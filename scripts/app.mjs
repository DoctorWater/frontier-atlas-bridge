// Окно моста: подключение → карта → предпросмотр → результат; режимы scout и update.
import * as A from "../vendor/atlas.mjs";
import * as hub from "./hub.mjs";
import { ID } from "./grid.mjs";
import { buildPlan, apply, scoutCells, sendScout } from "./sync.mjs";

const { ApplicationV2 } = foundry.applications.api;
const L = (k) => foundry.utils.escapeHTML(game.i18n.localize(k));
const F = (k, d) => foundry.utils.escapeHTML(game.i18n.format(k, d));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const btn = (action, key, extra = "") => `<button type="button" data-action="${action}" ${extra}>${L(key)}</button>`;

export class BridgeApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fab-app",
    classes: ["fab"],
    window: { title: "FAB.Title", icon: "fa-solid fa-map-location-dot" },
    position: { width: 600, height: "auto" },
    actions: {
      connect: BridgeApp.#connect, forget: BridgeApp.#forget, preview: BridgeApp.#preview, back: BridgeApp.#back,
      apply: BridgeApp.#apply, send: BridgeApp.#send, openScene: BridgeApp.#openScene, close: BridgeApp.#close
    }
  };

  step = "connect";
  mode = "import";
  err = "";
  busy = false;

  async open(mode) {
    Object.assign(this, { mode, err: "", plan: null, scout: null, result: null, campaign: null });
    this.step = mode === "scout" ? "scout" : mode === "update" ? "preview" : "connect";
    await this.render({ force: true });
    await this.#run(async () => {
      if (mode === "scout") this.scout = await scoutCells(canvas.scene);
      else if (mode === "update") this.plan = await buildPlan(canvas.scene.flags[ID].mapId);
      else if (hub.getToken()) { this.campaign = await hub.campaign(); this.step = "maps"; }
    });
  }

  async #run(fn) {
    this.busy = true;
    this.err = "";
    await this.render();
    try { await fn(); } catch (e) { console.error(ID, e); this.err = e.message; }
    this.busy = false;
    await this.render();
  }

  /* ---------- отрисовка ---------- */

  async _renderHTML() {
    const steps = ["connect", "maps", "preview", "result"];
    const head = this.mode === "import" ? `<div class="steps">${steps.map((s) => `<span class="${s === this.step ? "on" : ""}">${L(`FAB.Step.${s}`)}</span>`).join("")}</div>` : "";
    const sub = this.mode === "update" && this.plan ? `<p><strong>${F("FAB.Update.title", { from: canvas.scene.flags[ID].rev ?? "-", to: this.plan.rev })}</strong></p>` : "";
    const err = this.err ? `<p class="err">${esc(this.err)}</p>` : "";
    const body = this.busy ? `<p>${L("FAB.Working")}</p>` : this[`_${this.step}`]();
    const auto = this.busy || this.step === "connect" ? "" : `<label class="row auto"><input type="checkbox" data-auto ${game.settings.get(ID, "autoPush") ? "checked" : ""}> ${L("FAB.Auto.label")}</label><p class="muted">${L("FAB.Auto.hint")}</p>`;
    return `<div class="fab-body">${head}${sub}${err}${body}${auto}</div>`;
  }

  _replaceHTML(result, content) { content.innerHTML = result; }

  _onRender() {
    this.element.querySelector("[data-auto]")?.addEventListener("change", (ev) => game.settings.set(ID, "autoPush", ev.target.checked));
    for (const c of this.element.querySelectorAll("[data-sel]")) {
      c.addEventListener("change", () => { this.plan.sel[c.dataset.sel] = c.checked; this.render(); });
    }
  }

  _connect() {
    return `<label class="row">${L("FAB.HubUrl")} <input type="text" name="hub" value="${esc(game.settings.get(ID, "hubUrl"))}"></label>
      <label class="row">${L("FAB.Token")} <input type="password" name="token" value="${esc(hub.getToken())}" autocomplete="off"></label>
      <p class="muted">${L("FAB.TokenHint")}</p>
      <footer>${btn("forget", "FAB.Forget")}${btn("connect", "FAB.Connect")}</footer>`;
  }

  _maps() {
    const cur = canvas.scene?.flags?.[ID];
    const linked = new Set(game.scenes.filter((s) => s.flags?.[ID]?.kind === "scene").map((s) => s.flags[ID].mapId));
    const pick = this.campaign.maps.some((m) => m.id === cur?.mapId) ? cur.mapId : this.campaign.maps[0]?.id;
    const maps = this.campaign.maps.map((m) => `<label class="row"><input type="radio" name="map" value="${esc(m.id)}" ${m.id === pick ? "checked" : ""}> ${esc(m.name)}
      <span class="muted">${m.shared ? `${L("FAB.Shared")}, ` : ""}rev ${esc(m.rev)}${linked.has(m.id) ? `, ${L("FAB.Linked")}` : ""}</span></label>`).join("");
    return `<p>${F("FAB.Connected", { name: this.campaign.name })}</p>${maps || `<p>${L("FAB.NoMaps")}</p>`}
      <footer>${btn("back", "FAB.Back")}${maps ? btn("preview", "FAB.Preview") : ""}</footer>`;
  }

  _preview() {
    const p = this.plan, s = p.sel, z = p.zones, sc = p.scene;
    const counts = (d) => F("FAB.Counts", { c: d.create.length, u: d.update.length, d: d.remove.length, s: d.same?.length ?? 0 });
    const box = (key, title, lines, off) => `<div class="cat"><label class="row"><input type="checkbox" data-sel="${key}" ${s[key] && !off ? "checked" : ""} ${off ? "disabled" : ""}> <strong>${L(title)}</strong></label>${lines.filter(Boolean).map((l) => `<p>${l}</p>`).join("")}</div>`;
    const n = sc.notes;
    const sceneLines = [
      !sc.bound ? F("FAB.Scene.new", { w: p.lay.width, h: p.lay.height }) : sc.recreate ? L("FAB.Scene.recreate") : sc.bgChanged ? L("FAB.Scene.bg") : L("FAB.Scene.noBg"),
      sc.existing && F("FAB.Scene.notes", { c: n.create.length, u: n.update.length, d: n.remove.length }),
      !sc.recreate && sc.bound && L("FAB.Scene.safe")
    ];
    const m = z.sum;
    const zoneLines = !z.on ? [F("FAB.Zones.off", { why: z.why })] : [
      z.newStorage && L("FAB.Zones.newStorage"),
      F("FAB.Zones.line", { c: m.zonesNew.length, u: m.zonesCells.length, e: m.zonesCleared.length, l: m.linksSet, x: m.linksCleared }),
      m.bindingsDropped && F("FAB.Zones.dropped", { n: m.bindingsDropped }),
      m.foreign.length && F("FAB.Zones.foreign", { list: m.foreign.join(", ") }),
      L("FAB.Zones.warn")
    ];
    const conflicts = p.conflicts.length
      ? `<div class="cat warn"><label class="row"><input type="checkbox" data-sel="overwrite" ${s.overwrite ? "checked" : ""}> <strong>${L("FAB.Conflicts.title")}</strong></label><p>${esc(p.conflicts.join(", "))}</p><p class="muted">${L("FAB.Conflicts.hint")}</p></div>`
      : "";
    const any = s.tables || s.journal || s.scene || s.zones;
    return `${p.changed ? "" : `<p><strong>${L("FAB.Nothing")}</strong></p>`}
      ${box("tables", "FAB.Cat.tables", [counts(p.tables)])}${box("journal", "FAB.Cat.journal", [counts(p.journal)])}${box("scene", "FAB.Cat.scene", sceneLines)}${box("zones", "FAB.Cat.zones", zoneLines, !z.on)}${conflicts}
      <footer>${this.mode === "import" ? btn("back", "FAB.Back") : ""}${btn("apply", "FAB.Apply", p.changed && any ? "" : "disabled")}</footer>`;
  }

  _result() {
    return `<p><strong>${L(this.result.complete ? "FAB.Done" : "FAB.DonePartial")}</strong></p>${this.result.log.map((l) => `<p>${esc(l)}</p>`).join("")}
      <footer>${this.result.scene ? btn("openScene", "FAB.OpenScene") : ""}${btn("close", "FAB.Close")}</footer>`;
  }

  _scout() {
    const c = this.scout?.cells;
    if (!c) return `<footer>${btn("close", "FAB.Close")}</footer>`;
    if (!c.length) return `<p>${L("FAB.Scout.none")}</p><footer>${btn("close", "FAB.Close")}</footer>`;
    const list = c.map((x) => A.hexRef(x.col, x.row)).join(", ");
    return `<p>${F("FAB.Scout.will", { n: c.length, list })}</p><footer>${btn("close", "FAB.Close")}${btn("send", "FAB.Scout.send")}</footer>`;
  }

  _done() { return `<p>${esc(this.done)}</p><footer>${btn("close", "FAB.Close")}</footer>`; }

  /* ---------- действия ---------- */

  static async #connect() {
    const q = (n) => this.element.querySelector(`[name=${n}]`).value;
    await game.settings.set(ID, "hubUrl", hub.normalizeUrl(q("hub")) ?? q("hub").trim());
    await hub.setToken(q("token").trim());
    await this.#run(async () => { this.campaign = await hub.campaign(); this.step = "maps"; });
  }

  static async #forget() {
    await hub.setToken("");
    await this.render();
  }

  static async #preview() {
    const id = this.element.querySelector("[name=map]:checked")?.value;
    await this.#run(async () => { this.plan = await buildPlan(id); this.step = "preview"; });
  }

  static async #back() {
    this.err = "";
    this.step = this.step === "preview" ? "maps" : "connect";
    await this.render();
  }

  static async #apply() {
    await this.#run(async () => { this.result = await apply(this.plan); this.step = "result"; });
  }

  static async #send() {
    const n = this.scout.cells.length;
    await this.#run(async () => {
      await sendScout(this.scout);
      this.done = game.i18n.format("FAB.Scout.sent", { n });
      this.step = "done";
    });
  }

  static #openScene() { this.result.scene.view(); }

  static #close() { this.close(); }
}
