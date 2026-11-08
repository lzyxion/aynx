// 떨어진 세션에 다시 붙을 때 **링을 넘긴 유실** 안내 — 순수 부분(표시 조건 · 자동 닫힘 시간 · 문구 · 닫는 키).
//
// 예전에는 이 안내를 터미널 버퍼에 한 줄로 썼는데(`notice()`), 재부착 직후의 재생 · 실시간 출력 · ConPTY 재그림에 묻혀
// 사람 눈에 닿지 않았다(설치본 실기 10-10). 그래서 타일 위 막대(`Banners.svelte` 의 `.reco`)로 띄운다 — 버퍼에는 쓰지
// 않는다. 유실이 0 이면 안내도 없다.

/** 자동으로 걷히기까지(ms). 아무 키 · 클릭으로도 걷힌다. */
export const LOST_NOTICE_MS = 8000;

/** 유실 안내 막대의 상태 (`null` = 없음) */
export interface LostNotice {
  /** 유실된 바이트 */
  bytes: number;
  /** 화면에 쓸 KiB — 1 KiB 미만이어도 1 로 올린다("0 KiB 유실" 은 거짓말이다) */
  kib: number;
}

/** 서버가 알린 유실 바이트 → 안내 상태. 없거나 0 이하(또는 수가 아니면) `null` */
export function lostNoticeOf(bytes: number | null | undefined): LostNotice | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  return { bytes, kib: Math.max(1, Math.round(bytes / 1024)) };
}

/** 막대 문구 — i18n 키 `pane.notice.reattached_lost` */
export function lostNoticeText(
  n: LostNotice,
  tr: (key: "pane.notice.reattached_lost", vars: { kib: number }) => string,
): string {
  return tr("pane.notice.reattached_lost", { kib: n.kib });
}

/** 이 키가 막대를 걷는가 — 수식 키만 눌린 것(Ctrl·Shift·Alt·Meta 단독)은 아직 입력이 아니다 */
export function dismissesLostNotice(key: string): boolean {
  return key !== "Control" && key !== "Shift" && key !== "Alt" && key !== "Meta" && key !== "AltGraph";
}
