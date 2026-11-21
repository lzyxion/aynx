import { Channel, invoke } from "./ipc";
import { UI_ICONS } from "$lib/ui-icons.generated";
import type { Key } from "$lib/i18n/keys";

/**
 * 웹뷰 밖, OS 로 파일 끌어내기 — `tauri-plugin-drag` 2.1.1 의 얇은 벤딩(docs/log/2026-09-04-native-drag-out.md).
 * npm `@crabnebula/tauri-plugin-drag` 는 쓰지 않는다 — 2.1.0 에 멈춰 크레이트(2.1.1)와 짝이 어긋난다.
 * 명령 모양은 크레이트 `src/commands.rs` 와 맞춘다: `item` = 경로 배열(untagged — 태그 없음) · `image` = `data:image/png;base64,` 접두사 필수 ·
 * `options.mode` 는 최상위가 아니라 `options` 안이다 · `onEvent` 는 camelCase.
 *
 * 규칙 둘:
 * 1. `dragstart` 에서 `preventDefault()` 를 먼저 하고 `startDrag` 는 `await` 없이 즉시 부른다 — 웹 DnD 와 겹치면 네이티브가 곧바로
 *    취소되고, 한 틱이라도 늦으면 버튼이 떼어져 시작하자마자 놓인 것으로 처리된다.
 * 2. 부르기 전에 거절한다 — 플러그인은 셸 항목을 못 만들면 `unwrap()` 으로 패닉한다(UNC — 이슈 #72 · `MAX_PATH` 초과 — 이슈 #76).
 */

/** `drag::DragResult` 의 직렬화 그대로 */
export type NativeDragResult = "Dropped" | "Cancel";

/** `MAX_PATH`(260) 에서 10자를 남긴다 — 셸이 정규화하며(`\\?\` 접두사 등) 몇 글자를 더 붙일 수 있다 */
const MAX_PATH_SAFE = 250;

/** 이보다 짧게 끝난 드래그는 사람이 놓은 것이 아니다 — 콘솔 문구만 가른다 */
const IMMEDIATE_DROP_MS = 120;

/** 문구가 아니라 문구 키다 — 이 파일은 룬을 들이지 않는 순수 모듈이다(테스트가 그대로 들여온다) */
export interface DragBlocked {
  key: Key;
  params?: Record<string, string | number>;
}

/** 이 검사를 빠뜨린 호출 하나가 곧 앱 전체의 패닉이라, 검사와 호출이 같은 파일 안에 있어야 한다 */
export function nativeDragBlocker(paths: readonly string[]): DragBlocked | null {
  if (paths.length === 0) return { key: "files.drag.blocked.empty" };
  for (const path of paths) {
    if (path.startsWith("\\\\") || path.startsWith("//")) {
      return { key: "files.drag.blocked.unc" };
    }
    if (!/^[A-Za-z]:[\\/]/.test(path)) {
      return { key: "files.drag.blocked.relative" };
    }
    if (path.length > MAX_PATH_SAFE) {
      return { key: "files.drag.blocked.long", params: { limit: MAX_PATH_SAFE } };
    }
  }
  return null;
}

/**
 * 던지지 않는다 — `dragstart` 한가운데서 예외가 튀면 브라우저가 이벤트를 반쯤 처리한 채 멈춘다. 실패는 `onEnd("Cancel")` 로만 나간다.
 * `await` 이 하나도 없는 것이 요점이다(머리말 규칙 1).
 */
