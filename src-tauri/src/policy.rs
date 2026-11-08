//! 자동 승인 **정책 평가기** — 로드맵 **단계 10b** (docs/log/2026-09-10-auto-approval.md)의
//! **백엔드 권위 포트**. 프런트 `src/lib/policy.ts`·`src/lib/operations.ts` 의 순수 판정을
//! 그대로 옮겨, [`crate::operations::approval::approve_operation`] 이 자동 승인을 **독립적으로 다시**
//! 검증하게 한다.
//!
//! ## 왜 Rust 에도 두는가 (경계는 백엔드다)
//!
//! 프런트(`policy.ts`)는 쓸모없는 자동 호출을 미리 거르는 **사전 점검·자문**이다. 하지만 승인은
//! Tauri 명령 하나(`approve_operation`)로 들어오고, 프런트 버그·조작으로 `method:"auto"` 가
//! 정책 밖 명령과 함께 들어올 수 있다. 그래서 **여기 판정이 진짜 경계**다 — 상한(caps)은
//! [`crate::operations::exceeds_limits`] 가, 위험·구획 분해·allowlist 는 이 모듈이 본다. AI 는
//! 여전히 self-approve 를 못 한다(approve 는 MCP 도구가 아니다 — MCP 표면은 **읽기 전용**이고,
//! 정책을 **읽는** 도구 `get_auto_approval_policy` 가 늘어도 그 사실은 변하지 않는다).
//!
//! ## TS ↔ Rust 드리프트 방지
//!
//! 두 쪽은 **같은 케이스로 검증**한다 — `policy.test.ts`/`operations.test.ts` 의 케이스를 아래
//! 테스트가 그대로 미러링한다. 한쪽을 고치면 다른 쪽 테스트가 깨지게 두는 것이 이 모듈의
//! 목적이다. **아래 규칙을 바꾸면 `src/lib/policy.ts`·`src/lib/operations.ts` 도 함께 고친다.**

use std::sync::LazyLock;

use regex::Regex;

use crate::settings::AutomationPrefs;

/// 명령의 위험도 — 자문용 넓은(보수적) 판정. `policy.ts`/`operations.ts` 의 `"safe"|"dangerous"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Risk {
    Safe,
    Dangerous,
}

/// 파괴적으로 보이는 패턴들 — **`src/lib/operations.ts` 의 `DANGEROUS` 배열을 케이스 그대로 포팅**.
///
/// 넓게(보수적으로) 잡는다: 오탐이 미탐보다 낫다. 정적 패턴이라 한 번만 컴파일한다(LazyLock).
/// JS `\b`·`\w` 는 ASCII 이고 Rust regex 는 유니코드지만, 명령 텍스트는 ASCII 라 판정이 같다.
/// **바꾸면 `operations.ts` 의 같은 목록도 함께 고친다.**
static DANGEROUS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"\brm\b",
        r"\brmdir\b",
        r"\bdd\b",
        r"\bmkfs(\.\w+)?\b",
        r"\bsudo\b",
        r"\bsu\b",
        r"\bchmod\b",
        r"\bchown\b",
        r"\b(kill|killall|pkill)\b",
        r"\breboot\b",
        r"\bshutdown\b",
        r"\bhalt\b",
        r"\bpoweroff\b",
        r"\bsystemctl\b[^\n]*\b(restart|stop)\b",
        r">>?", // 리다이렉트 — 덮어쓰기/이어쓰기
        r"\bfind\b[^\n]*-delete\b",
        r"\bgit\b[^\n]*\breset\b[^\n]*--hard\b",
        r"\btruncate\b",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("정적 위험 패턴은 항상 유효하다"))
    .collect()
});

/// 명령이 파괴적으로 보이는가 — 하나라도 매칭하면 `Dangerous`. **순수**.
///
/// ⚠️ 이것은 자문이자 자동 승인의 배제 조건이지, 명령 실행을 막는 경계가 아니다(수동 승인은
/// 사람이 권위라 위험이어도 통과한다 — [`crate::operations::approval::approve_operation`] 참고).
pub(crate) fn classify_risk(command: &str) -> Risk {
    if DANGEROUS.iter().any(|re| re.is_match(command)) {
        Risk::Dangerous
    } else {
        Risk::Safe
    }
}

/// 셸 메타문자가 하나라도 있는가 — `policy.ts` 의 `/[;|&`$><()\n\r\\]/` 집합과 같다. **순수**.
///
/// 체이닝(`;` `|` `&`) · 치환(`` ` `` `$`) · 리다이렉트(`>` `<`) · 묶음(`(` `)`) · 개행(`\n` `\r`) ·
/// 이스케이프(`\`).
///
/// **명령 판정에는 더 쓰지 않는다** — 그 자리는 [`segments_for_auto_approval`] 이 가져갔다.
/// 남은 쓰임은 자동 승인의 **작업 디렉터리(`cwd`) 검사** 하나다
/// ([`crate::operations::approval_reject_reason`]): `cwd` 는 명령이 아니라 디렉터리 문자열이라
/// 체이닝을 허용할 이유가 없어 규칙이 그대로다.
pub(crate) fn has_shell_metachar(command: &str) -> bool {
    command.chars().any(|c| {
        matches!(
            c,
            ';' | '|' | '&' | '`' | '$' | '>' | '<' | '(' | ')' | '\n' | '\r' | '\\'
        )
    })
}

