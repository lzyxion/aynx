/** 원격 창의 [이 기기로 다운로드] — 메인 PC 의 폴더 고르기 대화상자는 원격 창에서 폴리필이 거절해서 이 길을 쓴다. */

/**
 * 응답은 ws 메시지 하나로 통째로 가고, 관문은 한 연결의 보내기 줄에 64 MiB(`remote/bridge.rs` 의 `MAX_QUEUED`)가 넘게 쌓이면
 * 연결을 끊는다 — 다른 출력 몫을 남기고 그 안쪽으로 둔다. 시험이 `MAX_QUEUED` 보다 작은지 지킨다.
 */
export const DEVICE_DOWNLOAD_MAX_BYTES = 48 * 1024 * 1024;

export type DeviceDownloadRow = "go" | "busy" | "none";

export function deviceDownloadRow(o: { hasFolder: boolean; busy: boolean }): DeviceDownloadRow {
  if (o.hasFolder) return "none";
  if (o.busy) return "busy";
  return "go";
}

export function deviceDownloadTooBig(size: number, max: number = DEVICE_DOWNLOAD_MAX_BYTES): boolean {
  return size > max;
}

/**
 * 링크는 `stat`(lstat)의 크기가 링크 자신의 것이라 여기서 거르지 않는다 — 진짜 크기는 읽기의 첫 진행 메시지(`bytesTotal`)로 본다.
 */
export function deviceDownloadSkip(o: { dir: boolean; link: boolean; size: number }): "dir" | "toobig" | null {
  if (o.dir) return "dir";
  if (!o.link && deviceDownloadTooBig(o.size)) return "toobig";
  return null;
}

export function deviceTooBigReport(
  sizes: readonly number[],
): { kind: "one"; size: number } | { kind: "many"; count: number } | null {
  if (sizes.length === 0) return null;
  if (sizes.length === 1) return { kind: "one", size: sizes[0] };
  return { kind: "many", count: sizes.length };
}

/** Chromium 은 아주 짧은 사이에 낸 `<a download>` 클릭을 뒤의 것부터 떨어뜨리기도 한다 — 둘째부터 이만큼 띄운다 */
export const DEVICE_DOWNLOAD_GAP_MS = 250;

/** URL 은 늦게 거둔다 — 바로 거두면 내려받기가 시작되기 전에 끊기는 브라우저가 있다 */
export function saveBlobToDevice(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
