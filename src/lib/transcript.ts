import type { TranscriptItem, TranscriptLink, TranscriptPicture, TranscriptTool } from "$lib/context";

/**
 * **기록 보기의 순수 층** — 에이전트 말의 가벼운 마크다운 읽기 · 도구 한 줄 · 키 판정
 * (docs/log/2026-09-27-conversation-viewer.md). 그림은 `ConversationViewer.svelte`.
 *
 * ## 마크다운은 **구조만** 읽는다 — HTML 은 만들지 않는다
 *
 * 에이전트 말은 문단 · 코드 블록 · 인라인 코드 · 목록 · 제목 · 인용 · 표 정도를 쓴다. 여기서는 그것을
 * **블록과 인라인 토막의 목록**으로만 나누고, 화면은 그 목록을 Svelte 의 글자 보간(`{text}`)으로 그린다 —
 * `{@html}` 이 없으니 본문의 `<script>` · `<img onerror>` 는 **글자 그대로** 보인다. 링크도 글자다(자동으로
 * 열지 않는다). 모르는 문법은 문단 글자로 떨어진다(잃는 것이 없다).
 *
 * 파서 본체는 `$lib/markdown`(문서 보기 타일과 공용), 그림은 `MarkdownBlocks.svelte`. 링크를 여는 것은 그리는 쪽
 * (`TranscriptBody` 의 `onlink` — `http`/`https` 만 · 그냥 클릭, 2026-10-25)이다.
 */

// 마크다운 파서는 `markdown.ts` 로 옮겼다(문서 보기 타일과 나눠 쓴다) — 예전 이름으로도 부를 수 있게 다시 내보낸다
export { parseInline, parseMarkdown } from "$lib/markdown";
export type { MdBlock, MdInline } from "$lib/markdown";

/** 도구 한 줄의 두 칸 — 이름(없으면 `null` = 호출을 못 만난 결과)과 요약(없으면 빈 글자). MCP 도구 `mcp__<서버>__<도구>`(Claude 꼴 —
 *  사이드 채팅의 Codex 도 같은 꼴로 낸다)는 `<서버> · <도구>` 로 읽기 쉽게(2026-10-25). */
export function toolHeadline(tool: TranscriptTool): { name: string | null; summary: string } {
  return { name: tool.name.trim() === "" ? null : mcpToolLabel(tool.name), summary: tool.summary };
}

/** `mcp__<서버>__<도구>` → `<서버> · <도구>`(첫 `__` 에서 가른다) · 그 밖의 이름은 그대로 */
export function mcpToolLabel(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? `${m[1]} · ${m[2]}` : name;
}

/** 도구 줄의 표지 — 거절됨(권한에서 막혀 돌지 않았다)이 실패보다 앞선다. 잘 끝났거나 아직 결과가 없으면 `null` */
export function toolFlag(tool: TranscriptTool): "denied" | "error" | null {
  if (tool.denied) return "denied";
  return tool.error ? "error" : null;
}

/**
 * 알약(프로듀서 채팅)을 펼쳐 보인 도구 줄이 열렸나 — **실패한 줄은 기본으로 열린다**(접힌 줄은 "실패" 만 보여 까닭 = 결과 칸의 서버 거절 코드 ·
 * 오류 글이 숨었다 — 실기 33). 사람이 누르면 뒤집힌다. 알약에 들지 않은 줄(사이드 채팅 · 기록 보기)은 누른 대로.
 */
export function pillToolOpen(tool: TranscriptTool | null | undefined, pilled: boolean, toggled: boolean): boolean {
  return toggled !== (pilled && !!tool && toolFlag(tool) === "error");
}

/**
 * 사람 말 위의 **연결 칩**(사이드 채팅 — 연결 머리글이 알린 것) — 사전 열쇠와 이름. 세션 id 는 없다(Rust 가 싣지 않는다).
 * 이름이 비면 이름 없는 연결, 끊었으면 "연결 끊음", 머리글이 없었으면 `null`(칩 없음).
 */
