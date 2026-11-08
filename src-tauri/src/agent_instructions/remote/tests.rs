//! 실제 SSH 없이 가짜 파일 시스템 스냅숏만 시험한다.
use super::*;

fn remote(id: &str, host: &str, path: &str) -> Project {
    serde_json::from_value(serde_json::json!({ "id": id, "name": id, "host": host, "path": path, "agent": null })).unwrap()
}

#[derive(Default)]
struct FakeFs {
    directories: HashSet<String>,
    files: HashMap<String, String>,
}

impl FakeFs {
    fn tree(path: &str) -> Self {
        Self { directories: HashSet::from([path.into()]), files: HashMap::new() }
    }
    fn snapshot(&self, path: &str) -> Snapshot {
        let get = |name| self.files.get(&crate::sftp::join_remote(path, name)).cloned();
        Snapshot {
            directory: Ok(self.directories.contains(path)), agents: Ok(get("AGENTS.md")), claude: Ok(get("CLAUDE.md")),
            other_claude: Ok(get(".claude/CLAUDE.md").is_some() || get("CLAUDE.local.md").is_some()),
        }
    }
    fn plan(&self, project: &Project, path: &str, body: Option<&str>) -> Vec<FileChange> {
        plan_snapshot(project, path, "/home/me", body, self.snapshot(path), false)
    }
    fn plan_subpath(&self, projects: &[&Project], wt: &str, subpath: Option<&str>, body: Option<&str>) -> Vec<FileChange> {
        let path = subpath.map_or_else(|| wt.to_owned(), |subpath| crate::sftp::join_remote(wt, subpath));
        let mut snapshot = self.snapshot(&path);
        snapshot.other_claude = Ok(claude_directories(subpath).iter().any(|directory| {
            let directory = if directory.is_empty() { wt.to_owned() } else { crate::sftp::join_remote(wt, directory) };
            ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].iter().any(|name| {
                !(directory == path && *name == "CLAUDE.md") && self.files.contains_key(&crate::sftp::join_remote(&directory, name))
            })
        }));
        plan_subpath_snapshot(projects, wt, "/home/me", subpath, body, snapshot, false)
    }
    fn plan_projects(&self, projects: &[Project], library: &[Instruction], worktrees: &dyn Fn(&Project) -> Vec<String>) -> Vec<FileChange> {
        let mut rows = Vec::new();
        for projects in host_groups(projects) {
            let mut groups = Vec::new();
            let mut indices = HashMap::new();
            for project in projects {
                group_worktrees(&mut groups, &mut indices, project, "/home/me", worktrees(project)).unwrap();
            }
            for (path, projects) in groups {
                for subpath in project_subpaths(library, &projects, &written::Written::new()) {
                    let body = projects_subpath_body(library, &projects, subpath.as_deref());
                    rows.extend(self.plan_subpath(&projects, &path, subpath.as_deref(), body.as_deref()));
                }
            }
        }
        rows
    }
}

#[test]
fn append_preserves_crlf_outside_and_uses_shared_local_decision() {
    let path = "/home/me/api";
    let project = remote("p", "dev-01", "~/api");
    let mut fs = FakeFs::tree(path);
    fs.files.insert(format!("{path}/AGENTS.md"), "human\r\n".into());
    let rows = fs.plan(&project, path, Some("PRIVATE_BODY\nrule"));
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].action, Action::Update);
    assert_eq!(rows[0].path, "~/api/AGENTS.md");
    assert_eq!(rows[0].host.as_deref(), Some("dev-01"));
    assert_eq!(rows[0].project_id.as_deref(), Some("p"));
    let written = super::super::tests::written(rows[0].edit.clone());
    assert!(written.starts_with("human\r\n\r\n"));
    assert!(!written.replace("\r\n", "").contains('\n'));
    assert_eq!(rows[0].edit, apply_block(Some("human\r\n"), Some("PRIVATE_BODY\nrule"), false).unwrap());
    assert_eq!(rows[1].action, Action::Unchanged);
    assert!(!format!("{:?}", rows[0]).contains("PRIVATE_BODY"));
    let json = serde_json::to_value(&rows[0]).unwrap();
    assert_eq!(json["projectId"], "p");
    assert_eq!(json["host"], "dev-01");
    assert!(json.get("file_path").is_none() && json.get("edit").is_none());
}

