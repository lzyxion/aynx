/**
 * **락파일이 말하는 버전** — 생성 파일 머리에 적는 출처 줄을 결정론적으로 만드는 한 함수.
 *
 * ## 왜 있는가 (2026-09-17)
 *
 * 아이콘 생성기 둘(`gen-host-icons.mjs` · `gen-ui-icons.mjs`)은 생성 파일 머리에
 * `@iconify-json/logos v1.2.14 · 라이선스 CC0-1.0` 같은 출처 줄을 적는다. 그 버전을
 * `node_modules/<pkg>/package.json` 에서 읽고 있었는데, 그것은 **지금 설치된 것**이라
 * `^1.2.13` 같은 범위가 물어 오는 값이 때에 따라 다르다. 그래서 아이콘을 하나도 건드리지
 * 않고 `npm install` 만 새로 해도 생성 파일이 **머리 한 줄만 다른 채** 변경으로 뜬다 —
 * 아무도 의도하지 않은 diff 가 아이콘 작업 때마다 따라붙었다 (docs/internal/next.md 의 "락파일 드리프트").
 *
 * 그래서 **`package-lock.json` 의 확정 버전**을 읽는다. 그 파일은 커밋되어 있으므로 값이
 * 바뀌는 순간은 딱 하나 — 락파일 자체가 바뀔 때다. 그때는 출처 줄이 바뀌는 것이 **옳다**
 * (실제로 다른 판의 아이콘을 뽑아 온 것이므로).
 *
 * 락파일에 그 항목이 없으면(설치 트리가 특이하거나 워크스페이스를 거친 경우) 설치된
 * `package.json` 으로 떨어진다 — 출처 줄이 비는 것보다는 낫고, 그때는 드리프트가 나도
 * **원래 있던 자리로 돌아간 것**뿐이다.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 락파일은 한 번만 읽는다 (생성기 하나가 패키지 여럿을 묻는다) */
let lock = null;
function lockfile() {
  if (lock === null) {
    try {
      lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"));
    } catch {
      lock = {}; // 락파일이 없으면 아래 폴백만 남는다
    }
  }
  return lock;
}

/**
 * `pkg` 의 **커밋된** 버전. 락파일에 없으면 설치본의 `package.json` 버전.
 *
 * @param {string} pkg 패키지 이름 (`@iconify-json/logos`)
 * @param {string} installed 설치본 `package.json` 의 `version` (폴백)
 * @returns {string}
 */
export function lockedVersion(pkg, installed) {
  const entry = lockfile().packages?.[`node_modules/${pkg}`];
  return entry?.version ?? installed ?? "(버전 미상)";
}
