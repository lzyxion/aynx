use super::*;

/// 테스트마다 겹치지 않는 임시 경로. 파일·폴더 모두 여기 아래에만 만든다.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        // 프로세스 id + 나노초면 동시 실행(cargo test 는 스레드 병렬)에도 안 겹친다.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("aynx-설정-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("임시 폴더 생성");
        Self(dir)
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn sample() -> AppSettings {
    AppSettings {
        triggers: vec![Trigger {
            pattern: r"\bFATAL\b".to_string(),
            fg: Some("#ffffff".to_string()),
            bg: Some("#7a1020".to_string()),
            url: Some("https://wiki.example.com/search?q=$0".to_string()),
            tooltip: Some("치명적 오류 — $0".to_string()),
            enabled: true,
        }],
        app: AppTheme {
            accent: Some("#c25b4a".to_string()),
            bg: Some("#101010".to_string()),
            bg_panel: Some("#181818".to_string()),
            fg: Some("#f1dfdc".to_string()),
            border: Some("#534341".to_string()),
            err: Some("#ffb4ab".to_string()),
            ok: Some("#b3ca76".to_string()),
            warn: Some("#f1b65f".to_string()),
            dynamic: Some("full".to_string()),
            opacity: Some(70),
            auto_reconnect: Some(true),
            tray_on_close: Some(false),
            window_controls: Some(true),
            resource_chip: Some(false),
            header_chip_order: vec!["ai".to_string(), "folder".to_string()],
            header_chips_hidden: vec!["resource".to_string()],
            resource_rings: Some(false),
            usage_rings: Some(false),
            tiling: Some("focus".to_string()),
            mode: Some("light".to_string()),
            language: Some("en".to_string()),
            tile_header: Some("multi".to_string()),
            status_bar: Some("top".to_string()),
            status_bar_style: Some("panel".to_string()),
            material: Some("flat".to_string()),
            app_icon: Some("gpt".to_string()),
            idle_lock_min: Some(5),
            ui_scale: Some(125),
            ui_font_family: Some("'Pretendard', sans-serif".to_string()),
        },
        terminal: TermPrefs {
            theme: Some("tokyo-night".to_string()),
            font_family: Some("'D2Coding', monospace".to_string()),
            font_size: Some(16),
            cursor_style: Some("underline".to_string()),
            webgl: Some(false),
            local_shell_integration: Some(false),
            tab_style: None,
            ligatures: None,
            right_click: Some("paste".to_string()),
            confirm_multiline_paste: Some(false),
            osc52_clipboard: Some(false),
            osc_notify: Some(false),
            inline_images: Some(false),
            inline_snippets: Some(false),
            notify_after_secs: Some(30),
            mark_after_secs: Some(5),
            bell: Some("visual+sound".to_string()),
            opacity: Some(85),
            dynamic: BTreeMap::from([
                ("background".to_string(), "#1a1110".to_string()),
                ("foreground".to_string(), "#f1dfdc".to_string()),
                ("red".to_string(), "#f09285".to_string()),
                ("before-theme".to_string(), "gruvbox-dark".to_string()),
            ]),
        },
        shell: ShellPrefs {
            default: Some("wsl:Ubuntu".to_string()),
        },
        ai: AiPrefs {
            start_dir: Some("C:\\src\\myproject".to_string()),
            notify_turn_end: Some(false),
            notify_permission: Some(false),
            notify_side_chat: Some(false),
            notify_focused_after_secs: Some(120),
            codex_no_daemon: Some(false),
            claude_statusline: Some(false),
            icon_style: Some("avatar".to_string()),
            avatar_claude: Some("user-0123456789ab".to_string()),
            avatar_codex: Some("grok".to_string()),
            loading_art: None,
            mcp_sessions_enabled: Some(false),
            mcp_sessions_agents: Some(vec!["codex".to_string()]),
            disabled_agents: vec!["codex".to_string()],
            mcp_servers: vec![crate::agent_mcp::McpServer {
                project_id: None,
                env: vec![],
                headers: vec![],
                name: "playwright".to_string(),
                enabled: true,
                agents: Some(vec!["claude".to_string()]),
                transport: "stdio".to_string(),
                command: Some("npx".to_string()),
                args: vec!["@playwright/mcp@latest".to_string()],
                url: None,
                side_chat: true,
                side_chat_no_ask: false,
            }],
            args: BTreeMap::from([
                (
                    "claude".to_string(),
                    "--model opus --append-system-prompt 'be brief'".to_string(),
                ),
                ("codex".to_string(), "-c model=o3".to_string()),
            ]),
        },
        wallpaper: WallpaperPrefs {
            file: Some("wallpaper.jpg".to_string()),
            dim: Some(60),
            blur: Some(4),
            fit: Some("cover".to_string()),
        },
        keybindings: BTreeMap::from([
            ("new-tab".to_string(), "Ctrl+Shift+KeyT".to_string()),
            ("command-palette".to_string(), "Ctrl+Comma".to_string()),
        ]),
        automation: AutomationPrefs {
            auto_approve: true,
            allow_patterns: vec!["df".to_string(), "uptime".to_string()],
            bundles: vec!["system".to_string(), "git".to_string()],
            max_targets: 8,
            max_concurrency: 3,
            auto_max_per_window: 15,
            auto_window_secs: 120,
            approval_ttl_minutes: 45,
            // 기본이 **켬**인 칸이라 표본은 일부러 끈 값을 담는다 — 왕복에서 `false` 가
            // 살아남는지가 이 칸의 유일한 위험이다(빠지면 `serde(default)` 가 다시 켠다).
            notify_review_requests: false,
            notify_operation_results: false,
            // 둘 다 기본과 다른 값 — 0(지우지 않음)과 켬이 왕복에서 살아남는지.
            audit_retention_days: 0,
            audit_output_excerpt: true,
            allow_pipes: false,
            // 묶음 안 끈 명령 — 표(table)라 `[[automation.allow]]` 앞에 쓰여야 한다.
            bundle_off: BTreeMap::from([
                ("files".to_string(), vec!["cat".to_string()]),
                ("system".to_string(), vec!["date".to_string(), "who".to_string()]),
            ]),
            allow: vec![
                AllowRule {
                    exec: "systemctl".to_string(),
                    subcommands: vec!["is-active".to_string(), "status".to_string()],
                    ..Default::default()
                },
                // 인자 제약 다섯 칸이 전부 왕복에서 살아남는지(2026-10-05).
                AllowRule {
                    exec: "ip".to_string(),
                    subcommands: vec!["addr".to_string()],
                    deny_flags: vec!["-batch".to_string()],
                    allow_flags: vec!["-br".to_string()],
                    require_flags: vec!["-4".to_string()],
                    first_arg: vec!["show".to_string()],
                    max_args: Some(0),
                    sub_first: true,
                },
            ],
        },
        vault: VaultPrefs {
            auto_lock_minutes: Some(5),
        },
        hosts: HostsPrefs {
            sort: Some("recent".to_string()),
        },
        files: FilesPrefs {
            default_view: Some("navigate".to_string()),
            auto_refresh: Some(false),
        },
        projects: ProjectsPrefs {
            start_screen: Some("off".to_string()),
        },
        dock: DockPrefs {
            layout: Some("launcher-right".to_string()),
        },
        plans: PlansPrefs {
            exec_sort: Some("oldest".to_string()),
        },
        updates: UpdatesPrefs { auto_check: Some(false) },
        messenger: MessengerPrefs {
            when: Some("always".to_string()),
            agent_stop: Some(false),
            agent_permission: Some(false),
            command_min_secs: Some(0),
            osc: Some(false),
            include_command: Some(true),
            include_conversation: Some(true),
            away_after_min: Some(0),
            discord: Some(false),
            slack: Some(false),
            operation_results: Some(false),
            operation_pending: Some(false),
            include_summary: Some(false),
        },
        remote: RemotePrefs {
            enabled: Some(true),
            port: Some(47900),
            host: Some("mypc.tailnet-abcd.ts.net".to_string()),
        },
    }
}

#[test]
fn roundtrip_through_a_file_preserves_everything() {
    let tmp = TempDir::new("왕복");
    let path = tmp.path("settings.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(load_at(&path), sample());
}

#[test]
fn roundtrip_through_toml_string() {
    let text = toml::to_string_pretty(&sample()).expect("직렬화");
    assert_eq!(
        toml::from_str::<AppSettings>(&text).expect("역직렬화"),
        sample()
    );
}

/// `None` 필드는 파일에 아예 적히지 않는다 — 나중에 기본값이 바뀌면 그 값을 따라간다.
#[test]
fn unset_fields_are_not_written() {
    let mut s = AppSettings::default();
    s.terminal.font_size = Some(14);
    let text = toml::to_string_pretty(&s).expect("직렬화");
    assert!(text.contains("font_size = 14"), "{text}");
    assert!(!text.contains("accent"), "{text}");
    assert!(!text.contains("font_family"), "{text}");
}

#[test]
fn partial_file_fills_the_rest_with_defaults() {
    let tmp = TempDir::new("부분");
    let path = tmp.path("settings.toml");
    std::fs::write(&path, "[app]\naccent = \"#ff8800\"\n").expect("쓰기");

    let s = load_at(&path);
    assert_eq!(s.app.accent.as_deref(), Some("#ff8800"));
    assert_eq!(s.app.bg, None);
    assert_eq!(s.terminal, TermPrefs::default());
}

#[test]
fn missing_sections_and_empty_file_are_not_an_error() {
    let tmp = TempDir::new("빈파일");

    let empty = tmp.path("empty.toml");
    std::fs::write(&empty, "").expect("쓰기");
    assert_eq!(load_at(&empty), AppSettings::default());

    let comment = tmp.path("comment.toml");
    std::fs::write(&comment, "# 주석만 있는 파일\n").expect("쓰기");
    assert_eq!(load_at(&comment), AppSettings::default());

    let sections = tmp.path("sections.toml");
    std::fs::write(&sections, "[app]\n[terminal]\n").expect("쓰기");
    assert_eq!(load_at(&sections), AppSettings::default());
}

#[test]
fn missing_file_yields_defaults() {
    let tmp = TempDir::new("없는파일");
    assert_eq!(
        load_at(&tmp.path("전혀-없는-파일.toml")),
        AppSettings::default()
    );
}

#[test]
fn broken_toml_falls_back_to_defaults() {
    let tmp = TempDir::new("깨진파일");

    let syntax = tmp.path("syntax.toml");
    std::fs::write(&syntax, "[app\naccent = ").expect("쓰기");
    assert_eq!(load_at(&syntax), AppSettings::default());

    // 값 타입이 어긋나도 같은 취급이다 — 파일 전체를 못 믿는다.
    let wrong_type = tmp.path("type.toml");
    std::fs::write(&wrong_type, "[terminal]\nfont_size = \"크게\"\n").expect("쓰기");
    assert_eq!(load_at(&wrong_type), AppSettings::default());
}

/// 깨진 파일은 기본값으로 시작하되 **원본을 `.broken-*` 로 떠 둔다** — 다음 저장이 덮어도 되살릴 수 있게.
/// 다시 읽어도 사본이 늘지 않고, 원본 자리는 그대로다(옮기지 않는다).
#[test]
fn broken_file_is_copied_aside_once() {
    let tmp = TempDir::new("깨진사본");
    let path = tmp.path("settings.toml");
    let broken = "[app\naccent = ";
    std::fs::write(&path, broken).expect("쓰기");

    assert_eq!(load_at(&path), AppSettings::default());
    assert_eq!(load_at(&path), AppSettings::default());

    let copies: Vec<_> = std::fs::read_dir(&tmp.0)
        .expect("목록")
        .map(|e| e.expect("항목").path())
        .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("settings.toml.broken-"))
        .collect();
    assert_eq!(copies.len(), 1, "{copies:?}");
    assert_eq!(std::fs::read_to_string(&copies[0]).expect("사본"), broken);
    assert_eq!(std::fs::read_to_string(&path).expect("원본"), broken);
}

/// 원자 저장 — 덮어쓴 뒤 폴더에 임시 파일이 남지 않는다.
#[test]
fn save_leaves_no_temp_file() {
    let tmp = TempDir::new("임시파일");
    let path = tmp.path("settings.toml");
    save_at(&path, &AppSettings::default()).expect("첫 저장");
    save_at(&path, &sample()).expect("덮어쓰기");

    let names: Vec<_> =
        std::fs::read_dir(&tmp.0).expect("목록").map(|e| e.expect("항목").file_name()).collect();
    assert_eq!(names, [std::ffi::OsString::from("settings.toml")]);
    assert_eq!(load_at(&path), sample());
}

/// 전방 호환 — 새 버전이 쓴 키가 섞여 있어도 아는 부분은 그대로 읽는다.
#[test]
fn unknown_keys_are_ignored() {
    let tmp = TempDir::new("모르는키");
    let path = tmp.path("settings.toml");
    std::fs::write(
        &path,
        "\
[app]
accent = \"#7aa2f7\"
future_token = \"#000000\"

[terminal]
font_size = 15
cursor_blink = true

[\"전혀 모르는 섹션\"]
whatever = true
",
    )
    .expect("쓰기");

    let s = load_at(&path);
    assert_eq!(s.app.accent.as_deref(), Some("#7aa2f7"));
    assert_eq!(s.terminal.font_size, Some(15));
}

#[test]
fn save_creates_missing_directories() {
    let tmp = TempDir::new("폴더생성");
    // 두 단계 아래 — 첫 실행에서 `<config_dir>/aynx` 가 통째로 없는 상황이다.
    let path = tmp.path("aynx").join("nested").join("settings.toml");
    assert!(!path.parent().expect("부모").exists());

    save_at(&path, &sample()).expect("저장");
    assert!(path.exists());
    assert_eq!(load_at(&path), sample());
}

#[test]
fn save_rewrites_the_whole_file() {
    let tmp = TempDir::new("재작성");
    let path = tmp.path("settings.toml");
    std::fs::write(
        &path,
        "[app]\naccent = \"#111111\"\nbg = \"#222222\"\n# 손으로 쓴 주석\n",
    )
    .expect("쓰기");

    let only_accent = AppSettings {
        app: AppTheme {
            accent: Some("#333333".to_string()),
            ..AppTheme::default()
        },
        ..AppSettings::default()
    };
    save_at(&path, &only_accent).expect("저장");

    // 앱 소유 파일이므로 전체 재작성이다 — 이전 값도 주석도 남지 않는다.
    let text = std::fs::read_to_string(&path).expect("읽기");
    assert!(!text.contains("#222222"), "{text}");
    assert!(!text.contains("손으로 쓴 주석"), "{text}");
    assert_eq!(load_at(&path), only_accent);
}

/// 헤더 주석을 붙여도 다시 읽는 데 지장이 없어야 한다.
#[test]
fn saved_file_starts_with_the_header_and_still_parses() {
    let tmp = TempDir::new("헤더");
    let path = tmp.path("settings.toml");
    save_at(&path, &sample()).expect("저장");

    let text = std::fs::read_to_string(&path).expect("읽기");
    assert!(text.starts_with("# aynx 앱 설정"), "{text}");
    assert_eq!(load_at(&path), sample());
}

#[test]
fn out_of_range_font_size_is_dropped() {
    let tmp = TempDir::new("글꼴크기");

    for (raw, expected) in [
        ("0", None),
        ("7", None),
        ("8", Some(8)),
        ("32", Some(32)),
        ("33", None),
        ("999", None),
    ] {
        let path = tmp.path(&format!("f{raw}.toml"));
        std::fs::write(&path, format!("[terminal]\nfont_size = {raw}\n")).expect("쓰기");
        assert_eq!(
            load_at(&path).terminal.font_size,
            expected,
            "font_size = {raw}"
        );
    }
}

#[test]
fn blank_strings_fold_to_unset_on_both_read_and_write() {
    let tmp = TempDir::new("빈문자열");

    let path = tmp.path("read.toml");
    std::fs::write(&path, "[app]\naccent = \"   \"\n[terminal]\ntheme = \"\"\n").expect("쓰기");
    let s = load_at(&path);
    assert_eq!(s.app.accent, None);
    assert_eq!(s.terminal.theme, None);

    // 저장 경로에서도 마찬가지 — 빈 값이 파일에 남지 않는다.
    let written = tmp.path("write.toml");
    let blank = AppSettings {
        app: AppTheme {
            accent: Some("  ".to_string()),
            ..AppTheme::default()
        },
        terminal: TermPrefs {
            font_family: Some(" ".to_string()),
            ..TermPrefs::default()
        },
        ..AppSettings::default()
    };
    save_at(&written, &blank).expect("저장");
    assert_eq!(load_at(&written), AppSettings::default());
}

#[test]
fn surrounding_whitespace_is_trimmed() {
    let tmp = TempDir::new("공백");
    let path = tmp.path("settings.toml");
    std::fs::write(&path, "[app]\naccent = \"  #7aa2f7  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.accent.as_deref(), Some("#7aa2f7"));
}

/// 프런트가 모르는 프리셋 키를 넣어도 백엔드는 그대로 보관한다 (목록을 아는 쪽은 프런트다).
#[test]
fn unknown_theme_key_is_stored_verbatim() {
    let tmp = TempDir::new("프리셋키");
    let path = tmp.path("settings.toml");
    std::fs::write(&path, "[terminal]\ntheme = \"아직-없는-프리셋\"\n").expect("쓰기");
    assert_eq!(
        load_at(&path).terminal.theme.as_deref(),
        Some("아직-없는-프리셋")
    );
}

/// 프런트 계약: `invoke` 응답은 JSON 이다. 필드 이름이 snake_case 그대로 나가는지 붙들어 둔다.
#[test]
fn serializes_to_json_with_expected_field_names() {
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"bg_panel\":\"#181818\""), "{json}");
    assert!(
        json.contains("\"font_family\":\"'D2Coding', monospace\""),
        "{json}"
    );
    assert!(json.contains("\"font_size\":16"), "{json}");
    assert!(json.contains("\"webgl\":false"), "{json}");
    assert!(json.contains("\"pattern\":\"\\\\bFATAL\\\\b\""), "{json}");
    assert!(json.contains("\"enabled\":true"), "{json}");

    // 안 정한 값은 키 자체가 없다 (프런트는 `?? undefined` 로 읽는다).
    // 트리거만은 예외 — 내장 두 개가 언제나 실려 나간다.
    let json = serde_json::to_string(&AppSettings::default()).expect("JSON");
    assert!(json.contains("\"app\":{}"), "{json}");
    assert!(json.contains("\"terminal\":{}"), "{json}");
    assert!(json.contains(r"\\bERROR\\b"), "{json}");
    // 안 정한 색은 키 자체가 없다.
    assert!(!json.contains("\"fg\""), "{json}");
}