export function linkChip(
  link: TranscriptLink | null | undefined,
): { key: "board.viewer.link" | "board.viewer.link.bare" | "board.viewer.unlinked"; label: string } | null {
  if (!link) return null;
  if (link.unlinked) return { key: "board.viewer.unlinked", label: "" };
  if (typeof link.label !== "string") return null;
  const label = link.label.trim();
  return label === "" ? { key: "board.viewer.link.bare", label: "" } : { key: "board.viewer.link", label };
}

/** 더 오래된 쪽을 앞에 붙인다 — 새 배열(항목은 그대로 — 화면이 붙인 열쇠도 따라간다) */
export function prependItems<T>(older: readonly T[], current: readonly T[]): T[] {
  return [...older, ...current];
}

/**
 * 두 항목이 **같은 사건**인가 — 따라가기([`mergeLatestPage`])가 겹침을 찾는 열쇠. 도구의 결과 · 오류 표시는 보지 않는다
 * (결과는 호출보다 늦게 붙는다 — 같은 호출이 처음엔 결과 없이, 다음 번엔 결과와 함께 온다).
 */
export function sameTranscriptItem(a: TranscriptItem, b: TranscriptItem): boolean {
  if (a.role !== b.role || a.at !== b.at || a.text !== b.text || a.images !== b.images) return false;
  if (a.tool === null || b.tool === null) return a.tool === b.tool;
  return a.tool.name === b.tool.name && a.tool.summary === b.tool.summary && a.tool.input === b.tool.input;
}

/** 최신 쪽의 앞 몇 항목까지 겹침의 시작으로 볼까 — 쪽 경계의 고아 결과(호출이 쪽 밖) 몇 개를 건너뛴다 */
const MERGE_SKIP_MAX = 3;

/**
 * **따라가기의 이어 붙이기** — 지금 쥔 목록(`current`, 오래된 것부터)의 꼬리가 새로 받은 최신 쪽(`latest`)의 앞부분과
 * 겹치는 자리를 찾는다. 찾으면 `{ at, skip }`: 결과 = `current[0..at)` + `latest[skip..]` 이고, `current[at..]` 은
 * `latest[skip..]` 의 앞과 같은 사건이다(부르는 쪽이 그 자리의 열쇠를 이어 쓴다 — 펼침 상태가 따라간다). 겹침이 없으면
 * (쪽 하나보다 많이 쌓였다 · 파일이 바뀌었다) `null` — 부르는 쪽이 최신 쪽으로 갈아 끼운다.
 *
 * Rust 의 쪽은 바이트 커서로 끝에서 거꾸로 자르므로 항목에 고유 id 가 없다 — 그래서 내용(시각 · 글 · 도구 이름 · 요약 ·
 * 입력)으로 맞춘다. `current` 가 비었으면 `{ at: 0, skip: 0 }`(그대로 받는다).
 */
export function mergeLatestPage(
  current: readonly TranscriptItem[],
  latest: readonly TranscriptItem[],
): { at: number; skip: number } | null {
  if (current.length === 0) return { at: 0, skip: 0 };
  if (latest.length === 0) return null;
  for (let skip = 0; skip < Math.min(MERGE_SKIP_MAX + 1, latest.length); skip++) {
    // 가장 앞의 일치부터 = 가장 긴 겹침 — 뒤에서부터 찾으면 같은 글이 되풀이될 때 짧은 가짜 겹침에 걸려 항목이 겹쳐 선다
    for (let at = 0; at < current.length; at++) {
      if (!sameTranscriptItem(current[at], latest[skip])) continue;
      const tail = current.length - at;
      if (tail > latest.length - skip) continue;
      let ok = true;
      for (let i = 1; i < tail; i++) {
        if (!sameTranscriptItem(current[at + i], latest[skip + i])) {
          ok = false;
          break;
        }
      }
      if (ok) return { at, skip };
    }
  }
  return null;
}

