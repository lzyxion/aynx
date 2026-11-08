/**
 * **토스트 한 벌** — 앱 전체가 나눠 쓰는 짧은 알림 큐
 * (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
 *
 * ## 무엇을 토스트로 말하는가
 *
 * 기준은 **"그 자리에 남아 있어야 하는가"** 하나다.
 *
 * - **토스트** — 방금 한 일이 끝났다는 확인(업로드 완료·복사 완료·설정 저장), 되돌릴 수 없는
 *   조작의 결과, 조작 자체가 거절됐다는 안내. 읽고 나면 화면에 남을 이유가 없다.
 * - **인라인** — 원인이 그 자리에 있어야 하는 것: 접속 실패 배너, 파일 목록 읽기 실패
 *   (그 옆에 [재시도] 가 붙는다), 폼 검증. 사라지면 무엇을 고쳐야 하는지가 사라진다.
 *
 * 두 길을 한 파일에 몰지 않는 이유가 그것이다 — 여기 있는 것은 **사라져도 되는 말**뿐이다.
 *
 * ## 왜 `.svelte.ts` 인가
 *
 * 큐가 `$state` 라 어느 컴포넌트에서 밀어 넣어도 화면(`Toasts.svelte`) 하나가 저절로
 * 갱신된다. 큐를 컴포넌트 상태로 올려 두었다면 SFTP 타일·설정 모달·`+page` 가 저마다
 * 콜백을 위로 올려야 했고, 타일 안에서 뜬 알림이 타일 크기에 갇히거나 타일이 닫히면서
 * 함께 사라지는 문제가 따라온다.
 */

/** 알림의 결 — 색과 기본 지속 시간을 가른다 */
export type ToastKind = "info" | "success" | "error";

/** 토스트 안의 버튼 하나 (예: "폴더 열기") — 없으면 문구만 뜬다 */
export interface ToastAction {
  label: string;
  run: () => void;
  /** 단추의 `data-toast-action` 값 — 하네스(CDP)가 문구 대신 잡는 손잡이. 없으면 속성이 없다 */
  id?: string;
}

/**
 * **두 줄짜리 몸** — 머리 한 줄 + 부제 한 줄(앞 토막만 결의 색). 작업안 실행 결과 알림이 처음
 * 쓴다(docs/log/2026-09-28-run-result-notify.md): `nginx 설정 재적용` / `일부 실패 2/3 · 실패: web-02`.
 *
 * 없으면 예전 그대로 `text` 한 줄이다 — 이 칸은 **그리는 모양만** 바꾸고, `text` 는 그래도 늘
 * 채운다(한 줄로 읽는 자리 — 스크린 리더 · 테스트 — 가 볼 글자).
 */
export interface ToastDetail {
  /** 첫 줄 (말줄임으로 한 줄에 가둔다) */
  head: string;
  /** 첫 줄 끝의 작은 칩 (`자동`) — 없으면 `null`/생략 */
  chip?: string | null;
  /** 칩의 말풍선 */
  chipTitle?: string;
  /** 부제의 앞 토막 — `tone` 의 색을 입는다 */
  lead: string;
  /** 앞 토막의 색 — `good`(초록) · `bad`(오류색) · `plain`(부제와 같은 회색) */
  tone?: "good" | "bad" | "plain";
  /** 앞 토막 뒤에 ` · ` 로 이어 붙는 나머지 (없으면 빈 문자열) */
  tail?: string;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  /** 두 줄짜리 몸 — 없으면 `text` 한 줄로 그린다 */
  detail?: ToastDetail;
  /** `text` 아래 흐린 보조 줄 — 없으면 한 줄 그대로 (`ToastOpts.sub`) */
  sub?: string;
  /** 이 항목이 살아 있을 총 시간(ms) — 호버 중에는 줄지 않는다 */
  ms: number;
  /**
   * 버튼들 (없으면 **빈 배열**). 둘 이상이면 **왼쪽부터 다음 걸음 순서**다 — 키를 만든 뒤의
   * `[에이전트에 넣기] [이 호스트에 공개키 설치…]` 가 그 꼴이다
   * (docs/log/2026-09-17-keygen.md).
   *
   * 부르는 쪽은 하나면 `action`, 여럿이면 `actions` 로 준다. **저장되는 모양은 하나**다 —
   * 그리는 쪽이 두 자리를 보게 두면 한쪽이 언젠가 잊힌다.
   */
  actions: readonly ToastAction[];
  /** 항목의 `data-toast` 값 (`ToastOpts.tag`) */
  tag?: string;
}

/** 세 함수가 받는 곁 인자 — `action`(하나)과 `actions`(여럿)는 같은 자리를 가리킨다 */
export interface ToastOpts {
  ms?: number;
  action?: ToastAction;
  actions?: readonly ToastAction[];
  /** 두 줄짜리 몸 (`ToastDetail`) — 주면 `text` 대신 이 모양으로 그린다 */
  detail?: ToastDetail;
  /**
   * `text` 아래 **흐린 보조 줄** 하나 — 백틱으로 감싼 구간은 인라인 코드 모양(`codeSpans`,
   * HTML 은 해석하지 않는다). 첫 소비자: git 신원 없음 알림(docs/log/2026-09-28-project-create.md).
   * `detail` 과 함께 주면 `detail` 이 이긴다. `text` 는 첫 줄만 담는다.
   */
  sub?: string;
  /**
   * 항목의 **종류 손잡이** — 토스트 상자에 `data-toast` 로 선다(하네스 · CDP 가 문구 대신 잡는다). 첫 소비자: 작업자 타일 손 놓기
   * (`worker-released` — `app/orchestration`). 없으면 속성이 없다.
   */
  tag?: string;
}

