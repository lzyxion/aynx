use super::*;
use std::process::Command;

const LIST: &str = "worktree /home/me/api\n\
HEAD 1111111111111111111111111111111111111111\n\
branch refs/heads/main\n\
\n\
worktree /home/me/api-wt/feat-x\n\
HEAD 2222222222222222222222222222222222222222\n\
branch refs/heads/feat-x\n\
\n\
worktree /home/me/api-wt/probe\n\
HEAD 3333333333333333333333333333333333333333\n\
detached\n\
\n";

fn facts() -> Facts {
    facts_of(
        LIST,
        "refs/heads/feat-x\r\nrefs/heads/feat/old\nrefs/heads/main\nrefs/heads/spare\nrefs/tags/v1\n\
         refs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/remotes/origin/feat-y\n\
         refs/remotes/origin/dup\nrefs/remotes/up/dup\nrefs/remotes/origin/spare\n\n",
    )
}

#[test]
fn refs_split_local_and_remote_tracking() {
    let f = facts();
    assert_eq!(f.branches, vec!["feat-x", "feat/old", "main", "spare"]);
    assert_eq!(
        f.remotes,
        vec!["origin/main", "origin/feat-y", "origin/dup", "up/dup", "origin/spare"],
        "origin/HEAD 는 버린다"
    );
    assert_eq!(parse_refs(""), (vec![], vec![]));
}

#[test]
fn add_plan_table() {
    let f = facts();
    // a. 로컬 브랜치가 있으면 그것 — 같은 이름의 원격 추적이 있어도 로컬이 먼저
    assert_eq!(plan_add("spare", &f), Ok(AddPlan::Existing));
    assert_eq!(plan_add("feat/old", &f), Ok(AddPlan::Existing));
    // b. 원격 추적이 딱 하나
    assert_eq!(
        plan_add("feat-y", &f),
        Ok(AddPlan::Track("origin/feat-y".into()))
    );
    // b'. 원격 둘 이상 — 거절(두 이름이 다 실린다)
    let amb = plan_add("dup", &f).unwrap_err();
    assert!(amb.contains("origin/dup") && amb.contains("up/dup"), "{amb}");
    // c. 둘 다 없으면 주 브랜치에서 새로
    assert_eq!(
        plan_add("brand-new", &f),
        Ok(AddPlan::New(Some("main".into())))
    );
    // c'. 주 브랜치를 모르면 시작점 없이
    let mut g = f.clone();
    g.worktrees[0].branch = None;
    assert_eq!(plan_add("brand-new", &g), Ok(AddPlan::New(None)));
    assert!(AddPlan::Track("o/x".into()).creates_branch());
    assert!(AddPlan::New(None).creates_branch());
    assert!(!AddPlan::Existing.creates_branch());
}

#[test]
fn add_args_per_plan() {
    assert_eq!(
        add_args("/w/x", "x", &AddPlan::Existing),
        vec!["worktree", "add", "/w/x", "x"]
    );
    assert_eq!(
        add_args("/w/x", "x", &AddPlan::Track("origin/x".into())),
        vec!["worktree", "add", "--track", "-b", "x", "/w/x", "origin/x"]
    );
    assert_eq!(
        add_args("/w/x", "x", &AddPlan::New(Some("main".into()))),
        vec!["worktree", "add", "-b", "x", "/w/x", "main"]
    );
    assert_eq!(
        add_args("/w/x", "x", &AddPlan::New(None)),
        vec!["worktree", "add", "-b", "x", "/w/x"]
    );
}

#[test]
fn remote_add_tail_quotes_each_plan() {
    let d = "\"$HOME\"/'w/x'";
    assert_eq!(
        remote_add_tail(d, "x", &AddPlan::Existing).unwrap(),
        "worktree add \"$HOME\"/'w/x' 'x'"
    );
    assert_eq!(
        remote_add_tail(d, "x", &AddPlan::Track("origin/x".into())).unwrap(),
        "worktree add --track -b 'x' \"$HOME\"/'w/x' 'origin/x'"
    );
    assert_eq!(
        remote_add_tail(d, "x", &AddPlan::New(Some("main".into()))).unwrap(),
        "worktree add -b 'x' \"$HOME\"/'w/x' 'main'"
    );
    assert_eq!(
        remote_add_tail(d, "x", &AddPlan::New(None)).unwrap(),
        "worktree add -b 'x' \"$HOME\"/'w/x'"
    );
    assert!(remote_add_tail(d, "-x", &AddPlan::Existing).is_none());
    assert!(remote_add_tail(d, "x", &AddPlan::Track("-o/x".into())).is_none());
}

#[test]
fn preview_carries_names_main_and_checked_out() {
    let p = preview_of(&facts());
    assert_eq!(p.main.as_deref(), Some("main"));
    assert_eq!(p.local.len(), 4);
    assert_eq!(p.remote.len(), 5);
    assert_eq!(p.checked_out, vec!["main", "feat-x"]);
}

