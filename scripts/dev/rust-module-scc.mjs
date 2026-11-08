#!/usr/bin/env node
// Rust 모듈 의존 그래프의 강결합 요소(SCC) 측정 — src-tauri/src/**/*.rs 를 훑어
// `crate::<모듈>` 참조(및 `use crate::{a, b}` 묶음)를 간선으로 모으고, Tarjan 으로 SCC 를 구한다.
// 주석(줄·문서·블록)과 `#[cfg(test)] mod … { … }` 블록은 빼고 센다 — 테스트만의 의존은 층을 가르지 않는다.
//
//   node scripts/dev/rust-module-scc.mjs            # 가장 큰 SCC 크기와 구성원
//   node scripts/dev/rust-module-scc.mjs --edges    # 모듈별 간선 목록까지
//   node scripts/dev/rust-module-scc.mjs --root <dir>  # 다른 소스 루트(기본 src-tauri/src)
//
// 의존성 없음(Node 18+).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const showEdges = args.includes("--edges");
const rootIdx = args.indexOf("--root");
const here = dirname(fileURLToPath(import.meta.url));
const root = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : resolve(here, "../../src-tauri/src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    // 하위 폴더의 tests.rs·*_tests.rs 는 `#[cfg(test)] mod tests;` 로 뺀 테스트 파일 — 인라인 블록처럼 뺀다.
    else if (name.endsWith(".rs") && !(dir !== root && /(^|_)tests\.rs$/.test(name))) out.push(p);
  }
  return out;
}

/** 파일 경로 → 최상위 모듈 이름. lib.rs/main.rs 는 크레이트 뿌리. ssh/core.rs → ssh. */
function moduleOf(file) {
  const rel = relative(root, file).split(sep);
  const first = rel[0].replace(/\.rs$/, "");
  return first;
}

/** 주석을 지우고 문자열·문자 리터럴은 빈 껍데기로 바꾼다(그 안의 `crate::`·`//` 오인 방지). */
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") { depth++; i += 2; }
        else if (src[i] === "*" && src[i + 1] === "/") { depth--; i += 2; }
        else { if (src[i] === "\n") out += "\n"; i++; }
      }
      continue;
    }
    // 원시 문자열 r"..", r#".."#, br#".."#
    const raw = /^b?r(#*)"/.exec(src.slice(i, i + 40));
    if (raw && !/[A-Za-z0-9_]/.test(src[i - 1] ?? "")) {
      const hashes = raw[1];
      const end = '"' + hashes;
      let j = i + raw[0].length;
      const k = src.indexOf(end, j);
      j = k < 0 ? n : k + end.length;
      out += '""';
      i = j;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && src[i] !== '"') { if (src[i] === "\\") i++; i++; }
      i++;
      out += '""';
      continue;
    }
    if (c === "'") {
      // 문자 리터럴 vs 수명: 'x' · '\n' · '\u{..}' 는 리터럴
      const m = /^'(\\u\{[0-9a-fA-F]+\}|\\.|[^\\'])'/u.exec(src.slice(i, i + 12));
      if (m) { out += "' '"; i += m[0].length; continue; }
      out += c; i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** `#[cfg(test)]` 뒤에 오는 `mod 이름 { … }` 블록을 지운다. */
function stripTestMods(src) {
  const re = /#\[cfg\(test\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*([{;])/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += src.slice(last, m.index);
    if (m[1] === ";") { last = re.lastIndex; continue; }
    let depth = 1;
    let j = re.lastIndex;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    last = j;
    re.lastIndex = j;
  }
  return out + src.slice(last);
}

/** `use crate::{a, b::c, d::{e}}` 의 최상위 이름들. */
function groupHeads(body) {
  const heads = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0 && ch === ",") { heads.push(cur); cur = ""; continue; }
    cur += ch;
  }
  heads.push(cur);
  return heads
    .map((h) => /^\s*([A-Za-z_]\w*)/.exec(h)?.[1])
    .filter(Boolean);
}

const files = walk(root);
const modules = new Set(files.map(moduleOf).filter((m) => m !== "lib" && m !== "main"));
const edges = new Map();
for (const m of modules) edges.set(m, new Set());

for (const f of files) {
  const from = moduleOf(f);
  if (!modules.has(from)) continue;
  const code = stripTestMods(stripCommentsAndStrings(readFileSync(f, "utf8")));
  const add = (to) => { if (to !== from && modules.has(to)) edges.get(from).add(to); };
  for (const m of code.matchAll(/\bcrate\s*::\s*([A-Za-z_]\w*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bcrate\s*::\s*\{/g)) {
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    while (j < code.length && depth > 0) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}") depth--;
      j++;
    }
    for (const h of groupHeads(code.slice(start, j - 1))) add(h);
  }
}

// Tarjan
let index = 0;
const idx = new Map();
const low = new Map();
const onStack = new Set();
const stack = [];
const sccs = [];
function strong(v) {
  idx.set(v, index);
  low.set(v, index);
  index++;
  stack.push(v);
  onStack.add(v);
  for (const w of edges.get(v)) {
    if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
  }
  if (low.get(v) === idx.get(v)) {
    const comp = [];
    let w;
    do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
    sccs.push(comp.sort());
  }
}
for (const v of [...modules].sort()) if (!idx.has(v)) strong(v);

sccs.sort((a, b) => b.length - a.length);
const big = sccs.filter((c) => c.length > 1);
console.log(`modules: ${modules.size}  edges: ${[...edges.values()].reduce((s, e) => s + e.size, 0)}`);
console.log(`largest SCC: ${sccs[0]?.length ?? 0}`);
console.log(`  ${sccs[0]?.join(", ") ?? ""}`);
if (big.length > 1) {
  console.log(`other SCCs (>1):`);
  for (const c of big.slice(1)) console.log(`  [${c.length}] ${c.join(", ")}`);
}
if (showEdges) {
  console.log("\nedges:");
  for (const m of [...modules].sort()) console.log(`  ${m} -> ${[...edges.get(m)].sort().join(", ")}`);
}
