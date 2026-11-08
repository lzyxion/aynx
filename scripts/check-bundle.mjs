// ---------------------------------------------------------------------------
// 릴리스 번들(`build/**/*.js`)에서 **선언 없이 대입되는 식별자**를 찾는다
// (docs/log/2026-10-14-vi-freeze-decrqm.md).
//
//     npm run build && npm run check:bundle      기본 대상은 `build/`
//     node scripts/check-bundle.mjs <폴더>        다른 폴더를 볼 때
//
// 왜 있나: esbuild 가 es2020 으로 압축하며 `||=` 를 낮추다 xterm `requestMode` 의 `let` 을
// 떨어뜨렸다. 남은 것은 `(s={})` 처럼 **어디에도 선언이 없는 이름에 대한 대입** — strict ESM 에서는
// 그 줄이 ReferenceError 를 던지고 타일이 멈췄다. dev 빌드는 압축하지 않아 멀쩡했으므로 이 모양은
// 릴리스 번들을 직접 읽어야만 보인다.
//
// 하는 일: acorn 으로 파싱해 스코프 나무를 세우고(함수 = var·매개변수·함수 선언 끌어올림,
// 블록·for·switch·static 블록 = let·const·class, 그 밖에 catch 매개변수·이름 있는 함수/클래스 식·
// import), 대입·증감·for-in/of 의 대상 식별자가 스코프 사슬 어디에서도 풀리지 않으면 보고한다.
//
// 한계는 정직하게 적어 둔다: **선언 없는 읽기**(`x + 1`)는 보지 않는다 — 번들에는 `window`·
// `document` 같은 진짜 전역 읽기가 가득해 가려낼 수 없다. 대입이 아닌 다른 의미 변형(변환기가
// 식 순서·this 를 바꾸는 버그 등)도 이 검사 밖이다. `with`·`eval` 은 셈하지 않는다(번들에 없다).
//
// 적중이 하나라도 있거나 파싱에 실패한 파일이 있으면 exit 1.
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";

/** @typedef {{ name: string, at: number, snippet: string }} Hit */

class Scope {
  /** @param {Scope | null} parent @param {boolean} isFn */
  constructor(parent, isFn) {
    this.parent = parent;
    this.isFn = isFn;
    /** @type {Set<string>} */
    this.names = new Set();
  }
  /** `var`·함수 선언이 끌어올려지는 가장 가까운 함수(또는 모듈) 스코프 */
  fn() {
    /** @type {Scope} */
    let s = this;
    while (!s.isFn && s.parent) s = s.parent;
    return s;
  }
  /** @param {string} n */
  has(n) {
    /** @type {Scope | null} */
    let s = this;
    for (; s; s = s.parent) if (s.names.has(n)) return true;
    return false;
  }
}

/**
 * 구조 분해 패턴에서 묶이는 이름들. 멤버 식(`a.b = …`)은 이름을 묶지 않으므로 빈 목록.
 * @param {any} p @param {string[]} [out] @returns {string[]}
 */
function patternNames(p, out = []) {
  if (!p) return out;
  switch (p.type) {
    case "Identifier":
      out.push(p.name);
      break;
    case "ObjectPattern":
      for (const q of p.properties) patternNames(q.type === "RestElement" ? q.argument : q.value, out);
      break;
    case "ArrayPattern":
      for (const q of p.elements) patternNames(q, out);
      break;
    case "RestElement":
      patternNames(p.argument, out);
      break;
    case "AssignmentPattern":
      patternNames(p.left, out);
      break;
  }
  return out;
}

const BLOCK_SCOPES = new Set(["BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement"]);

/**
 * 자식 노드를 차례로 돈다(`type` 이 있는 것만 노드로 본다).
 * @param {any} node @param {(child: any) => void} visit
 */
function eachChild(node, visit) {
  for (const k of Object.keys(node)) {
    if (k === "type" || k === "start" || k === "end") continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") visit(c);
    } else if (v && typeof v.type === "string") visit(v);
  }
}

/**
 * ES 모듈 소스 하나에서 선언 없는 대입을 찾는다. 파싱에 실패하면 acorn 의 SyntaxError 를 그대로 던진다.
 * @param {string} src
 * @returns {Hit[]}
 */