/// 따옴표 상태 — [`segments_for_auto_approval`] 의 보수적 토크나이저가 쥔다.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Quote {
    /// 따옴표 밖.
    None,
    /// `'…'` 안 — 안에 이스케이프가 없다.
    Single,
    /// `"…"` 안 — `\"`·`\\` 만 이스케이프.
    Double,
}

/// 명령을 자동 승인 후보 **구획(segment)들**로 나눈다 — 못 나누면 `None`(= 자동 승인 불가). **순수**.
///
/// `policy.ts segmentsForAutoApproval` 과 **한 글자도 다르지 않은 의미**여야 한다(드리프트
/// 잠금 — 양쪽이 같은 표로 검증된다).
///
/// ## 왜 나누나
///
/// AI CLI 는 `cd /srv && ls -la` 처럼 **체이닝을 일상적으로 쓴다**. 예전 규칙(메타문자 하나라도
/// 있으면 탈락)에서는 자동 승인이 사실상 발화하지 않았다. 그래서 체이닝만은 **구획 단위로**
/// 본다: 나눈 뒤 **각 구획이 저마다** 위험 아님 + allowlist 를 통과해야 한다
/// ([`command_passes_auto_policy`]). 바닥(floor)은 그대로다 — 한 구획이라도 걸리면 명령 전체가
/// 수동으로 간다.
///
/// ## 분해기 (보수적 토크나이저)
///
/// - `'…'` 안은 통짜 literal, `"…"` 안은 `\"`·`\\` 만 이스케이프.
/// - 따옴표가 **안 닫히면** `None`. 따옴표 **안의** `&&` `||` `;` 는 literal이라 나누지 않는다.
/// - 따옴표 **밖**의 `&&` `||` `;` 에서 나눈다.
/// - **어디에 있든 탈락**: `$` · `` ` ``(큰따옴표 안에서도 살아 있는 치환) · 개행/CR.
/// - **따옴표 밖에서 탈락**: 홑 `|`(파이프) · 홑 `&`(백그라운드) · `>` `<` · `(` `)` · `{` `}` ·
///   `\`(이스케이프).
/// - 구획은 trim 한다. **빈 구획이 하나라도 있으면 `None`**(`a && ` · `;;` · 빈 명령).
///
/// `$` 를 통째로 막는 것은 의도다 — 변수가 경로를 숨길 수 있어(`$HOME/x`) 여기서는 풀지 않는다.
#[cfg_attr(not(test), allow(dead_code))] // 판정은 [`split_for_policy`] 로 옮겼다 — 공유 표 시험이 이 이름으로 잠근다
pub(crate) fn segments_for_auto_approval(command: &str) -> Option<Vec<String>> {
    split_segments(command).ok()
}

/// **정책이 보는 구획** — 파이프 허용(`allow_pipes`, 10-22 옵트인)까지. 반환 `(구획들, 파이프라인인가)`. **순수**.
///
/// 꺼져 있으면 [`split_segments`] 그대로(한 글자도 다르지 않다). 켜져 있고 [`split_segments`] 가 **파이프로만** 실패했으면
/// 파이프라인 분해([`split_pipeline`])를 한다 — 맨 `|` 와 `&&` 에서 나누고, `;` · `||` 는 파이프와 섞이면 거절(`PipeMix`),
/// 나머지 탈락(리다이렉트 · 치환 · 묶음 · 이스케이프 · `&` · 줄바꿈 · 안 닫힌 따옴표)은 예전과 같다. 파이프라인이면 부르는 쪽이
/// 단계마다 [`pipe_stage_refused`] 를 본다. `policy.ts splitForPolicy` 와 같은 의미다.
pub(crate) fn split_for_policy(command: &str, allow_pipes: bool) -> Result<(Vec<String>, bool), SplitFail> {
    match split_segments(command) {
        Ok(s) => Ok((s, false)),
        Err(SplitFail::Pipe) if allow_pipes => split_pipeline(command).map(|s| (s, true)),
        Err(e) => Err(e),
    }
}

/// 파이프라인 단계에서 **늘 거절하는** 프로그램 — 다른 명령을 실행하거나(xargs · 셸 · 감싸개 · 권한 상승 · 원격 · 인터프리터)
/// 파일을 쓰는(`tee`) 것. 허용 목록에 있어도 거절한다. **바꾸면 `policy.ts` 의 `PIPE_REFUSED` 도 함께 고친다.**
pub(crate) const PIPE_REFUSED: &[&str] = &[
    "xargs", "parallel", "sh", "bash", "zsh", "dash", "ksh", "fish", "busybox", "env", "eval", "exec", "command", "builtin",
    "source", ".", "nohup", "time", "timeout", "watch", "nice", "ionice", "stdbuf", "chrt", "taskset", "sudo", "su", "doas",
    "pkexec", "ssh", "python", "python3", "perl", "ruby", "node", "php", "lua", "tee",
];

