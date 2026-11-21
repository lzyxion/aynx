// 재부착 때 링을 넘긴 유실 안내. 터미널 버퍼에는 쓰지 않는다 — 재생 · ConPTY 재그림에 묻혀 보이지 않는다(그래서 타일 위 막대).

/** 자동으로 걷히기까지(ms). 아무 키 · 클릭으로도 걷힌다. */
export const LOST_NOTICE_MS = 8000;

export interface LostNotice {
  bytes: number;
  /** 1 KiB 미만이어도 1 로 올린다("0 KiB 유실" 은 거짓말이다) */
  kib: number;
}

export function lostNoticeOf(bytes: number | null | undefined): LostNotice | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  return { bytes, kib: Math.max(1, Math.round(bytes / 1024)) };
}

export function lostNoticeText(
  n: LostNotice,
  tr: (key: "pane.notice.reattached_lost", vars: { kib: number }) => string,
): string {
  return tr("pane.notice.reattached_lost", { kib: n.kib });
}

/** 수식 키만 눌린 것은 아직 입력이 아니다 */
export function dismissesLostNotice(key: string): boolean {
  return key !== "Control" && key !== "Shift" && key !== "Alt" && key !== "Meta" && key !== "AltGraph";
}
