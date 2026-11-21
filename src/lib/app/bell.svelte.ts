import { settings } from "$lib/settings.svelte.js";

/**
 * 벨(`\a`) — 표식은 탭 id 가 아니라 타일 id 로 든다(탭으로 접는 것은 `tabBells`).
 * 세지 않는다 — 벨 횟수를 들지도 MCP 로 내보내지도 않는다.
 */

/** 타일당 이 간격에 한 번만 번쩍인다 — 벨이 연달아 오는 출력에서 테두리가 스트로보가 되는 것을 막는 유일한 장치다 */
export const BELL_FLASH_MS = 250;

const flashing = $state<Record<string, boolean>>({});
/** 그 탭을 보는 순간 거둔다(`stickyStatus` 와 같은 수명) */
const unseen = $state<Record<string, boolean>>({});

const lastFlash = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// ── 소리 ──

/** 처음 소리를 낼 때 만든다 — 벨 소리를 켜지 않은 사람(기본값)에게 오디오 장치를 열지 않는다 */
let audio: AudioContext | null = null;

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

// ── 울림 ──

export function bell(paneId: string, tileVisible: boolean): void {
  const mode = settings.bell;
  if (mode === "off") return;

  // 표식은 속도 제한 밖이다 — 안 보는 탭에서 울린 사실은 눌러 볼 때까지 남아야 한다
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

export function isBellFlashing(paneId: string): boolean {
  return flashing[paneId] === true;
}

export function hasBellMark(paneId: string): boolean {
  return unseen[paneId] === true;
}

export function clearBellMarks(paneIds: Iterable<string>): void {
  for (const id of paneIds) delete unseen[id];
}

export function dropBell(paneId: string): void {
  clearTimeout(timers.get(paneId));
  timers.delete(paneId);
  lastFlash.delete(paneId);
  delete flashing[paneId];
  delete unseen[paneId];
}
