use super::*;

/// 켜진 정책 하나 — `policy.test.ts` 의 `prefs()` 헬퍼와 같은 값(조건별로 한 축만 어긋뜨린다).
fn prefs() -> AutomationPrefs {
    AutomationPrefs {
        auto_approve: true,
        allow_patterns: vec!["df".to_string(), "uptime".to_string()],
        max_targets: 10,
        max_concurrency: 4,
        ..Default::default()
    }
}

use crate::settings::AllowRule;

/// exec+서브커맨드 두 규칙 — systemctl 은 서브커맨드 제한, df 는 개념 없음(빈 목록).
fn structured_rules() -> Vec<AllowRule> {
    vec![
        AllowRule {
            exec: "systemctl".to_string(),
            subcommands: vec![
                "is-active".to_string(),
                "status".to_string(),
                "show".to_string(),
            ],
            ..Default::default()
        },
        AllowRule {
            exec: "df".to_string(),
            ..Default::default()
        },
    ]
}

// ── classify_risk — operations.test.ts 와 같은 취지(위험 목록 케이스) ─────────────────

#[test]
fn classify_risk_flags_the_dangerous_list() {
    for cmd in [
        "rm file",
        "rmdir d",
        "dd if=/dev/zero of=x",
        "mkfs.ext4 /dev/sda1",
        "sudo apt update",
        "su root",
        "chmod 777 x",
        "chown me x",
        "kill 1",
        "killall node",
        "pkill nginx",
        "reboot",
        "shutdown now",
        "halt",
        "poweroff",
        "systemctl restart nginx",
        "systemctl stop nginx",
        "echo hi > out",
        "echo hi >> out",
        "find . -name x -delete",
        "git reset --hard HEAD",
        "truncate -s 0 x",
    ] {
        assert_eq!(classify_risk(cmd), Risk::Dangerous, "{cmd}");
    }
}

#[test]
fn classify_risk_leaves_plain_reads_safe() {
    for cmd in [
        "df -h",
        "uptime",
        "ls -la /var/log",
        "systemctl status nginx",
        "cat file",
    ] {
        assert_eq!(classify_risk(cmd), Risk::Safe, "{cmd}");
    }
}

// ── segments_for_auto_approval — policy.test.ts 와 **같은 표**(드리프트 잠금) ─────────

/// 구획 분해의 진실표 — `policy.test.ts` 의 `SEGMENT_TABLE` 과 **행 하나까지 같아야 한다**.
/// `None` = 자동 승인 후보 아님(수동으로 떨어진다).
const SEGMENT_TABLE: &[(&str, Option<&[&str]>)] = &[
    // 단순 단일 명령 — 예전과 같은 판정(구획 하나).
    ("df -h", Some(&["df -h"])),
    ("uptime", Some(&["uptime"])),
    ("  df -h  ", Some(&["df -h"])),
    // 체이닝 — 이번 변경의 핵심. 세 연산자 모두 나뉜다.
    ("df -h && free -m", Some(&["df -h", "free -m"])),
    ("df -h && rm -rf /", Some(&["df -h", "rm -rf /"])), // 분해는 되고, 위험이 뒤에서 막는다.
    ("df; ls", Some(&["df", "ls"])),
    ("df || ls", Some(&["df", "ls"])),
    (
        "cd /srv && ls -la && uptime",
        Some(&["cd /srv", "ls -la", "uptime"]),
    ),
    // 따옴표 안의 연산자는 literal — 나누지 않는다.
    ("echo \"a && b\"", Some(&["echo \"a && b\""])),
    ("echo 'a; b'", Some(&["echo 'a; b'"])),
    ("echo \"a\\\"b\"", Some(&["echo \"a\\\"b\""])), // `\"` 이스케이프는 닫힘이 아니다.
    // 파이프·리다이렉트 — 구획 안에서도 여전히 탈락.
    ("df | sh", None),
    ("df | grep x", None),
    ("df > x", None),
    ("cat < in", None),
    ("df -h && ls > out", None),
    // 치환 — 어디에 있든(따옴표 안에서도) 탈락. `$` 는 통째로 막는다.
    ("df $(x)", None),
    ("echo $HOME", None),
    ("echo `whoami`", None),
    ("echo \"$HOME\"", None),
    ("echo '$HOME'", None),
    // 묶음·그룹·이스케이프·개행.
    ("(cd /tmp)", None),
    ("{ df; }", None),
    ("df\\", None),
    ("df\nrm", None),
    ("df\rrm", None),
    // 백그라운드 `&` — `&&` 의 일부가 아닌 홑 `&` 는 탈락.
    ("df & ls", None),
    ("df &", None),
    ("df -h & ", None),
    // 안 닫힌 따옴표.
    ("echo \"a", None),
    ("echo 'a", None),
    ("echo \"a\\\"", None), // `\"` 를 먹어 치워 따옴표가 안 닫힌다.
    // 빈 구획.
    ("a &&", None),
    ("&& a", None),
    ("df ;; ls", None),
    ("df;", None),
    ("", None),
    ("   ", None),
];

