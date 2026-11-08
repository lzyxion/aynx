use super::*;

// ── 자동 이름 ───────────────────────────────────────────────────────────

#[test]
fn splits_the_last_extension() {
    assert_eq!(split_extension("a.txt", false), ("a", ".txt"));
    // 점이 여럿이면 마지막에서 가른다 (탐색기와 같다)
    assert_eq!(split_extension("a.tar.gz", false), ("a.tar", ".gz"));
    // 맨 앞의 점은 확장자가 아니다
    assert_eq!(split_extension(".bashrc", false), (".bashrc", ""));
    assert_eq!(split_extension("README", false), ("README", ""));
    // 디렉터리는 통째로 이름이다
    assert_eq!(split_extension("v1.2", true), ("v1.2", ""));
}

#[test]
fn builds_the_next_name() {
    assert_eq!(candidate_name("a.txt", 2, false), "a (2).txt");
    assert_eq!(candidate_name("a.txt", 10, false), "a (10).txt");
    assert_eq!(candidate_name("logs", 2, true), "logs (2)");
    assert_eq!(candidate_name("logs", 2, false), "logs (2)");
    assert_eq!(candidate_name(".bashrc", 3, false), ".bashrc (3)");
    // 한글 이름도 바이트 경계를 깨지 않는다
    assert_eq!(candidate_name("설정.conf", 2, false), "설정 (2).conf");
    assert_eq!(candidate_name("보고서", 2, true), "보고서 (2)");
}

// ── 충돌 정책 ───────────────────────────────────────────────────────────

#[test]
fn empty_slot_needs_no_policy() {
    for policy in [
        OnConflict::Fail,
        OnConflict::Overwrite,
        OnConflict::Skip,
        OnConflict::Rename,
    ] {
        assert_eq!(
            decide(None, Kind::File, policy),
            Decision::Use { clear: false },
            "{policy:?}"
        );
    }
}

#[test]
fn applies_each_conflict_policy() {
    let existing = Some(Kind::File);
    assert_eq!(
        decide(existing, Kind::File, OnConflict::Fail),
        Decision::Fail
    );
    assert_eq!(
        decide(existing, Kind::File, OnConflict::Skip),
        Decision::Skip
    );
    assert_eq!(
        decide(existing, Kind::File, OnConflict::Rename),
        Decision::Rename
    );
    // 파일끼리는 지우지 않고 잘라 쓴다 (지운 뒤 실패하면 원본이 없어진다)
    assert_eq!(
        decide(existing, Kind::File, OnConflict::Overwrite),
        Decision::Use { clear: false }
    );
}

/// 디렉터리끼리는 **합친다**, 모양이 다르면 먼저 지운다.
#[test]
fn overwrite_merges_dirs_and_clears_mismatches() {
    assert_eq!(
        decide(Some(Kind::Dir), Kind::Dir, OnConflict::Overwrite),
        Decision::Use { clear: false }
    );
    assert_eq!(
        decide(Some(Kind::Dir), Kind::File, OnConflict::Overwrite),
        Decision::Use { clear: true }
    );
    assert_eq!(
        decide(Some(Kind::File), Kind::Dir, OnConflict::Overwrite),
        Decision::Use { clear: true }
    );
    // 링크는 제자리에 덮어쓸 수 없다 — 어느 쪽이든 먼저 지운다
    assert_eq!(
        decide(Some(Kind::Link), Kind::File, OnConflict::Overwrite),
        Decision::Use { clear: true }
    );
    assert_eq!(
        decide(Some(Kind::File), Kind::Link, OnConflict::Overwrite),
        Decision::Use { clear: true }
    );
}

// ── 프런트 계약 ─────────────────────────────────────────────────────────

#[test]
fn parses_the_policy_from_the_front() {
    let parse = |text: &str| serde_json::from_str::<OnConflict>(text).unwrap();
    assert_eq!(parse("\"fail\""), OnConflict::Fail);
    assert_eq!(parse("\"overwrite\""), OnConflict::Overwrite);
    assert_eq!(parse("\"skip\""), OnConflict::Skip);
    assert_eq!(parse("\"rename\""), OnConflict::Rename);
    assert!(serde_json::from_str::<OnConflict>("\"nope\"").is_err());
    // 못 물어봤으면 아무것도 없애지 않는다
    assert_eq!(OnConflict::default(), OnConflict::Fail);
}

