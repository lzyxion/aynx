import { toast } from "$lib/toast.svelte.js";
import { showNotice } from "$lib/app/notice";
import { isAgentPane } from "$lib/app/agent-status.svelte.js";
import { stageAgentFiles, stageFsPaths } from "$lib/agent-attachments";
import { flipViewOf } from "$lib/pane/ai-flip.svelte.js";
import { baseName } from "$lib/pane/composer-attachments";
import { stageComposerAttachments } from "$lib/pane/composer-attachments.svelte.js";
import { fsDragActive, shellQuoteAll, type FsDrag } from "$lib/fs-drag";
import { fsDropAction, sessionOfFsKey } from "$lib/fs-drop-route";
import { broadcastInput } from "$lib/sync.svelte.js";
import { termActionsOf } from "$lib/term-actions";
import { promptsBlocking } from "$lib/app/prompts.svelte.js";
import {
  forgetFocusOrigin,
  rememberFocusOrigin,
  returnFocus,
} from "$lib/app/focus-return.svelte.js";
import { hostFormOpen } from "$lib/app/hosts.svelte.js";
import { activeSessionId, fsDropRouteTo, liveSession, sessionOf } from "$lib/app/sessions.svelte.js";
import { bumpSftpRefresh, sftpDirOf } from "$lib/app/panes.svelte.js";
import { focusTile, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { localBackend, LOCAL_KEY } from "$lib/fs-backend";
import { notifyFsRefresh } from "$lib/fs-refresh.svelte";
import { setPaneForwards } from "$lib/app/forwards.svelte.js";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import {
  addForward,
  invalidPort,
  listForwards,
  type ForwardKind,
  type ForwardPreset,
} from "$lib/forward";
import {
  editRemoteFile,
  isAlreadyExists,
  uploadDirValue,
  uploadFile,
  uploadVerb,
  DEFAULT_REMOTE_DIR,
  type UploadTarget,
  type UploadState,
  type UploadVerb,
} from "$lib/sftp";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import { findPane, hasSession, paneName, type SessionKind } from "$lib/session";

/**
 * **세션 하나에 매달린 모달 셋** — 포트 포워딩 · 파일 업로드/가져오기 · 원격 파일 편집.
 *
 * 셋 다 재료가 같다 (`app/sessions` 의 패널→세션 표) 그리고 성질도 같다: **대상 세션이
 * 사라지면 창을 닫는다.** 죽은 id 로는 목록도 추가도 전송도 뜻이 없기 때문이다 (업로드만
 * 예외 — 전송 중에는 닫지 않는다. 끝나고 그 줄에 오류가 남아야 무슨 일이 있었는지 보인다).
 *
 * ## 모달 우선순위의 꼬리
 *
 * 호스트 키 → 비밀번호 → 호스트 폼 → **포워딩 → 업로드 → 원격 편집** 순이다. 업로드가
 * 편집보다 앞인 이유: 파일을 떨어뜨리는 것이 더 즉각적인 조작이라 그 답이 먼저 보여야 한다.
 * 앞머리 둘은 각각 `promptsBlocking()` 과 `hostFormOpen()` 이라, 이 파일은 그 둘만 읽는다.
 *
 * `$effect` 는 여기 없다 — "세션이 죽었으면 닫기" 는 몸통만 두고
 * (`closeIfSessionGone`) 효과는 `+page.svelte` 가 건다.
 */

// ===========================================================================
// 포트 포워딩 (4단계 · docs/log/2026-09-01-port-forward.md)
// ===========================================================================

/**
 * 포커스 복귀 이름표 셋 (`app/focus-return`) — 셋 다 닫히면 키보드가 원래 치던 타일로 돌아간다.
 * 세션이 죽어 **저절로** 닫히는 경로도 같은 문을 지난다 (그때는 대개 사람이 이미 다른 곳을
 * 치고 있고, 그 판정은 `app/focus-return` 이 한다).
 */
const FOCUS_FORWARD = "forward";
const FOCUS_UPLOAD = "upload";
const FOCUS_REMOTE_EDIT = "remote-edit";

// 이 모달은 **추가 전용**이다 (2026-10-11). 걸려 있는 목록 · 줄 동작(중지 · 브라우저에서 열기)은 머리줄 포워딩 칩의
// 목록 메뉴(`pane/forward-menu.svelte.ts` → `app/forwards`)로 옮겼다 — 그래서 예전의 목록 폴링(2초)도 없다.
// 여는 길은 둘: 그 메뉴의 "포워딩 추가…" · ⋯ 메뉴의 "포트 포워딩…"(포워드가 0개일 때 — 있으면 같은 목록 메뉴가 뜬다).

let forwardOpen = $state(false);
/** 모달이 지금 보고 있는 타일 — 추가한 뒤 칩 표(`app/forwards`)에도 새 목록을 적는다 */
let forwardPane = $state<string | null>(null);

// 머리줄 칩이 읽는 **타일별 포워드 표**(`paneForwards`)와 프리셋을 세션에 반영하는 두 길은
// `app/forwards.svelte.ts` 에 산다 — 호스트 폼(`app/hosts`)도 그 둘을 불러야 하는데 이 파일은
// 그 반대 방향(`hostFormOpen`)으로 이미 얽혀 있어 한곳에 두면 값 순환이 선다.
// 여기서는 모달이 방금 읽은 목록을 칩에도 적는 [`setPaneForwards`] 하나만 쓴다.

/** 폼이 직접 바인딩하는 칸들 (`bind:value` · `bind:this`) */
export const fw = $state<{
  /**
   * 로컬(-L) · 원격(-R) · 동적(-D) — 칸이 무엇을 보여 줄지가 이것 하나로 갈린다. 모달을 열 때마다
   * 로컬로 돌아간다(가장 흔한 것이고, 지난번 종류가 남아 있으면 다른 뜻의 칸에 치게 된다).
   */
  kind: ForwardKind;
  localPort: number | null;
  /** DB 포워딩의 전형이라 기본값을 넣어 둔다 (원격 서버에서 본 "localhost") */
  remoteHost: string;
  remotePort: number | null;
  error: string | null;
  busy: boolean;
  firstField: HTMLInputElement | null;
}>({
  kind: "local",
  localPort: null,
  remoteHost: "localhost",
  remotePort: null,
  error: null,
  busy: false,
  firstField: null,
});

/** 우선순위는 호스트 키 → 비밀번호 → 호스트 폼 → 포워딩 순이다 */
export function forwardVisible(): boolean {
  return forwardOpen && !promptsBlocking() && !hostFormOpen();
}

async function refreshForwards(): Promise<void> {
  const sid = activeSessionId();
  if (sid === null || forwardPane === null) return;
  // 모달에서 건 것이 머리줄 칩(과 그 목록 메뉴)에도 곧바로 보여야 한다 (같은 목록이다).
  setPaneForwards(forwardPane, await listForwards(sid));
}

/** 활성 패널의 세션에 포워드를 거는 폼을 연다 (모달 자체는 언제나 활성 패널을 본다) */
function openForward(): void {
  if (activeSessionId() === null) return;
  fw.error = null;
  fw.kind = "local";
  fw.localPort = null;
  fw.remoteHost = "localhost";
  fw.remotePort = null;
  forwardOpen = true;
}

/**
 * **포워딩 추가 모달** — 머리줄 포워딩 칩 메뉴의 "포워딩 추가…" 와 ⋯ 메뉴의 "포트 포워딩…"(포워드 0개일 때)
 * (docs/log/2026-09-05-titlebar-cleanup.md).
 *
 * 모달은 지금도 **활성 패널의 세션**을 본다(`activeSessionId`) — 추가가 그
 * 한 값에 매여 있어 대상을 둘로 늘리면 상태가 갈린다. 그래서 여기서는 대상을 바꾸는 대신
 * **가리킨 타일을 먼저 활성으로 만든다**.
 */
export function openForwardFor(tabId: string, paneId: string): void {
  // **타일을 옮기기 전에** 적는다 — 돌아갈 자리는 이 대화상자의 대상이 아니라 방금까지
  // 키보드를 쥐고 있던 타일이다 (`app/focus-return` 머리말).
  rememberFocusOrigin(FOCUS_FORWARD);
  focusTile(tabId, paneId);
  if (activeSessionId() === null) {
    forgetFocusOrigin(FOCUS_FORWARD); // 열리지 않았다 — 적어 둔 자리도 없던 일로
    showNotice(t("files.transfer.connecting"));
    return;
  }
  forwardPane = paneId;
  openForward();
}

export function closeForward(): void {
  forwardOpen = false;
  fw.error = null;
  forwardPane = null;
  returnFocus(FOCUS_FORWARD);
}

/** 세션이 사라지면(탭 전환·재연결·종료) 모달을 닫는다 — 죽은 id 로는 뜻이 없다 */
export function closeForwardIfSessionGone(): void {
  if (!forwardVisible() || activeSessionId() !== null) return;
  forwardOpen = false;
  returnFocus(FOCUS_FORWARD);
}

export async function submitForward(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  const sid = activeSessionId();
  if (sid === null || fw.busy) return;

  // 종류마다 보는 칸이 다르다 — 감춘 칸의 값은 보지도 보내지도 않는다
  // (`forward.ts` 의 `parseForwardRow` · Rust `port_forward::validate` 와 같은 규칙).
  if (invalidPort(fw.localPort)) {
    fw.error = t("files.transfer.forward.localport");
    return;
  }
  if (fw.kind !== "dynamic" && invalidPort(fw.remotePort)) {
    fw.error = t("files.transfer.forward.remoteport");
    return;
  }
  const host = fw.kind === "local" ? fw.remoteHost.trim() : "";
  if (fw.kind === "local" && host === "") {
    fw.error = t("files.transfer.forward.remotehost");
    return;
  }
  const preset: ForwardPreset = {
    kind: fw.kind,
    local_port: fw.localPort as number,
    remote_host: host,
    remote_port: fw.kind === "dynamic" ? 0 : (fw.remotePort as number),
  };

  fw.busy = true;
  fw.error = null;
  try {
    await addForward(sid, preset, t);
    await refreshForwards();
    // 걸었으면 닫는다 — 목록이 없는 추가 전용 모달이라 남아 있어도 보여 줄 것이 없고, 걸린 것은 머리줄 칩이 말한다.
    closeForward();
  } catch (e) {
    fw.error = e instanceof Error ? e.message : String(e);
  } finally {
    fw.busy = false;
  }
}


// ===========================================================================
// 업로드 / 가져오기 (5단계 · docs/log/2026-09-02-sftp.md)
//
// 파일을 **한 번에 하나씩** 올린다. SFTP 채널이 세션당 하나이고 요청 파이프라이닝이 없어서
// (docs/verification/russh.md 5절) 동시에 밀어 넣어 봐야 빨라지지 않고, 진행 표시("n/m")와
// 실패한 파일만 골라 재시도하는 흐름만 어려워진다.
// ===========================================================================

/** 업로드 목록의 한 줄 */
export interface UploadItem {
  file: File;
  /**
   * 목적지에 따라 진행 중 값이 갈린다 (`uploading` ↔ `copying` — `uploadVerb`).
   * **언어를 타지 않는 값**이고 글자는 `files.transfer.state.<값>` 이다 (`sftp.ts`).
   */
  state: UploadState;
  error: string | null;
  /** 같은 이름이 이미 있어 거절됐다 — 이 줄에만 [덮어쓰기] 를 붙인다 */
  exists: boolean;
}

let uploadOpen = $state(false);
let target = $state<UploadTarget | null>(null);
let items = $state<UploadItem[]>([]);

/** 모달이 바인딩하는 칸들 */
export const up = $state<{
  /** 어느 패널로 올리는지 (모달 본문 — 여러 서버가 떠 있을 때 대상을 헷갈리면 안 된다) */
  pane: string;
  dir: string;
  busy: boolean;
  dirField: HTMLInputElement | null;
}>({ pane: "", dir: DEFAULT_REMOTE_DIR, busy: false, dirField: null });

export function uploadVisible(): boolean {
  return uploadOpen && !promptsBlocking() && !hostFormOpen() && !forwardVisible();
}

export function uploadTarget(): UploadTarget | null {
  return target;
}

export function uploadItems(): UploadItem[] {
  return items;
}

/** 목적지에 따라 갈리는 글자들 — 로직은 한 벌이고 말만 다르다 */
export function verb(): UploadVerb {
  return uploadVerb(target);
}

/** 진행 표시 — 올라간 파일 수 */
export function uploadDone(): number {
  return items.filter((i) => i.state === "done").length;
}

export function uploadFailed(): number {
  return items.filter((i) => i.state === "error").length;
}

/**
 * 패널 위에 OS 파일을 떨어뜨렸다 (`PaneHost` → 여기).
 * 대상은 **그 패널의 세션**이다 — 활성 패널이 아니라 놓은 자리가 뜻을 정한다.
 */
async function attachFiles(tabId: string, paneId: string, files: File[]): Promise<void> {
  if (files.length === 0) return;
  await pasteAttachment(tabId, paneId, files.map((file) => ({ name: file.name, file })), (kind, sid) =>
    stageAgentFiles(kind, sid, files, t),
  );
}

/**
 * AI 타일 입력창에 **첨부 경로를 괄호 붙여넣기**로 넣는다 — OS 드롭(`attachFiles`)과 파일 타일 드롭(`dropFsPaths`)의 공통 끝.
 * `stage` 가 그 타일이 읽을 수 있는 경로들을 마련하는 동안 타일이 닫히거나 재접속하거나 셸로 돌아오면 붙이지 않는다.
 *
 * 그 타일이 **대화 면**을 보이고 있으면(2026-10-24) 입력 줄 대신 대화 면 입력 칸의 첨부 칩으로 넣는다(`shown` = 칩의 이름 · 미리보기 —
 * 사본 · 업로드는 같은 `stage`) — 경로는 보낼 때 같은 괄호 붙여넣기로 들어간다(`pane/AiFlip` 의 `send`).
 */
async function pasteAttachment(
  tabId: string,
  paneId: string,
  shown: readonly { name: string; file?: File }[],
  stage: (kind: SessionKind, sid: number) => Promise<readonly string[]>,
): Promise<void> {
  const currentPane = () => {
    const tab = residentWindowTabs().find((tab) => tab.id === tabId);
    return tab ? findPane(tab.root, paneId) : null;
  };
  const pane = currentPane();
  const sid = sessionOf(paneId);
  const api = termActionsOf(paneId);
  if (!pane || !hasSession(pane.kind) || !isAgentPane(pane) || sid === null || !api?.bracketedPaste()) {
    showNotice(t("pane.drop.attach.notready"));
    return;
  }
  if (flipViewOf(paneId) === "convo") {
    const kind = pane.kind;
    focusTile(tabId, paneId);
    await stageComposerAttachments(paneId, shown, () => stage(kind, sid), () => {
      const now = currentPane();
      return !!now && isAgentPane(now) && sessionOf(paneId) === sid;
    });
    return;
  }
  try {
    const paths = await stage(pane.kind, sid);
    // 저장 중 닫히거나 재접속하거나 셸로 돌아온 타일에는 사본 경로를 보내지 않는다.
    const now = currentPane();
    if (!now || !isAgentPane(now) || sessionOf(paneId) !== sid || termActionsOf(paneId) !== api) {
      showNotice(t("pane.drop.attach.notready"));
      return;
    }
    if (api.insertText(`${shellQuoteAll(paths)} `) !== "ok") {
      showNotice(t("pane.drop.attach.notready"));
      return;
    }
    focusTile(tabId, paneId);
    api.focus();
  } catch (e) {
    showNotice(t("pane.drop.attach.failed", { message: stripReason(e instanceof Error ? e.message : String(e)) }));
  }
}

/**
 * 파일 타일에서 끈 경로 묶음을 터미널 타일에 놓았다 (`PaneHost` 의 `onfspaste` → 여기).
 *
 * 판정은 `fs-drop-route.ts` 의 표다: 같은 곳이면 셸에는 예전처럼 경로를 입력하고(동시 입력 규칙 그대로, 엔터 없음)
 * AI 타일에는 첨부처럼 괄호 붙여넣기로 이 타일에만 넣는다. 다른 곳의 파일은 AI 타일이면 사본을 그 자리로 옮겨
 * 붙이고, 셸이면 안내만 한다(그 경로는 이 터미널에서 없는 파일이다).
 *
 * 창을 넘은 드래그인지(`fsDragActive`)는 **동기로** 지금 읽는다 — 드롭이 끝나면 끌기 쪽이 그 값을 지운다.
 */
export function pasteFsDrag(tabId: string, paneId: string, drag: FsDrag): void {
  const sameWindow = fsDragActive() !== null;
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!pane || !hasSession(pane.kind) || drag.paths.length === 0) return;
  const action = fsDropAction(fsDropRouteTo(pane, drag, sameWindow), isAgentPane(pane), pane.kind);
  /** 대화 면 칩의 이름(경로만 있다 — 미리보기 없이 파일 아이콘) */
  const named = drag.paths.map((p) => ({ name: baseName(p) }));
  switch (action.kind) {
    case "notice":
      showNotice(t(action.key));
      return;
    case "broadcast":
      broadcastInput([paneId], shellQuoteAll(drag.paths));
      return;
    case "paste":
      void pasteAttachment(tabId, paneId, named, async () => drag.paths);
      return;
    case "upload":
      // 대상 서버 = 놓는 타일의 세션 (`pasteAttachment` 가 넘겨 준다)
      void pasteAttachment(tabId, paneId, named, (_, sid) => stageFsPaths("upload", sid, drag.paths, t));
      return;
    case "download": {
      // 출처 서버 = 짐의 키 (`fsDropRoute` 가 `download` 를 낸 이상 번호가 있다)
      const source = sessionOfFsKey(drag.backendKey);
      if (source === null) return;
      void pasteAttachment(tabId, paneId, named, () => stageFsPaths("download", source, drag.paths, t));
      return;
    }
  }
}

