use super::*;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use russh::{MethodKind, MethodSet};

use crate::ssh_config::{HostEntry, StrictHostKeyChecking};

// ---- 연결 공유의 열쇠 (docs/log/2026-09-23-ssh-connection-sharing.md) ----

/// `resolve_params` 가 내놓는 모양의 최소 파라미터.
fn share_params(user: &str, host: &str, port: u16) -> ConnectParams {
    ConnectParams {
        host: host.into(),
        port,
        user: user.into(),
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        strict: StrictHostKeyChecking::Yes,
        no_host_key_store: false,
        identity_file: None,
        identities_only: false,
        forward_agent: false,
        jump: None,
    }
}

#[test]
fn the_same_alias_always_lands_on_the_same_transport() {
    let p = share_params("deploy", "10.0.0.7", 22);
    assert_eq!(
        transport_key(&p, "web-01", false),
        transport_key(&p, "web-01", false)
    );
    // 별칭은 config 매칭과 같은 규칙으로 대소문자를 무시한다.
    assert_eq!(
        transport_key(&p, "web-01", false),
        transport_key(&p, "WEB-01", false)
    );
}

#[test]
fn two_aliases_to_the_same_server_are_not_merged() {
    let p = share_params("deploy", "10.0.0.7", 22);
    assert_ne!(
        transport_key(&p, "web-01", false),
        transport_key(&p, "web-01-admin", false),
        "블록이 다르면 우리가 안 읽는 줄도 다를 수 있다 — 애매하면 나눈다"
    );
}

#[test]
fn quick_connect_keys_on_user_host_port_not_the_display_name() {
    let p = share_params("me", "box.example.com", 2222);
    // 빠른 접속에는 config 블록이 없다 — 화면 이름이 무엇이든 같은 곳이면 같은 열쇠다.
    assert_eq!(
        transport_key(&p, "me@box.example.com:2222", true),
        transport_key(&p, "무엇이든", true)
    );
    // 그래도 설정 호스트와는 섞이지 않는다 (이름 칸이 비어 있다).
    assert_ne!(
        transport_key(&p, "box", true),
        transport_key(&p, "box", false)
    );
}

#[test]
fn a_different_target_under_the_same_alias_makes_a_different_key() {
    // 앱이 도는 중에 ~/.ssh/config 를 고치면 같은 별칭이 다른 서버를 가리킨다.
    let a = share_params("deploy", "10.0.0.7", 22);
    let b = share_params("deploy", "10.0.0.8", 22);
    let c = share_params("root", "10.0.0.7", 22);
    let d = share_params("deploy", "10.0.0.7", 2222);
    assert_ne!(
        transport_key(&a, "web", false),
        transport_key(&b, "web", false)
    );
    assert_ne!(
        transport_key(&a, "web", false),
        transport_key(&c, "web", false)
    );
    assert_ne!(
        transport_key(&a, "web", false),
        transport_key(&d, "web", false)
    );
}

#[test]
fn the_jump_chain_is_part_of_the_key() {
    let plain = share_params("deploy", "10.0.0.7", 22);
    let mut viaa = plain.clone();
    viaa.jump = Some(JumpParams {
        label: "gw".into(),
        host: "gw.example.com".into(),
        port: 22,
        user: "jump".into(),
        keepalive_interval: None,
        keepalive_max: 3,
        strict: StrictHostKeyChecking::Yes,
        no_host_key_store: false,
        identity_file: None,
        identities_only: false,
    });
    let mut viab = viaa.clone();
    viab.jump.as_mut().unwrap().host = "gw2.example.com".into();
    assert_ne!(
        transport_key(&plain, "web", false),
        transport_key(&viaa, "web", false)
    );
    assert_ne!(
        transport_key(&viaa, "web", false),
        transport_key(&viab, "web", false)
    );
}

#[test]
fn identity_rules_split_the_key() {
    let plain = share_params("deploy", "10.0.0.7", 22);
    let mut only = plain.clone();
    only.identities_only = true;
    let mut file = plain.clone();
    file.identity_file = Some("~/.ssh/id_ed25519".into());
    assert_ne!(
        transport_key(&plain, "web", false),
        transport_key(&only, "web", false)
    );
    assert_ne!(
        transport_key(&plain, "web", false),
        transport_key(&file, "web", false)
    );
}

#[test]
fn the_separator_cannot_be_forged_from_a_host_name() {
    // 사용자가 적을 수 있는 글자(`@`·`:`)로 이었다면 이 둘이 같은 문자열이 됐다.
    let a = share_params("deploy", "a", 22);
    let b = share_params("deploy", "a", 22);
    assert_ne!(
        transport_key(&a, "web", false),
        transport_key(&b, "web@x", false)
    );
    assert!(
        transport_key(&a, "web", false).contains('\x1f'),
        "구분자는 사용자가 못 적는 글자여야 한다"
    );
}

// ---- exec 누적기 (단계 9) — russh 없이 순수 상태만 검증한다 ----

#[test]
fn exec_accum_separates_stdout_and_stderr_and_keeps_exit() {
    let mut a = ExecAccum::default();
    a.push_stdout(b"out line 1\n");
    a.push_stderr(b"err line 1\n");
    a.push_stdout(b"out line 2\n");
    a.set_exit(0);
    let o = a.into_outcome(false, false, true);
    assert_eq!(o.stdout, "out line 1\nout line 2\n");
    assert_eq!(o.stderr, "err line 1\n");
    assert_eq!(o.exit_code, Some(0));
    assert!(!o.timed_out);
    assert!(!o.cancelled);
    assert!(o.launched, "정상 종료는 명령이 이미 나갔다");
    assert!(o.error.is_none());
}

// ---- await_bounded (단계 9 lifecycle) — 채널 열기·exec 요청을 감싸는 데드라인·취소 로직 ----
//
// run_exec 자체는 살아 있는 SSH 채널이 필요해 단위 테스트가 어렵다. 그래서 그 견고성의 핵심인
// await_bounded 를 떼어 여기서 준비/타임아웃/취소 세 갈래를 검증한다(읽기 루프·classify 는 그대로).

#[tokio::test]
async fn await_bounded_returns_ready_value() {
    let cancel = AtomicBool::new(false);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let r = await_bounded(std::future::ready(7u8), deadline, &cancel).await;
    assert!(matches!(r, Bounded::Ready(7)));
}

#[tokio::test]
async fn await_bounded_times_out_when_future_hangs() {
    let cancel = AtomicBool::new(false);
    let deadline = tokio::time::Instant::now() + Duration::from_millis(40);
    let r = await_bounded(std::future::pending::<u8>(), deadline, &cancel).await;
    assert!(
        matches!(r, Bounded::TimedOut),
        "hang 은 데드라인에 걸려야 한다"
    );
}

#[tokio::test]
async fn await_bounded_honors_cancel_over_a_hang() {
    let cancel = AtomicBool::new(true); // 이미 취소된 채로 들어온다
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let r = await_bounded(std::future::pending::<u8>(), deadline, &cancel).await;
    assert!(
        matches!(r, Bounded::Cancelled),
        "취소가 데드라인보다 먼저다"
    );
}

#[test]
fn exec_accum_marks_timeout_and_cancel_without_exit() {
    let timed = ExecAccum::default().into_outcome(true, false, false);
    assert!(timed.timed_out);
    assert!(timed.exit_code.is_none(), "타임아웃은 종료 코드가 없다");

    let cancelled = ExecAccum::default().into_outcome(false, true, false);
    assert!(cancelled.cancelled);
    assert!(!cancelled.launched, "시작 전 취소는 launched=false");
    assert!(cancelled.exit_code.is_none());
}

#[test]
fn append_capped_keeps_the_tail_on_a_char_boundary() {
    // 상한을 넘겨 쌓으면 앞을 버리고 tail 만 남긴다 — 최근 줄이 산다.
    let mut buf = String::new();
    assert!(!append_capped(&mut buf, &"a".repeat(EXEC_OUTPUT_CAP)));
    assert!(append_capped(&mut buf, "TAIL"), "넘쳤으면 잘림을 알린다");
    assert!(
        buf.len() <= EXEC_OUTPUT_CAP,
        "상한을 넘겨 쥐지 않는다: {}",
        buf.len()
    );
    assert!(buf.ends_with("TAIL"), "마지막 바이트가 살아 있어야 한다");

    // 멀티바이트 문자를 반토막 내지 않는다(자를 지점을 문자 경계로 민다).
    let mut multi = String::new();
    append_capped(&mut multi, &"가".repeat(EXEC_OUTPUT_CAP));
    append_capped(&mut multi, "나다");
    assert!(multi.len() <= EXEC_OUTPUT_CAP);
    assert!(multi.ends_with("나다"));
    // 잘린 결과가 여전히 올바른 UTF-8 이다(String 이라 당연하지만, 경계 처리의 회귀 방지).
    assert!(multi.chars().all(|c| c == '가' || c == '나' || c == '다'));
}

#[test]
fn exec_accum_rejoins_utf8_split_across_chunks() {
    // 한글은 글자당 3바이트 — 어느 경계로 잘라 두 조각·세 조각으로 넣어도 원문 그대로여야 한다.
    let src = "가나다";
    let b = src.as_bytes();
    for i in 0..=b.len() {
        let mut a = ExecAccum::default();
        a.push_stdout(&b[..i]);
        a.push_stdout(&b[i..]);
        a.push_stderr(&b[..i]);
        a.push_stderr(&b[i..]);
        let o = a.into_outcome(false, false, true);
        assert_eq!(o.stdout, src, "두 조각 경계 {i}");
        assert_eq!(o.stderr, src, "stderr 두 조각 경계 {i}");
        for j in i..=b.len() {
            let mut a = ExecAccum::default();
            a.push_stdout(&b[..i]);
            a.push_stdout(&b[i..j]);
            a.push_stdout(&b[j..]);
            assert_eq!(a.into_outcome(false, false, true).stdout, src, "세 조각 경계 {i}·{j}");
        }
    }
}

#[test]
fn capped_text_replaces_only_bad_bytes_and_flushes_tail() {
    // 진짜 잘못된 바이트는 그 자리만 U+FFFD — 뒤 글자는 산다.
    let mut t = CappedText::default();
    t.push(b"a\xffb");
    assert_eq!(t.finish().0, "a\u{FFFD}b");
    // 스트림이 글자 중간에서 끝나면 남은 꼬리는 손실 변환으로 마무리한다(버리지 않는다).
    let mut t = CappedText::default();
    t.push(&"가".as_bytes()[..2]);
    assert_eq!(t.finish(), ("\u{FFFD}".to_string(), false));
}

#[test]
fn exec_accum_marks_truncation_and_keeps_char_boundary() {
    // 상한을 넘기면 truncated 가 서고, 조각 경계에 걸린 글자도 깨지지 않는다.
    let big = "가".repeat(EXEC_OUTPUT_CAP / 3 + 10);
    let b = big.as_bytes();
    let mut a = ExecAccum::default();
    for chunk in b.chunks(32 * 1024 - 1) {
        // 32KiB-1 — 3의 배수가 아니라 매번 글자 중간에서 끊긴다.
        a.push_stdout(chunk);
    }
    a.push_stderr(b"short");
    let o = a.into_outcome(false, false, true);
    assert!(o.stdout_truncated);
    assert!(!o.stderr_truncated);
    assert!(o.stdout.len() <= EXEC_OUTPUT_CAP);
    assert!(o.stdout.chars().all(|c| c == '가'), "U+FFFD 가 섞이면 안 된다");
}

fn entry(name: &str) -> HostEntry {
    HostEntry {
        name: name.to_string(),
        ..HostEntry::default()
    }
}

#[test]
fn resolves_all_fields_from_config() {
    let hosts = vec![HostEntry {
        name: "web".into(),
        host_name: Some("10.0.0.1".into()),
        user: Some("deploy".into()),
        port: Some(2222),
        server_alive_interval: Some(15),
        server_alive_count_max: Some(5),
        ..HostEntry::default()
    }];

    let p = resolve_params("web", &hosts, Some("you")).unwrap();
    assert_eq!(
        p,
        ConnectParams {
            host: "10.0.0.1".into(),
            port: 2222,
            user: "deploy".into(),
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 5,
            strict: StrictHostKeyChecking::Yes,
            no_host_key_store: false,
            identity_file: None,
            identities_only: false,
            forward_agent: false,
            jump: None,
        }
    );
}

#[test]
fn falls_back_to_alias_port_22_and_env_user() {
    let hosts = vec![entry("web")];
    let p = resolve_params("web", &hosts, Some("you")).unwrap();
    // HostName 이 없으면 별칭이 곧 호스트 이름.
    assert_eq!(p.host, "web");
    assert_eq!(p.port, 22);
    assert_eq!(p.user, "you");
    assert_eq!(p.keepalive_interval, Some(Duration::from_secs(30)));
    assert_eq!(p.keepalive_max, 3);
}

#[test]
fn unknown_alias_is_treated_as_hostname() {
    let p = resolve_params("box.example.com", &[], Some("you")).unwrap();
    assert_eq!(p.host, "box.example.com");
    assert_eq!(p.port, 22);
    assert_eq!(p.user, "you");
}

#[test]
fn alias_lookup_is_case_insensitive() {
    let hosts = vec![HostEntry {
        name: "Web".into(),
        host_name: Some("10.0.0.1".into()),
        ..HostEntry::default()
    }];
    assert_eq!(
        resolve_params("web", &hosts, Some("u")).unwrap().host,
        "10.0.0.1"
    );
}

#[test]
fn config_user_beats_environment() {
    let hosts = vec![HostEntry {
        name: "web".into(),
        user: Some("deploy".into()),
        ..HostEntry::default()
    }];
    assert_eq!(
        resolve_params("web", &hosts, Some("you")).unwrap().user,
        "deploy"
    );
}

#[test]
fn missing_user_everywhere_is_an_error() {
    let err = resolve_params("web", &[entry("web")], None).unwrap_err();
    match err {
        SshOpenError::Other { message, .. } => {
            assert!(message.contains("사용자 이름"), "{message}")
        }
        other => panic!("Other 를 기대했는데 {other:?}"),
    }
    // 빈 문자열도 없는 것으로 본다.
    assert!(resolve_params("web", &[entry("web")], Some("")).is_err());
}

#[test]
fn keepalive_interval_zero_disables_keepalive() {
    let hosts = vec![HostEntry {
        name: "web".into(),
        server_alive_interval: Some(0),
        ..HostEntry::default()
    }];
    assert_eq!(
        resolve_params("web", &hosts, Some("u"))
            .unwrap()
            .keepalive_interval,
        None
    );
}

#[test]
fn proxy_jump_on_another_host_does_not_leak() {
    let hosts = vec![
        HostEntry {
            name: "bastioned".into(),
            proxy_jump: Some("bastion".into()),
            ..HostEntry::default()
        },
        entry("web"),
    ];
    assert_eq!(resolve_params("web", &hosts, Some("u")).unwrap().jump, None);
}

// ── ProxyJump 파싱 (순수 함수) ───────────────────────────────────────────

fn spec(raw: &str) -> JumpSpec {
    parse_jump_spec(raw).unwrap().expect("점프가 있어야 한다")
}

#[test]
fn plain_host_is_the_whole_spec() {
    assert_eq!(
        spec("bastion"),
        JumpSpec {
            user: None,
            host: "bastion".into(),
            port: None,
        }
    );
}

#[test]
fn user_and_port_are_split_off() {
    assert_eq!(
        spec("jump@bastion.example.com:2222"),
        JumpSpec {
            user: Some("jump".into()),
            host: "bastion.example.com".into(),
            port: Some(2222),
        }
    );
    assert_eq!(spec("jump@bastion").user.as_deref(), Some("jump"));
    assert_eq!(spec("bastion:2222").port, Some(2222));
    assert_eq!(spec("bastion:2222").user, None);
}

#[test]
fn spec_is_trimmed_and_empty_means_no_jump() {
    assert_eq!(spec("  bastion  ").host, "bastion");
    assert_eq!(parse_jump_spec("").unwrap(), None);
    assert_eq!(parse_jump_spec("   ").unwrap(), None);
    // OpenSSH 는 상위 블록의 ProxyJump 를 `none` 으로 취소한다.
    assert_eq!(parse_jump_spec("none").unwrap(), None);
    assert_eq!(parse_jump_spec("None").unwrap(), None);
}

#[test]
fn ipv6_forms_are_understood() {
    // 대괄호 표기는 포트를 분리하고, 맨 IPv6 은 통째로 호스트다.
    assert_eq!(
        spec("[fd00::1]:2222"),
        JumpSpec {
            user: None,
            host: "fd00::1".into(),
            port: Some(2222),
        }
    );
    assert_eq!(spec("[fd00::1]").host, "fd00::1");
    assert_eq!(
        spec("jump@[fd00::1]:22"),
        JumpSpec {
            user: Some("jump".into()),
            host: "fd00::1".into(),
            port: Some(22),
        }
    );
    assert_eq!(spec("fd00::1").host, "fd00::1");
    assert_eq!(spec("fd00::1").port, None);
}

#[test]
fn multiple_hops_are_rejected() {
    // 조용히 첫 홉만 쓰면 사용자가 의도하지 않은 경로로 나간다.
    match parse_jump_spec("a,b").unwrap_err() {
        SshOpenError::Other { message, .. } => assert_eq!(message, multi_jump()),
        other => panic!("Other 를 기대했는데 {other:?}"),
    }
    assert!(parse_jump_spec("u@a:22,u@b:22").is_err());
}

#[test]
fn broken_specs_are_errors() {
    // 숫자가 아닌 포트, 닫히지 않은 대괄호, 호스트 없음.
    assert!(parse_jump_spec("bastion:port").is_err());
    assert!(parse_jump_spec("bastion:99999").is_err());
    assert!(parse_jump_spec("[fd00::1:22").is_err());
    assert!(parse_jump_spec("user@").is_err());
}

