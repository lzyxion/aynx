use super::*;
use std::process::Command;

const H1: &str = "1111111111111111111111111111111111111111";
const H2: &str = "2222222222222222222222222222222222222222";
const H3: &str = "3333333333333333333333333333333333333333";

fn hs(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn merge_names() {
    assert_eq!(
        merge_name("Merge branch 'feat/x'").as_deref(),
        Some("feat/x")
    );
    assert_eq!(
        merge_name("Merge branch 'fix' into main").as_deref(),
        Some("fix")
    );
    assert_eq!(merge_name("Merge branch fix"), None, "따옴표 없음");
    assert_eq!(merge_name("Merge branch ''"), None);
    assert_eq!(merge_name("Merge branch 'a' of github.com:x/y"), None);
    assert_eq!(merge_name("Merge pull request #3 from x/y"), None);
    assert_eq!(merge_name("Merge remote-tracking branch 'origin/x'"), None);
    assert_eq!(merge_name("fix: Merge branch 'x'"), None);
}

#[test]
fn merged_table() {
    let rl = |l: &[&str]| hs(l);
    let cases: [(bool, u32, Vec<String>, bool); 9] = [
        (
            false,
            0,
            rl(&["commit: x", "branch: Created from main"]),
            true,
        ),
        (false, 0, rl(&["commit (amend): x"]), true),
        (false, 0, rl(&["merge main: Fast-forward"]), true),
        (false, 0, rl(&["cherry-pick: y"]), true),
        (
            false,
            0,
            rl(&["rebase (finish): refs/heads/a onto x"]),
            true,
        ),
        (false, 0, rl(&["pull: Fast-forward"]), true),
        (false, 0, rl(&["branch: Created from main"]), false),
        (false, 0, Vec::new(), false),
        (false, 2, rl(&["commit: x"]), false),
    ];
    for (is_main, ahead, reflog, want) in cases {
        assert_eq!(
            is_merged(is_main, ahead, &reflog),
            want,
            "{reflog:?} {ahead}"
        );
    }
    assert!(!is_merged(true, 0, &rl(&["commit: x"])), "주 브랜치");
    assert!(!is_merged(false, 0, &rl(&["reset: moving to HEAD~1"])));
}

#[test]
fn main_line_supplement_and_skips() {
    let fp: Vec<String> = (0..10).map(|i| format!("{i:040x}")).collect();
    let (rows, more) = build_main_line(&fp, false, 3, &[]);
    assert_eq!(
        rows.iter()
            .map(|r| (r.hash.as_str(), r.skipped_before))
            .collect::<Vec<_>>(),
        vec![
            (fp[0].as_str(), 0),
            (fp[1].as_str(), 0),
            (fp[2].as_str(), 0)
        ]
    );
    assert!(more);
    // 줄 위의 base 는 보충, 줄 밖(모르는) base 는 버린다, 이미 있는 것은 겹치지 않는다.
    let (rows, more) = build_main_line(&fp, false, 2, &[&fp[6], &fp[4], H1, &fp[1], &fp[6]]);
    assert_eq!(
        rows.iter()
            .map(|r| (r.hash.as_str(), r.skipped_before))
            .collect::<Vec<_>>(),
        vec![
            (fp[0].as_str(), 0),
            (fp[1].as_str(), 0),
            (fp[4].as_str(), 2),
            (fp[6].as_str(), 1)
        ]
    );
    assert!(more);
    let (rows, more) = build_main_line(&fp, false, 2, &[&fp[9]]);
    assert_eq!(rows.last().unwrap().skipped_before, 7);
    assert!(!more, "마지막 커밋까지 실었다");
    let (rows, more) = build_main_line(&fp, true, 20, &[]);
    assert_eq!(rows.len(), 10);
    assert!(more, "읽기 상한 뒤에 더 있다");
    let (rows, more) = build_main_line(&[], false, 5, &[H1]);
    assert!(rows.is_empty() && !more);
    assert_eq!(clamp_limit(None), 12);
    assert_eq!(clamp_limit(Some(0)), 1);
    assert_eq!(clamp_limit(Some(9999)), 500);
}

#[test]
fn log_reader_sums_and_merges() {
    let text = format!(
        "aynx-c={H1}\t{H2}\t100\tfix:\ta\x07b\n\n3\t1\ta.txt\n-\t-\tbin.png\n2\t0\t\"q\\tq\"\n\
aynx-c={H2}\t{H3} {H1}\t90\tMerge branch 'x'\n5\t5\tz\naynx-c={H3}\t\t80\troot\n"
    );
    let got = parse_commit_log(&text);
    assert_eq!(got.len(), 3);
    assert_eq!(got[0].subject, "fix: a b", "제어 글자는 빈칸");
    assert_eq!((got[0].added, got[0].deleted), (Some(5), Some(1)));
    assert_eq!(got[0].parents, hs(&[H2]));
    assert_eq!((got[1].added, got[1].deleted), (None, None), "병합 커밋");
    assert_eq!(got[1].parents.len(), 2);
    assert_eq!((got[2].added, got[2].time), (Some(0), 80));
    assert!(got[2].parents.is_empty());
    assert!(parse_commit_log("aynx-c=nothash\t\t1\tx\n").is_empty());
}

#[test]
fn dirty_counts() {
    let list = vec![
        NameStatus {
            status: 'M',
            path: "a".into(),
            old_path: None,
        },
        NameStatus {
            status: 'A',
            path: "n".into(),
            old_path: None,
        },
        NameStatus {
            status: 'M',
            path: "bin".into(),
            old_path: None,
        },
    ];
    let counts = HashMap::from([("a".to_string(), Some((2, 1))), ("bin".to_string(), None)]);
    let untracked = HashMap::from([("n".to_string(), 4)]);
    assert_eq!(
        dirty_of(&list, &counts, &untracked),
        Some(Dirty {
            files: 3,
            added: 6,
            deleted: 1
        })
    );
    assert_eq!(dirty_of(&[], &counts, &untracked), None);
}

#[test]
fn remote_graph_parses() {
    let out = format!(
        "motd\naynx-wt\nworktree /r\nHEAD {H1}\nbranch refs/heads/main\n\nworktree /r-wt/a\nHEAD {H3}\nbranch refs/heads/a\n\naynx-wt-end\n\
aynx-ref=refs/heads/a\t{H3}\t30\twork\naynx-ref=refs/heads/main\t{H1}\t20\tmerge\naynx-ref=refs/heads/main\t{H1}\t20\tmerge\n\
aynx-fp={H1}\naynx-fp={H2}\n\
aynx-grp=main\n\
aynx-c={H1}\t{H2} {H3}\t20\tMerge branch 'c' into main\naynx-n=9\t9\n\
aynx-c={H2}\t\t10\tinit\naynx-n=3\t0\n\
aynx-fold={H1}\t{H2}\n\
aynx-c={H3}\t{H2}\t15\tc work\naynx-n=1\t2\n\
aynx-made=a\t25\tbranch: Created from main\n\
aynx-br=a\t{H2}\t1\t1\n\
aynx-c=4444444444444444444444444444444444444444\t{H2}\t30\twork\naynx-n=7\t0\n\
aynx-made=gone\t5\tbranch: Created from main\n\
aynx-br=gone\t{H2}\t1\t0\naynx-rl=commit: x\n\
aynx-grp=bases\n\
aynx-dirty=/r-wt/a\t2\t3\t1\t4\n\
aynx-dirty=/r\t0\t0\t0\t0\n"
    );
    let raw = parse_remote_graph(&out).unwrap();
    assert_eq!(raw.worktrees.len(), 2);
    assert_eq!(raw.first_parent, hs(&[H1, H2]));
    assert_eq!(raw.pool.len(), 4);
    assert_eq!(raw.branches["gone"].reflog, hs(&["commit: x"]));
    let g = assemble(&raw, 12);
    assert_eq!(g.main.as_deref(), Some("main"));
    assert_eq!(g.main_head.as_deref(), Some(H1));
    assert_eq!(g.main_line.len(), 2);
    assert!(!g.main_more);
    assert_eq!(g.folds.len(), 1);
    assert_eq!(g.folds[0].name.as_deref(), Some("c"));
    assert_eq!(g.folds[0].commits, hs(&[H3]));
    assert_eq!(g.folds[0].base.as_deref(), Some(H2));
    assert_eq!(
        g.branches
            .iter()
            .map(|b| b.name.as_str())
            .collect::<Vec<_>>(),
        vec!["a"],
        "병합되고 워크트리 없는 브랜치는 싣지 않는다"
    );
    let a = &g.branches[0];
    assert_eq!((a.ahead, a.behind, a.merged), (1, 1, false));
    assert_eq!(a.created_from.as_deref(), Some("main"));
    let c = |h: &str| g.commits.iter().find(|c| c.hash == h).unwrap();
    assert_eq!(
        (c(H1).added, c(H2).added, c(H3).deleted),
        (None, Some(3), Some(2))
    );
    assert_eq!(g.commits.len(), 4, "겹침 없음");
    assert_eq!(
        g.worktrees[1].dirty,
        Some(Dirty {
            files: 2,
            added: 7,
            deleted: 1
        })
    );
    assert_eq!(g.worktrees[0].dirty, None);
    assert!(!g.truncated);
    assert!(parse_remote_graph("aynx-fail=nogit\n").is_err());
    assert!(parse_remote_graph("aynx-fail=notrepo\n").is_err());

    // 분리 HEAD — 워크트리만.
    let detached = format!("aynx-wt\nworktree /r\nHEAD {H1}\ndetached\n\naynx-wt-end\n");
    let g = assemble(&parse_remote_graph(&detached).unwrap(), 12);
    assert!(g.main.is_none() && g.main_line.is_empty() && g.branches.is_empty());
    assert_eq!(g.worktrees.len(), 1);
}

#[test]
fn remote_graph_content_merges() {
    const P: &str = "abababababababababababababababababababab";
    const S1: &str = "5555555555555555555555555555555555555555";
    const S2: &str = "6666666666666666666666666666666666666666";
    const A1: &str = "7777777777777777777777777777777777777777";
    // main = H1(squash 커밋) ← H2. 브랜치 s(워크트리 없음)는 squash 병합 · a(워크트리)는 rebase 병합인데 짝이 창 밖.
    let out = format!(
        "aynx-wt
worktree /r
HEAD {H1}
branch refs/heads/main

worktree /r-wt/a
HEAD {A1}
branch refs/heads/a

aynx-wt-end
aynx-ref=refs/heads/s	{S2}	30	s2
aynx-ref=refs/heads/a	{A1}	25	a1
aynx-ref=refs/heads/main	{H1}	40	Squash s
aynx-fp={H1}
aynx-fp={H2}
aynx-grp=main
aynx-c={H1}	{H2}	40	Squash s
aynx-n=2	0
aynx-c={H2}		10	init
aynx-n=1	0
aynx-br=s	{H2}	1	2
aynx-c={S2}	{S1}	30	s2
aynx-n=1	0
aynx-c={S1}	{H2}	20	s1
aynx-n=1	0
aynx-cm-sq={P}
aynx-cm-tip=
aynx-cm-main={P} {H1}
aynx-cm-cherry=2 0
aynx-br=a	{H2}	1	1
aynx-c={A1}	{H2}	25	a1
aynx-n=1	0
aynx-cm-sq=
aynx-cm-tip=
aynx-cm-cherry=0 1
aynx-grp=bases
"
    );
    let raw = parse_remote_graph(&out).unwrap();
    assert!(raw.branches["s"].content.is_some());
    let g = assemble(&raw, 12);
    assert_eq!(
        g.branches.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(),
        vec!["a"],
        "워크트리 없는 squash 병합 브랜치는 싣지 않는다"
    );
    let a = &g.branches[0];
    assert!(a.merged && a.commits.is_empty(), "워크트리에 선 rebase 병합 — 덩어리 없이");
    assert_eq!(a.merged_kind, Some(MergeKind::Rebase));
    assert_eq!(g.folds.len(), 1, "짝을 모르는 rebase 는 접힘이 없다");
    let f = &g.folds[0];
    assert_eq!((f.merge.as_str(), f.name.as_deref(), f.kind), (H1, Some("s"), FoldKind::Squash));
    assert_eq!(f.commits, hs(&[S2, S1]));
    assert_eq!(f.base.as_deref(), Some(H2));
    assert!(g.commits.iter().any(|c| c.hash == S1));
    // 창(mainLimit) 밖이면 접힘 없이 숨긴다.
    let g1 = assemble(&raw, 1);
    assert!(g1.folds.iter().any(|f| f.merge == H1 && f.kind == FoldKind::Squash), "H1 은 창 안(첫 줄)");
    let mut raw2 = raw.clone();
    raw2.first_parent = hs(&[H2, H1]);
    assert!(assemble(&raw2, 1).folds.is_empty(), "맞은 커밋이 창 밖");
}

#[test]
fn remote_files_parse() {
    let out = format!(
        "noise\naynx-cfiles\0hash\0{H1}\0parents\01\0cns\0M\0a.ts\0R100\0old.ts\0new.ts\0aynx-end\0cnum\0\
2\t1\ta.ts\00\t0\t\0old.ts\0new.ts\0aynx-end\0"
    );
    let f = parse_remote_commit_files(&out, "1111").unwrap();
    assert_eq!(f.hash, H1);
    assert!(!f.merge);
    assert_eq!(
        f.files
            .iter()
            .map(|x| (x.status.as_str(), x.path.as_str(), x.added))
            .collect::<Vec<_>>(),
        vec![("M", "a.ts", Some(2)), ("R", "new.ts", Some(0))]
    );
    let m =
        parse_remote_commit_files(&format!("aynx-cfiles\0hash\0{H1}\0parents\02\0"), H1).unwrap();
    assert!(m.merge && m.files.is_empty());
    assert!(parse_remote_commit_files("aynx-fail=nocommit\n", H1).is_err());
    assert!(parse_remote_commit_files("garbage", H1).is_err());

    let wip = format!(
        "aynx-wip\0head\0{H2}\0ust\0 M c.ts\0?? n.txt\0aynx-end\0unum\01\t1\tc.ts\0aynx-end\0ulines\03\tn.txt\0aynx-end\0"
    );
    let w = parse_remote_wip(&wip, " /r-wt/a ").unwrap();
    assert_eq!((w.path.as_str(), w.head.as_deref()), ("/r-wt/a", Some(H2)));
    assert_eq!(
        w.files
            .iter()
            .map(|f| (f.status.as_str(), f.added))
            .collect::<Vec<_>>(),
        vec![("M", Some(1)), ("A", Some(3))]
    );
    assert!(parse_remote_wip("aynx-fail=nowt\n", "/x").is_err());
    assert!(parse_remote_wip("aynx-fail=nogit\n", "/x").is_err());
}

#[test]
fn remote_commands_quote_and_stay_read_only() {
    let g = remote_graph_command(" ~/api ", 12).unwrap();
    assert!(g.starts_with("sh -c 'command -v git"), "{g}");
    assert!(g.contains(r#"R="$HOME"/'\''api'\''"#), "{g}");
    assert!(g.contains("--first-parent -n 12 "), "{g}");
    assert!(g.contains(&format!("-n {} ", FIRST_PARENT_READ + 1)), "{g}");
    assert!(g.contains(&format!("--count={}", MAX_BRANCHES + 1)), "{g}");
    assert!(g.contains("--no-optional-locks log"), "{g}");
    assert!(g.contains("--no-optional-locks status"), "{g}");
    assert!(g.contains("--no-ext-diff"), "{g}");
    // 앞선 브랜치마다 내용 판정 재료(squash · rebase) — 셸 함수 `cm` 하나.
    assert!(g.contains(r#"cm "$R" "$M" "$r""#), "{g}");
    assert!(g.contains("patch-id --stable"), "{g}");
    assert!(remote_graph_command("", 12).is_none() && remote_graph_command("/a\nb", 12).is_none());

    let c = remote_commit_files_command("/srv/api", H1).unwrap();
    assert!(c.contains(&format!("H='\\''{H1}'\\''")), "{c}");
    assert!(remote_commit_files_command("/srv/api", "zz; rm -rf /").is_none());
    assert!(remote_commit_files_command("/srv/api", "-x").is_none());

    let w = remote_wip_command("/srv/api", "/srv/it's").unwrap();
    assert!(w.contains(r#"w='\''/srv/it'\''\'\'''\''s'\''"#), "{w}");
    assert!(w.contains("grep -Fxq --"), "{w}");
    assert!(remote_wip_command("/srv/api", "/a\nb").is_none());
    assert!(remote_wip_command("/srv/api", " ").is_none());
    // 읽기 전용 — git 에 쓰는 명령이 없다.
    for s in [&g, &c, &w] {
        for bad in [
            " commit",
            "add ",
            "reset",
            "checkout -",
            "stash",
            "--force",
            "update-index",
            "branch -d",
            "branch -D",
            "gc",
            "merge --",
            "rebase",
        ] {
            assert!(!s.contains(bad), "{bad} in {s}");
        }
    }
}

/// 진짜 git 왕복 — `git` 이 PATH 에 없으면 건너뛴다.
#[test]
fn real_git_commit_graph() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git 이 PATH 에 없어 건너뜀");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "aynx-cg-{}-{:?}",
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
    std::fs::write(repo.join("a.txt"), "1\n2\n3\n").unwrap();
    let c1 = commit(&repo, "init");
    std::fs::write(repo.join("b.txt"), "b\n").unwrap();
    let c2 = commit(&repo, "two");

    // 브랜치 a — c2 에서 갈라진 워크트리, 커밋 둘 + 커밋 안 한 것.
    let wt_a = root.join("wt-a");
    let wt_a_s = wt_a.to_string_lossy().to_string();
    git(&repo, &["worktree", "add", "-q", "-b", "a", &wt_a_s, &c2]);
    std::fs::write(wt_a.join("f.txt"), "f\n").unwrap();
    let a1 = commit(&wt_a, "a1");
    std::fs::write(wt_a.join("a.txt"), "1\nTWO\n3\n4\n").unwrap();
    let a2 = commit(&wt_a, "a2");
    std::fs::write(wt_a.join("f.txt"), "f\nmore\n").unwrap();
    std::fs::create_dir_all(wt_a.join("dir")).unwrap();
    std::fs::write(wt_a.join("dir").join("n.txt"), "n1\nn2\nn3").unwrap();

    // 브랜치 c — main 에 --no-ff 로 병합.
    git(&repo, &["checkout", "-q", "-b", "c"]);
    std::fs::write(repo.join("c.txt"), "c\nc\n").unwrap();
    let cc = commit(&repo, "c work");
    git(&repo, &["checkout", "-q", "main"]);
    std::fs::write(repo.join("m.txt"), "m\n").unwrap();
    let m3 = commit(&repo, "m3");
    git(&repo, &["merge", "-q", "--no-ff", "--no-edit", "c"]);
    let merge = git(&repo, &["rev-parse", "HEAD"]);

    // 브랜치 e — 워크트리에서 커밋 하나, main 이 빨리 감기로 받는다(앞섬 0 · 일한 자국 → 병합됨).
    let wt_e = root.join("wt-e");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "e",
            &wt_e.to_string_lossy(),
            "main",
        ],
    );
    std::fs::write(wt_e.join("e.txt"), "e\n").unwrap();
    let e1 = commit(&wt_e, "e1");
    git(&repo, &["merge", "-q", "--ff-only", "e"]);

    // 브랜치 b — 워크트리 없이 커밋 하나.
    git(&repo, &["checkout", "-q", "-b", "b"]);
    std::fs::write(repo.join("bb.txt"), "x\ny\nz\n").unwrap();
    let b1 = commit(&repo, "b1");
    git(&repo, &["checkout", "-q", "main"]);

    let g = graph_blocking(&repo, 12).unwrap();
    assert_eq!(g.main.as_deref(), Some("main"));
    assert_eq!(g.main_head.as_deref(), Some(e1.as_str()));
    assert_eq!(
        g.main_line
            .iter()
            .map(|r| r.hash.clone())
            .collect::<Vec<_>>(),
        vec![
            e1.clone(),
            merge.clone(),
            m3.clone(),
            c2.clone(),
            c1.clone()
        ]
    );
    assert!(g.main_line.iter().all(|r| r.skipped_before == 0));
    assert!(!g.main_more);
    assert_eq!(g.folds.len(), 1);
    assert_eq!(g.folds[0].merge, merge);
    assert_eq!(g.folds[0].name.as_deref(), Some("c"));
    assert_eq!(g.folds[0].commits, vec![cc.clone()]);
    assert_eq!(g.folds[0].base.as_deref(), Some(c2.as_str()));
    let by: HashMap<&str, &GraphBranch> = g.branches.iter().map(|b| (b.name.as_str(), b)).collect();
    let mut names: Vec<&str> = by.keys().copied().collect();
    names.sort_unstable();
    assert_eq!(names, vec!["a", "b", "e"], "c 는 병합되고 워크트리가 없다");
    assert_eq!(by["a"].commits, vec![a2.clone(), a1.clone()]);
    assert_eq!((by["a"].ahead, by["a"].behind), (2, 4));
    assert_eq!(by["a"].base.as_deref(), Some(c2.as_str()));
    assert!(!by["a"].merged && !by["a"].commits_truncated);
    assert_eq!(by["b"].commits, vec![b1.clone()]);
    assert!(!by["b"].merged);
    assert!(by["e"].merged, "빨리 감기로 들어간 워크트리 브랜치");
    assert!(by["e"].commits.is_empty());
    let commit_of = |h: &str| g.commits.iter().find(|c| c.hash == h).cloned().unwrap();
    assert_eq!(
        (commit_of(&a2).added, commit_of(&a2).deleted),
        (Some(2), Some(1))
    );
    assert_eq!(
        (commit_of(&a1).added, commit_of(&a1).deleted),
        (Some(1), Some(0))
    );
    assert_eq!(commit_of(&merge).added, None, "병합 커밋");
    assert_eq!(commit_of(&cc).added, Some(2));
    assert_eq!(commit_of(&c1).subject, "init");
    let mut seen = HashSet::new();
    assert!(
        g.commits.iter().all(|c| seen.insert(c.hash.clone())),
        "겹침 없음"
    );
    let wa = g
        .worktrees
        .iter()
        .find(|w| w.branch.as_deref() == Some("a"))
        .unwrap();
    assert_eq!(
        wa.dirty,
        Some(Dirty {
            files: 2,
            added: 4,
            deleted: 0
        })
    );
    assert!(g.worktrees[0].primary && g.worktrees[0].dirty.is_none());
    assert!(!g.truncated);

    // 앞 한 줄만 — base(c2) 가 보충되고 사이 둘을 건너뛴다. 접힘은 앞 줄 안의 병합만.
    let g1 = graph_blocking(&repo, 1).unwrap();
    assert_eq!(
        g1.main_line
            .iter()
            .map(|r| (r.hash.clone(), r.skipped_before))
            .collect::<Vec<_>>(),
        vec![(e1.clone(), 0), (c2.clone(), 2)]
    );
    assert!(g1.main_more);
    assert!(g1.folds.is_empty());
    assert!(g1.commits.iter().any(|c| c.hash == c2));

    // 커밋 파일.
    let f = commit_files_blocking(&repo, &a2).unwrap();
    assert!(!f.merge);
    assert_eq!(
        f.files
            .iter()
            .map(|x| (x.status.as_str(), x.path.as_str(), x.added, x.deleted))
            .collect::<Vec<_>>(),
        vec![("M", "a.txt", Some(2), Some(1))]
    );
    let mf = commit_files_blocking(&repo, &merge[..12]).unwrap();
    assert!(mf.merge && mf.files.is_empty());
    assert_eq!(mf.hash, merge);
    let root_files = commit_files_blocking(&repo, &c1).unwrap();
    assert_eq!(root_files.files.len(), 1);
    assert_eq!(root_files.files[0].status, "A");
    assert!(commit_files_blocking(&repo, "zz").is_err());
    assert!(commit_files_blocking(&repo, "abcdef0123").is_err());

    // 커밋 안 한 파일 — git 이 적은 글자 · 이 PC 의 글자 모두.
    let wip = wip_blocking(&repo, &wa.path).unwrap();
    assert_eq!(wip.head.as_deref(), Some(a2.as_str()));
    let u: Vec<(&str, &str, Option<u32>)> = wip
        .files
        .iter()
        .map(|f| (f.status.as_str(), f.path.as_str(), f.added))
        .collect();
    assert!(u.contains(&("M", "f.txt", Some(1))), "{u:?}");
    assert!(u.contains(&("A", "dir/n.txt", Some(3))), "{u:?}");
    assert_eq!(wip_blocking(&repo, &wt_a_s).unwrap().files.len(), 2);
    assert!(wip_blocking(&repo, &root.join("nope").to_string_lossy()).is_err());
    assert!(wip_blocking(&repo, "a\nb").is_err());

    // 새 브랜치 d — 워크트리, 앞섬 0 · 갓 만듦 → 병합 아님.
    let wt_d = root.join("wt-d");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "d",
            &wt_d.to_string_lossy(),
            "main",
        ],
    );
    let g2 = graph_blocking(&repo, 12).unwrap();
    let d = g2.branches.iter().find(|b| b.name == "d").expect("d");
    assert!(!d.merged && d.commits.is_empty() && d.ahead == 0);
    assert_eq!(d.created_from.as_deref(), Some("main"));

    // (2026-10-05) 브랜치 s — 커밋 둘, main 에 squash 병합 → 덩어리 없이 squash 커밋 아래 접힘(kind squash).
    let before_s = git(&repo, &["rev-parse", "HEAD"]);
    git(&repo, &["checkout", "-q", "-b", "s"]);
    std::fs::write(repo.join("s1.txt"), "s1
").unwrap();
    let s1 = commit(&repo, "s1");
    std::fs::write(repo.join("s2.txt"), "s2
").unwrap();
    let s2 = commit(&repo, "s2");
    git(&repo, &["checkout", "-q", "main"]);
    git(&repo, &["merge", "--squash", "-q", "s"]);
    let squash = commit(&repo, "Squash s");
    let g3 = graph_blocking(&repo, 12).unwrap();
    assert!(g3.branches.iter().all(|b| b.name != "s"), "워크트리 없는 squash 병합 브랜치는 싣지 않는다");
    let f = g3.folds.iter().find(|f| f.merge == squash).expect("squash 접힘");
    assert_eq!(f.kind, FoldKind::Squash);
    assert_eq!(f.name.as_deref(), Some("s"));
    assert_eq!(f.commits, vec![s2.clone(), s1.clone()]);
    assert_eq!(f.base.as_deref(), Some(before_s.as_str()));
    assert!(g3.commits.iter().any(|c| c.hash == s1), "접힌 커밋도 표에 있다");
    assert_eq!(g3.folds.iter().find(|f| f.merge == merge).map(|f| f.kind), Some(FoldKind::Merge));
    let a = g3.branches.iter().find(|b| b.name == "a").expect("a");
    assert!(!a.merged && a.merged_kind.is_none() && !a.commits.is_empty(), "병합 안 한 브랜치는 그대로");
    let e = g3.branches.iter().find(|b| b.name == "e").expect("e");
    assert_eq!(e.merged_kind, Some(MergeKind::Ancestry));
    // 읽기만 했다 — index.lock 이 남지 않았다.
    assert!(!repo.join(".git").join("index.lock").exists());
    let _ = std::fs::remove_dir_all(&root);
}
