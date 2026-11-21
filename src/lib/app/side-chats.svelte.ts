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
 * 사이드 채팅 목록의 저장 모양(`sidechat/chats.json` — 불투명 blob, 모양은 `$lib/side-chat`). 채팅의 속은 세션 서버의 채팅 프로세스다
 * (`app/side-chat-live`). 채팅 폴더 경로는 Rust 가 정한다.
 */

let chats = $state<SideChat[]>([]);
let currentId = $state<string | null>(null);
let last = $state<SideChatLast>({ cli: null, byCli: {} });
let booted = false;
/** v1 이 남긴 PTY 스트림 — 아무도 붙지 않아 떨어진 세션으로 남으므로 [`closeLegacySideChatSessions`] 가 닫는다 */
let legacy: string[] = [];

export function sideChats(): readonly SideChat[] {
  return chats;
}

/** 저장은 주 창 · 원격 창만 읽으므로 다른 창에서는 늘 `null` */
export function sideChatConvMarkOf(agent: string, id: string): { forked: boolean } | null {
  return sideChatConvMark(chats, agent, id);
}

export function currentSideChat(): SideChat | null {
  return chats.find((c) => c.id === currentId) ?? null;
}

export function lastSideChatPick(): SideChatLast {
  return last;
}

function chatDir(id: string): Promise<string> {
  return invoke<string>("side_chat_dir", { id });
}

/** 구분자 `/` — 대화 면이 상대 경로 그림을 풀 기준 */
export function sideChatDir(id: string): Promise<string> {
  return chatDir(id);
}

// ── 저장 ──
// 주 창과 원격 창이 같은 `chats.json` 을 고친다 — Rust 가 판 번호(`rev`)를 쥐고, 낡은 `baseRev` 의 쓰기는 `[stale-list]` 로 거절한다.
// 거절 · 바뀜 알림이면 다시 읽어 이 창이 `base` 에서 바꾼 것만 다시 얹는다(`mergeSideChats`). 원격 창의 고른 채팅은 파일에 쓰지 않는다(localStorage).

let saveTimer: ReturnType<typeof setTimeout> | null = null;
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
    tiles: c.tiles.map((x) => ({ ...x })),
    forkedFrom: c.forkedFrom ? { ...c.forkedFrom } : null,
  };
}

/** 원격 창의 `current` 는 파일의 것 그대로 — 파일의 `current` 는 주 창 것이다 */
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

async function loadFile(): Promise<{ file: ReturnType<typeof parseSideChats>; rev: number } | null> {
  try {
    const r = await invoke<{ json: string | null; rev: number }>("side_chats_load");
    return { file: parseSideChats(r?.json ?? null), rev: typeof r?.rev === "number" ? r.rev : 0 };
  } catch {
    return null;
  }
}

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

async function onChanged(changedRev: unknown): Promise<void> {
  if (!booted || saving || changedRev === rev) return;
  if (!(await refresh())) return;
  if (saveTimer === null && !same(fileView(), base)) scheduleSave();
}

function same(a: SideChatList, b: SideChatList): boolean {
  return serializeSideChats(a) === serializeSideChats(b);
}

/** 주 창 · 원격 창에서만 */
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
  // v1 의 `stream` 칸을 걷은 모양으로 한 번 다시 쓴다
  if (legacy.length > 0) scheduleSave();
}

/** Rust `side_chat::store::CHANGED_EVENT` 와 같은 값 */
const SIDE_CHATS_CHANGED = "side-chats-changed";

/** 복원 알림(`restoreDoneSessions`) 뒤에 불러야 한다 — 그때야 아무도 데려가지 않은 v1 세션이 "떨어진" 것이 된다 */
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

// ── 조작 ──

/** 띄우지 않는다 — 첫 보내기 때 서버가 띄운다 */
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
    tiles: [],
    forkedFrom: null,
    cwd: "",
  };
  chats.push(chat);
  currentId = id;
  last = rememberSideChatPick(last, chat.cli, chat.model, chat.effort);
  scheduleSave();
  return chats[chats.length - 1];
}

/** 서버가 이미 연 채팅을 적는다 — `cwd` 는 서버가 알린 폴더의 이름표일 뿐이다 */
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
    tiles: [],
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

export function noteSideChatSent(id: string, text: string): void {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  if (!c.used.includes(c.cli)) c.used = [...c.used, c.cli];
  if (c.title === "" && !text.trimStart().startsWith("/")) c.title = sideChatTitleFrom(text);
  c.usedAt = Date.now();
  scheduleSave();
}

export function noteSideChatConversation(id: string, cli: string, conv: string): void {
  const c = chats.find((x) => x.id === id);
  if (!c || !sideChatConvOk(conv) || c.links[cli] === conv.toLowerCase()) return;
  c.links = { ...c.links, [cli]: conv.toLowerCase() };
  scheduleSave();
}

/** 저장만 — 서버 op 는 부르는 쪽(`app/side-chat-live` 의 `setSideChatLinks`) */
export function setSideChatTiles(id: string, tiles: readonly SideChatTileLink[]): void {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  if (c.tiles.length === tiles.length && c.tiles.every((x, i) => x.stream === tiles[i].stream && x.name === tiles[i].name)) return;
  c.tiles = tiles.map((x) => ({ ...x }));
  scheduleSave();
}

/** 저장만 — 프로세스는 부르는 쪽(`app/side-chat-live`). 강도 낱말은 CLI 마다 달라 그 CLI 의 기억으로 채운다 */
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

/** 저장만 — 프로세스는 부르는 쪽(`app/side-chat-live`) */
export function setSideChatEffortPick(id: string, effort: string): void {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  c.effort = sideChatEffortOk(effort) ? effort : "";
  last = rememberSideChatPick(last, c.cli, c.model, c.effort);
  scheduleSave();
}

/**
 * 프로세스 닫기(`closeSideChatLive`)는 부르는 쪽이 먼저. 막 닫힌 CLI 가 아직 cwd 를 쥐고 있으면 Windows 가 지우기를 막아 잠깐 뒤에 다시 해 본다.
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

/** Rust `codex_models` 의 답 */
export interface CodexModels {
  configured: string | null;
  models: string[];
  /** 모델 slug → 받는 추론 단계 · 기본 단계. 옛 서버면 없다 */
  levels?: Record<string, { levels: string[]; default: string | null }>;
}

export async function loadCodexModels(): Promise<CodexModels> {
  try {
    return await invoke<CodexModels>("codex_models");
  } catch {
    return { configured: null, models: [] };
  }
}
