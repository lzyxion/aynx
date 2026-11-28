import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "$lib/context";
import { dropDefaultAlias, isPlanRow, localCommandOf, withLocals, withPartials, withPlans } from "./chat-tile-view";
import { addSent, emptyLive, foldAll } from "$lib/side-chat-live";

const item = (role: TranscriptItem["role"], text: string | null = null): TranscriptItem => ({ role, text, truncated: false, images: 0, tool: null, at: 5 });

describe("dropDefaultAlias", () => {
  it("Claude 의 `default` 는 맨 위 CLI 기본 줄과 겹쳐 뺀다 — 그것을 고른 대화만 남긴다", () => {
    expect(dropDefaultAlias(["fable", "haiku", "default"], "")).toEqual(["fable", "haiku"]);
    expect(dropDefaultAlias(["fable", "default"], "default")).toEqual(["fable", "default"]);
    expect(dropDefaultAlias(["gpt-6.2-astra"], "")).toEqual(["gpt-6.2-astra"]);
  });
});

describe("withPartials — 끊긴 턴의 본 글을 기록에 다시 끼운다(한 턴에만)", () => {
  const T = 1_800_000_000_000;
  const at = (role: TranscriptItem["role"], text: string | null, t: number): TranscriptItem => ({ ...item(role, text), at: T + t });
  const shape = (xs: TranscriptItem[]) => xs.map((x) => `${x.role}:${x.text ?? ""}`);
  // Codex 롤아웃: 사람 말 → 끊김 표식(부분 답 없음)
  const codex = [at("user", "앞 말", 0), at("assistant", "앞 답", 1_000), at("user", "1부터 2000까지", 60_000), at("interrupted", null, 90_000), at("user", "OK 로만", 120_000), at("assistant", "OK", 121_000)];
  const part = (userText: string | null, texts: string[], end: number, start: number | null = null) => ({ userText, texts, at: T + end, start: start === null ? null : T + start });

  it("끊긴 때의 표식 앞에 끼운다 · 다른 턴은 그대로 · 받은 배열은 그대로", () => {
    const out = withPartials(codex, [part("1부터 2000까지", ["1\n2\n3"], 90_200, 59_900)]);
    expect(shape(out)).toEqual(["user:앞 말", "assistant:앞 답", "user:1부터 2000까지", "assistant:1\n2\n3", "interrupted:", "user:OK 로만", "assistant:OK"]);
    expect(codex).toHaveLength(6);
  });

  it("기록에 이미 같은 글이 있으면(Claude) 겹쳐 넣지 않는다 · 표식 없는 턴은 건드리지 않는다", () => {
    const claude = [at("user", "길게 써", 0), at("assistant", "1\n2", 1_000), at("interrupted", null, 2_000)];
    expect(withPartials(claude, [part("길게 써", ["1\n2"], 2_100)])).toEqual(claude);
    const done = [at("user", "길게 써", 0), at("assistant", "끝", 1_000)];
    expect(withPartials(done, [part("길게 써", ["1\n2"], 2_100)])).toEqual(done);
  });

  it("같은 말이 두 번이면 끊긴 때로 각자 제 턴에", () => {
    const twice = [at("user", "계속", 0), at("interrupted", null, 10_000), at("user", "계속", 60_000), at("interrupted", null, 70_000)];
    const out = withPartials(twice, [part("계속", ["둘째"], 70_100), part("계속", ["첫째"], 10_100)]);
    expect(out.map((x) => x.text ?? x.role)).toEqual(["계속", "첫째", "interrupted", "계속", "둘째", "interrupted"]);
  });

  it("두 턴이 잇따라 끊김 — 둘째의 부분 답은 둘째에만 · 첫째(검토)의 글은 둘째 턴에 붙지 않는다", () => {
    // 검토 턴(사람 말 없음)이 끊긴 뒤 사람 말 턴이 또 끊겼다 — 기록에 검토 턴의 표식은 있고 글은 없다
    const rec = [at("user", "앞 말", 0), at("assistant", "앞 답", 1_000), at("interrupted", null, 30_000), at("user", "다음", 60_000), at("interrupted", null, 90_000)];
    const review = part(null, ["Review was interrupted. Please re-run /review"], 30_050, 20_000);
    const second = part("다음", ["둘째 글"], 90_050, 59_900);
    const out = withPartials(rec, [review, second]);
    expect(shape(out)).toEqual(["user:앞 말", "assistant:앞 답", "assistant:Review was interrupted. Please re-run /review", "interrupted:", "user:다음", "assistant:둘째 글", "interrupted:"]);
    // 기록에 첫째 턴의 표식이 아직 없다(다른 쪽) — 첫째 글은 어디에도 붙지 않는다
    const page = rec.slice(3);
    expect(shape(withPartials(page, [review, second]))).toEqual(["user:다음", "assistant:둘째 글", "interrupted:"]);
  });

  it("사람 말 없이 선 턴(목표 자동 턴)이 끊김 — 제 표식에만 · 그 턴의 사람 말을 지어내지 않는다", () => {
    const rec = [at("user", "목표대로 해", 0), at("assistant", "1", 5_000), at("assistant", "2", 40_000), at("interrupted", null, 50_000), at("user", "그만", 80_000), at("assistant", "네", 81_000)];
    const out = withPartials(rec, [part(null, ["3 쓰는 중"], 50_100, 41_000)]);
    expect(shape(out)).toEqual(["user:목표대로 해", "assistant:1", "assistant:2", "assistant:3 쓰는 중", "interrupted:", "user:그만", "assistant:네"]);
  });

  it("끊긴 때와 먼 표식 · 다른 말의 턴 · 시작보다 앞선 표식에는 붙이지 않는다", () => {
    const rec = [at("user", "다른 말", 0), at("interrupted", null, 1_000)];
    expect(withPartials(rec, [part("1부터 2000까지", ["1"], 1_100)])).toEqual(rec);
    expect(withPartials(rec, [part(null, ["1"], 60_000)])).toEqual(rec);
    expect(withPartials(rec, [part(null, ["1"], 1_100, 30_000)])).toEqual(rec);
    expect(withPartials([at("user", "x", 0), { ...item("interrupted"), at: null }], [part("x", ["1"], 0)])).toHaveLength(2);
    expect(withPartials(rec, [])).toEqual(rec);
  });
});