/// 프런트에서 오는 부분 JSON(빠진 섹션·빠진 키)도 그대로 받아야 한다.
#[test]
fn deserializes_from_partial_json() {
    let s: AppSettings = serde_json::from_str("{}").expect("빈 객체");
    assert_eq!(s, AppSettings::default());

    let s: AppSettings =
        serde_json::from_str("{\"terminal\":{\"theme\":\"light\"}}").expect("부분 객체");
    assert_eq!(s.terminal.theme.as_deref(), Some("light"));
    assert_eq!(s.app, AppTheme::default());
    // triggers 를 빼고 보내면 내장 기본이 들어온다 (파일에 없는 것과 같은 취급).
    assert_eq!(s.triggers, default_triggers());

    // 프런트가 목록을 다 지우고 보낸 것은 "빈 목록" 이지 "안 정함" 이 아니다.
    let s: AppSettings = serde_json::from_str("{\"triggers\":[]}").expect("빈 배열");
    assert!(s.triggers.is_empty());
}

// ------------------------------------------------------------------
// 트리거
// ------------------------------------------------------------------

#[test]
fn missing_triggers_key_yields_the_builtin_two() {
    let tmp = TempDir::new("트리거기본");
    let path = tmp.path("settings.toml");
    std::fs::write(&path, "[terminal]\nfont_size = 14\n").expect("쓰기");

    let s = load_at(&path);
    assert_eq!(s.triggers.len(), 2, "{:?}", s.triggers);
    assert_eq!(s.triggers[0].pattern, r"\bERROR\b");
    assert_eq!(s.triggers[1].pattern, r"\bWARN(ING)?\b");
    assert!(s.triggers.iter().all(|t| t.enabled && t.bg.is_some()));
    // 파일이 아예 없어도 같다.
    assert_eq!(load_at(&tmp.path("없다.toml")).triggers, default_triggers());
}

/// **저장 → 다시 읽기가 트리거를 되살리면 안 된다.** 사용자가 목록을 다 지우고 저장한
/// 뒤에 앱을 다시 켰더니 ERROR/WARN 이 돌아와 있으면 지운 의미가 없다.
#[test]
fn cleared_triggers_stay_cleared_across_a_save() {
    let tmp = TempDir::new("트리거비움");
    let path = tmp.path("settings.toml");

    let cleared = AppSettings {
        triggers: Vec::new(),
        ..AppSettings::default()
    };
    save_at(&path, &cleared).expect("저장");
    assert!(
        load_at(&path).triggers.is_empty(),
        "{}",
        std::fs::read_to_string(&path).unwrap()
    );
}

/// TOML 은 "배열 키" 가 테이블 헤더 뒤에 오면 그 테이블 소속이 된다 — 그래서 순서가
/// 계약이다. 왕복이 값을 지켜 주는지 파일 내용까지 붙들어 둔다.
#[test]
fn triggers_round_trip_through_a_file() {
    let tmp = TempDir::new("트리거왕복");
    let path = tmp.path("settings.toml");
    save_at(&path, &sample()).expect("저장");

    let text = std::fs::read_to_string(&path).expect("읽기");
    assert!(text.contains("[[triggers]]"), "{text}");
    // 링크·툴팁 템플릿도 왕복한다 — `$0` 같은 달러가 TOML 에서 이스케이프되지 않는지까지.
    assert!(text.contains("wiki.example.com/search?q=$0"), "{text}");
    assert_eq!(load_at(&path), sample());
}

/// 링크·툴팁은 **선택 필드**다: 없는 트리거는 하이라이트 전용이고, 빈 칸은 색과 같은
/// 규칙으로 "안 정함"이 된다 (프런트가 편집 중에만 쓰는 `""` 가 파일에 새어 들어와도
/// 여기서 접힌다 — 그래야 "값이 있으면 켬" 이라는 규칙 하나만 남는다).
#[test]
fn trigger_links_and_tooltips_are_optional_and_blank_folds_to_none() {
    let tmp = TempDir::new("트리거링크");
    let path = tmp.path("settings.toml");
    std::fs::write(
        &path,
        concat!(
            "[[triggers]]\npattern = \"a\"\n\n",
            "[[triggers]]\npattern = \"b\"\nurl = \"  \"\ntooltip = \"\"\n\n",
            "[[triggers]]\npattern = \"c\"\nurl = \"  https://x/$1  \"\ntooltip = \"코드 $1\"\n",
        ),
    )
    .expect("쓰기");

    let s = load_at(&path);
    assert_eq!(s.triggers.len(), 3, "{:?}", s.triggers);
    // ① 키가 아예 없으면 하이라이트 전용 트리거다.
    assert_eq!(s.triggers[0].url, None);
    assert_eq!(s.triggers[0].tooltip, None);
    // ② 공백만 있는 값은 "안 정함" 으로 접힌다.
    assert_eq!(s.triggers[1].url, None);
    assert_eq!(s.triggers[1].tooltip, None);
    // ③ 양 끝 공백만 떼고 안쪽(`$1`)은 그대로 보관한다 — 해석은 프런트가 한다.
    assert_eq!(s.triggers[2].url.as_deref(), Some("https://x/$1"));
    assert_eq!(s.triggers[2].tooltip.as_deref(), Some("코드 $1"));

    // 값이 없는 필드는 파일에 키 자체가 남지 않는다 (`skip_serializing_if`).
    let out = tmp.path("out.toml");
    save_at(&out, &s).expect("저장");
    let text = std::fs::read_to_string(&out).expect("읽기");
    assert_eq!(text.matches("url = ").count(), 1, "{text}");
    assert_eq!(text.matches("tooltip = ").count(), 1, "{text}");
}

#[test]
fn blank_patterns_are_dropped_and_the_list_is_capped() {
    let tmp = TempDir::new("트리거정리");

    let path = tmp.path("blank.toml");
    std::fs::write(
        &path,
        "[[triggers]]\npattern = \"  \"\n\n[[triggers]]\npattern = \"  ok  \"\n",
    )
    .expect("쓰기");
    let s = load_at(&path);
    assert_eq!(s.triggers.len(), 1, "{:?}", s.triggers);
    // 앞뒤 공백은 떼고 보관한다 (정규식 안쪽 공백은 의미가 있으므로 건드리지 않는다).
    assert_eq!(s.triggers[0].pattern, "ok");
    // 손으로 적은 파일에서 enabled 를 생략하면 켜진 것으로 본다.
    assert!(s.triggers[0].enabled);

    let many = AppSettings {
        triggers: (0..MAX_TRIGGERS + 10)
            .map(|i| Trigger {
                pattern: format!("p{i}"),
                fg: None,
                bg: None,
                url: None,
                tooltip: None,
                enabled: true,
            })
            .collect(),
        ..AppSettings::default()
    };
    let path = tmp.path("many.toml");
    save_at(&path, &many).expect("저장");
    assert_eq!(load_at(&path).triggers.len(), MAX_TRIGGERS);
}

#[test]
fn broken_trigger_entries_fall_back_to_defaults_like_any_other_bad_file() {
    let tmp = TempDir::new("트리거깨짐");
    let path = tmp.path("settings.toml");
    // pattern 이 없는 항목 = 필수 필드 누락 → 파일 전체를 못 믿는다 (기존 규칙).
    std::fs::write(&path, "[[triggers]]\nbg = \"#000000\"\n").expect("쓰기");
    assert_eq!(load_at(&path), AppSettings::default());
}

#[test]
fn webgl_defaults_to_unset_and_round_trips() {
    let tmp = TempDir::new("webgl");

    let path = tmp.path("off.toml");
    std::fs::write(&path, "[terminal]\nwebgl = false\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.webgl, Some(false));

    // 안 정하면 키가 없다 — 프런트가 "켬" 으로 읽는다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("webgl"));
    assert_eq!(load_at(&path).terminal.webgl, None);
}

/// 원격 클립보드 쓰기 — `[terminal] osc52_clipboard`. `webgl` 과 **같은 배관**이라
/// 기본이 켬이고 끈 사람의 파일에만 `false` 가 남는다. 읽기 요청(`?`) 거부는 이 값과
/// 무관한 프런트의 불변이라 여기서 잴 것이 없다 (docs/log/2026-09-23-osc52-osc8.md).
#[test]
fn osc52_clipboard_defaults_to_unset_and_round_trips() {
    let tmp = TempDir::new("osc52");

    let path = tmp.path("off.toml");
    std::fs::write(&path, "[terminal]\nosc52_clipboard = false\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.osc52_clipboard, Some(false));

    // 안 정하면 키가 없다 — 프런트가 "켬" 으로 읽는다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("osc52_clipboard"));
    assert_eq!(load_at(&path).terminal.osc52_clipboard, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("osc52_clipboard = false"), "{text}");
    assert_eq!(load_at(&path).terminal.osc52_clipboard, Some(false));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"osc52_clipboard\":false"), "{json}");
}

/// 프로그램 알림 · 인라인 이미지 — `[terminal] osc_notify` · `inline_images`. 둘 다
/// `osc52_clipboard` 와 **같은 배관**이라 기본이 켬이고 끈 사람의 파일에만 `false` 가 남는다
/// (docs/log/2026-09-26-osc-notify-inline-images.md).
#[test]
fn osc_notify_and_inline_images_default_to_unset_and_round_trip() {
    let tmp = TempDir::new("osc-notify");

    let path = tmp.path("off.toml");
    std::fs::write(
        &path,
        "[terminal]
osc_notify = false
inline_images = false
",
    )
    .expect("쓰기");
    let loaded = load_at(&path).terminal;
    assert_eq!(loaded.osc_notify, Some(false));
    assert_eq!(loaded.inline_images, Some(false));

    // 안 정하면 키가 없다 — 프런트가 "켬" 으로 읽는다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("osc_notify"), "{text}");
    assert!(!text.contains("inline_images"), "{text}");
    let loaded = load_at(&path).terminal;
    assert_eq!(loaded.osc_notify, None);
    assert_eq!(loaded.inline_images, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("osc_notify = false"), "{text}");
    assert!(text.contains("inline_images = false"), "{text}");
    let loaded = load_at(&path).terminal;
    assert_eq!(loaded.osc_notify, Some(false));
    assert_eq!(loaded.inline_images, Some(false));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"osc_notify\":false"), "{json}");
    assert!(json.contains("\"inline_images\":false"), "{json}");
}

/// 걷은 아크릴 설정(10-22) — 예전 파일의 `[app] acrylic = true`(또는 그 옛 이름 `transparent = true`)가
/// 남아 있어도 파일 전체가 그대로 읽힌다(모르는 키는 serde 가 버린다 — `deny_unknown_fields` 를 달지 말 것).
/// 같은 표의 다른 값이 기본값으로 떨어지지 않고, 다시 저장하면 그 키는 사라진다.
#[test]
fn removed_acrylic_key_in_old_file_still_loads() {
    let tmp = TempDir::new("옛아크릴");

    for (name, key) in [("acrylic.toml", "acrylic"), ("transparent.toml", "transparent")] {
        let path = tmp.path(name);
        std::fs::write(&path, format!("[app]\naccent = \"#c25b4a\"\n{key} = true\nopacity = 70\n"))
            .expect("쓰기");
        let s = load_at(&path);
        assert_eq!(s.app.accent.as_deref(), Some("#c25b4a"), "{key}");
        assert_eq!(s.app.opacity, Some(70), "{key}");

        let rewritten = tmp.path(&format!("re-{name}"));
        save_at(&rewritten, &s).expect("저장");
        let text = std::fs::read_to_string(&rewritten).expect("읽기");
        assert!(!text.contains(key), "{text}");
        assert!(text.contains("opacity = 70"), "{text}");
    }
}

/// 투명도는 창 투명의 **주 조절값**이다 — 0~100 밖은 버리고(=기본 100), 안 정하면 안 적는다.
#[test]
fn opacity_is_clamped_to_percent_and_round_trips() {
    let tmp = TempDir::new("투명도");

    for (raw, expected) in [
        ("0", Some(0)),
        ("50", Some(50)),
        ("100", Some(100)),
        ("101", None),
        ("255", None),
    ] {
        let path = tmp.path(&format!("o{raw}.toml"));
        std::fs::write(&path, format!("[app]\nopacity = {raw}\n")).expect("쓰기");
        assert_eq!(load_at(&path).app.opacity, expected, "opacity = {raw}");
    }

    // 안 정하면 키가 없다 — 프런트가 기본값(100 = 불투명) 으로 읽는다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("opacity"));
    assert_eq!(load_at(&path).app.opacity, None);
}

