import { sleep, toast } from "../../common/dom.js";
import { getSettings, onSettingChange } from "../../common/settings.js";
import { win } from "../../common/env.js";
import { sendChat } from "../Chat/send.js";
import {
  parseCountdownSeconds,
  parseConditionsFromText,
  evaluateLotteryEligibility,
  parseLotteryResultText,
  isCommentJoinButtonText,
  isDirectJoinButtonText,
  isFollowButtonText,
  isPaidButtonText,
} from "../../lib/lottery.js";

const SELECTORS = {
  shortTouch: '#ShortTouchLayout, .ShortTouchContainer, [class*="ShortTouch"]',
  icon: '.dVxrjT_h, .LMUtLyr9, [aria-label*="福袋"], img[alt*="福袋"]',
  timer: ".ycjwPFJI, .VWPnhGkt, .qR53KhLu",
  dialog:
    '#short_touch_land_lottery_land_userMain, [data-short-touch-landing="short_touch_land_lottery_land_userMain"], #lottery_close_cotainer, [id*="lottery_close"]',
  closeBtn:
    '.hJ3SHYaQ, #lottery_close_cotainer [class*="close"], [id*="lottery_close"] .hJ3SHYaQ',
  alreadyJoined: ".UU67CvI1",
  actionBtn: '.QOARtY3v, [class*="QOARtY3v"], [role="button"], button',
  reqItem: '.aMOCkQGL, [class*="aMOCkQGL"], .oojA302O',
  statusItem: '.q6Dj7eFU, [class*="q6Dj7eFU"]',
  resultDialog:
    '#short_touch_land_lottery_land_result, [data-short-touch-landing="short_touch_land_lottery_land_result"], .HHKLyVbA.lotteryDialog, .HHkLyvba.lotteryDialog, [class*="lotteryDialog"], .lotteryDialog',
  resultText: '.EJpzW6yC, [class*="EJpzW6yC"]',
  resultBtn:
    '.QOARtY3v.VA93rNkB.U8EWGi24, [class*="lotteryDialog"] .QOARtY3v, #short_touch_land_lottery_land_result [role="button"]',
};

const POLL_MS = 3000;

let pollTimer = null;
let processing = false;
let cooldownUntil = 0;
let lastPathname = "";
let lastResultSig = "";

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const s = window.getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) <= 0.05) {
    return false;
  }
  const r = el.getBoundingClientRect();
  return r.width >= 8 && r.height >= 8;
}

function queryVisible(selector, root = document) {
  for (const el of root.querySelectorAll(selector)) {
    if (isVisible(el)) return el;
  }
  return null;
}

function dispatchClick(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const opts = {
    bubbles: true,
    cancelable: true,
    // 油猴沙箱里的 window 不是页面真实 Window，直接传给 view 会让构造器抛
    // `Failed to convert value to 'Window'`，导致整段点击失效。必须用 unsafeWindow。
    view: win,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
  };
  const fire = (Ctor, type) => {
    try {
      el.dispatchEvent(new Ctor(type, opts));
    } catch (_) {}
  };
  fire(PointerEvent, "pointerdown");
  fire(MouseEvent, "mousedown");
  fire(PointerEvent, "pointerup");
  fire(MouseEvent, "mouseup");
  // 即使上面的合成事件全部失败，也要保证原生 click 一定发出
  el.click();
  return true;
}

function getCountdownSec(root = document) {
  for (const el of root.querySelectorAll(SELECTORS.timer)) {
    if (!isVisible(el)) continue;
    const sec = parseCountdownSeconds(el.textContent);
    if (sec !== null) return sec;
  }
  const m = String(root.textContent || "").match(/\b(\d{1,2}):([0-5]\d)\b/);
  return m ? parseCountdownSeconds(m[0]) : null;
}

function findLotteryEntry() {
  const containers = [...document.querySelectorAll(SELECTORS.shortTouch)].filter(isVisible);
  const scopes = containers.length > 0 ? [...containers, document] : [document];
  for (const scope of scopes) {
    for (const rawEl of scope.querySelectorAll(SELECTORS.icon)) {
      if (!isVisible(rawEl)) continue;
      const el = queryVisible(".dVxrjT_h", rawEl) || rawEl;
      const sec = getCountdownSec(el) ?? (scope !== document ? getCountdownSec(scope) : null);
      if (sec !== null) return { el, remainingSeconds: sec };
    }
  }
  return null;
}

