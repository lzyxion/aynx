use super::*;

fn host<'a>(cfg: &'a SshConfig, name: &str) -> &'a HostEntry {
    cfg.hosts
        .iter()
        .find(|h| h.name == name)
        .unwrap_or_else(|| panic!("host '{name}' 없음: {:?}", cfg.hosts))
}

#[test]
fn parses_basic_block() {
    let cfg = parse(
        "\
Host web
    HostName 10.0.0.1
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    ProxyJump bastion
    ServerAliveInterval 30
    ServerAliveCountMax 3
",
    );

    assert_eq!(cfg.hosts.len(), 1);
    let h = host(&cfg, "web");
    assert_eq!(h.host_name.as_deref(), Some("10.0.0.1"));
    assert_eq!(h.user.as_deref(), Some("deploy"));
    assert_eq!(h.port, Some(2222));
    assert_eq!(h.identity_file.as_deref(), Some("~/.ssh/id_ed25519"));
    assert_eq!(h.proxy_jump.as_deref(), Some("bastion"));
    assert_eq!(h.server_alive_interval, Some(30));
    assert_eq!(h.server_alive_count_max, Some(3));
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
}

#[test]
fn ignores_comments_and_blank_lines() {
    let cfg = parse(
        "\
# 주석
\t
Host a   # 이 줄 뒤 주석은 패턴으로 새지 않는다
    # 들여쓴 주석
    HostName a.example.com

",
    );
    assert_eq!(cfg.hosts.len(), 1);
    assert_eq!(host(&cfg, "a").host_name.as_deref(), Some("a.example.com"));
}

#[test]
fn first_obtained_value_wins() {
    let cfg = parse(
        "\
Host web
    HostName first.example.com
    Port 1111
Host web
    HostName second.example.com
    Port 2222
    User late
",
    );

    // 같은 별칭은 한 번만 나오고, 옵션별로 먼저 나온 값이 이긴다.
    assert_eq!(cfg.hosts.len(), 1);
    let h = host(&cfg, "web");
    assert_eq!(h.host_name.as_deref(), Some("first.example.com"));
    assert_eq!(h.port, Some(1111));
    // 앞 블록에 없던 옵션은 뒤 블록에서 채워진다.
    assert_eq!(h.user.as_deref(), Some("late"));
}

#[test]
fn wildcard_block_merges_into_concrete_hosts() {
    let cfg = parse(
        "\
Host web
    HostName 10.0.0.1
Host db
    HostName 10.0.0.2
    ServerAliveInterval 5
Host *
    ServerAliveInterval 30
    ServerAliveCountMax 3
    User fallback
",
    );

    // 패턴 블록 자체는 목록에 나오지 않는다.
    assert_eq!(cfg.hosts.len(), 2);
    assert_eq!(cfg.hosts[0].name, "web");
    assert_eq!(cfg.hosts[1].name, "db");

    let web = host(&cfg, "web");
    assert_eq!(web.server_alive_interval, Some(30));
    assert_eq!(web.server_alive_count_max, Some(3));
    assert_eq!(web.user.as_deref(), Some("fallback"));

    // 구체 블록이 먼저 나왔으므로 Host * 값이 덮어쓰지 못한다.
    let db = host(&cfg, "db");
    assert_eq!(db.server_alive_interval, Some(5));
}

/// `proxy_jump` 는 `identity_file` 과 **같은 규칙**으로 보고된다 — 그 호스트 블록에
/// 적혀 있으면 그 값, 없으면 매치되는 패턴 블록(`Host *`)에서 내려온 값이다.
/// (프런트의 경유 호스트 칸이 "지금 적용 중인 값" 을 보여 주는 근거다.)
#[test]
fn proxy_jump_follows_the_identity_file_precedent() {
    let cfg = parse(
        "\
Host web
    ProxyJump own-bastion
Host db
Host *
    ProxyJump shared-bastion
    IdentityFile ~/.ssh/id_shared
",
    );
    assert_eq!(host(&cfg, "web").proxy_jump.as_deref(), Some("own-bastion"));
    // 자기 블록에 없으면 공용 블록 값이 실린다 — IdentityFile 과 한 규칙이다.
    assert_eq!(
        host(&cfg, "db").proxy_jump.as_deref(),
        Some("shared-bastion")
    );
    assert_eq!(
        host(&cfg, "db").identity_file.as_deref(),
        Some("~/.ssh/id_shared")
    );
}

