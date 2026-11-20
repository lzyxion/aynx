// **사이드 채팅 권한 모드 칩의 순수 재료**(2026-11-20 — 권한 모드 목업 · Rust `side_chat::perm` 의 거울).
// 모드 낱말 · 칩 그림 · 허용 목록 항목의 이름 · 칩의 `title` · 대신 답한 줄의 글자. 아무것도 부르지 않는다(글자는 넘겨받은 `t` 로).

import type { Key } from "$lib/i18n/keys";
import type { PermMode, ResolvedBy } from "$lib/side-chat-api";

/** Manual 칩의 그림 — 권한 카드와 같은 방패 */
export const PERM_MANUAL_ICON = "shield-check";
/**
 * Auto 칩의 그림 — **이 상수 하나만 바꾼다**(2026-11-20: 최종 그림은 사용자가 후보에서 고르는 중 · 지금은 상태줄 자동 승인 표시와 같은 번개.
 * 겹화살표(≫)는 사용자가 거절).
 */
export const PERM_AUTO_ICON = "zap";

/** 칩 · 메뉴의 모드 낱말 — 번역하지 않는다(ko · en 모두 그대로 · 사용자 확정) */
export const PERM_MODE_WORD: Readonly<Record<PermMode, string>> = { manual: "Manual", auto: "Auto" };

export const PERM_MODES: readonly PermMode[] = ["manual", "auto"];

type Tr = (key: Key, args?: Record<string, string | number>) => string;

/** 허용 목록 열쇠(`outsideRead` · `fileChange` · `command` · `mcp:<서버>`) → 사람 말. 모르는 열쇠는 그대로 */
export function allowKeyLabel(key: string, t: Tr): string {
  if (key.startsWith("mcp:")) return t("app.chatDock.permMode.kind.mcp", { name: key.slice(4) });
  if (key === "outsideRead" || key === "fileChange" || key === "command") return t(`app.chatDock.permMode.kind.${key}` as const);
  return key;
}

/** 칩의 `title` · `aria-label` — 지금 모드를 풀어 적는다(Manual 이면 허용한 종류 수도) */
export function permChipTitle(mode: PermMode, allowed: number, t: Tr): string {
  if (mode === "auto") return t("app.chatDock.permMode.title.auto");
  return allowed > 0 ? t("app.chatDock.permMode.title.manualAllow", { n: allowed }) : t("app.chatDock.permMode.title.manual");
}

/** 서버가 대신 답한 줄의 글자(`auto` · `remembered`) — 그 밖은 `null`(카드의 결과 줄이 따로 고른다) */
export function policyResultKey(by: ResolvedBy): Key | null {
  if (by === "auto") return "app.chatDock.perm.byAuto";
  if (by === "remembered") return "app.chatDock.perm.byRemembered";
  return null;
}
