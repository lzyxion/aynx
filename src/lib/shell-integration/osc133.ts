// **내부 전용** — OSC 133 상태 기계(A·B·C·D): 출처 고정 · 레코드·마커 · 입력 모드 · 블록 열고 닫기 · 상태 띠 · 싱크 알림.
// 거는 자리와 순서는 `attach.ts` 가 쥔다(`CSI J` 엿보기 → 133 → 7 → 9).

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

/**
 * OSC 133 핸들러. `true` 를 돌려주면 "우리가 처리했다" 는 뜻이라 xterm 이 더 손대지
 * 않는다 — 모르는 하위 명령(E·P 등 확장)도 조용히 삼킨다. 화면에 이스케이프 조각이
 * 새는 것보다 낫고, 그것들은 우리 스니펫이 보내지도 않는다.
 */
export function registerOsc133(s: SiState): IDisposable {
  return s.term.parser.registerOscHandler(133, (data) => {
    const { kind, fields, tag } = parseMarker(data);
    // `ED 3` 뒤 셸이 처음 돌아온 자리 — 새 프롬프트 글자가 찍히기 전이다 ([`eraseCheckPending`]).
    if (s.eraseCheckPending) {
      s.eraseCheckPending = false;
      dropErased(s, (line) => inViewport(s, line) && isBlankLine(s, line));
    }
    // ── 출처 고정 (설계 §5 ②) ───────────────────────────────────────────────
    // 첫 `A` 가 이 터미널의 소스를 정하고, 그 뒤로 다른 태그의 마커는 전부 버린다.
    // `A` 보다 먼저 온 조각(B·C·D)은 고정 전이라 그냥 받는다 — 버리면 훅이 중간에
    // 걸린 세션의 첫 명령이 통째로 사라진다.
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
    // **살아남은 마커만** 입력 모드를 움직인다 — 버린 마커(남의 통합)가 이 상태를 흔들면
    // 제안이 남의 프롬프트를 따라 뜬다. 자리를 분기들보다 앞에 두는 것은 `B` 가 그 아래에서
    // 마커를 심기 때문이다 (앵커는 나중에 읽으므로 순서가 어긋나지 않는다).
    s.inputMode = inputModeAfter(s.inputMode, kind);
    if (kind === "A") {
      prune(s);
      const marker = s.term.registerMarker();
      if (marker) {
        // **같은 줄의 두 번째 `A` 는 같은 프롬프트다** — 태그로 못 가른 두 통합(둘 다
        // foreign)이 나란히 `A` 를 내면 빈 레코드가 하나 끼어 명령 점프가 헛돈다.
        // 아직 명령이 시작되지 않은(`cmdMarker === null`) 직전 레코드와 줄이 같을 때만 접는다.
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
      // A 는 "프롬프트가 떴다" 는 뜻일 뿐이다 — 직전 명령의 성공/실패 상태는
      // 다음 명령이 시작(C)할 때까지 그대로 둔다 (탭 배지가 곧바로 꺼지면 안 된다).
      // 아직 아무 명령도 못 봤으면 상태는 계속 `null` 이다 — 접속만 한 탭에 성공 배지가
      // 뜨는 것은 거짓말이다 (그 탭은 활동 점으로 충분하다).
      s.jumpCursor = null; // 새 명령을 쳤으니 다음 점프는 바닥에서 다시 출발한다
      s.sink?.onprompt?.();
      return true;
    }
    if (kind === "B") {
      // 프롬프트 끝 = **명령문의 시작 자리**. 줄은 마커가(스크롤해도 따라간다), 열은 지금
      // 커서의 `cursorX` 가 알려 준다 — 마커는 줄만 기억하므로 열은 값으로 들고 있어야 한다.
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
        markStatus(s, rec, "running"); // 프롬프트 줄에 파란 실행 중 띠
        // 명령문은 한 번만 읽어 **두 소비자가 같은 값**을 보게 한다 (블록 이력 · 타일 신원).
        const commandLine = commandLineOf(s, rec);
        s.sink?.oncommand?.(commandLine); // "이 칸에서 지금 이게 돈다"
        // 블록을 연다 — 명령문은 `last()` 와 **같은 추출**이고 cwd 는 이 프롬프트가 알려 준
        // 값이다. `A` 만 온 자리(빈 프롬프트)는 여기 오지 않으므로 블록이 생기지 않는다.
        if (s.sink) {
          const block = beginBlock(s.sink.paneId, {
            commandLine,
            cwd: s.cwd,
            startedAt: Date.now(),
          });
          // 블록 → 프롬프트 줄. 이력은 마커를 들지 않으므로 이 맵이 유일한 다리다
          // (`CommandApi.lineOfBlock`). 착지점은 **A 의 줄**이다 — 명령과 그 결과가 함께
          // 읽히는 자리이고, 명령 점프(`jump`)가 이미 그 줄로 간다.
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
        /** 이 `D` 가 닫은 블록 (싱크가 없거나 못 닫았으면 `null`) */
        let closed: CommandBlock | null = null;
        // 블록을 닫는다 — **여기가 발췌를 뜨는 유일한 시점**이다. 출력은 "출력만 복사" 와
        // 똑같이 읽는다(`isWrapped` 이어붙이기 · 끝의 빈 줄 제거). 마커가 이미 스크롤백
        // 밖이면 빈 배열이 되고, 그래도 블록 자체는 종료 코드를 들고 남는다.
        if (s.sink) {
          // **`C` 를 못 본 채 `D` 가 왔다** — PSReadLine 이 없는 PowerShell 세션이 그렇다
          // (Enter 핸들러가 `C` 를 내는 유일한 자리라 A/B/D 만 온다 —
          // docs/log/2026-09-08-block-hooks.md). 그러면 여기서 블록을 **열고 곧바로 닫는다**:
          // 명령문은 `B..D` 로 읽히고, 출력은 프롬프트 줄 **다음**부터로 본다. 반쪽 정보라도
          // 블록이 있는 편이 낫고, 없으면 그 셸의 `#` 검색이 통째로 빈다.
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
          // `C` 가 있으면 그 줄이 곧 출력의 첫 줄이고, 없으면 프롬프트(명령) 줄 다음이다.
          const start = rec.cmdMarker ? from.line : from.line + 1;
          const to = rec.outMarker;
          // 마커가 스크롤백 밖으로 밀렸으면(`to` 없음 · from/to 폐기) 출력을 **못 읽는다**.
          // 그 사실을 `endBlock` 에 실어 "무출력" 과 "못 읽음" 을 구분하게 한다(빈 발췌를
          // 그냥 넘기면 `complete` 로 보여 고출력 명령이 "출력 없음" 으로 거짓 보고된다).
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
        // 실행 중 띠를 성공/실패로 **교체**한다. 블록을 닫은 **뒤**인 이유는 실패의 붉은
        // 띠에 거는 말풍선(종료 코드·시각·명령문)이 그 블록에서 나오기 때문이다 — 위의
        // `endBlock` 은 화면 텍스트만 읽고 데코는 건드리지 않으므로 순서를 미뤄도 그리는
        // 결과가 같다.
        markStatus(
          s,
          rec,
          exit === 0 ? "ok" : "fail",
          closed ? blockMarkTitle(closed, s.sink?.tr ?? koTr) : "",
          closed?.id,
          // 출력이 있는 블록만 [리치하게 보기] — 볼 것이 없는 줄에 단추를 세우지 않는다
          closed !== null && closed.excerpt.head.length + closed.excerpt.tail.length > 0,
        );
        if (closed) {
          // 시간 표식은 **상태 띠를 갈아 끼운 뒤**에 건다 (`markStatus` 가 배열을 비운다).
          // 화면 지우기로 걷힌 명령(`clear` 자신)에는 달지 않는다 — 걸 줄이 이미 비었다.
          if (!rec.promptMarker.isDisposed) markBlock(s, rec, closed, s.sink?.markAfterSecs?.() ?? 0);
          s.sink?.onblock?.(closed);
        }
      }
      // 프롬프트로 돌아왔다 — 도는 명령이 없다. `rec` 이 없어(A 를 못 본 세션) 블록을 못
      // 만든 경우에도 이건 참이므로 `if (rec)` 밖에서 한 번 부른다.
      s.sink?.oncommand?.(null);
      setStatus(s, exit === 0 ? "ok" : "fail");
      return true;
    }
    return true;
  });
}
