//! 앨범 병합 시험(`album_merge.rs`) — 진짜 임시 git 저장소 · 진짜 worktree(6단계 시험의 틀을 함께 쓴다). 작업자는 띄우지 않는다.

#![cfg(windows)]

use serde_json::{json, Value};

use super::album_merge::auto_merge_blocker;
use super::model::*;
use super::store::*;
use super::tests_stage6::*;

const CMD: &str = "exit 0";

/// 통합 하나를 쌓은 앨범(아직 완료 전). `cmd` = 앨범의 검증 명령.
fn album(h: &H, cmd: Option<&str>) -> (String, Caller) {
    let (run, c) = start(h, cmd, &[]);
    one_integrated(h, &run, &c, "a");
    (run, c)
}

/// 완료(내보냄)까지 간 앨범 — 사람 병합의 출발점.
fn done_album(h: &H) -> String {
    let (run, _c) = album(h, None);
    h.o.complete_run(&run).unwrap();
    run
}

fn edit(h: &H, run: &str, f: impl FnOnce(&mut Run)) {
    f(&mut h.o.lock().runs.get_mut(run).unwrap().run);
}

fn turn_on(h: &H, run: &str) {
    edit(h, run, |r| r.album.as_mut().unwrap().auto_merge = true);
}

fn main_tip(h: &H) -> String {
    rev(&h.repo, "refs/heads/main").unwrap()
}

/// 창이 본 값 그대로 [병합].
fn merge(h: &H, run: &str) -> Value {
    let head = run_of(&h.o, run).integration.unwrap().exported_head.unwrap();
    h.o.merge_album(run, &head, "main").unwrap()
}

fn actions(h: &H, run: &str, action: &str) -> Vec<LogEntry> {
    run_of(&h.o, run).log.into_iter().filter(|e| e.action == action).collect()
}

