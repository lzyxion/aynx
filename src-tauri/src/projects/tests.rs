use super::*;

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("aynx-프로젝트-{tag}-{}-{nanos}", std::process::id()));
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

fn local(id: &str, name: &str) -> Project {
    Project {
        id: id.into(),
        extra: Default::default(),
        name: name.into(),
        host: None,
        path: "C:\\src\\aynx".into(),
        shell: None,
        agent: Some("claude".into()),
        setup_script: String::new(),
        tmux: false,
        worktree_dir: None,
        migration: None,
        icon: None,
        color: None,
    }
}

fn remote(id: &str, host: &str) -> Project {
    Project {
        id: id.into(),
        extra: Default::default(),
        name: format!("{host} 프로젝트"),
        host: Some(host.into()),
        path: "~/aynx".into(),
        shell: None,
        agent: Some("codex".into()),
        setup_script: "npm ci\ncp \"$AYNX_ROOT_PATH/.env\" .env".into(),
        tmux: true,
        worktree_dir: None,
        migration: None,
        icon: None,
        color: None,
    }
}

#[test]
fn file_round_trips_and_missing_fields_take_defaults() {
    let tmp = TempDir::new("왕복");
    let path = tmp.path("projects.json");
    assert_eq!(load_file(&path), ProjectsFile::default());

    let file = ProjectsFile {
        version: None,
        extra: Default::default(),
        projects: vec![local("a", "aynx"), remote("b", "dev-01")],
    };
    write_file(&path, &file).unwrap();
    assert_eq!(load_file(&path), file);

    // 모양 계약 — 프런트(`src/lib/projects.ts`)가 읽는 칸 이름 그대로다.
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(v["projects"][0]["host"], serde_json::Value::Null);
    assert_eq!(v["projects"][1]["host"], "dev-01");
    assert_eq!(v["projects"][1]["tmux"], true);
    assert_eq!(v["projects"][0]["agent"], "claude");
    assert_eq!(
        v["projects"][1]["setupScript"],
        "npm ci\ncp \"$AYNX_ROOT_PATH/.env\" .env"
    );
    // 빈 스크립트 · 안내 없음 · 옛 칸은 쓰지 않는다.
    assert!(v["projects"][0].get("setupScript").is_none());
    assert!(v["projects"][0].get("migration").is_none());
    assert!(v["projects"][0].get("command").is_none());

    // 손으로 적은 짧은 줄 — 없는 칸은 기본값(에이전트 claude — 옛 기본 명령 · tmux 켬)이다.
    std::fs::write(&path, r#"{"projects":[{"id":"x","name":"n","path":"/p"}]}"#).unwrap();
    let got = load_file(&path);
    assert_eq!(got.projects[0].agent.as_deref(), Some("claude"));
    assert_eq!(got.projects[0].migration, None);
    assert!(got.projects[0].tmux);
    assert_eq!(got.projects[0].host, None);
}

/// **이관 표** — 옛 `command` 칸 → 에이전트 · 설정 스크립트 · 안내 (모듈 머리말 · 목업 "이관 표"). 프런트
/// `projects.test.ts` 의 `migrateProjectCommand` 가 같은 줄들을 본다.
#[test]
fn legacy_command_migrates_by_the_table() {
    let note = |kind: &str, text: &str| {
        Some(ProjectMigration {
            kind: kind.into(),
            text: text.into(),
        })
    };
    type Row<'a> = (
        &'a str,
        &'a str,
        Option<&'a str>,
        &'a str,
        Option<ProjectMigration>,
    );
    let table: [Row; 8] = [
        ("claude", "", Some("claude"), "", None),
        ("codex", "", Some("codex"), "", None),
        ("  Claude.exe  ", "", Some("claude"), "", None),
        (
            "claude --model opus",
            "",
            Some("claude"),
            "",
            note("args", "--model opus"),
        ),
        ("", "", None, "", None),
        ("   ", "", None, "", None),
        ("npm ci", "", None, "npm ci", note("script", "npm ci")),
        (
            "npm ci",
            "pnpm i",
            None,
            "pnpm i",
            note("dropped", "npm ci"),
        ),
    ];
    for (cmd, script, agent, want_script, want_note) in table {
        let (a, s, n) = migrate_command(cmd, script);
        assert_eq!(
            (a.as_deref(), s.as_str(), n),
            (agent, want_script, want_note),
            "{cmd:?}"
        );
    }

    // 파일에서 — 옛 줄은 옮겨 읽고, 새로 쓸 때 `command` 는 사라지고 안내는 남는다(폼이 저장할 때까지).
    let tmp = TempDir::new("이관");
    let path = tmp.path("projects.json");
    std::fs::write(
        &path,
        r#"{"projects":[
              {"id":"a","name":"a","path":"/a","command":"claude --model opus"},
              {"id":"b","name":"b","path":"/b","command":""},
              {"id":"c","name":"c","path":"/c","command":"npm ci"},
              {"id":"d","name":"d","path":"/d","agent":null,"command":"claude"}]}"#,
    )
    .unwrap();
    let got = load_file(&path);
    let ids: Vec<(Option<&str>, &str)> = got
        .projects
        .iter()
        .map(|p| (p.agent.as_deref(), p.setup_script.as_str()))
        .collect();
    assert_eq!(
        ids,
        [
            (Some("claude"), ""),
            (None, ""),
            (None, "npm ci"),
            (None, "")
        ]
    );
    assert_eq!(got.projects[0].migration, note("args", "--model opus"));
    assert_eq!(got.projects[2].migration, note("script", "npm ci"));
    assert_eq!(
        got.projects[3].migration, None,
        "agent 칸이 있으면(null 이어도) 새 모양 — command 는 버린다"
    );
    write_file(&path, &got).unwrap();
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("\"command\""), "{text}");
    let again = load_file(&path);
    assert_eq!(again, got, "다시 읽어도 같은 모양 — 이관은 한 번뿐이다");

    // 폼이 저장하면(normalize) 안내가 사라진다.
    let saved = normalize(got.projects[0].clone()).unwrap();
    assert_eq!(saved.migration, None);
}

