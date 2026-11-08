//! **시험 칸** — "이 명령은 자동 승인될까?" 를 **Rust 판정 그대로** 돌려 이유까지 말한다
//! (설정 › 자동 승인 › 묶음 조정, docs/log/2026-10-05-auto-approve-args.md "세분화").
//!
//! ## 불변
//!
//! - **실행하지 않는다.** 문자열을 판정할 뿐이고 셸·세션·작업안 저장소에 닿지 않는다.
//! - 판정은 [`super::command_passes_auto_policy`] 와 **같은 길**이다 — 구획 분해([`super::split_segments`]) ·
//!   위험([`super::classify_risk`]) · 평탄 패턴 · 사용자 규칙 · 켜진 묶음(끈 명령 제외). 여기서 따로 만든
//!   판정 규칙은 없고, 갈래를 **보이게** 할 뿐이다(`verdict == Auto` ⇔ 술어 참 — 시험이 못 박는다).
//! - 입력은 **화면의 초안**(저장 전)이다. 디스크 값이 아니므로 이 명령으로 정책이 바뀌는 일은 없다.
//!   Tauri 전용이고 MCP 도구가 아니다(AI 가 자기 명령을 미리 대 보는 길은 `get_auto_approval_policy` 의 읽기뿐).
//! - 이유 문구는 프런트가 그린다 — 여기서는 **코드 + 인자**만 돌려준다(화면 언어를 타지 않게).
//!
//! 대상 수 상한·빈도 한도는 보지 않는다(명령이 아니라 작업안의 성질이다).

use std::collections::BTreeMap;

use serde::Serialize;

use super::{classify_risk, pipe_stage_refused, split_for_policy, ArgFail, Risk, RuleCheck, SegmentWords, SplitFail};
use crate::automation_presets::{bundle_by_id, is_off, BUNDLES};
use crate::settings::AutomationPrefs;

/// 판정 셋 — 자동 승인 · 사람 승인 · 항상 제외(위험·파이프·리다이렉트 — 어떤 설정으로도 자동이 안 된다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Verdict {
    Auto,
    Manual,
    Excluded,
}

/// 이유 하나 — 프런트가 `code` 로 문구를 고르고 `args` 를 끼운다.
///
/// 코드: 제외 = `split_pipe`·`split_redirect`·`split_subst`·`split_background`·`split_group`·
/// `split_escape`·`split_newline`·`split_quote`·`split_empty`·`dangerous` / 자동 = `match_pattern`·
/// `match_rule`·`match_bundle` / 사람 = `bundle_off`·`constraint`·`bundle_disabled`·`sub_missing`·`no_rule`.
/// 인자: `segment`(그 구획) · `bundle`(묶음 id) · `key`(명령 키) · `exec` · `pattern` · `sub` ·
/// `kind`(`constraint` 의 칸 — `bad_deny`·`words`·`sub_first`·`deny`·`not_allowed`·`require`·
/// `first_arg`·`max_args`) · `item`(걸린 낱말) · `n`(상한).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Reason {
    pub code: &'static str,
    pub args: BTreeMap<&'static str, String>,
}

impl Reason {
    pub(crate) fn new(code: &'static str) -> Self {
        Self {
            code,
            args: BTreeMap::new(),
        }
    }
    pub(crate) fn with(mut self, k: &'static str, v: impl Into<String>) -> Self {
        self.args.insert(k, v.into());
        self
    }
}

/// 시험 결과 — `reasons` 는 자동이면 구획마다 하나(무엇이 열었나), 아니면 하나(가장 가까운 이유).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AutoApprovalTest {
    /// 자동 승인 스위치 — 꺼져 있으면 판정이 `Auto` 여도 실제로는 사람을 기다린다(화면이 함께 말한다).
    pub enabled: bool,
    pub verdict: Verdict,
    pub reasons: Vec<Reason>,
}

fn split_code(f: SplitFail) -> &'static str {
    match f {
        SplitFail::Pipe => "split_pipe",
        SplitFail::PipeMix => "split_pipe_mix",
        SplitFail::Redirect => "split_redirect",
        SplitFail::Subst => "split_subst",
        SplitFail::Background => "split_background",
        SplitFail::Group => "split_group",
        SplitFail::Escape => "split_escape",
        SplitFail::Newline => "split_newline",
        SplitFail::Quote => "split_quote",
        SplitFail::Empty => "split_empty",
    }
}