#[test]
fn new_remote_file_uses_lf_and_outside_home_keeps_absolute_path() {
    let path = "/srv/api";
    let project = remote("p", "dev-01", path);
    let rows = FakeFs::tree(path).plan(&project, path, Some("rule\r\nnext"));
    assert_eq!(rows[0].path, "/srv/api/AGENTS.md");
    assert_eq!(rows[0].action, Action::Create);
    let Edit::Write(text) = &rows[0].edit else { panic!("만들어야 한다"); };
    assert!(!text.contains('\r'));
    assert_eq!(rows[1].action, Action::Unchanged);
    assert_eq!(crate::git_repo::tilde_form("/home/me-other/api", Some("/home/me")), "/home/me-other/api");
}

#[test]
fn claude_import_conditions_match_local_snapshot_planner() {
    let path = "/home/me/api";
    let project = remote("p", "dev", "~/api");
    for existing in ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"] {
        let mut fs = FakeFs::tree(path);
        fs.files.insert(format!("{path}/{existing}"), "human\n".into());
        let rows = fs.plan(&project, path, Some("rule"));
        assert_eq!(rows[1].block.as_deref(), Some("@AGENTS.md"));
        assert_eq!(rows[1].action, if existing == "CLAUDE.md" { Action::Update } else { Action::Create });
    }
    let mut fs = FakeFs::tree(path);
    fs.files.insert(format!("{path}/CLAUDE.md"), "  @AGENTS.md  \nkeep\n".into());
    assert_eq!(fs.plan(&project, path, Some("rule"))[1].action, Action::Unchanged);
    let block = managed_block("@AGENTS.md", false, "\n", true);
    fs.files.insert(format!("{path}/CLAUDE.md"), format!("@AGENTS.md\n\n{block}"));
    assert_eq!(fs.plan(&project, path, Some("rule"))[1].edit, Edit::Write("@AGENTS.md\n".into()));
    fs.files.insert(format!("{path}/CLAUDE.md"), block);
    assert_eq!(fs.plan(&project, path, None)[1].action, Action::Delete);
}

#[test]
fn missing_folder_and_missing_connection_skip_without_file_changes() {
    let project = remote("p", "dev-01", "~/missing");
    let fs = FakeFs::default();
    let rows = fs.plan(&project, "/home/me/missing", Some("body"));
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, Action::Skipped);
    assert_eq!(rows[0].path, "~/missing");
    assert_eq!(rows[0].edit, Edit::Unchanged);
    let row = no_connection(&project);
    assert_eq!(row.action, Action::Skipped);
    assert_eq!(row.reason, Some(tr!(ko: "이 호스트에 열린 SSH 연결이 없습니다 — 그 호스트의 타일을 열고 다시 미리 보기 하세요", en: "There is no open SSH connection to this host — open a tile for that host and preview again")));
    assert_eq!(row.host.as_deref(), Some("dev-01"));
    assert_eq!(row.edit, Edit::Unchanged);
    assert!(row.block.is_none());
}

#[test]
fn picks_smallest_interactive_session_ignoring_alias_case() {
    let sessions = [(2, "DEV-01", false), (8, "dev-01", true), (4, "Dev-01", true), (1, "other", true)];
    assert_eq!(tile_id("dev-01", sessions.into_iter()), Some(4));
    assert_eq!(tile_id("unknown", sessions.into_iter()), None);
    assert_eq!(tile_id("dev-01", [(2, "DEV-01", false)].into_iter()), None);
}