/// 터미널 불투명도 — `[terminal] opacity`. `[app] opacity` 와 **다른 칸**이고, 범위 밖은
/// 버리는 대신 **자른다**(10~100). 안 정하면 키가 없고 프런트가 100(불투명)으로 읽는다.
#[test]
fn term_opacity_is_clamped_and_round_trips() {
    let tmp = TempDir::new("터미널투명도");

    for (raw, expected) in [
        ("0", Some(10)),
        ("9", Some(10)),
        ("10", Some(10)),
        ("85", Some(85)),
        ("100", Some(100)),
        ("255", Some(100)),
    ] {
        let path = tmp.path(&format!("t{raw}.toml"));
        std::fs::write(&path, format!("[terminal]\nopacity = {raw}\n")).expect("쓰기");
        assert_eq!(load_at(&path).terminal.opacity, expected, "opacity = {raw}");
    }

    // 안 정하면 키가 없다. `[app] opacity` 와 섞이지 않는지도 같이 본다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert_eq!(load_at(&path).terminal.opacity, None);

    let path = tmp.path("both.toml");
    std::fs::write(&path, "[app]\nopacity = 70\n\n[terminal]\nopacity = 85\n").expect("쓰기");
    let loaded = load_at(&path);
    assert_eq!(loaded.app.opacity, Some(70));
    assert_eq!(loaded.terminal.opacity, Some(85));

    // 저장 후 다시 읽어도 두 칸이 각자 자리를 지킨다 (`[terminal.dynamic]` 헤더보다 앞에
    // 찍혀야 하는 필드 순서 계약도 여기서 함께 걸린다 — 뒤로 가면 하위 테이블에 먹힌다).
    let path = tmp.path("rt.toml");
    save_at(&path, &loaded).expect("저장");
    assert_eq!(load_at(&path), loaded);
}

/// 배치 복원 시 자동 재접속 — `[app] auto_reconnect`. 색 토큰이 아니라 동작 플래그지만
/// `[app]` 이 하나뿐이라 같은 테이블에 산다. 기본은 **끔**이라 켰을 때만 파일에 남는다.
#[test]
fn auto_reconnect_defaults_to_unset_and_round_trips() {
    let tmp = TempDir::new("자동재접속");

    let path = tmp.path("on.toml");
    std::fs::write(&path, "[app]\nauto_reconnect = true\n").expect("쓰기");
    assert_eq!(load_at(&path).app.auto_reconnect, Some(true));

    // 명시적으로 끈 것("false")도 그대로 보존한다 — "안 정함" 과 구분된다.
    let path = tmp.path("off.toml");
    std::fs::write(&path, "[app]\nauto_reconnect = false\n").expect("쓰기");
    assert_eq!(load_at(&path).app.auto_reconnect, Some(false));

    // 안 정하면 키가 없다 — 프런트가 "끔"(수동 재접속) 으로 읽는다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("auto_reconnect"));
    assert_eq!(load_at(&path).app.auto_reconnect, None);

    // 파일 왕복에서도 살아남는다.
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).expect("읽기");
    assert!(text.contains("auto_reconnect = true"), "{text}");
    assert_eq!(load_at(&path).app.auto_reconnect, Some(true));

    // 프런트 계약: JSON 에도 snake_case 그대로 나간다.
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"auto_reconnect\":true"), "{json}");
}

// ------------------------------------------------------------------
// 자격증명 금고 (`[vault]`)
// ------------------------------------------------------------------

/// **읽지 않는 칸이지만 남의 파일을 지우지는 않는다** (2026-09-19 저녁).
///
/// 옛 앱이 적어 둔 `[vault] auto_lock_minutes` 는 설정 화면의 [저장] 한 번을 지나도
/// 그대로 있어야 한다 — 저장이 파일 전체를 다시 쓰기 때문이다.
#[test]
fn the_old_vault_key_survives_a_save_and_is_not_written_when_unset() {
    let tmp = TempDir::new("금고");

    // 손으로 적어 둔 값이 그대로 읽힌다.
    let path = tmp.path("legacy.toml");
    std::fs::write(&path, "[vault]\nauto_lock_minutes = 0\n").expect("쓰기");
    assert_eq!(load_at(&path).vault.auto_lock_minutes, Some(0));

    // 그리고 저장(= 전체 재작성) 뒤에도 살아남는다.
    let kept = load_at(&path);
    save_at(&path, &kept).expect("저장");
    assert_eq!(load_at(&path).vault.auto_lock_minutes, Some(0));

    // 안 적힌 파일에는 `[vault]` 를 만들지 않는다 (다른 섹션과 같은 규칙).
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("[vault]"));

    // 파일 왕복에서 살아남는다.
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(load_at(&path).vault.auto_lock_minutes, Some(5));
}

/// `[hosts] sort` — 왕복하고, 안 정했으면 섹션 자체를 쓰지 않는다.
#[test]
fn hosts_sort_round_trips_and_is_omitted_when_unset() {
    let tmp = TempDir::new("호스트정렬");
    let path = tmp.path("hosts.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(load_at(&path).hosts.sort.as_deref(), Some("recent"));

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("[hosts]"));

    // 빈 값은 "안 정함" 으로 접힌다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[hosts]\nsort = \"  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).hosts.sort, None);
}

/// `[files] default_view` — 왕복하고, 안 정했으면 섹션 자체를 쓰지 않는다.
#[test]
fn files_default_view_round_trips_and_is_omitted_when_unset() {
    let tmp = TempDir::new("파일보기");
    let path = tmp.path("files.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(
        load_at(&path).files.default_view.as_deref(),
        Some("navigate")
    );

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("[files]"));

    // 빈 값은 "안 정함" 으로 접힌다 · 모르는 값은 보관만 한다(거르는 것은 프런트다).
    let path = tmp.path("blank.toml");
    std::fs::write(
        &path,
        "[files]
default_view = \"  \"
",
    )
    .expect("쓰기");
    assert_eq!(load_at(&path).files.default_view, None);
    std::fs::write(
        &path,
        "[files]
default_view = \"grid\"
",
    )
    .expect("쓰기");
    assert_eq!(load_at(&path).files.default_view.as_deref(), Some("grid"));
}

/// `[files] auto_refresh` — 끈 값이 왕복하고(기본 켬은 적지 않는다), 칸 하나만 있어도 `[files]` 가 선다.
#[test]
fn files_auto_refresh_round_trips() {
    let tmp = TempDir::new("자동새로고침");
    let path = tmp.path("files.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(load_at(&path).files.auto_refresh, Some(false));

    let mut only = AppSettings::default();
    only.files.auto_refresh = Some(false);
    let path = tmp.path("only.toml");
    save_at(&path, &only).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("[files]") && text.contains("auto_refresh = false"));
    assert_eq!(load_at(&path).files.auto_refresh, Some(false));
}

/// `[projects] start_screen` — 왕복하고, 안 정했으면 섹션 자체를 쓰지 않는다.
#[test]
fn projects_start_screen_round_trips_and_is_omitted_when_unset() {
    let tmp = TempDir::new("시작화면");
    let path = tmp.path("projects.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(load_at(&path).projects.start_screen.as_deref(), Some("off"));

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("[projects]"));

    // 빈 값은 "안 정함" 으로 접힌다 · 모르는 값은 보관만 한다(거르는 것은 프런트다).
    let path = tmp.path("blank.toml");
    std::fs::write(
        &path,
        "[projects]
start_screen = \"  \"
",
    )
    .expect("쓰기");
    assert_eq!(load_at(&path).projects.start_screen, None);
    std::fs::write(
        &path,
        "[projects]
start_screen = \"always\"
",
    )
    .expect("쓰기");
    assert_eq!(
        load_at(&path).projects.start_screen.as_deref(),
        Some("always")
    );
}

// ------------------------------------------------------------------
// 자동 승인 정책 (`[automation]`) — 단계 10b
// ------------------------------------------------------------------

/// 기본은 전부 끔·비움 + 상한 기본값. 파일에 섹션이 없어도 그 값으로 채워진다.
#[test]
fn automation_defaults_to_off_and_is_not_written_when_default() {
    let tmp = TempDir::new("자동승인기본");

    // 섹션이 없으면 기본값(끔·빈 목록·10·4).
    let path = tmp.path("none.toml");
    std::fs::write(&path, "[terminal]\nfont_size = 14\n").expect("쓰기");
    let a = load_at(&path).automation;
    assert!(!a.auto_approve);
    assert!(a.allow_patterns.is_empty());
    assert_eq!(a.max_targets, 10);
    assert_eq!(a.max_concurrency, 4);

    // 기본값이면 파일에 `[automation]` 을 안 쓴다 (다른 섹션과 같은 규칙).
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("[automation]"));
    assert_eq!(load_at(&path).automation, AutomationPrefs::default());
}

/// 구조적 허용의 **옛 모양**(`exec`·`subcommands` 만)은 그대로 읽히고, 저장해도 새 칸이 생기지
/// 않는다 — 인자 제약은 사용자가 적었을 때만 산다(2026-10-05 하위 호환).
#[test]
fn allow_rule_old_shape_round_trips_without_new_keys() {
    let tmp = TempDir::new("구조적허용호환");
    let path = tmp.path("old.toml");
    std::fs::write(
        &path,
        "[automation]\nauto_approve = true\n\n[[automation.allow]]\nexec = \"git\"\nsubcommands = [\"branch\"]\n\n[[automation.allow]]\nexec = \"df\"\n",
    )
    .expect("쓰기");
    let a = load_at(&path).automation;
    assert_eq!(a.allow.len(), 2);
    assert_eq!(a.allow[0].exec, "git");
    assert_eq!(a.allow[0].subcommands, ["branch"]);
    assert!(a.allow[0].deny_flags.is_empty());
    assert!(a.allow[0].allow_flags.is_empty());
    assert!(a.allow[0].require_flags.is_empty());
    assert!(a.allow[0].first_arg.is_empty());
    assert_eq!(a.allow[0].max_args, None);

    let mut s = load_at(&path);
    s.automation.allow = a.allow.clone();
    save_at(&path, &s).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    for key in [
        "deny_flags",
        "allow_flags",
        "require_flags",
        "first_arg",
        "max_args",
    ] {
        assert!(!text.contains(key), "옛 규칙 저장에 {key} 가 생겼다:\n{text}");
    }
    assert_eq!(load_at(&path).automation.allow, a.allow);

    // 새 칸은 손으로 적으면 읽힌다(빈 항목은 sanitize 가 버리고, 형식이 틀린 금지 항목은 지우지 않는다).
    std::fs::write(
        &path,
        "[[automation.allow]]\nexec = \"journalctl\"\ndeny_flags = [\" -f \", \"\", \"follow\"]\nmax_args = 0\n",
    )
    .expect("쓰기");
    let r = &load_at(&path).automation.allow[0];
    assert_eq!(r.deny_flags, ["-f", "follow"]);
    assert_eq!(r.max_args, Some(0));
}

/// 상한은 제정신 범위로 **자른다**(1..=100 · 1..=16). 손으로 적은 0·거대값이 뚫지 못한다.
#[test]
fn automation_limits_are_clamped() {
    let tmp = TempDir::new("자동승인상한");

    let path = tmp.path("clamp.toml");
    std::fs::write(
        &path,
        "[automation]\nauto_approve = true\nmax_targets = 0\nmax_concurrency = 999\n",
    )
    .expect("쓰기");
    let a = load_at(&path).automation;
    assert_eq!(a.max_targets, 1, "0 은 하한 1 로");
    assert_eq!(a.max_concurrency, 16, "999 는 상한 16 으로");

    let path = tmp.path("high.toml");
    std::fs::write(&path, "[automation]\nmax_targets = 5000\n").expect("쓰기");
    assert_eq!(load_at(&path).automation.max_targets, 100, "상한 100 으로");

    // 좁은 조회(automation_prefs)도 같은 (자른) 값을 돌려준다 — 권위 게이트가 이걸 읽는다.
    // (automation_prefs 는 settings_path 를 쓰므로 여기선 sanitize 결과만 확인)
    let mut s = AppSettings {
        automation: AutomationPrefs {
            auto_approve: true,
            allow_patterns: vec![],
            bundles: vec![],
            max_targets: 0,
            max_concurrency: 0,
            auto_max_per_window: 0,
            auto_window_secs: 0,
            approval_ttl_minutes: 0,
            notify_review_requests: true,
            notify_operation_results: true,
            audit_retention_days: 99_999,
            audit_output_excerpt: false,
            allow_pipes: false,
            bundle_off: BTreeMap::new(),
            allow: vec![],
        },
        ..AppSettings::default()
    };
    s.sanitize();
    assert_eq!(s.automation.max_targets, 1);
    assert_eq!(s.automation.max_concurrency, 1);
    // A4c: 0 은 하한 1 로 — 자동 승인이 켜지면 언제나 유한 상한이 걸린다.
    assert_eq!(s.automation.auto_max_per_window, 1, "빈도 한도 0 은 1 로");
    assert_eq!(s.automation.auto_window_secs, 1, "창 0 은 1 로");
    // 검토 대기 만료만은 **0 이 그대로 산다** — "만료 없음" 이라는 답이다.
    assert_eq!(
        s.automation.approval_ttl_minutes, 0,
        "TTL 0 은 0 그대로(만료 없음)"
    );
    assert_eq!(
        s.automation.audit_retention_days, 3650,
        "보관 일수는 10년으로 자른다"
    );
}

/// 검토 대기 만료(`approval_ttl_minutes`) — 기본 30분 · 0 은 살고 · 위는 하루로 잘린다.
#[test]
fn approval_ttl_defaults_and_clamps() {
    let tmp = TempDir::new("검토만료");

    // 섹션이 없으면 기본값 30분.
    let path = tmp.path("none.toml");
    std::fs::write(&path, "[terminal]\nfont_size = 14\n").expect("쓰기");
    assert_eq!(load_at(&path).automation.approval_ttl_minutes, 30);

    // 0 = 만료 없음 — 하한으로 접지 않는다(사용자의 답이다).
    let path = tmp.path("zero.toml");
    std::fs::write(&path, "[automation]\napproval_ttl_minutes = 0\n").expect("쓰기");
    assert_eq!(load_at(&path).automation.approval_ttl_minutes, 0);

    // 하루(1440분)를 넘는 값은 잘린다.
    let path = tmp.path("high.toml");
    std::fs::write(&path, "[automation]\napproval_ttl_minutes = 99999\n").expect("쓰기");
    assert_eq!(load_at(&path).automation.approval_ttl_minutes, 1440);

    // 기본값 하나만 달라도 파일에 적힌다(다른 칸과 같은 규칙 — 왕복 보존).
    let path = tmp.path("roundtrip.toml");
    let mut s = AppSettings::default();
    s.automation.approval_ttl_minutes = 5;
    save_at(&path, &s).expect("저장");
    assert_eq!(load_at(&path).automation.approval_ttl_minutes, 5);
}

/// 검토 요청 OS 알림(`notify_review_requests`) — **기본 켬**이고, 꺼 둔 값은 왕복에서 산다.
///
/// 이 섹션에서 유일하게 기본이 참인 칸이라 위험이 정확히 둘이다: ① 칸이 없는 옛 파일을
/// 읽고 조용해지는 것(→ `serde(default)` 가 켜야 한다), ② 사람이 끈 것을 저장이 되살리는 것.
#[test]
fn notify_review_requests_defaults_on_and_keeps_an_explicit_off() {
    let tmp = TempDir::new("검토알림");

    // ① 섹션이 없으면 **켬** — 이 기능을 만진 적 없는 파일도 알림을 받는다.
    let path = tmp.path("none.toml");
    std::fs::write(&path, "[terminal]\nfont_size = 14\n").expect("쓰기");
    assert!(
        load_at(&path).automation.notify_review_requests,
        "칸이 없으면 켬"
    );

    // 섹션은 있는데 이 칸만 없는 파일(옛 버전이 쓴 파일)도 마찬가지다.
    let path = tmp.path("partial.toml");
    std::fs::write(&path, "[automation]\napproval_ttl_minutes = 10\n").expect("쓰기");
    assert!(
        load_at(&path).automation.notify_review_requests,
        "옛 파일도 켬"
    );

    // ② 명시적 `false` 는 그대로 읽히고, 저장을 한 번 지나도 살아남는다.
    let path = tmp.path("off.toml");
    std::fs::write(&path, "[automation]\nnotify_review_requests = false\n").expect("쓰기");
    let s = load_at(&path);
    assert!(!s.automation.notify_review_requests, "끈 값은 끈 채로");
    let path = tmp.path("off-roundtrip.toml");
    save_at(&path, &s).expect("저장");
    assert!(
        !load_at(&path).automation.notify_review_requests,
        "저장이 되살리지 않는다"
    );
}

