import type { Key } from "$lib/i18n/keys";

/** 세션 서버 [다시 시작] · [모든 세션 종료] 확인 문구의 순수 판정 — i18n 을 가져오지 않는다. 문구는 트레이 [모든 세션 종료…] 의 Rust 대화상자와 같은 뜻이다. */
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