export function dropFiles(tabId: string, paneId: string, files: File[]): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!pane) return;

  if (hasSession(pane.kind) && isAgentPane(pane)) {
    void attachFiles(tabId, paneId, files);
    return;
  }

  /*
   * SFTP 타일에 놓으면 **그 브라우저가 보고 있는 폴더**로 간다 — 세션은 원본 터미널의 것을
   * 빌리고, 목적지는 브라우저가 올려 준 cwd 다. 홈(`~/`)으로 보내면 브라우저를 열어 원하는
   * 자리까지 찾아 들어간 일이 통째로 무의미해진다.
   */
  if (pane.kind === "sftp") {
    const dir = sftpDirOf(paneId);
    if (!dir) {
      showNotice(t("files.transfer.drop.loading"));
      return;
    }
    openUploadTo(paneId, paneName(pane, t), dir, files);
    return;
  }

  /*
   * **로컬 파일 타일** — 그 브라우저가 보고 있는 폴더로 복사한다 (SFTP 타일과 같은 몸짓,
   * 다른 목적지). 목적지는 타일이 `onlocalcwd` 로 올려 둔 `PaneSpec.path` 다 — 그 값이
   * 없으면 "내 PC"(합성 루트)를 보고 있다는 뜻이라 놓을 자리가 없다.
   */
  if (pane.kind === "localfs") {
    const dir = pane.path;
    if (!dir) {
      showNotice(t("files.transfer.drop.root"));
      return;
    }
    // 라벨이 곧 목적지다 — 로컬 타일에는 "어느 서버" 가 없으므로 폴더 자신이 그 자리를 쓴다.
    openUploadTo(paneId, dir, dir, files);
    return;
  }

  if (pane.kind !== "ssh") {
    showNotice(t("files.transfer.drop.sshonly"));
    return;
  }
  if (sessionOf(paneId) === null) {
    showNotice(t("files.transfer.drop.connecting"));
    return;
  }
  openUploadTo(paneId, paneName(pane, t), DEFAULT_REMOTE_DIR, files);
}

