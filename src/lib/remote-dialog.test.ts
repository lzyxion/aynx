import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dialogChoices,
  escapeResult,
  initialFocus,
  reauthFailure,
  reauthTicketOf,
  reauthWhatKey,
} from "$lib/remote-dialog";
import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";

const lookup = (dict: Record<string, Record<string, string>>, key: string): string | undefined => {
  const dot = key.indexOf(".");
  return dict[key.slice(0, dot)]?.[key.slice(dot + 1)];
};

describe("원격 앱 모달 — 묻기 단추", () => {
  it("플러그인의 ask/confirm 이 견주는 결과 글자를 그대로 돌려준다", () => {
    expect(dialogChoices("YesNo").map((c) => c.result)).toEqual(["No", "Yes"]);
    expect(dialogChoices("OkCancel").map((c) => c.result)).toEqual(["Cancel", "Ok"]);
    expect(dialogChoices("YesNoCancel").map((c) => c.result)).toEqual(["Cancel", "No", "Yes"]);
    // 사용자 이름 — `ask(…, {okLabel, cancelLabel})` 는 OkCancelCustom 으로 와서 결과가 이름 그대로여야 한다.
    const custom = dialogChoices({ OkCancelCustom: ["닫기", "그대로 두기"] });
    expect(custom.map((c) => [c.label, c.result])).toEqual([
      ["그대로 두기", "그대로 두기"],
      ["닫기", "닫기"],
    ]);
    expect(dialogChoices({ YesNoCancelCustom: ["저장", "버림", "취소"] }).map((c) => c.result)).toEqual(["취소", "버림", "저장"]);
    expect(dialogChoices({ OkCustom: "알겠음" })).toEqual([{ label: "알겠음", result: "알겠음", primary: true, cancel: true }]);
  });

  it("없거나 모르는 모양은 확인 하나", () => {
    for (const b of [undefined, null, "Ok", "Weird", { Nope: 1 }]) {
      const c = dialogChoices(b);
      expect(c).toHaveLength(1);
      expect(c[0].result).toBe("Ok");
    }
  });

  it("강조는 하나 · 오른쪽 끝, Esc 는 취소 쪽", () => {
    for (const b of ["YesNo", "OkCancel", "YesNoCancel", { OkCancelCustom: ["a", "b"] }, { YesNoCancelCustom: ["y", "n", "c"] }]) {
      const c = dialogChoices(b);
      expect(c.filter((x) => x.primary)).toHaveLength(1);
      expect(c[c.length - 1].primary).toBe(true);
      expect(c[0].cancel).toBe(true);
      expect(escapeResult(c)).toBe(c[0].result);
    }
    expect(escapeResult(dialogChoices("Ok"))).toBe("Ok");
  });

  it("경고면 처음 포커스가 취소 쪽(Enter 한 번에 세션이 닫히지 않게)", () => {
    const c = dialogChoices("YesNo");
    expect(initialFocus(c, "warning")).toBe(0);
    expect(initialFocus(c, "error")).toBe(0);
    expect(initialFocus(c, "info")).toBe(1);
    expect(initialFocus(c, undefined)).toBe(1);
  });

  it("단추 문구 키가 두 언어에 있다", () => {
    for (const b of ["YesNo", "OkCancel", "YesNoCancel", "Ok"]) {
      for (const c of dialogChoices(b)) {
        expect(c.key).toBeDefined();
        expect(lookup(ko as never, c.key!)).toBeTruthy();
        expect(lookup(en as never, c.key!)).toBeTruthy();
      }
    }
  });
});

describe("원격 앱 모달 — 마스터 재확인", () => {
  it("표는 200 과 빈 글자 아닌 표만", () => {
    expect(reauthTicketOf({ status: 200, data: { ticket: "abc" } })).toBe("abc");
    expect(reauthTicketOf({ status: 200, data: { ticket: "" } })).toBeNull();
    expect(reauthTicketOf({ status: 200, data: {} })).toBeNull();
    expect(reauthTicketOf({ status: 401, data: { ticket: "abc" } })).toBeNull();
  });

  it("실패를 사람 말로 — 빈도 제한은 초로", () => {
    expect(reauthFailure({ status: 401, data: { error: "bad" } })).toEqual({ key: "app.remoteReauth.fail.wrong" });
    expect(reauthFailure({ status: 401, data: { error: "bad", retryAfterMs: 60000 } })).toEqual({
      key: "app.remoteReauth.fail.wrongLimited",
      params: { s: 60 },
    });
    expect(reauthFailure({ status: 429, data: { error: "limited", retryAfterMs: 1500 } })).toEqual({
      key: "app.remoteReauth.fail.limited",
      params: { s: 2 },
    });
    expect(reauthFailure({ status: 429, data: {} })).toEqual({ key: "app.remoteReauth.fail.limitedNow" });
    expect(reauthFailure({ status: 401, data: { error: "session" } })).toEqual({ key: "app.remoteReauth.fail.session" });
    expect(reauthFailure({ status: 0, data: {} })).toEqual({ key: "app.remoteReauth.fail.offline" });
    expect(reauthFailure({ status: 503, data: {} })).toEqual({ key: "app.remoteReauth.fail.server" });
    expect(reauthFailure({ status: 400, data: { error: "body" } })).toEqual({ key: "app.remoteReauth.fail.other" });
    for (const k of ["wrong", "wrongLimited", "limited", "limitedNow", "session", "offline", "server", "other"]) {
      expect(lookup(ko as never, `app.remoteReauth.fail.${k}`)).toBeTruthy();
      expect(lookup(en as never, `app.remoteReauth.fail.${k}`)).toBeTruthy();
    }
  });

  it("관문 deny.rs 의 REAUTH 명령마다 사람 말 이름이 있다", () => {
    const rs = readFileSync(new URL("../../src-tauri/src/remote/deny.rs", import.meta.url), "utf8");
    const body = rs.slice(rs.indexOf("pub(crate) const REAUTH: &[&str] = &["));
    const list = body.slice(0, body.indexOf("];"));
    const names = [...list.matchAll(/^\s*"([a-z_]+)",/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const n of [...names, "set_session_ai_read"]) {
      const key = reauthWhatKey(n);
      expect(key, n).not.toBeNull();
      expect(lookup(ko as never, key!)).toBeTruthy();
      expect(lookup(en as never, key!)).toBeTruthy();
    }
    expect(reauthWhatKey("list_shells")).toBeNull();
  });
});