#[test]
fn debug_never_prints_the_setup_script() {
    let r = remote("r", "dev-01");
    let d = format!("{r:?}");
    assert!(!d.contains("npm ci") && !d.contains("AYNX_ROOT_PATH"), "{d}");
    assert!(d.contains("setup_script_lines: 2"), "{d}");
}

#[test]
fn corrupt_file_starts_empty_and_next_write_succeeds() {
    let tmp = TempDir::new("깨짐");
    let path = tmp.path("projects.json");
    std::fs::write(&path, "{ not json").unwrap();
    assert_eq!(load_file(&path), ProjectsFile::default());
    assert!(modify(&path, |f| upsert(f, local("a", "aynx"))).unwrap());
    assert_eq!(load_file(&path).projects.len(), 1);
}

#[test]
fn upsert_replaces_by_id_in_place_and_appends_new() {
    let mut f = ProjectsFile::default();
    assert!(upsert(&mut f, local("a", "하나")));
    assert!(upsert(&mut f, local("b", "둘")));
    // 같은 id — 자리는 그대로, 내용만 바뀐다.
    assert!(upsert(&mut f, local("a", "하나 (고침)")));
    assert_eq!(f.projects.len(), 2);
    assert_eq!(f.projects[0].name, "하나 (고침)");
    assert_eq!(f.projects[1].id, "b");
    // 같은 내용이면 바뀐 것이 없다 (디스크를 안 건드린다).
    assert!(!upsert(&mut f, local("a", "하나 (고침)")));

    assert!(remove(&mut f, "a"));
    assert!(!remove(&mut f, "a"));
    assert_eq!(f.projects.len(), 1);
}

/// 아이콘·색 (docs/log/2026-09-29-folder-project-icons.md) — 왕복 · 옛 파일은 없음 · 비면 파일에 안 쓴다.
#[test]
fn icon_and_color_round_trip_and_old_files_load_without_them() {
    let tmp = TempDir::new("아이콘");
    let path = tmp.path("projects.json");
    let mut a = local("a", "aynx");
    a.icon = Some("svg:lucide:folder-git-2".into());
    a.color = Some("#4a90d9".into());
    let file = ProjectsFile {
        projects: vec![a, remote("b", "dev-01")],
        ..Default::default()
    };
    write_file(&path, &file).unwrap();
    assert_eq!(load_file(&path), file);

    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(v["projects"][0]["icon"], "svg:lucide:folder-git-2");
    assert_eq!(v["projects"][0]["color"], "#4a90d9");
    // 없는 칸은 쓰지 않는다 (옛 파일과 같은 모양).
    assert!(v["projects"][1].get("icon").is_none());
    assert!(v["projects"][1].get("color").is_none());

    // 아이콘 칸이 생기기 전의 파일 — 그대로 읽히고 둘 다 없음.
    std::fs::write(
        &path,
        r#"{"projects":[{"id":"x","name":"n","path":"C:\\p","agent":"claude","tmux":false}]}"#,
    )
    .unwrap();
    let got = load_file(&path);
    assert_eq!(got.projects.len(), 1);
    assert_eq!(got.projects[0].icon, None);
    assert_eq!(got.projects[0].color, None);

    // 저장 다듬기 — 공백은 떼고, 비면 없음, 줄바꿈은 거절.
    let mut p = local("x", "n");
    p.icon = Some("  🚀 ".into());
    p.color = Some("   ".into());
    let n = normalize(p).unwrap();
    assert_eq!(n.icon.as_deref(), Some("🚀"));
    assert_eq!(n.color, None);
    let mut bad = local("x", "n");
    bad.color = Some("#fff\nx".into());
    assert!(normalize(bad).is_err());
}

