/**
 * 자동 승인 **정책 평가기** — 로드맵 **단계 10b**
 * (docs/log/2026-09-10-auto-approval.md). **순수 함수만** 있는 모듈이다(상태·DOM 없음).
 *
 * ## 이 파일이 실행하지 않는다는 것
 *
 * 여기서 하는 일은 "이 작업안을 자동으로 승인해도 되는가?" 라는 **판정**뿐이다. `true` 여도
 * 실제 승인·실행은 관제판(`Console.svelte`)이 **기존** `approveOperation`(Tauri 명령)을
 * 부르는 것이고, 그 경로는 단계 9 그대로다 — 새 실행 경로도, 새 MCP 표면도 없다. AI 는
 * 여전히 self-approve 를 못 한다(approve 는 MCP 도구가 아니다).
 *
 * ## 경계는 백엔드다 — 이 파일은 자문·사전 점검
 *
 * **진짜 경계는 Rust `src-tauri/src/policy.rs` 다.** `approve_operation` 이 `method:"auto"` 를
 * 받으면 아래와 **같은 다섯 조건**을 독립적으로 다시 강제한다 — 이 파일이 버그거나 우회돼도
 * 정책 밖 자동 승인은 백엔드에서 거부된다. 여기 판정은 (1) 쓸모없는 자동 호출을 미리 거르는
 * 사전 점검과 (2) UI 자문(위험 배지)일 뿐이다. **이 규칙을 바꾸면 `policy.rs` 도 함께 고친다
 * (드리프트 방지 — 양쪽이 같은 케이스로 검증된다).**
 *
 * ## 세 겹 배제 (아래 다섯 조건 중 셋이 "위험을 뺀다")
 *
 * 1. **기본 끔** — `prefs.auto_approve` 가 켜져 있어야 한다.
 * 2. **위험 명령 제외** — `classifyRisk` 가 `"dangerous"` 면 절대 자동 승인 안 됨(②는 ③ 위에서
 *    항상 조인다: 위험 판정이 allowlist 매칭을 이긴다). **판정은 구획(segment)마다** 한다.
 * 3. **구획 분해 + 셸 메타문자 제외** — 명령을 **따옴표 밖** 체이닝 연산자(`&&` `||` `;`)로
 *    나누고, 구획 안에 파이프(`|`)·리다이렉트(`>` `<`)·치환(`` ` `` `$`)·묶음(`(` `)` `{` `}`)·
 *    개행·따옴표 밖 역슬래시·백그라운드 `&` 가 하나라도 있으면 통째로 수동으로 넘긴다
 *    ([`segmentsForAutoApproval`]). allowlist 를 `df` 로 열어 둔 사용자를 `df; rm -rf /` 가
 *    우회하지 못하게 하는 문은 그대로다 — 이제 **각 구획이 저마다** ②④를 통과해야 한다.
 * 4. **allowlist 매칭** — **모든 구획**이 어떤 패턴으로 **단어 경계 prefix** 시작하거나 구조적
 *    규칙에 맞아야 한다. `cd` 도 예외가 아니다(목록에 없으면 `cd x && ls` 는 수동이다 — 작업
 *    디렉터리는 작업안의 `cwd` 로 주는 것이 제 길이다).
 * 5. **상한 이내** — 대상 수가 `prefs.max_targets` 를 넘지 않아야 한다(백엔드가 승인 진입에서
 *    한 번 더 강제하는 하드 경계의 프런트 쪽 반영).
 *
 * 다섯이 **모두 참일 때만** true. 하나라도 아니면 false(= 수동).
 */

import { effectiveAllowRules } from "$lib/automation-presets";
import { classifyRisk } from "$lib/operations";
import type { AllowRule, AutomationPrefs } from "$lib/settings.svelte.js";

/**
 * 자동 승인을 막는 **셸 메타문자** 집합 — 이제 **작업 디렉터리(`cwd`) 전용 그물**이다.
 *
 * 명령 자체는 [`segmentsForAutoApproval`] 이 따옴표를 아는 분해기로 본다. 하지만 `cwd` 는
 * 명령이 아니라 **디렉터리 문자열**이라 체이닝을 허용할 이유가 없다 — Rust
 * `approval_reject_reason` 이 자동 승인의 `cwd` 를 이 집합으로 계속 거른다(규칙 불변).
 * 체이닝(`;` `|` `&`) · 치환(`` ` `` `$`) · 리다이렉트(`>` `<`) · 묶음/서브셸(`(` `)`) ·
 * 개행(`\n` `\r`) · 이스케이프(`\`).
 */