/// 파이프라인 단계 하나를 **늘 거절하는가** — [`PIPE_REFUSED`] · 변수 대입 앞머리(`A=1 cmd`) · `find` 의
/// `-exec`/`-execdir`/`-ok`/`-okdir`/`-delete` · `awk` 류 스크립트의 `system(` · `|`(스크립트 안 파이프) · 낱말로 못 나눔. **순수**.
pub(crate) fn pipe_stage_refused(segment: &str) -> bool {
    let Some(words) = shell_words(segment) else {
        return true;
    };
    let Some(first) = words.first() else {
        return true;
    };
    if first.contains('=') {
        return true;
    }
    let exec = basename(first);
    if PIPE_REFUSED.contains(&exec) {
        return true;
    }
    let args = &words[1..];
    match exec {
        "find" => args
            .iter()
            .any(|a| matches!(a.as_str(), "-exec" | "-execdir" | "-ok" | "-okdir" | "-delete")),
        "awk" | "gawk" | "mawk" | "nawk" => args.iter().any(|a| a.contains("system") || a.contains('|')),
        _ => false,
    }
}

/// 파이프라인 분해 — [`split_segments`] 와 같은 토크나이저에서 맨 `|` 와 `&&` 만 나눈다(`;` · `||` 는 `PipeMix`).
fn split_pipeline(command: &str) -> Result<Vec<String>, SplitFail> {
    split_with(command, true)
}

/// 구획 분해가 **왜** 실패했는가 — 시험 칸([`explain`])이 이유를 말하려고 쓴다. 판정은 같다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SplitFail {
    /// 홑 `|`.
    Pipe,
    /// 파이프와 `;` · `||` 가 섞였다(파이프 허용을 켜도 사람 승인).
    PipeMix,
    /// `>` `<`.
    Redirect,
    /// `$` `` ` ``.
    Subst,
    /// 홑 `&`.
    Background,
    /// `(` `)` `{` `}`.
    Group,
    /// 따옴표 밖 역슬래시.
    Escape,
    /// 개행·CR.
    Newline,
    /// 안 닫힌 따옴표.
    Quote,
    /// 빈 구획(빈 명령 · `a && ` · `;;`).
    Empty,
}

/// [`segments_for_auto_approval`] 의 몸통 — 실패하면 그 이유. **순수**.
pub(crate) fn split_segments(command: &str) -> Result<Vec<String>, SplitFail> {
    split_with(command, false)
}

