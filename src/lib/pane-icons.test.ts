import { describe, expect, it } from "vitest";
import { aiDisplayName, aiFromCommandLine, aiIconName, shellIconName, splitCommandLine } from "$lib/pane-icons";
import { GENERATED_ICONS } from "$lib/host-icons.generated";

// ---------------------------------------------------------------------------
// 타일·탭 앞자리 아이콘의 규칙 (`src/lib/pane-icons.ts`).
//
// 여기서 지키는 것이 둘이다: ① 셸 id → 로고 이름의 표가 안 흔들릴 것, ② 그 표가 **실재하는
// 아이콘만** 가리킬 것. ②가 없으면 `WANTED` 에서 이름 하나를 빼거나 오타를 냈을 때 화면에서
// 그 자리만 조용히 비고(`iconNameOf` 가 `null` 을 준다) 한참 뒤에야 발견된다.
// ---------------------------------------------------------------------------

describe("shellIconName — 셸 id → 로고 이름", () => {
  it("PowerShell 은 판(7·5.1)을 가리지 않고 같은 로고다", () => {
    expect(shellIconName("pwsh")).toBe("powershell");
    expect(shellIconName("powershell")).toBe("powershell");
  });

  it("Git Bash 는 bash, cmd 는 윈도우 로고", () => {
    expect(shellIconName("gitbash")).toBe("bash");
    expect(shellIconName("cmd")).toBe("windows");
  });

  it("WSL 은 배포판 이름으로 갈린다 (버전 꼬리표가 붙어도)", () => {
    expect(shellIconName("wsl:Ubuntu")).toBe("ubuntu");
    expect(shellIconName("wsl:Ubuntu-24.04")).toBe("ubuntu");
    expect(shellIconName("wsl:Debian")).toBe("debian");
    expect(shellIconName("wsl:Fedora-41")).toBe("fedora");
    expect(shellIconName("wsl:archlinux")).toBe("arch");
    expect(shellIconName("wsl:openSUSE-Tumbleweed")).toBe("opensuse");
  });

  it("로고가 없는 배포판은 펭귄으로 떨어진다 — 빈칸보다 낫다", () => {
    expect(shellIconName("wsl:kali-linux")).toBe("linux");
    expect(shellIconName("wsl:Alpine")).toBe("linux");
    expect(shellIconName("wsl:")).toBe("linux");
  });

  it("모르는 값·빈 값·null 은 일반 터미널", () => {
    expect(shellIconName("nushell")).toBe("terminal");
    expect(shellIconName("")).toBe("terminal");
    expect(shellIconName("   ")).toBe("terminal");
    expect(shellIconName(null)).toBe("terminal");
    expect(shellIconName(undefined)).toBe("terminal");
  });

  it("대소문자를 가리지 않는다 (백엔드가 어떻게 적어 보내도 같은 답)", () => {
    expect(shellIconName("PWSH")).toBe("powershell");
    expect(shellIconName("WSL:UBUNTU")).toBe("ubuntu");
  });
});

describe("aiIconName — AI CLI id·명령 → 로고 이름", () => {
  it("claude · codex 를 알아본다", () => {
    expect(aiIconName("claude")).toBe("claude");
    expect(aiIconName("codex")).toBe("codex");
  });

  it("인자가 붙은 명령도 같은 답이다 (`PaneSpec.autorun` 은 명령 문자열이다)", () => {
    expect(aiIconName("claude --resume")).toBe("claude");
    expect(aiIconName("codex exec")).toBe("codex");
  });

  it("모르는 CLI 는 null — 부르는 쪽이 셸 아이콘으로 떨어뜨린다", () => {
    expect(aiIconName("aider")).toBeNull();
    expect(aiIconName("")).toBeNull();
  });
});

