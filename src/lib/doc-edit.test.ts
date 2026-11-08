import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  NO_BAND,
  bandOnDisk,
  bandOnDismiss,
  bandOnIgnore,
  bandOnSave,
  detectEol,
  detectIndent,
  editBlockOf,
  editorLangOf,
  normalizeEol,
  saveFailureOf,
  type BandState,
} from "$lib/doc-edit";

describe("detectEol", () => {
  it("LF 파일 · 줄 끝 없는 파일은 \\n", () => {
    expect(detectEol("a\nb\n")).toBe("\n");
    expect(detectEol("one line")).toBe("\n");
    expect(detectEol("")).toBe("\n");
  });
  it("CRLF 가 우세하면 \\r\\n", () => {
    expect(detectEol("a\r\nb\r\n")).toBe("\r\n");
    expect(detectEol("a\r\nb\r\nc\n")).toBe("\r\n");
  });
  it("같으면 \\n · 홀로 선 \\r 은 세지 않는다", () => {
    expect(detectEol("a\r\nb\n")).toBe("\n");
    expect(detectEol("a\rb\rc\r\n")).toBe("\r\n");
  });
});

describe("normalizeEol", () => {
  it("붙여 넣은 글의 줄 끝을 문서의 것으로", () => {
    expect(normalizeEol("a\nb\r\nc\rd", "\r\n")).toBe("a\r\nb\r\nc\r\nd");
    expect(normalizeEol("a\r\nb\r\n", "\n")).toBe("a\nb\n");
  });
});

/** 편집기가 드는 모양 그대로(lineSeparator 명시) 넣고 `sliceDoc()` 으로 꺼내면 바이트가 같아야 한다 — `doc.toString()` 은 늘 LF 로 잇는다 */
function roundTrip(text: string): string {
  const state = EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of(detectEol(text))] });
  return state.sliceDoc();
}

describe("줄 끝 · 끝 개행 보존(편집기 왕복)", () => {
  it.each([
    ["LF · 끝 개행", "a\nb\n"],
    ["LF · 끝 개행 없음", "a\nb"],
    ["CRLF · 끝 개행", "a\r\nb\r\n"],
    ["CRLF · 끝 개행 없음", "a\r\nb"],
    ["섞임(LF 우세)", "a\nb\r\nc\n"],
    ["섞임(CRLF 우세)", "a\r\nb\nc\r\n"],
    ["홀로 선 CR", "a\rb\n"],
    ["빈 파일", ""],
    ["끝 개행 둘", "a\n\n"],
  ])("%s", (_name, text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("CRLF 문서에 줄을 넣으면 CRLF 로 나간다", () => {
    const state = EditorState.create({ doc: "a\r\nb", extensions: [EditorState.lineSeparator.of("\r\n")] });
    const next = state.update({ changes: { from: 1, insert: state.lineBreak + "x" } }).state;
    expect(next.sliceDoc()).toBe("a\r\nx\r\nb");
  });
});

describe("detectIndent", () => {
  it("탭 파일은 탭", () => {
    expect(detectIndent("a\n\tb\n\tc\n  d\n")).toBe("\t");
  });
  it("공백 폭 — 4 · 2 · 모르면 2", () => {
    expect(detectIndent("x\n    a\n        b\n    c\n")).toBe("    ");
    expect(detectIndent("x\n  a\n    b\n      c\n")).toBe("  ");
    expect(detectIndent("no indent\n")).toBe("  ");
  });
});

describe("editBlockOf", () => {
  const ok = { truncated: false, binary: false, lossy: false };
  it("셋 다 거짓이면 편집할 수 있다", () => {
    expect(editBlockOf(ok)).toBeNull();
  });
  it("잘림 · 이진 · 깨진 UTF-8 은 막는다", () => {
    expect(editBlockOf({ ...ok, truncated: true })).toBe("truncated");
    expect(editBlockOf({ ...ok, binary: true })).toBe("binary");
    expect(editBlockOf({ ...ok, lossy: true })).toBe("lossy");
  });
});

describe("editorLangOf", () => {
  it("toml 은 제 이름, 나머지는 강조 이름", () => {
    expect(editorLangOf("/srv/Cargo.toml")).toBe("toml");
    expect(editorLangOf("/etc/app.ini")).toBe("ini");
    expect(editorLangOf("C:\\x\\README.md")).toBe("markdown");
    expect(editorLangOf("/tmp/notes.txt")).toBeNull();
  });
});

describe("saveFailureOf", () => {
  it("이유 코드로 가른다", () => {
    expect(saveFailureOf("[conflict] a 가 바뀌었습니다")).toEqual({ ok: false, why: "conflict" });
    expect(saveFailureOf("저장: [session-gone] 세션 없음")).toEqual({ ok: false, why: "gone" });
    expect(saveFailureOf("[missing] 없음")).toEqual({ ok: false, why: "missing" });
    expect(saveFailureOf("권한 거부")).toEqual({ ok: false, why: "error", message: "권한 거부" });
  });
});

describe("띠 상태 기계", () => {
  it("저장 성공은 띠와 무시 기억을 지운다", () => {
    const s: BandState = { band: { kind: "conflict" }, ignored: "v2" };
    expect(bandOnSave(s, { ok: true })).toEqual(NO_BAND);
  });

  it("저장 충돌 → conflict · 연결 없음 → unsaved", () => {
    expect(bandOnSave(NO_BAND, { ok: false, why: "conflict" }).band).toEqual({ kind: "conflict" });
    expect(bandOnSave(NO_BAND, { ok: false, why: "gone" }).band).toEqual({ kind: "unsaved", why: "gone", message: undefined });
  });

  it("디스크가 기준과 다르면 changed, 같아지면 내린다", () => {
    const a = bandOnDisk(NO_BAND, "v1", "v2");
    expect(a.band).toEqual({ kind: "changed", disk: "v2" });
    expect(bandOnDisk(a, "v1", "v1")).toEqual(NO_BAND);
  });

  it("같은 version 은 한 번만 알리고, [무시] 한 version 은 다시 알리지 않는다", () => {
    const a = bandOnDisk(NO_BAND, "v1", "v2");
    expect(bandOnDisk(a, "v1", "v2")).toBe(a);
    const ignored = bandOnIgnore(a);
    expect(ignored).toEqual({ band: null, ignored: "v2" });
    expect(bandOnDisk(ignored, "v1", "v2")).toBe(ignored);
    // 또 바뀌면 다시 알린다
    expect(bandOnDisk(ignored, "v1", "v3").band).toEqual({ kind: "changed", disk: "v3" });
  });

  it("충돌 띠가 서 있으면 디스크 소식이 덮지 않는다", () => {
    const c = bandOnSave(NO_BAND, { ok: false, why: "conflict" });
    expect(bandOnDisk(c, "v1", "v3")).toBe(c);
  });

  it("[취소] · [닫기] 는 띠만 내린다", () => {
    const s: BandState = { band: { kind: "conflict" }, ignored: "v2" };
    expect(bandOnDismiss(s)).toEqual({ band: null, ignored: "v2" });
  });

  it("[무시] 는 changed 띠에서만 뜻이 있다", () => {
    const c = bandOnSave(NO_BAND, { ok: false, why: "conflict" });
    expect(bandOnIgnore(c)).toBe(c);
  });
});