/// 분해의 몸 — `pipes` 면 파이프라인 꼴([`split_pipeline`]), 아니면 [`split_segments`] 꼴.
fn split_with(command: &str, pipes: bool) -> Result<Vec<String>, SplitFail> {
    let chars: Vec<char> = command.chars().collect();
    let mut segments: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut quote = Quote::None;
    let mut i = 0usize;

    // 구획 하나를 봉한다 — trim 해서 비면 `false`(= 호출부가 None 을 돌려준다).
    fn push(cur: &mut String, segments: &mut Vec<String>) -> bool {
        let seg = cur.trim().to_string();
        cur.clear();
        if seg.is_empty() {
            return false; // 빈 구획 — `a && ` · `;;` · 앞이 빈 `&& a`.
        }
        segments.push(seg);
        true
    }

    while i < chars.len() {
        let c = chars[i];
        // 어디에 있든(따옴표 안에서도) 탈락시키는 것들: 치환과 개행.
        // `"$(x)"`·``"`x`"`` 는 큰따옴표 안에서도 살아 있으므로 상태와 무관하게 막는다.
        if matches!(c, '$' | '`') {
            return Err(SplitFail::Subst);
        }
        if matches!(c, '\n' | '\r') {
            return Err(SplitFail::Newline);
        }

        match quote {
            Quote::Single => {
                // 홑따옴표 안 — 닫힘만 본다(이스케이프 없음).
                if c == '\'' {
                    quote = Quote::None;
                }
                cur.push(c);
                i += 1;
            }
            Quote::Double => {
                // 겹따옴표 안 — `\"`·`\\` 만 한 쌍으로 삼킨다(닫힘 판정이 어긋나지 않게).
                if c == '\\' && matches!(chars.get(i + 1), Some('"') | Some('\\')) {
                    cur.push(c);
                    cur.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                if c == '"' {
                    quote = Quote::None;
                }
                cur.push(c);
                i += 1;
            }
            Quote::None => match c {
                '\'' => {
                    quote = Quote::Single;
                    cur.push(c);
                    i += 1;
                }
                '"' => {
                    quote = Quote::Double;
                    cur.push(c);
                    i += 1;
                }
                '&' => {
                    if chars.get(i + 1) != Some(&'&') {
                        return Err(SplitFail::Background); // 홑 `&` = 백그라운드 실행 — 탈락.
                    }
                    if !push(&mut cur, &mut segments) {
                        return Err(SplitFail::Empty);
                    }
                    i += 2;
                }
                '|' => {
                    if chars.get(i + 1) != Some(&'|') {
                        if !pipes {
                            return Err(SplitFail::Pipe); // 홑 `|` = 파이프 — 탈락.
                        }
                        // 파이프라인 꼴 — 단계 하나를 봉한다(`|&` 는 오류까지 넘기는 파이프라 탈락).
                        if chars.get(i + 1) == Some(&'&') {
                            return Err(SplitFail::Background);
                        }
                        if !push(&mut cur, &mut segments) {
                            return Err(SplitFail::Empty);
                        }
                        i += 1;
                        continue;
                    }
                    if pipes {
                        return Err(SplitFail::PipeMix); // 파이프와 `||` 는 섞지 않는다.
                    }
                    if !push(&mut cur, &mut segments) {
                        return Err(SplitFail::Empty);
                    }
                    i += 2;
                }
                ';' => {
                    if pipes {
                        return Err(SplitFail::PipeMix); // 파이프와 `;` 는 섞지 않는다.
                    }
                    if !push(&mut cur, &mut segments) {
                        return Err(SplitFail::Empty);
                    }
                    i += 1;
                }
                // 리다이렉트 · 서브셸 · 그룹 · 이스케이프.
                '>' | '<' => return Err(SplitFail::Redirect),
                '(' | ')' | '{' | '}' => return Err(SplitFail::Group),
                '\\' => return Err(SplitFail::Escape),
                _ => {
                    cur.push(c);
                    i += 1;
                }
            },
        }
    }

    if quote != Quote::None {
        return Err(SplitFail::Quote); // 안 닫힌 따옴표 — 무엇이 명령인지 알 수 없다.
    }
    if !push(&mut cur, &mut segments) {
        return Err(SplitFail::Empty); // 마지막 구획(빈 꼬리 `a && ` 도 여기서 탈락).
    }
    Ok(segments)
}

/// 명령 문자열이 **자동 승인의 명령 술어**를 통과하는가 — 대상 수·토글과 무관한 부분. **순수**.
///
/// `policy.ts commandPassesAutoPolicy` 와 같은 의미다. 셋을 본다:
/// 1. [`segments_for_auto_approval`] 로 구획 분해에 성공할 것(실패 = 자동 불가).
/// 2. **모든 구획**이 위험하지 않을 것([`classify_risk`] — ②는 ③ 위에서 조인다).
/// 3. **모든 구획**이 평탄 prefix **또는** 구조적 규칙에 맞을 것(OR 은 매칭 방식에만 적용된다).
///
/// 구획이 하나면 예전과 정확히 같은 판정이다. 여럿이면 **가장 약한 구획이 전체를 끌어내린다**.
/// [`should_auto_approve`] 와 [`crate::operations::approval_reject_reason`] 의 `validate` 검사가
/// 같은 술어를 쓴다(AI 가 준 검증 명령도 본 명령과 같은 바닥을 통과해야 한다).
///
/// 구조적 규칙은 사용자가 적은 `allow` **와 켜진 묶음이 펼친 규칙의 합집합**이다
/// ([`crate::automation_presets::effective_allow_rules`]) — 묶음의 효력은 프런트가 아니라
/// **여기서** 난다(프런트가 펼쳐 보내는 구조였다면 프런트 버그가 곧 범위 확장이다).
pub(crate) fn command_passes_auto_policy(command: &str, prefs: &AutomationPrefs) -> bool {
    // 파이프 허용(10-22 옵트인)이 꺼져 있으면 예전 분해 그대로 — 켜져 있으면 파이프라인 단계마다 다시 거른다.
    let Ok((segments, pipeline)) = split_for_policy(command, prefs.allow_pipes) else {
        return false;
    };
    if pipeline && segments.iter().any(|s| pipe_stage_refused(s)) {
        return false;
    }
    // 구획마다 같은 목록을 본다 — 펼치기는 루프 밖에서 한 번만.
    let rules = crate::automation_presets::effective_allow_rules(prefs);
    for seg in &segments {
        if classify_risk(seg) != Risk::Safe {
            return false;
        }
        // allowlist 매칭 = 평탄한 prefix(하위 호환) **OR** 구조적 규칙(A4b + 묶음). 무엇으로
        // 매칭돼도 바닥(floor)은 변하지 않는다 — 위험 아님·구획 분해 성공은 그대로 AND 로 남는다.
        if !matches_allowlist(seg, &prefs.allow_patterns) && !matches_structured_allow(seg, &rules)
        {
            return false;
        }
    }
    true
}

/// 명령이 allowlist 의 어떤 항목으로 **단어 경계 prefix** 시작하는가 — `policy.ts matchesAllowlist`
/// 와 **정확히 같은 의미**. 패턴 `"df"` 는 `df`(정확 일치)·`df -h`(뒤가 공백)를 매칭하고
/// `dfx`(뒤가 단어 문자)는 매칭하지 않는다. 패턴은 공백을 떼고, 빈 패턴은 건너뛴다. **순수**.
///
/// (이번 단계는 **충실 포팅만** — prefix 의미를 정확 일치/인자 템플릿으로 좁히는 것은 별도 후속.)
pub(crate) fn matches_allowlist(command: &str, patterns: &[String]) -> bool {
    let cmd = command.trim();
    if cmd.is_empty() {
        return false;
    }
    for raw in patterns {
        let p = raw.trim();
        if p.is_empty() {
            continue;
        }
        if cmd == p {
            return true;
        }
        // prefix 로 시작하고, 그 바로 뒤 문자가 공백이어야 한다(단어 경계). prefix 매칭이라
        // `p.len()` 은 항상 char 경계다. 문자열 끝(뒤가 없음)은 JS `charAt` 의 ""·`\s` 불일치와
        // 같게 false 로 떨어진다.
        if let Some(stripped) = cmd.strip_prefix(p) {
            if stripped.chars().next().is_some_and(char::is_whitespace) {
                return true;
            }
        }
    }
    false
}

/// 명령이 **구조적 allowlist**(A4b)의 어떤 규칙에 맞는가 — `policy.ts matchesStructuredAllow`
/// 와 **정확히 같은 의미**. 평탄한 `matches_allowlist` 를 좁힌 것으로, exec+서브커맨드 단위 위임을
/// 검증하고, 규칙이 인자 제약을 가지면 그것까지 본다. **순수**.
///
/// 토큰화·판정 규칙(자동 경로는 이미 메타문자가 없어 공백 분해가 안전하다):
/// - 명령을 공백으로 토큰화한다.
/// - `exec` = 첫 토큰의 **basename**(`/` 로 나눠 마지막 — `/usr/bin/systemctl` → `systemctl`).
/// - `subcommand` = exec 이후 **`-` 로 시작하지 않는 첫 토큰**(플래그 토큰은 건너뛴다). 없으면 "부재".
/// - exec 가 (정확·대소문자 구분) 같은 규칙을 찾는다. 없으면 `false`.
/// - 그 규칙의 `subcommands` 가 **비면** exec 만으로, 아니면 subcommand 가 **부재가 아니고** 그
///   목록에 있을 때 1차 통과.
/// - 1차 통과한 규칙이 **인자 제약**(`deny_flags`·`allow_flags`·`require_flags`·`first_arg`·
///   `max_args`)을 하나라도 가지면 [`arg_constraints_check`] 까지 참이어야 한다. 제약이 없는 옛
///   모양 규칙은 예전과 **글자 그대로 같은** 판정이다.
/// - 같은 exec 의 규칙이 여럿이면 OR 이다(하나라도 맞으면 통과). **모호하면 `false` 쪽으로**
///   기운다(수동 승인으로 떨어지는 안전한 방향).
pub(crate) fn matches_structured_allow(
    command: &str,
    rules: &[crate::settings::AllowRule],
) -> bool {
    let Some(seg) = SegmentWords::new(command) else {
        return false; // 빈 명령 → 매칭 없음.
    };
    rules
        .iter()
        .any(|rule| matches!(seg.check(rule), RuleCheck::Pass))
}

/// 구획 하나를 규칙들에 대 보기 위한 준비 — 공백 분해로 찾은 exec·서브커맨드와, 인자 제약이 있는
/// 규칙을 처음 만났을 때 한 번만 만드는 따옴표 벗긴 낱말.
pub(crate) struct SegmentWords<'a> {
    command: &'a str,
    exec: &'a str,
    subcommand: Option<&'a str>,
    words: std::cell::OnceCell<Option<Vec<String>>>,
}

