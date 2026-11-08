// 앨범 초안의 순수 모양 · 기본값 병합 · 제출 열쇠. 서버 상태나 브라우저 저장소를 쓰지 않는다.
import type { ArtistProfile } from "./artist-form";
import { EFFORTS, LIMITS, modelOk, type RoleCli } from "./config";

export interface AlbumMemberInput { artist: string; grade: "read" | "edit" | "full"; allowedCommands: string[] }
export interface AlbumAccept { require: { role: string; passes: number }[]; maxRework: number }
export type AlbumLimits = Record<"maxConcurrentWorkers" | "maxTotalWorkers" | "coordinationMinutes" | "turnMinutes" | "maxReviews", number>;
export interface AlbumVerify { command: string; timeoutMinutes: number; auto: boolean; keepDirs: string[]; cacheKeyFiles: string[]; extraEnv: string[] }
export interface AlbumDefaults {
  members?: AlbumMemberInput[]; accept?: AlbumAccept; verify?: Partial<AlbumVerify> | null;
  limits?: Partial<AlbumLimits>; verifyAuto?: boolean; planTools?: boolean; wakeMax?: number;
  producer?: { cli: RoleCli; model: string; effort?: string | null } | null;
  /** 같은 저장소의 지난 앨범에서 온 구성인가(없으면 씨앗 기본) — 옛 서버는 칸이 없다 → 거짓으로 본다 */
  fromLast?: boolean;
}
export interface AlbumDraft {
  repo: string; name: string; text: string; cli: RoleCli; model: string; effort: string;
  members: AlbumMemberInput[]; accept: AlbumAccept; verify: AlbumVerify; limits: AlbumLimits;
  planTools: boolean; wakeMax: number; riskConfirmed: boolean;
  /** 완료되면 자동 병합 — 기본 꺼짐 · 지난 앨범에서 물려받지 않는다 */
  autoMerge: boolean;
}
export interface AlbumFork { agent: RoleCli; conv: string }
export interface AlbumStartInput {
  /** 강도 `null` = CLI 기본(칸 없음) — 빈 문자열은 보내지 않는다(서버 bad-args) */
  chat: string; clientId: string; text: string; repo: string; cli: RoleCli; model: string; effort: string | null; name: string; fork?: AlbumFork;
  /** `autoMerge` 는 켰을 때만 싣는다 — 판 26 세션 서버가 모르는 칸을 거절하지 않게 */
  album: Pick<AlbumDraft, "members" | "accept" | "verify" | "limits" | "planTools" | "wakeMax" | "riskConfirmed"> & { autoMerge?: true };
}
export interface AlbumStartResult { runId: string; gen: number; chat: string; sent: boolean; state: string; epoch: number }
export const ALBUM_LIMITS = LIMITS as readonly { key: keyof AlbumLimits; default: number; max: number; label: (typeof LIMITS)[number]["label"] }[];

export function blankAlbumDraft(): AlbumDraft {
  return { repo: "", name: "", text: "", cli: "claude", model: "", effort: "", members: [], accept: { require: [], maxRework: 3 },
    verify: { command: "", timeoutMinutes: 10, auto: false, keepDirs: [], cacheKeyFiles: [], extraEnv: [] },
    limits: Object.fromEntries(ALBUM_LIMITS.map((l) => [l.key, l.default])) as AlbumLimits, planTools: false, wakeMax: 30, riskConfirmed: false, autoMerge: false };
}

/** 목록 갱신으로 지워진 멤버와 판정 규칙을 함께 뺀다. 살아 있는 편집은 보존한다. */
export function pruneAlbumArtists(draft: AlbumDraft, artists: readonly ArtistProfile[]): AlbumDraft {
  const members = draft.members.filter((m) => artists.some((a) => a.id === m.artist)).map((m) => {
    const judge = artists.find((a) => a.id === m.artist)?.kind === "judge";
    return { ...m, grade: judge ? "read" as const : m.grade, allowedCommands: judge ? [] : [...m.allowedCommands] };
  });
  return { ...draft, members, accept: { ...draft.accept, require: draft.accept.require.filter((r) => members.some((m) => m.artist === r.role) && artists.some((a) => a.id === r.role && a.kind === "judge")) } };
}

/** 저장소를 바꾸면 구성·프로듀서만 새로 채우고 사람이 쓴 이름과 첫 말은 둔다. 위험 확인은 새로 받는다. */
export function mergeAlbumDefaults(draft: AlbumDraft, defaults: AlbumDefaults, artists: readonly ArtistProfile[], fork?: AlbumFork): AlbumDraft {
  const base = blankAlbumDraft();
  const writer = artists.find((a) => a.kind === "write");
  const judge = artists.find((a) => a.kind === "judge");
  const members = defaults.members ?? [ ...(writer ? [{ artist: writer.id, grade: "edit" as const, allowedCommands: [] }] : []), ...(judge ? [{ artist: judge.id, grade: "read" as const, allowedCommands: [] }] : []) ];
  const producer = defaults.producer;
  const cli = fork?.agent ?? producer?.cli ?? base.cli;
  const same = !producer || producer.cli === cli;
  const accept = defaults.accept ?? { require: judge ? [{ role: judge.id, passes: 1 }] : [], maxRework: 3 };
  return pruneAlbumArtists({ ...base, repo: draft.repo, name: draft.name, text: draft.text, cli,
    model: same ? producer?.model ?? "" : "", effort: same ? producer?.effort ?? "" : "", members,
    accept: { ...accept, require: accept.require.map((r) => ({ ...r })) },
    verify: { command: defaults.verify?.command ?? "", timeoutMinutes: defaults.verify?.timeoutMinutes ?? base.verify.timeoutMinutes, auto: defaults.verifyAuto ?? defaults.verify?.auto ?? false,
      keepDirs: [...(defaults.verify?.keepDirs ?? [])], cacheKeyFiles: [...(defaults.verify?.cacheKeyFiles ?? [])], extraEnv: [...(defaults.verify?.extraEnv ?? [])] },
    limits: { ...base.limits, ...defaults.limits }, planTools: defaults.planTools ?? false, wakeMax: defaults.wakeMax ?? 30,
  }, artists);
}

