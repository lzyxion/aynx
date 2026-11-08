/**
 * **아이콘 세트** — 호스트에 붙이는 **컬러 로고**와 화면이 늘 그리는 **테마 색 글리프**
 * (docs/log/2026-09-04-icons-and-rows.md).
 *
 * ## 두 종류가 있고, 색 규칙이 정반대다
 *
 * | | 무엇 | 색 |
 * | --- | --- | --- |
 * | [`HOST_ICONS`] | 사용자가 호스트에 **골라 붙이는** 로고 (Ubuntu·Docker·AWS…) | **원본 그대로** |
 * | [`SERVER_D`] | 아이콘을 안 고른 호스트의 기본 서버 랙 | `currentColor` (테마를 따른다) |
 *
 * 로고가 테마를 따르지 않는 것은 **의도**다. 우분투가 주황이고 데비안이 빨강인 것이 이
 * 아이콘들의 요점이라, 강조색을 입히면 서로 구분되지 않는 실루엣 스물아홉 개가 되어 고르는
 * 뜻이 사라진다 — 한눈에 "저건 우분투" 로 읽히려고 다는 것이다. 반대로 폴더는 **앱의 일부**
 * 이므로 테마를 따라야 한다 (`--folder`).
 *
 * ## 왜 이모지가 아닌가
 *
 * `sessions.toml` 의 `icon` 은 원래 **이모지 한 글자**였다 (`"🐧"`). 지금도 그대로 되지만
 * 배포판을 가리키는 이모지가 없어, 서버 스무 대를 구분하려면 🐧 하나에 색 점을 곁들이는
 * 수밖에 없었다. 저장 형식은 **`"svg:<이름>"`** 접두사다 (`icon = "svg:ubuntu"`) — 백엔드는
 * 이 값을 **문자열로 보관만** 하므로 Rust 쪽 변경이 없고, 접두사가 아닌 값은 예전 그대로
 * 이모지로 그려진다. 이미 이모지를 적어 둔 사람의 파일은 아무것도 바뀌지 않는다.
 *
 * ## 아이콘 데이터는 생성물이다
 *
 * 로고 자체는 `host-icons.generated.ts` 에 있고, 그것은 `scripts/gen-host-icons.mjs` 가
 * Iconify 묶음(`@iconify-json/logos` · `@iconify-json/devicon`, 둘 다 devDependency)에서
 * 뽑아 만든다 — **런타임에 Iconify API 를 부르지 않는다** (오프라인 환경에서 화면이 반쯤
 * 비고, Tauri CSP 도 그만큼 열어야 한다). 아이콘을 더하는 절차는 그 스크립트의 머리 주석에
 * 있다: `npm run gen:icons`.
 *
 * ## logos 전체 (2026-09-29)
 *
 * 위 서른여섯 개(큐레이션) 말고도 고르개의 검색은 **logos 전체**(2,110개)를 찾는다. 그 표는 본
 * 번들이 아니라 늦게 받는 JSON 이고(`icon-sets.svelte.ts`), 저장 형식은 `svg:logos:<이름>` 이다
 * — 아래 "logos 전체" 절 (docs/log/2026-09-29-logos-full-icons.md).
 *
 * ## lucide 전체 — "기본" 아이콘 (2026-09-29)
 *
 * 브랜드가 아닌 **일반 사물**(서버·DB·라우터·집…)은 고르개의 "기본" 칸이 lucide 전체(1,909개,
 * ISC)에서 고른다. 저장 형식 `svg:lucide:<이름>`, 표는 logos 와 같은 방식으로 늦게 받는다
 * (`icon-sets.svelte.ts`). **이것만 색 규칙이 로고와 반대다** — 단색 선이라 `currentColor` 로
 * 그리고, 그리는 쪽이 호스트 색(`HostIcon` 의 `color`)을 입힌다. 아래 "lucide 전체" 절.
 */

