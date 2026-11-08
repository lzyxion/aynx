/**
 * **연결 대기 타일의 연결 레지스트리** (docs/log/2026-09-03-workspace-restore.md).
 *
 * 여기 있는 것은 맵 하나뿐이다: 패널 id → "지금 접속해라" 함수. 배치 복원으로 뜬 SSH
 * 타일([`PaneSpec.deferred`])의 `Terminal` 이 마운트에서 자기 `startSession` 을 등록하고,
 * `+page` 의 `reconnect-all`(기본 `Ctrl+Shift+R`)과 시작 시 자동 재접속이 그것을
 * **계단식으로** 하나씩 부른다.
 *
 * ## 왜 레지스트리인가 (프롭이 아니라)
 *
 * 세션을 실제로 여는 코드는 `Terminal.svelte` 안에만 있다 — TOFU·비밀번호 모달 왕복,
 * 채널 배선, 크기 계산이 전부 그 컴포넌트의 지역 상태에 묶여 있기 때문이다. 반대로
 * "지금 전부 재연결" 을 명령하는 곳은 창 전역(`+page`)이라, 그 사이를 잇는 길이 필요하다.
 * 프롭으로 신호를 내려보내면 탭·타일 트리 전체를 지나며 컴포넌트마다 구멍을 뚫어야 하고,
 * 트리 모양이 바뀔 때마다 그 배선이 흔들린다. 그래서 이미 앱 안에서 두 번 쓰인 패턴을
 * 그대로 쓴다 — `sync.svelte.ts` 의 `registerInput`, `shell-integration` 의
 * `registerCommands` 와 **같은 모양**이다 (키가 패널 id 라 창·탭이 몇 개든 섞이지 않는다).
 *
 * `$state` 가 아니다 — 렌더에 쓰이지 않고 오직 호출만 된다.
 */

/** 패널 하나를 지금 접속시키는 함수 (= `Terminal.svelte` 의 `connectDeferred`) */
export type ConnectFn = () => void;

const connects = new Map<string, ConnectFn>();

/**
 * 연결 대기 타일의 접속 함수를 등록한다 (마운트 시 1회).
 * 돌려주는 함수를 부르면 해제된다 — 접속에 성공한 순간과 언마운트에서 부른다.
 *
 * 해제는 **내가 넣은 그 함수일 때만** 지운다 (`registerInput` 과 같은 이유 — 같은 id 로
 * 새 인스턴스가 먼저 등록한 뒤 옛 인스턴스의 정리가 늦게 돌아도 새 등록을 지우지 않게).
 */
export function registerConnect(paneId: string, fn: ConnectFn): () => void {
  connects.set(paneId, fn);
  return () => {
    if (connects.get(paneId) === fn) connects.delete(paneId);
  };
}

/** 그 패널을 지금 접속시킨다. 등록이 없으면(이미 붙었거나 사라졌다) 조용히 넘어간다 */
export function connectPane(paneId: string): void {
  connects.get(paneId)?.();
}

/**
 * **붙기 시도 중인 연결 대기 타일** — 패널 id → 그 시도가 끝나면 풀리는 약속 (세션 코어 ②-2).
 *
 * 페이지 리로드 뒤 연결 대기 타일은 먼저 살아 있는 세션에 붙어 본다(`Terminal` 의 `attachDetached`). 붙으면
 * 연결 대기가 아니고(`pane.deferred` 를 지운다), 못 붙으면 그때 [`registerConnect`] 한다. 복원 안내·시작 시 자동
 * 재접속(`app/tabs` 의 `bootTabs`)은 이 결과가 **확정된 뒤**에 세야 한다 — 붙은 타일을 "재연결하세요" 로 세거나,
 * 늦게 등록된 타일을 자동 연결 계단에서 빠뜨리지 않게. 약속은 등록을 먼저 마친 뒤 풀린다(부르는 쪽의 순서).
 */
const settling = new Map<string, Promise<void>>();

/** 붙기 시도를 알린다 — 약속이 풀리면(성공·실패 무관) 표에서 빠진다 */
export function registerSettling(paneId: string, done: Promise<unknown>): void {
  const p = done.then(
    () => {},
    () => {},
  );
  settling.set(paneId, p);
  void p.then(() => {
    if (settling.get(paneId) === p) settling.delete(paneId);
  });
}

/** 붙기 시도를 기다리는 상한 — 그 뒤에는 결과를 모른 채 센다(멈춘 물음 하나가 안내를 영영 막지 않게) */
export const SETTLE_LIMIT_MS = 10_000;

/** 이 패널들 중 붙기 시도 중인 것이 모두 끝날 때까지(상한 [`SETTLE_LIMIT_MS`]) 기다린다 */
export async function whenSettled(paneIds: readonly string[], limitMs = SETTLE_LIMIT_MS): Promise<void> {
  const pending = paneIds.map((id) => settling.get(id)).filter((p): p is Promise<void> => !!p);
  if (pending.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(pending),
    new Promise<void>((r) => {
      timer = setTimeout(r, limitMs);
    }),
  ]);
  clearTimeout(timer);
}

/** 이 패널이 아직 연결을 기다리고 있는가 (등록이 남아 있는가) */
export function awaitsConnect(paneId: string): boolean {
  return connects.has(paneId);
}

/**
 * 여러 패널을 **계단식으로** 접속시킨다 — 간격은 [`RECONNECT_STAGGER_MS`].
 *
 * 같은 프레임에 SSH 핸드셰이크 N 개를 시작하면 sshd 의 `MaxStartups`(아직 인증이 끝나지
 * 않은 연결 수)에 걸려 뒤쪽 몇 개가 이유 없이 거절당한다 — 그룹 전체 열기의
 * `PaneSpec.openDelay` 가 푸는 것과 **같은 문제**라 같은 처방을 쓴다.
 * 돌려주는 값은 실제로 예약된 개수다 (호출부의 안내 문구에 쓴다).
 */
export const RECONNECT_STAGGER_MS = 120;

export function connectStaggered(paneIds: readonly string[]): number {
  paneIds.forEach((id, i) => {
    // 예약을 취소할 필요는 없다 — 그 사이 타일이 닫히면 등록이 사라져 no-op 이 된다.
    setTimeout(() => connectPane(id), i * RECONNECT_STAGGER_MS);
  });
  return paneIds.length;
}