#[test]
fn segments_for_auto_approval_matches_the_shared_table() {
    for (cmd, want) in SEGMENT_TABLE {
        let got = segments_for_auto_approval(cmd);
        match want {
            Some(expected) => {
                let got = got.unwrap_or_else(|| panic!("{cmd:?} 는 분해돼야 한다"));
                assert_eq!(got, *expected, "{cmd:?}");
            }
            None => assert!(
                got.is_none(),
                "{cmd:?} 는 자동 승인 후보가 아니어야 한다: {got:?}"
            ),
        }
    }
}

// ── has_shell_metachar — `cwd` 그물로 남은 옛 규칙(policy.test.ts 미러) ───────────────

#[test]
fn has_shell_metachar_catches_chaining_redirect_subst_group_newline_escape() {
    for cmd in [
        "df; rm -rf /",
        "df | grep x",
        "df && ls",
        "echo `whoami`",
        "echo $HOME",
        "ls > out",
        "cat < in",
        "(cd /tmp)",
        "df\nrm",
        "df\\",
    ] {
        assert!(has_shell_metachar(cmd), "{cmd}");
    }
}

#[test]
fn has_shell_metachar_clears_simple_single_commands() {
    for cmd in [
        "df -h",
        "uptime",
        "ls -la /var/log",
        "systemctl status nginx",
    ] {
        assert!(!has_shell_metachar(cmd), "{cmd}");
    }
}

// ── matches_allowlist — policy.test.ts 미러 ─────────────────────────────────────────

#[test]
fn matches_allowlist_word_boundary_prefix() {
    assert!(matches_allowlist("df", &["df".to_string()]));
    assert!(matches_allowlist("df -h", &["df".to_string()]));
    // 부분 문자열은 안 된다 (dfx 는 df 가 아니다).
    assert!(!matches_allowlist("dfx", &["df".to_string()]));
    assert!(!matches_allowlist("diff a b", &["df".to_string()]));
}

#[test]
fn matches_allowlist_skips_empty_patterns() {
    assert!(!matches_allowlist(
        "df -h",
        &["".to_string(), "   ".to_string()]
    ));
    assert!(!matches_allowlist("df -h", &[]));
}

// ── matches_structured_allow — policy.test.ts 미러(A4b) ─────────────────────────────

