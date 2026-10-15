// node --test foundry/frontier-atlas-bridge/tests/
// Чистая логика без Foundry. Ключи клеток сверяются с настоящим HexagonalGrid Foundry, если исходники рядом
// (путь можно задать переменной FOUNDRY_APP), иначе этот тест пропускается.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as A from "../vendor/atlas.mjs";
import { hash, cellKeys, hexTargets, noteLabel, bgHash, entryHash, diffItems, diffNotes, newCells, applyBridge, crawlChanged, CRAWL_MAX_BYTES } from "../scripts/grid.mjs";
import { normalizeUrl } from "../scripts/hub.mjs";

const APP = process.env.FOUNDRY_APP ?? "E:/Foundry VTT v14/resources/app";
const gridFile = `${APP}/common/grid/hexagonal.mjs`;

// Foundry добавляет эти константы в Math при старте клиента
Math.SQRT3 ??= Math.sqrt(3);
Math.SQRT1_3 ??= 1 / Math.sqrt(3);

const mkDoc = (orientation, cols = 7, rows = 6) => ({
  version: 1, name: "t", orientation, cols, rows, hexSize: 30,
  terrain: Array.from({ length: cols * rows }, (_, i) => (i % 3 === 0 ? "forest" : i % 3 === 1 ? "hills" : "")),
  explored: new Array(cols * rows).fill(0), features: [], labels: [], paths: [],
  notes: [], gm: { tables: [], terrainTables: { forest: ["t1"] }, notes: {} }
});

for (const orientation of ["flat", "pointy"]) {
  test(`cellKeys: ${orientation} совпадает с HexagonalGrid Foundry и формулами брифа`, { skip: !existsSync(gridFile) }, async () => {
    const { default: HexagonalGrid } = await import(pathToFileURL(gridFile).href);
    const doc = mkDoc(orientation);
    const g = A.planFoundryGrid(doc, 1, (s) => s);
    const grid = new HexagonalGrid({ size: g.size, columns: g.type === 5, even: true });
    const { keys, index } = cellKeys(doc, g.scale, (p) => grid.getOffset(p));
    assert.equal(index.size, doc.cols * doc.rows);
    for (let row = 0; row < doc.rows; row++) {
      for (let col = 0; col < doc.cols; col++) {
        const want = orientation === "flat" ? `${row + (col & 1)},${col}` : `${row},${col + (row & 1)}`;
        assert.equal(keys[row * doc.cols + col], want);
      }
    }
  });
}

test("cellKeys: повтор ключа — ошибка", () => {
  assert.throws(() => cellKeys(mkDoc("flat", 2, 2), 1, () => ({ i: 0, j: 0 })), /unique/);
});

test("hash и entryHash стабильны, entryHash не зависит от порядка страниц", () => {
  assert.equal(hash("abc"), hash("abc"));
  assert.notEqual(hash("abc"), hash("abd"));
  const p1 = { kind: "body", name: "a", content: "x" }, p2 = { kind: "secret", name: "s", content: "y" };
  assert.equal(entryHash("n", [p1, p2]), entryHash("n", [p2, p1]));
  assert.notEqual(entryHash("n", [p1]), entryHash("n", [{ ...p1, content: "z" }]));
});

test("bgHash меняется от карты игроков, сетки и версии кода", () => {
  const g = { type: 5, size: 52 };
  const base = bgHash({ a: 1 }, g, "0.1.0");
  assert.notEqual(base, bgHash({ a: 2 }, g, "0.1.0"));
  assert.notEqual(base, bgHash({ a: 1 }, { ...g, size: 53 }, "0.1.0"));
  assert.notEqual(base, bgHash({ a: 1 }, g, "0.2.0"));
});

test("diffItems: create/update/same/remove и конфликты правок в Foundry", () => {
  const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  const h = (it) => `h-${it.key}${it.v ?? ""}`;
  items[1].v = "2"; items[3].v = "2";
  const docs = [
    { key: "b", h: "h-b", hd: "x", cur: "x" },   // хаб изменил, в Foundry не правили
    { key: "c", h: "h-c", hd: "x", cur: "y" },   // не менялось: правка в Foundry не конфликт
    { key: "d", h: "h-d", hd: "x", cur: "y" },   // хаб изменил и в Foundry правили
    { key: "gone", h: "h", hd: "x", cur: "y" },  // удалено в хабе, правили в Foundry
    { key: "gone2", h: "h" }                     // таблица: без hd
  ];
  const r = diffItems(items, docs, h);
  assert.deepEqual(r.create.map((i) => i.key), ["a"]);
  assert.deepEqual(r.update.map((i) => i.key), ["b", "d"]);
  assert.deepEqual(r.same.map((i) => i.key), ["c"]);
  assert.deepEqual(r.remove, ["gone", "gone2"]);
  assert.deepEqual([...r.conflicts].sort(), ["d", "gone"]);
});

