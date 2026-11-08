/**
 * **타일이 무엇인지 앞자리에서 말하는 아이콘** — 셸 id·AI CLI 이름을 컬러 로고 **이름**으로
 * 옮기는 순수 규칙 한 벌.
 *
 * 돌려주는 것은 `host-icons.generated.ts` 의 **이름**이지 저장 형식이 아니다 (`"powershell"`,
 * `"ubuntu"`). 그리는 쪽이 [`iconRef`](`$lib/host-icons`)로 감싸 `HostIcon` 에 넘긴다 —
 * 호스트가 골라 붙인 아이콘(`sessions.toml` 의 `icon = "svg:…"`)과 **같은 한 자리**를 지나게
 * 하려는 것이다. 그래야 SSH 타일(사람이 고른 로고)과 로컬 타일(셸이 말해 주는 로고)이 같은
 * 크기·같은 정렬로 선다.
 *
 * ## 왜 순수 모듈인가
 *
 * 이 규칙을 읽는 자리가 넷이다 — 타일 헤더 · 탭 스트립 · 상태바 후미단 · 독 실행 단추(`DockLaunch`)·launcher. 앞의 셋은
 * `PaneSpec` 을 들고 있고 메뉴·launcher 는 아직 타일이 없는 **목록 항목**(`ShellInfo`·`AiCli`)만
 * 들고 있어서, 컴포넌트에 규칙을 심으면 메뉴 쪽이 같은 표를 한 벌 더 베껴 적게 된다. 표는
 * 여기 하나뿐이고 테스트도 여기 붙는다 (`pane-icons.test.ts`).
 *
 * Svelte 를 import 하지 않는다 — vitest 가 그대로 돈다 (`vitest.config.ts` 의 대상 규칙).
 */

/** 셸 id 를 모르거나 비었을 때 — 브랜드가 아니라 "터미널" 이라는 일반명사 하나 */
const UNKNOWN_SHELL_ICON = "terminal";

/**
 * WSL 배포판 이름 → 로고 이름. **부분 일치**(소문자)라 `"Ubuntu-24.04"`·`"openSUSE-Tumbleweed"`
 * 처럼 버전이 붙어 오는 실제 이름을 그대로 받는다. 위에서부터 처음 걸리는 것이 답이다.
 *
 * 없는 배포판(Kali·Alpine·Oracle …)은 **펭귄**(`linux`)으로 떨어진다 — 아이콘 세트에 그
 * 로고가 없을 뿐 "리눅스다" 는 여전히 맞는 말이고, 빈칸보다 낫다.
 */
const WSL_DISTRO_ICONS: readonly (readonly [string, string])[] = [
  ["ubuntu", "ubuntu"],
  ["debian", "debian"],
  ["fedora", "fedora"],
  ["arch", "arch"],
  ["suse", "opensuse"], // openSUSE · SLES 둘 다 같은 로고다
];

/**
 * 백엔드가 해석해 준 셸 id(`"pwsh"` · `"powershell"` · `"cmd"` · `"gitbash"` · `"wsl:<distro>"`)
 * 를 로고 이름으로. 모르는 값·빈 값은 [`UNKNOWN_SHELL_ICON`].
 *
 * `pwsh` 와 `powershell` 이 **같은 로고**인 것은 의도다: 사용자가 구분하는 것은 "PowerShell
 * 이냐 cmd 냐" 이지 7 이냐 5.1 이냐가 아니고, devicon 에도 그 둘을 가르는 로고가 없다.
 * `cmd` 는 윈도우 로고를 쓴다 — cmd.exe 만의 로고는 어느 묶음에도 없고, 그 자리에서
 * "윈도우 기본 명령 프롬프트" 로 읽힌다.
 */
export function shellIconName(shellId: string | null | undefined): string {
  const id = shellId?.trim().toLowerCase();
  if (!id) return UNKNOWN_SHELL_ICON;
  if (id === "pwsh" || id === "powershell") return "powershell";
  if (id === "gitbash") return "bash";
  if (id === "cmd") return "windows";
  if (id.startsWith("wsl:")) {
    const distro = id.slice("wsl:".length);
    for (const [needle, icon] of WSL_DISTRO_ICONS) if (distro.includes(needle)) return icon;
    return "linux";
  }
  return UNKNOWN_SHELL_ICON;
}

/**
 * AI CLI 의 id 나 명령(`"claude"` · `"codex"`)을 로고 이름으로. **모르는 CLI 는 `null`** —
 * 지어낸 아이콘을 붙이는 대신 셸 아이콘으로 떨어지게 한다 (부르는 쪽이 그 갈림을 쥔다).
 *
 * 부분 일치인 이유는 이 함수가 받는 값이 두 갈래이기 때문이다: `AiCli.id`(안정 id)와
 * `PaneSpec.autorun`(실제로 친 명령 — `"claude --resume"` 처럼 인자가 붙어 올 수 있다).
 */
