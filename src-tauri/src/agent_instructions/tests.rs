//! 지침 테스트는 임시 폴더만 쓴다. 사용자 홈·실제 설정·git·모델 호출은 없다.

use super::*;

struct Temp(PathBuf);

static TEMP_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

impl Temp {
    fn new() -> Self {
        let sequence = TEMP_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("aynx-instructions-{}-{nanos}-{sequence}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    fn write(&self, name: &str, text: &str) -> PathBuf {
        let path = self.path(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        path
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn item(name: &str, body: &str) -> Instruction {
    Instruction {
        name: name.into(), description: None, targets: vec!["*".into()], enabled: true,
        scope: Scope::Global, projects: Vec::new(), subpath: None, body: body.into(), extra: Vec::new(),
    }
}

fn project(id: &str, path: &Path) -> Project {
    serde_json::from_value(serde_json::json!({
        "id": id, "name": id, "path": path.to_string_lossy(), "host": null, "agent": null
    })).unwrap()
}

pub(super) fn project_item(id: &str, body: &str) -> Instruction {
    let mut value = item("project", body);
    value.scope = Scope::Project;
    value.projects = vec![id.into()];
    value
}

pub(super) fn written(edit: Edit) -> String {
    match edit {
        Edit::Write(text) => text,
        other => panic!("쓰기여야 한다: {other:?}"),
    }
}

fn env<'a>(worktrees: &'a dyn Fn(&Path) -> Vec<PathBuf>) -> PlanEnv<'a> {
    PlanEnv { dev: false, claude_global: None, codex_global: None, worktrees }
}

fn row<'a>(rows: &'a [FileChange], path: &Path) -> &'a FileChange {
    rows.iter().find(|row| row.file_path == path).expect("계획에 파일이 있다")
}

#[test]
fn front_matter_round_trip_quotes_targets_and_extra() {
    let text = "---\r\ntargets: [\"claudecode\", 'codexcli', \"future\"] # 도구\r\ndescription: 'It''s # a, rule'\r\naynx:\r\n  enabled: false\r\n  scope: project\r\n  projects: [\"p1\", 'p2']\r\ncursor:\r\n  globs: [\"**/*.rs\"]\r\n  nested:\r\n    value: keep # 원문\r\nother: plain\r\n---\r\n본문\r\n";
    let parsed = parse("rule", text).unwrap();
    assert_eq!(parsed.targets, ["claude", "codex", "future"]);
    assert_eq!(parsed.description.as_deref(), Some("It's # a, rule"));
    assert_eq!(parsed.scope, Scope::Project);
    assert!(!parsed.enabled);
    let next = serialize(&parsed, "\r\n");
    assert!(next.contains("cursor:\r\n  globs: [\"**/*.rs\"]\r\n  nested:\r\n    value: keep # 원문\r\nother: plain\r\n"));
    assert!(next.contains("\"claudecode\", \"codexcli\", \"future\""));
    assert_eq!(parse("rule", &next).unwrap(), parsed);
    assert_eq!(serialize(&parse("rule", &next).unwrap(), "\r\n"), next);
    let escaped = parse("quotes", "---\ndescription: \"a \\\"quote\\\" \\n line\"\n---\nbody").unwrap();
    assert_eq!(escaped.description.as_deref(), Some("a \"quote\" \n line"));
    assert_eq!(parse("quotes", &serialize(&escaped, "\n")).unwrap(), escaped);
}

#[test]
fn front_matter_defaults_and_plain_values() {
    let value = parse("defaults", "---\n---\nbody\n").unwrap();
    assert_eq!(value.targets, ["*"]);
    assert!(value.enabled);
    assert_eq!(value.scope, Scope::Global);
    assert!(value.projects.is_empty());
    assert_eq!(value.body, "body\n");
    let plain = parse("plain", "---\ntargets: \"*\"\ndescription: don't change # comment\naynx:\n  scope: 'global'\n  enabled: true # comment\n---\nbody").unwrap();
    assert_eq!(plain.description.as_deref(), Some("don't change"));
    assert_eq!(plain.targets, ["*"]);
    assert!(parse("empty", "---\ntargets: []\n---\n").unwrap().targets.is_empty());
}

#[test]
fn malformed_items_are_local_and_body_never_leaks() {
    let temp = Temp::new();
    temp.write("good.md", "---\n---\nGOOD_BODY");
    temp.write("close.md", "---\ndescription: x\nPRIVATE_BODY");
    temp.write("scope.md", "---\naynx:\n  scope: nowhere\n---\nPRIVATE_BODY");
    temp.write("Bad.md", "ignored");
    temp.write("unused.txt", "ignored");
    let listed = list_at(&temp.0).unwrap();
    assert_eq!(listed.items.len(), 1);
    assert_eq!(listed.items[0].name, "good");
    assert_eq!(listed.broken.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(), ["close", "scope"]);
    assert!(listed.broken.iter().all(|b| !b.reason.contains("PRIVATE_BODY")));
    assert!(!format!("{:?}", listed.items[0]).contains("GOOD_BODY"));
    let json = serde_json::to_string(&listed).unwrap();
    assert!(!json.contains("PRIVATE_BODY"));
    assert!(!json.contains("extra"));
    for bad in [
        "no header", "---\ntargets: [\"x\",]\n---\nsecret",
        "---\naynx:\n   scope: global\n---\nsecret",
        "---\naynx:\n  enabled: yes\n---\nsecret",
        "---\ndescription: \"unfinished\n---\nsecret",
        "---\ntargets: [\"a\"]\ntargets: [\"b\"]\n---\nsecret",
    ] {
        assert!(parse("bad", bad).is_err(), "{bad}");
    }
    for name in ["", "Upper", "a.b", "../escape", &"a".repeat(49), "한글"] {
        assert!(!name_ok(name));
    }
    assert!(name_ok("rule-01_a"));
    assert!(name_ok(&"a".repeat(48)));
}

#[test]
fn compose_uses_names_order_headings_and_trimmed_bodies() {
    assert_eq!(compose(&[]), None);
    let mut a = item("a", " \nfirst\n ");
    a.description = Some("규칙".into());
    let b = item("b", " second ");
    assert_eq!(compose(&[b, a]).as_deref(), Some("## 규칙\n\nfirst\n\n## b\n\nsecond"));
}

#[test]
fn block_append_create_replace_and_unchanged() {
    assert_eq!(apply_block(None, None, false), Ok(Edit::Unchanged));
    assert_eq!(apply_block(Some("keep"), None, false), Ok(Edit::Unchanged));
    let new = written(apply_block(None, Some("body"), false).unwrap());
    assert_eq!(new, managed_block("body", false, "\n", true));
    for before in ["keep", "keep\n", "keep\n\n"] {
        let out = written(apply_block(Some(before), Some("body"), false).unwrap());
        assert!(out.starts_with(before));
        assert_eq!(out, format!("keep\n\n{new}"));
        assert_eq!(apply_block(Some(&out), Some("body"), false), Ok(Edit::Unchanged));
        let replaced = written(apply_block(Some(&out), Some("other"), false).unwrap());
        assert_eq!(replaced, format!("keep\n\n{}", managed_block("other", false, "\n", true)));
    }
}

#[test]
fn block_removal_cleans_one_blank_line_or_deletes() {
    let block = managed_block("body", false, "\n", true);
    assert_eq!(apply_block(Some(&block), None, false), Ok(Edit::Delete));
    assert_eq!(apply_block(Some(&format!(" \n{block}\t\n")), None, false), Ok(Edit::Delete));
    let before = format!("keep\n\n{block}");
    assert_eq!(written(apply_block(Some(&before), None, false).unwrap()), "keep\n");
    let before = format!("keep\n\n\n{block}tail\n");
    assert_eq!(written(apply_block(Some(&before), None, false).unwrap()), "keep\n\ntail\n");
    let before = format!("keep \t\n{block}tail\n");
    assert_eq!(written(apply_block(Some(&before), None, false).unwrap()), "keep \t\ntail\n");
}