#[test]
fn options_before_first_host_apply_globally() {
    let cfg = parse(
        "\
ServerAliveInterval 42
Host a
    HostName a.example.com
Host b
    ServerAliveInterval 7
",
    );
    assert_eq!(host(&cfg, "a").server_alive_interval, Some(42));
    // 전역 블록이 파일 선두에 있으므로 first-wins 로 전역 값이 이긴다.
    assert_eq!(host(&cfg, "b").server_alive_interval, Some(42));
}

#[test]
fn multiple_patterns_on_one_host_line() {
    let cfg = parse(
        "\
Host alpha beta prod-*
    User shared
Host alpha
    HostName alpha.example.com
Host prod-web
    HostName prod-web.example.com
",
    );

    // 구체 이름은 등장 순서대로: alpha, beta, prod-web (prod-* 는 패턴이라 제외).
    let names: Vec<&str> = cfg.hosts.iter().map(|h| h.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "beta", "prod-web"]);
    assert_eq!(host(&cfg, "alpha").user.as_deref(), Some("shared"));
    assert_eq!(host(&cfg, "beta").user.as_deref(), Some("shared"));
    assert_eq!(host(&cfg, "prod-web").user.as_deref(), Some("shared"));
}

#[test]
fn question_mark_wildcard() {
    let cfg = parse(
        "\
Host web1
Host web22
Host web?
    User single
",
    );
    assert_eq!(host(&cfg, "web1").user.as_deref(), Some("single"));
    assert_eq!(host(&cfg, "web22").user, None);
}

#[test]
fn star_wildcard_matching_details() {
    assert!(matches_pattern("*", "anything"));
    assert!(matches_pattern("*", ""));
    assert!(matches_pattern("prod-*", "prod-web"));
    assert!(matches_pattern("*.example.com", "a.example.com"));
    assert!(matches_pattern("a*b*c", "axxbyyc"));
    assert!(!matches_pattern("prod-*", "stage-web"));
    assert!(!matches_pattern("web?", "web"));
    assert!(matches_pattern("web?", "webs"));
}

#[test]
fn host_matching_is_case_insensitive() {
    let cfg = parse(
        "\
Host Web
    HostName w.example.com
Host WEB*
    User upper
",
    );
    assert_eq!(host(&cfg, "Web").user.as_deref(), Some("upper"));
}

#[test]
fn option_keywords_are_case_insensitive() {
    let cfg = parse(
        "\
host web
    hostname 10.0.0.1
    USER deploy
    PoRt 2200
    serveraliveinterval 15
",
    );
    let h = host(&cfg, "web");
    assert_eq!(h.host_name.as_deref(), Some("10.0.0.1"));
    assert_eq!(h.user.as_deref(), Some("deploy"));
    assert_eq!(h.port, Some(2200));
    assert_eq!(h.server_alive_interval, Some(15));
}

#[test]
fn equals_separator_is_accepted() {
    let cfg = parse(
        "\
Host=web
    HostName=10.0.0.9
    Port = 2201
    User =deploy
",
    );
    let h = host(&cfg, "web");
    assert_eq!(h.host_name.as_deref(), Some("10.0.0.9"));
    assert_eq!(h.port, Some(2201));
    assert_eq!(h.user.as_deref(), Some("deploy"));
}

#[test]
fn quoted_values_keep_spaces() {
    let cfg = parse(
        "\
Host \"my host\"
    IdentityFile \"~/.ssh/my key\"
    User \"space man\"
",
    );
    let h = host(&cfg, "my host");
    assert_eq!(h.identity_file.as_deref(), Some("~/.ssh/my key"));
    assert_eq!(h.user.as_deref(), Some("space man"));
}

#[test]
fn include_produces_warning() {
    let cfg = parse(
        "\
Include ~/.ssh/conf.d/*
Host web
    HostName 10.0.0.1
",
    );
    assert_eq!(cfg.hosts.len(), 1);
    assert_eq!(cfg.warnings.len(), 1);
    assert!(
        cfg.warnings[0].starts_with("line 1: Include"),
        "{:?}",
        cfg.warnings
    );
    assert!(cfg.warnings[0].contains("지원하지 않습니다"));
}