#[test]
fn checked_out_comes_from_porcelain_branch_lines() {
    assert_eq!(checked_out(&parse_porcelain(LIST)), vec!["main", "feat-x"]);
}

#[test]
fn deletable_excludes_checked_out_and_main() {
    let f = facts();
    assert_eq!(deletable(&f), vec!["feat/old", "spare"]);
    // 주 폴더가 분리된 HEAD 면 주 브랜치를 모른다 — main 도 체크아웃돼 있지 않으니 후보에 든다.
    let mut g = f.clone();
    g.worktrees[0].branch = None;
    assert_eq!(deletable(&g), vec!["feat/old", "main", "spare"]);
    // 주 브랜치는 늘 빠진다.
    let mut h = f;
    h.worktrees[0].branch = Some("spare".into());
    assert_eq!(deletable(&h), vec!["feat/old", "main"]);
}

#[test]
fn delete_checks_and_choices() {
    let f = facts();
    assert_eq!(check_delete(&f, "feat/old"), Ok("feat/old".into()));
    assert!(check_delete(&f, "main").is_err());
    assert!(check_delete(&f, "feat-x").is_err());
    assert!(check_delete(&f, "nope").is_err());
    assert_eq!(choices_of(&f).deletable, vec!["feat/old", "spare"]);
}

#[test]
fn remote_commands_quote_and_never_force() {
    assert_eq!(
        remote_refs_command("~/api").unwrap(),
        "git -C \"$HOME\"/'api' for-each-ref '--format=%(refname)' refs/heads refs/remotes"
    );
    assert_eq!(
        remote_delete_command("/srv/it's", "o'k").unwrap(),
        "git -C '/srv/it'\\''s' branch -d 'o'\\''k'"
    );
    // 막는 것 — 개행 · 옵션처럼 읽히는 이름 · 빈 것
    assert!(remote_refs_command("/a\nrm -rf /").is_none());
    assert!(remote_delete_command("/a", "--force").is_none());
    assert!(remote_delete_command("/a", "x\ny").is_none());
    assert!(remote_delete_command("", "x").is_none());
    let c = remote_delete_command("/a", "b").unwrap();
    assert!(
        !c.contains(" -D") && !c.contains("--force") && !c.contains(" -f "),
        "{c}"
    );
}

#[test]
fn real_git_branch_delete_when_available() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git 이 PATH 에 없어 건너뜀");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "aynx-wtb-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let git = |dir: &Path, args: &[&str]| run_git(dir, args, GIT_TIMEOUT).unwrap();
    let with_id = |dir: &Path, rest: &[&str]| {
        let mut a = vec!["-c", "user.name=t", "-c", "user.email=t@t"];
        a.extend_from_slice(rest);
        git(dir, &a).ok
    };
    let has_branch = |b: &str| {
        git(
            &repo,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{b}"),
            ],
        )
        .ok
    };
    assert!(git(&repo, &["init", "-q", "-b", "main"]).ok);
    std::fs::write(repo.join("f.txt"), "x").unwrap();
    assert!(git(&repo, &["add", "."]).ok);
    assert!(with_id(&repo, &["commit", "-q", "-m", "i"]));
    let wt = root.join("wt");
    let wt_s = wt.to_string_lossy().into_owned();
    assert!(git(&repo, &["worktree", "add", "-q", "-b", "busy", &wt_s]).ok);
    // merged = main 과 같은 자리 · unmerged = main 에 없는 커밋 하나
    assert!(git(&repo, &["branch", "merged"]).ok);
    assert!(git(&repo, &["branch", "unmerged"]).ok);
    std::fs::write(wt.join("f.txt"), "b").unwrap();
    assert!(with_id(&wt, &["commit", "-q", "-am", "b"]));
    assert!(git(&wt, &["branch", "-f", "unmerged", "HEAD"]).ok);

    assert_eq!(
        choices_blocking(&repo).unwrap().deletable,
        vec!["merged", "unmerged"]
    );
    // 병합된 것은 지운다. 병합되지 않은 것은 git 이 거절하고 남는다(-D 없음).
    assert_eq!(delete_blocking(&repo, "merged"), Ok("merged".into()));
    assert!(!has_branch("merged"));
    let refused = delete_blocking(&repo, "unmerged").unwrap_err();
    assert!(!refused.is_empty() && !refused.contains('\n'), "{refused}");
    assert!(has_branch("unmerged"));
    assert!(delete_blocking(&repo, "main").is_err(), "주 브랜치");
    assert!(delete_blocking(&repo, "busy").is_err(), "체크아웃된 것");

    let _ = std::fs::remove_dir_all(&root);
}