/// 규칙 하나에 대 본 결과 — 시험 칸([`explain`])이 "가장 가까운 이유" 를 고르려고 갈래까지 본다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RuleCheck {
    /// exec 이 다르다.
    Miss,
    /// exec 은 같은데 서브커맨드가 목록에 없다(없으면 `None`).
    SubMiss(Option<String>),
    /// exec+서브커맨드는 맞는데 인자 제약에 걸렸다.
    Fail(ArgFail),
    /// 맞는다.
    Pass,
}

/// 인자 제약의 어느 칸에 걸렸나 — 걸린 낱말을 함께 든다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ArgFail {
    /// `deny_flags` 항목 형식이 틀려 규칙째 꺼져 있다.
    BadDeny,
    /// 낱말로 못 나누거나 공백 분해와 어긋났다(따옴표가 경계를 바꿈).
    Words,
    /// 서브커맨드 앞에 플래그가 있다(`sub_first`).
    SubFirst,
    /// 금지 플래그.
    Deny(String),
    /// 허용 목록 밖 플래그.
    NotAllowed(String),
    /// 필수 플래그가 없다.
    Require(String),
    /// 첫 인자가 목록 밖.
    FirstArg(String),
    /// 인자 수 상한을 넘었다.
    MaxArgs(u32),
}

