use super::*;

const SAMPLE: &str = "worktree /home/me/api\n\
HEAD 1111111111111111111111111111111111111111\n\
branch refs/heads/main\n\
\n\
worktree /home/me/api-wt/feat/x\n\
HEAD 2222222222222222222222222222222222222222\n\
branch refs/heads/feat/x\n\
locked\n\
\n\
worktree /home/me/api-wt/probe\n\
HEAD 3333333333333333333333333333333333333333\n\
detached\n\
prunable gitdir file points to non-existent location\n\
\n";

#[test]
fn porcelain_reads_blocks_and_skips_unknown_lines() {
    let got = parse_porcelain(SAMPLE);
    assert_eq!(got.len(), 3);
    assert_eq!(got[0].path, "/home/me/api");
    assert_eq!(got[0].branch.as_deref(), Some("main"));
    assert_eq!(
        got[0].head.as_deref(),
        Some("1111111111111111111111111111111111111111")
    );
    assert!(!got[0].detached && !got[0].bare);
    // `refs/heads/` 만 떼고 나머지 `/` 는 이름의 일부다.
    assert_eq!(got[1].branch.as_deref(), Some("feat/x"));
    assert_eq!(got[2].branch, None);
    assert!(got[2].detached);
}

#[test]
fn porcelain_handles_bare_crlf_and_missing_trailing_blank() {
    let text = "worktree C:/src/repo.git\r\nbare\r\n\r\nworktree C:/src/repo-wt/a\r\nHEAD abc\r\nbranch refs/heads/a";
    let got = parse_porcelain(text);
    assert_eq!(got.len(), 2);
    assert!(got[0].bare);
    assert_eq!(got[0].head, None);
    assert_eq!(got[1].path, "C:/src/repo-wt/a");
    assert_eq!(got[1].branch.as_deref(), Some("a"));
    // 빈 입력·worktree 줄이 없는 덩어리는 아무것도 아니다.
    assert!(parse_porcelain("").is_empty());
    assert!(parse_porcelain("HEAD abc\nbranch refs/heads/x\n").is_empty());
}