const SHELL_METACHARS = /[;|&`$><()\n\r\\]/;

/**
 * 문자열에 셸 메타문자가 하나라도 있는가 (순수) — Rust `has_shell_metachar` 와 같은 집합.
 *
 * 명령 판정에는 더 쓰지 않는다([`segmentsForAutoApproval`] 이 그 자리를 가져갔다). 남은 쓰임은
 * 자동 승인의 **`cwd` 검사** 하나이고, 그 규칙은 바뀌지 않았다.
 */
export function hasShellMetachar(command: string): boolean {
  return SHELL_METACHARS.test(command);
}

/**
 * 명령을 자동 승인 후보 **구획(segment)들**로 나눈다 — 못 나누면 `null`(= 자동 승인 불가). 순수.
 *
 * Rust `policy.rs segments_for_auto_approval` 과 **한 글자도 다르지 않은 의미**여야 한다
 * (드리프트 잠금 — 양쪽이 같은 표로 검증된다).
 *
 * ## 왜 나누나
 *
 * AI CLI 는 `cd /srv && ls -la` 처럼 **체이닝을 일상적으로 쓴다**. 예전 규칙(메타문자 하나라도
 * 있으면 탈락)에서는 자동 승인이 사실상 발화하지 않았다. 그래서 체이닝만은 **구획 단위로**
 * 본다: 나눈 뒤 **각 구획이 저마다** 위험 아님 + allowlist 를 통과해야 한다. 바닥(floor)은
 * 그대로다 — 한 구획이라도 걸리면 명령 전체가 수동으로 간다.
 *
 * ## 분해기 (보수적 토크나이저)
 *
 * - `'…'` 안은 통짜 literal(안에 이스케이프 없음), `"…"` 안은 `\"`·`\\` 만 이스케이프.
 * - 따옴표가 **안 닫히면** `null`. 따옴표 **안의** `&&` `||` `;` 는 literal이라 나누지 않는다.
 * - 따옴표 **밖**의 `&&` `||` `;` 에서 나눈다.
 * - **어디에 있든 탈락**: `$` · `` ` ``(따옴표 안에서도 살아 있는 치환) · 개행/CR.
 * - **따옴표 밖에서 탈락**: 홑 `|`(파이프) · 홑 `&`(백그라운드) · `>` `<` · `(` `)` · `{` `}` ·
 *   `\`(이스케이프).
 * - 구획은 trim 한다. **빈 구획이 하나라도 있으면 `null`**(`a && ` · `;;` · 빈 명령).
 *
 * `$` 를 통째로 막는 것은 의도다 — 변수가 경로를 숨길 수 있어(`$HOME/x`) 여기서는 풀지 않는다.
 */
export function segmentsForAutoApproval(command: string): string[] | null {
  const r = splitCore(command, false);
  return Array.isArray(r) ? r : null;
}

/**
 * **정책이 보는 구획** — 파이프 허용(`allow_pipes`, 10-22 옵트인)까지. Rust `policy.rs split_for_policy` 와 같은 의미(공유 표
 * `args_cases.json` 의 `pipes` 가 잠근다). 꺼져 있으면 [`segmentsForAutoApproval`] 그대로. 켜져 있고 **파이프로만** 실패했으면 맨 `|` 와
 * `&&` 에서 나눈다(`;` · `||` 섞임 · `|&` 는 탈락, 나머지 탈락은 예전과 같다). `null` = 자동 불가.
 */
export function splitForPolicy(command: string, allowPipes: boolean): { segments: string[]; pipeline: boolean } | null {
  const r = splitCore(command, false);
  if (Array.isArray(r)) return { segments: r, pipeline: false };
  if (r === "pipe" && allowPipes) {
    const p = splitCore(command, true);
    return Array.isArray(p) ? { segments: p, pipeline: true } : null;
  }
  return null;
}

/** 파이프라인 단계에서 늘 거절하는 프로그램 — Rust `PIPE_REFUSED` 와 같은 목록(바꾸면 함께) */
export const PIPE_REFUSED: readonly string[] = [
  "xargs", "parallel", "sh", "bash", "zsh", "dash", "ksh", "fish", "busybox", "env", "eval", "exec", "command", "builtin",
  "source", ".", "nohup", "time", "timeout", "watch", "nice", "ionice", "stdbuf", "chrt", "taskset", "sudo", "su", "doas",
  "pkexec", "ssh", "python", "python3", "perl", "ruby", "node", "php", "lua", "tee",
];

/** 파이프라인 단계 하나를 늘 거절하는가 — Rust `pipe_stage_refused` 와 같은 판정 */
export function pipeStageRefused(segment: string): boolean {
  const words = shellWords(segment);
  if (words === null || words.length === 0) return true;
  const first = words[0];
  if (first.includes("=")) return true;
  const exec = basename(first);
  if (PIPE_REFUSED.includes(exec)) return true;
  const args = words.slice(1);
  if (exec === "find") return args.some((a) => ["-exec", "-execdir", "-ok", "-okdir", "-delete"].includes(a));
  if (["awk", "gawk", "mawk", "nawk"].includes(exec)) return args.some((a) => a.includes("system") || a.includes("|"));
  return false;
}

/** 분해의 몸 — `pipes` 면 파이프라인 꼴. 구획들 · `"pipe"`(홑 `|` 로만 걸렸다 — 파이프 꼴이 아닐 때) · `null`(그 밖의 탈락) */
function splitCore(command: string, pipes: boolean): string[] | "pipe" | null {
  const segments: string[] = [];
  let cur = "";
  /** 따옴표 상태: 0=밖, 1=`'…'`, 2=`"…"`. */
  let quote: 0 | 1 | 2 = 0;
  let i = 0;

  const push = (): boolean => {
    const seg = cur.trim();
    cur = "";
    if (seg === "") return false; // 빈 구획 — `a && ` · `;;` · 앞이 빈 `&& a`.
    segments.push(seg);
    return true;
  };

  while (i < command.length) {
    const c = command[i];
    // 어디에 있든(따옴표 안에서도) 탈락시키는 것들: 치환과 개행.
    // `"$(x)"`·``"`x`"`` 는 큰따옴표 안에서도 살아 있으므로 상태와 무관하게 막는다.
    if (c === "$" || c === "`" || c === "\n" || c === "\r") return null;

    if (quote === 1) {
      // 홑따옴표 안 — 닫힘만 본다(이스케이프 없음).
      if (c === "'") quote = 0;
      cur += c;
      i += 1;
      continue;
    }
    if (quote === 2) {
      // 겹따옴표 안 — `\"`·`\\` 만 한 쌍으로 삼킨다(닫힘 판정이 어긋나지 않게).
      if (c === "\\" && (command[i + 1] === '"' || command[i + 1] === "\\")) {
        cur += c + command[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') quote = 0;
      cur += c;
      i += 1;
      continue;
    }

    // ── 따옴표 밖 ──────────────────────────────────────────────────────────────
    if (c === "'") {
      quote = 1;
      cur += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      quote = 2;
      cur += c;
      i += 1;
      continue;
    }
    if (c === "&") {
      if (command[i + 1] !== "&") return null; // 홑 `&` = 백그라운드 실행 — 탈락.
      if (!push()) return null;
      i += 2;
      continue;
    }
    if (c === "|") {
      if (command[i + 1] !== "|") {
        if (!pipes) return "pipe"; // 홑 `|` = 파이프 — 탈락(파이프 허용이면 파이프라인 꼴로 다시 본다).
        if (command[i + 1] === "&") return null; // `|&` — 오류까지 넘기는 파이프
        if (!push()) return null; // 파이프라인 단계 하나를 봉한다
        i += 1;
        continue;
      }
      if (pipes) return null; // 파이프와 `||` 는 섞지 않는다
      if (!push()) return null;
      i += 2;
      continue;
    }
    if (c === ";") {
      if (pipes) return null; // 파이프와 `;` 는 섞지 않는다
      if (!push()) return null;
      i += 1;
      continue;
    }
    if (c === ">" || c === "<" || c === "(" || c === ")" || c === "{" || c === "}" || c === "\\") {
      return null; // 리다이렉트 · 서브셸 · 그룹 · 이스케이프.
    }
    cur += c;
    i += 1;
  }

  if (quote !== 0) return null; // 안 닫힌 따옴표 — 무엇이 명령인지 알 수 없다.
  if (!push()) return null; // 마지막 구획(빈 꼬리 `a && ` 도 여기서 탈락).
  return segments;
}

/**
 * 명령이 allowlist 의 어떤 항목으로 **단어 경계 prefix** 시작하는가 (순수).
 *
 * 패턴 `"df"` 는 `df`(정확히 일치)·`df -h`(뒤가 공백)를 매칭하고 `dfx`(뒤가 단어 문자)는
 * 매칭하지 않는다 — prefix 뒤가 문자열 끝이거나 공백일 때만 통과시킨다. 패턴은 공백을 떼고,
 * 빈 패턴은 건너뛴다(빈 패턴이 모든 명령을 매칭하는 사고를 막는다).
 */
export function matchesAllowlist(command: string, patterns: readonly string[]): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) continue;
    if (cmd === p) return true;
    // prefix 로 시작하고, 그 바로 뒤가 공백이어야 한다(단어 경계). 자동 경로는 **구획 하나**를
    // 넘겨 오고 구획에는 체이닝·메타문자가 없으므로, 여기서 만나는 구분자는 사실상 공백뿐이다.
    if (cmd.startsWith(p) && /\s/.test(cmd.charAt(p.length))) return true;
  }
  return false;
}

