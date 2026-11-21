// **내부 전용** — 프롬프트 줄의 데코(상태 띠 · 실패 줄 · 단추 · 시간 표식). 데코의 수명은 부르는 쪽이 쥔다.

import type { IDecoration, IMarker } from "@xterm/xterm";
import { blockDurationMs, type CommandBlock } from "$lib/block-history";
import { blockMarkTitle, blockOutcomeLabel } from "$lib/finish-notify";
import { splitKeySequence } from "$lib/keycaps";
import { koTr, type CommandRecord, type SiState } from "./state";
import type { PaneStatus } from "./types";

/** `.xterm` 안쪽은 앱 툴팁 층이 비켜 가므로 `data-app-tooltip` 로 앱 말풍선을 받는다. */
function appTip(el: HTMLElement, text: string) {
  el.dataset.appTooltip = "";
  el.title = text;
}

/** 명령당 띠 하나 — 이전 상태의 데코를 걷고 갈아 끼운다. 띠는 거터 칸이라 불투명이어도 되고 줄 배경은 반투명이어야 한다(WebGL). */
export function markStatus(
  s: SiState,
  rec: CommandRecord,
  kind: PaneStatus,
  title = "",
  blockId?: number,
  rich = false,
) {
  if (rec.promptMarker.isDisposed) return;
  for (const d of rec.decorations) d.dispose();
  rec.decorations.length = 0;
  rec.decorations.push(...decorate(s, rec.promptMarker, kind, title, blockId, rich));
}

/**
 * 수명은 부르는 쪽이 쥔다. `markStatus` 와 `restoreMarkers` 가 같은 코드로 그린다 — 갈리면 넘어온 타일의 실패 표시만 달라진다.
 * `title` 은 붉은 띠에 건다 — 시간 표식은 임계를 넘긴 명령에만 서서, 표식에만 걸면 짧게 죽은 명령의 종료 코드를 볼 길이 없다.
 */
export function decorate(
  s: SiState,
  marker: IMarker,
  kind: PaneStatus,
  title = "",
  blockId?: number,
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

  // 줄 배경은 실패만 — 성공까지 깔면 스크롤이 얼룩덜룩해져 실패가 묻힌다. 텍스트 위라 CSS 에서 반투명이다.
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
    const row = s.term.registerDecoration({ marker, x: 0, width: s.term.cols, layer: "bottom" });
    row?.onRender((el) => {
      el.classList.add("aynx-block-row");
      attachRichButton(s, el, blockId);
    });
    if (row) out.push(row);
  }
  return out;
}

function rowActs(el: HTMLElement): HTMLElement {
  const have = el.querySelector<HTMLElement>(":scope > .aynx-row-acts");
  if (have) return have;
  const box = el.ownerDocument.createElement("span");
  box.className = "aynx-row-acts";
  el.append(box);
  return box;
}

/** 누름이 터미널 선택 · 포커스를 건드리지 않게 — `.xterm-screen` 자손이라 전파를 두면 xterm 이 선택을 시작한다. */
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

/** 실패 줄의 [AI에게 묻기] — `onRender` 가 스크롤마다 불려 한 번만 심는다 (docs/log/2026-09-28-ask-ai-block.md). */
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

/** `Keys.svelte`(`size="sm"`)와 같은 마크업을 DOM 으로 — 데코는 Svelte 밖에서 선다. */
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

/** 데코 상자 폭용 칸 수 — 표식 글자(숫자 · 라틴 · `초` · `·`)만 맞으면 된다, wcwidth 표는 들이지 않는다. */
export function cellWidth(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp >= 0x1100 && cp <= 0xffe6 && !(cp >= 0x2000 && cp <= 0x2bff) ? 2 : 1;
  }
  return n;
}

/**
 * 끝난 블록의 시간 표식 — `D` 줄이 아니라 그 블록의 마지막 출력 줄에 단다(`D` 줄은 다음 프롬프트 자리라 다음 명령의 것처럼 보인다).
 * 반드시 `markStatus` 뒤에 부른다 — 그 함수가 `rec.decorations` 를 비운다. 새로 심은 마커는 데코가 질 때 함께 버린다 — 안 그러면 명령마다 샌다.
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
    el.textContent = text;
    appTip(el, title);
    el.classList.add("aynx-block-mark");
    el.classList.toggle("aynx-block-mark-fail", block.exit !== null && block.exit !== 0);
  });
  // 우리가 심은 마커는 우리가 거둔다 — xterm 이 먼저 걷은 경우에도 이 콜백은 불린다.
  if (own) {
    deco.onDispose(() => {
      if (!own.isDisposed) own.dispose();
    });
  }
  rec.decorations.push(deco);
}
