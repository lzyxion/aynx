import { Channel, invoke } from "./ipc";
import { UI_ICONS } from "$lib/ui-icons.generated";
import type { Key } from "$lib/i18n/keys";

/**
 * **웹뷰 밖으로, OS 로 끌어내기** — `tauri-plugin-drag` 2.1.1 의 얇은 벤딩
 * (근거·제한·게이팅 이유는 docs/log/2026-09-04-native-drag-out.md).
 *
 * 웹 표준 DnD 로는 앱 밖으로 **파일**을 내보낼 수 없다. `DataTransfer` 에 실을 수 있는 것은
 * 글자와 `DownloadURL` 뿐이고, 탐색기가 알아듣는 것은 셸의 `CF_HDROP` 이다. 플러그인의
 * 윈도우 구현은 셸 `IDataObject` 를 만들어 `DoDragDrop` 을 직접 돌린다.
 *
 * ## npm 패키지를 쓰지 않는 이유
 *
 * 배포된 `@crabnebula/tauri-plugin-drag` 는 2.1.0 에 멈춰 있어 크레이트(2.1.1)와 짝이 어긋난다.
 * 감싸는 것이 `invoke` 한 줄뿐이라 의존성을 하나 더 지고 버전을 맞추는 것보다 **명령의
 * 모양을 여기 적어 두는 편**이 낫다 — 그 모양은 크레이트 소스
 * (`tauri-plugin-drag-2.1.1/src/commands.rs`)에서 확인했다:
 *
 * ```text
 *   invoke("plugin:drag|start_drag", {
 *     item:    string[]                     // 절대 경로들 (CF_HDROP)
 *     image:   "data:image/png;base64,…"    // 접두사가 정확히 이것이어야 한다
 *     options: { mode: "copy" | "move" }    // ← `mode` 는 최상위가 아니라 이 안이다
 *     onEvent: Channel<{ result, cursorPos }>
 *   })
 * ```
 *
 * **2026-09-05 재대조** (실기에서 "무반응" 이 나와 한 줄씩 다시 맞춰 봤다 — 어긋난 곳은
 * 없었다). 근거는 `tauri-plugin-drag-2.1.1/src/commands.rs` 다:
 *
 * - `DragItem` 은 `#[serde(untagged)]` 라 `Files(Vec<PathBuf>)` 가 **맨 위 갈래**다 →
 *   경로 배열을 그대로 주면 된다 (`{"Files":[…]}` 같은 태그가 **아니다**).
 * - `Image` 도 `untagged` 이고 `Base64Image` 의 `Deserialize` 가 `data:image/png;base64,`
 *   접두사를 요구한다 → `canvas.toDataURL("image/png")` 가 그대로 맞는다.
 * - `DragMode` 는 `#[serde(rename_all = "camelCase")]` → 갈래 이름이 `"copy"` · `"move"`.
 * - 인자 이름은 tauri `#[command]` 의 기본 규칙대로 camelCase 다 (`on_event` → `onEvent`).
 *
 * 그래서 남은 실패 갈래는 **조용하지 않아야** 한다 — 아래 `startNativeDrag` 가 거절을
 * 콘솔과 토스트로 내보낸다 (docs/log/2026-09-04-native-drag-out.md "실기 후").
 *
 * ## 두 가지 규칙이 이 파일의 전부다
 *
 * 1. **`dragstart` 에서 `preventDefault()` 를 먼저 하고, `startDrag` 는 `await` 없이 즉시
 *    부른다.** 웹 DnD 를 죽이지 않으면 두 드래그가 겹쳐 네이티브 쪽이 곧바로 취소되고,
 *    한 틱이라도 늦으면 그 사이 버튼이 떼어져 시작하자마자 놓인 것으로 처리된다.
 * 2. **부르기 전에 거절한다.** 플러그인의 윈도우 경로는 셸 항목을 만들지 못하면
 *    `unwrap()` 으로 **패닉**한다 (UNC `\\server\share` — 이슈 #72 · `MAX_PATH`(260) 초과 —
 *    이슈 #76). 앱이 통째로 죽는 실패라 사후 처리가 불가능하므로, 부르기 전에 [`nativeDragBlocker`]
 *    가 막고 안내로 물러난다.
 */

/** 플러그인이 끝을 알리는 두 값 (`drag::DragResult` 의 직렬화 그대로) */
export type NativeDragResult = "Dropped" | "Cancel";

