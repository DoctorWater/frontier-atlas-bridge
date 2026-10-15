// План (чтение), применение (единственный писатель), разведка и проверка хаба.
import * as A from "../vendor/atlas.mjs";
import * as hub from "./hub.mjs";
import { ID as FLAG, GRHC, hash, cellKeys, hexTargets, noteLabel, bgHash, entryHash, diffItems, diffNotes, newCells, sameGeometry, applyBridge, crawlChanged } from "./grid.mjs";

const L = (k) => game.i18n.localize(k);
const F = (k, d) => game.i18n.format(k, d);
const cls = (n) => CONFIG[n].documentClass;

/* ---------- очередь записей и состояние кнопки ---------- */

let tail = Promise.resolve();
/** Все записи (apply, отправка разведки) идут строго по одной. */
export const queue = (fn) => { const p = tail.then(fn); tail = p.catch(() => {}); return p; };

const states = new Map();
export const status = {
  /** unbound | unknown (ещё не проверяли) | synced | update | error */
  state: (scene) => (scene?.flags?.[FLAG]?.kind !== "scene" ? "unbound" : states.get(scene.id)?.state ?? "unknown"),
  error: (scene) => states.get(scene?.id)?.error ?? "",
  set(scene, state, error = "") { states.set(scene.id, { state, error }); ui.controls?.render(); }
};

export const crawlApi = () => { const m = game.modules.get(GRHC); return m?.active ? m.api ?? null : null; };

/* ---------- общие куски ---------- */

const mine = (coll, mapId, kind) => coll.filter((d) => d.flags?.[FLAG]?.mapId === mapId && d.flags[FLAG].kind === kind);
const geomOf = (s) => ({ width: s.width, height: s.height, gridType: s.grid.type, gridSize: s.grid.size });
const targetGeom = (lay) => ({ width: lay.width, height: lay.height, gridType: lay.g.type, gridSize: lay.g.size });
const tHash = (t) => hash(JSON.stringify(t));
const pagesOf = (d) => d.pages.filter((p) => p.flags?.[FLAG]?.page).map((p) => ({ kind: p.flags[FLAG].page, name: p.name, content: p.text.content }));
const docHash = (d) => entryHash(d.name, pagesOf(d));
// текст записи зависит от того, есть ли заметки у гексов, на которые она ссылается ([[14.08]] — ссылка, только если цель есть)
const eHash = (e, hexKeys) => {
  const s = JSON.stringify([e.name, e.body, e.secret]);   // x/y и подпись — дело меток, они сравниваются отдельно
  const refs = [...new Set([...s.matchAll(/data-hex=\\"(\d+,\d+)\\"/g)].map((m) => m[1]))].sort();
  return hash(s + refs.map((k) => k + (hexKeys.has(k) ? "+" : "-")).join(";") + L("FAB.Secret"));
};
const hexKeysOf = (entries) => new Set(entries.map((e) => `${e.col},${e.row}`));

