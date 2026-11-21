/**
 * 토스트 큐 — 사라져도 되는 말만 싣는다(방금 한 일의 확인 · 거절 안내). 원인이 그 자리에 남아야 하는 것(접속 실패 · 목록 읽기 실패 ·
 * 폼 검증)은 인라인이다.
 */

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  run: () => void;
  /** 단추의 `data-toast-action` 값 — 하네스(CDP)가 문구 대신 잡는 손잡이 */
  id?: string;
  /** 주 동작(채운 단추) — 알림 카드(`ToastNotice`)에서만 뜻이 있다 */
  primary?: boolean;
}

/** 알림 카드 몸 — `row` 면 한 줄(아이콘 · 제목 · 단추) */
export interface ToastNotice {
  icon: string;
  tone: "accent" | "ok";
  title: string;
  sub?: string;
  row?: boolean;
}

/** 두 줄짜리 몸 — 그리는 모양만 바꾼다. `text` 는 그래도 늘 채운다(스크린 리더 · 테스트가 읽는 글자) */
export interface ToastDetail {
  head: string;
  chip?: string | null;
  chipTitle?: string;
  lead: string;
  tone?: "good" | "bad" | "plain";
  tail?: string;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  detail?: ToastDetail;
  /** 있으면 `detail` · `sub` 보다 앞선다 */
  notice?: ToastNotice;
  sub?: string;
  /** 총 시간(ms) — 호버 중에는 줄지 않는다 */
  ms: number;
  /**
   * 둘 이상이면 왼쪽부터 다음 걸음 순서다. 부르는 쪽의 `action` · `actions` 를 이 하나로 눕힌다 — 그리는 쪽이 두 자리를 보면 한쪽이 잊힌다.
   */
  actions: readonly ToastAction[];
  tag?: string;
}

export interface ToastOpts {
  ms?: number;
  action?: ToastAction;
  actions?: readonly ToastAction[];
  detail?: ToastDetail;
  notice?: ToastNotice;
  /** `text` 아래 흐린 보조 줄 — 백틱 구간은 인라인 코드(HTML 은 해석하지 않는다). `detail` 과 함께 주면 `detail` 이 이긴다 */
  sub?: string;
  /** 토스트 상자의 `data-toast` 값 — 하네스(CDP)가 문구 대신 잡는 손잡이 */
  tag?: string;
}

export const MAX_TOASTS = 3;

export const ERROR_MS = 6000;
export const DEFAULT_MS = 3000;

/** 새것이 앞 — 그리는 쪽이 뒤집지 않는다 */
export const toasts = $state<ToastItem[]>([]);

/** 큐와 따로 두어 `ToastItem` 이 순수한 값으로 남는다 */
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const remains = new Map<number, number>();
const startedAt = new Map<number, number>();

let seq = 0;
/** 마우스가 토스트 무리 위에 있는가 — 있으면 새로 뜨는 것도 멈춘 채로 시작한다 */
let held = false;

function arm(id: number, ms: number) {
  clearTimeout(timers.get(id));
  remains.set(id, ms);
  if (held) return;
  startedAt.set(id, Date.now());
  timers.set(
    id,
    setTimeout(() => dismiss(id), ms),
  );
}

export function dismiss(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  remains.delete(id);
  startedAt.delete(id);
  const at = toasts.findIndex((t) => t.id === id);
  if (at >= 0) toasts.splice(at, 1);
}

/** 마우스를 올린 동안 시계를 멈춘다 — [액션] 단추를 누르러 가는 동안 단추가 도망가면 안 된다 */
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

export function releaseToasts() {
  if (!held) return;
  held = false;
  for (const t of toasts) arm(t.id, remains.get(t.id) ?? t.ms);
}

function push(kind: ToastKind, text: string, opts?: ToastOpts): number {
  const id = ++seq;
  const ms = opts?.ms ?? (kind === "error" ? ERROR_MS : DEFAULT_MS);
  const actions = opts?.actions ?? (opts?.action ? [opts.action] : []);
  const item: ToastItem = { id, kind, text, ms, actions };
  if (opts?.detail) item.detail = opts.detail;
  if (opts?.notice) item.notice = opts.notice;
  if (opts?.sub) item.sub = opts.sub;
  if (opts?.tag) item.tag = opts.tag;
  toasts.unshift(item);
  // `dismiss` 로 지워야 타이머까지 함께 정리된다
  while (toasts.length > MAX_TOASTS) dismiss(toasts[toasts.length - 1].id);
  arm(id, ms);
  return id;
}

export const toast = {
  info: (text: string, opts?: ToastOpts) => push("info", text, opts),
  success: (text: string, opts?: ToastOpts) => push("success", text, opts),
  error: (text: string, opts?: ToastOpts) => push("error", text, opts),
};
