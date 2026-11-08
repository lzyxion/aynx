import { describe, expect, it } from "vitest";
import { orch as ko } from "$lib/i18n/ko/orch";
import { orch as en } from "$lib/i18n/en/orch";
import { MERGE_WHY_KEY, mergeCheckRows, mergeRow, mergeTimelineWhat, mergeTracks, mergeWhyText, shortCommit, type MergePreview } from "./model/merge";
import { albumRiskNeeded, albumStartInput, autoMergeOn, blankAlbumDraft } from "./album-draft";
import { albumChangeBody, albumPermissionRisk, albumPermissions, albumWidens, type AlbumConfigView } from "./album-permissions";

// 시험은 키와 변수를 그대로 돌려받아 문구가 아니라 판정을 본다.
const tr = (k: string, v?: Record<string, string | number>) => (v ? `${k}|${Object.values(v).join("|")}` : k);

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const integration = (over = {}) => ({ workRef: "refs/x", exportBranch: "orch-1-int", baseCommit: "0".repeat(40), baseBranch: "main", expectedHead: H1, exportedHead: H1, ...over });

describe("앨범 줄", () => {
  it("내보내기 전이거나 통합이 없으면 줄이 없다", () => {
    expect(mergeRow({}).kind).toBe("hidden");
    expect(mergeRow({ integration: integration({ exportedHead: null }) }).kind).toBe("hidden");
  });
  it("내보낸 머리면 [병합]이 켜진다", () => {
    expect(mergeRow({ integration: integration() })).toEqual({ kind: "ready", branch: "orch-1-int", canMerge: true, stale: false, stop: null });
  });
  it("뒤처졌거나 대상 브랜치가 없으면 [병합]을 막는다", () => {
    expect(mergeRow({ integration: integration({ expectedHead: H2 }) })).toMatchObject({ kind: "stale", canMerge: false, stale: true });
    expect(mergeRow({ integration: integration({ baseBranch: null }) })).toMatchObject({ kind: "no-target", canMerge: false });
  });
  it("앱이 한 병합 — 사람 · 자동을 가르고 커밋을 보인다", () => {
    const merged = (by: "human" | "server") => ({ merged: { commit: H2, head: H1, target: "main", by, at: 1 } });
    expect(mergeRow({ integration: integration(), merge: merged("human") })).toEqual({ kind: "merged", target: "main", commit: H2, auto: false });
    expect(mergeRow({ integration: integration(), merge: merged("server") })).toEqual({ kind: "merged", target: "main", commit: H2, auto: true });
  });
  it("그 뒤 다시 내보낸 머리는 아직 병합되지 않았다", () => {
    const merge = { merged: { commit: H2, head: "3".repeat(40), target: "main", by: "human" as const, at: 1 } };
    expect(mergeRow({ integration: integration(), merge }).kind).toBe("ready");
  });
  it("터미널에서 직접 병합했으면 커밋 칩 없이 같은 결과", () => {
    expect(mergeRow({ integration: integration(), mergedOutside: true })).toEqual({ kind: "merged", target: "main", commit: null, auto: false });
  });
  it("자동 병합이 멈췄으면 대기 + 까닭 — 내보내지 못했으면 [병합]은 꺼진다", () => {
    const merge = { stopped: { reason: "dirty", detail: "2", at: 1 } };
    expect(mergeRow({ integration: integration(), merge })).toMatchObject({ kind: "waiting", canMerge: true, stop: merge.stopped });
    expect(mergeRow({ integration: integration({ exportedHead: null }), merge: { stopped: { reason: "export-failed", at: 1 } } })).toMatchObject({ kind: "waiting", canMerge: false });
  });
});

const preview = (over: Partial<MergePreview> = {}): MergePreview => ({
  runId: "r", branch: "orch-1-int", target: "main", head: H1, state: "ready", checked: true, mergeBase: H2, commits: 3, files: 6, additions: 214, deletions: 1,
  dirty: { count: 0, paths: [] }, inProgress: false, current: "main", onTarget: true, conflicts: { count: 0, paths: [] }, ...over,
});