impl<'a> SegmentWords<'a> {
    /// 공백 분해 — 빈 구획이면 `None`.
    pub(crate) fn new(command: &'a str) -> Option<Self> {
        let mut tokens = command.split_whitespace();
        let first = tokens.next()?;
        // exec = 첫 토큰의 basename (경로 구분자 `/` 뒤 마지막 조각).
        let exec = basename(first);
        if exec.is_empty() {
            return None;
        }
        // subcommand = exec 이후 `-` 로 시작하지 않는 첫 토큰(플래그는 건너뛴다). 없으면 None.
        let subcommand = tokens.find(|t| !t.starts_with('-'));
        Some(Self {
            command,
            exec,
            subcommand,
            words: std::cell::OnceCell::new(),
        })
    }

    /// exec 다음 공백 토큰이 플래그인가.
    fn second_is_flag(&self) -> bool {
        self.command
            .split_whitespace()
            .nth(1)
            .is_some_and(|t| t.starts_with('-'))
    }

    /// 규칙 하나에 대 본다 — [`matches_structured_allow`] 의 한 칸.
    pub(crate) fn check(&self, rule: &crate::settings::AllowRule) -> RuleCheck {
        if rule.exec != self.exec {
            return RuleCheck::Miss;
        }
        // 서브커맨드가 exec 바로 뒤여야 하는 규칙인데 그 자리가 플래그다 — 아래 서브커맨드 찾기는 플래그를
        // 건너뛰어 그 **값**을 서브커맨드로 읽으므로(`git -C /srv status` → `/srv`) 먼저 이유를 정한다.
        // 판정은 같다(어느 쪽이든 불통) — 이유만 정확해진다.
        if rule.sub_first && !rule.subcommands.is_empty() && self.second_is_flag() {
            return RuleCheck::Fail(ArgFail::SubFirst);
        }
        // 1차 — exec+서브커맨드(옛 의미 그대로).
        if !rule.subcommands.is_empty() {
            match self.subcommand {
                Some(sub) if rule.subcommands.iter().any(|s| s == sub) => {}
                other => return RuleCheck::SubMiss(other.map(str::to_string)),
            }
        }
        if !has_arg_constraints(rule) {
            return RuleCheck::Pass; // 옛 모양 규칙 — 인자는 보지 않는다(하위 호환).
        }
        let Some(ws) = self
            .words
            .get_or_init(|| shell_words(self.command))
            .as_deref()
        else {
            return RuleCheck::Fail(ArgFail::Words); // 제약을 확인할 수 없으니 불통.
        };
        let raw_sub = if rule.subcommands.is_empty() {
            None
        } else {
            self.subcommand
        };
        match arg_constraints_check(rule, self.exec, raw_sub, ws) {
            Ok(()) => RuleCheck::Pass,
            Err(f) => RuleCheck::Fail(f),
        }
    }
}

/// 경로의 마지막 조각 — `/usr/bin/git` → `git`.
fn basename(token: &str) -> &str {
    token.rsplit('/').next().unwrap_or(token)
}

/// 규칙이 인자 제약을 하나라도 갖는가 — 없으면 옛 exec+서브커맨드 판정 그대로다.
pub(crate) fn has_arg_constraints(rule: &crate::settings::AllowRule) -> bool {
    !rule.deny_flags.is_empty()
        || !rule.allow_flags.is_empty()
        || !rule.require_flags.is_empty()
        || !rule.first_arg.is_empty()
        || rule.max_args.is_some()
        || rule.sub_first
}

/// 구획 하나를 **셸이 보는 낱말**로 — 따옴표를 벗긴다. 못 하면 `None`. **순수**.
///
/// `policy.ts shellWords` 와 같다. 낱말 경계는 ASCII 공백(스페이스·탭·VT·FF)뿐이다 — 셸처럼
/// 비ASCII 공백은 글자다(공백 분해와 낱말이 어긋나면 [`arg_constraints_check`] 가 불통으로 본다).
/// `'…'` 는 통째로, `"…"` 안은 `\"`·`\\` 만 이스케이프. 따옴표 밖 `\`·개행은 `None`(구획 분해가
/// 이미 막지만 직접 불려도 안전하게). `''` 는 빈 낱말 하나다(셸도 빈 인자를 넘긴다).
pub(crate) fn shell_words(segment: &str) -> Option<Vec<String>> {
    let chars: Vec<char> = segment.chars().collect();
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut quote = Quote::None;
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        match quote {
            Quote::Single => {
                if c == '\'' {
                    quote = Quote::None;
                } else {
                    cur.push(c);
                }
            }
            Quote::Double => {
                if c == '\\' && matches!(chars.get(i + 1), Some('"') | Some('\\')) {
                    cur.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                if c == '"' {
                    quote = Quote::None;
                } else {
                    cur.push(c);
                }
            }
            Quote::None => match c {
                ' ' | '\t' | '\u{0b}' | '\u{0c}' => {
                    if in_word {
                        words.push(std::mem::take(&mut cur));
                        in_word = false;
                    }
                }
                '\'' => {
                    quote = Quote::Single;
                    in_word = true;
                }
                '"' => {
                    quote = Quote::Double;
                    in_word = true;
                }
                '\\' | '\n' | '\r' => return None,
                _ => {
                    cur.push(c);
                    in_word = true;
                }
            },
        }
        i += 1;
    }
    if quote != Quote::None {
        return None;
    }
    if in_word {
        words.push(cur);
    }
    Some(words)
}

