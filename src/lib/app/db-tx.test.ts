import { beforeEach, describe, expect, it, vi } from "vitest";

const ask = vi.fn();
vi.mock("$lib/app/confirm-dialog.svelte.js", () => ({ askConfirm: (...a: unknown[]) => ask(...a) }));
vi.mock("$lib/app/notice", () => ({ showNotice: vi.fn() }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));

import { confirmDbTxClose, dbTxPanes, hasOpenDbTx, noteDbTx } from "./db-tx";
import { showNotice } from "$lib/app/notice";

beforeEach(() => {
  for (const id of ["a", "b", "c"]) noteDbTx(id, null);
  ask.mockReset();
  vi.mocked(showNotice).mockClear();
});

describe("열린 트랜잭션 작업의 표", () => {
  it("적고 지운다 · 고른 타일 중 열린 것만", () => {
    noteDbTx("a", 3);
    noteDbTx("b", 0);
    expect(hasOpenDbTx("a")).toBe(true);
    expect(dbTxPanes(["a", "b", "c", "a"])).toEqual(["a", "b"]);
    noteDbTx("a", null);
    expect(hasOpenDbTx("a")).toBe(false);
  });
});

describe("닫기 전 물음 — 되돌리고 닫기 / 취소", () => {
  it("열린 작업이 없으면 묻지 않고 닫는다", async () => {
    expect(await confirmDbTxClose(["c"], () => "x")).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
  it("[되돌리고 닫기] 면 닫는다 — 대화에 타일 이름이 줄마다", async () => {
    noteDbTx("a", 2);
    ask.mockResolvedValue(true);
    expect(await confirmDbTxClose(["a", "c"], (id) => `name-${id}`)).toBe(true);
    const [body, opts] = ask.mock.calls[0] as [string, { okLabel: string; cancelLabel: string; kind: string }];
    expect(body).toContain("· name-a");
    expect(body).not.toContain("name-c");
    expect(opts).toMatchObject({ okLabel: "app.dbTx.close.ok", cancelLabel: "app.dbTx.close.cancel", kind: "warning", danger: true });
  });
  it("[취소] 면 닫지 않는다", async () => {
    noteDbTx("b", 1);
    ask.mockResolvedValue(false);
    expect(await confirmDbTxClose(["b"], () => "")).toBe(false);
  });
  it("대화를 못 띄우면 닫지 않는다(묻지 못한 채 작업을 버리지 않는다)", async () => {
    noteDbTx("b", 1);
    ask.mockRejectedValue(new Error("no dialog"));
    expect(await confirmDbTxClose(["b"], () => "")).toBe(false);
    expect(showNotice).toHaveBeenCalledWith("app.dbTx.close.noDialog");
  });
});
