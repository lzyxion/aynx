/**
 * 표시 트리거 — 출력에서 패턴을 찾아 하이라이트 · 링크 · 툴팁을 붙인다 (docs/log/2026-09-04-trigger-links-tooltips.md).
 *
 * 표시 계열만 — "매치하면 이 문자열을 보내라 / 실행하라" 는 만들지 않는다: 원격 출력이 로컬에서 코드를 실행시킬 수 있게 된다
 * (`echo` 가 곧 코드 실행이다). 링크는 세 겹으로 막는다 — 사람의 Ctrl+클릭 · 캡처는 `encodeURIComponent` 로 값에만 ·
 * `SAFE_PROTOCOLS` 밖의 스킴은 열지 않는다.
 *
 * 하이라이트는 커서가 지나간 줄에만 매치한다 — 원격 출력은 임의의 경계에서 쪼개져 온다(docs/verification/xterm.md §3).
 * 소급 적용은 하지 않는다 — 스크롤백 전체를 다시 훑는 것은 설정에서 한 글자 칠 때마다 돌릴 비용이 아니다.
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import type { IBufferLine, IDecoration, ILink, IMarker, Terminal } from "@xterm/xterm";
// 타입만 빌린다 — vitest 가 node 에서 그대로 돌리는 모듈이라 룬 모듈을 값으로 들이면 안 된다
import type { Tr } from "$lib/session";

/** Rust `Trigger` 와 1:1 */
export interface Trigger {
  pattern: string;
  fg?: string | null;
  bg?: string | null;
  /** `$0` · `$1`… 은 `encodeURIComponent` 한 캡처로 치환된다 */
  url?: string | null;
  /** 치환 규칙은 `url` 과 같되 인코딩하지 않는다 */
  tooltip?: string | null;
  enabled: boolean;
}

export interface CompiledTrigger {
  source: string;
  /** `g` 플래그 — `lastIndex` 는 쓰는 쪽이 매번 되돌린다 */
  re: RegExp;
  fg: string | null;
  bg: string | null;
  url: string | null;
  tooltip: string | null;
}

export interface TriggerError {
  index: number;
  pattern: string;
  message: string;
}

/** 좌표는 문자열 인덱스다(셀 좌표가 아니다) · `[start, end)` */
export interface TriggerMatch {
  start: number;
  end: number;
  fg: string | null;
  bg: string | null;
  url: string | null;
  tooltip: string | null;
  /** 템플릿이 있는 트리거에서만 채운다 — 하이라이트 경로는 줄마다 도는 자리다 */
  groups?: string[];
}

/** 데코레이션 하나가 DOM 원소 하나라 `.` 같은 패턴이면 프레임이 죽는다 — 넘치는 매치는 버린다 */
const MAX_MATCHES_PER_LINE = 32;

// ── 순수 부분 — 컴파일과 매칭 ──

/** 백엔드 `fold_empty` 와 같은 규칙 */
function color(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * 없는 캡처는 빈 문자열로 지운다 — 오타 `$9` 가 URL 에 글자 그대로 실려 나가는 편이 더 나쁘다.
 * `encode` 가 링크의 안전선이다 — 원격이 보낸 캡처가 스킴 · 호스트를 갈아치울 수 없다. 툴팁은 `textContent` 로만 넣는다.
 */
export function expandTemplate(
  template: string,
  groups: readonly (string | undefined)[],
  encode: boolean,
): string {
  return template.replace(/\$(\$|\d{1,2})/g, (_, tail: string) => {
    if (tail === "$") return "$";
    const v = groups[Number(tail)];
    if (v === undefined) return "";
    return encode ? encodeURIComponent(v) : v;
  });
}

/** `file:` · 앱 커스텀 스킴이 들어가면 클릭 한 번이 로컬 프로그램을 띄운다 — 브라우저가 다루는 것으로 좁힌다 */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  return SAFE_PROTOCOLS.has(u.protocol) ? u.href : null;
}

