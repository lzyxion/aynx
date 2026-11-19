import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

const hoisted = vi.hoisted(() => ({ saveBlob: vi.fn(), writeText: vi.fn(async () => undefined) }));
vi.mock("$lib/browser/device-download", () => ({ saveBlobToDevice: hoisted.saveBlob }));
vi.mock("$lib/scrollback", () => ({ writeTextFile: hoisted.writeText }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: vi.fn((key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key)) }));
vi.mock("$lib/toast.svelte.js", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { toast } from "$lib/toast.svelte.js";
import { fakeFileInput } from "../../test/fake-file-input";
import { SQL_FILE_ACCEPT, deviceSaveMime, fromFile, pickSqlSources, saveSqlText, saveTextAs } from "./sql-file-io";

const CSV = { filter: { name: "CSV", ext: "csv" }, saved: "pane.query.export.saved", failed: "pane.query.export.failed" } as const;

beforeEach(() => vi.clearAllMocks());

describe("saveTextAs — 원격 창은 이 기기로, 메인 PC 창은 저장 대화상자로", () => {
  it("원격 창: 대화상자 · writeTextFile 없이 saveBlobToDevice(이름 그대로 · 형식의 MIME · 같은 UTF-8 바이트) → 이 기기 알림", async () => {
    const text = "\uFEFFa,b\r\n한,1\r\n";
    await saveTextAs("result.csv", text, CSV, true);
    expect(saveDialog).not.toHaveBeenCalled();
    expect(hoisted.writeText).not.toHaveBeenCalled();
    expect(hoisted.saveBlob).toHaveBeenCalledOnce();
    const [blob, name] = hoisted.saveBlob.mock.calls[0] as unknown as [Blob, string];
    expect(name).toBe("result.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    // 메인 PC 창의 `write_text_file` 은 `contents.as_bytes()` — 같은 글의 UTF-8 이다(BOM = EF BB BF · CRLF 그대로)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new TextEncoder().encode(text));
    expect(Array.from(new Uint8Array(await blob.arrayBuffer())).slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
    expect(toast.success).toHaveBeenCalledWith('pane.query.file.savedDevice {"name":"result.csv"}');
  });

  it("원격 창의 .sql 저장도 같은 길(MIME = application/sql)", async () => {
    await saveSqlText("쿼리 1.sql", "select 1;", true);
    expect(saveDialog).not.toHaveBeenCalled();
    const [blob, name] = hoisted.saveBlob.mock.calls[0] as unknown as [Blob, string];
    expect(name).toBe("쿼리 1.sql");
    expect(blob.type).toBe("application/sql;charset=utf-8");
  });

  it("메인 PC 창: 저장 대화상자 → writeTextFile(그 경로 · 같은 글) → 경로 알림 · 내려받기 없음", async () => {
    vi.mocked(saveDialog).mockResolvedValueOnce("C:/out/result.csv");
    await saveTextAs("result.csv", "a\r\n", CSV, false);
    expect(saveDialog).toHaveBeenCalledWith({ defaultPath: "result.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    expect(hoisted.writeText).toHaveBeenCalledWith("C:/out/result.csv", "a\r\n");
    expect(hoisted.saveBlob).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('pane.query.export.saved {"path":"C:/out/result.csv"}');
  });

  it("메인 PC 창에서 취소하면 조용히 끝난다", async () => {
    await saveTextAs("result.csv", "a", CSV, false);
    expect(hoisted.writeText).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("MIME 은 확장자로", () => {
    expect(deviceSaveMime("json")).toBe("application/json;charset=utf-8");
    expect(deviceSaveMime("CSV")).toBe("text/csv;charset=utf-8");
    expect(deviceSaveMime("txt")).toBe("text/plain;charset=utf-8");
  });
});

describe("pickSqlSources — 원격 창은 이 기기의 파일 고르기 창", () => {
  const fakeDocument = fakeFileInput;
  afterEach(() => vi.unstubAllGlobals());

  it("원격 창: 메인 PC 대화상자 없이 같은 틱에 칸을 누르고 · 고른 File → 끌어 놓기와 같은 소스", async () => {
    const f = new File(["select 1;"], "a.sql");
    const seen = fakeDocument({ files: [f] });
    const pending = pickSqlSources(true);
    // 몸짓 사슬 — 첫 `await` 전에 이미 눌렸다
    expect(seen.clicked).toBe(1);
    const sources = await pending;
    expect(openDialog).not.toHaveBeenCalled();
    expect(seen.input).toMatchObject({ type: "file", multiple: true, accept: SQL_FILE_ACCEPT });
    expect(SQL_FILE_ACCEPT).toBe(".sql,.txt");
    expect(seen.attached).toBe(1);
    expect(seen.removed).toBe(1);
    expect(sources.map((s) => [s.name, s.size])).toEqual([["a.sql", f.size]]);
    expect(await sources[0].read()).toEqual(await fromFile(f).read());
    expect(await sources[0].read()).toMatchObject({ text: "select 1;", binary: false, truncated: false });
  });

  it("원격 창에서 취소하면 빈 목록(약속이 끝난다) · 칸은 걷는다", async () => {
    const seen = fakeDocument("cancel");
    expect(await pickSqlSources(true)).toEqual([]);
    expect(seen.removed).toBe(1);
  });

  it("메인 PC 창: 예전처럼 열기 대화상자(SQL 필터 · 여럿)", async () => {
    expect(await pickSqlSources(false)).toEqual([]);
    expect(openDialog).toHaveBeenCalledWith({ multiple: true, directory: false, filters: [{ name: "SQL", extensions: ["sql", "txt"] }] });
  });

  it("fromFile — 앞 8 KiB 의 NUL 은 이진(끌어 놓기와 같은 판정)", async () => {
    const r = await fromFile(new File(["a\u0000b"], "x.sql")).read();
    expect(r.binary).toBe(true);
  });
});
