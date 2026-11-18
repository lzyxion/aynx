// **사이드 채팅 연결 칩의 순수 층**(v2 5단계 — docs/log/2026-10-23-side-chat-dock.md 결정 10 · 11) — 저장 모양 · 묶음 고치기 · 칩 상태 ·
// 고를 타일의 차례 · [AI에게 묻기] 의 "사이드 채팅" 줄을 낼지. 아무것도 부르지 않는다. 상태는 `app/side-chat-live.svelte.ts`(서버 op
// `side_chat_link`) · `app/side-chats.svelte.ts`(`chats.json` 의 `tiles`), 그림은 `ChatDock.svelte` · `chat/ChatLinkChip.svelte`.
//
// 연결은 **사람이 고른 타일 묶음**(최대 [`SIDE_CHAT_LINK_MAX`] · 연결 순서)이다 — 그 채팅의 AI 는 MCP 읽기 도구로 그 세션들만 읽고(판정은
// 서버가 호출 · 타일마다 — 로컬 'AI 읽기 허용' · 원격 호스트 AI 권한), 앱은 값 · 출력을 대화에 붙여 넣지 않는다(연결이 바뀐 뒤 첫 글 앞의
// 짧은 머리글만 — 서버가 짓는다).

import type { PaneSpec } from "$lib/session";

/** 저장되는 연결 — 타일의 스트림 id(`historyStreamId` — 서버 거울 · MCP 세션 id) + 그때의 이름(닫힌 뒤에도 칩이 말하게) */
export interface SideChatTileLink {
  stream: string;
  name: string;
}

/** 스트림 id 모양 — Rust `tile_env::stream_ok`(영숫자 · `- _ . :` · 128자) */
export function linkStreamOk(s: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(s);
}

/** 이름 상한(글자) — 칩 · 저장 */
export const LINK_NAME_MAX = 80;

/** 한 채팅에 연결할 수 있는 타일 수 — 서버도 같은 수를 넘으면 거절한다(`[too-many-links]`) */
export const SIDE_CHAT_LINK_MAX = 8;

/** 저장 칸 → 모양(틀리면 `null`) */
export function parseTileLink(raw: unknown): SideChatTileLink | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stream = typeof o.stream === "string" ? o.stream : "";
  if (!linkStreamOk(stream)) return null;
  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, LINK_NAME_MAX) : "";
  return { stream, name };
}

/** 저장 칸(배열) → 묶음 — 모양이 틀린 칸은 버리고 같은 스트림은 처음 것만 · 상한에서 자른다 */
export function parseTileLinks(raw: unknown): SideChatTileLink[] {
  if (!Array.isArray(raw)) return [];
  const out: SideChatTileLink[] = [];
  for (const x of raw) {
    if (out.length >= SIDE_CHAT_LINK_MAX) break;
    const link = parseTileLink(x);
    if (link && !out.some((y) => y.stream === link.stream)) out.push(link);
  }
  return out;
}

/** 묶음에 하나 더한다 — 이미 있으면 그대로(자리 · 이름 그대로), 찼으면 더하지 않는다(`full`). 새 배열 */
export function withTileLink(
  links: readonly SideChatTileLink[],
  link: SideChatTileLink,
): { links: SideChatTileLink[]; full: boolean } {
  if (links.some((x) => x.stream === link.stream)) return { links: [...links], full: false };
  if (links.length >= SIDE_CHAT_LINK_MAX) return { links: [...links], full: true };
  return { links: [...links, { ...link }], full: false };
}

/** 묶음에서 그 스트림을 뺀다 — 새 배열 */
export function withoutTileLink(links: readonly SideChatTileLink[], stream: string): SideChatTileLink[] {
  return links.filter((x) => x.stream !== stream);
}

/** 두 묶음이 같은 스트림 · 같은 순서인가(이름은 보지 않는다 — 서버 표와 견줄 때) */
export function sameLinkStreams(a: readonly { stream: string }[], b: readonly { stream: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.stream === b[i].stream);
}

/**
 * **아는 것만 걸기** — 묶음을 통째로 건다(`push` = 서버 op · 부르는 쪽이 준다). 모르는 타일이 섞여 거절되면(`isBad` — `[bad-link]` · 서버는
 * 아무것도 바꾸지 않았다) 하나씩 더해 보며 받는 것만 남기고(걸기마다 묶음을 통째로 놓는다 — 마지막 성공이 서버 표), 하나도 안 되면 빈 묶음을
 * 건다. 답 = 마지막 성공의 보기. 그 밖의 실패는 그대로 던진다.
 */
export async function pushKnownLinks<V>(
  want: readonly string[],
  push: (streams: string[]) => Promise<V[]>,
  isBad: (e: unknown) => boolean,
): Promise<V[]> {
  try {
    return await push([...want]);
  } catch (e) {
    if (!isBad(e) || want.length === 0) throw e;
  }
  const ok: string[] = [];
  let views: V[] | null = null;
  for (const s of want) {
    try {
      views = await push([...ok, s]);
      ok.push(s);
    } catch (e) {
      if (!isBad(e)) throw e;
    }
  }
  return views ?? (await push([]));
}