test("diffNotes и noteLabel", () => {
  const e = (key, x, label) => ({ key, col: 13, row: 7, x, y: 0, label });
  const entries = [e("n1", 1, "14.08 Town"), e("n2", 2, "14.08 Hidden"), e("n3", 3, "14.08 X")];
  const shown = new Set(["n1"]);
  assert.equal(noteLabel(entries[0], shown), "14.08 Town");
  assert.equal(noteLabel(entries[1], shown), "14.08");
  const have = new Map([["n1", { x: 1, y: 0, text: "14.08 Town" }], ["n2", { x: 9, y: 0, text: "14.08" }], ["old", { x: 0, y: 0, text: "" }]]);
  const r = diffNotes(entries, have, (x) => noteLabel(x, shown), new Set());
  assert.deepEqual(r, { create: ["n3"], update: ["n2"], remove: ["old"] });
  assert.deepEqual(diffNotes(entries, new Map([["n1", { x: 1, y: 0, text: "14.08 Town" }]]), (x) => noteLabel(x, shown), new Set(["n1"])).update, ["n1"]);
});

test("hexTargets: первая заметка гекса", () => {
  const m = hexTargets([{ key: "a", col: 1, row: 2 }, { key: "b", col: 1, row: 2 }, { key: "c", col: 0, row: 0 }], 10);
  assert.equal(m.get(21), "a");
  assert.equal(m.get(0), "c");
  assert.equal(m.size, 2);
});

test("newCells: только неразведанные, unknown и клетки вне карты пропускаются", () => {
  const doc = mkDoc("flat", 3, 2);
  doc.explored[1] = 1;
  const index = new Map([["0,0", 0], ["0,1", 1], ["1,2", 5]]);
  const outside = [];
  const cells = newCells({
    "0,0": { state: "visited" }, "0,1": { state: "cleared" }, "1,2": { state: "discovered" },
    "9,9": { state: "visited" }, "0,2": { state: "unknown" }
  }, index, doc, (k) => outside.push(k));
  assert.deepEqual(cells, [{ col: 0, row: 0 }, { col: 2, row: 1 }]);
  assert.deepEqual(outside, ["9,9"]);
});

test("normalizeUrl", () => {
  assert.equal(normalizeUrl(" https://a.b/// "), "https://a.b");
  assert.equal(normalizeUrl("http://localhost:3001/"), "http://localhost:3001");
  assert.equal(normalizeUrl("ftp://x"), null);
  assert.equal(normalizeUrl("nonsense"), null);
});

/* ---------- applyBridge ---------- */

const binding = (uuid) => ({ id: "b1", label: "mine", uuid, trigger: "manual", chance: 0.5, once: true, rollMode: "publicroll" });
const emptyBind = () => ({ encounter: [], weather: [], discovery: [], loot: [], custom: [] });
const ctxFor = (doc, over = {}) => {
  const keys = doc.terrain.map((_, i) => `k${i}`);
  return {
    doc, keys, index: new Map(keys.map((k, i) => [k, i])),
    targets: new Map(), entryUuid: () => undefined, tableUuid: (k) => `RollTable.${k}`,
    isBridgeUuid: (u) => u.startsWith("JournalEntry.fa"), removedTables: new Set(), label: (t) => `L-${t}`, ...over
  };
};