fn no_merge_state(h: &H) {
    assert_eq!(git_out(&h.repo, &["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).0, 1, "진행 중인 병합이 남지 않는다");
}

#[test]
fn clean_merge_makes_a_no_ff_commit_runs_no_hooks_and_pushes_nothing() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-clean");
    let run = done_album(&h);
    let before = main_tip(&h);
    // 원격이 있어도 push 하지 않는다.
    let bare = h.root.join("origin.git");
    git(&h.root, &["init", "-q", "--bare", &bare.to_string_lossy()]);
    git(&h.repo, &["remote", "add", "origin", &bare.to_string_lossy()]);
    git(&h.repo, &["push", "-q", "origin", "main"]);
    // 사용자 훅은 돌지 않는다(공용 실행기의 빈 훅 폴더).
    let marker = h.root.join("hook-ran");
    let hook = format!("#!/bin/sh\necho x > '{}'\n", marker.to_string_lossy().replace('\\', "/"));
    for name in ["pre-merge-commit", "post-merge"] {
        std::fs::write(h.repo.join(".git/hooks").join(name), &hook).unwrap();
    }

    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!(p["state"], "ready", "{p}");
    assert_eq!(p["target"], "main");
    assert_eq!((p["commits"].as_u64(), p["files"].as_u64(), p["additions"].as_u64()), (Some(1), Some(1), Some(1)));
    assert_eq!(main_tip(&h), before, "검사는 저장소를 바꾸지 않는다");

    let integ = run_of(&h.o, &run).integration.unwrap();
    let head = integ.exported_head.clone().unwrap();
    let v = merge(&h, &run);
    assert_eq!(v["merged"], true, "{v}");
    let tip = main_tip(&h);
    assert_eq!(v["commit"], tip.as_str());
    assert_eq!(rev(&h.repo, "main^1").unwrap(), before, "대상 브랜치가 첫 부모");
    assert_eq!(rev(&h.repo, "main^2").unwrap(), head, "--no-ff — 내보낸 머리가 둘째 부모");
    assert!(git(&h.repo, &["log", "-1", "--format=%s", "main"]).starts_with(&format!("Merge branch '{}'", integ.export_branch)));
    assert!(h.repo.join("a.txt").exists(), "작업 폴더도 옮겨 갔다");
    assert_eq!(git(&h.repo, &["status", "--porcelain"]), "");
    assert!(!marker.exists(), "훅이 돌지 않았다");
    assert_eq!(rev(&h.repo, "refs/remotes/origin/main").unwrap(), before, "push 없음");
    assert_eq!(git(&bare, &["rev-parse", "refs/heads/main"]), before, "push 없음");
    // 장부 · Run 칸.
    let m = run_of(&h.o, &run).merge.unwrap().merged.unwrap();
    assert_eq!((m.commit.as_str(), m.head.as_str(), m.target.as_str(), m.by), (tip.as_str(), head.as_str(), "main", Actor::Human));
    let e = actions(&h, &run, "integration_merged");
    assert_eq!(e.len(), 1);
    assert_eq!((e[0].actor, e[0].target.as_deref(), e[0].outcome.as_str()), (Actor::Human, Some("main"), &tip[..7]));
    assert!(audit_events(&h).iter().any(|(ev, _)| ev == "integration_merged"));
    // 다시 눌러도 그대로.
    assert_eq!(merge(&h, &run)["already"], true);
    assert_eq!(main_tip(&h), tip);
    assert_eq!(h.o.merge_preview(&run).unwrap()["state"], "merged");
}

#[test]
fn dirty_tree_refuses_tracked_and_paths_the_merge_would_overwrite() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-dirty");
    let run = done_album(&h);
    let before = main_tip(&h);
    // 병합과 무관한 미추적 파일은 막지 않는다.
    std::fs::write(h.repo.join("unrelated.txt"), "keep\n").unwrap();
    assert_eq!(h.o.merge_preview(&run).unwrap()["state"], "ready");
    // 추적 파일의 변경.
    std::fs::write(h.repo.join("f.txt"), "changed\n").unwrap();
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["state"].as_str(), p["dirty"]["count"].as_u64()), (Some("blocked"), Some(1)));
    assert_eq!(p["dirty"]["paths"][0], "f.txt");
    let v = merge(&h, &run);
    assert_eq!((v["merged"].as_bool(), v["reason"].as_str()), (Some(false), Some("dirty")), "{v}");
    assert_eq!(main_tip(&h), before);
    git(&h.repo, &["checkout", "--", "f.txt"]);
    // 병합이 놓을 자리의 미추적 파일 · 무시 파일(git 은 무시 파일을 조용히 덮는다).
    std::fs::write(h.repo.join("a.txt"), "mine\n").unwrap();
    assert_eq!(h.o.merge_preview(&run).unwrap()["dirty"]["paths"][0], "a.txt");
    std::fs::write(h.repo.join(".git/info/exclude"), "a.txt\n").unwrap();
    assert_eq!(h.o.merge_preview(&run).unwrap()["dirty"]["paths"][0], "a.txt", "무시 파일도 덮지 않는다");
    assert_eq!(merge(&h, &run)["reason"], "dirty");
    assert_eq!(std::fs::read_to_string(h.repo.join("a.txt")).unwrap(), "mine\n");
    assert_eq!(main_tip(&h), before);
}

#[test]
fn wrong_branch_refuses_and_stays_put() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-branch");
    let run = done_album(&h);
    let before = main_tip(&h);
    git(&h.repo, &["switch", "-q", "-c", "feat-login"]);
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["onTarget"].as_bool(), p["current"].as_str()), (Some(false), Some("feat-login")));
    assert_eq!(p["state"], "blocked");
    assert_eq!(merge(&h, &run)["reason"], "wrong-branch");
    assert_eq!(main_tip(&h), before);
    assert_eq!(git(&h.repo, &["symbolic-ref", "--short", "HEAD"]), "feat-login");
    // 분리 HEAD 도 같다.
    git(&h.repo, &["checkout", "-q", "--detach"]);
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["onTarget"].as_bool(), p["current"].is_null()), (Some(false), true));
}

#[test]
fn expected_conflict_refuses_and_leaves_the_repo_untouched() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-conflict");
    let run = done_album(&h);
    // main 이 앨범 시작 뒤 같은 파일을 만들었다.
    std::fs::write(h.repo.join("a.txt"), "main\n").unwrap();
    git(&h.repo, &["add", "a.txt"]);
    git(&h.repo, &["commit", "-qm", "main moved"]);
    let before = main_tip(&h);
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["state"].as_str(), p["conflicts"]["count"].as_u64()), (Some("blocked"), Some(1)), "{p}");
    assert_eq!(p["conflicts"]["paths"][0], "a.txt");
    let v = merge(&h, &run);
    assert_eq!((v["merged"].as_bool(), v["reason"].as_str()), (Some(false), Some("conflict")));
    assert_eq!(main_tip(&h), before);
    no_merge_state(&h);
    assert_eq!(git(&h.repo, &["status", "--porcelain"]), "");
    assert_eq!(std::fs::read_to_string(h.repo.join("a.txt")).unwrap(), "main\n");
}