/**
 * 업로드 모달을 **어느 패널의 세션으로, 어느 폴더에** 열지 정해 띄운다.
 *
 * 진입점 셋(터미널 드롭 · 브라우저 타일 드롭 · 브라우저의 ⬆ 버튼)이 여기로 모인다 —
 * 덮어쓰기 확인·부분 실패 재시도·진행 표시가 전부 이 모달 하나에 이미 있으므로, 브라우저가
 * 자기 업로드 UI 를 따로 만들 이유가 없다.
 *
 * `owner` 는 세션을 **빌려 오는 자리**를 정한다: SFTP 타일이면 원본 터미널의 세션을,
 * 터미널이면 자기 세션을 쓴다. 여기서 한 번 더 조회하는 이유는 SFTP 타일 자신은 세션 표에
 * 등록돼 있지 않기 때문이다 (자기 세션이 없다).
 */
export function openUploadTo(paneId: string, label: string, dir: string, files: File[]): void {
  const tab = residentWindowTabs().find((t) => findPane(t.root, paneId) !== null);
  const pane = tab ? findPane(tab.root, paneId) : null;
  // 로컬 타일에는 빌려 올 세션이 없다 — 목적지가 내 디스크라 물어볼 것도 없다.
  if (pane?.kind === "localfs") {
    target = { kind: "local" };
  } else {
    const owner = pane?.kind === "sftp" ? (pane.sourcePaneId ?? "") : paneId;
    const sid = sessionOf(owner);
    if (sid === null) {
      showNotice(t("files.transfer.upload.offline"));
      return;
    }
    target = { kind: "remote", session: sid };
  }
  if (!uploadOpen) rememberFocusOrigin(FOCUS_UPLOAD);
  up.pane = label;
  up.dir = dir;
  items = files.map((file) => ({
    file,
    state: "waiting" as const,
    error: null,
    exists: false,
  }));
  up.busy = false;
  uploadOpen = true;
}

