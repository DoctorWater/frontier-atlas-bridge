# Бриф: модуль-мост Foundry VTT ↔ хаб Frontier Atlas

## Назначение
Мастер West Marches готовит мир в хабе Frontier Atlas (https://atlas.koshkaslojkoy.com; локально — http://localhost:3001 с dev-входом), а сессии ведёт в Foundry с модулем гекскраула `great-route-hex-crawl`. Мост:
1. **Хаб → Foundry:** по токену кампании берёт карту, создаёт или **обновляет на месте** сцену (фон — **карта игроков**: только разведанное и открытое), записи журнала (по заметкам, секрет — на скрытой странице) и RollTable; настраивает гекскраул: зоны по местностям и журналы на гексах.
2. **Foundry → хаб:** состояния гексов из гекскраула (`discovered` / `visited` / `cleared`) уходят в хаб как разведанные гексы. **Только открывать**: `unknown` в хабе ничего не закрывает. После отправки фон сцены перерисовывается — игроки видят новые гексы по ходу сессии.

## Пользователи и права
Только мастер. Все запросы к хабу — только с клиента мастера (`game.user.isGM`). Игроки модуль не видят.

## Платформа
- Foundry VTT **v14.360** (стоит у пользователя: `E:\Foundry VTT v14`, данные `%LOCALAPPDATA%\FoundryVTT`, тестовый мир `pf2test` с pf2e; модуль `great-route-hex-crawl` 0.2.0 установлен). Модуль system-agnostic.
- `compatibility: { minimum: "14.360", verified: "14.360" }`. API v14 — сверяй с https://foundryvtt.com/api/ (WebFetch), не выдумывай. Справка: `ApplicationV2` + `HandlebarsApplicationMixin`, хуки v13+ отдают `HTMLElement`.
- Зависимости: только ядро Foundry. `great-route-hex-crawl` — **необязательный** (`relationships.recommends`): без него мост делает сцену/журнал/таблицы, с ним — ещё зоны и обратную разведку.
- Языки: en + ru (`languages`, файлы `lang/en.json`, `lang/ru.json`).

## UI
Окно моста (ApplicationV2) + кнопка на панели инструментов сцены (`getSceneControlButtons`), видна только мастеру. Внешний вид — в стиле Foundry, функционально.

## Настройки
- `hubUrl` (адрес хаба), `token` — **`scope: "client"`** (токен = все секреты кампании; мировые настройки видят игроки). Токен вводит мастер (берёт в хабе: страница кампании → панель Foundry → «Создать токен»; показывается один раз).
- `autoPush` (client, bool, по умолчанию выкл.) — автоотправка разведки при каждом прибытии экспедиции.

## API хаба (Bearer-токен, CORS открыт, cookie не используются)
- `GET {hub}/api/bridge/campaign` → `{ id, name, maps: [{ id, name, rev, shared }] }` (порядок создания).
- `GET {hub}/api/bridge/maps/:id` → `{ doc: MapDoc (полный, с gm и explored), rev }`.
- `POST {hub}/api/bridge/maps/:id/exploration` `{ cells: [{ col, row, explored: true }] }` → разведка по клеткам, идемпотентно; клетка вне карты — 400 на весь запрос.
- Ошибки: JSON `{error}`; 401 — токен неверный/отозван (создатель токена больше не мастер).
`MapDoc`: `src/core/model.ts` репозитория (`cols`, `rows`, `orientation` flat|pointy, `hexSize`, `terrain[row*cols+col]`, `explored[]` 0/1, `features`, `labels`, `paths`, `notes [{id,col,row,title,body,shown?}]`, `gm: { tables, terrainTables: {terrainId: tableId[]}, notes: {noteId: {secret, tables?}} }`).

## Общий код хаба — `vendor/atlas.mjs` (готов, импортировать относительным путём)
Собран из исходников хаба; пересборка: `npm run build:bridge-vendor` в репозитории хаба (`tools/bridge-vendor/`). Экспорт:
- `playersDoc(doc)` — карта, какой её видят игроки (разрешающий список полей, пути обрезаны).
- `renderPng(doc, { scale, grid:false, fog:'players', background:'none'|'paper'|'dark' })` → `{ blob, width, height, scale }` — PNG в браузере (DOM canvas).
- `planFoundryGrid(doc, scale, fitScale)` / `foundryGrid(doc, scale)` → `{ type, size, scale }` — сетка Foundry, совпадающая с PNG (HEXEVENQ=5 для flat, HEXEVENR=3 для pointy; padding 0). Проверено в живом Foundry 14.360.
- `buildPackData(doc, grid, png, secretName, doneText)` → `{ scene:{width,height,grid,noteIcon,noteFont,…}, tables:[{key,name,formula,results:[{lo,hi,html,ref?}]}], entries:[{key,col,row,x,y,name,label,body,secret}] }` — готовые данные для сцены/таблиц/журнала (HTML уже санитизирован, `[[14.08]]` → `<a data-hex="c,r">`). Как превратить их в документы, показывает макрос `src/export/foundryPack.ts` (`MACRO_BODY`): папки, RollTable с вложенными `documentUuid`, JournalEntry со страницами `flags.worldograther.page = body|secret`, сцена с `levels: [{ name, background: { src } }]` и Notes.
- `hexToPixel(doc,col,row)`, `hexRef(col,row)` («14.08»), `worldSize`, `validateDoc`, `terrains` (id, nameKey, color), `setLang('ru'|'en')`.
PNG грузится в мир через `FilePicker` (v14: `foundry.applications.apps.FilePicker.implementation.upload`) в `worlds/<world>/frontier-atlas/`.

## Связь документов
Всё, что создаёт мост, помечается флагом `flags["frontier-atlas-bridge"] = { mapId, kind, key }` (key = id заметки/таблицы в хабе). Повторное «Получить» находит документы по флагу и **обновляет на месте**: жетоны, стены, рисунки и состояние гекскраула на сцене не трогает; удалённое в хабе удаляет в Foundry.

## Гекскраул (`great-route-hex-crawl`)
- Хранилище: приватный JournalEntry; конфиг схемы v1: `{ schemaVersion:1, geometry, settings:{autoTriggers, expeditionTokenUuid}, zones:[{id,label,priority,cells:["i,j"],bindings:{encounter:[],weather:[],discovery:[],loot:[],custom:[]}}], hexes:{"i,j":{journalUuid,notes,state:"unknown"|"discovered"|"visited"|"cleared",visitCount,inheritMode,bindings}}, state:{firedOnce:{}} }`. Binding: `{id,label,uuid:"RollTable.…",trigger:"manual"|"arrival"|"first-arrival",chance,once,rollMode}`.
- Публичный API (`game.modules.get("great-route-hex-crawl").api`): `inspect()`, `resolveCell(key)`, `manual(key)`, `resetOnce(key)`, `exportJson()`, `openManager()`. **Метода импорта пока нет** — пользователь решил добавить `api.importJson(config)` в гекскраул на этапе разработки. В прототипе: если `api.importJson` есть — вызвать, иначе показать собранный JSON для ручного импорта в менеджере гекскраула (`// prototype:`).
- Координаты: ключ клетки `"i,j"` — offset Foundry. Надёжнее всего брать `scene.grid.getOffset({x,y})` центра гекса (`hexToPixel × scale`). Для справки (проверено): flat — `i = row + (col & 1)`, `j = col`; pointy — `i = row`, `j = col + (row & 1)`.
- Зоны моста: по одной на местность, `id = "fa-terrain-<terrainId>"`, cells = гексы этой местности; bindings — из `gm.terrainTables` (категория `encounter`, trigger `arrival`, chance 1) **только при создании зоны**: настроенные мастером bindings при обновлении не перезаписываются. Гексам с заметкой — `journalUuid` записи журнала.
- Обратно: `exportJson()` → гексы со state ≠ unknown → (col,row) → `POST exploration`. Автоотправка: на прибытие экспедиции (обновление токена-маркера или изменение хранилища гекскраула — выбери и опиши).

## Не входит
Совместная правка в реальном времени; правка карты из Foundry (кроме разведки); перенос жетонов/стен в хаб; туман Foundry; публикация модуля (manifest) — позже.

## Прототипы
N = 3, ось — **UX-подход**. Каждый прототип — отдельный модуль в `prototypes/proto-<k>/` с id `frontier-atlas-bridge-proto-<k>`; `vendor/atlas.mjs` — копировать в прототип или импортировать относительным путём `../../vendor/atlas.mjs` (Foundry грузит модуль из своей папки — **копируй**).
