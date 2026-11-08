// 하네스가 `Page.reload` 뒤 **앱 부팅이 끝날 때까지** 기다린다 — `+page` 의 `startup()` 이 `boot()` 를 마치면 스플래시가
// 걷히고(`Splash.svelte` 의 `.splash` — 페이드 뒤 DOM 에서 빠진다) 탭 줄(`.tabs`)이 서 있다.
//
// 고정 `sleep(4500)` 은 찬 vite(러너가 새로 띄운 dev 서버)에서 모자랐다: 부팅이 약 5.2초 걸려 첫 키(Ctrl+Shift+N 등)가 앱이
// 서기 전에 떨어져 사라지고, 판 전체가 "타일 0 · 행 없음" 으로 무너졌다(2026-10-27 — 같은 판이 데운 vite 에서는 통과).
// 탭 줄만 보는 것도 모자라다 — `.tabs` 는 마운트 즉시 서고 부팅(설정 · 배치 복원)은 그 뒤에 끝난다.
//
//   import { waitBoot } from "./boot-wait.mjs";
//   await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);

/**
 * @param {(expr: string) => Promise<unknown>} ev 페이지에서 식을 평가해 값을 돌려주는 하네스의 `ev`
 * @param {{ timeout?: number, settle?: number }} [opt] 시한(기본 30초) · 선 뒤 가라앉기(기본 300ms — 첫 그리기 뒤 rAF 몫)
 */
export async function waitBoot(ev, { timeout = 30000, settle = 300 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await ev(`!!document.querySelector('.tabs') && !document.querySelector('.splash')`)) === true) {
      await sleep(settle);
      return;
    }
    await sleep(150);
  }
  throw new Error(`앱 부팅이 ${timeout}ms 안에 끝나지 않았다 (스플래시가 걷히지 않음)`);
}

/**
 * `Page.reload` + `waitBoot` 를 **새 문서에서** 판정한다. CDP 의 `Page.reload` 는 탐색이 시작되기 전에 답하므로, 곧바로 부른
 * `waitBoot` 는 **옛 문서**(이미 `.tabs` 가 서 있고 스플래시가 없다)를 보고 바로 끝날 수 있다 — 그 뒤의 식은 막 뜨는 새 문서에서
 * 돌아 `performance` 자원 목록이 비어 "module not loaded yet" 이 났다(2026-10-31 — 원격 → 로컬 복귀 직후 · 판마다 갈림).
 * 그래서 `performance.timeOrigin` 이 바뀔 때까지(= 새 문서) 기다린 뒤 부팅을 본다. `ev` 는 예외를 문자열로 돌려주는 하네스 원형이어야 한다.
 *
 * @param {(method: string, params?: object) => Promise<unknown>} send
 * @param {(expr: string) => Promise<unknown>} ev
 * @param {{ timeout?: number, settle?: number }} [opt]
 */
export async function reloadBoot(send, ev, opt = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = await ev(`performance.timeOrigin`);
  await send("Page.reload", { ignoreCache: true });
  const end = Date.now() + (opt.timeout ?? 30000);
  while (Date.now() < end) {
    const now = await ev(`performance.timeOrigin`);
    if (typeof now === "number" && now !== before) return waitBoot(ev, opt);
    await sleep(50);
  }
  throw new Error("다시 읽기가 새 문서로 넘어가지 않았다");
}

/**
 * 토스트 기둥(`.toasts` — 오른쪽 위)이 빌 때까지 기다린다. 하네스의 `Page.reload` 는 부팅 토스트("탭 N개를 복원했습니다.",
 * 3초)를 띄우고, 토스트는 **포인터가 올라 있으면 줄지 않는다**(`toast.svelte.ts`) — 그 자리의 단추(타일 오른쪽 위 · 실패 줄의
 * [AI에게 묻기])를 진짜 마우스로 누르는 판은 이 뒤에 누른다. 부팅을 기다린 뒤라 예전 고정 대기보다 일찍 닿아 토스트가 단추를 가렸다.
 */
export async function waitToastsGone(ev, { timeout = 10000 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await ev(`document.querySelectorAll('.toasts .toast').length`)) === 0) return;
    await sleep(150);
  }
  throw new Error(`토스트가 ${timeout}ms 안에 걷히지 않았다`);
}