/// 인자 제약 실패를 이유로.
fn constraint(f: &ArgFail) -> Reason {
    let r = Reason::new("constraint");
    match f {
        ArgFail::BadDeny => r.with("kind", "bad_deny"),
        ArgFail::Words => r.with("kind", "words"),
        ArgFail::SubFirst => r.with("kind", "sub_first"),
        ArgFail::Deny(w) => r.with("kind", "deny").with("item", w.as_str()),
        ArgFail::NotAllowed(w) => r.with("kind", "not_allowed").with("item", w.as_str()),
        ArgFail::Require(p) => r.with("kind", "require").with("item", p.as_str()),
        ArgFail::FirstArg(a) => r.with("kind", "first_arg").with("item", a.as_str()),
        ArgFail::MaxArgs(n) => r.with("kind", "max_args").with("n", n.to_string()),
    }
}

/// 명령 하나를 판정하고 이유를 붙인다. **순수**·실행 없음.
pub(crate) fn explain(command: &str, prefs: &AutomationPrefs) -> AutoApprovalTest {
    let enabled = prefs.auto_approve;
    let done = |verdict, reasons| AutoApprovalTest {
        enabled,
        verdict,
        reasons,
    };
    // 파이프 허용(10-22 옵트인)까지 — 판정 술어(`command_passes_auto_policy`)와 같은 분해 `split_for_policy`.
    let (segments, pipeline) = match split_for_policy(command, prefs.allow_pipes) {
        Ok(x) => x,
        // 파이프가 꺼져 있어 걸렸으면 `split_pipe` — 문구가 "파이프(|) 허용" 칸을 가리킨다(판정은 예전 그대로 제외).
        Err(f) => return done(Verdict::Excluded, vec![Reason::new(split_code(f))]),
    };
    // 파이프라인 — 다른 명령을 실행하거나 파일을 쓰는 단계는 허용 목록과 무관하게 제외.
    if pipeline {
        if let Some(seg) = segments.iter().find(|s| pipe_stage_refused(s)) {
            return done(Verdict::Excluded, vec![Reason::new("pipe_runner").with("segment", seg.as_str())]);
        }
    }
    // 위험은 허용 목록 위에서 늘 조인다 — 한 구획이라도 위험이면 제외.
    if let Some(seg) = segments.iter().find(|s| classify_risk(s) != Risk::Safe) {
        return done(
            Verdict::Excluded,
            vec![Reason::new("dangerous").with("segment", seg.as_str())],
        );
    }
    let mut matched = Vec::new();
    for seg in &segments {
        match explain_segment(seg, prefs) {
            Ok(r) => matched.push(r),
            // 파이프라인이면 **어느 단계**인지 말한다(그 단계의 자세한 이유는 시험 칸에 그 단계만 넣어 본다).
            Err(_) if pipeline => return done(Verdict::Manual, vec![Reason::new("pipe_stage").with("segment", seg.as_str())]),
            Err(r) => return done(Verdict::Manual, vec![r]),
        }
    }
    done(Verdict::Auto, matched)
}

