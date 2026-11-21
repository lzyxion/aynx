import type { TranscriptItem, TranscriptLink, TranscriptPicture, TranscriptTool } from "$lib/context";

/**
 * 기록 보기의 순수 층 — 도구 한 줄 · 따라가기 겹침 · 지금 턴 꼬리 · 키 판정.
 * 에이전트 말은 구조만 읽고 HTML 을 만들지 않는다 — `{@html}` 이 없어 본문의 `<script>` · `<img onerror>` 는 글자 그대로 보인다(파서는 `$lib/markdown`).
 */

// 예전 이름으로도 부를 수 있게 다시 내보낸다
export { parseInline, parseMarkdown } from "$lib/markdown";
export type { MdBlock, MdInline } from "$lib/markdown";

/** 이름이 없으면 `null`(= 호출을 못 만난 결과) */
export function toolHeadline(tool: TranscriptTool): { name: string | null; summary: string } {
  return { name: tool.name.trim() === "" ? null : mcpToolLabel(tool.name), summary: tool.summary };
}

export function mcpToolLabel(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? `${m[1]} · ${m[2]}` : name;
}

/** 거절됨(권한에서 막혀 돌지 않았다)이 실패보다 앞선다 */
export function toolFlag(tool: TranscriptTool): "denied" | "error" | null {
  if (tool.denied) return "denied";
  return tool.error ? "error" : null;
}

/** 알약(프로듀서 채팅)에 든 실패한 줄은 기본으로 열린다 — 접히면 까닭(서버 거절 코드 · 오류 글)이 숨는다. 누르면 뒤집힌다 */
export function pillToolOpen(tool: TranscriptTool | null | undefined, pilled: boolean, toggled: boolean): boolean {
  return toggled !== (pilled && !!tool && toolFlag(tool) === "error");
}

/** 사람 말 위의 연결 칩들(타일마다 하나 · 연결 순서). 세션 id 는 없다 — Rust 가 싣지 않는다 */
export function linkChips(
  link: TranscriptLink | null | undefined,
): { key: "board.viewer.link" | "board.viewer.link.bare" | "board.viewer.unlinked"; label: string }[] {
  if (!link) return [];
  if (link.unlinked) return [{ key: "board.viewer.unlinked", label: "" }];
  const labels = Array.isArray(link.labels) ? link.labels : [];
  return labels.map((raw) => {
    const label = typeof raw === "string" ? raw.trim() : "";
    return label === "" ? { key: "board.viewer.link.bare" as const, label: "" } : { key: "board.viewer.link" as const, label };
  });
}

/** 항목은 그대로 — 화면이 붙인 열쇠도 따라간다 */
export function prependItems<T>(older: readonly T[], current: readonly T[]): T[] {
  return [...older, ...current];
}

/** 따라가기의 겹침 열쇠 — 도구의 결과 · 오류 표시는 보지 않는다(같은 호출이 처음엔 결과 없이, 다음엔 결과와 함께 온다) */
export function sameTranscriptItem(a: TranscriptItem, b: TranscriptItem): boolean {
  if (a.role !== b.role || a.at !== b.at || a.text !== b.text || a.images !== b.images) return false;
  if (a.tool === null || b.tool === null) return a.tool === b.tool;
  return a.tool.name === b.tool.name && a.tool.summary === b.tool.summary && a.tool.input === b.tool.input;
}

/** 쪽 경계의 고아 결과(호출이 쪽 밖) 몇 개를 건너뛴다 */
const MERGE_SKIP_MAX = 3;