/// 실행 결과 OS 알림(`notify_operation_results`) — 검토 요청 알림과 같은 규칙(기본 켬 · 끈 값은 산다).
#[test]
fn notify_operation_results_defaults_on_and_keeps_an_explicit_off() {
    let tmp = TempDir::new("실행결과알림");

    let path = tmp.path("none.toml");
    std::fs::write(
        &path,
        "[terminal]
font_size = 14
",
    )
    .expect("쓰기");
    assert!(
        load_at(&path).automation.notify_operation_results,
        "칸이 없으면 켬"
    );

    let path = tmp.path("partial.toml");
    std::fs::write(
        &path,
        "[automation]
notify_review_requests = false
",
    )
    .expect("쓰기");
    let s = load_at(&path);
    assert!(s.automation.notify_operation_results, "옛 파일도 켬");
    assert!(!s.automation.notify_review_requests, "짝 칸과 따로 산다");

    let path = tmp.path("off.toml");
    std::fs::write(
        &path,
        "[automation]
notify_operation_results = false
",
    )
    .expect("쓰기");
    let s = load_at(&path);
    assert!(!s.automation.notify_operation_results, "끈 값은 끈 채로");
    let path = tmp.path("off-roundtrip.toml");
    save_at(&path, &s).expect("저장");
    assert!(
        !load_at(&path).automation.notify_operation_results,
        "저장이 되살리지 않는다"
    );
}

/// 감사 보관 일수·출력 발췌(docs/log/2026-09-28-run-history.md) — 칸이 없으면 90일·끔,
/// `0`(지우지 않음)은 0 그대로 살고, 켠 발췌는 왕복에서 살아남는다.
#[test]
fn audit_retention_and_excerpt_defaults_and_roundtrip() {
    let tmp = TempDir::new("감사보관");

    let path = tmp.path("none.toml");
    std::fs::write(&path, "[automation]\napproval_ttl_minutes = 10\n").expect("쓰기");
    let a = load_at(&path).automation;
    assert_eq!(a.audit_retention_days, 90, "칸이 없으면 90일");
    assert!(!a.audit_output_excerpt, "칸이 없으면 발췌는 끔");

    let path = tmp.path("zero.toml");
    std::fs::write(
        &path,
        "[automation]\naudit_retention_days = 0\naudit_output_excerpt = true\n",
    )
    .expect("쓰기");
    let s = load_at(&path);
    assert_eq!(
        s.automation.audit_retention_days, 0,
        "0 = 지우지 않음 — 하한으로 접지 않는다"
    );
    assert!(s.automation.audit_output_excerpt);
    let path = tmp.path("zero-roundtrip.toml");
    save_at(&path, &s).expect("저장");
    let back = load_at(&path).automation;
    assert_eq!(back.audit_retention_days, 0);
    assert!(back.audit_output_excerpt, "켠 발췌가 저장에서 살아남는다");

    let path = tmp.path("huge.toml");
    std::fs::write(&path, "[automation]\naudit_retention_days = 99999\n").expect("쓰기");
    assert_eq!(load_at(&path).automation.audit_retention_days, 3650);
}

/// A4c 빈도 한도의 기본값과 상한. 섹션이 없으면 20건/300초, 거대값은 잘린다.
#[test]
fn automation_rate_limit_defaults_and_clamps() {
    let tmp = TempDir::new("빈도한도");

    // 섹션이 없으면 기본값(20 / 300s).
    let path = tmp.path("none.toml");
    std::fs::write(&path, "[terminal]\nfont_size = 14\n").expect("쓰기");
    let a = load_at(&path).automation;
    assert_eq!(a.auto_max_per_window, 20);
    assert_eq!(a.auto_window_secs, 300);

    // 거대값은 상한(1000 / 86400)으로 잘린다.
    let path = tmp.path("high.toml");
    std::fs::write(
        &path,
        "[automation]\nauto_max_per_window = 99999\nauto_window_secs = 999999\n",
    )
    .expect("쓰기");
    let a = load_at(&path).automation;
    assert_eq!(a.auto_max_per_window, 1000, "빈도 한도 상한 1000");
    assert_eq!(a.auto_window_secs, 86_400, "창 상한 하루");
}

/// allow_patterns 는 공백·빈 값·중복을 정리하되 순서를 보존한다.
#[test]
fn automation_patterns_are_trimmed_deduped_and_ordered() {
    let tmp = TempDir::new("자동승인패턴");

    let path = tmp.path("patterns.toml");
    std::fs::write(
        &path,
        "[automation]\nallow_patterns = [\"  df  \", \"uptime\", \"df\", \"\", \"   \", \"ls -la\"]\n",
    )
    .expect("쓰기");
    let a = load_at(&path).automation;
    assert_eq!(
        a.allow_patterns,
        vec!["df".to_string(), "uptime".to_string(), "ls -la".to_string()],
        "공백 제거 · 빈 값 제거 · 중복 제거 · 순서 보존"
    );
}

/// 켠 정책은 파일 왕복에서 그대로 살아남고, JSON 계약도 snake_case 그대로다.
#[test]
fn automation_round_trips_and_serializes_snake_case() {
    let tmp = TempDir::new("자동승인왕복");
    let path = tmp.path("settings.toml");
    save_at(&path, &sample()).expect("저장");

    let text = std::fs::read_to_string(&path).expect("읽기");
    assert!(text.contains("[automation]"), "{text}");
    assert!(text.contains("auto_approve = true"), "{text}");
    // 구조적 규칙도 파일 왕복에서 그대로 살아남는다(저장이 손편집 규칙을 지우지 않는다).
    assert!(text.contains("[[automation.allow]]"), "{text}");
    assert!(text.contains("exec = \"systemctl\""), "{text}");
    assert_eq!(load_at(&path), sample());

    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"auto_approve\":true"), "{json}");
    assert!(json.contains("\"max_targets\":8"), "{json}");
    assert!(json.contains("\"max_concurrency\":3"), "{json}");
    // A4c 빈도 한도도 왕복·JSON 계약에 그대로 실린다.
    assert!(text.contains("auto_max_per_window = 15"), "{text}");
    assert!(text.contains("auto_window_secs = 120"), "{text}");
    assert!(json.contains("\"auto_max_per_window\":15"), "{json}");
    assert!(json.contains("\"auto_window_secs\":120"), "{json}");
    assert!(
        json.contains("\"allow_patterns\":[\"df\",\"uptime\"]"),
        "{json}"
    );
    // 묶음 id 도 파일·JSON 왕복에 그대로 실린다(`[[automation.allow]]` 보다 **앞**에 쓰여야
    // TOML 이 깨지지 않는다 — 배열-of-테이블 뒤의 스칼라는 그 테이블의 필드가 된다).
    assert!(
        text.contains("bundles = [\n    \"system\",\n    \"git\",\n]"),
        "{text}"
    );
    assert!(json.contains("\"bundles\":[\"system\",\"git\"]"), "{json}");
    // 끈 명령 — `[automation.bundle_off]` 표, JSON 은 묶음 id → 키 목록.
    assert!(text.contains("[automation.bundle_off]"), "{text}");
    assert!(text.contains("files = [\"cat\"]"), "{text}");
    assert!(
        json.contains("\"bundle_off\":{\"files\":[\"cat\"],\"system\":[\"date\",\"who\"]}"),
        "{json}"
    );
    // JSON 계약: allow 는 snake_case 필드명 그대로(exec·subcommands). 인자 제약이 없는 규칙은
    // 새 칸을 싣지 않는다(옛 모양 그대로), 있는 규칙은 snake_case 로 싣는다.
    assert!(
        json.contains(
            "\"allow\":[{\"exec\":\"systemctl\",\"subcommands\":[\"is-active\",\"status\"]},"
        ),
        "{json}"
    );
    assert!(
        json.contains(
            "{\"exec\":\"ip\",\"subcommands\":[\"addr\"],\"deny_flags\":[\"-batch\"],\"allow_flags\":[\"-br\"],\"require_flags\":[\"-4\"],\"first_arg\":[\"show\"],\"max_args\":0,\"sub_first\":true}"
        ),
        "{json}"
    );
}

/// 묶음 id 목록 — 패턴과 같은 정리(공백·빈 값·중복)를 받되 **모르는 id 는 살아남는다**.
#[test]
fn automation_bundles_are_cleaned_but_unknown_ids_survive() {
    let tmp = TempDir::new("묶음");
    let path = tmp.path("bundles.toml");
    std::fs::write(
        &path,
        "[automation]\nbundles = [\"  system  \", \"\", \"system\", \"from-the-future\"]\n",
    )
    .expect("쓰기");
    let a = load_at(&path).automation;
    assert_eq!(
        a.bundles,
        vec!["system".to_string(), "from-the-future".to_string()],
        "공백 제거·빈 값 제거·중복 제거·순서 보존 + 모르는 id 보존"
    );
    // 모르는 id 는 규칙을 하나도 열지 않는다(보존은 하되 해석은 안 한다).
    let rules = crate::automation_presets::effective_allow_rules(&a);
    assert!(rules.iter().any(|r| r.exec == "df"), "아는 묶음은 펼쳐진다");
    // 기본은 빈 목록이다(기본 거부 그대로).
    assert!(AutomationPrefs::default().bundles.is_empty());
    assert!(AutomationPrefs::default().bundle_off.is_empty());
}

/// 끈 명령 표 — 공백·빈 값·중복을 정리하고 빈 목록은 칸째 버린다. 모르는 묶음·키는 남는다.
#[test]
fn automation_bundle_off_is_cleaned_and_unknown_values_survive() {
    let tmp = TempDir::new("끈명령");
    let path = tmp.path("off.toml");
    std::fs::write(
        &path,
        "[automation]\nbundles = [\"files\"]\n\n[automation.bundle_off]\nfiles = [\" cat \", \"\", \"cat\", \"zzz\"]\nempty = [\"\"]\nfuture = [\"x\"]\n",
    )
    .expect("쓰기");
    let a = load_at(&path).automation;
    assert_eq!(
        a.bundle_off.get("files").unwrap(),
        &vec!["cat".to_string(), "zzz".to_string()]
    );
    assert!(!a.bundle_off.contains_key("empty"), "빈 목록은 칸째 버린다");
    assert_eq!(a.bundle_off.get("future").unwrap(), &vec!["x".to_string()]);
    // 판정에서 빠진다.
    let on = AutomationPrefs {
        auto_approve: true,
        ..a
    };
    assert!(!crate::policy::command_passes_auto_policy("cat x", &on));
    assert!(crate::policy::command_passes_auto_policy("ls", &on));
    // 비면 파일에 안 적힌다.
    let mut s = AppSettings::default();
    s.automation.bundles = vec!["files".to_string()];
    let text = toml::to_string(&s).expect("직렬화");
    assert!(!text.contains("bundle_off"), "{text}");
}

/// 옛 묶음 id 는 읽을 때 새 id 로 옮겨지고(옛 묶음에 없던 명령은 꺼진 채로), 저장하면 새 형식이다.
#[test]
fn legacy_bundle_ids_migrate_on_load_and_save_in_the_new_shape() {
    let tmp = TempDir::new("옛묶음");
    let path = tmp.path("legacy.toml");
    std::fs::write(
        &path,
        "[automation]\nauto_approve = true\nbundles = [\"diag-readonly\", \"git-readonly\"]\n",
    )
    .expect("쓰기");
    let s = load_at(&path);
    let a = &s.automation;
    assert_eq!(a.bundles[0], "system");
    assert!(a.bundles.iter().any(|b| b == "gitfetch"));
    assert!(!a.bundles.iter().any(|b| b.ends_with("-readonly")));
    assert!(a.bundle_off["system"].iter().any(|k| k == "nproc"));
    let text = toml::to_string(&s).expect("직렬화");
    assert!(!text.contains("readonly"), "{text}");
    assert!(text.contains("[automation.bundle_off]"), "{text}");
    // 다시 읽어도 같다(멱등).
    std::fs::write(&path, &text).expect("쓰기");
    assert_eq!(load_at(&path).automation, s.automation);
}

/// 손으로 적은 `[[automation.allow]]` 가 파싱되고, sanitize 가 공백·빈 값을 정리한다.
#[test]
fn structured_allow_parses_and_sanitizes() {
    let tmp = TempDir::new("구조적allow");
    let path = tmp.path("allow.toml");
    std::fs::write(
        &path,
        "[automation]\nauto_approve = true\n\n\
             [[automation.allow]]\nexec = \"  systemctl  \"\nsubcommands = [\"is-active\", \"\", \"  status  \"]\n\n\
             [[automation.allow]]\nexec = \"df\"\n\n\
             [[automation.allow]]\nexec = \"   \"\nsubcommands = [\"x\"]\n",
    )
    .expect("쓰기");
    let a = load_at(&path).automation;
    // exec 가 빈(공백뿐) 규칙은 버려진다 → 두 개만 남는다.
    assert_eq!(a.allow.len(), 2, "빈 exec 규칙 제거");
    assert_eq!(a.allow[0].exec, "systemctl", "exec 공백 제거");
    assert_eq!(
        a.allow[0].subcommands,
        vec!["is-active".to_string(), "status".to_string()],
        "서브커맨드 공백 제거·빈 값 제거"
    );
    assert_eq!(a.allow[1].exec, "df");
    assert!(
        a.allow[1].subcommands.is_empty(),
        "생략된 subcommands = 빈 목록"
    );
}