#[test]
fn serializes_progress_as_camel_case() {
    let json = serde_json::to_string(&TransferProgress {
        op: 7,
        files_done: 1,
        files_total: 3,
        bytes_done: 10,
        bytes_total: 30,
        current: "/tmp/a".to_string(),
    })
    .unwrap();
    assert!(json.contains("\"filesDone\":1"), "{json}");
    assert!(json.contains("\"filesTotal\":3"), "{json}");
    assert!(json.contains("\"bytesDone\":10"), "{json}");
    assert!(json.contains("\"bytesTotal\":30"), "{json}");
    assert!(json.contains("\"op\":7"), "{json}");
}

#[test]
fn serializes_conflict_kinds() {
    let json = serde_json::to_string(&Conflict {
        path: "/tmp/a".to_string(),
        kind: Kind::Dir.label().to_string(),
    })
    .unwrap();
    assert_eq!(json, "{\"path\":\"/tmp/a\",\"kind\":\"dir\"}");
    assert_eq!(Kind::File.label(), "file");
    // 링크는 한 항목이라 파일 쪽이다
    assert_eq!(Kind::Link.label(), "file");
}

// ── 취소 ────────────────────────────────────────────────────────────────
//
// 전역 맵을 테스트끼리 공유하므로 번호를 겹치지 않게 크게 잡는다
// (`sftp` · `port_forward` 테스트와 같은 규칙).

#[test]
fn cancel_raises_the_flag() {
    let cancel = Cancel::claim(900_001);
    assert!(!cancel.stopped());
    assert!(cancel.check().is_ok());

    transfer_cancel(900_001).unwrap();
    assert!(cancel.stopped());
    assert_eq!(cancel.check().unwrap_err(), crate::errors::cancelled());
}

/// 명령이 시작하기 **전에** 누른 취소도 유실되지 않는다.
#[test]
fn cancel_before_the_transfer_starts() {
    transfer_cancel(900_002).unwrap();
    let cancel = Cancel::claim(900_002);
    assert!(cancel.stopped());
}

/// 끝난 전송의 취소가 다음 전송에 남으면 안 된다.
#[test]
fn the_flag_dies_with_the_transfer() {
    let first = Cancel::claim(900_003);
    transfer_cancel(900_003).unwrap();
    assert!(first.stopped());
    drop(first);

    let second = Cancel::claim(900_003);
    assert!(!second.stopped());
}

/// 취소가 없는 경로는 깃발이 서지 않는다.
#[test]
fn inert_cancels_never_stop() {
    let cancel = Cancel::inert();
    transfer_cancel(0).unwrap(); // 0 번을 취소해도 무관하다
    assert!(!cancel.stopped());
    assert!(cancel.check().is_ok());
}

/// 임자 없는 깃발이 쌓이면 버린다 — **실행 중인 전송의 것은 살아남는다**.
/// (전역 맵을 부풀리면 다른 테스트를 밟으므로 맵 하나를 따로 만들어 본다.)
#[test]
fn prunes_unclaimed_flags() {
    let mut map: HashMap<u64, Slot> = (0..CANCEL_LIMIT as u64)
        .map(|op| {
            (
                op,
                Slot {
                    flag: Arc::new(AtomicBool::new(false)),
                    // 열에 하나만 실제로 전송이 집었다
                    claimed: op % 10 == 0,
                },
            )
        })
        .collect();

    prune(&mut map);
    assert_eq!(
        map.len(),
        CANCEL_LIMIT / 10 + usize::from(!CANCEL_LIMIT.is_multiple_of(10))
    );
    assert!(map.values().all(|slot| slot.claimed));

    // 아직 안 부풀었으면 아무것도 버리지 않는다
    let before = map.len();
    prune(&mut map);
    assert_eq!(map.len(), before);
}