#[test]
fn blocks_preserve_outside_bytes_crlf_and_eof_terminator() {
    for newline in ["\n", "\r\n"] {
        let prefix = format!("  사람 \t{newline}{newline}");
        let suffix = "\t뒤 글자  \n끝에는 개행 없음";
        let before = format!("{prefix}{}{suffix}", managed_block("old", false, newline, true));
        let out = written(apply_block(Some(&before), Some("new\nbody"), false).unwrap());
        assert_eq!(out.as_bytes().get(..prefix.len()), Some(prefix.as_bytes()));
        assert!(out.as_bytes().ends_with(suffix.as_bytes()));
        assert_eq!(out, format!("{prefix}{}{suffix}", managed_block("new\nbody", false, newline, true)));
        let removed = written(apply_block(Some(&before), None, false).unwrap());
        assert_eq!(removed, format!("  사람 \t{newline}{suffix}"));
        let eof = managed_block("old", false, newline, false);
        let out = written(apply_block(Some(&eof), Some("new"), false).unwrap());
        assert!(!out.ends_with('\n'));
        assert_eq!(out, managed_block("new", false, newline, false));
        let before = format!("기존{newline}");
        let out = written(apply_block(Some(&before), Some("new\nbody"), false).unwrap());
        if newline == "\r\n" {
            assert!(!out.replace("\r\n", "").contains('\n'));
        }
    }
}

#[test]
fn broken_markers_error_and_similar_names_are_not_markers() {
    for text in [
        "<!-- aynx:begin -->\nbody\n",
        "body\n<!-- aynx:end -->\n",
        "<!-- aynx:begin -->\n<!-- aynx:end -->\n<!-- aynx:begin -->\n<!-- aynx:end -->\n",
        "<!-- aynx:end -->\n<!-- aynx:begin -->\n",
    ] {
        assert_eq!(apply_block(Some(text), Some("new"), false), Err(BlockError));
        assert_eq!(apply_block(Some(text), None, false), Err(BlockError));
    }
    assert!(marker("  <!-- aynx:begin-->  ", "aynx", "begin"));
    assert!(!marker("<!-- aynx:beginning -->", "aynx", "begin"));
    assert!(!marker("<!-- aynx-dev:begin -->", "aynx", "begin"));
    assert_eq!(apply_block(Some("<!-- aynx:beginning -->\n"), None, false), Ok(Edit::Unchanged));
}

#[test]
fn dev_and_release_blocks_coexist_without_changing_each_other() {
    let release = managed_block("release", false, "\n", true);
    let dev = managed_block("dev", true, "\n", true);
    let both = format!("{release}\n{dev}");
    let out = written(apply_block(Some(&both), Some("new dev"), true).unwrap());
    assert!(out.starts_with(&format!("{release}\n")));
    let out = written(apply_block(Some(&both), Some("new release"), false).unwrap());
    assert!(out.ends_with(&format!("\n{dev}")));
    let out = written(apply_block(Some(&both), None, true).unwrap());
    assert_eq!(out, release);
    assert_eq!(apply_block(Some("<!-- aynx:begin -->\n"), None, true), Ok(Edit::Unchanged));
}

#[test]
fn plan_filters_global_targets_and_disabled_items() {
    let temp = Temp::new();
    let roots = |_path: &Path| Vec::new();
    let mut environment = env(&roots);
    environment.claude_global = Some(temp.path("claude/CLAUDE.md"));
    environment.codex_global = Some(temp.path("codex/AGENTS.md"));
    let mut claude = item("a", "CLAUDE_ONLY");
    claude.targets = vec!["claude".into()];
    let mut codex = item("b", "CODEX_ONLY");
    codex.targets = vec!["codexcli".into()];
    let mut unknown = item("c", "UNKNOWN");
    unknown.targets = vec!["future".into()];
    let mut disabled = item("d", "DISABLED");
    disabled.enabled = false;
    let project_only = project_item("p", "PROJECT_ONLY");
    let rows = plan(&environment, &[codex, unknown, disabled, project_only, claude, item("all", "BOTH")], &[]);
    assert_eq!(rows.len(), 2);
    for (path, own, other) in [
        (temp.path("claude/CLAUDE.md"), "CLAUDE_ONLY", "CODEX_ONLY"),
        (temp.path("codex/AGENTS.md"), "CODEX_ONLY", "CLAUDE_ONLY"),
    ] {
        let row = row(&rows, &path);
        assert_eq!(row.action, Action::Create);
        let body = row.block.as_deref().unwrap();
        assert!(body.contains(own) && body.contains("BOTH"));
        for absent in [other, "UNKNOWN", "DISABLED", "PROJECT_ONLY"] {
            assert!(!body.contains(absent));
        }
        assert!(!path.exists(), "미리 보기는 쓰지 않는다");
    }
}

#[test]
fn project_plan_copies_to_two_worktrees_ignores_targets_and_removes_old_blocks() {
    let temp = Temp::new();
    let wt1 = temp.path("one");
    let wt2 = temp.path("two");
    std::fs::create_dir_all(&wt1).unwrap();
    std::fs::create_dir_all(&wt2).unwrap();
    let roots = |_path: &Path| vec![wt1.clone(), wt2.clone()];
    let environment = env(&roots);
    let projects = [project("p", &wt1)];
    let mut value = project_item("p", "PROJECT_RULE");
    value.targets = vec!["future".into()];
    let mut disabled = project_item("p", "DISABLED");
    disabled.name = "disabled".into();
    disabled.enabled = false;
    let mut rows = plan(&environment, &[value, disabled], &projects);
    assert_eq!(rows.len(), 4);
    let body = row(&rows, &wt1.join("AGENTS.md")).block.clone();
    assert_eq!(body, row(&rows, &wt2.join("AGENTS.md")).block);
    assert!(body.unwrap().contains("PROJECT_RULE"));
    for wt in [&wt1, &wt2] {
        assert_eq!(row(&rows, &wt.join("CLAUDE.md")).action, Action::Unchanged);
        assert_eq!(row(&rows, &wt.join("AGENTS.md")).action, Action::Create);
    }
    apply_changes(&mut rows);
    for wt in [&wt1, &wt2] {
        assert!(wt.join("AGENTS.md").is_file());
        assert!(!wt.join("CLAUDE.md").exists());
    }
    // 항목이 사라져도 등록된 로컬 프로젝트 전부를 돈다.
    let removed = plan(&environment, &[], &projects);
    for wt in [&wt1, &wt2] {
        assert_eq!(row(&removed, &wt.join("AGENTS.md")).action, Action::Delete);
    }
}

#[test]
fn claude_file_is_created_only_when_an_existing_claude_file_hides_agents() {
    let temp = Temp::new();
    let none = temp.path("none");
    let local = temp.path("local");
    let hidden = temp.path("hidden");
    let imports = temp.path("imports");
    std::fs::create_dir_all(&none).unwrap();
    temp.write("local/CLAUDE.local.md", "local rules\n");
    temp.write("hidden/.claude/CLAUDE.md", "hidden rules\n");
    let human = "  @AGENTS.md  \nkeep\t\n";
    let agents_import = temp.write("imports/CLAUDE.md", human);
    let roots = |_path: &Path| vec![none.clone(), local.clone(), hidden.clone(), imports.clone()];
    let rows = plan(&env(&roots), &[project_item("p", "body")], &[project("p", &none)]);
    assert_eq!(row(&rows, &none.join("CLAUDE.md")).action, Action::Unchanged);
    for wt in [&local, &hidden] {
        let row = row(&rows, &wt.join("CLAUDE.md"));
        assert_eq!(row.action, Action::Create);
        assert_eq!(row.block.as_deref(), Some("@AGENTS.md"));
    }
    assert_eq!(row(&rows, &agents_import).action, Action::Unchanged);
    assert_eq!(row(&rows, &agents_import).block, None);
    assert_eq!(std::fs::read_to_string(&agents_import).unwrap(), human);
}

