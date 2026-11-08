import { toast } from "$lib/toast.svelte.js";

/**
 * **짧은 안내 한 줄** — 앱 코디네이터 층이 공유하는 유일한 알림 통로
 * (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
 *
 * 예전에는 `+page.svelte` 가 자기 `notice` 상태와 오른쪽 아래 한 줄을 따로 들고 있었다.
 * 그러면 알림이 **한 번에 하나**뿐이라, 계단식 재연결이나 여러 호스트 복제처럼 결과가 여러
 * 줄인 조작에서 마지막 줄이 앞의 것을 조용히 덮어썼다. 지금은 토스트 큐 하나로 들어간다.
 *
 * 이 함수를 (`toast.info` 를 직접 부르지 않고) 남겨 둔 이유는 부르는 자리가 40곳이 넘고
 * 그 대부분이 **"성공도 실패도 아닌 사실"** 이기 때문이다 — 결이 분명한 자리(업로드 완료·
 * 공개키 설치)는 `toast.success` 를 직접 부른다. 지속 시간 6초도 그 성격에서 온다:
 * 여기 오는 문구는 대개 사유가 실린 긴 문장이라 기본 3초로는 다 읽히지 않는다.
 *
 * ## 왜 `app/` 의 첫 모듈인가
 *
 * `app/` 아래 모듈은 전부 이것을 부르고, 이것은 아무도 부르지 않는다 — 의존 그래프의
 * 바닥이라 순환이 생길 자리가 없다 (docs/log/2026-09-05-refactor-page-split.md 의 그림).
 */
export function showNotice(message: string): void {
  toast.info(message, { ms: 6000 });
}
