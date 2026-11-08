import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUNDLES,
  BUNDLE_GROUPS,
  bundleById,
  bundleCommands,
  commandKey,
  effectiveAllowRules,
  expandBundles,
  isCommandOff,
  type AutomationBundle,
} from "$lib/automation-presets";
import { classifyRisk } from "$lib/operations";

/**
 * 묶음 프리셋(bundle) — 표의 위생 · **TS ↔ Rust 드리프트 잠금** · 펼치기 규칙.
 *
 * 이 표 한 줄이 늘면 그 묶음을 켠 모든 사용자의 무인 실행 범위가 늘어난다. 그래서 테스트가
 * 보는 것은 "코드가 도는가" 가 아니라 **경계가 그대로인가** 다.
 */

/** Rust 쌍둥이 파일 경로 — 저장소 루트 기준(`src/lib/` 에서 두 단계 위). */
const RUST_PRESETS = fileURLToPath(new URL("../../src-tauri/src/automation_presets.rs", import.meta.url));

/**
 * Rust 의 `BUNDLES` 표를 읽어 TS 와 같은 모양으로 만든다.
 *
 * 파서가 기대하는 서식은 `automation_presets.rs` 머리말에 적혀 있다 — 한 규칙 = 한 줄
 * `rule("exec", &["sub", …])` + 체인(`.deny(&[…])`·`.allow(&[…])`·`.require(&[…])`·
 * `.first_arg(&[…])`·`.max_args(n)`), 배열은 인라인, 문자열은 한 줄짜리 리터럴. 정규식으로
 * 충분한 이유는 이 파일이 **표 하나뿐인 데이터 파일**이기 때문이다(문법을 파싱할 일이 없다).
 * 모르는 체인 메서드를 만나면 실패한다(새 칸을 더하고 파서를 잊으면 잠금이 빈 채로 통과하지 않게).
 */
function parseRustBundles(): AutomationBundle[] {
  const src = readFileSync(RUST_PRESETS, "utf8");
  const start = src.indexOf("pub(crate) const BUNDLES: &[Bundle] = &[");
  expect(start, "Rust 에 BUNDLES 표가 있어야 한다").toBeGreaterThanOrEqual(0);
  const body = src.slice(start, src.indexOf("\n];", start));

  // `Bundle {` 마다 덩어리를 자른다(다음 `Bundle {` 직전까지).
  const heads: number[] = [];
  const headRe = /Bundle\s*\{/g;
  for (let m = headRe.exec(body); m !== null; m = headRe.exec(body)) heads.push(m.index);

  return heads.map((from, i) => {
    const chunk = body.slice(from, i + 1 < heads.length ? heads[i + 1] : body.length);
    const field = (name: string): string => {
      const m = new RegExp(`\\b${name}:\\s*"([^"]*)"`).exec(chunk);
      expect(m, `${name} 필드를 못 찾았다: ${chunk.slice(0, 80)}`).not.toBeNull();
      return m![1];
    };
    // 규칙 줄 — 이 덩어리에서 `rule("exec", &[…])` 로 시작하는 줄은 규칙뿐이다.
    const strs = (src: string): string[] => [...src.matchAll(/"([^"]*)"/g)].map((s) => s[1]);
    const rules: AutomationBundle["rules"] = [];
    const ruleRe = /\brule\(\s*"([^"]+)"\s*,\s*&\[([^\]]*)\]\s*\)((?:\.\w+\([^)]*\))*)\s*,/g;
    for (let m = ruleRe.exec(chunk); m !== null; m = ruleRe.exec(chunk)) {
      const rule: AutomationBundle["rules"][number] = { exec: m[1], subcommands: strs(m[2]) };
      for (const c of m[3].matchAll(/\.(\w+)\(([^)]*)\)/g)) {
        const [, method, arg] = c;
        if (method === "deny") rule.deny_flags = strs(arg);
        else if (method === "allow") rule.allow_flags = strs(arg);
        else if (method === "require") rule.require_flags = strs(arg);
        else if (method === "first_arg") rule.first_arg = strs(arg);
        else if (method === "max_args") rule.max_args = Number(arg.trim());
        else if (method === "key") rule.key = strs(arg)[0];
        else if (method === "any_order") rule.any_order = true;
        else throw new Error(`파서가 모르는 체인 메서드: .${method}(…)`);
      }
      rules.push(rule);
    }
    return { id: field("id"), name: field("name"), description: field("description"), rules };
  });
}

