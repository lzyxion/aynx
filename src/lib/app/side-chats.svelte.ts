import { invoke, isRemote, listen } from "../ipc";
import { hasReason } from "$lib/error-reason";
import { parseDetached } from "$lib/session/detached";
import {
  cloneSideChatLast,
  legacySideChatStream,
  rememberSideChatPick,
  mergeSideChats,
  newSideChatId,
  parseSideChats,
  serializeSideChats,
  sideChatConvMark,
  sideChatConvOk,
  sideChatEffortOk,
  sideChatModelOk,
  sideChatSwitchPick,
  sideChatTitleFrom,
  type SideChat,
  type SideChatLast,
  type SideChatList,
} from "$lib/side-chat";
import type { SideChatTileLink } from "$lib/side-chat-link";

/**
 * **사이드 채팅 목록의 상태** (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md 구현 순서 2 · v2 4단계) — 채팅 독(`ChatDock.svelte`)이
 * 그리는 채팅들의 **저장 모양**(id · CLI · 모델 · 추론 강도 · 제목 · 시각 · CLI 별 대화 id).
 *
 * v2(docs/log/2026-10-23-side-chat-v2-design.md)부터 채팅의 속은 **세션 서버의 채팅 프로세스**다(`app/side-chat-live.svelte.ts` —
 * 구조화 모드 · 사건 통로). 이 모듈은 타일 · PTY · 세션 id 를 모른다 — v1 의 "워크스페이스 밖 AI 타일 명세" 와 그것을 함께 보던 곳
 * (`app/sessions` · `app/agent-status` · `app/tabs` · `finish-notify`)의 손은 걷었다.
 *
 * ## 저장 — 워크스페이스 밖(결정 "(가)") · 주 창 · 원격 창
 *
 * `<데이터 루트>/sidechat/chats.json`(Rust `side_chat/store.rs` — 불투명 blob, 모양은 `$lib/side-chat`). 채팅마다 폴더 `sidechat/<id>/` 가
 * 그 CLI 의 cwd 다(서버가 띄울 때 쓴다 · 경로는 Rust 가 정한다). 부팅이 사람 창(주 창 · 원격 창 — 2026-11-01)에서 [`bootSideChats`] 를 부른다.
 * 두 창이 함께 고치는 규칙은 아래 "여러 창이 함께 고친다".
 *
 * ## v1 에서 옮기기(설계 6절)
 *
 * v1 은 채팅마다 PTY 세션(`sidechat-*` 스트림)을 띄웠다. 이제 아무도 그 세션에 붙지 않아 떨어진 세션으로 남으므로, 주 창 부팅이 복원 알림
 * 뒤에 [`closeLegacySideChatSessions`] 로 **한 번** 닫는다(저장의 `stream` 칸 + 떨어진 세션 목록의 그 머리 — 기존 닫기 길
 * `close_detached_session` · 지금 떨어진 것만). `stream` 칸은 읽고 버린다(다음 저장에서 빠진다). 몇 번 불려도 같다(닫을 것이 없으면 그냥 끝).
 *
 * 이 모듈은 잎에 가깝다(ipc · 순수 층만) — 상태 점 · CLI 목록 · 지금 턴은 독이 읽어 넘긴다.
 */

let chats = $state<SideChat[]>([]);
let currentId = $state<string | null>(null);
let last = $state<SideChatLast>({ cli: null, byCli: {} });
let booted = false;
/** v1 이 남긴 스트림(부팅에서 읽은 것) — [`closeLegacySideChatSessions`] 가 쓴다 */
let legacy: string[] = [];

/** 이 창의 채팅들(저장 순서) — 반응형 */
export function sideChats(): readonly SideChat[] {
  return chats;
}

/**
 * 그 대화가 사이드 채팅의 것인가(지난 대화 목록의 표지 — 순수 `sideChatConvMark`) — 반응형. 저장은 주 창만 읽으므로 다른 창에서는 늘 `null`
 * (표지 없이 예전 그대로).
 */
export function sideChatConvMarkOf(agent: string, id: string): { forked: boolean } | null {
  return sideChatConvMark(chats, agent, id);
}

