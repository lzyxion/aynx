import type { Key } from "$lib/i18n/keys";

/**
 * 설정 › 일반 › 세션 서버 줄의 [다시 시작] · [모든 세션 종료] 가 **먼저 물을지**와 무엇을 물을지 — 순수 판정.
 *
 * 살아 있는 세션이 0개면 닫힐 것이 없으니 묻지 않는다(`null` — 바로 실행). 세션 수를 모르면(상태를 아직 못 읽음 ·
 * 끊김) 닫힐 수 있다고 보고 수 없이 묻는다. 문구는 트레이 [모든 세션 종료…] 의 Rust 대화상자와 같은 뜻이다.
 * 대화는 앱의 다른 확인과 같은 네이티브 `ask()` 가 띄운다 — 여기는 키와 값만 고른다(i18n 을 가져오지 않는다).
 */
export type ServerAction = "restart" | "closeAll";

export type ServerConfirm = {
  message: Key;
  params?: Record<string, number>;
  ok: Key;
};

export function serverConfirm(action: ServerAction, sessions: number | null | undefined): ServerConfirm | null {
  if (sessions === 0) return null;
  const known = typeof sessions === "number" && sessions > 0;
  if (action === "closeAll") {
    return known
      ? { message: "settings.general.server.close_all.ask", params: { count: sessions }, ok: "settings.general.server.close_all" }
      : { message: "settings.general.server.close_all.ask.unknown", ok: "settings.general.server.close_all" };
  }
  return known
    ? { message: "settings.general.server.restart.ask", params: { count: sessions }, ok: "settings.general.server.restart" }
    : { message: "settings.general.server.restart.ask.unknown", ok: "settings.general.server.restart" };
}
