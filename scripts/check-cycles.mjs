// ---------------------------------------------------------------------------
// `src/` 의 **정적 import 그래프에서 순환을 찾는다** (docs/log/2026-09-05-refactor-structure.md).
//
//     npm run check:cycles              값 그래프 (`import type` 은 세지 않는다)
//     npm run check:cycles -- --with-types   타입까지 포함한 그래프
//
// 왜 도구를 들이지 않았나: 여기서 필요한 것은 "모듈 A 와 B 가 서로를 값으로 부르는가" 한
// 가지뿐이고, 그 답은 정규식 한 줄과 Tarjan 한 판이면 나온다. madge 를 의존성에 더하면
// 이 질문 하나를 위해 설치·버전·설정이 따라온다.
//
// **`import type` 을 기본으로 빼는 이유**: 그 구문은 컴파일에서 지워져 런타임 모듈 그래프에
// 남지 않는다. 즉 타입만 주고받는 두 파일은 서로를 부르지 않는다. 다만 "타입으로도 얽히지
// 않았는가" 를 묻고 싶을 때가 있어 `--with-types` 를 남겨 둔다 (지금은 둘 다 0 이다).
//
// 재수출(`export … from`)도 import 와 같은 간선으로 센다 — 배럴이 순환을 숨기지 않게.
// 한계는 정직하게 적어 둔다: 동적 `import()`·재수출 체인의 실제 사용 여부는 보지 않고,
// `$lib/…`·상대 경로만 푼다 (외부 패키지는 그래프에 넣지 않는다).
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = "src";
const WITH_TYPES = process.argv.includes("--with-types");

/** `src/` 아래의 모든 `.ts`·`.js`·`.svelte` (경로는 `/` 로 통일 — 윈도우에서도 같은 글자) */
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|js|svelte)$/.test(p)) files.push(p.replaceAll("\\", "/"));
  }
})(ROOT);

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * import 명세를 실제 파일로 푼다. `$lib` 는 `src/lib`, 상대 경로는 그대로.
 *
 * 후보를 여럿 두는 이유는 이 저장소가 **한 모듈을 세 가지 이름으로** 부르기 때문이다:
 * `$lib/x`(확장자 없음) · `$lib/x.svelte.js`(룬 모듈을 `.js` 로 — SvelteKit 규칙) ·
 * `$lib/X.svelte`(컴포넌트).
 */
function resolveSpec(spec, from) {
  let base;
  if (spec.startsWith("$lib/")) base = resolve("src/lib", spec.slice(5));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(from), spec);
  else return null; // 외부 패키지

  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    `${base}.svelte`,
    `${base}.svelte.ts`,
    join(base, "index.ts"),
  ];
  for (const c of candidates) if (isFile(c)) return relative(".", c).replaceAll("\\", "/");
  return null;
}

const IMPORT =
  /(?:^|\n)\s*import\s+([\s\S]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
/**
 * 재수출(`export {…} from` · `export * from` · `export * as x from`) — 배럴 파일은 이것으로만
 * 이웃을 부르므로 빼면 배럴을 거친 순환이 보이지 않는다. 절은 `import` 와 같은 자리(m[1])에
 * 담아 **같은 타입 규칙**을 탄다(`export type {…}` · 중괄호 안이 전부 `type` 이면 값 그래프에서 뺀다).
 * 절을 중괄호·`*` 로 좁힌 이유: `export const x = …` 뒤의 먼 `from` 까지 게으르게 삼키지 않게.
 */
const EXPORT_FROM =
  /(?:^|\n)\s*export\s+((?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?))\s*from\s*["']([^"']+)["']/g;

/** 파일 → 그 파일이 (값으로) 부르는 파일들 */
const graph = new Map();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const deps = new Set();
  for (const m of [...text.matchAll(IMPORT), ...text.matchAll(EXPORT_FROM)]) {
    const clause = m[1] ?? "";
    const spec = m[2] ?? m[3];
    if (!WITH_TYPES) {
      if (/^\s*type[\s{]/.test(clause)) continue; // `import type …`
      // `import { type A, type B }` — 중괄호 안이 전부 타입이면 값 그래프에서는 없는 변이다.
      const values = clause.replace(/\{[\s\S]*\}/, (b) =>
        `{${b
          .slice(1, -1)
          .split(",")
          .filter((one) => !/^\s*type\s/.test(one))
          .join(",")}}`,
      );
      if (/^\s*\{\s*\}\s*$/.test(values)) continue;
    }
    const target = resolveSpec(spec, f);
    if (target && target !== f) deps.add(target);
  }
  graph.set(f, [...deps]);
}

// Tarjan 의 강연결요소 — 크기 2 이상(또는 자기 자신을 부르는 것)이 곧 순환이다.
let counter = 0;
const index = new Map();
const low = new Map();
const onStack = new Set();
const stack = [];
const cycles = [];
function strong(v) {
  index.set(v, counter);
  low.set(v, counter);
  counter += 1;
  stack.push(v);
  onStack.add(v);
  for (const w of graph.get(v) ?? []) {
    if (!index.has(w)) {
      strong(w);
      low.set(v, Math.min(low.get(v), low.get(w)));
    } else if (onStack.has(w)) {
      low.set(v, Math.min(low.get(v), index.get(w)));
    }
  }
  if (low.get(v) !== index.get(v)) return;
  const group = [];
  let w;
  do {
    w = stack.pop();
    onStack.delete(w);
    group.push(w);
  } while (w !== v);
  if (group.length > 1 || (graph.get(v) ?? []).includes(v)) cycles.push(group);
}
for (const f of graph.keys()) if (!index.has(f)) strong(f);

console.log(`${files.length} files · ${WITH_TYPES ? "값+타입" : "값"} 그래프`);
if (cycles.length === 0) console.log("순환 0");
else for (const c of cycles) console.log(`순환: ${c.join(" ↔ ")}`);
process.exit(cycles.length === 0 ? 0 : 1);