#[test]
fn matches_structured_allow_by_exec_and_subcommand() {
    let r = structured_rules();
    // 서브커맨드가 목록에 있으면 통과.
    assert!(matches_structured_allow("systemctl is-active nginx", &r));
    assert!(matches_structured_allow("systemctl status nginx", &r));
    // 목록에 없는 서브커맨드는 불가(restart 는 위임 안 함).
    assert!(!matches_structured_allow("systemctl restart nginx", &r));
    // 빈 subcommands 규칙(df)은 exec 만 맞으면 통과(플래그 무엇이든).
    assert!(matches_structured_allow("df -h", &r));
    assert!(matches_structured_allow("df", &r));
    // basename 비교 — 절대 경로도 exec 로 인정.
    assert!(matches_structured_allow("/usr/bin/systemctl status", &r));
    // 플래그 토큰은 건너뛴다 — `--user` 를 건너 subcommand=status.
    assert!(matches_structured_allow("systemctl --user status", &r));
    // 서브커맨드가 아예 없는 systemctl(개념 있는 규칙)은 부재라 불가.
    assert!(!matches_structured_allow("systemctl --user", &r));
    // 모르는 exec → false.
    assert!(!matches_structured_allow("apt-get install foo", &r));
    // 빈 명령 → false.
    assert!(!matches_structured_allow("", &r));
    assert!(!matches_structured_allow("   ", &r));
}

// ── should_auto_approve — policy.test.ts 의 "다섯 조건" 미러 ─────────────────────────

#[test]
fn should_auto_approve_true_when_all_five_hold() {
    assert!(should_auto_approve("df -h", 3, &prefs()));
    assert!(should_auto_approve("uptime", 1, &prefs()));
}

#[test]
fn should_auto_approve_false_when_off() {
    let mut p = prefs();
    p.auto_approve = false;
    assert!(!should_auto_approve("df -h", 1, &p));
    // 기본 정책(전부 끔)도 false.
    assert!(!should_auto_approve(
        "df -h",
        1,
        &AutomationPrefs::default()
    ));
}

#[test]
fn should_auto_approve_false_for_dangerous_even_if_allowlisted() {
    // 위험(②)이 allowlist(③)를 이긴다.
    let mut p = prefs();
    p.allow_patterns = vec!["rm".to_string()];
    assert!(!should_auto_approve("rm file", 1, &p));
    // 리다이렉트가 붙은 안전 동사도 위험이자 메타문자.
    let mut p2 = prefs();
    p2.allow_patterns = vec!["echo".to_string()];
    assert!(!should_auto_approve("echo hi > out", 1, &p2));
}

#[test]
fn should_auto_approve_false_on_metachar() {
    // 파이프·리다이렉트·치환은 구획 안에서도 여전히 탈락한다.
    assert!(!should_auto_approve("df | cat", 1, &prefs()));
    assert!(!should_auto_approve("df > out", 1, &prefs()));
    assert!(!should_auto_approve("df $(x)", 1, &prefs()));
    // 체이닝은 이제 분해되지만, 목록에 없는 구획(`ls`)이 있으면 그 구획이 전체를 끌어내린다.
    assert!(!should_auto_approve("df; ls", 1, &prefs()));
}

/// 체이닝 — `policy.test.ts` 의 같은 이름 테스트와 **같은 표**(드리프트 잠금).
#[test]
fn should_auto_approve_evaluates_each_chained_segment() {
    // 평탄 목록에 네 동사를 열어 둔다(체이닝 표를 돌리기 위한 픽스처).
    let mut p = prefs();
    p.allow_patterns = vec![
        "df".to_string(),
        "uptime".to_string(),
        "free".to_string(),
        "ls".to_string(),
        "echo".to_string(),
    ];

    // 모든 구획이 허용 + 안전 → 자동 승인.
    assert!(should_auto_approve("df -h && free -m", 1, &p), "둘 다 허용");
    assert!(should_auto_approve("df; ls", 1, &p), "세미콜론");
    assert!(should_auto_approve("df || ls", 1, &p), "||");
    assert!(
        should_auto_approve("echo \"a && b\"", 1, &p),
        "따옴표 안 연산자는 literal"
    );

    // 한 구획이라도 위험하면 전체가 거부(바닥은 그대로).
    assert!(
        !should_auto_approve("df -h && rm -rf /", 1, &p),
        "위험 구획"
    );
    // 한 구획이라도 목록 밖이면 전체가 거부.
    assert!(
        !should_auto_approve("df -h && whoami", 1, &p),
        "목록 밖 구획"
    );
    // 구획 안의 파이프·리다이렉트·치환·백그라운드·안 닫힌 따옴표는 전체를 거부.
    assert!(!should_auto_approve("df | sh", 1, &p), "파이프");
    assert!(!should_auto_approve("df > x", 1, &p), "리다이렉트");
    assert!(!should_auto_approve("df $(x)", 1, &p), "치환");
    assert!(!should_auto_approve("echo \"a", 1, &p), "안 닫힌 따옴표");
    assert!(!should_auto_approve("a &&", 1, &p), "빈 구획");
    assert!(!should_auto_approve("df & ls", 1, &p), "백그라운드 &");

    // `cd` 는 그냥 또 하나의 실행 파일이다 — 목록에 없으면 체이닝 전체가 수동으로 간다.
    assert!(
        !should_auto_approve("cd /srv && ls", 1, &p),
        "cd 는 목록에 없다"
    );
    p.allow_patterns.push("cd".to_string());
    assert!(
        should_auto_approve("cd /srv && ls", 1, &p),
        "cd 를 열면 통과"
    );
}

