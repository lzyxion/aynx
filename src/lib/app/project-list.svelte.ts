import { invoke, listen } from "../ipc";
import { parseProjects, type Project } from "$lib/projects";

/**
 * **프로젝트 목록의 창 사본** (docs/log/2026-09-24-projects.md) — 상태와 왕복만.
 *
 * 쓰는 것은 Rust 하나다(`projects.rs` — 한 줄씩 고치고 `projects-changed` 를 쏜다). 이 모듈은
 * 사본을 **부팅 때 한 번 · 이벤트가 올 때마다 · 창이 포커스를 얻을 때마다** 다시 읽는다
 * (`app/host-history.svelte.ts` 와 같은 모양 — 포커스는 이벤트를 놓친 경우의 그물이다).
 *
 * ## 왜 `app/projects.svelte.ts` 와 갈라 두었나
 *
 * 여는 길·폼(`projects.svelte.ts`)은 호스트 층(`app/hosts.svelte.ts` — 스크롤백·대상 문구)을
 * 들여온다. 그런데 호스트 **제거·이름 변경 팬아웃**(`app/host-remove.ts`·`host-rename.ts`)이
 * 이 목록을 세고 고쳐야 하고, 그 둘은 호스트 층이 들여오는 모듈이다 — 한 파일이면 값 import 가
 * 제자리로 도는 순환이 생긴다(`npm run check:cycles`). 목록만 여기 두면 팬아웃은 이것만 본다.
 */

/** 이벤트 이름 — Rust `projects::CHANGED_EVENT` 와 같은 글자 */
export const PROJECTS_CHANGED_EVENT = "projects-changed";

let list = $state<Project[]>([]);

/** 지금 사본 (파일 순서 · 반응형) — 독·팔레트·즐겨찾기가 읽는다 */
export function projects(): readonly Project[] {
  return list;
}

/** id 로 하나 (없으면 `null`) — 숨긴 workspace 타일도 전역에서 찾는다 */
export function projectById(id: string): Project | null {
  return list.find((p) => p.id === id) ?? null;
}

/** 저장이 끝난 한 줄을 사본에 곧바로 반영한다 — 이벤트가 오면 같은 값으로 다시 읽힌다 */
export function putProjectLocal(p: Project): void {
  const i = list.findIndex((x) => x.id === p.id);
  list = i < 0 ? [...list, p] : list.map((x) => (x.id === p.id ? p : x));
}

/** 지운 한 줄을 사본에서 곧바로 뺀다 */
export function dropProjectLocal(id: string): void {
  list = list.filter((x) => x.id !== id);
}

/** 다시 읽는다. 실패는 삼킨다 — 목록이 못 뜬다고 앱이 멈출 일이 아니다(콘솔에 한 줄) */
export async function refreshProjects(): Promise<void> {
  try {
    list = parseProjects(await invoke<unknown>("projects_list"));
  } catch (e) {
    console.warn("[aynx] 프로젝트 목록을 읽지 못했습니다 (무시):", e);
  }
}

/** 창 수명 동안 사본을 맞춘다 — `mountAppListeners` 가 건다. 돌려준 함수가 전부 푼다 */
export function mountProjects(): () => void {
  void refreshProjects();
  const changed = listen(PROJECTS_CHANGED_EVENT, () => void refreshProjects()).catch(
    () => () => {},
  );
  const onFocus = () => void refreshProjects();
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  return () => {
    void changed.then((un) => un());
    if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
  };
}

/** 호스트 이름 변경을 따라간다 — 이름 변경 팬아웃(`app/host-rename.ts`) 전용 */
export function renameProjectsHost(from: string, to: string): Promise<void> {
  return invoke("project_rename_host", { from, to });
}

/** 지운 호스트의 원격 프로젝트를 뺀다 — 제거 팬아웃(`app/host-remove.ts`) 전용 */
export async function forgetProjectsHost(aliases: readonly string[]): Promise<void> {
  // 하나씩 차례로 — Rust 쪽 잠금이 어차피 줄 세운다 (`forgetHostHistory` 와 같은 모양).
  for (const alias of aliases) await invoke("projects_forget_host", { alias });
}
