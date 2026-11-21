import { invoke, listen } from "$lib/ipc";
import {
  noteEnded,
  parseAgentSeen,
  parseSideChatSeen,
  seenApplies,
  shouldSend,
  sideChatSeenApplies,
  turnEnded,
  watching,
  type SeenMark,
} from "$lib/agent-seen";
import { sideChatSeen } from "$lib/side-chat-api";
import { seenAgentBanner, seenSideChatBanner } from "$lib/app/agent-banners.svelte.js";
import { seenSideChatElsewhere, shownSideChat, sideChatTurnEnd, sideChatTurnEnds } from "$lib/app/side-chat-live.svelte.js";
import { agentSeqOf, agentSignalsOf } from "$lib/app/agent-status.svelte.js";
import { clearAgentUnseen } from "$lib/app/agent-unseen.svelte.js";
import { handheld, mobileLayout, pageShown } from "$lib/app/mobile.svelte.js";
import { activeTabId, paneOf, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { veilVisible } from "$lib/app/veil.svelte.js";
import { findPaneByStream, listPanes } from "$lib/session";

/**
 * 완료 확인 공유 — 서버 op `agent_state_seen` · `side_chat_seen` 은 서버 표를 바꾸지 않고 방송만 한다. 몸은 id · 번호뿐(본문 · 토큰 없음)이라
 * 모든 창에 중계된다(원격은 `remote/deny.rs` ALLOW). 보내기는 `$effect` 에서 한다 — `clearSeenStatus` 안에서 보내면 `tabs` ↔ `agent-status` 가 돈다.
 * 벨 · 안 본 명령 결과는 창마다 그대로다 — 터미널의 사건이라 서버 표에 없다.
 */

const marks = new Map<string, SeenMark>();
/** 턴 하나에 한 번 */
const sent = new Map<string, number>();
let gen = $state(0);
/** 그 뒤 첫 입력만 번호를 올린다 — 키마다 효과가 다시 돌지 않게 */
let newestMark = 0;
let focused = $state(true);

function onInput(): void {
  if (gen === newestMark) gen += 1;
}

function onFocus(): void {
  focused = true;
  onInput(); // 창으로 돌아온 것도 사람의 입력이다
}

function onBlur(): void {
  focused = false;
}

function sendSeen(): void {
  const activeId = activeTabId();
  const solo = mobileLayout();
  const hand = handheld();
  const now = gen;
  const see = watching({ veil: veilVisible(), pageShown: pageShown(), handheld: hand, focused });
  for (const tab of residentWindowTabs()) {
    const panes = listPanes(tab.root);
    const focusId = tab.id === activeId && solo ? paneOf(tab) : null;
    for (const pane of panes) {
      if (!turnEnded(agentSignalsOf(pane.id))) continue;
      const seq = agentSeqOf(pane.id);
      if (seq === null) continue; // 옛 서버 — seq 없는 신호는 보내지 않는다
      const mark = noteEnded(marks.get(pane.id), seq, now);
      if (mark !== marks.get(pane.id)) {
        marks.set(pane.id, mark);
        newestMark = Math.max(newestMark, mark.gen);
      }
      const visible = tab.id === activeId && (focusId === null || focusId === pane.id);
      if (!shouldSend({ visible, watching: see, handheld: hand, mark, gen: now, sent: sent.get(pane.id) })) continue;
      sent.set(pane.id, seq);
      void invoke("agent_state_seen", { stream: pane.historyStreamId ?? pane.id, seq }).catch(() => {});
    }
  }
  // 턴 끝을 안 때는 보이지 않는 채팅도 적는다 — 그 뒤 입력을 센다
  const shownChat = shownSideChat();
  for (const [chat, end] of Object.entries(sideChatTurnEnds())) {
    const key = chatKey(chat);
    const mark = noteEnded(marks.get(key), end.seq, now);
    if (mark !== marks.get(key)) {
      marks.set(key, mark);
      newestMark = Math.max(newestMark, mark.gen);
    }
    if (!shouldSend({ visible: chat === shownChat, watching: see, handheld: hand, mark, gen: now, sent: sent.get(key) })) continue;
    sent.set(key, end.seq);
    void sideChatSeen(chat, end.epoch, end.seq).catch(() => {});
  }
}

/** 타일 id 와 겹치지 않게 */
const chatKey = (chat: string): string => `chat:${chat}`;

function onSideChatSeen(payload: unknown): void {
  const seen = parseSideChatSeen(payload);
  if (!seen || !sideChatSeenApplies(seen, sideChatTurnEnd(seen.chat))) return;
  const key = chatKey(seen.chat);
  const own = sent.get(key) === seen.seq;
  sent.set(key, seen.seq);
  seenSideChatElsewhere(seen.chat);
  if (!own) seenSideChatBanner(seen.chat);
}

function onSeen(payload: unknown): void {
  const seen = parseAgentSeen(payload);
  if (!seen) return;
  for (const tab of residentWindowTabs()) {
    const pane = findPaneByStream(tab.root, seen.stream);
    if (!pane) continue;
    if (!seenApplies(seen.seq, agentSeqOf(pane.id))) return;
    const own = sent.get(pane.id) === seen.seq;
    sent.set(pane.id, seen.seq);
    clearAgentUnseen([pane.id]);
    if (!own) seenAgentBanner(pane.id);
    return;
  }
}

export function mountAgentSeen(): () => void {
  focused = document.hasFocus();
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  const opts = { capture: true, passive: true };
  for (const name of ["keydown", "pointerdown", "pointermove"]) window.addEventListener(name, onInput, opts);
  const stop = $effect.root(() => {
    $effect(sendSeen);
  });
  const unlisten = listen<unknown>("agent-seen", (ev) => onSeen(ev.payload)).catch(() => () => {});
  const unlistenChat = listen<unknown>("side-chat-seen", (ev) => onSideChatSeen(ev.payload)).catch(() => () => {});
  return () => {
    stop();
    void unlisten.then((un) => un());
    void unlistenChat.then((un) => un());
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    for (const name of ["keydown", "pointerdown", "pointermove"]) window.removeEventListener(name, onInput, opts);
  };
}
