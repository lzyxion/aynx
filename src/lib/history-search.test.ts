import { describe, expect, it } from "vitest";
import {
  collectHistory,
  historyPaletteEntries,
  relativeTime,
  HISTORY_QUERY_PREFIX,
  type HistoryBlock,
} from "$lib/history-search";
import { fuzzyMatch } from "$lib/hosts";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/finish-notify";

/** 블록 한 칸 — 끝난 명령 (`exit` 를 안 주면 성공) */
function block(commandLine: string, startedAt: number, exit: number | null = 0): HistoryBlock {
  return { commandLine, startedAt, endedAt: startedAt + 1000, exit };
}

/** 아직 도는 명령 */
function running(commandLine: string, startedAt: number): HistoryBlock {
  return { commandLine, startedAt, endedAt: null, exit: null };
}

/** `blocksOf` 스텁 — 타일 id → 블록들 (오래된 것부터, 저장소와 같은 순서) */
function store(table: Record<string, HistoryBlock[]>) {
  return (paneId: string): readonly HistoryBlock[] => table[paneId] ?? [];
}

describe("collectHistory — 창 안의 모든 타일을 한 줄로 편다", () => {
  const panes = [
    { id: "p1", label: "web-01" },
    { id: "p2", label: "bash" },
  ];

  it("최신순으로 세운다 — 타일이 달라도 시각 하나로 줄을 세운다", () => {
    const out = collectHistory(
      panes,
      store({
        p1: [block("git pull", 100), block("make all", 300, 2)],
        p2: [block("df -h", 200)],
      }),
    );
    expect(out.map((e) => e.command)).toEqual(["make all", "df -h", "git pull"]);
    expect(out.map((e) => e.paneLabel)).toEqual(["web-01", "bash", "web-01"]);
  });

  it("같은 명령은 한 줄뿐이고, 그 줄은 **가장 최근 것**이다", () => {
    const out = collectHistory(
      panes,
      store({
        p1: [block("ls -la", 100, 0)],
        p2: [block("ls -la", 500, 2)],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ paneId: "p2", paneLabel: "bash", exit: 2, startedAt: 500 });
  });

  // `ls` 처럼 순식간에 끝나는 명령을 잇달아 치면 `C` 둘이 **같은 밀리초**에 찍힌다.
  // 안정 정렬에만 기대면 그 자리에서 오래된 것이 위로 올라온다 (헤드리스 검증에서 실제로 났다).
  it("같은 ms 면 링에서 **나중인 블록**이 위다", () => {
    const out = collectHistory(
      panes,
      store({ p1: [block("first", 100), block("second", 100), block("third", 100)] }),
    );
    expect(out.map((e) => e.command)).toEqual(["third", "second", "first"]);
  });

  it("같은 ms 의 중복은 **나중 타일**이 이긴다 (가장 최근 것을 남긴다는 약속)", () => {
    const out = collectHistory(
      panes,
      store({ p1: [block("ls", 100, 0)], p2: [block("ls", 100, 2)] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ paneId: "p2", exit: 2 });
  });

  it("명령문이 빈 블록은 버린다 — 눌러도 빈 글자가 나가는 줄이 된다", () => {
    const out = collectHistory(panes, store({ p1: [block("", 100), block("   ", 200)] }));
    expect(out).toEqual([]);
  });

  it("앞뒤 공백은 떼고, 그 다듬은 글자가 곧 중복 제거의 키다", () => {
    const out = collectHistory(
      panes,
      store({ p1: [block("  git status  ", 100)], p2: [block("git status", 200)] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].command).toBe("git status");
  });

  it("실행 중인 블록도 들어온다 — 결말은 `exit: null` 로 말한다", () => {
    const out = collectHistory(panes, store({ p1: [running("npm run build", 900)] }));
    expect(out[0]).toMatchObject({ command: "npm run build", endedAt: null, exit: null });
  });

  it("상한에서 자른다 — 최신 쪽이 남는다", () => {
    const many = Array.from({ length: 10 }, (_, i) => block(`cmd-${i}`, i * 10));
    const out = collectHistory(panes, store({ p1: many }), 3);
    expect(out.map((e) => e.command)).toEqual(["cmd-9", "cmd-8", "cmd-7"]);
  });

  it("이력이 없는 타일은 조용히 건너뛴다", () => {
    expect(collectHistory(panes, store({}))).toEqual([]);
    expect(collectHistory([], store({ p1: [block("x", 1)] }))).toEqual([]);
  });
});

describe("historyPaletteEntries — 훑는 글자는 명령문 하나뿐이다", () => {
  const entries = collectHistory(
    [
      { id: "p1", label: "web-01" },
      { id: "p2", label: "bash" },
    ],
    store({ p1: [block("git pull", 100), block("make all", 300, 2)], p2: [block("df -h", 200)] }),
  );

  it("빈 질의는 전부 통과한다 (`fuzzyMatch` 규칙 그대로)", () => {
    expect(historyPaletteEntries("", entries, fuzzyMatch)).toHaveLength(3);
  });

  it("부분수열로 걸린다", () => {
    expect(historyPaletteEntries("make", entries, fuzzyMatch).map((e) => e.command)).toEqual([
      "make all",
    ]);
    expect(historyPaletteEntries("gtpl", entries, fuzzyMatch).map((e) => e.command)).toEqual([
      "git pull",
    ]);
  });

  it("**타일 이름은 훑지 않는다** — `!web` 이 그 타일의 명령을 통째로 끌고 오지 않는다", () => {
    expect(historyPaletteEntries("web", entries, fuzzyMatch)).toEqual([]);
  });

  it("최신순은 그대로 남는다 (거르기만 한다)", () => {
    expect(historyPaletteEntries("l", entries, fuzzyMatch).map((e) => e.command)).toEqual([
      "make all",
      "git pull",
    ]);
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 8, 17, 12, 0, 0);
  const ko: Tr = (key, params) => translate("ko", key, params);
  const en: Tr = (key, params) => translate("en", key, params);
  const ago = (ms: number, tr: Tr = ko) => relativeTime(now - ms, now, tr);

  it("분·시간·일로 접는다", () => {
    expect(ago(5_000)).toBe("방금");
    expect(ago(59_000)).toBe("방금");
    expect(ago(60_000)).toBe("1분 전");
    expect(ago(59 * 60_000)).toBe("59분 전");
    expect(ago(60 * 60_000)).toBe("1시간 전");
    expect(ago(25 * 60 * 60_000)).toBe("1일 전");
    expect(ago(6 * 24 * 60 * 60_000)).toBe("6일 전");
  });

  it("일주일이 넘으면 날짜를 쓴다", () => {
    expect(ago(30 * 24 * 60 * 60_000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("시계가 뒤로 간 경우(미래 시각)는 '방금' 으로 접는다", () => {
    expect(ago(-5_000)).toBe("방금");
  });

  it("영어 사전에도 같은 칸이 있다", () => {
    expect(ago(3 * 60_000, en)).toBe("3m ago");
    expect(ago(5_000, en)).toBe("just now");
  });

  it("말이 안 되는 숫자는 빈 글자다 (화면에 `NaN` 을 적지 않는다)", () => {
    expect(relativeTime(Number.NaN, now, ko)).toBe("");
    expect(relativeTime(now, Number.POSITIVE_INFINITY, ko)).toBe("");
  });
});

describe("HISTORY_QUERY_PREFIX", () => {
  it("셸 관습 그대로 `!` 다 — 팔레트와 힌트 줄이 같은 글자를 읽는다", () => {
    expect(HISTORY_QUERY_PREFIX).toBe("!");
  });
});