#[test]
fn should_auto_approve_false_when_not_allowlisted() {
    assert!(!should_auto_approve("ls -la", 1, &prefs()));
    assert!(!should_auto_approve("whoami", 1, &prefs()));
}

#[test]
fn should_auto_approve_respects_max_targets() {
    let p = prefs(); // max_targets = 10
    assert!(should_auto_approve("df -h", 10, &p));
    assert!(!should_auto_approve("df -h", 11, &p));
}

#[test]
fn should_auto_approve_accepts_structured_match_with_floor_intact() {
    // 평탄 목록은 비우고 구조적 규칙만 켠다 — 게이트가 flat OR structured 임을 못 박는다.
    let mut p = prefs();
    p.allow_patterns = vec![];
    p.allow = structured_rules();

    // 구조적으로 매칭되고 안전·메타문자 없음·상한 이내 → 자동 승인.
    assert!(should_auto_approve("systemctl is-active nginx", 3, &p));
    // 목록에 없는 서브커맨드는 구조적으로도 매칭 안 됨 → false.
    assert!(!should_auto_approve("systemctl start nginx", 1, &p));

    // 바닥(floor)은 그대로 AND: 위험(systemctl restart 는 DANGEROUS)·메타문자·상한 초과는
    // 구조적 규칙이 있어도 거부된다.
    assert!(
        !should_auto_approve("systemctl restart nginx", 1, &p),
        "위험"
    );
    // 구획 분해가 돼도 둘째 구획(`rm -rf /`)이 위험이자 목록 밖이라 전체가 거부된다.
    assert!(!should_auto_approve("df -h; rm -rf /", 1, &p), "위험 구획");
    assert!(!should_auto_approve("df -h", 11, &p), "상한 초과");
}

