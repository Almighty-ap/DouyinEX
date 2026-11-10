import { getSettings } from "./common/settings.js";
import { initPanel } from "./packages/Panel/Panel.js";
import { copyStream, autoHighestQuality } from "./packages/Stream/Stream.js";
import {
  autoWebFull,
  autoFull,
  initAutoFullMode,
  initWheelVolume,
  initSimpleMode,
  initFullscreenFoldChat,
  initHideGiftBar,
} from "./packages/Player/Player.js";
import { initChatShield } from "./packages/Chat/Shield.js";
import { initDanmakuLayer } from "./packages/Danmaku/Layer.js";
import { initLottery } from "./packages/Lottery/Lottery.js";

function registerMenu(panel) {
  if (typeof GM_registerMenuCommand !== "function") return;
  GM_registerMenuCommand("DouyinEX 设置面板", panel.toggle);
  GM_registerMenuCommand("复制直播流（最高画质 FLV）", () => copyStream("flv"));
}

function main() {
  const panel = initPanel();
  registerMenu(panel);
  initSimpleMode();
  initFullscreenFoldChat();
  initHideGiftBar();
  initAutoFullMode();
  initWheelVolume();
  initChatShield();
  initDanmakuLayer();
  initLottery();

  const s = getSettings();
  if (s.autoQuality) autoHighestQuality();
  if (s.autoFull) autoFull();
  else if (s.autoWebFull) autoWebFull();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