/**
 * 명령이 **구조적 allowlist**(A4b)의 어떤 규칙에 맞는가 — Rust `matches_structured_allow` 와
 * **정확히 같은 의미**(드리프트 잠금; 양쪽이 같은 표 `src-tauri/src/policy/args_cases.json` 으로
 * 검증된다). 평탄한 `matchesAllowlist` 를 좁힌 것으로, exec+서브커맨드 단위 위임을 검증하고,
 * 규칙이 인자 제약을 가지면 그것까지 본다.
 *
 * 토큰화·판정(자동 경로는 **구획 하나**를 넘겨 오고 구획에는 메타문자가 없어 공백 분해가 안전하다):
 * - 명령을 공백으로 토큰화한다.
 * - `exec` = 첫 토큰의 **basename**(`/` 로 나눠 마지막 — `/usr/bin/systemctl` → `systemctl`).
 * - `subcommand` = exec 이후 **`-` 로 시작하지 않는 첫 토큰**(플래그는 건너뛴다). 없으면 부재.
 * - exec 가 (정확·대소문자 구분) 같은 규칙을 찾는다. 없으면 `false`.
 * - 그 규칙의 `subcommands` 가 **비면** exec 만으로, 아니면 subcommand 가 부재가 아니고 그 목록에
 *   있을 때 1차 통과.
 * - 1차 통과한 규칙이 **인자 제약**을 하나라도 가지면 [`argConstraintsHold`] 까지 참이어야 한다.
 *   제약이 없는 옛 모양 규칙은 예전과 글자 그대로 같은 판정이다.
 * - 같은 exec 의 규칙이 여럿이면 OR. **모호하면 `false` 쪽으로**(수동 승인으로 떨어지는 안전한 방향).
 */
