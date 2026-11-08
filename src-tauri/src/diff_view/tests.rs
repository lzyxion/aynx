use super::*;
use std::process::Command;

const H1: &str = "1111111111111111111111111111111111111111";
const H2: &str = "2222222222222222222222222222222222222222";

fn scope(
    kind: ScopeKind,
    branch: Option<&str>,
    worktree: Option<&str>,
    commit: Option<&str>,
) -> DiffScope {
    DiffScope {
        kind,
        branch: branch.map(str::to_string),
        worktree: worktree.map(str::to_string),
        commit: commit.map(str::to_string),
        base: None,
    }
}

#[test]
fn branch_names() {
    for ok in ["main", "feat/retry", "a-b_c.d", "한글", "x@y"] {
        assert!(valid_branch(ok), "{ok}");
    }
    for bad in [
        "", "-x", "a..b", "a b", "a\nb", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "\t",
    ] {
        assert!(!valid_branch(bad), "{bad:?}");
    }
    assert!(!valid_branch(&"x".repeat(256)));
}

#[test]
fn scope_checks() {
    assert_eq!(
        check_scope(&scope(ScopeKind::Branch, Some(" feat "), None, None)),
        Ok(Scope::Branch {
            branch: "feat".into()
        })
    );
    assert!(check_scope(&scope(ScopeKind::Branch, None, None, None)).is_err());
    assert!(check_scope(&scope(ScopeKind::Branch, Some("a b"), None, None)).is_err());
    assert_eq!(
        check_scope(&scope(ScopeKind::Commit, Some("feat"), None, Some(H1))),
        Ok(Scope::Commit {
            commit: H1.into(),
            branch: Some("feat".into())
        })
    );
    assert!(check_scope(&scope(ScopeKind::Commit, None, None, Some("zz; rm"))).is_err());
    assert!(check_scope(&scope(ScopeKind::Commit, None, None, None)).is_err());
    assert_eq!(
        check_scope(&scope(ScopeKind::Wip, None, Some("/srv/wt"), None)),
        Ok(Scope::Wip {
            worktree: "/srv/wt".into()
        })
    );
    assert!(check_scope(&scope(ScopeKind::Wip, None, Some("/a\nb"), None)).is_err());
    assert!(check_scope(&scope(ScopeKind::Wip, None, None, None)).is_err());
    // range(오케스트레이션 보고 — base … 보고 커밋) — 두 끝 모두 커밋 해시여야 한다.
    let mut r = scope(ScopeKind::Range, None, Some("/srv/wt"), Some(H2));
    r.base = Some(H1.into());
    assert_eq!(
        check_scope(&r),
        Ok(Scope::Range {
            base: H1.into(),
            tip: H2.into(),
            worktree: Some("/srv/wt".into())
        })
    );
    r.base = Some("main; rm".into());
    assert!(check_scope(&r).is_err());
    r.base = None;
    assert!(check_scope(&r).is_err());
    let s: DiffScope = serde_json::from_str(&format!(r#"{{"kind":"range","base":"{H1}","commit":"{H2}"}}"#)).unwrap();
    assert_eq!(s.kind, ScopeKind::Range);
}

#[test]
fn scope_deserializes_from_front() {
    let s: DiffScope =
        serde_json::from_str(r#"{"kind":"commit","commit":"abcd1234","branch":"x"}"#).unwrap();
    assert_eq!(s.kind, ScopeKind::Commit);
    assert_eq!(s.commit.as_deref(), Some("abcd1234"));
    let g: DiffGroup = serde_json::from_str(r#""uncommitted""#).unwrap();
    assert_eq!(g, DiffGroup::Uncommitted);
}

#[test]
fn clean_text_masks_controls() {
    assert_eq!(clean_text("a\tb\r"), "a\tb");
    assert_eq!(clean_text("\x1b[31mx"), "\u{241b}[31mx");
    assert_eq!(clean_text("a\x7fb\u{85}"), "a\u{2421}b\u{FFFD}");
    let long = "y".repeat(MAX_LINE_CHARS + 10);
    let c = clean_text(&long);
    assert_eq!(c.chars().count(), MAX_LINE_CHARS + 1);
    assert!(c.ends_with('…'));
}

#[test]
fn hunk_headers() {
    let h = parse_hunk_header("@@ -38,9 +38,14 @@ impl Refresher").unwrap();
    assert_eq!(
        (h.old_start, h.old_lines, h.new_start, h.new_lines),
        (38, 9, 38, 14)
    );
    assert_eq!(h.section, "impl Refresher");
    let h = parse_hunk_header("@@ -1 +1 @@").unwrap();
    assert_eq!(
        (h.old_start, h.old_lines, h.new_start, h.new_lines),
        (1, 1, 1, 1)
    );
    assert_eq!(h.section, "");
    let h = parse_hunk_header("@@ -0,0 +1,3 @@").unwrap();
    assert_eq!(
        (h.old_start, h.old_lines, h.new_start, h.new_lines),
        (0, 0, 1, 3)
    );
    assert!(parse_hunk_header("@@ -x +1 @@").is_none());
    assert!(parse_hunk_header("not a hunk").is_none());
}

const SAMPLE: &str = concat!(
    "diff --git a/src/a.rs b/src/a.rs\n",
    "index 1111111..2222222 100644\n",
    "--- a/src/a.rs\n",
    "+++ b/src/a.rs\n",
    "@@ -1,4 +1,5 @@ fn top\n",
    " one\n",
    "-two\n",
    "+TWO\n",
    "+two-and-half\n",
    " three\n",
    "--- dashes are content\n",
    "@@ -10,2 +11,2 @@\n",
    " ten\n",
    "-last\n",
    "\\ No newline at end of file\n",
    "+last\n",
);

#[test]
fn unified_parses_numbers_and_markers() {
    let p = parse_unified(SAMPLE.as_bytes(), false);
    assert!(!p.binary && !p.truncated);
    assert_eq!(p.hunks.len(), 2);
    let h = &p.hunks[0];
    assert_eq!(h.section, "fn top");
    let kinds: Vec<(LineKind, Option<u32>, Option<u32>, &str)> = h
        .lines
        .iter()
        .map(|l| (l.kind, l.old_no, l.new_no, l.text.as_str()))
        .collect();
    assert_eq!(
        kinds,
        vec![
            (LineKind::Ctx, Some(1), Some(1), "one"),
            (LineKind::Del, Some(2), None, "two"),
            (LineKind::Add, None, Some(2), "TWO"),
            (LineKind::Add, None, Some(3), "two-and-half"),
            (LineKind::Ctx, Some(3), Some(4), "three"),
            // 헝크 안의 `---` 는 머리줄이 아니라 지운 줄이다.
            (LineKind::Del, Some(4), None, "-- dashes are content"),
        ]
    );
    let h2 = &p.hunks[1];
    assert_eq!(h2.lines[1].kind, LineKind::Del);
    assert!(
        h2.lines[1].no_newline,
        "\\ No newline 은 바로 앞 줄에 붙는다"
    );
    assert!(!h2.lines[2].no_newline);
    assert_eq!(h2.lines[2].new_no, Some(12));
    let f = file_of("src/a.rs", None, p);
    assert_eq!((f.added, f.deleted), (3, 3));
}

#[test]
fn unified_crlf_binary_second_file_and_caps() {
    let crlf =
        "diff --git a/w.txt b/w.txt\r\n--- a/w.txt\r\n+++ b/w.txt\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n";
    let p = parse_unified(crlf.as_bytes(), false);
    assert_eq!(p.hunks[0].lines[0].text, "a");
    assert_eq!(p.hunks[0].lines[1].text, "b");

    let bin =
        "diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n";
    let p = parse_unified(bin.as_bytes(), false);
    assert!(p.binary && p.hunks.is_empty());

    let two = format!("{SAMPLE}diff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-x\n+y\n");
    assert_eq!(
        parse_unified(two.as_bytes(), false).hunks.len(),
        2,
        "첫 파일만"
    );

    // 잘린 날 글자 — 반쪽 줄을 버리고 truncated.
    let cut = "@@ -1,2 +1,2 @@\n a\n-b\n+ha";
    let p = parse_unified(cut.as_bytes(), true);
    assert!(p.truncated);
    assert_eq!(p.hunks[0].lines.len(), 2);

    // 줄 상한.
    let mut big = String::from("@@ -0,0 +1,30000 @@\n");
    for i in 0..(MAX_DIFF_LINES + 5) {
        big.push_str(&format!("+l{i}\n"));
    }
    let p = parse_unified(big.as_bytes(), false);
    assert!(p.truncated);
    assert_eq!(p.hunks[0].lines.len(), MAX_DIFF_LINES);

    // 제어 글자는 대리 글자로.
    let esc = "@@ -1 +1 @@\n-\x1b[201~evil\n+ok\n";
    let p = parse_unified(esc.as_bytes(), false);
    assert_eq!(p.hunks[0].lines[0].text, "\u{241b}[201~evil");
}

#[test]
fn entries_and_groups() {
    let list = vec![
        NameStatus {
            status: 'M',
            path: "a".into(),
            old_path: None,
        },
        NameStatus {
            status: 'A',
            path: "img.png".into(),
            old_path: None,
        },
        NameStatus {
            status: 'R',
            path: "new".into(),
            old_path: Some("old".into()),
        },
        NameStatus {
            status: 'A',
            path: "u.txt".into(),
            old_path: None,
        },
    ];
    let mut counts = HashMap::new();
    counts.insert("a".to_string(), Some((3, 1)));
    counts.insert("img.png".to_string(), None);
    counts.insert("new".to_string(), Some((0, 0)));
    let mut un = HashMap::new();
    un.insert("u.txt".to_string(), 7);
    let e = entries_of(list, &counts, &un, DiffGroup::Uncommitted);
    assert_eq!(
        (e[0].added, e[0].deleted, e[0].binary),
        (Some(3), Some(1), false)
    );
    assert_eq!((e[1].added, e[1].binary), (None, true));
    assert_eq!(e[2].old_path.as_deref(), Some("old"));
    assert_eq!((e[3].added, e[3].deleted), (Some(7), Some(0)));
    assert!(e.iter().all(|x| x.group == DiffGroup::Uncommitted));

    let many: Vec<DiffEntry> = (0..MAX_FILES + 3)
        .map(|i| DiffEntry {
            path: format!("f{i}"),
            ..Default::default()
        })
        .collect();
    let (all, cut) = join_groups(many, e);
    assert!(cut && all.len() == MAX_FILES);
}

#[test]
fn commit_lines() {
    let c = parse_commit_line(&format!("\n{H1}\t1700000000\tfix\tthing")).unwrap();
    assert_eq!(
        (c.hash.as_str(), c.time, c.subject.as_str()),
        (H1, 1_700_000_000, "fix thing")
    );
    assert!(parse_commit_line("zz\t1\tx").is_none());
    assert!(parse_commit_line(H1).is_none());
}

#[test]
fn remote_files_parse() {
    let sc = Scope::Branch {
        branch: "feat".into(),
    };
    let out = format!(
        "motd\naynx-dfiles\0main\0main\0branch\0feat\0base\0{H1}\0tip\0{H2}\0wt\0/srv/wt feat\0head\0{H2}\0\
cns\0M\0a.rs\0R100\0old.rs\0new.rs\0aynx-end\0\
cnum\x002\t1\ta.rs\0\x000\t0\t\0old.rs\0new.rs\0aynx-end\0\
ust\0 M a.rs\0?? n.txt\0aynx-end\0\
unum\x001\t0\ta.rs\0aynx-end\0\
ulines\x004\tn.txt\0aynx-end\0\
commits\0{H2}\t1700\tsecond\0\n{H1}\t1600\tfirst\0\naynx-end\0"
    );
    let f = parse_remote_files(&out, &sc).unwrap();
    assert_eq!(f.main.as_deref(), Some("main"));
    assert_eq!(f.branch.as_deref(), Some("feat"));
    assert_eq!(f.base.as_deref(), Some(H1));
    assert_eq!(f.tip.as_deref(), Some(H2));
    assert_eq!(f.worktree.as_deref(), Some("/srv/wt feat"));
    assert_eq!(f.files.len(), 4);
    assert_eq!(f.files[0].group, DiffGroup::Committed);
    assert_eq!((f.files[0].added, f.files[0].deleted), (Some(2), Some(1)));
    assert_eq!(f.files[1].old_path.as_deref(), Some("old.rs"));
    assert_eq!(f.files[2].group, DiffGroup::Uncommitted);
    assert_eq!(
        (f.files[3].path.as_str(), f.files[3].added),
        ("n.txt", Some(4))
    );
    assert_eq!(f.wip_count, Some(2));
    assert_eq!(f.commits.len(), 2);
    assert_eq!(f.commits[0].subject, "second");

    // 병합 커밋 — 목록 없이 merge, 커밋 안 한 수는 wst 로.
    let sc = Scope::Commit {
        commit: H2.into(),
        branch: Some("feat".into()),
    };
    let out = format!(
        "aynx-dfiles\0main\0main\0branch\0feat\0tip\0{H2}\0parents\x002\0base\0{H1}\0wt\0/w\0wst\0 M x\0?? y\0aynx-end\0"
    );
    let f = parse_remote_files(&out, &sc).unwrap();
    assert!(f.merge && !f.root && f.files.is_empty());
    assert_eq!(f.wip_count, Some(2));
    // 뿌리 커밋.
    let out = format!("aynx-dfiles\0main\0\0branch\0\0tip\0{H2}\0parents\x000\0base\0\0cns\0A\0a\0aynx-end\0");
    let f = parse_remote_files(&out, &sc).unwrap();
    assert!(f.root && f.base.is_none() && f.main.is_none());
    assert_eq!(f.files.len(), 1);

    // 실패 표식.
    for (mark, needle) in [
        ("nogit", "git"),
        ("notrepo", "git"),
        ("nomain", ""),
        ("nocommit", H2),
    ] {
        let e = parse_remote_files(&format!("x\naynx-fail={mark}\n"), &sc).unwrap_err();
        assert!(e.contains(needle), "{mark}: {e}");
    }
    assert!(parse_remote_files("garbage", &sc).is_err());
}

#[test]
fn remote_file_parse() {
    let sc = Scope::Wip {
        worktree: "/w".into(),
    };
    let out = b"noise\naynx-diff\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n";
    let f = parse_remote_file(out, false, &sc, "a", None).unwrap();
    assert_eq!((f.added, f.deleted, f.truncated), (1, 1, false));
    let big = b"aynx-fail=big\naynx-diff\n";
    let f = parse_remote_file(big, false, &sc, "a", None).unwrap();
    assert!(f.truncated && f.hunks.is_empty());
    let e = parse_remote_file(b"aynx-fail=nowt\n", false, &sc, "a", None).unwrap_err();
    assert!(e.contains("/w"), "{e}");
    assert!(parse_remote_file(b"nothing", false, &sc, "a", None).is_err());
}

#[test]
fn remote_commands_quote_and_stay_read_only() {
    let b = remote_files_command(
        " ~/api ",
        &Scope::Branch {
            branch: "feat/x".into(),
        },
    )
    .unwrap();
    assert!(b.starts_with("sh -c 'command -v git"), "{b}");
    assert!(b.contains(r#"R="$HOME"/'\''api'\''"#), "{b}");
    assert!(b.contains(r#"B='\''feat/x'\''"#), "{b}");
    assert!(
        b.contains("--no-optional-locks diff --no-ext-diff --no-color -M --name-status -z"),
        "{b}"
    );
    let c = remote_files_command(
        "/srv/api",
        &Scope::Commit {
            commit: H1.into(),
            branch: None,
        },
    )
    .unwrap();
    assert!(c.contains(&format!("H='\\''{H1}'\\''")), "{c}");
    assert!(c.contains("diff-tree -r -M --root"), "{c}");
    let w = remote_files_command(
        "/srv/api",
        &Scope::Wip {
            worktree: "/srv/it's".into(),
        },
    )
    .unwrap();
    assert!(w.contains(r#"w='\''/srv/it'\''\'\'''\''s'\''"#), "{w}");
    assert!(w.contains("grep -Fxq --"), "{w}");
    assert!(remote_files_command(
        "",
        &Scope::Wip {
            worktree: "/w".into()
        }
    )
    .is_none());
    assert!(remote_files_command(
        "/a\nb",
        &Scope::Wip {
            worktree: "/w".into()
        }
    )
    .is_none());
    assert!(remote_files_command(
        "/r",
        &Scope::Branch {
            branch: "a b".into()
        }
    )
    .is_none());
    assert!(remote_files_command(
        "/r",
        &Scope::Commit {
            commit: "zz; rm -rf /".into(),
            branch: None
        }
    )
    .is_none());

    let f = remote_file_command(
        "/srv/api",
        &Scope::Branch {
            branch: "feat".into(),
        },
        "src/it's.rs",
        Some("src/old.rs"),
        DiffGroup::Committed,
    )
    .unwrap();
    assert!(
        f.contains("--literal-pathspecs --no-optional-locks diff --no-color --no-ext-diff -M -U3"),
        "{f}"
    );
    // 경로는 인용된 낱말로만 — 옛 이름은 두 겹 인용(eval 로 한 번 펼친다).
    assert!(f.contains(r#"P='\''src/it'\''\'\'''\''s.rs'\''"#), "{f}");
    assert!(f.contains("aynx-diff"), "{f}");
    let u = remote_file_command(
        "/r",
        &Scope::Wip {
            worktree: "/w".into(),
        },
        "n.txt",
        None,
        DiffGroup::Uncommitted,
    )
    .unwrap();
    assert!(u.contains("--no-index"), "{u}");
    assert!(u.contains(&format!("-le {UNTRACKED_MAX_BYTES}")), "{u}");
    assert!(remote_file_command(
        "/r",
        &Scope::Wip {
            worktree: "/w".into()
        },
        "a\nb",
        None,
        DiffGroup::Uncommitted
    )
    .is_none());
    assert!(remote_file_command(
        "/r",
        &Scope::Wip {
            worktree: "/w".into()
        },
        "a",
        Some("\n"),
        DiffGroup::Uncommitted
    )
    .is_none());

    // 읽기 전용 — git 에 쓰는 명령이 없다.
    for s in [&b, &c, &w, &f, &u] {
        for bad in [
            " commit ",
            "git add",
            "reset",
            "checkout",
            "stash",
            "--force",
            "update-index",
            "branch -d",
            "branch -D",
            " gc",
            "merge --",
            "rebase",
            "apply",
            "update-ref",
            "push",
            "fetch",
        ] {
            assert!(!s.contains(bad), "{bad} in {s}");
        }
    }
}

/// 진짜 git 왕복 — `git` 이 PATH 에 없으면 건너뛴다.
#[test]
fn real_git_diff_round_trip() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git 이 PATH 에 없어 건너뜀");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "aynx-dv-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let id = [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "-c",
        "core.autocrlf=false",
    ];
    let git = |dir: &Path, args: &[&str]| {
        let mut all: Vec<&str> = id.to_vec();
        all.extend_from_slice(args);
        let r = run_git(dir, &all, LOCAL_TIMEOUT).unwrap();
        assert!(r.ok, "{args:?}: {}", r.stderr);
        r.stdout.trim().to_string()
    };
    let commit = |dir: &Path, msg: &str| {
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-q", "-m", msg]);
        git(dir, &["rev-parse", "HEAD"])
    };
    git(&repo, &["init", "-q", "-b", "main"]);
    let body: String = (1..=30).map(|i| format!("line {i}\n")).collect();
    std::fs::write(repo.join("a.txt"), &body).unwrap();
    std::fs::write(
        repo.join("move-me.txt"),
        "same\ncontent\nhere\nfor\nrename\n",
    )
    .unwrap();
    std::fs::write(repo.join("crlf.txt"), "x\r\ny\r\n").unwrap();
    let root_commit = commit(&repo, "init");

    // feat — 워크트리, 커밋 둘(수정 · 이름 바꿈 · 이진 · CRLF · 큰 파일) + 커밋 안 한 것 + 추적 안 한 새 파일.
    let wt = root.join("wt-feat");
    let wt_s = wt.to_string_lossy().to_string();
    git(
        &repo,
        &["worktree", "add", "-q", "-b", "feat", &wt_s, &root_commit],
    );
    std::fs::write(wt.join("a.txt"), body.replace("line 5\n", "LINE five\n")).unwrap();
    std::fs::rename(wt.join("move-me.txt"), wt.join("moved.txt")).unwrap();
    std::fs::write(wt.join("bin.dat"), [0u8, 1, 2, 3, 0, 255]).unwrap();
    std::fs::write(wt.join("crlf.txt"), "x\r\nY\r\n").unwrap();
    let f1 = commit(&wt, "feat one");
    let huge: String = (0..(MAX_DIFF_LINES + 500))
        .map(|i| format!("h{i}\n"))
        .collect();
    std::fs::write(wt.join("huge.txt"), &huge).unwrap();
    let f2 = commit(&wt, "feat two");
    std::fs::write(
        wt.join("a.txt"),
        body.replace("line 20\n", "line twenty\n")
            .replace("line 5\n", "LINE five\n"),
    )
    .unwrap();
    std::fs::write(wt.join("new.txt"), "n1\nn2").unwrap();

    // main 이 따로 움직이고, 병합 커밋 하나.
    git(&repo, &["checkout", "-q", "-b", "side"]);
    std::fs::write(repo.join("side.txt"), "s\n").unwrap();
    commit(&repo, "side");
    git(&repo, &["checkout", "-q", "main"]);
    std::fs::write(repo.join("m.txt"), "m\n").unwrap();
    commit(&repo, "m");
    git(&repo, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
    let merge = git(&repo, &["rev-parse", "HEAD"]);

    // ── 브랜치 전체 ──
    let br = Scope::Branch {
        branch: "feat".into(),
    };
    let f = files_blocking(&repo, &br).unwrap();
    assert_eq!(f.main.as_deref(), Some("main"));
    assert_eq!(f.base.as_deref(), Some(root_commit.as_str()), "merge-base");
    assert_eq!(f.tip.as_deref(), Some(f2.as_str()));
    assert!(f.worktree.is_some());
    let committed: Vec<&DiffEntry> = f
        .files
        .iter()
        .filter(|e| e.group == DiffGroup::Committed)
        .collect();
    let uncommitted: Vec<&DiffEntry> = f
        .files
        .iter()
        .filter(|e| e.group == DiffGroup::Uncommitted)
        .collect();
    let find = |list: &[&DiffEntry], p: &str| list.iter().find(|e| e.path == p).cloned().cloned();
    assert_eq!(find(&committed, "a.txt").unwrap().status, "M");
    let mv = find(&committed, "moved.txt").unwrap();
    assert_eq!(
        (mv.status.as_str(), mv.old_path.as_deref()),
        ("R", Some("move-me.txt"))
    );
    assert!(find(&committed, "bin.dat").unwrap().binary);
    assert_eq!(find(&committed, "huge.txt").unwrap().status, "A");
    assert_eq!(find(&uncommitted, "a.txt").unwrap().status, "M");
    let nu = find(&uncommitted, "new.txt").unwrap();
    assert_eq!((nu.status.as_str(), nu.added), ("A", Some(2)));
    assert_eq!(f.wip_count, Some(2));
    assert_eq!(
        f.commits.iter().map(|c| c.hash.clone()).collect::<Vec<_>>(),
        vec![f2.clone(), f1.clone()]
    );

    let a = file_blocking(&repo, &br, "a.txt", None, DiffGroup::Committed).unwrap();
    assert_eq!((a.added, a.deleted), (1, 1));
    let del = a.hunks[0]
        .lines
        .iter()
        .find(|l| l.kind == LineKind::Del)
        .unwrap();
    assert_eq!((del.old_no, del.text.as_str()), (Some(5), "line 5"));
    let mvf = file_blocking(
        &repo,
        &br,
        "moved.txt",
        Some("move-me.txt"),
        DiffGroup::Committed,
    )
    .unwrap();
    assert!(
        mvf.hunks.is_empty() && !mvf.binary,
        "내용이 같은 이름 바꿈 — 헝크 없음"
    );
    let bin = file_blocking(&repo, &br, "bin.dat", None, DiffGroup::Committed).unwrap();
    assert!(bin.binary);
    let crlf = file_blocking(&repo, &br, "crlf.txt", None, DiffGroup::Committed).unwrap();
    let texts: Vec<&str> = crlf.hunks[0]
        .lines
        .iter()
        .map(|l| l.text.as_str())
        .collect();
    assert!(texts.contains(&"y") && texts.contains(&"Y"), "{texts:?}");
    let hg = file_blocking(&repo, &br, "huge.txt", None, DiffGroup::Committed).unwrap();
    assert!(hg.truncated);
    assert!(hg.hunks.iter().map(|h| h.lines.len()).sum::<usize>() <= MAX_DIFF_LINES);
    let ua = file_blocking(&repo, &br, "a.txt", None, DiffGroup::Uncommitted).unwrap();
    assert_eq!((ua.added, ua.deleted), (1, 1), "커밋 안 한 것 — HEAD 대비");
    let un = file_blocking(&repo, &br, "new.txt", None, DiffGroup::Uncommitted).unwrap();
    assert_eq!((un.added, un.deleted), (2, 0));
    assert!(un.hunks[0].lines[1].no_newline);

    // ── 커밋 하나 ──
    let c1 = Scope::Commit {
        commit: f1[..10].to_string(),
        branch: Some("feat".into()),
    };
    let f = files_blocking(&repo, &c1).unwrap();
    assert_eq!(f.tip.as_deref(), Some(f1.as_str()));
    assert_eq!(f.base.as_deref(), Some(root_commit.as_str()));
    assert!(!f.merge && !f.root);
    assert!(f.files.iter().all(|e| e.group == DiffGroup::Committed));
    assert!(f.files.iter().any(|e| e.path == "moved.txt"));
    assert_eq!(f.wip_count, Some(2));
    let a = file_blocking(&repo, &c1, "a.txt", None, DiffGroup::Committed).unwrap();
    assert_eq!((a.added, a.deleted), (1, 1));
    // 뿌리 커밋 — 빈 트리 대비.
    let r = Scope::Commit {
        commit: root_commit.clone(),
        branch: None,
    };
    let f = files_blocking(&repo, &r).unwrap();
    assert!(f.root && f.base.is_none());
    assert_eq!(f.files.len(), 3);
    let a = file_blocking(&repo, &r, "a.txt", None, DiffGroup::Committed).unwrap();
    assert_eq!((a.added, a.deleted), (30, 0));
    // 병합 커밋 — 목록 없음.
    let m = Scope::Commit {
        commit: merge.clone(),
        branch: Some("main".into()),
    };
    let f = files_blocking(&repo, &m).unwrap();
    assert!(f.merge && f.files.is_empty());

    // ── 커밋 안 한 것 ──
    let w = Scope::Wip {
        worktree: wt_s.clone(),
    };
    let f = files_blocking(&repo, &w).unwrap();
    assert_eq!(f.branch.as_deref(), Some("feat"));
    assert_eq!(f.head.as_deref(), Some(f2.as_str()));
    assert_eq!(f.files.len(), 2);
    assert!(f.files.iter().all(|e| e.group == DiffGroup::Uncommitted));
    let un = file_blocking(&repo, &w, "new.txt", None, DiffGroup::Uncommitted).unwrap();
    assert_eq!(un.added, 2);

    // ── 두 커밋 사이(range — 오케스트레이션 보고) ── 커밋된 것만, 커밋 안 한 것은 싣지 않는다.
    let rg = Scope::Range {
        base: root_commit.clone(),
        tip: f1.clone(),
        worktree: Some(wt_s.clone()),
    };
    let f = files_blocking(&repo, &rg).unwrap();
    assert_eq!((f.base.as_deref(), f.tip.as_deref()), (Some(root_commit.as_str()), Some(f1.as_str())));
    assert_eq!(f.worktree.as_deref().map(comparable), Some(comparable(&wt_s)), "그 worktree(git 목록의 글자)");
    assert!(f.files.iter().all(|e| e.group == DiffGroup::Committed));
    assert!(f.files.iter().any(|e| e.path == "moved.txt"));
    assert!(!f.files.iter().any(|e| e.path == "huge.txt"), "보고 커밋 뒤의 것은 없다");
    let a = file_blocking(&repo, &rg, "a.txt", None, DiffGroup::Committed).unwrap();
    assert_eq!((a.added, a.deleted), (1, 1));

    // 없는 것들.
    assert!(files_blocking(
        &repo,
        &Scope::Branch {
            branch: "nope".into()
        }
    )
    .is_err());
    assert!(files_blocking(
        &repo,
        &Scope::Commit {
            commit: "deadbeef".into(),
            branch: None
        }
    )
    .is_err());
    assert!(files_blocking(
        &repo,
        &Scope::Wip {
            worktree: root.join("x").to_string_lossy().into()
        }
    )
    .is_err());

    // 원격 스크립트를 이 PC 의 sh 로 돌려 본다(sh 가 없으면 건너뛴다) — 로컬 몸통과 같은 답이어야 한다.
    if Command::new("sh")
        .arg("-c")
        .arg("true")
        .output()
        .is_ok_and(|o| o.status.success())
    {
        let sh = |cmd: String| -> Vec<u8> {
            let o = Command::new("sh").arg("-c").arg(cmd).output().unwrap();
            o.stdout
        };
        let repo_s = repo.to_string_lossy().replace('\\', "/");
        let txt = |b: Vec<u8>| String::from_utf8_lossy(&b).into_owned();
        let rf =
            parse_remote_files(&txt(sh(remote_files_command(&repo_s, &br).unwrap())), &br).unwrap();
        let lf = files_blocking(&repo, &br).unwrap();
        assert_eq!(rf.base, lf.base);
        assert_eq!(rf.tip, lf.tip);
        let names = |f: &DiffFiles| {
            let mut v: Vec<(String, DiffGroup, String)> = f
                .files
                .iter()
                .map(|e| (e.path.clone(), e.group, e.status.clone()))
                .collect();
            v.sort_by(|a, b| (&a.0, a.1 as u8).cmp(&(&b.0, b.1 as u8)));
            v
        };
        assert_eq!(names(&rf), names(&lf));
        assert_eq!(rf.commits, lf.commits);
        let wt_git = rf.worktree.clone().unwrap();
        let ra = parse_remote_file(
            &sh(remote_file_command(&repo_s, &br, "a.txt", None, DiffGroup::Committed).unwrap()),
            false,
            &br,
            "a.txt",
            None,
        )
        .unwrap();
        assert_eq!((ra.added, ra.deleted), (1, 1));
        let rm = parse_remote_file(
            &sh(remote_file_command(
                &repo_s,
                &br,
                "moved.txt",
                Some("move-me.txt"),
                DiffGroup::Committed,
            )
            .unwrap()),
            false,
            &br,
            "moved.txt",
            Some("move-me.txt"),
        )
        .unwrap();
        assert!(rm.hunks.is_empty());
        let rn = parse_remote_file(
            &sh(
                remote_file_command(&repo_s, &br, "new.txt", None, DiffGroup::Uncommitted).unwrap(),
            ),
            false,
            &br,
            "new.txt",
            None,
        )
        .unwrap();
        assert_eq!(rn.added, 2);
        let rw = Scope::Wip {
            worktree: wt_git.clone(),
        };
        let rwf =
            parse_remote_files(&txt(sh(remote_files_command(&repo_s, &rw).unwrap())), &rw).unwrap();
        assert_eq!(rwf.branch.as_deref(), Some("feat"));
        assert_eq!(rwf.files.len(), 2);
        let rua = parse_remote_file(
            &sh(remote_file_command(&repo_s, &rw, "a.txt", None, DiffGroup::Uncommitted).unwrap()),
            false,
            &rw,
            "a.txt",
            None,
        )
        .unwrap();
        assert_eq!((rua.added, rua.deleted), (1, 1));
        let rc =
            parse_remote_files(&txt(sh(remote_files_command(&repo_s, &m).unwrap())), &m).unwrap();
        assert!(rc.merge);
        let rr =
            parse_remote_files(&txt(sh(remote_files_command(&repo_s, &r).unwrap())), &r).unwrap();
        assert!(rr.root && rr.files.len() == 3);
        let rcf = parse_remote_file(
            &sh(remote_file_command(&repo_s, &c1, "a.txt", None, DiffGroup::Committed).unwrap()),
            false,
            &c1,
            "a.txt",
            None,
        )
        .unwrap();
        assert_eq!((rcf.added, rcf.deleted), (1, 1));
        let e = parse_remote_files(
            &txt(sh(remote_files_command(
                &repo_s,
                &Scope::Branch {
                    branch: "nope".into(),
                },
            )
            .unwrap())),
            &Scope::Branch {
                branch: "nope".into(),
            },
        )
        .unwrap_err();
        assert!(e.contains("nope"), "{e}");
    } else {
        eprintln!("sh 가 없어 원격 스크립트 왕복은 건너뜀");
    }

    // 읽기 전용 — 저장소 상태가 그대로다.
    let st = git(&wt, &["status", "--porcelain"]);
    assert!(st.contains("M a.txt") && st.contains("?? new.txt"), "{st}");

    let _ = std::fs::remove_dir_all(&root);
}
