// **내부 전용** — 프롬프트 줄의 데코: 상태 띠(실행 중·성공·실패) · 실패 줄 배경 · [AI에게 묻기] · [리치하게 보기] 단추 · 거터 시간 표식.
// 데코의 수명은 부르는 쪽이 쥔다(`rec.decorations` · `s.restored`).

import type { IDecoration, IMarker } from "@xterm/xterm";
import { blockDurationMs, type CommandBlock } from "$lib/block-history";
import { blockMarkTitle, blockOutcomeLabel } from "$lib/finish-notify";
import { splitKeySequence } from "$lib/keycaps";
import { koTr, type CommandRecord, type SiState } from "./state";
import type { PaneStatus } from "./types";

/**
 * 데코에 말풍선을 단다 — `.xterm` 안쪽은 앱 툴팁 층이 비켜 가므로(`tooltip.svelte.ts`) `data-app-tooltip` 로 앱 것임을
 * 밝혀 네이티브 대신 앱 말풍선을 받는다. 호버 중에는 툴팁 층이 `title` 을 `data-tip` 으로 옮겨 두므로, `onRender` 가 다시
 * 불려 `title` 을 또 써도 그 층의 관찰자가 곧바로 다시 옮긴다.
 */
function appTip(el: HTMLElement, text: string) {
  el.dataset.appTooltip = "";
  el.title = text;
}

/**
 * 명령의 **상태 색 띠**를 프롬프트 줄(A)에 건다 — 실행 중/성공/실패를 한 자리에서 교체한다.
 *
 * 띠는 왼쪽 거터(x:0)의 **세로선**이다 (iTerm2·VS Code 의 명령 블록 시각화). C 에서 실행
 * 중(파랑), D 에서 성공(회색)·실패(빨강)로 **교체**한다 — 명령당 하나만 살아 스크롤백 밖으로
 * 밀릴 때까지 유지된다. **모든 명령에 띠가 서므로** 명령 경계가 눈으로 읽힌다: OSC 133 이
 * 만든 2계층 블록(프롬프트/출력)의 **시각적 절반**이다.
 *
 * 자리를 프롬프트 줄로 잡은 것은 명령과 함께 읽히게 하기 위해서다 — 스크롤을 훑을 때
 * "이 명령이 이렇게 끝났다" 가 명령과 붙어 있어야 한다. 색은 CSS 토큰이 정하므로 여기서는
 * 클래스만 붙인다 (테마가 바뀌면 따라간다).
 *
 * **WebGL 반투명 원칙:** 띠는 글자가 없는 거터 칸이라 **불투명이어도** 텍스트를 가리지
 * 않는다. 반면 실패의 줄 배경 강조는 명령 텍스트 **위**에 얹히므로 반드시 반투명이다
 * (WebGL 캔버스 위 데코 원칙 — Terminal.svelte 의 `.aynx-fail-row` 주석).
 */
export function markStatus(
  s: SiState,
  rec: CommandRecord,
  kind: PaneStatus,
  title = "",
  blockId?: number,
  rich = false,
) {
  if (rec.promptMarker.isDisposed) return;
  // 이전 상태(대개 "실행 중")의 데코를 걷어 내고 새 상태로 갈아 끼운다 — 명령당 띠 하나.
  for (const d of rec.decorations) d.dispose();
  rec.decorations.length = 0;
  rec.decorations.push(...decorate(s, rec.promptMarker, kind, title, blockId, rich));
}

/**
 * 마커 하나에 상태 띠(+실패면 줄 배경)를 건다 — 만든 데코를 돌려주고 **수명은 부르는
 * 쪽이 쥔다**. [`markStatus`](살아 있는 명령)와 [`restoreMarkers`](이관으로 넘어온
 * 실패 표시)가 **같은 코드로** 그리도록 떼어 낸 자리다: 둘이 갈리면 넘어온 타일의 실패
 * 표시만 색이나 층이 미묘하게 달라진다.
 *
 * `title` 은 **실패의 붉은 띠에 거는 말풍선**이다 (`blockMarkTitle` — 종료 코드·시각·
 * 명령문). 빈 문자열이면 안 건다. 자리를 여기로 잡은 이유: 시간 표식은 임계를 넘긴
 * 명령에만 서므로, 말풍선이 표식에만 붙어 있으면 **0.2초 만에 죽은 명령의 종료 코드를
 * 볼 길이 없다**. 반면 붉은 띠는 실패한 모든 명령에 선다.
 */
