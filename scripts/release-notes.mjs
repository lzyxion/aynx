#!/usr/bin/env node
// CHANGELOG.md 의 한 버전 칸 → 릴리스 노트 두 가지(2026-11-12). 의존성 없음 — 릴리스 워크플로와 로컬이 같은 코드를 돈다.
//
//   node scripts/release-notes.mjs <version> --check       칸이 있고 `### What's new` 목록이 비어 있지 않은지만 본다
//   node scripts/release-notes.mjs <version> <out-dir>     <out-dir>/changes-page.md · changes-app.md 를 쓴다
//
// 칸 모양(CHANGELOG.md 머리말과 같은 규칙):
//   ## [0.1.3] - 2026-11-20
//   (선택) 설치 전 안내 문단 — 릴리스 페이지에만
//   ### What's new
//   - …                           — 릴리스 페이지와 앱 업데이트 카드(`latest.json` 의 notes) 둘 다
//
// changes-page.md = 안내 문단 + "## What's new" + 목록(워크플로가 뒤에 설치 표 · SHA-256 을 붙인다)
// changes-app.md  = "## What's new" + 목록

import fs from "node:fs";
import path from "node:path";

const WHATS_NEW = /^###\s+What's new\s*$/m;

/** 버전 칸을 찾아 { intro, list } 로 — 없거나 비었으면 이유를 던진다 */
export function sectionOf(changelog, version) {
  const text = changelog.replace(/\r\n/g, "\n");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^## \\[${escaped}\\][^\\n]*$`, "m");
  const m = head.exec(text);
  if (!m) throw new Error(`CHANGELOG.md has no "## [${version}]" section — write it before tagging`);
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^## \[|^\[[^\]]+\]:\s/m);
  const body = (next < 0 ? rest : rest.slice(0, next)).trim();
  const wn = WHATS_NEW.exec(body);
  if (!wn) throw new Error(`CHANGELOG.md [${version}] has no "### What's new" heading`);
  const intro = body.slice(0, wn.index).trim();
  const list = body.slice(wn.index + wn[0].length).trim();
  if (!/^\s*[-*]\s+\S/m.test(list)) throw new Error(`CHANGELOG.md [${version}] "### What's new" has no items`);
  if (/_\(write|TODO|TBD/i.test(list)) throw new Error(`CHANGELOG.md [${version}] still has placeholder text`);
  return { intro, list };
}

function main() {
  const [version, target] = process.argv.slice(2);
  if (!version || !target) {
    console.error("usage: node scripts/release-notes.mjs <version> (--check | <out-dir>)");
    process.exit(2);
  }
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
  let section;
  try {
    section = sectionOf(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version);
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
  if (target === "--check") {
    console.log(`CHANGELOG.md [${version}] ok — ${section.list.split("\n").filter((l) => /^\s*[-*]\s/.test(l)).length} lines in What's new`);
    return;
  }
  fs.mkdirSync(target, { recursive: true });
  const app = `## What's new\n\n${section.list}\n`;
  const page = (section.intro ? `${section.intro}\n\n` : "") + app;
  fs.writeFileSync(path.join(target, "changes-page.md"), page);
  fs.writeFileSync(path.join(target, "changes-app.md"), app);
  console.log(`wrote ${target}/changes-page.md · changes-app.md`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) main();