export function matchesStructuredAllow(command: string, rules: readonly AllowRule[]): boolean {
  const tokens = command.split(/\s+/).filter((t) => t !== "");
  if (tokens.length === 0) return false;
  // exec = 첫 토큰의 basename (경로 구분자 `/` 뒤 마지막 조각).
  const exec = basename(tokens[0]);
  if (!exec) return false;
  // subcommand = exec 이후 `-` 로 시작하지 않는 첫 토큰(플래그는 건너뛴다). 없으면 undefined.
  const subcommand = tokens.slice(1).find((t) => !t.startsWith("-"));
  // 따옴표를 벗긴 낱말 — 인자 제약이 있는 규칙을 처음 만났을 때 한 번만 만든다.
  let words: string[] | null | undefined;

  for (const rule of rules) {
    if (rule.exec !== exec) continue;
    // 1차 — exec+서브커맨드(옛 의미 그대로).
    if (rule.subcommands.length > 0) {
      if (subcommand === undefined || !rule.subcommands.includes(subcommand)) continue;
    }
    if (!ruleHasArgConstraints(rule)) return true; // 옛 모양 — 인자는 보지 않는다(하위 호환).
    if (words === undefined) words = shellWords(command);
    if (words === null) continue; // 낱말로 못 나눔 — 제약을 확인할 수 없으니 불통.
    const rawSub = rule.subcommands.length === 0 ? undefined : subcommand;
    if (argConstraintsHold(rule, exec, rawSub, words)) return true;
  }
  return false;
}