import { GENERATED_ICONS, type GeneratedIcon } from "$lib/host-icons.generated";

export type { GeneratedIcon };

/** 사용자가 고를 수 있는 컬러 로고 전부 (선언 순서 = 고르개 격자 순서) */
export const HOST_ICONS: Readonly<Record<string, GeneratedIcon>> = GENERATED_ICONS;

/** 고르개가 그리는 순서 */
export const HOST_ICON_NAMES: readonly string[] = Object.keys(GENERATED_ICONS);

/** `sessions.toml` 의 `icon` 이 내장 아이콘을 가리킬 때 붙는 접두사 */
export const ICON_PREFIX = "svg:";

/** 이 이름을 저장 형식으로 (`"ubuntu"` → `"svg:ubuntu"`) */
export function iconRef(name: string): string {
  return `${ICON_PREFIX}${name}`;
}

/**
 * 저장된 `icon` 값이 **내장 아이콘을 가리키는가** — 가리키면 그 이름, 아니면 `null`.
 *
 * 모르는 이름(`"svg:없는것"`)에도 `null` 을 준다: 그 값을 적어 둔 설정 파일이 아이콘을 뺀
 * 버전에서 열렸을 때 빈칸이 되는 대신 **이모지 자리로 떨어져** 글자 그대로 보이는 편이,
 * 아무것도 안 그려져 "아이콘을 지운 것처럼" 보이는 것보다 고치기 쉽다.
 */
export function iconNameOf(icon: string | null | undefined): string | null {
  const raw = icon?.trim();
  if (!raw || !raw.startsWith(ICON_PREFIX)) return null;
  const name = raw.slice(ICON_PREFIX.length);
  return name in GENERATED_ICONS ? name : null;
}

/** 이름으로 로고 하나 (모르는 이름이면 `null`) */
export function glyphFor(name: string): GeneratedIcon | null {
  return GENERATED_ICONS[name] ?? null;
}

/**
 * **고르개의 검색** — 친 글자에 걸리는 로고 이름들 (격자를 그 순서로 좁힌다).
 *
 * 아이콘 칸이 값을 그대로 담던 상자에서 **검색창**이 되면서 생긴 함수다
 * (docs/log/2026-09-20-host-form-tabs.md 의 "아이콘 칸 = 검색"): 서른여섯 개를 눈으로 훑는
 * 대신 `deb` 를 치면 데비안 하나만 남는다.
 *
 * 규칙 셋:
 *
 * 1. **대소문자를 무시하고**, 앞에 붙은 `svg:` 는 떼고 본다 — 예전 칸에 `svg:ubuntu` 를
 *    치던 사람의 손버릇이 그대로 먹혀야 한다(그 글자가 저장 형식이기도 하다).
 * 2. 보는 곳은 셋이다: **이름**(`raspberry-pi`) · **라벨**(`Raspberry Pi`) · **별칭**
 *    (`rpi` — 생성기의 `KEYWORDS`). 별칭이 있는 이유는 사람이 치는 글자가 우리 이름과
 *    같지 않기 때문이다 (`k8s` · `pg`).
 * 3. **접두사가 포함보다 앞에 선다.** `red` 는 `Red Hat` 과 `redis` 를 먼저 세우고, 어디
 *    중간에 `red` 가 든 것은 그 뒤다. 같은 등급 안에서는 **표의 차례 그대로**(= 격자의
 *    차례) — 검색 결과가 제멋대로 재배열되면 사람이 외운 자리가 흔들린다.
 *
 * 빈 글자는 **전부**(격자가 평소 모습 그대로)이고, 걸리는 것이 없으면 빈 배열이다 —
 * 그때가 곧 **이모지를 친 것**이라 부르는 쪽이 그 글자를 값으로 쓴다.
 *
 * 순수 함수라 표를 인자로 받는다 (유닛 테스트 · `host-icons.test.ts`).
 */
