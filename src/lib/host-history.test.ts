import { describe, expect, it } from "vitest";
import {
  historyOf,
  historyTooltipLines,
  parseHistory,
  recentHosts,
  recentOrder,
  sortRowsByRecent,
  type HostHistoryEntry,
} from "$lib/host-history";
import type { HostEntry } from "$lib/hosts";
import type { HostRow } from "$lib/host-folders";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/finish-notify";

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

function entry(p: Partial<HostHistoryEntry>): HostHistoryEntry {
  return {
    last_ok_at: null,
    last_fail_at: null,
    last_fail_cause: null,
    last_fail_message: null,
    count: 0,
    ...p,
  };
}

const host = (name: string) => ({ name }) as HostEntry;
const names = (xs: readonly { name: string }[]) => xs.map((x) => x.name);

describe("parseHistory", () => {
  it("모양이 어긋난 줄만 버리고 나머지는 살린다", () => {
    const out = parseHistory({
      "web-01": { last_ok_at: 10, count: 2 },
      broken: "x",
      "": { last_ok_at: 1 },
      db: { last_fail_at: 5, last_fail_cause: "dns", last_fail_message: "  " },
    });
    expect(Object.keys(out).sort()).toEqual(["db", "web-01"]);
    expect(out["web-01"]).toEqual(entry({ last_ok_at: 10, count: 2 }));
    expect(out.db.last_fail_message).toBeNull();
    expect(parseHistory(null)).toEqual({});
    expect(parseHistory([1, 2])).toEqual({});
  });

  it("별칭은 대소문자를 무시하고 찾는다", () => {
    const h = { "Web-01": entry({ last_ok_at: 1 }) };
    expect(historyOf(h, "web-01")?.last_ok_at).toBe(1);
    expect(historyOf(h, "nope")).toBeNull();
  });
});

describe("recentOrder", () => {
  const history = {
    b: entry({ last_ok_at: 100 }),
    c: entry({ last_ok_at: 300 }),
    // 실패만 있는 호스트는 "안 붙어 본 것" 과 같다 — 실패는 순서에 들지 않는다
    d: entry({ last_fail_at: 999 }),
  };

  it("마지막 성공이 늦은 것부터, 한 번도 안 붙은 것은 뒤, 같으면 이름순", () => {
    const out = recentOrder([host("z"), host("b"), host("d"), host("c"), host("a")], history);
    expect(names(out)).toEqual(["c", "b", "a", "d", "z"]);
  });

  it("입력을 건드리지 않는다", () => {
    const input = [host("b"), host("c")];
    recentOrder(input, history);
    expect(names(input)).toEqual(["b", "c"]);
  });
});

describe("sortRowsByRecent", () => {
  it("폴더 줄은 제자리, 호스트 줄만 최근순으로", () => {
    const rows: HostRow[] = [
      { kind: "folder", fullPath: "prod", label: "prod", count: 1 },
      { kind: "host", host: host("old") },
      { kind: "host", host: host("new") },
      { kind: "host", host: host("never") },
    ];
    const history = { old: entry({ last_ok_at: 1 }), new: entry({ last_ok_at: 2 }) };
    const out = sortRowsByRecent(rows, history);
    expect(out.map((r) => (r.kind === "folder" ? `g:${r.fullPath}` : r.host.name))).toEqual([
      "g:prod",
      "new",
      "old",
      "never",
    ]);
  });
});

describe("recentHosts", () => {
  const history = {
    a: entry({ last_ok_at: 1 }),
    b: entry({ last_ok_at: 2 }),
    c: entry({ last_ok_at: 3 }),
    gone: entry({ last_ok_at: 9 }),
    failed: entry({ last_fail_at: 9 }),
  };
  const list = [host("a"), host("b"), host("c"), host("failed"), host("fresh")];

  it("성공한 적이 있는 것만, 늦은 순, 목록에 없는 별칭은 빼고", () => {
    expect(names(recentHosts(list, history))).toEqual(["c", "b", "a"]);
  });

  it("상한을 지킨다", () => {
    expect(names(recentHosts(list, history, 2))).toEqual(["c", "b"]);
  });

  it("별칭은 대소문자를 무시해 맞추고 한 번만 선다", () => {
    const h = { WEB: entry({ last_ok_at: 5 }) };
    expect(names(recentHosts([host("web"), host("Web")], h))).toEqual(["web"]);
  });

  it("이력이 비면 빈 목록 (팔레트에서 묶음 자체가 없어진다)", () => {
    expect(recentHosts(list, {})).toEqual([]);
  });
});

describe("historyTooltipLines", () => {
  const now = Date.UTC(2026, 8, 23, 12, 0, 0);
  const ago = (min: number) => now - min * 60_000;

  it("이력이 없으면 아무 줄도 없다", () => {
    expect(historyTooltipLines(null, now, ko)).toEqual([]);
  });

  it("성공만 있으면 마지막 접속과 횟수", () => {
    expect(historyTooltipLines(entry({ last_ok_at: ago(3), count: 12 }), now, ko)).toEqual([
      "마지막 접속 3분 전 · 12회",
    ]);
  });

  it("실패가 더 늦으면 실패와 사유 — 문구가 있으면 그것, 힌트는 진단과 같은 문구", () => {
    const e = entry({
      last_ok_at: ago(60),
      count: 1,
      last_fail_at: ago(5),
      last_fail_cause: "tcp_refused",
      last_fail_message: "Connection refused",
    });
    expect(historyTooltipLines(e, now, ko)).toEqual([
      "마지막 접속 1시간 전 · 1회",
      "마지막 실패 5분 전 · Connection refused",
      ko("pane.error.hint.tcp_refused"),
    ]);
  });

  it("문구가 없으면 힌트가 사유 자리에 선다 (인증 계열)", () => {
    const e = entry({ last_fail_at: ago(2), last_fail_cause: "auth_key_rejected" });
    expect(historyTooltipLines(e, now, ko)).toEqual([
      `마지막 실패 2분 전 · ${ko("pane.error.hint.auth_key_rejected")}`,
    ]);
  });

  it("other·모르는 사유는 힌트 없이", () => {
    expect(
      historyTooltipLines(entry({ last_fail_at: ago(2), last_fail_cause: "other" }), now, ko),
    ).toEqual(["마지막 실패 2분 전"]);
    expect(
      historyTooltipLines(entry({ last_fail_at: ago(2), last_fail_cause: "새것" }), now, ko),
    ).toEqual(["마지막 실패 2분 전"]);
  });

  it("성공이 더 늦으면 옛 실패는 말하지 않는다", () => {
    const e = entry({ last_ok_at: ago(1), count: 3, last_fail_at: ago(10), last_fail_cause: "dns" });
    expect(historyTooltipLines(e, now, ko)).toEqual(["마지막 접속 1분 전 · 3회"]);
  });

  it("영어", () => {
    expect(historyTooltipLines(entry({ last_ok_at: ago(3), count: 2 }), now, en)).toEqual([
      "Last connected 3m ago · 2 times",
    ]);
  });
});