/**
 * 경로 길이의 안전선. 윈도우의 `MAX_PATH` 는 **260**(끝의 NUL 포함)이고, 셸이 그 위에서
 * 항목을 만들지 못하면 플러그인이 패닉한다. 10자를 남겨 두는 것은 셸이 경로를 정규화하며
 * (`dunce::canonicalize` → `\\?\` 접두사 등) 몇 글자를 더 붙일 수 있어서다.
 */
const MAX_PATH_SAFE = 250;

/**
 * 이보다 짧게 끝난 드래그는 **사람이 놓은 것이 아니다** — 시작하자마자 버튼이 떨어진 것으로
 * 읽힌 것이다. 콘솔 문구를 두 갈래로 가르는 데만 쓰는 값이라 동작에는 영향이 없다.
 */
const IMMEDIATE_DROP_MS = 120;

/**
 * 못 끄는 사유 하나 — **문구가 아니라 문구 키**다.
 *
 * 이 파일은 룬을 들이지 않는 순수 모듈이라(테스트가 그대로 들여온다) 말을 만들 수 없다.
 * 키와 인자만 실어 보내고 `t()` 로 푸는 것은 부르는 쪽(`drag-controller.svelte.ts`)의 몫이다.
 */
export interface DragBlocked {
  key: Key;
  params?: Record<string, string | number>;
}

/**
 * 이 짐을 **네이티브로 끌 수 있는가** — 못 끌면 그 사유, 끌 수 있으면 `null`.
 *
 * 판정을 부르는 쪽에 흩지 않고 여기 모으는 이유: 이 검사를 빠뜨린 호출 하나가 곧 **앱 전체의
 * 패닉**이라, 검사와 호출이 같은 파일 안에 나란히 있어야 한다.
 */
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
 * 드래그를 시작한다 — **던지지 않는다**. `dragstart` 한가운데서 예외가 튀면 브라우저가
 * 그 이벤트를 반쯤 처리한 채로 멈추므로, 실패는 `onEnd("Cancel")` 로만 나간다.
 *
 * `await` 이 하나도 없는 것이 요점이다 (파일 머리말 규칙 1). 호출자는 이 함수가 돌아온
 * **뒤에** 화면을 만져야 한다.
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

  // **얼마나 살았는가**가 진단의 전부다 (docs/log/2026-09-04-native-drag-out.md "D").
  // `IDropSource::QueryContinueDrag` 는 `grfKeyState` 에 `MK_LBUTTON` 이 없으면 그 자리에서
  // `DRAGDROP_S_DROP` 을 돌려주므로, 버튼이 안 눌린 것으로 읽힌 드래그는 **수 ms 만에**
  // `Dropped` 로 끝난다. 사람이 실제로 끌어다 놓은 것은 아무리 빨라도 수백 ms 다.
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
      // **삼키지 않는다.** 예전에는 `.catch(() => finish("Cancel"))` 이라 권한 거절도
      // 인자 역직렬화 실패도 화면에서는 "아무 일도 안 일어남" 과 구별되지 않았다.
      console.error("[내보내기] 플러그인 호출 실패", e);
      finish("Cancel");
      onError?.(String(e));
    });
}

// ---------------------------------------------------------------------------
// 끌고 다니는 그림 — 캔버스 PNG 한 장
//
// 플러그인은 아이콘을 **필수**로 받고 크기를 조절하지 않는다 (이슈 #41). 그래서 여기서
// 장치 픽셀 비율까지 곱해 실제로 보일 크기로 그린다 — 96dpi 화면에서 만든 그림을 150%
// 배율 화면에 그대로 얹으면 흐릿하게 커진다.
//
// 모양은 목록 줄의 글리프(`host-icons` 의 24×24 path)와 같은 것을 쓰고, 여럿이면 오른쪽
// 아래에 "N개" 배지를 얹는다 — 앱 안 드래그의 개수 고스트(`setCountGhost`)와 같은 말이라
// 몸짓이 달라도 읽는 법이 같다.
// ---------------------------------------------------------------------------

/** 그림의 논리 한 변(px) — 탐색기의 드래그 이미지와 비슷한 크기 */
const ICON_PX = 64;

