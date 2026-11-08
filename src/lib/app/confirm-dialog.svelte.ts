import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **확인 · 알림 상자** — 앱 테마를 따르는 앱 안 모달(10-16). 예전에는 `@tauri-apps/plugin-dialog` 의 `ask` · `message` 로
 * **OS 기본 메시지 상자**를 띄웠다(테마 · 재질과 따로 놀았다). 그리는 곳은 `dialogs/ConfirmDialog.svelte`(`+page` 에 한 벌).
 * 파일 열기 · 저장 대화(`open` · `save` — 파일 선택기)는 여전히 플러그인이다.
 *
 * - [`askConfirm`] — `ask` 자리. 같은 꼴(본문 · `title` · `kind` · `okLabel` · `cancelLabel`)이라 부르는 쪽은 import 만 바꾼다.
 *   `danger` 면 확인 단추가 위험 색이다. 더 붙일 수 있는 것(10-23 — 모두 승인 확인): 점 목록 `points` · 체크해야 확인이 눌리는
 *   `ack` · 꼬리말 `footnote` · 모양 `variant: "approve-all"`. 체크는 화면만의 문이다 — 답은 여전히 단추가 낸다([`ackBlocks`]).
 * - [`showMessage`] — `message` 자리(단추 하나).
 * - [`askChoice`] — 단추 셋(`message` 의 `YesNoCancelCustom` 자리 — 저장 안 한 문서). 결과 글자는 플러그인과 같은
 *   `"Yes"` · `"No"` · `"Cancel"` 이라 `unsaved-guard` 의 `choiceFromDialog` 가 그대로 읽는다.
 * - [`askPick`] — 부르는 쪽이 정한 단추들 · 경고 칸 · 설명 칸(앨범 영구 삭제 — 되돌릴 수 없으니 첫 포커스는 취소 쪽).
 * - [`askHookInstall`] — 에이전트 훅 설치 확인(로컬 · 원격 둘 다). 같은 줄에 실리되 본문 글 대신 [`HookInstallDetail`] 을
 *   싣고, 상자는 그것을 구조화해 그린다(경로 둘 · 이벤트 칩 · 접힌 JSON — 긴 미리 보기로 상자가 창만큼 늘지 않게).
 *
 * ## 규칙
 *
 * - **줄** — 동시에 여러 개 물으면 하나씩 띄운다(앞이 지금 떠 있는 것). 답하면 다음이 선다.
 * - **취소** — Escape · 바깥 누르기 · [취소] 는 취소 쪽 단추(`askConfirm` 은 `false` · 알림은 그냥 닫힘).
 * - **첫 포커스** — 위험(`danger`) · 경고 · 오류면 **[취소]**, 아니면 확인 단추(`DbWriteDialog` · 원격 묻기 `initialFocus` 와
 *   같은 규칙 — Enter 한 번에 지우거나 세션을 닫지 않게). Enter 는 포커스 쥔 단추를 누른다.
 * - **포커스 되돌리기** — 줄이 비면 처음 물을 때 포커스를 쥐고 있던 요소(터미널 입력칸 등)로 돌려준 뒤 답을 넘긴다
 *   (OS 상자가 닫히면 웹뷰가 하던 일 — 답을 받은 쪽이 포커스를 옮기면 그쪽이 이긴다).
 *
 * 전역 키 가드(`app/keys` 의 `anyModalOpen`)와 Escape 사슬이 [`confirmDialogOpen`] 을 본다.
 *
 * **마운트 전에는 부르지 않는다** — 그리는 컴포넌트가 없으면 답이 영영 오지 않는다. 지금 부르는 자리는 전부 사람의 조작
 * (단추 · 메뉴 · 창 닫기 · 트레이 종료 — 트레이는 Rust 가 주 창을 먼저 띄운다) 뒤라 페이지가 이미 서 있다.
 */

export type ConfirmKind = "info" | "warning" | "error";