/** 잘못된 정규식이 하나 있다고 나머지가 죽지 않는다 */
export function compileTriggers(list: readonly Trigger[] | null | undefined): {
  compiled: CompiledTrigger[];
  errors: TriggerError[];
} {
  const compiled: CompiledTrigger[] = [];
  const errors: TriggerError[] = [];
  if (!Array.isArray(list)) return { compiled, errors };

  list.forEach((t, index) => {
    const pattern = typeof t?.pattern === "string" ? t.pattern.trim() : "";
    if (pattern === "") return;
    let re: RegExp;
    try {
      // `g` 는 필수다 — `exec` 루프가 `lastIndex` 로 줄을 훑는다
      re = new RegExp(pattern, "g");
    } catch (e) {
      errors.push({
        index,
        pattern,
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    // 오류 목록에는 꺼진 항목도 넣는다 — 고치기 전에는 켜도 안 먹는다는 것을 알려야 한다
    if (!t.enabled) return;
    compiled.push({
      source: pattern,
      re,
      fg: color(t.fg),
      bg: color(t.bg),
      url: color(t.url),
      tooltip: color(t.tooltip),
    });
  });

  return { compiled, errors };
}

/** WebGL/캔버스 렌더러에서는 데코레이션 DOM 이 늘 글자 위라 불투명 배경이면 글자가 통째로 사라진다 */
const BG_ALPHA = 0.45;

/** 3 · 6자리 hex 만 손댄다 — 사용자가 적은 `rgba` · `hsl` · 이름 색 · 8자리 hex 의 알파는 덮어쓰지 않는다 */
export function translucent(color: string | null, alpha = BG_ALPHA): string {
  if (color === null) return "";
  const hex = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const body = m[1];
  const [r, g, b] =
    body.length === 3
      ? [...body].map((c) => Number.parseInt(c + c, 16))
      : [0, 2, 4].map((i) => Number.parseInt(body.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function overlaps(taken: readonly TriggerMatch[], start: number, end: number): boolean {
  return taken.some((m) => start < m.end && m.start < end);
}

/**
 * 겹치면 목록에서 먼저 나온 트리거가 이긴다 — 둘 다 그리면 렌더 순서에 따라 같은 줄이 매번 다르게 보인다.
 * 부르는 쪽이 계열(색 · 템플릿)별로 걸러 넘기므로 겹침 판정도 같은 계열 안에서만 일어난다.
 */
export function matchLine(
  text: string,
  compiled: readonly CompiledTrigger[],
  limit = MAX_MATCHES_PER_LINE,
): TriggerMatch[] {
  const out: TriggerMatch[] = [];
  if (text === "" || compiled.length === 0) return out;

  for (const t of compiled) {
    t.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = t.re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) {
        // 길이 0 매치는 `lastIndex` 를 움직이지 않아 무한 루프가 된다
        t.re.lastIndex = start + 1;
        continue;
      }
      if (!overlaps(out, start, end)) {
        out.push({
          start,
          end,
          fg: t.fg,
          bg: t.bg,
          url: t.url,
          tooltip: t.tooltip,
          groups: t.url !== null || t.tooltip !== null ? [...m] : undefined,
        });
        if (out.length >= limit) {
          out.sort((a, b) => a.start - b.start);
          return out;
        }
      }
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

// ── 부착 — xterm 마커 · 데코레이션 ──

/** 나머지는 다음 rAF 로 — 따라잡지 못하면 현재 위치에서 다시 시작한다(하이라이트를 놓치는 것이 프레임을 놓치는 것보다 낫다) */
const MAX_LINES_PER_TICK = 200;

/** 스크롤백이 아주 크면 xterm 이 정리하기 전에 DOM 원소가 수만 개가 될 수 있다 */
const MAX_DECORATIONS = 800;

export interface DecoratedLine {
  marker: Pick<IMarker, "line" | "isDisposed" | "dispose">;
  decorations: Pick<IDecoration, "dispose">[];
}

/**
 * 마커는 줄이 빈 칸이 되어도 살아 `clear` 뒤 빈 줄에 하이라이트가 남는다 — `shell-integration/erase.ts` 와 판정을 맞춘다
 * (docs/log/2026-10-05-trigger-highlight-clear.md).
 * Windows ConPTY 의 `clear` 는 `ED 2` 없이 `ED 3` 뒤 `CSI K` 로 줄을 지운다 — 그래서 `ED 3` 은 다음 쓰기 뒤 빈 줄을 본다(`checkBlank`).
 * `ED 0` · `ED 1` 은 보지 않는다 — 진행 막대 · TUI 의 흔한 모양이다.
 */
export function eraseEffect(
  mode: number | undefined,
  baseY: number,
  rows: number,
  scrollOnErase: boolean,
): { hit: ((line: number) => boolean) | null; checkBlank: boolean } {
  if (mode === 2 && !scrollOnErase) {
    return { hit: (line) => line >= baseY && line < baseY + rows, checkBlank: false };
  }
  if (mode === 3) return { hit: (line) => line < baseY, checkBlank: true };
  return { hit: null, checkBlank: false };
}

export function dropLines(live: DecoratedLine[], hit: (line: number) => boolean): number {
  let n = 0;
  for (let i = live.length - 1; i >= 0; i--) {
    const item = live[i];
    if (!item.marker.isDisposed && !hit(item.marker.line)) continue;
    for (const d of item.decorations) d.dispose();
    item.marker.dispose();
    live.splice(i, 1);
    n++;
  }
  return n;
}

export interface TriggerHighlighter {
  /** 기존 하이라이트는 전부 사라지고 이후 출력부터 새 목록이 적용된다 */
  setTriggers(list: readonly Trigger[] | null | undefined): void;
  dispose(): void;
}

/** 지연이 없으면 마우스가 스쳐 지나가는 동안 팝오버가 연달아 깜빡인다 */
const TOOLTIP_DELAY_MS = 300;

const TOOLTIP_GAP = 10;

/** 보이는 글자만 자른다 — 여는 URL 은 온전한 값을 쓴다 */
const TOOLTIP_MAX_CHARS = 300;

function clip(s: string): string {
  return s.length <= TOOLTIP_MAX_CHARS ? s : `${s.slice(0, TOOLTIP_MAX_CHARS)}…`;
}

/**
 * 문자열 인덱스 → 셀 x — 넓은 글자는 한 문자로 두 칸, 결합 문자 · 이모지는 한 칸에 여러 문자라 둘이 다르다.
 * 길이는 `문자열 길이 + 1` 이다 — 마지막 원소가 줄 끝 경계라 `end` 를 그대로 넣을 수 있다.
 */
export function cellColumns(line: IBufferLine): number[] {
  const map: number[] = [];
  const cell = line.getCell(0);
  if (!cell) return [0];
  for (let x = 0; x < line.length; x++) {
    if (!line.getCell(x, cell)) continue;
    // 폭 0 = 넓은 글자의 뒷칸 — `translateToString` 이 건너뛰므로 여기서도 건너뛴다
    if (cell.getWidth() === 0) continue;
    const chars = cell.getChars();
    // 빈 셀은 공백 한 글자로 나온다
    const len = chars.length === 0 ? 1 : chars.length;
    for (let i = 0; i < len; i++) map.push(x);
  }
  map.push(line.length);
  return map;
}

/** 우클릭 메뉴가 읽는 호버 상태 — 우클릭 순간엔 `leave` 가 아직 오지 않아 마지막 값이 곧 답이다 · 툴팁만인 매치는 알리지 않는다 */
export type TriggerLinkHover = (url: string | null) => void;

/** `t.open()` 뒤에 부를 것 — 데코레이션은 렌더러가 서 있어야 그려진다 */
export function attachTriggers(
  term: Terminal,
  tr: Tr,
  onlinkhover?: TriggerLinkHover,
): TriggerHighlighter {
  /** 색이 있는 트리거만 */
  let compiled: CompiledTrigger[] = [];
  /** 템플릿(URL · 툴팁)이 있는 트리거만 */
  let interactive: CompiledTrigger[] = [];
  /** 마지막으로 검사를 마친 줄 — 마커라서 버퍼가 스크롤해도 따라간다 */
  let frontier: IMarker | null = null;
  /** 칠할 트리거가 없으면 걸지 않는다 */
  let writes: { dispose(): void } | null = null;
  let raf = 0;
  const live: DecoratedLine[] = [];
  let disposed = false;
  let blankCheckPending = false;

  // 기본 처리 앞에서 엿보고(`false`) 지우기는 그대로 돌린다
  const erase = term.parser.registerCsiHandler({ final: "J" }, (params) => {
    if (live.length === 0 || term.buffer.active.type !== "normal") return false;
    const p = params[0];
    const fx = eraseEffect(
      typeof p === "number" ? p : undefined,
      term.buffer.active.baseY,
      term.rows,
      !!term.options.scrollOnEraseInDisplay,
    );
    if (fx.hit) dropLines(live, fx.hit);
    if (fx.checkBlank) blankCheckPending = true;
    return false;
  });

  function dropBlankViewportLines() {
    blankCheckPending = false;
    const buf = term.buffer.active;
    if (live.length === 0 || buf.type !== "normal") return;
    const top = buf.baseY;
    dropLines(
      live,
      (line) =>
        line >= top &&
        line < top + term.rows &&
        (buf.getLine(line)?.translateToString(true) ?? "") === "",
    );
  }

  function clearDecorations() {
    for (const item of live) {
      for (const d of item.decorations) d.dispose();
      item.marker.dispose();
    }
    live.length = 0;
  }

  function prune() {
    while (live.length > 0 && live[0].marker.isDisposed) {
      const dead = live.shift();
      for (const d of dead?.decorations ?? []) d.dispose();
    }
    while (live.length > MAX_DECORATIONS) {
      const dead = live.shift();
      for (const d of dead?.decorations ?? []) d.dispose();
      dead?.marker.dispose();
    }
  }

  /** "여기까지는 검사한 것으로 친다" — 소급 적용을 하지 않는다는 뜻이다 */
  function resetFrontier() {
    frontier?.dispose();
    frontier =
      disposed || term.buffer.active.type !== "normal" ? null : (term.registerMarker(0) ?? null);
  }

  function decorateLine(y: number, cursorAbs: number) {
    const line = term.buffer.active.getLine(y);
    if (!line) return;
    // `false` = 오른쪽 공백을 남긴다 — 줄 전체가 있어야 `\b` 가 줄 끝에서도 성립한다
    const text = line.translateToString(false);
    const matches = matchLine(text, compiled);
    if (matches.length === 0) return;

    const columns = cellColumns(line);
    const marker = term.registerMarker(y - cursorAbs);
    if (!marker) return;

    const decorations: IDecoration[] = [];
    for (const m of matches) {
      const x = columns[m.start];
      const endX = columns[m.end];
      if (x === undefined || endX === undefined || endX <= x || x >= term.cols) continue;
      const width = Math.min(endX - x, term.cols - x);

      if (m.fg === null) {
        // 배경만 — `bottom` 층만으로는 부족해 반투명으로 깐다(`BG_ALPHA`)
        const d = term.registerDecoration({ marker, x, width, layer: "bottom" });
        if (!d) continue;
        d.onRender((el) => {
          el.classList.add("aynx-trigger-bg");
          el.style.backgroundColor = translucent(m.bg);
        });
        decorations.push(d);
        continue;
      }

      // 데코레이션은 셀의 색을 바꾸지 못한다 — 불투명 배경으로 원래 글자를 가리고 같은 글자를 새 색으로 찍는다
      const matched = text.slice(m.start, m.end);
      const d = term.registerDecoration({ marker, x, width, layer: "top" });
      if (!d) continue;
      d.onRender((el) => {
        el.classList.add("aynx-trigger-text");
        el.textContent = matched;
        el.style.color = m.fg ?? "";
        el.style.backgroundColor = m.bg ?? "var(--term-bg)";
        // 상속에 기대면 렌더러에 따라 어긋난다
        el.style.fontFamily = term.options.fontFamily ?? "";
        el.style.fontSize = `${term.options.fontSize ?? 14}px`;
      });
      decorations.push(d);
    }

    if (decorations.length === 0) {
      marker.dispose();
      return;
    }
    live.push({ marker, decorations });
  }

  function schedule() {
    if (raf !== 0 || disposed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      scan();
    });
  }

  function scan() {
    if (disposed || compiled.length === 0) return;
    const buf = term.buffer.active;
    // 대체 화면에는 "확정된 줄" 이라는 개념이 없다
    if (buf.type !== "normal") return;

    const cursorAbs = buf.baseY + buf.cursorY;
    const alive = frontier !== null && !frontier.isDisposed;
    const from = alive ? Math.min(frontier!.line + 1, cursorAbs) : cursorAbs;

    const to = Math.min(cursorAbs, from + MAX_LINES_PER_TICK);
    for (let y = from; y < to; y++) decorateLine(y, cursorAbs);

    // 한 줄도 못 읽었어도 다시 세운다 — 마커를 잃은 채로 두면 `from` 이 영원히 커서에 붙어 스캔이 멈춘다
    if (to > from || !alive) {
      frontier?.dispose();
      frontier = term.registerMarker(Math.max(0, to - 1) - cursorAbs) ?? null;
    }
    if (to > from) prune();
    if (to < cursorAbs) schedule();
  }

  // ── 툴팁 팝오버 ── 데코레이션을 쓰지 않는다 — 지나간 줄 · 대체 화면에는 없다.

  let tip: HTMLDivElement | null = null;
  let tipText: HTMLDivElement | null = null;
  let tipUrl: HTMLDivElement | null = null;
  let tipTimer = 0;
  const tipOff: { dispose(): void }[] = [];

  function ensureTip(): HTMLDivElement | null {
    if (tip) return tip;
    const host = term.element;
    if (!host) return null;
    tip = document.createElement("div");
    // `xterm-hover` 는 xterm 과의 약속이다(그 위의 마우스 이벤트가 링크 판정에서 빠져나가지 않는다) · CSS 는 Terminal.svelte
    tip.className = "xterm-hover aynx-trigger-tip";
    tip.setAttribute("role", "tooltip");
    tip.style.display = "none";
    tipText = document.createElement("div");
    tipText.className = "aynx-tip-text";
    tipUrl = document.createElement("div");
    tipUrl.className = "aynx-tip-url";
    tip.append(tipText, tipUrl);
    host.appendChild(tip);
    return tip;
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = 0;
    if (tip) tip.style.display = "none";
  }

  function placeTip(el: HTMLDivElement, x: number, y: number) {
    const host = term.element;
    if (!host) return;
    const box = host.getBoundingClientRect();
    // 크기를 재려면 먼저 보여야 한다
    el.style.display = "block";
    el.style.left = "0px";
    el.style.top = "0px";
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const px = x - box.left;
    const py = y - box.top;
    const left = Math.max(4, Math.min(px - w / 2, Math.max(4, box.width - w - 4)));
    const above = py - TOOLTIP_GAP - h;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(above >= 4 ? above : py + TOOLTIP_GAP * 2)}px`;
  }

  function scheduleTip(ev: MouseEvent, note: string | null, href: string | null) {
    hideTip();
    if (note === null && href === null) return;
    const x = ev.clientX;
    const y = ev.clientY;
    tipTimer = window.setTimeout(() => {
      tipTimer = 0;
      const el = ensureTip();
      if (!el || !tipText || !tipUrl || disposed) return;
      // `textContent` 만 쓴다 — 원격이 보낸 캡처가 섞여 들어온다
      tipText.textContent = note === null ? "" : clip(note);
      tipText.hidden = note === null;
      tipUrl.textContent = href === null ? "" : tr("pane.term.link.hint", { url: clip(href) });
      tipUrl.hidden = href === null;
      placeTip(el, x, y);
    }, TOOLTIP_DELAY_MS);
  }

  // ── 링크 프로바이더 ── 프로바이더 순서가 곧 우선순위다 — `Terminal.svelte` 는 이것을 web-links 애드온보다 먼저 건다.

  const links = term.registerLinkProvider({
    provideLinks(bufferLine, callback) {
      if (disposed || interactive.length === 0) {
        callback(undefined);
        return;
      }
      const line = term.buffer.active.getLine(bufferLine - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(false);
      const matches = matchLine(text, interactive);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }

      const columns = cellColumns(line);
      const out: ILink[] = [];
      for (const m of matches) {
        const x = columns[m.start];
        const endX = columns[m.end];
        if (x === undefined || endX === undefined || endX <= x) continue;
        const matched = text.slice(m.start, m.end);
        const groups = m.groups ?? [matched];
        const href = m.url === null ? null : safeUrl(expandTemplate(m.url, groups, true));
        const note = m.tooltip === null ? null : expandTemplate(m.tooltip, groups, false);
        if (href === null && note === null) continue;

        out.push({
          // xterm 의 범위는 1부터이고 `end.x` 는 포함이다 — 0부터의 열린 끝이 그대로 1부터의 닫힌 끝이 된다
          range: { start: { x: x + 1, y: bufferLine }, end: { x: endX, y: bufferLine } },
          text: matched,
          decorations: { pointerCursor: href !== null, underline: href !== null },
          activate(ev) {
            if (href === null) return;
            // Ctrl(⌘)+클릭에서만 연다 — 원격이 흘린 글자가 맨 클릭 한 번에 브라우저를 열면 안 된다
            if (!ev.ctrlKey && !ev.metaKey) return;
            hideTip();
            void openUrl(href).catch((e: unknown) => {
              console.error(`[aynx] 트리거 링크를 열지 못했습니다: ${href}`, e);
            });
          },
          hover(ev) {
            scheduleTip(ev, note, href);
            // 툴팁 지연과 달리 즉시 알린다 — 마우스를 올리자마자 우클릭하는 것이 평범한 사용이다
            if (href !== null) onlinkhover?.(href);
          },
          leave() {
            hideTip();
            if (href !== null) onlinkhover?.(null);
          },
        });
      }
      callback(out.length > 0 ? out : undefined);
    },
  });

  tipOff.push(term.onScroll(() => hideTip()));
  {
    const host = term.element;
    if (host) {
      const onLeave = () => {
        hideTip();
        // 빠르게 스쳐 나가면 `leave` 가 안 올 수 있다 — 남은 상태로 메뉴가 "링크 열기" 를 세우면 거짓말이다
        onlinkhover?.(null);
      };
      host.addEventListener("mouseleave", onLeave);
      tipOff.push({ dispose: () => host.removeEventListener("mouseleave", onLeave) });
    }
  }

  return {
    setTriggers(list) {
      if (disposed) return;
      const all = compileTriggers(list).compiled;
      compiled = all.filter((t) => t.fg !== null || t.bg !== null);
      interactive = all.filter((t) => t.url !== null || t.tooltip !== null);
      clearDecorations();
      resetFrontier();
      hideTip();
      if (compiled.length === 0) {
        writes?.dispose();
        writes = null;
        return;
      }
      writes ??= term.onWriteParsed(() => {
        if (blankCheckPending) dropBlankViewportLines();
        scan();
      });
    },

    dispose() {
      disposed = true;
      onlinkhover?.(null); // 떠나는 알림 없이 사라질 수 있다
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      writes?.dispose();
      writes = null;
      erase.dispose();
      links.dispose();
      for (const off of tipOff) off.dispose();
      tipOff.length = 0;
      hideTip();
      tip?.remove();
      tip = null;
      tipText = null;
      tipUrl = null;
      clearDecorations();
      frontier?.dispose();
      frontier = null;
      compiled = [];
      interactive = [];
    },
  };
}
