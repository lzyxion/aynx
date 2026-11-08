import { describe, expect, it } from "vitest";
import {
  aiOf,
  remotePaneName,
  isMeaningfulTitle,
  localPaneIdentity,
  type LocalPaneSignals,
} from "$lib/pane-identity";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/session";

// ---------------------------------------------------------------------------
// 로컬 타일의 신원 규칙 (`src/lib/pane-identity.ts`).
//
// 여기서 지키는 것은 **순서**다. 신호 넷이 동시에 올 수 있고(자동 실행한 AI 타일 안에서
// 다른 명령을 돌리는 중에 OSC 제목까지 바뀐다), 그때 어느 것이 이기는지가 화면의 답이다.
// 그리고 **아이콘과 이름이 언제나 같은 근거에서 나온다** — 한 함수가 둘을 함께 내므로
// "아이콘은 Claude 인데 이름은 PowerShell" 이 나올 자리가 없다.
// ---------------------------------------------------------------------------

/**
 * 문구는 인자로 들어간다 — `localPaneIdentity` 는 순수 모듈이라 사전을 들이지 않는다.
 * 단언이 글자를 보므로 테스트는 언제나 **한국어 사전**을 넘긴다.
 */
const ko: Tr = (key, params) => translate("ko", key, params);
const identity = (sig: LocalPaneSignals) => localPaneIdentity(sig, ko);

