// **다른 기기 크기 안내**(10-20 — 사용자 승인 목업 B). 순수 모듈 — 상태 저장소 · DOM 을 모른다.
//
// 크기 주인이 아닌 터미널 타일(`size-owner.ts` — 다른 창 · 원격 기기가 마지막으로 쳐서 PTY 가 그 크기다)은 왼쪽 위에 그 크기로 그려지고 나머지는
// 빈다. 그래서 그 타일에는:
//
// - **늘** 그려진 영역(cols×rows)에 점선 테두리 + 위 가장자리 꼬리표("원격 기기 80×24") — [`noticeSide`] 가 문구를 고른다.
// - **포커스 타일만** 빈 자리(오른쪽 또는 아래 — 넓은 쪽)에 카드 하나 — [`placeCard`] 가 자리를 고르고, 자리가 모자라면 `null`(카드 대신
//   꼬리표를 눌러 같은 단추를 연다).
// - 단추는 이 창의 줄어든 타일 수로 갈린다 — [`noticeActions`]: 하나면 [이 창 크기로], 둘 이상이면 [이 타일만] [모두 되돌리기].
//
// 폰 배치(`mobileLayout`)에는 이 안내가 없다 — 위 띠의 ⤢ 가 "이 기기 크기로 맞추기" 를 늘 쥐고 있다(`mobile/MobileBar`).

/** 주인이 누구로 보이나 — 이 창이 집 PC 창이면 주인이 아닌 쪽 = 원격 기기, 원격 창이면 주(집 PC) = 메인 PC · 나머지 = 다른 창 */
export type NoticeSide = "remoteDevice" | "mainPc" | "otherWindow";

/**
 * 꼬리표 · 카드 문구의 갈래. `remoteWindow` = 이 창이 원격 창인가(`isRemote`), `ownerPrimary` = 주인이 주(집 PC 창)인가(서버 `primary` —
 * 모르면 `undefined`). 집 PC 창에서 주인이 주가 아니면 원격 기기다(집 PC 의 다른 창은 주를 빼앗아 붙는다 — 시청자가 아니다).
 */
export function noticeSide(remoteWindow: boolean, ownerPrimary: boolean | undefined): NoticeSide {
  if (remoteWindow) return ownerPrimary === true ? "mainPc" : "otherWindow";
  return ownerPrimary === true ? "otherWindow" : "remoteDevice";
}

export interface Size2 {
  width: number;
  height: number;
}

/** 카드 자리 — 터미널 상자 왼쪽 위 기준 px */
export interface CardPlace {
  side: "right" | "below";
  left: number;
  top: number;
}

/** 카드와 그려진 영역 · 상자 가장자리 사이 최소 여백(px) */
export const CARD_GAP = 12;

/**
 * 카드를 어디에 둘까 — 상자(`box`) 왼쪽 위에 그려진 영역(`drawn` — 상자보다 크면 상자로 자른다) 오른쪽 또는 아래의 빈 자리에. 둘 다 들어가면
 * 넓은 쪽(남는 넓이가 큰 쪽), 하나만 들어가면 그쪽, 아무 데도 안 들어가면 `null`(꼬리표 팝오버로). 빈 자리 가운데에 놓는다.
 */
export function placeCard(box: Size2, drawn: Size2, card: Size2, gap: number = CARD_GAP): CardPlace | null {
  const dw = Math.min(drawn.width, box.width);
  const dh = Math.min(drawn.height, box.height);
  const rightW = box.width - dw;
  const belowH = box.height - dh;
  const fitsRight = rightW >= card.width + 2 * gap && box.height >= card.height + 2 * gap;
  const fitsBelow = belowH >= card.height + 2 * gap && box.width >= card.width + 2 * gap;
  const right = (): CardPlace => ({
    side: "right",
    left: Math.round(dw + (rightW - card.width) / 2),
    top: Math.round(Math.max(gap, Math.min((dh - card.height) / 2, box.height - card.height - gap))),
  });
  const below = (): CardPlace => ({
    side: "below",
    left: Math.round(Math.max(gap, Math.min((dw - card.width) / 2, box.width - card.width - gap))),
    top: Math.round(dh + (belowH - card.height) / 2),
  });
  if (fitsRight && fitsBelow) return rightW * box.height >= belowH * box.width ? right() : below();
  if (fitsRight) return right();
  if (fitsBelow) return below();
  return null;
}

/** 단추 하나의 뜻 — 이 타일을 이 창 크기로(`tile`) · 이 창의 줄어든 타일 모두(`all`) */
export interface NoticeAction {
  act: "tile" | "all";
  /** i18n 열쇠 */
  label: "pane.sizeNotice.fitHere" | "pane.sizeNotice.fitTile" | "pane.sizeNotice.fitAll" | "pane.sizeNotice.fitDevice";
}

/**
 * 이 창의 줄어든 타일 수(`shrunk` — 이 타일 포함) → 단추. 하나 이하면 [이 창 크기로], 둘 이상이면 [이 타일만] [모두 되돌리기].
 * `canClaim` 이 거짓이면(크기 주인 자격이 없는 이 기기 — 폰 · 넓은 배치) [이 기기 크기로] 하나다: "이 기기 크기로 맞추기" 를 켜고 다시 붙어 되찾는다.
 */
export function noticeActions(shrunk: number, canClaim: boolean = true): NoticeAction[] {
  if (!canClaim) return [{ act: "tile", label: "pane.sizeNotice.fitDevice" }];
  if (shrunk <= 1) return [{ act: "tile", label: "pane.sizeNotice.fitHere" }];
  return [
    { act: "tile", label: "pane.sizeNotice.fitTile" },
    { act: "all", label: "pane.sizeNotice.fitAll" },
  ];
}

/** 점선 테두리 상자 — 그려진 영역을 상자로 자른 것(넘치면 그쪽은 상자 끝까지 — 스크롤 중) */
export function outlineBox(box: Size2, drawn: Size2): Size2 {
  return { width: Math.min(drawn.width, box.width), height: Math.min(drawn.height, box.height) };
}