export function closeUpload(): void {
  if (up.busy) return; // 올리는 중에는 닫지 않는다 (닫아도 전송은 계속되므로 혼란만 준다)
  uploadOpen = false;
  returnFocus(FOCUS_UPLOAD);
}

/**
 * 세션이 사라지면 업로드 창도 닫는다 (포워딩과 같은 이유).
 * **업로드 중에는 닫지 않는다**: 전송이 끝나고 그 줄에 오류가 남아야 무슨 일이 있었는지 보인다.
 * 로컬 목적지에는 끊길 세션이 없으므로 이 검사는 원격일 때만 뜻이 있다.
 */
export function closeUploadIfSessionGone(): void {
  // 이름이 `t` 가 아닌 이유: 사전을 읽는 `t()` 를 가린다
  const dest = target;
  if (uploadVisible() && !up.busy && dest?.kind === "remote" && !liveSession(dest.session)) {
    uploadOpen = false;
    returnFocus(FOCUS_UPLOAD);
    showNotice(t("files.transfer.upload.sessiongone"));
  }
}

/** 한 줄을 올린다. 실패는 그 줄에만 적는다 — 나머지 파일은 계속 올라간다 */
async function uploadOne(
  item: UploadItem,
  to: UploadTarget,
  dir: string,
  overwrite: boolean,
): Promise<void> {
  item.state = verb().ing;
  item.error = null;
  item.exists = false;
  try {
    if (to.kind === "local") {
      // 로컬은 백엔드 어댑터를 지난다 (`local_write_file`). 정책 값은 붙여넣기와 같은 것을
      // 쓰므로 [덮어쓰기] 재시도가 저쪽과 한 글자도 다르지 않다.
      await localBackend().uploadBytes?.(dir, item.file, overwrite ? "overwrite" : "fail", t);
    } else {
      await uploadFile(to.session, dir, item.file, overwrite, t);
    }
    item.state = "done";
    // 한 줄이 올라갈 때마다 알린다 (모달이 닫힐 때가 아니라) — 여러 파일을 올리는 동안
    // 브라우저 목록이 차례로 채워지는 편이, 다 끝난 뒤 한꺼번에 나타나는 것보다 "지금 무슨
    // 일이 일어나는지" 가 잘 읽힌다. 실패한 줄은 올리지 않으므로 헛돌지 않는다.
    if (to.kind === "local") notifyFsRefresh(LOCAL_KEY);
    else bumpSftpRefresh();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    item.state = "error";
    // 화면에 찍는 것은 **이유 코드를 뗀 줄**이고, 갈래는 그 코드로 가른다
    // (`$lib/error-reason`).
    item.error = stripReason(message);
    item.exists = isAlreadyExists(message);
  }
}

