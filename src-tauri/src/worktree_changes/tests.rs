use super::*;
use crate::worktree::{load_sidecar, record_for};
use std::process::Command;

#[test]
fn classify_table() {
    use Change::*;
    for (xy, want) in [
        (" M", Some(Modified)),
        ("M ", Some(Modified)),
        ("MM", Some(Modified)),
        (" T", Some(Modified)),
        ("R ", Some(Modified)),
        ("RM", Some(Modified)),
        ("C ", Some(Modified)),
        ("UU", Some(Modified)),
        ("AA", Some(Modified)),
        ("DD", Some(Modified)),
        ("AU", Some(Modified)),
        ("??", Some(Added)),
        ("A ", Some(Added)),
        ("AM", Some(Added)),
        (" A", Some(Added)),
        (" D", Some(Deleted)),
        ("D ", Some(Deleted)),
        ("MD", Some(Deleted)),
        ("!!", None),
        ("  ", None),
        ("M", None),
        ("", None),
    ] {
        assert_eq!(classify(xy), want, "{xy:?}");
    }
}

#[test]
fn numstat_sums_and_text_lines() {
    let ns =
        "3\t1\tsrc/a.ts\r\n-\t-\timg.png\n10\t0\t{old => new}.ts\n0\t4\t\"q\\tuoted\"\nbroken\n\n";
    assert_eq!(sum_numstat(ns), (13, 5));
    assert_eq!(sum_numstat(""), (0, 0));
    let big = format!("{}\t{}\tx\n1\t1\ty", u32::MAX, u32::MAX);
    assert_eq!(sum_numstat(&big), (u32::MAX, u32::MAX), "넘치지 않는다");
    assert_eq!(text_lines(b""), Some(0));
    assert_eq!(
        text_lines(b"one"),
        Some(1),
        "끝 줄바꿈 없음 — git 과 같이 한 줄"
    );
    assert_eq!(text_lines(b"one\ntwo\n"), Some(2));
    assert_eq!(text_lines(b"one\r\ntwo"), Some(2));
    assert_eq!(text_lines(b"\n\n"), Some(2));
    assert_eq!(text_lines(b"ab\0cd\n"), None, "NUL — 바이너리");
    let mut late = vec![b'x'; BINARY_SNIFF];
    late.extend_from_slice(b"\0\n");
    assert_eq!(
        text_lines(&late),
        Some(1),
        "앞 8000바이트 밖의 NUL 은 git 처럼 보지 않는다"
    );
}

#[test]
fn small_rules() {
    assert!(
        valid_commit("abcd")
            && !valid_commit("abc")
            && !valid_commit("xyz1")
            && !valid_commit(&"a".repeat(65))
    );
    assert_eq!(parse_count("7\n"), Some(7));
    assert_eq!(parse_count(""), None);
    assert_eq!(main_range("main").as_deref(), Some("refs/heads/main..HEAD"));
    assert_eq!(main_range("-x"), None);
    assert_eq!(main_range(" "), None);
}

#[test]
fn reflog_history_and_merged_rule() {
    // 갓 만든 브랜치 — 만든 줄 하나뿐.
    assert!(!reflog_has_commits("branch: Created from HEAD\n"));
    assert!(!reflog_has_commits("branch: Created from main\r\n"));
    assert!(!reflog_has_commits(""));
    // 리셋 · 이름 바꿈은 커밋 기록이 아니다.
    assert!(!reflog_has_commits(
        "reset: moving to HEAD~1\nBranch: renamed refs/heads/a to refs/heads/b\n"
    ));
    for line in [
        "commit: fix the thing",
        "commit (initial): first",
        "commit (amend): fix",
        "commit (merge): Merge branch 'x'",
        "merge main: Fast-forward",
        "cherry-pick: pick it",
        "rebase (finish): refs/heads/x onto 0123",
        "pull: Fast-forward",
    ] {
        assert!(
            reflog_has_commits(&format!("{line}\r\nbranch: Created from HEAD\n")),
            "{line}"
        );
    }
    // 낱말 중간 · 앞에 빈칸은 아니다.
    assert!(!reflog_has_commits("branch: commit\n merge x\n"));

    assert!(is_merged(Some("feat-x"), Some("main"), Some(0), true));
    assert!(
        !is_merged(Some("feat-x"), Some("main"), Some(0), false),
        "갓 만든 브랜치"
    );
    assert!(!is_merged(Some("feat-x"), Some("main"), Some(2), true), "앞선 커밋");
    assert!(!is_merged(Some("feat-x"), Some("main"), None, true), "모름");
    assert!(!is_merged(Some("main"), Some("main"), Some(0), true), "main 자신");
    assert!(!is_merged(None, Some("main"), Some(0), true), "분리된 HEAD");
    assert!(!is_merged(Some(""), Some("main"), Some(0), true));
    assert!(
        !is_merged(Some("feat-x"), None, Some(0), true),
        "주 폴더 브랜치를 모른다"
    );
}