export function decorate(
  s: SiState,
  marker: IMarker,
  kind: PaneStatus,
  title = "",
  blockId?: number,
  /** 출력이 있는 끝난 블록 — [리치하게 보기] 단추를 심는다(`sink.richButton` 이 있을 때) */
  rich = false,
): IDecoration[] {
  if (marker.isDisposed) return [];
  const out: IDecoration[] = [];
  const cls =
    kind === "running" ? "aynx-cmd-running" : kind === "ok" ? "aynx-cmd-ok" : "aynx-cmd-fail";
  const tip = kind === "fail" ? title : "";
  const band = s.term.registerDecoration({ marker, x: 0, width: 1, layer: "top" });
  band?.onRender((el) => {
    el.classList.add("aynx-cmd-band", cls);
    if (tip !== "") appTip(el, tip); // `onRender` 는 스크롤마다 다시 불린다 — 대입은 멱등이다
  });
  if (band) out.push(band);

  // 줄 배경 강조는 **실패만** — 성공·실행 중은 띠 하나로 조용히 둔다 (배경까지 깔면
  // 스크롤이 얼룩덜룩해져 실패가 묻힌다). 배경은 텍스트 위라 CSS 에서 반투명이다.
  if (kind === "fail") {
    const row = s.term.registerDecoration({ marker, x: 0, width: s.term.cols, layer: "bottom" });
    row?.onRender((el) => {
      el.classList.add("aynx-fail-row");
      if (tip !== "") appTip(el, tip); // 줄 전체가 말풍선의 과녁이다 (3px 거터보다 맞히기 쉽다)
      if (blockId !== undefined && rich) attachRichButton(s, el, blockId);
      if (blockId !== undefined) attachAskButton(s, el, blockId);
    });
    if (row) out.push(row);
  } else if (kind === "ok" && rich && blockId !== undefined && s.sink?.richButton) {
    // 성공 줄은 배경을 깔지 않는다 — 단추만 얹을 **투명한** 줄 데코(손을 올린 줄을 옅은 선으로만 말한다)
    const row = s.term.registerDecoration({ marker, x: 0, width: s.term.cols, layer: "bottom" });
    row?.onRender((el) => {
      el.classList.add("aynx-block-row");
      attachRichButton(s, el, blockId);
    });
    if (row) out.push(row);
  }
  return out;
}

/** 줄 오른쪽 끝의 단추 묶음 — [리치하게 보기] · [AI에게 묻기] 가 나란히 선다(없으면 만든다) */
function rowActs(el: HTMLElement): HTMLElement {
  const have = el.querySelector<HTMLElement>(":scope > .aynx-row-acts");
  if (have) return have;
  const box = el.ownerDocument.createElement("span");
  box.className = "aynx-row-acts";
  el.append(box);
  return box;
}

/** 단추의 누름이 터미널 선택 · 포커스를 건드리지 않게 — [AI에게 묻기] 와 같은 규칙 */
function guardButton(btn: HTMLButtonElement, run: () => void) {
  const swallow = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  btn.addEventListener("mousedown", swallow);
  btn.addEventListener("mouseup", (ev) => ev.stopPropagation());
  btn.addEventListener("click", (ev) => {
    swallow(ev);
    run();
  });
}

/**
 * 블록 줄에 **[리치하게 보기]** 를 심는다 — 한 번만(`onRender` 는 스크롤마다 다시 불린다). [AI에게 묻기] 와 같은 결: 손을 올린
 * 줄에만 보이고(CSS) · 포커스를 훔치지 않고 · 누르면 그 **줄의 사각형**을 넘긴다(카드가 거기서 커진다).
 */
export function attachRichButton(s: SiState, el: HTMLElement, blockId: number) {
  const rich = s.sink?.richButton;
  if (!rich || typeof el.querySelector !== "function" || el.querySelector(".aynx-rich-view")) return;
  const acts = rowActs(el);
  const btn = el.ownerDocument.createElement("button");
  btn.type = "button";
  btn.className = "aynx-rich-view";
  btn.tabIndex = -1;
  btn.dataset.blockId = String(blockId);
  appTip(btn, rich.title());
  btn.textContent = rich.label();
  guardButton(btn, () => rich.run(blockId, el.getBoundingClientRect()));
  acts.prepend(btn);
  hideMarksWhileHovered(el);
}

/** 손을 올린 동안 같은 줄의 시간 표식을 가린다(단추가 그 자리에 선다) — 줄마다 한 번만 건다 */
function hideMarksWhileHovered(el: HTMLElement) {
  if (el.dataset.marksHidden === "1") return;
  el.dataset.marksHidden = "1";
  const marksOnRow = (): HTMLElement[] =>
    Array.from(el.closest(".xterm-screen")?.querySelectorAll<HTMLElement>(".aynx-block-mark") ?? []).filter(
      (m) => m.style.top === el.style.top,
    );
  el.addEventListener("mouseenter", () => {
    for (const m of marksOnRow()) m.classList.add("aynx-block-mark-hidden");
  });
  el.addEventListener("mouseleave", () => {
    for (const m of marksOnRow()) m.classList.remove("aynx-block-mark-hidden");
  });
}

