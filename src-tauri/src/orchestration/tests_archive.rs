//! 앨범 보관함 시험(`store/archive.rs`) — 진짜 git · 진짜 worktree(6단계 시험의 틀을 함께 쓴다). 작업자는 띄우지 않는다.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};

use super::integrate::refs;
use super::model::*;
use super::spawn::{LaunchJob, WorkerLauncher};
use super::store::*;
use super::tests_stage6::*;

fn main_file(h: &H, run: &str) -> PathBuf {
    h.data.join(format!("{run}.json"))
}

fn archived_file(h: &H, run: &str) -> PathBuf {
    h.data.join("archived").join(format!("{run}.json"))
}

fn worker_wts(h: &H, run: &str) -> Vec<String> {
    run_of(&h.o, run).attempts.iter().filter_map(|a| a.worktree.clone()).collect()
}

/// 통합 하나 · 완료(내보냄) · 작업자 worktree 를 지운 앨범.
fn done_album(h: &H, name: &str) -> String {
    let (run, c) = start(h, None, &[]);
    one_integrated(h, &run, &c, name);
    h.o.complete_run(&run).unwrap();
    h.o.cleanup_run(&run, &worker_wts(h, &run), &[], false).unwrap();
    run
}

fn row_of(o: &Orchestration, run: &str) -> Value {
    o.archived_list().as_array().unwrap().iter().find(|r| r["runId"] == run).cloned().unwrap_or(Value::Null)
}

fn refs_of(h: &H, run: &str) -> String {
    git(&h.repo, &["for-each-ref", &refs::run_prefix(run)])
}

/// 띄우기 손이 불렸는지 세는 가짜 — 복원이 아무것도 띄우지 않음을 본다.
struct CountingLauncher(Arc<AtomicUsize>);

impl WorkerLauncher for CountingLauncher {
    fn launch(&self, _job: LaunchJob) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn stop(&self, _run_id: &str, _attempt_id: &str) {}
    fn tree_gone(&self, _attempt_id: &str) -> bool {
        true
    }
}

#[test]
fn archive_refuses_a_live_album() {
    let _g = super::tests_stage4::serial();
    let h = harness("live");
    let (run, _c) = start(&h, None, &[]);
    assert_eq!(h.o.archive_run(&run).unwrap_err().code, reason::INVALID_STATE);
    h.o.pause(&run).unwrap();
    assert_eq!(h.o.archive_run(&run).unwrap_err().code, reason::INVALID_STATE);
    assert_eq!(h.o.archive_run("run-00000000000000000000000000000000").unwrap_err().code, reason::NOT_FOUND);
    assert_eq!(run_of(&h.o, &run).state, RunState::Paused, "그대로 산다");
    h.o.flush_saves();
    assert!(!archived_file(&h, &run).exists());
}

/// 남은 작업자 worktree 는 서버가 거절한다 — 요약 · 상세의 재료와 같은 판정이고 [정리] 뒤에 된다.
#[test]
fn archive_refuses_left_worktrees_until_cleaned() {
    let _g = super::tests_stage4::serial();
    let h = harness("wtleft");
    let (run, c) = start(&h, None, &[]);
    let t = create_task(&h.o, &c, "open");
    let wt = fake_worker(&h, &run, &t, "orch-open", &head(&h.o, &run), &[("o.txt", "o\n")]);
    assert_eq!(h.o.snapshot()[0]["worktreesLeft"], 0, "산 앨범은 디스크를 보지 않는다");
    stop_settled(&h, &run);
    assert_eq!(h.o.snapshot()[0]["worktreesLeft"], 1);
    assert_eq!(h.o.run_detail_fresh(&run).unwrap()["worktreesLeft"], 1);
    let e = h.o.archive_run(&run).unwrap_err();
    assert_eq!((e.code, e.message.as_str()), (reason::WORKTREES_LEFT, "1"));
    assert!(main_file(&h, &run).exists() && !archived_file(&h, &run).exists());
    h.o.cleanup_run(&run, std::slice::from_ref(&wt), &[], false).unwrap();
    assert_eq!(h.o.snapshot()[0]["worktreesLeft"], 0);
    h.o.archive_run(&run).unwrap();
    assert_eq!(h.o.snapshot(), json!([]));
}

