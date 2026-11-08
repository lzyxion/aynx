/**
 * **호스트 아이콘 생성기** — Iconify 아이콘 묶음에서 우리가 고른 것만 뽑아
 * `src/lib/host-icons.generated.ts` 를 만든다 (docs/log/2026-09-04-icons-and-rows.md).
 *
 *     npm run gen:icons
 *
 * ## 왜 생성인가
 *
 * - **런타임에 Iconify API 를 부르지 않는다.** 이 앱은 오프라인 서버에 붙는 터미널이다 —
 *   아이콘 하나 그리자고 외부 HTTP 를 타면 그 환경에서 화면이 반쯤 빈다. 게다가 Tauri 의
 *   CSP 를 그만큼 열어야 한다.
 * - **늘 그리는 것과 찾아 고르는 것을 가른다.** 목록·탭·상태바가 늘 그리는 큐레이션 서른여섯
 *   개는 `host-icons.generated.ts` 로 본 번들에 박는다. **logos 전체**(2,110개, 7MB 남짓)는
 *   둘째 산출물 `host-icons-logos.generated.json` 으로 따로 내고, 고르개가 열리거나 그 아이콘을
 *   그릴 때 앱 자신의 출처에서 받아 온다 (docs/log/2026-09-29-logos-full-icons.md). devicon 은
 *   큐레이션이 쓰는 두 개(opensuse · proxmox)만 싣는다.
 *   고르개의 "기본" 칸은 같은 방식으로 **lucide 전체**(1,909개 단색 선 아이콘, ISC)를
 *   `host-icons-lucide.generated.json` 으로 낸다.
 * - 셋 다 **생성 파일을 저장소에 커밋**한다 (그래서 `npm i` 없이 체크아웃만 해도 아이콘이
 *   그려진다). 아이콘 묶음은 그래서 **devDependency** 다 — 패키지 자체는 빌드 산출물에 들지
 *   않고, 우리가 뽑아 줄인 모양만 든다.
 *
 * ## 아이콘을 더하려면
 *
 * 1. 아래 [`WANTED`] 에 `[우리 이름, "세트:아이콘"]` 한 줄을 더한다. **우리 이름은 저장
 *    형식의 일부**다 (`sessions.toml` 의 `icon = "svg:ubuntu"`) — 한 번 나간 이름은 남의
 *    설정 파일에 적혀 있으므로 바꾸지 않는다.
 * 2. `npm run gen:icons` 를 돌리고 생성 파일을 함께 커밋한다.
 * 3. 이름이 없으면 스크립트가 **그 자리에서 멈춘다** (조용히 빠뜨리면 고르개에서만 사라져
 *    한참 뒤에 발견된다). 세트에 그 로고가 없으면 다른 세트를 쓰거나 목록에서 뺀다.
 *
 * ## 색
 *
 * 로고의 색은 **원본 그대로 둔다** (`currentColor` 로 바꾸지 않는다). 우분투가 주황이고
 * 데비안이 빨강인 것이 이 아이콘들의 요점이라, 테마 색을 입히면 서로 구분되지 않는 회색
 * 실루엣 스물아홉 개가 된다. 테마를 따르는 것은 폴더 아이콘(`--folder`) 쪽 일이다.
 *
 * **예외 하나 — 검정 단색 로고.** OpenAI(Codex) · Apple · GitHub 처럼 검정 한 색뿐인 로고는 다크
 * 모드의 어두운 면 위에서 사라진다. 그런 body 만 `src/lib/mono-logo.js` 의 `monoLogo` 가 검정을
 * `var(--logo-mono)`(라이트 ≈ 검정 · 다크 ≈ 흰색, `theme.css`)로 바꾼다 — 검정 + 흰색이면 흰색은
 * `var(--logo-mono-inverse)` 로 통째 반전한다. 다른 색이 하나라도 섞인 로고는 그대로다. 큐레이션과
 * logos 전체 둘 다 여기서(생성 시점) 거친다 (docs/log/2026-09-29-logos-full-icons.md 의 "검정 단색 로고").
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lockedVersion } from "./locked-version.mjs";
import { monoKind, monoLogo } from "../src/lib/mono-logo.js";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/lib/host-icons.generated.ts");

/**
 * 쓰는 아이콘 묶음. `license` 는 각 패키지의 `package.json` 에서 읽어 생성 파일 머리에
 * 그대로 적는다 — 출처를 손으로 적으면 패키지를 올릴 때 조용히 낡는다.
 */
const SETS = {
  logos: "@iconify-json/logos",
  devicon: "@iconify-json/devicon",
};

