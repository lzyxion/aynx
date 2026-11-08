use super::*;
use std::path::PathBuf;

const H1: &str = "1111111111111111111111111111111111111111";
const H2: &str = "2222222222222222222222222222222222222222";
const P1: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const P2: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const P3: &str = "cccccccccccccccccccccccccccccccccccccccc";
const ZERO: &str = "0000000000000000000000000000000000000000";

#[test]
fn parse_patch_ids_and_cherry() {
    let text = format!("{P1} {H1}\r\n{P2} {H2}\nnoise\n{P3}\nzz {H1}\n");
    assert_eq!(
        parse_patch_ids(&text),
        vec![
            (P1.to_string(), H1.to_string()),
            (P2.to_string(), H2.to_string())
        ]
    );
    // `git diff | git patch-id` 은 커밋 자리가 0 이다 — 첫 id 만 본다.
    assert_eq!(
        first_patch_id(&format!("{P3} {ZERO}\n")),
        Some(P3.to_string())
    );
    assert_eq!(first_patch_id(""), None, "빈 변경 = patch-id 없음");

    assert_eq!(parse_cherry(""), (0, 0));
    assert_eq!(parse_cherry(&format!("- {H1}\n- {H2}\r\n")), (0, 2));
    assert_eq!(
        parse_cherry(&format!("+ {H1}\n- {H2}\nwarning: x\n")),
        (1, 1)
    );
}

#[test]
fn judge_table() {
    let mains = vec![
        (P1.to_string(), H1.to_string()),
        (P2.to_string(), H2.to_string()),
    ];
    let facts = |sq: Option<&str>, tip: Option<&str>, cherry: Option<(u32, u32)>| ContentFacts {
        squash_id: sq.map(str::to_string),
        tip_id: tip.map(str::to_string),
        main_ids: mains.clone(),
        cherry,
    };
    // (c) squash — 변경 전체의 patch-id 가 main 커밋 하나와 같다 → 그 커밋.
    assert_eq!(
        judge(&facts(Some(P2), Some(P3), Some((3, 0)))),
        Some(ContentMerge {
            kind: MergeKind::Squash,
            commit: Some(H2.into())
        })
    );
    // (b) rebase — cherry 가 모두 `-` → 끝 커밋 patch-id 의 짝.
    assert_eq!(
        judge(&facts(Some(P3), Some(P1), Some((0, 3)))),
        Some(ContentMerge {
            kind: MergeKind::Rebase,
            commit: Some(H1.into())
        })
    );
    // rebase 인데 짝이 창 밖 — 병합됨은 그대로, 짝 없음.
    assert_eq!(
        judge(&facts(None, Some(P3), Some((0, 2)))),
        Some(ContentMerge {
            kind: MergeKind::Rebase,
            commit: None
        })
    );
    // 커밋 하나짜리는 둘 다 맞는다 — squash 가 먼저.
    assert_eq!(
        judge(&facts(Some(P1), Some(P1), Some((0, 1)))).map(|c| c.kind),
        Some(MergeKind::Squash)
    );
    // 하나라도 `+` 면 rebase 아님 · squash id 가 없으면 squash 아님.
    assert_eq!(judge(&facts(Some(P3), Some(P3), Some((1, 2)))), None);
    // 빈 변경(갓 만든 브랜치) — patch-id 없음 · cherry 빔 → 절대 병합됨 아님.
    assert_eq!(judge(&facts(None, None, Some((0, 0)))), None);
    assert_eq!(judge(&facts(None, None, None)), None);
    assert_eq!(judge(&ContentFacts::default()), None);
}

#[test]
fn absorb_remote_lines() {
    let mut slot = None;
    assert!(!absorb_line(&mut slot, "branch=x"));
    assert_eq!(slot, None, "재료 줄이 아니면 열지 않는다");
    for l in [
        format!("aynx-cm-sq={P1}\r"),
        "aynx-cm-tip=".to_string(),
        format!("aynx-cm-main={P1} {H1}"),
        "aynx-cm-main=junk".to_string(),
        "aynx-cm-cherry=2 0".to_string(),
    ] {
        assert!(absorb_line(&mut slot, &l), "{l}");
    }
    let f = slot.unwrap();
    assert_eq!(f.squash_id.as_deref(), Some(P1));
    assert_eq!(f.tip_id, None, "빈 값은 없음");
    assert_eq!(f.main_ids, vec![(P1.to_string(), H1.to_string())]);
    assert_eq!(f.cherry, Some((2, 0)));
    assert_eq!(judge(&f).map(|c| c.commit), Some(Some(H1.to_string())));
}