#[test]
fn project_claude_blocks_are_removed_with_items_or_redundant_human_imports() {
    let temp = Temp::new();
    let block = managed_block("@AGENTS.md", false, "\n", true);
    let claude = temp.write("repo/CLAUDE.md", &format!("human\n\n{block}"));
    let agents = temp.write("repo/AGENTS.md", &managed_block("old", false, "\n", true));
    let repo = temp.path("repo");
    let roots = |_path: &Path| vec![repo.clone()];
    let environment = env(&roots);
    let projects = [project("p", &repo)];
    let rows = plan(&environment, &[], &projects);
    assert_eq!(row(&rows, &agents).action, Action::Delete);
    assert_eq!(row(&rows, &claude).action, Action::Update);
    assert_eq!(row(&rows, &claude).edit, Edit::Write("human\n".into()));
    std::fs::write(&claude, format!("@AGENTS.md\n\n{block}")).unwrap();
    let rows = plan(&environment, &[project_item("p", "new")], &projects);
    assert_eq!(row(&rows, &claude).block, None);
    assert_eq!(row(&rows, &claude).edit, Edit::Write("@AGENTS.md\n".into()));
}

#[test]
fn claude_import_does_not_depend_on_another_instances_managed_import() {
    let temp = Temp::new();
    let release = managed_block("@AGENTS.md", false, "\n", true);
    let claude = temp.write("repo/CLAUDE.md", &release);
    let repo = temp.path("repo");
    let roots = |_path: &Path| vec![repo.clone()];
    let mut environment = env(&roots);
    environment.dev = true;
    let rows = plan(&environment, &[project_item("p", "body")], &[project("p", &repo)]);
    let row = row(&rows, &claude);
    assert_eq!(row.block.as_deref(), Some("@AGENTS.md"));
    let out = written(row.edit.clone());
    assert!(out.starts_with(&release));
    assert!(out.contains("<!-- aynx-dev:begin"));
    assert_eq!(outside_import("<!-- aynx:begin -->\n", true), Ok(false));
}

#[test]
fn remote_and_wsl_are_skipped_without_listing_or_reading_files() {
    let temp = Temp::new();
    let mut remote = project("remote", &temp.path("remote"));
    remote.host = Some("host".into());
    let wsl = project("wsl", Path::new(r"\\wsl$\Ubuntu\repo"));
    let localhost = project("localhost", Path::new(r"\\WSL.LocalHost\Ubuntu\repo"));
    let roots = |_path: &Path| -> Vec<PathBuf> { panic!("건너뛴 경로의 목록을 읽으면 안 된다") };
    let mut environment = env(&roots);
    environment.codex_global = Some(PathBuf::from(r"\\wsl.localhost\Ubuntu\codex\AGENTS.md"));
    let rows = plan(&environment, &[], &[remote, wsl, localhost]);
    assert_eq!(rows.len(), 4);
    assert!(rows.iter().all(|row| row.action == Action::Skipped && row.reason.is_some()));
    assert_eq!(rows[0].scope, Scope::Global);
    assert!(wsl_path(Path::new(r"\\?\UNC\wsl$\Ubuntu\repo")));
    assert!(!wsl_path(Path::new(r"\\wsl$-backup\repo")));
    assert!(!wsl_path(Path::new(r"C:\wsl$\repo")));
}

#[test]
fn plan_reports_broken_files_and_keeps_processing_other_files() {
    let temp = Temp::new();
    let broken = temp.write("broken/AGENTS.md", "<!-- aynx:begin -->\nSECRET\n");
    let repo = temp.path("broken");
    std::fs::create_dir_all(temp.path("good")).unwrap();
    let roots = |_path: &Path| vec![repo.clone(), temp.path("good")];
    let rows = plan(&env(&roots), &[project_item("p", "body")], &[project("p", &repo)]);
    let error = row(&rows, &broken);
    assert_eq!(error.action, Action::Error);
    assert!(!error.reason.as_deref().unwrap().contains("SECRET"));
    assert_eq!(row(&rows, &temp.path("good/AGENTS.md")).action, Action::Create);
    assert_eq!(std::fs::read_to_string(&broken).unwrap(), "<!-- aynx:begin -->\nSECRET\n");
}

#[test]
fn atomic_writes_and_apply_really_create_replace_delete_in_temporary_folders() {
    let temp = Temp::new();
    let path = temp.path("nested/AGENTS.md");
    let mut create = vec![plan_file(&path, Scope::Global, None, Some("codex"), Some("one"), false)];
    assert_eq!(create[0].action, Action::Create);
    apply_changes(&mut create);
    let before = std::fs::read_to_string(&path).unwrap();
    assert_eq!(before, managed_block("one", false, "\n", true));
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    write_atomic(&path, &before, true).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), modified);
    let mut update = vec![plan_file(&path, Scope::Global, None, Some("codex"), Some("two"), false)];
    assert_eq!(update[0].action, Action::Update);
    apply_changes(&mut update);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), managed_block("two", false, "\n", true));
    assert_eq!(plan_file(&path, Scope::Global, None, Some("codex"), Some("two"), false).action, Action::Unchanged);
    let mut delete = vec![plan_file(&path, Scope::Global, None, Some("codex"), None, false)];
    assert_eq!(delete[0].action, Action::Delete);
    apply_changes(&mut delete);
    assert!(!path.exists());
    assert_eq!(std::fs::read_dir(path.parent().unwrap()).unwrap().count(), 0, "임시 쓰기 파일이 남지 않는다");
}

#[test]
fn failed_apply_row_does_not_stop_other_rows() {
    let temp = Temp::new();
    let blocker = temp.write("blocker", "a file cannot be a parent folder");
    let bad = blocker.join("AGENTS.md");
    let good = temp.path("good/AGENTS.md");
    // 계획 뒤 부모가 바뀐 상황도 쓰기 함수에서 파일별 오류로 남긴다.
    let mut bad_row = change(&bad, Scope::Global, None, Some("codex"), Some("body"));
    bad_row.action = Action::Create;
    bad_row.edit = Edit::Write("body".into());
    let mut rows = vec![bad_row, plan_file(&good, Scope::Global, None, Some("codex"), Some("body"), false)];
    apply_changes(&mut rows);
    assert_eq!(rows[0].action, Action::Error);
    assert!(rows[0].reason.is_some());
    assert_eq!(rows[1].action, Action::Create);
    assert!(good.is_file());
}

#[test]
fn empty_and_relative_projects_are_skipped_before_listing() {
    let projects = [
        project("empty", Path::new("")),
        project("relative", Path::new("relative")),
        project("nested", Path::new("relative/nested")),
    ];
    let roots = |_path: &Path| -> Vec<PathBuf> { panic!("잘못된 프로젝트 경로는 조회하지 않는다") };
    let mut rows = plan(&env(&roots), &[project_item("empty", "body")], &projects);
    assert_eq!(rows.len(), projects.len());
    for (row, project) in rows.iter().zip(&projects) {
        assert_eq!(row.action, Action::Skipped);
        assert!(row.reason.is_some());
        assert_eq!(row.project_id.as_deref(), Some(project.id.as_str()));
        assert_eq!(row.edit, Edit::Unchanged);
        assert_eq!(row.block, None);
    }
    apply_changes(&mut rows);
    assert!(rows.iter().all(|row| row.action == Action::Skipped));
}