describe("BUNDLES 표", () => {
  it("Rust 쌍둥이와 id·이름·설명·규칙·순서까지 같다 (드리프트 잠금)", () => {
    // 구조체 비교 한 번이면 행 하나, 서브커맨드 하나의 차이도 잡힌다.
    expect(parseRustBundles()).toStrictEqual(BUNDLES.map((b) => ({ ...b, rules: b.rules.map((r) => ({ ...r })) })));
  });

  it("파서가 실제로 표를 읽었다 (빈 결과를 통과로 오해하지 않게)", () => {
    const parsed = parseRustBundles();
    expect(parsed.length).toBe(BUNDLES.length);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].rules.length).toBeGreaterThan(5);
  });

  it("id 는 유일하고 이름·설명·규칙이 비지 않는다", () => {
    const ids = new Set<string>();
    for (const b of BUNDLES) {
      expect(ids.has(b.id), `묶음 id 중복: ${b.id}`).toBe(false);
      ids.add(b.id);
      expect(b.name.trim()).not.toBe("");
      expect(b.description.trim()).not.toBe("");
      expect(b.rules.length).toBeGreaterThan(0);
      for (const r of b.rules) {
        expect(r.exec.trim()).not.toBe("");
        for (const f of [...(r.deny_flags ?? []), ...(r.allow_flags ?? []), ...(r.require_flags ?? [])]) {
          expect(f.startsWith("-"), `${b.id}/${r.exec} 의 플래그 항목이 - 로 시작하지 않는다: ${f}`).toBe(true);
        }
        for (const s of r.subcommands) {
          expect(s.trim()).not.toBe("");
          expect(s.startsWith("-"), `${b.id}/${r.exec} 의 서브커맨드가 플래그다: ${s}`).toBe(false);
        }
      }
    }
  });

  it("보안 검토의 못 — 뺀 실행 파일들이 다시 들어오지 않는다", () => {
    // `find`(-delete·-exec) · `env`/`printenv`(비밀) · `top`(대화형) + 파괴적 동사들.
    const forbidden = new Set([
      "find", "env", "printenv", "top", "rm", "rmdir", "dd", "mkfs", "sudo", "su", "chmod",
      "chown", "kill", "killall", "pkill", "reboot", "shutdown", "halt", "poweroff",
      "truncate", "sh", "bash", "zsh", "eval",
    ]);
    for (const b of BUNDLES) {
      for (const r of b.rules) expect(forbidden.has(r.exec), `${b.id} 에 금지된 exec: ${r.exec}`).toBe(false);
    }
  });

  it("규칙이 스스로를 배반하지 않는다 — 위험 분류되는 항목은 죽은 규칙이다", () => {
    for (const b of BUNDLES) {
      for (const r of b.rules) {
        expect(classifyRisk(r.exec), `${b.id}/${r.exec}`).toBe("safe");
        for (const s of r.subcommands) {
          expect(classifyRisk(`${r.exec} ${s}`), `${b.id}/${r.exec} ${s}`).toBe("safe");
        }
      }
    }
  });
});

