// 앨범 권한의 화면 거울. 최종 넓힘·위험 판정과 rev 검사는 서버가 맡는다.
import type { AlbumAccept, AlbumMemberInput } from "./album-draft";
import type { RunDetail } from "./model/types";

export type AlbumConfigView = NonNullable<RunDetail["album"]>;
export interface AlbumPermissions {
  members: AlbumMemberInput[];
  accept: AlbumAccept;
  verifyAuto: boolean;
  planTools: boolean;
  wakeMax: number;
  autoMerge?: boolean;
}

/** 허용한 칸만 새 객체로 뽑는다. 서버 메타데이터나 시작 때 고정한 칸은 절대 전송하지 않는다. */
export function albumPermissions(source: AlbumPermissions): AlbumPermissions {
  return {
    members: source.members.map(({ artist, grade, allowedCommands }) => ({ artist, grade, allowedCommands: [...allowedCommands] })),
    accept: { require: source.accept.require.map(({ role, passes }) => ({ role, passes })), maxRework: source.accept.maxRework },
    verifyAuto: source.verifyAuto, planTools: source.planTools, wakeMax: source.wakeMax, autoMerge: !!source.autoMerge,
  };
}

const rank = { read: 0, edit: 1, full: 2 };
/** Rust album::widens와 같은 표. 명령은 집합 포함으로 비교하며 순서·삭제는 넓힘이 아니다. */
export function albumWidens(old: AlbumPermissions, next: AlbumPermissions): boolean {
  return next.members.some((n) => {
    const o = old.members.find((m) => m.artist === n.artist);
    return o ? rank[n.grade] > rank[o.grade] || n.allowedCommands.some((c) => !o.allowedCommands.includes(c))
      : n.grade !== "read" || n.allowedCommands.length > 0;
  }) || (!old.verifyAuto && next.verifyAuto) || (!old.planTools && next.planTools) || (!old.autoMerge && !!next.autoMerge)
    || next.wakeMax > old.wakeMax || next.accept.maxRework > old.accept.maxRework
    || old.accept.require.some((o) => !next.accept.require.some((n) => n.role === o.role && n.passes >= o.passes));
}

/** 이미 확인한 위험을 유지하는 좁힘에는 재확인을 요구하지 않는다(S4). */
export function albumPermissionRisk(old: AlbumConfigView, next: AlbumPermissions): boolean {
  const risky = next.verifyAuto || next.planTools || !!next.autoMerge || next.members.some((m) => m.grade === "full");
  return risky && (old.riskConfirmedAt == null || (!old.verifyAuto && next.verifyAuto) || (!old.planTools && next.planTools) || (!old.autoMerge && !!next.autoMerge)
    || next.members.some((n) => n.grade === "full" && old.members.find((o) => o.artist === n.artist)?.grade !== "full"));
}

export function albumChangeBody(runId: string, old: AlbumConfigView, next: AlbumPermissions, widen: boolean, riskConfirmed: boolean) {
  // 자동 병합은 켰을 때만 싣는다(판 26 세션 서버가 모르는 칸을 거절하지 않게 · 칸 없음 = 꺼짐).
  const { autoMerge, ...rest } = albumPermissions(next);
  return { runId, expectRev: old.rev, next: { ...rest, ...(autoMerge ? { autoMerge: true } : {}) }, ...(widen ? { riskConfirmed } : {}) };
}

export const ALBUM_PERMISSION_FAILURES = ["album-changed", "widens", "risk-not-confirmed", "bad-args", "unknown-role", "no-verify-command", "run-stopped", "run-orphaned", "not-found"] as const;
export function albumPermissionFailureKey(error: unknown) {
  const word = ALBUM_PERMISSION_FAILURES.find((w) => String(error).includes(`[${w}]`));
  return `orch.perm.failure.${word ?? "unknown"}` as const;
}

export function albumPermissionsValid(d: AlbumPermissions): boolean {
  return d.members.length <= 8 && new Set(d.members.map((m) => m.artist)).size === d.members.length
    && d.members.every((m) => m.allowedCommands.length <= 32 && m.allowedCommands.every((c) => !!c.trim() && [...c].length <= 200 && !/[()*\u0000-\u001f\u007f]/.test(c)))
    && Number.isInteger(d.accept.maxRework) && d.accept.maxRework >= 0 && d.accept.maxRework <= 10
    && d.accept.require.every((r) => d.members.some((m) => m.artist === r.role) && Number.isInteger(r.passes) && r.passes >= 1 && r.passes <= 3)
    && Number.isInteger(d.wakeMax) && d.wakeMax >= 0 && d.wakeMax <= 200;
}