#[test]
fn empty_and_relative_worktrees_are_skipped() {
    let temp = Temp::new();
    let roots = |_path: &Path| vec![PathBuf::new(), PathBuf::from("relative"), temp.0.clone()];
    let mut rows = plan(&env(&roots), &[project_item("p", "body")], &[project("p", &temp.0)]);
    assert_eq!(rows.len(), 4);
    for path in [Path::new(""), Path::new("relative")] {
        let skipped = row(&rows, path);
        assert_eq!(skipped.action, Action::Skipped);
        assert!(skipped.reason.is_some());
        assert_eq!(skipped.edit, Edit::Unchanged);
    }
    assert_eq!(row(&rows, &temp.path("AGENTS.md")).action, Action::Create);
    apply_changes(&mut rows);
    assert!(temp.path("AGENTS.md").is_file());
}

#[test]
fn missing_and_non_directory_projects_are_skipped_before_listing() {
    let temp = Temp::new();
    let missing = temp.path("missing/repo");
    let file = temp.write("file", "keep");
    let roots = |_path: &Path| -> Vec<PathBuf> { panic!("없는 프로젝트 폴더는 조회하지 않는다") };
    let mut rows = plan(&env(&roots), &[project_item("p", "body")], &[
        project("p", &missing), project("file", &file),
    ]);
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.action == Action::Skipped && row.reason.is_some()));
    apply_changes(&mut rows);
    assert!(!temp.path("missing").exists());
    assert_eq!(std::fs::read_to_string(file).unwrap(), "keep");
}

#[test]
fn missing_and_non_directory_worktrees_are_skipped_without_recreation() {
    let temp = Temp::new();
    let missing = temp.path("prunable");
    let file = temp.write("file", "keep");
    let roots = |_path: &Path| vec![missing.clone(), file.clone(), temp.0.clone()];
    let mut rows = plan(&env(&roots), &[project_item("p", "body")], &[project("p", &temp.0)]);
    assert_eq!(rows.len(), 4);
    for path in [&missing, &file] {
        let skipped = row(&rows, path);
        assert_eq!(skipped.action, Action::Skipped);
        assert!(skipped.reason.is_some());
        assert_eq!(skipped.edit, Edit::Unchanged);
    }
    apply_changes(&mut rows);
    assert!(!missing.exists());
    assert_eq!(std::fs::read_to_string(file).unwrap(), "keep");
    assert!(temp.path("AGENTS.md").is_file());
}

#[test]
fn project_apply_does_not_recreate_parent_removed_after_planning() {
    let temp = Temp::new();
    let repo = temp.path("repo");
    std::fs::create_dir(&repo).unwrap();
    let roots = |_path: &Path| vec![repo.clone()];
    let mut environment = env(&roots);
    let global = temp.path("global/nested/AGENTS.md");
    environment.codex_global = Some(global.clone());
    let mut rows = plan(&environment, &[item("global", "global"), project_item("p", "body")], &[project("p", &repo)]);
    assert_eq!(row(&rows, &repo.join("AGENTS.md")).action, Action::Create);
    std::fs::remove_dir(&repo).unwrap();
    apply_changes(&mut rows);
    let failed = row(&rows, &repo.join("AGENTS.md"));
    assert_eq!(failed.action, Action::Error);
    assert!(failed.reason.is_some());
    assert!(!repo.exists());
    assert_eq!(row(&rows, &global).action, Action::Create);
    assert!(global.is_file());
}

#[test]
fn shared_worktree_unions_project_items_once_per_file() {
    let temp = Temp::new();
    let main = temp.path("main");
    let shared = temp.path("shared");
    std::fs::create_dir(&main).unwrap();
    temp.write("shared/CLAUDE.local.md", "local rules");
    let roots = |path: &Path| {
        if path == main.as_path() {
            let mut paths = vec![main.clone(), shared.clone(), shared.clone()];
            if cfg!(windows) {
                paths.push(PathBuf::from(shared.to_string_lossy().replace('\\', "/").to_uppercase()));
                paths.push(std::fs::canonicalize(&shared).unwrap());
            }
            paths
        } else { vec![shared.clone()] }
    };
    let mut alpha = project_item("main", "MAIN_RULE");
    alpha.name = "alpha".into();
    let mut beta = project_item("separate", "SEPARATE_RULE");
    beta.name = "beta".into();
    let mut common = project_item("main", "COMMON_RULE");
    common.name = "common".into();
    common.projects.push("separate".into());
    let mut disabled = project_item("separate", "DISABLED_RULE");
    disabled.name = "disabled".into();
    disabled.enabled = false;
    let library = [beta, common.clone(), disabled, alpha, common];
    let projects = [project("main", &main), project("separate", &shared)];
    let rows = plan(&env(&roots), &library, &projects);
    assert_eq!(rows.len(), 4);
    for name in ["AGENTS.md", "CLAUDE.md"] {
        assert_eq!(rows.iter().filter(|row| row.file_path == shared.join(name)).count(), 1);
    }
    let agents = row(&rows, &shared.join("AGENTS.md"));
    assert_eq!(agents.project_id.as_deref(), Some("main"));
    assert_eq!(agents.block.as_deref(), Some("## alpha\n\nMAIN_RULE\n\n## beta\n\nSEPARATE_RULE\n\n## common\n\nCOMMON_RULE"));
    assert!(agents.host.is_none());
    assert_eq!(row(&rows, &main.join("AGENTS.md")).block.as_deref(), Some("## alpha\n\nMAIN_RULE\n\n## common\n\nCOMMON_RULE"));
    assert_eq!(row(&rows, &shared.join("CLAUDE.md")).block.as_deref(), Some("@AGENTS.md"));
    let mut reversed = projects.clone();
    reversed.reverse();
    let reverse_rows = plan(&env(&roots), &library, &reversed);
    assert_eq!(reverse_rows.len(), 4);
    let after = row(&reverse_rows, &shared.join("AGENTS.md"));
    assert_eq!(after.project_id.as_deref(), Some("separate"));
    assert_eq!(after.block, agents.block);
}

#[test]
fn worktree_keys_normalize_separators_verbatim_and_windows_case() {
    assert_eq!(worktree_key(Path::new(r"C:\Repo\Tree")), worktree_key(Path::new("C:/Repo/Tree/")));
    assert_eq!(worktree_key(Path::new(r"\\?\C:\Repo\Tree")), worktree_key(Path::new("C:/Repo/Tree")));
    assert_eq!(worktree_key(Path::new(r"\\?\UNC\server\share\Tree")), worktree_key(Path::new("//server/share/Tree")));
    let upper = worktree_key(Path::new("C:/Repo/Tree"));
    let lower = worktree_key(Path::new("c:/repo/tree"));
    if cfg!(windows) {
        assert_eq!(upper, lower);
    } else {
        assert_ne!(upper, lower);
    }
}

#[test]
fn plan_loads_projects_from_supplied_path_independent_of_library_parent() {
    let temp = Temp::new();
    let repo = temp.path("repo");
    std::fs::create_dir(&repo).unwrap();
    let library = temp.path("library/instructions");
    save_at(&library, project_item("p", "FROM_PROJECTS_PATH"), None).unwrap();
    // 라이브러리 부모에 있는 다른 목록을 잘못 읽지 않는다.
    temp.write("library/projects.json", "{\"projects\":[]}");
    let projects_path = temp.write("configuration/projects.json", &serde_json::json!({
        "projects": [project("p", &repo)]
    }).to_string());
    let roots = |_path: &Path| vec![repo.clone()];
    let rows = plan_at(&library, &projects_path, &env(&roots)).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(row(&rows, &repo.join("AGENTS.md")).block.as_deref(), Some("## project\n\nFROM_PROJECTS_PATH"));
    // 경로 함수 조회만 한다 — 사용자 설정 파일은 열지 않는다.
    assert_eq!(crate::projects::projects_path(), crate::instance::config_root().map(|root| root.join("projects.json")));
    assert!(!repo.join("AGENTS.md").exists());
}

