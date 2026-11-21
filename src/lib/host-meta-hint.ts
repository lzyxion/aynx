/**
 * 호스트 폼 표시 탭의 상속 곁말 — 저장 형식(`svg:…`) 대신 "어디서 온 무엇인가" 를 사람 말로 말한다.
 * 출처는 백엔드 `sessions_meta.rs` 의 `resolve` 가 적는 `icon_from` · `color_from` 이고 상속은 `[defaults]` · `[presets.<이름>]` 둘뿐이다.
 */
import type { Tr } from "$lib/session";
import type { MetaLayer } from "$lib/hosts";
import { HOST_ICONS, ICON_PREFIX, iconNameOf, logosNameOf, lucideNameOf } from "$lib/host-icons";

function titleCase(name: string): string {
  const base = name.replace(/-icon$/i, "") || name;
  return base
    .split(/[-_\s]+/)
    .filter((w) => w !== "")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** 저장 형식(`svg:…`)은 내보내지 않는다 */
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

export type InheritField = "icon" | "color";

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

/** 견본만 보여 주는 회색 — 파일에는 쓰이지 않는다 */
export const SWATCH_PLACEHOLDER = "#8a8a8a";

/** `sessions.toml` 의 색은 CSS 문자열 그대로라(`tomato` · `rgb(…)`) `<input type="color">` 가 못 받는 값이면 `null` */
export function swatchHex(color: string | null | undefined): string | null {
  const c = color?.trim() ?? "";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return null;
}