/** 지금 고른 채팅 — 반응형 */
export function currentSideChat(): SideChat | null {
  return chats.find((c) => c.id === currentId) ?? null;
}

/** 새 채팅의 기본(마지막에 쓴 CLI · CLI 마다 모델 · 강도 — 고르기는 순수 `sideChatNewDefault`) */
export function lastSideChatPick(): SideChatLast {
  return last;
}

/** 채팅의 폴더(없으면 만든다) — 경로는 Rust 가 정한다 */
function chatDir(id: string): Promise<string> {
  return invoke<string>("side_chat_dir", { id });
}

/**
 * 그 채팅의 폴더(`sidechat/<id>/` — 없으면 만든다 · 구분자 `/`) — 갈라 오지 않은 채팅 CLI 의 cwd. 대화 면이 에이전트 말 속 **상대 경로
 * 그림**을 풀 기준으로 쓴다(`SideChatFace` — 2026-10-24). 기존 명령 `side_chat_dir` 하나(새 명령 없음)
 */
export function sideChatDir(id: string): Promise<string> {
  return chatDir(id);
}

// ---------------------------------------------------------------------------
// 저장 — 바뀔 때마다 조금 뒤 한 번(같은 글자면 Rust 가 디스크를 건드리지 않는다)
// ---------------------------------------------------------------------------

// ## 여러 창이 함께 고친다(2026-11-01 — 원격 웹 창의 사이드 채팅)
//
// 주 창과 원격 창이 같은 `chats.json` 을 고친다. Rust 가 판 번호를 쥔다: 읽기 `{json, rev}` · 쓰기 `{json, baseRev}` 가 지금 판이 아니면
// `[stale-list]`(쓰지 않음) · 쓰면 모든 창에 본문 없는 `side-chats-changed{rev}`. 이 창은 마지막으로 읽은(쓴) 파일(`base`)을 쥐고,
// 거절되거나 알림을 받으면 다시 읽어 **이 창이 `base` 에서 바꾼 것만** 다시 얹는다(순수 `mergeSideChats`). 고른 채팅(`current`)은 창마다다 —
// 원격 창은 파일에 쓰지 않고 이 브라우저의 localStorage 에 둔다(파일의 `current` 는 주 창 것 그대로).

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 마지막으로 읽은(쓴) 파일과 그 판 */
let base: SideChatList = { current: null, last: { cli: null, byCli: {} }, chats: [] };
let rev = 0;
let saving = false;
let saveAgain = false;

const REMOTE_CURRENT_KEY = "aynx:side-chat-current";

function cloneChat(c: SideChat): SideChat {
  return {
    ...c,
    links: { ...c.links },
    used: [...c.used],
    tile: c.tile ? { ...c.tile } : null,
    forkedFrom: c.forkedFrom ? { ...c.forkedFrom } : null,
  };
}

/** 이 창이 파일에 쓸 모양 — 원격 창의 `current` 는 파일의 것 그대로(창마다 고른 채팅) */
function fileView(): SideChatList {
  return {
    current: isRemote ? base.current : currentId,
    last: cloneSideChatLast(last),
    chats: chats.map(cloneChat),
  };
}

function rememberRemoteCurrent(): void {
  if (!isRemote) return;
  try {
    if (currentId === null) localStorage.removeItem(REMOTE_CURRENT_KEY);
    else localStorage.setItem(REMOTE_CURRENT_KEY, currentId);
  } catch {
    // 저장소가 막힌 브라우저 — 다음에 열면 파일의 고른 채팅으로 선다
  }
}

function remoteCurrent(): string | null {
  try {
    return localStorage.getItem(REMOTE_CURRENT_KEY);
  } catch {
    return null;
  }
}

/** 파일을 읽는다 — 실패는 `null` */
async function loadFile(): Promise<{ file: ReturnType<typeof parseSideChats>; rev: number } | null> {
  try {
    const r = await invoke<{ json: string | null; rev: number }>("side_chats_load");
    return { file: parseSideChats(r?.json ?? null), rev: typeof r?.rev === "number" ? r.rev : 0 };
  } catch {
    return null;
  }
}