/// 구획 하나 — 무엇이 열었는지(`Ok`) 또는 가장 가까운 이유(`Err`).
///
/// 가까운 이유의 순서: 끈 명령(켜면 통과) → 인자 제약 → 꺼진 묶음이 연다 → 하위 명령이 목록 밖 → 규칙 없음.
fn explain_segment(seg: &str, prefs: &AutomationPrefs) -> Result<Reason, Reason> {
    let tag = |r: Reason| r.with("segment", seg);
    // 1. 평탄 패턴(하위 호환).
    if let Some(p) = prefs
        .allow_patterns
        .iter()
        .find(|p| super::matches_allowlist(seg, std::slice::from_ref(*p)))
    {
        return Ok(tag(Reason::new("match_pattern").with("pattern", p.trim())));
    }
    let Some(sw) = SegmentWords::new(seg) else {
        return Err(tag(Reason::new("no_rule")));
    };
    // 2. 사용자 규칙.
    if let Some(r) = prefs.allow.iter().find(|r| sw.check(r) == RuleCheck::Pass) {
        return Ok(tag(Reason::new("match_rule").with("exec", r.exec.as_str())));
    }
    // 3. 켜진 묶음 — 통과면 끝, 아니면 가장 가까운 이유를 고른다(작은 순위가 이긴다).
    let mut nearest: Option<(u8, Reason)> = None;
    let mut consider = |rank: u8, r: Reason| {
        if nearest.as_ref().is_none_or(|(best, _)| rank < *best) {
            nearest = Some((rank, r));
        }
    };
    for id in &prefs.bundles {
        let Some(b) = bundle_by_id(id) else {
            continue;
        };
        for pr in b.rules {
            let key = pr.command_key();
            let off = is_off(&prefs.bundle_off, b.id, &key);
            let at = |r: Reason| r.with("bundle", b.id).with("key", key.as_str());
            match sw.check(&pr.to_allow_rule()) {
                RuleCheck::Pass if !off => {
                    return Ok(tag(at(Reason::new("match_bundle"))));
                }
                RuleCheck::Pass => consider(0, at(Reason::new("bundle_off"))),
                RuleCheck::Fail(f) => consider(1, at(constraint(&f))),
                RuleCheck::SubMiss(sub) if !off => consider(
                    3,
                    at(Reason::new("sub_missing")
                        .with("exec", pr.exec)
                        .with("sub", sub.unwrap_or_default())),
                ),
                RuleCheck::SubMiss(_) | RuleCheck::Miss => {}
            }
        }
    }
    // 사용자 규칙의 제약 실패도 후보다.
    for r in &prefs.allow {
        if let RuleCheck::Fail(f) = sw.check(r) {
            consider(1, constraint(&f).with("exec", r.exec.as_str()));
        }
    }
    // 4. 꺼진 묶음이 열어 줄 수 있는가 — 켜면 통과(끈 명령은 묻지 않는다: 켜는 사람이 고른다).
    'outer: for b in BUNDLES {
        if prefs.bundles.iter().any(|id| id == b.id) {
            continue;
        }
        for pr in b.rules {
            if sw.check(&pr.to_allow_rule()) == RuleCheck::Pass {
                consider(
                    2,
                    Reason::new("bundle_disabled")
                        .with("bundle", b.id)
                        .with("key", pr.command_key()),
                );
                break 'outer;
            }
        }
    }
    Err(tag(nearest.map_or_else(|| Reason::new("no_rule"), |(_, r)| r)))
}