describe("`/` 명령 — 기록 읽기가 숨기는 사람 말 · 출력을 타일이 떠 있는 동안 남긴다", () => {
  // 초 단위 — 기록의 `at` 은 ms
  const at = (role: TranscriptItem["role"], text: string | null, t: number): TranscriptItem => ({ ...item(role, text), at: t * 1000 });
  const turn = (text: string, evs: Parameters<typeof foldAll>[1]) => foldAll(addSent(emptyLive("ready"), text, "c1"), evs);

  it("이 턴의 사람 말이 `/` 로 시작하면 잡는다 — 도구가 낀 턴 · 글이 없는 턴도", () => {
    const s = turn("/context", [{ t: "turnStarted", turn: null }, { t: "text", item: null, text: "## Context Usage" }]);
    expect(localCommandOf(s, 100)).toEqual({ userText: "/context", texts: ["## Context Usage"], at: 100 });
    const tool = turn("/code-review low", [{ t: "toolStarted", item: "x", name: "Task", summary: "review", input: null }, { t: "text", item: null, text: "(none)" }]);
    expect(localCommandOf(tool, 1)).toEqual({ userText: "/code-review low", texts: ["(none)"], at: 1 });
    expect(localCommandOf(turn("/goal 시험 통과", [{ t: "turnStarted", turn: null }]), 1)).toEqual({ userText: "/goal 시험 통과", texts: [], at: 1 });
  });

  it("보통 말 · 실패한 말 · 지난 턴의 말은 잡지 않는다", () => {
    expect(localCommandOf(turn("안녕", [{ t: "text", item: null, text: "네" }]), 1)).toBeNull();
    const ended = foldAll(turn("/context", [{ t: "turnStarted", turn: null }]), [{ t: "turnEnded", turn: null, outcome: "ok", message: null }]);
    expect(localCommandOf(ended, 1)).toBeNull();
  });

  const rec = [at("user", "앞 말", 10), at("assistant", "앞 답", 20), at("user", "뒤 말", 40), at("assistant", "뒤 답", 50)];
  const ctx = { userText: "/context", texts: ["## Context Usage"], at: 30_000 };
  const shape = (xs: TranscriptItem[]) => xs.map((x) => `${x.role}:${x.text}`);

  it("때 순서로 끼운다 · 받은 배열은 그대로", () => {
    expect(shape(withLocals(rec, [ctx], { latest: true, oldest: true }))).toEqual([
      "user:앞 말",
      "assistant:앞 답",
      "user:/context",
      "assistant:## Context Usage",
      "user:뒤 말",
      "assistant:뒤 답",
    ]);
    expect(rec).toHaveLength(4);
    // 맨 뒤 — 최신 쪽에만
    const last = { ...ctx, at: 60_000 };
    expect(shape(withLocals(rec, [last], { latest: true, oldest: false })).slice(-2)).toEqual(["user:/context", "assistant:## Context Usage"]);
    expect(withLocals(rec, [last], { latest: false, oldest: false })).toEqual(rec);
    // 맨 앞 — 가장 옛 쪽에만
    expect(withLocals(rec, [{ ...ctx, at: 5_000 }], { latest: true, oldest: false })).toEqual(rec);
    expect(shape(withLocals(rec, [{ ...ctx, at: 5_000 }], { latest: true, oldest: true }))[0]).toBe("user:/context");
  });

  it("같은 명령 두 번은 둘 다 · 기록이 돌려준 명령(사람 말 줄이 있음)은 넣지 않는다", () => {
    const two = withLocals(rec, [{ ...ctx, at: 60_000 }, { ...ctx, texts: ["둘째"], at: 70_000 }], { latest: true, oldest: true });
    expect(shape(two).slice(-4)).toEqual(["user:/context", "assistant:## Context Usage", "user:/context", "assistant:둘째"]);
    const asked = [...rec, at("user", "/nope", 55), at("assistant", "모르는 명령입니다", 56)];
    expect(withLocals(asked, [{ userText: "/nope", texts: ["모르는 명령입니다"], at: 54_000 }], { latest: true, oldest: true })).toEqual(asked);
  });

  it("모델 턴이 된 명령(`/goal` · 스킬) — 사람 말은 보낸 자리에 남기고 기록에 있는 모델 답은 겹쳐 넣지 않는다", () => {
    const goal = [...rec, at("assistant", "Goal set: 시험 통과", 56), at("assistant", "시험을 돌립니다", 57), at("user", "다음 말", 90)];
    const out = withLocals(goal, [{ userText: "/goal 시험 통과", texts: ["Goal set: 시험 통과", "시험을 돌립니다"], at: 54_000 }], { latest: true, oldest: true });
    expect(shape(out).slice(4)).toEqual(["user:/goal 시험 통과", "assistant:Goal set: 시험 통과", "assistant:시험을 돌립니다", "user:다음 말"]);
    // 기록이 숨긴 로컬 출력만 끼운다(`/code-review` 의 "(none)")
    const review = [...rec, at("assistant", "검토 요약", 57)];
    const out2 = withLocals(review, [{ userText: "/code-review low", texts: ["검토 요약", "(none)"], at: 54_000 }], { latest: true, oldest: true });
    expect(shape(out2).slice(4)).toEqual(["user:/code-review low", "assistant:검토 요약", "assistant:(none)"]);
  });

  // 실측 꼴(Claude): `/code-review` 사람 말은 글 그대로 기록에 돌아오고(보낸 때), 출력 줄(`commandRun` 없음)은 숨는다.
  // `/goal` 은 사람 말이 `<command-name>` 꼴이라 숨고 출력은 `commandRun` 이 붙어 기록에 나온다.
  it("기록이 사람 말만 돌려준 명령 — 말은 겹치지 않고 숨은 출력만 그 줄 뒤에 한 번", () => {
    const sent = [...rec, at("user", "/code-review low", 54.2), at("user", "다음 말", 90), at("assistant", "다음 답", 91)];
    const none = withLocals(sent, [{ userText: "/code-review low", texts: ["(none)", "(none)"], at: 54_000 }], { latest: true, oldest: true });
    expect(shape(none).slice(4)).toEqual(["user:/code-review low", "assistant:(none)", "user:다음 말", "assistant:다음 답"]);
    const findings = "## 발견 둘\n\n1. a.ts:3 — 빈 배열에서 터진다\n2. b.ts:9 — 닫지 않는다";
    const tail = [...rec, at("user", "/code-review", 54.2)];
    const out = withLocals(tail, [{ userText: "/code-review", texts: ["diff 를 읽습니다", findings], at: 54_000 }], { latest: false, oldest: false });
    expect(shape(out).slice(4)).toEqual(["user:/code-review", "assistant:diff 를 읽습니다", `assistant:${findings}`]);
    // 기록에 이미 있는 글은 겹치지 않는다
    const has = [...tail, at("assistant", "diff 를 읽습니다", 55)];
    expect(shape(withLocals(has, [{ userText: "/code-review", texts: ["diff 를 읽습니다", findings], at: 54_000 }], { latest: true, oldest: true })).slice(4)).toEqual([
      "user:/code-review",
      "assistant:diff 를 읽습니다",
      `assistant:${findings}`,
    ]);
  });

  it("`/goal` 꼴(사람 말 숨음 · 출력은 기록에) — 말 하나 · Goal set 한 줄", () => {
    const goal = [...rec, at("assistant", "Goal set: 시험 통과", 54.1)];
    const out = withLocals(goal, [{ userText: "/goal 시험 통과", texts: ["Goal set: 시험 통과"], at: 54_000 }], { latest: true, oldest: true });
    expect(shape(out).slice(4)).toEqual(["user:/goal 시험 통과", "assistant:Goal set: 시험 통과"]);
  });

  it("같은 명령을 뒤에 또 — 각자 제 출력만", () => {
    const twice = [...rec, at("user", "/code-review low", 54.2), at("user", "/code-review low", 64.2)];
    const out = withLocals(
      twice,
      [
        { userText: "/code-review low", texts: ["(none)"], at: 54_000 },
        { userText: "/code-review low", texts: ["발견 하나"], at: 64_000 },
      ],
      { latest: true, oldest: true },
    );
    expect(shape(out).slice(4)).toEqual(["user:/code-review low", "assistant:(none)", "user:/code-review low", "assistant:발견 하나"]);
  });

  it("`/usr/bin` 으로 시작하는 보통 말 — 명령으로 잡지 않고 기록 그대로", () => {
    const s = turn("/usr/bin/env 가 뭐야", [{ t: "turnStarted", turn: null }, { t: "text", item: null, text: "환경을 정하고 실행합니다" }]);
    const local = localCommandOf(s, 54_000);
    const asked = [...rec, at("user", "/usr/bin/env 가 뭐야", 54.2), at("assistant", "환경을 정하고 실행합니다", 55)];
    expect(local).not.toBeNull();
    expect(withLocals(asked, local ? [local] : [], { latest: true, oldest: true })).toEqual(asked);
  });
});

