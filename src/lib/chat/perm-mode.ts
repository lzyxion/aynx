// Rust `side_chat::perm` 의 거울 — 허용 목록 열쇠(`outsideRead` · `fileChange` · `command` · `mcp:<서버>`)는 그쪽과 같은 글자다.

import type { Key } from "$lib/i18n/keys";
import type { PermMode, ResolvedBy } from "$lib/side-chat-api";

export const PERM_MANUAL_ICON = "shield-check";
/** Auto 칩의 그림은 이 상수 하나만 바꾼다 — 겹화살표(≫)는 사용자가 거절했다 */
export const PERM_AUTO_ICON = "zap";

/** 번역하지 않는다(ko · en 모두 그대로 · 사용자 확정) */
export const PERM_MODE_WORD: Readonly<Record<PermMode, string>> = { manual: "Manual", auto: "Auto" };

export const PERM_MODES: readonly PermMode[] = ["manual", "auto"];

type Tr = (key: Key, args?: Record<string, string | number>) => string;

export function allowKeyLabel(key: string, t: Tr): string {
  if (key.startsWith("mcp:")) return t("app.chatDock.permMode.kind.mcp", { name: key.slice(4) });
  if (key === "outsideRead" || key === "fileChange" || key === "command") return t(`app.chatDock.permMode.kind.${key}` as const);
  return key;
}

export function permChipTitle(mode: PermMode, allowed: number, t: Tr): string {
  if (mode === "auto") return t("app.chatDock.permMode.title.auto");
  return allowed > 0 ? t("app.chatDock.permMode.title.manualAllow", { n: allowed }) : t("app.chatDock.permMode.title.manual");
}

export function policyResultKey(by: ResolvedBy): Key | null {
  if (by === "auto") return "app.chatDock.perm.byAuto";
  if (by === "remembered") return "app.chatDock.perm.byRemembered";
  return null;
}