export function matchIcons(
  query: string,
  table: Readonly<Record<string, GeneratedIcon>> = GENERATED_ICONS,
): string[] {
  let q = query.trim().toLowerCase();
  if (q.startsWith(ICON_PREFIX)) q = q.slice(ICON_PREFIX.length);
  if (q === "") return Object.keys(table);

  const starts: string[] = [];
  const contains: string[] = [];
  for (const [name, icon] of Object.entries(table)) {
    const hay = [name, icon.label, ...icon.keywords].map((s) => s.toLowerCase());
    if (hay.some((h) => h.startsWith(q))) starts.push(name);
    else if (hay.some((h) => h.includes(q))) contains.push(name);
  }
  return [...starts, ...contains];
}

// ---------------------------------------------------------------------------
// **logos 전체** — 고르개의 검색이 늦게 불러 쓰는 2,110개 (docs/log/2026-09-29-logos-full-icons.md).
//
// 위의 서른여섯 개(`HOST_ICONS`)는 목록·탭·상태바가 늘 그리므로 본 번들에 있다. logos 전체는
// 7MB 남짓이라 따로 산다 — `host-icons-logos.generated.json` 을 고르개가 열릴 때(또는 그
// 아이콘을 그릴 때) 앱 자신의 출처에서 받아 온다 (`icon-sets.svelte.ts`). 여기는 그 표를
// **인자로 받는** 순수 함수들뿐이다 (유닛 테스트).
//
// 저장 형식은 `svg:logos:<logos 이름>` 이다. 큐레이션 이름에는 `:` 가 없으므로 둘이 **절대
// 겹치지 않고**, 이름은 Iconify 의 것 그대로라 우리가 붙인 별명처럼 흔들리지 않는다 (Iconify 는
// 바꾼 이름을 숨김·별칭으로 남긴다 — 그래서 표가 그 둘을 함께 싣는다).
// ---------------------------------------------------------------------------

/** logos 전체 표의 한 칸 — 생성기가 줄여 적은 모양 그대로 */
export interface LogosEntry {
  /** SVG 안쪽 마크업 (색 포함) */
  b: string;
  /** viewBox — 표의 기본(`0 0 256 256`)과 다를 때만 */
  v?: string;
  /** 숨김(Iconify `hidden`) — 옛 이름을 살려 두려고 싣지만 검색에는 안 뜬다 */
  x?: 1;
}

/**
 * 통째로 싣는 아이콘 표의 모양 — `host-icons-logos.generated.json` · `host-icons-lucide.generated.json`
 * 둘 다 이것이다 (`scripts/gen-host-icons.mjs` 의 `writeFullSet` 이 만든다).
 */
export interface IconSetData {
  source: string;
  version: string;
  license: string;
  /** 칸마다 `v` 가 없을 때의 viewBox */
  viewBox: string;
  icons: Readonly<Record<string, LogosEntry>>;
  /** 옛 이름 → 지금 이름 (풀이에만 쓴다) */
  aliases: Readonly<Record<string, string>>;
}

/** logos 전체 표 — 모양은 [`IconSetData`] 그대로 (이름은 먼저 나온 쪽의 것이 남았다) */
export type LogosSet = IconSetData;

/** `svg:` 뒤에 붙는 logos 전체의 표식 — 큐레이션 이름에는 `:` 가 없어 겹치지 않는다 */
export const LOGOS_PREFIX = "logos:";

/** logos 이름을 저장 형식으로 (`"mongodb-icon"` → `"svg:logos:mongodb-icon"`) */
export function logosRef(name: string): string {
  return `${ICON_PREFIX}${LOGOS_PREFIX}${name}`;
}

/**
 * 저장된 `icon` 값이 **logos 전체의 아이콘을 가리키는가** — 가리키면 그 logos 이름.
 *
 * 표를 보지 않는다(표는 늦게 온다) — 모양만 본다. 표에 그 이름이 있는지는 [`logosGlyph`] 가
 * 표가 온 뒤에 가린다.
 */