#[test]
fn broken_and_unreadable_files_do_not_hide_other_rows_or_leak_body() {
    let path = "/home/me/api";
    let project = remote("p", "dev", "~/api");
    let mut fs = FakeFs::tree(path);
    fs.files.insert(format!("{path}/AGENTS.md"), "<!-- aynx:begin -->\nSECRET\n".into());
    fs.files.insert(format!("{path}/CLAUDE.md"), "human\n".into());
    let rows = fs.plan(&project, path, Some("new"));
    assert_eq!(rows[0].action, Action::Error);
    assert!(!rows[0].reason.as_deref().unwrap().contains("SECRET"));
    assert_eq!(rows[1].action, Action::Update);
    let mut snapshot = fs.snapshot(path);
    snapshot.agents = Err("permission denied".into());
    assert_eq!(plan_snapshot(&project, path, "/home/me", Some("new"), snapshot, false)[0].action, Action::Error);
}

#[test]
fn project_lookup_matches_alias_case_and_tilde_or_absolute_repo_only() {
    let projects = [remote("other-host", "prod", "~/api"), remote("other-repo", "dev-01", "~/api-other"), remote("p", "DEV-01", "~/api/")];
    for repo in ["~/api", "/home/me/api", "/home/me//api/"] {
        assert_eq!(find_project(&projects, "dev-01", repo, "/home/me").map(|p| p.id.as_str()), Some("p"));
    }
    let projects = [remote("absolute", "Dev-01", "/home/me/api")];
    assert_eq!(find_project(&projects, "DEV-01", "~/api", "/home/me").map(|p| p.id.as_str()), Some("absolute"));
    for (host, repo) in [("wrong", "~/api"), ("dev-01", "~/API"), ("dev-01", "~/api-other"), ("dev-01", "../api")] {
        assert!(find_project(&projects, host, repo, "/home/me").is_none());
    }
}

#[test]
fn listing_reuses_porcelain_excludes_bare_and_falls_back_on_failure() {
    let outcome = crate::ssh::ExecOutcome { exit_code: Some(0), stdout: "worktree /home/me/api\nHEAD abc\nbranch refs/heads/main\n\nworktree /home/me/bare\nbare\n\nworktree /home/me/api-wt/new\nHEAD def\nbranch refs/heads/new\n".into(), ..Default::default() };
    assert_eq!(worktree_paths(&outcome, "/fallback"), ["/home/me/api", "/home/me/api-wt/new"]);
    for outcome in [crate::ssh::ExecOutcome::default(), crate::ssh::ExecOutcome { timed_out: true, ..outcome.clone() }, crate::ssh::ExecOutcome { error: Some("git failed".into()), ..outcome }] {
        assert_eq!(worktree_paths(&outcome, "/fallback"), ["/fallback"]);
    }
}

#[test]
fn single_worktree_uses_only_its_project_and_excludes_globals() {
    let path = "/home/me/api";
    let a = remote("a", "dev", "~/api");
    let b = remote("b", "dev", "~/api");
    let mut global = super::super::tests::item("global", "GLOBAL");
    global.scope = Scope::Global;
    let library = [global, super::super::tests::project_item("a", "ONLY_A"), super::super::tests::project_item("b", "ONLY_B")];
    let fs = FakeFs::tree(path);
    for (project, expected, excluded) in [(&a, "ONLY_A", "ONLY_B"), (&b, "ONLY_B", "ONLY_A")] {
        let body = project_body(&library, project).unwrap();
        let rows = fs.plan(project, path, Some(&body));
        let block = rows[0].block.as_deref().unwrap();
        assert!(block.contains(expected) && !block.contains(excluded) && !block.contains("GLOBAL"));
        assert!(rows.iter().all(|row| row.scope == Scope::Project));
    }
}