/**
 * **도는 도구** — 기록 맨 끝에 이어 붙은 도구 줄 가운데 아직 결과가 없는 것의 차례(타일 대화 면의 스피너). 끝의 도구 줄 묶음만
 * 본다 — 뒤에 말(사용자 · 에이전트)이 이어졌으면 그 앞의 도구는 끝난 것으로 친다(결과 없이 끊긴 호출이 영영 돌지 않게). 한 턴의
 * 병렬 호출은 여럿이 함께 돈다.
 */
export function runningToolIndexes(items: readonly TranscriptItem[]): number[] {
  const out: number[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.role !== "tool" || it.tool === null) break;
    if (it.tool.output === null) out.push(i);
  }
  return out.reverse();
}

/**
 * **기록 뒤에 붙는 지금 턴의 줄**(사이드 채팅 v2 — `TranscriptBody` 의 `live`). `item` 이 있으면 기록과 같은 그림, 없으면 부르는 쪽의 카드
 * (`liveCard(key)` — 권한 묻기 · 알림). `spinning` = 아직 끝나지 않은 도구(스피너).
 */
export interface LiveRow {
  key: string;
  item: TranscriptItem | null;
  spinning?: boolean;
  /** 흐리게(보내고 아직 받지 않은 사람 말) */
  dim?: boolean;
  /** 사람 말 밑의 한 줄(보내는 중 · 보내지 못함) */
  note?: string | null;
  /** 아직 자라는 모델 글 — 닫히지 않은 울타리는 다이어그램으로 그리지 않는다(`splitOpenFence`) */
  streaming?: boolean;
  /** 사람 말과 함께 보낸 첨부 이름(입력 칸 칩 — 기록에 들기 전의 꼬리) */
  files?: readonly string[];
  /** 그중 이 창이 보낸 그림의 미리보기(`SentPic` — 이름 칩 대신 그림으로 · 기록의 `upic` 과 같은 모양) */
  sentPics?: readonly { name: string; url: string }[];
}

/**
 * **턴이 도는 동안 받은 기록을 어디서 자를까**(사이드 채팅 v2) — 그 쪽에는 이미 지금 턴의 앞부분이 들어 있어 꼬리(`live`)와 겹친다.
 * 돌려준 수만큼만 그린다(`null` = 자르지 않는다). `hold` 가 없으면 자르지 않는다.
 * - `userText` 가 있으면(이 페이지에서 보낸 말이 꼬리에 있다) 기록의 마지막 사람 말이 **그 글일 때만** 그 말부터 자른다(아직 기록에
 *   안 적혔으면 겹칠 것이 없다 — 앞 턴을 자르지 않는다).
 * - `userText` 가 `null` 이면(F5 — 꼬리에 내 말이 없다) 마지막 사람 말 **뒤**부터 자른다(그 말은 기록이 그린다).
 */
export function liveCut(
  items: readonly TranscriptItem[],
  hold: { userText: string | null } | null,
  same: (sent: string, recorded: string | null) => boolean,
): number | null {
  if (!hold) return null;
  let at = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].role === "user") {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  if (hold.userText === null) return at + 1;
  return same(hold.userText, items[at].text) ? at : null;
}

/** 기록 보기 키 —대시보드의 줄 · 시작 화면의 줄에서 **수식 없는 `V`**(물리 키 — 한글 자판의 ㅍ 도 같다) */
export const VIEW_KEY = "KeyV";

export function isViewKey(ev: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; isComposing?: boolean }): boolean {
  return ev.code === VIEW_KEY && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && !ev.isComposing;
}

/**
 * **사용자 말의 붙여넣기 꼬리표를 걷는다** (10-20) — Claude Code 는 괄호 붙여넣기로 받은 글을 기록에
 * `<pasted_content id="…">` … `</pasted_content id="…">` 로 감싸 적는다(대화 면 입력 칸의 여러 줄 보내기가 바로 그 길이다).
 * 사람이 보는 것은 안의 글이므로 꼬리표와 그 바로 안쪽 줄바꿈만 걷는다 — 짝이 맞지 않는 꼬리표는 손대지 않는다.
 */
