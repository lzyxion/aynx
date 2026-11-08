// 타일 머리줄 · 몸의 **순수 표시 계산** — `PaneHost.svelte` 에서 뗀 판정들(2026-10-26 분할 3차).
// 앱 상태(설정 · 프로젝트 목록 · 세션 맵)는 읽지 않는다 — 그 값은 부르는 쪽(`PaneHost`)이 인자로 넘긴다.
import { hasSession, type PaneSpec } from "$lib/session";
import type { HostBox } from "$lib/pane/boxes";
import type { TileHeaderMode } from "$lib/settings/model/options";
import type { Project } from "$lib/projects";

/**
 * 이 타일에 **헤더를 다는가** — 설정 `[app] tile_header` 가 정한다
 * (docs/log/2026-09-05-tile-header.md). 기본은 `always`(타일 하나여도 붙인다)이고,
 * `multi` 가 2026-09-05 이전의 동작("패널이 2개 이상인 탭"), `never` 는 안 붙인다.
 *
 * **시작 타일은 어느 값에서도 빠진다.** 헤더는 정체성(이름·색 점)과 손잡이(드래그·×)인데
 * 시작 타일은 셋 다 뜻이 없다: 옮겨 봐야 같은 안내 화면이고, 닫기는 `Ctrl+D`·`close-tile`
 * 로 이미 되며(마지막 타일이면 탭이 닫힌다 — 기존 규칙), 무엇보다 이 화면은
 * **로고와 바로가기가 가운데 서 있는 그림**이라 위에 32px 짜리 띠가 붙으면 그 자리에서만
 * 조금 어긋나 보인다.
 *
 * 설정값(`when`)은 `PaneHost` 가 **직접 읽어** 넘긴다 — 프롭으로 받아 내리지 않는다. 이 판정을 쓰는 곳이
 * 그 컴포넌트 안뿐이라 `+page` 의 표면에 프롭이 하나 더 늘 이유가 없고, `settings.tileHeader`
 * 는 파생값이라 템플릿에서 읽는 것만으로 값이 바뀔 때 그 자리에서 다시 그려진다.
 */
export function tileHeaded(item: HostBox, solo: boolean, when: TileHeaderMode): boolean {
  if (item.pane.kind === "start") return false;
  // 프로듀서 채팅 잎(2단계 단계 3) — 제 머리(캐릭터 · CLI · 모델 · 상태)를 그린다. 머리줄(손잡이 · ⋯)이 없다 — 끌 수 없는 고정 잎(노트 5-1).
  if (item.pane.kind === "producer") return false;
  // 폰(모바일 배치) — 머리줄 대신 위 띠(알약 = 이름 · ⋯ = 이 메뉴 + 머리줄에만 있던 단추 줄 — `pane-menu.ts` 의 `phone`)
  if (solo) return false;
  if (when === "never") return false;
  if (when === "multi") return item.paneCount > 1;
  return true;
}

/** SSH 타일의 호스트 — 별칭으로 찾는다(목록에 없으면 `null`). 별칭 → 호스트 표는 부르는 쪽이 한 번만 편다 */
export const hostOfPane = <H>(pane: PaneSpec, hostByName: ReadonlyMap<string, H>): H | null =>
  pane.kind === "ssh" && pane.alias ? (hostByName.get(pane.alias) ?? null) : null;

/**
 * SFTP 타일의 **원본 터미널이 아직 살아 있는가**. `kindById` 는 모든 탭의 패널을 담고
 * 있으므로 트리를 다시 훑지 않고 존재만 물으면 된다.
 *
 * 이것이 거짓인 것과 세션이 `null` 인 것은 **다른 상태**다: 여기가 거짓이면 원본 타일이
 * 닫혔거나 창 이관에서 빠진 것이라 기다려도 돌아오지 않고, 세션만 `null` 이면 재연결로
 * 돌아온다. 브라우저가 배너 두 개를 따로 두는 근거가 이 구분이다.
 */
export const sourceAlive = (pane: PaneSpec, kindById: ReadonlyMap<string, unknown>): boolean =>
  pane.sourcePaneId !== undefined && kindById.has(pane.sourcePaneId);

/**
 * 파일 타일의 **장소 패널에 세울 프로젝트** — 그 타일의 백엔드 것만: 로컬 파일 타일은 호스트 없는 프로젝트, 원격은
 * 같은 별칭의 프로젝트 (docs/log/2026-10-07-file-tile-dolphin.md). 원격 경로의 `~` 는 타일이 푼다(`browser/places.ts`).
 */
export function fileProjectsFor(
  pane: PaneSpec,
  list: readonly Project[],
): { id: string; name: string; path: string }[] {
  const host = pane.kind === "sftp" ? (pane.alias ?? "") : null;
  return list
    .filter((p) => (host === null ? p.host === null : p.host === host))
    .map((p) => ({ id: p.id, name: p.name, path: p.path }));
}

/**
 * 이 패널이 **터미널**인가 — 헤더의 터미널 전용 표식(✦ AI 공유)과 그 밖의 세션 관련
 * 표시를 켜는 조건이다. 설정·파일 타일은 세션도 입력도 없으므로 이름만 단다.
 */
export const isTerminalPane = (pane: PaneSpec): boolean => hasSession(pane.kind);
