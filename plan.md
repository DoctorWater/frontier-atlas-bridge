# План реализации: модуль `frontier-atlas-bridge`

Основа — `prototypes/proto-3` (мастер с предпросмотром). Из `proto-2`: цвет кнопки на панели сцены по состоянию и проверка хаба при открытии привязанной сцены (через предпросмотр, не молча). Остальное из proto-1/2 не берётся.

Финальный модуль собирается в `foundry/frontier-atlas-bridge/` (рядом с `brief.md`). Папку целиком можно подключить junction'ом в `%LOCALAPPDATA%\FoundryVTT\Data\modules\frontier-atlas-bridge`. `vendor-entry.ts`, `vite.vendor.config.ts`, `prototypes/`, `brief.md`, `plan.md` в релизный архив не входят (позже).

Принципы: один писатель (`apply(plan)`), один чтение-план (`buildPlan`); всё в хаб и обратно — только с клиента активного/текущего мастера; никакого кода в скрытых глобалах.

---

## 1. Файлы модуля

```
module.json                    id frontier-atlas-bridge, v14.360, recommends great-route-hex-crawl, esmodules, styles, languages
lang/en.json, lang/ru.json     ключи FAB.* (см. 3)
styles/bridge.css              окно + цвет кнопки [data-fab-status]
templates/                     HandlebarsApplicationMixin, по части на шаг:
  connect.hbs  maps.hbs  preview.hbs  result.hbs  scout.hbs
vendor/atlas.mjs               уже есть (см. 9)
scripts/
  main.mjs        только проводка: Hooks.once init/ready, getSceneControlButtons, renderSceneControls, canvasReady, updateJournalEntry
  const.mjs       ID, FLAG="frontier-atlas-bridge", GRHC="great-route-hex-crawl", ключи настроек
  settings.mjs    register(hubUrl, token, autoPush) + геттеры
  hub.mjs         клиент хаба: campaign(), map(id), pushExploration(id,cells); HubError{status,message}; нормализация URL; таймаут (AbortController 20 с)
  grid.mjs        hexKey(scene,col,row,doc,scale) и keyToHex — через scene.grid.getOffset (см. 5.1)
  plan.mjs        buildPlan(mapId, scene?) -> plan  (чтение, ничего не пишет)
  apply.mjs       apply(plan, onProgress) -> log  (единственный писатель; порядок см. 5.3)
  docs-*.mjs      tables.mjs / journal.mjs / scene.mjs — куски apply и diff (не раздувать apply)
  crawl.mjs       обёртка над api гекскраула: available(), config(scene), zonesPlan(), importConfig(), scoutCells()
  status.mjs      state(scene): "synced"|"update"|"error"|"unbound"; хранит in-memory {hubRev, error} по sceneId
  scout.mjs       scoutCells(scene) -> {cells[]}; send(s) ; autoPush с очередью
  app.mjs         класс BridgeWizard
  queue.mjs       общая последовательная очередь промисов (все записи: apply, push, check)
```

Кода-копипасты из прототипов нет: структура берётся, текст пишется заново (см. 11).

## 2. Хуки

| Хук | Что делает |
|---|---|
| `init` | регистрирует настройки; `Handlebars` не нужен (используем mixin) |
| `ready` (GM) | `A.setLang(ru/en по game.i18n.lang)`; ничего не грузит из хаба |
| `getSceneControlButtons` (GM) | **своя группа** `controls["frontier-atlas-bridge"]` (иконка `fa-solid fa-map-location-dot`), инструменты-кнопки: `open` (мастер), `scout` (разведка с предпросмотром); `visible: game.user.isGM` |
| `renderSceneControls` | находит `button.layer[data-control="frontier-atlas-bridge"]` (в v14 это `scene-controls-layers.hbs`), ставит `dataset.fabStatus = status.state(canvas.scene)` и `dataset.tooltipText` |
| `canvasReady` (GM) | если сцена привязана и есть токен: `checkHub(scene)` (см. 7) |
| `updateJournalEntry` (isActiveGM) | автоотправка (см. 6.3); также сбрасывает кэш `crawl.config` |
| `updateScene` / `deleteScene` | перерисовать кнопку (флаги привязки) |

Все хуки — только `game.user.isGM`; для автоотправки `game.user.isActiveGM` (иначе два мастера в мире отправят дважды).

## 3. Настройки и тексты

Настройки (все `scope: "client"`):
- `hubUrl` (String, `config:false`, по умолчанию `https://atlas.koshkaslojkoy.com`; локально мастер меняет на `http://localhost:3001`). Правится в шаге «Подключение», не в общем меню — чтобы не светить токен и не плодить формы.
- `token` (String, `config:false`) — вводится в `<input type="password">`. Хранится как plain client setting (localStorage): честно сказать в hint окна («токен = все секреты кампании, хранится только в этом браузере»).
- `autoPush` (Boolean, `config:true`, **default false**, hint: «без предпросмотра; только открывает гексы»).

Тексты: `lang/en.json`, `lang/ru.json`, префикс `FAB.` (`FAB.Title`, `FAB.Step.connect|maps|preview|result`, `FAB.Status.synced|update|error|unbound`, `FAB.Preview.*`, `FAB.Scout.*`, `FAB.Setting.*`, `FAB.Err.*`). Все строки окон — через `{{localize}}`/`game.i18n.format`; в JS нет русских литералов. Названия местностей для зон — `A.t(terrain.nameKey)` (**нужен экспорт `t` из `vendor-entry.ts`**, пересборка vendor; `setLang` уже вызывается). Название секретной страницы — `FAB.Secret`.

## 4. Классы окон и шаги