export function aiIconName(cliIdOrCommand: string): string | null {
  const s = cliIdOrCommand.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("claude")) return "claude";
  if (s.includes("codex")) return "codex";
  return null;
}

/**
 * AI CLI 의 id 나 명령을 **타일에 보여 줄 이름**으로 (`"Claude Code"` · `"Codex"`). 모르는
 * CLI 는 `null` — 부르는 쪽(`displayName`)이 평소 규칙(OSC 제목·셸 이름)으로 떨어진다.
 *
 * 이 표가 있는 이유: AI 타일은 **무엇을 돌리는지 이미 안다**(SSH 타일이 별칭을 아는 것과
 * 같다). 그런데 CLI 마다 창 제목(OSC)을 제멋대로 바꾼다 — Claude Code 는 "✳ Claude Code",
 * Codex 는 작업 폴더 이름(`you`) — 이라 제목을 믿으면 타일마다 다른 종류의 글자가 뜬다.
 * 그래서 AI 타일은 제목을 무시하고 이 이름을 쓴다. 이름은 Rust `mcp.rs` 의 어댑터
 * `display` 와 같은 값이다(그쪽이 원본 — 새 CLI 를 더하면 둘 다 고친다).
 */
export function aiDisplayName(cliIdOrCommand: string): string | null {
  const icon = aiIconName(cliIdOrCommand);
  if (icon === "claude") return "Claude Code";
  if (icon === "codex") return "Codex";
  return null;
}

/** [`aiFromCommandLine`] 이 돌려주는 AI CLI (= 로고 이름이기도 하다) */
export type AiCliKind = "claude" | "codex";

/**
 * **지금 도는 명령 한 줄이 AI CLI 인가** — 맞으면 그 CLI, 아니면 `null`. 순수 함수.
 *
 * [`aiIconName`] 과 **일부러 규칙이 다르다**. 저쪽이 받는 값은 우리가 만든
 * `PaneSpec.autorun`(= 우리가 띄운 명령)이라 부분 일치로 넉넉히 봐도 안전하다. 이쪽이 받는
 * 값은 **사용자가 프롬프트에 친 아무 글자**(OSC 133 `B`~`C` 구간)라, 부분 일치면
 * `git commit -m "claude 얘기"` 나 `vim claude.md` 같은 줄에서 타일이 통째로 Claude 로
 * 둔갑한다. 그래서 여기서는 **각 명령의 실행 파일이 정확히 `claude`·`codex` 일 때만**
 * 답한다 — `claude-code`·`claudia` 같은 이웃 이름은 `null` 이다.
 *
 * ## 한 줄에 명령이 여럿일 때 (2026-09-25 실기)
 *
 * `cd C:/proj; claude --permission-mode default` 처럼 **앞에 다른 명령을 달고** 치면 첫 토큰이
 * `cd` 라 예전 규칙은 이 줄을 놓쳤다. 그 타일은 제목("claude")으로만 AI 로 읽히다가, Claude Code
 * 가 제목을 "✳ Git status check" 로 바꾸는 순간 셸로 돌아가 `stop` 신호가 버려졌다. 그래서 줄을
 * 셸 구분자(`;` · `&&` · `||` · `|` · `&` · 줄바꿈 — **따옴표 안은 제외**)로 조각내고 **조각마다**
 * 실행 파일을 본다. 여러 조각이 AI 면 **마지막 것**이 답이다: 순차(`;`·`&&`)면 마지막 조각이
 * 이 줄이 끝날 때까지 앞에 서 있는 명령이고, 파이프(`a | claude -p`)면 마지막 조각이 터미널에
 * 출력을 쓰는 쪽이다 — 어느 쪽이든 "지금 화면을 쥔 것" 에 더 가깝다.
 *
 * 한 조각 안에서 받아들이는 모양:
 *
 * | 친 것 | 답 | 왜 |
 * | --- | --- | --- |
 * | `claude` · `codex --model o3` | 그 CLI | 첫 토큰이 곧 실행 파일이다 |
 * | `C:\Users\me\.bun\bin\claude.exe` · `& 'C:\Program Files\x\claude.exe'` | `claude` | 경로·확장자를 떼고 본다 (pwsh 호출 연산자 `&` 는 구분자로 먹힌다) |
 * | `npx claude` · `bunx -y codex` · `npx @anthropic-ai/claude-code` | 그 CLI | 러너는 건너뛰고 그 뒤의 첫 비플래그 토큰(패키지 이름도)을 본다 |
 * | `FOO=1 claude` · `env FOO=1 codex` | 그 CLI | 앞자리 환경 대입(과 `env`)은 건너뛴다 |
 * | `claude-trace` · `sudo claude` · `echo claude` · `echo "a; claude"` | `null` | 어느 조각의 실행 파일도 그 CLI 가 아니다 |
 *
 * 따옴표는 `'…'`·`"…"` 두 가지만 안다. 역슬래시는 **이스케이프로 보지 않는다** — 윈도우 경로의
 * 구분자이기 때문이다. 리다이렉션의 `&`(`2>&1`)는 구분자가 아니다. 못 알아보는 모양이면
 * **지금까지와 똑같이** 셸 아이콘이 남을 뿐이라 지어내지 않는다.
 */