/**
 * 지금 쥔 목록의 꼬리가 새 최신 쪽의 앞부분과 겹치는 자리 — 결과 = `current[0..at)` + `latest[skip..]`. 겹침이 없으면 `null`(최신 쪽으로 갈아 끼운다).
 * Rust 의 쪽은 바이트 커서로 끝에서 자르므로 항목에 고유 id 가 없다 — 내용으로 맞춘다.
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

/** 끝의 도구 줄 묶음만 본다 — 뒤에 말이 이어졌으면 그 앞의 도구는 끝난 것으로 친다(결과 없이 끊긴 호출이 영영 돌지 않게) */
export function runningToolIndexes(items: readonly TranscriptItem[]): number[] {
  const out: number[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.role !== "tool" || it.tool === null) break;
    if (it.tool.output === null) out.push(i);
  }
  return out.reverse();
}

/** 기록 뒤에 붙는 지금 턴의 줄 — `item` 이 없으면 부르는 쪽의 카드(`liveCard(key)`) */
export interface LiveRow {
  key: string;
  item: TranscriptItem | null;
  spinning?: boolean;
  /** 보내고 아직 받지 않은 사람 말 */
  dim?: boolean;
  note?: string | null;
  /** 닫히지 않은 울타리는 다이어그램으로 그리지 않는다(`splitOpenFence`) */
  streaming?: boolean;
  /** 기록에 들기 전의 첨부 이름 */
  files?: readonly string[];
  /** 기록의 `upic` 과 같은 모양 */
  sentPics?: readonly { name: string; url: string }[];
}

/**
 * 턴이 도는 동안 받은 기록을 어디서 자를까(`null` = 자르지 않는다) — 그 쪽에는 이미 지금 턴의 앞부분이 들어 있어 꼬리와 겹친다.
 * 보낸 말이 있으면 기록의 마지막 사람 말이 그 글일 때만 그 말부터(앞 턴을 자르지 않는다), F5(`userText: null`)면 마지막 사람 말 뒤부터.
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

/** 수식 없는 `V`(물리 키 — 한글 자판의 ㅍ 도 같다) */
export const VIEW_KEY = "KeyV";

export function isViewKey(ev: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; isComposing?: boolean }): boolean {
  return ev.code === VIEW_KEY && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && !ev.isComposing;
}

/** Claude Code 가 붙여넣기를 감싸 적는 `<pasted_content id>` 꼬리표를 걷는다 — 짝이 맞지 않는 꼬리표는 손대지 않는다 */
export function unwrapPasted(text: string): string {
  return text.replace(/<pasted_content id="([^"]*)">\r?\n?([\s\S]*?)\r?\n?<\/pasted_content id="\1">/g, "$2");
}

/** 턴마다 마지막 에이전트 줄 id → 복사할 글(에이전트 말 원문만 빈 줄로). 끝 턴은 `lastDone` 일 때만 — 답을 쓰는 중이면 단추가 없다 */
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

/** 그 대화 파일 안에서 하나 — 줄 시작 · 길이 · 차례 */
export function pictureKey(p: TranscriptPicture): string {
  return `${p.at}:${p.len}:${p.n}`;
}

/** "그림 N" 칩의 N — 자리가 없는 것과 자리는 있지만 못 읽은 것. `showing` 이 거짓이면 전부 칩이다 */
export function hiddenImageCount(item: TranscriptItem, showing: boolean, failed: (p: TranscriptPicture) => boolean): number {
  const pics = showing ? (item.pictures ?? []) : [];
  return Math.max(0, item.images - pics.length) + pics.filter(failed).length;
}

/** 맨 앞에 이어진 `[Image #N]` 자리표는 그 말의 그림이 모두 그려질 때(`drawn`)만 뗀다 — 가운데 자리표 · 사람이 쓴 닮은 글은 그대로 */
export function withoutImagePlaceholders(text: string, drawn: boolean): string {
  if (!drawn) return text;
  const m = /^(?:\[Image #\d+\](?: |$))+/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

export function userPictures(items: Iterable<TranscriptItem>): TranscriptPicture[] {
  const out = new Map<string, TranscriptPicture>();
  for (const it of items) if (it.role === "user") for (const p of it.pictures ?? []) out.set(pictureKey(p), p);
  return [...out.values()];
}