/// 타일 배치 방식 — `[app] tiling`. `tab_style` 과 같은 **"보관만"** 분담이라 모르는
/// 값도 그대로 들고 있고(거르는 쪽은 프런트다), 공백만 있는 값은 "안 정함"으로 접는다.
#[test]
fn tiling_is_kept_verbatim_and_folds_blank() {
    let tmp = TempDir::new("타일배치");

    let path = tmp.path("focus.toml");
    std::fs::write(&path, "[app]\ntiling = \"focus\"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.tiling.as_deref(), Some("focus"));

    // 모르는 값도 버리지 않는다 — 프런트가 기본(spiral)으로 떨어뜨린다.
    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[app]\ntiling = \"  bsp  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.tiling.as_deref(), Some("bsp"));

    // 빈 값·안 정함은 둘 다 `None` 이고 파일에 키가 안 남는다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[app]\ntiling = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.tiling, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("tiling"));
    assert_eq!(load_at(&path).app.tiling, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("tiling = \"focus\""));
    assert_eq!(load_at(&path).app.tiling.as_deref(), Some("focus"));
    assert!(serde_json::to_string(&sample())
        .expect("JSON")
        .contains("\"tiling\":\"focus\""));
}

/// 터미널 우클릭 동작 — `[terminal] right_click`. `tiling` 과 같은 **"보관만"** 분담이라
/// 모르는 값도 그대로 들고 있고, 공백만 있는 값은 "안 정함"으로 접힌다. 붙여넣기 확인
/// (`confirm_multiline_paste`)은 그 옆줄이라 같은 테스트에서 함께 붙든다 — 기본이 **켬**이라
/// 파일에 남는 값은 `false` 뿐이다.
#[test]
fn right_click_is_kept_verbatim_and_paste_confirm_roundtrips() {
    let tmp = TempDir::new("우클릭");

    let path = tmp.path("paste.toml");
    std::fs::write(&path, "[terminal]\nright_click = \"paste\"\n").expect("쓰기");
    assert_eq!(
        load_at(&path).terminal.right_click.as_deref(),
        Some("paste")
    );

    // 모르는 값도 버리지 않는다 — 프런트가 기본(menu)으로 떨어뜨린다.
    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[terminal]\nright_click = \"  putty  \"\n").expect("쓰기");
    assert_eq!(
        load_at(&path).terminal.right_click.as_deref(),
        Some("putty")
    );

    // 빈 값·안 정함은 둘 다 `None` 이고 파일에 키가 안 남는다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[terminal]\nright_click = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.right_click, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("right_click"), "{text}");
    assert!(!text.contains("confirm_multiline_paste"), "{text}");
    assert_eq!(load_at(&path).terminal.confirm_multiline_paste, None);
    // 인라인 스니펫 제안도 같은 규칙이다 (기본 켬 → 안 정하면 키가 없다).
    assert!(!text.contains("inline_snippets"), "{text}");
    assert_eq!(load_at(&path).terminal.inline_snippets, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("right_click = \"paste\""), "{text}");
    assert!(text.contains("confirm_multiline_paste = false"), "{text}");
    assert!(text.contains("inline_snippets = false"), "{text}");
    let back = load_at(&path);
    assert_eq!(back.terminal.right_click.as_deref(), Some("paste"));
    assert_eq!(back.terminal.confirm_multiline_paste, Some(false));
    assert_eq!(back.terminal.inline_snippets, Some(false));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"right_click\":\"paste\""), "{json}");
    assert!(json.contains("\"confirm_multiline_paste\":false"), "{json}");
    assert!(json.contains("\"inline_snippets\":false"), "{json}");
}

/// AI 타일 시작 폴더 — `[ai] start_dir`. `shell.default` 와 같은 **"보관만"** 분담이라
/// 없는 폴더도 그대로 들고 있고(존재 여부는 `crate::pty::spawn_cwd` 가 본다), 공백만
/// 있는 값은 "안 정함"으로 접힌다.
#[test]
fn ai_start_dir_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("AI시작폴더");

    let path = tmp.path("set.toml");
    std::fs::write(&path, "[ai]\nstart_dir = 'C:\\src\\proj'\n").expect("쓰기");
    assert_eq!(
        load_at(&path).ai.start_dir.as_deref(),
        Some("C:\\src\\proj")
    );

    // 공백은 떼고, 지금 없는 폴더도 버리지 않는다 (외장·네트워크 경로가 다시 붙는다).
    let path = tmp.path("trim.toml");
    std::fs::write(&path, "[ai]\nstart_dir = '  D:\\없는폴더  '\n").expect("쓰기");
    assert_eq!(load_at(&path).ai.start_dir.as_deref(), Some("D:\\없는폴더"));

    // 빈 값·안 정함은 둘 다 `None` 이고 파일에 키가 안 남는다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[ai]\nstart_dir = '   '\n").expect("쓰기");
    assert_eq!(load_at(&path).ai.start_dir, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("start_dir"));
    assert_eq!(load_at(&path).ai.start_dir, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(
        load_at(&path).ai.start_dir.as_deref(),
        Some("C:\\src\\myproject")
    );
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"start_dir\":"), "{json}");
}

/// 끈 에이전트 — `[ai] disabled_agents`. 비면 파일에 안 적히고(= 모두 사용), 공백·빈 값·중복만 걸러 내며
/// **모르는 id 는 남긴다**(새 버전의 에이전트를 끈 파일을 옛 버전이 저장해도 살아 있게).
#[test]
fn disabled_agents_are_cleaned_kept_and_absent_when_empty() {
    let tmp = TempDir::new("끈에이전트");

    let path = tmp.path("set.toml");
    std::fs::write(
        &path,
        "[ai]\ndisabled_agents = [' codex ', '', 'codex', 'gemini']\n",
    )
    .expect("쓰기");
    assert_eq!(
        load_at(&path).ai.disabled_agents,
        vec!["codex".to_string(), "gemini".to_string()]
    );

    // 비었으면 키가 안 남는다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("disabled_agents"));
    assert!(load_at(&path).ai.disabled_agents.is_empty());

    // 파일 왕복 — `[ai.args]` · `[[ai.mcp_servers]]` 표와 함께 적혀도 다시 읽힌다 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("disabled_agents = [\"codex\"]"), "{text}");
    assert_eq!(load_at(&path).ai.disabled_agents, vec!["codex".to_string()]);
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"disabled_agents\":[\"codex\"]"), "{json}");
}

/// 머리줄 칩 — `[app] header_chip_order` · `header_chips_hidden`. 비면 파일에 안 적히고, 공백 · 빈 값 · 중복만 걸러 내며
/// **모르는 id 는 남긴다**(정규화는 프런트 `header-chips.ts`). 파일 왕복과 프런트 계약(JSON 키 이름)도 본다.
#[test]
fn header_chip_lists_are_cleaned_kept_and_absent_when_empty() {
    let tmp = TempDir::new("머리줄칩");

    let path = tmp.path("set.toml");
    std::fs::write(
        &path,
        "[app]\nheader_chip_order = [' ai ', '', 'ai', 'future']\nheader_chips_hidden = ['resource', 'resource']\n",
    )
    .expect("쓰기");
    let loaded = load_at(&path);
    assert_eq!(
        loaded.app.header_chip_order,
        vec!["ai".to_string(), "future".to_string()]
    );
    assert_eq!(loaded.app.header_chips_hidden, vec!["resource".to_string()]);

    // 비었으면 키가 안 남는다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("header_chip"), "{text}");

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &loaded).expect("저장");
    assert_eq!(load_at(&path).app, loaded.app);
    let json = serde_json::to_string(&loaded).expect("JSON");
    assert!(json.contains("\"header_chip_order\":[\"ai\",\"future\"]"), "{json}");
    assert!(json.contains("\"header_chips_hidden\":[\"resource\"]"), "{json}");
}

/// 커서 모양 — `[terminal] cursor_style`. `right_click` 과 같은 **"보관만"** 분담이라
/// 모르는 값도 그대로 들고 있고, 공백만 있는 값은 "안 정함"으로 접힌다.
#[test]
fn cursor_style_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("커서모양");

    let path = tmp.path("bar.toml");
    std::fs::write(&path, "[terminal]\ncursor_style = \"bar\"\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.cursor_style.as_deref(), Some("bar"));

    // 공백은 떼고, 모르는 값도 버리지 않는다 — 프런트가 기본(block)으로 떨어뜨린다.
    let path = tmp.path("trim.toml");
    std::fs::write(&path, "[terminal]\ncursor_style = \"  underline  \"\n").expect("쓰기");
    assert_eq!(
        load_at(&path).terminal.cursor_style.as_deref(),
        Some("underline")
    );

    // 빈 값·안 정함은 둘 다 `None` 이고 파일에 키가 안 남는다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[terminal]\ncursor_style = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.cursor_style, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("cursor_style"));
    assert_eq!(load_at(&path).terminal.cursor_style, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름). sample 은 비기본값(underline)이다.
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("cursor_style = \"underline\""), "{text}");
    assert_eq!(
        load_at(&path).terminal.cursor_style.as_deref(),
        Some("underline")
    );
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"cursor_style\":\"underline\""), "{json}");
}

/// 긴 명령 알림 — `[terminal] notify_after_secs`. **`0` 을 접지 않는 유일한 숫자 필드**다
/// (`idle_lock_min` 과 정반대 — 저쪽은 기본이 끔, 이쪽은 기본이 켬이라 0 이 "껐다"는 뜻이다).
#[test]
fn notify_after_secs_keeps_zero_clamps_high_and_round_trips() {
    let tmp = TempDir::new("긴명령알림");

    let path = tmp.path("set.toml");
    std::fs::write(&path, "[terminal]\nnotify_after_secs = 45\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.notify_after_secs, Some(45));

    // **0 은 살아남는다** — "껐다"는 사용자의 선택이지 "안 정함"이 아니다.
    let path = tmp.path("zero.toml");
    std::fs::write(&path, "[terminal]\nnotify_after_secs = 0\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.notify_after_secs, Some(0));
    save_at(&path, &load_at(&path)).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("notify_after_secs = 0"));

    // 터무니없는 큰 값은 하루로 자른다 (사실상 끔이 되지 않게).
    let path = tmp.path("huge.toml");
    std::fs::write(&path, "[terminal]\nnotify_after_secs = 999999999\n").expect("쓰기");
    assert_eq!(
        load_at(&path).terminal.notify_after_secs,
        Some(MAX_AFTER_SECS)
    );

    // 안 정함이면 파일에 키 자체가 없다 (= 프런트 기본 10초).
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("notify_after_secs"));
    assert_eq!(load_at(&path).terminal.notify_after_secs, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(load_at(&path).terminal.notify_after_secs, Some(30));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"notify_after_secs\":30"), "{json}");
}

/// 보고 있는 타일의 턴 알림 — `[ai] notify_focused_after_secs`(초, 기본 60 · `0` = 끔).
/// `notify_after_secs` 와 같은 배관이다(`0` 을 살리고 위만 자른다).
#[test]
fn notify_focused_after_secs_keeps_zero_clamps_high_and_round_trips() {
    let tmp = TempDir::new("보는타일알림");

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("notify_focused_after_secs"));
    assert_eq!(load_at(&path).ai.notify_focused_after_secs, None);

    let path = tmp.path("zero.toml");
    std::fs::write(
        &path,
        "[ai]
notify_focused_after_secs = 0
",
    )
    .expect("쓰기");
    assert_eq!(load_at(&path).ai.notify_focused_after_secs, Some(0));
    save_at(&path, &load_at(&path)).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("notify_focused_after_secs = 0"));

    let path = tmp.path("huge.toml");
    std::fs::write(
        &path,
        "[ai]
notify_focused_after_secs = 999999999
",
    )
    .expect("쓰기");
    assert_eq!(
        load_at(&path).ai.notify_focused_after_secs,
        Some(MAX_AFTER_SECS)
    );

    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(load_at(&path).ai.notify_focused_after_secs, Some(120));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"notify_focused_after_secs\":120"), "{json}");
}

/// 메신저 알림 — `[messenger]`. 안 정했으면 섹션이 아예 안 적히고, 숫자 둘은 `0` 을 살리고 위만
/// 자르며, `when` 은 빈 값만 접는다(보관만). **웹훅 URL 은 이 파일에 적힐 자리가 없다.**
#[test]
fn messenger_prefs_skip_when_default_keep_zero_and_clamp() {
    let tmp = TempDir::new("메신저");

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("[messenger]"));
    assert_eq!(load_at(&path).messenger, MessengerPrefs::default());

    let path = tmp.path("edge.toml");
    std::fs::write(
        &path,
        "[messenger]\nenabled = true\nwhen = \"  \"\ncommand_min_secs = 999999999\naway_after_min = 0\n",
    )
    .expect("쓰기");
    let loaded = load_at(&path).messenger;
    // 옛 파일의 `enabled` 는 읽고 버린다 — 걷힌 전체 스위치
    assert_eq!(loaded.when, None);
    assert_eq!(loaded.command_min_secs, Some(MAX_AFTER_SECS));
    assert_eq!(loaded.away_after_min, Some(0));

    let path = tmp.path("huge-away.toml");
    std::fs::write(&path, "[messenger]\naway_after_min = 100000\n").expect("쓰기");
    assert_eq!(
        load_at(&path).messenger.away_after_min,
        Some(MAX_IDLE_LOCK_MIN)
    );

    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(
        text.contains("[messenger]") && text.contains("command_min_secs = 0"),
        "{text}"
    );
    assert!(!text.contains("webhook"), "{text}");
    assert!(text.contains("include_conversation = true"), "{text}");
    assert!(text.contains("discord = false"), "{text}");
    assert!(text.contains("slack = false"), "{text}");
    assert_eq!(load_at(&path).messenger, sample().messenger);

    // 대화 싣기는 안 정하면 끔 — 섹션이 없는 파일에서도, 다른 칸만 적힌 파일에서도.
    let path = tmp.path("no-convo.toml");
    std::fs::write(
        &path,
        "[messenger]
enabled = true
",
    )
    .expect("쓰기");
    assert_eq!(load_at(&path).messenger.include_conversation, None);
    // 채널 칸도 안 정하면 비어 있다(= 켬 — 기존 사용자는 그대로 Discord 로 간다).
    assert_eq!(load_at(&path).messenger.discord, None);
    assert_eq!(load_at(&path).messenger.slack, None);
}

/// 실행 시간 표식과 벨 — `[terminal] mark_after_secs`(초, 기본 3 · `0` = 끔) ·
/// `[terminal] bell`("보관만"). 표식 쪽은 `notify_after_secs` 와 **같은 배관**이라
/// (`0` 을 살리고 위만 자른다) 그 규칙을 여기서 한 번 더 붙든다.
#[test]
fn mark_after_secs_and_bell_round_trip() {
    let tmp = TempDir::new("표식과벨");

    // 안 정함이면 파일에 키 자체가 없다 (= 프런트 기본 3초).
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("mark_after_secs"), "{text}");
    assert!(!text.contains("bell"), "{text}");
    assert_eq!(load_at(&path).terminal.mark_after_secs, None);
    assert_eq!(load_at(&path).terminal.bell, None);

    // **0 은 살아남는다** — "껐다"는 사용자의 선택이지 "안 정함"이 아니다.
    let path = tmp.path("zero.toml");
    std::fs::write(&path, "[terminal]\nmark_after_secs = 0\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.mark_after_secs, Some(0));
    save_at(&path, &load_at(&path)).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("mark_after_secs = 0"));

    // 터무니없는 큰 값은 하루로 자른다 (사실상 끔이 되지 않게).
    let path = tmp.path("huge.toml");
    std::fs::write(&path, "[terminal]\nmark_after_secs = 999999999\n").expect("쓰기");
    assert_eq!(
        load_at(&path).terminal.mark_after_secs,
        Some(MAX_AFTER_SECS)
    );

    // 벨은 **문자열을 보관만** 한다 — 공백은 떼고, 모르는 값도 버리지 않는다.
    let path = tmp.path("bell.toml");
    std::fs::write(&path, "[terminal]\nbell = \"  하울링  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.bell.as_deref(), Some("하울링"));

    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[terminal]\nbell = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).terminal.bell, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("mark_after_secs = 5"), "{text}");
    assert!(text.contains("bell = \"visual+sound\""), "{text}");
    let back = load_at(&path);
    assert_eq!(back.terminal.mark_after_secs, Some(5));
    assert_eq!(back.terminal.bell.as_deref(), Some("visual+sound"));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"mark_after_secs\":5"), "{json}");
    assert!(json.contains("\"bell\":\"visual+sound\""), "{json}");
}

/// 타일 헤더 표시 시점 — `[app] tile_header`. `tiling` 과 완전히 같은 **"보관만"** 분담이라
/// 모르는 값도 그대로 들고 있고, 안 정하면 파일에 키 자체가 없다(= 프런트 기본 `always`).
#[test]
fn tile_header_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("타일헤더");

    let path = tmp.path("never.toml");
    std::fs::write(&path, "[app]\ntile_header = \"never\"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.tile_header.as_deref(), Some("never"));

    // 모르는 값도 버리지 않는다 — 프런트가 기본(always)으로 떨어뜨린다.
    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[app]\ntile_header = \"  hover  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.tile_header.as_deref(), Some("hover"));

    // 빈 값·안 정함은 둘 다 `None` 이고 파일에 키가 안 남는다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[app]\ntile_header = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.tile_header, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("tile_header"));
    assert_eq!(load_at(&path).app.tile_header, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름은 snake_case 그대로).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("tile_header = \"multi\""));
    assert_eq!(load_at(&path).app.tile_header.as_deref(), Some("multi"));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"tile_header\":\"multi\""), "{json}");
}