export function startNativeDrag(
  paths: readonly string[],
  icon: string,
  onEnd: (result: NativeDragResult) => void,
  onError?: (message: string) => void,
): void {
  let done = false;
  const finish = (result: NativeDragResult) => {
    if (done) return; // 콜백과 실패 처리가 겹쳐도 정리는 한 번이다
    done = true;
    onEnd(result);
  };

  // OLE 는 `MK_LBUTTON` 이 없으면 곧바로 `DRAGDROP_S_DROP` 을 돌려준다 — 수 ms 만에 끝난 `Dropped` 는 버튼이 안 눌린 것으로 읽힌 드래그다
  const t0 = performance.now();
  const age = () => Math.round(performance.now() - t0);

  const channel = new Channel<{ result: NativeDragResult }>();
  channel.onmessage = (message) => {
    const ms = age();
    console.debug(
      `[내보내기] 끝 ${message.result} (${ms}ms)`,
      ms < IMMEDIATE_DROP_MS
        ? "— 즉시 드롭: OLE 가 왼쪽 버튼을 '안 눌림' 으로 봤다"
        : "— 정상: 사용자가 실제로 놓았다",
    );
    finish(message.result === "Dropped" ? "Dropped" : "Cancel");
  };

  console.debug("[내보내기] 플러그인 호출", { count: paths.length, mode: "copy", first: paths[0] });
  void invoke("plugin:drag|start_drag", {
    item: [...paths],
    image: icon,
    options: { mode: "copy" },
    onEvent: channel,
  })
    .then(() => console.debug(`[내보내기] 플러그인 반환 (DoDragDrop 종료, ${age()}ms)`))
    .catch((e: unknown) => {
      // 삼키지 않는다 — 권한 거절 · 인자 역직렬화 실패가 "아무 일도 안 일어남" 과 구별되지 않는다
      console.error("[내보내기] 플러그인 호출 실패", e);
      finish("Cancel");
      onError?.(String(e));
    });
}

// ── 끌고 다니는 그림 ──
// 플러그인은 아이콘을 필수로 받고 크기를 조절하지 않는다(이슈 #41) — 장치 픽셀 비율까지 곱해 그린다.

const ICON_PX = 64;

/**
 * 캔버스가 실제로 먹는 값만 쓴다 — `color-mix(… var() …)` 같은 합성 값은 캔버스가 조용히 무시하고 직전 색(검정)을 칠한다.
 */
let probe: CanvasRenderingContext2D | null | undefined;
function themeColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value === "") return fallback;
  if (probe === undefined) probe = document.createElement("canvas").getContext("2d");
  if (!probe) return fallback;
  probe.fillStyle = "#000000";
  probe.fillStyle = value;
  const first = probe.fillStyle;
  probe.fillStyle = "#ffffff";
  probe.fillStyle = value;
  return probe.fillStyle === first ? value : fallback;
}

/** 캔버스가 없으면 1×1 투명 PNG — 아이콘은 필수 인자라 빈 문자열이면 명령이 거절된다 */
export function nativeDragIcon(count: number, isDir: boolean, countLabel: string): string {
  const dpr = typeof window === "undefined" ? 1 : Math.min(3, Math.max(1, window.devicePixelRatio));
  const size = Math.round(ICON_PX * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return TRANSPARENT_PNG;

  const accent = themeColor("--accent", "#4c8dff");
  const folder = themeColor("--folder", accent);
  // 원색 쪽이다 — `--bg-panel` 은 `color-mix` 라 캔버스가 읽지 못하고, 그림은 OS 위에 떠 뒤가 비치면 안 된다
  const panel = themeColor("--bg-panel-base", "#20242b");

  ctx.scale(dpr, dpr);

  ctx.fillStyle = panel;
  ctx.globalAlpha = 0.92;
  roundRect(ctx, 1, 1, ICON_PX - 2, ICON_PX - 2, 10);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  roundRect(ctx, 1, 1, ICON_PX - 2, ICON_PX - 2, 10);
  ctx.stroke();

  // Material 은 면으로 그린 윤곽이라 칠만 한다(획을 얹으면 뭉개진다)
  ctx.save();
  ctx.translate((ICON_PX - 40) / 2, (ICON_PX - 40) / 2);
  ctx.scale(40 / 24, 40 / 24);
  ctx.fillStyle = isDir ? folder : accent;
  for (const d of uiIconPaths(isDir ? "folder" : "file", isDir)) ctx.fill(new Path2D(d));
  ctx.restore();

  if (count > 1) drawCountBadge(ctx, countLabel, accent);

  return canvas.toDataURL("image/png");
}

/** 손으로 딴 path 사본을 두지 않는다 — 목록 줄과 끌기 그림이 갈라진다. 모르는 이름이면 빈 배열(드래그는 살아야 한다) */
export function uiIconPaths(name: string, filled = false): string[] {
  const icon = UI_ICONS[name];
  const body = (filled ? icon?.filledBody : undefined) ?? icon?.body ?? "";
  return [...body.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCountBadge(ctx: CanvasRenderingContext2D, text: string, accent: string): void {
  ctx.font = "600 11px system-ui, sans-serif";
  const w = Math.ceil(ctx.measureText(text).width) + 10;
  const h = 16;
  const x = ICON_PX - w - 3;
  const y = ICON_PX - h - 3;
  ctx.fillStyle = accent;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
}