/**
 * **통째로 싣는 묶음** — 큐레이션과 달리 고르지 않고 전부를 JSON 하나로 낸다 (고르개의 검색이 늦게
 * 불러 쓴다). logos 는 컬러 로고(docs/log/2026-09-29-logos-full-icons.md), lucide 는 단색 선
 * 아이콘("기본" — 같은 로그의 Lucide 절)이다. lucide 는 `SETS` 에 없다: 큐레이션이 쓰지 않는다.
 */
const FULL_SETS = {
  // `mono` — 검정 단색 로고를 테마 색으로 (`monoLogo`). lucide 는 이미 `currentColor` 라 필요 없다.
  logos: { pkg: "@iconify-json/logos", out: "src/lib/host-icons-logos.generated.json", mono: true },
  lucide: { pkg: "@iconify-json/lucide", out: "src/lib/host-icons-lucide.generated.json" },
};

/**
 * `[우리 이름, "세트:아이콘"]` — **순서가 곧 고르개 격자의 순서**다.
 * 리눅스 배포판 → 그 밖의 OS → 인프라·클라우드 → 흔한 서비스 순으로 둔다 (알파벳 순이
 * 아니라 사람이 찾는 순서다).
 *
 * Alpine Linux 는 두 묶음 어디에도 없어 뺐다 (`logos:alpinejs` 는 전혀 다른 것이다).
 */
const WANTED = [
  // 리눅스 배포판
  ["linux", "logos:linux-tux"],
  ["ubuntu", "logos:ubuntu"],
  ["debian", "logos:debian"],
  ["fedora", "logos:fedora"],
  ["centos", "logos:centos-icon"],
  ["rhel", "logos:redhat-icon"],
  ["rocky", "logos:rocky-linux-icon"],
  ["arch", "logos:archlinux"],
  ["opensuse", "devicon:opensuse"],
  // 그 밖의 OS
  ["freebsd", "logos:freebsd"],
  ["windows", "logos:microsoft-windows-icon"],
  ["macos", "logos:apple"],
  ["raspberry-pi", "logos:raspberry-pi"],
  // 인프라 · 클라우드
  ["docker", "logos:docker-icon"],
  ["kubernetes", "logos:kubernetes"],
  ["proxmox", "devicon:proxmox"],
  ["aws", "logos:aws"],
  ["gcp", "logos:google-cloud"],
  ["azure", "logos:microsoft-azure"],
  // 흔한 서비스
  ["nginx", "logos:nginx"],
  ["postgres", "logos:postgresql"],
  ["mysql", "logos:mysql-icon"],
  ["redis", "logos:redis"],
  ["elasticsearch", "logos:elasticsearch"],
  ["grafana", "logos:grafana"],
  ["jenkins", "logos:jenkins"],
  ["git", "logos:git-icon"],
  ["github", "logos:github-icon"],
  ["gitlab", "logos:gitlab-icon"],
  // 셸 · 도구 — 타일·탭 앞자리가 "이게 무슨 셸인가" 를 말하는 데 쓴다 (`src/lib/pane-icons.ts`).
  // 호스트 고르개에도 함께 뜨지만 해롭지 않다(붙이고 싶은 사람은 붙인다). **맨 뒤에 더한다** —
  // 위 목록의 순서가 곧 고르개 격자의 순서라, 끼워 넣으면 사람이 외운 자리가 흔들린다.
  ["powershell", "devicon:powershell"],
  ["bash", "logos:bash-icon"],
  ["terminal", "logos:terminal"],
  ["claude", "logos:claude-icon"],
  ["codex", "logos:openai-icon"],
  // DB 엔진 — 독 DB 칸의 엔진 로고(`src/lib/db-conn.ts` 의 `DB_ENGINE_ICON`, 2026-10-13). postgres · mysql 은 위에
  // 이미 있고, 나머지 둘이 logos 전체(7MB)를 받지 않고 본 번들에서 그려지게 여기 둔다. 맨 뒤 규칙은 위와 같다.
  ["mariadb", "logos:mariadb-icon"],
  ["sqlite", "logos:sqlite"],
];

