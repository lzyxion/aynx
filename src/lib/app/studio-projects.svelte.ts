/**
 * **스튜디오의 프로젝트** — 앨범의 저장소가 프로젝트 독에 등록돼 있으면 그 이름 · 아이콘 · 색을 스튜디오 카드 · 화면에 쓴다(2026-11-07 사용자).
 * 같은 폴더인가는 기존 서버 판정 `orchestration_same_dir_index`(정션 · 대소문자)로 본다. 없으면 폴더 이름 · 기본 폴더 그림.
 *
 * 그리는 중에 불린다 — 찾기는 저장소마다 한 번(프로젝트 목록의 경로가 바뀌면 다시)이고 답은 비동기로 들어온다. 찾은 것은 id 만 쥔다:
 * 이름 · 아이콘은 늘 지금 프로젝트 목록의 값이다.
 */
import { invoke } from "$lib/ipc";
import { isRemote, type Project } from "$lib/projects";
import { projects } from "$lib/app/project-list.svelte.js";
import { studioLabelOf } from "$lib/orchestration/model/library";

/** 저장소 → 프로젝트 id(`null` = 등록 안 됨) */
const found = $state<Record<string, string | null>>({});
const asked = new Set<string>();
let listKey = "";

async function look(repo: string, list: readonly Project[]): Promise<void> {
  let index: number | null = null;
  try {
    index = await invoke<number | null>("orchestration_same_dir_index", { path: repo, candidates: list.map((p) => p.path) });
  } catch {
    index = null;
  }
  found[repo] = index === null ? null : (list[index]?.id ?? null);
}

/** 그 스튜디오의 프로젝트(로컬 프로젝트만 — 앨범은 로컬 저장소에서 돈다) */
export function studioProject(repo: string): Project | null {
  const list = projects().filter((p) => !isRemote(p));
  const key = list.map((p) => p.path).join("\n");
  if (key !== listKey) {
    listKey = key;
    asked.clear();
  }
  if (repo && !asked.has(repo)) {
    asked.add(repo);
    void look(repo, list);
  }
  const id = found[repo];
  return id ? (list.find((p) => p.id === id) ?? null) : null;
}

/** 스튜디오의 이름 — 프로젝트 이름, 없으면 폴더 이름 */
export function studioLabel(repo: string): string {
  return studioLabelOf(studioProject(repo)?.name, repo);
}