/** 다시 읽고 이 창의 바뀜을 다시 얹는다(상태에 반영 · `base` · `rev` 를 새 파일로). 읽지 못하면 거짓 */
async function refresh(): Promise<boolean> {
  const got = await loadFile();
  if (!got) return false;
  const theirs: SideChatList = { current: got.file.current, last: got.file.last, chats: got.file.chats };
  const merged = mergeSideChats(base, fileView(), theirs);
  chats = merged.chats;
  last = merged.last;
  if (isRemote) {
    if (currentId === null || !chats.some((c) => c.id === currentId)) currentId = chats[0]?.id ?? null;
  } else {
    currentId = merged.current;
  }
  base = theirs;
  rev = got.rev;
  return true;
}

/** 쓴다 — `[stale-list]` 면 다시 읽어 얹고 다시 쓴다(몇 번까지). 겹친 부름은 하나로 모은다 */
async function flush(): Promise<void> {
  if (saving) {
    saveAgain = true;
    return;
  }
  saving = true;
  try {
    for (let tries = 0; tries < 4; tries++) {
      const mine = fileView();
      try {
        const r = await invoke<{ rev: number }>("side_chats_save", { json: serializeSideChats(mine), baseRev: rev });
        rev = typeof r?.rev === "number" ? r.rev : rev;
        base = mine;
        return;
      } catch (e) {
        if (!hasReason(String(e), "stale-list")) {
          console.warn("[aynx] 사이드 채팅 저장 실패:", e);
          return;
        }
        if (!(await refresh())) return;
      }
    }
    console.warn("[aynx] 사이드 채팅 저장 실패: 다른 창과 계속 겹칩니다");
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      scheduleSave();
    }
  }
}

function scheduleSave(): void {
  if (!booted) return;
  rememberRemoteCurrent();
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flush();
  }, 300);
}

/** 다른 창이 목록을 썼다(`side-chats-changed{rev}`) — 다시 읽고, 이 창에 아직 쓰지 않은 바뀜이 있으면 다시 쓴다 */
async function onChanged(changedRev: unknown): Promise<void> {
  if (!booted || saving || changedRev === rev) return;
  if (!(await refresh())) return;
  if (saveTimer === null && !same(fileView(), base)) scheduleSave();
}

function same(a: SideChatList, b: SideChatList): boolean {
  return serializeSideChats(a) === serializeSideChats(b);
}

/** **부팅**(주 창 · 원격 창) — 저장된 채팅들을 되살리고 다른 창의 바뀜 알림을 듣는다. 실패는 빈 목록으로 삼킨다(독은 빈 채로 선다) */
export async function bootSideChats(): Promise<void> {
  if (booted) return;
  const got = await loadFile();
  const file = got?.file ?? parseSideChats(null);
  chats = file.chats;
  last = file.last;
  base = { current: file.current, last: cloneSideChatLast(file.last), chats: file.chats.map(cloneChat) };
  rev = got?.rev ?? 0;
  const mineCurrent = isRemote ? remoteCurrent() : null;
  currentId = mineCurrent !== null && chats.some((c) => c.id === mineCurrent) ? mineCurrent : file.current;
  // v1 옮기기는 주 창 몫(원격 창은 읽고 버리기만)
  legacy = isRemote ? [] : file.legacyStreams;
  booted = true;
  void listen<{ rev?: unknown }>(SIDE_CHATS_CHANGED, (e) => void onChanged(e.payload?.rev)).catch(() => {});
  // v1 의 `stream` 칸을 걷은 모양으로 한 번 다시 쓴다(같은 글자면 디스크를 건드리지 않는다)
  if (legacy.length > 0) scheduleSave();
}

/** 목록이 바뀌었다는 알림(Rust `side_chat::store::CHANGED_EVENT` — 본문 없음 · `{rev}`) */
const SIDE_CHATS_CHANGED = "side-chats-changed";