/// 낱말이 플래그인가 — `-` 로 시작하고 두 글자 이상(홀로 선 `-` 는 표준 입력이라는 인자다).
fn is_flag(word: &str) -> bool {
    word.chars().count() >= 2 && word.starts_with('-')
}

/// 짧은 플래그 묶음인가 — `-x…`(이중 대시가 아님).
fn is_short_cluster(word: &str) -> bool {
    is_flag(word) && !word.starts_with("--")
}

/// 짧은 한 글자 패턴(`-x`)이면 그 글자. `--` 는 아니다.
fn short_letter(pattern: &str) -> Option<char> {
    let mut it = pattern.chars();
    match (it.next(), it.next(), it.next()) {
        (Some('-'), Some(c), None) if c != '-' => Some(c),
        _ => None,
    }
}

/// `--name=value` · `-name=value` 의 이름 쪽.
fn flag_name(word: &str) -> &str {
    word.split('=').next().unwrap_or(word)
}

/// 끝의 `*` 를 떼고 (줄기, 접두 여부). 가운데 `*` 는 [`deny_pattern_ok`] 가 거른다.
fn split_wild(pattern: &str) -> (&str, bool) {
    match pattern.strip_suffix('*') {
        Some(stem) => (stem, true),
        None => (pattern, false),
    }
}

/// `deny_flags` 항목의 형식이 맞는가 — `-` 로 시작하고 `*` 는 끝에만. 틀린 항목이 하나라도
/// 있으면 그 규칙은 **매칭되지 않는다**(사용자가 의도한 금지를 못 지킬 바엔 수동이 낫다).
fn deny_pattern_ok(pattern: &str) -> bool {
    let (stem, _) = split_wild(pattern);
    pattern.starts_with('-') && !stem.contains('*')
}

/// 금지 패턴 하나가 플래그 낱말에 걸리는가.
///
/// - `-x`(짧은 한 글자): 짧은 묶음 낱말 안에 `x` 가 **어디든** 있으면(`-fn`·`-xef`). 값이 붙은
///   `-owide` 의 글자도 보므로 오탐이 있다 — 수동으로 떨어지는 안전한 방향이다.
/// - `--name`(긴): 이름(`=` 앞)이 같거나, `*` 면 접두로 시작하거나, **줄임**(이름이 패턴 줄기의
///   접두 — getopt_long·git 이 받아들이는 `--fol` → `--follow`)이면.
/// - `-name`(대시 하나 긴 이름, `ip -batch` 류): 위와 같되 대시 하나짜리 낱말에만.
fn deny_hits(pattern: &str, word: &str) -> bool {
    let (stem, wild) = split_wild(pattern);
    let name = flag_name(word);
    let long_match = |min_abbrev: usize| {
        let direct = if wild {
            name.starts_with(stem)
        } else {
            name == stem
        };
        direct || (name.chars().count() >= min_abbrev && stem.starts_with(name))
    };
    if stem.starts_with("--") {
        word.starts_with("--") && long_match(3)
    } else if let (false, Some(c)) = (wild, short_letter(stem)) {
        is_short_cluster(word) && word.chars().skip(1).any(|w| w == c)
    } else {
        is_short_cluster(word) && long_match(2)
    }
}

/// `allow_flags` 목록이 플래그 낱말 하나를 허용하는가 — 이름이 목록에 있거나(`*` 끝은 접두),
/// 짧은 묶음이면 글자마다 `-글자` 가 목록에 있을 때. 줄임은 받지 않는다.
fn flag_allowed(list: &[String], word: &str) -> bool {
    let name = flag_name(word);
    let named = list.iter().any(|p| {
        let (stem, wild) = split_wild(p);
        if wild {
            name.starts_with(stem)
        } else {
            name == stem
        }
    });
    if named {
        return true;
    }
    is_short_cluster(word)
        && word
            .chars()
            .skip(1)
            .all(|c| list.iter().any(|p| short_letter(p) == Some(c)))
}

/// 필수 플래그 하나가 있는가 — 낱말이 **정확히** 같거나(짧은 한 글자면 값 없는 묶음 안에),
/// 그리고 같은 이름에 값이 붙은 낱말(`--no-stream=false`)이 **하나도 없을 때**.
fn required_present(pattern: &str, flags: &[&str]) -> bool {
    let letter = short_letter(pattern);
    let found = flags.iter().any(|w| {
        *w == pattern
            || letter.is_some_and(|c| {
                is_short_cluster(w) && !w.contains('=') && w.chars().skip(1).any(|x| x == c)
            })
    });
    let poisoned = flags
        .iter()
        .any(|w| w.contains('=') && flag_name(w) == pattern);
    found && !poisoned
}

/// `first_arg` 패턴이 인자 하나에 맞는가 — 정확히, 또는 끝의 `*` 면 접두.
fn arg_matches(pattern: &str, arg: &str) -> bool {
    let (stem, wild) = split_wild(pattern);
    if wild {
        arg.starts_with(stem)
    } else {
        arg == stem
    }
}