#[test]
fn normalize_trims_validates_and_drops_meaningless_fields() {
    let mut p = local("", "  aynx  ");
    p.shell = Some("  ".into());
    p.tmux = true;
    let n = normalize(p).unwrap();
    assert_eq!(n.name, "aynx");
    assert_eq!(n.shell, None);
    assert!(!n.tmux, "로컬에는 tmux 가 없다");

    let mut r = remote("r", "dev-01");
    r.shell = Some("pwsh".into());
    assert_eq!(normalize(r).unwrap().shell, None, "원격에는 셸 칸이 없다");

    assert!(normalize(local("x", "  ")).is_err());
    let mut no_path = local("x", "n");
    no_path.path = " ".into();
    assert!(normalize(no_path).is_err());
    let mut two_lines = local("x", "n");
    two_lines.path = "C:\\src\naynx".into();
    assert!(normalize(two_lines).is_err());

    // 에이전트 — 없음(셸)은 허용, 빈 글자는 없음, 모르는 id 는 거절.
    let mut shell = local("x", "n");
    shell.agent = None;
    assert_eq!(normalize(shell).unwrap().agent, None);
    let mut blank = local("x", "n");
    blank.agent = Some("  ".into());
    assert_eq!(normalize(blank).unwrap().agent, None);
    let mut unknown = local("x", "n");
    unknown.agent = Some("npm ci".into());
    assert!(normalize(unknown).is_err());

    // 설정 스크립트 — 줄 끝을 맞추고 끝 공백·앞뒤 빈 줄을 뗀다. 공백뿐이면 없음. 제어 문자(탭 말고)는 거절.
    let mut sc = local("x", "n");
    sc.setup_script = "\r\n  pnpm install  \r\n\tcp a b\r\n\r\n".into();
    assert_eq!(
        normalize(sc).unwrap().setup_script,
        "  pnpm install\n\tcp a b"
    );
    let mut ws = local("x", "n");
    ws.setup_script = " \n \t\n".into();
    assert_eq!(normalize(ws).unwrap().setup_script, "");
    let mut esc = local("x", "n");
    esc.setup_script = "echo \u{1b}[31m".into();
    assert!(normalize(esc).is_err());
    assert_eq!(script_lines("a\n\n  \nb"), 2);
}

#[test]
fn local_path_must_be_absolute_remote_may_use_tilde() {
    // 2026-09-24 실기 ⑤ — 로컬에 `~/aynx-lab` 이 저장됐다
    for bad in ["~/aynx-lab", "~", "repo", r".\repo", "C:repo"] {
        let mut p = local("x", "n");
        p.path = bad.into();
        let err = normalize(p).unwrap_err();
        assert!(
            err.contains("절대 경로") || err.contains("absolute"),
            "{bad}: {err}"
        );
    }
    for ok in [
        r"C:\Users\me\repo",
        "c:/src/aynx",
        r"\\srv\share\repo",
        "/home/me/repo",
    ] {
        let mut p = local("x", "n");
        p.path = ok.into();
        assert!(normalize(p).is_ok(), "{ok}");
    }
    let mut r = remote("r", "dev-01");
    r.path = "~/aynx-lab".into();
    assert!(normalize(r).is_ok(), "원격은 `~` 가 된다 (셸이 편다)");
}

