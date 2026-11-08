/**
 * **로컬 자원 모니터의 저장소 · 폴링** (2026-10-17) — 세션 서버 op `resource_snapshot`(Tauri 명령 같은 이름)을 **보는 쪽이 있을 때만**
 * 2초마다 당긴다. 보는 쪽 = 타일 머리줄의 자원 칩(그 타일이 보일 때) · 자원 화면(열려 있을 때) · 상태바 자원 고리(켜져 있을 때 —
 * 상태바는 늘 서므로 사실상 창이 보이는 동안 늘) — 각자
 * [`watchResources`] 로 하나씩 등록하고 떠날 때 푼다. 보는 쪽이 0 이면 당기지 않고, 서버는 마지막 당김 뒤 10초에 표본을 멈춘다
 * (`src-tauri/src/server/resources.rs` 머리말 — 당김 + 임대). 창이 숨어 있으면(`document.hidden`) 그 바퀴는 건너뛴다.
 *
 * 링은 창마다 하나(30분) — 서버가 `since` 뒤의 것만 주므로 처음 한 번만 길고 그 뒤는 표본 하나씩이다. 재시도 기계는 없다 —
 * 실패하면 다음 바퀴가 다시 묻는다.
 */
import { invoke } from "../ipc";
import { hasReason, stripReason } from "$lib/error-reason";
import { mergeSamples, parseSnapshot, type ResourceSample, type ResourceSnapshot } from "$lib/resources";

let ring = $state.raw<ResourceSample[]>([]);
let top = $state.raw<ResourceSnapshot["top"]>({ gui: [], server: [], tiles: {} });
let interval = $state(2000);
/** 세션 서버가 이전 판(17 이하)이라 op 가 없다 — 칩은 숨고 자원 칸은 안내를 띄운다 */
let outdated = $state(false);
let lastError = $state<string | null>(null);
/** 마지막으로 당김이 성공한 벽시계 ms — 상태바 고리가 "가장 새 표본이 묵었나" 를 잴 시계(새 표본이 없어도 당길 때마다 바뀐다) */
let pulledAt = $state(0);

let watchers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

async function pull(): Promise<void> {
  if (inflight) return;
  if (typeof document !== "undefined" && document.hidden) return;
  inflight = true;
  try {
    const since = ring.length > 0 ? ring[ring.length - 1].at : 0;
    const snap = parseSnapshot(await invoke<unknown>("resource_snapshot", { since }));
    interval = snap.intervalMs;
    ring = mergeSamples(ring, snap.samples, snap.keepMs);
    top = snap.top;
    outdated = false;
    lastError = null;
    pulledAt = Date.now();
  } catch (e) {
    const msg = String(e);
    outdated = hasReason(msg, "server-outdated");
    lastError = stripReason(msg);
  } finally {
    inflight = false;
  }
}

function loop(): void {
  timer = null;
  if (watchers === 0) return;
  void pull().finally(() => {
    if (watchers > 0 && timer === null) timer = setTimeout(loop, interval);
  });
}

/** 보는 쪽 하나를 등록한다 — 첫 등록이면 곧바로 한 번 당기고 2초마다 잇는다. 돌려받은 함수로 푼다 */
export function watchResources(): () => void {
  watchers++;
  if (watchers === 1 && timer === null) loop();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    watchers--;
    if (watchers === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** 지금까지 받은 표본(시간 순 · 30분) */
export function resourceRing(): ResourceSample[] {
  return ring;
}

/** 가장 새 표본의 상위 프로세스(뿌리마다 셋까지) */
export function resourceTop(): ResourceSnapshot["top"] {
  return top;
}

/** 마지막 당김이 성공한 시각(벽시계 ms · 아직 없으면 0) */
export function resourcePulledAt(): number {
  return pulledAt;
}

/** 표본 간격(ms) */
export function resourceInterval(): number {
  return interval;
}

/** 세션 서버가 자원 op 를 모르는 이전 판인가 */
export function resourceOutdated(): boolean {
  return outdated;
}

/** 마지막 당김의 실패 문구(사람 말) — 성공하면 `null` */
export function resourceError(): string | null {
  return lastError;
}