export function logosNameOf(icon: string | null | undefined): string | null {
  const raw = icon?.trim();
  const head = `${ICON_PREFIX}${LOGOS_PREFIX}`;
  if (!raw || !raw.startsWith(head)) return null;
  const name = raw.slice(head.length);
  return name === "" ? null : name;
}

/** 그리는 데 드는 두 가지 — 큐레이션 로고(`GeneratedIcon`)와 logos 전체가 함께 쓰는 모양 */
export interface IconGlyph {
  viewBox: string;
  body: string;
}

/** 통째 표(logos · lucide)에서 이름 하나를 푼다 (별칭이면 지금 이름으로). 없으면 `null` */
export function setGlyph(set: IconSetData, name: string): IconGlyph | null {
  const entry = Object.hasOwn(set.icons, name)
    ? set.icons[name]
    : Object.hasOwn(set.aliases, name)
      ? set.icons[set.aliases[name]]
      : undefined;
  return entry ? { viewBox: entry.v ?? set.viewBox, body: entry.b } : null;
}

/** logos 표에서 이름 하나를 푼다 — [`setGlyph`] 그대로 */
export const logosGlyph = setGlyph;

/** 고르개 격자의 한 칸 — 저장될 값과 툴팁 */
export interface IconHit {
  /** 저장 형식 그대로 (`svg:ubuntu` · `svg:logos:mongodb-icon`) */
  ref: string;
  /** 툴팁·칸에 보이는 글자 — 큐레이션은 라벨, logos 는 이름 그대로 */
  label: string;
}

/**
 * 가로로 긴 **글씨 로고**(워드마크)인가 — 폭이 높이의 1.6배를 넘으면.
 *
 * logos 에는 같은 브랜드가 글씨(`mongodb`, 512×135)와 표장(`mongodb-icon`, 정사각) 두 벌로 있는
 * 일이 흔하다. 글씨 쪽은 14px 정사각 칸에 넣으면 **실오라기 한 줄**이 되어 목록에서 알아볼 수
 * 없다 — 그래서 검색은 같은 등급 안에서 정사각 쪽을 앞에 세운다(뺀 것은 아니다, 뒤로 갈 뿐).
 */
export function isWordmark(viewBox: string): boolean {
  const [, , w, h] = viewBox.split(/\s+/).map(Number);
  return w > 0 && h > 0 && w / h > 1.6;
}

/** 검색이 한 번에 그리는 칸 수의 상한 — 2,000개를 한꺼번에 SVG 로 그리지 않는다 */
export const ICON_SEARCH_CAP = 200;

/**
 * 검색어를 통째 표의 이름 모양으로 — 소문자, 앞의 `svg:`·`<묶음>:` 는 떼고, 공백은 `-`.
 * 손버릇(`svg:logos:mongo` · `cloud run`)이 그대로 먹게 한다.
 */
function setQuery(query: string, setPrefix: string): string {
  let q = query.trim().toLowerCase();
  if (q.startsWith(ICON_PREFIX)) q = q.slice(ICON_PREFIX.length);
  if (q.startsWith(setPrefix)) q = q.slice(setPrefix.length);
  return q.replace(/\s+/g, "-");
}

/**
 * 통째 표 하나에서 `q` 에 걸리는 이름들 — logos · lucide 가 함께 쓰는 규칙
 * ([`searchIcons`] 의 "logos 쪽 규칙"): 이름이나 `-` 조각의 접두사가 먼저, 중간에 든 것이 나중,
 * 각 등급 안에서 정사각이 가로 글씨보다 먼저(lucide 는 전부 24×24 라 순서가 그대로다), 그 안은
 * 표의 차례. 숨김과 `skip` 은 뺀다.
 */
