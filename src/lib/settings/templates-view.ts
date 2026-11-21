import { relativeTime } from "$lib/history-search";
import { cleanTemplateName } from "$lib/tab-templates";
import type { Tr } from "$lib/finish-notify";

/** 설정 › 템플릿의 줄 글자를 짓는 순수 조각 — 프로젝트 목록 · 사전을 직접 모르고 받는다. */

/** `gone` = 목록에 없는 프로젝트 id */
export type TemplateProjectPill = { kind: "project"; name: string } | { kind: "none" } | { kind: "gone" };

export function templateProjectPill(
  projectId: string | undefined,
  nameOf: (id: string) => string | null | undefined,
): TemplateProjectPill {
  if (!projectId) return { kind: "none" };
  const name = nameOf(projectId);
  return name ? { kind: "project", name } : { kind: "gone" };
}

/** `savedAt` 0 = 저장한 날을 모르는 옛 파일 */
export function templateRowSub(summary: string, savedAt: number, now: number, tr: Tr): string {
  const when = savedAt > 0 ? relativeTime(savedAt, now, tr) : "";
  if (when === "") return summary;
  const saved = tr("settings.templates.row.saved", { when });
  return summary === "" ? saved : `${summary} · ${saved}`;
}

/** 바뀐 것만 싣는다. `projectId: null` = 프로젝트 없음 */
export type TemplateEditPlan = { name?: string; projectId?: string | null };

/** 이름은 대소문자만 달라도 바뀐 것이다 */
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
