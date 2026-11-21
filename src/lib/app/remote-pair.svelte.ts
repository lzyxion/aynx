/**
 * 원격 기기 페어링 확인 상태 — 주 창에서만 띄운다(`remote_pair_respond` 는 원격 창에서 막힌 명령).
 * 가림막이 떠 있으면 그리지 않는다(`RemotePairDialog.svelte`) — 잠긴 메인 PC 앞에서 마스터 없이 기기를 들이지 못하게.
 * 닫기(Esc · 바깥 클릭)는 거절이다 — 답 없이 닫으면 원격 쪽이 만료까지 기다린다.
 */

import { invoke, listen } from "$lib/ipc";

/** Rust `remote::auth::PairNotice` 와 같은 모양 */
export interface PairNotice {
  requestId: string;
  code: string;
  deviceName: string;
  tailscaleLogin?: string;
  tailscaleName?: string;
  expiresInMs: number;
}

export const remotePair = $state({
  open: false,
  requestId: "",
  code: "",
  deviceName: "",
  tailscaleLogin: "",
  tailscaleName: "",
  busy: false,
  error: "",
});

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** 답은 보내지 않는다 */
export function closeRemotePair(): void {
  clearTimer();
  remotePair.open = false;
  remotePair.busy = false;
  remotePair.error = "";
}

/** 관문은 만료를 알리지 않는다 — 받은 `expiresInMs` 로 스스로 닫는다 */
export function showRemotePair(n: PairNotice): void {
  clearTimer();
  remotePair.requestId = n.requestId;
  remotePair.code = n.code;
  remotePair.deviceName = n.deviceName;
  remotePair.tailscaleLogin = n.tailscaleLogin ?? "";
  remotePair.tailscaleName = n.tailscaleName ?? "";
  remotePair.busy = false;
  remotePair.error = "";
  remotePair.open = true;
  const ms = Math.max(0, Number(n.expiresInMs) || 0);
  timer = setTimeout(() => {
    if (remotePair.requestId === n.requestId) closeRemotePair();
  }, ms);
}

export async function respondRemotePair(allow: boolean): Promise<void> {
  if (!remotePair.open || remotePair.busy) return;
  remotePair.busy = true;
  try {
    await invoke("remote_pair_respond", { requestId: remotePair.requestId, allow });
    closeRemotePair();
  } catch (e) {
    remotePair.busy = false;
    remotePair.error = String(e);
  }
}

/** 주 창에서만(`boot()`) */
export function startRemotePair(): void {
  if (started) return;
  started = true;
  void listen<PairNotice>("remote-pair-request", (e) => showRemotePair(e.payload));
  void listen("remote-pair-closed", () => closeRemotePair());
  // 리로드 사이에 온 요청(이벤트를 놓쳤다)
  void invoke<PairNotice | null>("remote_pair_pending")
    .then((n) => {
      if (n) showRemotePair(n);
    })
    .catch(() => {});
}
