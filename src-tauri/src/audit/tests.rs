use super::*;

/// 테스트의 쓰기 스레드는 보관 기간 정리를 하지 않는다(0 = 지우지 않음).
fn no_retention() -> u32 {
    0
}

fn day(s: &str) -> chrono::NaiveDate {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

// ── 보관 기간 (docs/log/2026-09-28-run-history.md) ──────────────────────────

#[test]
fn expired_files_are_strictly_older_than_the_retention_window() {
    let names: Vec<String> = [
        "audit-20260928.jsonl", // 오늘
        "audit-20260630.jsonl", // 정확히 90일 전 — 남는다
        "audit-20260629.jsonl", // 91일 전 — 지운다
        "audit-20250101.jsonl", // 한참 전 — 지운다
        "audit-2026.jsonl",     // 모양이 다르다 — 건드리지 않는다
        "notes.jsonl",          // 앱이 쓴 파일이 아니다
        "audit-20250101.txt",   // 확장자가 다르다
        "audit-2025ab01.jsonl", // 숫자가 아니다
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let mut got = expired_audit_files(&names, day("2026-09-28"), 90);
    got.sort();
    assert_eq!(got, vec!["audit-20250101.jsonl", "audit-20260629.jsonl"]);
}

#[test]
fn retention_zero_deletes_nothing_and_logs_since_0910_survive_the_default() {
    let names: Vec<String> = vec!["audit-19990101.jsonl".into(), "audit-20260910.jsonl".into()];
    assert!(
        expired_audit_files(&names, day("2026-09-28"), 0).is_empty(),
        "0 = 지우지 않음"
    );
    // 감사 로그는 2026-09-10 부터다 — 기본 90일로는 오늘 지워지는 파일이 없다.
    let real: Vec<String> = vec!["audit-20260910.jsonl".into(), "audit-20260927.jsonl".into()];
    assert!(expired_audit_files(&real, day("2026-09-28"), 90).is_empty());
    // 하루짜리 보관은 어제까지 남기고 그저께부터 지운다(연·월 경계도 날짜 계산으로 넘는다).
    let edge: Vec<String> = vec!["audit-20251231.jsonl".into(), "audit-20251230.jsonl".into()];
    assert_eq!(
        expired_audit_files(&edge, day("2026-01-01"), 1),
        vec!["audit-20251230.jsonl"]
    );
}

/// 쓰기 스레드가 **시작할 때** 지난 날짜 파일을 치운다(오늘 파일·모양이 다른 파일은 남는다).
#[test]
fn writer_prunes_expired_day_files_at_start() {
    fn thirty() -> u32 {
        30
    }
    let tmp = TempDir::new();
    let old = tmp.0.join(audit_file_name("20000101"));
    let keep = tmp.0.join(audit_file_name(&today_stamp()));
    let other = tmp.0.join("keep-me.jsonl");
    for p in [&old, &keep, &other] {
        std::fs::write(p, b"{}\n").unwrap();
    }
    let tx = spawn_writer_in(tmp.0.clone(), Arc::new(AuditHealth::default()), thirty);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while old.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "지난 파일이 지워지지 않았다"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    drop(tx);
    assert!(keep.exists(), "오늘 파일은 남는다");
    assert!(other.exists(), "앱이 쓴 날짜 파일이 아니면 건드리지 않는다");
}

// ── 출력 발췌 ─────────────────────────────────────────────────────────────

#[test]
fn tail_excerpt_keeps_the_last_lines_within_both_caps() {
    assert_eq!(tail_excerpt(""), None);
    assert_eq!(tail_excerpt("  \n\n "), None, "공백뿐이면 없음");
    assert_eq!(
        tail_excerpt("ok\n\n").as_deref(),
        Some("ok"),
        "끝의 빈 줄은 뗀다"
    );

    // 줄 상한 — 100줄 중 마지막 40줄.
    let many: String = (1..=100).map(|i| format!("line {i}\n")).collect();
    let got = tail_excerpt(&many).unwrap();
    assert_eq!(got.lines().count(), EXCERPT_MAX_LINES);
    assert!(got.starts_with("line 61"), "{got}");
    assert!(got.ends_with("line 100"), "{got}");

    // 바이트 상한 — 긴 줄 10개(각 1000바이트)면 4 KB 안에서 **줄 머리**부터.
    let wide: String = (0..10)
        .map(|i| format!("{i}{}\n", "x".repeat(999)))
        .collect();
    let got = tail_excerpt(&wide).unwrap();
    assert!(got.len() <= EXCERPT_MAX_BYTES, "{}", got.len());
    assert!(
        got.starts_with('7') || got.starts_with('6'),
        "줄 머리에서 시작: {}",
        &got[..8]
    );

    // 한 줄이 상한보다 길면 그 줄의 꼬리 — 다중 바이트 문자 경계를 지킨다.
    let one = "가".repeat(3000); // 9000 바이트
    let got = tail_excerpt(&one).unwrap();
    assert!(got.len() <= EXCERPT_MAX_BYTES && got.chars().all(|c| c == '가'));
}

// ── 새 칸의 직렬화 · 옛 줄 호환 ─────────────────────────────────────────────

#[test]
fn new_fields_are_optional_and_old_lines_still_parse() {
    let rec = AuditRecord::approved(
        "op-1".into(),
        "uptime".into(),
        vec!["a".into()],
        "manual".into(),
        1,
    )
    .with_plan(
        Some("가동 시간".into()),
        Some("/srv".into()),
        Some("true".into()),
    );
    let json = serde_json::to_string(&rec).unwrap();
    assert!(json.contains("\"title\":\"가동 시간\""), "{json}");
    assert!(json.contains("\"cwd\":\"/srv\""), "{json}");
    assert!(json.contains("\"validate\":\"true\""), "{json}");

    // 비어 있으면 칸이 빠진다 — 출력 발췌를 끈 결과 줄에는 꼬리 칸이 없다.
    let r = AuditTargetResult {
        stream_id: "a".into(),
        state: "succeeded".into(),
        exit_code: Some(0),
        started_at: Some(10),
        ended_at: Some(20),
        ..Default::default()
    };
    let json = serde_json::to_string(&r).unwrap();
    assert!(
        json.contains("\"startedAt\":10") && json.contains("\"endedAt\":20"),
        "{json}"
    );
    assert!(!json.contains("Tail"), "{json}");

    // 2026-09-28 전의 줄 — 새 칸이 없어도 읽힌다.
    let old = r#"{"operationId":"x","event":"finished","command":"ls","targets":["a"],"at":5,"results":[{"streamId":"a","state":"failed","exitCode":1}],"state":"failed"}"#;
    let rec: AuditRecord = serde_json::from_str(old).expect("옛 줄");
    assert_eq!(rec.title, None);
    assert_eq!(rec.results[0].started_at, None);
    assert_eq!(rec.results[0].stdout_tail, None);
}

// ── 실행 기록 — 두 줄을 한 실행으로 ─────────────────────────────────────────

fn approved(id: &str, at: u64) -> AuditRecord {
    AuditRecord::approved(
        id.into(),
        format!("cmd-{id}"),
        vec!["a".into(), "b".into()],
        "auto".into(),
        at,
    )
    .with_labels(vec![AuditTargetLabel {
        id: "a".into(),
        label: "web-01".into(),
        code: "p1".into(),
    }])
    .with_plan(Some(format!("title-{id}")), None, None)
}

fn finished(id: &str, at: u64, state: &str) -> AuditRecord {
    AuditRecord::finished(
        id.into(),
        format!("cmd-{id}"),
        vec!["a".into(), "b".into()],
        vec![AuditTargetResult {
            stream_id: "a".into(),
            state: "succeeded".into(),
            exit_code: Some(0),
            ..Default::default()
        }],
        state.into(),
        at,
    )
}

/// AI 가 쓴 설명 · 이유(승인 요약 10-22)는 `approved` 줄에 남아 기록 화면의 실행 한 건으로 간다 — 카드에서 접어 둔 이유를 "나중에
/// 기록에서" 볼 수 있게. 빈 글자는 남기지 않고, 옛 줄(칸 없음)은 `None`.
#[test]
fn ai_summary_and_reason_reach_the_run_record() {
    let rec = approved("op-ai", 10).with_ai_text(Some("로그 크기 보기".into()), Some("  디스크 경보가 와서  ".into()));
    let json = serde_json::to_string(&rec).unwrap();
    assert!(json.contains("\"summary\":\"로그 크기 보기\"") && json.contains("\"planReason\":\"디스크 경보가 와서\""), "{json}");
    let runs = join_runs(vec![finished("op-ai", 20, "succeeded"), rec, approved("op-old", 5)], 0, 10);
    assert_eq!(runs[0].summary.as_deref(), Some("로그 크기 보기"));
    assert_eq!(runs[0].reason.as_deref(), Some("디스크 경보가 와서"));
    assert_eq!(runs[1].summary, None);
    let empty = approved("op-e", 1).with_ai_text(Some("  ".into()), None);
    assert!(!serde_json::to_string(&empty).unwrap().contains("summary"));
}

#[test]
fn join_runs_pairs_approved_with_finished_newest_first() {
    // 최신순 입력(스캔 순서): op-2 끝 · op-3 승인(끝 없음) · op-2 승인 · op-1 끝 · 거절 · op-1 승인.
    let records = vec![
        finished("op-2", 40, "partial"),
        approved("op-3", 35),
        approved("op-2", 30),
        finished("op-1", 20, "succeeded"),
        AuditRecord::user_action("rejected", "op-r".into(), "rm".into(), vec![], 15),
        approved("op-1", 10),
    ];
    let runs = join_runs(records, 0, 100);
    let ids: Vec<&str> = runs.iter().map(|r| r.operation_id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["op-3", "op-2", "op-1"],
        "거절은 실행이 아니다 · 최신순"
    );
    assert_eq!(runs[0].state, None, "끝난 줄이 없으면 상태 없음");
    assert!(runs[0].results.is_empty());
    assert_eq!(runs[1].state.as_deref(), Some("partial"));
    assert_eq!(runs[1].finished_at, Some(40));
    assert_eq!(runs[1].title.as_deref(), Some("title-op-2"));
    assert_eq!(runs[1].approval_method.as_deref(), Some("auto"));
    assert_eq!(runs[1].target_labels[0].label, "web-01");
    assert_eq!(runs[2].results.len(), 1);
}

/// 사람의 취소 — 끝나기 전의 `cancelled` 줄이 그 실행에 `cancelled_by_user` 로 얹힌다(첫 취소 시각).
/// 끝난 뒤에 누른 취소는 얹히지 않는다. 취소 줄이 따로 실행 줄이 되지도 않는다.
#[test]
fn join_runs_marks_the_users_cancel_before_finish() {
    let cancel = |id: &str, at: u64| {
        AuditRecord::user_action("cancelled", id.into(), "x".into(), vec![], at)
    };
    let records = vec![
        cancel("op-late", 60), // 끝난 뒤 — 무시
        finished("op-late", 55, "succeeded"),
        approved("op-late", 50),
        finished("op-c", 40, "partial"),
        cancel("op-c", 35), // 두 번째 클릭
        cancel("op-c", 32), // 첫 클릭
        approved("op-c", 30),
        cancel("op-run", 25), // 끝난 줄이 아직 없다 — 그래도 사람이 멈췄다
        approved("op-run", 20),
    ];
    let runs = join_runs(records, 0, 100);
    let got: Vec<(&str, bool, Option<u64>)> = runs
        .iter()
        .map(|r| (r.operation_id.as_str(), r.cancelled_by_user, r.cancelled_at))
        .collect();
    assert_eq!(
        got,
        vec![
            ("op-late", false, None),
            ("op-c", true, Some(32)),
            ("op-run", true, Some(25))
        ]
    );
    assert_eq!(runs[1].state.as_deref(), Some("partial"), "집계는 그대로");
    let json = serde_json::to_string(&runs[1]).unwrap();
    assert!(
        json.contains("\"cancelledByUser\":true") && json.contains("\"cancelledAt\":32"),
        "{json}"
    );
}

#[test]
fn join_runs_respects_since_and_limit() {
    let records = vec![
        finished("op-3", 31, "succeeded"),
        approved("op-3", 30),
        approved("op-2", 20),
        approved("op-1", 10),
    ];
    let ids = |runs: Vec<AuditRun>| runs.into_iter().map(|r| r.operation_id).collect::<Vec<_>>();
    assert_eq!(
        ids(join_runs(records.clone(), 15, 100)),
        vec!["op-3", "op-2"],
        "since 보다 옛 실행은 빠진다"
    );
    assert_eq!(
        ids(join_runs(records.clone(), 0, 2)),
        vec!["op-3", "op-2"],
        "limit"
    );
    assert!(join_runs(records, 0, 0).is_empty());
}

/// 파일 둘에 걸친 실행 — 승인은 어제 파일, 끝은 오늘 파일(자정을 넘긴 실행)이어도 묶인다.
#[test]
fn read_runs_joins_across_day_files() {
    let tmp = TempDir::new();
    let line = |r: &AuditRecord| serde_json::to_string(r).unwrap() + "\n";
    std::fs::write(
        tmp.0.join(audit_file_name("20260927")),
        line(&approved("op-a", 1_000)) + &line(&approved("op-b", 2_000)),
    )
    .unwrap();
    std::fs::write(
        tmp.0.join(audit_file_name("20260928")),
        line(&finished("op-b", 3_000, "failed"))
            + "not json\n"
            + &line(&finished("op-a", 4_000, "succeeded")),
    )
    .unwrap();
    let runs = read_runs_in(&tmp.0, 0, 100);
    let got: Vec<(String, Option<String>)> = runs
        .iter()
        .map(|r| (r.operation_id.clone(), r.state.clone()))
        .collect();
    assert_eq!(
        got,
        vec![
            ("op-b".to_string(), Some("failed".to_string())),
            ("op-a".to_string(), Some("succeeded".to_string()))
        ]
    );
}

/// std 만으로 만드는 임시 디렉터리(session_log 테스트와 같은 방식).
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "aynx-audit-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("임시 디렉터리 생성");
        TempDir(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 파일 내용이 확정될 때까지(= 쓰기 스레드가 끝날 때까지) 기다렸다 읽는다.
fn read_when_lines(path: &std::path::Path, want: usize) -> Vec<String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let content = std::fs::read_to_string(path).unwrap_or_default();
        let lines: Vec<String> = content.lines().map(str::to_string).collect();
        if lines.len() >= want {
            return lines;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "기대한 줄 수가 안 나왔다: {content:?}"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[test]
fn file_name_has_the_expected_shape() {
    assert_eq!(audit_file_name("20260910"), "audit-20260910.jsonl");
    // 실제 날짜 스탬프도 8자리 숫자다.
    let d = today_stamp();
    assert_eq!(d.len(), 8, "{d}");
    assert!(d.chars().all(|c| c.is_ascii_digit()), "{d}");
}

#[test]
fn approved_record_serializes_as_camel_case() {
    let rec = AuditRecord::approved(
        "op-1".into(),
        "systemctl restart nginx".into(),
        vec!["web-1".into(), "web-2".into()],
        "manual".into(),
        1234,
    );
    let json = serde_json::to_string(&rec).unwrap();
    assert!(json.contains("\"operationId\":\"op-1\""), "{json}");
    assert!(json.contains("\"event\":\"approved\""), "{json}");
    assert!(json.contains("\"approvalMethod\":\"manual\""), "{json}");
    assert!(json.contains("\"at\":1234"), "{json}");
    // approved 에는 결과·집계 상태가 없다(직렬화에서 빠진다).
    assert!(!json.contains("\"results\""), "{json}");
    assert!(!json.contains("\"state\""), "{json}");
}

#[test]
fn finished_record_serializes_with_per_target_results_and_aggregate() {
    let rec = AuditRecord::finished(
        "op-1".into(),
        "uptime".into(),
        vec!["web-1".into()],
        vec![AuditTargetResult {
            stream_id: "web-1".into(),
            state: "succeeded".into(),
            exit_code: Some(0),
            ..Default::default()
        }],
        "succeeded".into(),
        5678,
    );
    let json = serde_json::to_string(&rec).unwrap();
    assert!(json.contains("\"event\":\"finished\""), "{json}");
    assert!(json.contains("\"streamId\":\"web-1\""), "{json}");
    assert!(json.contains("\"exitCode\":0"), "{json}");
    assert!(json.contains("\"state\":\"succeeded\""), "{json}");
    // finished 에는 승인 방식이 없다.
    assert!(!json.contains("\"approvalMethod\""), "{json}");
}

/// 계측이 남기는 두 행(approved → finished)이 JSONL 로 그대로 append 된다.
#[test]
fn writer_appends_approved_then_finished_as_two_jsonl_lines() {
    let tmp = TempDir::new();
    let tx = spawn_writer_in(
        tmp.0.clone(),
        Arc::new(AuditHealth::default()),
        no_retention,
    );

    tx.send(AuditRecord::approved(
        "op-1".into(),
        "uptime".into(),
        vec!["web-1".into()],
        "manual".into(),
        1,
    ))
    .expect("전송");
    tx.send(AuditRecord::finished(
        "op-1".into(),
        "uptime".into(),
        vec!["web-1".into()],
        vec![AuditTargetResult {
            stream_id: "web-1".into(),
            state: "succeeded".into(),
            exit_code: Some(0),
            ..Default::default()
        }],
        "succeeded".into(),
        2,
    ))
    .expect("전송");
    drop(tx); // 스레드가 flush 하고 끝나게 한다.

    let path = tmp.0.join(audit_file_name(&today_stamp()));
    let lines = read_when_lines(&path, 2);
    assert_eq!(lines.len(), 2, "{lines:?}");

    let first: AuditRecord = serde_json::from_str(&lines[0]).expect("첫 줄 파싱");
    let second: AuditRecord = serde_json::from_str(&lines[1]).expect("둘째 줄 파싱");
    assert_eq!(first.event, "approved");
    assert_eq!(first.approval_method.as_deref(), Some("manual"));
    assert_eq!(second.event, "finished");
    assert_eq!(second.state.as_deref(), Some("succeeded"));
    assert_eq!(second.results.len(), 1);
    assert_eq!(second.results[0].stream_id, "web-1");
}

/// 같은 파일에 이어 붙인다(append) — 앞 내용을 지우지 않는다.
#[test]
fn writer_appends_rather_than_truncates() {
    let tmp = TempDir::new();
    let path = tmp.0.join(audit_file_name(&today_stamp()));
    std::fs::write(&path, b"{\"pre\":true}\n").expect("사전 쓰기");

    let tx = spawn_writer_in(
        tmp.0.clone(),
        Arc::new(AuditHealth::default()),
        no_retention,
    );
    tx.send(AuditRecord::approved(
        "op-2".into(),
        "ls".into(),
        vec!["a".into()],
        "manual".into(),
        9,
    ))
    .expect("전송");
    drop(tx);

    let lines = read_when_lines(&path, 2);
    assert_eq!(lines[0], "{\"pre\":true}", "앞 내용이 남아 있다: {lines:?}");
    assert!(lines[1].contains("\"operationId\":\"op-2\""), "{lines:?}");
}

/// 건강 카운터 — 성공 쓰기마다 written 이 오르고 last_ok_at 이 찍히며, 스레드 수명에 따라
/// running 이 토글된다.
#[test]
fn writer_counts_written_and_toggles_running() {
    let tmp = TempDir::new();
    let health = Arc::new(AuditHealth::default());
    let tx = spawn_writer_in(tmp.0.clone(), Arc::clone(&health), no_retention);
    assert!(health.running.load(Ordering::Relaxed), "스폰 직후 running");

    for i in 0..3 {
        tx.send(AuditRecord::approved(
            format!("op-{i}"),
            "uptime".into(),
            vec!["a".into()],
            "manual".into(),
            i,
        ))
        .expect("전송");
    }
    // 세 줄이 파일에 확정될 때까지 기다린다(= 쓰기 스레드가 처리했다).
    let path = tmp.0.join(audit_file_name(&today_stamp()));
    read_when_lines(&path, 3);

    assert_eq!(health.written.load(Ordering::Relaxed), 3, "성공 쓰기 3");
    assert_eq!(health.failed.load(Ordering::Relaxed), 0, "실패 0");
    assert!(
        health.last_ok_at.load(Ordering::Relaxed) > 0,
        "성공 시각이 찍힌다"
    );

    drop(tx);
    // 채널이 닫히면 스레드가 끝나며 running=false.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while health.running.load(Ordering::Relaxed) {
        assert!(
            std::time::Instant::now() < deadline,
            "running 이 안 내려갔다"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// 파일을 못 열면 failed 가 오른다 — 감사 파일 이름 자리에 **디렉터리**를 놓아 append 를 막는다.
#[test]
fn writer_counts_failed_when_open_fails() {
    let tmp = TempDir::new();
    // 오늘 파일 이름과 같은 이름의 **디렉터리**를 만들어 두면 append 열기가 실패한다.
    std::fs::create_dir(tmp.0.join(audit_file_name(&today_stamp()))).expect("충돌 디렉터리");

    let health = Arc::new(AuditHealth::default());
    let tx = spawn_writer_in(tmp.0.clone(), Arc::clone(&health), no_retention);
    tx.send(AuditRecord::approved(
        "op-x".into(),
        "ls".into(),
        vec!["a".into()],
        "manual".into(),
        1,
    ))
    .expect("전송");
    drop(tx);

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if health.failed.load(Ordering::Relaxed) >= 1 {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "failed 가 안 올랐다");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert_eq!(health.written.load(Ordering::Relaxed), 0, "쓴 게 없다");
}

#[test]
fn reject_and_cancel_records_carry_the_event_and_labels() {
    let rej = AuditRecord::user_action(
        "rejected",
        "op-1".into(),
        "rm -rf /".into(),
        vec!["web-1".into()],
        10,
    )
    .with_labels(vec![AuditTargetLabel {
        id: "web-1".into(),
        label: "web-01".into(),
        code: "p2".into(),
    }]);
    let json = serde_json::to_string(&rej).unwrap();
    assert!(json.contains("\"event\":\"rejected\""), "{json}");
    assert!(json.contains("\"targetLabels\""), "{json}");
    assert!(json.contains("\"label\":\"web-01\""), "{json}");
    assert!(!json.contains("\"approvalMethod\""), "{json}");

    let can = AuditRecord::user_action("cancelled", "op-2".into(), "sleep 99".into(), vec![], 11);
    let json2 = serde_json::to_string(&can).unwrap();
    assert!(json2.contains("\"event\":\"cancelled\""), "{json2}");
    // 라벨이 없으면 필드가 빠진다.
    assert!(!json2.contains("\"targetLabels\""), "{json2}");
}

#[test]
fn read_recent_returns_newest_first_and_bounded() {
    // audit_dir 은 실제 데이터 폴더라 여기선 read_recent 알맹이 대신 정렬·역순 로직을 파일로 검증.
    // 파일 두 개(옛·새)에 여러 줄을 넣고, spawn_writer_in 이 아니라 직접 파싱 경로를 흉내낸다.
    let tmp = TempDir::new();
    std::fs::write(
        tmp.0.join(audit_file_name("20260101")),
        b"{\"operationId\":\"a\",\"event\":\"approved\",\"command\":\"x\",\"targets\":[],\"at\":1}\n\
              {\"operationId\":\"b\",\"event\":\"approved\",\"command\":\"x\",\"targets\":[],\"at\":2}\n",
    )
    .unwrap();
    std::fs::write(
        tmp.0.join(audit_file_name("20260102")),
        b"{\"operationId\":\"c\",\"event\":\"approved\",\"command\":\"x\",\"targets\":[],\"at\":3}\n",
    )
    .unwrap();

    let got = read_recent_in(&tmp.0, 2);
    let ids: Vec<&str> = got.iter().map(|r| r.operation_id.as_str()).collect();
    // 최신 파일(20260102)의 c 가 먼저, 그다음 옛 파일의 마지막 줄 b. limit=2 라 a 는 안 읽는다.
    assert_eq!(ids, vec!["c", "b"], "최신순·bounded");
}

/// 모두 승인(2026-10-23) — `approved` 줄의 `approveAll` 은 참일 때만 실리고(옛 줄 · 보통 자동 승인은 칸이 없다) 실행 기록으로 간다.
#[test]
fn approve_all_reaches_the_run_record() {
    let plain = serde_json::to_string(&approved("op-plain", 10)).unwrap();
    assert!(!plain.contains("approveAll"), "{plain}");
    let rec = approved("op-all", 20).with_approve_all(true);
    let json = serde_json::to_string(&rec).unwrap();
    assert!(json.contains("\"approveAll\":true"), "{json}");
    let back: AuditRecord = serde_json::from_str(&json).unwrap();
    assert!(back.approve_all);
    let runs = join_runs(vec![rec, approved("op-plain", 10)], 0, 10);
    assert!(runs.iter().find(|r| r.operation_id == "op-all").unwrap().approve_all);
    assert!(!runs.iter().find(|r| r.operation_id == "op-plain").unwrap().approve_all);
}