export async function submitUpload(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  const to = target;
  if (to === null || up.busy) return;
  const dir = uploadDirValue(up.dir, to);

  up.busy = true;
  for (const item of items) {
    // 이미 올라간 것은 건너뛴다 — [올리기] 를 다시 누르는 것은 **실패한 것만** 재시도다
    if (item.state === "done") continue;
    await uploadOne(item, to, dir, false);
  }
  up.busy = false;

  if (uploadFailed() === 0 && items.length > 0) {
    // 성공은 **성공의 결**로 말한다 (창이 닫히므로 그 자리에 남길 것도 없다).
    const text = t(verb().done, { n: items.length, dir });
    toast.success(text);
    recordNotification({ kind: "transfer", text, level: "success" }); // 알림 센터의 지난 알림
    uploadOpen = false;
    returnFocus(FOCUS_UPLOAD);
  }
}

/** "이미 있습니다" 로 막힌 줄만 덮어쓰기로 다시 올린다 */
export async function retryOverwrite(item: UploadItem): Promise<void> {
  const to = target;
  if (to === null || up.busy) return;
  up.busy = true;
  await uploadOne(item, to, uploadDirValue(up.dir, to), true);
  up.busy = false;
}

// ===========================================================================
// 원격 파일 편집
// ===========================================================================

