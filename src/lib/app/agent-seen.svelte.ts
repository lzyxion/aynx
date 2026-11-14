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
 * **완료 확인 공유**(2026-11-04 — docs/log/2026-11-04-agent-seen-sync.md). "안 봄" 표식(`app/agent-unseen`)은 창마다 살아, 폰에서 턴 끝을 봐도 집 PC 창의 완료가 남았다
 * (거꾸로도). 그래서 사람이 본 창이 서버 op `agent_state_seen{stream, seq}` 로 알리고, 서버가 낡지 않았으면 방송(`agent-seen`)한다 — 서버 표는 바뀌지 않는다(표시 전용 · 토큰 · 본문 없음).
 *
 * - **보내기** — `$effect` 하나가 이 창의 타일을 지켜본다(`tabs` ↔ `agent-status` 순환을 피해 `clearSeenStatus` 안에서 보내지 않는다). 무엇이 "봤다" 인지는 `$lib/agent-seen` 의 표.
 *   보이는 타일 = 활성 탭의 타일 전부 · 폰 배치면 그 탭의 포커스 타일 하나(`hostBoxes` 의 `solo` 와 같다). 타일당 턴 하나에 한 번.
 * - **받기** — 이 창의 그 스트림 타일의 표식을 거두고 끝남 배너를 푼다. 권한 물음은 풀지 않는다(답해야 풀린다). 이 창이 더 새 신호를 받았으면 지난 턴의 확인이라 버린다.
 *   자기가 보낸 것이 돌아오면 표식만 거둔다 — 배너의 "그 타일에 있던 채로 선 항목"(`bornFocused`)은 자기 창의 규칙이 푼다.
 * - **벨 · 안 본 명령 결과는 창마다 그대로다** — 터미널의 사건이라 서버 표에 없다.
 *
 * ## 사이드 채팅(2026-11-13 — 판 31)
 *
 * 사이드 채팅 배너(`app/agent-banners` 의 `{sideChatId}` 대상)도 창마다 산다 — 집 PC 에서 그 채팅을 봐도 원격 창의 배너가 남았다(거꾸로도). 같은 결로 나눈다:
 * - **번호** — 채팅 사건의 `turnEnded` 가 실은 세대(`epoch`) · 사건 번호(`seq` — 채팅마다 서버가 1씩)다(`app/side-chat-live` 의 `sideChatTurnEnd`). 새 서버 표는 없다.
 * - **보내기** — 같은 `$effect` 가 이 창에 **보이는 채팅**(채팅 독의 채팅 갈래 · 폰 덮개 — `shownSideChat`)의 턴 끝을 타일과 같은 표(`shouldSend` — 넓은 창은 턴 끝 뒤
 *   입력)로 보고 서버 op `side_chat_seen{chat, epoch, seq}` 를 보낸다. 서버는 그 채팅이 표에 있고 세대가 같고 번호가 앞서지 않으면 방송(`side-chat-seen`)한다 —
 *   표는 그대로이고 몸은 id · 번호뿐(본문 · 토큰 없음 — 사건 `side-chat-event` 와 달리 모든 창에 중계된다 · 원격은 `remote/deny.rs` ALLOW).
 * - **받기** — 그 채팅의 **끝남 · 실패** 배너를 "확인함" 으로 풀고(`seenSideChatBanner`) 목록 점 "새 답" 을 거둔다. 권한 물음은 답해야 풀린다. 이 창의 마지막 턴 끝과
 *   세대가 다르거나 이 창이 더 늦은 턴 끝을 받았으면(그 뒤 다음 턴이 섰다) 낡은 확인이라 버린다(`sideChatSeenApplies`). 자기가 보낸 것은 배너를 건드리지 않는다
 *   (보이는 채팅의 배너는 이 창의 `resolveVisitedSideChat` 이 푼다). 타일 표식과 열쇠가 겹치지 않게 `chat:<id>` 로 적는다.
 */

/** 타일 → 그 턴 끝을 처음 안 때 */
const marks = new Map<string, SeenMark>();
/** 타일 → 알렸거나 받은 seq — 턴 하나에 한 번 */
const sent = new Map<string, number>();
/** 사람의 입력 번호 — 값이 아니라 "그 턴이 끝난 뒤 입력이 있었나" 만 묻는다 */
let gen = $state(0);
/** 가장 늦게 적은 표시의 번호 — 그 뒤 첫 입력만 번호를 올린다(키마다 효과가 다시 돌지 않게) */
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
  // 사이드 채팅 — 턴 끝을 안 때는 채팅마다 적고(보이지 않아도 — 그 뒤 입력을 센다), 알리는 것은 보이는 채팅 하나
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

/** 사이드 채팅의 열쇠 — 타일 id 와 겹치지 않게 */
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

/** 창마다 한 번 — `mountAppListeners` 가 걸고 돌려받은 함수로 거둔다 */
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
