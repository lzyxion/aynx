// 숨은 터미널의 DOM 렌더러가 행을 그리지 않게 하는 문 — xterm 6.0.0 인스턴스 패치.
// 숨은(`display:none`) DOM 렌더러는 WebGL dispose 뒤의 resize 와 출력 스크롤의 선택 갱신(일시정지를 지나친다)으로 모든 행을 다시 그리고,
// `WidthCache` 가 0 폭을 캐시하지 않아 칸마다 강제 재계산한다 — 탭 전환마다 수 초 멈춘다(`scripts/dev/hidden-tab-measure-harness.mjs`).
// 숨은 동안 `renderRows` 만 건너뛰고 보일 때 한 번 다 그린다 — 버퍼 · 크기 · 선택 모형은 그대로 움직인다.
// 버린 안: 숨길 때 순서 바꾸기(숨은 탭 출력은 그대로) · 0 폭 대체/캐시(보일 때 글자 간격이 틀어진다) · 숨겨도 WebGL 유지(컨텍스트 상한 방어를 깬다).
// 모양이 6.0.0 과 다르면 손대지 않는다 — xterm 이 숨은 터미널 그리기를 멈추면 이 파일을 걷는다.
import type { Terminal } from "@xterm/xterm";

/** 6.0.0 `DomRenderer` 의 내부 모양 — 공개 API 가 아니다 */
export interface DomRendererLike {
  renderRows(start: number, end: number): void;
  _widthCache: unknown;
  _setDefaultSpacing?: () => void;
}

/** 6.0.0 `CoreBrowserTerminal` 의 내부 모양 */
export interface CoreLike {
  _createRenderer(): unknown;
  _renderService?: { _renderer?: { value?: unknown } };
}

export interface HiddenRenderGate {
  /** **WebGL 을 떼기 전에** 부른다 — 애드온 dispose 의 resize 가 그리는 것부터 막는다 */
  hide(): void;
  /** 렌더러(WebGL/DOM)를 정한 **뒤에** 부른다 */
  show(): void;
  readonly hidden: boolean;
}

/** WebGL 렌더러에는 글자 폭 캐시가 없다 */
export function looksLikeDomRenderer(r: unknown): r is DomRendererLike {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return typeof o.renderRows === "function" && typeof o._widthCache === "object" && o._widthCache !== null;
}

function looksLikeCore(c: unknown): c is CoreLike {
  return typeof c === "object" && c !== null && typeof (c as Record<string, unknown>)._createRenderer === "function";
}

interface Gated {
  skipped: boolean;
  bornHidden: boolean;
}

/** WebGL 을 뗄 때마다 `_createRenderer` 가 새 DOM 렌더러를 만드므로 그 함수도 감싸 새것에 문을 단다. 모양이 다르면 `null`. */
export function installGateOnCore(core: unknown, refresh: () => void, startHidden: boolean): HiddenRenderGate | null {
  if (!looksLikeCore(core)) return null;
  let hidden = startHidden;
  const states = new WeakMap<object, Gated>();

  const gate = (r: unknown): void => {
    if (!looksLikeDomRenderer(r) || states.has(r)) return;
    const st: Gated = { skipped: false, bornHidden: hidden };
    states.set(r, st);
    const render = r.renderRows;
    r.renderRows = function (start: number, end: number) {
      if (hidden) {
        st.skipped = true;
        return;
      }
      render.call(this, start, end);
    };
  };

  const create = core._createRenderer;
  core._createRenderer = function (this: unknown) {
    const r = create.call(this);
    gate(r);
    return r;
  };
  gate(core._renderService?._renderer?.value);

  return {
    get hidden() {
      return hidden;
    },
    hide() {
      hidden = true;
    },
    show() {
      if (!hidden) return;
      hidden = false;
      const r = core._renderService?._renderer?.value;
      if (!looksLikeDomRenderer(r)) return; // WebGL 이 섰다 — setRenderer 가 이미 다 그린다
      const st = states.get(r);
      if (!st) return;
      // 숨은 채 생긴 렌더러는 생성자의 기본 간격을 0 폭으로 쟀다(글자가 벌어진다) — 지금 다시 잰다.
      let redraw = st.skipped;
      st.skipped = false;
      if (st.bornHidden) {
        st.bornHidden = false;
        redraw = true;
        try {
          r._setDefaultSpacing?.();
        } catch {
          /* 모양이 다르다 — 간격은 다음 글꼴 · 크기 변경 때 맞춰진다 */
        }
      }
      if (redraw) refresh();
    },
  };
}

/** `term.open()` 뒤에 부른다 */
export function installHiddenRenderGate(term: Terminal, startHidden: boolean): HiddenRenderGate | null {
  const core = (term as unknown as { _core?: unknown })._core;
  const g = installGateOnCore(core, () => term.refresh(0, term.rows - 1), startHidden);
  if (!g) console.warn("[aynx] xterm 렌더러 모양이 달라 숨은 터미널 그리기 문을 건너뜁니다");
  return g;
}
