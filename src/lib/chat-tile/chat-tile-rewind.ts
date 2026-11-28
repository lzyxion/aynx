// 채팅 모양 AI 타일 되감기의 순수 층 — 범위 · 단추 판정 · 인용 · 받은 쪽 기록에서 센 재료. 값 import 없음.
// 기준점(`anchor`)은 기록 읽기가 낸 글자 그대로 돌려줄 뿐 여기서 짓지 않는다. 파일 목록은 기록의 도구 입력에서 센 추정이다.

import type { TranscriptItem } from "$lib/context";
import type { RewindScope, SideChatEv } from "$lib/side-chat-api";
import type { ChatTileRewindCaps } from "./chat-tile-api";

export type ChatTileRewindEv = Extract<SideChatEv, { t: "rewind" }>;

/** 이 창에서 연 되감기 카드 — 하나뿐 */
export interface ChatTileRewindAsk {
  anchor: string;
  scope: RewindScope;
  quote: string;
  /** 사람 말 원문 — 대화 되감기 뒤 빈 입력 칸에 넣어 둔다(보내지 않는다) */
  text: string;
  /** 화면이 받은 쪽에서 셈 — 모르면 null */
  localTurns: number | null;
  localFiles: string[] | null;
  phase: "loading" | "ready" | "applying";
  preview: ChatTileRewindEv | null;
  /** 서버 오류 글 그대로("[이유] …") 또는 CLI 거절 글 — 문구는 `rewindErrorText` */
  error: string | null;
  /** `both` 실행에서 파일 쪽만 끝났다 — 대화 쪽 실패는 "파일은 되돌렸지만 …" 으로 말한다 */
  filesDone: boolean;
  /** 물을 때 이 대화의 압축을 알았다 — CLI 의 기준점 거절을 압축 전 메시지로 읽는 근거 */
  compacted: boolean;
}

/** 이 창이 본 되감기 흔적 — 메모리뿐 */
export interface ChatTileRewindTrace {
  key: string;
  at: number;
  scope: RewindScope;
  /** 다른 창이 한 것이면 "" */
  quote: string;
  files: number | null;
  turns: number | null;
  skippedLinks: number | null;
}

const QUOTE_MAX = 80;
const FILES_MAX = 20;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
const PATCH_TOOLS = new Set(["apply_patch", "fileChange"]);

/**
 * 그 CLI 가 채팅 모양에서 되감는 범위 — 앞이 기본. Claude 는 둘 다 되면 `both` · `conversation` · `files`(카드의 범위 고르기 순서).
 * 캡을 모르면(띄운 적 없음) 정적 범위(Claude 파일 · 대화 · Codex 대화). 비면 단추를 그리지 않는다.
 */
export function rewindScopes(cli: "claude" | "codex", caps: ChatTileRewindCaps | null): RewindScope[] {
  if (cli === "codex") return (caps?.conversation ?? true) ? ["conversation"] : [];
  const files = caps?.files ?? true;
  const conversation = caps?.conversation ?? true;
  if (files && conversation) return ["both", "conversation", "files"];
  if (conversation) return ["conversation"];
  if (files) return ["files"];
  return [];
}

/** 범위가 파일 · 대화를 건드리나 */
export function scopeHasFiles(scope: RewindScope): boolean {
  return scope !== "conversation";
}

export function scopeHasConversation(scope: RewindScope): boolean {
  return scope !== "files";
}

/** 이 줄에 단추를 그리나 — 사람 줄 · anchor 있음 · 범위가 하나 이상 */
export function rewindable(item: TranscriptItem, scopes: readonly RewindScope[]): boolean {
  return item.role === "user" && typeof item.anchor === "string" && item.anchor !== "" && scopes.length > 0;
}

/** 카드 머리의 인용 — 첫 줄 · 80자 · 말줄임 */
export function rewindQuote(text: string | null): string {
  const line = (text ?? "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const one = line.trim().replace(/\s+/g, " ");
  const chars = [...one];
  return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX - 1).join("").trimEnd()}…` : one;
}

function anchorAt(items: readonly TranscriptItem[], anchor: string): number {
  return anchor === "" ? -1 : items.findIndex((it) => it.role === "user" && it.anchor === anchor);
}

function parsed(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

/** 입력이 잘려 JSON 이 깨져도 앞쪽 `file_path` 는 읽는다 */
function filePathOf(input: string): string | null {
  const v = parsed(input);
  if (v && typeof v === "object" && typeof (v as Record<string, unknown>).file_path === "string") return (v as Record<string, string>).file_path;
  const m = /"file_path"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(input);
  if (!m) return null;
  const back = parsed(`"${m[1]}"`);
  return typeof back === "string" ? back : null;
}

function patchTextOf(input: string): string {
  const v = parsed(input);
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["input", "patch"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return input;
}

function patchPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) out.push((m[1] ?? m[2]).trim());
  return out;
}

/** `fileChange` 꼴(`changes` 배열 · 경로 열쇠 객체 · `path` 칸) */
function changePaths(input: string): string[] {
  const v = parsed(input);
  if (!v || typeof v !== "object") return patchPaths(patchTextOf(input));
  const o = v as Record<string, unknown>;
  const changes = o.changes;
  if (Array.isArray(changes)) return changes.flatMap((c) => (c && typeof c === "object" && typeof (c as Record<string, unknown>).path === "string" ? [(c as Record<string, string>).path] : []));
  if (changes && typeof changes === "object") return Object.keys(changes);
  if (typeof o.path === "string") return [o.path];
  return patchPaths(patchTextOf(input));
}

/**
 * Codex 경고 재료 — 기준점 줄부터 도구 항목이 바꾼 파일 경로(Edit · Write · MultiEdit · apply_patch · fileChange 의 입력에서만) · 겹침 없이 · 최대 20.
 * 기준점이 그 쪽에 없으면 null(모른다)
 */
export function filesAfter(items: readonly TranscriptItem[], anchor: string): string[] | null {
  const at = anchorAt(items, anchor);
  if (at < 0) return null;
  const out: string[] = [];
  for (const it of items.slice(at)) {
    const tool = it.tool;
    if (!tool || tool.input === null) continue;
    const paths = EDIT_TOOLS.has(tool.name) ? [filePathOf(tool.input)] : PATCH_TOOLS.has(tool.name) ? changePaths(tool.input) : [];
    for (const p of paths) {
      if (!p || out.includes(p)) continue;
      out.push(p);
      if (out.length >= FILES_MAX) return out;
    }
  }
  return out;
}

/** 받은 쪽에서 기준점 줄과 그 뒤 사람 줄 수 — 기준점이 없으면 null */
export function userTurnsFrom(items: readonly TranscriptItem[], anchor: string): number | null {
  const at = anchorAt(items, anchor);
  if (at < 0) return null;
  return items.slice(at).filter((it) => it.role === "user").length;
}