/**
 * **v1 PTY 세션을 한 번 닫는다**(설계 6절) — 주 창 부팅이 복원 알림(`restoreDoneSessions`) **뒤에** 부른다(그때 아무도 데려가지 않은 v1 세션이
 * "떨어진" 것이 된다). 대상 = 저장의 `stream` 칸 + 떨어진 세션 목록 중 `sidechat-` 머리. 닫기는 기존 길(`close_detached_session` — 지금
 * 떨어져 있을 때만). 실패는 삼킨다(남으면 떨어진 세션 목록에서 사람이 닫는다). 닫은 수.
 */
export async function closeLegacySideChatSessions(): Promise<number> {
  const streams = new Set(legacy);
  legacy = [];
  try {
    for (const row of parseDetached(await invoke("detached_sessions"))) {
      if (legacySideChatStream(row.stream)) streams.add(row.stream);
    }
  } catch {
    // 서버 불통 — 저장의 것만
  }
  let closed = 0;
  for (const stream of streams) {
    try {
      if ((await invoke<boolean>("close_detached_session", { stream })) === true) closed++;
    } catch {
      // 다음 부팅이 떨어진 세션 목록에서 다시 본다
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// 조작 — 독이 부른다
// ---------------------------------------------------------------------------

/** 새 채팅 — 고른 CLI · 모델 · 강도로 적고 그 채팅을 고른다(띄우지 않는다 — 첫 보내기 때 서버가 띄운다). 폴더를 못 만들면 throw */
export async function newSideChat(cli: string, model: string, effort = ""): Promise<SideChat> {
  const id = newSideChatId();
  await chatDir(id);
  const chat: SideChat = {
    id,
    cli,
    model: sideChatModelOk(model) ? model : "",
    effort: sideChatEffortOk(effort) ? effort : "",
    title: "",
    createdAt: Date.now(),
    usedAt: 0,
    used: [],
    links: {},
    tile: null,
    forkedFrom: null,
    cwd: "",
  };
  chats.push(chat);
  currentId = id;
  last = rememberSideChatPick(last, chat.cli, chat.model, chat.effort);
  scheduleSave();
  return chats[chats.length - 1];
}

/**
 * **갈라 온 채팅을 적는다**(6단계 "타일 대화 이어 가기") — 서버가 이미 연 채팅(`side_chat_open{fork}` 가 원본과 폴더를 확인했다)을 목록에 넣고
 * 고른다. `id` 는 연 그 id · `cwd` 는 서버가 알린 폴더의 이름표. 채팅 폴더(`sidechat/<id>/` — 서버 임시 자리 · 지우기의 단위)도 만든다
 */
export async function addForkedSideChat(a: {
  id: string;
  cli: string;
  model: string;
  effort: string;
  title: string;
  forkedFrom: { agent: string; conv: string };
  cwd: string;
}): Promise<SideChat> {
  await chatDir(a.id);
  const chat: SideChat = {
    id: a.id,
    cli: a.cli,
    model: sideChatModelOk(a.model) ? a.model : "",
    effort: sideChatEffortOk(a.effort) ? a.effort : "",
    title: a.title.slice(0, 200),
    createdAt: Date.now(),
    usedAt: 0,
    used: [],
    links: {},
    tile: null,
    forkedFrom: { agent: a.forkedFrom.agent, conv: a.forkedFrom.conv.toLowerCase() },
    cwd: a.cwd.slice(0, 1024),
  };
  chats.push(chat);
  currentId = chat.id;
  scheduleSave();
  return chats[chats.length - 1];
}

export function selectSideChat(id: string): void {
  if (!chats.some((c) => c.id === id) || currentId === id) return;
  currentId = id;
  scheduleSave();
}

export function renameSideChat(id: string, title: string): void {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  c.title = title.trim().slice(0, 200);
  scheduleSave();
}

/** 입력 칸으로 보냈다 — 그 CLI 로 대화를 시작한 것으로 적고 제목이 비었으면 첫 질문으로 짓는다(`/` 로 시작하면 제목이 되지 않는다) */
export function noteSideChatSent(id: string, text: string): void {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  if (!c.used.includes(c.cli)) c.used = [...c.used, c.cli];
  if (c.title === "" && !text.trimStart().startsWith("/")) c.title = sideChatTitleFrom(text);
  c.usedAt = Date.now();
  scheduleSave();
}

/** 그 CLI 의 대화 id 를 적는다(턴이 선 대화만 — 다음 열기의 이어 가기) */
export function noteSideChatConversation(id: string, cli: string, conv: string): void {
  const c = chats.find((x) => x.id === id);
  if (!c || !sideChatConvOk(conv) || c.links[cli] === conv.toLowerCase()) return;
  c.links = { ...c.links, [cli]: conv.toLowerCase() };
  scheduleSave();
}

/** **연결 칩**(5단계)을 적는다 — 타일의 스트림 · 그때 이름(`null` = 끊기). 서버 op 는 부르는 쪽(`app/side-chat-live` 의 `linkSideChat`) */
export function setSideChatTile(id: string, tile: SideChatTileLink | null): void {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  if (c.tile?.stream === tile?.stream && c.tile?.name === tile?.name) return;
  c.tile = tile ? { ...tile } : null;
  scheduleSave();
}

/**
 * CLI · 모델을 바꿔 적는다(프로세스는 부르는 쪽 — `app/side-chat-live`). CLI 가 바뀌면 그 CLI 의 기억으로 채운다(순수 `sideChatSwitchPick` —
 * 모델은 받은 값이 있으면 그것, 없으면 기억 · 강도는 그 CLI 의 기억 — 낱말이 CLI 마다 다르다). 결과는 그 CLI 의 기억에 다시 적는다
 */
export function setSideChatPick(id: string, cli: string, model: string): void {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  const pick = sideChatSwitchPick(c, last, cli, model);
  c.cli = cli;
  c.model = pick.model;
  c.effort = pick.effort;
  last = rememberSideChatPick(last, c.cli, c.model, c.effort);
  scheduleSave();
}

/** 추론 강도를 바꿔 적는다(빈 값 = CLI 기본 · 프로세스는 부르는 쪽 — `app/side-chat-live`) */
export function setSideChatEffortPick(id: string, effort: string): void {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  c.effort = sideChatEffortOk(effort) ? effort : "";
  last = rememberSideChatPick(last, c.cli, c.model, c.effort);
  scheduleSave();
}

/**
 * **지운다** — 목록에서 빼고(프로세스 닫기는 부르는 쪽이 먼저 — `closeSideChatLive`) 그 채팅의 폴더를 지운다(Rust 가 그 폴더 하나만 ·
 * 링크가 있으면 거절). 막 닫힌 CLI 가 아직 cwd 를 쥐고 있으면 Windows 가 지우기를 막으므로 잠깐 뒤에 다시 해 본다. 그래도 안 되면 throw
 * (폴더만 남는다 — 목록에서는 이미 빠졌다).
 */
export async function deleteSideChat(id: string): Promise<void> {
  const at = chats.findIndex((c) => c.id === id);
  if (at < 0) return;
  chats.splice(at, 1);
  if (currentId === id) currentId = chats[Math.min(at, chats.length - 1)]?.id ?? null;
  scheduleSave();
  let err: unknown = null;
  for (const wait of [0, 1500, 4000]) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      await invoke("side_chat_remove", { id });
      return;
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

/** Codex 모델 — Rust `codex_models`(Codex 자신의 모델 캐시 · `config.toml` 의 `model` 을 읽기만 — 프로세스 없음) */
export interface CodexModels {
  configured: string | null;
  models: string[];
  /** 보이는 모델 slug → 그 모델이 받는 추론 단계 · 기본 단계(AI 타일 대화 면의 Codex 모델 메뉴 — 2026-11-14). 옛 서버면 없다 */
  levels?: Record<string, { levels: string[]; default: string | null }>;
}

/** 칩 메뉴를 열 때 부른다 — 파일 둘을 읽을 뿐이라 매번 새로 읽는다. 실패하면 빈 값 */
export async function loadCodexModels(): Promise<CodexModels> {
  try {
    return await invoke<CodexModels>("codex_models");
  } catch {
    return { configured: null, models: [] };
  }
}
