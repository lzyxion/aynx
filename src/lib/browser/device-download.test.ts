import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEVICE_DOWNLOAD_MAX_BYTES,
  deviceDownloadRow,
  deviceDownloadSkip,
  deviceDownloadTooBig,
  deviceTooBigReport,
} from "./device-download";

describe("[이 기기로 다운로드] 줄 상태", () => {
  it("파일만(하나든 여럿이든) · 전송 없음이면 켜진다", () => {
    expect(deviceDownloadRow({ hasFolder: false, busy: false })).toBe("go");
  });

  it("폴더가 섞이면 줄이 없다", () => {
    expect(deviceDownloadRow({ hasFolder: true, busy: false })).toBe("none");
  });

  it("전송 중이면 흐린 줄 — 폴더가 섞이면 전송 중이어도 줄이 없다", () => {
    expect(deviceDownloadRow({ hasFolder: false, busy: true })).toBe("busy");
    expect(deviceDownloadRow({ hasFolder: true, busy: true })).toBe("none");
  });
});

describe("받기 직전 건너뛰기", () => {
  it("폴더(경쟁)는 조용히 · 상한을 넘는 파일은 크기로 건너뛴다", () => {
    expect(deviceDownloadSkip({ dir: true, link: false, size: 0 })).toBe("dir");
    expect(deviceDownloadSkip({ dir: false, link: false, size: DEVICE_DOWNLOAD_MAX_BYTES + 1 })).toBe("toobig");
    expect(deviceDownloadSkip({ dir: false, link: false, size: DEVICE_DOWNLOAD_MAX_BYTES })).toBeNull();
  });

  it("링크는 lstat 크기로 거르지 않는다 — 진짜 크기는 읽기에서 늦게 본다", () => {
    expect(deviceDownloadSkip({ dir: false, link: true, size: DEVICE_DOWNLOAD_MAX_BYTES + 1 })).toBeNull();
  });
});

describe("상한 건너뛰기 안내", () => {
  it("없으면 없음 · 하나면 그 크기 · 여럿이면 개수", () => {
    expect(deviceTooBigReport([])).toBeNull();
    expect(deviceTooBigReport([100])).toEqual({ kind: "one", size: 100 });
    expect(deviceTooBigReport([100, 200, 300])).toEqual({ kind: "many", count: 3 });
  });
});

describe("크기 상한", () => {
  it("상한까지는 받고 넘으면 거절한다", () => {
    expect(deviceDownloadTooBig(0)).toBe(false);
    expect(deviceDownloadTooBig(DEVICE_DOWNLOAD_MAX_BYTES)).toBe(false);
    expect(deviceDownloadTooBig(DEVICE_DOWNLOAD_MAX_BYTES + 1)).toBe(true);
    expect(deviceDownloadTooBig(11, 10)).toBe(true);
  });

  it("`bridge.rs` 의 `MAX_QUEUED` 보다 넉넉히 작다 — 응답 하나가 넘으면 관문이 연결을 끊는다", () => {
    const rs = readFileSync(new URL("../../../src-tauri/src/remote/bridge.rs", import.meta.url), "utf8");
    const m = rs.match(/const MAX_QUEUED: usize = ([\d\s*]+);/);
    expect(m).not.toBeNull();
    const max = m![1]
      .split("*")
      .map((n) => Number(n.trim()))
      .reduce((a, b) => a * b, 1);
    expect(DEVICE_DOWNLOAD_MAX_BYTES).toBeLessThanOrEqual(max - 8 * 1024 * 1024);
  });
});