#[test]
fn moved_heads_refuse() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-moved");
    let (run, c) = album(&h, None);
    let integ = |h: &H| run_of(&h.o, &run).integration.unwrap();
    // 아직 내보내지 않았다.
    assert_eq!(h.o.merge_preview(&run).unwrap()["reason"], "not-exported");
    h.o.export_branch(&run).unwrap();
    let branch = format!("refs/heads/{}", integ(&h).export_branch);
    let seen = integ(&h).exported_head.unwrap();
    // 창이 본 값과 다르면 하지 않는다.
    let v = h.o.merge_album(&run, &"1".repeat(40), "main").unwrap();
    assert_eq!((v["merged"].as_bool(), v["reason"].as_str()), (Some(false), Some("merge-stale")));
    assert_eq!(h.o.merge_album(&run, &seen, "develop").unwrap()["reason"], "merge-stale");
    // 내보낸 브랜치를 앱 밖에서 옮겼다.
    let other = git(&h.repo, &["rev-parse", "main"]);
    git(&h.repo, &["update-ref", &branch, &other]);
    assert_eq!(h.o.merge_preview(&run).unwrap()["reason"], "branch-moved");
    git(&h.repo, &["update-ref", &branch, &seen]);
    // 내보낸 뒤 통합이 더 쌓였다.
    one_integrated(&h, &run, &c, "b");
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["state"].as_str(), p["reason"].as_str()), (Some("blocked"), Some("stale")));
    let before = main_tip(&h);
    assert_eq!(merge(&h, &run)["reason"], "stale");
    assert_eq!(main_tip(&h), before);
}

#[test]
fn already_contained_reads_as_merged_without_a_ledger_line() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-outside");
    let run = done_album(&h);
    assert_eq!(h.o.run_detail_fresh(&run).unwrap()["mergedOutside"], false);
    // 터미널에서 직접.
    let branch = run_of(&h.o, &run).integration.unwrap().export_branch;
    git(&h.repo, &["merge", "-q", "--no-ff", "--no-edit", &branch]);
    let tip = main_tip(&h);
    assert_eq!(h.o.merge_preview(&run).unwrap()["state"], "merged");
    assert_eq!(h.o.run_detail_fresh(&run).unwrap()["mergedOutside"], true);
    let v = merge(&h, &run);
    assert_eq!((v["merged"].as_bool(), v["already"].as_bool()), (Some(true), Some(true)));
    assert_eq!(main_tip(&h), tip);
    assert!(run_of(&h.o, &run).merge.is_none(), "앱이 한 병합이 아니다");
    assert!(actions(&h, &run, "integration_merged").is_empty());
}

#[test]
fn detached_start_has_no_target_and_blocks() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-detached");
    git(&h.repo, &["checkout", "-q", "--detach"]);
    let run = done_album(&h);
    let i = run_of(&h.o, &run).integration.unwrap();
    assert!(i.base_branch.is_none(), "분리 HEAD 시작");
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["state"].as_str(), p["reason"].as_str()), (Some("blocked"), Some("no-base-branch")));
    assert_eq!(h.o.merge_album(&run, &i.exported_head.unwrap(), "main").unwrap()["merged"], false);
}

#[test]
fn other_identity_and_merge_in_progress_block() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-identity");
    let run = done_album(&h);
    // 진행 중인 병합.
    git(&h.repo, &["switch", "-q", "-c", "side"]);
    std::fs::write(h.repo.join("s.txt"), "s\n").unwrap();
    git(&h.repo, &["add", "s.txt"]);
    git(&h.repo, &["commit", "-qm", "side"]);
    git(&h.repo, &["switch", "-q", "main"]);
    git(&h.repo, &["merge", "-q", "--no-ff", "--no-commit", "side"]);
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["inProgress"].as_bool(), p["state"].as_str()), (Some(true), Some("blocked")));
    assert_eq!(merge(&h, &run)["reason"], "in-progress");
    assert_eq!(git(&h.repo, &["rev-parse", "MERGE_HEAD"]), git(&h.repo, &["rev-parse", "side"]), "남의 병합을 걷지 않는다");
    git(&h.repo, &["merge", "--abort"]);
    // 저장소 신원이 다르면 git 을 읽지 않는다.
    edit(&h, &run, |r| r.delegation.as_mut().unwrap().repo_id = Some("someone-else".into()));
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["state"].as_str(), p["reason"].as_str()), (Some("blocked"), Some("repo-changed")));
    assert_eq!(merge(&h, &run)["reason"], "repo-changed");
}

