/**
 * 앨범 병합 — 앨범 줄 판정 · 확인 창의 검사 줄 · 멈춘 까닭 문구(서버 `orchestration/album_merge.rs`). 판정은 서버가 하고 여기는 보기만 짓는다.
 */

import type { Key } from "$lib/i18n/keys";
import { keyOf, type Tr } from "./text";
import type { LogEntry, RunDetail } from "./types";

/** `orchestration_merge_preview` 의 답 */
export interface MergePreview {
  runId: string;
  branch: string;
  target?: string | null;
  head?: string | null;
  state: "ready" | "blocked" | "merged";
  /** 세 줄로 보일 수 없는 까닭(낡음 · 대상 없음 · 지원 밖 …) */
  reason?: string | null;
  detail?: string | null;
  /** 세 줄을 실제로 판정했다 */
  checked: boolean;
  mergeBase?: string | null;
  commits: number;
  files: number;
  additions: number;
  deletions: number;
  dirty: { count: number; paths: string[] };
  inProgress: boolean;
  current?: string | null;
  onTarget: boolean;
  conflicts: { count: number; paths: string[] };
}

/** `orchestration_merge` 의 답 */
export interface MergeResult {
  merged: boolean;
  already?: boolean;
  commit?: string;
  target?: string;
  reason?: string | null;
  detail?: string;
  unchanged?: boolean;
  preview?: MergePreview;
}

/** 까닭 낱말 → 문구(서버 낱말 전부 — 시험이 지킨다). 모르는 낱말은 그대로 보인다 */
export const MERGE_WHY_KEY: Record<string, Key> = {
  dirty: "orch.merge.why.dirty",
  "in-progress": "orch.merge.why.in-progress",
  "wrong-branch": "orch.merge.why.wrong-branch",
  conflict: "orch.merge.why.conflict",
  stale: "orch.merge.why.stale",
  "branch-moved": "orch.merge.why.branch-moved",
  "not-exported": "orch.merge.why.not-exported",
  "no-base-branch": "orch.merge.why.no-base-branch",
  "target-missing": "orch.merge.why.target-missing",
  unrelated: "orch.merge.why.unrelated",
  "git-unsupported": "orch.merge.why.git-unsupported",
  "repo-changed": "orch.merge.why.repo-changed",
  "merge-failed": "orch.merge.why.merge-failed",
  "merge-stale": "orch.merge.why.merge-stale",
  "merge-busy": "orch.merge.why.merge-busy",
  "run-state": "orch.merge.why.run-state",
  "on-hold": "orch.merge.why.on-hold",
  "no-verify-command": "orch.merge.why.no-verify-command",
  "no-accepted": "orch.merge.why.no-accepted",
  waived: "orch.merge.why.waived",
  "verify-not-passed": "orch.merge.why.verify-not-passed",
  "verify-overridden": "orch.merge.why.verify-overridden",
  "accept-rule-unmet": "orch.merge.why.accept-rule-unmet",
  "head-not-verified": "orch.merge.why.head-not-verified",
  "export-failed": "orch.merge.why.export-failed",
  "role-invalid": "orch.merge.why.role-invalid",
};

/** 까닭 한 문장(끝 온점 없음) — 분리 HEAD 는 세부가 비어 있다 */
export function mergeWhyText(reason: string, detail: string | null | undefined, tr: Tr): string {
  if (reason === "wrong-branch" && !detail) return tr("orch.merge.why.detached");
  const key = keyOf(MERGE_WHY_KEY, reason);
  return key ? tr(key, { detail: detail ?? "" }) : reason;
}

/** 커밋 짧은 표기(서버 장부와 같은 길이) */
export function shortCommit(oid: string): string {
  return oid.slice(0, 7);
}

/** 앨범의 내보낸 브랜치 줄 */
export type MergeRow =
  | { kind: "hidden" }
  | { kind: "merged"; target: string; commit: string | null; auto: boolean }
  | { kind: "ready" | "stale" | "no-target" | "waiting"; branch: string; canMerge: boolean; stale: boolean; stop: { reason: string; detail?: string | null } | null };

export function mergeRow(run: Pick<RunDetail, "integration" | "merge" | "mergedOutside">): MergeRow {
  const i = run.integration;
  if (!i) return { kind: "hidden" };
  const done = run.merge?.merged;
  // 앱이 한 병합은 그 머리가 지금 내보낸 머리일 때만 뜻이 있다(그 뒤 다시 내보냈으면 새 결과가 남았다).
  if (done && done.head === i.exportedHead) return { kind: "merged", target: done.target, commit: done.commit, auto: done.by === "server" };
  if (run.mergedOutside && i.baseBranch) return { kind: "merged", target: i.baseBranch, commit: null, auto: false };
  const stop = run.merge?.stopped ?? null;
  if (!i.exportedHead && !stop) return { kind: "hidden" };
  const stale = !!i.exportedHead && i.exportedHead !== i.expectedHead;
  const canMerge = !!i.exportedHead && !stale && !!i.baseBranch;
  const kind = stop ? "waiting" : !i.baseBranch ? "no-target" : stale ? "stale" : "ready";
  return { kind, branch: i.exportBranch, canMerge, stale, stop };
}

