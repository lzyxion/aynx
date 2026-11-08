import { describe, expect, it } from "vitest";
import { answerText, cardAnswers, cardBody, cardQuestions, parseTilePermCard, togglePick, type TilePermCard } from "$lib/tile-permission";

// 질문 카드(2026-11-02 — Claude AskUserQuestion · 실측 7절): 답 글자의 꼴은 TUI 와 같다(하나 = 이름 · 여러 개 = ", " · 직접 쓴 글 그대로)

const INPUT = {
  questions: [
    { question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red", description: "r" }, { label: "Green" }] },
    { question: "Which sizes?", header: "Size", multiSelect: true, options: [{ label: "S" }, { label: "M" }, { label: "L" }] },
  ],
};

function card(over: Partial<TilePermCard> = {}): TilePermCard {
  const c = parseTilePermCard({ requestId: "r1", stream: "s1", sessionEpoch: 1, cli: "claude", tool: "AskUserQuestion", kind: "question", input: INPUT, ...over });
  if (!c) throw new Error("card");
  return c;
}

describe("질문 카드 — 모델", () => {
  it("kind question 을 읽고 질문 · 선택지를 뽑는다", () => {
    const b = cardBody(card());
    expect(b.kind).toBe("question");
    if (b.kind !== "question") return;
    expect(b.answerable).toBe(true);
    expect(b.questions.map((q) => [q.question, q.multiSelect, q.options.map((o) => o.label)])).toEqual([
      ["Which color?", false, ["Red", "Green"]],
      ["Which sizes?", true, ["S", "M", "L"]],
    ]);
  });

  it("Codex request_user_input 은 답 길이 있고 하나 고르기만 · 짝이 안 맞는 CLI · 도구 · 잘린 입력은 답 길이 없다", () => {
    const codex = cardBody(card({ cli: "codex", tool: "request_user_input" }));
    expect(codex.kind === "question" && codex.answerable).toBe(true);
    expect(codex.kind === "question" && codex.questions.every((q) => !q.multiSelect)).toBe(true);
    const mismatch = cardBody(card({ cli: "codex" }));
    const cut = cardBody(card({ truncated: true }));
    expect(mismatch.kind === "question" && mismatch.answerable).toBe(false);
    expect(cut.kind === "question" && cut.answerable).toBe(false);
  });

  it("하나 고르기는 마지막 누른 것 하나 · 여러 개는 켜고 끄며 선택지 순서를 지킨다", () => {
    const [one, many] = cardQuestions(INPUT);
    let p = togglePick(one, undefined, "Red");
    p = togglePick(one, p, "Green");
    expect(p.labels).toEqual(["Green"]);
    let m = togglePick(many, undefined, "L");
    m = togglePick(many, m, "S");
    expect(m.labels).toEqual(["S", "L"]);
    m = togglePick(many, m, "L");
    expect(m.labels).toEqual(["S"]);
  });

  it("답 글자 — 직접 쓴 글이 있으면 하나 고르기는 그 글 · 여러 개는 끝에 붙는다", () => {
    expect(answerText({ multiSelect: false }, { labels: ["Red"], other: "" })).toBe("Red");
    expect(answerText({ multiSelect: false }, { labels: ["Red"], other: " purple " })).toBe("purple");
    expect(answerText({ multiSelect: true }, { labels: ["S", "M"], other: "XL" })).toBe("S, M, XL");
    expect(answerText({ multiSelect: true }, undefined)).toBe("");
  });

  it("모든 질문에 답이 있어야 answers 가 선다 · 모르는 이름은 싣지 않는다", () => {
    const qs = cardQuestions(INPUT);
    expect(cardAnswers(qs, { "Which color?": { labels: ["Red"], other: "" } })).toBeNull();
    expect(cardAnswers(qs, { "Which color?": { labels: ["Red"], other: "" }, "Which sizes?": { labels: ["M", "L"], other: "" } })).toEqual({
      "Which color?": "Red",
      "Which sizes?": "M, L",
    });
    expect(cardAnswers(qs, { "Which color?": { labels: ["Hacked"], other: "" }, "Which sizes?": { labels: ["S"], other: "" } })).toBeNull();
    expect(cardAnswers([], {})).toBeNull();
  });
});

import { applyTilePermEvent, parseTilePermBody, parseTilePermSnapshot } from "$lib/tile-permission";

describe("면 규칙 — TUI 물음 사건 · 스냅숏(2026-11-02)", () => {
  it("사건 tui 를 읽고 카드 상태는 건드리지 않는다", () => {
    const body = parseTilePermBody({ windows: ["main"], stream: "s1", sessionEpoch: 1, ev: { t: "tui", asking: true } });
    expect(body?.ev).toEqual({ t: "tui", asking: true });
    const state = {};
    expect(body && applyTilePermEvent(state, body).state).toBe(state);
    expect(parseTilePermBody({ windows: [], stream: "s1", sessionEpoch: 1, ev: { t: "tui", asking: "yes" } })).toBeNull();
  });
  it("스냅숏의 tuiAsking(옛 서버는 없음 = 거짓)", () => {
    expect(parseTilePermSnapshot({ sessionEpoch: 1, cards: [], tuiAsking: true }).tuiAsking).toBe(true);
    expect(parseTilePermSnapshot({ sessionEpoch: 1, cards: [] }).tuiAsking).toBe(false);
  });
});

import { missingQuestions, questionAnswered, questionSummary } from "$lib/tile-permission";

describe("한 장씩 넘기는 질문 카드 — 답 판정 · 요약(2026-11-02)", () => {
  const qs = cardQuestions(INPUT);
  it("답이 있는가 — 그 질문의 선택지 이름 또는 직접 쓴 글", () => {
    expect(questionAnswered(qs[0], undefined)).toBe(false);
    expect(questionAnswered(qs[0], { labels: ["Red"], other: "" })).toBe(true);
    expect(questionAnswered(qs[0], { labels: ["Nope"], other: "" })).toBe(false);
    expect(questionAnswered(qs[1], { labels: [], other: " XL " })).toBe(true);
  });
  it("빠진 질문 번호(1부터)", () => {
    expect(missingQuestions(qs, {})).toEqual([1, 2]);
    expect(missingQuestions(qs, { "Which color?": { labels: ["Red"], other: "" } })).toEqual([2]);
  });
  it("요약 — 질문 순서 · 머리(없으면 Q<n> · 하나면 빈 글) · 보낸 답 그대로", () => {
    expect(questionSummary(qs, { "Which color?": "Red", "Which sizes?": "S, M" })).toEqual([
      { header: "Color", answer: "Red" },
      { header: "Size", answer: "S, M" },
    ]);
    const bare = cardQuestions({ questions: [{ question: "A?", options: [{ label: "x" }] }, { question: "B?", options: [{ label: "y" }] }] });
    expect(questionSummary(bare, { "A?": "x", "B?": "y" }).map((l) => l.header)).toEqual(["Q1", "Q2"]);
    expect(questionSummary([bare[0]], { "A?": "x" })).toEqual([{ header: "", answer: "x" }]);
  });
});
