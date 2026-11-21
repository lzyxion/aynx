/**
 * 자동 승인 묶음 프리셋 — 순수 데이터.
 *
 * - 묶음은 기본 거부를 넓히지 않는다 — 사람이 켜야만 규칙이 사용자 허용 목록에 얹히고, 그 규칙도 `policy.ts`/`policy.rs` 의
 *   같은 문(위험 배제 · 구획 분해 · 상한 · 빈도 한도)을 통과해야 한다. 여기 적힌 것은 allowlist 항목일 뿐 승인이 아니다.
 *   AI 는 이 파일을 바꿀 수 없고 묶음을 켜는 길은 앱 설정 화면 하나다.
 * - 묶음을 더하거나 규칙을 넓히는 것은 보안 검토다 — 읽기 · 관찰 전용인가 · 인자로 쓰기가 되지 않는가 · 비밀을 뱉지 않는가.
 *   뺀 것: `find`(-delete · -exec 가 인자다) · `env`/`printenv`(비밀) · `top`(대화형).
 * - 서브커맨드가 있으면 그 낱말이 exec 바로 뒤여야 한다(`sub_first` — 앞 플래그의 값이 서브커맨드로 위장하는 `git -C status push`
 *   를 막는다). `ip` 만 `any_order` 예외.
 * - `src-tauri/src/automation_presets.rs` 에 글자 그대로 같은 표가 있고 권위는 Rust 다. `automation-presets.test.ts` 가 둘을 대조한다.
 */

import type { AllowRule } from "$lib/settings.svelte.js";

/** `any_order` — 서브커맨드 앞 플래그를 받는다(`ip`). 없으면 서브커맨드가 있을 때 펼친 규칙에 `sub_first` 가 선다. */
export interface BundleRule extends AllowRule {
  key?: string;
  any_order?: boolean;
}

export interface AutomationBundle {
  /** `settings.toml` 의 `[automation] bundles` 에 적히는 키 — 바뀌면 안 된다. */
  id: string;
  name: string;
  description: string;
  rules: BundleRule[];
}

/**
 * Rust `automation_presets.rs` 의 `BUNDLES` 와 행 · 순서까지 같다. 같은 exec 이 여러 줄이면 OR 이다.
 * `name` · `description` 의 한국어는 그대로 둔다 — Rust 쌍둥이와 글자까지 대조된다(화면 글자는 i18n 사전이 덮는다).
 */