let editOpen = $state(false);
let editSession = $state<number | null>(null);

export const ed = $state<{
  pane: string;
  path: string;
  error: string | null;
  busy: boolean;
  field: HTMLInputElement | null;
}>({ pane: "", path: "", error: null, busy: false, field: null });

export function remoteEditVisible(): boolean {
  return (
    editOpen && !promptsBlocking() && !hostFormOpen() && !forwardVisible() && !uploadVisible()
  );
}

/**
 * 타일 헤더 ⋯ 메뉴의 "원격 파일 편집…" 과 `Ctrl+Shift+E` — 그 패널의 세션에서 원격 파일을 연다.
 *
 * 두 진입점 모두 **패널 id 로** 들어오므로 활성 패널을 다시 계산할 필요가 없다. 예전에는
 * 탭 바의 ✎(활성 패널로 같은 모달)까지 셋이었는데, 헤더가 기본으로 늘 붙게 되고
 * (docs/log/2026-09-05-tile-header.md) 그 헤더의 ⋯ 메뉴가 항목을 들면서 근거가 사라졌다.
 */
export function openRemoteEdit(tabId: string, paneId: string): void {
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  const pane = tab ? findPane(tab.root, paneId) : null;
  if (!pane) return;
  if (pane.kind !== "ssh") {
    showNotice(t("files.transfer.edit.sshonly"));
    return;
  }
  const sid = sessionOf(paneId);
  if (sid === null) {
    showNotice(t("files.transfer.connecting"));
    return;
  }
  if (!editOpen) rememberFocusOrigin(FOCUS_REMOTE_EDIT);
  editSession = sid;
  ed.pane = paneName(pane, t);
  ed.path = "";
  ed.error = null;
  editOpen = true;
}

export function closeRemoteEdit(): void {
  editOpen = false;
  ed.error = null;
  returnFocus(FOCUS_REMOTE_EDIT);
}

/** 세션이 사라지면 편집 창도 닫는다 */
export function closeRemoteEditIfSessionGone(): void {
  if (!remoteEditVisible() || editSession === null || liveSession(editSession)) return;
  editOpen = false;
  returnFocus(FOCUS_REMOTE_EDIT);
}

export async function submitRemoteEdit(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  const sid = editSession;
  if (sid === null || ed.busy) return;
  const path = ed.path.trim();
  if (path === "") {
    ed.error = t("files.transfer.edit.path");
    return;
  }
  ed.busy = true;
  ed.error = null;
  try {
    const info = await editRemoteFile(sid, path);
    editOpen = false;
    returnFocus(FOCUS_REMOTE_EDIT);
    showNotice(t("files.transfer.edit.opened", { name: info.file_name }));
  } catch (e) {
    ed.error = e instanceof Error ? e.message : String(e);
  } finally {
    ed.busy = false;
  }
}