#[test]
fn match_block_warns_and_its_options_are_dropped() {
    let cfg = parse(
        "\
Host web
    HostName 10.0.0.1
Match host web
    User matched
",
    );
    let h = host(&cfg, "web");
    assert_eq!(h.host_name.as_deref(), Some("10.0.0.1"));
    // Match 블록의 옵션이 앞 Host 블록으로 새면 안 된다.
    assert_eq!(h.user, None);
    assert_eq!(cfg.warnings.len(), 1);
    assert!(
        cfg.warnings[0].starts_with("line 3: Match"),
        "{:?}",
        cfg.warnings
    );
}

#[test]
fn negated_pattern_warns_and_is_skipped() {
    let cfg = parse(
        "\
Host * !secret
    User shared
Host web
    HostName 10.0.0.1
Host secret
    HostName 10.0.0.2
",
    );
    assert_eq!(cfg.warnings.len(), 1);
    assert!(cfg.warnings[0].contains("부정 패턴"), "{:?}", cfg.warnings);
    // 부정 패턴을 무시하므로 secret 도 * 에 매치된다 (경고로 알린 대로 동작).
    assert_eq!(host(&cfg, "secret").user.as_deref(), Some("shared"));
    assert_eq!(host(&cfg, "web").user.as_deref(), Some("shared"));
}

#[test]
fn invalid_number_warns_and_is_ignored() {
    let cfg = parse(
        "\
Host web
    Port abc
    Port 22
    ServerAliveCountMax -1
",
    );
    let h = host(&cfg, "web");
    // 깨진 값은 버려지고 다음 유효한 값이 채택된다.
    assert_eq!(h.port, Some(22));
    assert_eq!(h.server_alive_count_max, None);
    assert_eq!(cfg.warnings.len(), 2, "{:?}", cfg.warnings);
    assert!(cfg.warnings[0].contains("숫자로 해석할 수 없습니다"));
}

#[test]
fn unknown_options_are_ignored_silently() {
    let cfg = parse(
        "\
Host web
    HostName 10.0.0.1
    Compression yes
    ForwardX11 yes
",
    );
    assert_eq!(host(&cfg, "web").host_name.as_deref(), Some("10.0.0.1"));
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
}

#[test]
fn empty_config_yields_empty_result() {
    let cfg = parse("");
    assert!(cfg.hosts.is_empty());
    assert!(cfg.warnings.is_empty());
}

#[test]
fn order_follows_config_appearance() {
    let cfg = parse("Host zeta\nHost alpha\nHost mid\n");
    let names: Vec<&str> = cfg.hosts.iter().map(|h| h.name.as_str()).collect();
    assert_eq!(names, vec!["zeta", "alpha", "mid"]);
}

#[test]
fn serializes_to_json() {
    let cfg = parse("Host web\n    HostName 10.0.0.1\n");
    let json = serde_json::to_string(&cfg).unwrap();
    assert!(json.contains("\"hosts\""));
    assert!(json.contains("\"host_name\":\"10.0.0.1\""));
    assert!(json.contains("\"warnings\""));
    // meta 는 flatten 하지 않는다 — 프런트는 host.meta.color 로 읽는다.
    assert!(json.contains("\"meta\":{"), "{json}");
}

#[test]
fn parse_alone_leaves_meta_empty() {
    let cfg = parse("Host web\n    HostName 10.0.0.1\n");
    assert_eq!(host(&cfg, "web").meta, HostMeta::default());
}

