// **내부 전용** — 명령 레코드에서 글자를 읽는 창구. 블록 이력과 MCP 거울이 같은 추출을 보도록 한 곳에 둔다.

import { writeClipboard } from "$lib/clipboard";
import { readLineArray, readLines } from "./buffer-read";
import { prune } from "./records";
import type { CommandRecord, SiState } from "./state";
import type { CommandSnapshot, CopyResult } from "./types";

export function lastCompleted(s: SiState): CommandRecord | null {
  for (let i = s.records.length - 1; i >= 0; i--) {
    const r = s.records[i];
    // 프롬프트 마커가 죽은 명령은 화면에서 지워졌다 (스크롤백 밖 · `clear`) — 복사할 출력이 없다.
    if (r.promptMarker.isDisposed) continue;
    if (r.exit !== null && r.cmdMarker && r.outMarker) return r;
  }
  return null;
}

/**
 * 명령문 = `B`(프롬프트 끝)부터 `C` 직전까지 — `A` 부터 읽으면 프롬프트 문자열이 붙는다.
 * `B` 를 안 보내는 훅도 있어 그때는 줄을 통째로 읽는다 — 프롬프트가 붙은 값이 없는 값보다 낫다.
 */
export function commandLineOf(s: SiState, rec: CommandRecord): string {
  const end =
    rec.cmdMarker && !rec.cmdMarker.isDisposed ? rec.cmdMarker.line : rec.promptMarker.line + 1;
  const b = rec.bMarker;
  if (!b || b.isDisposed || b.line >= end) return readLines(s.term, rec.promptMarker.line, end);

  // 앞머리만 잘라 낸다 — 다시 쪼개면 "출력만 복사" 와 줄 나누기가 갈릴 수 있다.
  const lines = readLineArray(s.term, b.line, end);
  if (lines.length === 0) return "";
  const first = s.term.buffer.active.getLine(b.line);
  if (first) {
    const continues = s.term.buffer.active.getLine(b.line + 1)?.isWrapped ?? false;
    const whole = first.translateToString(!continues);
    lines[0] = first.translateToString(!continues, rec.bCol) + lines[0].slice(whole.length);
  }
  return lines.join("\n");
}

export function outputOf(s: SiState, rec: CommandRecord): string {
  const from = rec.cmdMarker;
  const to = rec.outMarker;
  if (!from || !to || from.isDisposed || to.isDisposed) return "";
  return readLines(s.term, from.line, to.line);
}

export function tail(s: SiState, lines: number): string[] {
  if (!Number.isFinite(lines) || lines <= 0) return [];
  const end = s.term.buffer.active.length;
  const text = readLines(s.term, end - lines, end);
  return text === "" ? [] : text.split("\n");
}

/** 빈 프롬프트는 건너뛴다 — `D` 직후에는 이미 다음 프롬프트의 레코드가 서 있다. */
export function last(s: SiState): CommandSnapshot | null {
  prune(s);
  let rec: CommandRecord | null = null;
  for (let i = s.records.length - 1; i >= 0; i--) {
    if (s.records[i].cmdMarker !== null) {
      rec = s.records[i];
      break;
    }
  }
  if (!rec || rec.promptMarker.isDisposed) return null;
  return {
    commandLine: commandLineOf(s, rec),
    output: outputOf(s, rec),
    exit: rec.exit,
    running: rec.cmdMarker !== null && rec.exit === null,
  };
}

export function blockOutput(s: SiState, blockId: number): string[] | null {
  const marker = s.blockLines.get(blockId);
  if (!marker || marker.isDisposed) return null;
  const rec = s.records.find((r) => r.promptMarker === marker);
  const to = rec?.outMarker;
  if (!rec || !to || to.isDisposed) return null;
  // `C` 가 있으면 그 줄부터, 없으면(`C` 없이 `D` 가 온 셸) 프롬프트 줄 다음부터 — 블록을 닫을 때와 같은 셈이다.
  if (rec.cmdMarker?.isDisposed) return null;
  const start = rec.cmdMarker ? rec.cmdMarker.line : marker.line + 1;
  return readLineArray(s.term, start, to.line);
}

export async function copyOutput(s: SiState): Promise<CopyResult> {
  prune(s);
  const rec = lastCompleted(s);
  if (!rec) return "empty";
  const text = outputOf(s, rec);
  if (text === "") return "empty";
  return (await writeClipboard(text)) ? "ok" : "denied";
}

export function canCopyOutput(s: SiState): boolean {
  prune(s);
  const rec = lastCompleted(s);
  return rec !== null && outputOf(s, rec) !== "";
}