export interface ConfirmOptions {
  title?: string;
  kind?: ConfirmKind;
  okLabel?: string;
  cancelLabel?: string;
  /** 확인 단추를 위험 색으로(지우기 · 되돌리기 · 세션 닫기). 첫 포커스는 [취소] */
  danger?: boolean;
  /** 본문 아래 점 목록(무엇을 건너뛰고 무엇이 남는가 — 모두 승인 확인) */
  points?: readonly string[];
  /** 이 칸을 체크해야 확인 단추가 눌린다(「이해했습니다」 — 줄마다 처음엔 꺼짐) */
  ack?: string;
  /** 단추 아래 작은 꼬리말 */
  footnote?: string;
  /** 모양 — `approve-all` 이면 머리 아래 게이지 미리 보기(가득 · 주황) · 따뜻한 테두리 · 주황 확인 단추(10-23 목업) */
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

/** 위험한 일의 확인 상자에 더 붙이는 것 — 경고 칸 · 머리글 달린 설명 칸([`askPick`]) */
export interface ConfirmSection {
  label: string;
  text: string;
}

export interface PickOptions {
  title: string;
  /** 부르는 쪽이 정한 단추들 — 왼쪽부터 · 취소 쪽 하나를 `cancel: true` 로 */
  choices: ConfirmChoice[];
  /** 본문 아래 경고 칸(없으면 안 그린다) */
  callout?: string;
  /** 경고 아래 머리글 달린 설명 칸 */
  section?: ConfirmSection;
}

/** 단추 하나 — 누르면 `result` 가 답이다 */
export interface ConfirmChoice {
  label: string;
  result: string;
  /** `primary` = 강조(오른쪽 끝) · `danger` = 위험 강조 · `secondary` = 그 밖 */
  tone: "primary" | "danger" | "secondary";
  /** Escape · 바깥 누르기가 고르는 단추 */
  cancel: boolean;
}

/** 훅 설치 확인에 실을 것 — 경로 · 미리 보기는 Rust 의 훅 상태(`AgentHooksStatus`)가 준 그대로 */
export interface HookInstallDetail {
  /** 원격 설치면 그 호스트 별칭(제목 옆 칩) · 로컬이면 `null` */
  remote: string | null;
  scriptPath: string;
  settingsPath: string;
  /** 더할 JSON(`{"hooks": {...}}`) 원문 — 접힌 칸 · [복사] 가 그대로 쓴다 */
  preview: string;
}

export interface ConfirmReq {
  title: string;
  body: string;
  /** 있으면 훅 설치 확인 — 상자가 `body` 한 줄 아래에 이것을 구조화해 그린다 */
  hooks?: HookInstallDetail;
  kind: ConfirmKind;
  /** 왼쪽부터 — 취소 쪽이 왼쪽, 강조가 오른쪽 끝 */
  choices: ConfirmChoice[];
  /** 처음 포커스를 줄 단추의 자리 */
  focus: number;
  points?: readonly string[];
  /** 있으면 체크해야 취소 쪽이 아닌 단추가 눌린다 */
  ack?: string;
  footnote?: string;
  variant?: "approve-all";
  callout?: string;
  section?: ConfirmSection;
  done: (result: string) => void;
}

/** 처음 포커스 — 위험 · 경고 · 오류면 취소 쪽, 아니면 강조 단추. **순수** */
export function initialChoice(choices: readonly ConfirmChoice[], kind: ConfirmKind, danger: boolean): number {
  const careful = danger || kind === "warning" || kind === "error";
  const i = careful ? choices.findIndex((c) => c.cancel) : choices.findIndex((c) => c.tone !== "secondary");
  return i >= 0 ? i : choices.length - 1;
}

/** 이 단추가 「이해했습니다」 칸에 막혀 있는가 — 칸이 있고 아직 체크하지 않았으면 취소 쪽이 아닌 단추는 눌리지 않는다. **순수** */
export function ackBlocks(req: Pick<ConfirmReq, "ack">, choice: Pick<ConfirmChoice, "cancel">, acked: boolean): boolean {
  return !!req.ack && !choice.cancel && !acked;
}

/** Escape · 바깥 누르기의 답 — 취소 쪽 단추(없으면 마지막 단추). **순수** */
export function cancelResult(choices: readonly ConfirmChoice[]): string {
  return (choices.find((c) => c.cancel) ?? choices[choices.length - 1])?.result ?? "Cancel";
}

let queue = $state.raw<ConfirmReq[]>([]);
/** 줄이 비어 있다가 처음 물을 때 포커스를 쥐고 있던 요소 — 줄이 다시 비면 돌려준다 */
let returnFocus: HTMLElement | null = null;

/** 지금 떠 있는 상자(없으면 `null`) */
export function currentConfirm(): ConfirmReq | null {
  return queue[0] ?? null;
}

/** 떠 있는가 — 전역 키 가드(`anyModalOpen`) · Escape 사슬이 본다 */
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

/** 지금 떠 있는 상자의 「이해했습니다」 칸이 체크됐는가 — 상자가 바뀌면(답하면) 다시 꺼진다 */
let acked = $state(false);

export function confirmAcked(): boolean {
  return acked;
}

export function setConfirmAcked(on: boolean): void {
  acked = on;
}

/** 지금 떠 있는 상자에 답한다 — 고른 단추의 `result`. 「이해했습니다」 칸에 막힌 단추의 답은 받지 않는다([`ackBlocks`]) */
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

/** Escape · 바깥 누르기 — 취소 쪽 단추 */
export function dismissConfirm(): void {
  const req = queue[0];
  if (req) answerConfirm(cancelResult(req.choices));
}

/** `ask` 자리 — 확인이면 `true`, [취소] · Escape · 바깥 누르기면 `false` */
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

/** `message` 자리 — 단추 하나. 닫히면 끝난다 */
export async function showMessage(body: string, opts: MessageOptions = {}): Promise<void> {
  const kind = opts.kind ?? "info";
  const choices: ConfirmChoice[] = [
    { label: opts.okLabel ?? t("app.confirmDialog.ok"), result: "Ok", tone: "primary", cancel: true },
  ];
  await push({ title: opts.title ?? "", body, kind, choices, focus: 0 });
}

/** 단추 셋 — `"Yes"`(강조) · `"No"` · `"Cancel"`(취소 쪽) */
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

/** 부르는 쪽이 정한 단추들 — 고른 단추의 `result`(Escape · 바깥 누르기는 취소 쪽). 위험한 확인이라 첫 포커스는 취소 쪽이다 */
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

/** 훅 설치 확인 — [설치] 면 `true`, [취소] · Escape · 바깥 누르기면 `false`. 첫 포커스는 [설치] */
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
