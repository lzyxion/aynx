use super::*;

fn meta(content: &str) -> SessionsMeta {
    let (m, w) = SessionsMeta::parse(content);
    assert!(w.is_empty(), "예상치 못한 경고: {w:?}");
    m
}

#[test]
fn merges_three_layers() {
    let m = meta(
        r##"
[defaults]
color = "#8a8a8a"
scrollback = 5000

[presets.prod]
identity = "~/.ssh/id_prod"
on_connect = "cd /srv/app"
color = "#333333"

[hosts.web-01]
group = "prod/web"
preset = "prod"
tags = ["web"]
color = "#c25b4a"
"##,
    );

    let h = m.resolve("web-01");
    // hosts 가 preset·defaults 를 모두 이긴다.
    assert_eq!(h.color.as_deref(), Some("#c25b4a"));
    // preset 에만 있는 값은 그대로 올라온다.
    assert_eq!(h.identity.as_deref(), Some("~/.ssh/id_prod"));
    assert_eq!(h.on_connect.as_deref(), Some("cd /srv/app"));
    // 어느 쪽도 덮지 않은 defaults 값은 살아남는다.
    assert_eq!(h.scrollback, Some(5000));
    assert_eq!(h.group.as_deref(), Some("prod/web"));
    assert_eq!(h.tags, vec!["web".to_string()]);
}

#[test]
fn records_which_layer_gave_color_and_icon() {
    let m = meta(
        r##"
[defaults]
color = "#8a8a8a"
icon = "svg:debian"

[presets.prod]
icon = "svg:ubuntu"

[hosts.web-01]
preset = "prod"

[hosts.web-02]
color = "#c25b4a"

[hosts.web-03]
preset = "prod"
icon = "🐧"
"##,
    );
    // 색은 defaults, 아이콘은 preset 이 덮었다.
    let h = m.resolve("web-01");
    assert_eq!(h.color_from, Some(MetaLayer::Defaults));
    assert_eq!(h.icon_from, Some(MetaLayer::Preset("prod".into())));
    // 자기 블록 값은 출처가 없다.
    let h = m.resolve("web-02");
    assert_eq!(h.color_from, None);
    assert_eq!(h.icon_from, Some(MetaLayer::Defaults));
    assert_eq!(m.resolve("web-03").icon_from, None);
    // 블록이 없는 호스트도 defaults 출처를 받는다.
    assert_eq!(m.resolve("nobody").color_from, Some(MetaLayer::Defaults));
    // 원본 읽기는 출처를 싣지 않는다.
    assert_eq!(m.raw_host("web-01").icon_from, None);
    // 직렬화 모양 — 프런트가 읽는 그대로.
    assert_eq!(
        serde_json::to_value(MetaLayer::Preset("prod".into())).unwrap(),
        serde_json::json!({"kind": "preset", "name": "prod"})
    );
    assert_eq!(
        serde_json::to_value(MetaLayer::Defaults).unwrap(),
        serde_json::json!({"kind": "defaults"})
    );
}

#[test]
fn preset_beats_defaults_when_host_is_silent() {
    let m = meta(
        "\
[defaults]
color = \"#111111\"

[presets.p]
color = \"#222222\"

[hosts.a]
preset = \"p\"
",
    );
    assert_eq!(m.resolve("a").color.as_deref(), Some("#222222"));
}

#[test]
fn defaults_apply_to_hosts_without_an_entry() {
    let m = meta("[defaults]\ncolor = \"#8a8a8a\"\nscrollback = 1000\n");
    let h = m.resolve("전혀-모르는-호스트");
    assert_eq!(h.color.as_deref(), Some("#8a8a8a"));
    assert_eq!(h.scrollback, Some(1000));
    assert!(h.tags.is_empty());
}

#[test]
fn missing_preset_warns_and_falls_back_to_defaults() {
    let (m, warnings) = SessionsMeta::parse(
        "\
[defaults]
color = \"#8a8a8a\"

[hosts.web]
preset = \"없는프리셋\"
tags = [\"a\"]
",
    );
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("없는 preset"), "{warnings:?}");
    assert!(warnings[0].contains("hosts.web"), "{warnings:?}");

    // 경고를 냈을 뿐 나머지 병합은 그대로 진행된다.
    let h = m.resolve("web");
    assert_eq!(h.color.as_deref(), Some("#8a8a8a"));
    assert_eq!(h.tags, vec!["a".to_string()]);
}

#[test]
fn preset_key_outside_hosts_warns() {
    let (_, warnings) = SessionsMeta::parse(
        "\
[defaults]
preset = \"p\"

[presets.p]
preset = \"q\"

[presets.q]
color = \"#000000\"
",
    );
    assert_eq!(warnings.len(), 2, "{warnings:?}");
    assert!(
        warnings.iter().any(|w| w.contains("[defaults] 의 preset")),
        "{warnings:?}"
    );
    assert!(
        warnings.iter().any(|w| w.contains("[presets.p] 의 preset")),
        "{warnings:?}"
    );
}

#[test]
fn unknown_keys_are_ignored() {
    // TOML 의 따옴표 없는 키는 ASCII 만 허용한다 — 한글 키는 따옴표로 감싼다.
    let m = meta(
        "\
[defaults]
color = \"#8a8a8a\"
unknown_key = 1
\"알 수 없는 키\" = true

[hosts.web]
tags = [\"x\"]
future_field = { a = 1 }
icon = \"🚀\"

[\"전혀 모르는 섹션\"]
whatever = true
",
    );
    let h = m.resolve("web");
    assert_eq!(h.color.as_deref(), Some("#8a8a8a"));
    assert_eq!(h.tags, vec!["x".to_string()]);
}

#[test]
fn host_lookup_ignores_case() {
    let m = meta("[hosts.WEB-01]\ncolor = \"#c25b4a\"\n");
    assert_eq!(m.resolve("web-01").color.as_deref(), Some("#c25b4a"));
    assert_eq!(m.resolve("Web-01").color.as_deref(), Some("#c25b4a"));
    assert_eq!(m.resolve("WEB-01").color.as_deref(), Some("#c25b4a"));
    // 이름이 실제로 다르면 매치되지 않는다.
    assert_eq!(m.resolve("web-02").color, None);
}

#[test]
fn case_colliding_host_tables_warn_and_first_wins() {
    let (m, warnings) = SessionsMeta::parse(
        "\
[hosts.WEB]
color = \"#aaaaaa\"

[hosts.web]
color = \"#bbbbbb\"
",
    );
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("대소문자만 다른"), "{warnings:?}");
    // BTreeMap 순서상 "WEB" 이 먼저다 — 어느 쪽이든 하나만 남는다는 것이 요점.
    assert_eq!(m.resolve("web").color.as_deref(), Some("#aaaaaa"));
}

#[test]
fn empty_and_missing_sections_are_not_an_error() {
    let (m, warnings) = SessionsMeta::parse("");
    assert!(warnings.is_empty());
    assert_eq!(m.resolve("web"), HostMeta::default());

    let (m, warnings) = SessionsMeta::parse("# 주석만 있는 파일\n");
    assert!(warnings.is_empty());
    assert_eq!(m.resolve("web"), HostMeta::default());

    let (m, warnings) = SessionsMeta::parse("[defaults]\n[presets]\n[hosts]\n");
    assert!(warnings.is_empty());
    assert_eq!(m.resolve("web"), HostMeta::default());
}

#[test]
fn broken_toml_warns_and_yields_empty_meta() {
    let (m, warnings) = SessionsMeta::parse("[hosts.web\ncolor = ");
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("해석할 수 없습니다"), "{warnings:?}");
    // 경고 한 줄은 한 줄이어야 한다 (사이드바 경고 목록에 그대로 들어간다).
    assert!(!warnings[0].contains('\n'), "{:?}", warnings[0]);
    assert_eq!(m.resolve("web"), HostMeta::default());
}

#[test]
fn wrong_value_type_is_treated_as_broken_file() {
    // scrollback 이 문자열이면 파일 전체를 못 믿는다 — 빈 메타 + 경고.
    let (m, warnings) = SessionsMeta::parse("[defaults]\nscrollback = \"많이\"\n");
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert_eq!(m.resolve("web"), HostMeta::default());
}