// ── ProxyJump 해석 (config 반영) ─────────────────────────────────────────

fn jump_of(hosts: &[HostEntry], alias: &str) -> JumpParams {
    resolve_params(alias, hosts, Some("me"))
        .unwrap()
        .jump
        .expect("점프가 있어야 한다")
}

#[test]
fn jump_alias_is_resolved_from_the_config() {
    let hosts = vec![
        HostEntry {
            name: "web".into(),
            host_name: Some("10.0.0.1".into()),
            proxy_jump: Some("bastion".into()),
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            host_name: Some("gw.example.com".into()),
            user: Some("jump".into()),
            port: Some(2222),
            server_alive_interval: Some(10),
            server_alive_count_max: Some(9),
            ..HostEntry::default()
        },
    ];

    assert_eq!(
        jump_of(&hosts, "web"),
        JumpParams {
            label: "bastion".into(),
            host: "gw.example.com".into(),
            port: 2222,
            user: "jump".into(),
            keepalive_interval: Some(Duration::from_secs(10)),
            keepalive_max: 9,
            strict: StrictHostKeyChecking::Yes,
            no_host_key_store: false,
            identity_file: None,
            identities_only: false,
        }
    );
}

#[test]
fn jump_alias_lookup_is_case_insensitive() {
    let hosts = vec![
        HostEntry {
            name: "web".into(),
            proxy_jump: Some("BASTION".into()),
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            host_name: Some("gw.example.com".into()),
            ..HostEntry::default()
        },
    ];
    assert_eq!(jump_of(&hosts, "web").host, "gw.example.com");
}

#[test]
fn explicit_user_and_port_beat_the_alias_block() {
    let hosts = vec![
        HostEntry {
            name: "web".into(),
            proxy_jump: Some("root@bastion:2200".into()),
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            host_name: Some("gw.example.com".into()),
            user: Some("jump".into()),
            port: Some(2222),
            ..HostEntry::default()
        },
    ];
    let j = jump_of(&hosts, "web");
    assert_eq!(j.host, "gw.example.com");
    assert_eq!(j.user, "root");
    assert_eq!(j.port, 2200);
}

#[test]
fn unknown_jump_alias_is_treated_as_a_hostname() {
    let hosts = vec![HostEntry {
        name: "web".into(),
        proxy_jump: Some("gw.example.com".into()),
        ..HostEntry::default()
    }];
    assert_eq!(
        jump_of(&hosts, "web"),
        JumpParams {
            label: "gw.example.com".into(),
            host: "gw.example.com".into(),
            port: 22,
            // config 에 User 가 없으면 대상과 같은 fallback 을 쓴다.
            user: "me".into(),
            keepalive_interval: Some(Duration::from_secs(DEFAULT_KEEPALIVE_SECS)),
            keepalive_max: DEFAULT_KEEPALIVE_MAX,
            // config 에 없는 이름이므로 완화가 붙을 자리가 없다 — 항상 검증.
            strict: StrictHostKeyChecking::Yes,
            no_host_key_store: false,
            identity_file: None,
            identities_only: false,
        }
    );
}

#[test]
fn the_jumps_own_proxy_jump_is_ignored() {
    // 1홉만 지원한다 — 점프의 ProxyJump 를 따라가면 체인이 무한히 길어진다.
    let hosts = vec![
        HostEntry {
            name: "web".into(),
            proxy_jump: Some("bastion".into()),
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            host_name: Some("gw.example.com".into()),
            proxy_jump: Some("outer".into()),
            ..HostEntry::default()
        },
    ];
    assert_eq!(jump_of(&hosts, "web").host, "gw.example.com");
}

#[test]
fn a_jump_pointing_at_itself_is_an_error() {
    let hosts = vec![HostEntry {
        name: "web".into(),
        host_name: Some("10.0.0.1".into()),
        proxy_jump: Some("web".into()),
        ..HostEntry::default()
    }];
    match resolve_params("web", &hosts, Some("me")).unwrap_err() {
        SshOpenError::Other { message, .. } => assert!(message.contains("자기 자신"), "{message}"),
        other => panic!("Other 를 기대했는데 {other:?}"),
    }
    // 대소문자만 다른 것도 같은 별칭이다 (호스트 폼의 검사와 같은 꼴).
    let mut upper = hosts.clone();
    upper[0].proxy_jump = Some("WEB".into());
    assert!(resolve_params("web", &upper, Some("me")).is_err());
}

#[test]
fn a_jump_at_the_same_address_under_another_alias_is_allowed() {
    // 별칭 둘이 같은 서버를 가리키는 것은 OpenSSH 에서 정상적인 구성이다
    // (`bastion` 과 `SSH` 가 둘 다 `localhost:1220`). 별칭이 다르면 순환이 아니다.
    let hosts = vec![
        HostEntry {
            name: "SSH".into(),
            host_name: Some("localhost".into()),
            port: Some(1220),
            proxy_jump: Some("bastion".into()),
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            host_name: Some("localhost".into()),
            port: Some(1220),
            ..HostEntry::default()
        },
    ];
    let jump = jump_of(&hosts, "SSH");
    assert_eq!(jump.host, "localhost");
    assert_eq!(jump.port, 1220);
    assert_eq!(jump.label, "bastion");
}

#[test]
fn multi_hop_surfaces_through_resolve_params() {
    let hosts = vec![HostEntry {
        name: "web".into(),
        proxy_jump: Some("a,b".into()),
        ..HostEntry::default()
    }];
    match resolve_params("web", &hosts, Some("me")).unwrap_err() {
        SshOpenError::Other { message, .. } => assert_eq!(message, multi_jump()),
        other => panic!("Other 를 기대했는데 {other:?}"),
    }
}

#[test]
fn jump_without_a_user_anywhere_is_an_error() {
    let hosts = vec![HostEntry {
        name: "web".into(),
        user: Some("deploy".into()),
        proxy_jump: Some("bastion".into()),
        ..HostEntry::default()
    }];
    // 대상은 User 가 있어 통과하지만 점프는 이름을 알 수 없다.
    match resolve_params("web", &hosts, None).unwrap_err() {
        SshOpenError::Other { message, .. } => {
            assert!(message.contains("경유 호스트 bastion"), "{message}")
        }
        other => panic!("Other 를 기대했는데 {other:?}"),
    }
}

// ── StrictHostKeyChecking · UserKnownHostsFile 반영 ──────────────────────

#[test]
fn host_key_options_come_from_the_alias_block() {
    let hosts = vec![HostEntry {
        name: "Remote-SSH".into(),
        host_name: Some("localhost".into()),
        port: Some(1220),
        user: Some("innobe".into()),
        strict_host_key_checking: StrictHostKeyChecking::No,
        no_host_key_store: true,
        ..HostEntry::default()
    }];
    let p = resolve_params("Remote-SSH", &hosts, Some("me")).unwrap();
    assert_eq!(p.strict, StrictHostKeyChecking::No);
    assert!(p.no_host_key_store);
}

#[test]
fn hosts_without_the_options_always_verify() {
    // 앱 기본값은 항상 검증이다 — 완화는 사용자가 적은 호스트에만 생긴다.
    let p = resolve_params("web", &[entry("web")], Some("me")).unwrap();
    assert_eq!(p.strict, StrictHostKeyChecking::Yes);
    assert!(!p.no_host_key_store);
    assert!(!p.strict.skips_verification());
    assert!(!p.strict.auto_accepts_new());

    // config 에 아예 없는 별칭도 마찬가지.
    let unknown = resolve_params("box.example.com", &[], Some("me")).unwrap();
    assert_eq!(unknown.strict, StrictHostKeyChecking::Yes);
    assert!(!unknown.no_host_key_store);
}

#[test]
fn each_hop_carries_its_own_host_key_policy() {
    // 대상은 검증을 껐지만 점프는 그대로 검증해야 한다 (그 반대도 마찬가지).
    let hosts = vec![
        HostEntry {
            name: "web".into(),
            host_name: Some("10.0.0.1".into()),
            proxy_jump: Some("bastion".into()),
            strict_host_key_checking: StrictHostKeyChecking::No,
            no_host_key_store: true,
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            host_name: Some("gw.example.com".into()),
            strict_host_key_checking: StrictHostKeyChecking::AcceptNew,
            ..HostEntry::default()
        },
    ];
    let p = resolve_params("web", &hosts, Some("me")).unwrap();
    assert_eq!(p.strict, StrictHostKeyChecking::No);
    assert!(p.no_host_key_store);

    let j = p.jump.unwrap();
    assert_eq!(j.strict, StrictHostKeyChecking::AcceptNew);
    assert!(!j.no_host_key_store);
}

#[test]
fn a_relaxed_jump_does_not_relax_the_target() {
    let hosts = vec![
        HostEntry {
            name: "web".into(),
            proxy_jump: Some("bastion".into()),
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            host_name: Some("gw.example.com".into()),
            strict_host_key_checking: StrictHostKeyChecking::No,
            no_host_key_store: true,
            ..HostEntry::default()
        },
    ];
    let p = resolve_params("web", &hosts, Some("me")).unwrap();
    assert_eq!(p.strict, StrictHostKeyChecking::Yes);
    assert!(!p.no_host_key_store);
    assert_eq!(p.jump.as_ref().unwrap().strict, StrictHostKeyChecking::No);
}

// ── 가시 경고 (배칭 채널로 직접 나가는 줄) ───────────────────────────────

#[test]
fn a_verified_session_says_nothing() {
    assert!(security_notices(false, false, false).is_empty());
}

#[test]
fn verification_off_shows_a_yellow_warning() {
    let lines = security_notices(true, false, false);
    assert_eq!(lines.len(), 1);
    // 회색이 아니라 경고색(33)이어야 하고, 줄 끝은 터미널 개행이다.
    assert!(lines[0].starts_with("\u{1b}[33m"), "{:?}", lines[0]);
    assert!(lines[0].ends_with("\u{1b}[0m\r\n"), "{:?}", lines[0]);
    assert_eq!(
        lines[0],
        "\u{1b}[33m⚠ 이 세션은 호스트 키 검증이 꺼져 있습니다 (StrictHostKeyChecking no)\u{1b}[0m\r\n"
    );
}

#[test]
fn auto_accepted_key_shows_a_grey_line() {
    let lines = security_notices(false, true, false);
    assert_eq!(lines.len(), 1);
    assert_eq!(
        lines[0],
        "\u{1b}[90m호스트 키를 자동으로 신뢰했습니다 (accept-new)\u{1b}[0m\r\n"
    );
}

#[test]
fn the_warning_comes_before_the_notice() {
    // 둘 다 있으면 경고가 먼저 (설정을 여러 홉에 섞어 쓴 경우).
    let lines = security_notices(true, true, false);
    assert_eq!(lines, vec![strict_off_notice(), accept_new_notice()]);
}

#[test]
fn accepting_a_changed_key_shows_a_yellow_warning() {
    let lines = security_notices(false, false, true);
    assert_eq!(lines, vec![changed_accepted_notice()]);
    // 회색 통지가 아니라 경고색이다 — 원래 거부되는 일을 사람이 그 자리에서 한 번 뚫었다.
    assert!(lines[0].starts_with("\u{1b}[33m"), "{:?}", lines[0]);
    assert!(lines[0].ends_with("\u{1b}[0m\r\n"), "{:?}", lines[0]);
}

// ── 호스트 키 결정 (2026-09-16) ─────────────────────────────────────────

#[test]
fn only_once_and_replace_get_past_a_changed_key() {
    // `trust`(= 미상 키 수락)로는 바뀐 키가 뚫리지 않는다 — 다른 결정이다.
    assert!(!HostKeyDecision::Trust.accepts_changed());
    assert!(HostKeyDecision::Once.accepts_changed());
    assert!(HostKeyDecision::Replace.accepts_changed());
}

#[test]
fn once_passes_an_unknown_key_without_recording_it() {
    assert!(HostKeyDecision::Trust.records_unknown());
    assert!(HostKeyDecision::Replace.records_unknown());
    assert!(!HostKeyDecision::Once.records_unknown());
}

