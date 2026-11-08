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
 * **원격 창의 앱 모달**(R4) — 묻기(`plugin:dialog|message` — 플러그인의 `ask`·`confirm`·`message`)와 마스터 재확인을 브라우저
 * 네이티브 `confirm` · 폴리필의 DOM 칸 대신 앱 모달로 띄운다. 그리는 곳은 `dialogs/RemoteDialog.svelte`, 단추·문구 고르기는
 * 순수 `$lib/remote-dialog`.
 *
 * ## 폴리필과의 약속 — `window.__AYNX_REMOTE_UI__`
 *
 * 원격 창 부팅이 [`installRemoteUi`] 로 건다(집 PC 창에서는 아무것도 하지 않는다). 폴리필(`src-tauri/src/remote/polyfill.js`)은
 * 이 손잡이가 있으면 그쪽으로, 없으면(앱이 뜨기 전) 예전 그대로 네이티브 대화 · 제 DOM 칸으로 간다.
 *
 * - `message({message, title, kind, buttons})` → 고른 단추의 결과 글자(`"Yes"` · `"Ok"` · 사용자 이름 …) — 플러그인이 견주는 값.
 * - `reauth({cmd, hasMaster, submit?})` → 마스터가 있으면 암호 칸 → `submit(암호)`(폴리필이 `POST /remote/reauth` — **암호는 그
 *   HTTP 몸으로만**, 여기 상태에 남기지 않는다) → 표 글자로 끝. 마스터가 없으면 확인 단추만(그 사실을 화면이 밝힌다) → 빈 글자로
 *   끝. 취소면 거절.
 *
 * **경계가 아니다** — 문은 관문(`remote/deny.rs` 의 REAUTH · 1회용 표)이고 서버가 만료·상한·정책·권한을 다시 판정한다. 이 모달은
 * 사람에게 묻는 화면일 뿐이다(같은 원격 창의 코드가 손잡이를 건너뛰어도 표 없이는 명령이 서지 않는다).
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

/** 줄 — 앞이 지금 떠 있는 것. 한 번에 하나만 그린다(폴리필도 재확인을 줄 세운다). */
let queue = $state.raw<RemoteDialogReq[]>([]);
/** 재확인 칸 — 보내는 중 · 실패 한 줄 */
let busy = $state(false);
let error = $state<string | null>(null);

/** 지금 떠 있는 모달(없으면 `null`) */
export function currentRemoteDialog(): RemoteDialogReq | null {
  return queue[0] ?? null;
}

/** 떠 있는가 — 전역 키 가드(`app/keys` 의 `anyModalOpen`)가 본다 */
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

/** 묻기에 답한다 — 고른 단추의 결과 글자 */
export function answerRemoteMessage(result: string): void {
  const req = queue[0];
  if (!req || req.kind !== "message") return;
  if (shift(req)) req.done(result);
}

/** 묻기를 Esc · 바깥 클릭으로 닫는다 — 취소 쪽 단추 */
export function dismissRemoteMessage(): void {
  const req = queue[0];
  if (req && req.kind === "message") answerRemoteMessage(escapeResult(req.choices));
}

/** 재확인 [확인] — 마스터가 있으면 암호로 표를 받고, 없으면 확인만 */
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

/** 재확인 [취소] · Esc */
export function cancelRemoteReauth(): void {
  const req = queue[0];
  if (!req || req.kind !== "reauth") return;
  if (shift(req)) req.fail(t("app.remoteReauth.cancelled"));
}

/** 폴리필의 손잡이 모양 */
interface RemoteUi {
  message(o: { message?: unknown; title?: unknown; kind?: unknown; buttons?: unknown }): Promise<string>;
  reauth(o: { cmd?: unknown; hasMaster?: unknown; submit?: unknown }): Promise<string>;
}

let installed = false;

/** 원격 창 부팅이 한 번 — 폴리필이 앱 모달로 묻게 손잡이를 건다. 집 PC 창이면 아무것도 하지 않는다. */
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