#[test]
fn unsupported_repo_setting_blocks_before_merge_tree() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-driver");
    let run = done_album(&h);
    let before = main_tip(&h);
    git(&h.repo, &["config", "merge.foo.driver", "does-not-exist %A"]);
    let p = h.o.merge_preview(&run).unwrap();
    assert_eq!((p["reason"].as_str(), p["detail"].as_str()), (Some("git-unsupported"), Some("merge-driver")), "{p}");
    assert_eq!(merge(&h, &run)["reason"], "git-unsupported");
    assert_eq!(main_tip(&h), before);
}

#[test]
fn failed_merge_reports_honestly_and_leaves_the_repo() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-fail");
    let run = done_album(&h);
    let before = main_tip(&h);
    // 신원이 없으면 git 이 병합 커밋을 만들지 못한다 — 검사를 지난 뒤의 실패.
    git(&h.repo, &["config", "user.name", ""]);
    git(&h.repo, &["config", "user.useConfigOnly", "true"]);
    let v = merge(&h, &run);
    assert_eq!((v["merged"].as_bool(), v["reason"].as_str(), v["unchanged"].as_bool()), (Some(false), Some("merge-failed"), Some(true)), "{v}");
    assert!(!v["detail"].as_str().unwrap().is_empty());
    assert_eq!(main_tip(&h), before);
    no_merge_state(&h);
    assert_eq!(git(&h.repo, &["status", "--porcelain"]), "");
}

// ---------------------------------------------------------------------------
// 자동 병합
// ---------------------------------------------------------------------------

#[test]
fn auto_merge_merges_once_after_complete_when_every_condition_holds() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-ok");
    let (run, _c) = album(&h, Some(CMD));
    turn_on(&h, &run);
    let before = main_tip(&h);
    let v = h.o.complete_run(&run).unwrap();
    assert_eq!(v["autoMerge"]["merged"], true, "{v}");
    let tip = main_tip(&h);
    assert_ne!(tip, before);
    assert_eq!(v["autoMerge"]["commit"], tip.as_str());
    assert_eq!(rev(&h.repo, "main^1").unwrap(), before);
    let m = run_of(&h.o, &run).merge.unwrap().merged.unwrap();
    assert_eq!(m.by, Actor::Server);
    let e = actions(&h, &run, "integration_auto_merged");
    assert_eq!((e.len(), e[0].actor, e[0].outcome.as_str()), (1, Actor::Server, &tip[..7]));
    assert!(audit_events(&h).iter().any(|(ev, _)| ev == "integration_auto_merged"));
    assert!(h.o.notices_view().as_array().unwrap().iter().all(|n| n["kind"] != "auto-merge-stopped"));
}

#[test]
fn auto_merge_off_does_nothing() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-off");
    let (run, _c) = album(&h, Some(CMD));
    let before = main_tip(&h);
    let v = h.o.complete_run(&run).unwrap();
    assert!(v.get("autoMerge").is_none());
    assert_eq!(main_tip(&h), before);
    assert!(run_of(&h.o, &run).merge.is_none());
}

/// 멈춤 공통 — 병합 없음 · 까닭이 Run 칸 · 장부 · 사람 알림에 · 재시도 없음.
fn assert_stopped(h: &H, run: &str, before: &str, v: &Value, word: &str) {
    assert_eq!((v["autoMerge"]["merged"].as_bool(), v["autoMerge"]["reason"].as_str()), (Some(false), Some(word)), "{v}");
    assert_eq!(main_tip(h), before, "병합하지 않는다");
    assert_eq!(run_of(&h.o, run).merge.unwrap().stopped.unwrap().reason, word);
    let e = actions(h, run, "auto_merge_stopped");
    assert_eq!((e.len(), e[0].actor, e[0].outcome.as_str()), (1, Actor::Server, word), "장부에 한 줄 — 재시도 없음");
    let notices = h.o.notices_view();
    let n = notices.as_array().unwrap().iter().find(|n| n["kind"] == "auto-merge-stopped").expect("사람 알림").clone();
    assert_eq!(n["detail"], word);
}

