use super::*;
use std::process::Command;

#[test]
fn folder_names_follow_the_rule() {
    for ok in ["api", "api-server", "v1.2", "a_b", " trim "] {
        assert!(valid_folder_name(ok).is_ok(), "{ok}");
    }
    for bad in [
        "",
        "-x",
        "a/b",
        "..",
        ".",
        "a.",
        "has space",
        "한글",
        "a\nb",
        "con",
        "NUL",
        "nul.txt",
        "Com1",
        "lpt9.md",
    ] {
        assert!(valid_folder_name(bad).is_err(), "{bad:?}");
    }
    // 장치 이름으로 시작할 뿐인 이름은 된다.
    assert!(valid_folder_name("console").is_ok());
    assert!(valid_folder_name("con-x").is_ok());
}

#[test]
fn default_branch_falls_back_to_main() {
    assert_eq!(default_branch_of("trunk\n", true), "trunk");
    assert_eq!(default_branch_of("", true), "main");
    assert_eq!(default_branch_of("trunk", false), "main");
    assert_eq!(default_branch_of("-x", true), "main");
    assert_eq!(default_branch_of("a b", true), "main");
}

#[test]
fn remote_paths_join_and_fold_home() {
    assert_eq!(remote_join("~/src/", "api"), "~/src/api");
    assert_eq!(remote_join("/", "api"), "/api");
    assert_eq!(remote_join("~", "api"), "~/api");
    // 로컬 — 부모의 구분자를 따른다(2026-09-28 실기: `C:/…/aynx-live\live-new` 로 섞였다).
    assert_eq!(
        local_join("C:/Users/me/aynx-live", "live-new"),
        "C:/Users/me/aynx-live/live-new"
    );
    assert_eq!(local_join(r"C:\Users\me", "x"), r"C:\Users\me\x");
    assert_eq!(local_join(r"C:\", "x"), r"C:\x");
    assert_eq!(local_join("/srv/", "x"), "/srv/x");
    assert_eq!(local_join(r"C:\a/b", "x"), r"C:\a/b/x");
    assert_eq!(
        tilde_form("/home/me/src/api", Some("/home/me")),
        "~/src/api"
    );
    assert_eq!(tilde_form("/home/me", Some("/home/me/")), "~");
    assert_eq!(tilde_form("/home/meow/x", Some("/home/me")), "/home/meow/x");
    assert_eq!(tilde_form("/srv/x", None), "/srv/x");
}

#[test]
fn remote_commands_quote_and_wrap_in_sh() {
    let s = remote_status_command("~/it's").unwrap();
    assert!(s.starts_with("sh -c '"), "{s}");
    // 안쪽 스크립트의 `"$HOME"/'it'\''s'` 가 바깥 인용에서 한 번 더 감싸인다 — 개행은 없다.
    assert!(remote_status_command("/a\nb").is_none());
    assert!(remote_status_command("  ").is_none());
    let c = remote_create_command("~/src", "api").unwrap();
    assert!(c.contains("mkdir"));
    assert!(remote_create_command("src", "api").is_none(), "상대 부모");
    assert!(remote_create_command("~/src", "a b").is_none(), "막힌 이름");
    assert!(remote_create_command("~/src", "../x").is_none());
    let e = remote_ensure_command("/srv/api").unwrap();
    assert!(e.contains("commit-tree") && !e.contains("--allow-empty"));
}

#[test]
fn remote_status_parses_each_kind() {
    use RepoStatus::*;
    assert_eq!(
        parse_remote_status("motd line\nbranch=main\nkind=ok\nworktrees=2\n", ""),
        Ok {
            branch: Some("main".into()),
            worktrees: Some(2)
        }
    );
    assert_eq!(parse_remote_status("kind=notrepo\n", ""), NotRepo);
    assert_eq!(parse_remote_status("kind=missing\n", ""), Missing);
    assert_eq!(
        parse_remote_status("branch=main\nkind=nocommit\n", ""),
        NoCommit {
            branch: Some("main".into())
        }
    );
    assert_eq!(
        parse_remote_status("kind=subfolder\nroot=/home/me/api\nhome=/home/me\n", ""),
        Subfolder {
            root: "~/api".into()
        }
    );
    assert!(matches!(
        parse_remote_status("kind=nogit\n", ""),
        Error { .. }
    ));
    assert_eq!(
        parse_remote_status(
            "kind=error\nmessage=fatal: detected dubious ownership\n",
            ""
        ),
        Error {
            message: "fatal: detected dubious ownership".into()
        }
    );
    assert_eq!(
        parse_remote_status("", "sh: 1: boom\n"),
        Error {
            message: "sh: 1: boom".into()
        }
    );
    // 직렬화 모양 — 프런트가 `kind` 로 가른다.
    let v = serde_json::to_value(NoCommit { branch: None }).unwrap();
    assert_eq!(v["kind"], "noCommit");
    assert_eq!(serde_json::to_value(NotRepo).unwrap()["kind"], "notRepo");
}

#[test]
fn remote_ensure_parses_success_and_steps() {
    let ok =
        parse_remote_ensure("branch=main\ninitialized=1\ncommitted=1\n", "", true, "~/a").unwrap();
    assert_eq!(
        ok,
        RepoInitialized {
            branch: "main".into(),
            initialized: true,
            committed: true
        }
    );
    let fail = parse_remote_ensure(
        "aynx-fail=commit\n",
        "\n*** Please tell me who you are.\nRun\n",
        false,
        "~/a",
    )
    .unwrap_err();
    assert!(fail.contains("*** Please tell me who you are."), "{fail}");
    assert!(
        !crate::errors::has_reason(&fail, crate::errors::GIT_IDENTITY),
        "그 밖의 커밋 실패는 신원 갈래가 아니다"
    );
    // 신원 없음은 커밋 전에 따로 판정한다 — 이유 코드로(문구는 로케일을 탄다).
    let id = parse_remote_ensure("aynx-fail=identity\n", "", false, "~/a").unwrap_err();
    assert!(
        crate::errors::has_reason(&id, crate::errors::GIT_IDENTITY),
        "{id}"
    );
    let e = remote_ensure_command("/srv/api").unwrap();
    let (var, tree) = (
        e.find("git var GIT_AUTHOR_IDENT").unwrap(),
        e.find("git mktree").unwrap(),
    );
    assert!(var < tree, "신원 확인이 커밋보다 먼저");
    assert!(parse_remote_ensure("aynx-fail=notempty\n", "", false, "~/a").is_err());
    assert!(parse_remote_ensure("", "boom", false, "~/a")
        .unwrap_err()
        .contains("boom"));
}

/// 사람 PC 의 전역·시스템 설정을 떼어 낸 환경 — 신원만 명령줄 대신 환경 설정으로 준다.
fn isolated(global: &Path, with_identity: bool) -> Vec<(String, String)> {
    let mut env = vec![
        (
            "GIT_CONFIG_GLOBAL".to_string(),
            global.to_string_lossy().into_owned(),
        ),
        ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
        // 신원 추측(호스트 이름 등)을 끈다 — 없으면 틀림없이 실패하게.
        (
            "GIT_CONFIG_COUNT".to_string(),
            if with_identity { "3" } else { "1" }.to_string(),
        ),
        (
            "GIT_CONFIG_KEY_0".to_string(),
            "user.useConfigOnly".to_string(),
        ),
        ("GIT_CONFIG_VALUE_0".to_string(), "true".to_string()),
    ];
    if with_identity {
        env.extend([
            ("GIT_CONFIG_KEY_1".to_string(), "user.name".to_string()),
            ("GIT_CONFIG_VALUE_1".to_string(), "t".to_string()),
            ("GIT_CONFIG_KEY_2".to_string(), "user.email".to_string()),
            ("GIT_CONFIG_VALUE_2".to_string(), "t@t".to_string()),
        ]);
    }
    env
}

fn as_refs(env: &[(String, String)]) -> Vec<(&str, &str)> {
    env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
}

/// 진짜 `git` 이 있을 때만 — 없으면 건너뛴다(`worktree::real_git_round_trip_when_available` 와 같다).
#[test]
fn real_git_create_init_and_status_when_available() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git 이 PATH 에 없어 건너뜀");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "aynx-repo-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let global = root.join("gitconfig");
    std::fs::write(&global, "").unwrap();
    let good_owned = isolated(&global, true);
    let good = as_refs(&good_owned);
    let root_s = root.to_string_lossy().into_owned();

    // 없는 폴더 · 저장소 아님.
    assert_eq!(
        status_blocking(&root.join("nope").to_string_lossy(), &good),
        RepoStatus::Missing
    );
    let plain = root.join("plain");
    std::fs::create_dir(&plain).unwrap();
    std::fs::write(plain.join("a.txt"), "a").unwrap();
    assert_eq!(
        status_blocking(&plain.to_string_lossy(), &good),
        RepoStatus::NotRepo
    );

    // ① 새로 만들기 — 폴더 + init + 빈 첫 커밋. 브랜치는 기본 main.
    let made = create_blocking(&root_s, "fresh", &good).expect("create");
    assert_eq!(PathBuf::from(&made.path), root.join("fresh"));
    assert_eq!(made.branch, "main");
    match status_blocking(&made.path, &good) {
        RepoStatus::Ok { branch, worktrees } => {
            assert_eq!(branch.as_deref(), Some("main"));
            assert_eq!(worktrees, Some(1));
        }
        other => panic!("{other:?}"),
    }
    // 첫 커밋은 빈 트리다.
    let tree = run_git_env(
        Path::new(&made.path),
        &["ls-tree", "-r", "HEAD"],
        GIT_TIMEOUT,
        &good,
    )
    .unwrap();
    assert!(tree.ok && tree.stdout.trim().is_empty());
    // 이미 비어 있지 않다(= .git 말고도 있다) → 거절. 이름 규칙도 거절.
    std::fs::write(root.join("fresh").join("x.txt"), "x").unwrap();
    assert!(create_blocking(&root_s, "fresh", &good).is_err());
    assert!(create_blocking(&root_s, "a b", &good).is_err());
    assert!(create_blocking("relative", "x", &good).is_err());
    assert!(create_blocking(&root.join("nope").to_string_lossy(), "x", &good).is_err());

    // 하위 폴더.
    let sub = root.join("fresh").join("sub");
    std::fs::create_dir(&sub).unwrap();
    match status_blocking(&sub.to_string_lossy(), &good) {
        RepoStatus::Subfolder { root: r } => {
            assert_eq!(comparable(&r), real_key(&root.join("fresh")))
        }
        other => panic!("{other:?}"),
    }

    // init.defaultBranch 를 따른다.
    std::fs::write(&global, "[init]\n\tdefaultBranch = trunk\n").unwrap();
    let trunk = create_blocking(&root_s, "trunky", &good).expect("create trunk");
    assert_eq!(trunk.branch, "trunk");
    std::fs::write(&global, "").unwrap();

    // ② 커밋 없는 저장소 — 스테이지한 파일이 있어도 첫 커밋은 비어 있다(인덱스는 그대로).
    let unborn = root.join("unborn");
    std::fs::create_dir(&unborn).unwrap();
    assert!(
        run_git_env(&unborn, &["init", "-q", "-b", "main"], GIT_TIMEOUT, &good)
            .unwrap()
            .ok
    );
    std::fs::write(unborn.join("staged.txt"), "s").unwrap();
    assert!(
        run_git_env(&unborn, &["add", "staged.txt"], GIT_TIMEOUT, &good)
            .unwrap()
            .ok
    );
    assert_eq!(
        status_blocking(&unborn.to_string_lossy(), &good),
        RepoStatus::NoCommit {
            branch: Some("main".into())
        }
    );
    let done = ensure_repo_blocking(&unborn.to_string_lossy(), &good).expect("first commit");
    assert_eq!(
        done,
        RepoInitialized {
            branch: "main".into(),
            initialized: false,
            committed: true
        }
    );
    let staged = run_git_env(
        &unborn,
        &["diff", "--cached", "--name-only"],
        GIT_TIMEOUT,
        &good,
    )
    .unwrap();
    assert_eq!(staged.stdout.trim(), "staged.txt", "인덱스는 손대지 않는다");
    // 두 번째는 할 일이 없다.
    let again = ensure_repo_blocking(&unborn.to_string_lossy(), &good).unwrap();
    assert!(!again.initialized && !again.committed);

    // ③ 저장소가 아닌 폴더를 초기화 — 파일은 추적하지 않은 채 남는다.
    let r = ensure_repo_blocking(&plain.to_string_lossy(), &good).expect("init plain");
    assert!(r.initialized && r.committed);
    assert!(matches!(
        status_blocking(&plain.to_string_lossy(), &good),
        RepoStatus::Ok { .. }
    ));

    // ④ 신원이 없으면 첫 커밋이 실패한다 — git 의 한 줄이 오고, 폴더와 저장소는 남는다.
    // 부모 환경이 신원을 주고 있으면(CI 등) 이 갈래는 설 수 없으니 건너뛴다.
    let env_identity = [
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "EMAIL",
    ]
    .iter()
    .any(|k| std::env::var_os(k).is_some());
    if env_identity {
        eprintln!("신원 환경 변수가 있어 '신원 없음' 갈래를 건너뜀");
        let _ = std::fs::remove_dir_all(&root);
        return;
    }
    let bad_owned = isolated(&global, false);
    let bad = as_refs(&bad_owned);
    let err = create_blocking(&root_s, "noid", &bad).expect_err("no identity");
    assert!(!err.contains('\n'), "{err}");
    assert!(
        crate::errors::has_reason(&err, crate::errors::GIT_IDENTITY),
        "신원 없음은 이유 코드로: {err}"
    );
    assert!(!has_identity(&root, &bad).unwrap() && has_identity(&root, &good).unwrap());
    let noid = root.join("noid");
    assert!(noid.join(".git").exists());
    assert!(matches!(
        status_blocking(&noid.to_string_lossy(), &bad),
        RepoStatus::NoCommit { .. }
    ));
    // 고친 뒤 같은 단추 — `.git` 하나뿐인 폴더는 받고 커밋만 한다.
    let retry = create_blocking(&root_s, "noid", &good).expect("retry");
    assert_eq!(retry.branch, "main");
    assert!(matches!(
        status_blocking(&retry.path, &good),
        RepoStatus::Ok { .. }
    ));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn remote_head_parses_branch_detached_and_none() {
    assert_eq!(
        parse_remote_head("motd\nbranch=feat/x\n"),
        GitHead::Branch {
            name: "feat/x".into()
        }
    );
    assert_eq!(
        parse_remote_head("detached=1a2b3c4\n"),
        GitHead::Detached {
            sha: "1a2b3c4".into()
        }
    );
    assert_eq!(parse_remote_head(""), GitHead::None);
    // 빈 값 · 공백이 낀 값은 칩이 되지 않는다(틀린 글자보다 없는 편).
    assert_eq!(parse_remote_head("branch=\n"), GitHead::None);
    assert_eq!(parse_remote_head("branch=a b\n"), GitHead::None);
    let s = remote_head_command("~/it's").unwrap();
    assert!(s.starts_with("sh -c '") && s.contains("symbolic-ref"), "{s}");
    assert!(remote_head_command("/a\nb").is_none());
    assert!(remote_head_command(" ").is_none());
    // 직렬화 모양 — 프런트가 `kind` 로 가른다.
    let v = serde_json::to_value(GitHead::Detached { sha: "abc".into() }).unwrap();
    assert_eq!(v["kind"], "detached");
    assert_eq!(v["sha"], "abc");
    assert_eq!(serde_json::to_value(GitHead::None).unwrap()["kind"], "none");
}

/// 진짜 `git` 이 있을 때만 — 브랜치 · 하위 폴더 · detached · 커밋 없는 저장소 · 저장소 아님 · 없는 폴더.
#[test]
fn real_git_head_when_available() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git 이 PATH 에 없어 건너뜀");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "aynx-head-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let global = root.join("gitconfig");
    std::fs::write(&global, "").unwrap();
    let owned = isolated(&global, true);
    let env = as_refs(&owned);
    let root_s = root.to_string_lossy().into_owned();

    assert_eq!(head_blocking(&root.join("nope").to_string_lossy(), &env), GitHead::None);
    let plain = root.join("plain");
    std::fs::create_dir(&plain).unwrap();
    // temp 폴더가 어떤 저장소 안에 있는 PC 는 드물지만, 그러면 이 단언은 뜻이 없다 — 그때만 건너뛴다.
    if !has_git_ancestor(&plain) {
        assert_eq!(head_blocking(&plain.to_string_lossy(), &env), GitHead::None);
    }

    let made = create_blocking(&root_s, "repo", &env).expect("create");
    let main = GitHead::Branch { name: "main".into() };
    assert_eq!(head_blocking(&made.path, &env), main);
    // 하위 폴더에서도 저장소의 브랜치다(프로젝트 폼의 판정과 달리).
    let sub = root.join("repo").join("deep").join("er");
    std::fs::create_dir_all(&sub).unwrap();
    assert_eq!(head_blocking(&sub.to_string_lossy(), &env), main);
    // detached — 짧은 해시.
    let repo = PathBuf::from(&made.path);
    assert!(run_git_env(&repo, &["checkout", "-q", "--detach"], GIT_TIMEOUT, &env).unwrap().ok);
    let full = run_git_env(&repo, &["rev-parse", "HEAD"], GIT_TIMEOUT, &env).unwrap();
    match head_blocking(&made.path, &env) {
        GitHead::Detached { sha } => {
            assert!(sha.len() >= 4 && full.stdout.trim().starts_with(&sha), "{sha}")
        }
        other => panic!("{other:?}"),
    }
    // 커밋 없는 저장소 — HEAD 가 가리키는 이름.
    let unborn = root.join("unborn");
    std::fs::create_dir(&unborn).unwrap();
    assert!(run_git_env(&unborn, &["init", "-q", "-b", "trunk"], GIT_TIMEOUT, &env).unwrap().ok);
    assert_eq!(
        head_blocking(&unborn.to_string_lossy(), &env),
        GitHead::Branch { name: "trunk".into() }
    );

    let _ = std::fs::remove_dir_all(&root);
}