function layout(doc) {
  const { width: ww, height: wh } = A.worldSize(doc, doc.cols, doc.rows);
  const g = A.planFoundryGrid(doc, 1, (s) => A.fitScale(ww, wh, s));
  const players = A.playersDoc(doc);
  const bg = bgHash(players, g, game.modules.get(FLAG).version);
  const base = (doc.name || "map").replace(/[#%?&+\s/\\:*"<>|]+/g, "_");
  // размеры PNG известны без рендера: ровно как считает renderPng
  return { g, players, bg, width: Math.ceil(ww * g.scale), height: Math.ceil(wh * g.scale), file: `${base}-${bg}.png` };
}

// ключи клеток по целевой геометрии (padding 0 → начало координат сцены в (0,0)), без живой сцены
function keysOf(doc, g) {
  const grid = new foundry.grid.HexagonalGrid({ size: g.size, columns: g.type === CONST.GRID_TYPES.HEXEVENQ, even: true });
  return cellKeys(doc, g.scale, (p) => grid.getOffset(p));
}

async function upload(blob, name) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dir = `worlds/${game.world.id}/frontier-atlas`;
  try { await FP.createDirectory("data", dir); } catch { /* уже есть */ }
  const res = await FP.upload("data", dir, new File([blob], name, { type: "image/png" }), {}, { notify: false });
  if (!res?.path) throw new Error(L("FAB.Err.upload"));
  return res.path;
}

async function uploadBg(lay) {
  const png = await A.renderPng(lay.players, { scale: lay.g.scale, grid: false, fog: "players", background: "paper", layers: { numbers: false } });
  if (png.width !== lay.width || png.height !== lay.height) throw new Error(F("FAB.Err.pngSize", { w: png.width, h: png.height, ew: lay.width, eh: lay.height }));
  return upload(png.blob, lay.file);
}

// фон в v14 живёт в Level; обновление встроенного документа перерисовывает сцену у всех клиентов
async function paintBg(scene, lay) {
  const src = await uploadBg(lay);
  await scene.updateEmbeddedDocuments("Level", [{ _id: scene.initialLevel.id, background: { src } }]);
}

const resolves = (uuid) => { try { return !!fromUuidSync(uuid); } catch { return false; } };

const crawlCtx = (plan, uuidE, uuidT, removedTables) => ({
  doc: plan.doc, keys: plan.cells.keys, index: plan.cells.index, targets: plan.targets,
  entryUuid: uuidE, tableUuid: uuidT, removedTables,
  // нерешаемая ссылка (документ удалён) считается заменяемой, а не чужой
  isBridgeUuid: (u) => plan.bridgeUuids.has(u) || !resolves(u),
  label: (tid) => { const t = A.terrains.find((x) => x.id === tid); return t ? A.t(t.nameKey) : tid; }
});

/* ---------- план: ничего не пишет ---------- */

export async function buildPlan(mapId) {
  const { doc, rev } = await hub.map(mapId);
  const lay = layout(doc);
  const pack = A.buildPackData(doc, lay.g, { name: lay.file, width: lay.width, height: lay.height }, L("FAB.Secret"), "");
  const shown = new Set(doc.notes.filter((n) => n.shown).map((n) => n.id));
  const hexKeys = hexKeysOf(pack.entries);

  const tdocs = mine(game.tables, mapId, "table"), edocs = mine(game.journal, mapId, "entry");
  const tables = diffItems(pack.tables, tdocs.map((d) => ({ key: d.flags[FLAG].key, h: d.flags[FLAG].h })), tHash);
  const journal = diffItems(pack.entries, edocs.map((d) => ({ key: d.flags[FLAG].key, h: d.flags[FLAG].h, hd: d.flags[FLAG].hd, cur: docHash(d) })), (e) => eHash(e, hexKeys));

  const sc = pack.scene;
  const bound = mine(game.scenes, mapId, "scene")[0] ?? null;
  // геометрия изменилась — существующую сцену не трогаем, будет новая
  const recreate = !!bound && !sameGeometry(geomOf(bound), targetGeom(lay));
  const existing = recreate ? null : bound;
  const have = new Map((existing?.notes ?? []).filter((n) => n.flags?.[FLAG]?.key).map((n) => [n.flags[FLAG].key, { x: n.x, y: n.y, text: n.text }]));
  const notes = diffNotes(pack.entries, have, (e) => noteLabel(e, shown), new Set(journal.create.map((e) => e.key)));
  const scene = { bound, existing, recreate, bgChanged: !existing || existing.flags[FLAG].bg !== lay.bg, notes };

  const plan = {
    mapId, rev, doc, lay, pack, shown, tables, journal, scene,
    cells: keysOf(doc, lay.g), targets: hexTargets(pack.entries, doc.cols),
    bridgeUuids: new Set(game.journal.filter((d) => d.flags?.[FLAG]?.kind === "entry").map((d) => d.uuid))
  };
  plan.zones = await zonesPlan(plan, tdocs, edocs);
  plan.conflicts = [...journal.conflicts].map((k) => pack.entries.find((e) => e.key === k)?.name ?? edocs.find((d) => d.flags[FLAG].key === k)?.name ?? k);

  const n = (d) => d.create.length + d.update.length + d.remove.length;
  plan.cats = {
    tables: n(tables) > 0, journal: n(journal) > 0,
    scene: !existing || scene.bgChanged || n(notes) > 0,
    zones: plan.zones.on && (plan.zones.newStorage || crawlChanged(plan.zones.sum))
  };
  plan.changed = Object.values(plan.cats).some(Boolean) || (!!existing && existing.flags[FLAG].rev !== rev);
  plan.sel = { tables: true, journal: true, scene: true, zones: plan.zones.on, overwrite: false };
  return plan;
}

async function zonesPlan(plan, tdocs, edocs) {
  const off = (why) => ({ on: false, why });
  const api = crawlApi();
  if (!api) return off(L("FAB.Zones.noModule"));
  if (!api.createStorage || !api.updateConfig) return off(L("FAB.Zones.old"));
  const bound = plan.scene.existing;
  let cfg = { zones: [], hexes: {} }, newStorage = true;
  if (bound) {
    const st = (await api.inspect(bound)).status;
    if (st === "ok") { cfg = JSON.parse(await api.exportJson(bound)); newStorage = false; }
    else if (st !== "unconfigured") return off(F("FAB.Zones.status", { status: st }));
  }
  const tby = new Map(tdocs.map((d) => [d.flags[FLAG].key, d.uuid])), eby = new Map(edocs.map((d) => [d.flags[FLAG].key, d.uuid]));
  const gone = new Set(plan.tables.remove.map((k) => tby.get(k)));
  const sum = applyBridge(cfg, crawlCtx(plan, (k) => eby.get(k) ?? `JournalEntry.${k}`, (k) => tby.get(k) ?? `RollTable.${k}`, gone));
  if (sum.tooBig) return off(F("FAB.Zones.tooBig", { mb: (sum.bytes / 1048576).toFixed(1) }));
  return { on: true, newStorage, sum };
}

/* ---------- применение ---------- */

export const apply = (plan) => queue(() => run(plan));

async function run(plan) {
  const { sel, pack, mapId, doc, lay } = plan;
  const log = [], skipped = {}, ow = sel.overwrite;
  const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  const flag = (kind, key, extra) => ({ [FLAG]: { mapId, kind, key, ...extra } });
  const folder = async (type) => game.folders.find((f) => f.type === type && f.flags?.[FLAG]?.mapId === mapId)
    ?? cls("Folder").create({ name: doc.name || "Map", type, flags: flag("folder", type) });

  // таблицы: сначала оболочки, затем строки — вложенные documentUuid должны быть настоящими
  const tdoc = new Map(mine(game.tables, mapId, "table").map((d) => [d.flags[FLAG].key, d]));
  const goneTables = new Set();
  if (sel.tables) {
    const { create, update, remove } = plan.tables;
    const f = create.length ? await folder("RollTable") : null;
    for (const t of create) tdoc.set(t.key, await cls("RollTable").create({ name: t.name, formula: t.formula, folder: f.id, replacement: true, displayRoll: true, flags: flag("table", t.key, { h: tHash(t) }) }));
    for (const t of update) {
      const d = tdoc.get(t.key);
      await d.update({ name: t.name, formula: t.formula, flags: flag("table", t.key, { h: tHash(t) }) });
      await d.deleteEmbeddedDocuments("TableResult", d.results.map((r) => r.id));
    }
    for (const t of [...create, ...update]) {
      const results = t.results.map((r) => {
        const base = { range: [r.lo, r.hi], weight: Math.max(1, r.hi - r.lo + 1) };
        const target = r.ref ? tdoc.get(r.ref) : null;
        return target
          ? { ...base, type: "document", name: target.name, description: r.html, documentUuid: target.uuid }
          : { ...base, type: "text", name: "", description: r.html };
      });
      if (results.length) await tdoc.get(t.key).createEmbeddedDocuments("TableResult", results);
    }
    for (const k of remove) { const d = tdoc.get(k); goneTables.add(d.uuid); tdoc.delete(k); await d.delete(); }
    log.push(F("FAB.Log.tables", { c: create.length, u: update.length, d: remove.length }));
  }

  // журнал: оболочки, затем страницы — ссылки @UUID на гексы ведут на настоящие записи
  const edoc = new Map(mine(game.journal, mapId, "entry").map((d) => [d.flags[FLAG].key, d]));
  if (sel.journal) {
    const { create, update, remove, conflicts } = plan.journal;
    const f = create.length ? await folder("JournalEntry") : null;
    for (const e of create) edoc.set(e.key, await cls("JournalEntry").create({ name: e.name, folder: f.id, ownership: { default: NONE }, flags: flag("entry", e.key) }));
    const byHex = new Map([...plan.targets].map(([idx, k]) => [`${idx % doc.cols},${Math.floor(idx / doc.cols)}`, edoc.get(k)]));
    const link = (html) => html.replace(/<a data-hex="(\d+),(\d+)"[^>]*>(.*?)<\/a>/g, (m, c, r, label) => {
      const t = byHex.get(`${c},${r}`);
      return t ? `@UUID[${t.uuid}]{${label}}` : label;
    });
    const hexKeys = hexKeysOf(pack.entries), secretName = L("FAB.Secret");
    const todo = [...create, ...update.filter((e) => ow || !conflicts.has(e.key))];
    for (const e of todo) {
      const d = edoc.get(e.key);
      await d.update({ name: e.name });
      const page = (k) => d.pages.find((p) => p.flags?.[FLAG]?.page === k);
      const body = page("body"), secret = page("secret");
      const bodyData = { name: e.name, type: "text", sort: 100000, text: { content: link(e.body), format: 1 }, flags: { [FLAG]: { page: "body" } } };
      const secretData = { name: secretName, type: "text", sort: 200000, text: { content: link(e.secret), format: 1 }, ownership: { default: NONE }, flags: { [FLAG]: { page: "secret" } } };
      if (body) await body.update(bodyData); else await d.createEmbeddedDocuments("JournalEntryPage", [bodyData]);
      if (e.secret && secret) await secret.update(secretData);
      else if (e.secret) await d.createEmbeddedDocuments("JournalEntryPage", [secretData]);
      else if (secret) await secret.delete();
      // hd — по содержимому, прочитанному из документа после записи
      await d.update({ flags: flag("entry", e.key, { h: eHash(e, hexKeys), hd: docHash(d) }) });
    }
    for (const k of remove) if (ow || !conflicts.has(k)) { await edoc.get(k).delete(); edoc.delete(k); }
    // оставленная без галочки правка — решение мастера, а не сбой: запоминаем версию хаба (h), hd не трогаем —
    // следующее изменение в хабе снова даст конфликт; удалённая в хабе запись отвязывается и остаётся мастеру
    const kept = ow ? 0 : conflicts.size;
    if (kept) {
      for (const e of update) if (conflicts.has(e.key)) await edoc.get(e.key).update({ [`flags.${FLAG}.h`]: eHash(e, hexKeys) });
      for (const k of remove) if (conflicts.has(k)) { await edoc.get(k).update({ flags: { [FLAG]: new foundry.data.operators.ForcedDeletion() } }); edoc.delete(k); }
    }
    log.push(F("FAB.Log.journal", { c: create.length, u: todo.length - create.length, d: remove.filter((k) => ow || !conflicts.has(k)).length, k: kept }));
  }

  // сцена: фон, метки; жетоны, стены, рисунки и состояние гекскраула не трогаем
  let scene = plan.scene.existing, bgDone = false;
  if (sel.scene) {
    const sc = pack.scene;
    if (!scene) {
      const src = await uploadBg(lay), f = await folder("Scene");
      const { noteIcon, noteFont, ...data } = sc;
      scene = await cls("Scene").create({ ...data, name: pack.name, folder: f.id, levels: [{ name: pack.name, background: { src } }], flags: flag("scene", "scene", { bg: lay.bg }) });
      // привязка переходит на новую сцену; старая остаётся как есть и больше не обновляется
      if (plan.scene.bound) await plan.scene.bound.update({ flags: { [FLAG]: new foundry.data.operators.ForcedDeletion() } });
    } else if (plan.scene.bgChanged) await paintBg(scene, lay);
    bgDone = true;

    const { notes } = plan.scene;
    const have = new Map(scene.notes.filter((n) => n.flags?.[FLAG]?.key).map((n) => [n.flags[FLAG].key, n]));
    const entry = new Map(pack.entries.map((e) => [e.key, e]));
    const dataOf = (k) => {
      const e = entry.get(k), j = edoc.get(k);
      return j && { entryId: j.id, pageId: j.pages.find((p) => p.flags?.[FLAG]?.page === "body")?.id ?? null, x: e.x, y: e.y, text: noteLabel(e, plan.shown), iconSize: sc.noteIcon, fontSize: sc.noteFont };
    };
    const make = notes.create.map((k) => dataOf(k) && { ...dataOf(k), texture: { src: "icons/svg/book.svg" }, flags: flag("note", k) }).filter(Boolean);
    const upd = notes.update.filter((k) => have.has(k) && dataOf(k)).map((k) => ({ _id: have.get(k).id, ...dataOf(k) }));
    const del = notes.remove.filter((k) => have.has(k)).map((k) => have.get(k).id);
    if (make.length) await scene.createEmbeddedDocuments("Note", make);
    if (upd.length) await scene.updateEmbeddedDocuments("Note", upd);
    if (del.length) await scene.deleteEmbeddedDocuments("Note", del);
    log.push(F(plan.scene.existing ? "FAB.Log.sceneUpdated" : "FAB.Log.sceneCreated", { name: scene.name, c: make.length, u: upd.length, d: del.length }));
  }

  // зоны гекскраула: изменения строятся внутри очереди прибытия на свежем конфиге
  if (sel.zones && plan.zones.on) {
    if (!scene) skipped.zones = true;
    else try {
      const api = crawlApi();
      if (plan.zones.newStorage) {
        const r = await api.createStorage(scene);
        if (r?.status !== "ok") throw new Error(F("FAB.Zones.status", { status: r?.status }));
      }
      let sum;
      const ctx = crawlCtx(plan, (k) => edoc.get(k)?.uuid, (k) => tdoc.get(k)?.uuid, goneTables);
      await api.updateConfig((cfg) => {
        sum = applyBridge(cfg, ctx);
        if (sum.tooBig) throw new Error(F("FAB.Zones.tooBig", { mb: (sum.bytes / 1048576).toFixed(1) }));
        return cfg;
      }, { scene });
      if (sum.zonesDeferred.length) skipped.zones = true;
      log.push(F("FAB.Log.zones", { c: sum.zonesNew.length, u: sum.zonesCells.length + sum.zonesCleared.length, l: sum.linksSet, x: sum.linksCleared }));
    } catch (e) {
      console.error(FLAG, e);
      skipped.zones = true;
      log.push(F("FAB.Log.zonesFailed", { why: e.message }));
    }
  }

  // rev — только если применено всё, что изменилось; хэш фона — только если фон применён
  const complete = Object.keys(plan.cats).every((k) => !plan.cats[k] || (sel[k] && !skipped[k]));
  if (scene) {
    const f = {};
    if (bgDone) f.bg = lay.bg;
    if (complete) f.rev = plan.rev;
    if (Object.keys(f).length) await scene.update({ flags: { [FLAG]: f } });
    status.set(scene, complete ? "synced" : "update");
  }
  return { log, scene, complete };
}

/* ---------- разведка: Foundry → хаб ---------- */

export async function scoutCells(scene) {
  const f = scene?.flags?.[FLAG];
  if (f?.kind !== "scene") throw new Error(L("FAB.Err.notBound"));
  const api = crawlApi();
  if (!api?.exportJson) throw new Error(L("FAB.Zones.noModule"));
  const { doc } = await hub.map(f.mapId);
  const lay = layout(doc);
  if (!sameGeometry(geomOf(scene), targetGeom(lay))) throw new Error(L("FAB.Err.geometry"));
  const cfg = JSON.parse(await api.exportJson(scene));
  const cells = newCells(cfg.hexes, keysOf(doc, lay.g).index, doc, (key) => console.warn(FLAG, "hex outside the map", key));
  if (status.state(scene) === "error") checkHub(scene); // хаб ответил: красная кнопка не должна залипать
  return { scene, mapId: f.mapId, cells };
}

/** Отправляет разведку и перерисовывает фон; flags.rev не трогает (разведка rev не меняет). */
export const sendScout = (s) => queue(async () => {
  // геометрию сверяем до отправки: при расхождении не шлём клетки и не рисуем фон
  if (!sameGeometry(geomOf(s.scene), targetGeom(layout((await hub.map(s.mapId)).doc)))) throw new Error(L("FAB.Err.geometry"));
  await hub.pushExploration(s.mapId, s.cells);
  const { doc } = await hub.map(s.mapId);
  const lay = layout(doc);
  await paintBg(s.scene, lay);
  await s.scene.update({ flags: { [FLAG]: { bg: lay.bg } } });
});

/* ---------- проверка хаба при открытии сцены ---------- */

/** Обновляет состояние кнопки; возвращает {key, rev, from}, если в хабе есть обновление. */
export async function checkHub(scene) {
  const f = scene.flags[FLAG];
  try {
    const { doc, rev } = await hub.map(f.mapId);
    const bg = layout(doc).bg;
    const stale = rev !== f.rev || bg !== f.bg;
    status.set(scene, stale ? "update" : "synced");
    return stale ? { key: `${rev}:${bg}`, rev, from: f.rev } : null;
  } catch (e) {
    status.set(scene, "error", e.message);
    return null;
  }
}
