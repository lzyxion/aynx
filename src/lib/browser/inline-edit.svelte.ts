import { tick } from "svelte";

/**
 * **인라인 편집 한 칸** — 우클릭 메뉴 안에서 이름을 받는 자리(이름 변경 · 새 폴더)의 상태.
 * (호스트 독 폴더의 이름·아이콘·색은 2026-09-29 부터 메뉴 밖의 모달 — `FolderEditDialog`.)
 *
 * 파일 타일과 세션 타일이 똑같이 `menuInput` · `menuError` · `menuInputEl` 세 칸을 들고
 * 있었고, "값을 채우고 → 오류를 비우고 → 한 틱 뒤에 포커스/전체 선택" 하는 절차도 같았다.
 * 모드 이름(`rename` · `newfolder` · `icon` · `confirm`)만 타일마다 달라 그쪽은 남기고,
 * **칸 하나의 상태와 절차**만 여기로 모은다.
 *
 * ## 왜 클래스가 아니라 `$state` 객체인가
 *
 * 마크업이 `bind:value` · `bind:this` 로 **양방향**을 건다. 룬 모듈은 재대입되는 `$state`
 * 를 export 하지 못하므로(룬 규칙), 필드를 가진 객체 한 칸을 돌려주고 마크업이 그 필드를
 * 바인딩한다 — `+page` 의 모달 폼들과 같은 모양이다
 * (docs/log/2026-09-05-refactor-page-split.md §3).
 *
 * ## `data-inline-edit`
 *
 * 이 칸을 그리는 `<input>` 에는 반드시 `data-inline-edit` 을 붙인다. 그 표를 보고 앱 전역의
 * `Ctrl+D`(타일 닫기)·`Alt+화살표`(타일 이동)가 비켜난다
 * (docs/log/2026-09-03-hosts-toolbar-tile-focus.md).
 */
export interface InlineEdit {
  /** 지금 입력값 (`bind:value`) */
  value: string;
  /** 검증 실패 한 줄 — 메뉴를 **열어 둔 채** 말한다 (없으면 `null`) */
  error: string | null;
  /** 칸의 DOM (`bind:this`) — 포커스를 주려면 필요하다 */
  el: HTMLInputElement | null;
}

export function createInlineEdit(): InlineEdit {
  // `$state(...)` 는 **변수 선언의 초기값**으로만 쓸 수 있다 (컴파일러 규칙) — 그래서
  // 곧바로 `return $state(...)` 로 적을 수 없고 한 칸을 거쳐 돌려준다.
  const edit: InlineEdit = $state({ value: "", error: null, el: null });
  return edit;
}

/** 편집을 시작한다 — 값을 채우고 지난 오류를 지운다 (칸은 아직 화면에 없을 수 있다) */
export function beginInlineEdit(edit: InlineEdit, initial = ""): void {
  edit.value = initial;
  edit.error = null;
}

/**
 * 칸에 포커스를 준다 — `select` 가 참이면 **전체 선택**까지.
 *
 * `tick()` 을 기다리는 것이 이 함수의 존재 이유다: `bind:this` 는 Svelte 가 DOM 을 갱신한
 * **뒤에야** 채워지므로, 모드를 바꾼 같은 프레임에 부르면 `el` 이 아직 `null` 이다.
 */
export async function focusInlineEdit(edit: InlineEdit, select = false): Promise<void> {
  await tick();
  if (select) edit.el?.select();
  else edit.el?.focus();
}

/** 편집을 접는다 (메뉴가 닫힐 때) — 다음에 열릴 때 지난 값이 비쳐 보이지 않게 */
export function resetInlineEdit(edit: InlineEdit): void {
  edit.value = "";
  edit.error = null;
}
