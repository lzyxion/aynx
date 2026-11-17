import type { SavedLeaf } from "$lib/tabs";
import { aiIconName, shellIconName } from "$lib/pane-icons";
import { iconRef } from "$lib/host-icons";

/**
 * **탭 템플릿 배치 그림의 칸 로고 — 순수 층**(2026-11-17) — 템플릿의 작은 분할 그림(`TemplatePreview.svelte`)이 칸마다 "셸" ·
 * "DB" 같은 글자 대신 그 타일의 로고를 얹을 때, 잎 하나에서 그림을 고른다. 앱 상태(호스트 목록 · DB 연결 사본)는 창 층
 * (`app/tab-templates` 의 `templateLeafLogo`)이 넘긴다. 룬도 DOM 도 없다.
 *
 * ## 그림은 타일이 이미 쓰는 그대로
 *
 * 잎 → 그림 규칙은 타일 앞자리 아이콘(`PaneIcon.svelte`)과 같다 — 탭 줄 · 타일 머리줄에서 본 그 그림이 템플릿 칸에도 선다.
 * 다른 점 하나: 원격 AI 타일은 `PaneIcon` 이 AI 로고 + 호스트 아이콘 둘을 세우지만, 작은 칸에는 **AI 로고 하나**다.
 */

/** 그리는 법 하나 — `ai` 는 `AiGlyph`, `host` 는 `HostIcon`(값 · 폴백 · 호스트 색), `ui` 는 `UiIcon` */
export type TemplateLogo =
  | { type: "ai"; name: string }
  | { type: "host"; icon: string | null; fallback: "server" | "folder" | "none"; color: string | null }
  | { type: "ui"; name: string };

/** 앱 상태에서 찾을 것 — 호스트의 아이콘 · 색(별칭), DB 연결의 엔진 로고(연결 id) */
export interface LogoEnv {
  hostOf(alias: string): { icon: string | null; color: string | null } | null;
  engineIconOf(connId: string): string | null;
}

/** 호스트 아이콘 — 목록에 없는 별칭(빠른 접속 포함)이면 서버 랙 폴백 */
function hostLogo(alias: string | undefined, env: LogoEnv): TemplateLogo {
  const a = alias?.trim();
  const h = a ? env.hostOf(a) : null;
  return { type: "host", icon: h?.icon ?? null, fallback: "server", color: h?.color ?? null };
}

/** 잎 하나의 그림 — `PaneIcon` 의 갈림과 같다(머리말) */
export function leafLogo(leaf: SavedLeaf, env: LogoEnv): TemplateLogo {
  switch (leaf.kind) {
    case "local": {
      const ai = leaf.autorun ? aiIconName(leaf.autorun) : null;
      if (ai) return { type: "ai", name: ai };
      return { type: "host", icon: iconRef(shellIconName(leaf.shell)), fallback: "none", color: null };
    }
    case "ssh": {
      const ai = leaf.autorun ? aiIconName(leaf.autorun) : null;
      return ai ? { type: "ai", name: ai } : hostLogo(leaf.alias, env);
    }
    case "sftp":
      return hostLogo(leaf.alias, env);
    case "localfs":
      return { type: "host", icon: null, fallback: "folder", color: null };
    case "query": {
      const engine = leaf.query?.connId ? env.engineIconOf(leaf.query.connId) : null;
      return engine ? { type: "host", icon: engine, fallback: "none", color: null } : { type: "ui", name: "database" };
    }
    case "doc":
      return { type: "ui", name: "file-text" };
    case "image":
      return { type: "ui", name: "image" };
    case "branches":
      return { type: "ui", name: "git-branch" };
    case "diff":
      return { type: "ui", name: "git-compare" };
    default:
      return { type: "ui", name: "home" };
  }
}

/** 그림을 가르는 키 — 같은 키면 같은 그림이다 */
export function logoKey(logo: TemplateLogo): string {
  switch (logo.type) {
    case "ai":
      return `ai:${logo.name}`;
    case "ui":
      return `ui:${logo.name}`;
    case "host":
      return `host:${logo.icon ?? `(${logo.fallback})`}:${logo.color ?? ""}`;
  }
}