`BridgeWizard extends HandlebarsApplicationMixin(ApplicationV2)`, id `fab-wizard`, `PARTS` по шагам, `actions` вместо `data-act`-делегирования proto-3. Состояние: `step`, `mode`, `campaign`, `plan`, `scout`, `busy`, `error`. `_prepareContext` отдаёт данные шага; ошибка хаба рендерится в шапке (не alert).

Шаги `mode: "import"`:
1. **connect** — hubUrl + token, «Проверить» → `hub.campaign()`; ошибка `401` → понятный текст «токен неверен или отозван», сеть → «хаб недоступен» (+ подсказка про http/https mixed content: Foundry по https не достучится до http-хаба). Если токен уже сохранён и рабочий, шаг пропускается автоматически.
2. **maps** — радио по `campaign.maps` (имя, `shared`, `rev`); если активная сцена привязана — предвыбор её карты и бейдж.
3. **preview** — `buildPlan` → 4 категории с чекбоксами (таблицы, журнал, сцена, зоны), счётчики «создать / изменить / удалить / без изменений», список конфликтов (см. 5.4), для зон — что добавится/сохранится. Кнопка «Применить» неактивна, если всё unchecked или нет изменений («Всё актуально»).
4. **result** — журнал событий apply; если зоны не применились (нет API / нет хранилища и мастер отказался) — причина, не JSON-портянка. «Открыть сцену».

`mode: "scout"` (кнопка «Разведка»): один шаг **scout** — список гексов («14.08, 14.09…», `A.hexRef`), «Отправить и перерисовать фон» → done. Если API гекскраула нет — сообщение, не пустое окно.

`mode: "update"` — вход из `checkHub`: сразу шаг preview для привязанной карты (шаги 1–2 пропущены), заголовок «В хабе есть обновление (rev N → M)».

Окно одно (`foundry.applications.instances.get("fab-wizard")`); `busy` блокирует кнопки.

## 5. Модель флагов и алгоритм diff/apply

### 5.1 Флаги и ключи клеток
Флаги: `doc.setFlag/getFlag("frontier-atlas-bridge", …)` — id модуля без суффикса, scope валиден. В плане читаем `doc.flags[FLAG]` (синхронно, без валидации — быстрее в циклах), пишем через `update({ flags: { [FLAG]: … } })` внутри общих update'ов.

`flags["frontier-atlas-bridge"] = { mapId, kind: "scene"|"table"|"entry"|"note"|"folder", key, h?, hd?, … }`:
- scene: `{ mapId, kind:"scene", key:"scene", rev, bg (хэш фона), scale }`;
- table/entry: `h` = хэш входных данных хаба (source), `hd` = хэш записанного результата (для обнаружения правок в Foundry);
- page: `flags[FLAG].page = "body"|"secret"` (как в макросе хаба `foundryPack.ts`);
- note (Note сцены): `{ mapId, kind:"note", key }`.

Ключи клеток: `grid.mjs`. `centerPx = hexToPixel(doc, col, row) * scale + (dimensions.sceneX, sceneY)`; `const {i,j} = scene.grid.getOffset({x,y})`; ключ `"i,j"`. Обратно (разведка): для каждого `"i,j"` гекскраула строим карту `key → {col,row}` ОДИН раз по всем клеткам карты (cols×rows вызовов `getOffset`, кэш в плане на сцену), а не обратной формулой. Формулы из брифа остаются только как **assert при разработке** (тест на 3 сценах flat/pointy, чтобы проверить совпадение). Масштаб `scale` берётся из флага сцены (`flags[FLAG].scale`) — тот, что использовал `planFoundryGrid`; при создании пишется в флаг.

Требование: сцена существует (для `getOffset` нужна живая `scene.grid`). Для ещё не созданной сцены зоны не планируются (план «создание» → зоны после apply сцены, см. 5.3: apply делится на две фазы, зоны — шаг после создания, но в одном preview они показаны как «будут добавлены» с оценочным числом ячеек из `terrain`).

### 5.2 `buildPlan(mapId, scene)` — только чтение
1. `GET maps/:id` → `{doc, rev}`.
2. `players = A.playersDoc(doc)`; `bgHash = hash(JSON.stringify(players) + scale + ATLAS_BUILD)`. **PNG на предпросмотре НЕ рендерится** (улучшение против proto-3, где рендер шёл ради хэша байтов). `A.planFoundryGrid(...)`, `A.buildPackData(doc, grid, {name:`${slug}-${bgHash}.png`, width, height}, L("FAB.Secret"), "")` — размеры PNG известны из `planFoundryGrid` без рендера (если `buildPackData` требует реальные width/height PNG — взять `worldSize × scale`; проверить на этапе 1 реализации, пересобрать vendor при необходимости).
3. Таблицы/журнал: `diff(items, flaggedDocs, hashOf)` → `create / update / same / remove` (+`conflict`, 5.4). Хэш журнала включает множество `hexKeys` (ссылки `[[14.08]]` зависят от наличия заметок).
4. Сцена: нет → «создать»; есть → `bgChanged = flags.bg !== bgHash`, `geometryChanged` (width/height/grid.type/size), Note: create/update/remove по `flags.key` и (x,y,text).
5. Зоны: см. 6.2.
6. Возврат `plan = { mapId, rev, doc, pack, grid, scale, bgHash, tables, journal, scene, zones, sel }`, `sel` по умолчанию: всё `true`, `zones` — только если доступны.

### 5.3 `apply(plan)` — порядок и ссылки
Сериализуется через `queue`. Отказ посреди — частично применённое состояние безопасно (идемпотентно, повторный preview покажет остаток); пишем прогресс в `log`.