function matchSetNames(q: string, set: IconSetData, skip: ReadonlySet<string> = new Set()): string[] {
  // 네 칸: [접두사·정사각, 접두사·가로 글씨, 포함·정사각, 포함·가로 글씨]
  const tiers: string[][] = [[], [], [], []];
  for (const [name, entry] of Object.entries(set.icons)) {
    if (entry.x || skip.has(name)) continue;
    const wide = isWordmark(entry.v ?? set.viewBox) ? 1 : 0;
    if (name.startsWith(q) || name.split("-").some((part) => part.startsWith(q))) tiers[wide].push(name);
    else if (name.includes(q)) tiers[2 + wide].push(name);
  }
  return tiers.flat();
}

/**
 * **고르개의 검색 (logos 전체까지)** — 큐레이션 먼저([`matchIcons`] 그대로), 그 뒤에 logos.
 *
 * logos 쪽 규칙:
 *
 * - 보는 곳은 **이름**과 이름을 `-` 로 가른 **조각**이다 — `tux` 가 `linux-tux` 를, `postgres`
 *   가 `postgresql` 을(접두사) 찾는다. 친 글자의 공백은 `-` 로 읽는다 (`google cloud`).
 * - 이름이나 조각의 접두사가 먼저, 이름 중간에 든 것이 나중. 각 등급 안에서 **정사각 표장이
 *   가로 글씨 로고보다 먼저**([`isWordmark`]) — `mongodb` 를 치면 `mongodb-icon` 이 첫 칸(Enter)이다.
 *   그 안은 표의 차례(알파벳).
 * - 큐레이션이 이미 가진 로고(`source` 가 `logos:<그 이름>`)는 **뺀다** — 같은 그림이 두 칸에
 *   뜨면 어느 쪽을 골라도 되는지 헷갈리고, 큐레이션 이름 쪽이 저장 형식으로 더 오래 산다.
 * - 숨김 아이콘은 뺀다(옛 이름 풀이에만 산다).
 *
 * 돌려주는 `total` 은 **상한 전의 개수**다 — 고르개가 "N개 더 — 더 좁혀 보세요" 를 말한다.
 * 빈 글자는 큐레이션 전부(격자의 평소 모습)이고, `logos` 가 아직 없으면(불러오는 중) 큐레이션만.
 */
export function searchIcons(
  query: string,
  logos: LogosSet | null,
  cap: number = ICON_SEARCH_CAP,
  table: Readonly<Record<string, GeneratedIcon>> = GENERATED_ICONS,
): { hits: IconHit[]; total: number } {
  const curated: IconHit[] = matchIcons(query, table).map((name) => ({
    ref: iconRef(name),
    label: table[name].label,
  }));

  const q = setQuery(query, LOGOS_PREFIX);
  const full: IconHit[] = [];
  if (q !== "" && logos) {
    const taken = new Set(
      Object.values(table)
        .map((i) => i.source)
        .filter((s) => s.startsWith(LOGOS_PREFIX))
        .map((s) => s.slice(LOGOS_PREFIX.length)),
    );
    for (const name of matchSetNames(q, logos, taken)) full.push({ ref: logosRef(name), label: name });
  }

  const all = [...curated, ...full];
  return { hits: all.slice(0, Math.max(0, cap)), total: all.length };
}

// ---------------------------------------------------------------------------
// **lucide 전체** — 고르개의 "기본" 칸 (docs/log/2026-09-29-logos-full-icons.md 의 Lucide 절).
//
// 브랜드가 아닌 **일반 사물**의 단색 선 아이콘 1,909개 (ISC). 표는 logos 와 같은 모양
// (`host-icons-lucide.generated.json`)이고 같은 방식으로 늦게 받는다. 저장 형식은
// `svg:lucide:<이름>` — 큐레이션(`:` 없음)·logos(`logos:`)와 겹치지 않는다.
//
// 로고와 달리 **색이 없다**: 획이 `currentColor` 라 `HostIcon` 이 호스트 색(`color`)을 입히고,
// 없으면 그 자리의 글자색을 따른다. 굵기는 1.75 로 덮는다.
// ---------------------------------------------------------------------------

