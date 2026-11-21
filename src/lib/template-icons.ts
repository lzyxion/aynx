import type { SavedLeaf } from "$lib/tabs";
import { aiIconName, shellIconName } from "$lib/pane-icons";
import { iconRef } from "$lib/host-icons";

/**
 * 탭 템플릿 배치 그림의 칸 로고. 잎 → 그림 규칙은 `PaneIcon.svelte` 와 같다 — 바꾸면 둘을 함께 바꾼다.
 * 다른 점 하나: 원격 AI 타일은 작은 칸에 AI 로고 하나만 세운다.
 */

/** `ai` 는 `AiGlyph`, `host` 는 `HostIcon`, `ui` 는 `UiIcon` 으로 그린다 */
export type TemplateLogo =
  | { type: "ai"; name: string }
  | { type: "host"; icon: string | null; fallback: "server" | "folder" | "none"; color: string | null }
  | { type: "ui"; name: string };

export interface LogoEnv {
  hostOf(alias: string): { icon: string | null; color: string | null } | null;
  engineIconOf(connId: string): string | null;
}

function hostLogo(alias: string | undefined, env: LogoEnv): TemplateLogo {
  const a = alias?.trim();
  const h = a ? env.hostOf(a) : null;
  return { type: "host", icon: h?.icon ?? null, fallback: "server", color: h?.color ?? null };
}

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