#[test]
fn names_follow_the_rule() {
    for ok in ["feat-x", "feat/x", "v1.2", "a_b", " spaced-trim "] {
        assert!(valid_name(ok).is_ok(), "{ok}");
    }
    assert_eq!(valid_name(" feat ").unwrap(), "feat");
    for bad in [
        "",
        "  ",
        "-x",
        "--force",
        "a..b",
        "..",
        "/abs",
        "tail/",
        "a//b",
        "a/./b",
        ".",
        "has space",
        "semi;colon",
        "quote'",
        "dollar$",
        "back\\slash",
        "한글",
        "a\nb",
    ] {
        assert!(valid_name(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn new_worktree_goes_next_to_the_repo() {
    let repo = Path::new("/home/me/api");
    assert_eq!(
        worktree_path(repo, None, "feat-x").unwrap(),
        PathBuf::from("/home/me/api-wt/feat-x")
    );
    assert_eq!(
        worktree_path(repo, None, "feat/x").unwrap(),
        PathBuf::from("/home/me/api-wt").join("feat").join("x")
    );
    // 끝의 구분자는 이름을 바꾸지 않는다. 빈 칸은 칸이 없는 것과 같다.
    assert_eq!(
        worktree_path(Path::new("/home/me/api/"), Some("  "), "a").unwrap(),
        PathBuf::from("/home/me/api-wt/a")
    );
    assert!(worktree_path(Path::new("/"), None, "a").is_err());
    assert!(worktree_path(repo, None, "-x").is_err());
}

#[test]
fn worktree_dir_field_moves_the_base() {
    let repo = Path::new("/home/me/api");
    assert_eq!(
        worktree_path(repo, Some("/srv/wt"), "feat-x").unwrap(),
        PathBuf::from("/srv/wt/feat-x")
    );
    // 저장소 자신·그 안·상대 경로는 거절 — 이웃 폴더(`api-wt`)는 된다.
    assert!(worktree_path(repo, Some("/home/me/api"), "a").is_err());
    assert!(worktree_path(repo, Some("/home/me/api/wt"), "a").is_err());
    assert!(worktree_path(repo, Some("wt"), "a").is_err());
    assert!(worktree_path(repo, Some("/home/me/api-wt"), "a").is_ok());
}

#[test]
fn worktree_dir_check_table() {
    // (저장소, 폴더, 원격?, 통과?) — 프런트 `worktreeDirProblem` 과 같은 표.
    let table = [
        ("C:\\src\\aynx", "D:\\wt", false, true),
        ("C:\\src\\aynx", "C:\\src\\aynx-wt", false, true),
        ("C:\\src\\aynx", "\\\\nas\\wt", false, true),
        ("C:\\src\\aynx", "C:\\src\\aynx", false, false),
        ("C:\\src\\aynx", "c:/SRC/aynx/sub", false, false),
        ("C:\\src\\aynx", "C:\\src\\aynx\\", false, false),
        ("C:\\src\\aynx", "wt", false, false),
        ("C:\\src\\aynx", "~/wt", false, false),
        ("~/api", "~/wt", true, true),
        ("~/api", "/srv/wt", true, true),
        ("~/api", "~/api/wt", true, false),
        ("~/api", "wt", true, false),
        // 원격(리눅스)은 대소문자를 가린다 — `/srv/Api` 는 다른 폴더다.
        ("/srv/api", "/srv/Api/wt", true, true),
    ];
    for (repo, dir, remote, ok) in table {
        assert_eq!(
            check_worktree_dir(repo, dir, remote).is_ok(),
            ok,
            "{repo} {dir} {remote}"
        );
    }
    assert!(check_worktree_dir("/a", "/b\nrm", true).is_err());
}

#[cfg(windows)]
#[test]
fn new_worktree_path_on_windows() {
    assert_eq!(
        worktree_path(Path::new(r"C:\src\proj"), None, "feat-x").unwrap(),
        PathBuf::from(r"C:\src\proj-wt\feat-x")
    );
    assert_eq!(
        worktree_path(Path::new(r"C:\src\proj"), Some(r"D:\wt\proj"), "feat-x").unwrap(),
        PathBuf::from(r"D:\wt\proj\feat-x")
    );
}

#[test]
fn remote_list_command_quotes_the_repo() {
    assert_eq!(
        remote_list_command("~/api").as_deref(),
        Some("git -C \"$HOME\"/'api' worktree list --porcelain")
    );
    assert_eq!(
        remote_list_command("/srv/it's").as_deref(),
        Some("git -C '/srv/it'\\''s' worktree list --porcelain")
    );
    assert_eq!(remote_list_command("  "), None);
    assert_eq!(remote_list_command("/a\nrm -rf /"), None);
}

#[test]
fn remote_remove_commands_quote_and_never_force() {
    let c = remote_remove_commands("~/api", "/root/api-wt/fix").unwrap();
    assert_eq!(c.list, "git -C \"$HOME\"/'api' worktree list --porcelain");
    assert_eq!(
        c.remove,
        "git -C \"$HOME\"/'api' worktree remove '/root/api-wt/fix'"
    );
    assert_eq!(
        c.branch_delete("fix").as_deref(),
        Some("git -C \"$HOME\"/'api' branch -d 'fix'")
    );
    // `~` 경로도 셸이 편다 — 따옴표 밖의 `"$HOME"` 한 낱말.
    let t = remote_remove_commands("/srv/api", "~/api-wt/feat/x").unwrap();
    assert_eq!(
        t.remove,
        "git -C '/srv/api' worktree remove \"$HOME\"/'api-wt/feat/x'"
    );
    // 작은따옴표·`$`·공백도 한 낱말로 들어간다.
    let q = remote_remove_commands("/srv/it's", "/srv/w t/$x").unwrap();
    assert_eq!(
        q.remove,
        "git -C '/srv/it'\\''s' worktree remove '/srv/w t/$x'"
    );
    assert_eq!(
        q.branch_delete("a'b").as_deref(),
        Some("git -C '/srv/it'\\''s' branch -d 'a'\\''b'")
    );
    // 강제는 어디에도 없다.
    for s in [&c.list, &c.remove, &c.branch_delete("fix").unwrap()] {
        assert!(
            !s.contains("--force") && !s.contains(" -D") && !s.contains(" -f"),
            "{s}"
        );
    }
    // 옵션으로 읽힐 브랜치·빈 이름·개행은 짓지 않는다.
    assert_eq!(c.branch_delete("-D"), None);
    assert_eq!(c.branch_delete(" "), None);
    assert_eq!(c.branch_delete("a\nrm"), None);
    // 경로: 상대·옵션 모양·개행·빈 칸은 거절, 저장소가 비면 거절.
    for bad in ["api-wt/fix", "--force", "", "/a\nrm -rf /"] {
        assert_eq!(remote_remove_commands("~/api", bad), None, "{bad:?}");
    }
    assert_eq!(remote_remove_commands(" ", "/root/x"), None);
}

#[test]
fn remote_entry_matches_after_home_expansion() {
    let text = "worktree /root/api\nHEAD 1\nbranch refs/heads/main\n\n\
worktree /root/api-wt/fix\nHEAD 2\nbranch refs/heads/fix\n\n\
worktree /root/api-wt/probe\nHEAD 3\ndetached\n";
    let list = parse_porcelain(text);
    let home = Some("/root");
    // 절대 경로 그대로.
    let (e, main) = find_remote_entry(&list, "~/api", "/root/api-wt/fix", home);
    assert_eq!(e.and_then(|w| w.branch.as_deref()), Some("fix"));
    assert!(!main);
    // `~` 경로는 홈으로 펴서 맞댄다(끝 `/` 무시).
    let (e, _) = find_remote_entry(&list, "~/api", "~/api-wt/fix/", home);
    assert_eq!(e.map(|w| w.path.as_str()), Some("/root/api-wt/fix"));
    // 홈을 모르면 `~` 는 맞지 않는다 — 브랜치 없이(삭제 없이) 제거만 시도된다.
    assert!(find_remote_entry(&list, "~/api", "~/api-wt/fix", None)
        .0
        .is_none());
    // 주 작업 폴더 — 첫 덩어리이거나 저장소 자신.
    assert!(find_remote_entry(&list, "~/api", "/root/api", home).1);
    assert!(find_remote_entry(&list, "~/api", "~/api", home).1);
    assert!(find_remote_entry(&[], "~/api", "~/api/", home).1);
    // 분리된 HEAD — 줄은 있고 브랜치가 없다.
    let (e, main) = find_remote_entry(&list, "~/api", "/root/api-wt/probe", home);
    assert!(e.is_some_and(|w| w.branch.is_none() && w.detached) && !main);
    // 원격은 대소문자를 가린다.
    assert!(find_remote_entry(&list, "~/api", "/root/API-wt/fix", home)
        .0
        .is_none());
    assert_eq!(remote_comparable("~", Some("/home/me/")), "/home/me");
    assert_eq!(remote_comparable("/", None), "/");
}

#[test]
fn remote_failure_keeps_only_the_first_line() {
    let stderr = "\nfatal: '/root/api-wt/fix' contains modified or untracked files, use --force to delete it\nhint: something\n";
    assert_eq!(
        remote_failure_line(stderr),
        "fatal: '/root/api-wt/fix' contains modified or untracked files, use --force to delete it"
    );
    assert_eq!(
        remote_failure_line("error: the branch 'fix' is not fully merged.\r\nIf you are sure you want to delete it, run 'git branch -D fix'.\r\n"),
        "error: the branch 'fix' is not fully merged."
    );
    assert!(!remote_failure_line("  \n").is_empty());
    // 원격엔 곁 파일이 없다 — 사람이 켠 칸이 동의다: 끄면 not_requested, 켜면 `-d` 로 간다.
    assert_eq!(
        branch_decision(false, false, false, false, None),
        BranchStep::Kept(KeptReason::NotRequested)
    );
    assert_eq!(
        branch_decision(true, true, false, false, None),
        BranchStep::RunDelete
    );
    assert_eq!(
        branch_decision(true, true, false, true, None),
        BranchStep::Kept(KeptReason::Main)
    );
}

#[test]
fn branch_decision_table() {
    use BranchStep::*;
    use KeptReason::*;
    // (원했나, 앱이 만들었나, 병합됨, 지금 브랜치인가, -d 결과) → 걸음
    let table = [
        (false, true, false, false, None, Kept(NotRequested)),
        (false, false, false, true, Some(true), Kept(NotRequested)),
        (false, false, true, false, None, Kept(NotRequested)),
        (true, true, false, true, None, Kept(Main)),
        (true, false, false, true, None, Kept(Main)),
        (true, false, true, true, None, Kept(Main)),
        (true, false, false, false, None, Kept(Predates)),
        (true, false, false, false, Some(true), Kept(Predates)),
        (true, true, false, false, None, RunDelete),
        (true, true, false, false, Some(true), Deleted),
        (true, true, false, false, Some(false), Kept(Unmerged)),
        // 2026-10-05 — 앱이 만들지 않았어도 병합됨이면 `-d` 로 간다(그래도 `-d` 가 마지막 그물)
        (true, false, true, false, None, RunDelete),
        (true, false, true, false, Some(true), Deleted),
        (true, false, true, false, Some(false), Kept(Unmerged)),
    ];
    for (want, created, merged, current, d, step) in table {
        assert_eq!(
            branch_decision(want, created, merged, current, d),
            step,
            "{want} {created} {merged} {current} {d:?}"
        );
    }
    // 알림 문구가 갈리는 글자 — 프런트(`removedToast`)가 이 글자를 읽는다.
    assert_eq!(serde_json::to_value(NotRequested).unwrap(), "not_requested");
    assert_eq!(serde_json::to_value(Unmerged).unwrap(), "unmerged");
}

fn rec(branch: &str, created: bool, repo: Option<&str>) -> WorktreeRecord {
    WorktreeRecord {
        branch: branch.into(),
        created_by_app: created,
        created_at: 1,
        repo: repo.map(Into::into),
        setup: None,
        base: None,
        run: None,
        role: None,
    }
}

#[test]
fn setup_records_live_on_the_worktree_line_and_leave_with_the_project() {
    let run = |code: i32| SetupRun {
        ok: code == 0,
        code,
        at: 7,
    };
    let mut f = Sidecar::new();
    // 앱이 만든 워크트리 — 브랜치 줄에 칸 하나가 붙는다(구분자·대소문자만 다른 키도 같은 줄).
    f.insert(
        r"C:\src\proj-wt\feat-x".into(),
        rec("feat-x", true, Some(r"C:\src\proj")),
    );
    assert!(record_setup_in(
        &mut f,
        "c:/src/proj-wt/feat-x",
        r"C:\src\proj",
        run(0)
    ));
    assert_eq!(f.len(), 1);
    assert_eq!(f[r"C:\src\proj-wt\feat-x"].setup, Some(run(0)));
    // 앱이 만들지 않은 워크트리(주 작업 폴더) — 브랜치를 모르는 줄로 선다. 브랜치 삭제 판정은 그대로다.
    assert!(record_setup_in(
        &mut f,
        r"C:\src\proj",
        r"C:\src\proj",
        run(3)
    ));
    assert_eq!(f.len(), 2);
    let main = &f[r"C:\src\proj"];
    assert_eq!(
        (main.created_by_app, main.branch.as_str(), main.setup),
        (false, "", Some(run(3)))
    );
    assert!(!made_by_app(Some(main), Some("main")));
    // 다른 저장소의 기록은 따로 센다.
    record_setup_in(&mut f, r"D:\other-wt\a", r"D:\other", run(0));
    assert_eq!(setup_count_in(&f, "c:/src/proj/"), 2);
    assert_eq!(setup_count_in(&f, r"D:\other"), 1);
    // 모양 계약 — 칸 이름 `setup` · `ok` · `code` · `at`, 없으면 칸이 없다.
    let v = serde_json::to_value(&f).unwrap();
    assert_eq!(v[r"C:\src\proj"]["setup"]["code"], 3);
    assert_eq!(v[r"C:\src\proj"]["setup"]["ok"], false);
    // 프로젝트를 지우면 그 저장소의 기록만 걷는다 — 브랜치 줄은 남고, 기록만 들던 줄은 빠진다.
    assert!(forget_setup_in(&mut f, r"C:\src\proj"));
    assert_eq!(f.len(), 2);
    assert_eq!(f[r"C:\src\proj-wt\feat-x"].setup, None);
    assert!(f[r"C:\src\proj-wt\feat-x"].created_by_app);
    assert!(!f.contains_key(r"C:\src\proj"));
    assert_eq!(setup_count_in(&f, r"D:\other"), 1);
    assert!(
        !forget_setup_in(&mut f, r"C:\src\proj"),
        "두 번째는 걷을 것이 없다"
    );
    assert!(v[r"C:\src\proj-wt\feat-x"].get("setup").is_some());
    let plain = serde_json::to_value(rec("b", false, None)).unwrap();
    assert!(plain.get("setup").is_none());
}

#[test]
fn sidecar_round_trips_and_corrupt_starts_empty() {
    let root =
        std::env::temp_dir().join(format!("aynx-wt-side-{}-{}", std::process::id(), now_ms()));
    let path = root.join("worktrees.json");
    assert!(load_sidecar(&path).is_empty());
    let mut file = Sidecar::new();
    file.insert(
        r"C:\src\proj-wt\feat-x".into(),
        rec("feat-x", true, Some(r"C:\src\proj")),
    );
    file.insert("/srv/api-wt/b".into(), rec("b", false, None));
    write_sidecar(&path, &file).unwrap();
    assert_eq!(load_sidecar(&path), file);
    // 모양 계약 — 키 = 워크트리 폴더, 칸 셋(+ 저장소). 저장소를 모르는 줄은 그 칸이 없다.
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(v[r"C:\src\proj-wt\feat-x"]["created_by_app"], true);
    assert_eq!(v[r"C:\src\proj-wt\feat-x"]["branch"], "feat-x");
    assert!(v["/srv/api-wt/b"].get("repo").is_none());
    // 깨진 파일 → 빈 표 (= 전부 먼저 있던 브랜치 — 지우는 쪽으로 틀리지 않는다), 다음 쓰기는 산다.
    std::fs::write(&path, "{ not json").unwrap();
    assert!(load_sidecar(&path).is_empty());
    assert!(modify_sidecar(&path, |f| {
        f.insert("k".into(), rec("k", true, None));
        true
    })
    .unwrap());
    assert_eq!(load_sidecar(&path).len(), 1);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn sidecar_prune_touches_only_this_repo() {
    let mut f = Sidecar::new();
    f.insert(
        r"C:\src\proj-wt\gone".into(),
        rec("gone", true, Some(r"C:\src\proj")),
    );
    f.insert(
        r"C:\src\proj-wt\here".into(),
        rec("here", true, Some(r"C:\src\proj")),
    );
    f.insert(
        r"C:\src\other-wt\x".into(),
        rec("x", true, Some(r"C:\src\other")),
    );
    f.insert(r"C:\loose".into(), rec("l", true, None));
    // git 은 `/` 로 적는다 — 구분자·대소문자를 무시하고 견준다.
    let listed = vec!["C:/src/proj".to_string(), "c:/SRC/proj-wt/here".to_string()];
    assert!(prune_sidecar(&mut f, "C:/src/proj/", &listed));
    let keys: Vec<&str> = f.keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        vec![r"C:\loose", r"C:\src\other-wt\x", r"C:\src\proj-wt\here"]
    );
    assert!(!prune_sidecar(&mut f, "C:/src/proj", &listed));
    // 줄의 브랜치가 지금 브랜치와 달라졌으면 앱의 것으로 보지 않는다.
    let r = rec("feat", true, None);
    assert!(made_by_app(Some(&r), Some("feat")));
    assert!(!made_by_app(Some(&r), Some("other")));
    assert!(!made_by_app(Some(&rec("feat", false, None)), Some("feat")));
    assert!(!made_by_app(None, Some("feat")));
    assert_eq!(strip_verbatim(r"\\?\C:\a"), r"C:\a");
    assert_eq!(strip_verbatim(r"\\?\UNC\nas\s"), r"\\nas\s");
}

/// 원격 줄(2026-09-29 B안) — 열쇠는 `ssh://<별칭 소문자><절대 경로>`, 로컬 줄과 섞이지 않고, 원격 목록이 그 줄로
/// `created_by_app` 을 싣고, 그 저장소(같은 별칭)의 원격 줄만 걷는다.
#[test]
fn remote_sidecar_lines_carry_created_by_app_per_host() {
    assert_eq!(
        remote_key("Dev-01", "/home/me/api-wt/x/"),
        "ssh://dev-01/home/me/api-wt/x"
    );
    assert_eq!(remote_key(" dev-01 ", "/"), "ssh://dev-01/");
    // 대소문자는 경로에서 그대로다(리눅스) — `comparable` 이 Windows 꼴로 보지 않는다.
    assert_ne!(
        comparable(&remote_key("d", "/A")),
        comparable(&remote_key("d", "/a"))
    );

    let mut f = Sidecar::new();
    f.insert(
        r"C:\src\proj-wt\x".into(),
        rec("x", true, Some(r"C:\src\proj")),
    );
    assert!(record_remote_added_in(
        &mut f,
        "dev-01",
        "/home/me/api",
        "/home/me/api-wt/feat-x",
        rec("feat-x", true, None)
    ));
    assert!(record_remote_added_in(
        &mut f,
        "dev-01",
        "/home/me/api",
        "/home/me/api-wt/old",
        rec("old", false, None)
    ));
    // 다른 호스트의 같은 경로는 다른 줄이다.
    assert!(record_remote_added_in(
        &mut f,
        "web-01",
        "/home/me/api",
        "/home/me/api-wt/feat-x",
        rec("feat-x", true, None)
    ));
    let r = &f["ssh://dev-01/home/me/api-wt/feat-x"];
    assert_eq!(r.repo.as_deref(), Some("ssh://dev-01/home/me/api"));
    assert!(r.created_by_app);

    let wt = |p: &str, b: Option<&str>| WorktreeInfo {
        path: p.into(),
        branch: b.map(str::to_string),
        ..WorktreeInfo::default()
    };
    let mut list = vec![
        wt("/home/me/api", Some("main")),
        wt("/home/me/api-wt/feat-x", Some("feat-x")),
        wt("/home/me/api-wt/old", Some("old")),
        wt("/home/me/api-wt/shell-made", Some("s")),
    ];
    mark_remote_list(&f, "DEV-01", &mut list);
    let marks: Vec<bool> = list.iter().map(|w| w.created_by_app).collect();
    assert_eq!(marks, vec![false, true, false, false]);
    // 셸에서 브랜치를 바꿨으면 앱의 것으로 보지 않는다.
    let mut moved = vec![
        wt("/home/me/api", Some("main")),
        wt("/home/me/api-wt/feat-x", Some("other")),
    ];
    mark_remote_list(&f, "dev-01", &mut moved);
    assert!(!moved[1].created_by_app);

    // 걷기 — 목록에서 `old` 가 사라졌다: dev-01 의 그 줄만 걷히고, web-01 · 로컬 줄은 남는다.
    list.remove(2);
    let (repo_key, keys) = remote_prune_keys("dev-01", &list).unwrap();
    assert_eq!(repo_key, "ssh://dev-01/home/me/api");
    assert!(prune_sidecar(&mut f, &repo_key, &keys));
    let left: Vec<&str> = f.keys().map(String::as_str).collect();
    assert_eq!(
        left,
        vec![
            r"C:\src\proj-wt\x",
            "ssh://dev-01/home/me/api-wt/feat-x",
            "ssh://web-01/home/me/api-wt/feat-x"
        ]
    );
    // 로컬 저장소의 걷기는 원격 줄을 건드리지 않는다.
    assert!(!prune_sidecar(
        &mut f,
        r"C:\src\proj",
        &[r"C:\src\proj-wt\x".to_string()]
    ));
    assert_eq!(remote_prune_keys("dev-01", &[]), None);
}

/// 진짜 `git` 이 있을 때만 — 없으면 건너뛴다(CI·새 PC). 임시 저장소 하나에 만들기·목록·제거와
/// 브랜치 갈래 셋(지움 · 먼저 있던 것 · 병합 안 됨)과 거절(더러운 워크트리).
#[test]
fn snapshot_entries_parse_porcelain_z() {
    let out = " M src/a.ts\0?? new dir/\0D  gone.txt\0AM 한글.md\0";
    let snap = snapshot_entries(out, |p| if p == "gone.txt" { -1 } else { 7 }).unwrap();
    assert_eq!(
        snap,
        vec![
            " M\t7\tsrc/a.ts",
            "??\t7\tnew dir/",
            "AM\t7\t한글.md",
            "D \t-1\tgone.txt"
        ]
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>(),
        "경로 순이 아니라 줄 순으로 정렬된다"
    );
    assert_eq!(
        snapshot_entries("", |_| 0),
        Some(Vec::new()),
        "깨끗한 저장소"
    );
    let many: String = (0..=SNAPSHOT_MAX_ENTRIES)
        .map(|i| format!("?? f{i}\0"))
        .collect();
    assert_eq!(
        snapshot_entries(&many, |_| 0),
        None,
        "너무 많으면 도장이 없다"
    );
}

#[test]
fn change_snapshot_sees_new_dirty_and_re_edited_files() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git 이 PATH 에 없어 건너뜀");
        return;
    }
    let repo = std::env::temp_dir().join(format!(
        "aynx-snap-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(repo.join("sub")).unwrap();
    let git = |args: &[&str]| run_git(&repo, args, GIT_TIMEOUT).unwrap().ok;
    assert!(git(&["init", "-q"]));
    std::fs::write(repo.join("a.txt"), "a").unwrap();
    std::fs::write(repo.join("b.txt"), "b").unwrap();
    assert!(git(&["add", "."]));
    assert!(git(&[
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "-m",
        "i"
    ]));
    std::fs::write(repo.join("a.txt"), "dirty before").unwrap();

    // 하위 폴더에서 찍어도 경로는 저장소 맨 위 기준이다.
    let before = change_snapshot_blocking(&repo.join("sub")).expect("before");
    assert_eq!(before.len(), 1);
    std::thread::sleep(Duration::from_millis(30));
    std::fs::write(repo.join("a.txt"), "dirty again").unwrap(); // 이미 더러운 파일을 다시
    std::fs::write(repo.join("b.txt"), "newly dirty").unwrap();
    std::fs::write(repo.join("c.txt"), "untracked").unwrap();
    let after = change_snapshot_blocking(&repo).expect("after");
    let paths = |v: &[String]| {
        v.iter()
            .map(|l| l.rsplit('\t').next().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    assert_eq!(paths(&after), vec!["a.txt", "b.txt", "c.txt"]);
    let changed: std::collections::BTreeSet<String> = before
        .iter()
        .chain(after.iter())
        .filter(|l| !(before.contains(l) && after.contains(l)))
        .map(|l| l.rsplit('\t').next().unwrap().to_owned())
        .collect();
    assert_eq!(changed.len(), 3, "{before:?} → {after:?}");

    assert!(change_snapshot_blocking(&std::env::temp_dir().join("aynx-no-such-dir-xyz")).is_none());
    let _ = std::fs::remove_dir_all(&repo);
}

#[test]
fn real_git_round_trip_when_available() {
    let probe = Command::new("git").arg("--version").output();
    if probe.is_err() {
        eprintln!("git 이 PATH 에 없어 건너뜀");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "aynx-wt-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let repo = root.join("repo");
    let side_file = root.join("worktrees.json");
    let side = Some(side_file.as_path());
    std::fs::create_dir_all(&repo).unwrap();
    let git = |args: &[&str]| run_git(&repo, args, GIT_TIMEOUT).unwrap();
    let commit = |dir: &Path| {
        run_git(
            dir,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-q",
                "-am",
                "c",
            ],
            GIT_TIMEOUT,
        )
        .unwrap()
        .ok
    };
    let has_branch = |b: &str| {
        git(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{b}"),
        ])
        .ok
    };
    assert!(git(&["init", "-q"]).ok);
    std::fs::write(repo.join("f.txt"), "x").unwrap();
    assert!(git(&["add", "."]).ok);
    assert!(
        git(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-q",
            "-m",
            "i"
        ])
        .ok
    );

    // ① 새 브랜치 — 곁 파일에 "앱이 만들었다", 목록도 그렇게 말한다. 제거 + 삭제 → 브랜치가 없다.
    let added = add_blocking(&repo, None, "feat-x", side).expect("add");
    assert!(added.branch_created);
    assert_eq!(
        PathBuf::from(&added.path),
        root.join("repo-wt").join("feat-x")
    );
    let list = list_blocking(&repo, side).expect("list");
    assert_eq!(list.len(), 2);
    let fx = list
        .iter()
        .find(|w| w.branch.as_deref() == Some("feat-x"))
        .unwrap();
    assert!(fx.created_by_app);
    assert!(
        !list[0].created_by_app,
        "주 작업 폴더는 앱이 만든 것이 아니다"
    );
    assert_eq!(load_sidecar(&side_file).len(), 1);

    // 두 번째 워크트리를 같은 이름으로 — 브랜치는 이미 있고(체크아웃 중이라) git 이 거절한다.
    assert!(add_blocking(&repo, None, "feat-x", side).is_err());

    let gone = remove_blocking(&repo, &added.path, true, side).expect("remove");
    assert!(gone.removed && gone.branch_deleted, "{gone:?}");
    assert_eq!(gone.branch.as_deref(), Some("feat-x"));
    assert_eq!(gone.branch_kept_reason, None);
    assert!(!has_branch("feat-x"));
    assert_eq!(list_blocking(&repo, side).unwrap().len(), 1);
    assert!(
        load_sidecar(&side_file).is_empty(),
        "제거하면 곁 파일 줄도 걷힌다"
    );

    // ② 먼저 있던 브랜치 — 체크아웃만 했다(`branch_created=false`) → 삭제를 원해도 남긴다.
    assert!(git(&["branch", "old-b"]).ok);
    let old = add_blocking(&repo, None, "old-b", side).expect("add existing");
    assert!(!old.branch_created);
    assert!(!list_blocking(&repo, side)
        .unwrap()
        .iter()
        .any(|w| w.created_by_app));
    let kept = remove_blocking(&repo, &old.path, true, side).expect("remove existing");
    assert!(kept.removed && !kept.branch_deleted);
    assert_eq!(kept.branch_kept_reason, Some(KeptReason::Predates));
    assert!(has_branch("old-b"));

    // ②-2 (2026-10-05) 먼저 있던 브랜치인데 main 에 병합됐다(독의 "병합됨" 과 같은 판정 — 앞선 커밋 0 · 커밋 기록 있음)
    //     → Rust 가 다시 보고 `-d` 로 지운다. 지우라고 하지 않으면 그대로 남는다.
    assert!(git(&["branch", "old-m"]).ok);
    let om = add_blocking(&repo, None, "old-m", side).expect("add existing merged");
    assert!(!om.branch_created);
    let om_dir = PathBuf::from(&om.path);
    std::fs::write(om_dir.join("f.txt"), "merged").unwrap();
    assert!(commit(&om_dir));
    assert!(git(&["merge", "-q", "--ff-only", "old-m"]).ok);
    let main = list_blocking(&repo, side).unwrap()[0].branch.clone();
    assert!(crate::worktree_changes::branch_merged_blocking(
        &repo,
        "old-m",
        main.as_deref()
    ));
    let gone = remove_blocking(&repo, &om.path, true, side).expect("remove existing merged");
    assert!(gone.removed && gone.branch_deleted, "{gone:?}");
    assert!(!has_branch("old-m"));
    // 갓 만든 브랜치(커밋 기록 없음)는 병합됨이 아니다 — ② 의 old-b 가 그 경우다.
    assert!(!crate::worktree_changes::branch_merged_blocking(
        &repo,
        "old-b",
        main.as_deref()
    ));

    // ③ 병합되지 않은 커밋 — `-d` 가 거절하고 남긴다(`-D` 는 없다). git 의 한 줄이 실린다.
    let un = add_blocking(&repo, None, "feat-u", side).expect("add unmerged");
    let un_dir = PathBuf::from(&un.path);
    std::fs::write(un_dir.join("f.txt"), "changed").unwrap();
    assert!(commit(&un_dir));
    let kept = remove_blocking(&repo, &un.path, true, side).expect("remove unmerged");
    assert!(kept.removed && !kept.branch_deleted);
    assert_eq!(kept.branch_kept_reason, Some(KeptReason::Unmerged));
    assert!(
        kept.message
            .as_deref()
            .is_some_and(|m| !m.is_empty() && !m.contains('\n')),
        "{kept:?}"
    );
    assert!(has_branch("feat-u"));

    // ④ 더러운 워크트리 — git 이 제거를 거절: `removed=false` + 그 한 줄, 브랜치는 손대지 않는다.
    let dirty = add_blocking(&repo, None, "feat-d", side).expect("add dirty");
    std::fs::write(PathBuf::from(&dirty.path).join("f.txt"), "dirty").unwrap();
    let refused = remove_blocking(&repo, &dirty.path, true, side).expect("remove dirty");
    assert!(!refused.removed && !refused.branch_deleted);
    assert!(refused.message.is_some());
    assert!(has_branch("feat-d") && PathBuf::from(&dirty.path).exists());
    assert!(git(&["worktree", "remove", "--force", &dirty.path]).ok);
    // 셸에서 지운 워크트리의 곁 파일 줄은 다음 목록 읽기에 걷힌다.
    assert_eq!(load_sidecar(&side_file).len(), 1);
    list_blocking(&repo, side).unwrap();
    assert!(load_sidecar(&side_file).is_empty());

    // ⑤ 삭제를 끄면 남긴다(`not_requested`) — 다시 만들면 있던 브랜치를 체크아웃한다.
    let again = add_blocking(&repo, None, "feat-x", side).expect("re-add");
    assert!(again.branch_created, "① 에서 지웠으므로 새로 만든다");
    let kept = remove_blocking(&repo, &again.path, false, side).expect("remove keep");
    assert_eq!(kept.branch_kept_reason, Some(KeptReason::NotRequested));
    assert!(has_branch("feat-x"));
    let back = add_blocking(&repo, None, "feat-x", side).expect("re-add existing");
    assert!(!back.branch_created);
    let _ = remove_blocking(&repo, &back.path, false, side);

    // 워크트리 폴더 칸 — 돌려준 `path` 가 그 폴더 아래다(알림이 이 글자를 그대로 쓴다).
    let custom = root.join("elsewhere");
    let placed =
        add_blocking(&repo, Some(&custom.to_string_lossy()), "feat-y", side).expect("custom");
    assert_eq!(PathBuf::from(&placed.path), custom.join("feat-y"));
    let _ = remove_blocking(&repo, &placed.path, true, side);

    // ⑥ 새 브랜치는 주 브랜치에서 딴다 — 다른 워크트리(커밋이 앞선 브랜치)를 저장소로 넘겨도 그 HEAD 가 아니다.
    let ahead = add_blocking(&repo, Some(&custom.to_string_lossy()), "ahead", side).expect("ahead");
    let ahead_dir = PathBuf::from(&ahead.path);
    std::fs::write(ahead_dir.join("f.txt"), "ahead").unwrap();
    assert!(commit(&ahead_dir));
    let fork = add_blocking(&ahead_dir, Some(&custom.to_string_lossy()), "fork", side).expect("fork");
    assert!(fork.branch_created);
    let rev = |r: &str| git(&["rev-parse", r]).stdout.trim().to_string();
    let main_branch = git(&["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim().to_string();
    assert_eq!(rev("refs/heads/fork"), rev(&format!("refs/heads/{main_branch}")));
    assert_ne!(rev("refs/heads/fork"), rev("refs/heads/ahead"));
    let _ = remove_blocking(&repo, &fork.path, true, side);
    let _ = remove_blocking(&repo, &ahead.path, false, side);

    // ⑦ 로컬에 없고 원격 추적만 있으면 그것을 받아 연다(--track) · 원격 둘에 있으면 거절(짐작하지 않는다). fetch 는 없다.
    assert!(git(&["remote", "add", "origin", "https://example.invalid/a.git"]).ok);
    assert!(git(&["remote", "add", "up", "https://example.invalid/b.git"]).ok);
    let ahead_head = rev("refs/heads/ahead");
    assert!(git(&["update-ref", "refs/remotes/origin/remote-only", &ahead_head]).ok);
    assert!(git(&["update-ref", "refs/remotes/origin/dup", &ahead_head]).ok);
    assert!(git(&["update-ref", "refs/remotes/up/dup", &ahead_head]).ok);
    let tr = add_blocking(&repo, Some(&custom.to_string_lossy()), "remote-only", side).expect("track");
    assert!(tr.branch_created);
    assert_eq!(tr.tracked.as_deref(), Some("origin/remote-only"));
    assert_eq!(rev("refs/heads/remote-only"), ahead_head);
    assert_eq!(
        git(&["config", "branch.remote-only.remote"]).stdout.trim(),
        "origin"
    );
    let amb = add_blocking(&repo, Some(&custom.to_string_lossy()), "dup", side).unwrap_err();
    assert!(amb.contains("origin/dup") && amb.contains("up/dup"), "{amb}");
    assert!(!has_branch("dup"));
    let _ = remove_blocking(&repo, &tr.path, true, side);

    // ⑧ (2026-10-05) squash 병합된 브랜치 — `-d` 는 거절하지만 Rust 가 내용 기준으로 다시 확인해 그 커밋 조건으로
    //    `update-ref -d` 한다(`merge_detect::delete_verified_local`). ③ 의 병합 안 된 feat-u 는 여전히 남아 있다.
    let sq = add_blocking(&repo, None, "feat-sq", side).expect("add squash");
    let sq_dir = PathBuf::from(&sq.path);
    for v in ["sq one", "sq two"] {
        std::fs::write(sq_dir.join("f.txt"), v).unwrap();
        assert!(commit(&sq_dir));
    }
    assert!(git(&["merge", "--squash", "-q", "feat-sq"]).ok);
    assert!(
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "squash"]).ok
    );
    assert!(!git(&["branch", "-d", "feat-sq"]).ok || !has_branch("feat-sq"), "-d 는 거절한다");
    let gone = remove_blocking(&repo, &sq.path, true, side).expect("remove squash-merged");
    assert!(gone.removed && gone.branch_deleted, "{gone:?}");
    assert_eq!(gone.message, None);
    assert!(!has_branch("feat-sq"));
    assert!(has_branch("feat-u"), "병합 안 된 브랜치는 그대로");
    let _ = std::fs::remove_dir_all(&root);
}