#[test]
fn auto_merge_stops_without_a_verify_command() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-noverify");
    let (run, _c) = album(&h, None);
    turn_on(&h, &run);
    let before = main_tip(&h);
    let v = h.o.complete_run(&run).unwrap();
    assert_stopped(&h, &run, &before, &v, "no-verify-command");
}

#[test]
fn auto_merge_stops_on_a_verify_override() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-override");
    let (run, _c) = album(&h, Some(CMD));
    turn_on(&h, &run);
    edit(&h, &run, |r| {
        let j = r.jobs.iter_mut().find(|j| j.phase == JobPhase::Integrated).unwrap();
        j.override_ = Some(VerifyOverride {
            failed_job_id: "job-x".into(),
            verify_id: "v".into(),
            candidate: j.candidate.clone().unwrap(),
            old: j.old.clone().unwrap(),
            by: Reviewer::Human,
            at: 1,
        });
    });
    let before = main_tip(&h);
    let v = h.o.complete_run(&run).unwrap();
    assert_stopped(&h, &run, &before, &v, "verify-overridden");
}

#[test]
fn auto_merge_stops_on_a_waiver() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-waived");
    let (run, _c) = album(&h, Some(CMD));
    turn_on(&h, &run);
    edit(&h, &run, |r| {
        r.accepted[0].waived.push(Waiver { rule: "judgment".into(), role: Some("j".into()), role_name: None, need: 1, have: 0 });
    });
    let before = main_tip(&h);
    let v = h.o.complete_run(&run).unwrap();
    assert_stopped(&h, &run, &before, &v, "waived");
}

#[test]
fn auto_merge_reads_the_accept_rules_of_the_current_config() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-rules");
    let (run, _c) = album(&h, Some(CMD));
    turn_on(&h, &run);
    // 수락 뒤 사람이 규칙을 올렸다 — 지금 구성으로 다시 센다.
    edit(&h, &run, |r| {
        r.album.as_mut().unwrap().accept.require.push(crate::orchestration::config::AcceptRule { role: "judge".into(), passes: 1 });
    });
    let before = main_tip(&h);
    let v = h.o.complete_run(&run).unwrap();
    assert_stopped(&h, &run, &before, &v, "accept-rule-unmet");
}

#[test]
fn auto_merge_stops_on_the_pre_merge_checks_and_a_person_finishes_it() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-dirty");
    let (run, _c) = album(&h, Some(CMD));
    turn_on(&h, &run);
    std::fs::write(h.repo.join("f.txt"), "changed\n").unwrap();
    std::fs::write(h.repo.join("g.txt"), "x\n").unwrap();
    git(&h.repo, &["add", "g.txt"]);
    let before = main_tip(&h);
    let v = h.o.complete_run(&run).unwrap();
    assert_stopped(&h, &run, &before, &v, "dirty");
    assert_eq!(run_of(&h.o, &run).merge.unwrap().stopped.unwrap().detail.as_deref(), Some("2"));
    // 앱은 혼자 다시 시도하지 않는다 — 사람이 치우고 [병합].
    assert_eq!(h.o.run_detail_fresh(&run).unwrap()["merge"]["stopped"]["reason"], "dirty");
    assert_eq!(main_tip(&h), before);
    assert_eq!(actions(&h, &run, "auto_merge_stopped").len(), 1);
    git(&h.repo, &["reset", "-q", "--hard"]);
    assert_eq!(merge(&h, &run)["merged"], true);
    let m = run_of(&h.o, &run).merge.unwrap();
    assert!(m.stopped.is_none(), "병합이 서면 멈춤 기록을 걷는다");
    assert_eq!(m.merged.unwrap().by, Actor::Human);
}

#[test]
fn auto_merge_stops_when_the_album_gate_fails() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-gate");
    let (run, _c) = album(&h, Some(CMD));
    // 위험 확인 없이 켜진 구성은 관문이 닫는다.
    edit(&h, &run, |r| {
        let a = r.album.as_mut().unwrap();
        a.auto_merge = true;
        a.verify_auto = false;
        a.risk_confirmed_at = None;
    });
    let before = main_tip(&h);
    let v = h.o.complete_run(&run).unwrap();
    assert_stopped(&h, &run, &before, &v, "role-invalid");
}