#[test]
fn host_key_decision_parses_the_frontend_spelling() {
    let parse = |s: &str| serde_json::from_str::<HostKeyDecision>(s).unwrap();
    assert_eq!(parse(r#""trust""#), HostKeyDecision::Trust);
    assert_eq!(parse(r#""once""#), HostKeyDecision::Once);
    assert_eq!(parse(r#""replace""#), HostKeyDecision::Replace);
    assert!(serde_json::from_str::<HostKeyDecision>(r#""nope""#).is_err());
}

// ── 빠른 접속 (2026-09-16) ──────────────────────────────────────────────

#[test]
fn adhoc_fills_in_the_defaults() {
    let p = resolve_adhoc(
        &AdhocTarget {
            host: "10.0.0.7".into(),
            user: None,
            port: None,
        },
        Some("you"),
    )
    .unwrap();
    assert_eq!(p.host, "10.0.0.7");
    assert_eq!(p.port, 22);
    assert_eq!(p.user, "you");
    assert_eq!(p.jump, None);
    // **완화가 붙는 길이 없다** — 빠른 접속에는 config 블록이 없으므로 언제나 검증한다.
    assert_eq!(p.strict, StrictHostKeyChecking::Yes);
    assert!(!p.no_host_key_store);
    assert_eq!(p.keepalive_interval, Some(Duration::from_secs(30)));
}

#[test]
fn adhoc_prefers_what_the_user_typed() {
    let p = resolve_adhoc(
        &AdhocTarget {
            host: "example.com".into(),
            user: Some("deploy".into()),
            port: Some(2222),
        },
        Some("you"),
    )
    .unwrap();
    assert_eq!(p.user, "deploy");
    assert_eq!(p.port, 2222);
}

#[test]
fn adhoc_without_any_user_is_an_error_not_a_guess() {
    let err = resolve_adhoc(
        &AdhocTarget {
            host: "example.com".into(),
            user: None,
            port: None,
        },
        None,
    )
    .unwrap_err();
    assert!(matches!(err, SshOpenError::Other { .. }), "{err:?}");
}

#[test]
fn adhoc_rejects_an_empty_host() {
    assert!(resolve_adhoc(
        &AdhocTarget {
            host: "   ".into(),
            user: Some("a".into()),
            port: None,
        },
        None,
    )
    .is_err());
}

#[test]
fn jump_auth_says_keys_only() {
    // 점프는 비밀번호 재시도 경로가 없으므로 PasswordRequired 가 아니라 Auth 다.
    match jump_auth_error("bastion", "ssh-agent 서비스가 꺼져 있습니다", false) {
        SshOpenError::Auth { message, .. } => {
            assert_eq!(
                message,
                "경유 호스트 bastion 는 키 인증이 필요합니다 (경유 호스트의 비밀번호 인증은 미지원) \
                     — ssh-agent 서비스가 꺼져 있습니다"
            );
        }
        other => panic!("Auth 를 기대했는데 {other:?}"),
    }
}

#[test]
fn at_jump_names_the_alias_and_keeps_the_variant() {
    // 대상 쪽과 글자가 똑같던 접속 실패에 "어느 쪽인지" 가 붙는다.
    match at_jump(
        "bastion",
        SshOpenError::other("10.0.0.9:22 접속 실패: timed out"),
    ) {
        SshOpenError::Other { message, .. } => assert_eq!(
            message,
            "경유 호스트 bastion 에서 실패: 10.0.0.9:22 접속 실패: timed out"
        ),
        other => panic!("Other 를 기대했는데 {other:?}"),
    }
    // 변종은 그대로다 — 프런트가 Auth/Other 로 화면을 가른다.
    assert!(matches!(
        at_jump("bastion", SshOpenError::auth("키가 거절됐습니다")),
        SshOpenError::Auth { .. }
    ));
}

#[test]
fn at_jump_leaves_the_host_key_dialog_contract_alone() {
    // 호스트 키 두 변종을 문자열로 접으면 TOFU 모달이 통째로 사라진다.
    let unknown = SshOpenError::HostKeyUnknown {
        fingerprint: "SHA256:abc".into(),
        key_type: "ssh-ed25519".into(),
        host: "bastion.example.com".into(),
        port: 22,
        no_store: false,
    };
    match at_jump("bastion", unknown) {
        SshOpenError::HostKeyUnknown { host, port, .. } => {
            assert_eq!(host, "bastion.example.com");
            assert_eq!(port, 22);
        }
        other => panic!("HostKeyUnknown 을 기대했는데 {other:?}"),
    }
}

#[test]
fn open_error_serializes_with_snake_case_kind_tag() {
    let unknown = serde_json::to_string(&SshOpenError::HostKeyUnknown {
        fingerprint: "SHA256:abc".into(),
        key_type: "ssh-ed25519".into(),
        host: "example.com".into(),
        port: 22,
        no_store: false,
    })
    .unwrap();
    assert_eq!(
        unknown,
        r#"{"kind":"host_key_unknown","fingerprint":"SHA256:abc","key_type":"ssh-ed25519","host":"example.com","port":22,"no_store":false}"#
    );

    let changed = serde_json::to_string(&SshOpenError::HostKeyChanged {
        fingerprint: "SHA256:abc".into(),
        key_type: "ssh-rsa".into(),
        host: "example.com".into(),
        port: 2222,
        no_store: true,
        old_fingerprint: Some("SHA256:old".into()),
    })
    .unwrap();
    assert_eq!(
        changed,
        r#"{"kind":"host_key_changed","fingerprint":"SHA256:abc","key_type":"ssh-rsa","host":"example.com","port":2222,"no_store":true,"old_fingerprint":"SHA256:old"}"#
    );

    // 문구를 싣는 세 변종에는 진단 한 벌이 **옆에** 탄다 — `kind` 는 한 글자도 안 바뀌었다.
    assert_eq!(
        serde_json::to_string(&SshOpenError::auth("nope")).unwrap(),
        r#"{"kind":"auth","message":"nope","diag":{"cause":"auth_no_method"}}"#
    );
    assert_eq!(
        serde_json::to_string(&SshOpenError::other("nope")).unwrap(),
        r#"{"kind":"other","message":"nope","diag":{"cause":"other"}}"#
    );
    assert_eq!(
        serde_json::to_string(&SshOpenError::password_required(wrong_password())).unwrap(),
        r#"{"kind":"password_required","message":"비밀번호가 올바르지 않습니다","diag":{"cause":"auth_password_rejected"},"stored_rejected":false}"#
    );
    // 경유 실패는 안쪽 사유를 잃지 않는다 (프런트가 그 힌트를 그린다).
    assert_eq!(
        serde_json::to_string(&at_jump(
            "bastion",
            SshOpenError::other_with(OpenCause::TcpRefused, "거부됨")
        ))
        .unwrap(),
        r#"{"kind":"other","message":"경유 호스트 bastion 에서 실패: 거부됨","diag":{"cause":"jump","jump":"bastion","inner":"tcp_refused"}}"#
    );
}

// ── 실패 분류 (docs/log/2026-09-17-connect-diagnostics.md) ────────────────

/// io 오류 표 — `(kind, raw, message)` 세 값만 보므로 어느 OS 에서 돌려도 답이 같다.
#[test]
fn io_errors_map_to_their_cause() {
    use std::io::ErrorKind as K;
    let cases = [
        (K::ConnectionRefused, None, "", OpenCause::TcpRefused),
        (K::TimedOut, None, "", OpenCause::TcpTimeout),
        (K::HostUnreachable, None, "", OpenCause::TcpUnreachable),
        (K::NetworkUnreachable, None, "", OpenCause::TcpUnreachable),
        (K::NetworkDown, None, "", OpenCause::TcpUnreachable),
        (K::ConnectionReset, None, "", OpenCause::BannerOrProtocol),
        (K::UnexpectedEof, None, "", OpenCause::BannerOrProtocol),
        (K::PermissionDenied, None, "", OpenCause::Other),
    ];
    for (kind, raw, message, want) in cases {
        assert_eq!(classify_io(kind, raw, message), want, "{kind:?}");
    }
}

/// 이름이 안 풀리는 것은 `ErrorKind` 로 오지 않는다 — 숫자(윈도우)나 문구(유닉스)로 본다.
#[test]
fn a_name_that_does_not_resolve_is_dns_on_both_platforms() {
    use std::io::ErrorKind as K;
    // Windows: WSAHOST_NOT_FOUND / WSANO_DATA. 종류는 `Uncategorized` 로 온다.
    assert_eq!(
        classify_io(K::Other, Some(WSA_HOST_NOT_FOUND), "No such host is known."),
        OpenCause::Dns
    );
    assert_eq!(classify_io(K::Other, Some(WSA_NO_DATA), ""), OpenCause::Dns);
    // 유닉스: std 가 붙이는 문구.
    assert_eq!(
        classify_io(
            K::Other,
            None,
            "failed to lookup address information: Name or service not known"
        ),
        OpenCause::Dns
    );
    // 다른 숫자는 DNS 가 아니다 — 10061 은 연결 거부다.
    assert_eq!(
        classify_io(K::ConnectionRefused, Some(10061), "Connection refused"),
        OpenCause::TcpRefused
    );
}

/// 러시 오류 표 — 전송 단계.
#[test]
fn russh_connect_errors_map_to_their_cause() {
    use russh::Error as E;
    assert_eq!(
        classify_connect(&E::IO(std::io::Error::from(
            std::io::ErrorKind::ConnectionRefused
        ))),
        OpenCause::TcpRefused
    );
    assert_eq!(
        classify_connect(&E::IO(std::io::Error::from(std::io::ErrorKind::TimedOut))),
        OpenCause::TcpTimeout
    );
    assert_eq!(
        classify_connect(&E::ConnectionTimeout),
        OpenCause::TcpTimeout
    );
    // SSH 로 말하지 않는 포트 — 버전 교환·KEX·배너 끊김이 한 갈래로 모인다.
    assert_eq!(classify_connect(&E::Version), OpenCause::BannerOrProtocol);
    assert_eq!(classify_connect(&E::KexInit), OpenCause::BannerOrProtocol);
    assert_eq!(classify_connect(&E::Kex), OpenCause::BannerOrProtocol);
    assert_eq!(classify_connect(&E::HUP), OpenCause::BannerOrProtocol);
    assert_eq!(classify_connect(&E::NoAuthMethod), OpenCause::AuthNoMethod);
    // 모르는 것은 넘겨짚지 않는다.
    assert_eq!(classify_connect(&E::WrongChannel), OpenCause::Other);
}

/// 인증 단계의 `HUP` 는 "SSH 서버가 아니다" 가 아니다 (MaxAuthTries 로 끊긴 것) —
/// 표를 나눠 둔 이유 그 자체다.
#[test]
fn the_auth_table_does_not_blame_the_port() {
    assert_eq!(classify_auth(&russh::Error::HUP), OpenCause::Other);
    assert_eq!(
        classify_auth(&russh::Error::NoAuthMethod),
        OpenCause::AuthNoMethod
    );
}

/// 분류된 사유는 러시의 영문 한 줄 대신 제 문구를 쓴다 (`other` 만 옛 모양 그대로).
#[test]
fn each_cause_has_its_own_sentence() {
    let e = russh::Error::ConnectionTimeout;
    assert_eq!(
        connect_message(OpenCause::Dns, "web-01.internal", 22, &e),
        "호스트 이름 web-01.internal 을(를) 찾을 수 없습니다"
    );
    assert_eq!(
        connect_message(OpenCause::TcpRefused, "10.0.0.9", 2222, &e),
        "10.0.0.9:2222 이(가) 연결을 거부했습니다"
    );
    assert_eq!(
        connect_message(OpenCause::TcpTimeout, "10.0.0.9", 22, &e),
        "10.0.0.9:22 이(가) 응답하지 않습니다 (시간 초과)"
    );
    assert_eq!(
        connect_message(OpenCause::TcpUnreachable, "10.0.0.9", 22, &e),
        "10.0.0.9:22 에 닿을 수 없습니다"
    );
    // 옛 문구는 `other` 에 그대로 남는다 — 러시 오류가 진단을 대신하는 유일한 자리.
    assert_eq!(
        connect_message(OpenCause::Other, "10.0.0.9", 22, &e),
        "10.0.0.9:22 접속 실패: Connection timeout"
    );
}

/// 경유 래퍼: 문구는 예전 그대로, 진단만 한 겹 접힌다.
#[test]
fn the_jump_wrapper_keeps_the_inner_cause() {
    let inner = SshOpenError::other_with(
        OpenCause::TcpTimeout,
        "10.0.0.9:22 이(가) 응답하지 않습니다 (시간 초과)",
    );
    match at_jump("bastion", inner) {
        SshOpenError::Other { message, diag } => {
            assert_eq!(
                message,
                "경유 호스트 bastion 에서 실패: 10.0.0.9:22 이(가) 응답하지 않습니다 (시간 초과)"
            );
            assert_eq!(diag.cause, OpenCause::Jump);
            assert_eq!(diag.jump.as_deref(), Some("bastion"));
            assert_eq!(diag.inner, Some(OpenCause::TcpTimeout));
        }
        other => panic!("Other 를 기대했는데 {other:?}"),
    }
    // 경유 인증 실패도 같은 모양이다 (문구만 `at_jump` 를 거치지 않는다).
    match jump_auth_error("bastion", "ssh-agent 서비스가 꺼져 있습니다", false) {
        SshOpenError::Auth { diag, .. } => {
            assert_eq!(diag.cause, OpenCause::Jump);
            assert_eq!(diag.inner, Some(OpenCause::AuthKeyRejected));
        }
        other => panic!("Auth 를 기대했는데 {other:?}"),
    }
    // 두 번 접혀도 안쪽 사유는 그대로다 (1홉 제한이라 실제로는 오지 않는 길).
    let twice = at_jump(
        "b",
        at_jump("b", SshOpenError::other_with(OpenCause::Dns, "x")),
    );
    match twice {
        SshOpenError::Other { diag, .. } => assert_eq!(diag.inner, Some(OpenCause::Dns)),
        other => panic!("Other 를 기대했는데 {other:?}"),
    }
}

/// 인증 실패의 갈래는 **"키를 실제로 냈는가"** 하나로 갈린다.
#[test]
fn auth_failures_carry_the_actionable_cause() {
    // 키를 내고 거부당했다 → 공개키 설치가 듣는 자리.
    for accepted in [true, false] {
        let err = auth_failure("키가 거부됨", true, false, false, accepted, false, false);
        let diag = match &err {
            SshOpenError::Auth { diag, .. } | SshOpenError::PasswordRequired { diag, .. } => diag,
            other => panic!("{other:?}"),
        };
        assert_eq!(diag.cause, OpenCause::AuthKeyRejected);
    }
    // 키를 내지도 못했다 → 서버가 받는 방식을 확인하라는 쪽.
    match auth_failure(
        "ssh-agent 서비스가 꺼져 있습니다",
        false,
        false,
        false,
        false,
        false,
        false,
    ) {
        SshOpenError::Auth { diag, .. } => assert_eq!(diag.cause, OpenCause::AuthNoMethod),
        other => panic!("Auth 를 기대했는데 {other:?}"),
    }
}

/// 호스트 키 두 변종은 **진단 축이 없다** — 다이얼로그 계약이라 필드가 늘지 않는다.
#[test]
fn the_host_key_contract_gained_no_fields() {
    let json = serde_json::to_string(&SshOpenError::HostKeyUnknown {
        fingerprint: "SHA256:abc".into(),
        key_type: "ssh-ed25519".into(),
        host: "example.com".into(),
        port: 22,
        no_store: false,
    })
    .unwrap();
    assert!(!json.contains("diag"), "{json}");
}

// ── IdentityFile 인증 (docs/log/2026-09-19-identity-file-auth.md) ───────

/// 있는 것만 가려내는 가짜 파일시스템 — 테스트가 디스크를 타지 않는다.
fn fs_of<'a>(present: &'a [&'a str]) -> impl Fn(&Path) -> bool + 'a {
    let set: Vec<PathBuf> = present.iter().map(PathBuf::from).collect();
    move |p: &Path| set.iter().any(|q| q == p)
}

#[test]
fn a_configured_identity_file_comes_first_then_the_defaults() {
    let home = PathBuf::from(r"C:\Users\wl");
    // 적힌 것이 **맨 앞**이고, 기본 이름들은 그 뒤에 폴백으로 붙는다.
    let present = fs_of(&[
        r"C:\Users\wl\.ssh\id_web01",
        r"C:\Users\wl\.ssh\id_ed25519",
        r"C:\Users\wl\.ssh\id_rsa",
    ]);
    let want = vec![
        PathBuf::from(r"C:\Users\wl\.ssh\id_web01"),
        PathBuf::from(r"C:\Users\wl\.ssh\id_ed25519"),
        PathBuf::from(r"C:\Users\wl\.ssh\id_rsa"),
    ];
    assert_eq!(
        identity_candidates(Some("~/.ssh/id_web01"), false, Some(&home), &present),
        want
    );
    // 따옴표로 감싼 config 값(`IdentityFile "~/.ssh/my key"`)도 같은 길을 지난다.
    assert_eq!(
        identity_candidates(
            Some("  \"~/.ssh/id_web01\"  "),
            false,
            Some(&home),
            &present
        ),
        want
    );
}

#[test]
fn a_configured_default_is_not_offered_twice() {
    let home = PathBuf::from(r"C:\Users\wl");
    let present = fs_of(&[r"C:\Users\wl\.ssh\id_ed25519", r"C:\Users\wl\.ssh\id_rsa"]);
    // 적힌 것이 기본 이름과 같은 파일이면 **한 번만** 낸다 (구분자가 달라도 같은 파일).
    assert_eq!(
        identity_candidates(Some("~/.ssh/id_ed25519"), false, Some(&home), &present),
        vec![
            PathBuf::from(r"C:\Users\wl\.ssh\id_ed25519"),
            PathBuf::from(r"C:\Users\wl\.ssh\id_rsa"),
        ]
    );
    // 윈도우는 대소문자도 같은 파일이다 — 두 번 내면 MaxAuthTries 를 공짜로 태운다.
    #[cfg(windows)]
    assert_eq!(
        identity_candidates(
            Some(r"C:\Users\wl\.ssh\ID_ED25519"),
            false,
            Some(&home),
            &present
        )
        .len(),
        2
    );
}

#[test]
fn defaults_are_scanned_in_openssh_order() {
    let home = PathBuf::from(r"C:\Users\wl");
    let present = fs_of(&[
        r"C:\Users\wl\.ssh\id_rsa",
        r"C:\Users\wl\.ssh\id_ed25519",
        // 후보가 아닌 것들 — 순서·목록에 끼면 안 된다.
        r"C:\Users\wl\.ssh\id_ed25519.pub",
        r"C:\Users\wl\.ssh\config",
    ]);
    // 순서는 OpenSSH 와 같다: ed25519 → ecdsa → rsa (있는 것만).
    assert_eq!(
        identity_candidates(None, false, Some(&home), &present),
        vec![
            PathBuf::from(r"C:\Users\wl\.ssh\id_ed25519"),
            PathBuf::from(r"C:\Users\wl\.ssh\id_rsa"),
        ]
    );
    // 빈 문자열은 "안 적힌 것" 과 같다 (`IdentityFile ""` 로 상위를 지우는 용법).
    assert_eq!(
        identity_candidates(Some("   "), false, Some(&home), &present).len(),
        2
    );
}

#[test]
fn a_pub_file_is_never_a_candidate() {
    let home = PathBuf::from(r"C:\Users\wl");
    let present = fs_of(&[r"C:\Users\wl\.ssh\id_ed25519.pub"]);
    // 공개키로는 서명할 수 없다 — 있어도 후보가 아니다(개인키가 하나도 없으면 빈 목록).
    assert!(
        identity_candidates(Some("~/.ssh/id_ed25519.pub"), false, Some(&home), &present).is_empty()
    );
    // 기본 이름 훑기에도 `.pub` 은 애초에 들어가지 않는다 (개인키 이름만 본다).
    assert!(identity_candidates(None, false, Some(&home), &present).is_empty());
}

#[test]
fn a_missing_identity_file_falls_back_to_the_defaults() {
    let home = PathBuf::from(r"C:\Users\wl");
    let nothing = fs_of(&[]);
    // 낡은 `IdentityFile` 하나 때문에 비밀번호 폴백까지 막히면 안 된다.
    assert!(identity_candidates(Some("~/.ssh/gone"), false, Some(&home), &nothing).is_empty());
    assert!(identity_candidates(None, false, Some(&home), &nothing).is_empty());
    // 홈을 모르면 기본 이름을 지어낼 수 없다 (적힌 절대 경로는 그대로 본다).
    assert!(identity_candidates(None, false, None, &nothing).is_empty());

    // **이 판이 고친 자리** — 적힌 파일이 지워져 있어도 있는 기본 키는 그대로 낸다.
    // (예전에는 후보가 통째로 비어 설치된 키를 두고도 "건너뜀" 이 났다.)
    let present = fs_of(&[r"C:\Users\wl\.ssh\id_ed25519"]);
    assert_eq!(
        identity_candidates(Some("~/.ssh/gone"), false, Some(&home), &present),
        vec![PathBuf::from(r"C:\Users\wl\.ssh\id_ed25519")]
    );
    // `.pub` 을 적은 호스트도 같다 — 그 줄만 빠지고 기본 이름은 산다.
    assert_eq!(
        identity_candidates(Some("~/.ssh/id_ed25519.pub"), false, Some(&home), &present).len(),
        1
    );
}

// ── IdentitiesOnly ───────────────────────────────────────────────────────

/// 켜져 있고 **적힌 줄이 있으면** 그것뿐이다 — 기본 이름 폴백이 꺼진다.
#[test]
fn identities_only_drops_the_default_names_when_a_file_is_configured() {
    let home = PathBuf::from(r"C:\Users\wl");
    let present = fs_of(&[
        r"C:\Users\wl\.ssh\id_web01",
        r"C:\Users\wl\.ssh\id_ed25519",
        r"C:\Users\wl\.ssh\id_rsa",
    ]);
    assert_eq!(
        identity_candidates(Some("~/.ssh/id_web01"), true, Some(&home), &present),
        vec![PathBuf::from(r"C:\Users\wl\.ssh\id_web01")]
    );
    // 끄면 예전 그대로 — 적힌 것 + 기본 이름 셋 중 있는 것.
    assert_eq!(
        identity_candidates(Some("~/.ssh/id_web01"), false, Some(&home), &present).len(),
        3
    );
}

/// **OpenSSH 의 미묘한 자리** — `IdentitiesOnly yes` 인데 `IdentityFile` 이 **하나도
/// 없으면** 기본 이름은 그대로 쓴다 (이 옵션이 빼는 것은 에이전트 키다).
#[test]
fn identities_only_without_a_configured_file_still_uses_the_defaults() {
    let home = PathBuf::from(r"C:\Users\wl");
    let present = fs_of(&[r"C:\Users\wl\.ssh\id_ed25519", r"C:\Users\wl\.ssh\id_rsa"]);
    let want = vec![
        PathBuf::from(r"C:\Users\wl\.ssh\id_ed25519"),
        PathBuf::from(r"C:\Users\wl\.ssh\id_rsa"),
    ];
    assert_eq!(identity_candidates(None, true, Some(&home), &present), want);
    // 빈 값은 "안 적힌 것" 과 같다 — 여기서도 기본 이름이 산다.
    assert_eq!(
        identity_candidates(Some("   "), true, Some(&home), &present),
        want
    );
}

/// 판정 기준은 "**적혀 있는가**" 이지 "그 파일이 있는가" 가 아니다 — 지워진 파일을
/// 가리켜도 켜져 있으면 후보는 빈다 (사용자가 그 키만 쓰라고 적었다).
#[test]
fn identities_only_does_not_fall_back_when_the_configured_file_is_gone() {
    let home = PathBuf::from(r"C:\Users\wl");
    let present = fs_of(&[r"C:\Users\wl\.ssh\id_ed25519"]);
    assert!(identity_candidates(Some("~/.ssh/gone"), true, Some(&home), &present).is_empty());
    // 끄면 있는 기본 키로 폴백한다 (2026-09-19 의 정정).
    assert_eq!(
        identity_candidates(Some("~/.ssh/gone"), false, Some(&home), &present).len(),
        1
    );
}

/// 에이전트 단계의 화이트리스트 — 순수 부분만 본다.
#[test]
fn the_agent_is_restricted_to_the_configured_keys_under_identities_only() {
    let a = PathBuf::from(r"C:\Users\wl\.ssh\id_web01");
    let b = PathBuf::from(r"C:\Users\wl\.ssh\id_nopub");
    let fp = |p: &Path| (p == a.as_path()).then(|| "SHA256:AAAA".to_string());

    // 꺼져 있으면 제한이 없다 = 에이전트의 모든 키를 낸다 (예전 그대로).
    assert_eq!(agent_allowlist(false, &[a.clone(), b.clone()], &fp), None);

    // 켜져 있으면 후보의 지문만 통과한다. `.pub` 이 없어 지문을 모르는 후보는 목록에
    // 들지 못한다 — 그 키는 에이전트에서 빠지고 파일에서 직접 열린다.
    assert_eq!(
        agent_allowlist(true, &[a.clone(), b.clone()], &fp),
        Some(vec!["SHA256:AAAA".to_string()])
    );
    // 후보가 하나도 없으면 빈 목록 = 에이전트 키를 **하나도 내지 않는다**.
    assert_eq!(agent_allowlist(true, &[], &fp), Some(Vec::new()));
}

/// `ForwardAgent` 는 config 에서 params 로 그대로 흐르고, 적히지 않았으면 끔이다.
/// (호스트 폼의 덮어쓰기와 합치는 일은 `agent_forward::effective` 의 몫이다.)
#[test]
fn forward_agent_flows_from_config_and_defaults_to_off() {
    let hosts = vec![
        HostEntry {
            name: "on".into(),
            forward_agent: true,
            ..HostEntry::default()
        },
        entry("off"),
    ];
    assert!(
        resolve_params("on", &hosts, Some("me"))
            .unwrap()
            .forward_agent
    );
    assert!(
        !resolve_params("off", &hosts, Some("me"))
            .unwrap()
            .forward_agent
    );
    // config 에 없는 이름도 끔.
    assert!(
        !resolve_params("box.example.com", &[], Some("me"))
            .unwrap()
            .forward_agent
    );
    // 호스트 덮어쓰기(끔)가 config 의 `yes` 를 이긴다.
    let p = resolve_params("on", &hosts, Some("me")).unwrap();
    assert!(!crate::agent_forward::effective(
        p.forward_agent,
        Some(false)
    ));
}

/// 대상과 경유는 **각자의 `IdentitiesOnly`** 를 탄다 — 호스트 키 옵션과 같은 규칙이다.
#[test]
fn identities_only_is_per_hop() {
    let hosts = vec![
        HostEntry {
            name: "web".into(),
            host_name: Some("10.0.0.1".into()),
            proxy_jump: Some("bastion".into()),
            identity_file: Some("~/.ssh/id_web".into()),
            identities_only: true,
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            host_name: Some("gw.example.com".into()),
            identity_file: Some("~/.ssh/id_gw".into()),
            ..HostEntry::default()
        },
    ];
    let p = resolve_params("web", &hosts, Some("me")).unwrap();
    assert!(p.identities_only);
    // 경유는 자기 블록에 안 적었으므로 꺼져 있다 — 대상의 값이 번지지 않는다.
    assert!(!p.jump.as_ref().unwrap().identities_only);

    // 반대 방향도 같다.
    let hosts = vec![
        HostEntry {
            name: "web".into(),
            proxy_jump: Some("bastion".into()),
            ..HostEntry::default()
        },
        HostEntry {
            name: "bastion".into(),
            identities_only: true,
            ..HostEntry::default()
        },
    ];
    let p = resolve_params("web", &hosts, Some("me")).unwrap();
    assert!(!p.identities_only);
    assert!(p.jump.as_ref().unwrap().identities_only);
}

/// 빠른 접속에는 config 블록이 없다 — 좁힐 줄도, 좁히라는 줄도 없다.
#[test]
fn quick_connect_never_turns_identities_only_on() {
    let p = resolve_adhoc(
        &AdhocTarget {
            host: "10.0.0.9".into(),
            user: None,
            port: None,
        },
        Some("me"),
    )
    .unwrap();
    assert!(!p.identities_only);
    // 에이전트 포워딩도 켜는 자리가 없다.
    assert!(!p.forward_agent);
}

/// 진단 플래그 — 사유는 그대로이고 **꼬리 한 칸**만 는다.
#[test]
fn identities_only_rides_along_as_a_diag_flag() {
    // 꺼져 있으면 계약이 예전과 **글자까지 같다** (필드가 아예 없다).
    let off = auth_failure("키가 거부됨", true, false, false, false, false, false);
    let json = serde_json::to_string(&off).unwrap();
    assert!(!json.contains("identities_only"), "{json}");

    let on = auth_failure("키가 거부됨", true, false, false, false, true, false);
    match &on {
        SshOpenError::Auth { diag, .. } => {
            // 사유는 바뀌지 않는다 — 화면의 분기표가 갈라지면 안 된다.
            assert_eq!(diag.cause, OpenCause::AuthKeyRejected);
            assert!(diag.identities_only);
        }
        other => panic!("Auth 여야 한다: {other:?}"),
    }
    assert!(serde_json::to_string(&on)
        .unwrap()
        .contains(r#""identities_only":true"#));

    // 비밀번호로 이어지는 갈래도 플래그를 싣는다.
    let pw = auth_failure("낼 키가 없습니다", false, false, false, true, true, false);
    match pw {
        SshOpenError::PasswordRequired { diag, .. } => {
            assert_eq!(diag.cause, OpenCause::AuthNoMethod);
            assert!(diag.identities_only);
        }
        other => panic!("PasswordRequired 여야 한다: {other:?}"),
    }

    // 경유 쪽 실패도 같다 — 접어도(`at_jump`) 플래그는 살아남는다.
    match jump_auth_error("bastion", "낼 키가 없습니다", true) {
        SshOpenError::Auth { diag, .. } => {
            assert_eq!(diag.cause, OpenCause::Jump);
            assert_eq!(diag.inner, Some(OpenCause::AuthKeyRejected));
            assert!(diag.identities_only);
        }
        other => panic!("Auth 여야 한다: {other:?}"),
    }
}

#[test]
fn the_agents_own_keys_are_not_offered_twice() {
    let a = PathBuf::from(r"C:\Users\wl\.ssh\id_ed25519");
    let b = PathBuf::from(r"C:\Users\wl\.ssh\id_rsa");
    let c = PathBuf::from(r"C:\Users\wl\.ssh\id_ecdsa");
    let fp = |p: &Path| match p.file_name().and_then(|n| n.to_str()) {
        Some("id_ed25519") => Some("SHA256:aaa".to_string()),
        Some("id_rsa") => Some("SHA256:bbb".to_string()),
        // 짝이 되는 `.pub` 이 없어 지문을 모르는 키.
        _ => None,
    };
    let kept = drop_keys_in_agent(
        vec![a.clone(), b.clone(), c.clone()],
        &["SHA256:aaa".to_string()],
        &fp,
    );
    // 에이전트가 이미 낸 것만 빠진다. **지문을 모르는 키는 남긴다** — 모르면 내 보는
    // 쪽이 맞다(빼면 붙을 수 있는 키를 잃는다).
    assert_eq!(kept, vec![b.clone(), c.clone()]);
    // 에이전트가 하나도 못 냈으면 후보는 그대로다.
    assert_eq!(drop_keys_in_agent(vec![a, b, c], &[], &fp).len(), 3);
}

#[test]
fn a_locked_key_is_told_apart_from_a_wrong_passphrase() {
    use russh::keys::Error as KeyError;
    // 암호구를 주지 않았는데 잠긴 키 → 묻는다.
    assert_eq!(
        classify_key_load(&KeyError::KeyIsEncrypted, false),
        KeyLoad::Locked
    );
    // 암호구를 줬는데 실패 → **틀렸다**(모달이 그 줄을 덧붙인다). 러시가 복호 실패를
    // 어떤 변종으로 싸든 이 판정은 "넣었는가" 하나만 본다.
    assert_eq!(
        classify_key_load(&KeyError::KeyIsCorrupt, true),
        KeyLoad::Wrong
    );
    assert_eq!(
        classify_key_load(&KeyError::CouldNotReadKey, true),
        KeyLoad::Wrong
    );
    // 안 넣었는데 실패 → 파일이 문제다 (다음 후보로 넘어간다).
    assert_eq!(
        classify_key_load(&KeyError::CouldNotReadKey, false),
        KeyLoad::Unreadable
    );
}

#[test]
fn the_shown_path_is_tilde_shortened_but_the_contract_path_is_not() {
    let home = PathBuf::from(r"C:\Users\wl");
    assert_eq!(
        shorten_home(Path::new(r"C:\Users\wl\.ssh\id_ed25519"), Some(&home)),
        "~/.ssh/id_ed25519"
    );
    // 홈 밖이면 그대로 — 지어내지 않는다.
    assert_eq!(
        shorten_home(Path::new(r"D:\keys\id_ed25519"), Some(&home)),
        r"D:\keys\id_ed25519"
    );
    assert_eq!(
        shorten_home(Path::new(r"C:\Users\wl\.ssh\id_ed25519"), None),
        r"C:\Users\wl\.ssh\id_ed25519"
    );
}

#[test]
fn a_passphrase_prompt_is_a_dialog_contract_not_a_sentence() {
    let json = serde_json::to_string(&SshOpenError::PassphraseRequired {
        path: r"C:\Users\wl\.ssh\id_ed25519_x".into(),
        fingerprint: Some("SHA256:abc".into()),
        wrong: true,
        stored_rejected: false,
    })
    .unwrap();
    assert_eq!(
        json,
        r#"{"kind":"passphrase_required","path":"C:\\Users\\wl\\.ssh\\id_ed25519_x","fingerprint":"SHA256:abc","wrong":true,"stored_rejected":false}"#
    );
    // 호스트 키 둘과 같은 성질이다 — 사람이 읽는 문구도, 진단 축도 없다.
    assert!(!json.contains("diag"), "{json}");
    assert!(!json.contains("message"), "{json}");
    // **암호구가 실릴 자리가 없다** (필드 셋뿐).
    assert!(!json.contains("passphrase\""), "{json}");
}

#[test]
fn the_jump_wrapper_leaves_the_passphrase_contract_alone() {
    // 경로는 홉을 가리지 않는 전역 이름이라, 경유의 잠긴 키도 같은 계약으로 푼다.
    // 문구로 접으면 모달이 통째로 사라진다 (호스트 키 두 변종과 같은 근거).
    let locked = SshOpenError::PassphraseRequired {
        path: r"C:\Users\wl\.ssh\id_bastion".into(),
        fingerprint: None,
        wrong: false,
        stored_rejected: false,
    };
    match at_jump("bastion", locked) {
        SshOpenError::PassphraseRequired { path, wrong, .. } => {
            assert_eq!(path, r"C:\Users\wl\.ssh\id_bastion");
            assert!(!wrong);
        }
        other => panic!("PassphraseRequired 를 기대했는데 {other:?}"),
    }
}

// ── 금고 (단계 ② · docs/log/2026-09-19-vault.md) ─────────────────────────

/// **거부된 것은 담아 둔 값이라는 사실이 계약에 실린다** — 값은 실리지 않는다.
#[test]
fn a_rejected_stored_password_says_so_without_carrying_the_value() {
    let json = serde_json::to_string(&SshOpenError::stored_password_rejected()).unwrap();
    assert!(json.contains(r#""kind":"password_required""#), "{json}");
    assert!(json.contains(r#""stored_rejected":true"#), "{json}");
    // 사람이 방금 친 값이 틀렸을 때와 **문구는 같다** — 다른 것은 이 칸 하나뿐이다.
    match SshOpenError::stored_password_rejected() {
        SshOpenError::PasswordRequired {
            message,
            diag,
            stored_rejected,
        } => {
            assert_eq!(message, wrong_password());
            assert_eq!(diag.cause, OpenCause::AuthPasswordRejected);
            assert!(stored_rejected);
        }
        other => panic!("PasswordRequired 를 기대했는데 {other:?}"),
    }
    // 평범한 거부에는 그 칸이 꺼져 있다 (모달이 갱신을 권하지 않는다).
    let plain = serde_json::to_string(&SshOpenError::password_required(wrong_password())).unwrap();
    assert!(plain.contains(r#""stored_rejected":false"#), "{plain}");
}

/// 금고에서 꺼내 둔 암호구는 **경로로** 찾는다 — 순수 함수.
#[test]
fn a_stored_passphrase_is_found_by_path_not_by_string() {
    let stored: Vec<StoredKey> = vec![
        (
            r"C:\Users\wl\.ssh\id_ed25519".into(),
            zeroize::Zeroizing::new("s3cret".into()),
        ),
        (
            r"C:\Users\wl\.ssh\id_rsa".into(),
            zeroize::Zeroizing::new("other".into()),
        ),
    ];
    assert_eq!(
        stored_passphrase_for(&stored, Path::new(r"C:\Users\wl\.ssh\id_rsa")),
        Some("other")
    );
    // 담아 두지 않은 키는 `None` — 그 자리에서 사람에게 묻는다.
    assert_eq!(
        stored_passphrase_for(&stored, Path::new(r"C:\Users\wl\.ssh\id_ecdsa")),
        None
    );
    // 빈 목록(금고 없음·잠김)은 예전과 글자 그대로 같다.
    assert_eq!(
        stored_passphrase_for(&[], Path::new(r"C:\Users\wl\.ssh\id_rsa")),
        None
    );
}

/// 담아 둔 암호구가 **틀렸을 때**의 갈래 — `wrong` 이 아니라 `stored_rejected` 다.
///
/// 둘을 나누는 이유는 모달의 한 줄이다: `wrong` 은 "방금 친 것이 틀렸다" 이고,
/// 사람은 아직 아무것도 치지 않았다.
#[test]
fn a_stale_stored_passphrase_is_not_a_wrong_one() {
    let locked = SshOpenError::PassphraseRequired {
        path: r"C:\Users\wl\.ssh\id_ed25519".into(),
        fingerprint: None,
        wrong: false,
        stored_rejected: true,
    };
    let json = serde_json::to_string(&locked).unwrap();
    assert!(json.contains(r#""wrong":false"#), "{json}");
    assert!(json.contains(r#""stored_rejected":true"#), "{json}");
    // 경유로 접혀도 다이얼로그 계약은 그대로다 (경로가 홉을 가리지 않는다).
    match at_jump("bastion", locked) {
        SshOpenError::PassphraseRequired {
            stored_rejected,
            wrong,
            ..
        } => {
            assert!(stored_rejected);
            assert!(!wrong);
        }
        other => panic!("PassphraseRequired 를 기대했는데 {other:?}"),
    }
}

/// 금고에서 붙은 접속은 **비밀번호와 다른 글자**로 나간다 (말풍선이 갈린다).
#[test]
fn the_vault_is_its_own_auth_method_on_the_wire() {
    assert_eq!(
        serde_json::to_string(&AuthMethod::PasswordVault).unwrap(),
        r#""password_vault""#
    );
    assert_eq!(
        serde_json::to_string(&AuthMethod::Password).unwrap(),
        r#""password""#
    );
    // 기본은 "담아 둔 값으로 연 것이 아니다" 다 — 에이전트·비밀번호 어느 쪽도 그렇다.
    assert!(!AuthUsed::of(AuthMethod::Password).identity_stored);
}

/// **헤드리스는 기본적으로 금고를 보지 않는다** — [`KeyUnlock::none`] 이 그 사실의
/// 기록이다. 2026-09-22 에 좁아진 예외(호스트별 `vault_passphrase` 위임)는 이 값이 아니라
/// [`connect_delegated`] 가 만드는 다른 `Skip` 한 벌을 쓴다
/// (docs/log/2026-09-22-delegation-vault-passphrase.md).
#[test]
fn the_headless_path_carries_no_stored_secrets() {
    match KeyUnlock::none() {
        KeyUnlock::Skip { stored } => assert!(stored.is_empty()),
        _ => panic!("Skip 를 기대했다"),
    }
}

/// 잠긴 `IdentityFile` 을 건너뛴 사실이 **진단 한 칸**으로 올라온다 (2026-09-22).
#[test]
fn a_skipped_locked_key_is_recorded_in_the_diag() {
    let err = auth_failure(
        "에이전트 키가 거부되었습니다",
        true,
        false,
        false,
        false,
        false,
        true,
    );
    match &err {
        SshOpenError::Auth { diag, .. } => assert!(diag.locked_identity),
        other => panic!("Auth 를 기대했다: {other:?}"),
    }
    // 켜지 않았으면 칸도 꺼져 있다(직렬화에서 아예 빠진다 — `is_false`).
    let off = auth_failure(
        "에이전트 키가 거부되었습니다",
        true,
        false,
        false,
        false,
        false,
        false,
    );
    match &off {
        SshOpenError::Auth { diag, .. } => assert!(!diag.locked_identity),
        other => panic!("Auth 를 기대했다: {other:?}"),
    }
}

#[test]
fn a_file_key_that_was_offered_still_points_at_public_key_install() {
    // 에이전트가 꺼져 있어도 **파일 키를 냈으면** 그것은 "서버가 이 키를 모른다" 다.
    match auth_failure(
        "ssh-agent 서비스가 꺼져 있습니다",
        false,
        true,
        false,
        false,
        false,
        false,
    ) {
        SshOpenError::Auth { diag, .. } => {
            assert_eq!(diag.cause, OpenCause::AuthKeyRejected)
        }
        other => panic!("Auth 를 기대했는데 {other:?}"),
    }
    // 키 파일이 **있는데 읽히지 않았다** → 포트도 서버도 아니고 그 파일을 보라는 자리.
    match auth_failure(
        "ssh-agent 에 등록된 키가 없습니다",
        false,
        false,
        true,
        false,
        false,
        false,
    ) {
        SshOpenError::Auth { diag, .. } => {
            assert_eq!(diag.cause, OpenCause::KeyFileUnreadable)
        }
        other => panic!("Auth 를 기대했는데 {other:?}"),
    }
}

/// **진짜 `ssh-keygen` 으로** 키를 만들어 러시의 읽기 경로가 우리 기대대로 도는지 본다.
/// (PATH 에 `ssh-keygen` 이 없으면 건너뛴다 — `keygen.rs` 의 같은 테스트와 한 규칙.)
#[test]
fn real_ed25519_keys_load_the_way_the_auth_step_expects() {
    use std::process::Command;
    const PASS: &str = "harness-passphrase";

    if Command::new("ssh-keygen").arg("-?").output().is_err() {
        eprintln!("ssh-keygen 이 PATH 에 없어 건너뜁니다");
        return;
    }
    let dir = std::env::temp_dir().join(format!(
        "aynx-idfile-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join(".ssh")).unwrap();

    let make = |name: &str, pass: &str| {
        let path = dir.join(".ssh").join(name);
        let out = Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", pass, "-C", "aynx-test", "-f"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        path
    };

    let plain = make("id_ed25519", "");
    let locked = make("id_ed25519_locked", PASS);

    // ① 암호구 없는 키는 그냥 읽힌다 — 2단계가 곧바로 서명한다.
    assert!(russh::keys::load_secret_key(&plain, None).is_ok());

    // ② 잠긴 키를 암호구 없이 열면 **`KeyIsEncrypted`** → 우리 분류는 `Locked` 다.
    let e = russh::keys::load_secret_key(&locked, None).unwrap_err();
    assert_eq!(classify_key_load(&e, false), KeyLoad::Locked);

    // ③ 맞는 암호구면 열린다.
    assert!(russh::keys::load_secret_key(&locked, Some(PASS)).is_ok());

    // ④ 틀린 암호구는 **`Wrong`** — 모달이 "틀렸습니다" 를 붙이는 근거다.
    let e = russh::keys::load_secret_key(&locked, Some("nope")).unwrap_err();
    assert_eq!(classify_key_load(&e, true), KeyLoad::Wrong);

    // ⑤ 후보 고르기는 `.pub` 을 빼고 개인키만 집는다 — 적힌 것이 앞, 기본 이름이 뒤.
    let present = |p: &Path| p.is_file();
    assert_eq!(
        identity_candidates(Some(locked.to_str().unwrap()), false, Some(&dir), &present),
        vec![locked.clone(), plain.clone()]
    );
    // 적힌 것이 `.pub` 이면 그 줄만 빠지고 기본 이름은 남는다.
    assert_eq!(
        identity_candidates(
            Some(&format!("{}.pub", locked.display())),
            false,
            Some(&dir),
            &present
        ),
        vec![plain.clone()]
    );
    // 기본 훑기는 `~/.ssh/id_ed25519` 하나를 찾는다 (`_locked` 는 기본 이름이 아니다).
    assert_eq!(
        identity_candidates(None, false, Some(&dir), &present),
        vec![plain.clone()]
    );

    // ⑥ 지문은 `.pub` 에서 나오고, 그 값으로 에이전트 중복을 거른다.
    let fp = file_key_fingerprint(&plain).expect("지문");
    assert!(fp.starts_with("SHA256:"), "{fp}");
    assert!(drop_keys_in_agent(vec![plain.clone()], &[fp], &file_key_fingerprint).is_empty());

    // ⑦ **개인키 파일에 암호구 글자가 없다** (`keygen.rs` 의 같은 단언).
    assert!(!std::fs::read_to_string(&locked).unwrap().contains(PASS));

    let _ = std::fs::remove_dir_all(&dir);
}

/// 배너 접두사만 떼고 나머지는 서버가 보낸 그대로.
#[test]
fn the_server_banner_loses_only_its_protocol_prefix() {
    assert_eq!(
        short_server_version("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5").as_deref(),
        Some("OpenSSH_9.6p1 Ubuntu-3ubuntu13.5")
    );
    // 모양이 다르면 손대지 않는다.
    assert_eq!(
        short_server_version("SSH-1.99-OpenSSH_3.9").as_deref(),
        Some("SSH-1.99-OpenSSH_3.9")
    );
    // 제어 문자(배너 끝의 CR)는 떨어뜨린다 — 말풍선에 그대로 들어가는 글자다.
    assert_eq!(
        short_server_version("SSH-2.0-OpenSSH_9.6\r\n").as_deref(),
        Some("OpenSSH_9.6")
    );
    assert_eq!(short_server_version("   "), None);
}

#[test]
fn password_unsupported_server_keeps_the_auth_error() {
    // 서버가 password 를 안 받으면 프런트에 재시도 경로를 주지 않는다.
    match auth_failure(
        "에이전트가 꺼져 있습니다",
        false,
        false,
        false,
        false,
        false,
        false,
    ) {
        SshOpenError::Auth { message, .. } => assert_eq!(message, "에이전트가 꺼져 있습니다"),
        other => panic!("Auth 를 기대했는데 {other:?}"),
    }
    match auth_failure("키가 거부됨", true, false, false, false, false, false) {
        SshOpenError::Auth { message, .. } => assert_eq!(message, "키가 거부됨"),
        other => panic!("Auth 를 기대했는데 {other:?}"),
    }
}

#[test]
fn rejected_keys_ask_for_a_password() {
    match auth_failure(
        "ssh-agent 의 키 2개가 모두 거부되었습니다",
        true,
        false,
        false,
        true,
        false,
        false,
    ) {
        SshOpenError::PasswordRequired { message, .. } => assert_eq!(message, key_rejected()),
        other => panic!("PasswordRequired 를 기대했는데 {other:?}"),
    }
}

#[test]
fn missing_agent_keeps_its_reason_in_the_message() {
    // 에이전트가 아예 없던 경우는 원인을 그대로 실어 UI 가 보여 줄 수 있게 한다.
    match auth_failure(
        "ssh-agent 서비스가 꺼져 있습니다",
        false,
        false,
        false,
        true,
        false,
        false,
    ) {
        SshOpenError::PasswordRequired { message, .. } => {
            assert_eq!(
                message,
                "ssh-agent 서비스가 꺼져 있습니다 — 비밀번호로 접속합니다"
            );
        }
        other => panic!("PasswordRequired 를 기대했는데 {other:?}"),
    }
}

#[test]
fn on_connect_appends_a_newline_when_missing() {
    assert_eq!(
        prepare_on_connect("cd /srv/app").as_deref(),
        Some("cd /srv/app\n")
    );
}

#[test]
fn on_connect_keeps_an_existing_trailing_newline() {
    // 이미 개행으로 끝나면 두 번 보내지 않는다 (빈 명령 한 줄이 더 실행된다).
    assert_eq!(prepare_on_connect("ls\n").as_deref(), Some("ls\n"));
    assert_eq!(prepare_on_connect("ls\r\n").as_deref(), Some("ls\r\n"));
}

#[test]
fn on_connect_preserves_inner_newlines() {
    // 여러 줄은 여러 명령이라는 뜻 — 안쪽 개행은 손대지 않고 끝에만 붙인다.
    assert_eq!(
        prepare_on_connect("cd /srv/app\nsource .env").as_deref(),
        Some("cd /srv/app\nsource .env\n")
    );
    assert_eq!(
        prepare_on_connect("cd /srv/app\nsource .env\n").as_deref(),
        Some("cd /srv/app\nsource .env\n")
    );
}

#[test]
fn empty_or_blank_on_connect_sends_nothing() {
    assert_eq!(prepare_on_connect(""), None);
    assert_eq!(prepare_on_connect("   "), None);
    assert_eq!(prepare_on_connect("\n"), None);
    assert_eq!(prepare_on_connect(" \t\r\n "), None);
}

#[test]
fn on_connect_is_not_escaped_or_trimmed() {
    // 셸에 그대로 흘려보내는 문자열이다 — 앱은 해석하지 않는다.
    assert_eq!(
        prepare_on_connect("  echo '따옴표 & 특수문자'  ").as_deref(),
        Some("  echo '따옴표 & 특수문자'  \n")
    );
}

// ── tmux 로 접속 (호스트별 토글) ─────────────────────────────────────────

#[test]
fn new_tmux_tiles_skip_names_left_on_the_server() {
    // (앱이 물고 있는 이름, `tmux ls -F` 출력) → 고를 이름.
    let cases: [(&[&str], &str, &str); 6] = [
        // 서버도 앱도 비었다 — 1번.
        (&[], "", "aynx-1"),
        // 앱이 모르는 분리된 어제의 aynx-1 — 거기 붙지 않고 2번(dev-01 실기의 결함).
        (&[], "aynx-1|1|0|1700000000\n", "aynx-2"),
        // 앱의 aynx-1 + 서버의 aynx-2(앱이 모름) — 3번.
        (
            &["aynx-1"],
            "aynx-1|1|1|1700000000\naynx-2|2|0|1700000001\n",
            "aynx-3",
        ),
        // 서버의 구멍(aynx-2 없음)은 되찾는다.
        (&[], "aynx-1|1|0|1\naynx-3|1|0|2\n", "aynx-2"),
        // 사람이 만든 이름 · 망가진 줄은 번호에 영향이 없다.
        (&[], "work|1|0|1\nmain: 3 windows\n", "aynx-1"),
        // 목록을 못 받았다(빈 목록) — 예전처럼 앱 장부만.
        (&["aynx-1"], "", "aynx-2"),
    ];
    for (app, ls, want) in cases {
        let app: Vec<String> = app.iter().map(|s| s.to_string()).collect();
        assert_eq!(
            pick_new_tmux_name(&app, &parse_tmux_list(ls)),
            want,
            "{app:?} / {ls:?}"
        );
    }
}

#[test]
fn tmux_names_start_at_one_and_fill_holes() {
    // 아무도 없으면 1번.
    assert_eq!(pick_tmux_name(&[]), "aynx-1");
    // 이어서 열면 다음 번호.
    assert_eq!(pick_tmux_name(&["aynx-1".into()]), "aynx-2");
    assert_eq!(pick_tmux_name(&["aynx-1".into(), "aynx-2".into()]), "aynx-3");
    // 가운데를 닫으면 그 구멍을 **되찾는다** (사람이 `tmux ls` 로 보기에 맞다).
    assert_eq!(pick_tmux_name(&["aynx-1".into(), "aynx-3".into()]), "aynx-2");
    // 순서는 상관없다 — 집합으로 본다.
    assert_eq!(pick_tmux_name(&["aynx-3".into(), "aynx-1".into()]), "aynx-2");
    // 남이 만든 이름(접두사가 다르다)은 우리 번호를 막지 않는다.
    assert_eq!(pick_tmux_name(&["work".into(), "0".into()]), "aynx-1");
}

#[test]
fn tmux_name_lock_allows_only_app_generated_shapes() {
    assert!(valid_tmux_name("aynx-1"));
    assert!(valid_tmux_name("aynx-12345"));
    // 빈 값·따옴표·공백·셸 메타문자는 전부 거부한다 — 이 잠금이 곧 `'…'` 안전의 근거다.
    assert!(!valid_tmux_name(""));
    assert!(!valid_tmux_name("aynx 1"));
    assert!(!valid_tmux_name("aynx'1"));
    assert!(!valid_tmux_name("aynx$(id)"));
    assert!(!valid_tmux_name("aynx;rm -rf /"));
    assert!(!valid_tmux_name("aynx_1")); // 밑줄도 아니다 — `[A-Za-z0-9-]` 뿐
    assert!(!valid_tmux_name(&"m".repeat(65)));
}

#[test]
fn tmux_command_is_one_posix_sh_line() {
    // 새 타일 — `-D` 없음(빼앗을 클라이언트가 없다).
    assert_eq!(
        tmux_attach_command("aynx-1", false),
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s 'aynx-1' \
             \\; set-option -t 'aynx-1' set-titles on \\; set-option -t 'aynx-1' set-titles-string '#T' || echo '[Aynx] tmux 가 없어 일반 셸로 남깁니다'"
    );
    // 재접속 — `-D` 로 낡은 클라이언트를 떼고 붙는다.
    assert_eq!(
        tmux_attach_command("aynx-2", true),
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -D -s 'aynx-2' \
             \\; set-option -t 'aynx-2' set-titles on \\; set-option -t 'aynx-2' set-titles-string '#T' || echo '[Aynx] tmux 가 없어 일반 셸로 남깁니다'"
    );
    // 실제로 큐에 들어가는 것은 그 줄 + 엔터(`\r`) 하나뿐이다.
    assert_eq!(
        tmux_bootstrap("aynx-1", false),
        format!("{}\r", tmux_attach_command("aynx-1", false))
    );
    // 줄바꿈이 **한 줄 끝에만** 있다 = 셸이 명령 하나로 읽는다.
    assert_eq!(tmux_bootstrap("aynx-1", false).matches('\r').count(), 1);
    assert!(!tmux_attach_command("aynx-1", false).contains('\n'));
}

#[test]
fn tmux_title_chain_is_session_scoped_and_quoted() {
    // 제목 전달(2026-10-07) — 앱이 연/붙은 **그 세션에만**(`-t`, `-g` 없음), 새로 만들 때·붙을 때 같은 줄.
    let st = SshStart {
        cwd: "/srv/app".into(),
        command: Some("claude".into()),
        worktree: None,
        setup: None,
        signal_env: None,
    };
    for line in [
        tmux_attach_command("it's x", false),
        tmux_attach_command("it's x", true),
        tmux_attach_command_with_start("it's x", false, &st),
    ] {
        assert!(
            line.contains(
                r"\; set-option -t 'it'\''s x' set-titles on \; set-option -t 'it'\''s x' set-titles-string '#T' ||"
            ),
            "{line}"
        );
        assert!(!line.contains(" -g"), "전역 옵션을 쓰지 않는다: {line}");
        assert!(!line.contains("tmux.conf"), "서버 파일을 건드리지 않는다: {line}");
    }
    // 체인은 세션 명령 **뒤에** 선다 — 앞이면 tmux 가 `\;` 를 새 세션의 명령 인자로 읽는다.
    let with = tmux_attach_command_with_start("aynx-1", false, &st);
    assert!(with.find("-l; fi'").unwrap() < with.find(r"\; set-option").unwrap());
}

#[test]
fn project_tmux_toggle_alone_decides_for_project_tiles() {
    // 프로젝트 켬 → 호스트 설정과 무관하게 tmux (2026-09-24 실기 ④ — 호스트 꺼짐에서도)
    assert!(use_tmux_for(None, false, true));
    assert!(use_tmux_for(Some(false), false, true));
    assert!(use_tmux_for(Some(true), false, true));
    // 프로젝트 끔 → 호스트가 tmux 여도 평범한 셸
    assert!(!use_tmux_for(Some(true), true, false));
    assert!(!use_tmux_for(None, true, false));
    // 표식 없는 평범한 호스트 타일 → 호스트 설정 그대로
    assert!(use_tmux_for(Some(true), false, false));
    assert!(!use_tmux_for(Some(false), false, false));
    assert!(!use_tmux_for(None, false, false));
    // 만들어지지 않는 조합 — 끄는 쪽이 이긴다
    assert!(!use_tmux_for(Some(true), true, true));
}

#[test]
fn project_start_line_quotes_the_folder_not_the_command() {
    let st = |cwd: &str, cmd: Option<&str>| SshStart {
        cwd: cwd.into(),
        command: cmd.map(str::to_string),
        worktree: None,
        setup: None,
        signal_env: None,
    };
    assert_eq!(
        project_start_line(&st("/root/aynx", Some("claude"))).as_deref(),
        Some("cd -- '/root/aynx' && claude\n")
    );
    // `~` 는 따옴표 밖에서 `$HOME` 으로 편다 — `'~/aynx'` 은 글자 그대로의 폴더다.
    assert_eq!(
        project_start_line(&st("~/my repo", Some("codex --model o3"))).as_deref(),
        Some("cd -- \"$HOME\"/'my repo' && codex --model o3\n")
    );
    assert_eq!(
        project_start_line(&st("~", None)).as_deref(),
        Some("cd -- \"$HOME\"\n")
    );
    // 빈 명령 = 폴더로 들어가기만.
    assert_eq!(
        project_start_line(&st("/srv/app", Some("  "))).as_deref(),
        Some("cd -- '/srv/app'\n")
    );
    // 따옴표가 든 폴더도 한 낱말.
    assert_eq!(
        project_start_line(&st("/srv/it's", None)).as_deref(),
        Some("cd -- '/srv/it'\\''s'\n")
    );
    // 쓸 수 없는 재료는 아무것도 보내지 않는다.
    assert_eq!(project_start_line(&st("  ", Some("claude"))), None);
    assert_eq!(project_start_line(&st("/a\nrm -rf /", None)), None);
    assert_eq!(
        project_start_line(&st("/a", Some("claude\nrm -rf /"))),
        None
    );
}

#[test]
fn project_start_rides_inside_the_tmux_session() {
    let st = SshStart {
        cwd: "~/aynx".into(),
        command: Some("claude".into()),
        worktree: None,
        setup: None,
        signal_env: None,
    };
    assert_eq!(
        tmux_attach_command_with_start("aynx-1", false, &st),
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s 'aynx-1' -c \"$HOME\"/'aynx' \
             'claude; if [ -f \"$HOME/.aynx/rc\" ] && [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.aynx/rc\" -i; else exec \"${SHELL:-/bin/sh}\" -l; fi' \
             \\; set-option -t 'aynx-1' set-titles on \\; set-option -t 'aynx-1' set-titles-string '#T' || { echo '[Aynx] tmux 가 없어 일반 셸로 남깁니다'; cd -- \"$HOME\"/'aynx' && claude; }"
    );
    // 명령이 없으면 폴더만 — tmux 는 기본 셸을 그 폴더에서 띄운다.
    let only_dir = SshStart {
        cwd: "/srv/app".into(),
        command: None,
        worktree: None,
        setup: None,
        signal_env: None,
    };
    assert_eq!(
        tmux_attach_command_with_start("aynx-2", true, &only_dir),
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -D -s 'aynx-2' -c '/srv/app' \
             \\; set-option -t 'aynx-2' set-titles on \\; set-option -t 'aynx-2' set-titles-string '#T' || { echo '[Aynx] tmux 가 없어 일반 셸로 남깁니다'; cd -- '/srv/app'; }"
    );
    // 명령 안의 따옴표도 한 낱말 안에 갇힌다.
    let quoted = SshStart {
        cwd: "/a".into(),
        command: Some("echo 'hi'".into()),
        worktree: None,
        setup: None,
        signal_env: None,
    };
    assert!(tmux_attach_command_with_start("aynx-3", false, &quoted)
        .contains(r#"'echo '\''hi'\''; if [ -f "$HOME/.aynx/rc" ] && [ "${SHELL##*/}" = bash ]; then exec "$SHELL" --rcfile "$HOME/.aynx/rc" -i; else exec "${SHELL:-/bin/sh}" -l; fi'"#));
    // 쓸 수 없는 재료면 평범한 부트스트랩과 같다.
    let bad = SshStart {
        cwd: "".into(),
        command: Some("claude".into()),
        worktree: None,
        setup: None,
        signal_env: None,
    };
    assert_eq!(
        tmux_attach_command_with_start("aynx-1", false, &bad),
        tmux_attach_command("aynx-1", false)
    );
    // 한 줄이다 — 개행이 없다.
    assert!(!tmux_attach_command_with_start("aynx-1", false, &st).contains('\n'));
}

#[test]
fn worktree_start_only_enters_the_folder() {
    // B안(2026-09-29): 워크트리는 첫 입력 전에 앱이 exec 로 만든다 — 첫 입력에는 git 명령이 없고, 워크트리
    // 재료가 실려 와도 폴더에서 **시작만** 한다(재료가 이상해도 첫 입력은 막히지 않는다 — 준비가 이미 걸렀다).
    let st = SshStart {
        cwd: "~/api-wt/feat-x".into(),
        command: Some("claude".into()),
        worktree: Some(SshWorktree {
            repo: "~/api".into(),
            name: "feat-x".into(),
            ticket: "t-1".into(),
        }),
        setup: None,
        signal_env: None,
    };
    assert_eq!(
        project_start_line(&st).as_deref(),
        Some("cd -- \"$HOME\"/'api-wt/feat-x' && claude\n")
    );
    let tm = tmux_attach_command_with_start("aynx-1", false, &st);
    assert_eq!(
        tm,
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s 'aynx-1' -c \"$HOME\"/'api-wt/feat-x' \
             'claude; if [ -f \"$HOME/.aynx/rc\" ] && [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.aynx/rc\" -i; else exec \"${SHELL:-/bin/sh}\" -l; fi' \
             \\; set-option -t 'aynx-1' set-titles on \\; set-option -t 'aynx-1' set-titles-string '#T' || { echo '[Aynx] tmux 가 없어 일반 셸로 남깁니다'; cd -- \"$HOME\"/'api-wt/feat-x' && claude; }"
    );
    for line in [project_start_line(&st).unwrap(), tm] {
        assert!(!line.contains("git "), "{line}");
        assert!(!line.contains("rev-parse"), "{line}");
    }
}

/// 원격 AI 타일의 첫 입력 — 신호 환경의 `export` 가 명령 앞에 선다. tmux 는 **명령 문자열 안에**
/// (이미 떠 있던 tmux 서버는 새 환경을 물려주지 않는다), 폴백 갈래에도. MCP 토큰은 어디에도 없다.
#[test]
fn signal_env_is_exported_before_the_agent_command() {
    let env = RemoteSignalEnv {
        url: "http://127.0.0.1:41234".into(),
        token: "0123abcd".into(),
        stream: "s-1".into(),
        codex_no_daemon: false,
        in_file: false,
        agent_path: false,
    };
    assert_eq!(
        signal_exports(&env),
        "export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='0123abcd' AYNX_STREAM='s-1'; "
    );
    let st = SshStart {
        cwd: "~/aynx".into(),
        command: Some("claude".into()),
        worktree: None,
        setup: None,
        signal_env: Some(env.clone()),
    };
    assert_eq!(
        project_start_line(&st).as_deref(),
        Some(
            "export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='0123abcd' AYNX_STREAM='s-1'; \
                 cd -- \"$HOME\"/'aynx' && claude\n"
        )
    );
    assert_eq!(
        tmux_attach_command_with_start("aynx-1", false, &st),
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s 'aynx-1' -c \"$HOME\"/'aynx' \
             'export AYNX_MCP_URL='\\''http://127.0.0.1:41234'\\'' AYNX_SIGNAL_TOKEN='\\''0123abcd'\\'' \
             AYNX_STREAM='\\''s-1'\\''; claude; if [ -f \"$HOME/.aynx/rc\" ] && [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.aynx/rc\" -i; else exec \"${SHELL:-/bin/sh}\" -l; fi' \
             \\; set-option -t 'aynx-1' set-titles on \\; set-option -t 'aynx-1' set-titles-string '#T' || { echo '[Aynx] tmux 가 없어 일반 셸로 남깁니다'; \
             export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='0123abcd' AYNX_STREAM='s-1'; \
             cd -- \"$HOME\"/'aynx' && claude; }"
    );
    for line in [
        project_start_line(&st).unwrap(),
        tmux_attach_command_with_start("aynx-1", false, &st),
    ] {
        assert!(
            !line.contains("AYNX_MCP_TOKEN") && !line.contains(crate::tile_env::MCP_TOKEN_ENV),
            "원격에는 MCP 토큰을 주지 않는다: {line}"
        );
    }
    // 명령이 없는 폴더 타일 — 신호 환경이 있으면(호스트 AI 권한 읽기 이상, 2026-10-08) 셸이 그 환경으로 선다.
    let only_dir = SshStart {
        command: None,
        ..st.clone()
    };
    assert_eq!(
        project_start_line(&only_dir).as_deref(),
        Some(
            "export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='0123abcd' AYNX_STREAM='s-1'; \
                 cd -- \"$HOME\"/'aynx'\n"
        )
    );
    assert_eq!(
        tmux_attach_command_with_start("aynx-1", false, &only_dir),
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s 'aynx-1' -c \"$HOME\"/'aynx' \
             'export AYNX_MCP_URL='\\''http://127.0.0.1:41234'\\'' AYNX_SIGNAL_TOKEN='\\''0123abcd'\\'' \
             AYNX_STREAM='\\''s-1'\\''; if [ -f \"$HOME/.aynx/rc\" ] && [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.aynx/rc\" -i; else exec \"${SHELL:-/bin/sh}\" -l; fi' \
             \\; set-option -t 'aynx-1' set-titles on \\; set-option -t 'aynx-1' set-titles-string '#T' || { echo '[Aynx] tmux 가 없어 일반 셸로 남깁니다'; \
             export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='0123abcd' AYNX_STREAM='s-1'; \
             cd -- \"$HOME\"/'aynx'; }"
    );
    // 신호 환경이 없으면 폴더 타일은 예전 그대로 — export 없음.
    let no_env = SshStart {
        signal_env: None,
        ..only_dir.clone()
    };
    assert_eq!(
        project_start_line(&no_env).as_deref(),
        Some("cd -- \"$HOME\"/'aynx'\n")
    );
    assert!(!tmux_attach_command_with_start("aynx-1", false, &no_env).contains("export"));
    // Debug 는 토큰을 가린다.
    assert!(!format!("{st:?}").contains("0123abcd"));
}

/// 시작 명령이 없는 원격 타일(평범한 셸 · 재접속)이 호스트 AI 권한으로 신호를 받을 때(2026-10-08) — tmux 는 새
/// 세션의 자기 명령 안에서 export 뒤 로그인 셸, 폴백 갈래에도 같은 export. tmux 아닌 호스트는 앞 공백 한 줄.
/// 환경이 없으면 예전 줄과 글자 하나 다르지 않다. MCP 토큰은 어디에도 없다.
#[test]
fn plain_tiles_export_the_signal_env_into_the_new_shell() {
    let env = RemoteSignalEnv {
        url: "http://127.0.0.1:41234".into(),
        token: "0123abcd".into(),
        stream: "s-1".into(),
        codex_no_daemon: false,
        in_file: false,
        agent_path: false,
    };
    assert_eq!(
        tmux_attach_command_with_env("aynx-2", true, None),
        tmux_attach_command("aynx-2", true)
    );
    let tm = tmux_attach_command_with_env("aynx-2", false, Some(&env));
    assert_eq!(
        tm,
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s 'aynx-2' \
             'export AYNX_MCP_URL='\\''http://127.0.0.1:41234'\\'' AYNX_SIGNAL_TOKEN='\\''0123abcd'\\'' \
             AYNX_STREAM='\\''s-1'\\''; if [ -f \"$HOME/.aynx/rc\" ] && [ \"${SHELL##*/}\" = bash ]; \
             then exec \"$SHELL\" --rcfile \"$HOME/.aynx/rc\" -i; else exec \"${SHELL:-/bin/sh}\" -l; fi' \
             \\; set-option -t 'aynx-2' set-titles on \\; set-option -t 'aynx-2' set-titles-string '#T' || { echo '[Aynx] tmux 가 없어 일반 셸로 남깁니다'; \
             export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='0123abcd' AYNX_STREAM='s-1'; }"
    );
    let line = signal_export_line(&env);
    assert_eq!(
        line,
        " export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='0123abcd' AYNX_STREAM='s-1'\n"
    );
    // 설정 `[ai] codex_no_daemon` 이 켜졌으면 서버 감싸개의 표식도 함께 선다(로컬 타일과 같은 값).
    let marked = RemoteSignalEnv {
        codex_no_daemon: true,
        ..env.clone()
    };
    assert_eq!(
        signal_export_line(&marked),
        " export AYNX_MCP_URL='http://127.0.0.1:41234' AYNX_SIGNAL_TOKEN='0123abcd' AYNX_STREAM='s-1' AYNX_CODEX_NO_DAEMON=1\n"
    );
    assert!(tmux_attach_command_with_env("aynx-2", false, Some(&marked))
        .contains(r"AYNX_STREAM='\''s-1'\'' AYNX_CODEX_NO_DAEMON=1; if [ -f"));
    assert!(!line.contains("NO_DAEMON"), "꺼져 있으면 표식 없음");
    for s in [tm, line] {
        assert!(!s.contains(crate::tile_env::MCP_TOKEN_ENV), "원격에는 MCP 토큰을 주지 않는다: {s}");
    }
}

/// 앱이 띄우는 원격 codex 의 시작 명령에 `--no-daemon` — 로컬 autorun 문과 같은 규칙(`codex_launch::codex_line`) ·
/// 같은 설정. 설정 스크립트가 감싸기 전에 걸므로 첫 낱말이 codex 인 줄만 본다.
#[test]
fn remote_codex_start_gets_no_daemon_by_the_setting() {
    let mk = |cmd: Option<&str>| {
        Some(SshStart {
            cwd: "~/p".into(),
            command: cmd.map(str::to_owned),
            worktree: None,
            setup: None,
            signal_env: None,
        })
    };
    let cmd_of = |s: &Option<SshStart>| s.as_ref().and_then(|s| s.command.clone());
    let mut s = mk(Some("codex --model o3"));
    open::codex_start_no_daemon(&mut s, true);
    assert_eq!(cmd_of(&s).as_deref(), Some("codex --no-daemon --model o3"));
    let mut s = mk(Some("codex resume abc"));
    open::codex_start_no_daemon(&mut s, true);
    assert_eq!(cmd_of(&s).as_deref(), Some("codex resume --no-daemon abc"));
    // 설정 끔 · 이미 정함 · codex 아님 · 명령 없음 — 그대로
    for (cmd, on) in [
        (Some("codex"), false),
        (Some("codex --remote=unix://x"), true),
        (Some("claude"), true),
        (None, true),
    ] {
        let mut s = mk(cmd);
        open::codex_start_no_daemon(&mut s, on);
        assert_eq!(cmd_of(&s).as_deref(), cmd, "{cmd:?} {on}");
    }
    let mut none: Option<SshStart> = None;
    open::codex_start_no_daemon(&mut none, true);
    assert!(none.is_none());
}

/// **원격 신호를 세우는 조건** (2026-10-27 사용자 결정) — 앱이 AI 를 띄운 타일 **또는** 호스트의 에이전트 활성화. 호스트 AI
/// 권한은 판정의 입력이 아니다(표의 `perm` 칸은 어느 값이어도 결과가 같음을 적어 둔 것 — 함수가 받지도 않는다). 빠른 접속은
/// 토글이 늘 끔이라 앱이 띄운 AI 만 받는다. 재접속(시작 명령 없음) · tmux · 비-tmux 는 같은 판정이다(시작 명령 · 토글만 본다).
#[test]
fn remote_signal_follows_agent_toggle_not_ai_permission() {
    // (시작 명령, 토글(sessions.toml `agent` — None = 적지 않음), 빠른 접속, 기대)
    let rows: &[(Option<&str>, Option<bool>, bool, bool)] = &[
        // 앱이 AI 를 띄움 — 토글 · 권한과 무관하게 받는다(빠른 접속도)
        (Some("claude"), Some(false), false, true),
        (Some("claude --resume abc"), None, false, true),
        (Some("codex resume x"), Some(true), false, true),
        (Some("npx @anthropic-ai/claude-code"), None, false, true),
        (Some("claude"), None, true, true),
        // 토글 켬 — 평범한 셸 · 재접속 · AI 아닌 시작 명령도 받는다
        (None, Some(true), false, true),
        (Some("htop"), Some(true), false, true),
        // 토글 끔 · 적지 않음 — AI 를 띄우지 않으면 받지 않는다(권한이 Read 이상이어도)
        (None, Some(false), false, false),
        (None, None, false, false),
        (Some("htop"), Some(false), false, false),
        // 빠른 접속 — 토글을 적어 둬도 끔(호스트 설정이 없는 대상)
        (None, Some(true), true, false),
        (Some("htop"), Some(true), true, false),
    ];
    for &(cmd, toggle, adhoc, want) in rows {
        let ai = cmd.is_some_and(open::launches_ai);
        let on = open::agent_enabled(adhoc, toggle);
        for perm in ["off", "read", "ask", "auto", "yolo"] {
            assert_eq!(
                open::signal_stream(ai, on, "h-1"),
                want.then_some("h-1"),
                "cmd={cmd:?} toggle={toggle:?} adhoc={adhoc} perm={perm}"
            );
        }
    }
    // 토글 자체(빠른 접속 · 적지 않음)
    assert!(open::agent_enabled(false, Some(true)));
    assert!(!open::agent_enabled(false, None));
    assert!(!open::agent_enabled(true, Some(true)));
    // AI 줄 판정 — 프런트 `aiIconName` 과 같은 폭(대소문자 무시 · 품은 줄)
    for yes in ["claude", "CLAUDE --model x", "  codex", "/usr/local/bin/claude"] {
        assert!(open::launches_ai(yes), "{yes}");
    }
    for no in ["", "   ", "htop", "vim claud.txt", "bash"] {
        assert!(!open::launches_ai(no), "{no}");
    }
}

/// 판정 자리는 하나 — 열기의 신호 단계는 [`open::signal_stream`] 만 거치고, 그 판정 · 신호 단계는 호스트 AI 권한
/// (`delegation` · `ai_level` · `read_granted`)을 보지 않는다. 열기 인자에 프런트가 정한 신호 칸(`agent_stream`)도 없다.
#[test]
fn remote_signal_decision_has_one_seat() {
    let src = include_str!("open.rs");
    let code: String = src
        .lines()
        .map(str::trim_start)
        .filter(|l| !l.starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(
        code.matches("signal_stream(ai_launch, host_agent.agent, &stream)").count(),
        1,
        "열기가 신호 판정을 한 번 부른다"
    );
    assert!(!code.contains("pub agent_stream"), "프런트가 정하는 신호 칸이 돌아왔다");
    for (head, end) in [
        ("pub(crate) fn signal_stream(", "\n}"),
        ("async fn arm_agent_signal(", "\n}"),
        ("fn host_agent(", "\n}"),
    ] {
        let at = code.find(head).unwrap_or_else(|| panic!("{head} 가 없다"));
        let body = &code[at..at + code[at..].find(end).expect("몸 끝")];
        for banned in ["delegation", "ai_level", "read_granted", "ai_readable"] {
            assert!(!body.contains(banned), "{head} 가 `{banned}` 를 본다");
        }
    }
}

#[test]
fn tmux_cwd_command_asks_the_active_pane() {
    assert_eq!(
        tmux_cwd_command("aynx-3"),
        "tmux display -p -t 'aynx-3' '#{pane_current_path}'"
    );
}

// ── 세션 목록·전환 (서버에 있는 남의 세션까지) ───────────────────────────

#[test]
fn sh_quote_wraps_everything_in_one_word() {
    assert_eq!(sh_quote("aynx-1"), "'aynx-1'");
    assert_eq!(sh_quote("my work"), "'my work'");
    // 따옴표 하나가 `'\''` 로 — 닫고, 이스케이프된 따옴표, 다시 열기.
    assert_eq!(sh_quote("it's"), r"'it'\''s'");
    assert_eq!(sh_quote("a'b'c"), r"'a'\''b'\''c'");
    // 작은따옴표 안에서는 나머지가 전부 글자다 — 치환이 필요한 것은 `'` 하나뿐이다.
    assert_eq!(sh_quote("$(id)"), "'$(id)'");
    assert_eq!(sh_quote("a;rm -rf /"), "'a;rm -rf /'");
    assert_eq!(sh_quote(r"back\slash"), r"'back\slash'");
    assert_eq!(sh_quote(""), "''");
}

#[test]
fn safe_tmux_target_locks_control_characters_not_shapes() {
    // 앱이 만든 이름도, 서버에 있던 남의 이름도 통과한다(다듬은 값이 나온다).
    assert_eq!(safe_tmux_target("aynx-1"), Some("aynx-1"));
    assert_eq!(safe_tmux_target(" work "), Some("work"));
    assert_eq!(safe_tmux_target("내 작업"), Some("내 작업"));
    assert_eq!(safe_tmux_target("it's"), Some("it's"));
    assert_eq!(safe_tmux_target("$(id)"), Some("$(id)")); // sh_quote 가 감싼다
                                                          // 비어 있거나 제어문자가 있으면 거부 — 개행은 `'…'` 안에서도 새 명령줄이 된다.
    assert_eq!(safe_tmux_target(""), None);
    assert_eq!(safe_tmux_target("   "), None);
    assert_eq!(safe_tmux_target("a\nrm -rf /"), None);
    assert_eq!(safe_tmux_target("a\rb"), None);
    assert_eq!(safe_tmux_target("a\x1b[2J"), None);
    assert_eq!(safe_tmux_target(&"m".repeat(129)), None);
}

#[test]
fn quoted_names_survive_the_attach_line() {
    // 목록에서 고른 남의 세션(공백·따옴표)도 **한 낱말**로 들어간다.
    assert!(tmux_attach_command("my work", false).contains("-s 'my work'"));
    assert!(tmux_attach_command("it's", true).contains(r"-s 'it'\''s'"));
    assert!(tmux_cwd_command("my work").starts_with("tmux display -p -t 'my work' "));
}

#[test]
fn detach_flag_never_kicks_a_tile_this_app_is_showing() {
    // 이 앱이 안 물고 있는 이름 = 떼어 낼 것이 있다면 낡은 클라이언트뿐이다 → `-D`.
    assert!(kick_stale_for_hint("aynx-1", &[]));
    assert!(kick_stale_for_hint("aynx-1", &["aynx-2".into()]));
    // 살아 있는 다른 타일이 물고 있으면 붙이지 않는다 — 함께 본다(거울).
    assert!(!kick_stale_for_hint("aynx-1", &["aynx-1".into()]));
    assert!(!kick_stale_for_hint(
        "work",
        &["aynx-1".into(), "work".into()]
    ));
}

#[test]
fn tmux_list_command_asks_for_four_fields() {
    assert_eq!(
        tmux_list_command(),
        "tmux ls -F '#{session_name}|#{session_windows}|#{session_attached}|#{session_created}'"
    );
}

#[test]
fn tmux_list_parses_four_fields_per_line() {
    let out = "aynx-1|3|1|1757980800\naynx-2|1|0|1757984400\n";
    assert_eq!(
        parse_tmux_list(out),
        vec![
            TmuxSessionInfo {
                name: "aynx-1".into(),
                windows: 3,
                attached: 1,
                created: 1_757_980_800,
            },
            TmuxSessionInfo {
                name: "aynx-2".into(),
                windows: 1,
                attached: 0,
                created: 1_757_984_400,
            },
        ]
    );
}

#[test]
fn tmux_list_keeps_odd_names_whole() {
    // 공백·콜론·점·막대가 든 이름 — tmux 는 `:`·`.` 를 막지만 우리는 관대하게 읽는다
    // (뒤에서부터 세 번 자르므로 이름 안의 `|` 도 살아남는다).
    let out = "my work|2|0|10\na:b.c|1|1|20\npipe|name|4|2|30\n";
    let got = parse_tmux_list(out);
    assert_eq!(
        got.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        vec!["my work", "a:b.c", "pipe|name"]
    );
    assert_eq!(got[2].windows, 4);
    assert_eq!(got[2].attached, 2);
}

#[test]
fn tmux_list_skips_malformed_lines_instead_of_failing() {
    let out = "\
no server running on /tmp/tmux-1000/default
aynx-1|3|1|1757980800

garbage
short|1|2
bad|x|1|10
name|1|1|not-a-number
aynx-2|1|0|1757984400
\x1b[31mred\x1b[0m|1|1|40
";
    let got = parse_tmux_list(out);
    // 살아남은 것은 온전한 두 줄뿐이다 (제어문자가 든 이름도 떨군다).
    assert_eq!(
        got.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        vec!["aynx-1", "aynx-2"]
    );
    // 빈 출력·공백뿐인 출력은 빈 목록이다 (오류가 아니다).
    assert!(parse_tmux_list("").is_empty());
    assert!(parse_tmux_list("   \n\n").is_empty());
}

#[test]
fn tmux_list_tolerates_crlf() {
    assert_eq!(parse_tmux_list("aynx-1|1|0|5\r\n").len(), 1);
}

// ── 세션 끄기 (목록 팝오버의 끄기 단추 — 사람 전용) ───────────────────────

#[test]
fn tmux_kill_command_targets_exact_name_bytes() {
    // `=` 접두 = tmux 대상의 정확 일치(접두 일치 · fnmatch 로 엉뚱한 세션에 닿지 않게) · `=` 까지 한 낱말로 인용.
    assert_eq!(tmux_kill_command("aynx-3"), "tmux kill-session -t '=aynx-3'");
    assert_eq!(tmux_kill_command("my work"), "tmux kill-session -t '=my work'");
    assert_eq!(tmux_kill_command("내 작업"), "tmux kill-session -t '=내 작업'");
    assert_eq!(
        tmux_kill_command("a(b)[c]{d}#!^&,~%@+_"),
        "tmux kill-session -t '=a(b)[c]{d}#!^&,~%@+_'"
    );
}

#[test]
fn killable_tmux_name_accepts_list_shapes() {
    for ok in ["aynx-1", "work", "my work", "내 작업", "a_b+c@d%e", "x-", "1", &"m".repeat(128)] {
        assert_eq!(killable_tmux_name(ok), Some(ok), "{ok}");
    }
}

#[test]
fn killable_tmux_name_rejects_risky_shapes() {
    for bad in [
        "",
        " ",
        " work",   // 다듬지 않는다 — 앞뒤 공백은 거절(글자 그대로 같아야 한다)
        "work ",
        "-t",      // 옵션 모양
        "-",
        "a\nrm -rf /",
        "a\rb",
        "a\tb",
        "a\x1b[2J",
        "a\u{7f}b",
        "it's",    // 따옴표
        "a\"b",
        "a`id`",
        "$(id)",
        "a\\b",
        "a;b",
        "a|b",
        "a<b",
        "a>b",
        "wo*",     // tmux 대상의 fnmatch
        "w?rk",
        "a:b",     // 창 · 패널 구분자
        "a.b",
        "a/b",
        "=work",
    ] {
        assert_eq!(killable_tmux_name(bad), None, "{bad:?}");
    }
    assert_eq!(killable_tmux_name(&"m".repeat(129)), None);
}

/// 끄는 명령을 조립하는 함수는 Tauri 명령 `ssh_tmux_kill` 하나만 부른다 — MCP · 오케스트레이션 · 작업안에는 이 길이 없다
/// (사람 단추 전용). `kill-session` 이라는 글자도 조립 함수 밖의 제품 코드에 없다.
#[test]
fn tmux_kill_only_from_human_command() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    walk(&root, &mut files);
    let mut callers = Vec::new();
    let mut spelled = Vec::new();
    for f in files {
        let rel = f.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        if rel.ends_with("tests.rs") || rel.contains("/tests/") {
            continue;
        }
        let text = std::fs::read_to_string(&f).unwrap();
        // 주석 줄은 뺀다(문서 · 분류 표의 설명은 길이 아니다).
        let body: String = text
            .split("#[cfg(test)]")
            .next()
            .unwrap_or("")
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("
");
        if body.contains("tmux_kill_command(") && rel != "ssh/remote_cmd.rs" {
            callers.push(rel.clone());
        }
        if body.contains("kill-session") && rel != "ssh/remote_cmd.rs" && rel != "ssh/commands.rs" {
            spelled.push(rel);
        }
    }
    assert_eq!(callers, vec!["ssh/commands.rs".to_string()], "tmux_kill_command 를 부르는 곳");
    assert!(spelled.is_empty(), "kill-session 을 적는 다른 제품 코드: {spelled:?}");
    let mcp = std::fs::read_to_string(root.join("mcp.rs")).unwrap();
    assert!(!mcp.contains("ssh_tmux_kill"));
}

// ── 종료 사유 판정 (자동 재연결의 분기점) ────────────────────────────────

#[test]
fn clean_shell_exit_is_a_normal_exit_without_a_message() {
    assert_eq!(
        classify_exit(3, Some(ShellExit::Status(0)), None),
        ExitEvent {
            id: 3,
            reason: "exit",
            message: None,
        }
    );
}

#[test]
fn nonzero_exit_code_is_still_a_normal_exit() {
    // Ctrl+C 로 죽은 명령 뒤의 `exit` 도 사용자가 끝낸 것이다 — 재연결 금지.
    let ev = classify_exit(3, Some(ShellExit::Status(130)), None);
    assert_eq!(ev.reason, "exit");
    assert_eq!(ev.message.as_deref(), Some("종료 코드 130"));
}

#[test]
fn killed_shell_is_a_normal_exit_too() {
    let ev = classify_exit(3, Some(ShellExit::Signal("TERM".into())), None);
    assert_eq!(ev.reason, "exit");
    assert_eq!(ev.message.as_deref(), Some("신호 TERM 로 종료"));
}

#[test]
fn orderly_channel_close_is_a_normal_exit_without_status() {
    // 일부 sshd(사내망 1220)는 exit-status 를 안 보낸다 — Eof/Close 만으로 정상 종료.
    assert_eq!(
        classify_exit(3, Some(ShellExit::Closed), None),
        ExitEvent {
            id: 3,
            reason: REASON_EXIT,
            message: None,
        }
    );
}

#[test]
fn late_exit_status_upgrades_a_closed_note() {
    // Eof(약한 증거) 뒤에 오는 exit-status(강한 증거)가 코드를 살린다.
    let merged = merge_shell_evidence(Some(ShellExit::Closed), ShellExit::Status(130));
    assert_eq!(merged, Some(ShellExit::Status(130)));
}

#[test]
fn closed_note_does_not_downgrade_a_status() {
    // status → Eof/Close 순서 (일반적 sshd) 에서 코드가 유지된다.
    let merged = merge_shell_evidence(Some(ShellExit::Status(0)), ShellExit::Closed);
    assert_eq!(merged, Some(ShellExit::Status(0)));
}

#[test]
fn first_strong_evidence_wins_between_strong_ones() {
    let merged = merge_shell_evidence(Some(ShellExit::Status(1)), ShellExit::Signal("TERM".into()));
    assert_eq!(merged, Some(ShellExit::Status(1)));
}

#[test]
fn missing_shell_evidence_is_an_error() {
    let ev = classify_exit(7, None, Some("서버 무응답 (keepalive 3회 초과)".into()));
    assert_eq!(ev.id, 7);
    assert_eq!(ev.reason, "error");
    assert_eq!(
        ev.message.as_deref(),
        Some("서버 무응답 (keepalive 3회 초과)")
    );
}

#[test]
fn error_without_a_reason_still_gets_a_message() {
    // 펌프가 먼저 끝난 경우 — 전송 계층 사유를 모르지만 배너에 쓸 문구는 있어야 한다.
    let ev = classify_exit(7, None, None);
    assert_eq!(ev.reason, "error");
    assert_eq!(ev.message.as_deref(), Some(disconnected_message().as_str()));
}

#[test]
fn shell_evidence_beats_a_transport_failure() {
    // `exit` 직후 서버가 연결을 끊으면 둘 다 온다. 오류로 판정하면 사용자가 닫은
    // 셸을 프런트가 다시 열어 버리므로, 증거가 반드시 이겨야 한다.
    let ev = classify_exit(
        1,
        Some(ShellExit::Status(0)),
        Some("서버가 연결을 끊었습니다".into()),
    );
    assert_eq!(ev.reason, "exit");
    assert_eq!(ev.message, None);
}

#[test]
fn exit_event_serializes_as_the_front_end_contract() {
    assert_eq!(
        serde_json::to_string(&classify_exit(3, Some(ShellExit::Status(0)), None)).unwrap(),
        r#"{"id":3,"reason":"exit","message":null}"#
    );
    assert_eq!(
        serde_json::to_string(&classify_exit(3, None, Some("끊김".into()))).unwrap(),
        r#"{"id":3,"reason":"error","message":"끊김"}"#
    );
}

#[test]
fn keepalive_timeout_becomes_a_korean_sentence() {
    assert_eq!(
        describe_disconnect(Some(&russh::Error::KeepaliveTimeout), 3),
        "서버 무응답 (keepalive 3회 초과)"
    );
    // 문구에 실리는 횟수는 그 호스트의 ServerAliveCountMax 다.
    assert_eq!(
        describe_disconnect(Some(&russh::Error::KeepaliveTimeout), 5),
        "서버 무응답 (keepalive 5회 초과)"
    );
}

#[test]
fn other_disconnect_reasons_have_their_own_wording() {
    assert_eq!(describe_disconnect(None, 3), "서버가 연결을 끊었습니다");
    assert_eq!(
        describe_disconnect(Some(&russh::Error::HUP), 3),
        disconnected_message()
    );
    // 나머지는 러시 오류를 뒤에 붙여 원인을 남긴다.
    assert_eq!(
        describe_disconnect(Some(&russh::Error::Inconsistent), 3),
        format!(
            "{}: Inconsistent state of the protocol",
            disconnected_message()
        )
    );
}

#[test]
fn password_method_is_detected_in_the_remaining_set() {
    // 서버가 알려 주는 남은 방식 목록을 그대로 읽는다 (russh MethodSet).
    let with_password = MethodSet::from(&[MethodKind::PublicKey, MethodKind::Password][..]);
    assert!(with_password.contains(&MethodKind::Password));

    let keys_only = MethodSet::from(&[MethodKind::PublicKey][..]);
    assert!(!keys_only.contains(&MethodKind::Password));
    assert!(!MethodSet::empty().contains(&MethodKind::Password));
}

#[test]
fn remote_home_takes_only_an_absolute_path() {
    assert_eq!(parse_remote_home("/root").as_deref(), Some("/root"));
    assert_eq!(
        parse_remote_home("/home/me/\n").as_deref(),
        Some("/home/me")
    );
    assert_eq!(parse_remote_home("/").as_deref(), Some("/"));
    // `$HOME` 이 비었거나 상대 경로·잡음이 섞였으면 모르는 채로 둔다(틀린 홈으로 펴지 않는다).
    assert_eq!(parse_remote_home(""), None);
    assert_eq!(parse_remote_home("home/me"), None);
    assert_eq!(parse_remote_home("/home/me\nwelcome"), None);
}

// ---------------------------------------------------------------------------
// 펌프의 끝 — 이 앱이 닫은 채널 (docs/log/2026-09-30-shared-session-log-flush.md)
// ---------------------------------------------------------------------------
// 러시는 우리가 먼저 닫은 채널의 서버 답(Close)을 읽기 쪽에 넘기지 않는다 — 읽기 쪽 대역은
// "송신자가 살아 있고 아무것도 안 오는" mpsc 로 그대로 흉내 낸다(공유 전송로의 그 모양).

#[tokio::test]
async fn pump_ends_when_app_closed_channel_though_reader_never_ends() {
    let (_tx_alive, mut rx) = tokio::sync::mpsc::channel::<u8>(4);
    let closed = tokio::sync::Notify::new();
    // 기다리는 이가 없을 때 울려도 허가가 남아 놓치지 않는다(닫기가 펌프보다 먼저 와도 된다).
    closed.notify_one();
    let got = tokio::time::timeout(
        Duration::from_secs(2),
        open::until_closed(rx.recv(), &closed),
    )
    .await
    .expect("닫았는데 펌프가 안 끝났다");
    assert_eq!(got, None);
}

#[tokio::test]
async fn pump_drains_queued_output_before_honouring_close() {
    // 닫기 직전에 도착한 출력은 로그에 남아야 한다 — 쌓인 것을 다 읽은 뒤에야 끝난다.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<u8>(4);
    tx.send(1).await.unwrap();
    tx.send(2).await.unwrap();
    let closed = tokio::sync::Notify::new();
    closed.notify_one();
    assert_eq!(open::until_closed(rx.recv(), &closed).await, Some(1));
    assert_eq!(open::until_closed(rx.recv(), &closed).await, Some(2));
    assert_eq!(open::until_closed(rx.recv(), &closed).await, None);
}

#[tokio::test]
async fn pump_follows_remote_close_when_app_did_not_close() {
    // 원격이 먼저 닫는 길은 그대로 — 종이 울리지 않으면 읽기 쪽의 끝(None)을 따른다.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<u8>(4);
    tx.send(7).await.unwrap();
    drop(tx);
    let closed = tokio::sync::Notify::new();
    assert_eq!(open::until_closed(rx.recv(), &closed).await, Some(7));
    assert_eq!(open::until_closed(rx.recv(), &closed).await, None);
}

// ---- 서버 쪽 준비의 종류 — tmux 호스트도 파일은 심는다 (2026-10-08) ----

#[test]
fn remote_prep_tmux_host_plants_files_only_when_integration_on() {
    use open::{remote_prep, RemotePrep};
    // tmux + 통합 켬 → 스니펫·rc 만 심는다(첫 입력은 tmux 한 줄, 계획은 옵트아웃).
    assert_eq!(remote_prep(true, true), RemotePrep::FilesOnly);
    // tmux + 통합 끔 → 아무것도 없다(새 tmux 세션의 셸은 `[ -f rc ]` 에서 `-l` 로 떨어진다).
    assert_eq!(remote_prep(false, true), RemotePrep::Nothing);
    // 비-tmux → 예전 그대로.
    assert_eq!(remote_prep(true, false), RemotePrep::Full);
    assert_eq!(remote_prep(false, false), RemotePrep::Nothing);
    // tmux 호스트의 계획은 통합 줄이 없는 옵트아웃이다(`shell_integration = !use_tmux && 옵션`).
    assert_eq!(
        crate::shell_integration::bootstrap_plan(
            false,
            crate::shell_integration::RemoteSetup::Failed,
            None
        ),
        crate::shell_integration::BootstrapPlan::ShellOptOut
    );
}

/// 신호 파일 방식(2026-10-08 ①b) — 주소·토큰을 서버 파일에 썼으면 셸 자리 셋(tmux 명령 문자열 · `on_connect` 앞 줄 ·
/// 프로젝트 줄) 어디에도 토큰·주소가 없고 스트림 id(와 codex 표식)만 선다.
#[test]
fn signal_file_mode_exports_only_the_stream() {
    let env = RemoteSignalEnv {
        url: "http://127.0.0.1:41234".into(),
        token: "0123abcd".into(),
        stream: "s-1".into(),
        codex_no_daemon: true,
        in_file: true,
        agent_path: false,
    };
    assert_eq!(
        signal_exports(&env),
        "export AYNX_STREAM='s-1' AYNX_CODEX_NO_DAEMON=1; "
    );
    assert_eq!(
        signal_export_line(&env),
        " export AYNX_STREAM='s-1' AYNX_CODEX_NO_DAEMON=1\n"
    );
    let st = SshStart {
        cwd: "~/aynx".into(),
        command: Some("claude".into()),
        worktree: None,
        setup: None,
        signal_env: Some(env.clone()),
    };
    let lines = [
        signal_export_line(&env),
        tmux_attach_command_with_env("aynx-2", false, Some(&env)),
        project_start_line(&st).unwrap(),
        tmux_attach_command_with_start("aynx-1", false, &st),
    ];
    for line in &lines {
        assert!(line.contains("AYNX_STREAM="), "{line}");
        for secret in ["0123abcd", "41234", "AYNX_MCP_URL", "AYNX_SIGNAL_TOKEN", "MCP_TOKEN"] {
            assert!(!line.contains(secret), "{secret} 이 셸 자리에 남았다: {line}");
        }
    }
    assert!(lines[2].starts_with("export AYNX_STREAM='s-1' AYNX_CODEX_NO_DAEMON=1; cd -- "));
}

/// 에이전트 활성화(2026-10-26) — 스트림 뒤에 PATH 심 폴더가 선다. 신호를 세우지 않은 타일(주소·토큰 빈 값)도 같은 모양이고,
/// tmux 는 명령 문자열 안에(바깥 셸이 `$HOME` · `$PATH` 를 편다), 폴백 갈래에도.
#[test]
fn agent_enable_exports_the_shim_path_after_the_stream() {
    let env = RemoteSignalEnv {
        url: String::new(),
        token: String::new(),
        stream: "s-1".into(),
        codex_no_daemon: true,
        in_file: true,
        agent_path: true,
    };
    assert_eq!(
        signal_exports(&env),
        "export AYNX_STREAM='s-1' PATH=\"$HOME/.config/aynx/bin:$PATH\" AYNX_CODEX_NO_DAEMON=1; "
    );
    assert_eq!(
        signal_export_line(&env),
        " export AYNX_STREAM='s-1' PATH=\"$HOME/.config/aynx/bin:$PATH\" AYNX_CODEX_NO_DAEMON=1\n"
    );
    let tm = tmux_attach_command_with_env("aynx-2", false, Some(&env));
    assert!(
        tm.contains(r#"'export AYNX_STREAM='\''s-1'\'' PATH="$HOME/.config/aynx/bin:$PATH" AYNX_CODEX_NO_DAEMON=1; if [ -f"#),
        "{tm}"
    );
    assert!(tm.ends_with(r#"export AYNX_STREAM='s-1' PATH="$HOME/.config/aynx/bin:$PATH" AYNX_CODEX_NO_DAEMON=1; }"#), "{tm}");
    // 셸 통합 rc 가 없으면 bash 는 에이전트 rc 로(사용자 프로필 뒤에 심 폴더를 다시 앞에) — 세션 명령 · 시작 명령 둘 다.
    let agent_rc = r#"--rcfile "$HOME/.config/aynx/agent-rc" -i"#;
    assert!(tm.contains(agent_rc), "{tm}");
    let st = SshStart {
        cwd: "~/aynx".into(),
        command: Some("claude".into()),
        worktree: None,
        setup: None,
        signal_env: Some(env.clone()),
    };
    assert!(tmux_attach_command_with_start("aynx-1", false, &st).contains(agent_rc));
    let plain = RemoteSignalEnv { agent_path: false, ..env.clone() };
    assert!(!tmux_attach_command_with_env("aynx-2", false, Some(&plain)).contains("agent-rc"));
    // 폴백(파일을 못 쓴 신호)에도 PATH 는 스트림 바로 뒤.
    let fallback = RemoteSignalEnv {
        url: "http://127.0.0.1:41234".into(),
        token: "0123abcd".into(),
        in_file: false,
        codex_no_daemon: false,
        ..env
    };
    assert!(signal_exports(&fallback).ends_with("AYNX_STREAM='s-1' PATH=\"$HOME/.config/aynx/bin:$PATH\"; "));
}

// ---------------------------------------------------------------------------
// 신호 export 줄을 화면에 남기지 않기 (2026-10-27)
// ---------------------------------------------------------------------------

fn agent_env(in_file: bool) -> RemoteSignalEnv {
    RemoteSignalEnv {
        url: if in_file { String::new() } else { "http://127.0.0.1:41234".into() },
        token: if in_file { String::new() } else { "0123abcd".into() },
        stream: "s-1234abcd".into(),
        codex_no_daemon: true,
        in_file,
        agent_path: true,
    }
}

/// 셸 통합 exec 런처로 뜨는 bash(계획 `Exec`) — 비밀 없는 신호 환경은 런처 **앞에** 실려 타이핑하는 줄이 없다. 런처 안쪽은
/// 예전 글자 그대로(작은따옴표 둘)이고, 비밀이 든 폴백 · 다른 계획은 예전처럼 타이핑한다.
#[test]
fn signal_env_rides_the_exec_launcher_without_typing() {
    use crate::shell_integration::{exec_launcher, BootstrapPlan};
    let env = agent_env(true);
    assert!(signal_rides_launcher(BootstrapPlan::Exec, &env));
    assert_eq!(
        exec_launcher_with_signal(&env),
        format!(
            "export AYNX_STREAM='s-1234abcd' PATH=\"$HOME/.config/aynx/bin:$PATH\" AYNX_CODEX_NO_DAEMON=1; {}",
            exec_launcher()
        )
    );
    assert!(exec_launcher_with_signal(&env).ends_with(&exec_launcher()));
    assert_eq!(typed_signal_line(BootstrapPlan::Exec, Some(&env)), None);
    assert_eq!(typed_signal_line(BootstrapPlan::Exec, None), None);
    // 비밀(주소 · 토큰)이 든 폴백은 exec 명령(서버 `ps`)에 싣지 않는다 — 타이핑으로.
    let secret = agent_env(false);
    assert!(!signal_rides_launcher(BootstrapPlan::Exec, &secret));
    assert_eq!(
        typed_signal_line(BootstrapPlan::Exec, Some(&secret)),
        Some(signal_export_line(&secret))
    );
    // bash 가 아니거나(ShellQuiet) · SFTP 실패 · 셸 통합 끔 — 런처가 없으니 타이핑.
    for plan in [
        BootstrapPlan::ShellQuiet,
        BootstrapPlan::ShellHeredoc,
        BootstrapPlan::ShellOptOut,
    ] {
        assert!(!signal_rides_launcher(plan, &env));
        assert_eq!(typed_signal_line(plan, Some(&env)), Some(signal_export_line(&env)));
    }
}

/// 필터 목록 — 조용한 한 줄은 `ShellQuiet` 에서만 하나, 타이핑한 신호 줄은 둘(터미널 드라이버 에코 + 줄 편집기 다시 그림).
/// 지울 줄이 없으면 빈 목록. 바늘은 앞 공백 · 끝 개행을 뗀 줄이다.
#[test]
fn echo_filters_cover_exactly_the_lines_we_type() {
    use crate::shell_integration::BootstrapPlan;
    use open::echo_filters;
    let line = signal_export_line(&agent_env(true));
    assert_eq!(
        signal_echo_needle(&line),
        "export AYNX_STREAM='s-1234abcd' PATH=\"$HOME/.config/aynx/bin:$PATH\" AYNX_CODEX_NO_DAEMON=1"
    );
    assert!(echo_filters(BootstrapPlan::Exec, None).is_empty());
    assert!(echo_filters(BootstrapPlan::ShellOptOut, None).is_empty());
    assert!(echo_filters(BootstrapPlan::ShellHeredoc, None).is_empty());
    assert_eq!(echo_filters(BootstrapPlan::ShellQuiet, None).len(), 1);
    assert_eq!(echo_filters(BootstrapPlan::ShellOptOut, Some(&line)).len(), 2);
    assert_eq!(echo_filters(BootstrapPlan::ShellQuiet, Some(&line)).len(), 3);
}

/// 필터 사슬에 청크를 먹인다 — 펌프(`spawn_output_pump`)와 같은 순서 · 같은 내려놓기.
fn pump_chain(filters: &mut Vec<crate::shell_integration::EchoFilter>, chunks: &[&[u8]]) -> Vec<u8> {
    let mut all = Vec::new();
    for c in chunks {
        let mut out = c.to_vec();
        for f in filters.iter_mut() {
            out = f.feed(&out);
        }
        filters.retain(|f| !f.is_done());
        all.extend_from_slice(&out);
    }
    all
}

/// 실측 바이트(2026-10-27 — MSYS pty 위 bash 5.2 에 셸이 읽기 전에 이 줄을 넣었다: 사용자 화면과 같은 두 번)에서 두 등장이
/// 모두 지워지고, 사용자 `on_connect`(여기서는 `echo …` 줄)와 프롬프트는 그대로 남는다. 청크가 어디서 갈리든 같다.
#[test]
fn typed_signal_echo_is_scrubbed_twice_from_real_bytes() {
    use crate::shell_integration::BootstrapPlan;
    use open::echo_filters;
    let line = signal_export_line(&agent_env(true));
    let user = "echo \"S=[$AYNX_STREAM]\"";
    let needle = signal_echo_needle(&line);
    // 터미널 드라이버의 에코(셸이 읽기 전) → 첫 프롬프트 + readline 의 다시 그림 → 엔터 → 다음 프롬프트 + 사용자 줄.
    let raw = format!(
        "\x1b[6n {needle}\r\n{user}\r\n\x1b[?2004hroot@dev-01:~#  {needle}\r\n\x1b[?2004l\r\
         \x1b[?2004hroot@dev-01:~# {user}\r\n\x1b[?2004l\rS=[s-1234abcd]\r\n\x1b[?2004hroot@dev-01:~# "
    );
    let want = format!(
        "\x1b[6n \r\n{user}\r\n\x1b[?2004hroot@dev-01:~#  \r\n\x1b[?2004l\r\
         \x1b[?2004hroot@dev-01:~# {user}\r\n\x1b[?2004l\rS=[s-1234abcd]\r\n\x1b[?2004hroot@dev-01:~# "
    );
    let bytes = raw.as_bytes();
    // 한 덩어리 · 바이트 하나씩 · 여러 자리에서 둘로.
    let mut f = echo_filters(BootstrapPlan::Exec, Some(&line));
    assert_eq!(String::from_utf8(pump_chain(&mut f, &[bytes])).unwrap(), want);
    let singles: Vec<&[u8]> = bytes.chunks(1).collect();
    let mut f = echo_filters(BootstrapPlan::Exec, Some(&line));
    assert_eq!(String::from_utf8(pump_chain(&mut f, &singles)).unwrap(), want);
    for cut in (1..bytes.len()).step_by(7) {
        let mut f = echo_filters(BootstrapPlan::Exec, Some(&line));
        let got = pump_chain(&mut f, &[&bytes[..cut], &bytes[cut..]]);
        assert_eq!(String::from_utf8(got).unwrap(), want, "cut={cut}");
    }
    // 두 번 다 지운 뒤에는 필터가 모두 내려놓인다(이후 출력은 손대지 않는다).
    let mut f = echo_filters(BootstrapPlan::Exec, Some(&line));
    pump_chain(&mut f, &[bytes]);
    assert!(f.is_empty());
}

/// 줄 편집기가 이미 떠 있어 에코가 **한 번**뿐인 셸 — 그 하나만 지우고, 프롬프트 끝의 공백이 붙들려 늦게 서지 않는다(바늘이
/// 공백으로 시작하지 않는다). 사람이 나중에 다른 글자를 쳐도 그대로 지나간다.
#[test]
fn typed_signal_echo_once_does_not_hold_the_prompt() {
    use crate::shell_integration::BootstrapPlan;
    use open::echo_filters;
    let line = signal_export_line(&agent_env(true));
    let needle = signal_echo_needle(&line).to_string();
    let mut f = echo_filters(BootstrapPlan::ShellOptOut, Some(&line));
    let prompt = b"root@dev-01:~# ";
    assert_eq!(pump_chain(&mut f, &[prompt]), prompt.to_vec(), "프롬프트는 곧바로 나가야 한다");
    let echoed = format!(" {needle}\r\nroot@dev-01:~# ls\r\n");
    assert_eq!(
        String::from_utf8(pump_chain(&mut f, &[echoed.as_bytes()])).unwrap(),
        " \r\nroot@dev-01:~# ls\r\n"
    );
}

// ---------------------------------------------------------------------------
// 공유 전송로만 빌리기 (`open::acquire_shared`) — 쿼리 타일의 SSH 터널
// ---------------------------------------------------------------------------

/// DB 터널의 핀은 **세션이 아니다** — 그 구획의 코드(주석 밖)는 세션 표·세션 코어를 부르지 않는다.
/// 표에 오르면 헤드리스가 "셸 없는 세션 + 같은 별칭" 으로 재사용하고 세션 목록 어디에나 보이게 된다.
#[test]
fn acquire_shared_never_touches_the_session_table() {
    let src = include_str!("open.rs");
    let start = src
        .find("// 공유 전송로만 빌리기")
        .expect("구획 머리가 있어야 한다");
    let end = start
        + src[start..]
            .find("/// 원격 새 워크트리를 준비한다")
            .expect("구획 끝이 있어야 한다");
    let code: Vec<&str> = src[start..end]
        .lines()
        .map(str::trim_start)
        .filter(|l| !l.starts_with("//"))
        .collect();
    assert!(code.iter().any(|l| l.contains("async fn acquire_shared(")));
    for banned in [
        "table()",
        "core()",
        "register_session",
        "SshSession {",
        "agent_signal",
        "port_forward::",
    ] {
        assert!(
            !code.iter().any(|l| l.contains(banned)),
            "acquire_shared 구획이 `{banned}` 를 부른다"
        );
    }
}

/// 실패한 빌리기는 아무것도 차지하지 않는다 — 풀에도, 세션 표에도 남지 않는다(닫힌 루프백 포트로 실제로 접속해 본다).
#[tokio::test]
// 테스트 직렬화용 잠금이라 await 를 넘어 들고 있어야 한다
#[allow(clippy::await_holding_lock)]
async fn a_failed_shared_acquire_leaves_nothing_behind() {
    let _net = crate::test_support::NET_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let probe = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe); // 닫힌 포트 — 연결 거부가 온다

    let adhoc = AdhocTarget {
        host: "127.0.0.1".into(),
        user: Some("nobody".into()),
        port: Some(port),
    };
    let alias = format!("nobody@127.0.0.1:{port}");
    let params = resolve_adhoc(&adhoc, None).unwrap();
    let key = transport_key(&params, &alias, true);
    let fired = std::sync::Arc::new(AtomicBool::new(false));
    let hook_fired = std::sync::Arc::clone(&fired);
    let result = open::acquire_shared(
        &alias,
        Some(&adhoc),
        open::SharedCreds::default(),
        Some(Box::new(move |_| {
            hook_fired.store(true, std::sync::atomic::Ordering::SeqCst)
        })),
    )
    .await;
    assert!(result.is_err(), "닫힌 포트에 붙었다");
    assert_eq!(TRANSPORTS.users(&key), 0, "실패했는데 풀에 자리가 남았다");
    assert!(
        !table().0.lock().unwrap().values().any(|s| s.alias == alias),
        "세션 표에 올랐다"
    );
    assert!(
        !fired.load(std::sync::atomic::Ordering::SeqCst),
        "접속하지도 않은 전송로의 죽음 훅이 울렸다"
    );
}
