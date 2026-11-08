/**
 * **'모두 승인' 확인**(2026-10-23 — docs/log/2026-10-23-approve-all.md) — 호스트 · DB 연결의 AI 권한을 모두 승인(`all`)으로 **새로**
 * 올릴 때 한 번 묻는다. 앱 안 모달(`confirm-dialog.svelte.ts` 의 [`askConfirm`] — 브라우저 `confirm` 아님)이고, 위험 · 경고 종류라
 * 첫 포커스는 [취소]다(Enter 한 번에 넘어가지 않게).
 *
 * 꼴은 게이지 목업(`Confirm.dc.html`)이다: 머리 아래 게이지 미리 보기(가득 · 주황) · 한 줄 · 무엇을 건너뛰고 무엇이 남는지 점 목록 ·
 * 「이해했습니다」 칸(체크해야 확인 단추가 눌린다) · 원격 웹이면 꼬리말(이어서 마스터 재확인). 고르는 규칙은 그대로다 — 이 상자가
 * `true` 를 돌려야 부르는 쪽이 단계를 바꾼다.
 *
 * 부르는 자리: 호스트 폼의 AI 칸 · 타일 머리줄의 AI 권한 팝오버 · 쿼리 타일의 DB AI 권한 메뉴 · DB 연결 폼 · 설정 › 보안의 위임 표.
 * 원격 웹 창에서도 같은 상자가 서고, 저장 명령(`delegation_set_target` · `db_ai_set`)은 그 위에서 다시 재확인(REAUTH)을 지난다.
 */
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";
import { isRemote } from "$lib/ipc";
import { askConfirm } from "./confirm-dialog.svelte";

/** 점 목록 키 — 넷째(전체 스위치)는 둘이 같다 */
const POINTS: Record<"host" | "db", readonly Key[]> = {
  host: ["app.ai.all.confirm.host.p1", "app.ai.all.confirm.host.p2", "app.ai.all.confirm.host.p3", "app.ai.all.confirm.switch"],
  db: ["app.ai.all.confirm.db.p1", "app.ai.all.confirm.db.p2", "app.ai.all.confirm.db.p3", "app.ai.all.confirm.switch"],
};

/** 모두 승인으로 올려도 되는가 — 확인이면 `true`. `what` = 호스트(`host`) · DB 연결(`db`), `name` = 사람이 아는 이름 */
export function confirmApproveAll(what: "host" | "db", name: string): Promise<boolean> {
  return askConfirm(t(what === "host" ? "app.ai.all.confirm.host" : "app.ai.all.confirm.db"), {
    title: t("app.ai.all.confirm.title", { name }),
    kind: "warning",
    danger: true,
    okLabel: t("app.ai.all.confirm.ok"),
    points: POINTS[what].map((k) => t(k)),
    ack: t("app.ai.all.confirm.ack", { name }),
    footnote: isRemote ? t("app.ai.all.confirm.remote") : undefined,
    variant: "approve-all",
  });
}
