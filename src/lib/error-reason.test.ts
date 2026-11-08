import { describe, expect, it } from "vitest";
import { REASONS, hasReason, stripReason, withReason } from "$lib/error-reason";

/**
 * **이유 코드** — 백엔드 실패의 갈래를 글자가 아니라 코드로 가른다
 * (docs/log/2026-09-17-i18n.md 의 "프런트가 오류 글자를 보는 자리").
 *
 * 이 파일이 지키는 계약 셋:
 * **판정이 언어를 타지 않는다** · **감싸인 문구도 알아본다** · **화면에는 대괄호가 없다**.
 */

/** Rust `errors.rs` 의 생성자가 만드는 것과 같은 모양의 두 언어 표본 */
const KO = {
  exists: "[exists] note.txt 이(가) 이미 있습니다 — 다른 이름을 지정하세요",
  notEmpty: "[not-empty] /srv/logs 이(가) 비어 있지 않습니다 — 안의 항목까지 지우려면 재귀 삭제를 쓰세요",
  sessionGone: "[session-gone] 세션을 찾을 수 없습니다 — 연결이 끊겼거나 이미 닫힌 세션입니다",
  cancelled: "[cancelled] 전송을 취소했습니다",
} as const;

const EN = {
  exists: "[exists] note.txt already exists — choose a different name",
  notEmpty: "[not-empty] /srv/logs is not empty — use recursive delete to remove what is inside",
  sessionGone: "[session-gone] Could not find the session — it was disconnected or already closed",
  cancelled: "[cancelled] The transfer was cancelled",
} as const;

describe("hasReason — 판정은 두 언어에서 같다", () => {
  it("한국어 본문", () => {
    expect(hasReason(KO.exists, "exists")).toBe(true);
    expect(hasReason(KO.notEmpty, "not-empty")).toBe(true);
    expect(hasReason(KO.sessionGone, "session-gone")).toBe(true);
    expect(hasReason(KO.cancelled, "cancelled")).toBe(true);
  });

  it("영어 본문 — 같은 코드가 같은 갈래를 낸다", () => {
    expect(hasReason(EN.exists, "exists")).toBe(true);
    expect(hasReason(EN.notEmpty, "not-empty")).toBe(true);
    expect(hasReason(EN.sessionGone, "session-gone")).toBe(true);
    expect(hasReason(EN.cancelled, "cancelled")).toBe(true);
  });

  it("코드가 다르면 걸리지 않는다 — 넷이 서로를 오인하지 않는다", () => {
    expect(hasReason(KO.exists, "not-empty")).toBe(false);
    expect(hasReason(EN.notEmpty, "exists")).toBe(false);
    expect(hasReason(EN.cancelled, "session-gone")).toBe(false);
  });

  it("코드가 없는 평범한 실패는 어느 갈래도 아니다", () => {
    for (const reason of REASONS) {
      expect(hasReason("권한이 없습니다", reason)).toBe(false);
      expect(hasReason("Permission denied", reason)).toBe(false);
      expect(hasReason("", reason)).toBe(false);
    }
  });

  /** `fail` 과 `move_failure` 가 앞에 말을 붙인다 — 그래서 판정은 "들어 있는가" 다 */
  it("감싸인 문구도 알아본다", () => {
    expect(hasReason(`3개 이동 완료, 4번째에서 중단: ${KO.cancelled}`, "cancelled")).toBe(true);
    expect(hasReason(`/srv 목록을 읽지 못했습니다: ${EN.sessionGone}`, "session-gone")).toBe(true);
  });
});

describe("stripReason — 사용자는 대괄호를 보지 않는다", () => {
  it("앞에 붙은 표식을 공백까지 걷어낸다", () => {
    expect(stripReason(KO.exists)).toBe("note.txt 이(가) 이미 있습니다 — 다른 이름을 지정하세요");
    expect(stripReason(EN.cancelled)).toBe("The transfer was cancelled");
  });

  it("감싸인 자리의 표식도 뗀다", () => {
    expect(stripReason(`3개 이동 완료, 4번째에서 중단: ${KO.cancelled}`)).toBe(
      "3개 이동 완료, 4번째에서 중단: 전송을 취소했습니다",
    );
  });

  it("표식이 없는 문구는 글자 하나 바뀌지 않는다", () => {
    expect(stripReason("권한이 없습니다")).toBe("권한이 없습니다");
    expect(stripReason("")).toBe("");
    // 우리 표에 없는 대괄호는 남의 글자다 — 건드리지 않는다.
    expect(stripReason("[warn] 자리가 모자랍니다")).toBe("[warn] 자리가 모자랍니다");
  });

  it("코드 전부를 뗀다", () => {
    for (const reason of REASONS) {
      expect(stripReason(withReason(reason, "본문"))).toBe("본문");
    }
  });

  it("금고 셋이 표에 있다 — Rust `errors.rs` 의 상수와 글자까지 같다", () => {
    // 2026-09-19 (docs/log/2026-09-19-vault.md): 이 셋이 표에 없으면 `[vault-locked]`
    // 대괄호가 **화면에 그대로 찍힌다** (`stripReason` 의 정규식이 이 목록에서 나온다).
    for (const code of ["vault-locked", "vault-wrong-master", "vault-absent"] as const) {
      expect(REASONS).toContain(code);
      expect(hasReason(`[${code}] 금고`, code)).toBe(true);
      expect(stripReason(`[${code}] 금고`)).toBe("금고");
    }
  });

  it("저장 둘이 표에 있다 — Rust `errors.rs` 의 CONFLICT·MISSING 과 글자까지 같다", () => {
    // 2026-09-27 (docs/log/2026-09-27-doc-edit.md): 문서 편집의 저장이 이 둘로 띠를 가른다.
    const conflict = "/srv/a.conf: [conflict] /srv/a.conf 이(가) 편집을 시작한 뒤 디스크에서 바뀌었습니다";
    const missing = "[missing] /srv/a.conf does not exist — it was deleted or moved (it was not saved)";
    expect(hasReason(conflict, "conflict")).toBe(true);
    expect(hasReason(conflict, "missing")).toBe(false);
    expect(hasReason(missing, "missing")).toBe(true);
    expect(hasReason(missing, "session-gone")).toBe(false);
    expect(stripReason(missing)).toBe(
      "/srv/a.conf does not exist — it was deleted or moved (it was not saved)",
    );
  });
});

describe("withReason — 프런트가 스스로 만드는 실패", () => {
  it("표식을 앞에 달고, 그 결과는 제 갈래로 걸린다", () => {
    const made = withReason("session-gone", "터미널이 연결되어 있지 않습니다");
    expect(made).toBe("[session-gone] 터미널이 연결되어 있지 않습니다");
    expect(hasReason(made, "session-gone")).toBe(true);
    expect(stripReason(made)).toBe("터미널이 연결되어 있지 않습니다");
  });
});