describe("계획 줄 — 사람이 본 글 · 결과를 기록 줄에 얹는다", () => {
  const at = (it: TranscriptItem, t: number): TranscriptItem => ({ ...it, at: t });
  const exit = (t: number, plan: TranscriptItem["plan"]): TranscriptItem => ({
    ...item("tool"),
    at: t,
    tool: { name: "ExitPlanMode", summary: "", input: '{"plan":"# stale"}', inputTruncated: false, output: "ok", outputTruncated: false, error: false },
    plan,
  });

  it("isPlanRow — Codex 계획 글 · Claude ExitPlanMode 줄만", () => {
    expect(isPlanRow({ ...item("assistant", "1. a"), plan: {} })).toBe(true);
    expect(isPlanRow(item("assistant", "1. a"))).toBe(false);
    expect(isPlanRow({ ...item("assistant", " "), plan: {} })).toBe(false);
    expect(isPlanRow(exit(1, { file: "p.md" }))).toBe(true);
    expect(isPlanRow({ ...exit(1, null) })).toBe(false);
  });

  it("답한 때보다 늦지 않은 마지막 계획 줄에 · 본문은 사람이 본 글 · 기록에 없는 고칠 점을 더한다", () => {
    const rec = [at(item("user", "계획 세워"), 10), exit(20, { file: "p.md", outcome: "kept" }), exit(40, { body: "# d", file: "p.md", outcome: "approved" }), at(item("assistant", "끝"), 60)];
    const out = withPlans(rec, [
      { at: 30, plan: "# c", file: "p.md", outcome: "kept", feedback: "c 대신 d" },
      { at: 50, plan: "# d", file: "p.md", outcome: "approved", feedback: null },
    ]);
    expect(out[1].plan).toEqual({ body: "# c", bodyTruncated: false, file: "p.md", outcome: "kept", feedback: "c 대신 d" });
    expect(out[2].plan).toEqual({ body: "# d", bodyTruncated: false, file: "p.md", outcome: "approved" });
    expect(rec[1].plan).toEqual({ file: "p.md", outcome: "kept" }); // 받은 배열은 그대로
  });

  it("사이에 사람 말이 있거나 아직 기록에 없는 계획은 얹지 않는다 · 거둬진 결과는 기록 결과를 둔다", () => {
    const rec = [exit(20, { file: "p.md", outcome: "approved" }), at(item("user", "다음"), 30)];
    expect(withPlans(rec, [{ at: 40, plan: "# 새", file: null, outcome: "approved", feedback: null }])).toEqual(rec);
    const cancelled = withPlans([exit(20, { outcome: "approved" })], [{ at: 25, plan: "# x", file: null, outcome: "cancelled", feedback: null }]);
    expect(cancelled[0].plan?.outcome).toBe("approved");
    expect(withPlans(rec, [])).toEqual(rec);
  });
});
