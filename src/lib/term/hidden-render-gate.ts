// 숨은 터미널의 DOM 렌더러가 행을 그리지 않게 하는 문 — xterm 6.0.0 인스턴스 패치(탭 전환 멈춤, 2026-10-17).
//
// 원인(릴리스 앱 CDP 프로필 · 헤드리스 계측 `scripts/dev/hidden-tab-measure-harness.mjs`): 숨은 탭(`display:none`)의
// 터미널은 DOM 렌더러로 산다(WebGL 은 보이는 타일에만 — `renderer-addons.ts`). 그런데 xterm 의 DOM 렌더러는 두 길로
// **숨은 채 모든 행을 다시 그린다**:
//   ① WebGL 애드온의 dispose 가 새 DOM 렌더러를 세우고 곧바로 `renderService.handleResize` 를 부른다 → (일시정지면
//      유휴 작업으로 미뤄) `DomRenderer.handleResize` → `handleSelectionChanged` → `renderRows(0, rows-1)` — 탭을 숨길 때마다.
//   ② 출력이 화면을 밀면(스크롤) `SelectionService.refresh` 가 rAF 로 `renderService.handleSelectionChanged` 를 부르는데,
//      이 길은 렌더러 일시정지를 **지나치지 않고 곧장** `DomRenderer.handleSelectionChanged` → `renderRows` 다 — 숨은 탭에
//      출력이 올 때마다(백그라운드 AI 타일).
// 행을 그릴 때 글자마다 `WidthCache.get` → `offsetWidth` 로 재는데, `display:none` 이라 0 이 나오고 xterm 은 0 을 캐시하지
// 않아(`if (width > 0)`) **모든 칸을 매번 다시 잰다** — 칸마다 textContent 쓰기 + 강제 스타일 재계산. 릴리스 앱에서 한 번에
// ~7000번 · 번당 ~1ms, 탭 전환마다 2~8초 멈춤이었다.
//
// 고친 것: 이 터미널이 숨은 동안(`Terminal.svelte` 의 가시성 `$effect` 가 정한다) DOM 렌더러의 `renderRows` 를 건너뛰고,
// 다시 보일 때 한 번 다 그린다(`term.refresh`). 건너뛴 것은 화면 그림뿐이다 — 버퍼 · 크기 · 선택 모형은 그대로 움직인다.
// 새 DOM 렌더러는 WebGL 을 뗄 때마다 `core._createRenderer()` 로 다시 생기므로 그 함수를 인스턴스에서 감싸 새것에도 문을 단다.
// 숨은 채 세운 렌더러는 생성자에서 기본 글자 간격('W' 폭)을 0 으로 재어 틀린 값을 들고 있으니, 보일 때 다시 잰다.
//
// 버린 후보:
//   - 숨길 때의 순서만 바꾸기(레이아웃이 살아 있을 때 WebGL 떼기) — ①의 한 번은 줄지만 ②(숨은 탭 출력)는 그대로다.
//   - WidthCache 가 0 을 받으면 셀 폭으로 대신 · 0 도 캐시 — 재기는 멎지만 숨은 탭 출력마다 모든 행의 DOM 을 다시 짓는 일은
//     남고, 0/대체 값이 보일 때 남아 글자 간격이 틀어진다.
//   - 숨겨도 WebGL 유지 — 컨텍스트 상한 방어(`renderer-addons.ts` 머리말)를 깬다.
// 모양이 6.0.0 과 다르면(업그레이드) 손대지 않는다 — 그때는 상위가 고쳤는지 보고 이 파일을 걷거나 맞춘다.
import type { Terminal } from "@xterm/xterm";

/** 6.0.0 `DomRenderer` 에서 쓰는 내부 모양 — 공개 API 가 아니다 */
export interface DomRendererLike {
  renderRows(start: number, end: number): void;
  _widthCache: unknown;
  _setDefaultSpacing?: () => void;
}

/** 6.0.0 `CoreBrowserTerminal` 에서 쓰는 내부 모양 */
export interface CoreLike {
  _createRenderer(): unknown;
  _renderService?: { _renderer?: { value?: unknown } };
}

export interface HiddenRenderGate {
  /** 숨긴다 — **WebGL 을 떼기 전에** 부른다(애드온 dispose 의 resize 가 그리는 것부터 막는다) */
  hide(): void;
  /** 다시 보인다 — 렌더러(WebGL/DOM)를 정한 **뒤에** 부른다. 숨은 동안 그리지 못한 DOM 렌더러면 다시 그린다 */
  show(): void;
  readonly hidden: boolean;
}

/** DOM 렌더러인가 — 행을 그리는 함수와 글자 폭 캐시가 있을 때만(WebGL 렌더러에는 캐시가 없다) */
export function looksLikeDomRenderer(r: unknown): r is DomRendererLike {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return typeof o.renderRows === "function" && typeof o._widthCache === "object" && o._widthCache !== null;
}

function looksLikeCore(c: unknown): c is CoreLike {
  return typeof c === "object" && c !== null && typeof (c as Record<string, unknown>)._createRenderer === "function";
}

/** 렌더러 하나의 문 상태 — 숨은 동안 건너뛴 그림이 있는가 · 숨은 채 생겼는가 */
interface Gated {
  skipped: boolean;
  bornHidden: boolean;
}

/**
 * 코어에 문을 단다(순수 — xterm 없이 시험한다). 지금 렌더러와 앞으로 `_createRenderer` 가 만들 DOM 렌더러 모두.
 * 모양이 다르면 `null`.
 *
 * @param refresh 다시 보일 때 화면 전체를 다시 그리는 길(`term.refresh(0, rows - 1)`)
 */
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
      // 숨은 채 생긴 렌더러는 생성자의 기본 간격을 0 폭으로 쟀다(간격 = 칸 폭 — 글자가 벌어진다). 지금 다시 잰다.
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

/** `term.open()` 뒤에 부른다. 못 찾거나 모양이 다르면 그대로 두고 `null` */
export function installHiddenRenderGate(term: Terminal, startHidden: boolean): HiddenRenderGate | null {
  const core = (term as unknown as { _core?: unknown })._core;
  const g = installGateOnCore(core, () => term.refresh(0, term.rows - 1), startHidden);
  if (!g) console.warn("[aynx] xterm 렌더러 모양이 달라 숨은 터미널 그리기 문을 건너뜁니다");
  return g;
}