/// 묶음(bundle) — 켜면 그 규칙이 **백엔드 판정에서** 실제로 먹고, 바닥은 그대로다.
/// (`policy.test.ts` 의 같은 이름 테스트와 짝 — 드리프트 잠금.)
#[test]
fn should_auto_approve_honors_enabled_bundles() {
    let mut p = prefs();
    p.allow_patterns = vec![]; // 평탄 목록을 비워 묶음만 남긴다.

    // 묶음을 켜기 전에는 기본 거부 그대로다.
    assert!(
        !should_auto_approve("systemctl status nginx", 1, &p),
        "묶음 꺼짐"
    );

    p.bundles = vec!["services".to_string(), "system".to_string()];
    assert!(
        should_auto_approve("systemctl status nginx", 1, &p),
        "묶음이 연 서브커맨드"
    );
    assert!(
        should_auto_approve("df -h", 1, &p),
        "서브커맨드 개념 없는 규칙"
    );
    assert!(
        should_auto_approve("df -h && free -m", 1, &p),
        "구획 둘 다 묶음 안"
    );

    // 묶음 밖은 여전히 수동이다 — 묶음은 목록을 넓힐 뿐 문을 열지 않는다.
    assert!(
        !should_auto_approve("systemctl restart nginx", 1, &p),
        "위험(②가 이긴다)"
    );
    assert!(
        !should_auto_approve("apt-get install x", 1, &p),
        "묶음 밖 exec"
    );
    assert!(
        !should_auto_approve("git status", 1, &p),
        "다른 묶음의 규칙"
    );
    assert!(!should_auto_approve("df | sh", 1, &p), "파이프");
    assert!(!should_auto_approve("df -h", 11, &p), "상한 초과");

    // 토글이 꺼져 있으면 묶음이 켜져 있어도 아무것도 자동 승인되지 않는다(①).
    p.auto_approve = false;
    assert!(!should_auto_approve("df -h", 1, &p), "auto_approve 꺼짐");

    // 모르는 id 는 조용히 무시된다(설정은 보존된다 — sanitize 가 지우지 않는다).
    let mut q = prefs();
    q.allow_patterns = vec![];
    q.bundles = vec!["from-the-future".to_string()];
    assert!(
        !should_auto_approve("df -h", 1, &q),
        "모르는 묶음은 아무 규칙도 안 연다"
    );
}

#[test]
fn should_auto_approve_flat_or_structured_are_additive() {
    // 평탄 목록(df·uptime)과 구조적 규칙(systemctl) 둘 다 켜면 양쪽 다 통과한다(OR).
    let mut p = prefs();
    p.allow = structured_rules();
    assert!(should_auto_approve("uptime", 1, &p), "평탄 prefix");
    assert!(
        should_auto_approve("systemctl status nginx", 1, &p),
        "구조적"
    );
}

// ── 인자 제약 — args_cases.json 공유 표(policy.test.ts 가 같은 파일을 읽는다) ─────────────

/// 공유 표 — Rust·TS 가 **같은 파일**을 읽는다(2026-10-05, docs/log/2026-10-05-auto-approve-args.md).
const ARGS_CASES: &str = include_str!("args_cases.json");

fn args_cases() -> serde_json::Value {
    serde_json::from_str(ARGS_CASES).expect("args_cases.json 은 유효한 JSON 이다")
}

/// 묶음 열 개를 전부 켜고 평탄 패턴은 비운 정책(세분화 전에는 옛 두 묶음이었다 — 같은 표가 그대로 통한다).
fn bundle_prefs() -> AutomationPrefs {
    AutomationPrefs {
        auto_approve: true,
        allow_patterns: vec![],
        bundles: crate::automation_presets::BUNDLES
            .iter()
            .map(|b| b.id.to_string())
            .collect(),
        ..Default::default()
    }
}

/// 기본 묶음은 '읽기 전용' 이라는 이름을 지킨다 — 위험 예시는 전부 거부, 의도한 읽기는 전부 허용.
#[test]
fn bundles_deny_writes_and_endless_commands_but_allow_intended_reads() {
    let v = args_cases();
    let p = bundle_prefs();
    let deny = v["bundles"]["deny"].as_array().expect("deny 표");
    let allow = v["bundles"]["allow"].as_array().expect("allow 표");
    assert!(deny.len() > 50 && allow.len() > 50, "표를 실제로 읽었다");
    for c in deny {
        let cmd = c.as_str().unwrap();
        assert!(!command_passes_auto_policy(cmd, &p), "자동 승인되면 안 된다: {cmd}");
    }
    for c in allow {
        let cmd = c.as_str().unwrap();
        assert!(command_passes_auto_policy(cmd, &p), "자동 승인돼야 한다: {cmd}");
    }
}