/// 예상 밖 변경으로 남긴 서버 임시 자리는 보관을 막는다(`cleanup-pending` 그대로) — [그래도 지우기] 뒤에 된다.
#[test]
fn archive_refuses_kept_server_temp() {
    let _g = super::tests_stage4::serial();
    let h = harness("tempkept");
    let (run, c) = start(&h, Some("exit 0"), &[]);
    one_integrated(&h, &run, &c, "one");
    let vdir = h.wt_dir().join(super::verify::place_names(&run).0);
    std::fs::write(vdir.join("stray.txt"), "x").unwrap();
    stop_settled(&h, &run);
    h.o.cleanup_run(&run, &worker_wts(&h, &run), &[], false).unwrap();
    assert_eq!(h.o.archive_run(&run).unwrap_err().code, reason::CLEANUP_PENDING);
    assert!(!archived_file(&h, &run).exists());
    h.o.discard_temp(&run, &vdir.display().to_string()).unwrap();
    h.o.archive_run(&run).unwrap();
    assert!(archived_file(&h, &run).exists());
}

/// 보관 → 목록 → 복원 왕복 — 기록 · ref 는 그대로이고 복원은 끝난 기록으로만 돌아온다(프로세스 · 토큰 · 묶음 없음 · 재실행 없음).
#[test]
fn archive_list_restore_round_trip() {
    let _g = super::tests_stage4::serial();
    let h = harness("roundtrip");
    let launched = Arc::new(AtomicUsize::new(0));
    h.o.set_launcher(Arc::new(CountingLauncher(Arc::clone(&launched))));
    let run = done_album(&h, "one");
    let before = run_of(&h.o, &run);
    assert_eq!(h.o.snapshot()[0]["exportedBranch"], before.integration.as_ref().unwrap().export_branch.as_str(), "라이브러리 줄의 칩 재료");
    let ref_list = refs_of(&h, &run);
    assert!(!ref_list.is_empty());
    h.o.archive_run(&run).unwrap();
    h.o.flush_saves();
    assert_eq!(h.o.snapshot(), json!([]), "라이브러리에서 빠진다");
    assert!(!main_file(&h, &run).exists(), "쓰기 줄의 옛 스냅숏이 파일을 되살리지 않는다");
    assert!(archived_file(&h, &run).exists());
    assert_eq!(refs_of(&h, &run), ref_list, "ref 는 보관 중 그대로");
    let row = row_of(&h.o, &run);
    assert_eq!(row["name"], before.name.as_str());
    assert_eq!(row["repo"], before.repo.as_str());
    assert_eq!(row["state"], "done");
    assert_eq!(row["taskCount"], 1);
    assert!(row["archivedAt"].as_u64().unwrap() > 0);
    assert_eq!(row["exportedBranch"], before.integration.as_ref().unwrap().export_branch.as_str());
    assert_eq!(row["unexported"], false);
    assert_eq!(row["exportable"], false);
    assert_eq!(h.o.run_detail(&run).unwrap_err().code, reason::NOT_FOUND);
    let shown = h.o.restore_archived(&run).unwrap();
    assert_eq!(shown["state"], "done");
    h.o.flush_saves();
    assert!(main_file(&h, &run).exists() && !archived_file(&h, &run).exists());
    assert_eq!(h.o.archived_list(), json!([]));
    let after = run_of(&h.o, &run);
    assert_eq!(after.state, RunState::Done);
    assert_eq!(after.seq, before.seq, "기록이 그대로");
    assert_eq!(after.archived_at, None);
    assert!(h.o.coordinator_caller(&run).is_none(), "묶음을 되살리지 않는다");
    assert!(h.o.lock().tokens.is_empty(), "토큰을 되살리지 않는다");
    assert_eq!(h.o.active_count(), 0);
    h.o.tick();
    assert_eq!(launched.load(Ordering::SeqCst), 0, "아무것도 띄우지 않는다");
    assert_eq!(run_of(&h.o, &run).state, RunState::Done);
    assert!(h.o.resume(&run).is_err(), "다시 돌 수 없다");
    let saved = super::persist::decode(&std::fs::read(main_file(&h, &run)).unwrap()).unwrap();
    assert_eq!(saved.archived_at, None, "복원 상태가 파일에도");
    let ev = audit_events(&h);
    assert!(ev.iter().any(|(e, _)| e == "run_archived") && ev.iter().any(|(e, _)| e == "run_restored"));
}