export function aiFromCommandLine(cmdline: string): AiCliKind | null {
  let found: AiCliKind | null = null;
  for (const segment of splitCommandLine(cmdline)) {
    const ai = aiOfSegment(segment);
    if (ai !== null) found = ai; // 마지막 AI 조각이 이긴다 (함수 머리말)
  }
  return found;
}

/**
 * 한 줄을 **명령 조각**들로 — 각 조각은 따옴표를 벗긴 토큰 배열이다. 순수 함수.
 *
 * 구분자: `;` · `&&` · `||` · `|` · `&` · 줄바꿈. 따옴표 안의 구분자·공백은 글자다. `>&`·`<&`
 * (리다이렉션)의 `&` 는 글자다. 빈 조각(줄 머리의 pwsh `&` 앞 같은)은 버린다.
 */
export function splitCommandLine(cmdline: string): string[][] {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let cur = "";
  let inToken = false;
  let quote: '"' | "'" | null = null;

  const endToken = () => {
    if (inToken) tokens.push(cur);
    cur = "";
    inToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < cmdline.length; i++) {
    const c = cmdline[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inToken = true; // `""` 도 빈 토큰 하나다
      continue;
    }
    if (c === ";" || c === "\n" || c === "\r" || c === "|") {
      endSegment();
      if (c === "|" && cmdline[i + 1] === "|") i++;
      continue;
    }
    if (c === "&") {
      const prev = cmdline[i - 1];
      if (inToken && (prev === ">" || prev === "<")) {
        cur += c; // 2>&1 — 리다이렉션의 일부
        continue;
      }
      endSegment();
      if (cmdline[i + 1] === "&") i++;
      continue;
    }
    if (/\s/.test(c)) {
      endToken();
      continue;
    }
    cur += c;
    inToken = true;
  }
  endSegment(); // 닫히지 않은 따옴표는 줄 끝까지를 한 토큰으로 친다
  return segments;
}

/** 한 조각의 실행 파일이 AI CLI 인가 — 앞자리 환경 대입·`env`·러너를 건너뛴다 */
function aiOfSegment(tokens: readonly string[]): AiCliKind | null {
  let i = 0;
  const skipAssignments = () => {
    while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i])) i++;
  };
  const skipFlags = () => {
    while (i < tokens.length && tokens[i].startsWith("-")) i++;
  };

  skipAssignments();
  if (i < tokens.length && executableName(tokens[i]) === "env") {
    i++;
    skipFlags();
    skipAssignments();
  }
  if (i >= tokens.length) return null;

  let exe = executableName(tokens[i]);
  if (exe !== null && AI_RUNNERS.has(exe)) {
    // `npx`·`bunx`·`pnpx` 는 **다음 토큰이 진짜 명령**이다. 그 사이의 플래그(`-y`)는 넘긴다.
    i++;
    skipFlags();
    if (i >= tokens.length) return null;
    const pkg = AI_PACKAGES[packageName(tokens[i])];
    if (pkg !== undefined) return pkg;
    exe = executableName(tokens[i]);
  }
  return exe === "claude" || exe === "codex" ? exe : null;
}

/** `FOO=1` · `_X=a=b` — POSIX 셸의 앞자리 환경 대입 */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** CLI 를 대신 띄우는 러너들 — 뒤의 토큰이 진짜 명령이다 */
const AI_RUNNERS = new Set(["npx", "bunx", "pnpx"]);

/** 러너 뒤에 올 수 있는 **npm 패키지 이름** → CLI (`npx @anthropic-ai/claude-code@latest`) */
const AI_PACKAGES: Readonly<Record<string, AiCliKind>> = {
  "@anthropic-ai/claude-code": "claude",
  "@openai/codex": "codex",
};

/** 패키지 지정에서 판 꼬리(`@latest`·`@1.2.3`)를 떼고 소문자로 — 스코프의 앞 `@` 는 남긴다 */
function packageName(token: string): string {
  const s = token.trim().toLowerCase();
  const at = s.indexOf("@", 1);
  return at > 0 ? s.slice(0, at) : s;
}

/**
 * 토큰 하나에서 **실행 파일 이름**만 남긴다 — 감싼 따옴표·디렉터리·윈도우 확장자를 뗀다.
 * (`"C:\bin\claude.cmd"` → `claude`). 남길 것이 없으면 `null`.
 */
function executableName(token: string): string | null {
  let s = token.trim();
  if (s.length >= 2 && /^(".*"|'.*')$/s.test(s)) s = s.slice(1, -1);
  const base = s.split(/[\\/]/).pop() ?? "";
  const name = base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
  return name === "" ? null : name;
}
