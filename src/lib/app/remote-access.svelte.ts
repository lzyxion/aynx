/**
 * **원격 접속 상태** — 설정 › 원격 접속 화면과 상태바 원격 칩의 재료(R1a-5 — 설계
 * docs/log/2026-10-15-remote-web-client-design.md 13절 "원격 접속 기록 + 상태바 '원격 접속 중' 상시").
 *
 * - **집 PC 주 창**: 부팅에서 [`startRemoteAccess`] 가 `remote-sessions`(Rust `gate::activity_changed` — 세션 열림·닫힘 · 원격 창
 *   붙음·끊김 · 이름)를 듣고, 올 때마다 기기 목록·기록을 다시 읽는다. 상태바 칩은 "열렸고 원격 창이 붙은 기기"(`activeDevices`)가
 *   하나라도 있으면 선다 — **끌 수 없다**(설정 칸이 없다). OS 알림은 Rust 가 직접 낸다(`gate::notify_home`).
 * - **원격 창**: 이벤트를 듣지 않는다(집 PC 주 창 대상 이벤트다). 설정 화면이 보이는 동안 [`refreshRemoteAccess`] 를 몇 초마다
 *   부른다(`RemoteSection`). 상태바에는 "원격 — <기기 이름>" + [잠그기]([`lockThisRemote`])가 선다.
 *
 * 값에 비밀은 없다 — 기기 id·이름·시각·상태 수뿐(토큰·암호·코드 없음).
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

/** 지금 원격으로 쓰는 기기(상태바 칩의 N) */
export function remoteActive(): RemoteDevice[] {
  return activeDevices(devices);
}

/** 상태 · 기기 · 기록을 다시 읽는다 — 실패는 삼킨다(지금 값 그대로 남는다). */
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

/** **모두 끊기** — 열린 원격 세션을 모두 닫는다(기기는 남는다). 닫은 수. */
export async function disconnectAllRemote(): Promise<number> {
  const n = await invoke<number>("remote_disconnect_all");
  await refreshRemoteAccess();
  return n;
}

/** 기기 이름 바꾸기 — 실패면 던진다(문구는 Rust). */
export async function renameRemoteDevice(id: string, name: string): Promise<void> {
  await invoke("remote_device_rename", { id, name });
  await refreshRemoteAccess();
}

/** 기기 폐기 — 그 기기의 원격 창은 곧바로 닫힌다. */
export async function revokeRemoteDevice(id: string): Promise<void> {
  await invoke<boolean>("remote_device_revoke", { id });
  await refreshRemoteAccess();
}

/** 이 PC 의 MagicDNS 이름 — `tailscale status --json`(집 PC 전용). 실패면 던진다(문구는 Rust). */
export function detectRemoteHost(): Promise<string> {
  return invoke<string>("remote_detect_host");
}

// ── Tailscale 연결(집 PC 전용 — Rust `remote/serve.rs`) ──

let serve = $state<RemoteServeStatus | null>(null);
let flow = $state<ConnectFlow>({ phase: "idle" });
/** 마지막 판정 요청 번호 — 늦게 끝난 옛 읽기가 동작 뒤의 값을 덮지 않게 */
let serveSeq = 0;

export function remoteServe(): RemoteServeStatus | null {
  return serve;
}

export function connectFlow(): ConnectFlow {
  return flow;
}

/** 지금 443 판정을 다시 읽는다(CLI 를 부른다 — 섹션이 보일 때 · 동작 뒤 · 15초마다만). 못 읽으면 Rust 가 `unknown`. */
export async function refreshRemoteServe(port: number | null): Promise<void> {
  const seq = ++serveSeq;
  const next = await invoke<RemoteServeStatus>("remote_serve_status", { port }).catch((): RemoteServeStatus => ({ state: "unknown" }));
  if (seq === serveSeq) serve = next;
}

function setServe(next: RemoteServeStatus): void {
  serveSeq++;
  serve = next;
}

/**
 * **[연결]** — [저장] 을 기다리지 않는 즉시 동작(Rust 가 serve 를 확인한 뒤 `[remote]` 를 저장하고 관문을 맞춘다). 이 창은 remote 칸만 맞추고
 * 다른 창에는 저장 알림을 보낸다. `replace` = 사람이 확인한 지금 대상(바뀌었으면 Rust 가 다시 묻는다).
 */
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

/** **[serve 끄기]** — serve 만 걷는다(`[remote]` 는 그대로). Rust 가 이 포트일 때만 실행한다. */
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

/** 확인 · 관리 화면 · 실패 줄을 걷는다([취소] · 섹션을 떠날 때). 하는 중이면 그대로. */
export function resetConnectFlow(): void {
  if (flow.phase !== "busy" && flow.phase !== "idle") flow = { phase: "idle" };
}

/**
 * **원격 창의 [잠그기]** — 관문의 `POST /remote/lock`(같은 출처 · 쿠키) 으로 이 세션을 닫고 페이지를 다시 읽는다(관문이 잠금
 * 해제 쪽을 낸다). 세션이 닫히면 ws 도 곧바로 닫혀 폴리필이 어차피 다시 읽는다 — 여기서 먼저 읽는 것은 기다림을 줄일 뿐이다.
 */
export async function lockThisRemote(): Promise<void> {
  if (!isRemote) return;
  try {
    await fetch("/remote/lock", { method: "POST", credentials: "same-origin" });
  } finally {
    location.reload();
  }
}

/** 부팅에서 한 번 — **집 PC 주 창에서만**(`boot()`). */
export function startRemoteAccess(): void {
  if (started || isRemote) return;
  started = true;
  void listen("remote-sessions", () => void refreshRemoteAccess()).catch(() => {});
  void refreshRemoteAccess();
}