describe("aiFromCommandLine — 사용자가 친 명령 한 줄 → AI CLI", () => {
  it("첫 토큰이 그 CLI 면 인자가 붙어도 알아본다", () => {
    expect(aiFromCommandLine("claude")).toBe("claude");
    expect(aiFromCommandLine("codex")).toBe("codex");
    expect(aiFromCommandLine("claude --resume --model opus")).toBe("claude");
    expect(aiFromCommandLine("  codex exec 'ls'  ")).toBe("codex");
  });

  it("경로와 윈도우 확장자를 떼고 본다", () => {
    expect(aiFromCommandLine("C:\\Users\\me\\.bun\\bin\\claude.exe")).toBe("claude");
    expect(aiFromCommandLine("C:/Users/me/AppData/npm/codex.cmd --help")).toBe("codex");
    expect(aiFromCommandLine("/usr/local/bin/claude")).toBe("claude");
    expect(aiFromCommandLine('"C:\\bin\\claude.cmd"')).toBe("claude");
  });

  it("러너(npx·bunx·pnpx)는 건너뛰고 그 뒤를 본다 (플래그도)", () => {
    expect(aiFromCommandLine("npx claude")).toBe("claude");
    expect(aiFromCommandLine("bunx -y codex")).toBe("codex");
    expect(aiFromCommandLine("pnpx claude --resume")).toBe("claude");
    expect(aiFromCommandLine("npx")).toBeNull(); // 러너만 있고 명령이 없다
  });

  it("**이웃 이름과 인자는 안 걸린다** — 부분 일치였으면 타일이 통째로 둔갑한다", () => {
    expect(aiFromCommandLine("claude-trace")).toBeNull();
    expect(aiFromCommandLine("claudia")).toBeNull();
    expect(aiFromCommandLine("codex-cli")).toBeNull();
    expect(aiFromCommandLine("vim claude.md")).toBeNull();
    expect(aiFromCommandLine('git commit -m "claude 얘기"')).toBeNull();
    expect(aiFromCommandLine("echo codex")).toBeNull();
    expect(aiFromCommandLine("sudo claude")).toBeNull(); // 러너 목록에 없다
  });

  it("빈 줄·공백은 null", () => {
    expect(aiFromCommandLine("")).toBeNull();
    expect(aiFromCommandLine("   ")).toBeNull();
  });

  it("대소문자를 가리지 않는다 (윈도우에서 `Claude.exe` 로 뜰 수 있다)", () => {
    expect(aiFromCommandLine("CLAUDE")).toBe("claude");
    expect(aiFromCommandLine("Codex.EXE --help")).toBe("codex");
  });

  // 2026-09-25 실기: `cd …; claude …` 를 놓쳐 제목이 바뀌자 신호가 버려졌다
  it.each<[string, string | null]>([
    ["cd C:/Users/you/projects/aynx; claude --permission-mode default", "claude"],
    ["cd x && claude", "claude"],
    ["cd x || codex", "codex"],
    ["git status | claude -p", "claude"], // 파이프로 받는 쪽도 그 CLI 가 돈다
    ["claude; echo done", "claude"],
    ["cd x;claude", "claude"], // 구분자 둘레에 공백이 없어도
    ["cd a\nclaude", "claude"],
    ["FOO=1 codex", "codex"],
    ["FOO=1 BAR=x=y claude --resume", "claude"],
    ["env FOO=1 claude", "claude"],
    ["env -i FOO=1 codex exec", "codex"],
    ["npx @anthropic-ai/claude-code", "claude"],
    ["npx -y @anthropic-ai/claude-code@latest --resume", "claude"],
    ["bunx @openai/codex", "codex"],
    ["& claude", "claude"], // pwsh 호출 연산자
    ["& 'C:\\Program Files\\nodejs\\claude.exe' --resume", "claude"],
    ['& "C:\\Program Files\\x\\codex.cmd"', "codex"],
    [".\\claude.exe", "claude"],
    ["claude.cmd", "claude"],
    ["cd x; & 'C:\\Program Files\\x\\claude.exe'", "claude"],
    ["git status 2>&1 | claude -p", "claude"], // 2>&1 의 & 는 구분자가 아니다
    ["claude; codex", "codex"], // 마지막 AI 조각이 이긴다
    ["codex && echo ok", "codex"],
  ])("여러 명령 · 모양: %j → %s", (line, want) => {
    expect(aiFromCommandLine(line)).toBe(want);
  });

  it.each([
    'echo "a; claude"', // 따옴표 안의 구분자는 글자다
    "echo 'x && codex'",
    "cd x; vim claude.md",
    "cd claude; ls", // 인자로 온 이름
    "claude-trace | less",
    "FOO=claude ls",
    "env",
    "npx @anthropic-ai/claude-code-router",
    "cd x;",
    ";;&&||",
    '"unterminated; claude',
  ])("AI 가 아니다: %j", (line) => {
    expect(aiFromCommandLine(line)).toBeNull();
  });
});

describe("splitCommandLine — 한 줄 → 명령 조각(토큰 배열)", () => {
  it("구분자로 가르고 따옴표를 벗긴다", () => {
    expect(splitCommandLine("cd 'a b'; claude --x && echo \"c;d\" | wc")).toEqual([
      ["cd", "a b"],
      ["claude", "--x"],
      ["echo", "c;d"],
      ["wc"],
    ]);
  });
  it("리다이렉션의 & 는 토큰에 남고, 빈 조각은 버린다", () => {
    expect(splitCommandLine("& foo 2>&1")).toEqual([["foo", "2>&1"]]);
    expect(splitCommandLine("  ;  ")).toEqual([]);
  });
});

describe("가리키는 이름은 전부 실재하는 아이콘이다", () => {
  const names = [
    shellIconName("pwsh"),
    shellIconName("gitbash"),
    shellIconName("cmd"),
    shellIconName("wsl:Ubuntu"),
    shellIconName("wsl:Debian"),
    shellIconName("wsl:Fedora"),
    shellIconName("wsl:arch"),
    shellIconName("wsl:openSUSE"),
    shellIconName("wsl:kali"),
    shellIconName(null),
    aiIconName("claude"),
    aiIconName("codex"),
  ];

  it.each(names)("%s 가 생성 세트에 있다", (name) => {
    expect(name).not.toBeNull();
    expect(GENERATED_ICONS[name as string]).toBeTruthy();
  });
});

describe("aiDisplayName — AI CLI id·명령 → 타일 이름", () => {
  it("아는 CLI 는 표시 이름 (인자가 붙은 명령도)", () => {
    expect(aiDisplayName("claude")).toBe("Claude Code");
    expect(aiDisplayName("claude --resume")).toBe("Claude Code");
    expect(aiDisplayName("codex")).toBe("Codex");
  });
  it("모르는 CLI·빈 값은 null (부르는 쪽이 평소 규칙으로 떨어진다)", () => {
    expect(aiDisplayName("aider")).toBeNull();
    expect(aiDisplayName("")).toBeNull();
  });
});