export function unwrapPasted(text: string): string {
  return text.replace(/<pasted_content id="([^"]*)">\r?\n?([\s\S]*?)\r?\n?<\/pasted_content id="\1">/g, "$2");
}

/**
 * **에이전트 답 복사의 자리와 글**(대화 면 · 사이드 채팅 — `TranscriptBody` 의 `copyable`, 2026-11-14): 한 턴(사람 말 하나 뒤의 에이전트 줄 전부)마다
 * 그 턴의 **마지막 에이전트 줄 id → 복사할 글**. 글은 그 턴의 에이전트 말(마크다운 원문 그대로)만 빈 줄로 잇는다 — 도구 줄 · 끊김 표식은 자리만
 * 차지하고 글에는 없다. 글이 없는 턴은 뺀다. 끝 턴은 `lastDone` 일 때만(답을 아직 쓰는 중이면 단추가 없다).
 */
export function agentTurnCopies(seq: readonly { id: string; item: TranscriptItem }[], lastDone: boolean): Map<string, string> {
  const out = new Map<string, string>();
  let texts: string[] = [];
  let last: string | null = null;
  const flush = () => {
    if (last !== null && texts.length > 0) out.set(last, texts.join("\n\n"));
    texts = [];
    last = null;
  };
  for (const { id, item } of seq) {
    if (item.role === "user") {
      flush();
      continue;
    }
    last = id;
    if (item.role === "assistant" && item.text && item.text.trim() !== "") texts.push(item.text.trim());
  }
  if (lastDone) flush();
  return out;
}

/** 사람 말에 바로 실린 그림 자리의 열쇠(그 대화 파일 안에서 하나 — 줄 시작 · 길이 · 차례) */
export function pictureKey(p: TranscriptPicture): string {
  return `${p.at}:${p.len}:${p.n}`;
}

/**
 * 사람 말의 그림 중 **그리지 못하는 수** — "그림 N" 칩의 N. 자리가 없는 것(주소 그림 · 모르는 형식 · 그림 그리기를 넘기지 않은 화면)과
 * 자리는 있지만 못 읽은 것(`failed` — 그 자리의 열쇠가 실패면 참). `showing` 이 거짓이면(그림을 그리지 않는 화면) 전부 칩이다.
 */
export function hiddenImageCount(item: TranscriptItem, showing: boolean, failed: (p: TranscriptPicture) => boolean): number {
  const pics = showing ? (item.pictures ?? []) : [];
  return Math.max(0, item.images - pics.length) + pics.filter(failed).length;
}

/**
 * **사람 말 맨 앞의 그림 자리표 떼기**(2026-11-14 사용자 결정) — CLI 가 붙여 넣은 그림을 바꾼 `[Image #N]` 가 글 **맨 앞에 이어져** 있고 그 말의
 * 그림이 **모두** 그려질 때(`drawn` — 그릴 수 없는 그림 · "그림 N" 칩 · 실패가 하나도 없다)만 그 자리표들을 뗀 글. 아니면 글 그대로(가운데 자리표 ·
 * 사람이 쓴 닮은 글은 맨 앞 꼴이 아니면 그대로). **순수**.
 */
export function withoutImagePlaceholders(text: string, drawn: boolean): string {
  if (!drawn) return text;
  const m = /^(?:\[Image #\d+\](?: |$))+/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** 쪽들(받은 항목 + 꼬리)의 사람 말에 실린 그림 자리들 — 겹치면 하나 */
export function userPictures(items: Iterable<TranscriptItem>): TranscriptPicture[] {
  const out = new Map<string, TranscriptPicture>();
  for (const it of items) if (it.role === "user") for (const p of it.pictures ?? []) out.set(pictureKey(p), p);
  return [...out.values()];
}