describe("localPaneIdentity — 신호 넷의 우선순위", () => {
  it("① `autorun` 이 AI CLI 면 그것이 답이다 (우리가 띄웠다)", () => {
    expect(identity({ autorun: "claude", shell: "pwsh" })).toEqual({
      icon: "claude",
      name: "Claude Code",
      ai: "claude",
    });
    expect(identity({ autorun: "codex --model o3", shell: "pwsh" })).toEqual({
      icon: "codex",
      name: "Codex",
      ai: "codex",
    });
  });

  it("① 은 OSC 제목과 도는 명령을 **이긴다** (CLI 가 제목을 제멋대로 바꾼다)", () => {
    const id = identity({
      autorun: "claude",
      runningCommand: "npm run build",
      oscTitle: "✳ 뭔가 다른 것",
      shell: "pwsh",
    });
    expect(id.name).toBe("Claude Code");
    expect(id.icon).toBe("claude");
  });

  it("① 은 autorun 에이전트가 **끝나면**(`agentEnded`) 쉰다 — 셸로 돌아오고, 손으로 다시 띄우면 ② 가 잡는다", () => {
    // 2026-09-24 실기 ② — `/exit` 뒤의 pwsh 가 계속 "Claude Code" 로 불리던 것
    expect(identity({ autorun: "claude", agentEnded: true, shell: "pwsh" })).toEqual({
      icon: "powershell",
      name: "PowerShell 7",
      ai: null,
    });
    expect(identity({ autorun: "claude", agentEnded: true, runningCommand: "codex", shell: "pwsh" }).ai).toBe(
      "codex",
    );
  });

  it("② 손으로 띄운 AI CLI — 도는 명령이 곧 신원이다 (이 판의 요점)", () => {
    const id = identity({ runningCommand: "claude", shell: "pwsh" });
    expect(id).toEqual({ icon: "claude", name: "Claude Code", ai: "claude" });
    expect(identity({ runningCommand: "codex exec", shell: "pwsh" }).name).toBe("Codex");
  });

  it("② 는 **끝나면 사라진다** — 명령이 `null` 이면 셸로 돌아온다 (`133;D`)", () => {
    const running = identity({ runningCommand: "claude", shell: "pwsh" });
    const done = identity({ runningCommand: null, shell: "pwsh" });
    expect(running.name).toBe("Claude Code");
    expect(done).toEqual({ icon: "powershell", name: "PowerShell 7", ai: null });
  });

  it("② 는 AI 가 아닌 명령에는 안 걸린다 — 셸 이름·아이콘 그대로", () => {
    const id = identity({ runningCommand: "npm run build", shell: "pwsh" });
    expect(id).toEqual({ icon: "powershell", name: "PowerShell 7", ai: null });
  });

  it("② 는 OSC 제목을 이긴다 — 명령은 셸이 찍어 준 사실, 제목은 프로그램이 쓰는 글자다", () => {
    const id = identity({
      runningCommand: "claude",
      oscTitle: "user@web-01: ~/src",
      shell: "pwsh",
    });
    expect(id.name).toBe("Claude Code");
  });

  it("② 는 앞에 다른 명령을 단 줄도 잡는다 — Claude 가 제목을 작업 이름으로 바꿔도 AI 로 남는다 (09-25 실기)", () => {
    const id = identity({
      runningCommand: "cd C:/Users/you/projects/aynx; claude --permission-mode default",
      oscTitle: "✳ Git status check",
      shell: "pwsh",
    });
    expect(id).toEqual({ icon: "claude", name: "Claude Code", ai: "claude" });
  });

  it("③ 제목 폴백은 Claude Code 하나뿐이다 (cmd.exe 처럼 133 이 없는 셸의 그물)", () => {
    expect(identity({ oscTitle: "✳ Claude Code", shell: "cmd" })).toEqual({
      icon: "claude",
      name: "Claude Code",
      ai: "claude",
    });
    // 대소문자를 가리지 않는다
    expect(identity({ oscTitle: "claude code — aynx", shell: "cmd" }).ai).toBe("claude");
  });

  it("③ 에 Codex 는 없다 — 제목이 작업 폴더 이름이라 그 글자로는 가를 수 없다", () => {
    const id = identity({ oscTitle: "you", shell: "pwsh" });
    expect(id.ai).toBeNull();
    expect(id.name).toBe("you"); // 의미 있는 제목이라 그대로 뜬다
    expect(id.icon).toBe("powershell");
  });

  it("④ 의미 있는 OSC 제목은 셸 이름을 통째로 대신한다 (로컬 셸 안의 `ssh`)", () => {
    const id = identity({ oscTitle: "me@web-01: ~/src", shell: "pwsh" });
    expect(id).toEqual({ icon: "powershell", name: "me@web-01: ~/src", ai: null });
  });

  it("④ 잡음 제목(경로)은 버리고 셸 이름을 남긴다", () => {
    const noisy = identity({ oscTitle: "C:\\Users\\me", shell: "pwsh" });
    expect(noisy.name).toBe("PowerShell 7");
    expect(identity({ oscTitle: "MINGW64:/c/work", shell: "gitbash" }).name).toBe(
      "Git Bash",
    );
    expect(identity({ oscTitle: "   ", shell: "pwsh" }).name).toBe("PowerShell 7");
  });

  it("④ 아무 신호도 없으면 일반 터미널 + 뭉뚱그린 이름 (세션이 열리기 전)", () => {
    expect(identity({})).toEqual({ icon: "terminal", name: "로컬", ai: null });
  });

  it("셸 아이콘·이름은 지금까지의 표 그대로다 (WSL 은 배포판으로 갈린다)", () => {
    const id = identity({ shell: "wsl:Ubuntu-24.04" });
    expect(id).toEqual({ icon: "ubuntu", name: "WSL: Ubuntu-24.04", ai: null });
  });
});

describe("remotePaneName — 원격 타일 이름", () => {
  it("AI 가 없으면 별칭 그대로", () => {
    expect(remotePaneName("dev-01", null)).toBe("dev-01");
  });
  it("AI 가 붙으면 AI 이름 먼저, 뒤에 서버", () => {
    expect(remotePaneName("dev-01", "claude")).toBe("Claude Code · dev-01");
    expect(remotePaneName("dev-01", "codex")).toBe("Codex · dev-01");
  });
});