/// orphaned 도 같은 보관이고(옛 [닫기]) 복원은 재시작 규칙과 같은 결과다. 보관한 앨범은 재시작해도 라이브러리로 돌아오지 않는다.
#[test]
fn orphaned_archive_restores_like_a_restart_and_stays_archived_across_restarts() {
    let _g = super::tests_stage4::serial();
    let h = harness("orphan");
    let run = done_album(&h, "one");
    h.o.flush_saves();
    // 내보낸 브랜치를 사람이 지웠다 — 통합 결과가 내보내지지 않은 채로 orphaned 가 된다.
    let branch = run_of(&h.o, &run).integration.unwrap().export_branch;
    git(&h.repo, &["branch", "-D", &branch]);
    let (o2, _rx) = orch_at(&h.data, &h.side);
    assert_eq!(o2.lock().runs.get(&run).unwrap().run.state, RunState::Orphaned);
    o2.archive_run(&run).unwrap();
    o2.flush_saves();
    assert!(!main_file(&h, &run).exists());
    let row = row_of(&o2, &run);
    assert_eq!(row["state"], "orphaned");
    assert_eq!(row["previousState"], "done");
    assert_eq!(row["unexported"], true);
    assert_eq!(row["exportable"], true, "orphaned 도 [먼저 내보내기]가 선다(11-09)");
    // 재시작 — 라이브러리에는 없고 보관함에는 있다.
    drop(o2);
    let (o3, _rx3) = orch_at(&h.data, &h.side);
    assert_eq!(o3.snapshot(), json!([]));
    assert_eq!(row_of(&o3, &run)["runId"], run.as_str());
    // 복원 — 재시작 때 읽는 규칙과 같은 결과.
    assert_eq!(o3.restore_archived(&run).unwrap()["state"], "orphaned");
    let r = o3.lock().runs.get(&run).unwrap().run.clone();
    assert_eq!((r.state, r.previous_state), (RunState::Orphaned, Some(RunState::Done)));
    assert!(o3.coordinator_caller(&run).is_none());
    assert_eq!(o3.pause(&run).unwrap_err().code, reason::RUN_ORPHANED, "읽기 전용 그대로");
    // 내보내기 하나는 받는다 — 통합 머리에 브랜치가 다시 서고 상태는 orphaned 그대로.
    let head = r.integration.as_ref().unwrap().expected_head.clone();
    o3.export_branch(&run).unwrap();
    assert_eq!(rev(&h.repo, &format!("refs/heads/{branch}")).as_deref(), Some(head.as_str()));
    assert_eq!(o3.lock().runs.get(&run).unwrap().run.state, RunState::Orphaned);
    o3.flush_saves();
    drop(o3);
    let (o4, _rx4) = orch_at(&h.data, &h.side);
    let r = o4.lock().runs.get(&run).unwrap().run.clone();
    assert_eq!((r.state, r.previous_state), (RunState::Orphaned, Some(RunState::Done)));
}

