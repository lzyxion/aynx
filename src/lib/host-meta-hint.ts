/**
 * 호스트 폼 **표시 탭의 상속 곁말** — 순수 함수 (docs/log/2026-09-29-hostform-display-tidy.md).
 *
 * 빈 아이콘·색 칸은 "지우기 = 위 계층을 따른다" 이다. 예전에는 그 사실을 `상속: svg:ubuntu`
 * 처럼 **저장 형식 그대로** 말해서 읽히지 않았다. 이제 칸은 **어디서 온 무엇인가**를 사람 말로
 * 말한다 — "프리셋 prod 의 아이콘 · Ubuntu", "기본값의 색 · #8a8a8a".
 *
 * 같은 칸 한 벌(`IconColorFields.svelte`)을 호스트 폼 · 폴더 편집 · 프로젝트 폼이 쓴다
 * (docs/log/2026-09-29-folder-project-icons.md) — 상속이 있는 것은 호스트뿐이라 곁말 함수는 호스트 폼만 부른다.
 *
 * 출처는 백엔드가 병합하면서 적어 준다(`HostMeta.icon_from`·`color_from`,
 * `src-tauri/src/sessions_meta.rs` 의 `resolve`): 상속은 `[defaults]` 와 `[presets.<이름>]`
 * 두 계층뿐이다(그룹 폴더는 호스트에 값을 물려주지 않는다). 출처를 모르면(옛 백엔드) "상속된 …".
 */
import type { Tr } from "$lib/session";
import type { MetaLayer } from "$lib/hosts";
import { HOST_ICONS, ICON_PREFIX, iconNameOf, logosNameOf, lucideNameOf } from "$lib/host-icons";

/** `mongodb-icon` → `Mongodb`, `google-cloud` → `Google Cloud` (끝의 `-icon` 은 뗀다) */
function titleCase(name: string): string {
  const base = name.replace(/-icon$/i, "") || name;
  return base
    .split(/[-_\s]+/)
    .filter((w) => w !== "")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * 저장된 `icon` 값을 **사람이 읽는 이름**으로 — 저장 형식(`svg:…`)은 절대 내보내지 않는다.
 *
 * - 큐레이션 로고 → 그 라벨 (`svg:ubuntu` → `Ubuntu`, `svg:postgresql` → `PostgreSQL`)
 * - logos · lucide 전체 → 이름을 단어별 대문자로, 끝의 `-icon` 은 뗀다 (`Mongodb` · `Server Cog`)
 * - 모르는 `svg:` 이름 → 접두사를 떼고 같은 규칙
 * - 그 밖(이모지·글자) → 그대로
 */
export function iconDisplayName(icon: string | null | undefined): string {
  const raw = icon?.trim() ?? "";
  if (raw === "") return "";
  const curated = iconNameOf(raw);
  if (curated !== null) return HOST_ICONS[curated].label;
  const set = logosNameOf(raw) ?? lucideNameOf(raw);
  if (set !== null) return titleCase(set);
  if (raw.startsWith(ICON_PREFIX)) {
    const rest = raw.slice(ICON_PREFIX.length).replace(/^[a-z]+:/, "");
    return rest === "" ? "" : titleCase(rest);
  }
  return raw;
}

/** 칸 하나 — 곁말의 머리말이 갈린다 */
export type InheritField = "icon" | "color";

/**
 * 빈 칸의 placeholder — 상속값이 있으면 "출처 · 값", 없으면 `undefined`(부르는 쪽이 평소 문구).
 * 아이콘 값은 [`iconDisplayName`] 을 지난다.
 */
export function inheritPlaceholder(
  tr: Tr,
  field: InheritField,
  value: string | null | undefined,
  from: MetaLayer | null | undefined,
): string | undefined {
  const v = value?.trim() ?? "";
  if (v === "") return undefined;
  const shown = field === "icon" ? iconDisplayName(v) : v;
  if (from?.kind === "preset") return tr(`app.hostform.inherit.${field}.preset`, { name: from.name, value: shown });
  if (from?.kind === "defaults") return tr(`app.hostform.inherit.${field}.defaults`, { value: shown });
  return tr(`app.hostform.inherit.${field}.unknown`, { value: shown });
}

/** 되돌리기 단추의 말풍선 — 지우면 무엇을 따르게 되는가 (상속값이 없으면 그냥 "지우기") */
export function resetTitle(
  tr: Tr,
  value: string | null | undefined,
  from: MetaLayer | null | undefined,
): string {
  if ((value?.trim() ?? "") === "") return tr("app.iconcolor.reset");
  if (from?.kind === "preset") return tr("app.hostform.reset.preset", { name: from.name });
  if (from?.kind === "defaults") return tr("app.hostform.reset.defaults");
  return tr("app.hostform.reset.unknown");
}

/** 색 칸이 비었을 때(물려받은 색도 없을 때) 견본이 보여 주는 회색 — 파일에는 쓰이지 않는다 */
export const SWATCH_PLACEHOLDER = "#8a8a8a";

/**
 * `<input type="color">` 가 받을 수 있는 `#rrggbb` 로 — 못 바꾸면 `null`.
 * `sessions.toml` 의 색은 CSS 문자열 그대로라(`tomato`·`rgb(…)`) 견본 칸이 못 그리는 값도 있다.
 */
export function swatchHex(color: string | null | undefined): string | null {
  const c = color?.trim() ?? "";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return null;
}