/// 규칙 몇 개만 둔 `matches_structured_allow` — 옛 모양 하위 호환과 새 칸 다섯의 의미.
#[test]
fn structured_allow_argument_constraints_match_the_shared_table() {
    let v = args_cases();
    for group in v["rules"].as_array().expect("rules 표") {
        let rules: Vec<AllowRule> =
            serde_json::from_value(group["rules"].clone()).expect("규칙이 AllowRule 로 읽힌다");
        for case in group["cases"].as_array().unwrap() {
            let cmd = case[0].as_str().unwrap();
            let want = case[1].as_bool().unwrap();
            assert_eq!(
                matches_structured_allow(cmd, &rules),
                want,
                "{cmd:?} · 규칙 {:?}",
                group["rules"]
            );
        }
    }
}

/// 따옴표 벗긴 낱말 — 공유 표.
#[test]
fn shell_words_match_the_shared_table() {
    let v = args_cases();
    for case in v["words"].as_array().expect("words 표") {
        let input = case[0].as_str().unwrap();
        let want: Option<Vec<String>> = serde_json::from_value(case[1].clone()).unwrap();
        assert_eq!(shell_words(input), want, "{input:?}");
    }
}

// ── 세분화(2026-10-05) — 묶음별 표 · 끈 명령 · 옛 묶음 옮기기 ─────────────────────────────

/// 묶음 열 개 — 위험 예시는 전부 켜도 거부, 대표 조회는 **그 묶음 하나만** 켜도 허용(어느 묶음에 있는지까지).
#[test]
fn split_bundles_deny_writes_and_allow_their_own_reads() {
    let v = args_cases();
    let all = bundle_prefs();
    let deny = v["split"]["deny"].as_array().expect("split.deny");
    let allow = v["split"]["allow"].as_array().expect("split.allow");
    assert!(deny.len() > 80 && allow.len() > 100, "표를 실제로 읽었다");
    for c in deny {
        let cmd = c[1].as_str().unwrap();
        assert!(!command_passes_auto_policy(cmd, &all), "자동 승인되면 안 된다: {cmd}");
    }
    let mut covered = std::collections::HashSet::new();
    for c in allow {
        let (bundle, cmd) = (c[0].as_str().unwrap(), c[1].as_str().unwrap());
        assert!(crate::automation_presets::bundle_by_id(bundle).is_some(), "없는 묶음 {bundle}");
        let mut p = bundle_prefs();
        p.bundles = vec![bundle.to_string()];
        assert!(command_passes_auto_policy(cmd, &p), "{bundle} 하나로 자동 승인돼야 한다: {cmd}");
        covered.insert(bundle);
    }
    for b in crate::automation_presets::BUNDLES {
        assert!(covered.contains(b.id), "{} 의 허용 예시가 표에 없다", b.id);
    }
}

/// 묶음 안 끈 명령 — 그 명령만 수동으로, 같은 묶음의 다른 명령은 그대로.
#[test]
fn bundle_off_turns_single_commands_back_to_manual() {
    let mut p = bundle_prefs();
    p.bundles = vec!["files".to_string(), "docker".to_string()];
    assert!(command_passes_auto_policy("cat /etc/hosts", &p));
    p.bundle_off
        .insert("files".to_string(), vec!["cat".to_string()]);
    p.bundle_off
        .insert("docker".to_string(), vec!["docker compose".to_string()]);
    assert!(!command_passes_auto_policy("cat /etc/hosts", &p), "끈 명령");
    assert!(command_passes_auto_policy("ls -la", &p), "같은 묶음의 다른 명령");
    assert!(!command_passes_auto_policy("docker compose ps", &p), "같은 키의 두 줄 모두");
    assert!(!command_passes_auto_policy("docker compose logs --tail 5", &p));
    assert!(command_passes_auto_policy("docker ps", &p));
    // 체이닝 — 한 구획이라도 끈 명령이면 전체가 수동.
    assert!(!command_passes_auto_policy("ls && cat x", &p));
    // 모르는 묶음·키의 끄기는 아무 일도 안 한다(넓히지도 않는다).
    p.bundle_off
        .insert("nope".to_string(), vec!["ls".to_string()]);
    assert!(command_passes_auto_policy("ls -la", &p));
}

