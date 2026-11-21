/** 브라우저에게 한 번 물어보고 못 알아보면 검정 — 텍스트 칸의 값 자체는 그대로 산다. `document` 가 없으면 hex 두 형태만 안다 */
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