#[test]
fn save_preserves_extra_rejects_collisions_renames_and_delete_validates_names() {
    let temp = Temp::new();
    let original = "---\r\ntargets: [\"*\"]\r\ncursor:\r\n  include: [\"a\"] # keep\r\n---\r\nold\r\n";
    temp.write("old.md", original);
    let mut value = item("new", "changed\nline\n");
    value.description = Some("응답 규칙".into());
    let saved = save_at(&temp.0, value.clone(), Some("old")).unwrap();
    assert!(!temp.path("old.md").exists());
    let new = std::fs::read_to_string(temp.path("new.md")).unwrap();
    assert!(new.contains("cursor:\r\n  include: [\"a\"] # keep\r\n"));
    assert!(!new.replace("\r\n", "").contains('\n'));
    assert_eq!(saved.body, "changed\r\nline\r\n");
    assert_eq!(saved, parse("new", &new).unwrap());
    let modified = std::fs::metadata(temp.path("new.md")).unwrap().modified().unwrap();
    save_at(&temp.0, saved.clone(), Some("new")).unwrap();
    assert_eq!(std::fs::metadata(temp.path("new.md")).unwrap().modified().unwrap(), modified);
    assert!(save_at(&temp.0, value.clone(), None).is_err());
    temp.write("other.md", "---\n---\nkeep");
    assert!(save_at(&temp.0, value, Some("other")).is_err());
    assert!(temp.path("other.md").exists());
    let mut invalid = item("../outside", "secret");
    assert!(save_at(&temp.0, invalid.clone(), None).is_err());
    invalid.name = "ok".into();
    assert!(save_at(&temp.0, invalid, Some("../outside")).is_err());
    assert!(delete_at(&temp.0, "../outside").is_err());
    delete_at(&temp.0, "new").unwrap();
    delete_at(&temp.0, "new").unwrap();
    assert!(!temp.path("new.md").exists());
    assert!(std::fs::read_dir(&temp.0).unwrap().all(|file| !file.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
}

#[test]
fn import_strips_both_instances_preserving_outside_text_and_source() {
    let temp = Temp::new();
    let release = managed_block("RELEASE_ONLY", false, "\r\n", true);
    let dev = managed_block("DEV_ONLY", true, "\r\n", true);
    let original = format!("  first\t\r\n{release}middle\r\n{dev}last  ");
    let agents = temp.write("repo/AGENTS.md", &original);
    let roots = |_path: &Path| -> Vec<PathBuf> { panic!("가져오기는 워크트리를 조회하지 않는다") };
    let candidates = import_candidates_at(&temp.path("library"), &env(&roots), Some(&project("p", &temp.path("repo")))).unwrap();
    assert_eq!(candidates.len(), 1);
    let candidate = &candidates[0];
    assert_eq!(candidate.body, "first\t\nmiddle\nlast");
    // 원본 경로는 Path::join 으로 만든 것 — temp.write 의 "repo/AGENTS.md" 글자와 Windows 구분자가 다르다.
    assert_eq!(candidate.source, temp.path("repo").join("AGENTS.md").to_string_lossy());
    assert!(agents.ends_with("AGENTS.md"));
    assert_eq!(candidate.label, "AGENTS.md");
    assert_eq!(candidate.suggested_name, "p-agents");
    assert_eq!(candidate.scope, Scope::Project);
    assert_eq!(candidate.projects, ["p"]);
    assert_eq!(candidate.targets, ["*"]);
    assert_eq!(candidate.skipped, None);
    assert_eq!(std::fs::read_to_string(agents).unwrap(), original);
    assert_eq!(strip_import_blocks(&original).unwrap(), "  first\t\r\nmiddle\r\nlast  ");
    let json = serde_json::to_value(candidate).unwrap();
    assert_eq!(json["suggestedName"], "p-agents");
    assert!(!json.as_object().unwrap().contains_key("suggested_name"));
}

#[test]
fn import_ignores_managed_blocks_only_and_whitespace_only_files() {
    let temp = Temp::new();
    temp.write("repo/AGENTS.md", &format!("{}\n{}", managed_block("release", false, "\n", true), managed_block("dev", true, "\n", true)));
    temp.write("repo/CLAUDE.md", " \r\n\t\n");
    temp.write("repo/.rulesync/rules/empty.md", "---\ntargets: [\"*\"]\n---\n   \n");
    let roots = |_path: &Path| Vec::new();
    let candidates = import_candidates_at(&temp.path("library"), &env(&roots), Some(&project("p", &temp.path("repo")))).unwrap();
    assert!(candidates.is_empty());
    assert!(!temp.path("library").exists());
}

#[test]
fn import_skips_broken_or_overlapping_markers_without_exposing_body() {
    let temp = Temp::new();
    temp.write("repo/AGENTS.md", "<!-- aynx:begin -->\nPRIVATE_BODY\n");
    temp.write("repo/CLAUDE.md", "<!-- aynx-dev:end -->\nPRIVATE_BODY\n");
    temp.write("repo/CLAUDE.local.md", "<!-- aynx:begin -->\n<!-- aynx-dev:begin -->\nPRIVATE_BODY\n<!-- aynx:end -->\n<!-- aynx-dev:end -->\n");
    temp.write("repo/.claude/CLAUDE.md", "valid");
    temp.write("repo/.rulesync/rules/header.md", "---\n<!-- aynx-dev:begin -->\ntargets: [\"*\"]\n---\nPRIVATE_BODY");
    let roots = |_path: &Path| Vec::new();
    let candidates = import_candidates_at(&temp.path("library"), &env(&roots), Some(&project("p", &temp.path("repo")))).unwrap();
    assert_eq!(candidates.len(), 5);
    assert_eq!(candidates.iter().filter(|candidate| candidate.skipped.is_some()).count(), 4);
    for candidate in candidates.iter().filter(|candidate| candidate.skipped.is_some()) {
        assert!(candidate.body.is_empty());
        assert!(!candidate.skipped.as_deref().unwrap().contains("PRIVATE_BODY"));
    }
    assert!(candidates.iter().any(|candidate| candidate.body == "valid"));
    assert!(!serde_json::to_string(&candidates).unwrap().contains("PRIVATE_BODY"));
}

#[test]
fn import_rulesync_reads_front_matter_and_falls_back_to_full_source() {
    let temp = Temp::new();
    let valid = "---\r\ntargets: [\"claudecode\", \"codexcli\"]\r\ndescription: 'Shared rule'\r\naynx:\r\n  scope: global\r\n  enabled: false\r\n  projects: [\"other\"]\r\n---\r\n  first\r\nsecond  ";
    temp.write("repo/.rulesync/rules/Shared Rule.md", valid);
    let invalid = "---\ntargets: [broken\n---\nraw body";
    temp.write("repo/.rulesync/rules/bad.md", invalid);
    let roots = |_path: &Path| Vec::new();
    let candidates = import_candidates_at(&temp.path("library"), &env(&roots), Some(&project("p", &temp.path("repo")))).unwrap();
    assert_eq!(candidates.len(), 2);
    let shared = candidates.iter().find(|candidate| candidate.suggested_name == "shared-rule").unwrap();
    assert_eq!(shared.description.as_deref(), Some("Shared rule"));
    assert_eq!(shared.targets, ["claude", "codex"]);
    assert_eq!(shared.body, "first\nsecond");
    assert_eq!(shared.scope, Scope::Project);
    assert_eq!(shared.projects, ["p"]);
    let bad = candidates.iter().find(|candidate| candidate.suggested_name == "bad").unwrap();
    assert_eq!(bad.body, invalid);
    assert_eq!(bad.description, None);
    assert_eq!(bad.targets, ["*"]);
}

#[test]
fn import_names_are_valid_unique_against_library_and_other_candidates() {
    let temp = Temp::new();
    temp.write("repo/AGENTS.md", "agents");
    temp.write("repo/CLAUDE.md", "claude");
    temp.write("repo/CLAUDE.local.md", "local");
    temp.write("repo/.claude/CLAUDE.md", "dir");
    temp.write("repo/.rulesync/rules/My App-agents.md", "rulesync");
    temp.write("repo/.rulesync/rules/한글.md", "fallback");
    temp.write("library/my-app-agents.md", "---\n---\nexisting");
    temp.write("library/my-app-agents-2.md", "broken library entry");
    let mut p = project("p", &temp.path("repo"));
    p.name = "My App".into();
    let roots = |_path: &Path| Vec::new();
    let candidates = import_candidates_at(&temp.path("library"), &env(&roots), Some(&p)).unwrap();
    let names: Vec<&str> = candidates.iter().map(|candidate| candidate.suggested_name.as_str()).collect();
    assert_eq!(names, ["my-app-agents-3", "my-app-claude", "my-app-claude-dir", "my-app-claude-local", "my-app-agents-4", "imported"]);
    assert!(names.iter().all(|name| name_ok(name)));
    let mut used = HashSet::new();
    let long = import_slug(&"A".repeat(80));
    let first = unique_import_name(&long, &mut used);
    let second = unique_import_name(&long, &mut used);
    assert!(name_ok(&first) && name_ok(&second));
    assert_eq!(first.len(), 48);
    assert_eq!(second.len(), 48);
    assert!(second.ends_with("-2"));
    p.name = "한글".into();
    let candidates = import_candidates_at(&temp.path("library"), &env(&roots), Some(&p)).unwrap();
    assert_eq!(candidates[0].suggested_name, "imported-agents");
}

#[test]
fn import_global_uses_supplied_paths_and_remote_is_rejected_before_reading() {
    let temp = Temp::new();
    let claude = temp.write("global/claude/CLAUDE.md", "claude body");
    let codex = temp.write("global/codex/AGENTS.md", "codex body");
    let roots = |_path: &Path| -> Vec<PathBuf> { panic!("가져오기는 목록을 읽지 않는다") };
    let mut environment = env(&roots);
    environment.claude_global = Some(claude.clone());
    environment.codex_global = Some(codex.clone());
    let candidates = import_candidates_at(&temp.path("library"), &environment, None).unwrap();
    assert_eq!(candidates.len(), 2);
    for (candidate, name, target, path) in [
        (&candidates[0], "claude-global", "claude", claude),
        (&candidates[1], "codex-global", "codex", codex),
    ] {
        assert_eq!(candidate.suggested_name, name);
        assert_eq!(candidate.targets, [target]);
        assert_eq!(candidate.scope, Scope::Global);
        assert!(candidate.projects.is_empty());
        assert_eq!(candidate.source, path.to_string_lossy());
    }
    let mut remote = project("remote", &temp.path("absent"));
    remote.host = Some("host".into());
    // 라이브러리 자리조차 읽지 않는다 — 파일인 경로를 주어도 원격 오류가 먼저다.
    let invalid_library = temp.write("not-a-directory", "keep");
    let reason = match import_candidates_at(&invalid_library, &environment, Some(&remote)) {
        Err(reason) => reason,
        Ok(_) => panic!("원격 가져오기는 거절해야 한다"),
    };
    assert_eq!(reason, tr!(ko: "원격 프로젝트는 아직 지원하지 않습니다", en: "Remote projects are not supported yet"));
}

#[test]
fn apply_worktree_writes_only_requested_tree_without_touching_main_or_globals() {
    let temp = Temp::new();
    let main = temp.path("main");
    std::fs::create_dir(&main).unwrap();
    let next = temp.path("next");
    std::fs::create_dir(&next).unwrap();
    let another = temp.path("another");
    std::fs::create_dir(&another).unwrap();
    temp.write("next/CLAUDE.local.md", "local");
    let library = temp.path("library");
    save_at(&library, project_item("p", "NEW_PROJECT_RULE"), None).unwrap();
    save_at(&library, item("global", "GLOBAL_RULE"), None).unwrap();
    let mut other = project_item("other", "OTHER_RULE");
    other.name = "other".into();
    save_at(&library, other, None).unwrap();
    let projects_path = temp.write("config/projects.json", &serde_json::json!({
        "projects": [project("p", &main), project("other", &another)]
    }).to_string());
    let roots = |_path: &Path| -> Vec<PathBuf> { panic!("새 워크트리 반영은 기존 워크트리 목록을 조회하지 않는다") };
    let mut environment = env(&roots);
    let global = temp.write("global/AGENTS.md", "GLOBAL_ORIGINAL");
    environment.codex_global = Some(global.clone());
    environment.claude_global = Some(temp.path("global/CLAUDE.md"));
    let rows = apply_worktree_at(&library, &projects_path, &environment, "p", &next).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.scope == Scope::Project && row.project_id.as_deref() == Some("p")));
    assert!(rows.iter().all(|row| row.action == Action::Create));
    let agents = std::fs::read_to_string(next.join("AGENTS.md")).unwrap();
    assert!(agents.contains("NEW_PROJECT_RULE"));
    assert!(!agents.contains("GLOBAL_RULE") && !agents.contains("OTHER_RULE"));
    assert!(std::fs::read_to_string(next.join("CLAUDE.md")).unwrap().contains("@AGENTS.md"));
    for path in [&main, &another] {
        assert!(!path.join("AGENTS.md").exists());
        assert!(!path.join("CLAUDE.md").exists());
    }
    assert_eq!(std::fs::read_to_string(global).unwrap(), "GLOBAL_ORIGINAL");
    assert!(!temp.path("global/CLAUDE.md").exists());
}