/// 옛 묶음 두 개를 켠 설정을 그대로 흉내 낸 정책 — 옛 규칙을 사용자 규칙 자리에 둔다.
fn legacy_prefs(v: &serde_json::Value) -> AutomationPrefs {
    let mut allow: Vec<AllowRule> = Vec::new();
    for id in ["diag-readonly", "git-readonly"] {
        let rules: Vec<AllowRule> =
            serde_json::from_value(v["legacy"]["rules"][id].clone()).expect("legacy 규칙");
        assert!(!rules.is_empty());
        allow.extend(rules);
    }
    AutomationPrefs {
        auto_approve: true,
        allow,
        ..Default::default()
    }
}

/// **옮기기는 넓어지지 않는다** — 옛 두 묶음으로 거부되던 명령은 옮긴 뒤에도 거부된다(공유 표 전부 +
/// 새 명령·위장 예시). 옛 묶음이 허용하던 일상 조회(`bundles.allow`)는 옮긴 뒤에도 그대로 허용된다.
#[test]
fn migrating_legacy_bundles_never_widens_the_scope() {
    let v = args_cases();
    let legacy = legacy_prefs(&v);
    let mut migrated = AutomationPrefs {
        auto_approve: true,
        bundles: vec!["diag-readonly".to_string(), "git-readonly".to_string()],
        ..Default::default()
    };
    migrated.sanitize();
    assert!(!migrated.bundles.iter().any(|b| b.ends_with("-readonly")), "{:?}", migrated.bundles);

    let mut corpus: Vec<String> = Vec::new();
    for list in ["deny", "allow"] {
        for c in v["bundles"][list].as_array().unwrap() {
            corpus.push(c.as_str().unwrap().to_string());
        }
        for c in v["split"][list].as_array().unwrap() {
            corpus.push(c[1].as_str().unwrap().to_string());
        }
    }
    for c in v["legacy"]["extra"].as_array().unwrap() {
        corpus.push(c.as_str().unwrap().to_string());
    }
    assert!(corpus.len() > 400, "표를 실제로 읽었다");
    let mut narrowed = 0;
    for cmd in &corpus {
        let before = command_passes_auto_policy(cmd, &legacy);
        let after = command_passes_auto_policy(cmd, &migrated);
        assert!(before || !after, "옮긴 뒤 넓어졌다: {cmd}");
        if before && !after {
            narrowed += 1;
        }
    }
    // 새 명령·위장 예시는 옛 묶음이 거부했고 옮긴 뒤에도 거부한다.
    for c in v["legacy"]["extra"].as_array().unwrap() {
        let cmd = c.as_str().unwrap();
        assert!(!command_passes_auto_policy(cmd, &migrated), "옮긴 뒤 열렸다: {cmd}");
    }
    // 위장(앞 플래그의 값)은 옛 묶음이 열어 두던 구멍이다 — 옮긴 뒤 좁아진 몫에 든다.
    assert!(command_passes_auto_policy("git -C status push origin main", &legacy));
    assert!(narrowed > 0);
    // 일상 조회는 그대로.
    for c in v["bundles"]["allow"].as_array().unwrap() {
        let cmd = c.as_str().unwrap();
        assert!(command_passes_auto_policy(cmd, &migrated), "옮긴 뒤 막혔다: {cmd}");
    }
    // 옮긴 뒤 켜진 명령 키는 전부 옛 묶음에 있던 키다.
    let legacy_keys: Vec<&str> = crate::automation_presets::LEGACY_BUNDLES
        .iter()
        .flat_map(|(_, _, keys)| keys.iter().copied())
        .collect();
    for id in &migrated.bundles {
        let b = crate::automation_presets::bundle_by_id(id).unwrap();
        for k in b.command_keys() {
            if !crate::automation_presets::is_off(&migrated.bundle_off, id, &k) {
                assert!(legacy_keys.contains(&k.as_str()), "{id}/{k} 가 켜진 채로 옮겨졌다");
            }
        }
    }
}

