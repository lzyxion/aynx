// 사이드 채팅 연결 칩의 순수 층 — 아무것도 부르지 않는다 (docs/log/2026-10-23-side-chat-dock.md 결정 10 · 11).
// 연결은 사람이 고른 타일 묶음이다 — AI 는 MCP 읽기 도구로 그 세션들만 읽고(판정은 서버가 호출 · 타일마다 — 로컬 'AI 읽기 허용' · 원격 호스트
// AI 권한), 앱은 값 · 출력을 대화에 붙여 넣지 않는다(연결이 바뀐 뒤 첫 글 앞의 짧은 머리글만 — 서버가 짓는다).

import type { PaneSpec } from "$lib/session";

/** `stream` = 타일의 `historyStreamId`(서버 거울 · MCP 세션 id) · `name` = 그때의 이름(닫힌 뒤에도 칩이 말하게) */
export interface SideChatTileLink {
  stream: string;
  name: string;
}

/** Rust `tile_env::stream_ok` 와 같은 모양 */
export function linkStreamOk(s: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(s);
}

export const LINK_NAME_MAX = 80;

/** 서버도 같은 수를 넘으면 거절한다(`[too-many-links]`) */
export const SIDE_CHAT_LINK_MAX = 8;

export function parseTileLink(raw: unknown): SideChatTileLink | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stream = typeof o.stream === "string" ? o.stream : "";
  if (!linkStreamOk(stream)) return null;
  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, LINK_NAME_MAX) : "";
  return { stream, name };
}

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

export function withTileLink(
  links: readonly SideChatTileLink[],
  link: SideChatTileLink,
): { links: SideChatTileLink[]; full: boolean } {
  if (links.some((x) => x.stream === link.stream)) return { links: [...links], full: false };
  if (links.length >= SIDE_CHAT_LINK_MAX) return { links: [...links], full: true };
  return { links: [...links, { ...link }], full: false };
}

export function withoutTileLink(links: readonly SideChatTileLink[], stream: string): SideChatTileLink[] {
  return links.filter((x) => x.stream !== stream);
}

/** 이름은 보지 않는다 — 서버 표와 견줄 때 */
export function sameLinkStreams(a: readonly { stream: string }[], b: readonly { stream: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.stream === b[i].stream);
}

/** `[bad-link]` 면 서버는 아무것도 바꾸지 않았다 — 하나씩 더해 보며 받는 것만 남긴다(걸기마다 통째로 놓아 마지막 성공이 서버 표다). */
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

export interface LinkTile {
  paneId: string;
  tabId: string;
  stream: string;
  /** 타일 코드(`p2`) — 머리줄과 같은 글자 */
  code: string;
  name: string;
  kind: "local" | "ssh";
  /** 로컬 = 'AI 읽기 허용' · 원격 = 호스트 AI 권한 읽기 전용 이상 */
  readable: boolean;
  focused: boolean;
  pane?: PaneSpec;
}

/**
 * 타일 표시 이름 하나 — 입력 칸 칩 · 저장 칸 · 서버 머리글 이름(Rust `link_display_name`)이 같은 글자여야 기록 칩과 맞는다.
 * 타일 코드(`p6`)는 넣지 않는다 — F5 · 옮기기에 번호가 바뀌어 기록 칩과 어긋난다.
 */
export function linkTileName(t: Pick<LinkTile, "name">): string {
  return t.name.replace(/\s+/g, " ").trim().slice(0, LINK_NAME_MAX);
}

export function orderLinkTiles<T extends Pick<LinkTile, "focused">>(tiles: readonly T[]): T[] {
  return [...tiles.filter((t) => t.focused), ...tiles.filter((t) => !t.focused)];
}

export interface LinkServerView {
  stream: string;
  readable: boolean;
  closed: boolean;
}

export interface LinkChip {
  stream: string;
  name: string;
  closed: boolean;
  /** `null` = 모름 — 다른 창의 타일인데 서버 답이 아직 없다 */
  readable: boolean | null;
  tile: LinkTile | null;
}

/** 이 창의 타일 목록을 먼저 본다 — 살아 있는 읽기 권한이라 토글하면 곧바로 바뀐다. */
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

export function linkChipIcon(chip: LinkChip): "pane" | "ai-off" | "link" {
  if (chip.closed || chip.readable === false) return "ai-off";
  return chip.tile?.pane ? "pane" : "link";
}

export function linkSendNames(chips: readonly LinkChip[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const c of chips) if (c.name.trim() !== "") out[c.stream] = c.name;
  return Object.keys(out).length > 0 ? out : null;
}

/** 곧장 넘기는 경우(이 탭에 AI 타일이 하나)는 상자가 뜨지 않아 이 줄도 없다 — 그때는 터미널 우클릭 "사이드 채팅에 묻기" 가 길이다. */
export function sideChatAskOffered(a: { mainWindow: boolean; hasChat: boolean; hasCli: boolean }): boolean {
  return a.mainWindow && (a.hasChat || a.hasCli);
}
