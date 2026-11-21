import { isRemote } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  dialogChoices,
  escapeResult,
  reauthFailure,
  reauthTicketOf,
  type DialogChoice,
  type ReauthReply,
} from "$lib/remote-dialog";

/**
 * 원격 창의 앱 모달 — 폴리필(`src-tauri/src/remote/polyfill.js`)과의 약속은 손잡이 `window.__AYNX_REMOTE_UI__` 의 모양이다.
 * `message` 는 고른 단추의 결과 글자(플러그인이 견주는 값)로, `reauth` 는 표 글자(마스터 없으면 빈 글자)로 끝나고 취소면 거절한다.
 * 재확인 암호는 폴리필의 `POST /remote/reauth` 몸으로만 간다 — 여기 상태에 남기지 않는다.
 * 경계가 아니다 — 문은 관문(`remote/deny.rs` 의 REAUTH · 1회용 표)이고, 손잡이를 건너뛰어도 표 없이는 명령이 서지 않는다.
 */

interface MessageReq {
  kind: "message";
  title: string;
  message: string;
  tone: unknown;
  choices: DialogChoice[];
  done: (result: string) => void;
}

interface ReauthReq {
  kind: "reauth";
  cmd: string;
  hasMaster: boolean;
  submit: ((password: string) => Promise<ReauthReply>) | null;
  done: (ticket: string) => void;
  fail: (why: string) => void;
}

export type RemoteDialogReq = MessageReq | ReauthReq;

/** 앞이 지금 떠 있는 것 */
let queue = $state.raw<RemoteDialogReq[]>([]);
let busy = $state(false);
let error = $state<string | null>(null);

export function currentRemoteDialog(): RemoteDialogReq | null {
  return queue[0] ?? null;
}

export function remoteDialogOpen(): boolean {
  return queue.length > 0;
}

export function remoteDialogBusy(): boolean {
  return busy;
}

export function remoteDialogError(): string | null {
  return error;
}

function push(req: RemoteDialogReq): void {
  queue = [...queue, req];
}

function shift(req: RemoteDialogReq): boolean {
  if (queue[0] !== req) return false;
  queue = queue.slice(1);
  busy = false;
  error = null;
  return true;
}

export function answerRemoteMessage(result: string): void {
  const req = queue[0];
  if (!req || req.kind !== "message") return;
  if (shift(req)) req.done(result);
}

export function dismissRemoteMessage(): void {
  const req = queue[0];
  if (req && req.kind === "message") answerRemoteMessage(escapeResult(req.choices));
}

export async function submitRemoteReauth(password: string): Promise<void> {
  const req = queue[0];
  if (!req || req.kind !== "reauth" || busy) return;
  if (!req.hasMaster || !req.submit) {
    if (shift(req)) req.done("");
    return;
  }
  if (!password) return;
  busy = true;
  error = null;
  let reply: ReauthReply;
  try {
    reply = await req.submit(password);
  } catch {
    reply = { status: 0, data: {} };
  }
  if (queue[0] !== req) return; // 그 사이 닫혔다
  const ticket = reauthTicketOf(reply);
  if (ticket !== null) {
    if (shift(req)) req.done(ticket);
    return;
  }
  busy = false;
  const f = reauthFailure(reply);
  error = t(f.key, f.params);
}

export function cancelRemoteReauth(): void {
  const req = queue[0];
  if (!req || req.kind !== "reauth") return;
  if (shift(req)) req.fail(t("app.remoteReauth.cancelled"));
}

interface RemoteUi {
  message(o: { message?: unknown; title?: unknown; kind?: unknown; buttons?: unknown }): Promise<string>;
  reauth(o: { cmd?: unknown; hasMaster?: unknown; submit?: unknown }): Promise<string>;
}

let installed = false;

export function installRemoteUi(): void {
  if (!isRemote || installed || typeof window === "undefined") return;
  installed = true;
  const ui: RemoteUi = {
    message: (o) =>
      new Promise<string>((done) => {
        push({
          kind: "message",
          title: typeof o?.title === "string" ? o.title : "",
          message: String(o?.message ?? ""),
          tone: o?.kind,
          choices: dialogChoices(o?.buttons),
          done,
        });
      }),
    reauth: (o) =>
      new Promise<string>((done, fail) => {
        const submit = typeof o?.submit === "function" ? (o.submit as (password: string) => Promise<ReauthReply>) : null;
        push({ kind: "reauth", cmd: String(o?.cmd ?? ""), hasMaster: o?.hasMaster === true, submit, done, fail });
      }),
  };
  (window as unknown as { __AYNX_REMOTE_UI__?: RemoteUi }).__AYNX_REMOTE_UI__ = ui;
}