/** 경로의 마지막 조각 — `/usr/bin/git` → `git`. */
function basename(token: string): string {
  const slash = token.lastIndexOf("/");
  return slash === -1 ? token : token.slice(slash + 1);
}

/** 규칙이 인자 제약을 하나라도 갖는가 — 없으면 옛 exec+서브커맨드 판정 그대로다. */
function ruleHasArgConstraints(rule: AllowRule): boolean {
  return (
    (rule.deny_flags?.length ?? 0) > 0 ||
    (rule.allow_flags?.length ?? 0) > 0 ||
    (rule.require_flags?.length ?? 0) > 0 ||
    (rule.first_arg?.length ?? 0) > 0 ||
    rule.max_args !== undefined ||
    rule.sub_first === true
  );
}

/**
 * 구획 하나를 **셸이 보는 낱말**로 — 따옴표를 벗긴다. 못 하면 `null` (순수). Rust `shell_words` 와 같다.
 *
 * 낱말 경계는 ASCII 공백(스페이스·탭·VT·FF)뿐이다 — 셸처럼 비ASCII 공백은 글자다. `'…'` 는 통째로,
 * `"…"` 안은 `\"`·`\\` 만 이스케이프. 따옴표 밖 `\`·개행은 `null`. `''` 는 빈 낱말 하나다.
 */