/// 영구 삭제 — 이 앨범의 ref 전부와 파일을 지우고, 내보낸 브랜치와 그 커밋은 남긴다. 다른 앨범의 ref 는 건드리지 않는다.
#[test]
fn delete_removes_refs_and_file_but_keeps_the_exported_branch() {
    let _g = super::tests_stage4::serial();
    let h = harness("delete");
    let run = done_album(&h, "one");
    let other = done_album(&h, "two");
    let integ = run_of(&h.o, &run).integration.unwrap();
    let branch = format!("refs/heads/{}", integ.export_branch);
    let tip = rev(&h.repo, &branch).unwrap();
    let other_refs = refs_of(&h, &other);
    // 표에 있는(보관하지 않은) 앨범은 지우지 못한다.
    assert_eq!(h.o.delete_archived(&run).unwrap_err().code, reason::NOT_FOUND);
    h.o.archive_run(&run).unwrap();
    let n = refs_of(&h, &run).lines().count();
    assert!(n >= 3, "통합 · 완료 증거 · 보존");
    let shown = h.o.delete_archived(&run).unwrap();
    assert_eq!(shown["refsRemoved"], n);
    assert_eq!(refs_of(&h, &run), "");
    assert!(!archived_file(&h, &run).exists());
    assert_eq!(row_of(&h.o, &run), Value::Null);
    assert_eq!(rev(&h.repo, &branch).as_deref(), Some(tip.as_str()), "내보낸 브랜치는 남는다");
    assert_eq!(git(&h.repo, &["cat-file", "-t", &tip]), "commit");
    assert_eq!(refs_of(&h, &other), other_refs, "다른 앨범의 ref 는 그대로");
    assert_eq!(h.o.delete_archived(&run).unwrap_err().code, reason::NOT_FOUND, "두 번째는 없다");
    assert!(audit_events(&h).iter().any(|(e, v)| e == "run_deleted" && v["orchestration"]["cleaned"] == n));
}

/// ref 삭제가 실패하면 파일을 남기고 오류 — 고치면 다시 시도할 수 있다.
#[test]
fn delete_keeps_the_file_when_a_ref_cannot_be_removed() {
    let _g = super::tests_stage4::serial();
    let h = harness("delfail");
    let run = done_album(&h, "one");
    h.o.archive_run(&run).unwrap();
    // 잠금 파일 — git 이 그 ref 를 지우지 못한다(for-each-ref 는 `.lock` 을 보지 않는다).
    let lock: PathBuf = h.repo.join(".git").join(refs::int(&run).replace('/', "\\") + ".lock");
    std::fs::write(&lock, "").unwrap();
    assert_eq!(h.o.delete_archived(&run).unwrap_err().code, reason::GIT_FAILED);
    assert!(archived_file(&h, &run).exists(), "파일을 남긴다");
    assert_eq!(row_of(&h.o, &run)["runId"], run.as_str(), "보관함에 그대로");
    std::fs::remove_file(&lock).unwrap();
    h.o.delete_archived(&run).unwrap();
    assert!(!archived_file(&h, &run).exists());
    assert_eq!(refs_of(&h, &run), "");
}

/// 저장소 폴더가 사라졌으면 ref 는 건너뛰고 지운다.
#[test]
fn delete_skips_refs_when_the_repo_is_gone() {
    let _g = super::tests_stage4::serial();
    let h = harness("repogone");
    let run = done_album(&h, "one");
    h.o.archive_run(&run).unwrap();
    std::fs::rename(&h.repo, h.root.join("moved-away")).unwrap();
    let row = row_of(&h.o, &run);
    assert_eq!((row["unexported"].clone(), row["exportable"].clone()), (json!(false), json!(false)), "장부로 본다");
    assert_eq!(h.o.delete_archived(&run).unwrap()["refsRemoved"], 0);
    assert!(!archived_file(&h, &run).exists());
}

