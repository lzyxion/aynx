import { describe, expect, it, vi } from "vitest";
import { ALBUM_FAILURES, ALBUM_LIMITS, albumDraftValid, albumFailureKey, albumRiskNeeded, albumStartInput, blankAlbumDraft, createAlbumAttempt, createAlbumDefaultsReader, mergeAlbumDefaults, pruneAlbumArtists, type AlbumDefaults } from "./album-draft";
import type { ArtistProfile } from "./artist-form";
import { orch as ko } from "$lib/i18n/ko/orch";
import { orch as en } from "$lib/i18n/en/orch";
import { producerOpenMode } from "./model/producer";

const writer: ArtistProfile = { id: "a-12345678", name: "구현", cli: "claude", icon: "claude", kind: "write", model: "", effort: "", instructions: "" };
const judge: ArtistProfile = { ...writer, id: "a-87654321", name: "검토", kind: "judge" };
const artists = [writer, judge];
function draft() { return mergeAlbumDefaults({ ...blankAlbumDraft(), repo: "C:/repo", text: "첫 지시" }, {}, artists); }

describe("앨범 초안 기본값", () => {
  it("지난 구성을 깊이 복사하고 이름·첫 말은 유지하며 위험 확인을 되묻는다", () => {
    const old = { ...draft(), name: "내 앨범", riskConfirmed: true };
    const defaults: AlbumDefaults = { members: [{ artist: writer.id, grade: "full", allowedCommands: ["git status"] }],
      accept: { require: [], maxRework: 2 }, limits: { maxTotalWorkers: 4 }, producer: { cli: "codex", model: "gpt-5", effort: "low" },
      verify: { command: "npm test", timeoutMinutes: 5, extraEnv: ["CI"] }, verifyAuto: true, planTools: true, wakeMax: 20 };
    const next = mergeAlbumDefaults(old, defaults, artists);
    expect([next.repo, next.name, next.text, next.cli, next.model, next.effort, next.riskConfirmed]).toEqual([old.repo, "내 앨범", "첫 지시", "codex", "gpt-5", "low", false]);
    expect(next.verify).toEqual({ command: "npm test", timeoutMinutes: 5, auto: true, keepDirs: [], cacheKeyFiles: [], extraEnv: ["CI"] });
    expect(next.limits.maxTotalWorkers).toBe(4);
    next.members[0].allowedCommands.push("git diff");
    expect(defaults.members![0].allowedCommands).toEqual(["git status"]);
  });
  it("검토형을 기본 1회 통과로 들이고 작업형만 있으면 필수 판정 없음·되돌림 3", () => {
    expect(draft().accept).toEqual({ require: [{ role: judge.id, passes: 1 }], maxRework: 3 });
    expect(mergeAlbumDefaults(blankAlbumDraft(), {}, [writer]).accept).toEqual({ require: [], maxRework: 3 });
    expect(ALBUM_LIMITS.map((l) => l.key)).not.toContain("maxRunsPerDay");
  });
  it("지운 아티스트와 그 필수 판정을 빼고 남은 사람 편집을 보존한다", () => {
    const old = draft(); old.members[0].grade = "full";
    const next = pruneAlbumArtists(old, [writer]);
    expect(next.members).toEqual([{ artist: writer.id, grade: "full", allowedCommands: [] }]);
    expect(next.accept.require).toEqual([]);
    expect(old.members).toHaveLength(2);
  });
  it("서버 기본값에 섞인 사라진 멤버도 뺀다", () => {
    const old = draft();
    const next = mergeAlbumDefaults(old, { members: old.members, accept: old.accept }, [writer]);
    expect(next.members.map((m) => m.artist)).toEqual([writer.id]);
    expect(next.accept.require).toEqual([]);
  });
  it("fork는 서버 저장소와 원본 CLI를 유지하고 다른 CLI의 모델을 쓰지 않는다", () => {
    const next = mergeAlbumDefaults(draft(), { producer: { cli: "codex", model: "codex-model", effort: "high" } }, artists, { agent: "claude", conv: "source" });
    expect([next.repo, next.cli, next.model, next.effort]).toEqual(["C:/repo", "claude", "", ""]);
  });
  it("저장소를 바꿀 때마다 다시 읽고 늦은 이전 답은 버린다", async () => {
    let finish!: (v: AlbumDefaults) => void;
    const read = vi.fn((repo: string) => repo === "A" ? new Promise<AlbumDefaults>((resolve) => { finish = resolve; }) : Promise.resolve({ wakeMax: 8 }));
    const reader = createAlbumDefaultsReader(read);
    const a = reader.load("A"); const b = await reader.load("B"); finish({ wakeMax: 90 });
    expect(await a).toBeNull(); expect(b).toEqual({ wakeMax: 8 }); expect(read.mock.calls).toEqual([["A"], ["B"]]);
    await reader.load("B"); expect(read.mock.calls).toHaveLength(3);
  });
});