#[test]
fn worktree_dir_is_optional_trimmed_and_kept_outside_the_repo() {
    // 빈 칸은 없는 것 — 파일에 쓰지도 않는다(옛 파일과 같은 모양).
    let mut blank = local("x", "n");
    blank.worktree_dir = Some("   ".into());
    let n = normalize(blank).unwrap();
    assert_eq!(n.worktree_dir, None);
    let json = serde_json::to_value(&n).unwrap();
    assert!(json.get("worktreeDir").is_none());

    let mut ok = local("x", "n");
    ok.worktree_dir = Some(r"  D:\wt\aynx  ".into());
    let n = normalize(ok).unwrap();
    assert_eq!(n.worktree_dir.as_deref(), Some(r"D:\wt\aynx"));
    assert_eq!(
        serde_json::to_value(&n).unwrap()["worktreeDir"],
        r"D:\wt\aynx"
    );

    // 저장소 자신과 그 안은 안 된다(대소문자·구분자 무시 — 로컬 경로 `C:\src\aynx`).
    // 상대 경로와 로컬의 `~` 도 안 된다(git 이 저장소 기준으로 읽는다).
    for bad in [
        r"C:\src\aynx",
        "c:/SRC/aynx/wt",
        r"C:\src\aynx\",
        r"relative\wt",
        "~/wt",
    ] {
        let mut p = local("x", "n");
        p.worktree_dir = Some(bad.into());
        assert!(normalize(p).is_err(), "{bad}");
    }
    // 이웃 폴더(이름이 저장소 이름으로 시작할 뿐)는 된다.
    let mut sibling = local("x", "n");
    sibling.worktree_dir = Some(r"C:\src\aynx-wt".into());
    assert!(normalize(sibling).is_ok());

    // 원격은 `~` 도 절대 자리다 — 저장소 `~/aynx` 안만 막는다.
    let mut r = remote("r", "dev-01");
    r.worktree_dir = Some("~/wt".into());
    assert!(normalize(r).is_ok());
    let mut inside = remote("r", "dev-01");
    inside.worktree_dir = Some("~/aynx/wt".into());
    assert!(normalize(inside).is_err());
}

#[test]
fn rename_and_forget_follow_the_alias_case_insensitively() {
    let mut f = ProjectsFile {
        version: None,
        extra: Default::default(),
        projects: vec![
            local("l", "로컬"),
            remote("a", "Dev-01"),
            remote("b", "web"),
        ],
    };
    assert!(rename_host(&mut f, "dev-01", "dev-02"));
    assert_eq!(f.projects[1].host.as_deref(), Some("dev-02"));
    assert_eq!(f.projects[2].host.as_deref(), Some("web"));
    assert_eq!(f.projects[0].host, None, "로컬은 건드리지 않는다");
    assert!(!rename_host(&mut f, "nope", "x"));
    assert!(!rename_host(&mut f, "web", "  "));

    assert!(forget_host(&mut f, "DEV-02"));
    assert_eq!(f.projects.len(), 2);
    assert!(!forget_host(&mut f, "dev-02"));
    assert!(!forget_host(&mut f, " "));
}

#[test]
fn new_ids_are_hex_and_distinct() {
    let a = new_id();
    let b = new_id();
    assert_ne!(a, b);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn old_membership_is_ignored_and_unknown_fields_survive_row_mutations() {
    let tmp = TempDir::new("workspace-왕복");
    let path = tmp.path("projects.json");
    std::fs::write(
        &path,
        r#"{"version":2,"futureFile":true,"projects":[{"id":"a","name":"a","path":"/a","host":"old","agent":null,"workspaceId":"ws-a","futureProject":{"x":1}}]}"#,
    )
    .unwrap();
    let mut file = load_file(&path);
    assert_eq!(file.version, Some(2));
    assert!(!file.projects[0].extra.contains_key("workspaceId"));
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("workspaceId"));
    assert!(rename_host(&mut file, "old", "new"));
    let p = normalize(file.projects[0].clone()).unwrap();
    upsert(&mut file, p);
    // 편집 폼이 보내지 않는 추가 필드는 보존한다.
    let mut replacement = file.projects[0].clone();
    replacement.extra.clear();
    replacement.name = "edited".into();
    upsert(&mut file, replacement);
    write_file(&path, &file).unwrap();
    let again = load_file(&path);
    assert_eq!(again, file);
    assert!(!std::fs::read_to_string(&path)
        .unwrap()
        .contains("workspaceId"));
    assert_eq!(
        again.projects[0].extra["futureProject"],
        serde_json::json!({"x":1})
    );
    assert_eq!(again.extra["futureFile"], true);
    assert!(!forget_host(&mut file, "unrelated"));
    assert!(!remove(&mut file, "unrelated"));
}

#[test]
fn create_is_independent_of_workspace_storage() {
    let tmp = TempDir::new("전역-생성");
    let path = tmp.path("projects.json");
    std::fs::write(tmp.path("workspaces.json"), b"{broken").unwrap();
    let (saved, changed) = upsert_at(&path, local("", "global")).unwrap();
    assert!(changed);
    assert!(!saved.id.is_empty());
    assert!(!upsert_at(&path, saved).unwrap().1);
    assert_eq!(
        std::fs::read(tmp.path("workspaces.json")).unwrap(),
        b"{broken"
    );
}
