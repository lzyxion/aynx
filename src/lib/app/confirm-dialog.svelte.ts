import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 확인 · 알림 상자(앱 안 모달) — 동시에 여러 개 물으면 하나씩 띄운다.
 * 첫 포커스는 위험 · 경고 · 오류면 취소 쪽이다 — Enter 한 번에 지우거나 세션을 닫지 않게.
 * 마운트 전에는 부르지 않는다 — 그리는 컴포넌트(`dialogs/ConfirmDialog.svelte`)가 없으면 답이 영영 오지 않는다.
 */

export type ConfirmKind = "info" | "warning" | "error";

export interface ConfirmOptions {
  title?: string;
  kind?: ConfirmKind;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  points?: readonly string[];
  /** 체크해야 확인 단추가 눌린다 — 화면만의 문이고 답은 여전히 단추가 낸다 */
  ack?: string;
  footnote?: string;
  variant?: "approve-all";
}

export interface MessageOptions {
  title?: string;
  kind?: ConfirmKind;
  okLabel?: string;
}

export interface ChoiceOptions {
  title?: string;
  kind?: ConfirmKind;
  yesLabel: string;
  noLabel: string;
  cancelLabel?: string;
}

export interface ConfirmSection {
  label: string;
  text: string;
}

export interface PickOptions {
  title: string;
  /** 왼쪽부터 · 취소 쪽 하나를 `cancel: true` 로 */
  choices: ConfirmChoice[];
  callout?: string;
  section?: ConfirmSection;
}

export interface ConfirmChoice {
  label: string;
  result: string;
  tone: "primary" | "danger" | "secondary";
  /** Escape · 바깥 누르기가 고르는 단추 */
  cancel: boolean;
}

export interface HookInstallDetail {
  /** 로컬이면 `null` */
  remote: string | null;
  scriptPath: string;
  settingsPath: string;
  preview: string;
}

export interface ConfirmReq {
  title: string;
  body: string;
  hooks?: HookInstallDetail;
  kind: ConfirmKind;
  choices: ConfirmChoice[];
  /** 처음 포커스를 줄 단추의 자리 */
  focus: number;
  points?: readonly string[];
  ack?: string;
  footnote?: string;
  variant?: "approve-all";
  callout?: string;
  section?: ConfirmSection;
  done: (result: string) => void;
}

export function initialChoice(choices: readonly ConfirmChoice[], kind: ConfirmKind, danger: boolean): number {
  const careful = danger || kind === "warning" || kind === "error";
  const i = careful ? choices.findIndex((c) => c.cancel) : choices.findIndex((c) => c.tone !== "secondary");
  return i >= 0 ? i : choices.length - 1;
}

export function ackBlocks(req: Pick<ConfirmReq, "ack">, choice: Pick<ConfirmChoice, "cancel">, acked: boolean): boolean {
  return !!req.ack && !choice.cancel && !acked;
}

export function cancelResult(choices: readonly ConfirmChoice[]): string {
  return (choices.find((c) => c.cancel) ?? choices[choices.length - 1])?.result ?? "Cancel";
}

let queue = $state.raw<ConfirmReq[]>([]);
/** 줄이 다시 비면 돌려준다 — 답을 받은 쪽이 포커스를 옮기면 그쪽이 이긴다(돌려준 뒤 답을 넘긴다) */
let returnFocus: HTMLElement | null = null;

export function currentConfirm(): ConfirmReq | null {
  return queue[0] ?? null;
}

export function confirmDialogOpen(): boolean {
  return queue.length > 0;
}

function push(req: Omit<ConfirmReq, "done">): Promise<string> {
  return new Promise<string>((done) => {
    if (queue.length === 0 && typeof document !== "undefined") {
      const el = document.activeElement;
      returnFocus = el instanceof HTMLElement && el !== document.body ? el : null;
    }
    queue = [...queue, { ...req, done }];
  });
}

let acked = $state(false);

export function confirmAcked(): boolean {
  return acked;
}

export function setConfirmAcked(on: boolean): void {
  acked = on;
}

export function answerConfirm(result: string): void {
  const req = queue[0];
  if (!req) return;
  const choice = req.choices.find((c) => c.result === result);
  if (choice && ackBlocks(req, choice, acked)) return;
  acked = false;
  queue = queue.slice(1);
  if (queue.length === 0) {
    const el = returnFocus;
    returnFocus = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }
  req.done(result);
}

export function dismissConfirm(): void {
  const req = queue[0];
  if (req) answerConfirm(cancelResult(req.choices));
}

export async function askConfirm(body: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const kind = opts.kind ?? "info";
  const danger = opts.danger === true;
  const choices: ConfirmChoice[] = [
    { label: opts.cancelLabel ?? t("app.actions.cancel"), result: "Cancel", tone: "secondary", cancel: true },
    { label: opts.okLabel ?? t("app.confirmDialog.ok"), result: "Ok", tone: danger ? "danger" : "primary", cancel: false },
  ];
  const result = await push({
    title: opts.title ?? "",
    body,
    kind,
    choices,
    focus: initialChoice(choices, kind, danger),
    points: opts.points,
    ack: opts.ack,
    footnote: opts.footnote,
    variant: opts.variant,
  });
  return result === "Ok";
}

export async function showMessage(body: string, opts: MessageOptions = {}): Promise<void> {
  const kind = opts.kind ?? "info";
  const choices: ConfirmChoice[] = [
    { label: opts.okLabel ?? t("app.confirmDialog.ok"), result: "Ok", tone: "primary", cancel: true },
  ];
  await push({ title: opts.title ?? "", body, kind, choices, focus: 0 });
}

/** 결과 글자 `"Yes"` · `"No"` · `"Cancel"` 은 `unsaved-guard` 의 `choiceFromDialog` 가 그대로 읽는다 */
export async function askChoice(body: string, opts: ChoiceOptions): Promise<"Yes" | "No" | "Cancel"> {
  const kind = opts.kind ?? "info";
  const choices: ConfirmChoice[] = [
    { label: opts.cancelLabel ?? t("app.actions.cancel"), result: "Cancel", tone: "secondary", cancel: true },
    { label: opts.noLabel, result: "No", tone: "secondary", cancel: false },
    { label: opts.yesLabel, result: "Yes", tone: "primary", cancel: false },
  ];
  const result = await push({ title: opts.title ?? "", body, kind, choices, focus: initialChoice(choices, kind, false) });
  return result === "Yes" || result === "No" ? result : "Cancel";
}

/** 위험한 확인이라 첫 포커스는 취소 쪽이다 */
export function askPick(body: string, opts: PickOptions): Promise<string> {
  return push({
    title: opts.title,
    body,
    kind: "info",
    choices: opts.choices,
    focus: initialChoice(opts.choices, "info", true),
    callout: opts.callout,
    section: opts.section,
  });
}

export async function askHookInstall(agent: string, hooks: HookInstallDetail): Promise<boolean> {
  const choices: ConfirmChoice[] = [
    { label: t("app.actions.cancel"), result: "Cancel", tone: "secondary", cancel: true },
    { label: t("settings.ai.hooks.confirm.ok"), result: "Ok", tone: "primary", cancel: false },
  ];
  const result = await push({
    title: t("settings.ai.hooks.confirm.title", { agent }),
    body: t("settings.ai.hooks.confirm.lead"),
    kind: "info",
    choices,
    focus: initialChoice(choices, "info", false),
    hooks,
  });
  return result === "Ok";
}