/// 상태바 자리 — `[app] status_bar`. `tile_header` 와 완전히 같은 **"보관만"** 분담이라
/// 모르는 값도 그대로 들고 있고, 안 정하면 파일에 키 자체가 없다(= 프런트 기본 `left`).
#[test]
fn status_bar_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("상태바");

    let path = tmp.path("left.toml");
    std::fs::write(&path, "[app]\nstatus_bar = \"left\"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.status_bar.as_deref(), Some("left"));

    // 모르는 값도 버리지 않는다 — 프런트가 기본(left)으로 떨어뜨린다 (공백만 뗀다).
    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[app]\nstatus_bar = \"  middle  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.status_bar.as_deref(), Some("middle"));

    // 빈 값·안 정함은 둘 다 `None` 이고 파일에 키가 안 남는다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[app]\nstatus_bar = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.status_bar, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("status_bar"));
    assert_eq!(load_at(&path).app.status_bar, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름은 snake_case 그대로).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("status_bar = \"top\""));
    assert_eq!(load_at(&path).app.status_bar.as_deref(), Some("top"));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"status_bar\":\"top\""), "{json}");
}

/// 독 배치 — `[dock] layout`(2026-10-23 채팅 독). `status_bar` 와 같은 **"보관만"** 분담이라 모르는 값도 그대로 들고 있고,
/// 안 정하면 `[dock]` 섹션 자체가 없다(= 프런트 기본 `launcher-left`).
#[test]
fn dock_layout_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("독배치");

    let path = tmp.path("right.toml");
    std::fs::write(&path, "[dock]\nlayout = \" launcher-right \"\n").expect("쓰기");
    assert_eq!(load_at(&path).dock.layout.as_deref(), Some("launcher-right"));

    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[dock]\nlayout = \"auto\"\n").expect("쓰기");
    assert_eq!(load_at(&path).dock.layout.as_deref(), Some("auto"));

    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[dock]\nlayout = \"  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).dock, DockPrefs::default());

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("[dock]"));

    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path).unwrap().contains("layout = \"launcher-right\""));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"dock\":{\"layout\":\"launcher-right\"}"), "{json}");
}

/// 작업안 실행 목록 정렬 — `[plans] exec_sort`(2026-11-01). `[dock] layout` 과 같은 **"보관만"** 분담이라 모르는 값도 그대로
/// 들고 있고, 안 정하면 `[plans]` 섹션 자체가 없다(= 프런트 기본 `newest`).
#[test]
fn plans_exec_sort_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("작업안정렬");

    let path = tmp.path("oldest.toml");
    std::fs::write(&path, "[plans]\nexec_sort = \" oldest \"\n").expect("쓰기");
    assert_eq!(load_at(&path).plans.exec_sort.as_deref(), Some("oldest"));

    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[plans]\nexec_sort = \"  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).plans, PlansPrefs::default());

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("[plans]"));

    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path).unwrap().contains("exec_sort = \"oldest\""));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"plans\":{\"exec_sort\":\"oldest\"}"), "{json}");
}

/// 업데이트 자동 확인 — `[updates] auto_check`(2026-11-12). 끌 때만 적고, 안 정하면 `[updates]` 섹션 자체가 없다(= 켬).
#[test]
fn updates_auto_check_round_trips_and_is_absent_when_unset() {
    let tmp = TempDir::new("업데이트확인");

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("[updates]"));

    let path = tmp.path("off.toml");
    std::fs::write(&path, "[updates]
auto_check = false
").expect("쓰기");
    assert_eq!(load_at(&path).updates.auto_check, Some(false));

    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path).unwrap().contains("auto_check = false"));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"updates\":{\"auto_check\":false}"), "{json}");
}

/// 상태바 모양 — `[app] status_bar_style`. `status_bar`(자리)와 완전히 같은 **"보관만"**
/// 분담이라 모르는 값도 그대로 들고 있고, 안 정하면 파일에 키 자체가 없다(= 프런트 기본 `flat`).
#[test]
fn status_bar_style_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("상태바모양");

    let path = tmp.path("panel.toml");
    std::fs::write(&path, "[app]\nstatus_bar_style = \"panel\"\n").expect("쓰기");
    assert_eq!(
        load_at(&path).app.status_bar_style.as_deref(),
        Some("panel")
    );

    // 모르는 값도 버리지 않는다 — 프런트가 기본(flat)으로 떨어뜨린다 (공백만 뗀다).
    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[app]\nstatus_bar_style = \"  bevel  \"\n").expect("쓰기");
    assert_eq!(
        load_at(&path).app.status_bar_style.as_deref(),
        Some("bevel")
    );

    // 빈 값·안 정함은 둘 다 `None` 이고 파일에 키가 안 남는다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[app]\nstatus_bar_style = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.status_bar_style, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("status_bar_style"));
    assert_eq!(load_at(&path).app.status_bar_style, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름은 snake_case 그대로).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("status_bar_style = \"panel\""));
    assert_eq!(
        load_at(&path).app.status_bar_style.as_deref(),
        Some("panel")
    );
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"status_bar_style\":\"panel\""), "{json}");
}

/// 앱 크롬 재질 — `[app] material`. `tiling` 과 같은 **"보관만"** 분담이라 모르는 값도
/// 그대로 들고 있고, 빈 값은 접으며, 안 정하면 파일에 키 자체가 없다(= 프런트 기본 `glass`).
#[test]
fn material_is_kept_verbatim_and_folds_blank() {
    let tmp = TempDir::new("재질");

    let path = tmp.path("flat.toml");
    std::fs::write(&path, "[app]
material = \"flat\"
").expect("쓰기");
    assert_eq!(load_at(&path).app.material.as_deref(), Some("flat"));

    // 모르는 값도 버리지 않는다 — 프런트가 기본(glass)으로 떨어뜨린다 (공백만 뗀다).
    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[app]
material = \"  metal  \"
").expect("쓰기");
    assert_eq!(load_at(&path).app.material.as_deref(), Some("metal"));

    // 빈 값·안 정함은 둘 다 `None` 이고 파일에 키가 안 남는다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[app]
material = \"   \"
").expect("쓰기");
    assert_eq!(load_at(&path).app.material, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("material"));
    assert_eq!(load_at(&path).app.material, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름은 snake_case 그대로).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("material = \"flat\""));
    assert_eq!(load_at(&path).app.material.as_deref(), Some("flat"));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"material\":\"flat\""), "{json}");
}

/// 앱 아이콘 — `[app] app_icon`. 다른 `[app]` 문자열과 같은 **"보관만"** 이라 모르는 값도 들고 있고
/// (해석은 `app_icon::normalize`), 안 정하면 파일에 키가 없다(= `gpt`).
#[test]
fn app_icon_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("앱아이콘");

    let path = tmp.path("gpt.toml");
    std::fs::write(&path, "[app]\napp_icon = \" gpt \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.app_icon.as_deref(), Some("gpt"));
    assert_eq!(crate::app_icon::normalize(load_at(&path).app.app_icon.as_deref()), "gpt");

    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[app]\napp_icon = \"nobody\"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.app_icon.as_deref(), Some("nobody"));
    assert_eq!(crate::app_icon::normalize(load_at(&path).app.app_icon.as_deref()), "gpt");

    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[app]\napp_icon = \"  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.app_icon, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("app_icon"));
}

/// AI 아이콘 모양 · CLI 별 아바타 — `[ai] icon_style` · `avatar_claude` · `avatar_codex` 는 "보관만"(공백만 떼고 빈 값은 접음).
/// 옛 칸 `loading_art = "character"` 는 `icon_style = "avatar"` 로 옮겨지고(새 칸이 비었을 때만) 파일에 다시 쓰이지 않는다
/// (docs/log/2026-10-31-avatars.md).
#[test]
fn ai_icon_style_absorbs_legacy_loading_art() {
    let tmp = TempDir::new("아바타");

    let path = tmp.path("legacy.toml");
    std::fs::write(&path, "[ai]
loading_art = \"character\"
").expect("쓰기");
    let s = load_at(&path);
    assert_eq!(s.ai.icon_style.as_deref(), Some("avatar"));
    assert_eq!(s.ai.loading_art, None);
    save_at(&path, &s).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("loading_art"), "{text}");
    assert!(text.contains("icon_style = \"avatar\""), "{text}");

    let path = tmp.path("logo.toml");
    std::fs::write(&path, "[ai]
loading_art = \"logo\"
").expect("쓰기");
    assert_eq!(load_at(&path).ai.icon_style, None, "옛 기본(logo)은 새 기본 그대로");

    let path = tmp.path("both.toml");
    std::fs::write(&path, "[ai]
icon_style = \"logo\"
loading_art = \"character\"
").expect("쓰기");
    assert_eq!(load_at(&path).ai.icon_style.as_deref(), Some("logo"), "새 칸이 이긴다");

    let path = tmp.path("avatars.toml");
    std::fs::write(&path, "[ai]
avatar_claude = \" grok \"
avatar_codex = \"  \"
").expect("쓰기");
    let s = load_at(&path);
    assert_eq!(s.ai.avatar_claude.as_deref(), Some("grok"));
    assert_eq!(s.ai.avatar_codex, None);

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("icon_style") && !text.contains("avatar_"), "{text}");
}

/// 2026-10-01 에 뺀 신호 모양 `[app] signal_style` — 옛 파일에 남아 있어도 읽기가 실패하지 않고 조용히
/// 버려진다(다음 저장 때 파일에서 빠진다). 같은 테이블의 다른 값은 살아 있다
/// (docs/log/2026-10-01-agent-status-three.md).
#[test]
fn removed_signal_style_is_ignored_on_load() {
    let tmp = TempDir::new("신호모양");
    let path = tmp.path("grid.toml");
    std::fs::write(
        &path,
        "[app]\nsignal_style = \"grid\"\nstatus_bar = \"top\"\n",
    )
    .expect("쓰기");
    let s = load_at(&path);
    assert_eq!(
        s.app.status_bar.as_deref(),
        Some("top"),
        "같은 테이블의 다른 값이 살아 있다"
    );
    save_at(&path, &s).expect("저장");
    assert!(
        !std::fs::read_to_string(&path)
            .unwrap()
            .contains("signal_style"),
        "다음 저장 때 빠진다"
    );
}

/// 2026-10-01 에 뺀 탭 모양 `powerline` — 옛 파일에 남아 있어도 읽기가 실패하지 않는다. 백엔드는
/// "보관만" 이라 그대로 들고 있고, 기본(`pill`)으로 떨어뜨리는 것은 프런트 정규화다
/// (`normalize.test.ts` · docs/log/2026-10-01-design-defaults.md).
#[test]
fn removed_tab_style_powerline_still_loads() {
    let tmp = TempDir::new("파워라인");
    let path = tmp.path("powerline.toml");
    std::fs::write(
        &path,
        "[terminal]\ntab_style = \"powerline\"\nfont_size = 15\n",
    )
    .expect("쓰기");
    let s = load_at(&path);
    assert_eq!(s.terminal.tab_style.as_deref(), Some("powerline"));
    assert_eq!(
        s.terminal.font_size,
        Some(15),
        "같은 테이블의 다른 값이 살아 있다"
    );
}

/// 무입력 자동 잠금 — `[app] idle_lock_min`. 다른 `[app]` 스칼라와 달리 **숫자**라
/// `0`(끔)은 `None` 으로 접고 나머지는 `1..=240` 으로 자른다. 안 정하면 키가 안 남는다.
#[test]
fn idle_lock_min_clamps_folds_zero_and_round_trips() {
    let tmp = TempDir::new("자동잠금");

    // 켠 값은 그대로 통과한다.
    let path = tmp.path("on.toml");
    std::fs::write(&path, "[app]\nidle_lock_min = 5\n").expect("쓰기");
    assert_eq!(load_at(&path).app.idle_lock_min, Some(5));

    // `0` 은 "끄기" — `None` 으로 접히고 파일에도 키가 안 남는다.
    let path = tmp.path("zero.toml");
    std::fs::write(&path, "[app]\nidle_lock_min = 0\n").expect("쓰기");
    assert_eq!(load_at(&path).app.idle_lock_min, None);

    // 범위 밖은 버리지 않고 자른다 (터무니없는 값이 사실상 "잠금 안 함"이 되지 않게).
    let path = tmp.path("huge.toml");
    std::fs::write(&path, "[app]\nidle_lock_min = 99999\n").expect("쓰기");
    assert_eq!(load_at(&path).app.idle_lock_min, Some(240));

    // 안 정함 = 파일에 키가 없다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("idle_lock_min"));
    assert_eq!(load_at(&path).app.idle_lock_min, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름은 snake_case 그대로).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("idle_lock_min = 5"));
    assert_eq!(load_at(&path).app.idle_lock_min, Some(5));
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"idle_lock_min\":5"), "{json}");
}

/// 앱 모드 — `[app] mode`. `tiling` 과 완전히 같은 **"보관만"** 분담이라 모르는 값도
/// 그대로 들고 있고, 안 정하면 파일에 키 자체가 없다.
#[test]
fn app_mode_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("앱모드");

    let path = tmp.path("light.toml");
    std::fs::write(&path, "[app]\nmode = \"light\"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.mode.as_deref(), Some("light"));

    // 모르는 값도 버리지 않는다 — 프런트가 기본(system)으로 떨어뜨린다.
    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[app]\nmode = \"  sepia  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.mode.as_deref(), Some("sepia"));

    // 공백만 있는 값은 "안 정함"으로 접힌다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[app]\nmode = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.mode, None);

    // 안 정했으면 파일에 키가 안 남는다 (기본값 추종).
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("mode"));
    assert_eq!(load_at(&path).app.mode, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("mode = \"light\""));
    assert_eq!(load_at(&path).app.mode.as_deref(), Some("light"));
    assert!(serde_json::to_string(&sample())
        .expect("JSON")
        .contains("\"mode\":\"light\""));
}

/// 화면 언어 — `[app] language`. `mode` 와 완전히 같은 **"보관만"** 분담이라 모르는 값도
/// 그대로 들고 있고, 안 정하면 파일에 키 자체가 없다 (= OS 를 따른다).
#[test]
fn app_language_is_kept_verbatim_and_absent_when_unset() {
    let tmp = TempDir::new("언어");

    let path = tmp.path("en.toml");
    std::fs::write(&path, "[app]\nlanguage = \"en\"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.language.as_deref(), Some("en"));

    // 모르는 값도 버리지 않는다 — 프런트가 "안 정함"(OS 따라가기)으로 떨어뜨린다.
    let path = tmp.path("unknown.toml");
    std::fs::write(&path, "[app]\nlanguage = \"  fr  \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.language.as_deref(), Some("fr"));

    // 공백만 있는 값은 "안 정함"으로 접힌다.
    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[app]\nlanguage = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&path).app.language, None);

    // 안 정했으면 파일에 키가 안 남는다 (기본값 = OS 추종).
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("language"));
    assert_eq!(load_at(&path).app.language, None);

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("language = \"en\""));
    assert_eq!(load_at(&path).app.language.as_deref(), Some("en"));
    assert!(serde_json::to_string(&sample())
        .expect("JSON")
        .contains("\"language\":\"en\""));
}