describe("expandBundles · effectiveAllowRules", () => {
  it("모르는 id 는 조용히 건너뛴다 (설정은 보존하고 해석만 안 한다)", () => {
    expect(expandBundles(["from-the-future"])).toEqual([]);
    expect(expandBundles(["from-the-future", "git"])).toHaveLength(bundleById("git")!.rules.length);
    expect(bundleById("from-the-future")).toBeUndefined();
  });

  it("아는 id 는 규칙으로 펼쳐진다 — 서브커맨드가 있으면 sub_first, ip 만 예외", () => {
    const rules = expandBundles(["git"]);
    expect(rules).toEqual(bundleById("git")!.rules.map((r) => ({ ...r, sub_first: true })));
    expect(rules[0].subcommands).toEqual(["status"]);
    expect(rules.find((r) => r.subcommands[0] === "branch")?.max_args).toBe(0);
    const ip = expandBundles(["network"]).filter((r) => r.exec === "ip");
    expect(ip.length).toBe(5); // addr · route · link · a/address · neigh
    expect(ip.every((r) => r.sub_first === undefined && !("any_order" in r))).toBe(true);
    // 표 전용 칸(key·any_order)은 떼어 낸다.
    expect(expandBundles(["system"]).some((r) => "key" in r)).toBe(false);
    // 표를 복제해 내보낸다 — 부르는 쪽이 고쳐도 원본 표가 오염되지 않는다(인자 제약 배열까지).
    rules[0].subcommands.push("push");
    rules[0].deny_flags!.push("-x");
    expect(bundleById("git")!.rules[0].subcommands).not.toContain("push");
    expect(bundleById("git")!.rules[0].deny_flags).not.toContain("-x");
  });

  it("끈 명령은 빠진다 — 같은 키의 줄은 함께, 모르는 묶음·키는 아무 일도 안 한다", () => {
    const off = { docker: ["docker compose", "zzz"], nope: ["ls"] };
    const rules = expandBundles(["docker", "files"], off);
    expect(rules.some((r) => r.subcommands[0] === "compose")).toBe(false);
    expect(rules.some((r) => r.subcommands[0] === "ps")).toBe(true);
    expect(rules.some((r) => r.exec === "ls")).toBe(true);
    expect(isCommandOff(off, "docker", "docker compose")).toBe(true);
    expect(isCommandOff(off, "files", "docker compose")).toBe(false);
    expect(isCommandOff(undefined, "files", "cat")).toBe(false);
  });

  it("사용자 규칙 + 묶음 규칙의 합집합이고, 사용자 규칙이 앞이다", () => {
    const rules = effectiveAllowRules({
      allow: [{ exec: "mytool", subcommands: [] }],
      bundles: ["git"],
    });
    expect(rules[0]).toEqual({ exec: "mytool", subcommands: [] });
    expect(rules.some((r) => r.exec === "git")).toBe(true);
  });

  it("묶음을 켜지 않으면 아무 규칙도 생기지 않는다 (기본 거부 그대로)", () => {
    expect(effectiveAllowRules({ allow: [], bundles: [] })).toEqual([]);
  });
});

describe("명령 키 · 소제목", () => {
  it("명령 키 — key 가 있으면 그것, 서브커맨드 하나면 exec sub, 아니면 exec (Rust command_key 와 같다)", () => {
    expect(commandKey({ exec: "tail", subcommands: [] })).toBe("tail");
    expect(commandKey({ exec: "docker", subcommands: ["logs"] })).toBe("docker logs");
    expect(commandKey({ exec: "systemctl", subcommands: ["status", "cat"] })).toBe("systemctl");
    expect(commandKey({ exec: "hostnamectl", subcommands: ["status"], key: "hostnamectl" })).toBe("hostnamectl");
  });

  it("한 명령 키는 한 묶음에만 있고, 같은 키의 줄은 한 스위치로 모인다", () => {
    const seen = new Map<string, string>();
    for (const b of BUNDLES) {
      for (const c of bundleCommands(b)) {
        expect(seen.has(c.key), `${c.key} 가 ${seen.get(c.key)} 와 ${b.id} 둘에 있다`).toBe(false);
        seen.set(c.key, b.id);
      }
    }
    const sys = bundleCommands(bundleById("system")!);
    expect(sys.find((c) => c.key === "timedatectl")?.rules.length).toBe(2);
    expect(bundleCommands(bundleById("docker")!).find((c) => c.key === "docker compose")?.rules.length).toBe(2);
  });

  it("소제목 넷이 묶음 열 개를 표 순서대로 빠짐없이 한 번씩 담는다", () => {
    expect(BUNDLE_GROUPS.flatMap((g) => g.bundles)).toEqual(BUNDLES.map((b) => b.id));
    expect(BUNDLE_GROUPS.filter((g) => g.caution).map((g) => g.id)).toEqual(["data"]);
  });
});