/** 확인 창의 검사 줄 하나 */
export interface MergeCheckRow {
  id: "clean" | "progress" | "branch" | "conflict" | "blocked";
  ok: boolean;
  text: string;
  /** 막혔을 때 — 까닭 · 해결 방법 */
  fix?: string;
}

const pathList = (paths: readonly string[], count: number): string => (count > paths.length ? `${paths.join(", ")} …` : paths.join(", "));

/** 검사 줄 — 세 줄(목업)에 진행 중인 병합 · rebase 줄과 세 줄로 못 보이는 까닭을 더한다 */
export function mergeCheckRows(p: MergePreview, tr: Tr): MergeCheckRow[] {
  const rows: MergeCheckRow[] = [];
  const target = p.target ?? "";
  if (p.reason) rows.push({ id: "blocked", ok: false, text: mergeWhyText(p.reason, p.detail, tr) });
  if (!p.checked) return rows;
  rows.push(
    p.dirty.count === 0
      ? { id: "clean", ok: true, text: tr("orch.merge.check.clean.ok") }
      : { id: "clean", ok: false, text: tr("orch.merge.check.clean.bad", { n: p.dirty.count }), fix: tr("orch.merge.check.clean.fix", { paths: pathList(p.dirty.paths, p.dirty.count) }) },
  );
  if (p.inProgress) rows.push({ id: "progress", ok: false, text: tr("orch.merge.check.progress.bad"), fix: tr("orch.merge.check.progress.fix") });
  rows.push(
    p.onTarget
      ? { id: "branch", ok: true, text: tr("orch.merge.check.branch", { branch: target }) }
      : {
          id: "branch",
          ok: false,
          text: p.current ? tr("orch.merge.check.branch", { branch: p.current }) : tr("orch.merge.check.branch.detached"),
          fix: tr("orch.merge.check.branch.fix", { branch: target }),
        },
  );
  // 지원 밖 저장소는 충돌 검사(`merge-tree`)를 돌리지 않았다 — "충돌 없음" 을 말하지 않는다.
  if (p.reason !== "git-unsupported" && p.reason !== "merge-failed" && p.reason !== "unrelated") {
    rows.push(
      p.conflicts.count === 0
        ? { id: "conflict", ok: true, text: tr("orch.merge.check.conflict.ok") }
        : {
            id: "conflict",
            ok: false,
            text: tr("orch.merge.check.conflict.bad", { n: p.conflicts.count }),
            fix: tr("orch.merge.check.conflict.fix", { paths: pathList(p.conflicts.paths, p.conflicts.count), branch: target }),
          },
    );
  }
  return rows;
}

/** 확인 창의 트랙 줄 — 수락된 트랙의 제목 + `수락 · 검증 통과 · 검토 통과` 식 상태 */
export function mergeTracks(run: Pick<RunDetail, "tasks" | "accepted" | "jobs">, tr: Tr): { id: string; title: string; status: string }[] {
  const valid = (run.accepted ?? []).filter((a) => !a.revokedAt && !!a.integrationCommit);
  return valid.map((a) => {
    const job = (run.jobs ?? []).find((j) => j.jobId === a.jobId);
    const parts: string[] = [tr("orch.merge.track.accepted")];
    if (job?.override) parts.push(tr("orch.merge.track.overridden"));
    else if (job?.verify?.outcome === "pass") parts.push(tr("orch.merge.track.verified"));
    if ((a.waived?.length ?? 0) > 0) parts.push(tr("orch.merge.track.waived"));
    else if ((a.judgments?.length ?? 0) > 0 || a.reviewId) parts.push(tr("orch.merge.track.reviewed"));
    return { id: a.taskId, title: run.tasks.find((t) => t.id === a.taskId)?.title ?? a.taskId, status: parts.join(" · ") };
  });
}

/** 타임라인의 병합 줄 — `main에 병합` · `자동 병합`. 대상 브랜치가 문장에 들어가 대상 칸은 따로 그리지 않는다. 다른 사건은 `null` */
export function mergeTimelineWhat(e: Pick<LogEntry, "action" | "target">, tr: Tr): string | null {
  if (e.action === "integration_merged") return tr("orch.merge.timeline.to", { branch: e.target ?? "" });
  if (e.action === "integration_auto_merged") return tr("orch.action.integration_auto_merged");
  return null;
}
