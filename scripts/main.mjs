// Только проводка: хуки Foundry. Логика — в sync.mjs, окно — в app.mjs.
import * as A from "../vendor/atlas.mjs";
import { ID, GRHC } from "./grid.mjs";
import { registerSettings, getToken } from "./hub.mjs";
import { status, checkHub, scoutCells, sendScout } from "./sync.mjs";
import { BridgeApp } from "./app.mjs";

const F = (k, d) => game.i18n.format(k, d);
const bound = (scene) => scene?.flags?.[ID]?.kind === "scene";
const open = (mode) => () => (foundry.applications.instances.get("fab-app") ?? new BridgeApp()).open(mode);

Hooks.once("init", registerSettings);

Hooks.once("ready", () => { if (game.user.isGM) A.setLang(game.i18n.lang === "ru" ? "ru" : "en"); });

// своя группа кнопок: цвет иконки группы показывает состояние связи с хабом
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  controls[ID] = {
    name: ID, order: Object.keys(controls).length, title: "FAB.Button", icon: "fa-solid fa-map-location-dot", visible: true,
    tools: {
      open: { name: "open", order: 0, title: "FAB.Tool.open", icon: "fa-solid fa-download", button: true, onChange: open("import") },
      scout: { name: "scout", order: 1, title: "FAB.Tool.scout", icon: "fa-solid fa-binoculars", button: true, onChange: open("scout") }
    }
  };
});

Hooks.on("renderSceneControls", (app, html) => {
  const b = html.querySelector(`button.layer[data-control="${ID}"]`);
  if (!b) return;
  const state = status.state(canvas.scene);
  b.dataset.fabStatus = state;
  b.dataset.tooltipText = [game.i18n.localize("FAB.Button"), game.i18n.localize(`FAB.Status.${state}`), status.error(canvas.scene)].filter(Boolean).join(": ");
});

// проверка хаба — только при смене сцены, а не на каждый canvasReady
let lastScene = null, offered = new Map();
Hooks.on("canvasReady", async (cv) => {
  const scene = cv.scene;
  if (!game.user.isGM || scene?.id === lastScene) return;
  lastScene = scene?.id;
  if (!bound(scene) || !getToken()) return;
  const info = await checkHub(scene);
  if (!info || offered.get(scene.id) === info.key) return;
  offered.set(scene.id, info.key);
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: "FAB.Title" }, content: `<p>${F("FAB.Update.ask", { from: info.from ?? "-", to: info.rev })}</p>`
  });
  if (yes && canvas.scene?.id === scene.id) open("update")();
});

// Автоотправка разведки: гекскраул пишет состояние в журнал-хранилище сцены; шаг без новых гексов — тихий no-op.
const pending = new Set();
const autoPush = foundry.utils.debounce(async () => {
  const scenes = [...pending];
  pending.clear();
  for (const scene of scenes) {
    try {
      const s = await scoutCells(scene);
      if (!s.cells.length) continue;
      await sendScout(s);
      ui.notifications.info(F("FAB.Auto.sent", { n: s.cells.length }));
    } catch (e) {
      console.warn(ID, e);
      status.set(scene, "error", e.message);
    }
  }
}, 2000);

Hooks.on("updateJournalEntry", (journal) => {
  if (!game.user.isGM || !game.settings.get(ID, "autoPush") || !getToken() || !game.modules.get(GRHC)?.active) return;
  const scene = game.scenes.find((s) => bound(s) && s.flags[GRHC]?.locator?.storageJournalUuid === journal.uuid);
  if (!scene) return;
  pending.add(scene);
  autoPush();
});
