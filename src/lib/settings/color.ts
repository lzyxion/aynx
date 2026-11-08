/**
 * 설정 화면의 색 선택기가 쓰는 한 가지 변환 — 임의의 CSS 색 → `#rrggbb`.
 *
 * 앱 테마 칸(`AppThemeSection`)과 트리거 색 칸(`TriggersSection`) 둘이 쓴다. 두 화면이
 * 같은 규칙을 써야 하는 자리라 컴포넌트 밖에 둔다.
 */

/**
 * 임의의 CSS 색을 `<input type="color">` 가 받아들이는 `#rrggbb` 로 만든다.
 *
 * 텍스트 칸에는 `tomato`·`rgb(…)` 같은 값도 적을 수 있는데(앱은 색 문자열을 해석하지 않는다),
 * 색 선택기는 6자리 hex 만 받는다. 브라우저에게 한 번 물어보고 못 알아보면 검정으로 둔다 —
 * 그래도 텍스트 칸의 값 자체는 그대로 살아 있다.
 *
 * `document` 가 없는 곳(테스트·SSR)에서는 hex 두 형태만 알아보고 나머지는 검정이다.
 * 브라우저에게 물어보는 길이 없기 때문이지, 값을 버리는 것이 아니다.
 */
export function toHex(css: string): string {
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(css)) {
    return `#${[...css.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  }
  if (typeof document === "undefined" || css === "") return "#000000";

  const probe = document.createElement("span");
  probe.style.color = css;
  if (probe.style.color === "") return "#000000"; // 브라우저가 거부한 값
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();

  const parts = rgb.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return "#000000";
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"))
    .join("")}`;
}