/** 사람이 읽는 이름 — 고르개 툴팁에 뜬다 (생성 파일에 함께 박는다) */
const LABELS = {
  linux: "Linux",
  ubuntu: "Ubuntu",
  debian: "Debian",
  fedora: "Fedora",
  centos: "CentOS",
  rhel: "Red Hat",
  rocky: "Rocky Linux",
  arch: "Arch Linux",
  opensuse: "openSUSE",
  freebsd: "FreeBSD",
  windows: "Windows",
  macos: "macOS",
  "raspberry-pi": "Raspberry Pi",
  docker: "Docker",
  kubernetes: "Kubernetes",
  proxmox: "Proxmox",
  aws: "AWS",
  gcp: "Google Cloud",
  azure: "Azure",
  nginx: "nginx",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  redis: "Redis",
  elasticsearch: "Elasticsearch",
  grafana: "Grafana",
  jenkins: "Jenkins",
  git: "Git",
  github: "GitHub",
  gitlab: "GitLab",
  powershell: "PowerShell",
  bash: "Bash",
  terminal: "Terminal",
  claude: "Claude",
  codex: "Codex",
  mariadb: "MariaDB",
  sqlite: "SQLite",
};

/**
 * **검색어 별칭** — 고르개의 칸이 검색창이 되면서 생긴 표다
 * (docs/log/2026-09-20-host-form-tabs.md 의 "아이콘 칸 = 검색").
 *
 * 사람이 치는 글자가 늘 우리 이름(`rhel`)이나 라벨(`Red Hat`)과 같지는 않다 — `k8s` ·
 * `rpi` · `pg` 는 **그 물건의 흔한 부름**이고, 그것을 쳤을 때 아무것도 안 나오면 고르개는
 * 없는 것과 같다. 여기 적힌 글자는 **찾기에만** 쓰이고 화면에는 나오지 않는다(툴팁은 라벨).
 *
 * 적는 기준 하나: **사람이 실제로 칠 법한 것만**. 넉넉히 적을수록 좋은 표가 아니다 —
 * `red` 하나에 열 개가 걸리면 격자를 좁힌 뜻이 사라진다. 이름·라벨로 이미 걸리는 글자는
 * 다시 적지 않는다 (`debian` 에 `deb` 는 접두사라 저절로 걸리지만, 옛 습관대로 적어 둔다).
 *
 * 없으면 `[]` 다 (`fedora` · `git` 처럼 이름 말고 달리 부를 길이 없는 것들).
 */
const KEYWORDS = {
  linux: ["tux", "penguin"],
  ubuntu: ["canonical"],
  debian: ["deb"],
  fedora: [],
  centos: ["cent"],
  rhel: ["redhat", "red hat"],
  rocky: ["rockylinux"],
  arch: ["archlinux"],
  opensuse: ["suse"],
  freebsd: ["bsd"],
  windows: ["win", "microsoft"],
  macos: ["mac", "apple", "osx"],
  "raspberry-pi": ["rpi", "raspberry", "pi"],
  docker: ["container"],
  kubernetes: ["k8s", "kube"],
  proxmox: ["pve"],
  aws: ["amazon"],
  gcp: ["google", "google cloud"],
  azure: ["microsoft"],
  nginx: ["web"],
  postgres: ["postgresql", "pg"],
  mysql: ["mariadb"],
  redis: ["cache"],
  elasticsearch: ["elastic", "es"],
  grafana: ["dashboard"],
  jenkins: ["ci"],
  git: [],
  github: ["gh"],
  gitlab: ["gl"],
  powershell: ["pwsh", "ps"],
  bash: ["sh", "shell"],
  terminal: ["shell", "console", "터미널"],
  claude: ["anthropic", "ai"],
  codex: ["openai", "ai"],
  mariadb: [],
  sqlite: ["db"],
};

/** 세트 하나를 읽어 `{ icons, width, height, license, version }` 로 */
function loadSet(pkg) {
  const meta = require(`${pkg}/package.json`);
  const json = JSON.parse(readFileSync(require.resolve(`${pkg}/icons.json`), "utf8"));
  return {
    icons: json.icons,
    aliases: json.aliases ?? {},
    width: json.width ?? 16,
    height: json.height ?? 16,
    license: meta.license ?? "(license 필드 없음)",
    // **락파일이 말하는 버전**이지 설치본의 버전이 아니다 — 생성 파일 머리가 `npm install`
    // 한 번에 흔들리지 않게 (`scripts/locked-version.mjs` 머리말).
    version: lockedVersion(pkg, meta.version),
  };
}

const sets = Object.fromEntries(Object.entries(SETS).map(([k, pkg]) => [k, loadSet(pkg)]));

