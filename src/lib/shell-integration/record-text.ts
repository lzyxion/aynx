// **내부 전용** — 명령 레코드에서 글자를 읽는 창구: 명령문(`B`~`C`) · 출력(`C`~`D`) · 마지막 명령 · 버퍼 꼬리 ·
// 블록 출력 · 출력 복사. 블록 이력과 MCP 거울이 **같은 추출**을 보도록 한 곳에 둔다.

import { writeClipboard } from "$lib/clipboard";
import { readLineArray, readLines } from "./buffer-read";
import { prune } from "./records";
import type { CommandRecord, SiState } from "./state";
import type { CommandSnapshot, CopyResult } from "./types";

/** 완료된(= C 와 D 를 다 본) 마지막 레코드 */
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
 * 그 레코드의 **명령문** — `B`(프롬프트 끝)부터 `C`(출력 시작) 직전까지의 화면 텍스트.
 *
 * `last()`(MCP 거울)와 블록 이력이 **같은 값**을 쓰도록 한 곳에 둔다. 아직 `C` 를 못
 * 봤으면 프롬프트 줄 한 줄만 본다 (그 아래는 아직 명령이 아니다).
 *
 * ## 왜 `A` 가 아니라 `B` 에서 시작하는가
 *
 * `A` 부터 읽으면 **프롬프트 문자열이 앞에 붙는다** — 결과 줄이 `u@host:~$ make all` 로
 * 보이고, `#make` 매칭도 AI 거울도 그 프롬프트 글자를 함께 본다. 셸이 알려 주는 경계는
 * A·B·C·D 뿐이고 그중 "프롬프트가 여기서 끝난다" 를 말하는 것이 `B` 다. 지금까지 `B` 는
 * 표시만 하고 소비하지 않았는데, 바로 이 값을 위해 마커가 필요했다.
 *
 * **`B` 를 안 보내는 훅도 있다**(A/C/D 만 내는 것들 · tmux 안에서 반쪽이 된 세션). 그때는
 * 옛 동작 그대로 줄을 통째로 읽는다 — 프롬프트가 붙은 값이 없는 값보다 낫다.
 *
 * 점프의 착지점은 여전히 `A`(`promptMarker`)다. 여기서 바뀐 것은 **읽는 범위**뿐이다.
 */
export function commandLineOf(s: SiState, rec: CommandRecord): string {
  const end =
    rec.cmdMarker && !rec.cmdMarker.isDisposed ? rec.cmdMarker.line : rec.promptMarker.line + 1;
  const b = rec.bMarker;
  if (!b || b.isDisposed || b.line >= end) return readLines(s.term, rec.promptMarker.line, end);

  // 첫 논리 줄만 `B` 의 열부터 다시 뜬다. `readLineArray` 가 이미 래핑을 이어 붙였으므로,
  // 이어 붙은 뒷부분은 그대로 두고 **앞머리만** 잘라 낸다 (거기서 다시 쪼개면 "출력만
  // 복사" 와 줄 나누기가 갈릴 수 있다).
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

/**
 * 버퍼의 마지막 `lines` 개 논리 줄. `readLines` 를 버퍼 끝 구간
 * `[length - lines, length)` 에 그대로 태운다 — 래핑된 줄은 이어 붙고, 끝의 빈 줄은
 * 잘려 나간다 (`readLines` 의 규칙). 논리 줄로 다시 쪼개 배열로 돌려준다.
 */
export function tail(s: SiState, lines: number): string[] {
  if (!Number.isFinite(lines) || lines <= 0) return [];
  const end = s.term.buffer.active.length;
  const text = readLines(s.term, end - lines, end);
  return text === "" ? [] : text.split("\n");
}

/**
 * 마지막 **명령** 한 건. 빈 프롬프트(A 만 오고 아직 아무것도 안 친 자리)는 건너뛴다 —
 * D 직후에는 이미 다음 프롬프트의 레코드가 서 있어서, 그냥 마지막 원소를 집으면
 * "방금 끝난 명령" 대신 "지금 비어 있는 프롬프트" 가 나온다.
 */
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