#[test]
fn attach_meta_fills_hosts_case_insensitively() {
    let mut cfg = parse("Host Web-01\nHost db\n");
    let (meta, _) = SessionsMeta::parse(
        "\
[defaults]
color = \"#8a8a8a\"

[hosts.web-01]
group = \"prod/web\"
tags = [\"web\"]
color = \"#c25b4a\"
",
    );
    attach_meta(&mut cfg, &meta);

    // ssh config 의 별칭(대문자 포함)과 sessions.toml 키가 대소문자 무시로 맞는다.
    let web = host(&cfg, "Web-01");
    assert_eq!(web.meta.color.as_deref(), Some("#c25b4a"));
    assert_eq!(web.meta.group.as_deref(), Some("prod/web"));
    assert_eq!(web.meta.tags, vec!["web".to_string()]);

    // 항목이 없는 호스트도 defaults 는 받는다.
    let db = host(&cfg, "db");
    assert_eq!(db.meta.color.as_deref(), Some("#8a8a8a"));
    assert!(db.meta.group.is_none());
    assert!(db.meta.tags.is_empty());
}

// ── StrictHostKeyChecking · UserKnownHostsFile ───────────────────────────

#[test]
fn strict_host_key_checking_takes_all_four_values() {
    let cfg = parse(
        "\
Host plain
Host strict
    StrictHostKeyChecking yes
Host off
    StrictHostKeyChecking no
Host newkeys
    StrictHostKeyChecking accept-new
Host asked
    StrictHostKeyChecking ask
",
    );
    use StrictHostKeyChecking::*;
    // 적지 않으면 언제나 yes — 앱 기본값은 항상 검증이다.
    assert_eq!(host(&cfg, "plain").strict_host_key_checking, Yes);
    assert_eq!(host(&cfg, "strict").strict_host_key_checking, Yes);
    assert_eq!(host(&cfg, "off").strict_host_key_checking, No);
    assert_eq!(host(&cfg, "newkeys").strict_host_key_checking, AcceptNew);
    assert_eq!(host(&cfg, "asked").strict_host_key_checking, Ask);
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
}

#[test]
fn strict_value_is_case_insensitive() {
    let cfg = parse(
        "Host a\n    StrictHostKeyChecking Accept-New\nHost b\n    stricthostkeychecking NO\n",
    );
    assert_eq!(
        host(&cfg, "a").strict_host_key_checking,
        StrictHostKeyChecking::AcceptNew
    );
    assert_eq!(
        host(&cfg, "b").strict_host_key_checking,
        StrictHostKeyChecking::No
    );
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
}

#[test]
fn strict_semantics_helpers() {
    use StrictHostKeyChecking::*;
    assert!(No.skips_verification());
    for v in [Yes, Ask, AcceptNew] {
        assert!(!v.skips_verification(), "{v:?}");
    }
    assert!(AcceptNew.auto_accepts_new());
    for v in [Yes, Ask, No] {
        assert!(!v.auto_accepts_new(), "{v:?}");
    }
    // ask 는 우리 TOFU 모달과 같은 동작이라 yes 와 판정이 같다.
    assert_eq!(Ask.skips_verification(), Yes.skips_verification());
    assert_eq!(Ask.auto_accepts_new(), Yes.auto_accepts_new());
}

#[test]
fn unknown_strict_value_warns_and_falls_back_to_yes() {
    let cfg = parse(
        "\
Host web
    StrictHostKeyChecking maybe
Host *
    StrictHostKeyChecking no
",
    );
    // 알 수 없는 값이라도 first-wins 슬롯을 차지한다 — 뒤의 Host * 완화가 이기면 안 된다.
    assert_eq!(
        host(&cfg, "web").strict_host_key_checking,
        StrictHostKeyChecking::Yes
    );
    assert_eq!(cfg.warnings.len(), 1, "{:?}", cfg.warnings);
    assert!(
        cfg.warnings[0].starts_with("line 2: StrictHostKeyChecking"),
        "{:?}",
        cfg.warnings
    );
    assert!(
        cfg.warnings[0].contains("yes 로 취급"),
        "{:?}",
        cfg.warnings
    );
}

#[test]
fn dev_null_known_hosts_means_do_not_store() {
    let cfg = parse(
        "\
Host a
    UserKnownHostsFile /dev/null
Host b
    UserKnownHostsFile none
Host c
    UserKnownHostsFile NONE
Host d
",
    );
    assert!(host(&cfg, "a").no_host_key_store);
    assert!(host(&cfg, "b").no_host_key_store);
    assert!(host(&cfg, "c").no_host_key_store);
    // 적지 않으면 평소대로 기본 파일에 기록한다.
    assert!(!host(&cfg, "d").no_host_key_store);
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
}

#[test]
fn other_known_hosts_paths_warn_and_keep_the_default_file() {
    let cfg = parse(
        "\
Host web
    UserKnownHostsFile ~/.ssh/known_hosts.work
Host *
    UserKnownHostsFile /dev/null
",
    );
    // 지원하지 않는 경로도 슬롯을 차지한다 — Host * 의 /dev/null 이 이기면 안 된다.
    assert!(!host(&cfg, "web").no_host_key_store);
    assert_eq!(cfg.warnings.len(), 1, "{:?}", cfg.warnings);
    assert!(
        cfg.warnings[0].contains("UserKnownHostsFile 은 /dev/null 만 지원합니다"),
        "{:?}",
        cfg.warnings
    );
}

#[test]
fn security_options_follow_first_wins_and_wildcard_merge() {
    let cfg = parse(
        "\
Host tunnel
    StrictHostKeyChecking no
    StrictHostKeyChecking yes
Host plain
Host *
    StrictHostKeyChecking accept-new
    UserKnownHostsFile /dev/null
",
    );
    // 같은 블록 안에서도 먼저 적은 값이 이긴다.
    assert_eq!(
        host(&cfg, "tunnel").strict_host_key_checking,
        StrictHostKeyChecking::No
    );
    // 구체 블록에 없던 값은 Host * 에서 내려온다.
    assert!(host(&cfg, "tunnel").no_host_key_store);
    assert_eq!(
        host(&cfg, "plain").strict_host_key_checking,
        StrictHostKeyChecking::AcceptNew
    );
    assert!(host(&cfg, "plain").no_host_key_store);
}

/// 실기 시나리오 — 사용자의 실제 `~/.ssh/config` 에 이미 들어 있던 두 줄
/// (rustdesk 터널 뒤의 머신이 바뀌어 Changed 가 반복되던 호스트).
#[test]
fn real_world_remote_ssh_block() {
    let cfg = parse(
        "\
Host Remote-SSH
    HostName localhost
    Port 1220
    User innobe
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
Host other
    HostName 10.0.0.5
",
    );
    let h = host(&cfg, "Remote-SSH");
    assert_eq!(h.host_name.as_deref(), Some("localhost"));
    assert_eq!(h.port, Some(1220));
    assert_eq!(h.strict_host_key_checking, StrictHostKeyChecking::No);
    assert!(h.no_host_key_store);
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);

    // 완화는 **그 블록에만** 적용된다 — 다른 호스트는 기본값(항상 검증) 그대로.
    let other = host(&cfg, "other");
    assert_eq!(other.strict_host_key_checking, StrictHostKeyChecking::Yes);
    assert!(!other.no_host_key_store);
}