#[test]
fn apply_worktree_without_enabled_project_instructions_does_not_write_or_delete() {
    let temp = Temp::new();
    let main = temp.path("main");
    let next = temp.path("next");
    std::fs::create_dir(&main).unwrap();
    std::fs::create_dir(&next).unwrap();
    let library = temp.path("library");
    save_at(&library, item("global", "global"), None).unwrap();
    let mut disabled = project_item("p", "disabled");
    disabled.enabled = false;
    save_at(&library, disabled, None).unwrap();
    let projects_path = temp.write("config/projects.json", &serde_json::json!({
        "projects": [project("p", &main)]
    }).to_string());
    let roots = |_path: &Path| Vec::new();
    let rows = apply_worktree_at(&library, &projects_path, &env(&roots), "p", &next).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.action == Action::Unchanged));
    assert_eq!(std::fs::read_dir(&next).unwrap().count(), 0);
    // 저장소에서 복사된 블록이 있어도 켜진 프로젝트 지침이 없으면 쓰기가 없다.
    let original = managed_block("COPIED_RULE", false, "\n", true);
    std::fs::write(next.join("AGENTS.md"), &original).unwrap();
    let rows = apply_worktree_at(&library, &projects_path, &env(&roots), "p", &next).unwrap();
    assert!(rows.iter().all(|row| row.action == Action::Unchanged));
    assert_eq!(std::fs::read_to_string(next.join("AGENTS.md")).unwrap(), original);
}

#[test]
fn apply_worktree_missing_or_remote_project_returns_empty_before_library_read() {
    let temp = Temp::new();
    let mut remote = project("remote", &temp.path("remote"));
    remote.host = Some("host".into());
    let projects_path = temp.write("config/projects.json", &serde_json::json!({ "projects": [remote] }).to_string());
    let invalid_library = temp.write("not-a-directory", "keep");
    let roots = |_path: &Path| -> Vec<PathBuf> { panic!("원격 워크트리 목록은 읽지 않는다") };
    for id in ["absent", "remote"] {
        let rows = apply_worktree_at(&invalid_library, &projects_path, &env(&roots), id, &temp.path("absent-tree")).unwrap();
        assert!(rows.is_empty());
    }
    assert!(!temp.path("absent-tree").exists());
}