/**
 * 검정 단색이어도 **원본 색 그대로 두는** logos — 다크 반전(`monoLogo`)을 건너뛴다.
 * `terminal`(검정 판 + 흰 프롬프트)은 그 자체가 "검정 화면" 그림이라 뒤집으면 흰 판이 된다 — 아이콘 칸에 판(바탕)이
 * 깔리면서 검정 그대로도 충분히 갈린다(2026-10-18 사용자)
 */
const MONO_KEEP = new Set(["terminal"]);

const rows = [];
/** 검정 단색이라 테마 색으로 바꾼 큐레이션 (`monoLogo`) — 끝에 찍어 둔다 */
const monoCurated = [];
for (const [name, ref] of WANTED) {
  const [setName, iconName] = ref.split(":");
  const set = sets[setName];
  if (!set) throw new Error(`모르는 세트: ${ref}`);
  const icon = set.icons[iconName];
  // 조용히 빠뜨리지 않는다 — 고르개에서만 사라지면 한참 뒤에야 발견된다.
  if (!icon) throw new Error(`${ref} 를 찾을 수 없습니다 (세트에 그 이름이 없다)`);
  const left = icon.left ?? 0;
  const top = icon.top ?? 0;
  const width = icon.width ?? set.width;
  const height = icon.height ?? set.height;
  const label = LABELS[name] ?? name;
  const keywords = KEYWORDS[name] ?? [];
  const keep = MONO_KEEP.has(name);
  const mono = keep ? null : monoKind(icon.body);
  if (mono) monoCurated.push(`${name}(${mono})`);
  rows.push(
    `  ${JSON.stringify(name)}: {\n` +
      `    label: ${JSON.stringify(label)},\n` +
      `    keywords: ${JSON.stringify(keywords)},\n` +
      `    source: ${JSON.stringify(ref)},\n` +
      `    viewBox: ${JSON.stringify(`${left} ${top} ${width} ${height}`)},\n` +
      `    body: ${JSON.stringify(keep ? icon.body : monoLogo(icon.body))},\n` +
      `  },`,
  );
}

const credits = Object.entries(SETS)
  .map(([k, pkg]) => ` *   - \`${k}\` — ${pkg} v${sets[k].version} · 라이선스 ${sets[k].license}`)
  .join("\n");

