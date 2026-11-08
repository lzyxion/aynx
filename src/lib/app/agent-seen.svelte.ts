import { invoke, listen } from "$lib/ipc";
import { noteEnded, parseAgentSeen, seenApplies, shouldSend, turnEnded, watching, type SeenMark } from "$lib/agent-seen";
import { seenAgentBanner } from "$lib/app/agent-banners.svelte.js";
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
  return () => {
    stop();
    void unlisten.then((un) => un());
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    for (const name of ["keydown", "pointerdown", "pointermove"]) window.removeEventListener(name, onInput, opts);
  };
}
