// **내부 전용** — OSC 133 상태 기계(A·B·C·D). Rust `screen_mirror/vt.rs` 의 상태 기계와 같은 의미여야 한다.

import type { IDisposable } from "@xterm/xterm";
import { beginBlock, endBlock, type CommandBlock } from "$lib/block-history";
import { blockMarkTitle } from "$lib/finish-notify";
import { inputModeAfter } from "$lib/snippet-input";
import { readLineArray } from "./buffer-read";
import { markBlock, markStatus } from "./decorations";
import { dropErased, inViewport, isBlankLine } from "./erase";
import { parseMarker } from "./marker";
import { commandLineOf } from "./record-text";
import { current, prune, sweepBlockLines } from "./records";
import { koTr, type SiState } from "./state";
import type { PaneStatus } from "./types";

export function setStatus(s: SiState, next: PaneStatus | null) {
  if (next === s.status) return;
  s.status = next;
  s.onstatus(next);
}

/** 모르는 하위 명령(E·P 등)도 `true` 로 삼킨다 — 화면에 이스케이프 조각이 새는 것보다 낫다. */
export function registerOsc133(s: SiState): IDisposable {
  return s.term.parser.registerOscHandler(133, (data) => {
    const { kind, fields, tag } = parseMarker(data);
    // `ED 3` 뒤 셸이 처음 돌아온 자리 — 새 프롬프트 글자가 찍히기 전이다.
    if (s.eraseCheckPending) {
      s.eraseCheckPending = false;
      dropErased(s, (line) => inViewport(s, line) && isBlankLine(s, line));
    }
    // ── 출처 고정 ──
    // `A` 보다 먼저 온 조각(B·C·D)은 고정 전이라 받는다 — 버리면 훅이 중간에 걸린 세션의 첫 명령이 사라진다.
    if (kind === "A") {
      if (s.sourceTag === null) s.sourceTag = tag;
      else if (tag !== s.sourceTag) {
        s.diag.foreignDropped++;
        return true;
      }
    } else if (s.sourceTag !== null && tag !== s.sourceTag) {
      s.diag.foreignDropped++;
      return true;
    }
    // 살아남은 마커만 입력 모드를 움직인다 — 버린 마커가 흔들면 제안이 남의 프롬프트를 따라 뜬다.
    s.inputMode = inputModeAfter(s.inputMode, kind);
    if (kind === "A") {
      prune(s);
      const marker = s.term.registerMarker();
      if (marker) {
        // 같은 줄의 두 번째 `A` 는 같은 프롬프트다 — 안 접으면 빈 레코드가 끼어 명령 점프가 헛돈다.
        const prev = current(s);
        if (
          prev &&
          !prev.promptMarker.isDisposed &&
          prev.cmdMarker === null &&
          prev.promptMarker.line === marker.line
        ) {
          marker.dispose();
          s.diag.collapsedPrompts++;
        } else {
          s.records.push({
            promptMarker: marker,
            bMarker: null,
            bCol: 0,
            cmdMarker: null,
            outMarker: null,
            exit: null,
            decorations: [],
          });
        }
      }
      // 상태는 `C` 까지 그대로 둔다 — 탭 배지가 곧바로 꺼지면 안 되고, 명령을 못 본 탭에 성공 배지를 띄우지 않는다.
      s.jumpCursor = null;
      s.sink?.onprompt?.();
      return true;
    }
    if (kind === "B") {
      // 마커는 줄만 기억하므로 열은 값으로 들고 있어야 한다.
      const rec = current(s);
      if (rec) {
        rec.bMarker = s.term.registerMarker() ?? null;
        rec.bCol = s.term.buffer.active.cursorX;
      }
      return true;
    }
    if (kind === "C") {
      const rec = current(s);
      if (rec) {
        rec.cmdMarker = s.term.registerMarker() ?? null;
        markStatus(s, rec, "running");
        // 명령문은 한 번만 읽어 두 소비자(블록 이력 · 타일 신원)가 같은 값을 보게 한다.
        const commandLine = commandLineOf(s, rec);
        s.sink?.oncommand?.(commandLine);
        if (s.sink) {
          const block = beginBlock(s.sink.paneId, {
            commandLine,
            cwd: s.cwd,
            startedAt: Date.now(),
          });
          // 이력은 마커를 들지 않으므로 이 맵이 블록 → 프롬프트 줄의 유일한 다리다.
          s.blockLines.set(block.id, rec.promptMarker);
          sweepBlockLines(s);
        }
      }
      setStatus(s, "running");
      return true;
    }
    if (kind === "D") {
      const rec = current(s);
      // `D` 만 오면(코드 없음) 성공으로 본다 — OSC 133 규약의 기본값이다.
      const raw = fields[1] ?? "";
      const code = raw === "" ? 0 : Number.parseInt(raw, 10);
      const exit = Number.isFinite(code) ? code : 0;
      if (rec) {
        rec.exit = exit;
        rec.outMarker = s.term.registerMarker() ?? null;
        let closed: CommandBlock | null = null;
        // 발췌를 뜨는 유일한 시점이다.
        if (s.sink) {
          // `C` 없이 `D` 가 왔다 — PSReadLine 이 없는 PowerShell 은 A/B/D 만 온다(Rust `shell_integration.rs`).
          // 여기서 블록을 열고 곧바로 닫는다 — 없으면 그 셸의 `#` 검색이 통째로 빈다 (docs/log/2026-09-08-block-hooks.md).
          if (rec.cmdMarker === null) {
            const opened = beginBlock(s.sink.paneId, {
              commandLine: commandLineOf(s, rec),
              cwd: s.cwd,
              startedAt: Date.now(),
            });
            s.blockLines.set(opened.id, rec.promptMarker);
            sweepBlockLines(s);
          }
          const from = rec.cmdMarker ?? rec.promptMarker;
          const start = rec.cmdMarker ? from.line : from.line + 1;
          const to = rec.outMarker;
          // "무출력" 과 "못 읽음" 을 가른다 — 빈 발췌를 그냥 넘기면 고출력 명령이 "출력 없음" 으로 거짓 보고된다.
          const outputCaptured = !!(to && !from.isDisposed && !to.isDisposed);
          const outputLines = outputCaptured && to ? readLineArray(s.term, start, to.line) : [];
          closed =
            endBlock(s.sink.paneId, {
              exit,
              endedAt: Date.now(),
              outputLines,
              outputCaptured,
            }) ?? null;
        }
        // 블록을 닫은 뒤에 띠를 바꾼다 — 실패 띠의 말풍선이 그 블록에서 나온다.
        markStatus(
          s,
          rec,
          exit === 0 ? "ok" : "fail",
          closed ? blockMarkTitle(closed, s.sink?.tr ?? koTr) : "",
          closed?.id,
          closed !== null && closed.excerpt.head.length + closed.excerpt.tail.length > 0,
        );
        if (closed) {
          // `markStatus` 뒤에 건다(배열을 비운다). 화면 지우기로 걷힌 명령에는 달지 않는다.
          if (!rec.promptMarker.isDisposed) markBlock(s, rec, closed, s.sink?.markAfterSecs?.() ?? 0);
          s.sink?.onblock?.(closed);
        }
      }
      // `rec` 이 없어도(A 를 못 본 세션) 참이라 `if (rec)` 밖에서 부른다.
      s.sink?.oncommand?.(null);
      setStatus(s, exit === 0 ? "ok" : "fail");
      return true;
    }
    return true;
  });
}