describe("확인 창 검사 줄", () => {
  it("병합할 수 있으면 세 줄 모두 ✓", () => {
    expect(mergeCheckRows(preview(), tr).map((r) => [r.id, r.ok])).toEqual([["clean", true], ["branch", true], ["conflict", true]]);
  });
  it("막히면 그 줄이 ✕ + 까닭 + 해결 방법", () => {
    const rows = mergeCheckRows(preview({
      state: "blocked", dirty: { count: 2, paths: ["README.md", "utils/__init__.py"] }, onTarget: false, current: "feat-login", conflicts: { count: 1, paths: ["utils/chunk.py"] },
    }), tr);
    expect(rows.every((r) => !r.ok)).toBe(true);
    expect(rows[0].text).toBe("orch.merge.check.clean.bad|2");
    expect(rows[0].fix).toBe("orch.merge.check.clean.fix|README.md, utils/__init__.py");
    expect(rows[1].text).toBe("orch.merge.check.branch|feat-login");
    expect(rows[1].fix).toBe("orch.merge.check.branch.fix|main");
    expect(rows[2].fix).toBe("orch.merge.check.conflict.fix|utils/chunk.py|main");
  });
  it("경로가 잘렸으면 줄임표", () => {
    expect(mergeCheckRows(preview({ dirty: { count: 25, paths: ["a"] } }), tr)[0].fix).toContain("a …");
  });
  it("분리 HEAD · 진행 중인 병합", () => {
    const rows = mergeCheckRows(preview({ onTarget: false, current: null, inProgress: true }), tr);
    expect(rows.map((r) => r.id)).toEqual(["clean", "progress", "branch", "conflict"]);
    expect(rows[2].text).toBe("orch.merge.check.branch.detached");
  });
  it("세 줄을 판정하지 못했으면 까닭 한 줄만", () => {
    expect(mergeCheckRows(preview({ state: "blocked", checked: false, reason: "stale" }), tr)).toEqual([{ id: "blocked", ok: false, text: "orch.merge.why.stale|" }]);
  });
  it("충돌 검사를 돌리지 않았으면 '충돌 없음' 을 말하지 않는다", () => {
    const rows = mergeCheckRows(preview({ state: "blocked", reason: "git-unsupported", detail: "merge-driver" }), tr);
    expect(rows.map((r) => r.id)).toEqual(["blocked", "clean", "branch"]);
  });
});

describe("까닭 문구", () => {
  it("낱말 표의 키가 두 언어에 다 있다", () => {
    for (const key of Object.values(MERGE_WHY_KEY)) {
      const k = key.replace(/^orch\./, "") as keyof typeof ko;
      expect(ko[k], key).toBeTruthy();
      expect(en[k as keyof typeof en], key).toBeTruthy();
    }
    expect(ko["merge.why.detached"]).toBeTruthy();
  });
  it("모르는 낱말은 그대로 · 분리 HEAD 는 따로", () => {
    expect(mergeWhyText("new-word", null, tr)).toBe("new-word");
    expect(mergeWhyText("wrong-branch", null, tr)).toBe("orch.merge.why.detached");
    expect(mergeWhyText("dirty", "2", tr)).toBe("orch.merge.why.dirty|2");
  });
});