function isAlreadyJoinedModal(dialog) {
  if (!dialog) return false;
  const joinedEl = queryVisible(SELECTORS.alreadyJoined, dialog);
  if (joinedEl && /已参与|等待开奖|参与成功/.test(joinedEl.textContent || "")) return true;
  for (const el of dialog.querySelectorAll("div, span, button")) {
    const t = (el.textContent || "").trim();
    if ((t === "已参与" || t === "等待开奖" || t === "已成功参与") && isVisible(el)) {
      return true;
    }
  }
  return false;
}

function findParticipationDialog() {
  for (const el of document.querySelectorAll(SELECTORS.dialog)) {
    if (!isVisible(el)) continue;
    if (
      el.id === "short_touch_land_lottery_land_result" ||
      el.closest("#short_touch_land_lottery_land_result") ||
      el.querySelector(".lotteryDialog, [class*='lotteryDialog']")
    ) {
      continue;
    }
    return el;
  }
  return null;
}

function extractModalConditions(dialog) {
  if (!dialog) return [];
  const list = [];
  const seen = new Set();
  for (const reqEl of dialog.querySelectorAll(SELECTORS.reqItem)) {
    if (!isVisible(reqEl)) continue;
    const statusEl =
      reqEl.querySelector(SELECTORS.statusItem) ||
      (reqEl.parentElement ? reqEl.parentElement.querySelector(SELECTORS.statusItem) : null);
    if (statusEl) {
      const status = (statusEl.textContent || "").trim();
      const requirement = (reqEl.textContent || "").replace(status, "").trim();
      const key = `${requirement}|${status}`;
      if (requirement && !seen.has(key)) {
        seen.add(key);
        list.push({ requirement, status });
      }
    }
  }
  if (list.length > 0) return list;
  return parseConditionsFromText(dialog.innerText || dialog.textContent || "");
}

function findModalActionButton(dialog) {
  if (!dialog) return null;
  const candidates = [...dialog.querySelectorAll(SELECTORS.actionBtn)].filter(isVisible);
  for (const btn of candidates) {
    const t = (btn.textContent || "").trim();
    if (isCommentJoinButtonText(t) || isDirectJoinButtonText(t) || isFollowButtonText(t)) {
      return btn;
    }
  }
  const primary = queryVisible(".QOARtY3v", dialog);
  if (primary && !isVisible(primary.querySelector("button, [role='button']"))) {
    return primary;
  }
  return null;
}

function closeLotteryDialog(dialog) {
  const closeBtn =
    (dialog && queryVisible(SELECTORS.closeBtn, dialog)) || queryVisible(SELECTORS.closeBtn);
  if (closeBtn) {
    dispatchClick(closeBtn);
    return true;
  }
  for (const el of (dialog || document).querySelectorAll('div, span, button, [role="button"]')) {
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim();
    if (/^(?:关闭|×|✕|✖)$/.test(label) && isVisible(el)) {
      dispatchClick(el);
      return true;
    }
  }
  return false;
}

async function handleResultModal() {
  const resultDialog = queryVisible(SELECTORS.resultDialog);
  if (!resultDialog) return false;

  const textEl = queryVisible(SELECTORS.resultText, resultDialog) || resultDialog;
  const parsed = parseLotteryResultText(textEl.textContent || "");
  if (!parsed) return false;

  const sig = `${parsed.status}:${parsed.text.slice(0, 30)}`;
  if (sig !== lastResultSig) {
    lastResultSig = sig;
    if (parsed.status === "won") {
      toast("🎉 恭喜抽中福袋！请留意直播间领奖提示");
    }
  }

  cooldownUntil = 0;

  // 未中奖时自动点掉【知道了】或关闭按钮；中奖时保留弹窗以免错过实物填地址入口
  if (parsed.status === "lost") {
    const knowBtn =
      queryVisible(SELECTORS.resultBtn, resultDialog) ||
      [...resultDialog.querySelectorAll("div, button, span")].find(
        (el) => (el.textContent || "").trim() === "知道了" && isVisible(el),
      );
    if (knowBtn) dispatchClick(knowBtn);
    else closeLotteryDialog(resultDialog);
    await sleep(200);
  }
  return true;
}

async function waitForDialog(timeout = 3500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const d = findParticipationDialog();
    if (d) {
      await sleep(350);
      return d;
    }
    await sleep(200);
  }
  return null;
}

