// Чистая логика моста без Foundry: хэши, ключи клеток, дифф, изменения конфига гекскраула.
// Всё, что можно проверить через `node --test`, лежит здесь.
import { hexToPixel, hexRef } from "../vendor/atlas.mjs";

export const ID = "frontier-atlas-bridge";
export const GRHC = "great-route-hex-crawl";
export const ZONE_PREFIX = "fa-terrain-";
// Лимит импорта гекскраула (MAX_IMPORT_BYTES): конфиг в pretty-JSON не должен его превышать.
export const CRAWL_MAX_BYTES = 2 * 1024 * 1024;

export const hash = (s) => {
  let h = 5381;
  for (const c of s) h = ((h << 5) + h + c.codePointAt(0)) | 0;
  return (h >>> 0).toString(36);
};

/** Каждая клетка карты → ключ "i,j" гекскраула. getOffset — scene.grid.getOffset или его эквивалент. */
export function cellKeys(doc, scale, getOffset) {
  const keys = [], index = new Map();
  for (let row = 0; row < doc.rows; row++) {
    for (let col = 0; col < doc.cols; col++) {
      const c = hexToPixel(doc, col, row);
      const { i, j } = getOffset({ x: c.x * scale, y: c.y * scale });
      const key = `${i},${j}`, idx = row * doc.cols + col;
      keys[idx] = key;
      index.set(key, idx);
    }
  }
  if (index.size !== keys.length) throw new Error("cell keys are not unique");
  return { keys, index };
}

/** Гекс (индекс клетки) → ключ заметки, на которую он ссылается; при нескольких заметках в гексе — первая. */
export function hexTargets(entries, cols) {
  const m = new Map();
  for (const e of entries) {
    const idx = e.row * cols + e.col;
    if (!m.has(idx)) m.set(idx, e.key);
  }
  return m;
}

/** Метка Note: у закрытых заметок только номер гекса, у открытых игрокам — «номер название». */
export const noteLabel = (e, shown) => (shown.has(e.key) ? e.label : hexRef(e.col, e.row));

/** Хэш фона: карта игроков + сетка + версия кода отрисовки. */
export const bgHash = (players, g, salt) => hash(`${JSON.stringify(players)}|${g.type},${g.size}|${salt}`);

/** Хэш содержимого записи журнала по страницам моста (для обнаружения правок в Foundry). */
export const entryHash = (name, pages) => hash(JSON.stringify([name, pages.map((p) => [p.kind, p.name, p.content]).sort()]));

/**
 * items — данные хаба; docs — описания документов моста {key, h, hd?, cur?}.
 * conflicts — ключи записей, которые изменятся/удалятся, но были правлены в Foundry (hd ≠ cur).
 */
export function diffItems(items, docs, hashOf) {
  const left = new Map(docs.map((d) => [d.key, d]));
  const r = { create: [], update: [], same: [], remove: [], conflicts: new Set() };
  const edited = (d) => d.hd !== undefined && d.hd !== d.cur;
  for (const it of items) {
    const d = left.get(it.key);
    left.delete(it.key);
    if (!d) r.create.push(it);
    else if (d.h !== hashOf(it)) { r.update.push(it); if (edited(d)) r.conflicts.add(it.key); }
    else r.same.push(it);
  }
  for (const d of left.values()) { r.remove.push(d.key); if (edited(d)) r.conflicts.add(d.key); }
  return r;
}

/** have: Map key → {x, y, text} существующих Notes моста. */
export function diffNotes(entries, have, label, fresh) {
  const left = new Map(have);
  const r = { create: [], update: [], remove: [] };
  for (const e of entries) {
    const n = left.get(e.key);
    left.delete(e.key);
    if (!n) r.create.push(e.key);
    else if (n.x !== e.x || n.y !== e.y || n.text !== label(e) || fresh.has(e.key)) r.update.push(e.key);
  }
  r.remove = [...left.keys()];
  return r;
}

/** Разведанные в гекскраул клетки, которых ещё нет в хабе: [{col,row}]. Ключи вне карты пропускаются. */
export function newCells(hexes, index, doc, onOutside = () => {}) {
  const cells = [];
  for (const [key, hex] of Object.entries(hexes)) {
    if (hex.state === "unknown") continue;
    const idx = index.get(key);
    if (idx === undefined) { onOutside(key); continue; }
    if (!doc.explored[idx]) cells.push({ col: idx % doc.cols, row: Math.floor(idx / doc.cols) });
  }
  return cells;
}