/**
 * 실패 줄 배경에 **[AI에게 묻기] 단추**를 심는다 (docs/log/2026-09-28-ask-ai-block.md) — 한 번만.
 *
 * `onRender` 는 스크롤마다 다시 불리므로 이미 있으면 손대지 않는다. 단추는 **CSS 로만 드러난다**
 * (`.aynx-fail-row:hover .aynx-ask-ai`) — 손을 올린 줄에만 뜬다.
 *
 * 셋을 지킨다:
 * - **포커스를 훔치지 않는다** — `mousedown` 의 기본 동작을 막는다(터미널 textarea 가 포커스를 잃지 않는다).
 *   전파도 끊는다: 이 요소는 `.xterm-screen` 의 자손이라 그대로 두면 xterm 이 선택을 시작한다.
 * - **시간 표식과 겹치지 않는다** — 출력이 없는 명령은 표식(`12.4초`)이 이 줄 오른쪽 끝에 선다. 손을 올린 동안
 *   같은 줄(같은 `top`)의 표식을 가린다(`.aynx-block-mark-hidden`).
 * - **셸 통합이 없는 타일에는 없다** — 이 함수는 실패 블록(= OSC 133)이 있어야 불린다.
 */
export function attachAskButton(s: SiState, el: HTMLElement, blockId: number) {
  const ask = s.sink?.askButton;
  if (!ask || typeof el.querySelector !== "function" || el.querySelector(".aynx-ask-ai")) return;
  const doc = el.ownerDocument;
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "aynx-ask-ai";
  btn.tabIndex = -1;
  btn.dataset.blockId = String(blockId);
  appTip(btn, ask.title());
  const label = doc.createElement("span");
  label.textContent = ask.label();
  btn.append(label);
  const hint = ask.hint();
  if (hint !== "") btn.append(keycapsEl(doc, hint));
  guardButton(btn, () => ask.run(blockId, btn.getBoundingClientRect()));
  rowActs(el).append(btn);
  hideMarksWhileHovered(el);
}

/**
 * 단축키 칩 — `Keys.svelte`(`size="sm"`)와 같은 마크업을 DOM 으로 짓는다(데코는 Svelte 밖에서 선다). 모양은
 * 전역 `theme.css` 의 단축키 칩 절(조합 하나 = 알약 `.keycap-group`), 구분 글자는 눈에만 숨긴다(`.keycap-sep`).
 */
function keycapsEl(doc: Document, combo: string): HTMLElement {
  const wrap = doc.createElement("span");
  wrap.className = "keycaps sm";
  splitKeySequence(combo).forEach((keys, gi) => {
    if (gi > 0) wrap.append(sepEl(doc, " "));
    const group = doc.createElement("span");
    group.className = "keycap-group";
    keys.forEach((key, i) => {
      if (i > 0) group.append(sepEl(doc, "+"));
      const kbd = doc.createElement("kbd");
      kbd.className = "keycap";
      kbd.textContent = key;
      group.append(kbd);
    });
    wrap.append(group);
  });
  return wrap;
}

function sepEl(doc: Document, text: string): HTMLElement {
  const sep = doc.createElement("span");
  sep.className = "keycap-sep";
  sep.textContent = text;
  return sep;
}

/**
 * 글자가 터미널에서 차지하는 **칸 수** — 데코 상자의 폭을 잡는 데만 쓴다.
 *
 * 한글·CJK 는 두 칸이다(`12.4초` 는 일곱 글자가 아니라 **여덟 칸**). 정확한 wcwidth 표를
 * 들일 이유는 없다: 여기서 필요한 것은 "상자가 글자보다 좁지 않다" 뿐이고, 표식에 쓰는
 * 글자는 숫자·라틴·`초`·`·` 뿐이다.
 */
export function cellWidth(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp >= 0x1100 && cp <= 0xffe6 && !(cp >= 0x2000 && cp <= 0x2bff) ? 2 : 1;
  }
  return n;
}