/** 이 창의 연결할 수 있는 타일 하나(로컬 · SSH 터미널 — 서버 거울에 오르는 것) */
export interface LinkTile {
  paneId: string;
  tabId: string;
  stream: string;
  /** 타일 코드(`p2`) — 머리줄과 같은 글자 */
  code: string;
  /** 타일 이름(머리줄 제목) */
  name: string;
  kind: "local" | "ssh";
  /** 지금 AI 가 이 타일을 읽을 수 있나(로컬 = 'AI 읽기 허용' · 원격 = 호스트 AI 권한 읽기 전용 이상) */
  readable: boolean;
  /** 지금 포커스된 타일 */
  focused: boolean;
  /** 그 타일(고르기 메뉴 줄 · 입력 칸 칩의 앞 그림 = `PaneIcon` — 머리줄 · 탭과 같은 그림) */
  pane?: PaneSpec;
}

/**
 * **칩의 이름** — 타일 표시 이름(머리줄 제목 · `Claude Code` · `PowerShell 7`) **하나**. 입력 칸 칩 · 저장 칸 · 보낼 때 서버에 싣는 머리글 이름
 * (`linkSendNames` → Rust `link_display_name`)이 모두 이 이름이라 기록 칩과 입력 칸 칩이 같은 글자다. 타일 코드(`p6`)는 넣지 않는다 — F5 ·
 * 옮기기에 번호가 바뀌어 보낼 때 굳힌 기록 칩과 어긋났다(10-24 실기 3차). 옛 저장 · 기록의 `p6 로컬` 꼴은 그대로 보인다.
 */
export function linkTileName(t: Pick<LinkTile, "name">): string {
  return t.name.replace(/\s+/g, " ").trim().slice(0, LINK_NAME_MAX);
}

/** 고를 차례 — **지금 포커스된 타일이 맨 위**(기본 제안), 나머지는 탭 · 화면 순서 그대로 */
export function orderLinkTiles<T extends Pick<LinkTile, "focused">>(tiles: readonly T[]): T[] {
  return [...tiles.filter((t) => t.focused), ...tiles.filter((t) => !t.focused)];
}

/** 서버가 아는 연결(스냅숏 · 연결 답) — 칩 판정에 쓰는 칸만 */
export interface LinkServerView {
  stream: string;
  readable: boolean;
  closed: boolean;
}

/** 연결 칩 하나(묶음의 타일 하나) */
export interface LinkChip {
  stream: string;
  name: string;
  /** 타일이 닫혔다(이 창에 없고 서버 거울에도 없다) */
  closed: boolean;
  /** AI 가 읽을 수 있나(`null` = 모름 — 다른 창의 타일인데 서버 답이 아직 없다) */
  readable: boolean | null;
  /** 이 창의 그 타일(읽기 허용 켜기 · 포커스 · 칩 앞 로고) */
  tile: LinkTile | null;
}

/**
 * **칩 상태 — 순수 · 연결 순서대로 타일마다 하나**. 이 창의 타일 목록에서 먼저 찾고(살아 있는 읽기 권한 — 토글하면 곧바로), 없으면 서버가
 * 아는 것(다른 창으로 옮긴 타일 · 거울에 남은 세션)을, 그것도 없거나 서버가 닫혔다고 하면 "닫힘".
 */
export function linkChipStates(
  links: readonly SideChatTileLink[],
  tiles: readonly LinkTile[],
  server: readonly LinkServerView[],
): LinkChip[] {
  return links.map((link): LinkChip => {
    const tile = tiles.find((t) => t.stream === link.stream) ?? null;
    if (tile) return { stream: link.stream, name: linkTileName(tile), closed: false, readable: tile.readable, tile };
    const known = server.find((v) => v.stream === link.stream) ?? null;
    if (known && !known.closed) return { stream: link.stream, name: link.name, closed: false, readable: known.readable, tile: null };
    return { stream: link.stream, name: link.name, closed: true, readable: known ? false : null, tile: null };
  });
}

/**
 * 칩 앞 그림 — 이 창에 있고 열려 있고 읽을 수 있으면 **그 타일의 로고**(`pane` — `PaneIcon`), 닫혔거나 AI 가 못 읽으면 `ai-off`,
 * 이 창에서 타일을 찾지 못했으면 `link`
 */
export function linkChipIcon(chip: LinkChip): "pane" | "ai-off" | "link" {
  if (chip.closed || chip.readable === false) return "ai-off";
  return chip.tile?.pane ? "pane" : "link";
}

/**
 * 보낼 때 서버에 실을 머리글 이름 — 스트림 id → 지금 칩의 이름(빈 이름은 싣지 않는다 · 하나도 없으면 `null` — 서버는 머리글이 필요할
 * 때만 쓰고 없는 타일은 거울 이름으로)
 */
export function linkSendNames(chips: readonly LinkChip[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const c of chips) if (c.name.trim() !== "") out[c.stream] = c.name;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * [AI에게 묻기] 상자에 **"사이드 채팅" 줄**을 낼지 — 독이 있는 주 창이고, 이어 쓸 채팅이 있거나 새로 만들 CLI 가 켜져 있을 때(결정 11).
 * 곧장 넘기는 경우(이 탭에 AI 타일이 하나)는 상자가 뜨지 않으므로 그 줄도 없다 — 그때는 터미널 우클릭 "사이드 채팅에 묻기" 가 길이다.
 */
export function sideChatAskOffered(a: { mainWindow: boolean; hasChat: boolean; hasCli: boolean }): boolean {
  return a.mainWindow && (a.hasChat || a.hasCli);
}