#[test]
fn shared_worktree_unions_project_items_once_per_file() {
    let path = "/home/me/api";
    let projects = [remote("a", "DEV-01", "~/api/"), remote("b", "dev-01", "/home/me//api/.")];
    let mut alpha = super::super::tests::project_item("a", "ONLY_A");
    alpha.name = "alpha".into();
    let mut beta = super::super::tests::project_item("b", "ONLY_B");
    beta.name = "beta".into();
    let mut common = super::super::tests::project_item("a", "COMMON");
    common.name = "common".into();
    common.projects.push("b".into());
    let mut disabled = super::super::tests::project_item("b", "DISABLED");
    disabled.name = "disabled".into();
    disabled.enabled = false;
    let global = super::super::tests::item("global", "GLOBAL");
    let library = [beta, common.clone(), disabled, alpha, common, global];
    let mut fs = FakeFs::tree(path);
    fs.files.insert(format!("{path}/CLAUDE.local.md"), "human".into());
    let worktrees = |project: &Project| vec![project.path.clone(), path.into(), "/home/me//api/".into()];
    let rows = fs.plan_projects(&projects, &library, &worktrees);
    assert_eq!(rows.len(), 2);
    for name in ["AGENTS.md", "CLAUDE.md"] {
        assert_eq!(rows.iter().filter(|row| row.file_path == Path::new(&format!("{path}/{name}"))).count(), 1);
    }
    assert!(rows.iter().all(|row| row.project_id.as_deref() == Some("a") && row.host.as_deref() == Some("DEV-01")));
    assert_eq!(rows[0].block.as_deref(), Some("## alpha\n\nONLY_A\n\n## beta\n\nONLY_B\n\n## common\n\nCOMMON"));
    assert_eq!(rows[1].block.as_deref(), Some("@AGENTS.md"));
    assert_eq!(rows[0].action, Action::Create);
    assert_eq!(rows[1].action, Action::Create);
    let reversed = [projects[1].clone(), projects[0].clone()];
    let reversed_rows = fs.plan_projects(&reversed, &library, &worktrees);
    assert_eq!(reversed_rows.len(), 2);
    assert!(reversed_rows.iter().all(|row| row.project_id.as_deref() == Some("b")));
    assert_eq!(reversed_rows[0].block, rows[0].block);
}

#[test]
fn host_and_case_sensitive_remote_paths_keep_groups_separate() {
    let path = "/home/me/api";
    let projects = [remote("a", "DEV", "~/api"), remote("b", "dev", "~/API"), remote("c", "other", "~/api")];
    let mut library = Vec::new();
    for project in &projects {
        let mut item = super::super::tests::project_item(&project.id, &project.id);
        item.name = project.id.clone();
        library.push(item);
    }
    let mut fs = FakeFs::tree(path);
    fs.directories.insert("/home/me/API".into());
    let rows = fs.plan_projects(&projects, &library, &|project| vec![project.path.clone()]);
    assert_eq!(rows.len(), 6);
    for (index, project) in projects.iter().enumerate() {
        assert_eq!(rows[index * 2].project_id.as_deref(), Some(project.id.as_str()));
        assert_eq!(rows[index * 2].block, Some(format!("## {}\n\n{}", project.id, project.id)));
    }
}

#[test]
fn worktree_listing_and_separate_registration_union_at_the_shared_remote_path() {
    let main = "/home/me/main";
    let shared = "/home/me/shared";
    let projects = [remote("main", "DEV", "~/main"), remote("separate", "dev", "~/shared")];
    let mut alpha = super::super::tests::project_item("main", "MAIN");
    alpha.name = "alpha".into();
    let mut beta = super::super::tests::project_item("separate", "SEPARATE");
    beta.name = "beta".into();
    let mut fs = FakeFs::tree(main);
    fs.directories.insert(shared.into());
    let rows = fs.plan_projects(&projects, &[beta, alpha], &|project| {
        if project.id == "main" { vec![main.into(), shared.into(), "~/shared/".into()] }
        else { vec!["/home/me//shared/".into()] }
    });
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0].block.as_deref(), Some("## alpha\n\nMAIN"));
    assert_eq!(rows[2].block.as_deref(), Some("## alpha\n\nMAIN\n\n## beta\n\nSEPARATE"));
    assert!(rows.iter().all(|row| row.project_id.as_deref() == Some("main")));
}