/** Геометрия сцены совпадает с целевой? a, b: {width, height, gridType, gridSize}. */
export const sameGeometry = (a, b) => a.width === b.width && a.height === b.height && a.gridType === b.gridType && a.gridSize === b.gridSize;

const CATS = ["encounter", "weather", "discovery", "loot", "custom"];
const emptyBindings = () => Object.fromEntries(CATS.map((c) => [c, []]));
const emptyHex = () => ({ journalUuid: "", notes: "", state: "unknown", visitCount: 0, inheritMode: Object.fromEntries(CATS.map((c) => [c, "inherit"])), bindings: emptyBindings() });
const sameSet = (a, b) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

/**
 * Меняет cfg (конфиг гекскраула) на месте: зоны местностей и ссылки гексов на журнал; остальное не трогает.
 * ctx: {doc, keys, index, targets (hexTargets), entryUuid(key), tableUuid(key), isBridgeUuid(uuid), removedTables:Set, label(terrainId)}.
 * Возвращает сводку для предпросмотра.
 */
export function applyBridge(cfg, ctx) {
  const { doc, keys } = ctx;
  const sum = { zonesNew: [], zonesDeferred: [], zonesCells: [], zonesCleared: [], bindingsDropped: 0, linksSet: 0, linksCleared: 0, foreign: [], bytes: 0, tooBig: false };

  const cells = new Map();
  doc.terrain.forEach((tid, idx) => { if (tid) { if (!cells.has(tid)) cells.set(tid, []); cells.get(tid).push(keys[idx]); } });
  const mine = new Map(cfg.zones.filter((z) => z.id.startsWith(ZONE_PREFIX)).map((z) => [z.id, z]));
  for (const [tid, c] of cells) {
    const id = ZONE_PREFIX + tid, z = mine.get(id);
    mine.delete(id);
    if (!z) {
      // привязки — только при создании зоны; у существующей мастер мог их настроить
      const uuids = (doc.gm.terrainTables?.[tid] ?? []).map((k) => ctx.tableUuid(k));
      // нужных таблиц ещё нет: зону не создаём, иначе привязки не появятся никогда (создаются только вместе с зоной)
      if (uuids.some((u) => !u)) { sum.zonesDeferred.push(tid); continue; }
      const encounter = uuids.map((uuid) => ({ id: `fa${hash(id + uuid)}`, label: "", uuid, trigger: "arrival", chance: 1, once: false, rollMode: "gmroll" }));
      cfg.zones.push({ id, label: ctx.label(tid), priority: 0, cells: c, bindings: { ...emptyBindings(), encounter } });
      sum.zonesNew.push(tid);
    } else if (!sameSet(z.cells, c)) { z.cells = c; sum.zonesCells.push(tid); }
  }
  // исчезнувшая местность: зона остаётся пустой, чтобы не потерять привязки мастера
  for (const z of mine.values()) if (z.cells.length) { z.cells = []; sum.zonesCleared.push(z.id); }
  for (const z of cfg.zones) {
    if (!z.id.startsWith(ZONE_PREFIX)) continue;
    for (const cat of Object.keys(z.bindings)) {
      const keep = z.bindings[cat].filter((b) => !ctx.removedTables.has(b.uuid));
      sum.bindingsDropped += z.bindings[cat].length - keep.length;
      z.bindings[cat] = keep;
    }
  }

  const want = new Map();
  for (const [idx, entryKey] of ctx.targets) {
    const uuid = ctx.entryUuid(entryKey);
    if (uuid) want.set(keys[idx], uuid);
  }
  for (const [key, uuid] of want) {
    const cur = cfg.hexes[key]?.journalUuid ?? "";
    if (cur === uuid) continue;
    if (cur && !ctx.isBridgeUuid(cur)) { // ссылку мастера не трогаем
      const idx = ctx.index.get(key);
      sum.foreign.push(hexRef(idx % doc.cols, Math.floor(idx / doc.cols)));
      continue;
    }
    (cfg.hexes[key] ??= emptyHex()).journalUuid = uuid;
    sum.linksSet++;
  }
  for (const [key, h] of Object.entries(cfg.hexes)) {
    if (!want.has(key) && h.journalUuid && ctx.isBridgeUuid(h.journalUuid)) { h.journalUuid = ""; sum.linksCleared++; }
  }

  sum.bytes = new TextEncoder().encode(JSON.stringify(cfg, null, 2)).byteLength;
  sum.tooBig = sum.bytes > CRAWL_MAX_BYTES;
  return sum;
}

export const crawlChanged = (s) => s.zonesNew.length + s.zonesCells.length + s.zonesCleared.length + s.bindingsDropped + s.linksSet + s.linksCleared > 0;