describe("위험 확인 거울 · 제출 열쇠", () => {
  it("편집·허용 명령만은 위험 확인이 필요 없고 전부 자동·자동 검증·작업안 도구 각각 필요하다", () => {
    const base = draft(); base.members[0].allowedCommands = ["git status"];
    expect(albumRiskNeeded(base)).toBe(false);
    expect(albumRiskNeeded({ ...base, members: [{ ...base.members[0], grade: "full" }] })).toBe(true);
    expect(albumRiskNeeded({ ...base, verify: { ...base.verify, command: "npm test", auto: true } })).toBe(true);
    expect(albumRiskNeeded({ ...base, planTools: true })).toBe(true);
    expect(albumRiskNeeded({ ...base, verify: { ...base.verify, auto: true } })).toBe(false);
  });
  it("편집 작업형 필수·위험 확인·허용 명령·한도 검사를 시작 전에 거친다", () => {
    const base = draft(); expect(albumDraftValid(base, artists)).toBe(true);
    expect(albumDraftValid({ ...base, members: [{ artist: judge.id, grade: "read", allowedCommands: [] }] }, artists)).toBe(false);
    expect(albumDraftValid({ ...base, planTools: true }, artists)).toBe(false);
    expect(albumDraftValid({ ...base, planTools: true, riskConfirmed: true }, artists)).toBe(true);
    expect(albumDraftValid({ ...base, limits: { ...base.limits, maxTotalWorkers: 9 } }, artists)).toBe(false);
    expect(albumDraftValid({ ...base, members: [{ ...base.members[0], allowedCommands: ["git *"] }] }, artists)).toBe(false);
  });
  it("빈 강도(CLI 기본)는 \"\" 가 아니라 null 로 보낸다 — 서버 bad-args 를 피한다", () => {
    const base = draft();
    expect(base.effort).toBe("");
    const input = albumStartInput(base, "chat-1", "c-1");
    expect(input.effort).toBeNull();
    expect(input).not.toHaveProperty("fork");
    expect(albumStartInput({ ...base, effort: "high" }, "chat-1", "c-1").effort).toBe("high");
    expect(albumStartInput(base, "chat-1", "c-1", { agent: "claude", conv: "x" }).fork).toEqual({ agent: "claude", conv: "x" });
  });
  it("실패·응답 유실 재시도는 같은 id, 수정했다 되돌려도 새 id", () => {
    let n = 0; const attempt = createAlbumAttempt(() => `c-${++n}`);
    expect(attempt.key()).toBe("c-1"); expect(attempt.key()).toBe("c-1");
    attempt.edited(); attempt.edited(); expect(attempt.key()).toBe("c-2"); expect(attempt.key()).toBe("c-2");
  });
});

describe("실패 문구와 이어받기", () => {
  it.each(ALBUM_FAILURES)("%s를 한국어·영어 사람 문구로 바꾼다", (word) => {
    const key = albumFailureKey(new Error(`[${word}] 서버 내부 상세`)).replace(/^orch\./, "") as keyof typeof ko;
    expect(ko[key].length).toBeGreaterThan(8); expect(en[key].length).toBeGreaterThan(8);
    expect(ko[key]).not.toContain("서버 내부 상세");
  });
  it("모르는 오류는 초안 보존·멱등 재시도를 안내한다", () => { expect(albumFailureKey("connection lost")).toBe("orch.new.failure.unknown"); });
  it("아직 대화가 없는 이어받기는 adopt로 열고 대화가 있으면 resume한다", () => {
    expect(producerOpenMode({ conv: null, adoptRun: "run-1" })).toEqual({ kind: "adopt", run: "run-1" });
    expect(producerOpenMode({ conv: "conv", adoptRun: "run-1" })).toEqual({ kind: "resume", conv: "conv" });
  });
});