// ── ForwardAgent (docs/log/2026-09-23-agent-forwarding.md) ─────────────────

#[test]
fn forward_agent_takes_yes_no_first_wins_and_defaults_to_false() {
    let cfg = parse(
        "Host on
    ForwardAgent yes
Host off
    ForwardAgent no
Host plain
    HostName 10.0.0.9
Host *
    ForwardAgent yes
",
    );
    assert!(host(&cfg, "on").forward_agent);
    // 자기 블록의 `no` 가 먼저라 `Host *` 의 `yes` 가 이기지 못한다 (first-wins).
    assert!(!host(&cfg, "off").forward_agent);
    // 자기 블록에 없으면 `Host *` 에서 물려받는다 — OpenSSH 와 같다.
    assert!(host(&cfg, "plain").forward_agent);
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
    assert!(
        !parse(
            "Host x
"
        )
        .hosts[0]
            .forward_agent
    );
}

/// 소켓 경로·`$VAR` 는 받지 않는다 — 꺼진 쪽으로 버리고 경고한다.
#[test]
fn forward_agent_path_value_warns_and_stays_off() {
    let cfg = parse(
        "Host web
    ForwardAgent ~/.ssh/other.sock
",
    );
    assert!(!host(&cfg, "web").forward_agent);
    assert_eq!(cfg.warnings.len(), 1, "{:?}", cfg.warnings);
    assert!(cfg.warnings[0].contains("ForwardAgent"));
}

// ── IdentitiesOnly ───────────────────────────────────────────────────────