/// 규칙의 **인자 제약**이 이 낱말들에서 지켜지는가 — 아니면 걸린 칸. **순수**. `policy.ts argConstraintsHold` 와 같다.
///
/// `words[0]` 은 exec 이고 그 basename 이 `exec`(공백 분해로 찾은 것)와 같아야 한다. 규칙에
/// 서브커맨드가 있으면 첫 비플래그 낱말이 `raw_sub`(공백 분해로 찾은 서브커맨드)와 **같아야**
/// 한다 — 두 분해가 어긋나면(따옴표가 경계를 바꾼 경우) 불통이다. 그 뒤로:
/// - 플래그 = `--` 앞의 `-…` 낱말(두 글자 이상). `--` 뒤는 전부 인자다.
/// - 인자 = 서브커맨드(없으면 exec) **뒤**의 비플래그 낱말들.
/// - `deny_flags` 하나라도 걸리면 불통 · `allow_flags` 가 있으면 모든 플래그가 허용돼야 함 ·
///   `require_flags` 전부 있어야 함 · `first_arg` 가 있으면 첫 인자가 없거나 맞아야 함 ·
///   `max_args` 이하.
fn arg_constraints_check(
    rule: &crate::settings::AllowRule,
    exec: &str,
    raw_sub: Option<&str>,
    words: &[String],
) -> Result<(), ArgFail> {
    if !rule.deny_flags.iter().all(|p| deny_pattern_ok(p)) {
        return Err(ArgFail::BadDeny);
    }
    let Some((first, rest)) = words.split_first() else {
        return Err(ArgFail::Words);
    };
    if basename(first) != exec {
        return Err(ArgFail::Words);
    }
    // 서브커맨드는 exec 바로 다음 낱말이어야 한다 — 앞 플래그의 값이 서브커맨드로 위장하지 못하게.
    if let (true, Some(sub)) = (rule.sub_first, raw_sub) {
        match rest.first() {
            Some(w) if w == sub => {}
            Some(w) if is_flag(w) => return Err(ArgFail::SubFirst),
            _ => return Err(ArgFail::Words),
        }
    }
    let mut flags: Vec<&str> = Vec::new();
    let mut positionals: Vec<&str> = Vec::new();
    let mut after_dd = false;
    for w in rest {
        if after_dd {
            positionals.push(w);
        } else if w == "--" {
            after_dd = true;
        } else if is_flag(w) {
            flags.push(w);
        } else {
            positionals.push(w);
        }
    }
    let args: &[&str] = match raw_sub {
        Some(sub) => match positionals.split_first() {
            Some((first_pos, after)) if *first_pos == sub => after,
            _ => return Err(ArgFail::Words),
        },
        None => &positionals,
    };

    if let Some(w) = flags
        .iter()
        .find(|w| rule.deny_flags.iter().any(|p| deny_hits(p, w)))
    {
        return Err(ArgFail::Deny((*w).to_string()));
    }
    if !rule.allow_flags.is_empty() {
        if let Some(w) = flags.iter().find(|w| !flag_allowed(&rule.allow_flags, w)) {
            return Err(ArgFail::NotAllowed((*w).to_string()));
        }
    }
    if let Some(p) = rule
        .require_flags
        .iter()
        .find(|p| !required_present(p, &flags))
    {
        return Err(ArgFail::Require(p.clone()));
    }
    if let (false, Some(a)) = (rule.first_arg.is_empty(), args.first()) {
        if !rule.first_arg.iter().any(|p| arg_matches(p, a)) {
            return Err(ArgFail::FirstArg((*a).to_string()));
        }
    }
    if let Some(max) = rule.max_args {
        if args.len() > max as usize {
            return Err(ArgFail::MaxArgs(max));
        }
    }
    Ok(())
}

/// 이 명령·대상 수를 **자동 승인해도 되는가** — 다섯 조건이 모두 참일 때만 `true`. **순수**.
///
/// `policy.ts shouldAutoApprove` 와 **같은 5조건 AND**: `auto_approve` 켬 → 구획 분해 성공 →
/// **구획마다** 위험 아님 → **구획마다** allowlist 매칭 → `target_count <= max_targets`.
/// 순서는 싼 것·잘 거르는 것부터다. **바꾸면 `policy.ts` 도 함께 고친다.**
///
/// `max_concurrency` 는 **여기서 보지 않는다** — 그 상한은 수동·자동 공통이라
/// [`crate::operations::exceeds_limits`] 가 별도로 강제한다.
pub(crate) fn should_auto_approve(
    command: &str,
    target_count: usize,
    prefs: &AutomationPrefs,
) -> bool {
    if !prefs.auto_approve {
        return false;
    }
    if !command_passes_auto_policy(command, prefs) {
        return false;
    }
    if target_count > prefs.max_targets as usize {
        return false;
    }
    true
}

pub(crate) mod explain;

#[cfg(test)]
mod tests;