/** `svg:` 뒤에 붙는 lucide 전체의 표식 */
export const LUCIDE_PREFIX = "lucide:";

/** lucide 이름을 저장 형식으로 (`"database"` → `"svg:lucide:database"`) */
export function lucideRef(name: string): string {
  return `${ICON_PREFIX}${LUCIDE_PREFIX}${name}`;
}

/** 저장된 `icon` 값이 lucide 를 가리키면 그 이름 (모양만 본다 — [`logosNameOf`] 와 같은 규칙) */
export function lucideNameOf(icon: string | null | undefined): string | null {
  const raw = icon?.trim();
  const head = `${ICON_PREFIX}${LUCIDE_PREFIX}`;
  if (!raw || !raw.startsWith(head)) return null;
  const name = raw.slice(head.length);
  return name === "" ? null : name;
}

/**
 * "기본" 칸의 빈 격자 — 서버를 다루는 사람이 호스트에 붙일 법한 스물네 개. 순서가 곧 격자의
 * 순서다 (장비 → 자리 → 성격 → 도구). 이름은 표에 **실제로 있는**(별칭·숨김이 아닌) 것만 —
 * 유닛 테스트가 진짜 표로 확인한다.
 */
export const LUCIDE_FEATURED: readonly string[] = [
  "server",
  "database",
  "hard-drive",
  "cpu",
  "container",
  "box",
  "archive",
  "cloud",
  "router",
  "network",
  "wifi",
  "radio-tower",
  "globe",
  "monitor",
  "laptop",
  "house",
  "building",
  "flask-conical",
  "shield",
  "lock",
  "bug",
  "rocket",
  "terminal",
  "git-branch",
];

/**
 * **"기본" 칸의 검색** — lucide 전체에서 `q` 에 걸리는 것 (규칙은 logos 쪽과 같다 —
 * `matchSetNames`). 빈 글자는 [`LUCIDE_FEATURED`], 표가 아직이면 빈 결과다.
 * `total` 은 상한 전의 개수 ([`searchIcons`] 와 같다).
 */
export function searchLucide(
  query: string,
  lucide: IconSetData | null,
  cap: number = ICON_SEARCH_CAP,
): { hits: IconHit[]; total: number } {
  const q = setQuery(query, LUCIDE_PREFIX);
  const names = q === "" ? [...LUCIDE_FEATURED] : lucide ? matchSetNames(q, lucide) : [];
  const all = names.map((name) => ({ ref: lucideRef(name), label: name }));
  return { hits: all.slice(0, Math.max(0, cap)), total: all.length };
}

/**
 * 로고 마크업 안의 **내부 id 를 이 인스턴스만의 것으로** 바꾼다 (`id="g1"` · `url(#g1)`).
 *
 * 스물아홉 개 중 셋(Tux · Azure · Grafana)이 그라디언트를 쓰는데, 그 정의는 `id` 로 참조된다.
 * 같은 아이콘이 화면에 여럿 뜨면 **문서에 같은 id 가 여러 개** 생기고, 브라우저는 `url(#id)`
 * 를 문서에서 **처음 만난** 것으로 푼다. 그 첫 번째가 사라지는 순간(목록이 다시 그려지거나
 * 그 줄만 스크롤 밖으로 나가 지워지면) 남은 것들의 그라디언트가 통째로 풀려 **아이콘이
 * 검게 죽는다** — 재현하기 어렵고 원인을 찾기는 더 어려운 부류의 버그다.
 *
 * 그래서 그리는 쪽이 인스턴스마다 고유한 꼬리표를 붙인다. 순수 함수라 여기 둔다.
 */
