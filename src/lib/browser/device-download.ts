/**
 * **원격 창의 [이 기기로 다운로드]**(2026-11-19) — 파일 타일에서 고른 파일(하나 또는 여럿 — 여럿은 차례로 하나씩)을
 * 원격 창을 띄운 브라우저로 내려받는다. 폴더는 받지 않는다.
 *
 * 메인 PC 창의 [다운로드] · [탐색기로 내보내기…]는 메인 PC 의 폴더 고르기 대화상자를 여는 길이라 원격 창에서는 폴리필이
 * 거절한다. 그래서 원격 창에서는 그 두 줄 자리에 이 한 줄만 선다(`FileMenu.svelte`). 바이트는 이미 있는 `FsBackend.readImage`
 * (Rust `*_read_image` — 그림인지 보지 않고 파일 하나를 조각으로 읽는다 · 진행 · 취소)로 받고, 브라우저 내려받기로 넘긴다.
 * 몸통(진행 줄 · 취소 · 완료 안내)은 `fs-transfer.svelte.ts` 의 `downloadToDevice`. 여기는 순수 규칙 + DOM 도우미 하나다.
 */

/**
 * 원격 창으로 받을 수 있는 파일 하나의 상한 — **48 MiB**.
 *
 * 사용자가 고른 값은 200 MB 였지만, 응답은 ws 메시지 하나로 통째로 가고(`remote/frames.rs` `res_raw`), 관문은 한 연결의
 * 보내기 줄에 64 MiB(`remote/bridge.rs` 의 `MAX_QUEUED`)가 넘게 쌓이면 그 연결을 끊는다(페이지가 다시 읽힌다). 그래서 그
 * 안쪽으로 두고 다른 출력(터미널 · 진행 메시지) 몫을 남겼다. 시험이 `MAX_QUEUED` 보다 작은지 지킨다.
 */
export const DEVICE_DOWNLOAD_MAX_BYTES = 48 * 1024 * 1024;

/** 메뉴 줄의 모양 — 켜짐 / 흐림(전송 중) / 줄 없음 */
export type DeviceDownloadRow = "go" | "busy" | "none";

/**
 * [이 기기로 다운로드] 줄의 상태. 대상에 폴더(또는 폴더를 가리키는 링크)가 하나라도 섞이면 받을 수 없는 대상이라 줄을
 * 그리지 않는다(`"none"` — 전송 중이어도 · 폴더 내려받기는 없다). 파일만이면 하나든 여럿이든 선다(2026-11-19 사용자: 여러
 * 파일은 차례로 받기). 그다음 전송 중은 다른 줄의 `(전송 중)` 과 같은 흐린 줄.
 */
export function deviceDownloadRow(o: { hasFolder: boolean; busy: boolean }): DeviceDownloadRow {
  if (o.hasFolder) return "none";
  if (o.busy) return "busy";
  return "go";
}

/** 상한을 넘는가 — 넘으면 읽기 전에 거절한다 */
export function deviceDownloadTooBig(size: number, max: number = DEVICE_DOWNLOAD_MAX_BYTES): boolean {
  return size > max;
}

/**
 * 받기 직전에 다시 본(`stat`) 항목 하나를 건너뛸 까닭 — 없으면 `null`.
 * `"dir"` 은 메뉴를 연 뒤 폴더로 바뀐 경쟁이라 조용히 건너뛴다. 링크는 `stat`(lstat)의 크기가 링크 자신의 것이라 여기서
 * 거르지 않는다 — 진짜 크기는 읽기의 첫 진행 메시지(`bytesTotal`)로 늦게 본다.
 */
export function deviceDownloadSkip(o: { dir: boolean; link: boolean; size: number }): "dir" | "toobig" | null {
  if (o.dir) return "dir";
  if (!o.link && deviceDownloadTooBig(o.size)) return "toobig";
  return null;
}

/**
 * 상한 때문에 건너뛴 것들의 안내 모양 — 하나면 그 크기를 적는 옛 문구 그대로, 여럿이면 개수 문구, 없으면 `null`.
 */
export function deviceTooBigReport(
  sizes: readonly number[],
): { kind: "one"; size: number } | { kind: "many"; count: number } | null {
  if (sizes.length === 0) return null;
  if (sizes.length === 1) return { kind: "one", size: sizes[0] };
  return { kind: "many", count: sizes.length };
}

/**
 * 연달아 내는 내려받기 사이의 틈. 브라우저(Chromium)는 한 페이지가 아주 짧은 사이에 낸 `<a download>` 클릭을 뒤의 것부터
 * 떨어뜨리기도 한다 — 작은 파일은 ws 왕복이 짧아 클릭이 거의 붙어 나가므로, 둘째부터 이만큼 띄운다.
 * (여러 파일 내려받기 허용 묻기는 브라우저가 한 번 띄운다 — 그것은 막을 수 없고 막지 않는다.)
 */
export const DEVICE_DOWNLOAD_GAP_MS = 250;

/**
 * 바이트 한 덩어리를 **이 브라우저의 내려받기**로 넘긴다(`<a download>`) — 저장 자리는 브라우저가 정한다. 원격 창에서만 쓴다
 * (메인 PC 창은 디스크에 직접 쓴다). URL 은 늦게 거둔다 — 바로 거두면 내려받기가 시작되기 전에 끊기는 브라우저가 있다.
 */
export function saveBlobToDevice(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