#[test]
fn remote_command_quotes_and_runs_once_for_all() {
    let paths: Vec<String> = [
        "/home/me/api-wt/feat-x",
        "~/api-wt/it's",
        "relative/x",
        "/home/me/o\nk",
    ]
    .iter()
    .map(|p| (*p).to_string())
    .collect();
    let c = remote_changes_command(" ~/api ", &paths).unwrap();
    assert!(c.starts_with("sh -c 'command -v git"), "{c}");
    assert!(
        c.contains(r#"git -C "$HOME"/'\''api'\'' worktree list --porcelain"#),
        "{c}"
    );
    assert!(c.contains(r#"w 0 '\''/home/me/api-wt/feat-x'\''"#), "{c}");
    assert!(
        c.contains(r#"w 1 "$HOME"/'\''api-wt/it'\''\'\'''\''s'\''"#),
        "{c}"
    );
    // 상대 경로 · 제어 문자는 버린다(번호는 그대로 — 답을 되짚는 열쇠).
    assert!(!c.contains("w 2 ") && !c.contains("w 3 "), "{c}");
    // 읽기 전용 — git 에 쓰는 명령이 없다.
    for bad in [
        "git -C \"$2\" commit",
        "add ",
        "reset",
        "checkout",
        "stash",
        "--force",
        "update-index",
        " status",
    ] {
        assert!(!c.contains(bad), "{bad} in {c}");
    }
    // 커밋한 것만 — merge-base 부터 HEAD 까지(작업 트리 아님) · 합계만(awk).
    assert!(c.contains(r#"merge-base HEAD "refs/heads/$main""#), "{c}");
    assert!(
        c.contains(r#"--no-optional-locks diff --numstat "$mb" HEAD --"#),
        "{c}"
    );
    assert!(c.contains(r#"rev-list --count "refs/heads/$main..HEAD""#), "{c}");
    assert!(c.contains(r#"printf "%d %d", a, d"#), "{c}");
    // reflog 판정 — 로컬과 같은 표(HISTORY_PREFIXES)로 0/1 만.
    assert!(
        c.contains(r#"reflog show --format=%gs "refs/heads/$b" --"#),
        "{c}"
    );
    assert!(
        c.contains("/^(commit|merge |cherry-pick|rebase|pull)/"),
        "{c}"
    );
    // 앞선 커밋이 있으면 내용 판정 재료(squash · rebase) — 셸 함수 `cm` 하나, 판정은 Rust.
    assert!(
        c.contains(r#"then cm "$2" "refs/heads/$main" HEAD; fi"#),
        "{c}"
    );
    assert!(c.contains("patch-id --stable"), "{c}");
    for key in ["branch=%s", "main=%s", "ahead=%s", "lines=%s", "hist=%s"] {
        assert!(c.contains(key), "{key} in {c}");
    }
    // 옛 줄(커밋 안 한 변경 · 추적 안 하는 파일 · 시작 커밋)은 없다.
    for gone in ["--porcelain=v1", "lb=", "lh=", "lu=", "ls-files", "base="] {
        assert!(!c.contains(gone), "{gone} in {c}");
    }
    assert_eq!(remote_changes_command("", &paths), None);
    assert_eq!(
        remote_changes_command("~/api", &paths[2..]),
        None,
        "실을 것이 없다"
    );
}

#[test]
fn remote_answer_blocks_and_merged() {
    let out = "motd\nbranch=noise\naynx-wt=0\nbranch=feat-x\nmain=main\nahead=2\nlines=30 4\nhist=1\n\
aynx-wt=1\r\nbranch=feat-m\r\nmain=main\r\nahead=0\r\nhist=1\r\n\
aynx-wt=2\nbranch=fresh\nmain=main\nahead=0\nlines=0 0\nhist=0\n\
aynx-wt=3\nbranch=\nmain=main\nahead=0\nlines=7\n\
aynx-wt=4\nbranch=feat-y\nmain=\n\
aynx-wt=x\nbranch=lost\n\
aynx-wt=1\nbranch=dup\n";
    let blocks = parse_remote_changes(out).unwrap();
    assert_eq!(blocks.len(), 6);
    assert_eq!(
        blocks[0],
        RemoteBlock {
            index: 0,
            branch: Some("feat-x".into()),
            main: Some("main".into()),
            ahead: Some(2),
            lines: Some((30, 4)),
            history: true,
            content: None,
        }
    );
    assert_eq!(blocks[3].branch, None, "분리된 HEAD");
    assert_eq!(blocks[3].lines, None, "한 쌍이 아니면 버린다");
    assert_eq!((blocks[4].main.as_deref(), blocks[4].ahead), (None, None));
    assert!(parse_remote_changes("aynx-fail=nogit\n").is_err());

    let paths: Vec<String> = ["/a", "/b", "/c", "/d", "/e"]
        .iter()
        .map(|p| (*p).to_string())
        .collect();
    let got = resolve_remote(&paths, &blocks);
    let view: Vec<(&str, Option<u32>, u32, u32, bool)> = got
        .iter()
        .map(|g| {
            (
                g.path.as_str(),
                g.ahead,
                g.added_lines,
                g.deleted_lines,
                g.merged,
            )
        })
        .collect();
    assert_eq!(
        view,
        vec![
            ("/a", Some(2), 30, 4, false),
            ("/b", Some(0), 0, 0, true),
            ("/c", Some(0), 0, 0, false),
            ("/d", Some(0), 0, 0, false),
            ("/e", None, 0, 0, false),
        ],
        "겹친 번호(/b 두 번)는 처음 것만"
    );
}

#[test]
fn remote_content_merged_and_kind() {
    const P: &str = "abababababababababababababababababababab";
    const M: &str = "1111111111111111111111111111111111111111";
    let out = format!(
        "aynx-wt=0
branch=sq
main=main
ahead=3
lines=9 1
hist=1
aynx-cm-sq={P}
aynx-cm-tip=
aynx-cm-main={P} {M}
aynx-cm-cherry=3 0
aynx-wt=1
branch=rb
main=main
ahead=2
lines=4 0
hist=1
aynx-cm-sq=
aynx-cm-tip=
aynx-cm-cherry=0 2
aynx-wt=2
branch=open
main=main
ahead=1
lines=1 0
hist=1
aynx-cm-sq={P}
aynx-cm-cherry=1 0
aynx-wt=3
branch=main
main=main
ahead=1
hist=1
aynx-cm-cherry=0 1
"
    );
    let blocks = parse_remote_changes(&out).unwrap();
    assert!(blocks[0].content.is_some());
    let paths: Vec<String> = ["/a", "/b", "/c", "/d"].iter().map(|p| (*p).to_string()).collect();
    let got = resolve_remote(&paths, &blocks);
    let view: Vec<(Option<u32>, bool, Option<MergeKind>)> =
        got.iter().map(|g| (g.ahead, g.merged, g.merged_kind)).collect();
    assert_eq!(
        view,
        vec![
            (Some(3), true, Some(MergeKind::Squash)),
            (Some(2), true, Some(MergeKind::Rebase)),
            (Some(1), false, None),
            (Some(1), false, None),
        ],
        "주 브랜치 자신은 재료가 있어도 병합됨이 아니다"
    );
    assert_eq!(merged_kind_of(true, Some(MergeKind::Squash)), Some(MergeKind::Ancestry));
    assert_eq!(merged_kind_of(false, None), None);
    assert!(wants_content(Some("x"), Some("main"), Some(1)));
    assert!(!wants_content(Some("main"), Some("main"), Some(1)));
    assert!(!wants_content(None, Some("main"), Some(1)));
    assert!(!wants_content(Some("x"), None, Some(1)));
    assert!(!wants_content(Some("x"), Some("main"), Some(0)));
}

/// 진짜 git 왕복 — `git` 이 PATH 에 없으면 건너뛴다. 브랜치에 커밋 둘 → `↑2`·줄 수(커밋 안 한 것은 빠진다) ·
/// main 에 병합 → `↑0`·병합됨 · 같은 자리에서 새 브랜치 → 병합됨 아님.
#[test]
fn real_git_counts_commits_and_merged() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git 이 PATH 에 없어 건너뜀");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "aynx-wtc-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let repo = root.join("repo");
    let side_file = root.join("worktrees.json");
    std::fs::create_dir_all(&repo).unwrap();
    let g = |dir: &Path, args: &[&str]| run_git(dir, args, LOCAL_TIMEOUT).unwrap();
    let who = ["-c", "user.name=t", "-c", "user.email=t@t"];
    let as_user = |dir: &Path, args: &[&str]| {
        let mut all: Vec<&str> = who.to_vec();
        all.extend_from_slice(args);
        assert!(g(dir, &all).ok, "{args:?}");
    };
    let commit = |dir: &Path, msg: &str| {
        assert!(g(dir, &["add", "-A"]).ok);
        as_user(dir, &["commit", "-q", "-m", msg]);
    };
    assert!(g(&repo, &["init", "-q", "-b", "main"]).ok);
    for f in ["a.txt", "b.txt", "c.txt"] {
        std::fs::write(repo.join(f), f).unwrap();
    }
    commit(&repo, "i");

    // 앱이 만든 워크트리 — 곁 파일에 시작 커밋을 더 적지 않는다.
    let added = crate::worktree::add_blocking(&repo, None, "feat-x", Some(side_file.as_path()))
        .expect("add");
    let wt = PathBuf::from(&added.path);
    let file = load_sidecar(&side_file);
    let line = record_for(&file, &path_key(&added.path)).expect("sidecar line");
    assert_eq!(line.base, None);
    let one = |p: &str| {
        let got = changes_blocking(&repo, &[p.to_string()]).unwrap();
        assert_eq!(got.len(), 1, "{p}");
        got.into_iter().next().unwrap()
    };

    // 갓 만든 브랜치 — 전부 0, 병합됨 아님(reflog 가 만든 줄 하나뿐).
    assert_eq!(
        one(&added.path),
        WorktreeChanges {
            path: added.path.clone(),
            ahead: Some(0),
            ..Default::default()
        }
    );

    // 커밋 둘 → ↑2. 커밋 안 한 수정 · 삭제 · 추적 안 하는 새 파일은 세지 않는다.
    std::fs::write(wt.join("a.txt"), "one").unwrap();
    commit(&wt, "1");
    std::fs::write(wt.join("a.txt"), "two\nlines\n").unwrap();
    commit(&wt, "2");
    std::fs::write(wt.join("b.txt"), "dirty").unwrap();
    std::fs::remove_file(wt.join("c.txt")).unwrap();
    std::fs::write(wt.join("new.txt"), "n").unwrap();
    // 주 폴더도 앞으로 간다 — merge-base 기준이라 main 쪽 커밋은 줄 수에 없다.
    std::fs::write(repo.join("main-only.txt"), "m").unwrap();
    commit(&repo, "main moves");
    assert_eq!(
        one(&added.path),
        WorktreeChanges {
            path: added.path.clone(),
            ahead: Some(2),
            // a.txt: "a.txt"(한 줄) → "two\nlines\n" = +2 −1
            added_lines: 2,
            deleted_lines: 1,
            merged: false,
            merged_kind: None,
        }
    );

    // main 에 병합 → ↑0 · 줄 수 0 · 병합됨. 워크트리의 커밋 안 한 변경은 그대로 남아 있어도 병합됨이다.
    as_user(&repo, &["merge", "-q", "--no-edit", "feat-x"]);
    assert_eq!(
        one(&added.path),
        WorktreeChanges {
            path: added.path.clone(),
            ahead: Some(0),
            merged: true,
            merged_kind: Some(MergeKind::Ancestry),
            ..Default::default()
        }
    );
    // 주 폴더 자신은 병합됨이 아니다.
    let main_path = repo.to_string_lossy().into_owned();
    let m = one(&main_path);
    assert_eq!((m.ahead, m.merged), (Some(0), false));

    // 같은 자리에서 새 브랜치 — 다시 갓 만든 브랜치라 병합됨이 아니다.
    assert!(g(&wt, &["switch", "-q", "-c", "fresh"]).ok);
    assert_eq!(
        one(&added.path),
        WorktreeChanges {
            path: added.path.clone(),
            ahead: Some(0),
            ..Default::default()
        }
    );
    // 분리된 HEAD — 병합됨이 아니다.
    assert!(g(&wt, &["switch", "-q", "--detach"]).ok);
    let d = one(&added.path);
    assert_eq!((d.ahead, d.merged), (Some(0), false));

    // (2026-10-05) squash 병합 — 같은 워크트리에서 브랜치 sq 에 커밋 둘, main 이 squash 로 받는다 → ↑2 그대로 · 병합됨(squash).
    assert!(g(&wt, &["switch", "-q", "-c", "sq", "main"]).ok);
    std::fs::write(wt.join("s1.txt"), "s1
").unwrap();
    commit(&wt, "s1");
    std::fs::write(wt.join("s2.txt"), "s2
").unwrap();
    commit(&wt, "s2");
    let before = one(&added.path);
    assert_eq!((before.ahead, before.merged, before.merged_kind), (Some(2), false, None));
    as_user(&repo, &["merge", "--squash", "-q", "sq"]);
    as_user(&repo, &["commit", "-q", "-m", "Squash sq"]);
    let sq = one(&added.path);
    assert_eq!((sq.ahead, sq.merged, sq.merged_kind), (Some(2), true, Some(MergeKind::Squash)));
    // 그 뒤에 커밋이 더 있으면 병합됨이 아니다.
    std::fs::write(wt.join("s3.txt"), "s3
").unwrap();
    commit(&wt, "s3");
    let more = one(&added.path);
    assert_eq!((more.ahead, more.merged), (Some(3), false));

    // 읽기만 했다 — index.lock 이 남지 않는다.
    assert!(!repo.join(".git").join("index.lock").exists());

    // 목록에 없는 경로는 답에서 빠진다.
    let stray = root.join("elsewhere").to_string_lossy().into_owned();
    assert!(changes_blocking(&repo, &[stray]).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&root);
}