/**
 * 테마 변수 하나를 **캔버스가 쓸 수 있는 색**으로 (아니면 대비가 확실한 대체색).
 *
 * 걸러 내는 일이 있다. 커스텀 속성의 계산값은 **글자 그대로** 나오므로 `--bg-panel` 같은
 * 합성 값(`color-mix(in srgb, var(--bg-panel-base) …)`)은 `var()` 를 품은 채 온다 — 캔버스에
 * 넣으면 조용히 무시되고 **직전 색**(기본 검정)이 칠해진다. 그래서 실제로 넣어 보고 먹히는
 * 값만 쓴다. 부르는 쪽이 애초에 **합성되지 않은 원색 변수**(`--bg-panel-base`)를 고르는 것이
 * 첫 방어이고, 이 검사는 테마가 바뀌었을 때의 두 번째 방어다.
 */
let probe: CanvasRenderingContext2D | null | undefined;
function themeColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value === "") return fallback;
  if (probe === undefined) probe = document.createElement("canvas").getContext("2d");
  if (!probe) return fallback;
  // 서로 다른 두 바탕에서 같은 결과가 나와야 **실제로 먹힌 값**이다 (무시되면 바탕이 남는다).
  probe.fillStyle = "#000000";
  probe.fillStyle = value;
  const first = probe.fillStyle;
  probe.fillStyle = "#ffffff";
  probe.fillStyle = value;
  return probe.fillStyle === first ? value : fallback;
}

/**
 * 끌고 다닐 그림을 만든다 — `data:image/png;base64,…` (플러그인이 요구하는 정확한 접두사).
 *
 * 캔버스를 못 쓰는 자리(테스트·서버)에서는 **1×1 투명 PNG** 를 돌려준다. 아이콘은 필수
 * 인자라 빈 문자열을 넘기면 명령 자체가 거절되므로, 그림이 없더라도 드래그는 살려 둔다.
 */
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
  // `--bg-panel` 이 아니라 **원색** 쪽이다 — 저쪽은 투명도가 섞인 `color-mix` 라 캔버스가
  // 읽지 못하고, 어차피 이 그림은 OS 위에 뜨므로 뒤가 비치면 안 된다.
  const panel = themeColor("--bg-panel-base", "#20242b");

  ctx.scale(dpr, dpr);

  // 바닥 — 살짝 둥근 사각형. 글리프만 띄우면 밝은 배경 위에서 사라진다.
  ctx.fillStyle = panel;
  ctx.globalAlpha = 0.92;
  roundRect(ctx, 1, 1, ICON_PX - 2, ICON_PX - 2, 10);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  roundRect(ctx, 1, 1, ICON_PX - 2, ICON_PX - 2, 10);
  ctx.stroke();

  // 글리프 — 목록 줄과 **같은 그림**을 24×24 좌표계째 가운데 40px 로 옮겨 그린다. Material 은 면으로 그린 윤곽이라
  // 칠만 한다(획을 얹으면 뭉개진다). 폴더는 줄과 같은 꽉 찬 그림, 파일은 윤곽 그림이다.
  ctx.save();
  ctx.translate((ICON_PX - 40) / 2, (ICON_PX - 40) / 2);
  ctx.scale(40 / 24, 40 / 24);
  ctx.fillStyle = isDir ? folder : accent;
  for (const d of uiIconPaths(isDir ? "folder" : "file", isDir)) ctx.fill(new Path2D(d));
  ctx.restore();

  if (count > 1) drawCountBadge(ctx, countLabel, accent);

  return canvas.toDataURL("image/png");
}

/**
 * 생성된 UI 아이콘의 **path 데이터만** 뽑는다 — 캔버스의 `Path2D` 는 SVG 마크업이 아니라 `d`
 * 문자열을 받는다. 손으로 딴 사본(예전 `FOLDER_D`·`FILE_D`)을 여기 다시 두면 목록 줄과 끌기
 * 그림이 서로 다른 모양으로 갈라지므로, 줄이 그리는 바로 그 `body` 에서 꺼낸다.
 *
 * `body` 는 `<path d="…"/>` 몇 개뿐이라 `d` 속성만 모으면 충분하다. `filled` 면 꽉 찬 변형(`UiIcon` 의 `filled` 와 같은 것)에서
 * 꺼낸다. 모르는 이름이면 빈 배열 — 그림이 비어도 드래그 자체는 살아야 한다.
 */
export function uiIconPaths(name: string, filled = false): string[] {
  const icon = UI_ICONS[name];
  const body = (filled ? icon?.filledBody : undefined) ?? icon?.body ?? "";
  return [...body.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

/** 1×1 투명 PNG — 캔버스가 없을 때의 자리 채움 (아이콘은 명령의 필수 인자다) */
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

/** 오른쪽 아래 "N개" 알약 — 앱 안 고스트와 같은 글자·같은 색 (글자는 부르는 쪽이 만든다) */
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
