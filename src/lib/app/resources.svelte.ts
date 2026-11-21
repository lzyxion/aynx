/**
 * 로컬 자원 모니터의 폴링 — 보는 쪽(`watchResources`)이 있을 때만 당긴다.
 * 서버는 마지막 당김 뒤 10초에 표본을 멈춘다(`server/resources.rs` — 당김 + 임대).
 */
import { invoke } from "../ipc";
import { hasReason, stripReason } from "$lib/error-reason";
import { mergeSamples, parseSnapshot, type ResourceSample, type ResourceSnapshot } from "$lib/resources";

let ring = $state.raw<ResourceSample[]>([]);
let top = $state.raw<ResourceSnapshot["top"]>({ gui: [], server: [], tiles: {} });
let interval = $state(2000);
/** 세션 서버가 이전 판(17 이하)이라 op 가 없다 */
let outdated = $state(false);
let lastError = $state<string | null>(null);
/** 벽시계 ms — 새 표본이 없어도 당길 때마다 바뀐다(상태바 고리가 묵음을 잰다) */
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

export function resourceRing(): ResourceSample[] {
  return ring;
}

export function resourceTop(): ResourceSnapshot["top"] {
  return top;
}

export function resourcePulledAt(): number {
  return pulledAt;
}

/** ms */
export function resourceInterval(): number {
  return interval;
}

export function resourceOutdated(): boolean {
  return outdated;
}

export function resourceError(): string | null {
  return lastError;
}