1. **Папки** (`Folder` типов RollTable / JournalEntry / Scene, флаг `{mapId, kind:"folder", key:type}`).
2. **RollTable — оболочки**: `create` без results, затем (для update) `deleteEmbeddedDocuments("TableResult")`.
3. **RollTable — results**: вторым проходом, когда все таблицы существуют, чтобы вложенные `documentUuid` (`r.ref` → таблица по флагу `key`) были реальными. Ссылка не нашлась → text-результат.
4. **JournalEntry — оболочки** (`ownership.default = NONE`), чтобы получить `uuid`.
5. **JournalEntry — страницы**: `@UUID[…]{label}` вместо `<a data-hex="c,r">`: карта `"c,r" → JournalEntry` из шага 4; если цели нет — просто текст ссылки. Страница `body` — `text.format = 1 (HTML)`; страница `secret` — `ownership.default = NONE`, существует ровно когда есть секрет (иначе удаляется). Страницы ищутся по `flags[FLAG].page`.
6. **Сцена**: создание — `PNG upload` → `Scene.create({ …pack.scene (без noteIcon/noteFont), levels:[{name, background:{src}}], flags })`; обновление — `scene.update({flags, [width/height/grid если изменились]})`; фон — `updateEmbeddedDocuments("Level", [{_id: scene.initialLevel.id, background:{src}}])` (5.5). Загрузка PNG только если `bgChanged` и сцена ещё не имеет такого файла (имя содержит хэш — проверка `FilePicker.browse`, повторно не заливаем).
7. **Notes**: после журналов (нужны `entryId`/`pageId`). create/update/delete по флагу `key`. Жетоны, стены, рисунки, освещение, регионы — **не трогаем**.
8. **Зоны гекскраула** — последний шаг (нужны `journalUuid`'ы шага 5 и сцена шага 6), см. 6.2.
9. Запись `flags.rev = plan.rev` и `flags.bg` — **последним update сцены** (после успеха шагов 1–7), чтобы сбой не оставил «синхронно» при половинчатом результате.
10. Удалённое в хабе удаляется (`remove`), но только документы с флагом `mapId`; пользовательские документы без флага — никогда.

Старые PNG: после успешного обновления фона удалять устаревшие файлы моста нельзя (у Foundry нет API удаления файлов с клиента без сервера). Решение: оставляем, хэш в имени; в README — «чистить `worlds/<world>/frontier-atlas/` вручную».

### 5.4 Правки в Foundry поверх моста (конфликты)
proto-3 их не замечал. Делаем: при апдейте журнала/таблицы сравниваем хэш **текущего содержимого** документа с `flags.hd`; не совпал → элемент в списке «изменено в Foundry — будет перезаписано» (категория по-прежнему управляется чекбоксом; без галочки не трогаем). Для Notes сцены — позиция/текст сравниваются напрямую. Папки/имена не отслеживаем.

### 5.5 Обновление фона на месте (v14.360, по исходникам)
Источники (`E:\Foundry VTT v14\resources\app\common\documents\scene.mjs`, `client\documents\scene.mjs`): фон в v14 живёт в **embedded `Level`** (`scene.levels`, фон = `level.background.src`); `scene.background.src`/`scene.update({"background.src":…})` — **shim** (`_LEVELS_PROPERTY_MAP`; `_preUpdate` переносит в `firstLevel`, есть `deprecated`-путь). `Scene#initialLevel` — стартовый уровень; `firstLevel` — «первый созданный» (в док-строке: не полагаться при мультиуровне).

Выбор: `scene.updateEmbeddedDocuments("Level", [{ _id: scene.initialLevel.id, background: { src } }])`. Причины: не deprecated; событие `_onUpdateDescendantDocuments` с `redrawKeys` содержит `"background"` → `canvas.draw()` у всех клиентов сам; не затрагивает жетоны/стены. Не `scene.update({levels:[…]})` (proto-2) — это путь с merge массива, поведение зависит от нюансов EmbeddedCollectionField; не используем без нужды. Если у сцены `levels.size === 0` (импортированная) — создать Level.

Как проверить в живом Foundry (`pf2test`): создать сцену мостом; в консоли `canvas.scene.initialLevel.background.src` → путь hash1; разместить жетон, стену, рисунок; в хабе разведать гекс; в мосте «Обновить»; проверить: фон сменился без перезагрузки страницы, `canvas.scene.initialLevel.background.src` → hash2, `tokens/walls/drawings` не изменились (`.size` и `_id`), на втором клиенте-игроке фон перерисовался; `canvas.scene.levels.size === 1`. Если `canvas.draw()` сбрасывает вид камеры — зафиксировать (допустимо) или сохранить `canvas.pan` до и вернуть после (решить по факту).

## 6. Гекскраул

### 6.1 Доступ
`crawl.available()` = модуль активен и `api.exportJson` существует. Ничего иного из внутренностей (`HexRepository`, `ImportService`) мост не импортирует — только публичный `api`. Версия: если нет `api.importJson` — зоны недоступны, мост честно пишет «обновите great-route-hex-crawl».

### 6.2 Зоны, хранилище, импорт
**Хранилища на сцене нет** (`api.inspect(scene).status === "unconfigured"`) — гекскраул создаёт его только через менеджер с подтверждением (`HexRepository.createStorage({confirmed})`), публичного метода нет. Решение моста: в предпросмотре категория «Зоны» показывает «Хранилище гекскраула не создано — будет создано» и отдельная галочка «создать хранилище»; при отметке `apply` вызывает `api.importJson(config, { scene, createStorage: true })` (новый параметр, см. 8) — подтверждение мастера = галочка в предпросмотре (аналог `confirmed:true`). Без галочки зоны пропускаются.

Статусы `api.inspect()` обрабатываются явно: `ok` → работаем; `unconfigured` → как выше; `geometry-mismatch` / `invalid-storage` / `missing-storage` / `empty-storage` / `unsupported-grid` → зоны отключены с причиной (мост ничего не чинит).

Построение конфига (чистая функция `buildCrawlConfig(current, plan, scene)`):
1. `current = JSON.parse(await api.exportJson(scene))` либо `createEmptyConfig` (если хранилища нет; тогда `geometry = api.geometry(scene)`, см. 8).
2. Зоны моста: `id = "fa-terrain-<terrainId>"`, `label` = локализованное имя местности, `priority: 0`, `cells` = ключи через `grid.mjs`. Создание: `bindings.encounter` из `gm.terrainTables[terrainId]` → `{id: randomID(), label:"", uuid: table.uuid, trigger:"arrival", chance:1, once:false, rollMode:"gmroll"}`; **у существующей зоны bindings, label, priority не трогаются, только `cells`**. Зоны с префиксом `fa-terrain-`, исчезнувшие в хабе, удаляются; чужие зоны (другой префикс) — никогда.
3. `hexes[key].journalUuid` для гексов с заметкой = uuid записи журнала (страницу `body` не указываем — гекскраул разрешает и JournalEntry; проверено регэкспом `JOURNAL_UUID`). Остальные поля гекса не трогаются (state/visitCount/bindings/notes мастера сохраняются). У гексов, чья заметка удалена в хабе, `journalUuid` очищается, **только если он указывает на документ моста**.
4. `settings`, `state`, `schemaVersion`, `geometry` — копируются как есть из `current` (мост не меняет `expeditionTokenUuid`, `autoTriggers`, `firedOnce`).
5. Дифф для предпросмотра — по зонам (create/update cells/remove, «bindings сохранены у N зон») и по гексам (journalUuid +N/−M), без вызова записи: `api.importJson(cfg, {scene, dryRun:true})` возвращает diff (6, 8) — предпросмотр опирается на **валидацию гекскраула**, а не на догадки моста.

Применение: `api.importJson(cfg, { scene, expect: <строка exportJson, из которой собрано>, createStorage })`. `expect` — защита от гонки: если пока мастер смотрел предпросмотр, экспедиция прибыла и состояние изменилось, `importJson` отказывает («устарело, пересчитайте»), мост перестраивает план. Это важно: без неё мост перезаписал бы `state`/`visitCount`.

### 6.3 Разведка и «прибытие экспедиции» (надёжно, по коду гекскраула)
Что делает гекскраул (`movement-controller.mjs`, `hex-controller.mjs`): по `moveToken` активный мастер ставит задачу в очередь, ждёт `movement.finished`, считает клетки, `hexController.arrival` → `repository.save` → `journal.update({ "flags.great-route-hex-crawl.data": validated })` на хранилище, uuid которого лежит в `scene.flags["great-route-hex-crawl"].locator.storageJournalUuid`. Пост-условие прибытия — именно эта запись (`visitCount++`, `state: unknown|discovered → visited`). Токен-хук `moveToken` для моста не годится: событие приходит до обработки гекскраулом, не знает, прошёл ли он автотриггеры/проверки (`autoTriggers`, `expeditionTokenUuid`, `movement.finished`, ограничение «1 гекс»).

Решение: `Hooks.on("updateJournalEntry", (journal, changes))`, фильтр: `game.user.isActiveGM`, `changes.flags?.[GRHC]?.data !== undefined`, журнал — хранилище какой-то привязанной сцены (`game.scenes.find(s => s.flags[FLAG]?.kind==="scene" && s.flags[GRHC]?.locator?.storageJournalUuid === journal.uuid)`; **proto-3 использовал «любое обновление любого журнала» — не берём**). Далее debounce 2 с + очередь + `scoutCells(scene)`; если новых гексов нет — тихий no-op (идемпотентно). Запись хранилища происходит и при `manual`, `resetOnce`, правке мастера в менеджере — это лишь лишний вызов `exportJson` без сети (сеть только при наличии новых гексов). Формат `changes` (вложенный diff) не используем — решение не зависит от него.

`scoutCells(scene)`: `cfg = JSON.parse(api.exportJson(scene))`; гексы со `state !== "unknown"`; `key → (col,row)` через `grid.mjs` (карта ключей); клетки вне карты — пропускаются с предупреждением в консоль; **сравнение с `doc.explored`** (нужен `GET maps/:id` — один запрос, он же даёт актуальный `doc` для перерисовки); отправка только неразведанных. `POST exploration`. Затем фон: `buildPlan`-light (только `bgHash`/PNG) → `apply` в режиме `bgOnly` (шаги 6 фон + 9 флаги `bg`; `rev` продвигается **только если сцена была актуальна до отправки**: иначе несодержательное обновление хаба затерлось бы — приём из proto-2).

Ручная разведка — с предпросмотром (список гексов, кнопка). Автоотправка (`autoPush`, default off) — без предпросмотра, с уведомлением «Отправлено N гексов» и записью в статус кнопки; ошибка → красная кнопка, не модалка.

## 7. Проверка хаба при открытии сцены и цвет кнопки (из proto-2)

`canvasReady` → привязана? (`scene.flags[FLAG]?.kind === "scene"`) и есть token → `queue(checkHub)`: `GET /api/bridge/campaign` (лёгкий; карту не качаем), `m = maps.find(id)`: нет → `status.error = "карта удалена в хабе"`; `m.rev !== flags.rev` → `status.hubRev = m.rev`, **уведомление с действием**: `DialogV2.confirm` «В хабе есть обновление, открыть предпросмотр?» → открывает `BridgeWizard` в режиме `update` (предпросмотр diff с галочками, **без** автоприменения; настройки `autoUpdate` в финале нет). «Нет» — кнопка остаётся оранжевой. Повторно за сессию на одну сцену диалог не спрашиваем (флаг в памяти), пока rev не поменялся ещё раз.

Состояния и цвет (CSS по `data-fab-status`):
- `unbound` (серый) — нет привязки;
- `synced` (зелёный) — `hubRev === flags.rev` (после проверки);
- `update` (оранжевый) — `hubRev !== flags.rev`;
- `error` (красный) — последняя операция/проверка упала (401, сеть, таймаут, карта удалена); текст — в тултипе кнопки и в окне.
Пока проверка не выполнялась или идёт — нейтральный (как `unbound`), не зелёный. После `apply`/`push` статус пересчитывается и `ui.controls.render()`. Периодического опроса хаба нет (проверка при открытии сцены + кнопка «Проверить» в окне + при открытии окна).

## 8. Правка гекскраула: `api.importJson`

**Положение:** гекскраул лежит без git прямо в `%LOCALAPPDATA%\FoundryVTT\Data\modules\great-route-hex-crawl`. Перед правкой — резервная копия папки (`great-route-hex-crawl.bak-<дата>` рядом **вне** папки `modules`, иначе Foundry увидит дубль-модуль; например `%LOCALAPPDATA%\FoundryVTT\backups\`), либо `git init` в копии. **Где живут «настоящие» исходники гекскраула — уточняется у пользователя** до правки (если есть отдельный репозиторий, правим там и синхронизируем, а не только установленную копию). Правка маленькая; версию поднять до 0.3.0 (новый API).

Файлы:
1. `scripts/main.mjs` — в `Object.freeze({...})` добавить:
```js
importJson: async (input, { scene = canvas?.scene, dryRun = false, createStorage = false, expect = null } = {}) => {
  if (!game.user?.isGM) throw new Error("GM only.");
  return repository.importFromApi(scene, input, { dryRun, createStorage, expect });
},
geometry: (scene = canvas?.scene) => { if (!game.user?.isGM) throw new Error("GM only."); return geometrySignature(scene); }
```
(+ импорт `geometrySignature`). `geometry` нужен мосту, чтобы собрать конфиг для сцены без хранилища, не копируя формулу сигнатуры.

2. `scripts/hex-repository.mjs` — метод `importFromApi(scene, input, {dryRun, createStorage, expect})`:
   - только GM; `input` — объект **или** JSON-строка; всегда прогоняется `this.importService.parse(typeof input === "string" ? input : JSON.stringify(input))` → ограничение размера (`MAX_IMPORT_BYTES`), `safeTree` (прототипные ключи), `migrate`, **полная строгая `validate`** (неизвестные поля — ошибка, UUID таблиц/журналов по регэкспам, лимиты, зоны/ячейки/биндинги). Отдельной «мягкой» ветки нет.
   - `status = await this.inspect(scene)`:
     - `unconfigured` и `createStorage === true` → после `dryRun`-проверок вызвать `createStorage(scene, {confirmed:true})` (сам требует GM и hex-сетку), затем `inspect` снова; `unconfigured` без `createStorage` → ошибка «storage missing».
     - иначе требует `status.status === "ok"` (как `importAtomic`) — `geometry-mismatch`, `invalid-storage` и т.д. → ошибка, **ничего не чинит**.
   - **геометрия:** `sameGeometry(candidate.geometry, geometrySignature(scene))` (как в `importAtomic`) — иначе ошибка «Imported geometry does not match this Scene».
   - `#validateExpeditionToken` (токен встроен в эту сцену).
   - `expect` (необяз.): строка/объект — вывод `exportJson` на момент сборки; если `JSON.stringify(validated текущий) !== JSON.stringify(expect валидированный)` → ошибка с кодом `STALE` (`error.code = "stale"`); защищает `state` от гонки с прибытием.
   - **diff/preview:** всегда считает `this.importService.diff(current, next)` (существующий) и возвращает `{ ok: true, dryRun, created, diff }` (дополнить diff списком id добавленных/удалённых/изменённых зон — небольшое расширение `diff`, чтобы мост показывал по зонам); при `dryRun: true` **ничего не пишет** и не создаёт хранилище (для `createStorage` в dry-run сообщает `{willCreateStorage:true}`).
   - запись — одним `journal.update({[`flags.${MODULE_ID}.${STORAGE_FLAG}`]: validated})` (одна запись, как `importAtomic`), для нового хранилища — создание и запись.
   - возвращает `{ ok, dryRun, created, diff, config }` (config — провалидированный объект, не ссылка на хранилище).
   Реализация — тонкая обёртка над существующим `importAtomic`/`createStorage`; `importAtomic` остаётся для UI менеджера.
3. `tests/core.test.mjs` — добавить тесты `ImportService`/(по возможности) обёртки: строгий отказ на лишнем поле, на чужой геометрии, на `__proto__`, dryRun без записи, `expect`-несовпадение. Запуск: `node --test tests/` в папке модуля.
4. `README.md`/`GUIDE_RU.md` — абзац про `importJson`/`geometry`. `module.json`: версия.

Без правок формата схемы (schemaVersion остаётся 1).

## 9. Общий код хаба: копия или бандл по URL

Варианты:
- **A. Копия `vendor/atlas.mjs` в модуле** (сейчас). Плюсы: офлайн, один источник кода (подписанный пакетом модуль), версии модуля и кода фиксированы, нет исполнения чужого кода в сессии мастера; импорт статический. Минусы: правки в хабе (рендер, `buildPackData`, `playersDoc`) не доходят, пока не пересобран и не обновлён модуль → PNG из моста может отличаться от PNG хаба; нужен процесс «собрали vendor → подняли версию модуля».
- **B. Хаб отдаёт `/bridge/atlas.mjs`**, модуль делает `await import(hub + "/bridge/atlas.mjs")`. Плюсы: всегда версия хаба, нет ручной пересборки. Минусы: **код из сети исполняется в сессии мастера с доступом ко всему миру и токену** (компрометация хаба = выполнение кода в Foundry); хаб должен отдавать CORS для `import()` (ES-модули требуют `Access-Control-Allow-Origin` у cross-origin); без сети/при недоступном хабе окно вообще не открывается (даже разведка по кэшу невозможна); мост должен проверять совместимость (код хаба может уйти вперёд от модуля — ломающееся API); при https-Foundry и http-хабе блокируется; сложнее отладка.
- **C. Гибрид:** копия + проверка версии сборки. Хаб в `GET /api/bridge/campaign` отдаёт `bridgeApi: <int>` (минимально поддерживаемая версия vendor); модуль знает свою `ATLAS_BUILD`; если хаб новее → бейдж «обновите модуль» и (опция) блокировка применения.

**Рекомендация: C.** Копия в модуле (A) + одна строка в хабе: поле `bridgeApi` (необязательное; модуль без него работает). Пересборка vendor — шаг релиза модуля (`npx vite build --config foundry/frontier-atlas-bridge/vite.vendor.config.ts`), `ATLAS_BUILD` экспортируется из `vendor-entry.ts`. Спорное: нужна ли правка хаба ради `bridgeApi` (см. Спорные места).

## 10. Как проверить в живом Foundry (я Foundry не запускаю — это чек-лист для пользователя/следующего этапа)

Подготовка: хаб `http://localhost:3001` (dev-вход `/auth/dev?name=Мастер`), кампания с картой (flat и pointy — две карты), разведанные гексы, заметки (одна с секретом, одна со ссылкой `[[14.08]]`), таблицы, `terrainTables`; токен Foundry со страницы кампании (показывается раз). Мир `pf2test`, Foundry 14.360, модули `frontier-atlas-bridge` (junction) и `great-route-hex-crawl` (после правки 8). Игрок-клиент во втором окне.

1. Подключение: неверный токен → ошибка 401; верный → имя кампании; хаб выключен → понятная ошибка.
2. Первый импорт без гекскраула (отключить его): предпросмотр «создать», apply → папки, RollTable (вложенные `documentUuid`), журналы (секрет — страница NONE; игрок её не видит), сцена с PNG-фоном, Notes; сетка совпадает с PNG (5.1 `getOffset`-тест: центр каждого гекса попадает в нужный ключ).
3. Тот же импорт повторно → «без изменений», apply неактивен.
4. Правка заметки / разведка в хабе → preview «изменить»; apply не трогает жетон, стену, рисунок (проверить `.size`), фон обновился на месте (5.5), у игрока — тоже.
5. Правка журнала в Foundry → конфликт в предпросмотре; без галочки не перезаписывается.
6. Гекскраул: включить, создать сцену без хранилища → в предпросмотре «будет создано хранилище»; apply → `api.inspect()` `ok`, зоны `fa-terrain-*`, `journalUuid` у гексов с заметкой; затем в менеджере изменить bindings зоны и `priority`, импортировать снова → не затёрты; `cells` обновились.
7. Гонка: открыть preview зон, сдвинуть экспедицию, нажать apply → `STALE`, план перестроился, `visitCount` не потерян.
8. Разведка: токен-экспедиция в новый гекс (включить `autoTriggers`) → ручная «Разведка»: список, отправка, гекс в хабе разведан, фон перерисован. `autoPush` on → то же без диалога, один запрос на прибытие.
9. Цвет кнопки: unbound (серый) → synced (зелёный) → поднять rev в хабе, переоткрыть сцену → диалог + оранжевый → «Предпросмотр» → apply → зелёный → отозвать токен в хабе → красный.
10. Игрок: кнопки, окно и настройки не видны; `game.settings.get(..., "token")` у игрока — свой (пустой).
11. Тесты: `node --check` всех `scripts/*.mjs`; для чистых функций (`buildCrawlConfig`, `diff`, `grid` с заглушкой `getOffset`) — небольшой `tests/core.test.mjs` (`node --test`). Для гекскраула — его тесты (8.3).
12. Консольные сверки: `game.modules.get("frontier-atlas-bridge")`, `canvas.scene.flags["frontier-atlas-bridge"]`, `canvas.scene.initialLevel.background.src`, `game.modules.get("great-route-hex-crawl").api.inspect()`.

## 11. Что берётся из прототипов и какие заглушки/догадки закрываются

**proto-3 — берётся:** шаги и идея `buildPlan`/`apply`, разделение diff на create/update/same/remove, оболочки→результаты для таблиц и журналов, ссылки `@UUID` вместо `data-hex`, папки с флагом, загрузка PNG в `worlds/<world>/frontier-atlas/`, имя файла с хэшем, страницы `body`/`secret`, `sceneBgOnly` режим, «никогда не перезаписывать bindings существующих зон», `scoutCells/sendScout`, список гексов в разведке, `canvasReady`-идея не оттуда.

**proto-3 — заглушки (`// prototype:`) и догадки, закрываемые по-настоящему:**
- `cellKey`/`keyToHex` по формулам → `scene.grid.getOffset` (5.1).
- `grhc.importJson(cfg)` «сигнатура предположена» + показ JSON вручную → реальный `api.importJson` со строгой валидацией (8); ручной JSON не нужен (остаётся лишь как диагностика при отсутствии API: кнопка «Скопировать JSON» опционально).
- `buildZones` падает «нет конфига», если нет хранилища → создание хранилища по галочке (6.2).
- Диф по сохранённым хэшам без обнаружения правок в Foundry → `hd` + конфликты (5.4).
- PNG рендерится на предпросмотре → хэш документа игроков (5.2).
- `scene.firstLevel.id` → `initialLevel` (5.5).
- Автоотправка по `updateJournalEntry` **любого** журнала → фильтр по хранилищу привязанной сцены (6.3).
- Нет защиты `state` от гонки → `expect`/`STALE` (6.2).
- Метка зоны = id местности, без локализованных имён → `A.t(nameKey)`.
- `gm.notes[id].tables` не привязываются к гексам → **не делаем** (спорное, ниже); `note-level` таблицы остаются таблицами в Foundry без привязки.
- Журналы с `ownership NONE` без настройки видимости → оставляем (мастер сам делится), документируем.
- Не запускалось в Foundry → это целиком этап проверки (10).
- Строки окна в `innerHTML` + `esc` → Handlebars-шаблоны (экранирует сам).
- Нет таймаутов/статусов ошибок хаба → `hub.mjs` с `HubError`.

**proto-2 — берётся:** цвет кнопки (`renderSceneControls`, `dataset.fabStatus`, тултип), `checkHub` на `canvasReady` через лёгкий `GET campaign` + сравнение `rev`, правило «`rev` продвигается только если сцена была актуальна», ключ идеи «`updateJournalEntry` на хранилище гекскраула = прибытие». **Не берём:** привязка «одним кликом» без предпросмотра, автообновление, очередь как «основной режим», `autoPush` по умолчанию вкл., отдельную панель «Link and create scene».

**proto-1 — не берём.**

Заглушки proto-2 (`importJson` «(config, scene)» — угадано; ручной JSON-диалог; один глобальный queue; нет offline/retry; zone label = terrain id) закрываются теми же пунктами.

## 12. Порядок работ

1. `module.json`, `lang`, настройки, `hub.mjs`, `status.mjs`, кнопка + цвет (без бизнес-логики).
2. `grid.mjs` + тест ключей; `plan.mjs` (таблицы/журнал/сцена); `apply.mjs`; окно шаги 1–4 → прогон чек-листа 1–5.
3. Правка гекскраула (бэкап → `importJson`, `geometry`, тесты) → `crawl.mjs` и зоны → чек-лист 6–7.
4. Разведка ручная + авто, `checkHub` → чек-лист 8–10.
5. Пересборка vendor (экспорт `t`, `ATLAS_BUILD`), опциональное поле `bridgeApi` в хабе, README модуля.

---

## Спорные места

1. **Группа кнопок: своя группа в панели сцены vs инструменты в группе токенов.** Варианты: (а) своя группа (цвет кнопки виден всегда, как в proto-2); (б) два инструмента в «Токенах» (как proto-3; цвет не покрасить без обхода). **Рекомендация: (а).**
2. **Создание хранилища гекскраула мостом.** Варианты: (а) мост создаёт при apply по галочке в предпросмотре (`importJson(..., {createStorage:true})`); (б) требовать, чтобы мастер сам создал в менеджере гекскраула; (в) создавать молча. **Рекомендация: (а)** — один шаг, явное подтверждение; (б) — запасной путь.
3. **Версионирование общего кода (`vendor`).** (A) копия, (B) бандл с хаба по URL, (C) копия + `bridgeApi` из хаба. **Рекомендация: C**; спорно, стоит ли ради неё менять хаб (без неё можно жить, но расхождение PNG хаба и моста не будет обнаружено).
4. **Правка гекскраула в месте установки.** Сейчас папка без git в `modules/`; правка требует бэкапа и, возможно, синхронизации с «настоящим» репозиторием. **Рекомендация:** сначала уточнить у пользователя, где исходники; до ответа правку не делать.
5. **Защита от гонки `expect`/`STALE`** — лишний параметр API гекскраула. Альтернатива — «прочитал-записал» без проверки (проще, но может затереть `visitCount`/`state`). **Рекомендация: оставить `expect`** (дёшево, спасает данные).
6. **Конфликты (правки в Foundry поверх моста).** (а) показывать и по умолчанию перезаписывать при галочке категории; (б) никогда не перезаписывать изменённое; (в) не следить. **Рекомендация: (а)** с видимым списком; (б) как опция позже.
7. **Автоотправка: сигнал.** (а) запись во флаг хранилища гекскраула (надёжно, но срабатывает и на ручные правки — безвредно); (б) `moveToken` (не знает, обработал ли гекскраул). **Рекомендация: (а)**, плюс debounce 2 с и проверка «есть ли новые гексы».
8. **Проверка обновлений хаба.** Только при открытии сцены/окна (без опроса) vs периодический опрос раз в N минут (кнопка оранжевеет во время долгой сессии). **Рекомендация:** без опроса в первой версии; опрос раз в 5 мин — дешёвое расширение (один `GET campaign`).
9. **Видимость журналов игрокам.** Сейчас `ownership.default = NONE` (как макрос хаба); мастер открывает доступ сам. Альтернатива: настройка «открывать журналы» или открывать body-страницы для OBSERVER. **Рекомендация:** оставить NONE (игроки не должны видеть до решения мастера), настройку не добавлять.
10. **Заметки с `gm.notes[id].tables`.** Привязывать к гексу (binding в `hexes[key].bindings`) или оставить только таблицей Foundry. **Рекомендация:** пока не привязывать; спросить, нужно ли (иначе мост «владеет» binding-ами гекса, и правки мастера затрутся).
11. **Старые PNG в `worlds/<world>/frontier-atlas/`.** Не чистятся (нет API). Альтернатива: перезаписывать один файл с `?v=rev` (ломает кэш/откат, в Foundry путь с `?` ненадёжен). **Рекомендация:** имя с хэшем, чистка вручную, строка в README.
12. **Токен в localStorage браузера (client setting).** Альтернатива — вводить на каждую сессию (не сохранять). **Рекомендация:** хранить (как в брифе), предупреждать в окне, кнопка «Забыть токен».
13. **Куда ставить «Разведку» и нужен ли предпросмотр у ручной.** Оставляем отдельной кнопкой с предпросмотром (по выбору пользователя); автоотправка — опция, без предпросмотра.

---

# ИТОГОВЫЕ РЕШЕНИЯ (после ревью Критика и ответов пользователя) — перебивают всё выше

## Ответы пользователя
1. **Гекскраул:** исходников нет — правим установленную копию `%LOCALAPPDATA%\FoundryVTT\Data\modules\great-route-hex-crawl\`. Перед правкой полная резервная копия ВНЕ папки FoundryVTT: `D:\ClaudeFun\backups\great-route-hex-crawl-0.2.0\`. Версия → 0.3.0, тесты модуля (`tests/core.test.mjs`) зелёные.
2. **Смена геометрии** (cols/rows/hexSize/orientation/масштаб → другие width/height/grid сцены): мост **не меняет** существующую сцену. Предпросмотр показывает «Размер карты изменился — будет создана новая сцена; старая останется как есть (жетоны, стены, гекскраул)». Применение: новая сцена (с зонами гекскраула), привязка (`flags` моста) переходит на неё; у старой флаги моста снимаются (она больше не обновляется). Журнал и таблицы — общие, обновляются на месте как обычно. Никакого `rebaseGeometry`.
3. **Конфликты:** запись/таблица, изменённая в Foundry (`hd` не совпадает), — в предпросмотре пометка «изменено в Foundry», по умолчанию НЕ трогается, галочка заменяет версией хаба. То же при удалении (удалённое в хабе, но правленное в Foundry, — конфликт, по умолчанию не удаляется).
4. **Метки заметок:** у заметок без `shown` текст Note = только номер гекса («14.08»); у открытых — «14.08 Название».

## Правки по ревью (обязательны)
- **API гекскраула — минимально, два метода** (только GM):
  - `api.createStorage(scene = canvas.scene)` → создаёт хранилище, как кнопка менеджера с подтверждением (`createStorage(scene, {confirmed:true})`); если уже есть — возвращает существующее. Результат `{ status, storageJournalUuid }`.
  - `api.updateConfig(mutate, { scene = canvas.scene } = {})` → выполняется **в той же очереди сцены, что и обработка прибытия** (сериализация с `MovementController`): `inspect` (статус должен быть `ok`, иначе ошибка с кодом статуса) → `structuredClone(config)` → `await mutate(clone)` → строгая валидация модуля (как импорт) → атомарная запись. Возвращает `{ ok:true, diff }`. Мост строит изменения на СВЕЖЕМ конфиге внутри `mutate` — гонка с прибытием и `expect/STALE` не нужны.
  - Существующее поведение гекскраула не меняется; менеджер/импорт/прибытие работают как раньше.
- **Ключи клеток** строятся по целевой геометрии без живой сцены: `new foundry.grid.HexagonalGrid({size, columns: flat, even: true})` из `pack.scene.grid` (padding 0 → origin 0), центр гекса = `hexToPixel × scale` → `getOffset`. Двухфазное применение и флаг `scale` не нужны.
- **Размеры PNG без рендера:** строго `Math.ceil(worldSize × scale)`; после рендера проверить `png.width/height` совпали, иначе ошибка.
- **Проверка хаба (цвет кнопки, предложение обновить):** запуск только при смене `canvas.scene.id` (не на каждый `canvasReady`), делает `GET maps/:id` и сравнивает `rev` **и хэш фона** (разведка не меняет `rev`!). Диалог «Обновить» — вне очереди записей. `bgOnly`-перерисовка не трогает `flags.rev`.
- **`rev` в флаг сцены** пишется, только если применены все категории с изменениями (включая зоны); хэш фона — только если применён фон. Иначе кнопка «есть обновление».
- **Ссылки гексов на журнал:** целевая карта «гекс → uuid записи моста»; пишем только если текущее значение пустое или принадлежит мосту; ссылки моста вне целевой карты очищаем; чужую ссылку мастера не трогаем, показываем в предпросмотре.
- **Зоны:** исчезнувшая местность → зона `fa-terrain-*` остаётся с `cells: []` (привязки мастера сохраняются); при удалении таблицы её uuid убирается из привязок зон `fa-terrain-*`; предпросмотр предупреждает, что раскраска зон местностей перезаписывается.
- **`hd` (хэш для конфликтов)** считать после записи, по содержимому, прочитанному из документа. Для таблиц конфликты в первой версии не отслеживать (таблицы правятся в хабе).
- **Настройки:** `autoPush` — `config: false`, переключатель в окне моста. Токен хранится по миру: client-настройка `tokens = {[game.world.id]: token}`; кнопка «Забыть токен». Условие автоотправки — «в этом клиенте есть токен и autoPush», не `isActiveGM` (`POST exploration` идемпотентен).
- **Общий код хаба:** копия `vendor/atlas.mjs` в модуле (пересобирается `vite.vendor.config.ts`); совместимость — по `doc.version` (сейчас 1): неизвестная версия → понятная ошибка. Без правки хаба.
- **Размер конфига гекскраула:** при превышении его лимита — понятная ошибка в предпросмотре.
- **README:** скрытая страница журнала и метки — скрытие интерфейсом Foundry, не защита от игрока с DevTools; старые PNG в `worlds/<world>/frontier-atlas/` чистить вручную.
- **Состав:** ~5 скриптов (`main`, `hub`, `sync` — план/применение/разведка, `app` — окно, `grid`) и один шаблон или HTML-строки; без мёртвых веток (`levels.size === 0`, `FilePicker.browse`).