#[test]
fn subpath_front_matter_round_trip_preserves_unknown_agentsmd_children() {
    let text = "---\r\naynx:\r\n  scope: project\r\n  projects: [\"p\"]\r\nagentsmd:\r\n  subprojectPath: \"pkg\\\\api/\"\r\n  future:\r\n    nested: keep # 그대로\r\n  unknown: [a, b]\r\ncursor:\r\n  glob: keep\r\n---\r\nbody\r\n";
    let parsed = parse("rule", text).unwrap();
    assert_eq!(parsed.subpath.as_deref(), Some("pkg/api"));
    let next = serialize(&parsed, "\r\n");
    assert!(next.contains("agentsmd:\r\n  subprojectPath: \"pkg/api\"\r\n  future:\r\n    nested: keep # 그대로\r\n  unknown: [a, b]\r\n"));
    assert_eq!(parse("rule", &next).unwrap(), parsed);
    assert_eq!(serialize(&parse("rule", &next).unwrap(), "\r\n"), next);
    let root = parse("root", "---\nagentsmd:\n  subprojectPath: \"\"\n---\nbody").unwrap();
    assert_eq!(root.subpath, None);
    assert_eq!(parse("blank", "---\nagentsmd:\n  subprojectPath:\n---\nbody").unwrap().subpath, None);
    assert!(!serialize(&root, "\n").contains("subprojectPath"));
    let extra = parse("root", "---\nagentsmd:\n  future: keep\n---\nbody").unwrap();
    assert!(serialize(&extra, "\n").contains("agentsmd:\n  future: keep\n"));
    assert!(!serialize(&extra, "\n").contains("subprojectPath"));
}

#[test]
fn subpath_validation_rejects_invalid_paths_on_parse_and_save() {
    let temp = Temp::new();
    for path in ["pkg//api", ".", "..", "pkg/./api", "pkg/../api", "C:/api", "C:api", "a:b", "a\n", "a\r", "a\0", "a\u{85}", &"a".repeat(201)] {
        assert!(normalize_subpath(Some(path)).is_err(), "{path:?}");
        let text = format!("---\naynx:\n  scope: project\nagentsmd:\n  subprojectPath: {}\n---\nbody", quoted(path));
        assert!(parse("bad", &text).is_err(), "{path:?}");
        let mut value = project_item("p", "body");
        value.subpath = Some(path.into());
        assert!(save_at(&temp.path("library"), value, None).is_err());
    }
    assert!(!temp.path("library").exists());
    assert_eq!(normalize_subpath(Some(r"pkg\api/")).unwrap().as_deref(), Some("pkg/api"));
    assert_eq!(normalize_subpath(Some("/pkg/api/")).unwrap().as_deref(), Some("pkg/api"));
    assert_eq!(normalize_subpath(Some("/")).unwrap(), None);
    assert_eq!(normalize_subpath(Some(&format!("/{}//", "a".repeat(200)))).unwrap(), Some("a".repeat(200)));
    for path in ["가".repeat(200), "😀".repeat(200)] {
        assert_eq!(normalize_subpath(Some(&path)).unwrap(), Some(path));
    }
    let mut value = item("global", "body");
    value.subpath = Some("pkg/api".into());
    assert!(save_at(&temp.path("library"), value, None).is_err());
    assert!(parse("global", "---\nagentsmd:\n  subprojectPath: pkg/api\n---\nbody").is_err());
}

#[test]
fn rulesync_import_transfers_subpath_without_aynx_header() {
    let temp = Temp::new();
    temp.write("repo/.rulesync/rules/api.md", "---\ntargets: [codexcli]\nagentsmd:\n  subprojectPath: pkg/api\n---\nAPI_RULE");
    let roots = |_path: &Path| Vec::new();
    let project = project("p", &temp.path("repo"));
    let candidates = import_candidates_at(&temp.path("library"), &env(&roots), Some(&project)).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].scope, Scope::Project);
    assert_eq!(candidates[0].subpath.as_deref(), Some("pkg/api"));
    assert_eq!(candidates[0].body, "API_RULE");
}

fn subpath_item(name: &str, id: &str, subpath: &str, body: &str) -> Instruction {
    let mut value = project_item(id, body);
    value.name = name.into();
    value.subpath = Some(subpath.into());
    value
}

#[test]
fn subfolder_blocks_and_claude_ancestors_stop_at_worktree_boundary() {
    let temp = Temp::new();
    let wt = temp.path("repo");
    let api = wt.join("pkg/api");
    std::fs::create_dir_all(&api).unwrap();
    // 워크트리 바깥의 파일은 판정에 들어가지 않는다.
    temp.write("CLAUDE.md", "outside");
    let roots = |_path: &Path| vec![wt.clone()];
    let projects = [project("p", &wt)];
    let library = [subpath_item("api", "p", "pkg/api", "API_RULE")];
    let mut rows = plan(&env(&roots), &library, &projects);
    assert_eq!(row(&rows, &api.join("AGENTS.md")).action, Action::Create);
    assert_eq!(row(&rows, &api.join("CLAUDE.md")).action, Action::Unchanged);
    assert_eq!(row(&rows, &wt.join("AGENTS.md")).block, None);
    apply_changes(&mut rows);
    assert!(api.join("AGENTS.md").is_file());
    assert!(!api.join("CLAUDE.md").exists());
    let human = "root\r\n";
    temp.write("repo/CLAUDE.md", human);
    let mut rows = plan(&env(&roots), &library, &projects);
    assert_eq!(row(&rows, &api.join("CLAUDE.md")).action, Action::Create);
    apply_changes(&mut rows);
    assert!(std::fs::read_to_string(api.join("CLAUDE.md")).unwrap().contains("@AGENTS.md"));
    assert_eq!(std::fs::read_to_string(wt.join("CLAUDE.md")).unwrap(), human);
    std::fs::remove_file(wt.join("CLAUDE.md")).unwrap();
    std::fs::remove_file(api.join("CLAUDE.md")).unwrap();
    temp.write("repo/pkg/CLAUDE.local.md", "middle");
    let rows = plan(&env(&roots), &library, &projects);
    assert_eq!(row(&rows, &api.join("CLAUDE.md")).action, Action::Create);
    temp.write("repo/pkg/api/CLAUDE.md", "  @AGENTS.md  \r\nkeep\r\n");
    let rows = plan(&env(&roots), &library, &projects);
    assert_eq!(row(&rows, &api.join("CLAUDE.md")).action, Action::Unchanged);
}

#[test]
fn missing_subfolder_is_skipped_and_never_created() {
    let temp = Temp::new();
    let wt = temp.path("repo");
    std::fs::create_dir(&wt).unwrap();
    let roots = |_path: &Path| vec![wt.clone()];
    let mut rows = plan(&env(&roots), &[subpath_item("api", "p", "pkg/api", "RULE")], &[project("p", &wt)]);
    let skipped = row(&rows, &wt.join("pkg/api"));
    assert_eq!(skipped.action, Action::Skipped);
    assert_eq!(skipped.reason, Some(subfolder_missing()));
    assert!(skipped.missing_subfolder);
    apply_changes(&mut rows);
    assert!(!wt.join("pkg").exists());
}

#[test]
fn shared_worktree_unions_only_items_at_the_same_subpath() {
    let temp = Temp::new();
    let wt = temp.path("repo");
    std::fs::create_dir_all(wt.join("pkg/api")).unwrap();
    std::fs::create_dir_all(wt.join("pkg/web")).unwrap();
    let roots = |_path: &Path| vec![wt.clone(), wt.clone()];
    let projects = [project("a", &wt), project("b", &wt)];
    let mut common = subpath_item("common", "a", "pkg/api", "COMMON");
    common.projects.push("b".into());
    let library = [subpath_item("alpha", "a", "pkg/api", "A"), subpath_item("beta", "b", "pkg/api", "B"), common.clone(), common,
        subpath_item("web", "b", "pkg/web", "WEB"), project_item("a", "ROOT")];
    let rows = plan(&env(&roots), &library, &projects);
    assert_eq!(rows.iter().filter(|row| row.file_path == wt.join("pkg/api/AGENTS.md")).count(), 1);
    assert_eq!(row(&rows, &wt.join("pkg/api/AGENTS.md")).block.as_deref(), Some("## alpha\n\nA\n\n## beta\n\nB\n\n## common\n\nCOMMON"));
    assert_eq!(row(&rows, &wt.join("pkg/web/AGENTS.md")).block.as_deref(), Some("## web\n\nWEB"));
    assert_eq!(row(&rows, &wt.join("AGENTS.md")).block.as_deref(), Some("## project\n\nROOT"));
}

