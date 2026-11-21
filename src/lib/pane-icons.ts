/**
 * 셸 id · AI CLI 이름 → 컬러 로고 이름(`host-icons.generated.ts` 의 이름 — 저장 형식이 아니다).
 * Svelte 를 import 하지 않는다 — vitest 가 그대로 돈다.
 */

const UNKNOWN_SHELL_ICON = "terminal";

/** 부분 일치(소문자) · 위에서부터 처음 걸리는 것 — 없는 배포판은 `linux` */
const WSL_DISTRO_ICONS: readonly (readonly [string, string])[] = [
  ["ubuntu", "ubuntu"],
  ["debian", "debian"],
  ["fedora", "fedora"],
  ["arch", "arch"],
  ["suse", "opensuse"],
];

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

/** 부분 일치 — 받는 값이 우리가 띄운 명령(`PaneSpec.autorun` · `AiCli.id`)뿐이라 안전하다 */
export function aiIconName(cliIdOrCommand: string): string | null {
  const s = cliIdOrCommand.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("claude")) return "claude";
  if (s.includes("codex")) return "codex";
  return null;
}

/**
 * AI 타일은 CLI 가 바꾸는 창 제목(OSC)을 무시하고 이 이름을 쓴다.
 * Rust `mcp/cli.rs` 의 어댑터 `display` 와 같은 값이다(그쪽이 원본 — 새 CLI 를 더하면 둘 다 고친다).
 */
export function aiDisplayName(cliIdOrCommand: string): string | null {
  const icon = aiIconName(cliIdOrCommand);
  if (icon === "claude") return "Claude Code";
  if (icon === "codex") return "Codex";
  return null;
}

export type AiCliKind = "claude" | "codex";

/**
 * [`aiIconName`] 과 일부러 규칙이 다르다 — 사용자가 친 아무 줄(OSC 133 `B`~`C`)이라 부분 일치면
 * `vim claude.md` 같은 줄에 타일이 Claude 로 둔갑한다. 조각마다 실행 파일이 정확히 `claude`·`codex` 일 때만, 여럿이면 마지막 것.
 * 역슬래시는 이스케이프로 보지 않는다 — 윈도우 경로의 구분자다.
 */
export function aiFromCommandLine(cmdline: string): AiCliKind | null {
  let found: AiCliKind | null = null;
  for (const segment of splitCommandLine(cmdline)) {
    const ai = aiOfSegment(segment);
    if (ai !== null) found = ai;
  }
  return found;
}

/** 구분자 `;` · `&&` · `||` · `|` · `&` · 줄바꿈 — 따옴표 안과 리다이렉션(`2>&1`)의 `&` 는 글자다 */
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
      inToken = true;
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
        cur += c;
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
  endSegment();
  return segments;
}

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
    i++;
    skipFlags();
    if (i >= tokens.length) return null;
    const pkg = AI_PACKAGES[packageName(tokens[i])];
    if (pkg !== undefined) return pkg;
    exe = executableName(tokens[i]);
  }
  return exe === "claude" || exe === "codex" ? exe : null;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const AI_RUNNERS = new Set(["npx", "bunx", "pnpx"]);

const AI_PACKAGES: Readonly<Record<string, AiCliKind>> = {
  "@anthropic-ai/claude-code": "claude",
  "@openai/codex": "codex",
};

/** 판 꼬리(`@latest`)를 뗀다 — 스코프의 앞 `@` 는 남긴다 */
function packageName(token: string): string {
  const s = token.trim().toLowerCase();
  const at = s.indexOf("@", 1);
  return at > 0 ? s.slice(0, at) : s;
}

function executableName(token: string): string | null {
  let s = token.trim();
  if (s.length >= 2 && /^(".*"|'.*')$/s.test(s)) s = s.slice(1, -1);
  const base = s.split(/[\\/]/).pop() ?? "";
  const name = base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
  return name === "" ? null : name;
}