#[test]
fn tags_default_to_empty_vec_and_replace_rather_than_merge() {
    let m = meta(
        "\
[defaults]
tags = [\"기본\"]

[presets.p]
tags = [\"프리셋\"]

[hosts.a]
preset = \"p\"

[hosts.b]
preset = \"p\"
tags = [\"호스트\"]

[hosts.c]
preset = \"p\"
tags = []

[hosts.d]
color = \"#000000\"
",
    );
    assert_eq!(m.resolve("a").tags, vec!["프리셋".to_string()]);
    assert_eq!(m.resolve("b").tags, vec!["호스트".to_string()]);
    // 빈 배열은 "지움" 이다 — 위 계층 태그가 남지 않는다.
    assert!(m.resolve("c").tags.is_empty());
    assert_eq!(m.resolve("d").tags, vec!["기본".to_string()]);
    // 아무 데도 태그가 없으면 null 이 아니라 빈 배열.
    let empty = SessionsMeta::default();
    assert!(empty.resolve("x").tags.is_empty());
}

/// 세션 로깅은 다른 키와 **똑같은** 3계층 병합 규칙을 따른다 (특별 취급 없음).
#[test]
fn log_merges_like_every_other_key() {
    let m = meta(
        "\
[defaults]
log = true

[presets.p]
log = false

[hosts.a]
preset = \"p\"

[hosts.b]
preset = \"p\"
log = true

[hosts.c]
color = \"#000000\"
",
    );
    // preset 이 defaults 를 이기고, hosts 가 preset 을 이긴다.
    assert_eq!(m.resolve("a").log, Some(false));
    assert_eq!(m.resolve("b").log, Some(true));
    assert_eq!(m.resolve("c").log, Some(true));
    // 아무 데도 안 적혀 있으면 None = 끔.
    assert_eq!(SessionsMeta::default().resolve("x").log, None);
    // 원본 읽기는 병합하지 않는다 (폼 프리필).
    assert_eq!(m.raw_host("c").log, None);
    assert_eq!(m.raw_host("b").log, Some(true));
}

#[test]
fn log_true_is_written_and_false_removes_the_key() {
    // 체크 → `log = true` 가 적힌다.
    let p = HostMetaPatch {
        log: Some(true),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &p).unwrap();
    assert_eq!(after, "[hosts.web]\nlog = true\n");
    assert_eq!(reread(&after, "web").log, Some(true));

    // 체크 해제 → 키를 지운다 (= 상속/기본값으로). `false` 를 적어 두지 않는다.
    let off = HostMetaPatch {
        log: Some(false),
        ..HostMetaPatch::default()
    };
    assert_eq!(patch_document(&after, "web", &off).unwrap(), "");
    // 다른 키가 남아 있으면 테이블은 살아 있고 log 만 사라진다.
    let mixed = HostMetaPatch {
        color: Some("#c25b4a".into()),
        log: Some(false),
        ..HostMetaPatch::default()
    };
    let after = patch_document(
        "[hosts.web]\ncolor = \"#000000\"\nlog = true\n",
        "web",
        &mixed,
    )
    .unwrap();
    assert_eq!(after, "[hosts.web]\ncolor = \"#c25b4a\"\n");
}

/// 아이콘은 color 와 **똑같은** 3계층 병합 규칙을 따른다 (특별 취급 없음).
#[test]
fn icon_merges_like_color_through_all_three_layers() {
    let m = meta(
        "\
[defaults]
icon = \"🐧\"

[presets.p]
icon = \"🐳\"

[hosts.a]
preset = \"p\"

[hosts.b]
preset = \"p\"
icon = \"🚀\"

[hosts.c]
color = \"#000000\"
",
    );
    // preset 이 defaults 를 이기고, hosts 가 preset 을 이긴다.
    assert_eq!(m.resolve("a").icon.as_deref(), Some("🐳"));
    assert_eq!(m.resolve("b").icon.as_deref(), Some("🚀"));
    // 어느 항목도 icon 을 덮지 않으면 defaults 가 항목 없는 호스트까지 내려간다.
    assert_eq!(m.resolve("c").icon.as_deref(), Some("🐧"));
    assert_eq!(m.resolve("전혀-모르는-호스트").icon.as_deref(), Some("🐧"));
    // 아무 데도 안 적혀 있으면 None.
    assert_eq!(SessionsMeta::default().resolve("x").icon, None);
    // 원본 읽기는 병합하지 않는다 (폼 프리필).
    assert_eq!(m.raw_host("c").icon, None);
    assert_eq!(m.raw_host("b").icon.as_deref(), Some("🚀"));
}

/// 아이콘 패치는 color 와 똑같이 키를 쓰고, 빈/공백 문자열이면 키를 지운다.
#[test]
fn icon_is_written_and_a_blank_string_removes_the_key() {
    // 값이 있으면 `icon = "🐧"` 가 적힌다.
    let p = HostMetaPatch {
        icon: Some("🐧".into()),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &p).unwrap();
    assert_eq!(after, "[hosts.web]\nicon = \"🐧\"\n");
    assert_eq!(reread(&after, "web").icon.as_deref(), Some("🐧"));

    // 공백만 있는 문자열 = 지우기 (color 와 같은 규칙). 다른 키가 없으면 테이블째 사라진다.
    let blank = HostMetaPatch {
        icon: Some("   ".into()),
        ..HostMetaPatch::default()
    };
    assert_eq!(patch_document(&after, "web", &blank).unwrap(), "");

    // 다른 키가 남아 있으면 테이블은 살아 있고 icon 만 사라진다 (빈 문자열).
    let mixed = HostMetaPatch {
        color: Some("#c25b4a".into()),
        icon: Some("".into()),
        ..HostMetaPatch::default()
    };
    let after = patch_document(
        "[hosts.web]\ncolor = \"#000000\"\nicon = \"🐧\"\n",
        "web",
        &mixed,
    )
    .unwrap();
    assert_eq!(after, "[hosts.web]\ncolor = \"#c25b4a\"\n");
}

/// `is_all_empty` 가 icon 을 센다 — icon 만 있는 저장이 "전부 지우기" 로 오인되면 테이블이
/// 만들어지지 않으므로, 테이블이 실제로 생기는 것으로 카운트를 못 박는다.
#[test]
fn icon_only_patch_is_not_treated_as_empty() {
    let p = HostMetaPatch {
        icon: Some("🐧".into()),
        ..HostMetaPatch::default()
    };
    let after = patch_document("[defaults]\ncolor = \"#8a8a8a\"\n", "web", &p).unwrap();
    assert!(after.contains("[hosts.web]\nicon = \"🐧\"\n"), "{after}");
}

/// 셸 통합 옵트아웃도 **다른 키와 똑같은** 3계층 병합이다 — 특별 취급은 없다.
/// (`[defaults] shell_integration = false` 로 전체 기본을 끄는 것도 이 규칙의 따름정리다.)
#[test]
fn shell_integration_merges_like_every_other_key() {
    let m = meta(
        "\
[defaults]
shell_integration = false

[presets.p]
shell_integration = true

[hosts.a]
preset = \"p\"

[hosts.b]
preset = \"p\"
shell_integration = false

[hosts.c]
color = \"#000000\"
",
    );
    // preset 이 defaults 를 이기고, hosts 가 preset 을 이긴다.
    assert_eq!(m.resolve("a").shell_integration, Some(true));
    assert_eq!(m.resolve("b").shell_integration, Some(false));
    // defaults 로 전체를 끈 것이 항목 없는 호스트까지 내려간다.
    assert_eq!(m.resolve("c").shell_integration, Some(false));
    assert_eq!(
        m.resolve("전혀-모르는-호스트").shell_integration,
        Some(false)
    );
    // 아무 데도 안 적혀 있으면 None = 현행(주입한다). ssh.rs 는 None 과 Some(true) 를 같게 본다.
    assert_eq!(SessionsMeta::default().resolve("x").shell_integration, None);
    // 원본 읽기는 병합하지 않는다 (폼 프리필).
    assert_eq!(m.raw_host("c").shell_integration, None);
    assert_eq!(m.raw_host("b").shell_integration, Some(false));
}

/// 3값 select 의 계약: `기본` = 키 삭제 · `켬` = `true` · `끔` = **`false` 를 적는다**.
/// `log` 의 "해제 = 삭제" 규칙과 다른 유일한 칸이라 왕복까지 못 박는다.
#[test]
fn shell_integration_writes_false_instead_of_removing_the_key() {
    let off = HostMetaPatch {
        shell_integration: Some(false),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &off).unwrap();
    assert_eq!(after, "[hosts.web]\nshell_integration = false\n");
    // 적힌 false 가 그대로 다시 읽힌다 (= 상속을 이 호스트에서 끊는다).
    assert_eq!(reread(&after, "web").shell_integration, Some(false));

    // `켬` 은 true 를 적는다 — 상위 계층이 꺼 놨어도 이 호스트만 켜진다.
    let on = HostMetaPatch {
        shell_integration: Some(true),
        ..HostMetaPatch::default()
    };
    let after = patch_document(&after, "web", &on).unwrap();
    assert_eq!(after, "[hosts.web]\nshell_integration = true\n");

    // `기본` 은 키를 지운다 — 다른 키가 없으면 테이블째 사라진다.
    assert_eq!(
        patch_document(&after, "web", &HostMetaPatch::default()).unwrap(),
        ""
    );
}

/// 끄기 저장이 다른 칸을 건드리지 않는지 (한 폼에서 함께 나가는 값들이다).
#[test]
fn shell_integration_off_leaves_the_other_keys_alone() {
    let before = "[hosts.web]\ncolor = \"#c25b4a\"\nidentity = \"~/.ssh/id_prod\"\n";
    let p = HostMetaPatch {
        color: Some("#c25b4a".into()),
        shell_integration: Some(false),
        ..HostMetaPatch::default()
    };
    let after = patch_document(before, "web", &p).unwrap();
    assert_eq!(
        after,
        "[hosts.web]\ncolor = \"#c25b4a\"\nidentity = \"~/.ssh/id_prod\"\nshell_integration = false\n"
    );
    let raw = reread(&after, "web");
    assert_eq!(raw.color.as_deref(), Some("#c25b4a"));
    assert_eq!(raw.shell_integration, Some(false));
}

// ── tmux 로 접속 (호스트별 토글 · docs/log/2026-09-16-tmux-toggle.md) ─────

/// 다른 키와 **완전히 같은 3계층 병합**이다 — 새 키가 특별한 규칙을 갖지 않는다는 못.
#[test]
fn tmux_merges_like_every_other_key() {
    let m = meta(
        "\
[defaults]
tmux = true

[presets.p]
tmux = false

[hosts.a]
preset = \"p\"

[hosts.b]
preset = \"p\"
tmux = true
",
    );
    // preset 이 defaults 를 이긴다.
    assert_eq!(m.resolve("a").tmux, Some(false));
    // 호스트가 preset 을 이긴다.
    assert_eq!(m.resolve("b").tmux, Some(true));
    // 항목 없는 호스트에도 defaults 가 내려간다.
    assert_eq!(m.resolve("전혀-모르는-호스트").tmux, Some(true));
    // 아무 데도 안 적혀 있으면 None = 꺼짐 (`ssh.rs` 가 `unwrap_or(false)`).
    assert_eq!(SessionsMeta::default().resolve("x").tmux, None);
    // 원본 읽기는 병합하지 않는다 (폼 프리필).
    assert_eq!(m.raw_host("a").tmux, None);
    assert_eq!(m.raw_host("b").tmux, Some(true));
}

/// 체크박스 왕복: 켜면 `tmux = true` 가 적히고, 끄면 **키가 사라진다**(`log` 와 같은 규칙).
#[test]
fn tmux_writes_true_and_unchecking_removes_the_key() {
    let on = HostMetaPatch {
        tmux: Some(true),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &on).unwrap();
    assert_eq!(after, "[hosts.web]\ntmux = true\n");
    assert_eq!(reread(&after, "web").tmux, Some(true));

    // 해제 = "끔" 이 아니라 "안 적음" — 다른 키가 없으면 테이블째 사라진다.
    let off = HostMetaPatch {
        tmux: Some(false),
        ..HostMetaPatch::default()
    };
    assert_eq!(patch_document(&after, "web", &off).unwrap(), "");
    // `None`(폼이 값을 안 보냄)도 같다.
    assert_eq!(
        patch_document(&after, "web", &HostMetaPatch::default()).unwrap(),
        ""
    );
}

/// 한 폼에서 함께 나가는 값이라, 켜기 저장이 이웃 키를 건드리면 안 된다.
#[test]
fn tmux_on_leaves_the_other_keys_alone() {
    let before = "[hosts.web]\ncolor = \"#c25b4a\"\nidentity = \"~/.ssh/id_prod\"\n";
    let p = HostMetaPatch {
        color: Some("#c25b4a".into()),
        tmux: Some(true),
        ..HostMetaPatch::default()
    };
    let after = patch_document(before, "web", &p).unwrap();
    assert_eq!(
        after,
        "[hosts.web]\ncolor = \"#c25b4a\"\nidentity = \"~/.ssh/id_prod\"\ntmux = true\n"
    );
    let raw = reread(&after, "web");
    assert_eq!(raw.color.as_deref(), Some("#c25b4a"));
    assert_eq!(raw.tmux, Some(true));
}

// ── 에이전트 포워딩 덮어쓰기 (docs/log/2026-09-23-agent-forwarding.md) ─────

/// 세 값 왕복: `true`·`false` 는 **그대로 적히고**, `None` 은 키를 지운다(= config 를 따른다).
#[test]
fn forward_agent_round_trips_true_false_and_none() {
    for v in [true, false] {
        let p = HostMetaPatch {
            forward_agent: Some(v),
            ..HostMetaPatch::default()
        };
        let after = patch_document("", "web", &p).unwrap();
        assert_eq!(
            after,
            format!(
                "[hosts.web]
forward_agent = {v}
"
            )
        );
        assert_eq!(reread(&after, "web").forward_agent, Some(v));
        assert_eq!(meta(&after).resolve("web").forward_agent, Some(v));
        // 비우면 키가 사라진다 — 다른 키가 없으면 테이블째.
        assert_eq!(
            patch_document(&after, "web", &HostMetaPatch::default()).unwrap(),
            ""
        );
    }
    assert_eq!(SessionsMeta::default().resolve("x").forward_agent, None);
}

// ── 에이전트 활성화 (옛 원격 훅 자동 설치 — 2026-10-26) ─────

/// 기본은 끔(`None`) · `true` · `false` 를 그대로 적고 `None` 은 키 삭제 · 다시 읽으면 같은 값 · 상속한다.
#[test]
fn agent_defaults_off_and_round_trips() {
    assert_eq!(SessionsMeta::default().resolve("x").agent, None);
    let on = HostMetaPatch {
        agent: Some(true),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &on).unwrap();
    assert_eq!(after, "[hosts.web]
agent = true
");
    assert_eq!(reread(&after, "web").agent, Some(true));
    assert_eq!(meta(&after).resolve("web").agent, Some(true));
    // 위 계층의 켬을 덮는 끔은 그대로 적힌다.
    let off = HostMetaPatch {
        agent: Some(false),
        ..HostMetaPatch::default()
    };
    assert_eq!(patch_document(&after, "web", &off).unwrap(), "[hosts.web]
agent = false
");
    assert_eq!(patch_document(&after, "web", &HostMetaPatch::default()).unwrap(), "");
    // `[defaults]` 에서 켜면 호스트가 물려받는다(셸 통합과 같은 칸).
    let m = meta("[defaults]
agent = true
");
    assert_eq!(m.resolve("아무-호스트").agent, Some(true));
}

/// 옛 키 `remote_hooks` 는 같은 뜻으로 읽고(같은 블록에 `agent` 가 있으면 그것이 이긴다), 저장은 새 키로 옮긴다.
#[test]
fn legacy_remote_hooks_reads_as_agent_and_is_rewritten() {
    let m = meta("[defaults]
remote_hooks = false

[hosts.a]
remote_hooks = false
agent = true
");
    assert_eq!(m.resolve("b").agent, Some(false), "옛 키도 상속한다");
    assert_eq!(m.resolve("a").agent, Some(true), "같은 블록에서는 새 키가 이긴다");
    // 패치의 옛 이름도 받는다(serde 별칭).
    let p: HostMetaPatch = serde_json::from_str(r#"{"remote_hooks": false}"#).unwrap();
    assert_eq!(p.agent, Some(false));
    let after = patch_document("[hosts.web]\nremote_hooks = false\n", "web", &p).unwrap();
    assert_eq!(after, "[hosts.web]\nagent = false\n");
    assert_eq!(
        patch_document("[hosts.web]\nremote_hooks = false\n", "web", &HostMetaPatch::default()).unwrap(),
        "",
        "상속으로 저장하면 옛 키도 함께 사라진다"
    );
}

/// 추가 인자는 **키별로** 상속하고(빈 문자열 = 붙이지 않음으로 덮음) 출처를 남긴다.
#[test]
fn agent_args_inherit_per_key_with_sources() {
    let m = meta(
        r#"[defaults.agent_args]
claude = "--model opus"
codex = "--yolo"

[presets.lab]
agent_args = { codex = "-c model='o3'" }

[hosts.a]
preset = "lab"

[hosts.b]
preset = "lab"
agent_args = { claude = "" }
"#,
    );
    let a = m.resolve("a");
    assert_eq!(a.agent_args.get("claude").map(String::as_str), Some("--model opus"));
    assert_eq!(a.agent_args.get("codex").map(String::as_str), Some("-c model='o3'"));
    assert_eq!(a.agent_args_from.get("claude"), Some(&MetaLayer::Defaults));
    assert_eq!(a.agent_args_from.get("codex"), Some(&MetaLayer::Preset("lab".into())));
    let b = m.resolve("b");
    assert_eq!(b.agent_args.get("claude").map(String::as_str), Some(""), "빈 문자열이 위를 덮는다");
    assert_eq!(b.agent_args_from.get("claude"), None, "자기 값은 출처가 없다");
    // 원본 읽기는 자기 블록만.
    assert_eq!(m.raw_host("a").agent_args, BTreeMap::new());
    assert_eq!(m.raw_host("b").agent_args.get("claude").map(String::as_str), Some(""));
}

/// 저장은 인라인 테이블 하나 · 빈 문자열도 적힌다 · 빈 맵은 키 삭제 · 규칙에 어긋나면 한 글자도 쓰지 않는다.
#[test]
fn agent_args_write_validates_and_keeps_empty_overrides() {
    let p = HostMetaPatch {
        agent_args: Some(BTreeMap::from([
            ("claude".to_string(), " --model opus ".to_string()),
            ("codex".to_string(), String::new()),
        ])),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &p).unwrap();
    assert_eq!(after, "[hosts.web]\nagent_args = { claude = \"--model opus\", codex = \"\" }\n");
    assert_eq!(reread(&after, "web").agent_args.get("codex").map(String::as_str), Some(""));
    let cleared = HostMetaPatch {
        agent_args: Some(BTreeMap::new()),
        ..HostMetaPatch::default()
    };
    assert_eq!(patch_document(&after, "web", &cleared).unwrap(), "");
    for (id, line) in [("claude", "a; rm -rf /"), ("codex", "\"x"), ("gemini", "--x")] {
        let bad = HostMetaPatch {
            agent_args: Some(BTreeMap::from([(id.to_string(), line.to_string())])),
            ..HostMetaPatch::default()
        };
        assert!(patch_document(&after, "web", &bad).is_err(), "{id} {line}");
    }
}

/// `forwards` 와 같이 **상속하지 않는다** — `[defaults]`·preset 에 적으면 무시하고 경고.
#[test]
fn forward_agent_is_never_inherited() {
    let (m, warnings) = SessionsMeta::parse(
        "[defaults]
forward_agent = true

[presets.lab]
forward_agent = true

[hosts.a]
preset = \"lab\"
",
    );
    assert_eq!(m.resolve("a").forward_agent, None);
    assert_eq!(m.resolve("아무-호스트").forward_agent, None);
    assert_eq!(
        warnings
            .iter()
            .filter(|w| w.contains("forward_agent"))
            .count(),
        2,
        "{warnings:?}"
    );
}

#[test]
fn group_is_a_plain_path_string() {
    let m = meta("[hosts.web]\ngroup = \"prod/web/edge\"\n");
    assert_eq!(m.resolve("web").group.as_deref(), Some("prod/web/edge"));
}

#[test]
fn quoted_host_keys_with_dots_work() {
    // 별칭에 점이 있으면 TOML 에서 따옴표로 감싸야 한 덩어리로 읽힌다.
    let m = meta("[hosts.\"web.example.com\"]\ncolor = \"#c25b4a\"\n");
    assert_eq!(
        m.resolve("web.example.com").color.as_deref(),
        Some("#c25b4a")
    );
}

/// docs/log/2026-08-31-sessions-meta.md 의 "시험용 예시 파일" 을 그대로 옮긴 것.
/// 문서에 적어 둔 예시가 실제로 파싱되는지 붙들어 둔다 (사용자가 복사해 쓰는 내용이다).
#[test]
fn documented_example_parses_cleanly() {
    let m = meta(
        r##"
[defaults]
color = "#8a8a8a"
scrollback = 5000

[presets.prod]
identity = "~/.ssh/id_prod"
on_connect = "cd /srv/app"

[presets.lab]
scrollback = 20000

[hosts.web-01]
group = "prod/web"
preset = "prod"
color = "#c25b4a"
tags = ["web", "nginx"]

[hosts.web-02]
group = "prod/web"
preset = "prod"
color = "#c25b4a"
tags = ["web", "nginx", "canary", "asia"]

[hosts.db-01]
group = "prod/db"
preset = "prod"
color = "#4a7fc2"
tags = ["postgres"]

[hosts.sandbox]
preset = "lab"
color = "#5aa469"

[hosts."내 서버"]
color = "#b08a3c"
"##,
    );

    let web = m.resolve("web-02");
    assert_eq!(web.group.as_deref(), Some("prod/web"));
    assert_eq!(web.tags.len(), 4); // 사이드바가 3개 + "+1" 로 접는 경우
    assert_eq!(web.scrollback, Some(5000)); // defaults
    assert_eq!(web.identity.as_deref(), Some("~/.ssh/id_prod")); // preset

    let sandbox = m.resolve("sandbox");
    assert!(sandbox.group.is_none()); // 머리글 없이 맨 위에 평평하게
    assert_eq!(sandbox.scrollback, Some(20000)); // preset 이 defaults 를 이긴다

    assert_eq!(m.resolve("내 서버").color.as_deref(), Some("#b08a3c"));
}

#[test]
fn serializes_to_json_with_expected_field_names() {
    let m = meta(
        "[hosts.web]\ncolor = \"#c25b4a\"\ngroup = \"prod\"\ntags = [\"a\"]\non_connect = \"ls\"\n",
    );
    let json = serde_json::to_string(&m.resolve("web")).unwrap();
    assert!(json.contains("\"color\":\"#c25b4a\""), "{json}");
    assert!(json.contains("\"group\":\"prod\""), "{json}");
    assert!(json.contains("\"tags\":[\"a\"]"), "{json}");
    assert!(json.contains("\"on_connect\":\"ls\""), "{json}");
    // 비어 있는 값은 null 로 나간다 (프런트 계약: 필드는 항상 존재한다).
    assert!(json.contains("\"icon\":null"), "{json}");
    assert!(json.contains("\"identity\":null"), "{json}");
    assert!(json.contains("\"scrollback\":null"), "{json}");
    assert!(json.contains("\"log\":null"), "{json}");
    assert!(json.contains("\"shell_integration\":null"), "{json}");
}

// ------------------------------------------------------------------
// 원본 값 읽기 (병합 아님)
// ------------------------------------------------------------------

#[test]
fn raw_host_returns_only_the_host_table_never_the_merged_result() {
    let m = meta(
        r##"
[defaults]
color = "#8a8a8a"
scrollback = 5000

[presets.prod]
on_connect = "cd /srv/app"

[hosts.web]
preset = "prod"
group = "prod/web"
"##,
    );

    // 병합 결과에는 defaults·preset 값이 올라온다.
    let merged = m.resolve("web");
    assert_eq!(merged.color.as_deref(), Some("#8a8a8a"));
    assert_eq!(merged.scrollback, Some(5000));
    assert_eq!(merged.on_connect.as_deref(), Some("cd /srv/app"));

    // 원본에는 이 호스트 테이블에 적힌 것만 있다 — 폼은 이쪽으로 채워야 상속이 안 끊긴다.
    let raw = m.raw_host("web");
    assert_eq!(raw.group.as_deref(), Some("prod/web"));
    assert_eq!(raw.color, None);
    assert_eq!(raw.scrollback, None);
    assert_eq!(raw.on_connect, None);
    assert!(raw.tags.is_empty());

    // 항목이 없는 호스트는 defaults 가 있어도 전부 빈 값이다.
    assert_eq!(m.raw_host("없는호스트"), HostMeta::default());
    // 별칭 매칭은 읽기와 같은 규칙(대소문자 무시).
    assert_eq!(m.raw_host("WEB").group.as_deref(), Some("prod/web"));
}

// ------------------------------------------------------------------
// 쓰기 (toml_edit 국소 편집)
// ------------------------------------------------------------------

fn patch(color: Option<&str>, group: Option<&str>) -> HostMetaPatch {
    HostMetaPatch {
        color: color.map(str::to_string),
        group: group.map(str::to_string),
        ..HostMetaPatch::default()
    }
}

/// 저장 결과가 다시 읽힐 때 기대한 값이 나오는지 (쓰기 ↔ 파서 왕복).
fn reread(content: &str, name: &str) -> HostMeta {
    let (m, w) = SessionsMeta::parse(content);
    assert!(w.is_empty(), "저장 결과에 경고가 생겼다: {w:?}");
    m.raw_host(name)
}

#[test]
fn write_preserves_comments_other_tables_and_key_order() {
    let before = r##"# 사람이 손으로 적은 머리 주석
# 두 줄짜리

[defaults]
color = "#8a8a8a"   # 기본 회색
scrollback = 5000

[presets.prod]
on_connect = "cd /srv/app"

[hosts.web]
# 이 호스트만 빨강
preset  =  "prod"
color = "#c25b4a"
tags = ["web"]

[hosts.db]
color = "#4a7fc2"
"##;

    let after = patch_document(before, "web", &patch(Some("#00ff00"), Some("prod/web"))).unwrap();

    // 우리 키만 바뀐다 — 주석·다른 테이블·이상한 공백까지 그대로.
    assert!(
        after.contains("# 사람이 손으로 적은 머리 주석\n# 두 줄짜리\n"),
        "{after}"
    );
    assert!(
        after.contains("color = \"#8a8a8a\"   # 기본 회색\n"),
        "{after}"
    );
    assert!(
        after.contains("[presets.prod]\non_connect = \"cd /srv/app\"\n"),
        "{after}"
    );
    assert!(
        after.contains("[hosts.db]\ncolor = \"#4a7fc2\"\n"),
        "{after}"
    );
    assert!(
        after.contains("# 이 호스트만 빨강\npreset  =  \"prod\"\n"),
        "{after}"
    );
    // 색은 제자리에서 값만 바뀌고, 폼에서 비운 tags 는 사라지고, group 이 새로 붙는다.
    assert!(after.contains("color = \"#00ff00\"\n"), "{after}");
    assert!(!after.contains("tags"), "{after}");
    assert!(after.contains("group = \"prod/web\"\n"), "{after}");

    // 다시 파싱하면 방금 쓴 값이 그대로 나온다.
    let raw = reread(&after, "web");
    assert_eq!(raw.color.as_deref(), Some("#00ff00"));
    assert_eq!(raw.group.as_deref(), Some("prod/web"));
    assert!(raw.tags.is_empty());
    // preset 은 폼에 없는 키라 손대지 않았다 → 병합은 그대로 산다.
    let (m, _) = SessionsMeta::parse(&after);
    assert_eq!(m.resolve("web").on_connect.as_deref(), Some("cd /srv/app"));
}

#[test]
fn write_keeps_a_trailing_comment_on_the_edited_line() {
    let before = "[hosts.web]\ncolor = \"#c25b4a\"  # 사내망 표시색\n";
    let after = patch_document(before, "web", &patch(Some("#000000"), None)).unwrap();
    assert_eq!(after, "[hosts.web]\ncolor = \"#000000\"  # 사내망 표시색\n");
}

#[test]
fn write_updates_an_existing_value_of_every_kind() {
    let before = r##"[hosts.web]
color = "#c25b4a"
group = "old"
tags = ["a"]
scrollback = 100
on_connect = "ls"
"##;
    let p = HostMetaPatch {
        color: Some("#111111".into()),
        icon: None,
        group: Some("new/group".into()),
        tags: Some(vec!["x".into(), "y".into()]),
        scrollback: Some(20000),
        on_connect: Some("tmux new -A -s main".into()),
        log: None,
        shell_integration: None,
        tmux: None,
        forwards: None,
        forward_agent: None,
        agent: None,
        agent_args: None,
    };
    let after = patch_document(before, "web", &p).unwrap();

    assert_eq!(
        after,
        r##"[hosts.web]
color = "#111111"
group = "new/group"
tags = ["x", "y"]
scrollback = 20000
on_connect = "tmux new -A -s main"
"##
    );

    let raw = reread(&after, "web");
    assert_eq!(raw.tags, vec!["x".to_string(), "y".to_string()]);
    assert_eq!(raw.scrollback, Some(20000));
    assert_eq!(raw.on_connect.as_deref(), Some("tmux new -A -s main"));
}

#[test]
fn write_adds_a_new_host_table_at_the_end() {
    let before = "[defaults]\ncolor = \"#8a8a8a\"\n\n[hosts.web]\ncolor = \"#c25b4a\"\n";
    let after = patch_document(before, "db-01", &patch(Some("#4a7fc2"), None)).unwrap();

    assert!(
        after.starts_with(before),
        "기존 내용이 그대로 앞에 있어야 한다: {after}"
    );
    assert!(
        after.contains("[hosts.db-01]\ncolor = \"#4a7fc2\"\n"),
        "{after}"
    );
    assert_eq!(reread(&after, "db-01").color.as_deref(), Some("#4a7fc2"));
}

#[test]
fn write_creates_the_hosts_table_without_an_explicit_header() {
    // hosts 섹션이 아예 없던 파일 — `[hosts]` 빈 헤더를 만들지 않는다.
    let after = patch_document(
        "[defaults]\ncolor = \"#8a8a8a\"\n",
        "web",
        &patch(Some("#c25b4a"), None),
    )
    .unwrap();
    assert!(!after.contains("[hosts]"), "{after}");
    assert!(after.contains("[hosts.web]"), "{after}");
}

#[test]
fn empty_strings_and_empty_tags_remove_the_key() {
    let before = "[hosts.web]\ncolor = \"#c25b4a\"\ngroup = \"prod\"\ntags = [\"a\"]\non_connect = \"ls\"\nscrollback = 100\npreset = \"prod\"\n";
    let p = HostMetaPatch {
        color: Some("   ".into()),                // 공백만 = 지우기
        icon: Some("  ".into()),                  // 공백만 = 지우기
        group: Some("".into()),                   // 빈 문자열 = 지우기
        tags: Some(vec!["".into(), "  ".into()]), // 빈 항목만 = 지우기
        scrollback: Some(0),                      // 0 = 지우기
        on_connect: None,                         // 아예 없음 = 지우기
        log: Some(false),                         // 체크 해제 = 지우기
        shell_integration: None,                  // select 의 "기본" = 지우기
        tmux: Some(false),                        // 체크 해제 = 지우기 (`log` 와 같은 규칙)
        forwards: Some(Vec::new()),               // 빈 목록 = 지우기 (`tags` 와 같은 규칙)
        forward_agent: None,                      // 덮어쓰기 없음 = 지우기 (config 를 따른다)
        agent: None,                              // 상속 = 지우기 (기본 끔)
        agent_args: Some(BTreeMap::new()),        // 빈 맵 = 지우기
    };
    let before = format!(
        "{before}forward_agent = true
remote_hooks = false
"
    );
    let after = patch_document(&before, "web", &p).unwrap();

    // 우리 키는 전부 사라지고, 폼에 없는 preset 만 남아 테이블은 살아 있다.
    assert_eq!(after, "[hosts.web]\npreset = \"prod\"\n");
    assert_eq!(
        SessionsMeta::parse(&after).0.raw_host("web"),
        HostMeta::default()
    );
}

#[test]
fn tags_are_trimmed_and_blank_entries_dropped() {
    let p = HostMetaPatch {
        tags: Some(vec![" web ".into(), "".into(), "nginx".into()]),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &p).unwrap();
    assert_eq!(after, "[hosts.web]\ntags = [\"web\", \"nginx\"]\n");
}

// ── 포트 포워딩 프리셋 (docs/log/2026-09-17-forward-presets.md) ─────────────

fn fw(local: u16, host: &str, remote: u16) -> ForwardPreset {
    ForwardPreset {
        kind: crate::port_forward::ForwardKind::Local,
        local_port: local,
        remote_host: host.into(),
        remote_port: remote,
    }
}

fn fw_remote(local: u16, remote: u16) -> ForwardPreset {
    ForwardPreset {
        kind: crate::port_forward::ForwardKind::Remote,
        local_port: local,
        remote_host: String::new(),
        remote_port: remote,
    }
}

fn fw_dynamic(local: u16) -> ForwardPreset {
    ForwardPreset {
        kind: crate::port_forward::ForwardKind::Dynamic,
        local_port: local,
        remote_host: String::new(),
        remote_port: 0,
    }
}

/// 원격·동적은 `kind` 를 적고 **쓰지 않는 칸을 뺀다** — 그리고 그대로 다시 읽힌다.
#[test]
fn remote_and_dynamic_forwards_round_trip() {
    let p = HostMetaPatch {
        forwards: Some(vec![fw_remote(18080, 18081), fw_dynamic(1080)]),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &p).unwrap();
    assert_eq!(
        after,
        "[hosts.web]\nforwards = [{ kind = \"remote\", local_port = 18080, remote_port = 18081 }, \
             { kind = \"dynamic\", local_port = 1080 }]\n"
    );
    assert_eq!(
        reread(&after, "web").forwards,
        vec![fw_remote(18080, 18081), fw_dynamic(1080)]
    );
}

/// 감춘 칸에 남은 값(원격의 호스트 · 동적의 원격 포트)은 저장 전에 비워진다.
#[test]
fn unused_fields_are_cleared_on_save() {
    let mut stale_remote = fw_remote(18080, 18081);
    stale_remote.remote_host = "localhost".into();
    let mut stale_dynamic = fw_dynamic(1080);
    stale_dynamic.remote_port = 5432;
    assert_eq!(
        validate_forwards(&[stale_remote, stale_dynamic]).unwrap(),
        vec![fw_remote(18080, 18081), fw_dynamic(1080)]
    );
}

/// 겹침은 **같은 자리**끼리만: 로컬·동적은 내 PC 포트, 원격은 서버 포트.
#[test]
fn duplicate_slots_depend_on_kind() {
    // 로컬 15432 와 원격(서버 15432) 은 다른 자리다.
    assert!(validate_forwards(&[fw(15432, "localhost", 5432), fw_remote(3000, 15432)]).is_ok());
    // 원격 둘이 같은 로컬 포트로 이어 주는 것도 괜찮다 (듣는 자리가 서버의 두 포트다).
    assert!(validate_forwards(&[fw_remote(3000, 18080), fw_remote(3000, 18081)]).is_ok());
    // 로컬 1080 과 동적 1080 은 내 PC 의 같은 리스너다.
    let err = validate_forwards(&[fw(1080, "localhost", 80), fw_dynamic(1080)]).unwrap_err();
    assert!(err.contains("로컬 포트 1080"), "{err}");
    // 원격 둘이 같은 서버 포트.
    let err = validate_forwards(&[fw_remote(3000, 18080), fw_remote(3001, 18080)]).unwrap_err();
    assert!(err.contains("원격 포트 18080"), "{err}");
}

/// 쓴 모양이 그대로 다시 읽힌다 (인라인 테이블의 배열).
#[test]
fn forwards_round_trip_as_an_inline_array() {
    let p = HostMetaPatch {
        forwards: Some(vec![
            fw(15432, "localhost", 5432),
            fw(18080, "127.0.0.1", 8080),
        ]),
        ..HostMetaPatch::default()
    };
    let after = patch_document("", "web", &p).unwrap();
    assert_eq!(
        after,
        "[hosts.web]\nforwards = [{ local_port = 15432, remote_host = \"localhost\", remote_port = 5432 }, \
             { local_port = 18080, remote_host = \"127.0.0.1\", remote_port = 8080 }]\n"
    );

    let raw = reread(&after, "web");
    assert_eq!(
        raw.forwards,
        vec![fw(15432, "localhost", 5432), fw(18080, "127.0.0.1", 8080)]
    );
}

/// 사람이 **배열 오브 테이블**로 적어 둔 것도 그대로 읽힌다 (serde 는 표기를 가리지 않는다).
#[test]
fn forwards_also_parse_from_array_of_tables() {
    let m = meta(
        "[[hosts.web.forwards]]\nlocal_port = 15432\nremote_host = \"localhost\"\nremote_port = 5432\n",
    );
    assert_eq!(
        m.raw_host("web").forwards,
        vec![fw(15432, "localhost", 5432)]
    );
}

/// 명령 계약을 못 박는다: **부분 패치는 나머지 칸을 지운다**(전체 교체 — `set_host_meta` 머리말).
/// 2026-09-24 실기 발견 ⑥ — `{tmux:true}` 하나가 icon·group 을 지웠다. 이 테스트가 깨지면 계약이
/// 바뀐 것이니 명령의 문서와 호스트 폼을 함께 본다.
#[test]
fn a_partial_patch_replaces_the_whole_block() {
    let before = "[hosts.dev-01]\nicon = \"ubuntu\"\ngroup = \"lab\"\n";
    let p = HostMetaPatch {
        tmux: Some(true),
        ..HostMetaPatch::default()
    };
    let after = patch_document(before, "dev-01", &p).unwrap();
    let raw = reread(&after, "dev-01");
    assert_eq!(raw.tmux, Some(true));
    assert_eq!(raw.icon, None, "부분 패치는 icon 을 지운다");
    assert_eq!(raw.group, None, "부분 패치는 group 을 지운다");
}

/// 빈 목록은 `tags` 와 같이 **키를 지운다** (값이 `[]` 로 남지 않는다).
#[test]
fn empty_forwards_remove_the_key() {
    let before = "[hosts.web]\ncolor = \"#c25b4a\"\nforwards = [{ local_port = 15432, remote_host = \"localhost\", remote_port = 5432 }]\n";
    let p = HostMetaPatch {
        color: Some("#c25b4a".into()),
        forwards: Some(Vec::new()),
        ..HostMetaPatch::default()
    };
    let after = patch_document(before, "web", &p).unwrap();
    assert_eq!(after, "[hosts.web]\ncolor = \"#c25b4a\"\n");
    assert!(reread(&after, "web").forwards.is_empty());
}

/// 같은 로컬 포트가 두 번이면 **파일에 한 글자도 닿지 않는다.**
#[test]
fn duplicate_local_port_is_rejected_and_writes_nothing() {
    let before = "[hosts.web]\ncolor = \"#c25b4a\"\n";
    let p = HostMetaPatch {
        forwards: Some(vec![
            fw(15432, "localhost", 5432),
            fw(15432, "localhost", 6379),
        ]),
        ..HostMetaPatch::default()
    };
    let err = patch_document(before, "web", &p).unwrap_err();
    assert!(err.contains("15432"), "{err}");
    // 원본 파일은 그대로다 — 검증이 `normalize` 안에서 먼저 돈다.
    assert_eq!(reread(before, "web").color.as_deref(), Some("#c25b4a"));
}

/// 검증은 `port_forward::validate` 그대로다 — 포트 0·빈 호스트·가운데 공백.
#[test]
fn forward_validation_reuses_port_forward_rules() {
    assert!(validate_forwards(&[fw(0, "localhost", 5432)])
        .unwrap_err()
        .contains("로컬 포트"));
    assert!(validate_forwards(&[fw(15432, "localhost", 0)])
        .unwrap_err()
        .contains("원격 포트"));
    assert!(validate_forwards(&[fw(15432, "  ", 5432)])
        .unwrap_err()
        .contains("원격 호스트"));
    assert!(validate_forwards(&[fw(15432, "db 01", 5432)])
        .unwrap_err()
        .contains("공백"));
    // 앞뒤 공백은 다듬어 저장한다.
    assert_eq!(
        validate_forwards(&[fw(15432, " db.internal ", 5432)]).unwrap(),
        vec![fw(15432, "db.internal", 5432)]
    );
}

/// **상속이 없다** — `[defaults]`·프리셋에 적힌 forwards 는 무시되고 경고가 뜬다.
#[test]
fn forwards_do_not_inherit_from_defaults_or_presets() {
    let (m, warnings) = SessionsMeta::parse(
        r##"
[defaults]
forwards = [{ local_port = 1111, remote_host = "localhost", remote_port = 1 }]

[presets.prod]
forwards = [{ local_port = 2222, remote_host = "localhost", remote_port = 2 }]

[hosts.a]
preset = "prod"

[hosts.b]
preset = "prod"
forwards = [{ local_port = 15432, remote_host = "localhost", remote_port = 5432 }]
"##,
    );
    // 위 두 계층은 **아무 호스트에도 닿지 않는다**.
    assert!(m.resolve("a").forwards.is_empty());
    assert_eq!(m.resolve("b").forwards, vec![fw(15432, "localhost", 5432)]);
    // 조용히 무시하지 않는다 — 적어 둔 사람에게 두 줄로 말한다.
    assert_eq!(warnings.len(), 2, "{warnings:?}");
    assert!(
        warnings.iter().all(|w| w.contains("forwards")),
        "{warnings:?}"
    );
}

/// 프런트 계약 — `forwards` 는 값이 없어도 **빈 배열**로 나간다 (`tags` 와 같다).
#[test]
fn forwards_serialize_as_an_array_even_when_absent() {
    let json =
        serde_json::to_string(&meta("[hosts.web]\ncolor = \"#c25b4a\"\n").resolve("web")).unwrap();
    assert!(json.contains("\"forwards\":[]"), "{json}");
}

#[test]
fn clearing_every_key_removes_the_whole_host_table() {
    let before = "[defaults]\ncolor = \"#8a8a8a\"\n\n[hosts.web]\ncolor = \"#c25b4a\"\ntags = [\"a\"]\n\n[hosts.db]\ncolor = \"#4a7fc2\"\n";
    let after = patch_document(before, "web", &HostMetaPatch::default()).unwrap();

    assert!(!after.contains("[hosts.web]"), "{after}");
    // 옆 테이블과 defaults 는 멀쩡하다.
    assert!(
        after.contains("[defaults]\ncolor = \"#8a8a8a\"\n"),
        "{after}"
    );
    assert!(
        after.contains("[hosts.db]\ncolor = \"#4a7fc2\"\n"),
        "{after}"
    );
    assert_eq!(reread(&after, "web"), HostMeta::default());
}

#[test]
fn a_table_with_a_comment_above_it_is_emptied_but_not_removed() {
    // TOML 주석은 "바로 뒤 항목의 앞 장식" 이라 헤더를 지우면 주석이 딸려 나간다.
    // 파일 머리글이 첫 호스트 테이블 위에 있는 흔한 배치에서 특히 위험하다.
    let before = "# 이 파일은 aynx 가 씁니다\n\n[hosts.web]\ncolor = \"#c25b4a\"\n";
    let after = patch_document(before, "web", &HostMetaPatch::default()).unwrap();

    assert_eq!(after, "# 이 파일은 aynx 가 씁니다\n\n[hosts.web]\n");
    // 빈 테이블은 파서에 무해하다 — 경고도 값도 없다.
    assert_eq!(reread(&after, "web"), HostMeta::default());
    // 다시 값을 넣으면 그 테이블이 그대로 채워진다 (중복 테이블이 생기지 않는다).
    let again = patch_document(&after, "web", &patch(Some("#000000"), None)).unwrap();
    assert_eq!(
        again,
        "# 이 파일은 aynx 가 씁니다\n\n[hosts.web]\ncolor = \"#000000\"\n"
    );
}

#[test]
fn clearing_a_host_that_has_no_entry_changes_nothing() {
    let before = "[defaults]\ncolor = \"#8a8a8a\"\n";
    assert_eq!(
        patch_document(before, "web", &HostMetaPatch::default()).unwrap(),
        before
    );
    // hosts 섹션도 통째로 없는 파일에 빈 테이블을 만들지 않는다.
    assert_eq!(
        patch_document("", "web", &HostMetaPatch::default()).unwrap(),
        ""
    );
}

#[test]
fn korean_and_dotted_aliases_round_trip_through_quoting() {
    for alias in ["내 서버", "web.example.com", "서버-1", "a b c"] {
        let after = patch_document("", alias, &patch(Some("#b08a3c"), Some("사내/서버"))).unwrap();
        // 따옴표는 toml_edit 이 알아서 붙인다 — 우리가 만드는 것이 아니라 왕복으로 보증한다.
        let raw = reread(&after, alias);
        assert_eq!(raw.color.as_deref(), Some("#b08a3c"), "{alias}: {after}");
        assert_eq!(raw.group.as_deref(), Some("사내/서버"), "{alias}: {after}");

        // 같은 별칭을 다시 저장해도 테이블이 둘로 갈라지지 않는다.
        let again =
            patch_document(&after, alias, &patch(Some("#000000"), Some("사내/서버"))).unwrap();
        assert_eq!(again.matches("[hosts.").count(), 1, "{alias}: {again}");
        assert_eq!(reread(&again, alias).color.as_deref(), Some("#000000"));
    }
}

#[test]
fn write_reuses_an_existing_key_that_differs_only_in_case() {
    // 파일에 [hosts.WEB] 가 있는데 `web` 으로 저장 → 테이블을 새로 만들지 않고 그 테이블을 고친다
    // (새로 만들면 파서가 "대소문자만 다른 항목" 경고를 내며 하나를 버린다).
    let after = patch_document(
        "[hosts.WEB]\ncolor = \"#aaaaaa\"\n",
        "web",
        &patch(Some("#bbbbbb"), None),
    )
    .unwrap();
    assert_eq!(after, "[hosts.WEB]\ncolor = \"#bbbbbb\"\n");
    assert_eq!(reread(&after, "web").color.as_deref(), Some("#bbbbbb"));
}

#[test]
fn broken_file_is_refused_rather_than_overwritten() {
    let err =
        patch_document("[hosts.web\ncolor = ", "web", &patch(Some("#000000"), None)).unwrap_err();
    assert!(err.contains("해석할 수 없어 저장하지 않았습니다"), "{err}");
    assert!(!err.contains('\n'), "{err}");
}

#[test]
fn blank_alias_is_refused() {
    assert!(patch_document("", "   ", &patch(Some("#000000"), None)).is_err());
}

#[test]
fn crlf_files_keep_their_line_endings() {
    let before = "[hosts.web]\r\ncolor = \"#c25b4a\"\r\n";
    let after = patch_document(before, "web", &patch(Some("#000000"), None)).unwrap();
    assert_eq!(after, "[hosts.web]\r\ncolor = \"#000000\"\r\n");
}

// ------------------------------------------------------------------
// 파일 왕복
// ------------------------------------------------------------------

/// std 만으로 만드는 임시 디렉터리 (config_edit 테스트와 같은 방식).
/// **사용자의 진짜 `~/.ssh/sessions.toml` 은 어떤 테스트도 건드리지 않는다.**
struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "aynx-sessions-meta-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("임시 디렉터리 생성");
        TempDir(dir)
    }

    fn file(&self) -> std::path::PathBuf {
        self.0.join("sessions.toml")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn missing_file_is_created_with_a_header_comment() {
    let tmp = TempDir::new();
    let path = tmp.0.join("nested").join(".ssh").join("sessions.toml");

    set_host_meta_at(&path, "web", &patch(Some("#c25b4a"), Some("prod/web"))).unwrap();

    let content = std::fs::read_to_string(&path).unwrap();
    assert!(content.starts_with("# ~/.ssh/sessions.toml"), "{content}");
    assert_eq!(
        content.lines().filter(|l| l.starts_with('#')).count(),
        2,
        "{content}"
    );
    assert!(content.contains("[hosts.web]"), "{content}");
    assert_eq!(
        get_host_meta_at(&path, "web").color.as_deref(),
        Some("#c25b4a")
    );
}

#[test]
fn missing_file_stays_missing_when_there_is_nothing_to_write() {
    let tmp = TempDir::new();
    let path = tmp.file();
    set_host_meta_at(&path, "web", &HostMetaPatch::default()).unwrap();
    assert!(!path.exists(), "빈 저장이 파일을 만들면 안 된다");
}

#[test]
fn header_is_never_added_to_an_existing_file() {
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(&path, "[hosts.web]\ncolor = \"#c25b4a\"\n").unwrap();

    set_host_meta_at(&path, "web", &patch(Some("#000000"), None)).unwrap();
    let content = std::fs::read_to_string(&path).unwrap();
    assert_eq!(content, "[hosts.web]\ncolor = \"#000000\"\n");
}

#[test]
fn saving_the_same_values_does_not_rewrite_the_file() {
    let tmp = TempDir::new();
    let path = tmp.file();
    let before = "# 주석\n[hosts.web]\ncolor = \"#c25b4a\"\n";
    std::fs::write(&path, before).unwrap();

    set_host_meta_at(&path, "web", &patch(Some("#c25b4a"), None)).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
}

#[test]
fn get_reads_the_raw_entry_and_falls_back_to_default() {
    let tmp = TempDir::new();
    let path = tmp.file();

    // 파일 없음 → 기본값 (오류가 아니다)
    assert_eq!(get_host_meta_at(&path, "web"), HostMeta::default());

    std::fs::write(
        &path,
        "[defaults]\ncolor = \"#8a8a8a\"\n\n[hosts.web]\ngroup = \"prod\"\n",
    )
    .unwrap();
    let raw = get_host_meta_at(&path, "web");
    // defaults 의 색은 올라오지 않는다 — 원본만.
    assert_eq!(raw.color, None);
    assert_eq!(raw.group.as_deref(), Some("prod"));
    // 항목 없는 호스트도 기본값.
    assert_eq!(get_host_meta_at(&path, "db"), HostMeta::default());

    // 깨진 파일도 읽기는 조용히 기본값 (경고는 list_hosts 쪽에서 이미 낸다)
    std::fs::write(&path, "[hosts.web\n").unwrap();
    assert_eq!(get_host_meta_at(&path, "web"), HostMeta::default());
}

#[test]
fn rename_flow_moves_the_entry_and_drops_the_old_table() {
    // 프런트의 별칭 변경 흐름: 새 별칭으로 저장 → 옛 별칭을 빈 패치로 지운다.
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(
        &path,
        "# 주석\n[defaults]\ncolor = \"#8a8a8a\"\n\n[hosts.web]\ncolor = \"#c25b4a\"\ntags = [\"a\"]\n\n[hosts.db]\ncolor = \"#4a7fc2\"\n",
    )
    .unwrap();

    let moved = HostMetaPatch {
        color: Some("#c25b4a".into()),
        tags: Some(vec!["a".into()]),
        ..HostMetaPatch::default()
    };
    set_host_meta_at(&path, "web-new", &moved).unwrap();
    set_host_meta_at(&path, "web", &HostMetaPatch::default()).unwrap();

    let content = std::fs::read_to_string(&path).unwrap();
    assert!(content.starts_with("# 주석\n"), "{content}");
    assert!(!content.contains("[hosts.web]"), "{content}");
    assert!(content.contains("[hosts.db]"), "{content}");
    assert_eq!(
        get_host_meta_at(&path, "web-new").color.as_deref(),
        Some("#c25b4a")
    );
    assert_eq!(
        get_host_meta_at(&path, "web-new").tags,
        vec!["a".to_string()]
    );
    assert_eq!(get_host_meta_at(&path, "web"), HostMeta::default());
}

#[test]
fn documented_example_survives_a_gui_edit() {
    // 문서의 예시 파일을 GUI 로 한 번 고쳐도 나머지가 그대로인지 (사용자가 복사해 쓰는 내용이다).
    let before = r##"[defaults]
color = "#8a8a8a"
scrollback = 5000

[presets.prod]
identity = "~/.ssh/id_prod"
on_connect = "cd /srv/app"

[hosts.web-01]
group = "prod/web"
preset = "prod"
color = "#c25b4a"
tags = ["web", "nginx"]

[hosts."내 서버"]
color = "#b08a3c"
"##;
    let p = HostMetaPatch {
        color: Some("#5aa469".into()),
        group: Some("prod/web".into()),
        tags: Some(vec!["web".into(), "nginx".into(), "canary".into()]),
        scrollback: Some(20000),
        ..HostMetaPatch::default()
    };
    let after = patch_document(before, "web-01", &p).unwrap();

    let (m, warnings) = SessionsMeta::parse(&after);
    assert!(warnings.is_empty(), "{warnings:?}");
    let web = m.resolve("web-01");
    assert_eq!(web.color.as_deref(), Some("#5aa469"));
    assert_eq!(web.scrollback, Some(20000));
    assert_eq!(web.tags.len(), 3);
    // preset 은 손대지 않았으므로 상속이 그대로 산다.
    assert_eq!(web.identity.as_deref(), Some("~/.ssh/id_prod"));
    assert_eq!(web.on_connect.as_deref(), Some("cd /srv/app"));
    // 다른 호스트·defaults 는 무변화.
    assert_eq!(m.resolve("내 서버").color.as_deref(), Some("#b08a3c"));
    assert_eq!(m.resolve("아무개").scrollback, Some(5000));
}

// ------------------------------------------------------------------
// 그룹 메타 읽기 (`[groups]` → 맵)
// ------------------------------------------------------------------

#[test]
fn parse_groups_reads_icons_into_a_map() {
    let m = parse_group_meta(
        r##"[groups."prod/web"]
icon = "🌐"

[groups."prod/db"]
icon = "🗄️"
"##,
    );
    assert_eq!(m.len(), 2);
    assert_eq!(m["prod/web"].icon.as_deref(), Some("🌐"));
    assert_eq!(m["prod/db"].icon.as_deref(), Some("🗄️"));
}

#[test]
fn parse_groups_is_empty_when_the_table_is_missing() {
    assert!(parse_group_meta("").is_empty());
    assert!(parse_group_meta("[hosts.web]\ncolor = \"#c25b4a\"\n").is_empty());
}

#[test]
fn parse_groups_skips_malformed_entries_instead_of_throwing() {
    // 아이콘이 문자열이 아니거나 항목이 테이블이 아니면 그 항목만 버린다 (전체는 산다).
    let m = parse_group_meta(
        r##"[groups."ok"]
icon = "✅"

[groups."no-icon"]

[groups."wrong-type"]
icon = 42
"##,
    );
    assert_eq!(m["ok"].icon.as_deref(), Some("✅"));
    // 아이콘 없는 그룹도 항목은 있고 icon 만 None.
    assert_eq!(m["no-icon"].icon, None);
    // 타입이 틀린 아이콘은 조용히 버려진다.
    assert_eq!(m["wrong-type"].icon, None);
}

#[test]
fn parse_groups_of_a_broken_file_is_empty_not_an_error() {
    assert!(parse_group_meta("[groups.\"x\"\nicon = ").is_empty());
}

#[test]
fn group_meta_serializes_with_icon_field_and_null() {
    let json = serde_json::to_string(&GroupMeta {
        icon: Some("🌐".into()),
        color: None,
    })
    .unwrap();
    assert_eq!(json, "{\"icon\":\"🌐\",\"color\":null}");
    let json = serde_json::to_string(&GroupMeta::default()).unwrap();
    assert_eq!(json, "{\"icon\":null,\"color\":null}");
}

// ------------------------------------------------------------------
// 그룹 아이콘 쓰기 (`set_group_meta`)
// ------------------------------------------------------------------

#[test]
fn set_group_icon_writes_a_quoted_table_key() {
    let after = patch_group_meta_document("", "prod/web", Some("🌐"), None).unwrap();
    // 경로에 `/` 가 있으니 키는 따옴표로 감싸진다 (toml_edit 이 알아서 붙인다).
    assert_eq!(after, "[groups.\"prod/web\"]\nicon = \"🌐\"\n");
    assert_eq!(
        parse_group_meta(&after)["prod/web"].icon.as_deref(),
        Some("🌐")
    );
}

#[test]
fn set_group_icon_updates_in_place_and_keeps_a_trailing_comment() {
    let before = "[groups.\"prod/web\"]\nicon = \"🌐\"  # 웹 계층\n";
    let after = patch_group_meta_document(before, "prod/web", Some("🕸️"), None).unwrap();
    assert_eq!(after, "[groups.\"prod/web\"]\nicon = \"🕸️\"  # 웹 계층\n");
}

#[test]
fn blank_icon_removes_the_key_and_prunes_empty_tables() {
    // 공백만 있는 아이콘 = 지우기. 남는 키가 없으면 그룹 테이블도, [groups] 헤더도 사라진다.
    let before = "[groups.\"prod/web\"]\nicon = \"🌐\"\n";
    assert_eq!(
        patch_group_meta_document(before, "prod/web", Some("   "), None).unwrap(),
        ""
    );
    // None 도 같은 규칙.
    assert_eq!(
        patch_group_meta_document(before, "prod/web", None, None).unwrap(),
        ""
    );
}

#[test]
fn removing_one_group_icon_keeps_the_other_groups() {
    let before = "[groups.\"a\"]\nicon = \"🅰️\"\n\n[groups.\"b\"]\nicon = \"🅱️\"\n";
    let after = patch_group_meta_document(before, "a", None, None).unwrap();
    // a 는 사라지지만 b 와 [groups] 는 살아 있다.
    assert!(!after.contains("groups.\"a\""), "{after}");
    assert!(after.contains("[groups.\"b\"]\nicon = \"🅱️\"\n"), "{after}");
}

#[test]
fn clearing_a_group_with_no_entry_changes_nothing() {
    assert_eq!(
        patch_group_meta_document("", "prod/web", None, None).unwrap(),
        ""
    );
    let before = "[hosts.web]\ncolor = \"#c25b4a\"\n";
    assert_eq!(
        patch_group_meta_document(before, "prod/web", None, None).unwrap(),
        before
    );
}

#[test]
fn set_group_icon_leaves_hosts_and_other_content_untouched() {
    let before = "# 머리 주석\n[hosts.web]\ngroup = \"prod/web\"\ncolor = \"#c25b4a\"\n";
    let after = patch_group_meta_document(before, "prod/web", Some("🌐"), None).unwrap();
    assert!(
        after.starts_with(before),
        "기존 내용이 그대로 앞에 있어야 한다: {after}"
    );
    assert!(
        after.contains("[groups.\"prod/web\"]\nicon = \"🌐\"\n"),
        "{after}"
    );
}

#[test]
fn set_group_icon_rejects_a_blank_path() {
    assert!(patch_group_meta_document("", "   ", Some("🌐"), None).is_err());
}

#[test]
fn group_meta_crlf_files_keep_their_line_endings() {
    let before = "[groups.\"a\"]\r\nicon = \"🅰️\"\r\n";
    let after = patch_group_meta_document(before, "a", Some("🔤"), None).unwrap();
    assert_eq!(after, "[groups.\"a\"]\r\nicon = \"🔤\"\r\n");
}

// ------------------------------------------------------------------
// 그룹 이름 바꾸기·중첩·해제·해산 (`rename_group`)
// ------------------------------------------------------------------

/// 걸리는 호스트들의 group 값을 뽑아 (별칭, group) 목록으로 (테스트 확인용).
fn groups_of(content: &str) -> Vec<(String, Option<String>)> {
    let (m, w) = SessionsMeta::parse(content);
    assert!(w.is_empty(), "예상치 못한 경고: {w:?}");
    let mut out: Vec<_> = ["web", "web-sub", "db", "other"]
        .iter()
        .map(|h| (h.to_string(), m.raw_host(h).group))
        .collect();
    out.sort();
    out
}

#[test]
fn rename_group_renames_a_leaf() {
    let before = "[hosts.web]\ngroup = \"web\"\n[hosts.other]\ngroup = \"db\"\n";
    let after = rename_group_document(before, "web", "www").unwrap();
    assert_eq!(
        after,
        "[hosts.web]\ngroup = \"www\"\n[hosts.other]\ngroup = \"db\"\n"
    );
}

#[test]
fn rename_group_re_nests_the_exact_host_and_the_subgroup_hosts() {
    // web → infra/web : 정확히 web 인 호스트도, web/edge 하위 호스트도 함께 옮긴다.
    let before = "[hosts.web]\ngroup = \"web\"\n[hosts.web-sub]\ngroup = \"web/edge\"\n[hosts.other]\ngroup = \"website\"\n";
    let after = rename_group_document(before, "web", "infra/web").unwrap();
    assert_eq!(
        groups_of(&after),
        vec![
            ("db".to_string(), None),
            // `website` 는 `web/` 경계가 아니라 안 걸린다.
            ("other".to_string(), Some("website".to_string())),
            ("web".to_string(), Some("infra/web".to_string())),
            ("web-sub".to_string(), Some("infra/web/edge".to_string())),
        ]
    );
}

#[test]
fn rename_group_un_nests_back_to_a_leaf() {
    let before =
        "[hosts.web]\ngroup = \"infra/web\"\n[hosts.web-sub]\ngroup = \"infra/web/edge\"\n";
    let after = rename_group_document(before, "infra/web", "web").unwrap();
    assert_eq!(
        groups_of(&after),
        vec![
            ("db".to_string(), None),
            ("other".to_string(), None),
            ("web".to_string(), Some("web".to_string())),
            ("web-sub".to_string(), Some("web/edge".to_string())),
        ]
    );
}

#[test]
fn rename_group_dissolves_to_root_when_to_is_empty() {
    // infra → "" : 정확히 infra 인 호스트는 그룹을 잃고, infra/web 은 web 으로 올라간다.
    let before = "[hosts.web]\ngroup = \"infra\"\n[hosts.web-sub]\ngroup = \"infra/web\"\n";
    let after = rename_group_document(before, "infra", "").unwrap();
    assert_eq!(
        groups_of(&after),
        vec![
            ("db".to_string(), None),
            ("other".to_string(), None),
            // 정확히 infra 인 호스트는 group 키 자체가 사라진다.
            ("web".to_string(), None),
            ("web-sub".to_string(), Some("web".to_string())),
        ]
    );
    // 실제로 group 키가 지워졌는지 (그냥 빈 문자열이 아니라).
    assert!(!after.contains("[hosts.web]\ngroup"), "{after}");
}

#[test]
fn rename_group_migrates_group_meta_keys_alongside_hosts() {
    let before = r##"[hosts.web]
group = "web"

[hosts.web-sub]
group = "web/edge"

[groups."web"]
icon = "🌐"

[groups."web/edge"]
icon = "🛰️"
"##;
    let after = rename_group_document(before, "web", "infra/web").unwrap();
    let groups = parse_group_meta(&after);
    // 그룹 메타 키가 호스트와 같은 규칙으로 이관된다.
    assert!(!groups.contains_key("web"), "{groups:?}");
    assert_eq!(groups["infra/web"].icon.as_deref(), Some("🌐"));
    assert_eq!(groups["infra/web/edge"].icon.as_deref(), Some("🛰️"));
}

#[test]
fn rename_group_to_root_drops_the_exact_group_meta_but_lifts_subgroup_meta() {
    let before = "[groups.\"infra\"]\nicon = \"🏗️\"\n\n[groups.\"infra/web\"]\nicon = \"🌐\"\n";
    let after = rename_group_document(before, "infra", "").unwrap();
    let groups = parse_group_meta(&after);
    // 정확히 infra 인 메타는 뿌리로 해산되며 버려진다.
    assert!(!groups.contains_key("infra"), "{groups:?}");
    // infra/web 은 web 으로 올라간다.
    assert_eq!(groups["web"].icon.as_deref(), Some("🌐"));
}

#[test]
fn rename_group_prefers_the_moved_key_on_a_destination_collision() {
    // web → db 인데 db 메타가 이미 있으면, 옮겨온 web 쪽으로 덮어쓴다.
    let before = "[groups.\"web\"]\nicon = \"🌐\"\n\n[groups.\"db\"]\nicon = \"🗄️\"\n";
    let after = rename_group_document(before, "web", "db").unwrap();
    let groups = parse_group_meta(&after);
    assert_eq!(groups.len(), 1);
    assert_eq!(
        groups["db"].icon.as_deref(),
        Some("🌐"),
        "옮겨온 쪽이 이긴다"
    );
}

#[test]
fn rename_group_rejects_empty_from_and_a_no_op_rename() {
    assert!(rename_group_document("[hosts.web]\ngroup = \"web\"\n", "", "x").is_err());
    assert!(rename_group_document("[hosts.web]\ngroup = \"web\"\n", "  ", "x").is_err());
    // to == from 은 거부.
    assert!(rename_group_document("[hosts.web]\ngroup = \"web\"\n", "web", "web").is_err());
}

#[test]
fn rename_group_rejects_moving_a_group_into_its_own_descendant() {
    // web → web/sub 는 그룹을 자기 안으로 넣는 순환이라 거부한다.
    let err =
        rename_group_document("[hosts.web]\ngroup = \"web\"\n", "web", "web/sub").unwrap_err();
    assert!(err.contains("하위 경로"), "{err}");
}

#[test]
fn rename_group_with_no_match_is_a_clean_no_op() {
    let before = "[hosts.web]\ngroup = \"prod\"\n[hosts.db]\ngroup = \"prod/db\"\n";
    // 걸리는 그룹이 없다 — 내용이 그대로 돌아온다.
    assert_eq!(
        rename_group_document(before, "staging", "qa").unwrap(),
        before
    );
}

#[test]
fn rename_group_preserves_comments_and_unrelated_keys() {
    let before = r##"# 파일 머리 주석
[defaults]
color = "#8a8a8a"

[hosts.web]
group = "web"   # 웹 그룹
color = "#c25b4a"

[hosts.db]
group = "db"
"##;
    let after = rename_group_document(before, "web", "infra/web").unwrap();
    // 주석·다른 키·다른 호스트는 그대로, group 값만 바뀐다.
    assert!(after.contains("# 파일 머리 주석\n"), "{after}");
    assert!(
        after.contains("[defaults]\ncolor = \"#8a8a8a\"\n"),
        "{after}"
    );
    assert!(
        after.contains("group = \"infra/web\"   # 웹 그룹\n"),
        "{after}"
    );
    assert!(after.contains("color = \"#c25b4a\"\n"), "{after}");
    assert!(after.contains("[hosts.db]\ngroup = \"db\"\n"), "{after}");
}

#[test]
fn rename_group_keeps_crlf_line_endings() {
    let before = "[hosts.web]\r\ngroup = \"web\"\r\n";
    let after = rename_group_document(before, "web", "www").unwrap();
    assert_eq!(after, "[hosts.web]\r\ngroup = \"www\"\r\n");
}

// ------------------------------------------------------------------
// 그룹 파일 왕복
// ------------------------------------------------------------------

#[test]
fn group_meta_file_round_trips_and_creates_a_header() {
    let tmp = TempDir::new();
    let path = tmp.0.join("nested").join(".ssh").join("sessions.toml");

    set_group_meta_at(&path, "prod/web", Some("🌐"), None).unwrap();
    let content = std::fs::read_to_string(&path).unwrap();
    assert!(content.starts_with("# ~/.ssh/sessions.toml"), "{content}");

    let map = list_group_meta_at(&path).unwrap();
    assert_eq!(map["prod/web"].icon.as_deref(), Some("🌐"));

    // 빈 아이콘으로 지우면 icon 이 사라진다. (이 파일은 첫 그룹 위에 머리 주석이 붙어 있어
    // 빈 테이블 헤더는 주석 보존을 위해 남지만 — 호스트 쪽과 같은 규칙 — 아이콘은 없어진다.)
    set_group_meta_at(&path, "prod/web", None, None).unwrap();
    let map = list_group_meta_at(&path).unwrap();
    assert!(
        map.get("prod/web").and_then(|g| g.icon.as_ref()).is_none(),
        "{map:?}"
    );
    assert!(
        !std::fs::read_to_string(&path).unwrap().contains("icon"),
        "아이콘 키가 남았다"
    );
}

/// 폴더 색 (docs/log/2026-09-29-folder-project-icons.md) — 아이콘과 함께 쓰고 함께 읽는다.
#[test]
fn group_color_round_trips_alongside_the_icon() {
    let after = patch_group_meta_document(
        "",
        "prod",
        Some("svg:lucide:folder-git-2"),
        Some(" #4a90d9 "),
    )
    .unwrap();
    assert_eq!(
        after,
        "[groups.prod]\nicon = \"svg:lucide:folder-git-2\"\ncolor = \"#4a90d9\"\n"
    );
    let m = parse_group_meta(&after);
    assert_eq!(m["prod"].icon.as_deref(), Some("svg:lucide:folder-git-2"));
    assert_eq!(m["prod"].color.as_deref(), Some("#4a90d9"));

    // 색만 남기기 — 아이콘 키만 빠지고 테이블은 산다 (폴더의 존재 증거로도 충분하다).
    let color_only = patch_group_meta_document(&after, "prod", None, Some("#4a90d9")).unwrap();
    assert_eq!(color_only, "[groups.prod]\ncolor = \"#4a90d9\"\n");
    assert_eq!(parse_group_meta(&color_only)["prod"].icon, None);

    // 색을 비우면 그 키만, 둘 다 비면 테이블째 사라진다.
    let icon_only =
        patch_group_meta_document(&after, "prod", Some("svg:lucide:folder-git-2"), Some("  "))
            .unwrap();
    assert!(!icon_only.contains("color"), "{icon_only}");
    assert_eq!(
        patch_group_meta_document(&after, "prod", None, None).unwrap(),
        ""
    );

    // 줄 끝 주석은 색을 바꿔도 남는다.
    let commented = "[groups.prod]\ncolor = \"#111111\"  # 운영\n";
    let recolored = patch_group_meta_document(commented, "prod", None, Some("#222222")).unwrap();
    assert_eq!(recolored, "[groups.prod]\ncolor = \"#222222\"  # 운영\n");

    // 색이 문자열이 아니면 그 칸만 버린다.
    assert_eq!(parse_group_meta("[groups.x]\ncolor = 3\n")["x"].color, None);
}

#[test]
fn group_color_file_round_trips_and_follows_a_rename() {
    let tmp = TempDir::new();
    let path = tmp.file();
    set_group_meta_at(&path, "prod/web", Some("🌐"), Some("#e5484d")).unwrap();
    let map = list_group_meta_at(&path).unwrap();
    assert_eq!(map["prod/web"].color.as_deref(), Some("#e5484d"));
    // 이름 바꾸기는 테이블째 옮기므로 색도 따라간다.
    rename_group_at(&path, "prod/web", "prod/www").unwrap();
    let map = list_group_meta_at(&path).unwrap();
    assert_eq!(map["prod/www"].color.as_deref(), Some("#e5484d"));
    assert!(!map.contains_key("prod/web"));
}

#[test]
fn list_group_meta_of_a_missing_file_is_an_empty_map() {
    let tmp = TempDir::new();
    assert!(list_group_meta_at(&tmp.file()).unwrap().is_empty());
}

#[test]
fn rename_group_at_writes_the_file_and_is_a_no_op_when_nothing_matches() {
    let tmp = TempDir::new();
    let path = tmp.file();
    std::fs::write(&path, "[hosts.web]\ngroup = \"web\"\n").unwrap();

    rename_group_at(&path, "web", "infra/web").unwrap();
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "[hosts.web]\ngroup = \"infra/web\"\n"
    );

    // 걸리는 그룹이 없으면 파일을 건드리지 않는다 (내용 그대로).
    let before = std::fs::read_to_string(&path).unwrap();
    rename_group_at(&path, "staging", "qa").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
}

#[test]
fn rename_group_at_validates_input_even_when_the_file_is_missing() {
    let tmp = TempDir::new();
    // 파일이 없어도 잘못된 입력은 거부한다.
    assert!(rename_group_at(&tmp.file(), "", "x").is_err());
    // 유효한 입력이면 대상이 없어 조용히 성공하고 파일을 만들지 않는다.
    assert!(rename_group_at(&tmp.file(), "web", "www").is_ok());
    assert!(!tmp.file().exists());
}

// ------------------------------------------------------------------
// 호스트 메타 삭제 (`remove_host_document` / `remove_host_meta_at`)
// ------------------------------------------------------------------

#[test]
fn remove_host_meta_deletes_the_whole_table_and_prunes_empty_hosts() {
    // 테이블이 하나뿐이면 `[hosts]` 마저 비어 헤더까지 사라진다 → 빈 문서.
    let before = "[hosts.web]\ncolor = \"#c25b4a\"\npreset = \"prod\"\n";
    assert_eq!(remove_host_document(before, "web").unwrap(), "");
}

#[test]
fn remove_host_meta_keeps_other_hosts_defaults_and_comments() {
    let before = r##"# 파일 머리 주석
[defaults]
color = "#8a8a8a"

[presets.prod]
on_connect = "cd /srv/app"

[hosts.web]
color = "#c25b4a"
preset = "prod"
tags = ["web"]

[hosts.db]
color = "#4a7fc2"
"##;
    let after = remove_host_document(before, "web").unwrap();
    // web 테이블만 통째로 사라지고 나머지는 그대로.
    assert!(!after.contains("[hosts.web]"), "{after}");
    assert!(after.contains("# 파일 머리 주석\n"), "{after}");
    assert!(
        after.contains("[defaults]\ncolor = \"#8a8a8a\"\n"),
        "{after}"
    );
    assert!(
        after.contains("[presets.prod]\non_connect = \"cd /srv/app\"\n"),
        "{after}"
    );
    assert!(
        after.contains("[hosts.db]\ncolor = \"#4a7fc2\"\n"),
        "{after}"
    );

    let (m, warnings) = SessionsMeta::parse(&after);
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(m.raw_host("web"), HostMeta::default());
    assert_eq!(m.raw_host("db").color.as_deref(), Some("#4a7fc2"));
}

#[test]
fn remove_host_meta_of_a_missing_table_or_section_is_a_no_op() {
    // 해당 테이블이 없다 — 입력 그대로.
    let before = "[defaults]\ncolor = \"#8a8a8a\"\n\n[hosts.db]\ncolor = \"#4a7fc2\"\n";
    assert_eq!(remove_host_document(before, "web").unwrap(), before);
    // hosts 섹션 자체가 없어도 그대로.
    assert_eq!(
        remove_host_document("[defaults]\ncolor = \"#8a8a8a\"\n", "web").unwrap(),
        "[defaults]\ncolor = \"#8a8a8a\"\n"
    );
    // 빈 문서도 그대로.
    assert_eq!(remove_host_document("", "web").unwrap(), "");
}

#[test]
fn remove_host_meta_matches_case_insensitively() {
    // 파일에 [hosts.WEB] 가 있고 소문자 web 으로 지워도 찾아 지운다 (읽기와 같은 규칙).
    let before = "[hosts.WEB]\ncolor = \"#aaaaaa\"\n\n[hosts.db]\ncolor = \"#4a7fc2\"\n";
    let after = remove_host_document(before, "web").unwrap();
    assert!(!after.contains("WEB"), "{after}");
    assert!(
        after.contains("[hosts.db]\ncolor = \"#4a7fc2\"\n"),
        "{after}"
    );
}

#[test]
fn remove_host_meta_empties_but_keeps_a_table_with_a_comment_above_it() {
    // TOML 주석은 뒤 항목의 앞 장식이라 헤더를 지우면 파일 머리글이 딸려 나간다 —
    // 그런 테이블은 비워만 두고 헤더는 남긴다 (호스트 편집·그룹 쓰기와 같은 규칙).
    let before =
        "# 이 파일은 aynx 가 씁니다\n\n[hosts.web]\ncolor = \"#c25b4a\"\npreset = \"prod\"\n";
    let after = remove_host_document(before, "web").unwrap();
    assert_eq!(after, "# 이 파일은 aynx 가 씁니다\n\n[hosts.web]\n");
    // 빈 테이블은 파서에 무해하다.
    assert_eq!(reread(&after, "web"), HostMeta::default());
}

#[test]
fn remove_host_meta_keeps_crlf_line_endings() {
    let before = "[hosts.web]\r\ncolor = \"#c25b4a\"\r\n\r\n[hosts.db]\r\ncolor = \"#4a7fc2\"\r\n";
    let after = remove_host_document(before, "web").unwrap();
    assert!(!after.contains("[hosts.web]"), "{after}");
    assert!(
        after.contains("[hosts.db]\r\ncolor = \"#4a7fc2\"\r\n"),
        "{after}"
    );
    assert!(
        !after.contains("[hosts.db]\ncolor"),
        "LF 로 바뀌면 안 된다: {after:?}"
    );
}

#[test]
fn remove_host_meta_rejects_a_blank_alias() {
    assert!(remove_host_document("[hosts.web]\ncolor = \"#c25b4a\"\n", "   ").is_err());
}

#[test]
fn remove_host_meta_broken_file_is_refused_rather_than_overwritten() {
    let err = remove_host_document("[hosts.web\ncolor = ", "web").unwrap_err();
    assert!(err.contains("해석할 수 없어 저장하지 않았습니다"), "{err}");
    assert!(!err.contains('\n'), "{err}");
}

#[test]
fn remove_host_meta_at_writes_the_file_and_is_a_no_op_on_missing_file_or_table() {
    let tmp = TempDir::new();
    let path = tmp.file();

    // 파일 없음 → 조용한 no-op (오류 아님), 파일도 만들지 않는다.
    remove_host_meta_at(&path, "web").unwrap();
    assert!(!path.exists());

    // web 위에 주석이 없으니 테이블이 통째로 사라진다 (주석 보존 경로는 document 테스트에서 다룬다).
    std::fs::write(&path, "[defaults]\ncolor = \"#8a8a8a\"\n\n[hosts.web]\ncolor = \"#c25b4a\"\n\n[hosts.db]\ncolor = \"#4a7fc2\"\n").unwrap();
    remove_host_meta_at(&path, "web").unwrap();
    let content = std::fs::read_to_string(&path).unwrap();
    assert!(!content.contains("[hosts.web]"), "{content}");
    assert!(content.contains("[hosts.db]"), "{content}");
    assert_eq!(get_host_meta_at(&path, "web"), HostMeta::default());

    // 없는 테이블을 지워도 파일 내용은 그대로 (mtime 도 흔들지 않는 no-op 경로).
    let before = std::fs::read_to_string(&path).unwrap();
    remove_host_meta_at(&path, "없는호스트").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
}

/// 옛 DB 연결 프리셋 키 `dbs`(10-13 까지 이 파일에 적던 것 — 지금은 `db-connections.json`)는 **모르는 키**다: 읽기는 무시하고
/// 경고도 없으며, 앱이 호스트를 저장해도 지우지 않는다(우리 키만 갈아 끼운다 — 사람이 손으로 옮길 때까지 남는다).
#[test]
fn legacy_dbs_key_is_ignored_and_survives_host_saves() {
    let before = "[hosts.web]\ncolor = \"#c25b4a\"\ndbs = [{ id = \"Kp3_pg-main01\", name = \"prod\", engine = \"postgres\", host = \"localhost\", port = 5432 }]\n";
    let (m, warnings) = SessionsMeta::parse(before);
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(m.resolve("web").color.as_deref(), Some("#c25b4a"));

    // 색만 바꾸는 저장 · 우리 키를 모두 지우는 저장 — 둘 다 `dbs` 줄은 그대로 둔다(헤더 줄도 남는다).
    let p = HostMetaPatch { color: Some("#000000".into()), ..Default::default() };
    let after = patch_document(before, "web", &p).unwrap();
    assert!(after.contains("color = \"#000000\""), "{after}");
    assert!(after.contains("dbs = [{ id = \"Kp3_pg-main01\""), "{after}");
    let cleared = patch_document(&after, "web", &HostMetaPatch::default()).unwrap();
    assert!(cleared.contains("[hosts.web]") && cleared.contains("dbs = ["), "{cleared}");
    assert!(!cleared.contains("color"), "{cleared}");
}