describe("트랙 줄 · 타임라인", () => {
  const task = (id: string, title: string) => ({ id, title }) as never;
  const art = (over = {}) => ({ taskId: "t", jobId: "j", integrationCommit: H1, ...over }) as never;
  it("수락 · 검증 · 검토를 잇고 거둔 수락은 뺀다", () => {
    const run = { tasks: [task("t", "chunk"), task("u", "gone")], jobs: [{ jobId: "j", verify: { outcome: "pass" } }] as never, accepted: [art({ judgments: ["r"] }), art({ taskId: "u", revokedAt: 1 })] };
    expect(mergeTracks(run, tr)).toEqual([{ id: "t", title: "chunk", status: "orch.merge.track.accepted · orch.merge.track.verified · orch.merge.track.reviewed" }]);
  });
  it("덮어쓰기 · 면제를 사실대로", () => {
    const run = { tasks: [task("t", "x")], jobs: [{ jobId: "j", override: { failedJobId: "f" }, verify: null }] as never, accepted: [art({ waived: [{ rule: "judgment" }] })] };
    expect(mergeTracks(run, tr)[0].status).toBe("orch.merge.track.accepted · orch.merge.track.overridden · orch.merge.track.waived");
  });
  it("병합 줄만 문장을 짓는다", () => {
    expect(mergeTimelineWhat({ action: "integration_merged", target: "main" }, tr)).toBe("orch.merge.timeline.to|main");
    expect(mergeTimelineWhat({ action: "integration_auto_merged", target: "main" }, tr)).toBe("orch.action.integration_auto_merged");
    expect(mergeTimelineWhat({ action: "run_done" }, tr)).toBeNull();
    expect(shortCommit(H1)).toHaveLength(7);
  });
});

describe("자동 병합 칸", () => {
  const draft = (command: string, autoMerge: boolean) => ({ ...blankAlbumDraft(), autoMerge, verify: { ...blankAlbumDraft().verify, command } });
  it("기본 꺼짐 · 검증 명령이 있어야 켜진다", () => {
    expect(blankAlbumDraft().autoMerge).toBe(false);
    expect(autoMergeOn(draft("", true))).toBe(false);
    expect(autoMergeOn(draft("  ", true))).toBe(false);
    expect(autoMergeOn(draft("npm test", true))).toBe(true);
  });
  it("켜면 위험 확인이 필요하다", () => {
    expect(albumRiskNeeded(draft("npm test", false))).toBe(false);
    expect(albumRiskNeeded(draft("npm test", true))).toBe(true);
    expect(albumRiskNeeded(draft("", true))).toBe(false);
  });
  it("시작 몸에는 켰을 때만 싣는다(판 26 서버가 모르는 칸을 거절하지 않게)", () => {
    expect("autoMerge" in albumStartInput(draft("npm test", false), "c", "k").album).toBe(false);
    expect("autoMerge" in albumStartInput(draft("", true), "c", "k").album).toBe(false);
    expect(albumStartInput(draft("npm test", true), "c", "k").album.autoMerge).toBe(true);
  });

  const base = (over: Partial<AlbumConfigView> = {}): AlbumConfigView => ({
    rev: 7, changedAt: 1, riskConfirmedAt: null, members: [], accept: { require: [], maxRework: 3 }, verifyAuto: false, planTools: false, wakeMax: 30, ...over,
  });
  it("앨범 권한 — 켬은 넓힘 · 위험 확인, 끔은 좁힘", () => {
    const off = base();
    const on = base({ autoMerge: true, riskConfirmedAt: 1 });
    expect(albumWidens(off, { ...albumPermissions(off), autoMerge: true })).toBe(true);
    expect(albumWidens(on, { ...albumPermissions(on), autoMerge: false })).toBe(false);
    expect(albumPermissionRisk(off, { ...albumPermissions(off), autoMerge: true })).toBe(true);
    expect(albumPermissionRisk(on, albumPermissions(on))).toBe(false);
  });
  it("앨범 권한 몸 — 끄면 칸을 뺀다(서버는 칸 없음 = 꺼짐)", () => {
    const on = base({ autoMerge: true, riskConfirmedAt: 1 });
    expect(albumChangeBody("r", on, albumPermissions(on), false, false).next).toMatchObject({ autoMerge: true });
    expect("autoMerge" in albumChangeBody("r", on, { ...albumPermissions(on), autoMerge: false }, false, false).next).toBe(false);
  });
});