export function shellWords(segment: string): string[] | null {
  const chars = Array.from(segment);
  const words: string[] = [];
  let cur = "";
  let inWord = false;
  let quote: "none" | "single" | "double" = "none";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (quote === "single") {
      if (c === "'") quote = "none";
      else cur += c;
    } else if (quote === "double") {
      if (c === "\\" && (chars[i + 1] === '"' || chars[i + 1] === "\\")) {
        cur += chars[i + 1];
        i++;
      } else if (c === '"') quote = "none";
      else cur += c;
    } else if (c === " " || c === "\t" || c === "\u000b" || c === "\u000c") {
      if (inWord) {
        words.push(cur);
        cur = "";
        inWord = false;
      }
    } else if (c === "'") {
      quote = "single";
      inWord = true;
    } else if (c === '"') {
      quote = "double";
      inWord = true;
    } else if (c === "\\" || c === "\n" || c === "\r") {
      return null;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (quote !== "none") return null;
  if (inWord) words.push(cur);
  return words;
}

/** 낱말이 플래그인가 — `-` 로 시작하고 두 글자 이상(홀로 선 `-` 는 표준 입력이라는 인자다). */
function isFlag(word: string): boolean {
  return Array.from(word).length >= 2 && word.startsWith("-");
}

/** 짧은 플래그 묶음인가 — `-x…`(이중 대시가 아님). */
function isShortCluster(word: string): boolean {
  return isFlag(word) && !word.startsWith("--");
}

/** 짧은 한 글자 패턴(`-x`)이면 그 글자. `--` 는 아니다. */
function shortLetter(pattern: string): string | undefined {
  const cs = Array.from(pattern);
  return cs.length === 2 && cs[0] === "-" && cs[1] !== "-" ? cs[1] : undefined;
}

/** `--name=value` · `-name=value` 의 이름 쪽. */
function flagName(word: string): string {
  const eq = word.indexOf("=");
  return eq === -1 ? word : word.slice(0, eq);
}

/** 끝의 `*` 를 떼고 [줄기, 접두 여부]. */
function splitWild(pattern: string): [string, boolean] {
  return pattern.endsWith("*") ? [pattern.slice(0, -1), true] : [pattern, false];
}

/** `deny_flags` 항목의 형식 — `-` 로 시작하고 `*` 는 끝에만. 틀리면 그 규칙은 매칭되지 않는다. */
function denyPatternOk(pattern: string): boolean {
  const [stem] = splitWild(pattern);
  return pattern.startsWith("-") && !stem.includes("*");
}

/**
 * 금지 패턴 하나가 플래그 낱말에 걸리는가 — Rust `deny_hits` 와 같다.
 * `-x` 는 짧은 묶음 안 어디든, `--name` 은 이름·접두(`*`)·줄임(`--fol`), `-name` 은 대시 하나 낱말에.
 */
function denyHits(pattern: string, word: string): boolean {
  const [stem, wild] = splitWild(pattern);
  const name = flagName(word);
  const longMatch = (minAbbrev: number): boolean =>
    (wild ? name.startsWith(stem) : name === stem) ||
    (Array.from(name).length >= minAbbrev && stem.startsWith(name));
  if (stem.startsWith("--")) return word.startsWith("--") && longMatch(3);
  const letter = wild ? undefined : shortLetter(stem);
  if (letter !== undefined) return isShortCluster(word) && Array.from(word).slice(1).includes(letter);
  return isShortCluster(word) && longMatch(2);
}

/** `allow_flags` 가 플래그 낱말 하나를 허용하는가 — 이름(`*` 끝은 접두), 또는 짧은 묶음의 글자마다. */
function flagAllowed(list: readonly string[], word: string): boolean {
  const name = flagName(word);
  const named = list.some((p) => {
    const [stem, wild] = splitWild(p);
    return wild ? name.startsWith(stem) : name === stem;
  });
  if (named) return true;
  return (
    isShortCluster(word) &&
    Array.from(word)
      .slice(1)
      .every((c) => list.some((p) => shortLetter(p) === c))
  );
}

/** 필수 플래그 하나가 있는가 — 정확히(짧은 한 글자면 값 없는 묶음 안에), 그리고 값 붙은 꼴이 없을 때. */
function requiredPresent(pattern: string, flags: readonly string[]): boolean {
  const letter = shortLetter(pattern);
  const found = flags.some(
    (w) =>
      w === pattern ||
      (letter !== undefined &&
        isShortCluster(w) &&
        !w.includes("=") &&
        Array.from(w).slice(1).includes(letter)),
  );
  const poisoned = flags.some((w) => w.includes("=") && flagName(w) === pattern);
  return found && !poisoned;
}

/** `first_arg` 패턴이 인자 하나에 맞는가 — 정확히, 또는 끝의 `*` 면 접두. */
function argMatches(pattern: string, arg: string): boolean {
  const [stem, wild] = splitWild(pattern);
  return wild ? arg.startsWith(stem) : arg === stem;
}

/**
 * 규칙의 **인자 제약**이 이 낱말들에서 지켜지는가 (순수) — Rust `arg_constraints_hold` 와 같다.
 *
 * `words[0]` 의 basename 이 `exec` 여야 하고, 규칙에 서브커맨드가 있으면 첫 비플래그 낱말이
 * `rawSub`(공백 분해로 찾은 것)와 같아야 한다(두 분해가 어긋나면 불통). 플래그 = `--` 앞의 `-…`
 * 낱말, 인자 = 서브커맨드(없으면 exec) 뒤의 비플래그 낱말. 그 위에서 deny · allow · require ·
 * first_arg · max_args 를 차례로 본다.
 */
function argConstraintsHold(
  rule: AllowRule,
  exec: string,
  rawSub: string | undefined,
  words: readonly string[],
): boolean {
  const deny = rule.deny_flags ?? [];
  const allow = rule.allow_flags ?? [];
  const require = rule.require_flags ?? [];
  const firstArg = rule.first_arg ?? [];
  if (!deny.every(denyPatternOk)) return false;
  if (words.length === 0 || basename(words[0]) !== exec) return false;
  // 서브커맨드는 exec 바로 다음 낱말이어야 한다 — 앞 플래그의 값이 서브커맨드로 위장하지 못하게
  // (`git -C status push`). Rust `arg_constraints_check` 의 `sub_first` 와 같다.
  if (rule.sub_first === true && rawSub !== undefined && words[1] !== rawSub) return false;
  const flags: string[] = [];
  const positionals: string[] = [];
  let afterDd = false;
  for (const w of words.slice(1)) {
    if (afterDd) positionals.push(w);
    else if (w === "--") afterDd = true;
    else if (isFlag(w)) flags.push(w);
    else positionals.push(w);
  }
  let args: string[];
  if (rawSub !== undefined) {
    if (positionals[0] !== rawSub) return false;
    args = positionals.slice(1);
  } else {
    args = positionals;
  }

  if (flags.some((w) => deny.some((p) => denyHits(p, w)))) return false;
  if (allow.length > 0 && !flags.every((w) => flagAllowed(allow, w))) return false;
  if (!require.every((p) => requiredPresent(p, flags))) return false;
  if (firstArg.length > 0 && args.length > 0 && !firstArg.some((p) => argMatches(p, args[0])))
    return false;
  if (rule.max_args !== undefined && args.length > rule.max_args) return false;
  return true;
}

/**
 * 명령 문자열이 **자동 승인의 명령 술어**를 통과하는가 (순수) — 대상 수·토글과 무관한 부분.
 *
 * Rust `policy.rs command_passes_auto_policy` 와 같은 의미다. 셋을 본다:
 * 1. [`segmentsForAutoApproval`] 로 구획 분해에 성공할 것(실패 = 자동 불가).
 * 2. **모든 구획**이 위험하지 않을 것(`classifyRisk` — ②는 ③ 위에서 조인다).
 * 3. **모든 구획**이 평탄 prefix **또는** 구조적 규칙에 맞을 것(OR 은 매칭 방식에만 적용된다).
 *
 * 구획이 하나면 예전과 정확히 같은 판정이다. 여럿이면 **가장 약한 구획이 전체를 끌어내린다**.
 *
 * 구조적 규칙은 사용자가 적은 `allow` **와 켜진 묶음이 펼친 규칙의 합집합**이다
 * ([`effectiveAllowRules`]) — Rust 도 디스크의 `bundles` 를 읽어 같은 합집합을 본다.
 */
export function commandPassesAutoPolicy(command: string, prefs: AutomationPrefs): boolean {
  // 파이프 허용(10-22 옵트인)이 꺼져 있으면 예전 분해 그대로 — 켜져 있으면 파이프라인 단계마다 다시 거른다(Rust 와 같다).
  const split = splitForPolicy(command, prefs.allow_pipes === true);
  if (split === null) return false;
  const { segments, pipeline } = split;
  if (pipeline && segments.some((s) => pipeStageRefused(s))) return false;
  // 구획마다 같은 목록을 본다 — 펼치기는 루프 밖에서 한 번만.
  const rules = effectiveAllowRules(prefs);
  for (const seg of segments) {
    if (classifyRisk(seg) !== "safe") return false;
    // allowlist 매칭 = 평탄한 prefix(하위 호환) **OR** 구조적 규칙(A4b + 묶음). 무엇으로
    // 매칭돼도 바닥(floor)은 변하지 않는다 — 위험 아님·구획 분해 성공은 그대로 AND 다.
    if (!matchesAllowlist(seg, prefs.allow_patterns) && !matchesStructuredAllow(seg, rules))
      return false;
  }
  return true;
}

/**
 * 서브커맨드처럼 **보이는** 토큰인가 — 글자로 시작하고 영문자·숫자·`-`·`_` 로만 이뤄진 것
 * (순수). `-` 로 시작하는 플래그, 경로(`/var/log`), 값(`80`), 확장자 있는 파일 이름은 아니다.
 *
 * 보수적으로 본다: 애매하면 "서브커맨드 아님" 으로 떨어져 [`proposeAllowRules`] 가 **exec 만**
 * 제안하고, 그 확장은 승인 카드가 미리보기로 사용자에게 먼저 보여 준다.
 */
function looksLikeSubcommand(token: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(token);
}

/**
 * 이 명령을 앞으로 자동 승인하려면 허용 목록에 **무엇을 더해야 하는가** — "승인하면서 배우기"
 * 의 순수 제안기 (docs/log/2026-09-16-auto-approval-bundles.md). 아무것도 제안하지 않으면
 * 빈 배열이다(그 경우 승인 카드는 체크박스를 아예 내주지 않는다).
 *
 * ## 제안 규칙
 *
 * 1. 명령을 [`segmentsForAutoApproval`] 로 나눈다. **못 나누면 빈 배열** — 파이프·치환·
 *    리다이렉트가 섞인 명령은 목록을 넓혀도 자동 승인되지 않으므로 제안할 것이 없다.
 * 2. 구획 중 **하나라도 위험**하면(`classifyRisk`) **빈 배열**. 위험 배제는 allowlist 위에서
 *    항상 조이므로, 목록에 넣어 봐야 죽은 규칙이 될 뿐이다(사용자를 속이지 않는다).
 * 3. 구획마다 `exec` = 첫 토큰의 basename, `subcommand` = **둘째 토큰**이 서브커맨드처럼
 *    보이면 그것 하나. 플래그(`df -h`)·경로·숫자면 서브커맨드 없음 = **exec 통째로**.
 * 4. 이미 `existing`(= 지금 실제로 먹는 규칙 전부 — 사용자 규칙 + 묶음)이 덮는 구획은 건너뛴다.
 * 5. 제안끼리도 중복을 접는다(같은 exec 의 서브커맨드는 한 규칙으로 모인다).
 *
 * ## 세분성의 한계 (정직하게)
 *
 * 제안은 **exec + 서브커맨드 하나**까지다. 인자 제약은 만들지 않는다 — `systemctl --user status`
 * 처럼 둘째 토큰이 플래그면 `systemctl` 이 통째로 열린다. 그래서 승인 카드는 제안을 **그대로
 * 미리보기로 보여 주고**, 저장은 사용자가 체크박스를 눌렀을 때만 한다.
 */
export function proposeAllowRules(
  command: string,
  existing: readonly AllowRule[],
): AllowRule[] {
  const segments = segmentsForAutoApproval(command);
  if (segments === null) return []; // 토크나이저 탈락 — 넓혀도 자동 승인이 안 된다.

  // 위험 구획이 하나라도 있으면 제안 자체를 하지 않는다(②는 ③ 위에서 항상 조인다).
  for (const seg of segments) if (classifyRisk(seg) !== "safe") return [];

  const out: AllowRule[] = [];
  for (const seg of segments) {
    // 이미 먹는 구획은 제안할 것이 없다. 평탄 prefix 로 덮이는 경우는 여기서 보지 않는다 —
    // 제안은 구조적 규칙만 만들고, 부르는 쪽이 `commandPassesAutoPolicy` 로 이미 걸렀다.
    if (matchesStructuredAllow(seg, [...existing, ...out])) continue;

    const tokens = seg.split(/\s+/).filter((t) => t !== "");
    if (tokens.length === 0) continue;
    const first = tokens[0];
    const slash = first.lastIndexOf("/");
    const exec = slash === -1 ? first : first.slice(slash + 1);
    if (!exec) continue;
    const second = tokens[1];
    const sub = second !== undefined && looksLikeSubcommand(second) ? second : undefined;

    const already = out.find((r) => r.exec === exec);
    if (!already) {
      out.push({ exec, subcommands: sub === undefined ? [] : [sub] });
      continue;
    }
    // 같은 exec 을 또 만났다 — 넓은 쪽(빈 목록 = 전체)이 이긴다.
    if (already.subcommands.length === 0) continue;
    if (sub === undefined) already.subcommands = [];
    else if (!already.subcommands.includes(sub)) already.subcommands.push(sub);
  }
  return out;
}

/**
 * 이 명령·대상 수를 **자동 승인해도 되는가** — 다섯 조건이 모두 참일 때만 `true` (순수).
 *
 * 모듈 머리말의 다섯 조건을 그대로 AND 로 엮는다. 순서는 싼 것·잘 거르는 것부터다
 * (`auto_approve` → 구획 분해·구획별 위험·구획별 allowlist → 상한).
 */
export function shouldAutoApprove(
  command: string,
  targetCount: number,
  prefs: AutomationPrefs,
): boolean {
  if (!prefs.auto_approve) return false;
  if (!commandPassesAutoPolicy(command, prefs)) return false;
  if (targetCount > prefs.max_targets) return false;
  return true;
}

/** 칩 문구 조각 하나 — 화면이 `kind` 로 문구 키를 고르고 `items` 를 끼운다. */
export interface ArgConstraintPiece {
  kind: "first_arg" | "no_args" | "max_args" | "require" | "allow" | "deny";
  items: string[];
}

/**
 * 규칙의 인자 제약을 **사람이 읽을 조각**으로 (순수) — 설정 화면의 묶음 칩이 쓴다
 * (`ip addr` · `show·list 만` · `-f·--follow 제외`). 제약이 없으면 빈 목록이라 칩은 예전 모양 그대로다.
 *
 * 순서는 읽는 순서다: 다음 낱말 → 인자 수 → 필수 → 허용 플래그 → 금지 플래그.
 */
export function describeArgConstraints(rule: AllowRule): ArgConstraintPiece[] {
  const out: ArgConstraintPiece[] = [];
  if (rule.first_arg?.length) out.push({ kind: "first_arg", items: [...rule.first_arg] });
  if (rule.max_args === 0) out.push({ kind: "no_args", items: [] });
  else if (rule.max_args !== undefined) out.push({ kind: "max_args", items: [String(rule.max_args)] });
  if (rule.require_flags?.length) out.push({ kind: "require", items: [...rule.require_flags] });
  if (rule.allow_flags?.length) out.push({ kind: "allow", items: [...rule.allow_flags] });
  if (rule.deny_flags?.length) out.push({ kind: "deny", items: [...rule.deny_flags] });
  return out;
}