export const BUNDLES: readonly AutomationBundle[] = [
  {
    id: "system",
    name: "시스템 상태",
    description:
      "디스크·메모리·CPU·프로세스·로그인 사용자·시각을 보는 명령들. 시각·호스트 이름을 바꾸는 꼴은 막았다.",
    rules: [
      // 인자로 상태를 바꾸는 것(`date -s`·`hostname 새이름`)은 인자를 막고, 끝나지 않는 것
      // (`free -s 1`·`vmstat 1`)은 그 플래그·인자를 막는다.
      { exec: "df", subcommands: [] },
      { exec: "free", subcommands: [], deny_flags: ["-s", "--seconds"] },
      { exec: "uptime", subcommands: [] },
      { exec: "hostname", subcommands: [], allow_flags: ["-s", "--short", "-f", "--fqdn", "--long", "-d", "--domain", "-i", "--ip-address", "-I", "--all-ip-addresses", "-A", "--all-fqdns"], max_args: 0 },
      { exec: "whoami", subcommands: [] },
      { exec: "id", subcommands: [] },
      { exec: "date", subcommands: [], allow_flags: ["-u", "--utc", "--universal", "-R", "--rfc-email", "-I", "--iso-8601", "--rfc-3339"], first_arg: ["+*"], max_args: 1 },
      { exec: "uname", subcommands: [] },
      { exec: "ps", subcommands: [] },
      { exec: "nproc", subcommands: [] },
      { exec: "lscpu", subcommands: [] },
      { exec: "lsmem", subcommands: [] },
      { exec: "lsblk", subcommands: [] },
      { exec: "mount", subcommands: [], allow_flags: ["-l", "--show-labels"], max_args: 0 },
      { exec: "vmstat", subcommands: [], max_args: 0 },
      { exec: "iostat", subcommands: [], max_args: 0 },
      { exec: "who", subcommands: [] },
      { exec: "w", subcommands: [] },
      { exec: "last", subcommands: [] },
      // 동사 없이(= status)·status·show 만 — set-time·set-timezone·set-ntp 는 없다.
      { exec: "timedatectl", subcommands: [], max_args: 0 },
      { exec: "timedatectl", subcommands: ["status", "show"] },
      { exec: "hostnamectl", subcommands: [], max_args: 0 },
      { exec: "hostnamectl", subcommands: ["status"], key: "hostnamectl" },
    ],
  },
  {
    id: "services",
    name: "서비스 점검",
    description:
      "서비스 상태·타이머·유닛 파일, nginx 설정 검사, crontab 목록. 시작·중지·재시작은 없다.",
    rules: [
      // 상태 조회까지만. restart·stop 은 위험 분류기도 따로 잡는다.
      { exec: "systemctl", subcommands: ["status", "is-active", "is-enabled", "list-units"] },
      { exec: "systemctl", subcommands: ["list-timers"] },
      { exec: "systemctl", subcommands: ["cat"] },
      // 설정 검사만 — `-c`(다른 설정)·`-g`(지시어 — load_module 로 코드 적재)·`-e`(로그 파일 쓰기)·
      // `-s`(신호) 는 없다.
      { exec: "nginx", subcommands: [], allow_flags: ["-t", "-T", "-q"], require_flags: ["-t"], max_args: 0 },
      // 목록만 — 파일 인자는 설치이고, `-u 사용자` 의 값은 파일 인자와 구별할 수 없어 뺐다.
      { exec: "crontab", subcommands: [], allow_flags: ["-l"], require_flags: ["-l"], max_args: 0 },
    ],
  },
  {
    id: "pkg",
    name: "패키지 조회",
    description:
      "설치된 패키지와 버전을 보는 명령들(apt·dpkg·rpm·pip·npm·snap). 설치·삭제·갱신은 없다.",
    rules: [
      // `-o`·`-c` 는 apt 설정을 바꾼다(훅·경로).
      { exec: "apt", subcommands: ["list", "show", "policy"], deny_flags: ["-o", "--option", "-c", "--config-file"] },
      { exec: "apt-cache", subcommands: ["policy", "show", "search", "depends"], deny_flags: ["-o", "--option", "-c", "--config-file"] },
      { exec: "dpkg-query", subcommands: [] },
      // 조회 모드(-q)와 조회 플래그만 — `--qf`(매크로 확장)·`--pipe`·`-D`·`-E`·`-e`·`-i` 단독 설치는 없다.
      { exec: "rpm", subcommands: [], allow_flags: ["-q", "--query", "-a", "--all", "-i", "--info", "-l", "--list", "-f", "--file", "-p", "--package", "-c", "--configfiles", "-d", "--docfiles", "-R", "--requires", "--provides", "--whatprovides", "--whatrequires", "--changelog", "--last", "-s", "--state", "--scripts", "--triggers", "--conflicts", "--obsoletes", "--dump"], require_flags: ["-q"] },
      // `--python` 은 다른 인터프리터를 실행하고 `--log` 는 파일을 쓴다.
      { exec: "pip", subcommands: ["list", "show", "freeze"], deny_flags: ["--python*", "--log*"] },
      { exec: "npm", subcommands: ["ls"], deny_flags: ["--logs-dir*"] },
      { exec: "snap", subcommands: ["list"] },
    ],
  },
  {
    id: "files",
    name: "파일 읽기",
    description:
      "파일 목록·내용·크기·해시를 읽는 명령들. 쓰지는 않지만 비밀 파일의 내용도 그대로 읽는다.",
    rules: [
      // `find` 는 제외했다(-delete·-exec 가 인자다).
      { exec: "ls", subcommands: [] },
      { exec: "cat", subcommands: [] },
      { exec: "head", subcommands: [] },
      { exec: "tail", subcommands: [], deny_flags: ["-f", "-F", "--follow*"] },
      { exec: "wc", subcommands: [] },
      { exec: "grep", subcommands: [] },
      { exec: "stat", subcommands: [] },
      { exec: "du", subcommands: [] },
      // `-C` 는 magic 파일을 컴파일해 쓴다.
      { exec: "file", subcommands: [], deny_flags: ["-C", "--compile"] },
      { exec: "sha256sum", subcommands: [] },
      { exec: "md5sum", subcommands: [] },
      { exec: "readlink", subcommands: [] },
      { exec: "realpath", subcommands: [] },
      // `-o` 는 출력 파일을 쓰고 `-R` 은 디렉터리마다 00Tree.html 을 쓴다.
      { exec: "tree", subcommands: [], deny_flags: ["-o", "-R"] },
    ],
  },
  {
    id: "logs",
    name: "로그 읽기",
    description:
      "시스템 저널과 커널 로그를 읽는 명령들. 따라가기와 로그 삭제·회전은 막았다.",
    rules: [
      { exec: "journalctl", subcommands: [], deny_flags: ["-f", "--follow", "--vacuum-*", "--rotate", "--flush", "--sync", "--relinquish-var", "--smart-relinquish-var", "--setup-keys", "--update-catalog", "--cursor-file"] },
      { exec: "dmesg", subcommands: [], deny_flags: ["-C", "--clear", "-c", "--read-clear", "-D", "--console-off", "-E", "--console-on", "-n", "--console-level", "-w", "--follow", "-W", "--follow-new"] },
    ],
  },
  {
    id: "network",
    name: "네트워크 조회",
    description:
      "소켓·주소·경로·이웃 표·이름 풀이·연결 확인. 주소·경로·이웃 표를 바꾸는 꼴과 소켓 끊기는 막았다.",
    rules: [
      { exec: "ss", subcommands: [], deny_flags: ["-K", "--kill", "-E", "--events", "-D", "--diag"] },
      // 대상(addr·route·link) 뒤 낱말이 show·list(route 는 get 까지)이거나 없을 때만, 플래그는
      // 출력 모양을 바꾸는 것만(-batch·-netns·-force 없음). 값 받는 플래그가 없어 앞에 와도 된다.
      { exec: "ip", subcommands: ["addr"], allow_flags: ["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"], first_arg: ["show", "list"], any_order: true },
      { exec: "ip", subcommands: ["route"], allow_flags: ["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"], first_arg: ["show", "list", "get"], any_order: true },
      { exec: "ip", subcommands: ["link"], allow_flags: ["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"], first_arg: ["show", "list"], any_order: true },
      // `ip a`·`ip address` 는 addr 의 다른 철자 — 같은 제약. 키는 따로 둬서 옛 묶음에서 옮긴 설정에는 꺼진 채로 온다.
      { exec: "ip", subcommands: ["a", "address"], allow_flags: ["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"], first_arg: ["show", "list"], any_order: true, key: "ip address" },
      // 이웃(ARP·NDP) 표 보기만 — add·del·change·replace·flush 는 표를 바꾸고 get 은 프로브를 보낸다.
      { exec: "ip", subcommands: ["neigh"], allow_flags: ["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"], first_arg: ["show", "list"], any_order: true },
      { exec: "netstat", subcommands: [], deny_flags: ["-c", "--continuous"] },
      { exec: "dig", subcommands: [] },
      { exec: "host", subcommands: [] },
      // 공개 데이터베이스만 — shadow·gshadow 는 없다.
      { exec: "getent", subcommands: [], first_arg: ["hosts", "ahosts", "ahostsv4", "ahostsv6", "networks", "services", "protocols", "passwd", "group", "rpc", "ethers", "netgroup"] },
      { exec: "resolvectl", subcommands: ["status", "query"] },
      // 횟수(-c)가 있어야 끝난다. 홍수(-f)·간격(-i)·미리 보내기(-l)·적응(-A)은 없다.
      { exec: "ping", subcommands: [], require_flags: ["-c"], deny_flags: ["-f", "-i", "-l", "-A"] },
      { exec: "traceroute", subcommands: [] },
    ],
  },
  {
    id: "docker",
    name: "컨테이너",
    description:
      "docker 컨테이너·이미지·네트워크·볼륨·compose 상태 조회. 실행·중지·삭제는 없다. inspect 는 환경 변수도 보여 준다.",
    rules: [
      // 따라가기(-f)는 끝나지 않으므로 막고, `docker stats` 는 `--no-stream` 이 있어야 끝난다.
      { exec: "docker", subcommands: ["ps"] },
      { exec: "docker", subcommands: ["images"] },
      { exec: "docker", subcommands: ["inspect"] },
      { exec: "docker", subcommands: ["logs"], deny_flags: ["-f", "--follow"] },
      { exec: "docker", subcommands: ["stats"], require_flags: ["--no-stream"] },
      { exec: "docker", subcommands: ["version"] },
      { exec: "docker", subcommands: ["info"] },
      { exec: "docker", subcommands: ["network"], allow_flags: ["-f", "--filter", "--format", "--no-trunc", "-q", "--quiet", "-v", "--verbose"], first_arg: ["ls", "inspect"] },
      { exec: "docker", subcommands: ["volume"], allow_flags: ["-f", "--filter", "--format", "-q", "--quiet", "--cluster"], first_arg: ["ls", "inspect"] },
      // compose 는 하위 동사의 플래그만 — 전역 `-p`·`-f`·`--env-file` 의 값이 동사로 위장하지 못하게.
      { exec: "docker", subcommands: ["compose"], allow_flags: ["-a", "--all", "-q", "--quiet", "--services", "--format", "--status", "--filter", "--no-trunc", "--orphans", "--volumes", "--profiles", "--images", "--hash", "--no-interpolate", "--no-normalize", "--no-path-resolution", "--no-consistency", "--resolve-image-digests", "--environment", "--variables", "--networks"], first_arg: ["ps", "config", "images"] },
      { exec: "docker", subcommands: ["compose"], allow_flags: ["--tail", "-n", "-t", "--timestamps", "--since", "--until", "--no-color", "--no-log-prefix", "--index"], first_arg: ["logs"] },
    ],
  },
  {
    id: "k8s",
    name: "쿠버네티스",
    description:
      "kubectl 조회(get·describe·logs·top·events)와 helm 목록·상태. 적용·삭제·exec 는 없다.",
    rules: [
      { exec: "kubectl", subcommands: ["describe"] },
      { exec: "kubectl", subcommands: ["get"], deny_flags: ["-w", "--watch*"] },
      { exec: "kubectl", subcommands: ["logs"], deny_flags: ["-f", "--follow"] },
      { exec: "kubectl", subcommands: ["top"] },
      { exec: "kubectl", subcommands: ["version"] },
      { exec: "kubectl", subcommands: ["api-resources"] },
      { exec: "kubectl", subcommands: ["events"], deny_flags: ["-w", "--watch*"] },
      { exec: "helm", subcommands: ["list", "status"] },
    ],
  },
  {
    id: "git",
    name: "Git 조회",
    description:
      "저장소 상태를 읽는 git 서브커맨드들(태그는 목록만). 네트워크를 쓰는 fetch 는 따로 있다 — pull·checkout·reset·태그 만들기는 없다.",
    rules: [
      // 공통 금지: 파일을 쓰는 `--output` · 설정/실행 경로를 바꾸는 `--config-env`·`--exec-path` ·
      // 임의 명령을 받는 `--upload-pack`.
      { exec: "git", subcommands: ["status"], deny_flags: ["--output*", "--config-env*", "--exec-path*", "--upload-pack*"] },
      { exec: "git", subcommands: ["log"], deny_flags: ["--output*", "--config-env*", "--exec-path*", "--upload-pack*"] },
      { exec: "git", subcommands: ["diff"], deny_flags: ["--output*", "--config-env*", "--exec-path*", "--upload-pack*"] },
      { exec: "git", subcommands: ["show"], deny_flags: ["--output*", "--config-env*", "--exec-path*", "--upload-pack*"] },
      { exec: "git", subcommands: ["rev-parse"], deny_flags: ["--output*", "--config-env*", "--exec-path*", "--upload-pack*"] },
      { exec: "git", subcommands: ["describe"], deny_flags: ["--output*", "--config-env*", "--exec-path*", "--upload-pack*"] },
      // branch 는 목록만 — 목록형 플래그만, 이름 인자 없음(`-D`·`-m`·`-c`·`-u`·새 이름 없음).
      { exec: "git", subcommands: ["branch"], allow_flags: ["-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "-l", "--list", "--show-current", "--merged", "--no-merged", "--contains", "--no-contains", "--sort", "--color", "--no-color", "--column", "--no-column", "-i", "--ignore-case", "--abbrev", "--no-abbrev"], max_args: 0 },
      // remote 는 목록(`-v`)·show·get-url 만(add·remove·rename·set-url·prune 없음).
      { exec: "git", subcommands: ["remote"], deny_flags: ["--output*", "--config-env*", "--exec-path*", "--upload-pack*"], first_arg: ["show", "get-url"] },
      // ls-files 는 쓰지 않는다 — 플래그는 출력 모양·고르기만. 저장소 밖 파일을 읽는 `-X`·`--exclude-from`·`--exclude-per-directory` 는 없다.
      { exec: "git", subcommands: ["ls-files"], allow_flags: ["-c", "--cached", "-d", "--deleted", "-m", "--modified", "-o", "--others", "-i", "--ignored", "-s", "--stage", "-u", "--unmerged", "-k", "--killed", "-z", "-t", "-v", "-f", "--directory", "--no-empty-directory", "--eol", "--deduplicate", "-x", "--exclude", "--exclude-standard", "--error-unmatch", "--with-tree", "--full-name", "--recurse-submodules", "--abbrev", "--debug", "--sparse", "--format"] },
      // blame 은 출력 플래그만 — 아무 파일이나 읽어 그 내용을 찍는 `--contents`, 리비전 목록 파일을 읽는 `-S`·`--ignore-revs-file` 은 없다.
      { exec: "git", subcommands: ["blame"], allow_flags: ["-L", "-l", "-t", "-b", "-f", "--show-name", "-n", "--show-number", "-s", "-e", "--show-email", "-w", "-c", "-p", "--porcelain", "--line-porcelain", "--incremental", "--root", "--show-stats", "--reverse", "--first-parent", "--encoding", "--date", "--abbrev", "-M", "-C", "--color-lines", "--color-by-age", "--ignore-rev", "--minimal", "--progress", "--no-progress", "--score-debug"] },
      // shortlog 는 요약·리비전 고르기 플래그만(`--output` 같은 diff 옵션 없음). 리비전이 없으면 stdin 을 읽지만 실행기가 stdin 을 곧바로 닫아(ssh/exec.rs) 빈 출력으로 끝난다.
      { exec: "git", subcommands: ["shortlog"], allow_flags: ["-n", "--numbered", "-s", "--summary", "-e", "--email", "-c", "--committer", "--group", "--format", "-w", "--all", "--branches", "--tags", "--remotes", "--no-merges", "--merges", "--first-parent", "--since", "--after", "--until", "--before", "--author", "--date"] },
      // tag 는 목록만 — 이름 인자는 `-l`/`--list` 가 있을 때만(패턴). 목록 플래그 없이 이름을 주면 태그를 만든다. `-d`·`-a`·`-s`·`-u`·`-f`·`-m`·`-F`·`-v`(gpg 실행) 없음.
      { exec: "git", subcommands: ["tag"], allow_flags: ["-l", "--list", "-n", "--sort", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--format", "--color", "--no-color", "--column", "--no-column", "-i", "--ignore-case", "--omit-empty"], require_flags: ["-l"] },
      { exec: "git", subcommands: ["tag"], allow_flags: ["-l", "--list", "-n", "--sort", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--format", "--color", "--no-color", "--column", "--no-column", "-i", "--ignore-case", "--omit-empty"], require_flags: ["--list"] },
      { exec: "git", subcommands: ["tag"], allow_flags: ["-l", "--list", "-n", "--sort", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--format", "--color", "--no-color", "--column", "--no-column", "-i", "--ignore-case", "--omit-empty"], max_args: 0 },
    ],
  },
  {
    id: "gitfetch",
    name: "Git 갱신",
    description:
      "원격의 새 커밋을 받아 오는 git fetch. 작업 트리는 건드리지 않는다 — 원격 이름 하나까지, refspec 은 없다.",
    rules: [
      // 원격 이름 하나까지 — refspec(`+a:main`)은 로컬 브랜치를 덮어쓸 수 있다.
      { exec: "git", subcommands: ["fetch"], deny_flags: ["--output*", "--config-env*", "--exec-path*", "--upload-pack*"], max_args: 1 },
    ],
  },
];

/** 설정 화면의 소제목 — 화면 전용이라 Rust 쌍둥이가 없다. */
export const BUNDLE_GROUPS: readonly { id: string; bundles: readonly string[]; caution?: boolean }[] = [
  { id: "server", bundles: ["system", "services", "pkg"] },
  { id: "data", bundles: ["files", "logs"], caution: true },
  { id: "infra", bundles: ["network", "docker", "k8s"] },
  { id: "dev", bundles: ["git", "gitfetch"] },
];

/** `[automation.bundle_off]` 에 적히는 이름 — 바뀌면 안 된다. Rust `PresetRule::command_key` 와 같은 규칙. */
export function commandKey(r: BundleRule): string {
  if (r.key) return r.key;
  return r.subcommands.length === 1 ? `${r.exec} ${r.subcommands[0]}` : r.exec;
}

export interface BundleCommand {
  key: string;
  rules: BundleRule[];
}

export function bundleCommands(b: AutomationBundle): BundleCommand[] {
  const out: BundleCommand[] = [];
  for (const r of b.rules) {
    const key = commandKey(r);
    const hit = out.find((c) => c.key === key);
    if (hit) hit.rules.push(r);
    else out.push({ key, rules: [r] });
  }
  return out;
}

/** 부르는 쪽이 고쳐도 표가 오염되지 않게 깊은 사본 */
function cloneRule(r: AllowRule): AllowRule {
  const c: AllowRule = { exec: r.exec, subcommands: [...r.subcommands] };
  if (r.deny_flags) c.deny_flags = [...r.deny_flags];
  if (r.allow_flags) c.allow_flags = [...r.allow_flags];
  if (r.require_flags) c.require_flags = [...r.require_flags];
  if (r.first_arg) c.first_arg = [...r.first_arg];
  if (r.max_args !== undefined) c.max_args = r.max_args;
  if (r.sub_first) c.sub_first = true;
  return c;
}

/** Rust `PresetRule::to_allow_rule` 과 같다. */
function expandRule(r: BundleRule): AllowRule {
  const c = cloneRule(r);
  if (r.subcommands.length > 0 && !r.any_order) c.sub_first = true;
  return c;
}

export function bundleById(id: string): AutomationBundle | undefined {
  return BUNDLES.find((b) => b.id === id);
}

export type BundleOff = Readonly<Record<string, readonly string[]>>;

export function isCommandOff(off: BundleOff | undefined, bundle: string, key: string): boolean {
  return off?.[bundle]?.includes(key) ?? false;
}

/**
 * 모르는 id 는 조용히 건너뛴다 — 새 버전의 묶음을 켜 둔 `settings.toml` 을 옛 버전이 읽어도 값이 지워지지 않게.
 * Rust `expand_bundles` 와 같은 의미다.
 */
export function expandBundles(ids: readonly string[], off?: BundleOff): AllowRule[] {
  const out: AllowRule[] = [];
  for (const id of ids) {
    const b = bundleById(id);
    if (!b) continue;
    for (const r of b.rules) {
      if (isCommandOff(off, b.id, commandKey(r))) continue;
      out.push(expandRule(r));
    }
  }
  return out;
}

/** Rust `effective_allow_rules` 와 같은 의미다 — 판정의 권위는 백엔드이고 그쪽도 디스크에서 스스로 펼친다. */
export function effectiveAllowRules(prefs: {
  allow: readonly AllowRule[];
  bundles: readonly string[];
  bundle_off?: BundleOff;
}): AllowRule[] {
  const out: AllowRule[] = prefs.allow.map(cloneRule);
  out.push(...expandBundles(prefs.bundles, prefs.bundle_off));
  return out;
}
