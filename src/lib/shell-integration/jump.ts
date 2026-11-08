// **내부 전용** — 명령 점프(Ctrl+↑/↓): 프롬프트 줄 사이를 인덱스로 훑고, 착지한 줄을 잠깐 반짝인다.

import { prune } from "./records";
import type { SiState } from "./state";

/** 점프 착지 반짝임 길이 (ms) — CSS 애니메이션 시간과 맞춘다 */
const FLASH_MS = 600;

/**
 * 점프가 착지한 프롬프트 줄을 잠깐 **노랗게 반짝**인다 (`--warn` 계열, fade out).
 *
 * 점프는 **스크롤만** 하고 포커스는 옮기지 않는다 — 입력은 여전히 지금 프롬프트로 간다
 * (스크롤백을 훑어보는 것이지 그 자리로 이동하는 것이 아니다). 그래서 "여기로 왔다" 가
 * 눈에 보이지 않으면 어디에 착지했는지 놓치기 쉽다. 데코는 **1회성**이라 FLASH_MS 뒤
 * 스스로 dispose 한다 (상태 띠와 수명이 달라 `rec.decorations` 에는 넣지 않는다).
 */
export function flashLanding(s: SiState, line: number) {
  const rec = s.records.find((r) => !r.promptMarker.isDisposed && r.promptMarker.line === line);
  if (!rec) return;
  const flash = s.term.registerDecoration({
    marker: rec.promptMarker,
    x: 0,
    width: s.term.cols,
    layer: "top",
  });
  if (!flash) return;
  flash.onRender((el) => el.classList.add("aynx-jump-flash"));
  setTimeout(() => flash.dispose(), FLASH_MS);
}

/**
 * 이전/다음 **프롬프트 줄**로 스크롤한다. 기준은 지금 보고 있는 위치(`viewportY`)라
 * 연달아 누르면 프롬프트를 한 칸씩 훑는다.
 *
 * 착지점을 한 줄 위로 잡는 이유: 프롬프트가 화면 맨 윗줄에 딱 붙으면 그 위에 있던
 * 직전 명령의 출력 끝이 안 보여 "여기가 경계다" 가 읽히지 않는다.
 */
export function jump(s: SiState, dir: -1 | 1): boolean {
  prune(s);
  // 명령이 나온 순서 = 프롬프트 줄의 순서. **인덱스**로 다루는 것이 핵심이다 —
  // viewportY(화면 최상단)로 기준을 잡으면 화면 안에 이미 보이는 바로 위 명령들을
  // 건너뛰고 "화면 밖 위쪽 첫 명령" 으로 튄다 (실기: 바로 이전 명령으로 안 감).
  const lines = s.records
    .map((r) => r.promptMarker)
    .filter((m) => !m.isDisposed)
    .map((m) => m.line)
    .sort((a, b) => a - b);
  const n = lines.length;
  if (n === 0) return false;

  // 시작점은 **맨 아래(현재 라이브 프롬프트)** 다. 새 명령을 치면 jumpCursor 가 리셋되어
  // 다음 점프가 다시 바닥에서 출발한다 (A 핸들러에서 null 로). 첫 Ctrl+↑ 은 바로 이전
  // 명령(n-2)으로, 첫 Ctrl+↓ 은 갈 곳이 없어 false.
  const base = s.jumpCursor ?? n - 1;
  const next = base + dir;
  if (next < 0 || next >= n) return false;
  s.jumpCursor = next;

  // 착지점을 한 줄 위로 잡는 이유: 프롬프트가 화면 맨 윗줄에 딱 붙으면 그 위 직전
  // 명령의 출력 끝이 안 보여 "여기가 경계다" 가 읽히지 않는다.
  s.term.scrollToLine(Math.max(0, lines[next] - 1));
  flashLanding(s, lines[next]); // "여기로 왔다" — 착지 줄을 잠깐 노랗게 반짝인다
  return true;
}