test("applyBridge: новая зона получает привязки, существующая — только клетки", () => {
  const doc = mkDoc("flat", 3, 2); // forest: 0,3; hills: 1,4; пусто: 2,5
  const cfg = {
    zones: [
      { id: "fa-terrain-hills", label: "Мои холмы", priority: 7, cells: ["k1"], bindings: { ...emptyBind(), loot: [binding("RollTable.mine")] } },
      { id: "fa-terrain-desert", label: "d", priority: 0, cells: ["k2"], bindings: { ...emptyBind(), encounter: [binding("RollTable.keep")] } },
      { id: "custom-zone", label: "c", priority: 1, cells: ["k0"], bindings: emptyBind() }
    ],
    hexes: {}
  };
  const sum = applyBridge(cfg, ctxFor(doc));
  const by = Object.fromEntries(cfg.zones.map((z) => [z.id, z]));
  assert.deepEqual(by["fa-terrain-forest"].cells, ["k0", "k3"]);
  assert.equal(by["fa-terrain-forest"].label, "L-forest");
  assert.deepEqual(by["fa-terrain-forest"].bindings.encounter.map((b) => [b.uuid, b.trigger, b.chance, b.once, b.rollMode]), [["RollTable.t1", "arrival", 1, false, "gmroll"]]);
  assert.deepEqual(by["fa-terrain-hills"].cells, ["k1", "k4"]);
  assert.equal(by["fa-terrain-hills"].label, "Мои холмы");
  assert.equal(by["fa-terrain-hills"].priority, 7);
  assert.equal(by["fa-terrain-hills"].bindings.loot.length, 1);
  assert.deepEqual(by["fa-terrain-desert"].cells, []);               // исчезла из хаба: пустая, но не удалена
  assert.equal(by["fa-terrain-desert"].bindings.encounter.length, 1);
  assert.deepEqual(by["custom-zone"].cells, ["k0"]);                 // чужая зона нетронута
  assert.deepEqual([sum.zonesNew, sum.zonesCells, sum.zonesCleared], [["forest"], ["hills"], ["fa-terrain-desert"]]);
  assert.ok(crawlChanged(sum));
  // повторный прогон ничего не меняет
  assert.equal(crawlChanged(applyBridge(cfg, ctxFor(doc))), false);
});

test("applyBridge: удалённая таблица убирается из привязок зон местностей, но не чужих зон", () => {
  const doc = mkDoc("flat", 3, 2);
  const cfg = {
    zones: [
      { id: "fa-terrain-forest", label: "f", priority: 0, cells: ["k0", "k3"], bindings: { ...emptyBind(), encounter: [binding("RollTable.dead"), binding("RollTable.ok")] } },
      { id: "mine", label: "m", priority: 0, cells: [], bindings: { ...emptyBind(), encounter: [binding("RollTable.dead")] } }
    ],
    hexes: {}
  };
  const sum = applyBridge(cfg, ctxFor(doc, { removedTables: new Set(["RollTable.dead"]) }));
  assert.deepEqual(cfg.zones[0].bindings.encounter.map((b) => b.uuid), ["RollTable.ok"]);
  assert.equal(cfg.zones[1].bindings.encounter.length, 1);
  assert.equal(sum.bindingsDropped, 1);
});

test("applyBridge: ссылки гексов — пустые и свои ставим, чужие не трогаем, устаревшие свои снимаем", () => {
  const doc = mkDoc("flat", 3, 2);
  const hex = (journalUuid, extra = {}) => ({ journalUuid, notes: "n", state: "visited", visitCount: 3, inheritMode: {}, bindings: emptyBind(), ...extra });
  const cfg = {
    zones: [],
    hexes: { k0: hex(""), k1: hex("JournalEntry.faOld"), k2: hex("JournalEntry.userOwn"), k4: hex("JournalEntry.faStale") }
  };
  const targets = new Map([[0, "a"], [1, "b"], [2, "c"], [5, "d"]]);
  const uuids = { a: "JournalEntry.faA", b: "JournalEntry.faB", c: "JournalEntry.faC", d: "JournalEntry.faD" };
  const sum = applyBridge(cfg, ctxFor(doc, { targets, entryUuid: (k) => uuids[k] }));
  assert.equal(cfg.hexes.k0.journalUuid, "JournalEntry.faA");
  assert.equal(cfg.hexes.k0.visitCount, 3);                           // состояние мастера сохранено
  assert.equal(cfg.hexes.k0.state, "visited");
  assert.equal(cfg.hexes.k1.journalUuid, "JournalEntry.faB");
  assert.equal(cfg.hexes.k2.journalUuid, "JournalEntry.userOwn");     // чужая ссылка
  assert.deepEqual(sum.foreign, ["03.01"]);
  assert.equal(cfg.hexes.k5.journalUuid, "JournalEntry.faD");         // новый гекс получил пустую запись
  assert.equal(cfg.hexes.k5.state, "unknown");
  assert.equal(cfg.hexes.k4.journalUuid, "");                         // заметки больше нет
  assert.deepEqual([sum.linksSet, sum.linksCleared], [3, 1]);
});

test("applyBridge: превышение лимита размера конфига", () => {
  const doc = mkDoc("flat", 3, 2);
  const cfg = { zones: [], hexes: {} };
  assert.equal(applyBridge(cfg, ctxFor(doc)).tooBig, false);
  const big = { zones: [], hexes: { pad: { journalUuid: "", notes: "x".repeat(CRAWL_MAX_BYTES) } } };
  assert.equal(applyBridge(big, ctxFor(doc)).tooBig, true);
});
