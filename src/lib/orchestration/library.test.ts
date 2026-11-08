// 오케스트레이션 탭 ④ 홈 · 라이브러리의 순수 층(`model/library.ts`) — 묶음 · 정렬 · 최근 5 · 최근 카드 갈래 · 스튜디오 카드(오늘 앨범 수) ·
// 필터 · 트랙 번호 표기 — 노트 2026-10-29-orchestration-player-tab 3-2 · 2-1 · 8절 단계 4.
import { describe, expect, it } from "vitest";
import {
  RECENT_MAX,
  continueKind,
  elapsedSplit,
  mergeCommand,
  trackNo,
  type RunSummary,
} from "./model";
import { parseAlbumView, recentAlbums, studioLabelOf, albumRowMeta, archivedInStudio, filterLibraryRuns, libraryRepositories, studioName, studioSummary } from "./model/library";

describe("라이브러리 저장소 필터", () => {
  it("전부·진행 중·끝남과 저장소 칩을 함께 적용하고 원본은 유지", () => {
    const list = [run("a"), run("b", { state: "paused", repo: "B" }), run("c", { state: "done" }), run("d", { state: "stopping" }), run("e", { state: "stopped", repo: "B" })];
    expect(filterLibraryRuns(list, "all", null)).toHaveLength(5);
    expect(filterLibraryRuns(list, "live", null).map((r) => r.runId)).toEqual(["a", "b", "d"]);
    expect(filterLibraryRuns(list, "ended", "B").map((r) => r.runId)).toEqual(["e"]);
    expect(filterLibraryRuns(list, "all", "없는 저장소")).toEqual([]);
    expect(libraryRepositories(list)).toEqual([{ repo: "C:/work/api", count: 3, live: true }, { repo: "B", count: 2, live: true }]);
    // 스튜디오 카드는 고른 필터를 지난 앨범만 센다
    expect(libraryRepositories(filterLibraryRuns(list, "ended", null)).map((r) => r.count).reduce((a, b) => a + b, 0)).toBe(filterLibraryRuns(list, "ended", null).length);
    expect(list.map((r) => r.runId)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("저장소 문자열을 합치지 않고 최근 순서로 전체 앨범을 보여 준다", () => {
    const list = Array.from({ length: 8 }, (_, i) => run(String(i), { state: "done", updatedAt: i, repo: i % 2 ? "C:/A" : "c:/a" }));
    expect(filterLibraryRuns(list, "ended", null).map((r) => r.runId)).toEqual(["7", "6", "5", "4", "3", "2", "1", "0"]);
    expect(libraryRepositories(list)).toHaveLength(2);
  });
});

describe("스튜디오", () => {
  const list = [run("a", { repo: "C:/w/api" }), run("b", { repo: "C:/w/api", state: "done" }), run("c", { repo: "C:/w/docs", state: "done" }), run("d", { repo: "C:/w/ops", state: "paused" })];
  const archived = [{ repo: "C:/w/old", state: "done" as const }, { repo: "C:/w/api", state: "stopped" as const }];

  it("이름은 경로의 마지막 칸 — 구분자 둘 · 끝 구분자 · 이름 없는 경로", () => {
    expect(studioName("C:/w/e2e-merge")).toBe("e2e-merge");
    expect(studioName("C:\\w\\e2e-merge")).toBe("e2e-merge");
    expect(studioName("/home/me/repo/")).toBe("repo");
    expect(studioName("/")).toBe("/");
  });

  it("카드는 고른 필터를 따른다 — 수 · 카드 유무 · 재생 표시", () => {
    const cards = (f: "all" | "live" | "ended") => libraryRepositories(filterLibraryRuns(list, f, null));
    expect(cards("all")).toEqual([{ repo: "C:/w/api", count: 2, live: true }, { repo: "C:/w/docs", count: 1, live: false }, { repo: "C:/w/ops", count: 1, live: true }]);
    expect(cards("live").map((c) => c.repo)).toEqual(["C:/w/api", "C:/w/ops"]);
    expect(cards("ended")).toEqual([{ repo: "C:/w/api", count: 1, live: false }, { repo: "C:/w/docs", count: 1, live: false }]);
  });

  it("보관함 필터면 보관 앨범이 있는 스튜디오만 · 재생 표시 없음", () => {
    expect(libraryRepositories(archived)).toEqual([{ repo: "C:/w/old", count: 1, live: false }, { repo: "C:/w/api", count: 1, live: false }]);
  });

  it("화면 범위 — 목록과 보관함을 그 스튜디오로 좁힌다", () => {
    expect(filterLibraryRuns(list, "all", "C:/w/api").map((r) => r.runId)).toEqual(["a", "b"]);
    expect(filterLibraryRuns(list, "live", "C:/w/api").map((r) => r.runId)).toEqual(["a"]);
    expect(archivedInStudio(archived, "C:/w/api")).toEqual([archived[1]]);
    expect(archivedInStudio(archived, null)).toEqual(archived);
  });

  it("머리의 수는 필터와 무관 · 모두 0 이면 빈 화면 판정", () => {
    expect(studioSummary(list, archived, "C:/w/api")).toEqual({ albums: 2, live: 1, archived: 1 });
    expect(studioSummary(list, archived, "C:/w/old")).toEqual({ albums: 0, live: 0, archived: 1 });
    expect(studioSummary([], [], "C:/w/api")).toEqual({ albums: 0, live: 0, archived: 0 });
  });

  it("앨범 줄의 작은 글 — 라이브러리만 스튜디오 이름을 붙인다", () => {
    const tr = ((key: string, p: Record<string, string>) => `${key}|${p.studio}|${p.meta}`) as never;
    expect(albumRowMeta("트랙 1 · 1시간 전", "C:/w/e2e-merge", false, tr)).toBe("orch.library.row.withStudio|e2e-merge|트랙 1 · 1시간 전");
    expect(albumRowMeta("트랙 1 · 1시간 전", "C:/w/e2e-merge", true, tr)).toBe("트랙 1 · 1시간 전");
  });
});

const NOW = 10 * 24 * 60 * 60 * 1000;

function run(id: string, extra: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: id,
    name: id,
    state: "running",
    orphaned: false,
    gen: 1,
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    repo: "C:/work/api",
    latestSeq: 1,
    taskCount: 0,
    taskStates: {},
    attemptCount: 0,
    coordinatorAttached: true,
    origin: { by: "ai", producer: "pc-1" },
    running: { write: 0, judge: 0 },
    hold: null,
    adoptable: { restore: false, autoResume: false, why: "running" },
    coordinatorChat: "pc-1",
    producers: ["pc-1"],
    wake: null,
    ...extra,
  };
}

describe("continueKind — 최근 카드 갈래", () => {
  it("도는 앨범 · 중단 요청 중 = playing", () => {
    expect(continueKind(run("a"))).toBe("playing");
    expect(continueKind(run("a", { state: "stopping" }))).toBe("playing");
  });
  it("서버 판정이 되찾고 곧바로 재생이면 orphan · 되찾되 멈춤 그대로면 reattach", () => {
    expect(continueKind(run("a", { state: "paused", pauseReason: "coordinator-exited", adoptable: { restore: true, autoResume: true } }))).toBe("orphan");
    expect(continueKind(run("a", { state: "paused", pauseReason: "human", adoptable: { restore: true, autoResume: false } }))).toBe("reattach");
  });
  it("서버 판정이 되찾을 수 없는 멈춤 = paused(그냥 연다)", () => {
    for (const why of ["coordinator-attached", "coordination-limit", "on-hold"]) {
      expect(continueKind(run("a", { state: "paused", adoptable: { restore: false, autoResume: false, why } }))).toBe("paused");
    }
  });
});

describe("화면 표기", () => {
  it("트랙 번호 = #n (번호 없으면 —)", () => {
    expect([trackNo(2), trackNo(0)]).toEqual(["#2", "—"]);
  });
  it("카드 경과 — 시 · 분(초 버림 · 음수 0)", () => {
    expect([elapsedSplit(18 * 60_000 + 25_000), elapsedSplit(65 * 60_000), elapsedSplit(-5)]).toEqual([
      { hours: 0, minutes: 18 },
      { hours: 1, minutes: 5 },
      { hours: 0, minutes: 0 },
    ]);
  });
  it("병합 명령(복사만)", () => expect(mergeCommand("orch-aaaa-int")).toBe("git merge --no-ff orch-aaaa-int"));
});

describe("스튜디오에 보일 이름", () => {
  it("프로젝트 이름 · 없거나 빈 글자면 폴더 이름", () => {
    expect(studioLabelOf("내 프로젝트", "C:/w/api")).toBe("내 프로젝트");
    expect(studioLabelOf("  ", "C:/w/api")).toBe("api");
    expect(studioLabelOf(null, "C:\\w\\api")).toBe("api");
  });
  it("앨범 줄의 작은 글은 넘긴 이름을 쓴다", () => {
    const tr = (_k: string, p?: Record<string, string | number>) => `${p?.studio} · ${p?.meta}`;
    expect(albumRowMeta("트랙 1", "C:/w/api", false, tr as never, "내 프로젝트")).toBe("내 프로젝트 · 트랙 1");
    expect(albumRowMeta("트랙 1", "C:/w/api", false, tr as never)).toBe("api · 트랙 1");
    expect(albumRowMeta("트랙 1", "C:/w/api", true, tr as never, "내 프로젝트")).toBe("트랙 1");
  });
});

describe("앨범 보기", () => {
  it("저장된 rows 만 줄 · 나머지는 카드(기본)", () => {
    expect(parseAlbumView("rows")).toBe("rows");
    expect(parseAlbumView("cards")).toBe("cards");
    expect(parseAlbumView(null)).toBe("cards");
    expect(parseAlbumView("grid")).toBe("cards");
  });
});

describe("최근 칸", () => {
  const run = (id: string, state: RunSummary["state"], updatedAt: number) => ({ id, state, updatedAt });
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).join(",");
  it("도는 앨범 먼저 · 남은 자리는 최근에 움직인 끝난 앨범", () => {
    const rows = [run("a", "done", 5), run("b", "running", 1), run("c", "stopped", 9), run("d", "paused", 3), run("e", "done", 7)];
    expect(ids(recentAlbums(rows, 4))).toBe("d,b,c,e");
  });
  it("도는 앨범은 상한을 넘어도 빠지지 않는다", () => {
    const rows = [run("a", "paused", 1), run("b", "running", 2), run("c", "running", 3), run("d", "done", 9)];
    expect(ids(recentAlbums(rows, 2))).toBe("c,b,a");
  });
  it("기본 상한 · 빈 목록", () => {
    const rows = Array.from({ length: 8 }, (_, i) => run(`r${i}`, "done", i));
    expect(recentAlbums(rows)).toHaveLength(RECENT_MAX);
    expect(recentAlbums([])).toEqual([]);
  });
});
