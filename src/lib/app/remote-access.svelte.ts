/**
 * 원격 접속 상태. 상태바의 "원격 접속 중" 칩은 끌 수 없다 — 설정 칸을 만들지 않는다(docs/log/2026-10-15-remote-web-client-design.md).
 * 값에 비밀은 없다 — 기기 id · 이름 · 시각 · 상태 수뿐(토큰 · 암호 · 코드 없음).
 */
import { invoke, isRemote, listen } from "$lib/ipc";
import type { ConnectFlow, RemoteDevice, RemoteLogEntry, RemoteServeStatus, RemoteStatus, ServeConnectOutcome } from "$lib/remote-access";
import { activeDevices } from "$lib/remote-access";
import { emitSettingsSaved, markRemoteConnected } from "$lib/settings.svelte.js";

let status = $state<RemoteStatus | null>(null);
let devices = $state<RemoteDevice[]>([]);
let log = $state<RemoteLogEntry[]>([]);
let started = false;

export function remoteStatus(): RemoteStatus | null {
  return status;
}

export function remoteDevices(): RemoteDevice[] {
  return devices;
}

export function remoteLog(): RemoteLogEntry[] {
  return log;
}

export function remoteActive(): RemoteDevice[] {
  return activeDevices(devices);
}

export async function refreshRemoteAccess(): Promise<void> {
  const [s, d, l] = await Promise.all([
    invoke<RemoteStatus>("remote_status").catch(() => null),
    invoke<RemoteDevice[]>("remote_devices_list").catch(() => null),
    invoke<RemoteLogEntry[]>("remote_log").catch(() => null),
  ]);
  if (s) status = s;
  if (d) devices = d;
  if (l) log = l;
}

/** 열린 원격 세션을 모두 닫는다(기기는 남는다) */
export async function disconnectAllRemote(): Promise<number> {
  const n = await invoke<number>("remote_disconnect_all");
  await refreshRemoteAccess();
  return n;
}

export async function renameRemoteDevice(id: string, name: string): Promise<void> {
  await invoke("remote_device_rename", { id, name });
  await refreshRemoteAccess();
}

export async function revokeRemoteDevice(id: string): Promise<void> {
  await invoke<boolean>("remote_device_revoke", { id });
  await refreshRemoteAccess();
}

export function detectRemoteHost(): Promise<string> {
  return invoke<string>("remote_detect_host");
}

// ── Tailscale 연결 ──

let serve = $state<RemoteServeStatus | null>(null);
let flow = $state<ConnectFlow>({ phase: "idle" });
/** 늦게 끝난 옛 읽기가 동작 뒤의 값을 덮지 않게 */
let serveSeq = 0;

export function remoteServe(): RemoteServeStatus | null {
  return serve;
}

export function connectFlow(): ConnectFlow {
  return flow;
}

/** CLI 를 부른다 — 섹션이 보일 때 · 동작 뒤 · 15초마다만 */
export async function refreshRemoteServe(port: number | null): Promise<void> {
  const seq = ++serveSeq;
  const next = await invoke<RemoteServeStatus>("remote_serve_status", { port }).catch((): RemoteServeStatus => ({ state: "unknown" }));
  if (seq === serveSeq) serve = next;
}

function setServe(next: RemoteServeStatus): void {
  serveSeq++;
  serve = next;
}

/** `replace` = 사람이 확인한 지금 대상(바뀌었으면 Rust 가 다시 묻는다) */
export async function connectRemoteServe(port: number | null, replace?: string): Promise<void> {
  if (flow.phase === "busy") return;
  flow = { phase: "busy", step: "serve" };
  try {
    const answer = await invoke<ServeConnectOutcome>("remote_serve_connect", { port, replace: replace ?? null });
    if (answer.kind === "connected") {
      setServe({ state: "ours" });
      markRemoteConnected(answer.host, port);
      emitSettingsSaved();
      flow = { phase: "idle" };
      void refreshRemoteAccess();
      return;
    }
    flow = answer.kind === "confirm" ? { phase: "confirm", target: answer.target } : { phase: "admin", message: answer.message, url: answer.url };
  } catch (e) {
    flow = { phase: "failed", message: String(e), retry: "connect" };
  }
  void refreshRemoteServe(port);
}

export async function serveOffRemote(port: number | null): Promise<void> {
  if (flow.phase === "busy") return;
  flow = { phase: "busy", step: "off" };
  try {
    await invoke("remote_serve_off", { port });
    setServe({ state: "none" });
    flow = { phase: "idle" };
  } catch (e) {
    flow = { phase: "failed", message: String(e), retry: "off" };
  }
  void refreshRemoteServe(port);
}

export function resetConnectFlow(): void {
  if (flow.phase !== "busy" && flow.phase !== "idle") flow = { phase: "idle" };
}

export async function lockThisRemote(): Promise<void> {
  if (!isRemote) return;
  try {
    await fetch("/remote/lock", { method: "POST", credentials: "same-origin" });
  } finally {
    location.reload();
  }
}

/** 메인 PC 주 창에서만 — `remote-sessions` 는 그 창 대상 이벤트다 */
export function startRemoteAccess(): void {
  if (started || isRemote) return;
  started = true;
  void listen("remote-sessions", () => void refreshRemoteAccess()).catch(() => {});
  void refreshRemoteAccess();
}
