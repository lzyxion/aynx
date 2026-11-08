// **사이드 채팅 연결 칩의 순수 층**(v2 5단계 — docs/log/2026-10-23-side-chat-dock.md 결정 10 · 11) — 저장 모양 · 칩 상태 · 고를 타일의 차례 ·
// [AI에게 묻기] 의 "사이드 채팅" 줄을 낼지. 아무것도 부르지 않는다. 상태는 `app/side-chat-live.svelte.ts`(서버 op `side_chat_link`) ·
// `app/side-chats.svelte.ts`(`chats.json` 의 `tile`), 그림은 `ChatDock.svelte`.
//
// 연결은 **사람이 칩으로 고른 타일 하나**다 — 그 채팅의 AI 는 MCP 읽기 도구로 그 세션만 읽고(판정은 서버가 호출마다 — 로컬 'AI 읽기 허용' ·
// 원격 호스트 AI 권한), 앱은 값 · 출력을 대화에 붙여 넣지 않는다(연결이 바뀐 뒤 첫 글 앞의 짧은 머리글만 — 서버가 짓는다).

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

/** 저장 칸 → 모양(틀리면 `null`) */
export function parseTileLink(raw: unknown): SideChatTileLink | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stream = typeof o.stream === "string" ? o.stream : "";
  if (!linkStreamOk(stream)) return null;
  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, LINK_NAME_MAX) : "";
  return { stream, name };
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
}

/**
 * **칩의 이름** — 타일 표시 이름(머리줄 제목 · `Claude Code` · `PowerShell 7`) **하나**. 입력 칸 칩 · 저장 칸 · 보낼 때 서버에 싣는 머리글 이름
 * (`linkSendName` → Rust `link_display_name`)이 모두 이 이름이라 기록 칩과 입력 칸 칩이 같은 글자다. 타일 코드(`p6`)는 넣지 않는다 — F5 ·
 * 옮기기에 번호가 바뀌어 보낼 때 굳힌 기록 칩과 어긋났다(10-24 실기 3차). 옛 저장 · 기록의 `p6 로컬` 꼴은 그대로 보인다.
 */
export function linkTileName(t: Pick<LinkTile, "name">): string {
  return t.name.replace(/\s+/g, " ").trim().slice(0, LINK_NAME_MAX);
}

/** 고르기 메뉴의 줄 — 지금 코드 + 이름(`p2 PowerShell 7` — 같은 이름의 타일을 가려 고르게. 칩 · 머리글에는 쓰지 않는다) */
export function linkTilePickLabel(t: Pick<LinkTile, "code" | "name">): string {
  return `${t.code} ${linkTileName(t)}`.replace(/\s+/g, " ").trim();
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

/** 칩 상태 */
export type LinkChip =
  | { kind: "none" }
  | {
      kind: "linked";
      name: string;
      /** 타일이 닫혔다(이 창에 없고 서버 거울에도 없다) */
      closed: boolean;
      /** AI 가 읽을 수 있나(`null` = 모름 — 다른 창의 타일인데 서버 답이 아직 없다) */
      readable: boolean | null;
      /** 이 창의 그 타일(읽기 허용 켜기 · 포커스) */
      tile: LinkTile | null;
    };

/**
 * **칩 상태 — 순수**. 이 창의 타일 목록에서 먼저 찾고(살아 있는 읽기 권한 — 토글하면 곧바로), 없으면 서버가 아는 것(다른 창으로 옮긴
 * 타일 · 거울에 남은 세션)을, 그것도 없거나 서버가 닫혔다고 하면 "닫힘".
 */
export function linkChipState(
  link: SideChatTileLink | null,
  tiles: readonly LinkTile[],
  server: LinkServerView | null,
): LinkChip {
  if (!link) return { kind: "none" };
  const tile = tiles.find((t) => t.stream === link.stream) ?? null;
  if (tile) return { kind: "linked", name: linkTileName(tile), closed: false, readable: tile.readable, tile };
  const known = server && server.stream === link.stream ? server : null;
  if (known && !known.closed) return { kind: "linked", name: link.name, closed: false, readable: known.readable, tile: null };
  return { kind: "linked", name: link.name, closed: true, readable: known ? false : null, tile: null };
}

/** 보낼 때 서버에 실을 머리글 이름 — 지금 칩의 이름(연결 없음이면 `null` — 서버는 머리글이 필요할 때만 쓴다 · 없으면 거울 이름) */
export function linkSendName(chip: LinkChip): string | null {
  return chip.kind === "linked" && chip.name.trim() !== "" ? chip.name : null;
}

/**
 * [AI에게 묻기] 상자에 **"사이드 채팅" 줄**을 낼지 — 독이 있는 주 창이고, 이어 쓸 채팅이 있거나 새로 만들 CLI 가 켜져 있을 때(결정 11).
 * 곧장 넘기는 경우(이 탭에 AI 타일이 하나)는 상자가 뜨지 않으므로 그 줄도 없다 — 그때는 터미널 우클릭 "사이드 채팅에 묻기" 가 길이다.
 */
export function sideChatAskOffered(a: { mainWindow: boolean; hasChat: boolean; hasCli: boolean }): boolean {
  return a.mainWindow && (a.hasChat || a.hasCli);
}
