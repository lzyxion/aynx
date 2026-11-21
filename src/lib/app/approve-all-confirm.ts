/**
 * AI 권한을 모두 승인(`all`)으로 새로 올릴 때의 확인 — `true` 를 돌려야 부르는 쪽이 단계를 바꾼다(docs/log/2026-10-23-approve-all.md).
 * 원격 웹 창에서는 저장 명령(`delegation_set_target` · `db_ai_set`)이 그 위에서 다시 재확인(REAUTH)을 지난다.
 */
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";
import { isRemote } from "$lib/ipc";
import { askConfirm } from "./confirm-dialog.svelte";

const POINTS: Record<"host" | "db", readonly Key[]> = {
  host: ["app.ai.all.confirm.host.p1", "app.ai.all.confirm.host.p2", "app.ai.all.confirm.host.p3", "app.ai.all.confirm.switch"],
  db: ["app.ai.all.confirm.db.p1", "app.ai.all.confirm.db.p2", "app.ai.all.confirm.db.p3", "app.ai.all.confirm.switch"],
};

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
