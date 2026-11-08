import { describe, expect, it } from "vitest";
import { menuEscape } from "./tab-menu";

// 창 캡처 단계의 Escape — 터미널(xterm)이 Escape 를 셸로 보내고 전파를 끊기 전에 탭 줄 메뉴가 먼저 받는다
const term = { id: "xterm-helper-textarea" } as unknown as EventTarget;
const row = { id: "more-row" } as unknown as EventTarget;
const moreEl = { contains: (n: Node | null) => (n as unknown) === row };
// 워크스페이스 목록의 줄 · 그 줄의 우클릭 메뉴 항목
const wsRow = { id: "ws-row" } as unknown as EventTarget;
const wsCtxItem = { id: "ws-ctx-item" } as unknown as EventTarget;
const wsEls = [{ contains: (n: Node | null) => (n as unknown) === wsRow }, { contains: (n: Node | null) => (n as unknown) === wsCtxItem }];
const esc = (target: EventTarget | null) => ({ key: "Escape", code: "Escape", target });
// 한국어 IME 조합 중 — Chromium 은 입력기가 받은 키를 `key: "Process"`(keyCode 229)로 낸다. 물리 키는 `code` 에 남는다
const imeEsc = (target: EventTarget | null) => ({ key: "Process", code: "Escape", target });
const none = { ctx: false, more: false, ws: false };

describe("menuEscape", () => {
  it("우클릭 메뉴가 열려 있으면 포커스가 터미널이어도 닫는다", () => {
    expect(menuEscape(esc(term), { ctx: true, more: false, moreEl: null })).toEqual({ ctx: true, more: false, ws: false });
  });

  it("접힌 탭 목록 — 포커스가 목록 밖(터미널)이면 창이 닫는다", () => {
    expect(menuEscape(esc(term), { ctx: false, more: true, moreEl })).toEqual({ ctx: false, more: true, ws: false });
  });

  it("접힌 탭 목록 안의 Escape 는 목록의 키 처리에 맡긴다(포커스를 ⌄N 단추로 돌린다)", () => {
    expect(menuEscape(esc(row), { ctx: false, more: true, moreEl })).toEqual(none);
  });

  it("열린 메뉴가 없으면 먹지 않는다 — Escape 는 셸로 간다", () => {
    expect(menuEscape(esc(term), { ctx: false, more: false, moreEl: null })).toEqual(none);
  });

  it("IME 조합 중이어도 열린 메뉴는 닫는다 — 조합 글자 취소는 입력기 몫(2026-10-26 결정)", () => {
    expect(menuEscape(imeEsc(term), { ctx: true, more: false, moreEl: null })).toEqual({ ctx: true, more: false, ws: false });
    expect(menuEscape(imeEsc(term), { ctx: false, more: true, moreEl })).toEqual({ ctx: false, more: true, ws: false });
  });

  it("IME 조합 중이라도 닫힌 메뉴면 먹지 않는다 — Escape 는 터미널로 간다", () => {
    expect(menuEscape(imeEsc(term), { ctx: false, more: false, moreEl: null })).toEqual(none);
  });

  it("워크스페이스 목록 — 포커스가 목록 밖(터미널)이면 창이 닫는다 · IME 조합 중이어도", () => {
    expect(menuEscape(esc(term), { ctx: false, more: false, moreEl: null, ws: true, wsEls })).toEqual({ ctx: false, more: false, ws: true });
    expect(menuEscape(imeEsc(term), { ctx: false, more: false, moreEl: null, ws: true, wsEls })).toEqual({ ctx: false, more: false, ws: true });
  });

  it("워크스페이스 목록 · 그 줄 메뉴 안의 Escape 는 제 키 처리에 맡긴다(목록은 단추로 · 줄 메뉴는 그것만 닫는다)", () => {
    expect(menuEscape(esc(wsRow), { ctx: false, more: false, moreEl: null, ws: true, wsEls })).toEqual(none);
    expect(menuEscape(esc(wsCtxItem), { ctx: false, more: false, moreEl: null, ws: true, wsEls })).toEqual(none);
  });

  it("워크스페이스 목록이 닫혀 있거나 끌기 중(부르는 쪽이 ws 거짓)이면 먹지 않는다 — Escape 는 셸로 · 끌기 취소로", () => {
    expect(menuEscape(esc(term), { ctx: false, more: false, moreEl: null, ws: false, wsEls })).toEqual(none);
    expect(menuEscape(esc(term), { ctx: false, more: false, moreEl: null })).toEqual(none);
  });

  it("다른 키 · 입력기가 받은 다른 키는 건드리지 않는다", () => {
    expect(menuEscape({ key: "Enter", code: "Enter", target: term }, { ctx: true, more: true, moreEl })).toEqual(none);
    expect(menuEscape({ key: "Process", code: "KeyA", target: term }, { ctx: true, more: true, moreEl })).toEqual(none);
    expect(menuEscape({ key: "Enter", code: "Enter", target: term }, { ctx: false, more: false, moreEl: null, ws: true, wsEls })).toEqual(none);
  });
});