/**
 * 한 번에 쌓이는 최대 개수. 넘치면 **가장 오래된 것부터** 사라진다 —
 * 화면 구석이 알림탑이 되면 정작 방금 뜬 줄이 안 읽힌다. 오래된 것은 **맨 아래**다(큐의 끝).
 */
export const MAX_TOASTS = 3;

/** 오류는 길게 (읽고 대응할 시간), 나머지는 짧게 — 이 둘뿐이라 표를 만들지 않는다 */
export const ERROR_MS = 6000;
export const DEFAULT_MS = 3000;

/**
 * 화면에 떠 있는 것들 (**새것이 앞**) — `Toasts.svelte` 만 읽는다. 순서를 큐에서 정하는 까닭은
 * 그리는 쪽이 뒤집지 않아도 되게 하려는 것이다: 새것은 늘 기둥 첫 자리(카드 바로 아래)에
 * 들어오고 있던 것들은 한 칸씩 밀려 내려간다 (2026-09-25, 사용자).
 */
export const toasts = $state<ToastItem[]>([]);

/** 항목별 타이머 — 큐와 따로 두어 `ToastItem` 이 순수한 값으로 남는다 */
const timers = new Map<number, ReturnType<typeof setTimeout>>();
/** 항목별 **남은 시간**(ms) — 호버로 멈춘 동안 여기에 담긴다 */
const remains = new Map<number, number>();
/** 항목별 마지막으로 타이머를 건 시각 — 멈출 때 남은 시간을 계산한다 */
const startedAt = new Map<number, number>();

let seq = 0;
/** 지금 마우스가 토스트 무리 위에 있는가 (있으면 새로 뜨는 것도 멈춘 채로 시작한다) */
let held = false;

function arm(id: number, ms: number) {
  clearTimeout(timers.get(id));
  remains.set(id, ms);
  if (held) return; // 붙잡혀 있는 동안에는 시계를 걸지 않는다
  startedAt.set(id, Date.now());
  timers.set(
    id,
    setTimeout(() => dismiss(id), ms),
  );
}

/** 하나를 지금 지운다 (× 버튼·시간 만료·액션 실행 뒤) */
export function dismiss(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  remains.delete(id);
  startedAt.delete(id);
  const at = toasts.findIndex((t) => t.id === id);
  if (at >= 0) toasts.splice(at, 1);
}

/**
 * **마우스를 올리고 있는 동안 시계를 멈춘다** — 읽는 중에 글이 사라지면 안 되고,
 * 무엇보다 [액션] 버튼을 누르러 가는 동안 버튼이 도망가면 안 된다.
 */
export function holdToasts() {
  if (held) return;
  held = true;
  const now = Date.now();
  for (const t of toasts) {
    clearTimeout(timers.get(t.id));
    timers.delete(t.id);
    const left = (remains.get(t.id) ?? t.ms) - (now - (startedAt.get(t.id) ?? now));
    remains.set(t.id, Math.max(600, left)); // 떠난 직후 바로 사라지지 않을 만큼은 남긴다
  }
}

/** 마우스가 떠났다 — 남은 시간만큼 다시 센다 */
export function releaseToasts() {
  if (!held) return;
  held = false;
  for (const t of toasts) arm(t.id, remains.get(t.id) ?? t.ms);
}

function push(kind: ToastKind, text: string, opts?: ToastOpts): number {
  const id = ++seq;
  const ms = opts?.ms ?? (kind === "error" ? ERROR_MS : DEFAULT_MS);
  // 하나든 여럿이든 **배열 하나**로 눕힌다 (위 `actions` 주석).
  const actions = opts?.actions ?? (opts?.action ? [opts.action] : []);
  const item: ToastItem = { id, kind, text, ms, actions };
  if (opts?.detail) item.detail = opts.detail;
  if (opts?.sub) item.sub = opts.sub;
  if (opts?.tag) item.tag = opts.tag;
  toasts.unshift(item);
  // 넘치면 오래된 것(맨 뒤)부터 — `dismiss` 로 지워야 타이머까지 함께 정리된다
  while (toasts.length > MAX_TOASTS) dismiss(toasts[toasts.length - 1].id);
  arm(id, ms);
  return id;
}

/**
 * 알림 세 갈래. 부르는 쪽은 이 세 함수만 안다 —
 * 지속 시간·최대 개수·호버 규칙은 전부 이 파일 안에 있다.
 */
export const toast = {
  /** 알림 (성공도 실패도 아닌 사실) */
  info: (text: string, opts?: ToastOpts) => push("info", text, opts),
  /** 방금 한 일이 끝났다 */
  success: (text: string, opts?: ToastOpts) => push("success", text, opts),
  /** 실패했거나 거절됐다 — 기본 6초 */
  error: (text: string, opts?: ToastOpts) => push("error", text, opts),
};