/// 잘못된 id 는 파일을 보기 전에 거절한다(경로 탈출 금지) · 판이 맞지 않는 파일은 복원 · 삭제하지 않고 목록에서 건너뛴다.
#[test]
fn bad_ids_and_unsupported_files_are_refused() {
    let _g = super::tests_stage4::serial();
    let h = harness("badid");
    let dir = h.data.join("archived");
    std::fs::create_dir_all(&dir).unwrap();
    let outside = h.data.join("outside.json");
    std::fs::write(&outside, "{}").unwrap();
    for bad in ["../outside", "..\\outside", "run-1", "run-../../outside", "RUN-00000000000000000000000000000000", ""] {
        assert_eq!(h.o.restore_archived(bad).unwrap_err().code, reason::INVALID_ARGUMENT, "{bad}");
        assert_eq!(h.o.delete_archived(bad).unwrap_err().code, reason::INVALID_ARGUMENT, "{bad}");
    }
    assert!(outside.exists());
    let id = new_id("run").unwrap();
    let file = dir.join(format!("{id}.json"));
    std::fs::write(&file, r#"{"version": 99, "run": {}}"#).unwrap();
    assert_eq!(h.o.restore_archived(&id).unwrap_err().code, reason::ARCHIVE_UNREADABLE);
    assert_eq!(h.o.delete_archived(&id).unwrap_err().code, reason::ARCHIVE_UNREADABLE);
    assert!(file.exists());
    assert_eq!(h.o.archived_list(), json!([]), "못 읽는 파일은 건너뛴다");
    assert_eq!(h.o.restore_archived(&new_id("run").unwrap()).unwrap_err().code, reason::NOT_FOUND);
}

/// 옛 판 파일이 있어도 목록의 건너뜀 로그는 파일 하나당 서버 수명에 한 번이다. 사람이 고른 복원 거절의 로그는 그때마다 남는다.
#[test]
fn skipped_archived_file_logs_once_per_server() {
    let _g = super::tests_stage4::serial();
    let h = harness("skiplog");
    let dir = h.data.join("archived");
    std::fs::create_dir_all(&dir).unwrap();
    let id = new_id("run").unwrap();
    std::fs::write(dir.join(format!("{id}.json")), r#"{"version": 99, "run": {}}"#).unwrap();
    let count = |word: &str| {
        crate::server::log::CAPTURED.lock().unwrap_or_else(|e| e.into_inner()).iter().filter(|l| l.contains(word) && l.contains(&id)).count()
    };
    for _ in 0..3 {
        assert_eq!(h.o.archived_list(), json!([]));
    }
    assert_eq!(count("skipped archived"), 1);
    // 다른 파일은 따로 한 번.
    let other = new_id("run").unwrap();
    std::fs::write(dir.join(format!("{other}.json")), r#"{"version": 99, "run": {}}"#).unwrap();
    h.o.archived_list();
    h.o.archived_list();
    assert_eq!(count("skipped archived"), 1);
    assert_eq!(crate::server::log::CAPTURED.lock().unwrap().iter().filter(|l| l.contains("skipped archived") && l.contains(&other)).count(), 1);
    // 거절 로그는 그대로.
    for _ in 0..2 {
        assert_eq!(h.o.restore_archived(&id).unwrap_err().code, reason::ARCHIVE_UNREADABLE);
    }
    assert_eq!(h.o.delete_archived(&id).unwrap_err().code, reason::ARCHIVE_UNREADABLE);
    assert_eq!(count("refused"), 3);
    // 새 서버 수명 — 다시 한 번.
    let (o2, _rx) = orch_at(&h.data, &h.side);
    o2.archived_list();
    assert_eq!(count("skipped archived"), 2);
}

/// 통합 ref 규칙(A) — 시작 커밋 그대로면 내보내지 않아도 지울 수 있다(기본 해제 그대로 · 지우는 길도 같은 판정). 통합 결과가 있으면 `not-exported` 그대로.
#[test]
fn int_at_base_commit_has_no_blocker_but_real_results_still_do() {
    let _g = super::tests_stage4::serial();
    let h = harness("intbase");
    let int_row = |p: &Value| p["refs"].as_array().unwrap().iter().find(|r| r["kind"] == "int").cloned().unwrap();
    // 트랙 없이 멈춘 앨범.
    let (empty, _c) = start(&h, None, &[]);
    stop_settled(&h, &empty);
    let row = int_row(&h.o.cleanup_preview(&empty).unwrap());
    assert_eq!(row["eligible"], true, "{row}");
    assert!(row["blocker"].is_null(), "{row}");
    assert_eq!(row["defaultChecked"], false);
    let name = row["name"].as_str().unwrap().to_string();
    let r = h.o.cleanup_run(&empty, &[], std::slice::from_ref(&name), false).unwrap();
    assert_eq!(r["refs"].as_array().unwrap().len(), 1, "{r}");
    assert_eq!(rev(&h.repo, &name), None);
    // 통합이 있는데 내보내지 않고 멈춘 앨범.
    let (run, c) = start(&h, None, &[]);
    one_integrated(&h, &run, &c, "one");
    stop_settled(&h, &run);
    let row = int_row(&h.o.cleanup_preview(&run).unwrap());
    assert_eq!(row["blocker"], "not-exported");
    let name = row["name"].as_str().unwrap().to_string();
    let r = h.o.cleanup_run(&run, &[], std::slice::from_ref(&name), false).unwrap();
    assert_eq!(r["failed"][0]["reason"], "not-exported", "지우는 길도 같은 판정");
    assert!(rev(&h.repo, &name).is_some());
    // 보관함 칸 — 내보내지 않은 결과 · 복원하면 내보낼 수 있다.
    h.o.cleanup_run(&run, &worker_wts(&h, &run), &[], false).unwrap();
    h.o.archive_run(&run).unwrap();
    let archived = row_of(&h.o, &run);
    assert_eq!(archived["state"], "stopped");
    assert_eq!((archived["unexported"].clone(), archived["exportable"].clone()), (json!(true), json!(true)));
    assert!(archived["exportedBranch"].is_null());
    h.o.restore_archived(&run).unwrap();
    h.o.export_branch(&run).unwrap();
    // 내보낸 브랜치가 품으면 경고가 사라진다 · 트랙 없는 앨범은 처음부터 없다.
    h.o.archive_run(&run).unwrap();
    assert_eq!(row_of(&h.o, &run)["unexported"], false);
    h.o.archive_run(&empty).unwrap();
    assert_eq!(row_of(&h.o, &empty)["unexported"], false);
}

/// 보관해 표에서 사라진 앨범의 프로듀서 채팅은 끝난 앨범과 같은 수명이다(레지스트리 판정 재료).
#[test]
fn archived_album_counts_as_gone_for_its_producer() {
    let _g = super::tests_stage4::serial();
    let h = harness("producer");
    let (run, _c) = start(&h, None, &[]);
    stop_settled(&h, &run);
    h.o.lock().producer_ever.insert("pc-archive".into(), run.clone());
    assert!(!h.o.producer_album_gone("pc-archive"));
    assert!(!h.o.producer_album_gone("pc-other"), "귀속 없는 채팅은 아니다");
    h.o.archive_run(&run).unwrap();
    assert!(h.o.producer_album_gone("pc-archive"));
    h.o.restore_archived(&run).unwrap();
    assert!(!h.o.producer_album_gone("pc-archive"));
}

/// 보관함의 길은 사람의 Tauri 명령 · 서버 op 뿐이다 — MCP 도구도 소스의 길도 없다.
#[test]
fn archive_has_no_mcp_path() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = vec![root.join("mcp.rs"), root.join("orchestration/tools.rs"), root.join("orchestration/tile.rs"), root.join("orchestration/start.rs")];
    files.extend(
        std::fs::read_dir(root.join("mcp")).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "rs")),
    );
    for path in files {
        let src = std::fs::read_to_string(&path).unwrap();
        for word in ["archive_run", "archived_list", "restore_archived", "delete_archived", "orchestration_archive", "orchestration_restore"] {
            assert!(!src.contains(word), "{}: {word}", path.display());
        }
    }
    let callers = [
        Caller::Global,
        Caller::SideChat { chat: "side".into() },
        Caller::Tile { stream: "tile".into() },
        Caller::Producer { chat: "pc".into(), proc: crate::server::chat_proc::ProcId::next() },
        Caller::Coordinator { run_id: "run".into(), gen: 1 },
        Caller::Worker { run_id: "run".into(), gen: 1, attempt_id: "w".into() },
        Caller::Reviewer { run_id: "run".into(), gen: 1, attempt_id: "r".into() },
    ];
    for name in ["archive_run", "archive_album", "orchestration_archive", "orchestration_archive_list", "orchestration_restore", "orchestration_delete_archived", "delete_archived"] {
        for caller in &callers {
            assert!(!super::is_tool_for(caller, name), "{name}");
        }
    }
    let lib = include_str!("../lib.rs");
    for command in ["orchestration_archive,", "orchestration_archive_list,", "orchestration_restore,", "orchestration_delete_archived,"] {
        assert_eq!(lib.matches(command).count(), 1, "{command}");
    }
}