#[test]
fn identities_only_takes_yes_no_and_defaults_to_false() {
    let cfg = parse(
        "\
Host on
    IdentityFile ~/.ssh/id_only
    IdentitiesOnly yes
Host off
    IdentitiesOnly no
Host loud
    identitiesonly YES
Host plain
",
    );
    assert!(host(&cfg, "on").identities_only);
    assert!(!host(&cfg, "off").identities_only);
    // 키워드도 값도 대소문자를 가리지 않는다.
    assert!(host(&cfg, "loud").identities_only);
    // 적지 않으면 OpenSSH 기본값 = no.
    assert!(!host(&cfg, "plain").identities_only);
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
}

/// `IdentityFile` 과 **한 규칙**이다 — 자기 블록에 없으면 `Host *` 에서 내려오고,
/// 먼저 적은 값이 이긴다.
#[test]
fn identities_only_follows_first_wins_and_the_wildcard_merge() {
    let cfg = parse(
        "\
Host web
    IdentitiesOnly no
    IdentitiesOnly yes
Host db
Host *
    IdentitiesOnly yes
",
    );
    // 같은 블록 안에서도 먼저 적은 값이 이긴다.
    assert!(!host(&cfg, "web").identities_only);
    // 자기 블록에 없으면 공용 블록 값이 실린다.
    assert!(host(&cfg, "db").identities_only);
}

/// **폼이 보는 값은 자기 블록뿐이다** — `Host *` 에서 물려받은 것은 실리지 않는다.
///
/// 이 칸이 따로 있는 이유가 여기 있다: `db` 의 스위치를 병합값으로 켜 놓으면, 사람이
/// 아무것도 안 고치고 [저장]만 눌러도 `IdentitiesOnly yes` 가 `db` 블록에 굳어
/// 상속이 끊긴다.
#[test]
fn identities_only_own_ignores_the_wildcard_block() {
    let cfg = parse(
        "\
Host web
    IdentitiesOnly yes
Host db
Host off
    IdentitiesOnly no
Host *
    IdentitiesOnly yes
",
    );
    // 자기 블록에 적힌 호스트 — 둘 다 참.
    assert!(host(&cfg, "web").identities_only);
    assert!(host(&cfg, "web").identities_only_own);

    // 물려받기만 한 호스트 — 접속은 켜진 것으로 보지만 폼의 스위치는 꺼져 있다.
    assert!(host(&cfg, "db").identities_only);
    assert!(!host(&cfg, "db").identities_only_own);

    // 자기 블록에서 껐으면 둘 다 거짓이다 (그 `no` 가 공용 블록을 이긴다).
    assert!(!host(&cfg, "off").identities_only);
    assert!(!host(&cfg, "off").identities_only_own);
}

/// 여러 별칭을 공유하는 `Host` 줄은 **둘 다의 자기 블록**이다.
#[test]
fn identities_only_own_covers_a_shared_host_line() {
    let cfg = parse(
        "\
Host web db
    IdentitiesOnly yes
",
    );
    assert!(host(&cfg, "web").identities_only_own);
    assert!(host(&cfg, "db").identities_only_own);
}

#[test]
fn unknown_identities_only_value_warns_and_is_ignored() {
    let cfg = parse(
        "\
Host web
    IdentitiesOnly maybe
    IdentitiesOnly yes
",
    );
    // 깨진 값은 슬롯을 차지하지 않는다 — 다음 유효한 값이 채택된다.
    assert!(host(&cfg, "web").identities_only);
    assert_eq!(cfg.warnings.len(), 1, "{:?}", cfg.warnings);
    assert!(
        cfg.warnings[0].starts_with("line 2: IdentitiesOnly"),
        "{:?}",
        cfg.warnings
    );
}

#[test]
fn strict_serializes_with_the_openssh_spelling() {
    let cfg =
        parse("Host web\n    StrictHostKeyChecking accept-new\n    UserKnownHostsFile /dev/null\n");
    let json = serde_json::to_string(&cfg).unwrap();
    assert!(
        json.contains(r#""strict_host_key_checking":"accept-new""#),
        "{json}"
    );
    assert!(json.contains(r#""no_host_key_store":true"#), "{json}");

    let plain = serde_json::to_string(&parse("Host web\n")).unwrap();
    assert!(
        plain.contains(r#""strict_host_key_checking":"yes""#),
        "{plain}"
    );
    assert!(plain.contains(r#""no_host_key_store":false"#), "{plain}");
}
