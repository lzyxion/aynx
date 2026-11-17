import { relativeTime } from "$lib/history-search";
import { cleanTemplateName } from "$lib/tab-templates";
import type { Tr } from "$lib/finish-notify";

/**
 * 설정 › 템플릿(`TemplatesSection`)의 **줄 글자**를 짓는 순수 조각(2026-11-17) — 프로젝트 알약 · 보조 줄.
 *
 * 화면은 템플릿 목록(파일 순서 = 최근 저장 먼저)을 그대로 돌며 이 두 함수로 글자만 받는다. 타일 요약
 * (`templateSummary` — "AI 2 · SSH · DB")은 창 층(`app/tab-templates`)이 짓고, 여기는 거기에 저장한 날을 붙인다.
 * 프로젝트 목록 · 사전을 직접 모른다 — 이름 찾기(`nameOf`)와 사전(`tr`)을 받는다.
 */

/** 프로젝트 알약 — 프로젝트 템플릿 · 프로젝트 없음 · 프로젝트를 찾지 못함(목록에 없는 id) */
export type TemplateProjectPill = { kind: "project"; name: string } | { kind: "none" } | { kind: "gone" };

export function templateProjectPill(
  projectId: string | undefined,
  nameOf: (id: string) => string | null | undefined,
): TemplateProjectPill {
  if (!projectId) return { kind: "none" };
  const name = nameOf(projectId);
  return name ? { kind: "project", name } : { kind: "gone" };
}

/**
 * 보조 줄 — "AI 2 · SSH · 3일 전 저장". 저장한 날을 모르면(옛 파일 · `savedAt` 0) 요약만, 요약이 비면 날만.
 * 날짜는 팔레트 · 실행기와 같은 [`relativeTime`] 계단(일주일이 넘으면 `YYYY-MM-DD`)이다.
 */
export function templateRowSub(summary: string, savedAt: number, now: number, tr: Tr): string {
  const when = savedAt > 0 ? relativeTime(savedAt, now, tr) : "";
  if (when === "") return summary;
  const saved = tr("settings.templates.row.saved", { when });
  return summary === "" ? saved : `${summary} · ${saved}`;
}

/** 편집 화면이 할 일 — 바뀐 것만. `name` = 새 이름(다듬은 것), `projectId` = 새 프로젝트(`null` = 없음) */
export type TemplateEditPlan = { name?: string; projectId?: string | null };

/**
 * 편집 화면([저장])의 **무엇이 바뀌었나** — 이름은 다듬어(`cleanTemplateName`) 견주고(대소문자만 달라도 바뀐 것), 프로젝트는 고르기
 * 값(`""` = 없음)과 견준다. 둘 다 그대로면 빈 계획 — 화면은 쓰지 않고 돌아간다. 이름이 비면 `name` 을 싣지 않는다(화면이 먼저 막는다).
 */
export function templateEditPlan(
  cur: { name: string; projectId?: string },
  form: { name: string; projectId: string },
): TemplateEditPlan {
  const plan: TemplateEditPlan = {};
  const name = cleanTemplateName(form.name);
  if (name !== "" && name !== cur.name) plan.name = name;
  const projectId = form.projectId || null;
  if (projectId !== (cur.projectId || null)) plan.projectId = projectId;
  return plan;
}