async function executeJoin(dialog, decision) {
  const actionBtn = findModalActionButton(dialog);
  const btnText = actionBtn ? (actionBtn.textContent || "").trim() : "";

  if (isPaidButtonText(btnText)) return false;

  if (decision.action === "follow_then_join") {
    if (!actionBtn) return false;
    dispatchClick(actionBtn);
    await sleep(700);
    const refreshedDialog = findParticipationDialog() || dialog;
    if (isAlreadyJoinedModal(refreshedDialog)) return true;
    const nextBtn = findModalActionButton(refreshedDialog);
    const nextText = nextBtn ? (nextBtn.textContent || "").trim() : "";
    if (nextBtn && !isPaidButtonText(nextText)) {
      dispatchClick(nextBtn);
      await sleep(500);
    }
    if (isAlreadyJoinedModal(refreshedDialog)) return true;
    if (decision.command) {
      return await sendChat(decision.command);
    }
    return false;
  }

  // join_comment 或 join_direct：优先点击弹窗内一键评论/参与按钮
  if (actionBtn) {
    dispatchClick(actionBtn);
    await sleep(550);
    const currentDialog = findParticipationDialog();
    if (!currentDialog || isAlreadyJoinedModal(currentDialog)) {
      return true;
    }
  }

  // 兜底：若存在明确口令且弹窗按钮未能完成参与，调用 sendChat 发送口令评论
  if (decision.action === "join_comment" && decision.command) {
    const sent = await sendChat(decision.command);
    if (!sent) return false;
    await sleep(450);
    const currentDialog = findParticipationDialog();
    if (currentDialog && !isAlreadyJoinedModal(currentDialog)) {
      const retryBtn = findModalActionButton(currentDialog);
      if (retryBtn && !isPaidButtonText(retryBtn.textContent || "")) {
        dispatchClick(retryBtn);
        await sleep(400);
      }
    }
    return true;
  }

  return false;
}

async function runTick() {
  const s = getSettings();
  if (!s.autoLottery || processing) return;

  if (location.pathname !== lastPathname) {
    lastPathname = location.pathname;
    cooldownUntil = 0;
    lastResultSig = "";
  }

  processing = true;
  try {
    if (await handleResultModal()) return;
    if (Date.now() < cooldownUntil) return;

    let dialog = findParticipationDialog();
    let entrySec = null;

    if (!dialog) {
      const entry = findLotteryEntry();
      if (!entry) return;
      entrySec = entry.remainingSeconds;
      dispatchClick(entry.el);
      dialog = await waitForDialog();
      if (!dialog) return;
    }

    const modalSec = getCountdownSec(dialog) ?? entrySec;
    const alreadyJoined = isAlreadyJoinedModal(dialog);
    const conditions = extractModalConditions(dialog);
    const actionBtn = findModalActionButton(dialog);
    const buttonText = actionBtn ? (actionBtn.textContent || "").trim() : "";

    const decision = evaluateLotteryEligibility({
      conditions,
      alreadyJoined,
      buttonText,
      allowFollow: !!s.autoLotteryFollow,
      remainingSeconds: modalSec,
    });

    const lockRound = (sec) => {
      const waitSec = sec && sec > 0 ? sec + 2 : 45;
      cooldownUntil = Date.now() + waitSec * 1000;
    };

    if (decision.action === "already_joined") {
      closeLotteryDialog(dialog);
      lockRound(modalSec);
      return;
    }

    if (decision.action === "skip") {
      closeLotteryDialog(dialog);
      lockRound(modalSec);
      return;
    }

    if (decision.action === "wait_watch") {
      closeLotteryDialog(dialog);
      cooldownUntil = Date.now() + (decision.retryDelaySec || 30) * 1000;
      return;
    }

    if (
      decision.action === "join_comment" ||
      decision.action === "join_direct" ||
      decision.action === "follow_then_join"
    ) {
      const ok = await executeJoin(dialog, decision);
      const afterDialog = findParticipationDialog();
      if (afterDialog) closeLotteryDialog(afterDialog);
      lockRound(modalSec);
      if (ok) {
        toast(
          decision.command
            ? `已自动参与福袋（口令：${decision.command}）`
            : "已自动参与免费福袋",
        );
      }
    }
  } catch (_) {
    // 忽略单次 DOM 异常，等待下一轮轮询
  } finally {
    processing = false;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(runTick, POLL_MS);
  setTimeout(runTick, 3500);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  cooldownUntil = 0;
}

export function initLottery() {
  lastPathname = location.pathname;
  if (getSettings().autoLottery) startPolling();
  onSettingChange((key, val) => {
    if (key === "autoLottery") {
      if (val) startPolling();
      else stopPolling();
    } else if (key === "autoLotteryFollow" && val) {
      cooldownUntil = 0;
    }
  });
}
