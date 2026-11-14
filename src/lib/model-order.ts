// 모델 고르기 목록의 **순서 · 표시 글자**(2026-11-13) — 사이드 채팅 칩 메뉴 · 오케스트레이션 모델 칸이 함께 쓴다. **순수**
//
// 순서는 **고정**이다(2026-11-13 실기 — 고른 것을 맨 위로 올리지 않는다 · 고른 줄은 부르는 쪽의 ✓ 로만): (가족이 섞이면 가족 — Claude 먼저) → 별칭(버전 없음 = 최신을 가리킴)을 등급 순 →
// 숫자 버전 내림차순, 같은 버전 안에서는 성능 등급 순(Claude fable > opus > sonnet > haiku · Codex astra > sol > terra > luna).
// 예: opus-5-5 · sonnet-5-5 · haiku-5-5 · opus-5 · sonnet-5 …(버전 → 등급 — 2026-11-13 사용자 결정). 하이픈으로 쪼갠 숫자도
// 한 버전이다(`claude-opus-5-5` = 5.5 · 날짜 꼬리는 빼고). 등급을 모르는 것은 아는 것들 뒤에 원래 순서대로.
// 표시: `modelLabel` 하나(Claude 전체 id → `Opus 5.5` · 그 밖은 낱말마다 첫 글자 대문자 · `gpt` → `GPT`). **값(CLI 에 넘기는 글자 · 저장값)은 건드리지 않는다 — 라벨만.**

/** 등급 낱말 — 앞이 위. CLI(가족)마다 따로 세고, 가족 사이는 이 표의 순서(섞여 오면 Claude 가 앞) */
const TIERS: readonly (readonly string[])[] = [
  ["fable", "opus", "sonnet", "haiku"],
  ["astra", "sol", "terra", "luna"],
];

/** 날짜 꼬리(`20250514` 등)는 버전이 아니다 — 이 길이부터 숫자 조각을 뺀다 */
const DATE_DIGITS = 8;

type Rank = { family: number; tier: number; version: number[] | null };

/** 이름 하나의 등급 · 버전 — 모르는 등급이면 `null` */
function rankOf(model: string): Rank | null {
  // `opus[1m]` 같은 꼬리 괄호는 등급 · 버전과 무관하다
  const parts = model.toLowerCase().replace(/\[.*$/, "").split(/[-_:]/);
  let family = -1;
  let tier = -1;
  for (const p of parts) {
    for (let f = 0; f < TIERS.length && tier < 0; f++) {
      const i = TIERS[f].indexOf(p);
      if (i >= 0) {
        family = f;
        tier = i;
      }
    }
  }
  if (tier < 0) return null;
  const version: number[] = [];
  for (const p of parts) {
    if (!/^\d+(\.\d+)*$/.test(p) || p.length >= DATE_DIGITS) continue;
    for (const n of p.split(".")) version.push(Number(n));
  }
  return { family, tier, version: version.length > 0 ? version : null };
}

/** 버전 내림차순 비교(없는 자리 = 0 — `6` 과 `6.0` 은 같다) */
function versionDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 고르기 목록의 순서 — 가족 → 별칭(등급 순) → 버전 내림차순 → 등급, 모르는 것은 뒤에 원래 순서. 같은 자리끼리는 원래 순서(안정 정렬).
 * 지금 고른 값의 자리도 이 규칙대로다. 목록에 없는 지금 값을 더하는 것은 부르는 쪽 몫(사이드 채팅 `sideChatModelChoices` · 프로듀서 채팅)
 */
export function orderModels(models: readonly string[]): string[] {
  const ranked = models.map((m, i) => ({ m, i, r: rankOf(m) }));
  ranked.sort((a, b) => {
    if (a.r && !b.r) return -1;
    if (!a.r && b.r) return 1;
    if (a.r && b.r) {
      if (a.r.family !== b.r.family) return a.r.family - b.r.family;
      if (!a.r.version && b.r.version) return -1;
      if (a.r.version && !b.r.version) return 1;
      if (a.r.version && b.r.version) {
        const d = versionDesc(a.r.version, b.r.version);
        if (d !== 0) return d;
      }
      if (a.r.tier !== b.r.tier) return a.r.tier - b.r.tier;
    }
    return a.i - b.i;
  });
  return ranked.map((x) => x.m);
}

/**
 * **화면에 보이는 모델 이름 — 앱의 모든 자리가 이 함수 하나를 쓴다**(2026-11-15 사용자 결정). 값은 그대로, 보이는 글자만:
 * - Claude 전체 id(`claude-` 머리) → 등급 + 버전: `claude-opus-5-5` → `Opus 5.5` · `claude-sonnet-4-5-20250929` → `Sonnet 4.5`
 *   (날짜 꼬리 · `[1m]` 같은 꼬리 괄호 버림). 등급 낱말이 없으면 아래 낱말 규칙.
 * - 그 밖: 하이픈으로 나뉜 낱말마다 첫 글자만 대문자(나머지 글자는 그대로 · 숫자 낱말은 그대로), 머리 낱말 `gpt` 는 `GPT`:
 *   `gpt-6.1-sol` → `GPT-6.1-Sol` · `codex-auto-review` → `Codex-Auto-Review` · `opus` → `Opus` · `default` → `Default`.
 * 앞뒤 공백은 뗀다 · 빈 값은 빈 글.
 */
export function modelLabel(model: string): string {
  const m = model.trim();
  if (/^claude-/i.test(m)) {
    const parts = m.replace(/\[.*$/, "").slice("claude-".length).split(/[-_]/).filter((p) => p !== "");
    const tier = parts.find((p) => /^[a-z]+$/i.test(p));
    if (tier) {
      const version = parts.filter((p) => /^\d+(\.\d+)*$/.test(p) && p.length < DATE_DIGITS);
      const name = tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
      return version.length > 0 ? `${name} ${version.join(".")}` : name;
    }
  }
  return m
    .split("-")
    .map((w, i) => (i === 0 && w.toLowerCase() === "gpt" ? "GPT" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("-");
}

/** 화면에 보이는 Effort 단계 — 첫 글자만 대문자(`high` → `High`). 빈 값은 빈 글(부르는 쪽이 "기본" 글자를 고른다) */
export function effortLabel(effort: string): string {
  const e = effort.trim();
  return e.charAt(0).toUpperCase() + e.slice(1);
}
