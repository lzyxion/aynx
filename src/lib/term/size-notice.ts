// 크기 주인이 아닌 타일의 안내(점선 테두리 · 꼬리표 · 포커스 타일의 카드). 폰 배치에는 없다 — 위 띠의 ⤢ 가 그 몫이다.

export type NoticeSide = "remoteDevice" | "mainPc" | "otherWindow";

/** 메인 PC 창에서 주인이 주가 아니면 원격 기기다 — 메인 PC 의 다른 창은 주를 빼앗아 붙는다(시청자가 아니다). */
export function noticeSide(remoteWindow: boolean, ownerPrimary: boolean | undefined): NoticeSide {
  if (remoteWindow) return ownerPrimary === true ? "mainPc" : "otherWindow";
  return ownerPrimary === true ? "otherWindow" : "remoteDevice";
}

export interface Size2 {
  width: number;
  height: number;
}

/** 터미널 상자 왼쪽 위 기준 px. `over` 는 글자 위에 겹친 자리라 닫을 수 있어야 한다. */
export interface CardPlace {
  side: "right" | "below" | "over";
  left: number;
  top: number;
}

export const CARD_GAP = 12;

/** 옆 · 아래 빈자리가 없으면 상자 안 오른쪽 아래 구석(`over`), 상자도 작으면 `null` — 꼬리표를 눌러 같은 단추를 연다 */
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
  if (box.width >= card.width + 2 * gap && box.height >= card.height + 2 * gap) {
    return { side: "over", left: Math.round(box.width - card.width - gap), top: Math.round(box.height - card.height - gap) };
  }
  return null;
}

export interface NoticeAction {
  act: "tile" | "all";
  label: "pane.sizeNotice.fitHere" | "pane.sizeNotice.fitTile" | "pane.sizeNotice.fitAll" | "pane.sizeNotice.fitDevice";
}

/** `canClaim` 이 거짓이면(크기 주인 자격이 없는 기기) [이 기기 크기로] 하나 — "이 기기 크기로 맞추기" 를 켜고 다시 붙어 되찾는다. */
export function noticeActions(shrunk: number, canClaim: boolean = true): NoticeAction[] {
  if (!canClaim) return [{ act: "tile", label: "pane.sizeNotice.fitDevice" }];
  if (shrunk <= 1) return [{ act: "tile", label: "pane.sizeNotice.fitHere" }];
  return [
    { act: "tile", label: "pane.sizeNotice.fitTile" },
    { act: "all", label: "pane.sizeNotice.fitAll" },
  ];
}

export function outlineBox(box: Size2, drawn: Size2): Size2 {
  return { width: Math.min(drawn.width, box.width), height: Math.min(drawn.height, box.height) };
}
