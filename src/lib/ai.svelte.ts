/**
 * AI 공유 옵트인 (6단계 — docs/log/2026-09-02-mcp-frontend.md).
 *
 * 패널마다 "이 패널의 명령·출력을 로컬 AI(MCP)에 공유할지" 하나의 불리언을 든다.
 * **기본값은 꺼짐**이다 — 프라이버시가 기본이고, 공유는 명시적 조작이어야 한다.
 *
 * ## 왜 반응형 모듈 상태인가 (동시 입력 레지스트리와 같은 자리, 다른 성질)
 *
 * 이 상태를 **두 컴포넌트가** 본다: 패널 헤더의 토글 버튼(`PaneHost`)이 켜고 끄고,
 * 터미널(`Terminal`)이 그 값을 읽어 서버로 밀어 올릴지를 정한다. +page 를 거쳐 프롭으로
 * 내려보내는 대신(sync 처럼) 모듈 하나에 두면 두 컴포넌트가 직접 읽고 쓴다 — 옵트인은
 * +page 의 다른 상태와 얽힐 일이 없어서다. `sync.svelte.ts` 의 입력 레지스트리와 같은
 * 위치지만, 그쪽은 호출만 되는 비반응형 `Map` 이고 이쪽은 **버튼 점등·터미널 `$effect`**
 * 가 구독해야 하므로 반응형 컬렉션(`SvelteSet`)이다.
 *
 * 상태는 **런타임 전용**이다 (v1 에서는 저장하지 않는다) — 앱을 다시 켜면 전부 꺼진 채로 시작한다.
 *
 * ## 2026-10-07 — 이 토글은 **로컬 타일의 것**이다
 *
 * 원격(SSH) 타일의 AI 권한은 호스트 하나의 단계(`delegation.toml` — `app/delegation.svelte.ts` 의
 * `paneAiReadable`)가 정한다. 이 집합은 원격 타일에서 뜻이 없고(Rust 도 그 값을 안 본다), 그래서
 * "이 타일이 AI 에게 보이는가" 를 물을 때는 `isShared` 가 아니라 `paneAiReadable` 을 부른다. 로컬
 * 타일은 실행 권한이 없다 — 읽기 허용 하나뿐이다.
 */

import { SvelteSet } from "svelte/reactivity";

/** 공유가 **켜진** 패널 id 들. 키가 없으면(= 대부분) 꺼짐이다 */
const shared = new SvelteSet<string>();

/** 이 패널이 AI 에 공유 중인가 */
export function isShared(paneId: string): boolean {
  return shared.has(paneId);
}

/** 공유를 뒤집고 **바뀐 뒤의 값**을 돌려준다 (헤더 버튼) */
export function toggleShared(paneId: string): boolean {
  const next = !shared.has(paneId);
  if (next) shared.add(paneId);
  else shared.delete(paneId);
  return next;
}

/**
 * 공유 여부를 **값으로** 세운다 (창 이관 — `tear.ts` 의 `restoreTab`).
 *
 * 토글이 아니라 대입인 이유는 부르는 쪽이 "저쪽 창에서 켜져 있었다" 는 **사실**을 옮겨
 * 심기 때문이다. 뒤집기(`toggleShared`)로 하면 이 창의 현재 값에 따라 결과가 달라진다.
 *
 * 이관이 이 문을 쓰기 전에는 뜯어낸 타일의 공유가 **말없이 꺼졌다** — 공유 집합은 창마다
 * 따로 살고 페이로드에 실리지 않았다 (docs/log/2026-09-08-block-history-store.md).
 */
export function setShared(paneId: string, on: boolean): void {
  if (on) shared.add(paneId);
  else shared.delete(paneId);
}

/**
 * 패널이 사라졌다 — 집합에서 뺀다 (터미널 언마운트).
 * 남겨 둬도 id 가 재사용되지 않아(카운터 단조 증가) 무해하지만, 죽은 패널의 흔적을 남기지 않는다.
 */
export function dropShared(paneId: string): void {
  shared.delete(paneId);
}