/// UI 크기·앱 글꼴 — `[app] ui_scale`·`ui_font_family` (docs/log/2026-09-25-ui-scale-font.md).
/// 크기는 범위로 **자르고**, 글꼴은 빈 값만 접는다. 안 정하면 둘 다 파일에 키가 없다.
#[test]
fn ui_scale_is_clamped_and_ui_font_kept_verbatim() {
    let tmp = TempDir::new("UI크기");

    for (raw, expected) in [
        (125, 125),
        (80, 80),
        (150, 150),
        (0, 80),
        (50, 80),
        (300, 150),
    ] {
        let path = tmp.path(&format!("scale-{raw}.toml"));
        std::fs::write(
            &path,
            format!(
                "[app]
ui_scale = {raw}
"
            ),
        )
        .expect("쓰기");
        assert_eq!(
            load_at(&path).app.ui_scale,
            Some(expected),
            "ui_scale = {raw}"
        );
    }

    // 글꼴 — 공백만 떼고 그대로, 공백만 있으면 "안 정함".
    let path = tmp.path("font.toml");
    std::fs::write(
        &path,
        "[app]
ui_font_family = \"  'Pretendard', sans-serif  \"
",
    )
    .expect("쓰기");
    assert_eq!(
        load_at(&path).app.ui_font_family.as_deref(),
        Some("'Pretendard', sans-serif")
    );
    let path = tmp.path("font-blank.toml");
    std::fs::write(
        &path,
        "[app]
ui_font_family = \"   \"
",
    )
    .expect("쓰기");
    assert_eq!(load_at(&path).app.ui_font_family, None);

    // 안 정했으면 파일에 키가 안 남는다.
    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(
        !text.contains("ui_scale") && !text.contains("ui_font_family"),
        "{text}"
    );

    // 파일 왕복 + 프런트 계약(JSON 키 이름).
    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("ui_scale = 125"), "{text}");
    let back = load_at(&path);
    assert_eq!(back.app.ui_scale, Some(125));
    assert_eq!(
        back.app.ui_font_family.as_deref(),
        Some("'Pretendard', sans-serif")
    );
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"ui_scale\":125"), "{json}");
    assert!(
        json.contains("\"ui_font_family\":\"'Pretendard', sans-serif\""),
        "{json}"
    );
}

// ------------------------------------------------------------------
// 기본 셸 (`[shell] default`)
// ------------------------------------------------------------------

/// 키가 없으면 `None` = "안 정함" = 백엔드 기본 셸. 파일에도 적히지 않는다.
#[test]
fn default_shell_is_unset_when_absent() {
    let tmp = TempDir::new("기본셸없음");

    let path = tmp.path("없음.toml");
    std::fs::write(&path, "[terminal]\nfont_size = 14\n").expect("쓰기");
    assert_eq!(load_at(&path).shell.default, None);

    // 빈 파일·저장 왕복에서도 키가 생기지 않는다.
    let saved = tmp.path("저장.toml");
    save_at(&saved, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&saved)
        .unwrap()
        .contains("default ="));
    assert_eq!(load_at(&saved).shell.default, None);
}

/// 적혀 있으면 **문자열 그대로** 보관한다 — 목록을 아는 쪽은 프런트다.
#[test]
fn default_shell_round_trips_verbatim() {
    let tmp = TempDir::new("기본셸값");

    let path = tmp.path("값.toml");
    std::fs::write(&path, "[shell]\ndefault = \"  wsl:Ubuntu  \"\n").expect("쓰기");
    // 앞뒤 공백은 떼고, 빈 값은 "안 정함" 으로 접는다 (다른 문자열 필드와 같은 규칙).
    assert_eq!(load_at(&path).shell.default.as_deref(), Some("wsl:Ubuntu"));

    let blank = tmp.path("빈값.toml");
    std::fs::write(&blank, "[shell]\ndefault = \"   \"\n").expect("쓰기");
    assert_eq!(load_at(&blank).shell.default, None);

    // 이 기기에 없는 id(배포판을 지운 뒤 등)도 지우지 않는다 — 프런트가 판단한다.
    let gone = tmp.path("없는셸.toml");
    std::fs::write(&gone, "[shell]\ndefault = \"wsl:이미-지운-배포판\"\n").expect("쓰기");
    assert_eq!(
        load_at(&gone).shell.default.as_deref(),
        Some("wsl:이미-지운-배포판"),
    );

    // 파일 왕복 + 프런트 계약(JSON) 양쪽에서 살아남는다.
    let rt = tmp.path("왕복.toml");
    save_at(&rt, &sample()).expect("저장");
    let text = std::fs::read_to_string(&rt).expect("읽기");
    assert!(text.contains("[shell]"), "{text}");
    assert_eq!(load_at(&rt), sample());
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(
        json.contains("\"shell\":{\"default\":\"wsl:Ubuntu\"}"),
        "{json}"
    );
}

// ------------------------------------------------------------------
// 키보드 단축키 오버라이드
// ------------------------------------------------------------------

/// 오버라이드 맵이 `[keybindings]` 테이블로 나갔다가 그대로 돌아온다.
#[test]
fn keybindings_round_trip_through_a_file() {
    let tmp = TempDir::new("키바인딩왕복");
    let path = tmp.path("settings.toml");
    save_at(&path, &sample()).expect("저장");

    let text = std::fs::read_to_string(&path).expect("읽기");
    assert!(text.contains("[keybindings]"), "{text}");
    assert!(text.contains("new-tab = \"Ctrl+Shift+KeyT\""), "{text}");
    // BTreeMap 이라 파일 출력 순서가 결정적이다 (command-palette < new-tab).
    let cp = text.find("command-palette").expect("command-palette");
    let nt = text.find("new-tab").expect("new-tab");
    assert!(cp < nt, "{text}");
    assert_eq!(load_at(&path), sample());
}