const out = `/**
 * **자동 생성 파일 — 손으로 고치지 마세요.**
 *
 *     npm run gen:icons        (scripts/gen-host-icons.mjs)
 *
 * Iconify 아이콘 묶음에서 \`scripts/gen-host-icons.mjs\` 의 \`WANTED\` 목록에 적힌 것만
 * 뽑아 온 **컬러 로고**들이다. 아이콘을 더하고 빼는 방법은 그 스크립트의 머리 주석에 있다.
 *
 * 출처:
 *
${credits}
 *
 * 브랜드 로고의 **상표권은 각 상표권자에게** 있다 — 여기서는 그 서버가 무엇인지 가리키는
 * 표시로만 쓴다.
 *
 * \`body\` 는 원본의 색을 **그대로** 담고 있다 (\`currentColor\` 로 바꾸지 않는다 — 색이
 * 이 아이콘들의 요점이다). 예외는 **검정 단색 로고**뿐이다 — 검정이 \`var(--logo-mono)\` 로
 * 바뀌어 있다 (\`src/lib/mono-logo.js\`). \`viewBox\` 는 아이콘마다 다르므로(logos 는 256, devicon 은 128)
 * 그리는 쪽이 정사각 칸 안에 비율을 지켜 맞춘다.
 */

/** 생성된 로고 하나 */
export interface GeneratedIcon {
  /** 고르개 툴팁에 뜨는 사람이 읽는 이름 */
  label: string;
  /**
   * **찾기에만** 쓰는 별칭들 (\`k8s\` · \`rpi\` · \`pg\`) — 화면에는 나오지 않는다.
   * 표는 \`scripts/gen-host-icons.mjs\` 의 \`KEYWORDS\` 에 있고, 읽는 곳은 \`matchIcons\` 다.
   */
  keywords: readonly string[];
  /** 어느 묶음의 무엇인가 (\`"logos:ubuntu"\`) — 출처 추적용 */
  source: string;
  /** 이 아이콘의 viewBox (묶음마다·아이콘마다 다르다) */
  viewBox: string;
  /** SVG 안쪽 마크업 그대로 (색 포함) */
  body: string;
}

export const GENERATED_ICONS: Readonly<Record<string, GeneratedIcon>> = {
${rows.join("\n")}
};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`wrote ${OUT} (${rows.length} icons, ${out.length} bytes)`);
console.log(`  mono → var(--logo-mono): ${monoCurated.join(" ") || "(none)"}`);

// ---------------------------------------------------------------------------
// **logos 전체** — 고르개의 검색이 늦게 불러 쓰는 둘째 산출물
// (docs/log/2026-09-29-logos-full-icons.md).
//
// 위의 서른여섯 개는 목록·탭·상태바가 **늘** 그리므로 본 번들에 박혀 있다. 여기는 그 밖의
// logos 전부(2,110개 — 숨김 230 포함)이고, 7MB 남짓이라 본 번들에 넣지 않는다: 고르개가
// 열리거나 `svg:logos:<이름>` 을 그릴 때 **앱 자신의 출처에서** 받아 온다 (`?url` + fetch —
// 네트워크가 아니라 번들 안의 파일이다). 그래서 JSON 이고, 주석이 없으니 출처·라이선스는
// 머리 필드(`source`·`version`·`license`)에 적는다.
//
// devicon 은 싣지 않는다 — 위 목록이 쓰는 두 개(opensuse · proxmox)로 충분하다는 결정이다.
//
// **lucide 전체**(1,909개, 578KB 남짓 · ISC)도 같은 모양으로 셋째 산출물
// `host-icons-lucide.generated.json` 에 낸다 — 고르개의 "기본" 칸, 저장 형식 `svg:lucide:<이름>`.
// 단색 선 아이콘이라 색은 그리는 쪽이 호스트 색으로 입힌다 (`HostIcon` 의 `color`).
//
// 모양 (`IconSetData` · `src/lib/host-icons.ts`):
//
//     { source, version, license, viewBox: "0 0 256 256",
//       icons: { "<이름>": { b: <body>, v?: <viewBox>, x?: 1 } },   // v 는 기본과 다를 때만, x = 숨김
//       aliases: { "<옛 이름>": "<지금 이름>" } }
//
// **숨김(`hidden`) 아이콘도 싣는다** — Iconify 는 이름을 바꾸거나 지운 아이콘을 숨김으로 남겨
// 옛 이름을 살려 둔다. 사람이 한 번 저장한 `svg:logos:<이름>` 이 다음 판에서 숨김이 되어도
// 계속 그려져야 하므로, 검색에서만 빼고 풀이에는 남긴다. `aliases` 도 같은 이유다.
// ---------------------------------------------------------------------------

/** 묶음 하나를 통째로 줄여 JSON 한 벌로 쓴다 (모양은 위 주석) */
function writeFullSet(key, { pkg, out, mono }) {
  const set = sets[key] ?? loadSet(pkg);
  const defaultViewBox = `0 0 ${set.width} ${set.height}`;
  const fullIcons = {};
  const monoCount = { mono: 0, negative: 0 };
  for (const [iconName, icon] of Object.entries(set.icons)) {
    const viewBox = `${icon.left ?? 0} ${icon.top ?? 0} ${icon.width ?? set.width} ${icon.height ?? set.height}`;
    const monoOn = mono && !MONO_KEEP.has(iconName);
    const isMono = monoOn ? monoKind(icon.body) : null;
    if (isMono) monoCount[isMono]++;
    const entry = { b: monoOn ? monoLogo(icon.body) : icon.body };
    if (viewBox !== defaultViewBox) entry.v = viewBox;
    if (icon.hidden) entry.x = 1;
    fullIcons[iconName] = entry;
  }
  const fullAliases = {};
  for (const [alias, a] of Object.entries(set.aliases)) {
    // 별칭의 부모가 또 별칭일 수 있다 (Iconify 규격) — 끝까지 따라가 실제 아이콘 이름을 적는다.
    let parent = a.parent;
    for (let i = 0; i < 8 && parent !== undefined && !(parent in fullIcons); i++) {
      parent = set.aliases[parent]?.parent;
    }
    if (parent !== undefined && parent in fullIcons) fullAliases[alias] = parent;
  }
  const full = {
    source: pkg,
    version: set.version,
    license: set.license,
    viewBox: defaultViewBox,
    icons: fullIcons,
    aliases: fullAliases,
  };
  const fullText = JSON.stringify(full);
  const outPath = resolve(ROOT, out);
  writeFileSync(outPath, fullText);
  console.log(
    `wrote ${outPath} (${Object.keys(fullIcons).length} icons, ${Object.keys(fullAliases).length} aliases, ${fullText.length} bytes)`,
  );
  if (mono) console.log(`  mono → var(--logo-mono): ${monoCount.mono} · negative: ${monoCount.negative}`);
}

for (const [key, spec] of Object.entries(FULL_SETS)) writeFullSet(key, spec);
