// **실제 CLI 화면으로 대화 면 판정 셋을 본다**(2026-11-14 — 흉내 화면만으로 통과시키지 않는다).
// 고정 자료(`fixtures/screen-*.json`)는 실제 Claude Code 2.1.325 · Codex 0.169 를 **앱과 같은 ConPTY 길**(portable-pty)로 띄워 슬래시 명령만 보낸
// 원시 출력을 **앱과 같은 xterm 설정**(`windowsPty: conpty`)에 먹인 화면 행(글 · `isWrapped` · 흐림)이다. 경로 · 이름은 지어낸 값으로 바꿨다.
import { describe, expect, it } from "vitest";
import { screenRowsText, type ScreenRow } from "$lib/term/screen-rows";
import { claudeSwitchAsk, latestAck } from "./flip-model-ack";
import { tuiInputHolds, tuiInputLeftover, type InputRun } from "./flip-model";
import claude120 from "./fixtures/screen-claude-120.json";
import claude60 from "./fixtures/screen-claude-60.json";
import codex120 from "./fixtures/screen-codex-120.json";
import codex44 from "./fixtures/screen-codex-44.json";

interface Fixture {
  cols: number;
  rows: (ScreenRow & { runs: InputRun[] })[];
}

const lines = (f: Fixture) => screenRowsText(f.rows);
const runs = (f: Fixture) => f.rows.map((r) => r.runs);

describe.each([
  ["Claude 120열", claude120 as Fixture],
  ["Claude 60열", claude60 as Fixture],
])("%s — 실제 화면", (_name, fx) => {
  it("고정 자료는 칸 끝까지 채운 되울림 다음 행에 isWrapped 가 선 실제 모양이다", () => {
    const i = fx.rows.findIndex((r) => r.text.trim().startsWith("⎿  Set effort level to low"));
    expect(i).toBeGreaterThan(0);
    expect(fx.rows[i].wrapped).toBe(true);
    expect(fx.rows[i - 1].text.trim()).toBe("❯ /effort low");
  });

  it("확인 — 맨 아래 짝 /effort low 를 받는다 · 다른 명령이면 기다린다", () => {
    expect(latestAck("claude", { kind: "effort", line: "/effort low" }, lines(fx))).toEqual({ ack: { kind: "effort", ok: true, effort: "low" } });
    expect(latestAck("claude", { kind: "model", line: "/model opus" }, lines(fx))).toBe("wait");
    expect(latestAck("claude", { kind: "effort", line: null }, lines(fx))).toEqual({ ack: { kind: "effort", ok: true, effort: "low" } });
  });

  it("전환 확인 카드 — 이 화면에는 없다 · 칸 끝까지 찬 구분선 다음 행(isWrapped)에 확인이 서도 알아본다", () => {
    expect(claudeSwitchAsk(lines(fx))).toBeNull();
    // 실측 확인 화면(2.1.323)의 줄들을 이 화면 아래에 — 구분선 `▔` 은 칸 끝까지 차서 다음 행에 isWrapped 가 선다(같은 그리기)
    const ask: ScreenRow[] = [
      { text: "▔".repeat(fx.cols), wrapped: false },
      { text: "   Switch model?", wrapped: true },
      { text: "   Your next response will be slower and use more tokens", wrapped: false },
      { text: "", wrapped: false },
      { text: "   ❯ 1. Yes, switch to Haiku 5.5", wrapped: false },
      { text: "     2. No, go back", wrapped: false },
    ];
    expect(claudeSwitchAsk(screenRowsText([...fx.rows, ...ask]))).toEqual({ kind: "model", name: "Haiku 5.5" });
  });

  it("치다 만 글 — 빈 입력 줄(❯ + NBSP)이라 막지 않는다", () => {
    expect(tuiInputLeftover("claude", runs(fx))).toBe(false);
  });
});

describe.each([
  ["Codex 120열", codex120 as Fixture],
  ["Codex 44열(낱말 사이에서 접힘)", codex44 as Fixture],
])("%s — 실제 화면", (_name, fx) => {
  it("확인 — 맨 아래 'Model changed to … medium' 을 받는다 · 다른 단계면 기다린다", () => {
    expect(latestAck("codex", { kind: "effort", line: "/model --reasoning=medium" }, lines(fx))).toEqual({
      ack: { kind: "model", ok: true, model: "gpt-6-astra", effort: "medium" },
    });
    expect(latestAck("codex", { kind: "effort", line: "/model --reasoning=low" }, lines(fx))).toBe("wait");
  });

  it("치다 만 글 · Enter 다시 보내기 — 흐린 안내 글뿐이라 둘 다 아니다", () => {
    expect(tuiInputLeftover("codex", runs(fx))).toBe(false);
    expect(tuiInputHolds("codex", runs(fx), "/model --reasoning=medium")).toBe(false);
  });
});