export function uniquifyIds(body: string, uid: string): string {
  if (!body.includes('id="')) return body; // 대부분의 아이콘은 여기서 끝난다
  return body
    .replaceAll(/ id="([^"]+)"/g, (_m, id: string) => ` id="${id}-${uid}"`)
    .replaceAll(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${id}-${uid})`);
}

/**
 * **단색 칠의 오려낼 색** — 로고마다 "구멍" 으로 남길 칠(기본 흰색 · `--logo-mono-inverse` 에 더해). 나머지 칠은 전부
 * 잉크(`currentColor`)가 된다. 여러 톤이 겹친 로고만 적는다: PowerShell 의 `_`(진한 파랑) · Bash 의 초록 `$_` 막대 —
 * 안 적으면 바탕 면과 같은 잉크로 합쳐져 모양이 사라진다.
 */
const MONO_CUT_EXTRA: Readonly<Record<string, readonly string[]>> = {
  powershell: ["#2c5591"],
  bash: ["#3ab14a"],
};

const MONO_CUT_DEFAULT = new Set(["#fff", "#ffffff", "white", "var(--logo-mono-inverse)"]);

/**
 * 로고 몸통 → **한 가지 색의 실루엣**(2026-10-18 독 실행 단추 — 강조색 판 위에서 다색 로고가 묻히거나 튀었다).
 * `fill` · `stroke` 값을 잉크(`currentColor`)와 구멍(`var(--mono-cut, transparent)` — 그리는 쪽이 자기 판 색을 준다)
 * 둘로만 바꾼다. 그라디언트 칠도 잉크다. `none` 은 그대로. 그리는 SVG 는 `fill="currentColor"` 를 함께 단다
 * (칠 속성이 없는 도형의 기본 검정까지 잉크로). 순수 함수.
 */
export function monoBody(body: string, name: string | null = null): string {
  const extra = (name && MONO_CUT_EXTRA[name]) || [];
  return body.replaceAll(/\b(fill|stroke)="([^"]*)"/g, (m, attr: string, raw: string) => {
    const v = raw.trim().toLowerCase();
    if (v === "none") return m;
    const cut = MONO_CUT_DEFAULT.has(v) || extra.includes(v);
    return `${attr}="${cut ? "var(--mono-cut, transparent)" : "currentColor"}"`;
  });
}

// ---------------------------------------------------------------------------
// UI 글리프 — 화면이 **늘** 그리는 것들. 24×24 viewBox 안의 path 하나이고 색은
// `currentColor` 라, 부모가 정한 색을 그대로 입는다. 폴더·파일·링크·내보내기 손잡이는
// 2026-09-25 에 Lucide 선 아이콘(`ui-icons.generated.ts`)으로 옮겨 여기 남은 것은 기본 서버 랙
// 하나다 (docs/log/2026-09-25-duotone-glyphs.md).
//
// 인라인 SVG 인 이유가 그 한 줄이다: `<img>` 나 배경 이미지는 색을 물려받지 못한다.
// ---------------------------------------------------------------------------

/** UI 글리프의 공용 viewBox — 아래 상수들은 전부 이 안에 그려져 있다 */
export const UI_VIEWBOX = "0 0 24 24";

/**
 * 목록 줄 앞자리 글리프의 한 변(px). **`theme.css` 의 `--row-icon-size` 와 같은 값이어야
 * 한다** — SVG 의 `width`/`height` 속성에는 `var()` 를 쓸 수 없어 숫자가 한 번 더 필요하다
 * (`layout.ts` 의 `GAP` 이 `--gap` 과 짝을 이루는 것과 같은 사정이다).
 */
export const ROW_ICON_PX = 14;

/** 아이콘 보기(격자)의 큰 글리프 — `theme.css` 의 `--tile-icon-size` 와 같은 값 */
export const TILE_ICON_PX = 24;

/**
 * 새로 만든 폴더에 붙는 기본 아이콘.
 *
 * 장식이 아니라 **폴더가 존재하게 하는 값**이다 — 그룹 메타 항목은 아이콘이 비어 있지
 * 않을 때만 파일에 남고(`setGroupMeta` 주석), 호스트가 없는 폴더는 그 항목이 유일한
 * 존재 증거다. 마침 폴더 줄이 아이콘 없을 때 그리는 모양과 같은 글자라 화면은 그대로다.
 */
export const DEFAULT_FOLDER_ICON = "📁";

/**
 * 그룹 메타의 `icon` 이 **사용자가 손으로 고른** 값인가 — 맞으면 그 값, 아니면 `null`.
 *
 * `null` 이면 화면은 테마 색 SVG 폴더(`--folder`)를 그린다 (`HostIcon` 의 `fallback="folder"`).
 * 기본값(`📁`)을 "고른 것" 으로 치지 않는 이유가 여기 있다: 그 글자는 장식이 아니라 **폴더가
 * 존재하게 하는 표식**이라 폴더를 만들 때마다 자동으로 적힌다 (위 [`DEFAULT_FOLDER_ICON`]).
 * 그것까지 사용자 지정으로 읽으면 모든 폴더가 노란 이모지로 남아 테마를 따르는 폴더가 하나도
 * 없게 된다. 반대로 사람이 직접 `🚀`·`svg:docker` 를 골랐다면 그 뜻은 명확하므로 건드리지 않는다.
 *
 * 세션 타일·빵부스러기·명령 팔레트가 **같은 답**을 쓰도록 순수 함수로 여기 둔다 — 규칙이
 * 컴포넌트마다 흩어지면 한 곳만 고치는 사고가 난다.
 */
export function folderIcon(icon: string | null | undefined): string | null {
  const raw = icon?.trim();
  return raw && raw !== DEFAULT_FOLDER_ICON ? raw : null;
}

/**
 * 아이콘도 색도 없는 호스트의 **기본 표시** — 서버 랙 한 대.
 *
 * 컬러 로고 세트에는 "그냥 서버" 가 없다 (로고 묶음이라 브랜드뿐이다). 그런데 대부분의
 * 호스트는 아무것도 고르지 않은 채로 산다 — 그 자리가 비어 있으면 격자 보기에서 타일
 * 한가운데가 뚫려 보인다. 그래서 이 하나만 자체 도형으로 두고 **테마 색**을 입힌다
 * (골라 붙이는 로고가 아니라 "없음" 의 표시라, 앱의 색을 따르는 쪽이 맞다).
 */
export const SERVER_D =
  "M3.5 3.5h17A1.5 1.5 0 0 1 22 5v4a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 9V5a1.5 1.5 0 0 1 1.5-1.5zm2 2.1a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zM3.5 13.5h17A1.5 1.5 0 0 1 22 15v4a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 19v-4a1.5 1.5 0 0 1 1.5-1.5zm2 2.1a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z";

/** [`SERVER_D`] 는 구멍(LED)이 있어 evenodd 로 칠해야 한다 */
export const SERVER_RULE = "evenodd" as const;

/*
 * **`NEW_TAB_D` · `NEW_TAB_RULE` · `LAYOUT_D` 는 2026-09-15 에 지웠다.**
 *
 * `+` 메뉴의 "새 탭"·"레이아웃에서 새 탭" 두 줄이 유일한 호출부였고, 그 둘이 Lucide
 * (`new-tab` · `layout`)로 옮겨 가면서 남는 자리가 없어졌다. 특히 레이아웃은 **같은 말을 두
 * 그림으로** 그리고 있었다 — 상태바는 `layout-grid`, 여기는 손으로 딴 비대칭 3분할.
 * 이제 이름 하나가 두 자리를 함께 그린다 (docs/log/2026-09-15-lucide-ui-icons.md).
 *
 * 이 파일의 나머지 `*_D` 는 그대로다 — 파일 브라우저의 폴더·파일·링크·내보내기와
 * `SERVER_D`(호스트 폴백)는 아직 손으로 딴 도형이고, `Glyph` 가 그린다.
 */