export function scanSource(src) {
  const ast = parse(src, { ecmaVersion: "latest", sourceType: "module" });
  /** @type {Map<any, Scope>} */
  const scopeOf = new Map();

  // 1차: 노드마다 스코프를 정하고 선언을 올린다(var·함수 선언은 함수 스코프로). 2차가 나무
  // 전체를 본 뒤에 돌므로 끌어올림 순서는 신경 쓰지 않아도 된다.
  /** @param {any} node @param {Scope} scope */
  function build(node, scope) {
    let s = scope;
    if (/Function/.test(node.type)) {
      s = new Scope(scope, true);
      if (node.type === "FunctionExpression" && node.id) s.names.add(node.id.name);
      for (const p of node.params) for (const n of patternNames(p)) s.names.add(n);
      if (node.type === "FunctionDeclaration" && node.id) scope.fn().names.add(node.id.name);
    } else if (BLOCK_SCOPES.has(node.type)) {
      s = new Scope(scope, false);
    } else if (node.type === "StaticBlock") {
      s = new Scope(scope, true);
    } else if (node.type === "CatchClause") {
      s = new Scope(scope, false);
      for (const n of patternNames(node.param)) s.names.add(n);
    } else if (node.type === "ClassDeclaration" && node.id) {
      scope.names.add(node.id.name);
    } else if (node.type === "ClassExpression" && node.id) {
      s = new Scope(scope, false);
      s.names.add(node.id.name);
    } else if (node.type === "VariableDeclaration") {
      const target = node.kind === "var" ? scope.fn() : scope;
      for (const d of node.declarations) for (const n of patternNames(d.id)) target.names.add(n);
    } else if (node.type === "ImportDeclaration") {
      for (const sp of node.specifiers) scope.names.add(sp.local.name);
    }
    scopeOf.set(node, s);
    eachChild(node, (c) => build(c, s));
  }

  // 2차: 대입·증감·for-in/of 대상 식별자가 스코프 사슬 어디에도 없으면 적중.
  /** @type {Hit[]} */
  const hits = [];
  /** @param {any} node @param {Scope} scope */
  function check(node, scope) {
    const s = scopeOf.get(node) ?? scope;
    /** @type {string[]} */
    const targets = [];
    if (node.type === "AssignmentExpression") targets.push(...patternNames(node.left));
    if (node.type === "UpdateExpression" && node.argument.type === "Identifier") targets.push(node.argument.name);
    if ((node.type === "ForInStatement" || node.type === "ForOfStatement") && node.left.type !== "VariableDeclaration") {
      targets.push(...patternNames(node.left));
    }
    for (const name of targets) {
      if (!s.has(name)) {
        const snippet = src.slice(Math.max(0, node.start - 80), node.end + 40).replace(/\s+/g, " ");
        hits.push({ name, at: node.start, snippet });
      }
    }
    eachChild(node, (c) => check(c, s));
  }

  const top = new Scope(null, true);
  build(ast, top);
  check(ast, top);
  return hits;
}

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}

function main() {
  const dir = resolve(process.argv[2] ?? "build");
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    // 없음 — 아래에서 안내한다
  }
  if (!isDir) {
    console.error(`check:bundle: ${relative(process.cwd(), dir) || dir} 폴더가 없다 — 먼저 npm run build 를 돌려라 (run npm run build first).`);
    process.exit(1);
  }

  const started = performance.now();
  let files = 0;
  let bytes = 0;
  /** @type {(Hit & { file: string })[]} */
  const hits = [];
  /** @type {{ file: string, message: string }[]} */
  const failures = [];
  for (const f of jsFiles(dir)) {
    const file = relative(dir, f).replaceAll("\\", "/");
    const src = readFileSync(f, "utf8");
    files++;
    bytes += src.length;
    try {
      for (const h of scanSource(src)) hits.push({ file, ...h });
    } catch (e) {
      failures.push({ file, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const ms = Math.round(performance.now() - started);

  for (const f of failures) console.error(`PARSE FAIL ${f.file}: ${f.message}`);
  for (const h of hits) console.error(`- ${h.file} @${h.at} \`${h.name}\`  …${h.snippet}…`);
  const ok = hits.length === 0 && failures.length === 0;
  console.log(
    `check:bundle: ${ok ? "ok" : "FAIL"} — 파일 ${files}개 · ${(bytes / 1e6).toFixed(1)} MB · ` +
      `선언 없는 대입 ${hits.length} · 파싱 실패 ${failures.length} · ${ms} ms`,
  );
  if (!ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