describe("isMeaningfulTitle — 셸이 흘리는 경로 잡음 거르기", () => {
  it("호스트를 가리키는 제목은 경로를 달고 와도 살린다", () => {
    expect(isMeaningfulTitle("me@web-01")).toBe(true);
    expect(isMeaningfulTitle("me@web-01: ~/src")).toBe(true);
  });

  it("경로·exe 잡음은 버린다", () => {
    expect(isMeaningfulTitle("C:\\Program Files\\PowerShell\\pwsh.exe")).toBe(false);
    expect(isMeaningfulTitle("C:/work")).toBe(false);
    expect(isMeaningfulTitle("/home/me")).toBe(false);
    expect(isMeaningfulTitle("MINGW64:/c/work")).toBe(false);
    expect(isMeaningfulTitle("")).toBe(false);
  });

  it("평범한 낱말 제목은 살린다", () => {
    expect(isMeaningfulTitle("aynx")).toBe(true);
    expect(isMeaningfulTitle("✳ Claude Code")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SSH 타일의 AI 판정 (`app/agent-status` 의 `agentKindOf` 가 SSH 타일에도 `aiOf` 를 쓴다 — 2026-10-07).
// 원격 셸에서 손으로 띄운 Claude·Codex 도 AI 타일이다. 원격 셸은 프롬프트마다 `user@host: ~/dir` 제목을 흘린다.
// ---------------------------------------------------------------------------

describe("aiOf — SSH 타일(원격 셸)의 세 갈래", () => {
  it("② 원격 셸에서 손으로 친 `claude`·`codex` 는 AI 다 (셸 통합의 도는 명령)", () => {
    expect(aiOf({ runningCommand: "claude" })).toBe("claude");
    expect(aiOf({ runningCommand: "cd ~/work && codex --model o3" })).toBe("codex");
  });

  it("③ Claude Code 가 보낸 제목은 AI 다 (셸 통합 없는 원격 셸)", () => {
    expect(aiOf({ oscTitle: "✳ Claude Code" })).toBe("claude");
  });

  it("평범한 호스트 프롬프트 제목은 AI 가 아니다 — 폴더 이름에 \"claude code\" 가 있어도", () => {
    expect(aiOf({ oscTitle: "user@host: ~" })).toBeNull();
    expect(aiOf({ oscTitle: "deploy@dev-01: ~/src/claude code" })).toBeNull();
    expect(aiOf({ oscTitle: "root@box:/srv/Claude Code" })).toBeNull();
  });

  it("autorun 에이전트가 끝났으면(프롬프트 복귀) 셸이다 — 다시 손으로 띄우면 ② 가 잡는다", () => {
    expect(aiOf({ autorun: "claude --resume abc" })).toBe("claude");
    expect(aiOf({ autorun: "claude --resume abc", agentEnded: true })).toBeNull();
    expect(aiOf({ autorun: "claude", agentEnded: true, oscTitle: "user@host: ~" })).toBeNull();
    expect(aiOf({ autorun: "claude", agentEnded: true, runningCommand: "codex" })).toBe("codex");
  });

  it("아무 신호도 없으면 AI 가 아니다", () => {
    expect(aiOf({})).toBeNull();
    expect(aiOf({ runningCommand: "ls -al", oscTitle: "user@host: ~" })).toBeNull();
  });
});

describe("aiOf — ③′ 훅 신호가 밝힌 CLI (2026-10-08)", () => {
  it("다른 갈래가 없으면 신호가 밝힌 CLI 다 — tmux 안의 codex(제목이 폴더 이름)", () => {
    expect(aiOf({ signalAttested: "codex", oscTitle: "work" })).toBe("codex");
    expect(aiOf({ signalAttested: "claude" })).toBe("claude");
    // 이름·아이콘도 그 값으로 (원격 타일 이름도 같은 판정)
    expect(identity({ signalAttested: "codex", shell: "pwsh" })).toMatchObject({ icon: "codex", name: "Codex", ai: "codex" });
    expect(remotePaneName("dev-01", aiOf({ signalAttested: "codex" }))).toBe("Codex · dev-01");
  });

  it("앞 세 갈래가 먼저다", () => {
    expect(aiOf({ autorun: "claude", signalAttested: "codex" })).toBe("claude");
    expect(aiOf({ runningCommand: "claude", signalAttested: "codex" })).toBe("claude");
    expect(aiOf({ oscTitle: "✳ Claude Code", signalAttested: "codex" })).toBe("claude");
  });

  it("모르는 글자 · 없음은 AI 가 아니다", () => {
    expect(aiOf({ signalAttested: "gemini" })).toBeNull();
    expect(aiOf({ signalAttested: "" })).toBeNull();
    expect(aiOf({ signalAttested: null })).toBeNull();
  });
});