// ── 파이프 허용(10-22 옵트인 · `allow_pipes`) — args_cases.json 의 `pipes` 표(policy.test.ts 가 같은 파일을 읽는다) ─────────

fn pipe_prefs(v: &serde_json::Value, on: bool) -> AutomationPrefs {
    AutomationPrefs {
        auto_approve: true,
        allow_patterns: v["pipes"]["allow"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect(),
        allow_pipes: on,
        ..Default::default()
    }
}

fn table<'a>(v: &'a serde_json::Value, side: &str, kind: &str) -> Vec<&'a str> {
    v["pipes"][side][kind].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect()
}

/// 끄면 **예전과 한 글자도 다르지 않다** — 파이프는 사람 승인, `&&` · `||` · `;` 는 구획마다(예전 그대로).
#[test]
fn pipes_off_is_exactly_as_before() {
    let v = args_cases();
    let p = pipe_prefs(&v, false);
    for cmd in table(&v, "off", "pass") {
        assert!(command_passes_auto_policy(cmd, &p), "끔 · 통과해야: {cmd}");
    }
    for cmd in table(&v, "off", "fail") {
        assert!(!command_passes_auto_policy(cmd, &p), "끔 · 사람 승인: {cmd}");
        assert_eq!(split_for_policy(cmd, false), split_segments(cmd).map(|s| (s, false)), "끔이면 분해도 예전 그대로: {cmd}");
    }
    // `uptime | cat` — 두 단계 다 허용이어도 끔이면 사람 승인, 켜면 통과(오직 이 칸만이 가른다).
    assert!(!command_passes_auto_policy("uptime | cat", &p));
    assert!(command_passes_auto_policy("uptime | cat", &pipe_prefs(&v, true)));
    assert!(!should_auto_approve("uptime | cat", 1, &p));
    assert!(should_auto_approve("uptime | cat", 1, &pipe_prefs(&v, true)));
}

/// 켜면 단계마다 — 단계 하나하나가 위험 아님 + 허용. 다른 명령을 실행하는 단계 · 리다이렉트 · 치환 · `;` · `||` 섞임은 늘 사람 승인.
#[test]
fn pipes_on_every_stage_must_pass_and_runners_never_do() {
    let v = args_cases();
    let p = pipe_prefs(&v, true);
    for cmd in table(&v, "on", "pass") {
        assert!(command_passes_auto_policy(cmd, &p), "켬 · 통과해야: {cmd}");
    }
    for cmd in table(&v, "on", "fail") {
        assert!(!command_passes_auto_policy(cmd, &p), "켬 · 사람 승인: {cmd}");
    }
    // 실행기 단계는 허용 목록에 넣어도 거절(xargs · sh · tee 를 패턴에 더해도).
    let mut wide = p.clone();
    wide.allow_patterns.extend(["xargs", "sh", "tee", "rm", "env"].map(String::from));
    for cmd in ["cat x | sh", "ls | xargs rm", "ps | tee f", "ls | env cat"] {
        assert!(!command_passes_auto_policy(cmd, &wide), "허용 목록에 있어도 거절: {cmd}");
    }
    assert!(!command_passes_auto_policy("a | b > f", &wide));
    assert!(!command_passes_auto_policy("uptime || ls | cat", &wide), "파이프와 || 는 섞지 않는다");
    for s in ["xargs rm", "sh", "tee f", "env cat", "find . -exec rm {} +", "find . -delete", "awk '{system(1)}'", "FOO=1 cat"] {
        assert!(pipe_stage_refused(s), "{s}");
    }
    for s in ["cat", "sort -rh", "head -n 10", "find /x -name y", "awk '{print}'"] {
        assert!(!pipe_stage_refused(s), "{s}");
    }
}

