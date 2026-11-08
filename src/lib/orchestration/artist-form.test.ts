import { describe, expect, it } from "vitest";
import { artistDirty, artistFormError, artistInUseRunIds, blankArtist } from "./artist-form";

describe("아티스트 폼", () => {
  const valid = () => ({ ...blankArtist(), name: "구현가" });
  it("이름은 공백 정리 뒤 1~40 유니코드 글자", () => {
    expect(artistFormError(blankArtist())).toBe("orch.artists.error.name");
    expect(artistFormError({ ...valid(), name: "  " })).toBe("orch.artists.error.name");
    expect(artistFormError({ ...valid(), name: "😀".repeat(40) })).toBeNull();
    expect(artistFormError({ ...valid(), name: "가".repeat(41) })).toBe("orch.artists.error.name");
    expect(artistFormError({ ...valid(), name: "가\n나" })).toBe("orch.artists.error.name");
  });
  it("지침은 글자 수가 아니라 UTF-8 4 KiB, NUL 금지", () => {
    expect(artistFormError({ ...valid(), instructions: "x".repeat(4096) })).toBeNull();
    expect(artistFormError({ ...valid(), instructions: "x".repeat(4097) })).toBe("orch.artists.error.instructions");
    expect(artistFormError({ ...valid(), instructions: "가".repeat(1365) + "x" })).toBeNull();
    expect(artistFormError({ ...valid(), instructions: "가".repeat(1366) })).toBe("orch.artists.error.instructions");
    expect(artistFormError({ ...valid(), instructions: "\0" })).toBe("orch.artists.error.instructions");
  });
  it("종류는 만들 때 고르고 저장 뒤 잠긴다", () => {
    const original = { ...valid(), id: "a-12345678" };
    expect(artistFormError({ ...valid(), kind: "judge" })).toBeNull();
    expect(artistFormError({ ...original, kind: "judge" }, original)).toBe("orch.artists.error.kind");
    expect(artistFormError({ ...original, cli: "codex" }, original)).toBeNull();
  });
  it("고르기만 한 기존 아티스트는 저장할 것이 없다(정규화 차이는 변경이 아니다)", () => {
    const original = { ...valid(), id: "a-12345678", model: "", effort: "", instructions: "한 줄\r\n두 줄" };
    expect(artistDirty({ ...original }, original)).toBe(false);
    expect(artistDirty({ ...original, instructions: "한 줄\n두 줄", name: " 구현가 " }, original)).toBe(false);
    expect(artistDirty({ ...original, model: "opus" }, original)).toBe(true);
    expect(artistDirty({ ...original, effort: "high" }, original)).toBe(true);
    expect(artistDirty({ ...original, icon: "codex" }, original)).toBe(true);
    expect(artistDirty({ ...blankArtist() }, null)).toBe(true);
  });
  it("모델·강도는 기존 역할 편집과 같은 CLI별 규칙", () => {
    expect(artistFormError({ ...valid(), model: "bad/name" })).toBe("orch.artists.error.model");
    expect(artistFormError({ ...valid(), cli: "codex", effort: "max" })).toBe("orch.artists.error.model");
    expect(artistFormError({ ...valid(), effort: "max" })).toBeNull();
  });
  it("삭제 거절에서 앨범 열쇠만 읽는다", () => {
    expect(artistInUseRunIds('[artist-in-use] {"runIds":["r1",4,"r2"]}')).toEqual(["r1", "r2"]);
    expect(artistInUseRunIds("다른 오류")).toBeNull();
    expect(artistInUseRunIds("[artist-in-use] 잘못된 몸")).toEqual([]);
  });
});
