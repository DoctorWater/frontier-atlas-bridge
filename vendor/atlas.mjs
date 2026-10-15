const S3$2 = Math.sqrt(3);
function hexToPixel(g, col, row) {
  const s = g.hexSize;
  if (g.orientation === "flat") {
    return { x: s + 1.5 * s * col, y: S3$2 / 2 * s + S3$2 * s * (row + 0.5 * (col & 1)) };
  }
  return { x: S3$2 / 2 * s + S3$2 * s * (col + 0.5 * (row & 1)), y: s + 1.5 * s * row };
}
function fromAxial(g, q, r) {
  return g.orientation === "flat" ? { col: q, row: r + (q - (q & 1)) / 2 } : { col: q + (r - (r & 1)) / 2, row: r };
}
function pixelToHex(g, p) {
  const s = g.hexSize;
  const o = hexToPixel(g, 0, 0);
  const x = p.x - o.x, y = p.y - o.y;
  let qf, rf;
  if (g.orientation === "flat") {
    qf = 2 / 3 * x / s;
    rf = (-x / 3 + S3$2 / 3 * y) / s;
  } else {
    qf = (S3$2 / 3 * x - y / 3) / s;
    rf = 2 / 3 * y / s;
  }
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s2 = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s2 - sf);
  if (dq > dr && dq > ds) q = -r - s2;
  else if (dr > ds) r = -q - s2;
  q += 0;
  r += 0;
  return fromAxial(g, q, r);
}
function hexVertices(g, col, row) {
  const c = hexToPixel(g, col, row);
  const a0 = g.orientation === "flat" ? 0 : Math.PI / 6;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = a0 + Math.PI / 3 * i;
    out.push({ x: c.x + g.hexSize * Math.cos(a), y: c.y + g.hexSize * Math.sin(a) });
  }
  return out;
}
function inBounds(d, col, row) {
  return col >= 0 && row >= 0 && col < d.cols && row < d.rows;
}
function worldSize(g, cols, rows) {
  const s = g.hexSize;
  if (g.orientation === "flat") {
    return { width: 2 * s + 1.5 * s * (cols - 1), height: S3$2 * s * rows + (cols > 1 ? S3$2 / 2 * s : 0) };
  }
  return { width: S3$2 * s * cols + (rows > 1 ? S3$2 / 2 * s : 0), height: 2 * s + 1.5 * s * (rows - 1) };
}
function visibleRange(g, cols, rows, r) {
  const s = g.hexSize;
  const flat = g.orientation === "flat";
  const dx = flat ? 1.5 * s : S3$2 * s;
  const dy = flat ? S3$2 * s : 1.5 * s;
  return {
    c0: Math.max(0, Math.floor(r.minX / dx) - 1),
    c1: Math.min(cols - 1, Math.ceil(r.maxX / dx) + 1),
    r0: Math.max(0, Math.floor(r.minY / dy) - 1),
    r1: Math.min(rows - 1, Math.ceil(r.maxY / dy) + 1)
  };
}
const refLabel = (index) => String(index + 1).padStart(2, "0");
const hexRef = (col, row) => `${refLabel(col)}.${refLabel(row)}`;
function parseHexRef(s) {
  const m = /^(\d{1,4})\.(\d{1,4})$/.exec(s.trim());
  return m && +m[1] > 0 && +m[2] > 0 ? { col: +m[1] - 1, row: +m[2] - 1 } : null;
}
const T = (id2, color2) => ({ id: id2, nameKey: `terrain.${id2}`, color: color2 });
const terrains = [
  T("ocean", "#2b5a8a"),
  T("shallow", "#4a8ab5"),
  T("plains", "#c9d27a"),
  T("grassland", "#8fc063"),
  T("forest", "#4f8a47"),
  T("jungle", "#2f7a4a"),
  T("hills", "#b3a36a"),
  T("mountains", "#9a948c"),
  T("desert", "#e6cf8f"),
  T("swamp", "#6b8a6a"),
  T("tundra", "#c8d3cf"),
  T("ice", "#eaf4f8")
];
const terrainById = new Map(terrains.map((t2) => [t2.id, t2]));
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t2 = a;
    t2 = Math.imul(t2 ^ t2 >>> 15, t2 | 1);
    t2 ^= t2 + Math.imul(t2 ^ t2 >>> 7, t2 | 61);
    return ((t2 ^ t2 >>> 14) >>> 0) / 4294967296;
  };
}
function spot(x, y, s, rnd) {
  const a = rnd() * Math.PI * 2, r = 0.6 * s * Math.sqrt(rnd());
  return { x: x + r * Math.cos(a), y: y + r * Math.sin(a) };
}
const dots = (color2, n, r) => (ctx, x, y, s, rnd) => {
  ctx.fillStyle = color2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = spot(x, y, s, rnd);
    ctx.moveTo(p.x + r * s, p.y);
    ctx.arc(p.x, p.y, r * s, 0, Math.PI * 2);
  }
  ctx.fill();
};
const lines = (color2, n, dx, dy) => (ctx, x, y, s, rnd) => {
  ctx.strokeStyle = color2;
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = spot(x, y, s, rnd);
    ctx.moveTo(p.x - dx * s, p.y - dy * s);
    ctx.lineTo(p.x + dx * s, p.y + dy * s);
  }
  ctx.stroke();
};
const waves = (color2) => (ctx, x, y, s, rnd) => {
  ctx.strokeStyle = color2;
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const p = spot(x, y, s * 0.8, rnd), w = 0.12 * s, h = 0.07 * s;
    ctx.moveTo(p.x - 2 * w, p.y);
    ctx.quadraticCurveTo(p.x - w, p.y - h, p.x, p.y);
    ctx.quadraticCurveTo(p.x + w, p.y + h, p.x + 2 * w, p.y);
  }
  ctx.stroke();
};
const hills = (ctx, x, y, s, rnd) => {
  ctx.strokeStyle = "#6b5a2e";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const p = spot(x, y, s * 0.8, rnd), w = 0.2 * s;
    ctx.moveTo(p.x - w, p.y);
    ctx.quadraticCurveTo(p.x, p.y - w * 1.6, p.x + w, p.y);
  }
  ctx.stroke();
};
const mountains = (ctx, x, y, s, rnd) => {
  ctx.fillStyle = "#6f6a64";
  ctx.strokeStyle = "#3d3a37";
  ctx.lineWidth = Math.max(1, s * 0.04);
  for (let i = 0; i < 3; i++) {
    const p = spot(x, y, s * 0.6, rnd), w = 0.2 * s, h = 0.4 * s;
    ctx.beginPath();
    ctx.moveTo(p.x - w, p.y + h / 2);
    ctx.lineTo(p.x, p.y - h / 2);
    ctx.lineTo(p.x + w, p.y + h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
};
const patterns = new Map(Object.entries({
  ocean: waves("#7fb0d8"),
  shallow: waves("#d6ecf7"),
  plains: lines("#a3ae52", 4, 0.06, -0.06),
  grassland: lines("#5f9a3c", 6, 0, -0.1),
  forest: dots("#245a2c", 5, 0.13),
  jungle: dots("#0f4a2a", 8, 0.11),
  hills,
  mountains,
  desert: dots("#c4a05a", 7, 0.04),
  swamp: lines("#38573a", 5, 0.12, 0),
  tundra: dots("#9aa8a6", 5, 0.04),
  ice: lines("#ffffff", 3, 0.15, 0.1)
}));
const S3$1 = Math.sqrt(3);
const centerX = (flat, s, col, row) => flat ? s + 1.5 * s * col : S3$1 / 2 * s + S3$1 * s * (col + 0.5 * (row & 1));
const centerY = (flat, s, col, row) => flat ? S3$1 / 2 * s + S3$1 * s * (row + 0.5 * (col & 1)) : s + 1.5 * s * row;
const CHUNK$1 = 100;
const chunkFor$1 = (hexPx) => hexPx >= 32 ? 1 : CHUNK$1;
const lodOf = (doc, zoom, lod) => {
  const px = doc.hexSize * zoom;
  return !lod || px >= 14 ? "detailed" : px < 7 ? "tiny" : "plain";
};
const drawTerrain = (ctx, doc, f) => {
  const mode = lodOf(doc, f.view.zoom, f.lod);
  if (f.terrainCache && f.lod) drawCached(ctx, doc, f, mode, f.terrainCache);
  else paintHexes(ctx, doc, f.range, mode, 1 / f.view.zoom, CHUNK$1, f.hatch);
};
const HATCH_PX = 8;
const hatchSrc = /* @__PURE__ */ new Map();
function hatchPattern(ctx, color2, seam) {
  let src = hatchSrc.get(color2);
  if (!src) {
    src = Object.assign(document.createElement("canvas"), { width: HATCH_PX, height: HATCH_PX });
    const c = src.getContext("2d"), n = HATCH_PX;
    c.strokeStyle = color2;
    c.lineWidth = 1;
    c.beginPath();
    for (const d of [-n, 0, n]) {
      c.moveTo(d - 1, n + 1);
      c.lineTo(d + n + 1, -1);
    }
    c.stroke();
    hatchSrc.set(color2, src);
  }
  const p = ctx.createPattern(src, "repeat");
  p?.setTransform(new DOMMatrix().scale(seam));
  return p;
}
function paintHexes(ctx, doc, range, mode, seam, chunk = CHUNK$1, hatch = null) {
  const s = doc.hexSize;
  const a0 = doc.orientation === "flat" ? 0 : Math.PI / 6;
  const off = Array.from({ length: 6 }, (_, i) => [s * Math.cos(a0 + Math.PI / 3 * i), s * Math.sin(a0 + Math.PI / 3 * i)]);
  const detailed = mode === "detailed", tiny = mode === "tiny";
  const flat = doc.orientation === "flat";
  const cw = flat ? 1.5 * s : Math.sqrt(3) * s, ch = flat ? Math.sqrt(3) * s : 1.5 * s;
  const buckets = /* @__PURE__ */ new Map();
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      const id2 = doc.terrain[row * doc.cols + col];
      if (!id2) continue;
      let b = buckets.get(id2);
      if (!b) buckets.set(id2, b = []);
      b.push(col, row);
    }
  }
  for (const [id2, b] of buckets) {
    const t2 = terrainById.get(id2);
    if (!t2) continue;
    const draw = detailed ? patterns.get(id2) : void 0;
    const centers = [];
    ctx.fillStyle = ctx.strokeStyle = t2.color;
    ctx.lineWidth = seam;
    ctx.beginPath();
    for (let k = 0; k < b.length; k += 2) {
      if (k && k / 2 % chunk === 0) {
        ctx.fill();
        if (!tiny) ctx.stroke();
        ctx.beginPath();
      }
      const col = b[k], row = b[k + 1];
      const x = centerX(flat, s, col, row), y = centerY(flat, s, col, row);
      if (tiny) {
        ctx.rect(x - cw / 2, y - ch / 2, cw, ch);
        continue;
      }
      ctx.moveTo(x + off[0][0], y + off[0][1]);
      for (let i = 1; i < 6; i++) ctx.lineTo(x + off[i][0], y + off[i][1]);
      ctx.closePath();
      if (draw) centers.push(col, row, x, y);
    }
    ctx.fill();
    if (!tiny) ctx.stroke();
    for (let k = 0; k < centers.length; k += 4) {
      draw(ctx, centers[k + 2], centers[k + 3], s, mulberry32(Math.imul(centers[k] + 1, 73856093) ^ Math.imul(centers[k + 1] + 1, 19349663)));
    }
  }
  if (!hatch) return;
  ctx.fillStyle = hatchPattern(ctx, hatch, seam) ?? hatch;
  ctx.beginPath();
  let n = 0;
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      if (doc.explored[row * doc.cols + col]) continue;
      if (n++ && n % chunk === 0) {
        ctx.fill();
        ctx.beginPath();
      }
      const x = centerX(flat, s, col, row), y = centerY(flat, s, col, row);
      if (tiny) {
        ctx.rect(x - cw / 2, y - ch / 2, cw, ch);
        continue;
      }
      ctx.moveTo(x + off[0][0], y + off[0][1]);
      for (let i = 1; i < 6; i++) ctx.lineTo(x + off[i][0], y + off[i][1]);
      ctx.closePath();
    }
  }
  ctx.fill();
}
const TILE_PX = 512;
const MAX_HEX_PX = 128;
const MAX_PIXELS = 24e6;
const BUILD_HEXES = 256;
function drawCached(ctx, doc, f, mode, cache) {
  const s = doc.hexSize, flat = doc.orientation === "flat";
  const scale = ctx.getTransform().a;
  const level = 2 ** Math.ceil(Math.log2(scale));
  if (s * level > MAX_HEX_PX) return paintHexes(ctx, doc, f.range, mode, 1 / f.view.zoom, 1, f.hatch);
  const geom = `${doc.orientation}|${s}|${doc.cols}|${doc.rows}`;
  if (cache.geom !== geom) {
    cache.tiles.clear();
    cache.pixels = 0;
    cache.geom = geom;
  }
  const T2 = Math.max(4, Math.min(32, Math.floor(TILE_PX / (2 * s * level))));
  const M = 1.1 * s + 2 / level;
  const { c0, c1, r0, r1 } = f.range;
  let budget = BUILD_HEXES;
  cache.incomplete = false;
  for (let ty = Math.floor(r0 / T2); ty <= Math.floor(r1 / T2); ty++) {
    for (let tx = Math.floor(c0 / T2); tx <= Math.floor(c1 / T2); tx++) {
      const range = { c0: tx * T2, c1: Math.min(doc.cols - 1, tx * T2 + T2 - 1), r0: ty * T2, r1: Math.min(doc.rows - 1, ty * T2 + T2 - 1) };
      const ids = [];
      for (let row = range.r0; row <= range.r1; row++) {
        for (let col = range.c0; col <= range.c1; col++) {
          const i = row * doc.cols + col;
          ids.push(f.hatch && !doc.explored[i] ? doc.terrain[i] + "#" : doc.terrain[i]);
        }
      }
      const key = `${level}|${mode}|${f.hatch ?? ""}|${tx}|${ty}`;
      let tile = cache.tiles.get(key);
      if (tile && !sameIds(tile.ids, ids)) {
        cache.tiles.delete(key);
        cache.pixels -= tile.w * tile.h;
        tile = void 0;
      }
      if (!tile) {
        if (ids.every((id2) => !id2)) continue;
        if (budget <= 0) {
          cache.incomplete = true;
          paintHexes(ctx, doc, { c0: Math.max(c0, range.c0), c1: Math.min(c1, range.c1), r0: Math.max(r0, range.r0), r1: Math.min(r1, range.r1) }, "tiny", 1 / f.view.zoom);
          continue;
        }
        const x = centerX(flat, s, range.c0, 0) - M, y = centerY(flat, s, 0, range.r0) - M;
        const w = Math.ceil((centerX(flat, s, range.c1, 1) + M - x) * level), h = Math.ceil((centerY(flat, s, 1, range.r1) + M - y) * level);
        const canvas = cache.make(w, h);
        const tctx = canvas.getContext("2d");
        tctx.setTransform(level, 0, 0, level, -x * level, -y * level);
        paintHexes(tctx, doc, range, mode, 1 / f.view.zoom, chunkFor$1(s * level), f.hatch);
        budget -= ids.length;
        tile = { canvas, ids, x, y, w, h };
        cache.pixels += w * h;
        for (const [k, old] of cache.tiles) {
          if (cache.pixels <= MAX_PIXELS) break;
          cache.tiles.delete(k);
          cache.pixels -= old.w * old.h;
        }
      } else cache.tiles.delete(key);
      cache.tiles.set(key, tile);
      ctx.drawImage(tile.canvas, tile.x, tile.y, tile.w / level, tile.h / level);
    }
  }
}
function sameIds(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function polyline(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}
function smooth(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  const l = pts[pts.length - 1];
  ctx.lineTo(l.x, l.y);
  ctx.stroke();
}
const drawKind = (ctx, paths, kind) => {
  for (const p of paths) {
    if (p.kind !== kind || p.points.length < 2) continue;
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.width;
    if (kind === "river") {
      smooth(ctx, p.points);
      ctx.strokeStyle = "#bfe0ff";
      ctx.lineWidth = p.width * 0.4;
      smooth(ctx, p.points);
    } else if (kind === "road") {
      ctx.lineCap = "butt";
      ctx.setLineDash([p.width * 2, p.width * 1.5]);
      smooth(ctx, p.points);
    } else {
      ctx.lineWidth = p.width * 0.4;
      ctx.globalAlpha = 0.4;
      polyline(ctx, p.points);
      ctx.globalAlpha = 1;
      ctx.lineWidth = p.width;
      ctx.lineCap = "butt";
      ctx.setLineDash([p.width * 2.5, p.width * 1.5]);
      polyline(ctx, p.points);
    }
  }
};
const drawPaths = (ctx, doc, { range, players }) => {
  if (!doc.paths.length) return;
  if (players && !clipExplored(ctx, doc, range)) return;
  for (const k of ["river", "road", "border"]) drawKind(ctx, doc.paths, k);
};
function clipExplored(ctx, doc, range) {
  ctx.beginPath();
  let any = false;
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      if (!doc.explored[row * doc.cols + col]) continue;
      any = true;
      hexVertices(doc, col, row).forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
      ctx.closePath();
    }
  }
  if (any) ctx.clip("nonzero");
  return any;
}
const featureKinds = [
  "city",
  "town",
  "village",
  "castle",
  "tower",
  "ruins",
  "temple",
  "cave",
  "port",
  "mine",
  "camp",
  "landmark"
].map((id2) => ({ id: id2, nameKey: `feature.${id2}` }));
const FEATURE_HALF = 0.4;
const LIMITS = { title: 200, text: 2e4, tableName: 200, formula: 100, rowText: 2e3, rows: 1e3, tables: 500, notes: 2e4, ids: 500, rowNum: 1e6 };
const PATH_KINDS = ["river", "road", "border"];
const LABEL_COLOR = "#2b2118";
const PATH_DEFAULTS = {
  river: { width: 8, color: "#3b7dd8" },
  road: { width: 4, color: "#7a5230" },
  border: { width: 4, color: "#b03030" }
};
const emptyGm = () => ({ tables: [], terrainTables: {}, notes: {} });
function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
const MAX_CELLS = 4e6;
const isObj = (v) => !!v && typeof v === "object";
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\([-+\d.%\s,/]+\))$/i;
const color = (v, def) => typeof v === "string" && COLOR_RE.test(v) ? v : def;
const id = (v) => typeof v === "string" && v !== "__proto__" && v.length <= 64 ? v : newId();
const list = (v) => Array.isArray(v) ? v : [];
const withShown = (o, src) => src.shown === true ? { ...o, shown: true } : o;
function cleanFeature(f) {
  if (!isObj(f) || typeof f.kind !== "string" || !featureKinds.some((k) => k.id === f.kind)) return null;
  if (!fin(f.x) || !fin(f.y) || !fin(f.scale)) return null;
  return withShown({ id: id(f.id), kind: f.kind, x: f.x, y: f.y, scale: f.scale }, f);
}
function cleanLabel(l) {
  if (!isObj(l) || typeof l.text !== "string") return null;
  if (!fin(l.x) || !fin(l.y) || !fin(l.size) || !fin(l.angle)) return null;
  return withShown({ id: id(l.id), text: l.text, x: l.x, y: l.y, size: l.size, color: color(l.color, LABEL_COLOR), angle: l.angle }, l);
}
function cleanPath(p) {
  if (!isObj(p) || typeof p.kind !== "string" || !PATH_KINDS.includes(p.kind)) return null;
  if (!Array.isArray(p.points) || p.points.length < 2 || !fin(p.width)) return null;
  const points = [];
  for (const q of p.points) {
    if (!isObj(q) || !fin(q.x) || !fin(q.y)) return null;
    points.push({ x: q.x, y: q.y });
  }
  const kind = p.kind;
  return { id: id(p.id), kind, points, width: p.width, color: color(p.color, PATH_DEFAULTS[kind].color) };
}
const str = (v, max) => typeof v === "string" ? v.slice(0, max) : null;
const isRowInt = (v) => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= LIMITS.rowNum;
function cleanResult(r) {
  if (!isObj(r)) return null;
  const lo = isRowInt(r.lo) ? r.lo : isRowInt(r.hi) ? r.hi : 1, hi = isRowInt(r.hi) ? r.hi : lo;
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  const out = { id: id(r.id), lo: a, hi: b, text: str(r.text, LIMITS.rowText) ?? "" };
  if (typeof r.tableId === "string") out.tableId = r.tableId;
  return out;
}
function cleanTable(t2) {
  if (!isObj(t2)) return null;
  const name = str(t2.name, LIMITS.tableName), formula = str(t2.formula, LIMITS.formula);
  if (name === null || formula === null) return null;
  return { id: id(t2.id), name, formula, results: list(t2.results).slice(0, LIMITS.rows).map(cleanResult).filter((r) => r !== null) };
}
function cleanNote(n, doc) {
  if (!isObj(n) || !Number.isInteger(n.col) || !Number.isInteger(n.row)) return null;
  const col = n.col, row = n.row;
  if (col < 0 || row < 0 || col >= doc.cols || row >= doc.rows) return null;
  const title = str(n.title, LIMITS.title), body = str(n.body, LIMITS.text);
  if (title === null || body === null) return null;
  return withShown({ id: id(n.id), col, row, title, body }, n);
}
function cleanNotesAndGm(x, doc) {
  const gmIn = isObj(x.gm) ? x.gm : {};
  const seen = /* @__PURE__ */ new Set();
  const tables = [];
  for (const t2 of list(gmIn.tables ?? x.tables).slice(0, LIMITS.tables).map(cleanTable)) {
    if (!t2) continue;
    if (seen.has(t2.id)) t2.id = newId();
    seen.add(t2.id);
    tables.push(t2);
  }
  for (const t2 of tables) {
    const rseen = /* @__PURE__ */ new Set();
    for (const r of t2.results) {
      if (rseen.has(r.id)) r.id = newId();
      rseen.add(r.id);
      if (r.tableId !== void 0 && !seen.has(r.tableId)) delete r.tableId;
    }
  }
  const live = (v) => {
    const out = /* @__PURE__ */ new Set();
    for (const s of list(v)) {
      if (typeof s === "string" && seen.has(s)) out.add(s);
      if (out.size >= LIMITS.ids) break;
    }
    return [...out];
  };
  const notes = [];
  const nseen = /* @__PURE__ */ new Set();
  const gmNotes = {};
  const gmNotesIn = isObj(gmIn.notes) ? gmIn.notes : {};
  for (const raw of list(x.notes).slice(0, LIMITS.notes)) {
    const n = cleanNote(raw, doc);
    if (!n) continue;
    const oldId = n.id;
    const dup = nseen.has(n.id);
    if (dup) n.id = newId();
    nseen.add(n.id);
    notes.push(n);
    const g = !dup && Object.hasOwn(gmNotesIn, oldId) && isObj(gmNotesIn[oldId]) ? gmNotesIn[oldId] : isObj(raw) ? raw : {};
    const secret = str(g.secret, LIMITS.text) ?? "";
    const entry = { secret };
    if (Array.isArray(g.tables)) entry.tables = live(g.tables);
    if (secret || entry.tables) gmNotes[n.id] = entry;
  }
  const terrainTables = {};
  const ttIn = gmIn.terrainTables ?? x.terrainTables;
  if (isObj(ttIn) && !Array.isArray(ttIn)) {
    for (const k of Object.keys(ttIn)) {
      if (!terrainById.has(k)) continue;
      const ids = live(ttIn[k]);
      if (ids.length) terrainTables[k] = ids;
    }
  }
  return { notes, gm: { tables, terrainTables, notes: gmNotes } };
}
function validateDoc(x) {
  if (!isObj(x) || x.version !== 1) return null;
  if (x.orientation !== "flat" && x.orientation !== "pointy") return null;
  const { cols, rows, hexSize } = x;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  const c = cols, r = rows;
  if (c < 1 || r < 1 || c * r > MAX_CELLS) return null;
  if (!fin(hexSize) || !(hexSize > 0)) return null;
  if (!Array.isArray(x.terrain) || x.terrain.length !== c * r) return null;
  if (!x.terrain.every((s) => typeof s === "string")) return null;
  if (!Array.isArray(x.features) || !Array.isArray(x.labels) || !Array.isArray(x.paths)) return null;
  return {
    version: 1,
    name: typeof x.name === "string" ? x.name : "Untitled",
    orientation: x.orientation,
    cols: c,
    rows: r,
    hexSize,
    terrain: x.terrain.map((t2) => terrainById.has(t2) ? t2 : ""),
    // файлы до тумана войны: ничего не разведано
    explored: Array.isArray(x.explored) && x.explored.length === c * r ? x.explored.map((v) => v === 1 ? 1 : 0) : new Array(c * r).fill(0),
    features: list(x.features).map(cleanFeature).filter((f) => f !== null),
    labels: list(x.labels).map(cleanLabel).filter((l) => l !== null),
    paths: list(x.paths).map(cleanPath).filter((p) => p !== null),
    ...cleanNotesAndGm(x, { cols: c, rows: r })
  };
}
const LABEL_FONT = '"Source Sans 3", "Segoe UI", Arial, sans-serif';
const featureHalf = (doc, f) => doc.hexSize * FEATURE_HALF * f.scale;
const labelWidth = (l, measure) => l.text.length * l.size * 0.55;
function selectionFrame(ctx, f, px, x, y, w, h) {
  ctx.setLineDash([]);
  ctx.lineWidth = 5 * px;
  ctx.strokeStyle = f.selectionHalo;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([6 * px, 4 * px]);
  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = f.selectionColor;
  ctx.strokeRect(x, y, w, h);
}
const INK = "#2b2118", FILL = "#f1e6c8", ROOF = "#b5523b", DARK = "#3a2f26";
function poly(ctx, pts, fill = FILL) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}
const rect = (ctx, x, y, w, h, fill = FILL) => poly(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill);
const house = (ctx, x, y, w, h) => {
  rect(ctx, x, y, w, h);
  poly(ctx, [[x - w * 0.12, y], [x + w / 2, y - h * 0.7], [x + w * 1.12, y]], ROOF);
};
const crenels = (ctx, x, y, w, n) => {
  const cw = w / (2 * n - 1);
  for (let i = 0; i < n; i++) rect(ctx, x + i * 2 * cw, y - 0.22, cw, 0.22);
};
const icons = {
  city(ctx) {
    house(ctx, -0.95, 0, 0.6, 0.8);
    house(ctx, 0.35, 0, 0.6, 0.8);
    rect(ctx, -0.3, -0.5, 0.6, 1.3);
    crenels(ctx, -0.3, -0.5, 0.6, 2);
    rect(ctx, -0.12, 0.3, 0.24, 0.5, DARK);
  },
  town(ctx) {
    house(ctx, -0.95, 0, 0.85, 0.8);
    house(ctx, 0.05, -0.15, 0.9, 0.95);
  },
  village(ctx) {
    house(ctx, -0.55, -0.1, 1.1, 0.9);
    rect(ctx, -0.12, 0.35, 0.24, 0.45, DARK);
  },
  castle(ctx) {
    rect(ctx, -0.95, -0.2, 1.9, 1);
    crenels(ctx, -0.95, -0.2, 1.9, 5);
    rect(ctx, -0.95, -0.7, 0.55, 1.5);
    crenels(ctx, -0.95, -0.7, 0.55, 2);
    rect(ctx, 0.4, -0.7, 0.55, 1.5);
    crenels(ctx, 0.4, -0.7, 0.55, 2);
    ctx.beginPath();
    ctx.moveTo(-0.22, 0.8);
    ctx.lineTo(-0.22, 0.3);
    ctx.arc(0, 0.3, 0.22, Math.PI, 0);
    ctx.lineTo(0.22, 0.8);
    ctx.closePath();
    ctx.fillStyle = DARK;
    ctx.fill();
    ctx.stroke();
  },
  tower(ctx) {
    rect(ctx, -0.4, -0.5, 0.8, 1.4);
    crenels(ctx, -0.4, -0.5, 0.8, 3);
    rect(ctx, -0.1, -0.1, 0.2, 0.3, DARK);
    rect(ctx, -0.12, 0.5, 0.24, 0.4, DARK);
  },
  ruins(ctx) {
    poly(ctx, [[-0.95, 0.8], [-0.95, -0.2], [-0.6, -0.4], [-0.45, 0], [-0.3, 0.8]]);
    poly(ctx, [[-0.1, 0.8], [-0.1, 0.2], [0.2, 0], [0.3, 0.3], [0.45, 0.8]]);
    poly(ctx, [[0.55, 0.8], [0.55, -0.6], [0.95, -0.7], [0.95, 0.8]]);
  },
  temple(ctx) {
    poly(ctx, [[-0.95, -0.35], [0, -0.95], [0.95, -0.35]], ROOF);
    for (const x of [-0.75, -0.25, 0.25, 0.55]) rect(ctx, x, -0.3, 0.2, 0.85);
    rect(ctx, -0.95, 0.55, 1.9, 0.25);
  },
  cave(ctx) {
    ctx.beginPath();
    ctx.moveTo(-1, 0.8);
    ctx.quadraticCurveTo(-0.9, -0.9, 0, -0.9);
    ctx.quadraticCurveTo(0.9, -0.9, 1, 0.8);
    ctx.closePath();
    ctx.fillStyle = "#c9bfa5";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.4, 0.8);
    ctx.lineTo(-0.4, 0.2);
    ctx.arc(0, 0.2, 0.4, Math.PI, 0);
    ctx.lineTo(0.4, 0.8);
    ctx.closePath();
    ctx.fillStyle = DARK;
    ctx.fill();
    ctx.stroke();
  },
  port(ctx) {
    ctx.beginPath();
    ctx.arc(0, -0.65, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -0.45);
    ctx.lineTo(0, 0.8);
    ctx.moveTo(-0.4, -0.15);
    ctx.lineTo(0.4, -0.15);
    ctx.moveTo(-0.8, 0.2);
    ctx.quadraticCurveTo(-0.7, 0.85, 0, 0.8);
    ctx.quadraticCurveTo(0.7, 0.85, 0.8, 0.2);
    ctx.stroke();
  },
  mine(ctx) {
    const cross = () => {
      ctx.beginPath();
      ctx.moveTo(-0.8, 0.8);
      ctx.lineTo(0.7, -0.7);
      ctx.moveTo(0.8, 0.8);
      ctx.lineTo(-0.7, -0.7);
      ctx.stroke();
    };
    const w = ctx.lineWidth;
    ctx.lineWidth = w * 3;
    cross();
    ctx.strokeStyle = "#b08a55";
    ctx.lineWidth = w * 1.4;
    cross();
    ctx.strokeStyle = INK;
    ctx.lineWidth = w * 2;
    ctx.beginPath();
    ctx.moveTo(-0.95, -0.5);
    ctx.quadraticCurveTo(-0.3, -1, 0.1, -0.55);
    ctx.moveTo(0.95, -0.5);
    ctx.quadraticCurveTo(0.3, -1, -0.1, -0.55);
    ctx.stroke();
  },
  camp(ctx) {
    poly(ctx, [[-0.95, 0.8], [0, -0.8], [0.95, 0.8]], ROOF);
    poly(ctx, [[-0.25, 0.8], [0, 0.1], [0.25, 0.8]], DARK);
  },
  landmark(ctx) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + Math.PI / 5 * i, r = i % 2 ? 0.4 : 0.95;
      pts.push([r * Math.cos(a), r * Math.sin(a) + 0.05]);
    }
    poly(ctx, pts, "#e8c95a");
  }
};
function paintIcon(ctx, kind, lw) {
  const icon = Object.hasOwn(icons, kind) ? icons[kind] : void 0;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  if (icon) icon(ctx);
  else {
    ctx.beginPath();
    ctx.arc(0, 0, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.stroke();
  }
}
const drawFeatures = (ctx, doc, frame) => {
  const { selection, view } = frame;
  for (const f of doc.features) {
    const h = featureHalf(doc, f);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(h, h);
    paintIcon(ctx, f.kind, Math.max(0.09, 1.2 / (h * view.zoom)));
    if (selection?.type === "feature" && selection.id === f.id) {
      selectionFrame(ctx, frame, 1 / (h * view.zoom), -1.15, -1.15, 2.3, 2.3);
    }
    ctx.restore();
  }
};
const drawLabels = (ctx, doc, frame) => {
  const { selection, view } = frame;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const l of doc.labels) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.angle * Math.PI / 180);
    ctx.font = `600 ${l.size}px ${LABEL_FONT}`;
    ctx.lineWidth = Math.max(2, l.size * 0.22);
    ctx.strokeStyle = "rgba(247,248,245,0.92)";
    ctx.strokeText(l.text, 0, 0);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, 0, 0);
    if (selection?.type === "label" && selection.id === l.id) {
      const w = labelWidth(l) / 2 + 3, h = l.size * 0.6;
      selectionFrame(ctx, frame, 1 / view.zoom, -w, -h, w * 2, h * 2);
    }
    ctx.restore();
  }
};
const CHUNK = 100;
const chunkFor = (hexPx) => hexPx < 24 ? CHUNK : hexPx < 64 ? 3 : 1;
const drawGrid = (ctx, doc, { range, view, grid, lod, gridColor }) => {
  if (!grid || lod && doc.hexSize * view.zoom < 10) return;
  const s = doc.hexSize;
  const a0 = doc.orientation === "flat" ? 0 : Math.PI / 6;
  const chunk = lod ? chunkFor(s * (ctx.getTransform?.()?.a ?? view.zoom)) : CHUNK;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1 / view.zoom;
  ctx.beginPath();
  let n = 0;
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      if (++n % chunk === 0) {
        ctx.stroke();
        ctx.beginPath();
      }
      const c = hexToPixel(doc, col, row);
      for (let i = 0; i < 6; i++) {
        const a = a0 + Math.PI / 3 * i;
        const x = c.x + s * Math.cos(a), y = c.y + s * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }
  ctx.stroke();
};
const drawNumbers = (ctx, doc, { range, view, lod }) => {
  const s = doc.hexSize;
  if (!doc.notes.length || lod && s * view.zoom < 16) return;
  const size = s * 0.28;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.font = `600 ${size}px ${LABEL_FONT}`;
  ctx.lineWidth = size * 0.25;
  ctx.strokeStyle = "rgba(247,248,245,0.92)";
  ctx.fillStyle = LABEL_COLOR;
  for (const n of doc.notes) {
    if (n.col < range.c0 || n.col > range.c1 || n.row < range.r0 || n.row > range.r1) continue;
    const c = hexToPixel(doc, n.col, n.row);
    const y = c.y - s * (doc.orientation === "flat" ? 0.6 : 0.58);
    const text = hexRef(n.col, n.row);
    ctx.strokeText(text, c.x, y);
    ctx.fillText(text, c.x, y);
  }
};
const layers = [["terrain", drawTerrain], ["paths", drawPaths], ["features", drawFeatures], ["labels", drawLabels], ["grid", drawGrid], ["numbers", drawNumbers]];
function renderMap(ctx, doc, view, opts = {}) {
  const width = opts.width ?? ctx.canvas.width;
  const height = opts.height ?? ctx.canvas.height;
  const rect2 = {
    minX: -view.x / view.zoom,
    minY: -view.y / view.zoom,
    maxX: (width - view.x) / view.zoom,
    maxY: (height - view.y) / view.zoom
  };
  const frame = {
    view,
    rect: rect2,
    grid: (opts.grid ?? true) && opts.layers?.grid !== false,
    lod: opts.lod ?? true,
    selection: opts.selection ?? null,
    selectionColor: opts.selectionColor ?? "#1D2321",
    selectionHalo: opts.selectionHalo ?? "#F7F8F5",
    gridColor: opts.gridColor ?? "rgba(0,0,0,0.3)",
    terrainCache: opts.terrainCache ?? null,
    hatch: opts.fog === "gm" && opts.layers?.fog !== false ? opts.fogColor ?? "rgba(29,35,33,0.45)" : null,
    players: opts.fog === "players",
    range: visibleRange(doc, doc.cols, doc.rows, rect2)
  };
  ctx.save();
  ctx.fillStyle = opts.background ?? "#26282c";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);
  for (const [id2, layer] of layers) {
    if (opts.layers?.[id2] === false) continue;
    ctx.save();
    layer(ctx, doc, frame);
    ctx.restore();
  }
  ctx.restore();
}
const MAX_SIDE = 16384;
const MAX_AREA = 268e6;
const EXPORT_BACKGROUNDS = { dark: "#26282c", paper: "#F7F8F5", none: "transparent" };
function fitScale(width, height, scale) {
  const k = Math.min(
    1,
    MAX_SIDE / (width * scale),
    MAX_SIDE / (height * scale),
    Math.sqrt(MAX_AREA / (width * scale * height * scale))
  );
  return k < 1 ? scale * k * 0.999 : scale;
}
async function renderPng(doc, opts) {
  if (typeof document !== "undefined" && document.fonts) {
    await document.fonts.load('600 16px "Source Sans 3"').catch(() => []);
    await document.fonts.ready;
  }
  const { width: ww, height: wh } = worldSize(doc, doc.cols, doc.rows);
  const scale = fitScale(ww, wh, opts.scale);
  const width = Math.ceil(ww * scale), height = Math.ceil(wh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable (size too large?)");
  renderMap(ctx, doc, { x: 0, y: 0, zoom: scale }, { grid: opts.grid ?? true, layers: opts.layers, width, height, lod: false, fog: opts.fog, background: EXPORT_BACKGROUNDS[opts.background ?? "dark"] });
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("PNG encoding failed");
  return { blob, width, height, scale, reduced: scale < opts.scale };
}
const noteSecret = (doc, id2) => doc.gm.notes[id2]?.secret ?? "";
const DICE_LIMITS = { maxCount: 100, maxSides: 1e3, maxLength: 100, maxTerms: 20, maxConst: 1e5 };
const MINUS = /[−–—]/g;
const TERM = /^(?:(\d{1,4})?[dDдДкК](\d{1,5})|(\d{1,9}))$/;
function parseFormula(src) {
  if (typeof src !== "string") return { ok: false, error: "dice.err.empty" };
  if (src.length > DICE_LIMITS.maxLength) return { ok: false, error: "dice.err.long" };
  const s = src.replace(MINUS, "-").replace(/\s+/g, "");
  if (!s) return { ok: false, error: "dice.err.empty" };
  const terms = [];
  const re = /([+-]?)([^+-]+)/y;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m || m[1] === "" && pos > 0) return { ok: false, error: "dice.err.syntax" };
    pos = re.lastIndex;
    const t2 = TERM.exec(m[2]);
    if (!t2) return { ok: false, error: "dice.err.syntax" };
    const sign = m[1] === "-" ? -1 : 1;
    if (t2[2] !== void 0) {
      const n = t2[1] === void 0 ? 1 : +t2[1], mm = +t2[2];
      if (n < 1 || mm < 1 || n > DICE_LIMITS.maxCount || mm > DICE_LIMITS.maxSides) return { ok: false, error: "dice.err.limit" };
      terms.push({ kind: "dice", sign, n, m: mm });
    } else {
      if (+t2[3] > DICE_LIMITS.maxConst) return { ok: false, error: "dice.err.limit" };
      terms.push({ kind: "const", sign, value: +t2[3] });
    }
    if (terms.length > DICE_LIMITS.maxTerms) return { ok: false, error: "dice.err.limit" };
  }
  return { ok: true, formula: { terms } };
}
const termText = (t2) => t2.kind === "dice" ? t2.n === 1 ? `d${t2.m}` : `${t2.n}d${t2.m}` : String(t2.value);
const formatFormula = (f) => f.terms.map((t2, i) => (t2.sign < 0 ? "-" : i ? "+" : "") + termText(t2)).join("");
const en = {
  "terrain.ocean": "Ocean",
  "terrain.shallow": "Shallow water",
  "terrain.plains": "Plains",
  "terrain.grassland": "Grassland",
  "terrain.forest": "Forest",
  "terrain.jungle": "Jungle",
  "terrain.hills": "Hills",
  "terrain.mountains": "Mountains",
  "terrain.desert": "Desert",
  "terrain.swamp": "Swamp",
  "terrain.tundra": "Tundra",
  "terrain.ice": "Ice",
  "tool.brush": "Brush",
  "tool.fill": "Fill",
  "tool.eraser": "Eraser",
  "tool.picker": "Picker",
  "tool.feature": "Feature",
  "tool.label": "Label",
  "label.default": "Label",
  "feature.city": "City",
  "feature.town": "Town",
  "feature.village": "Village",
  "feature.castle": "Castle",
  "feature.tower": "Tower",
  "feature.ruins": "Ruins",
  "feature.temple": "Temple",
  "feature.cave": "Cave",
  "feature.port": "Port",
  "feature.mine": "Mine",
  "feature.camp": "Camp",
  "feature.landmark": "Landmark",
  "tool.river": "River",
  "tool.road": "Road",
  "tool.border": "Border",
  "path.river": "River",
  "path.road": "Road",
  "path.border": "Border",
  "app.title": "Frontier Atlas: hex map editor",
  "hub.login": "Login required.",
  "hub.loginLink": "Log in with Discord",
  "hub.logout": "Log out",
  "hub.home": "All campaigns",
  "hub.accept": "Accept invite",
  "hub.notFound": "Not found or no access",
  "hub.error": "Failed to load. Reload the page.",
  "sheet.name": "Map name",
  "sheet.back": "← Campaign",
  "act.export": "Export",
  "act.undo": "Undo",
  "act.redo": "Redo",
  "act.delete": "Delete",
  "export.scale": "Scale",
  "export.grid": "Grid in file",
  "export.bg": "Background",
  "export.bg.dark": "Dark",
  "export.bg.paper": "Paper",
  "export.bg.none": "Transparent",
  "export.png": "PNG",
  "export.svg": "SVG",
  "export.foundry": "Foundry (macro)",
  "export.json": "JSON (map backup)",
  "export.note": "Hidden layers are left out of the file. Foundry draws its own grid.",
  "lang.label": "Language",
  "theme.toLight": "Light theme",
  "theme.toDark": "Dark theme",
  "zoom.out": "Zoom out",
  "zoom.in": "Zoom in",
  "zoom.fit": "Fit map",
  "zoom.reset": "Zoom 100%",
  "orient.flat": "flat hexes",
  "orient.pointy": "pointy hexes",
  "tools.label": "Tools",
  "canvas.label": "Map",
  "legend.title": "Terrains",
  "terrain.none": "Empty",
  "ctx.radius": "Radius",
  "ctx.kind": "Feature kind",
  "ctx.text": "Label text",
  "ctx.color": "Colour",
  "ctx.width": "Width",
  "hint.brush": "Radius 0 paints a single hex. Space and drag pan the map.",
  "hint.eraser": "Clears terrain. Radius works like the brush.",
  "hint.fill": "Click fills the connected area with the chosen terrain.",
  "hint.picker": "Click a hex to load its terrain into the legend.",
  "hint.feature": "Click places the icon at the hex centre, Shift at the click point. Alt-click deletes.",
  "hint.label": "Click places a label. Drag moves it, Alt-click deletes.",
  "hint.path": "Drag across hexes. Alt-click on a line deletes it.",
  "hint.border": "Drag along hex edges. Alt-click on a line deletes it.",
  "layers.title": "Layers",
  "layer.grid": "Grid",
  "layer.terrain": "Terrain",
  "layer.paths": "Lines",
  "layer.features": "Icons",
  "layer.labels": "Labels",
  "layer.on": "shown",
  "layer.off": "hidden",
  "insp.label": "Label",
  "insp.feature": "Icon",
  "insp.text": "Text",
  "insp.size": "Size",
  "insp.angle": "Angle",
  "insp.kind": "Kind",
  "insp.scale": "Scale",
  "minimap.title": "Sheet index",
  "minimap.aria": "Minimap: click or arrow keys move the view",
  "status.hex": "Hex",
  "status.terrain": "Terrain",
  "status.zoom": "Zoom",
  "legend.toggle": "Legend",
  "stamp.dirty": "Unsaved",
  "stamp.saved": "Saved",
  "stamp.json": "JSON downloaded",
  "stamp.autosave": "Saved to server",
  "stamp.png": "Exported PNG",
  "stamp.svg": "Exported SVG",
  "stamp.foundry": "Exported Foundry",
  "stamp.reduced": "scale reduced to ×{0}",
  "error.auth": "Session expired: edits are not being saved. Log in again and saving will resume by itself.",
  "error.relogin": "Log in again",
  "error.conflict": "The map was changed in another tab or on another device. Your unsaved edits will be lost: click here to reload the map.",
  "error.saveFailed": "The server rejected the save (code {0}). Your edits exist only in this tab: download a copy via Export → JSON.",
  "error.export": "Export failed ({0}). Lower the scale in the Export menu and try again.",
  "error.foundry": "Foundry export failed ({0}). Lower the scale or the map size and try again.",
  "val.range": "Whole number from {0} to {1}",
  "dlg.title": "New map",
  "dlg.name": "Name",
  "dlg.orientation": "Hex orientation",
  "dlg.cols": "Columns",
  "dlg.rows": "Rows",
  "dlg.hexSize": "Hex size, px",
  "dlg.warn": "The current map is replaced and undo history is cleared. Save it to a file first if you need it.",
  "dlg.cancel": "Cancel",
  "dlg.create": "Create",
  "dlg.defaultName": "New map",
  "layer.numbers": "Hex numbers",
  "dice.err.empty": "Enter a formula, for example d6 or 2d6+1",
  "dice.err.syntax": "Cannot read the formula. Use dice and numbers joined by + or −, for example 1d8+1d4",
  "dice.err.limit": "Too large: up to 100 dice, up to 1000 sides, up to 20 terms",
  "dice.err.long": "Formula is too long (100 characters at most)",
  "tbl.w.formula": "Formula problem: {0}",
  "tbl.w.inverted": "Reversed ranges: {0}",
  "tbl.w.cycle": "This table links back to itself through other tables",
  "tbl.w.overlap": "Ranges {0} and {1} overlap",
  "tbl.w.gap": "No row for: {0}",
  "tbl.w.outside": "Rows outside the formula range: {0}",
  "tbl.w.missing": "Row {0} links to a table that no longer exists",
  "tbl.stop.cycle": "Stopped: the tables link to each other in a loop",
  "tbl.stop.depth": "Stopped: nested rolls go more than 5 deep",
  "tbl.stop.missing": "Stopped: the linked table does not exist",
  "tbl.stop.noRow": "Nothing matches this roll: no row covers it",
  "tbl.stop.formula": "Stopped: the formula of this table is invalid",
  "imp.err.empty": 'No table rows found. Use lines like "1-3 Wolves".',
  "imp.err.format": "Cannot import: not a table text and not a Foundry RollTable JSON",
  "imp.w.line": "Line {0} skipped: {1}",
  "imp.w.row": "Row skipped, bad range: {0}",
  "imp.w.formula": 'Formula "{0}" not understood, replaced by a die that fits the rows',
  "imp.w.doc": 'Row "{0}" links to a document that is not in this project; kept as text',
  "pack.secret": "GM secret",
  "pack.done": "Frontier Atlas: imported {0} (tables {1}, entries {2})",
  "tool.note": "Note",
  "hint.note": "Click a hex to open its note. A note appears once you start writing.",
  "tabs.label": "Panel sections",
  "tabs.legend": "Legend",
  "tabs.notes": "Notes",
  "tabs.tables": "Tables",
  "notes.search": "Search notes",
  "notes.searchPh": "Number, title, text",
  "notes.empty": "No notes yet. Pick the Note tool (key N) and click a hex.",
  "notes.noMatch": "Nothing found. Search covers the hex number, title, text and secret.",
  "notes.untitled": "Untitled",
  "notes.pickTool": "Note tool",
  "notes.more": "First {0} shown, narrow the search",
  "drawer.close": "Close panel",
  "note.title": "Title",
  "note.body": "Text",
  "note.edit": "Text",
  "note.preview": "Preview",
  "note.emptyPreview": "No text yet. Link to another hex like this: [[14.08]]",
  "note.secret": "GM secret",
  "note.secretHint": "Hidden from players: in Foundry it goes on a closed page. This is not file protection.",
  "note.tables": "Tables",
  "note.byTerrain": "By terrain",
  "note.custom": "Custom",
  "note.none": "No tables",
  "note.byTerrainInfo": "By terrain ({0})",
  "note.noTablesTerrain": "No tables for this terrain. Assign them in the table editor.",
  "note.noTablesAny": "No tables yet. Create them on the Tables tab.",
  "note.pickTables": "Tick the tables for this note",
  "note.roll": "Roll",
  "note.log": "Recent rolls",
  "note.delete": "Delete note",
  "note.readonly": "Phone: notes are read-only. You can still roll tables.",
  "roll.result": "Result",
  "roll.row": "row {0}",
  "tbl.new": "New",
  "tbl.import": "Import",
  "tbl.dup": "Duplicate",
  "tbl.del": "Delete",
  "tbl.empty": "No tables yet. Press New or paste a ready one with Import.",
  "tbl.newName": "New table",
  "tbl.importedName": "Imported",
  "tbl.name": "Name",
  "tbl.formula": "Dice formula",
  "tbl.rows": "Rows",
  "tbl.from": "From",
  "tbl.to": "To",
  "tbl.text": "Result",
  "tbl.next": "Nested table",
  "tbl.noNext": "— none",
  "tbl.addRow": "Add row",
  "tbl.delRow": "Delete row",
  "tbl.terrains": "Terrains",
  "tbl.test": "Test roll",
  "tbl.badNum": "Whole number, at most 1,000,000 in absolute value",
  "tbl.noRows": "No rows yet",
  "tbl.warnCount": "Warnings: {0}",
  "tbl.warnings": "Warnings",
  "tbl.noTerrain": "not assigned",
  "tbl.notesCount": "notes: {0}",
  "tbl.confirm": 'Table "{0}" is referenced: {1}. Deleting it removes those links. Delete?',
  "tbl.confirmPlain": 'Delete table "{0}"?',
  "tbl.refTerrains": "terrains {0}",
  "tbl.refNotes": "notes {0}",
  "tbl.refRows": "rows of other tables {0}",
  "tbl.table": "Table",
  "imp.title": "Import tables",
  "imp.paste": 'Paste table text ("1-3 Wolves", "96-00 Dragon") or a Foundry RollTable JSON',
  "imp.file": "Choose JSON file",
  "imp.run": "Import",
  "imp.done": "Tables imported: {0}",
  "imp.warnings": "Warnings",
  "imp.close": "Done",
  "imp.fileErr": "Could not read the file. Choose a text file or .json.",
  "confirm.title": "Confirm",
  "tool.explore": "Explore",
  "hint.explore": "Stroke over unexplored hexes to reveal them to players; over explored ones to hide them again. Unexplored hexes are hatched.",
  "layer.fog": "Fog",
  "view.label": "Map view",
  "view.gm": "GM",
  "view.players": "Players",
  "status.players": "Players’ view",
  "insp.shown": "Visible to players",
  "note.shown": "Visible to players: title and text",
  "export.players": "Players’ map",
  "export.playersSuffix": "players",
  "hub.ok": "OK",
  "hub.retry": "Retry",
  "hub.loading": "Loading…",
  "hub.tagline": "Campaign hub: maps, members and the Foundry bridge in one place.",
  "hub.crumb": "Campaigns",
  "hub.campaigns": "Campaigns",
  "hub.newCampaign": "New campaign",
  "hub.campaignName": "Campaign name",
  "hub.emptyTitle": "No campaigns yet",
  "hub.emptyText": "A campaign is a series of map sheets, its members and a bridge to Foundry. Create your own or open an invite the GM sent you.",
  "role.gm": "GM",
  "role.player": "Player",
  "n.sheets.one": "{0} sheet",
  "n.sheets.other": "{0} sheets",
  "n.members.one": "{0} member",
  "n.members.other": "{0} members",
  "n.days.one": "{0} day",
  "n.days.other": "{0} days",
  "hub.series": "Sheet series",
  "hub.newSheet": "New sheet",
  "hub.importJson": "Import JSON",
  "hub.sheet": "Sheet",
  "hub.shared": "Open to players",
  "hub.draft": "Draft",
  "hub.share": "Open to players",
  "hub.unshare": "Hide from players",
  "hub.rename": "Rename",
  "hub.delete": "Delete",
  "hub.editedAt": "edited {0}",
  "hub.noPreview": "No preview",
  "hub.noSheets": "No sheets",
  "hub.emptyGm": "This campaign has no sheets yet. Create the first one or import a map from JSON.",
  "hub.emptyPlayer": "The GM has not opened any maps yet.",
  "hub.sayShared": "Map opened to players",
  "hub.sayHidden": "Map hidden from players",
  "hub.sayCreated": "Sheet created",
  "hub.sayImported": "Sheet imported",
  "hub.sayRenamed": "Renamed",
  "hub.sayDeleted": "Deleted",
  "hub.sayCopied": "Copied",
  "hub.sayCopySelect": "Selected: press Ctrl+C",
  "hub.sayRevoked": "Links revoked",
  "hub.sayTokenRevoked": "Token revoked",
  "hub.sayRole": "Role changed",
  "hub.sayRemoved": "Member removed",
  "hub.renameSheet": "Sheet name",
  "hub.renameCampaign": "Campaign name",
  "hub.confirmDeleteSheet": "Delete sheet “{0}” with its notes and tables? This cannot be undone.",
  "hub.confirmDeleteCampaign": "Delete campaign “{0}” with all its sheets, members and tokens? This cannot be undone.",
  "hub.confirmRevokeInvites": "Revoke all invite links? Invites already accepted stay valid.",
  "hub.confirmRemoveMember": "Remove “{0}” from the campaign?",
  "hub.confirmLeave": "Leave campaign “{0}”? You can only return with a new invite.",
  "hub.confirmRevokeToken": "Revoke token “{0}”? The Foundry bridge using it will stop working.",
  "hub.revoke": "Revoke",
  "hub.leave": "Leave",
  "hub.remove": "Remove",
  "hub.importBad": "This file does not look like a Frontier Atlas map. Use a JSON saved with “Export → JSON”.",
  "hub.importRead": "Could not read the file.",
  "hub.members": "Members",
  "hub.you": "you",
  "hub.leaveCampaign": "Leave campaign",
  "hub.removeMember": "Remove from campaign",
  "hub.memberRole": "Role of {0}",
  "hub.invites": "Invites",
  "hub.invPlayer": "Link for player",
  "hub.invGm": "Link for GM",
  "hub.invExpiry": "Expires in",
  "hub.invOnce": "Shown once — copy it now.",
  "hub.invGmWarn": "A GM link is single-use: whoever opens it first becomes a GM.",
  "hub.revokeAll": "Revoke all links",
  "hub.copy": "Copy",
  "hub.invUrl": "Invite link",
  "hub.foundry": "Foundry",
  "hub.tokenLabel": "Token name",
  "hub.tokenCreate": "Create token",
  "hub.tokenValue": "Token",
  "hub.tokenOnce": "Shown once — copy it now. Paste it into the bridge module settings in Foundry (the GM’s client setting).",
  "hub.tokenCreated": "created {0}",
  "hub.tokenUsed": "used {0}",
  "hub.tokenNever": "never used",
  "hub.tokensNone": "No tokens yet",
  "hub.tokenRevoke": "Revoke token",
  "hub.campaign": "Campaign",
  "hub.deleteCampaign": "Delete campaign",
  "hub.renameCampaignBtn": "Rename campaign",
  "hub.statusCampaign": "Campaign",
  "hub.statusRole": "Role",
  "hub.inviteTitle": "Invitation to the campaign “{0}”",
  "hub.inviteRole": "Role",
  "hub.inviteUntil": "valid until {0}",
  "hub.inviteLogin": "Log in with Discord to accept the invitation.",
  "hub.inviteBadTitle": "Invitation is not valid",
  "hub.inviteBad": "This invitation is not valid: it expired, was revoked or was already used. Ask the GM for a new link.",
  "hub.notFoundHint": "The link may be outdated or you may not have access to this campaign. Go back to the campaign list.",
  "err.network": "No connection to the server. Check your network and retry.",
  "err.session": "Your session expired. Reload the page and log in again.",
  "err.forbidden": "Only the campaign GM can do this.",
  "err.gone": "It is gone: it may have been deleted. Reload the page.",
  "err.lastGm": "You cannot remove the last GM. Make another member a GM first.",
  "err.conflict": "The data changed. Reload the page and retry.",
  "err.tooLarge": "The map is too large for the server. Reduce its size and retry.",
  "err.badDoc": "The server rejected the map: the file is damaged or of a different version.",
  "err.generic": "Something went wrong ({0}). Reload the page and retry."
};
const ru = {
  "terrain.ocean": "Океан",
  "terrain.shallow": "Мелководье",
  "terrain.plains": "Равнины",
  "terrain.grassland": "Луга",
  "terrain.forest": "Лес",
  "terrain.jungle": "Джунгли",
  "terrain.hills": "Холмы",
  "terrain.mountains": "Горы",
  "terrain.desert": "Пустыня",
  "terrain.swamp": "Болото",
  "terrain.tundra": "Тундра",
  "terrain.ice": "Лёд",
  "tool.brush": "Кисть",
  "tool.fill": "Заливка",
  "tool.eraser": "Ластик",
  "tool.picker": "Пипетка",
  "tool.feature": "Значок",
  "tool.label": "Подпись",
  "label.default": "Подпись",
  "feature.city": "Город",
  "feature.town": "Городок",
  "feature.village": "Деревня",
  "feature.castle": "Замок",
  "feature.tower": "Башня",
  "feature.ruins": "Руины",
  "feature.temple": "Храм",
  "feature.cave": "Пещера",
  "feature.port": "Порт",
  "feature.mine": "Шахта",
  "feature.camp": "Лагерь",
  "feature.landmark": "Достопримечательность",
  "tool.river": "Река",
  "tool.road": "Дорога",
  "tool.border": "Граница",
  "path.river": "Река",
  "path.road": "Дорога",
  "path.border": "Граница",
  "app.title": "Frontier Atlas — редактор гексовых карт",
  "hub.login": "Нужен вход.",
  "hub.loginLink": "Войти через Discord",
  "hub.logout": "Выйти",
  "hub.home": "Все кампании",
  "hub.accept": "Принять приглашение",
  "hub.notFound": "Не найдено или нет доступа",
  "hub.error": "Не удалось загрузить. Обновите страницу.",
  "sheet.name": "Название карты",
  "sheet.back": "← Кампания",
  "act.export": "Экспорт",
  "act.undo": "Отменить",
  "act.redo": "Повторить",
  "act.delete": "Удалить",
  "export.scale": "Масштаб",
  "export.grid": "Сетка в файле",
  "export.bg": "Фон",
  "export.bg.dark": "Тёмный",
  "export.bg.paper": "Бумага",
  "export.bg.none": "Прозрачный",
  "export.png": "PNG",
  "export.svg": "SVG",
  "export.foundry": "Foundry (макрос)",
  "export.json": "JSON (копия карты)",
  "export.note": "Скрытые слои в файл не попадают. В Foundry сетку рисует сам Foundry.",
  "lang.label": "Язык",
  "theme.toLight": "Светлая тема",
  "theme.toDark": "Тёмная тема",
  "zoom.out": "Уменьшить",
  "zoom.in": "Увеличить",
  "zoom.fit": "Вписать карту",
  "zoom.reset": "Масштаб 100%",
  "orient.flat": "плоские гексы",
  "orient.pointy": "острые гексы",
  "tools.label": "Инструменты",
  "canvas.label": "Карта",
  "legend.title": "Местности",
  "terrain.none": "Пусто",
  "ctx.radius": "Радиус",
  "ctx.kind": "Вид значка",
  "ctx.text": "Текст подписи",
  "ctx.color": "Цвет",
  "ctx.width": "Ширина",
  "hint.brush": "Радиус 0 красит один гекс. Пробел и перетаскивание двигают карту.",
  "hint.eraser": "Стирает местность. Радиус как у кисти.",
  "hint.fill": "Клик заливает связную область выбранной местностью.",
  "hint.picker": "Клик по гексу берёт его местность в легенду.",
  "hint.feature": "Клик ставит значок в центр гекса, Shift — в точку клика. Alt и клик удаляют.",
  "hint.label": "Клик ставит подпись. Перетаскивание двигает, Alt и клик удаляют.",
  "hint.path": "Тяните по гексам. Alt и клик по линии удаляют её.",
  "hint.border": "Тяните вдоль рёбер гексов. Alt и клик по линии удаляют её.",
  "layers.title": "Слои",
  "layer.grid": "Сетка",
  "layer.terrain": "Местность",
  "layer.paths": "Линии",
  "layer.features": "Значки",
  "layer.labels": "Подписи",
  "layer.on": "видим",
  "layer.off": "скрыт",
  "insp.label": "Подпись",
  "insp.feature": "Значок",
  "insp.text": "Текст",
  "insp.size": "Размер",
  "insp.angle": "Угол",
  "insp.kind": "Вид",
  "insp.scale": "Масштаб",
  "minimap.title": "Сборная таблица",
  "minimap.aria": "Мини-карта: клик или стрелки переводят вид",
  "status.hex": "Гекс",
  "status.terrain": "Местность",
  "status.zoom": "Масштаб",
  "legend.toggle": "Легенда",
  "stamp.dirty": "Не сохранено",
  "stamp.saved": "Сохранено",
  "stamp.json": "Скачано JSON",
  "stamp.autosave": "Сохранено на сервере",
  "stamp.png": "Экспорт PNG",
  "stamp.svg": "Экспорт SVG",
  "stamp.foundry": "Экспорт Foundry",
  "stamp.reduced": "масштаб снижен до ×{0}",
  "error.auth": "Сессия истекла: правки не сохраняются. Войдите снова — сохранение продолжится само.",
  "error.relogin": "Войти снова",
  "error.conflict": "Карту изменили в другой вкладке или на другом устройстве. Ваши несохранённые правки будут потеряны: нажмите здесь, чтобы перезагрузить карту.",
  "error.saveFailed": "Сервер отклонил сохранение (код {0}). Правки остались только в этой вкладке: скачайте копию через «Экспорт → JSON».",
  "error.export": "Экспорт не удался ({0}). Уменьшите масштаб в меню «Экспорт» и повторите.",
  "error.foundry": "Экспорт в Foundry не удался ({0}). Уменьшите масштаб или размер карты и повторите.",
  "val.range": "Целое от {0} до {1}",
  "dlg.title": "Новая карта",
  "dlg.name": "Название",
  "dlg.orientation": "Ориентация гексов",
  "dlg.cols": "Колонки",
  "dlg.rows": "Строки",
  "dlg.hexSize": "Размер гекса, px",
  "dlg.warn": "Текущая карта будет заменена, история отмены очистится. Сохраните карту в файл, если она нужна.",
  "dlg.cancel": "Отмена",
  "dlg.create": "Создать",
  "dlg.defaultName": "Новая карта",
  "layer.numbers": "Номера гексов",
  "dice.err.empty": "Введите формулу, например d6 или 2d6+1",
  "dice.err.syntax": "Не могу разобрать формулу. Кубики и числа через + или −, например 1d8+1d4",
  "dice.err.limit": "Слишком много: до 100 кубиков, до 1000 граней, до 20 слагаемых",
  "dice.err.long": "Формула слишком длинная (не больше 100 знаков)",
  "tbl.w.formula": "Проблема с формулой: {0}",
  "tbl.w.inverted": "Перевёрнутые диапазоны: {0}",
  "tbl.w.cycle": "Таблица через другие таблицы ссылается сама на себя",
  "tbl.w.overlap": "Диапазоны {0} и {1} пересекаются",
  "tbl.w.gap": "Нет строки для: {0}",
  "tbl.w.outside": "Строки вне диапазона формулы: {0}",
  "tbl.w.missing": "Строка {0} ссылается на таблицу, которой уже нет",
  "tbl.stop.cycle": "Остановлено: таблицы ссылаются друг на друга по кругу",
  "tbl.stop.depth": "Остановлено: вложенных бросков больше 5",
  "tbl.stop.missing": "Остановлено: вложенной таблицы не существует",
  "tbl.stop.noRow": "На этот бросок нет строки: диапазоны его не покрывают",
  "tbl.stop.formula": "Остановлено: формула таблицы неверна",
  "imp.err.empty": "Строки таблицы не найдены. Нужны строки вида «1-3 Волки».",
  "imp.err.format": "Не удалось импортировать: это не текст таблицы и не JSON RollTable из Foundry",
  "imp.w.line": "Строка {0} пропущена: {1}",
  "imp.w.row": "Строка пропущена, неверный диапазон: {0}",
  "imp.w.formula": "Формула «{0}» не понята, заменена на кубик по строкам",
  "imp.w.doc": "Строка «{0}» ссылается на документ, которого нет в проекте; оставлена текстом",
  "pack.secret": "Секрет мастера",
  "pack.done": "Frontier Atlas: импортировано {0} (таблиц {1}, записей {2})",
  "tool.note": "Заметка",
  "hint.note": "Клик по гексу открывает его заметку. Заметка появляется, когда вы начнёте писать.",
  "tabs.label": "Разделы панели",
  "tabs.legend": "Легенда",
  "tabs.notes": "Заметки",
  "tabs.tables": "Таблицы",
  "notes.search": "Поиск по заметкам",
  "notes.searchPh": "Номер, название, текст",
  "notes.empty": "Заметок пока нет. Выберите инструмент «Заметка» (клавиша N) и щёлкните по гексу.",
  "notes.noMatch": "Ничего не найдено. Поиск идёт по номеру гекса, названию, тексту и секрету.",
  "notes.untitled": "Без названия",
  "notes.pickTool": "Инструмент «Заметка»",
  "notes.more": "Показаны первые {0}, уточните запрос",
  "drawer.close": "Закрыть панель",
  "note.title": "Название",
  "note.body": "Текст",
  "note.edit": "Текст",
  "note.preview": "Просмотр",
  "note.emptyPreview": "Текста пока нет. Ссылка на другой гекс пишется так: [[14.08]]",
  "note.secret": "Секрет мастера",
  "note.secretHint": "Скрыто от игроков: в Foundry уходит на закрытую страницу. Это не защита файла.",
  "note.tables": "Таблицы",
  "note.byTerrain": "По местности",
  "note.custom": "Свои",
  "note.none": "Без таблиц",
  "note.byTerrainInfo": "По местности ({0})",
  "note.noTablesTerrain": "Для этой местности таблиц нет. Назначьте их в редакторе таблицы.",
  "note.noTablesAny": "Таблиц ещё нет. Создайте их на вкладке «Таблицы».",
  "note.pickTables": "Отметьте таблицы этой заметки",
  "note.roll": "Бросить",
  "note.log": "Последние броски",
  "note.delete": "Удалить заметку",
  "note.readonly": "Телефон: заметки только для чтения. Бросать таблицы можно.",
  "roll.result": "Выпало",
  "roll.row": "строка {0}",
  "tbl.new": "Новая",
  "tbl.import": "Импорт",
  "tbl.dup": "Дублировать",
  "tbl.del": "Удалить",
  "tbl.empty": "Таблиц пока нет. Нажмите «Новая» или вставьте готовую через «Импорт».",
  "tbl.newName": "Новая таблица",
  "tbl.importedName": "Импорт",
  "tbl.name": "Название",
  "tbl.formula": "Формула кубиков",
  "tbl.rows": "Строки",
  "tbl.from": "От",
  "tbl.to": "До",
  "tbl.text": "Результат",
  "tbl.next": "Вложенная таблица",
  "tbl.noNext": "— нет",
  "tbl.addRow": "Добавить строку",
  "tbl.delRow": "Удалить строку",
  "tbl.terrains": "Местности",
  "tbl.test": "Тестовый бросок",
  "tbl.badNum": "Нужно целое число, по модулю не больше 1 000 000",
  "tbl.noRows": "Строк пока нет",
  "tbl.warnCount": "Предупреждений: {0}",
  "tbl.warnings": "Предупреждения",
  "tbl.noTerrain": "не назначена",
  "tbl.notesCount": "заметок: {0}",
  "tbl.confirm": "На таблицу «{0}» есть ссылки: {1}. После удаления они будут убраны. Удалить?",
  "tbl.confirmPlain": "Удалить таблицу «{0}»?",
  "tbl.refTerrains": "местностей {0}",
  "tbl.refNotes": "заметок {0}",
  "tbl.refRows": "строк других таблиц {0}",
  "tbl.table": "Таблица",
  "imp.title": "Импорт таблиц",
  "imp.paste": "Вставьте текст таблицы («1-3 Волки», «96-00 Дракон») или JSON RollTable из Foundry",
  "imp.file": "Выбрать файл JSON",
  "imp.run": "Импортировать",
  "imp.done": "Импортировано таблиц: {0}",
  "imp.warnings": "Предупреждения",
  "imp.close": "Готово",
  "imp.fileErr": "Не удалось прочитать файл. Выберите текстовый файл или .json.",
  "confirm.title": "Подтверждение",
  "tool.explore": "Разведка",
  "hint.explore": "Мазок по неразведанным гексам открывает их игрокам, по разведанным — снова закрывает. Неразведанное заштриховано.",
  "layer.fog": "Туман",
  "view.label": "Вид карты",
  "view.gm": "Мастер",
  "view.players": "Игроки",
  "status.players": "Вид игроков",
  "insp.shown": "Видно игрокам",
  "note.shown": "Видно игрокам: название и текст",
  "export.players": "Карта для игроков",
  "export.playersSuffix": "игроки",
  "hub.ok": "Готово",
  "hub.retry": "Повторить",
  "hub.loading": "Загрузка…",
  "hub.tagline": "Хаб кампаний: карты, участники и мост в Foundry в одном месте.",
  "hub.crumb": "Кампании",
  "hub.campaigns": "Кампании",
  "hub.newCampaign": "Новая кампания",
  "hub.campaignName": "Название кампании",
  "hub.emptyTitle": "Кампаний пока нет",
  "hub.emptyText": "Кампания — это серия листов-карт, её участники и мост в Foundry. Создайте свою или откройте приглашение, которое прислал мастер.",
  "role.gm": "Мастер",
  "role.player": "Игрок",
  "n.sheets.one": "{0} лист",
  "n.sheets.few": "{0} листа",
  "n.sheets.other": "{0} листов",
  "n.members.one": "{0} участник",
  "n.members.few": "{0} участника",
  "n.members.other": "{0} участников",
  "n.days.one": "{0} день",
  "n.days.few": "{0} дня",
  "n.days.other": "{0} дней",
  "hub.series": "Сборная таблица",
  "hub.newSheet": "Новый лист",
  "hub.importJson": "Импорт JSON",
  "hub.sheet": "Лист",
  "hub.shared": "Открыт игрокам",
  "hub.draft": "Черновик",
  "hub.share": "Открыть игрокам",
  "hub.unshare": "Скрыть от игроков",
  "hub.rename": "Переименовать",
  "hub.delete": "Удалить",
  "hub.editedAt": "изменён {0}",
  "hub.noPreview": "Нет превью",
  "hub.noSheets": "Листов нет",
  "hub.emptyGm": "В кампании ещё нет листов. Создайте первый или импортируйте карту из JSON.",
  "hub.emptyPlayer": "Мастер ещё не открыл карты.",
  "hub.sayShared": "Карта открыта игрокам",
  "hub.sayHidden": "Карта скрыта от игроков",
  "hub.sayCreated": "Лист создан",
  "hub.sayImported": "Лист импортирован",
  "hub.sayRenamed": "Переименовано",
  "hub.sayDeleted": "Удалено",
  "hub.sayCopied": "Скопировано",
  "hub.sayCopySelect": "Выделено: нажмите Ctrl+C",
  "hub.sayRevoked": "Ссылки отозваны",
  "hub.sayTokenRevoked": "Токен отозван",
  "hub.sayRole": "Роль изменена",
  "hub.sayRemoved": "Участник убран",
  "hub.renameSheet": "Название листа",
  "hub.renameCampaign": "Название кампании",
  "hub.confirmDeleteSheet": "Удалить лист «{0}» вместе с заметками и таблицами? Это нельзя отменить.",
  "hub.confirmDeleteCampaign": "Удалить кампанию «{0}» со всеми листами, участниками и токенами? Это нельзя отменить.",
  "hub.confirmRevokeInvites": "Отозвать все ссылки-приглашения? Уже принятые приглашения останутся в силе.",
  "hub.confirmRemoveMember": "Убрать «{0}» из кампании?",
  "hub.confirmLeave": "Покинуть кампанию «{0}»? Вернуться можно только по новому приглашению.",
  "hub.confirmRevokeToken": "Отозвать токен «{0}»? Мост в Foundry с этим токеном перестанет работать.",
  "hub.revoke": "Отозвать",
  "hub.leave": "Покинуть",
  "hub.remove": "Убрать",
  "hub.importBad": "Файл не похож на карту Frontier Atlas. Нужен JSON, сохранённый через «Экспорт → JSON».",
  "hub.importRead": "Не удалось прочитать файл.",
  "hub.members": "Участники",
  "hub.you": "вы",
  "hub.leaveCampaign": "Покинуть кампанию",
  "hub.removeMember": "Убрать из кампании",
  "hub.memberRole": "Роль участника {0}",
  "hub.invites": "Приглашения",
  "hub.invPlayer": "Ссылка для игрока",
  "hub.invGm": "Ссылка для мастера",
  "hub.invExpiry": "Срок действия",
  "hub.invOnce": "Показывается один раз — скопируйте сейчас.",
  "hub.invGmWarn": "Ссылка для мастера одноразовая: первый, кто её откроет, станет мастером.",
  "hub.revokeAll": "Отозвать все ссылки",
  "hub.copy": "Копировать",
  "hub.invUrl": "Ссылка-приглашение",
  "hub.foundry": "Foundry",
  "hub.tokenLabel": "Название токена",
  "hub.tokenCreate": "Создать токен",
  "hub.tokenValue": "Токен",
  "hub.tokenOnce": "Показывается один раз — скопируйте сейчас. Вставьте в настройки модуля-моста в Foundry (клиентская настройка мастера).",
  "hub.tokenCreated": "создан {0}",
  "hub.tokenUsed": "использован {0}",
  "hub.tokenNever": "не использовался",
  "hub.tokensNone": "Токенов пока нет",
  "hub.tokenRevoke": "Отозвать токен",
  "hub.campaign": "Кампания",
  "hub.deleteCampaign": "Удалить кампанию",
  "hub.renameCampaignBtn": "Переименовать кампанию",
  "hub.statusCampaign": "Кампания",
  "hub.statusRole": "Роль",
  "hub.inviteTitle": "Приглашение в кампанию «{0}»",
  "hub.inviteRole": "Роль",
  "hub.inviteUntil": "действует до {0}",
  "hub.inviteLogin": "Войдите через Discord, чтобы принять приглашение.",
  "hub.inviteBadTitle": "Приглашение недействительно",
  "hub.inviteBad": "Приглашение недействительно: срок вышел, его отозвали или его уже использовали. Попросите мастера прислать новую ссылку.",
  "hub.notFoundHint": "Возможно, ссылка устарела или у вас нет доступа к этой кампании. Вернитесь к списку кампаний.",
  "err.network": "Нет связи с сервером. Проверьте соединение и повторите.",
  "err.session": "Сессия истекла. Обновите страницу и войдите снова.",
  "err.forbidden": "Это действие доступно только мастеру кампании.",
  "err.gone": "Этого уже нет: возможно, его удалили. Обновите страницу.",
  "err.lastGm": "Нельзя убрать последнего мастера. Сначала назначьте мастером другого участника.",
  "err.conflict": "Данные изменились. Обновите страницу и повторите.",
  "err.tooLarge": "Карта слишком большая для сервера. Уменьшите размер и повторите.",
  "err.badDoc": "Сервер не принял карту: файл повреждён или не той версии.",
  "err.generic": "Что-то пошло не так ({0}). Обновите страницу и повторите."
};
const dicts = { ru, en };
const KEY = "worldograther.lang";
function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}
let lang = detect();
const listeners = /* @__PURE__ */ new Set();
function setLang(l) {
  if (!(l in dicts) || l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
  }
  for (const fn of listeners) fn();
}
const t = (key) => dicts[lang][key] ?? en[key] ?? key;
function backEdges(tables) {
  const byId = new Map(tables.map((x) => [x.id, x]));
  const state = /* @__PURE__ */ new Map();
  const out = /* @__PURE__ */ new Set();
  const visit = (tb) => {
    state.set(tb.id, 1);
    for (const r of tb.results) {
      const next = r.tableId ? byId.get(r.tableId) : void 0;
      if (!next) continue;
      if (state.get(next.id) === 1) out.add(`${tb.id}:${r.id}`);
      else if (!state.has(next.id)) visit(next);
    }
    state.set(tb.id, 2);
  };
  for (const tb of tables) if (!state.has(tb.id)) visit(tb);
  return out;
}
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);
function renderMarkdown(src, opts = {}) {
  const inline = (s) => s.replace(/\[\[(\d{1,4}\.\d{1,4})\]\]/g, (m, ref) => {
    const h = parseHexRef(ref);
    return h && (opts.hexExists?.(h.col, h.row) ?? true) ? `<a data-hex="${h.col},${h.row}" href="#hex-${ref}" role="link">${ref}</a>` : m;
  }).replace(new RegExp("\\*\\*(?=\\S)(.+?)(?<=\\S)\\*\\*", "g"), "<strong>$1</strong>").replace(new RegExp("\\*(?=[^\\s*])(.+?)(?<=[^\\s*])\\*", "g"), "<em>$1</em>");
  const lines2 = escapeHtml(String(src).replace(/\r\n?/g, "\n")).split("\n");
  const out = [];
  let para = [];
  let list2 = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    if (list2) out.push(`<${list2.tag}>${list2.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list2.tag}>`);
    para = [];
    list2 = null;
  };
  for (const line of lines2) {
    let m;
    if (!line.trim()) flush();
    else if (m = /^(#{1,3})\s+(.*)$/.exec(line)) {
      flush();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (m = /^\s*(?:(-)|\d+\.)\s+(.*)$/.exec(line)) {
      const tag = m[1] ? "ul" : "ol";
      if (list2?.tag !== tag) {
        flush();
        list2 = { tag, items: [] };
      }
      list2.items.push(m[2]);
    } else {
      if (list2) flush();
      para.push(line);
    }
  }
  flush();
  return out.join("");
}
const GRID_TYPE = { pointy: 3, flat: 5 };
const GRID_MIN_SIZE = 20;
const S3 = Math.sqrt(3);
function foundryGrid(doc, scale, round = Math.round) {
  const size = Math.max(GRID_MIN_SIZE, round(S3 * doc.hexSize * scale));
  return { type: GRID_TYPE[doc.orientation], size, scale: size / (S3 * doc.hexSize) };
}
function planFoundryGrid(doc, scale, fit) {
  const req = foundryGrid(doc, scale);
  if (fit(req.scale) >= req.scale) return req;
  const g = foundryGrid(doc, fit(req.scale), Math.floor);
  if (fit(g.scale) !== g.scale) throw new Error("Foundry export: map too large for a grid of the minimum size");
  return g;
}
const nameOr = (s, fallback) => s.trim() || fallback;
const foundryText = (html) => html.replace(/\[(?=\[)/g, "[&#8203;").replace(/@(?=[A-Za-z]+\[)/g, "@&#8203;");
function buildPackData(doc, g, png, secretName, doneText) {
  const hexExists = (c, r) => inBounds(doc, c, r);
  const cut = backEdges(doc.gm.tables);
  return {
    name: nameOr(doc.name, "Map"),
    png: png.name,
    msgs: { secret: nameOr(secretName, "GM secret"), done: doneText },
    scene: {
      width: png.width,
      height: png.height,
      padding: 0,
      shiftX: 0,
      shiftY: 0,
      grid: { type: g.type, size: g.size, distance: 5, units: "ft", style: "solidLines", thickness: 1, color: "#000000", alpha: 0.2 },
      noteIcon: Math.max(32, Math.round(g.size * 0.4)),
      noteFont: Math.min(128, Math.max(8, Math.round(g.size * 0.22)))
    },
    tables: doc.gm.tables.map((tb) => {
      const f = parseFormula(tb.formula);
      return {
        key: tb.id,
        name: nameOr(tb.name, "Table"),
        formula: f.ok ? formatFormula(f.formula) : tb.formula,
        results: tb.results.map((r) => ({
          lo: r.lo,
          hi: r.hi,
          html: foundryText(escapeHtml(r.text)),
          ...r.tableId && !cut.has(`${tb.id}:${r.id}`) && doc.gm.tables.some((x) => x.id === r.tableId) ? { ref: r.tableId } : {}
        }))
      };
    }),
    entries: doc.notes.map((n) => {
      const ref = hexRef(n.col, n.row), c = hexToPixel(doc, n.col, n.row), secret = noteSecret(doc, n.id);
      const label = nameOr(`${ref} ${n.title}`, ref);
      return {
        key: n.id,
        col: n.col,
        row: n.row,
        x: Math.round(c.x * g.scale),
        y: Math.round(c.y * g.scale),
        name: label,
        label,
        body: foundryText(renderMarkdown(n.body, { hexExists })),
        secret: secret.trim() ? foundryText(renderMarkdown(secret, { hexExists })) : ""
      };
    })
  };
}
function clipPath(doc, p) {
  const ok = (q) => {
    const { col, row } = pixelToHex(doc, q);
    return col >= 0 && row >= 0 && col < doc.cols && row < doc.rows && doc.explored[row * doc.cols + col] === 1;
  };
  const runs = [];
  let run = [];
  for (let i = 0; i + 1 < p.points.length; i++) {
    const a = p.points[i], b = p.points[i + 1];
    if (ok(a) || ok(b) || ok({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) {
      if (!run.length) run.push({ x: a.x, y: a.y });
      run.push({ x: b.x, y: b.y });
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.map((points, k) => ({ id: k ? `${p.id}~${k}` : p.id, kind: p.kind, points, width: p.width, color: p.color }));
}
function playersDoc(doc) {
  const feature = (f) => ({ id: f.id, kind: f.kind, x: f.x, y: f.y, scale: f.scale, shown: true });
  const label = (l) => ({ id: l.id, text: l.text, x: l.x, y: l.y, size: l.size, color: l.color, angle: l.angle, shown: true });
  const note = (n) => ({ id: n.id, col: n.col, row: n.row, title: n.title, body: n.body, shown: true });
  return {
    version: doc.version,
    name: doc.name,
    orientation: doc.orientation,
    cols: doc.cols,
    rows: doc.rows,
    hexSize: doc.hexSize,
    terrain: doc.terrain.map((t2, i) => doc.explored[i] ? t2 : ""),
    explored: doc.explored.slice(),
    features: doc.features.filter((f) => f.shown).map(feature),
    labels: doc.labels.filter((l) => l.shown).map(label),
    notes: doc.notes.filter((n) => n.shown).map(note),
    paths: doc.paths.flatMap((p) => clipPath(doc, p)),
    gm: emptyGm()
  };
}
export {
  buildPackData,
  fitScale,
  foundryGrid,
  hexRef,
  hexToPixel,
  planFoundryGrid,
  playersDoc,
  renderPng,
  setLang,
  t,
  terrains,
  validateDoc,
  worldSize
};