#[test]
fn history_cleans_old_subpaths_after_disable_delete_and_move_in_all_worktrees() {
    for operation in ["disable", "delete", "move"] {
        let temp = Temp::new();
        let one = temp.path("one");
        let two = temp.path("two");
        for wt in [&one, &two] {
            std::fs::create_dir_all(wt.join("pkg/api")).unwrap();
            std::fs::create_dir_all(wt.join("pkg/new")).unwrap();
            std::fs::write(wt.join("CLAUDE.md"), "human\n").unwrap();
            std::fs::write(wt.join("pkg/api/AGENTS.md"), "keep\r\n").unwrap();
        }
        let roots = |_path: &Path| vec![one.clone(), two.clone()];
        let projects = [project("p", &one)];
        let mut library = vec![subpath_item("api", "p", "pkg/api", "PRIVATE_RULE")];
        let history = temp.path("data/instructions-written.json");
        let mut rows = plan(&env(&roots), &library, &projects);
        apply_changes(&mut rows);
        written::persist_at(&history, &rows, true).unwrap();
        let text = std::fs::read_to_string(&history).unwrap();
        assert!(!text.contains("PRIVATE_RULE") && !text.contains("AGENTS.md"));
        assert_eq!(written::load(&history).unwrap()["p"], BTreeSet::from(["pkg/api".into()]));
        match operation {
            "disable" => library[0].enabled = false,
            "delete" => library.clear(),
            "move" => library[0].subpath = Some("pkg/new".into()),
            _ => unreachable!(),
        }
        let previous = written::load(&history).unwrap();
        let mut rows = plan_with_written(&env(&roots), &library, &projects, &previous);
        apply_changes(&mut rows);
        written::persist_at(&history, &rows, true).unwrap();
        for wt in [&one, &two] {
            assert_eq!(std::fs::read_to_string(wt.join("pkg/api/AGENTS.md")).unwrap(), "keep\r\n");
            assert!(!wt.join("pkg/api/CLAUDE.md").exists());
        }
        let history = written::load(&history).unwrap();
        if operation == "move" {
            assert_eq!(history["p"], BTreeSet::from(["pkg/new".into()]));
        } else { assert!(history.is_empty()); }
    }
}

#[test]
fn history_retains_failures_but_clears_missing_subfolder_and_already_absent_blocks() {
    let temp = Temp::new();
    let one = temp.path("one");
    let two = temp.path("two");
    std::fs::create_dir_all(one.join("pkg/api")).unwrap();
    std::fs::create_dir_all(two.join("pkg/api")).unwrap();
    temp.write("one/pkg/api/AGENTS.md", &managed_block("old", false, "\n", true));
    temp.write("two/pkg/api/CLAUDE.md", "<!-- aynx:begin -->\nBROKEN\n");
    let roots = |_path: &Path| vec![one.clone(), two.clone()];
    let projects = [project("p", &one)];
    let mut history = written::Written::from([("p".into(), BTreeSet::from(["pkg/api".into()]))]);
    let mut rows = plan_with_written(&env(&roots), &[], &projects, &history);
    apply_changes(&mut rows);
    written::update(&mut history, &rows, true);
    assert!(history["p"].contains("pkg/api"));
    assert!(!one.join("pkg/api/AGENTS.md").exists());
    std::fs::remove_dir_all(two.join("pkg/api")).unwrap();
    let mut rows = plan_with_written(&env(&roots), &[], &projects, &history);
    apply_changes(&mut rows);
    assert_eq!(row(&rows, &one.join("pkg/api/AGENTS.md")).action, Action::Unchanged);
    assert!(row(&rows, &two.join("pkg/api")).missing_subfolder);
    written::update(&mut history, &rows, true);
    assert!(history.is_empty());
    // 연결·워크트리 오류는 특정 하위 폴더를 읽기도 전이므로 모든 이전 기록을 보존한다.
    history.insert("p".into(), BTreeSet::from(["pkg/api".into()]));
    let blocker = skipped(&two, "p", "unavailable".into());
    written::update(&mut history, &[blocker], true);
    assert!(history["p"].contains("pkg/api"));
}

#[test]
fn history_retains_real_write_failure_and_rejects_corrupt_paths_without_home_access() {
    let temp = Temp::new();
    let wt = temp.path("repo");
    std::fs::create_dir_all(wt.join("pkg/api")).unwrap();
    let roots = |_path: &Path| vec![wt.clone()];
    let projects = [project("p", &wt)];
    let mut rows = plan(&env(&roots), &[subpath_item("api", "p", "pkg/api", "RULE")], &projects);
    std::fs::remove_dir_all(wt.join("pkg/api")).unwrap();
    std::fs::write(wt.join("pkg/api"), "blocks directory").unwrap();
    apply_changes(&mut rows);
    assert_eq!(row(&rows, &wt.join("pkg/api/AGENTS.md")).action, Action::Error);
    let mut history = written::Written::new();
    written::update(&mut history, &rows, true);
    assert!(history["p"].contains("pkg/api"));
    let path = temp.write("data/instructions-written.json", "broken");
    assert!(written::load(&path).unwrap().is_empty());
    assert!(written::decode(r#"{"p":["../outside"]}"#).is_none());
    assert!(written::decode(r#"{"p":[""]}"#).is_none());
    std::fs::write(&path, [0xff]).unwrap();
    assert!(written::load(&path).unwrap().is_empty());
    written::persist_at(&path, &rows, false).unwrap();
    assert!(written::load(&path).unwrap()["p"].contains("pkg/api"));
}

#[test]
fn single_worktree_plans_subpaths_and_records_without_enumerating_other_worktrees() {
    let temp = Temp::new();
    let main = temp.path("main");
    let next = temp.path("next");
    std::fs::create_dir(&main).unwrap();
    std::fs::create_dir_all(next.join("pkg/api")).unwrap();
    temp.write("next/CLAUDE.md", "human");
    let library = temp.path("library");
    let value = subpath_item("api", "p", "pkg/api", "API_RULE");
    save_at(&library, value.clone(), None).unwrap();
    let projects_path = temp.write("projects.json", &serde_json::json!({"projects": [project("p", &main)]}).to_string());
    let roots = |_path: &Path| -> Vec<PathBuf> { panic!("단일 반영은 목록을 조회하지 않는다"); };
    let project = project("p", &main);
    let planned = plan_worktree(&env(&roots), &[value], Some(&project), &next);
    assert_eq!(row(&planned, &next.join("pkg/api/AGENTS.md")).action, Action::Create);
    let history_path = temp.path("data/instructions-written.json");
    let rows = apply_worktree_recorded_at(&library, &projects_path, &env(&roots), "p", &next, &history_path).unwrap();
    assert_eq!(row(&rows, &next.join("pkg/api/CLAUDE.md")).action, Action::Create);
    assert!(written::load(&history_path).unwrap()["p"].contains("pkg/api"));
    assert!(!main.join("pkg").exists());
    delete_at(&library, "api").unwrap();
    apply_worktree_recorded_at(&library, &projects_path, &env(&roots), "p", &next, &history_path).unwrap();
    assert!(!next.join("pkg/api/AGENTS.md").exists());
    // 다른 워크트리의 부재는 확인하지 않았으므로 단일 반영만으로 기록을 지우지 않는다.
    assert!(written::load(&history_path).unwrap()["p"].contains("pkg/api"));
}
