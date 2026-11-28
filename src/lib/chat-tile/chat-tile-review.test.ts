import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REVIEW_KINDS, reviewDraft, reviewKindKey, reviewTargetError, reviewTargetOf, reviewWireOf } from "./chat-tile-review";
import type { ReviewTargetWire } from "./chat-tile-api";
import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";

const ERR = "pane.chatTile.review.err.target";
const lookup = (dict: Record<string, Record<string, string>>, key: string) => dict[key.slice(0, key.indexOf("."))]?.[key.slice(key.indexOf(".") + 1)];

describe("reviewTargetError — 서버 `review_target` 과 같은 경계", () => {
  it("커밋하지 않은 변경은 늘 된다", () => {
    expect(reviewTargetError({ type: "uncommittedChanges" })).toBeNull();
  });

  it("브랜치 — 1–200 바이트 · [A-Za-z0-9._/-] · `..` 없음 · 앞 `-` 없음", () => {
    for (const ok of ["main", "feature/x-1", "release/0.1.8", "a".repeat(200), "a_b.c"]) expect([ok, reviewTargetError({ type: "baseBranch", branch: ok })]).toEqual([ok, null]);
    for (const bad of ["", "-x", "a..b", "a b", "a;b", "a".repeat(201), "브랜치", "a\nb", "$(x)"]) expect([bad, reviewTargetError({ type: "baseBranch", branch: bad })]).toEqual([bad, ERR]);
  });

  it("커밋 — 7–64 hex", () => {
    for (const ok of ["ea1dbc4", "EA1DBC41", "a".repeat(64)]) expect(reviewTargetError({ type: "commit", sha: ok })).toBeNull();
    for (const bad of ["", "ea1dbc", "zz12345", "a".repeat(65), "ea1dbc41 "]) expect(reviewTargetError({ type: "commit", sha: bad })).toBe(ERR);
  });

  it("직접 지시 — 비지 않음 · 4 KiB(UTF-8) · 줄바꿈 밖 제어 문자 없음", () => {
    expect(reviewTargetError({ type: "custom", instructions: "인증 흐름만 봐 줘\n둘째 줄\r\n셋째" })).toBeNull();
    expect(reviewTargetError({ type: "custom", instructions: "a".repeat(4096) })).toBeNull();
    expect(reviewTargetError({ type: "custom", instructions: "a".repeat(4097) })).toBe(ERR);
    // 한글 한 자는 3 바이트
    expect(reviewTargetError({ type: "custom", instructions: "가".repeat(1366) })).toBe(ERR);
    for (const bad of ["", "   ", "a\tb", "a\u0000b", "a\u007fb", "a\u0085b"]) expect(reviewTargetError({ type: "custom", instructions: bad })).toBe(ERR);
  });

  it("모르는 꼴은 거절", () => {
    expect(reviewTargetError({ type: "pr" } as unknown as ReviewTargetWire)).toBe(ERR);
  });
});

describe("카드 기본값 · 보낼 꼴", () => {
  it("인자 없으면 커밋하지 않은 변경 · 있으면 직접 지시에 미리 채움 · 브랜치 기본 main", () => {
    expect(reviewDraft("")).toEqual({ kind: "uncommittedChanges", branch: "main", sha: "", instructions: "" });
    expect(reviewDraft("  인증만 ")).toEqual({ kind: "custom", branch: "main", sha: "", instructions: "인증만" });
  });

  it("고른 종류의 칸만 싣는다", () => {
    const d = { kind: "baseBranch" as const, branch: " develop ", sha: "abc1234", instructions: "x" };
    expect(reviewTargetOf(d)).toEqual({ type: "baseBranch", branch: "develop" });
    expect(reviewTargetOf({ ...d, kind: "commit" })).toEqual({ type: "commit", sha: "abc1234" });
    expect(reviewTargetOf({ ...d, kind: "custom" })).toEqual({ type: "custom", instructions: "x" });
    expect(reviewTargetOf({ ...d, kind: "uncommittedChanges" })).toEqual({ type: "uncommittedChanges" });
  });

  it("reviewWireOf — 덧붙은 열쇠를 버린다", () => {
    const loose = { type: "commit", sha: "abc1234", title: "x", branch: "main" } as unknown as ReviewTargetWire;
    expect(reviewWireOf(loose)).toEqual({ type: "commit", sha: "abc1234" });
    expect(reviewWireOf({ type: "uncommittedChanges", extra: 1 } as unknown as ReviewTargetWire)).toEqual({ type: "uncommittedChanges" });
  });

  it("종류 넷의 문구가 두 사전에 있다", () => {
    expect(REVIEW_KINDS).toEqual(["uncommittedChanges", "baseBranch", "commit", "custom"]);
    for (const k of REVIEW_KINDS) {
      expect(lookup(ko as never, reviewKindKey(k))).toBeTruthy();
      expect(lookup(en as never, reviewKindKey(k))).toBeTruthy();
    }
  });
});

describe("모듈", () => {
  it("값 import 가 없다", () => {
    const src = readFileSync(new URL("./chat-tile-review.ts", import.meta.url), "utf8");
    for (const m of src.matchAll(/^import\s+(.+?)\s+from/gm)) expect(m[1].startsWith("type ")).toBe(true);
  });
});