#[test]
fn verified_delete_decision_table() {
    let v = |kind: MergeKind, head: &str| Verdict {
        merge: ContentMerge { kind, commit: None },
        head: head.to_string(),
    };
    let sq = v(MergeKind::Squash, H1);
    let rb = v(MergeKind::Rebase, H2);
    let anc = v(MergeKind::Ancestry, H1);
    let bad = v(MergeKind::Squash, "not-a-hash");
    // 확인됨 + 체크아웃 안 됨 → 그 커밋으로(compare-and-swap 값).
    assert_eq!(verified_target(Some(&sq), false), Some(H1));
    assert_eq!(verified_target(Some(&rb), false), Some(H2));
    // 체크아웃돼 있으면 · 판정 없음(병합 안 됨) · 조상 병합(그건 `-d` 의 몫) · 해시가 이상하면 → 남긴다.
    assert_eq!(verified_target(Some(&sq), true), None);
    assert_eq!(verified_target(None, false), None);
    assert_eq!(verified_target(Some(&anc), false), None);
    assert_eq!(verified_target(Some(&bad), false), None);
}

#[test]
fn remote_commands_quote_and_stay_narrow() {
    let c = remote_judge_command(" ~/api ", "feat/it's").unwrap();
    assert!(c.starts_with("sh -c 'command -v git"), "{c}");
    assert!(c.contains(r#"R="$HOME"/'\''api'\''"#), "{c}");
    assert!(
        c.contains(r#"B='\''refs/heads/feat/it'\''\'\'''\''s'\''"#),
        "{c}"
    );
    assert!(c.contains("patch-id --stable"), "{c}");
    assert!(c.contains(r#"cm "$R" "refs/heads/$main" "$H""#), "{c}");
    // 판정 스크립트는 읽기만 — 쓰는 명령이 없다.
    for bad in [
        "update-ref",
        "branch -D",
        "branch -d",
        "--force",
        "commit-tree",
        "reset",
        "config",
    ] {
        assert!(!c.contains(bad), "{bad} in {c}");
    }
    assert_eq!(remote_judge_command("", "x"), None);
    assert_eq!(
        remote_judge_command("/r", "-x"),
        None,
        "옵션으로 읽히는 이름"
    );
    assert_eq!(remote_judge_command("/r", "a\nb"), None);

    let d = remote_verified_delete_command("/srv/app", "feat-x", H1).unwrap();
    assert_eq!(
        d,
        format!(
            "git -C '/srv/app' update-ref -d 'refs/heads/feat-x' {H1} && {{ git -C '/srv/app' config --remove-section 'branch.feat-x' >/dev/null 2>&1; true; }}"
        )
    );
    assert!(!d.contains("-D") && !d.contains("--force"));
    assert_eq!(
        remote_verified_delete_command("/srv/app", "feat-x", "HEAD"),
        None,
        "해시만"
    );
    assert_eq!(remote_verified_delete_command("/srv/app", "-x", H1), None);

    let j = parse_remote_judge(&format!(
        "motd\naynx-busy=1\naynx-main=main\naynx-head={H2}\naynx-cm-sq={P1}\naynx-cm-main={P1} {H1}\naynx-cm-cherry=3 0\n"
    ))
    .unwrap();
    assert!(j.busy);
    assert_eq!(j.main.as_deref(), Some("main"));
    let v = remote_verdict(&j, "feat-x").unwrap();
    assert_eq!((v.merge.kind, v.head.as_str()), (MergeKind::Squash, H2));
    assert_eq!(
        verified_target(Some(&v), j.busy),
        None,
        "체크아웃돼 있으면 남긴다"
    );
    assert_eq!(remote_verdict(&j, "main"), None, "주 브랜치");
    assert!(parse_remote_judge("aynx-fail=nogit\n").is_err());
}

// ---------------------------------------------------------------------------
// 진짜 git
// ---------------------------------------------------------------------------

struct Repo {
    root: PathBuf,
    dir: PathBuf,
}

impl Repo {
    fn new(tag: &str) -> Option<Repo> {
        if Command::new("git").arg("--version").output().is_err() {
            eprintln!("git 이 PATH 에 없어 건너뜀");
            return None;
        }
        let root = std::env::temp_dir().join(format!(
            "aynx-md-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("repo");
        std::fs::create_dir_all(&dir).unwrap();
        let r = Repo { root, dir };
        r.ok(&["init", "-q", "-b", "main"]);
        r.write("base.txt", "base\n");
        r.commit("init");
        Some(r)
    }
    fn git(&self, args: &[&str]) -> crate::worktree::GitRun {
        let mut all = vec![
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ];
        all.extend_from_slice(args);
        run_git(&self.dir, &all, GIT_TIMEOUT).unwrap()
    }
    fn ok(&self, args: &[&str]) -> String {
        let r = self.git(args);
        assert!(r.ok, "{args:?}: {}", r.stderr);
        r.stdout.trim().to_string()
    }
    fn write(&self, f: &str, text: &str) {
        std::fs::write(self.dir.join(f), text).unwrap();
    }
    fn commit(&self, msg: &str) -> String {
        self.ok(&["add", "-A"]);
        self.ok(&["commit", "-q", "-m", msg]);
        self.ok(&["rev-parse", "HEAD"])
    }
    fn has(&self, b: &str) -> bool {
        self.git(&[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{b}"),
        ])
        .ok
    }
    /// main 에서 갈라진 브랜치에 파일마다 커밋 하나씩 — 끝나면 main 으로 돌아온다.
    fn branch_with(&self, name: &str, files: &[(&str, &str)]) -> Vec<String> {
        self.ok(&["switch", "-q", "-c", name, "main"]);
        let out = files
            .iter()
            .map(|(f, t)| {
                self.write(f, t);
                self.commit(&format!("{name} {f}"))
            })
            .collect();
        self.ok(&["switch", "-q", "main"]);
        out
    }
}

impl Drop for Repo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// squash 3커밋 → (c) · rebase 3커밋 → (b) · squash 뒤 커밋 하나 더 → 아님 · 갓 만든 브랜치 · 병합 안 한 브랜치 → 아님.
/// 판정은 읽기만 한다(객체 · 참조가 그대로). 그리고 확인된 삭제: squash 병합은 `-d` 가 거절해도 지워지고, 병합 안 된 것 ·
/// 체크아웃된 것은 남는다.
#[test]
fn real_git_squash_and_rebase_merges() {
    let Some(r) = Repo::new("judge") else { return };
    // 브랜치들 — 모두 같은 main 에서.
    r.branch_with(
        "sq",
        &[
            ("s1.txt", "one\n"),
            ("s2.txt", "two\n"),
            ("s1.txt", "one\nmore\n"),
        ],
    );
    let rb = r.branch_with(
        "rb",
        &[("r1.txt", "r1\n"), ("r2.txt", "r2\n"), ("r3.txt", "r3\n")],
    );
    r.branch_with(
        "sqx",
        &[("x1.txt", "x1\n"), ("x2.txt", "x2\n"), ("x3.txt", "x3\n")],
    );
    r.branch_with("open", &[("o1.txt", "o\n")]);
    // main 이 앞으로 간다(관계없는 파일).
    r.write("main.txt", "m\n");
    r.commit("main moves");
    r.ok(&["branch", "fresh"]);

    // 갓 만든 브랜치 — main 이 그대로라 문에서 끝난다(재료 없음).
    assert_eq!(judge_branch_local(&r.dir, "main", "fresh"), None);
    assert_eq!(
        local_facts(&r.dir, "refs/heads/main", "refs/heads/fresh"),
        None
    );

    // squash 병합.
    r.ok(&["merge", "--squash", "-q", "sq"]);
    let squash_commit = r.commit("Squash sq");
    // rebase 병합(= main 위에 커밋을 하나씩 다시 얹기).
    for h in &rb {
        r.ok(&["cherry-pick", h]);
    }
    let rebased_tip = r.ok(&["rev-parse", "HEAD"]);
    // squash 병합한 뒤 그 브랜치에 커밋 하나 더.
    r.ok(&["merge", "--squash", "-q", "sqx"]);
    r.commit("Squash sqx");
    r.ok(&["switch", "-q", "sqx"]);
    r.write("x4.txt", "x4\n");
    r.commit("after squash");
    r.ok(&["switch", "-q", "main"]);

    let objects_before = r.ok(&["count-objects"]);
    let refs_before = r.ok(&["for-each-ref"]);

    let v = judge_branch_local(&r.dir, "main", "sq").expect("sq squash");
    assert_eq!(
        v.merge,
        ContentMerge {
            kind: MergeKind::Squash,
            commit: Some(squash_commit.clone())
        }
    );
    assert_eq!(v.head, r.ok(&["rev-parse", "refs/heads/sq"]));
    let v = judge_branch_local(&r.dir, "main", "rb").expect("rb rebase");
    assert_eq!(
        v.merge,
        ContentMerge {
            kind: MergeKind::Rebase,
            commit: Some(rebased_tip)
        }
    );
    assert_eq!(
        judge_branch_local(&r.dir, "main", "sqx"),
        None,
        "squash 뒤 커밋이 더 있다"
    );
    assert_eq!(
        judge_branch_local(&r.dir, "main", "open"),
        None,
        "병합 안 함"
    );
    assert_eq!(
        judge_branch_local(&r.dir, "main", "fresh"),
        None,
        "갓 만든 브랜치(main 이 움직인 뒤에도)"
    );
    assert_eq!(judge_branch_local(&r.dir, "main", "main"), None);
    // 독 칩 · 제거의 문과 같은 판정.
    assert!(crate::worktree_changes::branch_merged_blocking(
        &r.dir,
        "sq",
        Some("main")
    ));
    assert!(crate::worktree_changes::branch_merged_blocking(
        &r.dir,
        "rb",
        Some("main")
    ));
    assert!(!crate::worktree_changes::branch_merged_blocking(
        &r.dir,
        "open",
        Some("main")
    ));
    assert!(!crate::worktree_changes::branch_merged_blocking(
        &r.dir,
        "fresh",
        Some("main")
    ));
    // 읽기 전용 — 객체도 참조도 그대로.
    assert_eq!(r.ok(&["count-objects"]), objects_before);
    assert_eq!(r.ok(&["for-each-ref"]), refs_before);

    // 확인된 삭제 — `-d` 는 squash 병합 브랜치를 거절한다.
    assert!(!r.git(&["branch", "-d", "sq"]).ok);
    r.ok(&["config", "branch.sq.note", "x"]);
    assert_eq!(
        delete_verified_local(&r.dir, "sq").unwrap(),
        Some(MergeKind::Squash)
    );
    assert!(!r.has("sq"));
    assert!(
        !r.git(&["config", "--get", "branch.sq.note"]).ok,
        "branch.<이름> 설정도 걷힌다"
    );
    // 병합 안 된 것 · squash 뒤 커밋이 더 있는 것은 남는다.
    assert_eq!(delete_verified_local(&r.dir, "open").unwrap(), None);
    assert_eq!(delete_verified_local(&r.dir, "sqx").unwrap(), None);
    assert!(r.has("open") && r.has("sqx"));
    // 체크아웃된 브랜치는 병합됐어도 남는다.
    let wt = r.root.join("rb-wt");
    r.ok(&["worktree", "add", "-q", &wt.to_string_lossy(), "rb"]);
    assert_eq!(delete_verified_local(&r.dir, "rb").unwrap(), None);
    assert!(r.has("rb"));
    r.ok(&["worktree", "remove", &wt.to_string_lossy()]);
    assert_eq!(
        delete_verified_local(&r.dir, "rb").unwrap(),
        Some(MergeKind::Rebase)
    );
    assert!(!r.has("rb"));
}

/// 원격 스크립트를 이 PC 의 `sh` 로 돌려 로컬과 같은 답인지 — `sh` 가 없으면 건너뛴다(Windows 에서는 Git Bash).
#[test]
fn real_sh_remote_judge_matches_local() {
    if Command::new("sh").arg("-c").arg("exit 0").output().is_err() {
        eprintln!("sh 가 없어 건너뜀");
        return;
    }
    let Some(r) = Repo::new("sh") else { return };
    r.branch_with("sq", &[("a.txt", "a\n"), ("b.txt", "b\n")]);
    r.branch_with("open", &[("o.txt", "o\n")]);
    r.write("m.txt", "m\n");
    r.commit("main moves");
    r.ok(&["merge", "--squash", "-q", "sq"]);
    let squash_commit = r.commit("Squash sq");
    let repo = r.dir.to_string_lossy().replace('\\', "/");
    let run = |branch: &str| {
        let cmd = remote_judge_command(&repo, branch).unwrap();
        let out = Command::new("sh").arg("-c").arg(&cmd).output().unwrap();
        parse_remote_judge(&String::from_utf8_lossy(&out.stdout)).unwrap()
    };
    let j = run("sq");
    assert!(!j.busy);
    assert_eq!(j.main.as_deref(), Some("main"));
    let v = remote_verdict(&j, "sq").expect("원격도 squash");
    assert_eq!(
        v.merge,
        ContentMerge {
            kind: MergeKind::Squash,
            commit: Some(squash_commit)
        }
    );
    assert_eq!(Some(v), judge_branch_local(&r.dir, "main", "sq"));
    assert_eq!(remote_verdict(&run("open"), "open"), None);
    assert!(run("main").busy, "주 폴더에 체크아웃됨");
}

/// 독 배지 · 커밋 그래프의 원격 스크립트도 `cm` 을 실어 같은 답 — `sh` 가 없으면 건너뛴다. Windows(Git Bash)에서는
/// 원격 절대 자리 규칙(`/`·`~`)에 맞춰 `C:/x` 를 `/c/x` 로 넘긴다(MSYS 가 git 인자로 되돌린다).
#[test]
fn real_sh_remote_badge_and_graph_scripts() {
    if Command::new("sh").arg("-c").arg("exit 0").output().is_err() {
        eprintln!("sh 가 없어 건너뜀");
        return;
    }
    let Some(r) = Repo::new("shbg") else { return };
    r.branch_with("sq", &[("a.txt", "a\n"), ("b.txt", "b\n")]);
    r.write("m.txt", "m\n");
    r.commit("main moves");
    r.ok(&["merge", "--squash", "-q", "sq"]);
    let squash_commit = r.commit("Squash sq");
    let wt = r.root.join("sq-wt");
    r.ok(&["worktree", "add", "-q", &wt.to_string_lossy(), "sq"]);
    let posix = |p: &Path| {
        let s = p.to_string_lossy().replace('\\', "/");
        match s.as_bytes() {
            [d, b':', b'/', ..] if cfg!(windows) => {
                format!("/{}{}", (*d as char).to_ascii_lowercase(), &s[2..])
            }
            _ => s,
        }
    };
    let sh = |cmd: &str| {
        let out = Command::new("sh").arg("-c").arg(cmd).output().unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    let repo = posix(&r.dir);
    let paths = vec![posix(&wt)];
    let badge = crate::worktree_changes::remote_changes_command(&repo, &paths).unwrap();
    let blocks = crate::worktree_changes::parse_remote_changes(&sh(&badge)).unwrap();
    let got = crate::worktree_changes::resolve_remote(&paths, &blocks);
    assert_eq!(got.len(), 1, "{blocks:?}");
    assert_eq!(
        (got[0].ahead, got[0].merged, got[0].merged_kind),
        (Some(2), true, Some(MergeKind::Squash))
    );

    let graph = crate::commit_graph::remote_graph_command(&repo, 12).unwrap();
    let g = crate::commit_graph::assemble(
        &crate::commit_graph::parse_remote_graph(&sh(&graph)).unwrap(),
        12,
    );
    let f = g
        .folds
        .iter()
        .find(|f| f.merge == squash_commit)
        .expect("squash 접힘");
    assert_eq!(
        (f.name.as_deref(), f.kind, f.commits.len()),
        (Some("sq"), crate::commit_graph::FoldKind::Squash, 2)
    );
    let b = g
        .branches
        .iter()
        .find(|b| b.name == "sq")
        .expect("워크트리에 선 브랜치는 남는다");
    assert!(b.merged && b.commits.is_empty());
}
