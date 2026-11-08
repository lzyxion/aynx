import { describe, expect, it } from "vitest";
import { translate } from "$lib/i18n/dict";
import { shellInfoLabel, shellLabel, type Tr } from "$lib/session";

// ---------------------------------------------------------------------------
// 셸 표시 이름 (`src/lib/session/names.ts` 의 `shellLabel` · `shellInfoLabel`).
//
// 지키는 것: Rust `list_shells` 가 **목록을 만든 순간의 언어**로 구운 `label` 에 기대지 않고,
// 그릴 때의 언어로 이름을 고른다 — 한국어로 받은 목록을 영어 화면에서 그려도 "Command Prompt".
// ---------------------------------------------------------------------------

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

describe("shellInfoLabel — 감지된 셸 줄의 이름은 지금 언어로", () => {
  it("cmd 는 백엔드 글자가 어느 언어든 지금 언어의 문구다", () => {
    expect(shellInfoLabel({ id: "cmd", label: "명령 프롬프트" }, en)).toBe("Command Prompt");
    expect(shellInfoLabel({ id: "cmd", label: "Command Prompt" }, ko)).toBe("명령 프롬프트");
  });

  it("고유명은 두 언어가 같다", () => {
    for (const tr of [ko, en]) {
      expect(shellInfoLabel({ id: "pwsh", label: "x" }, tr)).toBe("PowerShell 7");
      expect(shellInfoLabel({ id: "powershell", label: "x" }, tr)).toBe("Windows PowerShell");
      expect(shellInfoLabel({ id: "gitbash", label: "x" }, tr)).toBe("Git Bash");
      expect(shellInfoLabel({ id: "wsl:Ubuntu-24.04", label: "x" }, tr)).toBe("WSL: Ubuntu-24.04");
    }
  });

  it("프런트가 모르는 새 셸은 백엔드 글자, 그것도 없으면 id", () => {
    expect(shellInfoLabel({ id: "nushell", label: "Nushell" }, en)).toBe("Nushell");
    expect(shellInfoLabel({ id: "nushell", label: "  " }, en)).toBe("nushell");
    expect(shellInfoLabel({ id: "nushell" }, en)).toBe("nushell");
  });

  it("Object 프로토타입 이름을 아는 셸로 오인하지 않는다", () => {
    expect(shellInfoLabel({ id: "constructor", label: "C" }, en)).toBe("C");
  });

  it("셸이 없으면 셸을 특정하지 않은 로컬 터미널 이름", () => {
    expect(shellInfoLabel(null, en)).toBe(shellLabel(undefined, en));
    expect(shellInfoLabel(undefined, ko)).toBe(shellLabel(undefined, ko));
  });
});
