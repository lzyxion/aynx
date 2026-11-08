import { settings } from "$lib/settings.svelte.js";

/**
 * **벨** (`\a` · OSC 없는 가장 오래된 알림)
 * — docs/log/2026-09-16-finish-notify-block-marks-bell.md.
 *
 * xterm 이 `onBell` 로 알려 주면 이 모듈이 세 가지를 정한다: 그 타일을 번쩍일 것인가 ·
 * 안 보는 탭이면 표식을 남길 것인가 · 소리를 낼 것인가. 그 판단이 한 곳에 있어야 하는
 * 이유는 **울리는 자리와 보이는 자리가 다르기 때문**이다 — 벨은 `Terminal.svelte` 가 받고,
 * 테두리는 `PaneHost` 가 그리고, 탭 표식은 `Tabs` 가 그린다.
 *
 * ## 왜 `app/tabs` 를 부르지 않는가
 *
 * 표식을 **탭 id 가 아니라 타일 id** 로 든다 (안 본 결과 배지 `stickyStatus` 와 같은 모양).
 * 그러면 이 모듈이 탭 구조를 알 필요가 없고, 탭 단위로 접는 것은 저쪽(`tabBells`)이 한다 —
 * 의존이 한 방향(tabs → bell)이라 순환이 생길 자리가 없다. 덤으로 타일이 탭 사이를
 * 옮겨 다녀도 손댈 것이 없다.
 *
 * ## 무엇을 하지 않는가
 *
 * **세지 않는다.** 타일별 벨 횟수 같은 값을 들지 않고 MCP 로도 내보내지 않는다 — 벨은
 * "지금 무슨 일이 있었다" 는 순간 신호이고, 그것을 숫자로 쌓으면 아무도 읽지 않는 계량기가
 * 하나 는다 (CLAUDE.md — 재발을 보기 전에 기계를 늘리지 않는다).
 */

/**
 * 번쩍임 길이(ms). **타일당 이 간격에 한 번**만 번쩍인다 — `find / | grep …` 처럼 벨이
 * 연달아 오는 출력에서 테두리가 스트로보가 되는 것을 막는 유일한 장치다.
 * CSS 쪽 전환 시간과 굳이 맞추지 않는다 (클래스가 붙어 있는 시간이 이 값이다).
 */
export const BELL_FLASH_MS = 250;

/** 타일 id → 지금 번쩍이는 중인가 (`PaneHost` 의 `.pane-box.bell`) */
const flashing = $state<Record<string, boolean>>({});
/** 타일 id → **안 본 벨**이 있는가. 그 탭을 보는 순간 거둔다 (`stickyStatus` 와 같은 수명) */
const unseen = $state<Record<string, boolean>>({});

/** 타일 id → 마지막으로 번쩍인 시각 — 위 [`BELL_FLASH_MS`] 판정에만 쓴다 (반응형 아님) */
const lastFlash = new Map<string, number>();
/** 타일 id → 번쩍임을 끌 타이머 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// 소리 — **코드로 만든다** (자산 파일을 두지 않는다)
// ---------------------------------------------------------------------------

/**
 * 오디오 컨텍스트 한 벌 — 처음 소리를 낼 때 만든다.
 *
 * 미리 만들지 않는 이유는 벨 소리를 켜지 않은 사람(기본값)에게 오디오 장치를 열 이유가
 * 없기 때문이다. 웹뷰가 오디오를 못 열거나(장치 없음·정책) 사용자 제스처를 기다리는
 * 상태면 조용히 실패한다 — 벨의 본체는 화면이고 소리는 덤이다.
 */
let audio: AudioContext | null = null;

/**
 * 짧은 블립 하나 — 사인파 880Hz, 약 0.12초, 지수 감쇠.
 *
 * 파일을 두지 않는 이유가 셋이다: 번들에 바이너리가 안 늘고, 볼륨·길이를 상수로 고칠 수
 * 있고, 무엇보다 **음질이 필요 없는 소리**다(있었다는 사실만 전하면 된다). 사각파가 아니라
 * 사인파인 것은 하루 종일 옆에서 울릴 수 있어서다.
 */
function blip(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const t0 = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t0);
    // 0 에서 시작하면 `exponentialRamp` 가 정의되지 않는다 — 들리지 않는 값에서 올린다.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + 0.14);
  } catch {
    /* 오디오를 못 연다 — 벨은 화면으로 이미 말했다 */
  }
}

// ---------------------------------------------------------------------------
// 울림
// ---------------------------------------------------------------------------

/**
 * 그 타일에서 **벨이 울렸다** (`Terminal.svelte` 의 `t.onBell`).
 *
 * `tileVisible` 은 그 타일이 **지금 보이는 탭**에 있는가다 (`Terminal` 의 `visible` 프롭
 * 그대로). 보이지 않으면 탭 표식을 남긴다 — 안 본 결과 배지와 정확히 같은 규칙이고,
 * 이유도 같다: 보고 있는 화면에서 난 일은 화면이 이미 말했다.
 *
 * 설정이 `off` 면 아무것도 하지 않는다 — 표식도 남기지 않는다(꺼 둔 사람에게 탭에 점이
 * 남는 것은 "껐는데 왜 뜨나" 다).
 */
export function bell(paneId: string, tileVisible: boolean): void {
  const mode = settings.bell;
  if (mode === "off") return;

  // 표식은 **속도 제한 밖**이다. 연달아 온 벨을 한 번만 번쩍이는 것과, 그 사이에 온 벨을
  // 없던 일로 하는 것은 다르다 — 안 보는 탭에서 울린 사실은 눌러 볼 때까지 남아야 한다.
  if (!tileVisible) unseen[paneId] = true;

  const now = Date.now();
  if (now - (lastFlash.get(paneId) ?? 0) < BELL_FLASH_MS) return;
  lastFlash.set(paneId, now);

  flashing[paneId] = true;
  clearTimeout(timers.get(paneId));
  timers.set(
    paneId,
    setTimeout(() => {
      delete flashing[paneId];
      timers.delete(paneId);
    }, BELL_FLASH_MS),
  );

  if (mode === "visual+sound") blip();
}

/** 그 타일이 지금 번쩍이는 중인가 — `PaneHost` 가 `.pane-box` 에 `.bell` 을 붙일 때 본다 */
export function isBellFlashing(paneId: string): boolean {
  return flashing[paneId] === true;
}

/** 그 타일에 **안 본 벨**이 있는가 — 탭 표식을 접는 쪽(`tabBells`)이 본다 */
export function hasBellMark(paneId: string): boolean {
  return unseen[paneId] === true;
}

/** 그 탭을 봤다 — 거기 있는 타일들의 벨 표식을 거둔다 (`clearSeenStatus` 와 같은 자리) */
export function clearBellMarks(paneIds: Iterable<string>): void {
  for (const id of paneIds) delete unseen[id];
}

/** 타일이 사라졌다 — 번쩍임·표식·타이머를 함께 버린다 (`dropHistory` 와 같은 자리) */
export function dropBell(paneId: string): void {
  clearTimeout(timers.get(paneId));
  timers.delete(paneId);
  lastFlash.delete(paneId);
  delete flashing[paneId];
  delete unseen[paneId];
}