/// 장부 판정 — 내보낸 머리가 검증된 후보가 아니면([조정]으로 사람이 올린 머리) 무인으로 넣지 않는다 · 끝나지 않은 앨범 · 보류도.
#[test]
fn blocker_requires_a_verified_head_and_a_done_run() {
    let _g = super::tests_stage4::serial();
    let h = harness("auto-pure");
    let (run, _c) = album(&h, Some(CMD));
    let mut r = run_of(&h.o, &run);
    let album = r.album.clone().unwrap();
    assert_eq!(auto_merge_blocker(&r, &album), Some("run-state"), "앨범이 아직 산다");
    r.state = RunState::Stopped;
    assert_eq!(auto_merge_blocker(&r, &album), Some("run-state"), "중단은 제외");
    r.state = RunState::Done;
    assert_eq!(auto_merge_blocker(&r, &album), None);
    let mut moved = r.clone();
    moved.integration.as_mut().unwrap().expected_head = "2".repeat(40);
    assert_eq!(auto_merge_blocker(&moved, &album), Some("head-not-verified"));
    let mut held = r.clone();
    held.hold = Some(RunHold { reason: HoldReason::CleanupPending, at: 1, detail: None });
    assert_eq!(auto_merge_blocker(&held, &album), Some("on-hold"));
    let mut failed = r.clone();
    let j = failed.jobs.iter_mut().find(|j| j.phase == JobPhase::Integrated).unwrap();
    j.verify.as_mut().unwrap().outcome = VerifyOutcome::Fail;
    assert_eq!(auto_merge_blocker(&failed, &album), Some("verify-not-passed"));
    let mut none = r.clone();
    none.accepted.clear();
    assert_eq!(auto_merge_blocker(&none, &album), Some("no-accepted"));
}

/// 깨움 허용 목록은 그대로 — 병합 낱말은 프로듀서를 깨우지 않는다.
#[test]
fn merge_words_do_not_wake_the_producer() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-wake");
    let (run, _c) = album(&h, None);
    edit(&h, &run, |r| {
        let from = r.seq;
        r.bump(1, Actor::Human, "integration_merged", Some("main"), "abc1234");
        r.bump(1, Actor::Server, "integration_auto_merged", Some("main"), "abc1234");
        r.bump(1, Actor::Server, "auto_merge_stopped", None, "dirty");
        let scan = super::wake::wake_items(r, from, r.seq);
        assert!(scan.items.is_empty());
    });
}

/// **AI 에는 길이 없다** — MCP 역할 전부 목록 · 디스패치 · 미리 허용에 없고, MCP 쪽 소스에 병합 몸을 부르는 곳이 없다.
#[test]
fn album_merge_has_no_mcp_path() {
    let _g = super::tests_stage4::serial();
    let h = harness("merge-mcp");
    let (run, c) = album(&h, None);
    let callers = [
        c.clone(),
        Caller::Global,
        Caller::SideChat { chat: "side".into() },
        Caller::Tile { stream: "tile".into() },
        Caller::Producer { chat: "pc-writer".into(), proc: crate::server::chat_proc::ProcId::next() },
        Caller::Worker { run_id: run.clone(), gen: 1, attempt_id: "worker".into() },
        Caller::Reviewer { run_id: run.clone(), gen: 1, attempt_id: "judge".into() },
    ];
    for tool in ["orchestration_merge", "orchestration_merge_preview", "merge", "merge_album", "auto_merge", "set_auto_merge"] {
        for caller in &callers {
            assert!(!super::is_tool_for(caller, tool), "{tool}");
            let e = h.o.call_tool(caller, tool, Some(&json!({}))).unwrap_err();
            assert!(e.contains("Unknown tool"), "{tool}: {e}");
        }
        assert!(!super::preallowed_tools().any(|name| name == tool), "{tool}");
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = vec![root.join("mcp.rs"), root.join("orchestration/tools.rs"), root.join("orchestration/start.rs"), root.join("server/ai.rs")];
    files.extend(std::fs::read_dir(root.join("mcp")).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "rs")));
    for path in files {
        let src = std::fs::read_to_string(&path).unwrap();
        // (`complete_run` 설명의 결과 칸 이름 `autoMerge` 는 읽기 — 몸을 부르는 낱말만 본다.)
        for word in ["merge_album", "merge_preview", "orchestration_merge", "auto_merge"] {
            assert!(!src.contains(word), "{}: {word}", path.display());
        }
    }
    // 조정자의 보기에는 병합 칸이 없다(사람 보드만).
    assert!(h.o.lock().runs.get(&run).map(|s| super::store::view(s, 0, false)).unwrap().get("merge").is_none());
}
