// 모델 고르기 목록의 순서 · 표시 글자 — 순수. 순서는 고정이다(고른 것을 맨 위로 올리지 않는다 — 고른 줄은 부르는 쪽의 ✓ 로만).
// 값(CLI 에 넘기는 글자 · 저장값)은 건드리지 않는다 — 라벨만.

/** 앞이 위. 가족(CLI)마다 따로 세고, 가족 사이는 이 표의 순서 */
const TIERS: readonly (readonly string[])[] = [
  ["fable", "opus", "sonnet", "haiku"],
  ["astra", "sol", "terra", "luna"],
];

/** 날짜 꼬리(`20250514` 등)는 버전이 아니다 */
const DATE_DIGITS = 8;

type Rank = { family: number; tier: number; version: number[] | null };

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

/** 없는 자리 = 0 — `6` 과 `6.0` 은 같다 */
function versionDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 목록에 없는 지금 값을 더하는 것은 부르는 쪽 몫(사이드 채팅 `sideChatModelChoices` · 프로듀서 채팅) */
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

/** 화면에 보이는 모델 이름 — 앱의 모든 자리가 이 함수 하나를 쓴다 */
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

/** 빈 값은 빈 글 — 부르는 쪽이 "기본" 글자를 고른다 */
export function effortLabel(effort: string): string {
  const e = effort.trim();
  return e.charAt(0).toUpperCase() + e.slice(1);
}
