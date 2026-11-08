/**
 * **원격 기기 페어링 확인** — 원격 브라우저가 [연결 요청] 을 누르면 관문(Rust `remote/gate.rs`)이 주 창에
 * `remote-pair-request` 를 보낸다. 여기서 모달 상태를 세우고, 사람이 두 화면의 6자리 코드를 견준 뒤
 * [허용]·[거절] 하면 `remote_pair_respond` 를 부른다(R1a-2 — 설계 docs/log/2026-10-15-remote-web-client-design.md 3절).
 *
 * 규칙:
 * - **주 창에서만** — `boot()` 이 `isMainWindow` 로 가른다(대기 카드·알림과 같은 규칙). `remote_pair_respond` 는 집 PC 전용
 *   명령이다(R1a 4번 커밋 거부 목록).
 * - **가림막이 떠 있으면 그리지 않는다**(`RemotePairDialog.svelte`) — 잠긴 집 PC 앞의 누군가가 마스터 없이 기기를 들이지 못하게.
 *   요청은 그대로 기다리다(120초) 가림막을 걷으면 보인다.
 * - 닫기(Esc · 바깥 클릭)는 **거절**이다 — 답 없이 닫으면 원격 쪽이 만료까지 기다린다.
 * - 요청 수명이 끝나면 스스로 닫는다(관문이 만료를 알리지 않는다 — 받은 `expiresInMs` 로 잰다). 다른 길로 끝나면
 *   (`remote-pair-closed`) 함께 닫는다.
 *
 * 임포트는 IPC 하나 — 다른 앱 모듈을 부르지 않는다.
 */

import { invoke, listen } from "$lib/ipc";

/** 관문이 보내는 요청 한 장 (Rust `remote::auth::PairNotice`) */
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

/** 모달을 닫는다(답은 보내지 않는다) */
export function closeRemotePair(): void {
  clearTimer();
  remotePair.open = false;
  remotePair.busy = false;
  remotePair.error = "";
}

/** 요청 하나를 띄운다 — 이미 다른 것이 떠 있으면 새것으로 갈아 낀다(관문은 한 번에 하나만 낸다) */
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

/** [허용]·[거절] — 실패(이미 끝난 요청)면 문구를 띄우고 닫지 않는다 */
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

/** 부팅에서 한 번 — 주 창에서만(`boot()`) */
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