/**
 * 끝난 블록의 **거터 표식** — 오른쪽 끝에 `12.4초` 한 토막을 건다 (실패면 같은 글이
 * 붉은색이다 — docs/log/2026-09-16-finish-notify-block-marks-bell.md).
 *
 * `afterSecs` 이 하한(초)이다. `0` 이하이거나 그보다 짧게 끝난 명령에는 **아무것도 안
 * 붙는다** — 성패와 무관하다(짧게 죽은 명령은 붉은 띠가 이미 말한다).
 *
 * ## 어느 줄에 다나 — 그 블록의 **마지막 출력 줄**
 *
 * 처음에는 `D` 의 줄(`outMarker`)에 걸었다. 이미 살아 있는 마커라 값이 쌌지만 **읽히는
 * 뜻이 틀렸다**: 그 줄은 곧 셸이 다음 프롬프트를 찍는 자리라, `npm run build` 의
 * `1.3초` 가 그 다음에 친 `pytest -q` 의 프롬프트 줄에 나란히 서서 **다음 명령의
 * 것처럼** 보였다 (실기 확인 2026-09-16).
 *
 * 그래서 `D` 시점의 **커서 기준 상대 마커**를 새로 하나 심는다. 오프셋은 커서 열이 정한다:
 *
 * | `D` 시점의 커서 | 오프셋 | 왜 |
 * | --- | --- | --- |
 * | 새 줄 첫 칸 (`cursorX === 0`) | `-1` | 출력이 줄바꿈으로 끝났다 — 마지막 출력 줄은 **한 줄 위**다 |
 * | 줄 중간 (`cursorX > 0`) | `0` | 줄바꿈 없이 끝났다 — 커서가 **그 마지막 출력 줄 위에** 아직 있다 |
 *
 * 대부분의 셸은 프롬프트 직전에 줄을 바꾸므로 첫 줄이 보통이고, 둘째 줄은 `printf foo`
 * 처럼 개행 없이 끝낸 출력에서 온다. 어느 쪽이든 답은 같다: **그 명령이 마지막으로 쓴 줄.**
 * 출력이 아예 없으면 그 줄은 명령 줄 자신인데, 그것도 맞다 — 표식이 자기 명령 옆에 선다.
 * (`bandLastLine` 이 `outMarker.line - 1` 을 블록의 끝으로 보는 것과 같은 셈이다.)
 *
 * `registerMarker` 가 `undefined` 를 주면(버퍼 맨 윗줄이라 `-1` 이 범위 밖) 지금까지처럼
 * `outMarker` 로 물러선다 — 그 경우 둘은 어차피 같은 줄이다.
 *
 * ## 수명은 상태 띠에 얹는다
 *
 * 데코를 `rec.decorations` 에 넣으므로 [`prune`] 이 프롬프트 마커와 함께 걷는다. **반드시
 * [`markStatus`] 뒤에 불러야 한다** — 그 함수가 배열을 비우고 새 띠로 갈아 끼우기 때문이다.
 * 새로 심은 마커는 **우리 것**이라 데코가 질 때 함께 버린다(`onDispose`) — 안 그러면 표식
 * 하나마다 마커가 하나씩 남아 명령마다 샌다.
 *
 * 선택·복사에는 **닿지 않는다**: 데코 요소는 xterm 버퍼가 아니라 그 위에 얹힌 DOM 이라
 * `.xterm` 텍스트 선택에 들지 않는다 (`pointer-events` 는 말풍선을 위해 살려 둔다).
 */
export function markBlock(s: SiState, rec: CommandRecord, block: CommandBlock, afterSecs: number) {
  const { mark: text } = blockOutcomeLabel(
    { durationMs: blockDurationMs(block), exit: block.exit, markAfterSecs: afterSecs },
    s.sink?.tr ?? koTr,
  );
  if (text === null) return;

  // 출력이 줄바꿈으로 끝났으면 커서는 다음 줄 첫 칸이다 — 마지막 출력 줄은 한 줄 위.
  const offset = s.term.buffer.active.cursorX > 0 ? 0 : -1;
  const own = s.term.registerMarker(offset) ?? null;
  const marker = own ?? rec.outMarker; // 범위 밖이면 옛 자리로 물러선다 (둘은 같은 줄이다)
  if (!marker || marker.isDisposed) {
    own?.dispose();
    return;
  }

  // 한 칸 띄워 출력 글자와 붙지 않게. 터미널이 아주 좁으면 있는 만큼만 쓴다.
  const width = Math.min(s.term.cols, cellWidth(text) + 1);
  const deco = s.term.registerDecoration({
    marker,
    x: Math.max(0, s.term.cols - width),
    width,
    layer: "top",
  });
  if (!deco) {
    own?.dispose();
    return;
  }

  const title = blockMarkTitle(block, s.sink?.tr ?? koTr);
  deco.onRender((el) => {
    // `onRender` 는 스크롤할 때마다 다시 불린다 — 대입은 멱등이라 그대로 두어도 된다.
    el.textContent = text;
    appTip(el, title);
    el.classList.add("aynx-block-mark");
    el.classList.toggle("aynx-block-mark-fail", block.exit !== null && block.exit !== 0);
  });
  // 우리가 심은 마커는 우리가 거둔다. 스크롤백 밖으로 밀려 xterm 이 먼저 걷은 경우에도
  // 이 콜백은 불리므로 이미 죽었는지 한 번 본다 (두 번 dispose 해도 무해하지만 명시한다).
  if (own) {
    deco.onDispose(() => {
      if (!own.isDisposed) own.dispose();
    });
  }
  rec.decorations.push(deco);
}
