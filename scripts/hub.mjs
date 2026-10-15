// Клиент хаба и настройки подключения. Запросы только с клиента мастера.
import { ID } from "./grid.mjs";

const TIMEOUT_MS = 20_000;
const DEFAULT_URL = "https://atlas.koshkaslojkoy.com";

export class HubError extends Error {
  /** kind — ключ FAB.Err.<kind>; detail подставляется в текст. */
  constructor(kind, detail = "") {
    super(game.i18n.format(`FAB.Err.${kind}`, { detail }));
    this.kind = kind;
  }
}

/** Адрес без хвостовых слэшей; не http(s) → null. */
export function normalizeUrl(s) {
  const url = String(s ?? "").trim().replace(/\/+$/, "");
  try { return /^https?:$/.test(new URL(url).protocol) ? url : null; } catch { return null; }
}

export function registerSettings() {
  const client = { scope: "client", config: false };
  game.settings.register(ID, "hubUrl", { ...client, type: String, default: DEFAULT_URL });
  // токен = все секреты кампании: только в этом браузере, по одному на мир
  game.settings.register(ID, "tokens", { ...client, type: Object, default: {} });
  game.settings.register(ID, "autoPush", { ...client, type: Boolean, default: false });
}

export const getToken = () => game.settings.get(ID, "tokens")?.[game.world.id] ?? "";

export function setToken(token) {
  const all = { ...game.settings.get(ID, "tokens") };
  if (token) all[game.world.id] = token; else delete all[game.world.id];
  return game.settings.set(ID, "tokens", all);
}

async function call(path, init = {}) {
  const base = normalizeUrl(game.settings.get(ID, "hubUrl"));
  if (!base) throw new HubError("badUrl");
  const token = getToken();
  if (!token) throw new HubError("noToken");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(base + path, {
        ...init, signal: ctl.signal,
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) }
      });
    } catch (e) {
      if (e.name === "AbortError") throw new HubError("timeout");
      throw new HubError(location.protocol === "https:" && base.startsWith("http:") ? "mixed" : "net", base);
    }
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) throw new HubError("auth");
    if (!res.ok) throw new HubError("http", json.error || `HTTP ${res.status}`);
    return json;
  } finally { clearTimeout(timer); }
}

export const campaign = () => call("/api/bridge/campaign");

export async function map(id) {
  const r = await call(`/api/bridge/maps/${encodeURIComponent(id)}`);
  if (r.doc?.version !== 1) throw new HubError("version", r.doc?.version);
  return r;
}

/** Только открывает гексы; идемпотентно. */
export const pushExploration = (id, cells) => call(`/api/bridge/maps/${encodeURIComponent(id)}/exploration`, {
  method: "POST", body: JSON.stringify({ cells: cells.map(({ col, row }) => ({ col, row, explored: true })) })
});