/// 빈 맵은 `[keybindings]` 테이블 자체가 파일에 안 적힌다.
#[test]
fn empty_keybindings_are_not_written() {
    let tmp = TempDir::new("키바인딩빈맵");
    let path = tmp.path("settings.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("keybindings"));
    assert!(load_at(&path).keybindings.is_empty());
}

/// 키·값 공백을 떼고, 어느 쪽이든 비면 버린다 — 조합 문법은 검사하지 않는다.
#[test]
fn sanitize_trims_and_drops_blank_keybindings() {
    let tmp = TempDir::new("키바인딩정리");
    let path = tmp.path("settings.toml");
    std::fs::write(
        &path,
        "\
[keybindings]
\"new-tab\" = \"  Ctrl+Shift+KeyT  \"
\"  close-tab  \" = \"Ctrl+KeyW\"
\"blank-value\" = \"   \"
\"\" = \"Ctrl+KeyX\"
",
    )
    .expect("쓰기");

    let s = load_at(&path);
    // 살아남는 것은 둘 — 값·키의 공백은 떼고 보관한다.
    assert_eq!(s.keybindings.len(), 2, "{:?}", s.keybindings);
    assert_eq!(
        s.keybindings.get("new-tab").map(String::as_str),
        Some("Ctrl+Shift+KeyT")
    );
    assert_eq!(
        s.keybindings.get("close-tab").map(String::as_str),
        Some("Ctrl+KeyW")
    );
    // 값이 공백뿐이거나 키가 빈 항목은 사라진다.
    assert!(
        !s.keybindings.contains_key("blank-value"),
        "{:?}",
        s.keybindings
    );
    assert!(!s.keybindings.contains_key(""), "{:?}", s.keybindings);
}

/// keybindings 만 있는 파일도 정상적으로 읽히고 나머지는 기본값이 된다.
#[test]
fn keybindings_only_file_loads() {
    let tmp = TempDir::new("키바인딩만");
    let path = tmp.path("settings.toml");
    std::fs::write(&path, "[keybindings]\n\"prev-tab\" = \"Ctrl+ArrowUp\"\n").expect("쓰기");

    let s = load_at(&path);
    assert_eq!(
        s.keybindings.get("prev-tab").map(String::as_str),
        Some("Ctrl+ArrowUp")
    );
    // 나머지는 손대지 않는다 — 트리거는 내장 기본, 나머지 섹션은 기본값.
    assert_eq!(s.app, AppTheme::default());
    assert_eq!(s.terminal, TermPrefs::default());
    assert_eq!(s.triggers, default_triggers());
}

// ------------------------------------------------------------------
// 월페이퍼 (`[wallpaper]`)
// ------------------------------------------------------------------

/// 키가 없으면 네 값 모두 "안 정함" 이고 파일에도 안 적힌다 (= 배경 없음).
#[test]
fn wallpaper_is_unset_when_absent() {
    let tmp = TempDir::new("월페이퍼없음");

    let path = tmp.path("없음.toml");
    std::fs::write(&path, "[app]\naccent = \"#ff8800\"\n").expect("쓰기");
    assert_eq!(load_at(&path).wallpaper, WallpaperPrefs::default());

    // 빈 테이블 머리(`[wallpaper]`)만 남고 **키는 하나도 안 적힌다** —
    // `[app]`·`[terminal]` 과 같은 모양이다 (안 정한 값은 나중에 기본값을 따라간다).
    let saved = tmp.path("저장.toml");
    save_at(&saved, &AppSettings::default()).expect("저장");
    let text = std::fs::read_to_string(&saved).expect("읽기");
    for key in ["file =", "dim =", "blur =", "fit ="] {
        assert!(!text.contains(key), "{key} / {text}");
    }
    assert_eq!(load_at(&saved).wallpaper, WallpaperPrefs::default());
}

/// 네 값이 파일·JSON 양쪽 왕복에서 살아남는다.
#[test]
fn wallpaper_round_trips() {
    let tmp = TempDir::new("월페이퍼왕복");
    let path = tmp.path("settings.toml");
    save_at(&path, &sample()).expect("저장");

    let text = std::fs::read_to_string(&path).expect("읽기");
    assert!(text.contains("[wallpaper]"), "{text}");
    assert!(text.contains("file = \"wallpaper.jpg\""), "{text}");
    assert_eq!(load_at(&path), sample());

    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(
        json.contains("\"wallpaper\":{\"file\":\"wallpaper.jpg\""),
        "{json}"
    );
}

/// **이름 한 조각만** 통과한다 — 손으로 고친 파일이 앱 폴더 밖을 가리키지 못하게.
#[test]
fn wallpaper_file_must_be_a_bare_name() {
    let tmp = TempDir::new("월페이퍼이름");

    for raw in [
        r"../../비밀.png",
        r"..",
        r"C:\Windows\win.png",
        r"sub/wallpaper.png",
        r"sub\wallpaper.png",
        r"   ",
    ] {
        let path = tmp.path(&format!("n{}.toml", raw.len()));
        std::fs::write(&path, format!("[wallpaper]\nfile = {}\n", toml_str(raw))).expect("쓰기");
        assert_eq!(load_at(&path).wallpaper.file, None, "file = {raw}");
    }

    // 평범한 이름은 그대로 (앞뒤 공백만 뗀다 — 다른 문자열과 같은 규칙).
    let path = tmp.path("정상.toml");
    std::fs::write(&path, "[wallpaper]\nfile = \"  밤 바다.jpg  \"\n").expect("쓰기");
    assert_eq!(
        load_at(&path).wallpaper.file.as_deref(),
        Some("밤 바다.jpg")
    );
}

/// dim·blur 는 **자른다**(버리지 않는다) — "너무 어둡게" 는 "가장 어둡게" 로 읽는다.
#[test]
fn wallpaper_sliders_are_clamped() {
    let tmp = TempDir::new("월페이퍼범위");

    for (raw, expected) in [("0", 0), ("60", 60), ("100", 100), ("200", MAX_DIM)] {
        let path = tmp.path(&format!("d{raw}.toml"));
        std::fs::write(&path, format!("[wallpaper]\ndim = {raw}\n")).expect("쓰기");
        assert_eq!(load_at(&path).wallpaper.dim, Some(expected), "dim = {raw}");
    }

    for (raw, expected) in [("0", 0), ("20", 20), ("21", MAX_BLUR), ("255", MAX_BLUR)] {
        let path = tmp.path(&format!("b{raw}.toml"));
        std::fs::write(&path, format!("[wallpaper]\nblur = {raw}\n")).expect("쓰기");
        assert_eq!(
            load_at(&path).wallpaper.blur,
            Some(expected),
            "blur = {raw}"
        );
    }

    // 저장 경로에서도 같은 규칙이다 (읽기·쓰기 양쪽이 sanitize 를 지난다).
    let written = tmp.path("저장.toml");
    let over = AppSettings {
        wallpaper: WallpaperPrefs {
            dim: Some(255),
            blur: Some(99),
            ..WallpaperPrefs::default()
        },
        ..AppSettings::default()
    };
    save_at(&written, &over).expect("저장");
    assert_eq!(load_at(&written).wallpaper.dim, Some(MAX_DIM));
    assert_eq!(load_at(&written).wallpaper.blur, Some(MAX_BLUR));
}

/// 모르는 배치 값은 버린다 = 프런트 기본(`cover`) 추종 (`tab_style` 과 같은 규칙).
#[test]
fn unknown_wallpaper_fit_falls_back_to_unset() {
    let tmp = TempDir::new("월페이퍼배치");

    for fit in WALLPAPER_FITS {
        let path = tmp.path(&format!("{fit}.toml"));
        std::fs::write(&path, format!("[wallpaper]\nfit = \"{fit}\"\n")).expect("쓰기");
        assert_eq!(load_at(&path).wallpaper.fit.as_deref(), Some(fit));
    }

    for raw in ["stretch", "COVER", "채우기", ""] {
        let path = tmp.path(&format!("x{}.toml", raw.len()));
        std::fs::write(&path, format!("[wallpaper]\nfit = \"{raw}\"\n")).expect("쓰기");
        assert_eq!(load_at(&path).wallpaper.fit, None, "fit = {raw}");
    }
}

/// TOML 문자열 리터럴 하나 — 백슬래시가 든 경로를 그대로 적으려고 리터럴 문자열(`'...'`)을 쓴다.
fn toml_str(raw: &str) -> String {
    format!("'{raw}'")
}

// ------------------------------------------------------------------
// 월페이퍼에서 뽑은 색 (`[app] dynamic` · `[terminal.dynamic]`)
// docs/log/2026-09-04-dynamic-color.md
// ------------------------------------------------------------------

/// 새 색 토큰 다섯 칸은 기존 셋과 **똑같은 규칙**이다 — 문자열 그대로, 빈 값은 "안 정함",
/// 안 정하면 파일에 키가 없다.
#[test]
fn extra_color_tokens_follow_the_same_rules() {
    let tmp = TempDir::new("추가토큰");

    let path = tmp.path("값.toml");
    std::fs::write(
        &path,
        "[app]\nfg = \"  #e6f0ff  \"\nborder = \"#1d2740\"\nerr = \"tomato\"\nok = \"\"\nwarn = \"   \"\n",
    )
    .expect("쓰기");
    let s = load_at(&path);
    assert_eq!(s.app.fg.as_deref(), Some("#e6f0ff"));
    assert_eq!(s.app.border.as_deref(), Some("#1d2740"));
    // 색 문법은 검사하지 않는다 — CSS 색 이름도 그대로 보관한다 (기존 토큰과 같은 규칙).
    assert_eq!(s.app.err.as_deref(), Some("tomato"));
    assert_eq!(s.app.ok, None);
    assert_eq!(s.app.warn, None);

    // 안 정하면 키가 없다.
    let saved = tmp.path("저장.toml");
    save_at(&saved, &AppSettings::default()).expect("저장");
    let text = std::fs::read_to_string(&saved).expect("읽기");
    for key in ["fg =", "border =", "err =", "ok =", "warn =", "dynamic ="] {
        assert!(!text.contains(key), "{key} / {text}");
    }
}

/// `[app] dynamic` 은 세 단계 문자열이다 — 옛 불리언 `true` 는 `"full"` 로 이사한다
/// (docs/log/2026-09-25-wallpaper-tint.md).
#[test]
fn dynamic_mode_migrates_the_old_flag_and_round_trips() {
    let tmp = TempDir::new("동적단계");

    // 옛 파일: 켜 둔 토글 = 전체.
    let path = tmp.path("old-on.toml");
    std::fs::write(&path, "[app]\ndynamic = true\n").expect("쓰기");
    assert_eq!(load_at(&path).app.dynamic.as_deref(), Some("full"));

    // 옛 `false`(손으로 적은 것) = 안 정함. 이사가 다른 칸을 해치지 않는다.
    let path = tmp.path("old-off.toml");
    std::fs::write(&path, "[app]\ndynamic = false\naccent = \"#101010\"\n").expect("쓰기");
    let s = load_at(&path);
    assert_eq!(s.app.dynamic, None);
    assert_eq!(s.app.accent.as_deref(), Some("#101010"));

    // 새 파일: 문자열 그대로(공백 정리) · 빈 값은 안 정함 · 모르는 값도 보관만 한다.
    for (raw, want) in [
        ("\" subtle \"", Some("subtle")),
        ("\"off\"", Some("off")),
        ("\"\"", None),
        ("\"loud\"", Some("loud")),
    ] {
        let path = tmp.path("new.toml");
        std::fs::write(&path, format!("[app]\ndynamic = {raw}\n")).expect("쓰기");
        assert_eq!(load_at(&path).app.dynamic.as_deref(), want, "{raw}");
    }

    // 옛 `true` 를 읽고 저장하면 `"full"` 이 적히고, 다시 읽어도 같다.
    let path = tmp.path("round.toml");
    std::fs::write(&path, "[app]\ndynamic = true\n").expect("쓰기");
    let s = load_at(&path);
    save_at(&path, &s).expect("저장");
    let text = std::fs::read_to_string(&path).expect("읽기");
    assert!(text.contains("dynamic = \"full\""), "{text}");
    assert_eq!(load_at(&path).app.dynamic.as_deref(), Some("full"));

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert_eq!(load_at(&path).app.dynamic, None);

    // 프런트 계약: JSON 에는 문자열로 나가고, 프런트가 보낸 문자열도 그대로 받는다.
    let json = serde_json::to_string(&sample()).expect("JSON");
    assert!(json.contains("\"dynamic\":\"full\""), "{json}");
    let back: AppTheme = serde_json::from_str(r#"{"dynamic":"subtle"}"#).expect("JSON 읽기");
    assert_eq!(back.dynamic.as_deref(), Some("subtle"));
    let legacy: AppTheme = serde_json::from_str(r#"{"dynamic":true}"#).expect("옛 JSON 읽기");
    assert_eq!(legacy.dynamic.as_deref(), Some("full"));
}

/// **순서가 계약이다** — `[terminal.dynamic]` 헤더가 `theme = …` 보다 뒤에 찍혀야
/// 그 스칼라들이 하위 테이블로 빨려 들어가지 않는다 ([`TermPrefs`] 주석).
#[test]
fn dynamic_palette_table_is_written_after_the_scalars() {
    let tmp = TempDir::new("동적팔레트순서");
    let path = tmp.path("settings.toml");
    save_at(&path, &sample()).expect("저장");

    let text = std::fs::read_to_string(&path).expect("읽기");
    let header = text.find("[terminal.dynamic]").expect("헤더");
    let theme = text.find("theme = \"tokyo-night\"").expect("theme");
    assert!(theme < header, "{text}");
    // 그리고 실제로 왕복이 값을 지킨다 (순서가 틀렸다면 여기서 theme 이 사라진다).
    assert_eq!(load_at(&path), sample());
}

/// 팔레트는 **보관만** 한다 — 색 문법도 키 목록도 검사하지 않고, 색이 아닌 칸도 그대로 둔다.
#[test]
fn dynamic_palette_is_stored_verbatim() {
    let tmp = TempDir::new("동적팔레트보관");
    let path = tmp.path("settings.toml");
    std::fs::write(
        &path,
        "\
[terminal]
theme = \"dynamic\"

[terminal.dynamic]
background = \"  #0e1415  \"
\"  red  \" = \"#f09285\"
before-theme = \"tokyo-night\"
\"아직-모르는-칸\" = \"뭐든\"
\"빈값\" = \"   \"
",
    )
    .expect("쓰기");

    let s = load_at(&path);
    assert_eq!(s.terminal.theme.as_deref(), Some("dynamic"));
    // 키·값의 공백만 떼고, 어느 쪽이든 비면 버린다 (keybindings 와 같은 규칙).
    assert_eq!(
        s.terminal.dynamic.get("background").map(String::as_str),
        Some("#0e1415")
    );
    assert_eq!(
        s.terminal.dynamic.get("red").map(String::as_str),
        Some("#f09285")
    );
    // 색이 아닌 칸도, 모르는 칸도 그대로 남는다 — 아는 쪽은 프런트다.
    assert_eq!(
        s.terminal.dynamic.get("before-theme").map(String::as_str),
        Some("tokyo-night")
    );
    assert_eq!(
        s.terminal.dynamic.get("아직-모르는-칸").map(String::as_str),
        Some("뭐든")
    );
    assert!(
        !s.terminal.dynamic.contains_key("빈값"),
        "{:?}",
        s.terminal.dynamic
    );
}

/// 비면 `[terminal.dynamic]` 테이블 자체가 안 적힌다 (`[keybindings]` 와 같다).
#[test]
fn empty_dynamic_palette_is_not_written() {
    let tmp = TempDir::new("동적팔레트빈맵");
    let path = tmp.path("settings.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("terminal.dynamic"));
    assert!(load_at(&path).terminal.dynamic.is_empty());
}

/// 백엔드는 액션 id·조합 문자열을 해석하지 않는다 — 모르는 값도 그대로 보관한다.
#[test]
fn unknown_keybinding_ids_are_stored_verbatim() {
    let tmp = TempDir::new("키바인딩모르는id");
    let path = tmp.path("settings.toml");
    std::fs::write(&path, "[keybindings]\n\"아직-없는-액션\" = \"Ctrl+Tab\"\n").expect("쓰기");
    assert_eq!(
        load_at(&path)
            .keybindings
            .get("아직-없는-액션")
            .map(String::as_str),
        Some("Ctrl+Tab"),
    );
}

// ── 옛 이름 폴더의 1회 이전 ─────────────────────────────────────────────────

/// 실제 후보는 지금 비어 있다(2026-10-22 2차 — docs/log/2026-10-22-rename-aynx.md). 기계
/// ([`rename_first_legacy_dir`] — 최근 이름 먼저 · 첫 하나만)는 다음 개명을 위해 남겼고, 가짜 이름으로 잰다.
const RECENT_LEGACY: &str = "recent-name-for-test";
/// 규칙 시험용 가짜 더 옛 이름 — 실제 후보가 아니다.
const OLDER_FAKE: &str = "older-name-for-test";
const CHAIN: &[&str] = &[RECENT_LEGACY, OLDER_FAKE];

#[test]
fn legacy_app_dir_candidates_are_empty_now() {
    assert!(LEGACY_APP_DIRS.is_empty());
}

#[test]
fn legacy_app_dir_carries_vault_and_webhook_files_untouched() {
    // 옛 이름 → 새 이름: 볼트(`vault.bin`·`vault.key`)·웹훅 파일은 경로에 묶여 있지 않다(볼트 키 감싸기는
    // DPAPI 계정 묶음이고 엔트로피·경로를 쓰지 않는다) — 폴더째 rename 이라 바이트 그대로 따라간다.
    let tmp = TempDir::new("이전-볼트");
    let old = tmp.path(RECENT_LEGACY);
    std::fs::create_dir_all(&old).expect("옛 폴더");
    let files: [(&str, &[u8]); 4] = [
        ("vault.bin", b"sealed-envelope"),
        ("vault.key", b"wrapped-key"),
        ("discord-webhook", b"https://example.invalid/x"),
        ("slack-webhook", b"https://example.invalid/y"),
    ];
    for (name, body) in files {
        std::fs::write(old.join(name), body).expect("옛 파일");
    }
    assert!(migrate_app_dir_at(&tmp.0, &[RECENT_LEGACY], APP_DIR));
    let new = tmp.path(APP_DIR);
    for (name, body) in files {
        assert_eq!(std::fs::read(new.join(name)).unwrap(), body, "{name}");
    }
    assert!(!old.exists());
}

#[test]
fn recent_legacy_app_dir_wins_and_older_ones_are_left_alone() {
    let tmp = TempDir::new("이전-옛폴더셋");
    // 두 세대가 **동시에** 남아 있는 경우 — 가장 최근 것 하나만 옮긴다.
    for (name, body) in [(RECENT_LEGACY, "최근 것"), (OLDER_FAKE, "더 옛 것")] {
        let old = tmp.path(name);
        std::fs::create_dir_all(&old).expect("옛 폴더");
        std::fs::write(old.join("settings.toml"), body).expect("옛 파일");
    }

    assert!(migrate_app_dir_at(&tmp.0, CHAIN, APP_DIR), "하나는 옮겼어야 한다");

    let new = tmp.path(APP_DIR);
    assert!(!tmp.path(RECENT_LEGACY).exists(), "최근 옛 폴더만 사라진다");
    assert_eq!(
        std::fs::read_to_string(new.join("settings.toml")).unwrap(),
        "최근 것"
    );
    // 더 옛 폴더는 **그대로 남는다** — 합치지도, 지우지도 않는다.
    assert_eq!(
        std::fs::read_to_string(tmp.path(OLDER_FAKE).join("settings.toml")).unwrap(),
        "더 옛 것"
    );
}

#[test]
fn older_legacy_app_dir_is_moved_and_contents_survive() {
    let tmp = TempDir::new("이전-옛폴더하나");
    let old = tmp.path(OLDER_FAKE);
    std::fs::create_dir_all(old.join("nested")).expect("옛 폴더");
    std::fs::write(old.join("settings.toml"), "# 사용자 설정\n").expect("설정 파일");
    std::fs::write(old.join("nested").join("wallpaper.jpg"), b"\xff\xd8").expect("월페이퍼");

    assert!(migrate_app_dir_at(&tmp.0, CHAIN, APP_DIR), "옮겼어야 한다");

    let new = tmp.path(APP_DIR);
    assert!(!old.exists(), "옛 폴더는 사라진다");
    assert!(
        !tmp.path(RECENT_LEGACY).exists(),
        "없던 후보를 만들지도 않는다"
    );
    assert_eq!(
        std::fs::read_to_string(new.join("settings.toml")).unwrap(),
        "# 사용자 설정\n"
    );
    assert_eq!(
        std::fs::read(new.join("nested").join("wallpaper.jpg")).unwrap(),
        b"\xff\xd8"
    );

    // 두 번째 부팅 — 새 폴더가 이미 있으니 아무 일도 없다.
    assert!(!migrate_app_dir_at(&tmp.0, CHAIN, APP_DIR));
}

#[test]
fn existing_app_dir_wins_and_every_legacy_is_left_alone() {
    let tmp = TempDir::new("이전-새폴더있음");
    let new = tmp.path(APP_DIR);
    std::fs::create_dir_all(&new).expect("새 폴더");
    std::fs::write(new.join("settings.toml"), "새것").expect("새 파일");
    for (name, body) in [(RECENT_LEGACY, "최근 것"), (OLDER_FAKE, "더 옛 것")] {
        let old = tmp.path(name);
        std::fs::create_dir_all(&old).expect("옛 폴더");
        std::fs::write(old.join("settings.toml"), body).expect("옛 파일");
    }

    assert!(!migrate_app_dir_at(&tmp.0, CHAIN, APP_DIR), "옮기지 않는다");

    // 새 폴더는 그대로고, **옛 폴더도 하나도 지우지 않는다**(사용자가 되살릴 수 있게).
    assert_eq!(
        std::fs::read_to_string(new.join("settings.toml")).unwrap(),
        "새것"
    );
    for (name, body) in [(RECENT_LEGACY, "최근 것"), (OLDER_FAKE, "더 옛 것")] {
        let kept = tmp.path(name).join("settings.toml");
        assert_eq!(
            std::fs::read_to_string(&kept).unwrap(),
            body,
            "{name} 은 남는다"
        );
    }
}

#[test]
fn no_legacy_app_dir_is_a_noop() {
    let tmp = TempDir::new("이전-옛폴더없음");
    assert!(!migrate_app_dir_at(&tmp.0, LEGACY_APP_DIRS, APP_DIR));
    assert!(!tmp.path(APP_DIR).exists(), "새 폴더를 만들지도 않는다");
}

#[test]
fn sessions_preferences_roundtrip_and_defaults_are_not_written() {
    let mut settings = crate::settings::AppSettings::default();
    settings.ai.mcp_sessions_enabled = Some(true);
    settings.ai.mcp_sessions_agents = Some(vec!["codex".into(), "claude".into()]);
    settings.sanitize();
    let text = toml::to_string(&settings).unwrap();
    assert!(!text.contains("mcp_sessions_"));
    settings.ai.mcp_sessions_enabled = Some(false);
    settings.ai.mcp_sessions_agents = Some(vec![]);
    let text = toml::to_string(&settings).unwrap();
    assert_eq!(toml::from_str::<crate::settings::AppSettings>(&text).unwrap(), settings);
    assert!(text.contains("mcp_sessions_enabled = false") && text.contains("mcp_sessions_agents = []"));
}

/// [연결] 의 저장 — `[remote]` 만 바꾸고 파일의 다른 칸은 그대로 · 포트 0 은 "안 정함".
#[test]
fn set_remote_connected_touches_only_remote() {
    let tmp = TempDir::new("원격연결");
    let path = tmp.path("settings.toml");
    let before = sample();
    save_at(&path, &before).expect("저장");

    access::set_remote_connected_at(&path, "mypc.tail1234.ts.net", Some(50000)).expect("연결 저장");
    let after = load_at(&path);
    assert_eq!(
        after.remote,
        RemotePrefs {
            enabled: Some(true),
            port: Some(50000),
            host: Some("mypc.tail1234.ts.net".to_string()),
        }
    );
    let mut expected = load_at(&path);
    expected.remote = before.remote.clone();
    assert_eq!(expected.triggers, before.triggers);
    assert_eq!(expected.app, before.app);

    access::set_remote_connected_at(&path, "mypc.tail1234.ts.net", Some(0)).expect("포트 0");
    assert_eq!(load_at(&path).remote.port, None);
}

/// 원격 관문 — `[remote]`. 안 정했으면 섹션이 아예 안 적히고, 이름은 공백을 걷고 소문자로 · 빈 이름과 포트 0 은 "안 정함".
#[test]
fn remote_prefs_skip_when_default_and_fold_empty() {
    let tmp = TempDir::new("원격");

    let path = tmp.path("unset.toml");
    save_at(&path, &AppSettings::default()).expect("저장");
    assert!(!std::fs::read_to_string(&path).unwrap().contains("[remote]"));
    assert_eq!(load_at(&path).remote, RemotePrefs::default());

    let path = tmp.path("edge.toml");
    std::fs::write(&path, "[remote]
enabled = true
port = 0
host = \"  MyPC.Tailnet-AB.ts.net \"
").expect("쓰기");
    let loaded = load_at(&path).remote;
    assert_eq!(loaded.enabled, Some(true));
    assert_eq!(loaded.port, None);
    assert_eq!(loaded.host.as_deref(), Some("mypc.tailnet-ab.ts.net"));

    let path = tmp.path("blank.toml");
    std::fs::write(&path, "[remote]
host = \"   \"
").expect("쓰기");
    assert_eq!(load_at(&path).remote, RemotePrefs::default());

    let path = tmp.path("roundtrip.toml");
    save_at(&path, &sample()).expect("저장");
    assert_eq!(load_at(&path).remote, sample().remote);
}
