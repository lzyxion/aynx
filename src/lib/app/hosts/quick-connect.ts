// **빠른 접속** — 설정에 없는 대상에 그 자리에서 붙고, 실제로 붙으면 "호스트로 저장" 을 한 번 권한다
// (권하면 추가 폼을 미리 채워 연다).
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { openPaneHere } from "$lib/app/tabs.svelte.js";
import { newAdhocSshPane, type PaneSpec } from "$lib/session";
import type { QuickConnectTarget } from "$lib/quick-connect";
import { hostForm } from "./form-model.svelte.js";
import { openAdd } from "./form.svelte.js";

// ---------------------------------------------------------------------------
// 빠른 접속 (docs/log/2026-09-16-quick-connect-and-host-keys.md)
// ---------------------------------------------------------------------------

/**
 * 설정에 없는 대상에 **그 자리에서** 붙는다 — [`connect`] 와 **같은 자리 잡기**를 지난다
 * (지금 탭의 활성 타일 옆).
 *
 * 문법·파싱은 부르는 쪽이 이미 끝냈다 (`$lib/quick-connect` 의 `parseQuickConnect`) —
 * 여기 오는 것은 검증된 대상뿐이다. 진입점 둘(명령 팔레트의 맨 윗줄 · 호스트 독 검색 칸의
 * 빈 결과)이 같은 함수를 부르므로 "팔레트로 연 것과 독으로 연 것이 다르다" 가 생기지 않는다.
 */
export function quickConnect(target: QuickConnectTarget): void {
  openPaneHere(newAdhocSshPane(target));
}

/**
 * 이미 **저장을 권한** 타일들 — 같은 타일에 두 번 권하지 않는다.
 *
 * 세션은 재연결마다 새 id 를 받고([`noteSession`]) 그때마다 이 문을 지나므로, 표시가 없으면
 * 네트워크가 흔들릴 때마다 같은 토스트가 다시 뜬다. 타일 id 기준이라 새 빠른 접속 타일은
 * 다시 권유를 받는다 (창을 닫으면 함께 사라지는 메모지다 — 파일에 남기지 않는다).
 */
const adhocOffered = new Set<string>();

/**
 * 빠른 접속 타일이 **실제로 붙었다** — "호스트로 저장" 을 한 번 권한다.
 *
 * 부르는 자리는 `+page` 의 `onsession` 하나다. 그 자리가 곧 "세션 id 가 붙은 순간" 이라
 * 접속 성공의 유일한 증거다 (`openSession` 은 순수 모듈이라 토스트를 모른다).
 *
 * 인라인 배너가 아니라 **토스트**인 이유: 읽고 나면 화면에 남을 이유가 없는 제안이고,
 * 무시하면 그냥 접속한 터미널이 남는다 (`toast.svelte.ts` 머리말의 가름 기준 그대로).
 */
export function offerSaveAdhocHost(pane: PaneSpec): void {
  if (!pane.adhoc || adhocOffered.has(pane.id)) return;
  adhocOffered.add(pane.id);
  const target = pane.adhoc;
  toast.info(t("files.host.adhoc.connected", { target: pane.alias ?? target.host }), {
    action: {
      label: t("files.host.adhoc.save"),
      run: () => openAddFromTarget(target),
    },
  });
}

/**
 * 빠른 접속 대상으로 **호스트 추가 폼을 미리 채워** 연다.
 *
 * 별칭 후보는 호스트 이름 그대로다 — 사람이 그것을 보고 고치는 편이, 우리가 `web-01-2`
 * 같은 이름을 지어내는 것보다 놀랄 자리가 없다. **이미 있는 별칭이면 백엔드가 거절하고**
 * 폼이 그 문구를 그대로 띄운다 (`submitForm` 의 기존 경로).
 */
export function openAddFromTarget(target: QuickConnectTarget): void {
  openAdd();
  hostForm.name = target.host;
  hostForm.hostName = target.host;
  hostForm.user = target.user ?? "";
  hostForm.port = target.port ?? null;
}