/// 화면의 **초안 설정**으로 명령 하나를 판정한다 — 저장하지도 실행하지도 않는다.
///
/// 초안은 디스크에 쓸 때와 같은 정리를 거친다([`AutomationPrefs::sanitize`] — 옛 묶음 id 옮기기 포함).
/// 계산은 마이크로초지만 규칙상 `async`(CLAUDE.md "Tauri 명령은 기본 async fn").
#[tauri::command]
pub async fn test_auto_approval(command: String, automation: AutomationPrefs) -> AutoApprovalTest {
    let mut prefs = automation;
    prefs.sanitize();
    explain(&command, &prefs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AllowRule;

    fn prefs(bundles: &[&str]) -> AutomationPrefs {
        AutomationPrefs {
            auto_approve: true,
            bundles: bundles.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    fn one(t: &AutoApprovalTest) -> &Reason {
        assert_eq!(t.reasons.len(), 1, "{t:?}");
        &t.reasons[0]
    }

    #[test]
    fn excluded_for_split_failures_and_danger() {
        let p = prefs(&["files"]);
        for (cmd, code) in [
            ("cat x | sh", "split_pipe"),
            ("cat x > y", "split_redirect"),
            ("cat $HOME/x", "split_subst"),
            ("cat x &", "split_background"),
            ("(cat x)", "split_group"),
            ("cat 'x", "split_quote"),
            ("", "split_empty"),
            ("ls && rm -rf /", "dangerous"),
        ] {
            let t = explain(cmd, &p);
            assert_eq!(t.verdict, Verdict::Excluded, "{cmd}");
            assert_eq!(one(&t).code, code, "{cmd}");
        }
        assert_eq!(one(&explain("ls && rm -rf /", &p)).args["segment"], "rm -rf /");
    }

    /// 파이프(10-22) — 끄면 `split_pipe`(문구가 "파이프(|) 허용" 칸을 가리킨다), 켜면 어느 단계가 범위 밖인지(`pipe_stage`) ·
    /// 다른 명령을 실행하는 단계는 `pipe_runner` · 파이프와 `;`/`||` 섞임은 `split_pipe_mix` · 다 맞으면 자동.
    #[test]
    fn pipes_say_which_stage() {
        let mut p = prefs(&["files"]);
        p.allow_patterns = vec!["uptime".into(), "cat".into()];
        let t = explain("uptime | cat", &p);
        assert_eq!(one(&t).code, "split_pipe");
        p.allow_pipes = true;
        assert_eq!(explain("uptime | cat", &p).verdict, Verdict::Auto);
        let t = explain("uptime | mytool -x", &p);
        assert_eq!(t.verdict, Verdict::Manual);
        assert_eq!(one(&t).code, "pipe_stage");
        assert_eq!(one(&t).args["segment"], "mytool -x");
        let t = explain("cat x | sh", &p);
        assert_eq!(t.verdict, Verdict::Excluded);
        assert_eq!(one(&t).code, "pipe_runner");
        assert_eq!(one(&t).args["segment"], "sh");
        assert_eq!(one(&explain("uptime || cat | cat", &p)).code, "split_pipe_mix");
        assert_eq!(one(&explain("uptime | cat > f", &p)).code, "split_redirect");
    }

    #[test]
    fn auto_names_the_bundle_and_key_for_each_segment() {
        let p = prefs(&["files", "docker"]);
        let t = explain("cat /etc/hosts && docker logs --tail 5 c1", &p);
        assert_eq!(t.verdict, Verdict::Auto);
        assert_eq!(t.reasons.len(), 2);
        assert_eq!(t.reasons[0].code, "match_bundle");
        assert_eq!(t.reasons[0].args["bundle"], "files");
        assert_eq!(t.reasons[0].args["key"], "cat");
        assert_eq!(t.reasons[1].args["key"], "docker logs");
        // 평탄 패턴 · 사용자 규칙도 이름을 댄다.
        let mut q = prefs(&[]);
        q.allow_patterns = vec!["uptime".into()];
        q.allow = vec![AllowRule {
            exec: "mytool".into(),
            ..Default::default()
        }];
        let t = explain("uptime -p; mytool x", &q);
        assert_eq!(t.verdict, Verdict::Auto);
        assert_eq!(t.reasons[0].code, "match_pattern");
        assert_eq!(t.reasons[0].args["pattern"], "uptime");
        assert_eq!(t.reasons[1].code, "match_rule");
    }

    #[test]
    fn manual_reasons_pick_the_nearest_cause() {
        let mut p = prefs(&["files", "logs", "git"]);
        // 인자 제약 — 어느 묶음의 어느 칸인지.
        let r = one(&explain("tail -f /var/log/syslog", &p)).clone();
        assert_eq!((r.code, r.args["kind"].as_str(), r.args["item"].as_str()), ("constraint", "deny", "-f"));
        assert_eq!(r.args["bundle"], "files");
        // 꺼진 묶음이 열어 줄 수 있으면 그 묶음을 댄다.
        let r = one(&explain("git fetch origin", &p)).clone();
        assert_eq!((r.code, r.args["bundle"].as_str()), ("bundle_disabled", "gitfetch"));
        // 서브커맨드 앞 플래그 — 위장 막기.
        let r = one(&explain("git -C /srv status", &p)).clone();
        assert_eq!((r.code, r.args["kind"].as_str()), ("constraint", "sub_first"));
        // 하위 명령이 목록 밖(그리고 어느 묶음도 안 연다).
        let r = one(&explain("git push", &p)).clone();
        assert_eq!((r.code, r.args["sub"].as_str()), ("sub_missing", "push"));
        // 규칙 없음.
        assert_eq!(one(&explain("make build", &p)).code, "no_rule");
        // 묶음에서 끈 명령.
        p.bundle_off.insert("files".into(), vec!["cat".into()]);
        let t = explain("cat /etc/hosts", &p);
        assert_eq!(t.verdict, Verdict::Manual);
        let r = one(&t);
        assert_eq!((r.code, r.args["key"].as_str()), ("bundle_off", "cat"));
    }

    /// 조회 묶음에 든 명령의 **바꾸는 꼴**(10-05 발견 예)은 사람 승인이고, 이유가 묶음 · 명령 키 ·
    /// 걸린 칸 · 낱말을 댄다 — 화면은 "묶음 ‘네트워크’ · ip link: 다음 낱말 set 은 허용되지 않음" 으로 읽힌다.
    #[test]
    fn bundle_refusals_name_the_bundle_key_and_word() {
        let all: Vec<&str> = BUNDLES.iter().map(|b| b.id).collect();
        let p = prefs(&all);
        for (cmd, bundle, key, kind, item) in [
            ("ip link set eth0 down", "network", "ip link", "first_arg", "set"),
            ("/sbin/ip addr del 10.0.0.5/24 dev eth0", "network", "ip addr", "first_arg", "del"),
            ("git branch -D x", "git", "git branch", "not_allowed", "-D"),
            ("journalctl --vacuum-size=1M", "logs", "journalctl", "deny", "--vacuum-size=1M"),
            ("journalctl --rotate", "logs", "journalctl", "deny", "--rotate"),
            ("dmesg -C", "logs", "dmesg", "deny", "-C"),
            ("date -s now", "system", "date", "not_allowed", "-s"),
            ("ss -K dst 10.0.0.1", "network", "ss", "deny", "-K"),
            // 10-10 조회 추가분 — 태그 만들기는 목록 플래그가 없다는 이유로, 이웃 표 비우기는 다음 낱말로.
            ("git tag v1", "git", "git tag", "require", "-l"),
            ("git tag -d v1", "git", "git tag", "not_allowed", "-d"),
            ("ip neigh flush all", "network", "ip neigh", "first_arg", "flush"),
            ("ip a add 10.0.0.1/24 dev eth0", "network", "ip address", "first_arg", "add"),
            ("git blame --contents /etc/shadow f", "git", "git blame", "not_allowed", "--contents"),
        ] {
            let t = explain(cmd, &p);
            assert_eq!(t.verdict, Verdict::Manual, "{cmd}");
            let r = one(&t);
            assert_eq!(
                (
                    r.code,
                    r.args["bundle"].as_str(),
                    r.args["key"].as_str(),
                    r.args["kind"].as_str(),
                    r.args["item"].as_str()
                ),
                ("constraint", bundle, key, kind, item),
                "{cmd}"
            );
        }
        let r = one(&explain("mount /dev/sdb1 /mnt", &p)).clone();
        assert_eq!(
            (r.code, r.args["bundle"].as_str(), r.args["kind"].as_str(), r.args["n"].as_str()),
            ("constraint", "system", "max_args", "0")
        );
        // sudo 접두는 묶음과 무관하게 제외(위험).
        assert_eq!(explain("sudo ip addr show", &p).verdict, Verdict::Excluded);
    }

    #[test]
    fn switch_off_is_reported_but_verdict_is_still_computed() {
        let mut p = prefs(&["files"]);
        p.auto_approve = false;
        let t = explain("ls -la", &p);
        assert!(!t.enabled);
        assert_eq!(t.verdict, Verdict::Auto);
    }

    /// 판정은 술어와 **같다** — 공유 표의 명령 전부에서 `Auto` ⇔ `command_passes_auto_policy`.
    #[test]
    fn verdict_agrees_with_the_real_predicate() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("args_cases.json")).expect("공유 표");
        let mut cmds: Vec<String> = Vec::new();
        for list in ["deny", "allow"] {
            for c in v["bundles"][list].as_array().unwrap() {
                cmds.push(c.as_str().unwrap().to_string());
            }
        }
        for c in v["split"]["deny"].as_array().unwrap().iter().chain(v["split"]["allow"].as_array().unwrap()) {
            cmds.push(c[1].as_str().unwrap().to_string());
        }
        let all: Vec<&str> = BUNDLES.iter().map(|b| b.id).collect();
        let mut p = prefs(&all);
        p.bundle_off.insert("files".into(), vec!["cat".into(), "tail".into()]);
        p.allow_patterns = vec!["uptime".into()];
        for p in [p, prefs(&["files"]), prefs(&[])] {
            for cmd in &cmds {
                let t = explain(cmd, &p);
                assert_eq!(
                    t.verdict == Verdict::Auto,
                    super::super::command_passes_auto_policy(cmd, &p),
                    "{cmd} · {t:?}"
                );
            }
        }
    }

    /// 초안은 저장과 같은 정리를 거친다 — 옛 id 도 옮겨서 판정한다(넓어지지 않게).
    #[test]
    fn command_sanitizes_the_draft_like_a_save() {
        let draft = AutomationPrefs {
            auto_approve: true,
            bundles: vec!["diag-readonly".into()],
            ..Default::default()
        };
        let t = tauri::async_runtime::block_on(test_auto_approval("df -h".into(), draft.clone()));
        assert_eq!(t.verdict, Verdict::Auto);
        // 옛 묶음에 없던 명령은 꺼진 채로 옮겨진다.
        let t = tauri::async_runtime::block_on(test_auto_approval("nproc".into(), draft));
        assert_eq!(t.verdict, Verdict::Manual);
        assert_eq!(t.reasons[0].code, "bundle_off");
    }
}