/** 보낼 시작 입력 — 초안의 빈 강도("" = CLI 기본)는 `null` 로 바꾼다 */
export function albumStartInput(d: AlbumDraft, chat: string, clientId: string, fork?: AlbumFork): AlbumStartInput {
  const { repo, cli, model, effort, name, text, members, accept, verify, limits, planTools, wakeMax, riskConfirmed } = d;
  const autoMerge = autoMergeOn(d);
  return { chat, clientId, repo, cli, model, effort: effort || null, name, text, ...(fork ? { fork } : {}),
    album: { members, accept, verify, limits, planTools, wakeMax, riskConfirmed, ...(autoMerge ? { autoMerge: true as const } : {}) } };
}

/** 자동 병합은 검증 명령이 있어야 켜진다 — 명령을 지우면 칸의 값과 상관없이 꺼짐이다 */
export function autoMergeOn(d: Pick<AlbumDraft, "verify" | "autoMerge">): boolean {
  return d.autoMerge && d.verify.command.trim() !== "";
}

export function albumRiskNeeded(d: Pick<AlbumDraft, "members" | "verify" | "planTools" | "autoMerge">): boolean {
  return d.members.some((m) => m.grade === "full") || (d.verify.command.trim() !== "" && d.verify.auto) || d.planTools || autoMergeOn(d);
}
export function albumDraftValid(d: AlbumDraft, artists: readonly ArtistProfile[]): boolean {
  return !!d.repo.trim() && !!d.text.trim() && new TextEncoder().encode(d.text).length <= 256 * 1024 && [...d.name].length <= 80 && !/[\u0000-\u001f\u007f]/.test(d.name)
    && modelOk(d.model) && EFFORTS[d.cli].includes(d.effort) && d.members.length > 0 && d.members.length <= 8
    && d.members.some((m) => m.grade !== "read" && artists.some((a) => a.id === m.artist && a.kind === "write"))
    && d.members.every((m) => artists.some((a) => a.id === m.artist) && m.allowedCommands.length <= 32 && m.allowedCommands.every((c) => !!c.trim() && [...c].length <= 200 && !/[()*\u0000-\u001f\u007f]/.test(c)))
    && ALBUM_LIMITS.every((l) => Number.isInteger(d.limits[l.key]) && d.limits[l.key] >= 1 && d.limits[l.key] <= l.max)
    && Number.isInteger(d.accept.maxRework) && d.accept.maxRework >= 0 && d.accept.maxRework <= 10
    && d.accept.require.every((r) => Number.isInteger(r.passes) && r.passes >= 1 && r.passes <= 3)
    && d.verify.command.length <= 1000 && (!d.verify.command.trim() || (Number.isInteger(d.verify.timeoutMinutes) && d.verify.timeoutMinutes >= 1 && d.verify.timeoutMinutes <= 60))
    && Number.isInteger(d.wakeMax) && d.wakeMax >= 0 && d.wakeMax <= 200 && (!albumRiskNeeded(d) || d.riskConfirmed);
}

/** 수정 사건마다 열쇠를 버린다. 원래 값으로 되돌렸어도 새 제출이다. 실패 재시도는 같은 열쇠다. */
export function createAlbumAttempt(id: () => string = () => crypto.randomUUID()) {
  let clientId: string | null = null;
  return { edited() { clientId = null; }, key() { return clientId ??= id(); } };
}

/** 늦게 도착한 이전 저장소 기본값이 현재 초안을 덮지 못하게 한다. */
export function createAlbumDefaultsReader(read: (repo: string) => Promise<AlbumDefaults>) {
  let seq = 0;
  return { cancel() { ++seq; }, async load(repo: string): Promise<AlbumDefaults | null> { const n = ++seq; const value = await read(repo); return n === seq ? value : null; } };
}

export const ALBUM_FAILURES = ["bad-args", "risk-not-confirmed", "widens", "already-produced", "no-verify-command", "not-a-repo", "out-of-scope:repo", "git-too-old", "invalid-state", "unknown-role", "no-usable-artist", "too-many-runs", "integration-failed", "producer-mcp-unavailable", "spawn-failed", "cli-not-found", "not-a-tile"] as const;
export function albumFailureKey(error: unknown) {
  const text = String(error);
  const word = ALBUM_FAILURES.find((w) => text.includes(`[${w}]`)) ?? (text.includes("bad-args") ? "bad-args" : null);
  return word ? `orch.new.failure.${word}` as const : "orch.new.failure.unknown" as const;
}