#[test]
fn remote_subfolder_uses_all_claude_ancestors_and_missing_folder_rule() {
    let wt = "/home/me/repo";
    let path = "/home/me/repo/pkg/api";
    let project = remote("p", "dev", "~/repo");
    let mut fs = FakeFs::tree(wt);
    fs.directories.insert(path.into());
    fs.files.insert("/home/me/CLAUDE.md".into(), "outside".into());
    assert_eq!(fs.plan_subpath(&[&project], wt, Some("pkg/api"), Some("RULE"))[1].action, Action::Unchanged);
    for existing in ["CLAUDE.md", "pkg/CLAUDE.local.md", "pkg/.claude/CLAUDE.md"] {
        fs.files.insert(format!("{wt}/{existing}"), "human".into());
        let rows = fs.plan_subpath(&[&project], wt, Some("pkg/api"), Some("RULE"));
        assert_eq!(rows[0].path, "~/repo/pkg/api/AGENTS.md");
        assert_eq!(rows[0].action, Action::Create);
        assert_eq!(rows[1].action, Action::Create);
        assert_eq!(rows[1].block.as_deref(), Some("@AGENTS.md"));
        fs.files.remove(&format!("{wt}/{existing}"));
    }
    fs.files.insert(format!("{path}/CLAUDE.md"), "@AGENTS.md\r\nkeep\r\n".into());
    assert_eq!(fs.plan_subpath(&[&project], wt, Some("pkg/api"), Some("RULE"))[1].action, Action::Unchanged);
    fs.directories.remove(path);
    let rows = fs.plan_subpath(&[&project], wt, Some("pkg/api"), Some("RULE"));
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, Action::Skipped);
    assert_eq!(rows[0].reason, Some(subfolder_missing()));
    assert!(rows[0].missing_subfolder);
    assert_eq!(rows[0].edit, Edit::Unchanged);
}

#[test]
fn remote_same_subpath_unions_and_record_only_paths_remove_old_blocks() {
    let wt = "/home/me/repo";
    let path = "/home/me/repo/pkg/api";
    let projects = [remote("a", "DEV", "~/repo"), remote("b", "dev", "~/repo")];
    let mut alpha = super::super::tests::project_item("a", "A");
    alpha.name = "alpha".into();
    alpha.subpath = Some("pkg/api".into());
    let mut beta = super::super::tests::project_item("b", "B");
    beta.name = "beta".into();
    beta.subpath = Some("pkg/api".into());
    let mut fs = FakeFs::tree(wt);
    fs.directories.insert(path.into());
    let rows = fs.plan_projects(&projects, &[alpha, beta], &|_| vec![wt.into()]);
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[2].block.as_deref(), Some("## alpha\n\nA\n\n## beta\n\nB"));
    let mut history = written::Written::new();
    written::update(&mut history, &rows, false);
    assert!(history["a"].contains("pkg/api") && history["b"].contains("pkg/api"));
    fs.files.insert(format!("{path}/AGENTS.md"), managed_block("old", false, "\n", true));
    fs.files.insert(format!("{path}/CLAUDE.md"), managed_block("@AGENTS.md", false, "\n", true));
    let group = [&projects[0], &projects[1]];
    assert!(project_subpaths(&[], &group, &history).contains(&Some("pkg/api".into())));
    let mut removed = fs.plan_subpath(&group, wt, Some("pkg/api"), None);
    assert!(removed.iter().all(|row| row.action == Action::Delete));
    removed[1] = failed(removed[1].clone(), "failure".into());
    written::update(&mut history, &removed, true);
    assert!(history["a"].contains("pkg/api") && history["b"].contains("pkg/api"));
    let removed = fs.plan_subpath(&group, wt, Some("pkg/api"), None);
    written::update(&mut history, &removed, true);
    assert!(history.is_empty());
}

#[test]
fn remote_timeout_preserves_possible_writes_for_next_cleanup() {
    let project = remote("p", "dev", "~/repo");
    let mut fs = FakeFs::tree("/home/me/repo");
    fs.directories.insert("/home/me/repo/pkg/api".into());
    let mut rows = fs.plan_subpath(&[&project], "/home/me/repo", Some("pkg/api"), Some("RULE"));
    rows[0].attempted_write = true;
    mark_timeout(&mut rows);
    assert_eq!(rows[0].action, Action::Error);
    let mut history = written::Written::new();
    written::update(&mut history, &rows, false);
    assert!(history["p"].contains("pkg/api"));
}
