use super::*;

use std::time::Duration;

use russh_sftp::protocol::FileAttributes;

use crate::fs_transfer::{candidate_name, Kind};
use crate::sftp::{join_remote, normalize_remote};

// ── 종류 매핑 ───────────────────────────────────────────────────────────

#[test]
fn maps_kind_from_file_type_bits() {
    assert_eq!(kind_from_mode(0o040755), "dir"); // S_IFDIR
    assert_eq!(kind_from_mode(0o100644), "file"); // S_IFREG
    assert_eq!(kind_from_mode(0o120777), "symlink"); // S_IFLNK
    assert_eq!(kind_from_mode(0o010600), "other"); // fifo
    assert_eq!(kind_from_mode(0o140755), "other"); // socket
    assert_eq!(kind_from_mode(0o060600), "other"); // block device
}

/// 종류 비트가 아예 없으면(서버가 permissions 를 안 줬을 때) 거짓말하지 않는다.
#[test]
fn unknown_mode_is_other() {
    assert_eq!(kind_from_mode(0), "other");
    assert_eq!(kind_from_mode(0o644), "other");
}

#[test]
fn keeps_only_permission_bits() {
    assert_eq!(permission_bits(0o100644), 0o644);
    assert_eq!(permission_bits(0o040755), 0o755);
    // setuid·sticky 는 살린다 (목록에 보여 줄 값이다)
    assert_eq!(permission_bits(0o104755), 0o4755);
    assert_eq!(permission_bits(0o041777), 0o1777);
}

// ── `~`·상대 경로 잇기 ──────────────────────────────────────────────────

#[test]
fn joins_relative_paths_onto_home() {
    assert_eq!(join_home("/home/wl", "logs"), "/home/wl/logs");
    assert_eq!(join_home("/home/wl", "a/b"), "/home/wl/a/b");
    // `~` 만 있었던 경우 — normalize_remote 이 "." 으로 준다
    assert_eq!(join_home("/home/wl", "."), "/home/wl");
    assert_eq!(join_home("/home/wl", ""), "/home/wl");
    // 홈이 루트인 계정(root)에서 슬래시가 겹치면 안 된다
    assert_eq!(join_home("/", "logs"), "/logs");
    assert_eq!(join_home("/", "."), "/");
    // 서버가 꼬리 슬래시를 붙여 준 경우
    assert_eq!(join_home("/home/wl/", "logs"), "/home/wl/logs");
}

/// `normalize_remote` → `join_home` 까지가 프런트가 보는 경로 계약이다.
#[test]
fn tilde_paths_resolve_under_home() {
    let home = "/home/wl";
    let resolve = |p: &str| {
        let n = normalize_remote(p).unwrap();
        if n.starts_with('/') {
            n
        } else {
            join_home(home, &n)
        }
    };
    assert_eq!(resolve("~/logs"), "/home/wl/logs");
    assert_eq!(resolve("~"), "/home/wl");
    assert_eq!(resolve("~/"), "/home/wl");
    assert_eq!(resolve("logs/nginx"), "/home/wl/logs/nginx");
    assert_eq!(resolve("."), "/home/wl");
    // 절대 경로는 손대지 않는다 (심링크도 그대로 둔다)
    assert_eq!(resolve("/usr/bin/python"), "/usr/bin/python");
    assert_eq!(resolve("/"), "/");
}

#[test]
fn trims_and_names_paths() {
    assert_eq!(trim_dir("/etc/"), "/etc");
    assert_eq!(trim_dir("/"), "/");
    assert_eq!(trim_dir("///"), "/");
    assert_eq!(leaf_name("/etc/nginx/nginx.conf"), "nginx.conf");
    assert_eq!(leaf_name("/etc/"), "etc");
    assert_eq!(leaf_name("/"), "/");
}

// ── 삭제 보호 ───────────────────────────────────────────────────────────

#[test]
fn protects_root_and_home() {
    let home = "/home/wl";
    assert!(is_protected("/", home));
    assert!(is_protected("/home/wl", home));
    assert!(is_protected("/home/wl/", home)); // 꼬리 슬래시로 우회하지 못한다
    assert!(!is_protected("/home/wl/logs", home));
    assert!(!is_protected("/home/wl2", home)); // 접두사만 같은 남의 홈
    assert!(!is_protected("/etc", home));
}

/// 홈이 루트인 계정에서는 홈 검사와 루트 검사가 같은 자리에 겹친다.
#[test]
fn protects_root_home_account() {
    assert!(is_protected("/", "/"));
    assert!(!is_protected("/etc", "/"));
}

// ── 목록 한 줄 만들기 ───────────────────────────────────────────────────
//
// 정렬과 직렬화(camelCase)는 [`crate::fs_entry`] 의 테스트가 본다 — 로컬 브라우저와
// **같은 함수**를 쓰므로 규칙도 한 자리에서만 지킨다.

#[test]
fn builds_entry_from_attributes() {
    let meta = FileAttributes {
        size: Some(1234),
        permissions: Some(0o100644),
        mtime: Some(1_700_000_000),
        ..Default::default()
    };
    let e = entry_from("a.conf".to_string(), "/etc/a.conf".to_string(), &meta);
    assert_eq!(e.kind, "file");
    assert_eq!(e.size, 1234);
    assert_eq!(e.mode, Some(0o644));
    assert_eq!(e.mtime, Some(1_700_000_000));
    assert!(!e.link_is_dir);
    assert_eq!(e.symlink_target, None);
}

/// 서버가 속성을 비워 보내도 목록은 떠야 한다.
#[test]
fn tolerates_missing_attributes() {
    let e = entry_from(
        "x".to_string(),
        "/x".to_string(),
        &FileAttributes::default(),
    );
    assert_eq!(e.kind, "other");
    assert_eq!(e.size, 0);
    assert_eq!(e.mode, None);
    assert_eq!(e.mtime, None);
}

/// SFTP 항목은 **숨김을 모른다** (그 속성이 프로토콜에 없다) — `null` 로 나간다.
#[test]
fn sftp_entries_leave_hidden_unknown() {
    let e = entry_from(
        "x".to_string(),
        "/x".to_string(),
        &FileAttributes::default(),
    );
    assert_eq!(e.hidden, None);
}

// ── 다운로드 (진행률·임시 파일) ─────────────────────────────────────────

#[test]
fn names_the_partial_file() {
    assert_eq!(part_path("C:\\down\\a.tar.gz"), "C:\\down\\a.tar.gz.part");
    assert_eq!(part_path("/tmp/a"), "/tmp/a.part");
}

#[test]
fn reports_only_after_the_interval() {
    assert!(!should_report(0, Duration::from_secs(1))); // 받은 게 없으면 안 보낸다
    assert!(!should_report(CHUNK as u64, Duration::from_millis(10)));
    assert!(should_report(1, PROGRESS_INTERVAL));
    assert!(should_report(CHUNK as u64, Duration::from_secs(1)));
}

// ── 묶음 작업의 순수 부분 ───────────────────────────────────────────────
//
// 서버가 있어야 도는 부분(왕복이 붙는 계획·실행)은 여기서 보지 않는다. 실수가 나는
// 자리는 **경로 조합·자기 하위 판정·자동 이름** 셋이고, 그 셋은 순수 함수다.

#[test]
fn detects_self_and_descendants() {
    assert!(is_within("/a", "/a")); // 자기 자신
    assert!(is_within("/a", "/a/b"));
    assert!(is_within("/a/", "/a/b/c"));
    // 접두사만 같은 이웃은 하위가 아니다
    assert!(!is_within("/a", "/ab"));
    assert!(!is_within("/a/b", "/a"));
    // 원격은 대소문자를 가린다 (유닉스 서버가 그렇다)
    assert!(!is_within("/A", "/a/b"));
    // 루트는 모든 절대 경로의 조상이다
    assert!(is_within("/", "/etc/nginx"));
    assert!(is_within("/", "/"));
}

/// 붙여넣을 자리 = `join_remote(목적지, 원본의 마지막 이름)`. 이 조합이 틀어지면
/// 충돌 조회와 실제 복사가 서로 다른 자리를 본다.
#[test]
fn builds_the_target_path_from_the_leaf() {
    let target = |dest: &str, source: &str| join_remote(dest, leaf_name(source));
    assert_eq!(target("/backup", "/etc/nginx.conf"), "/backup/nginx.conf");
    assert_eq!(target("/backup/", "/etc/nginx"), "/backup/nginx");
    assert_eq!(target("/", "/etc/nginx.conf"), "/nginx.conf");
    assert_eq!(target("/home/wl", "/home/wl/a.txt"), "/home/wl/a.txt");
}

/// 자동 이름은 원격에서도 같은 규칙이다 (`crate::fs_transfer` 가 그 규칙을 갖는다).
#[test]
fn pushes_names_aside_the_same_way() {
    let next = |dir: &str, name: &str, index, is_dir| {
        join_remote(dir, &candidate_name(name, index, is_dir))
    };
    assert_eq!(next("/backup", "a.conf", 2, false), "/backup/a (2).conf");
    assert_eq!(next("/backup", "logs", 2, true), "/backup/logs (2)");
    assert_eq!(next("/", "설정.conf", 3, false), "/설정 (3).conf");
}

/// 복사 계획에 담기는 것은 **디렉터리와 보통 파일만**이다.
#[test]
fn only_dirs_and_files_are_copyable() {
    let attributes = |mode: u32, size: u64| FileAttributes {
        permissions: Some(mode),
        size: Some(size),
        ..Default::default()
    };
    assert_eq!(copyable(&attributes(0o040755, 4096)), Some((Kind::Dir, 0)));
    assert_eq!(
        copyable(&attributes(0o100644, 1234)),
        Some((Kind::File, 1234))
    );
    // 심링크는 서버에 다시 만들지 않는다 (`copyable` 주석 — SSH_FXP_SYMLINK 비호환)
    assert_eq!(copyable(&attributes(0o120777, 7)), None);
    // fifo·소켓·장치는 읽으면 매달린다
    assert_eq!(copyable(&attributes(0o010600, 0)), None);
    assert_eq!(copyable(&attributes(0o140755, 0)), None);
}

/// 충돌 판정에서 필요한 것은 "디렉터리인가" 뿐이다 — 특수 파일도 파일 쪽으로 접는다.
#[test]
fn folds_attributes_into_a_kind() {
    let attributes = |mode: u32| FileAttributes {
        permissions: Some(mode),
        ..Default::default()
    };
    assert_eq!(kind_from_attributes(&attributes(0o040755)), Kind::Dir);
    assert_eq!(kind_from_attributes(&attributes(0o100644)), Kind::File);
    assert_eq!(kind_from_attributes(&attributes(0o120777)), Kind::Link);
    assert_eq!(kind_from_attributes(&attributes(0o010600)), Kind::File);
}

// ── 서버 간 복사 · 다른 곳 사이의 이동 (순수 부분) ──────────────────────
//
// 두 서버가 필요한 부분은 여기서 보지 않는다. 실수가 나는 자리는 **양쪽 홈으로 따로
// 푸는 경로 · 최상위 항목의 걸음 경계 · 멈춘 자리 문구** 셋이고, 그 셋은 순수하다.

/// 서버 간 복사에서는 홈이 **둘**이다 — 각 경로가 자기 쪽 홈으로 풀려야 한다.
#[test]
fn resolves_each_side_against_its_own_home() {
    assert_eq!(under_home("/home/a", "~/logs").unwrap(), "/home/a/logs");
    assert_eq!(under_home("/srv/b", "~/logs").unwrap(), "/srv/b/logs");
    assert_eq!(
        under_home("/home/a", "logs/nginx").unwrap(),
        "/home/a/logs/nginx"
    );
    assert_eq!(under_home("/home/a", "~").unwrap(), "/home/a");
    // 절대 경로는 홈과 무관하다 (어느 서버에서 왔든 그대로다)
    assert_eq!(under_home("/home/a", "/srv/x").unwrap(), "/srv/x");
    assert_eq!(under_home("/", "logs").unwrap(), "/logs");
    // 위로 빠져나가는 요청은 `normalize_remote` 가 막는다
    assert!(under_home("/home/a", "../etc").is_err());
}

/// 이동의 원자성 단위 = **최상위 항목 하나**. 계획은 항목마다 걸음의 경계를 들고
/// 있어야 "여기까지 완전히 놓였다 → 이 항목의 원본을 지운다" 를 판정할 수 있다.
#[test]
fn tops_carve_the_plan_into_items() {
    let mut plan = Plan::default();
    let dir = |target: &str| Step::Dir {
        target: target.to_string(),
        clear: false,
        existed: false,
    };

    plan.top("/a/one".to_string(), "/b/one".to_string(), true);
    plan.steps.push(dir("/b/one"));
    plan.steps.push(dir("/b/one/x"));
    // 걸음이 하나도 없는 항목도 항목이다 (제자리·빈 디렉터리)
    plan.top("/a/two".to_string(), "/b/two".to_string(), false);
    plan.top("/a/three".to_string(), "/b/three".to_string(), true);
    plan.steps.push(dir("/b/three"));

    // 반환값은 **놓인 자리**들이다 (자동 이름으로 밀렸을 수 있다)
    assert_eq!(plan.made(), vec!["/b/one", "/b/two", "/b/three"]);
    assert_eq!(plan.span(0), 0..2);
    assert_eq!(plan.span(1), 2..2);
    // 마지막 항목은 계획의 끝까지다
    assert_eq!(plan.span(2), 2..3);
    assert!(plan.steps[plan.span(1)].is_empty());
    // 부분물을 치워도 되는 자리인가 — 합쳐 넣은 남의 자리는 아니다
    assert!(plan.tops[0].fresh);
    assert!(!plan.tops[1].fresh);
    assert_eq!(plan.tops[0].source, "/a/one");
}

/// 멈춘 자리를 말해 준다 — 이동은 되돌릴 수 없으므로 그것이 사용자가 다음에 무엇을
/// 할지 정할 수 있는 유일한 답이다.
#[test]
fn tells_where_the_move_stopped() {
    // 첫 항목에서 멈추면 셀 것이 없다 (원인 문구에 이미 경로가 들어 있다)
    let first = "/srv/a 을(를) 열지 못했습니다";
    assert_eq!(move_failure(0, first), first);

    let third = move_failure(2, "권한이 없습니다");
    assert!(
        third.starts_with("2개 이동 완료, 3번째에서 중단"),
        "{third}"
    );
    assert!(third.ends_with("권한이 없습니다"), "{third}");
    assert!(move_failure(1, "x").starts_with("1개 이동 완료, 2번째에서 중단"));

    // 취소도 같은 길로 나간다 — 프런트의 취소 판정이 **부분 일치**여야 하는 이유다
    let cancelled = crate::errors::cancelled();
    assert_eq!(move_failure(0, &cancelled), cancelled);
    assert!(crate::errors::is_cancelled(&move_failure(3, &cancelled)));
}

/// 청크를 몇 번 돌든 **보고값은 누적 총합**이고, 마지막 총합은 파일 크기와 같다.
#[test]
fn progress_is_cumulative_and_exact() {
    let size = 10 * CHUNK as u64 + 7; // 마지막 청크가 짧은 경우
    let mut total = 0u64;
    let mut reported = 0u64;
    let mut sends: Vec<u64> = Vec::new();
    let mut left = size;
    let mut elapsed = Duration::ZERO;

    while left > 0 {
        let read = left.min(CHUNK as u64);
        total += read;
        left -= read;
        // 세 청크마다 간격이 찬 것으로 친다
        elapsed += Duration::from_millis(40);
        if should_report(total - reported, elapsed) {
            sends.push(total);
            reported = total;
            elapsed = Duration::ZERO;
        }
    }

    assert_eq!(total, size);
    assert!(sends.len() < 11, "청크마다 보내면 안 된다: {sends:?}");
    assert!(
        sends.windows(2).all(|w| w[0] < w[1]),
        "누적이라 줄지 않는다"
    );
    assert!(sends.iter().all(|&s| s <= size));
}

// ── 덮어쓰기 저장(교체 · 보호된 제자리) ─────────────────────────────────

#[test]
fn splits_remote_save_targets() {
    use super::text::split_remote;
    assert_eq!(split_remote("/etc/nginx.conf"), ("/etc", "nginx.conf"));
    assert_eq!(split_remote("/a.txt"), ("/", "a.txt"));
    // 상대 경로(홈 기준) — 스니펫 `.aynx/integration.sh` · 외부 편집 `~/nginx.conf` → `nginx.conf`
    assert_eq!(split_remote(".aynx/integration.sh"), (".aynx", "integration.sh"));
    assert_eq!(split_remote("nginx.conf"), (".", "nginx.conf"));
    // 임시 파일은 대상과 같은 폴더에 생긴다 (rename 이 같은 파일 시스템 안에서 일어나게)
    let (dir, name) = split_remote("nginx.conf");
    let tmp = join_remote(dir, &crate::text_file::save_temp_name(name));
    assert!(tmp.starts_with(".nginx.conf.aynx-save-"), "{tmp}");
}

#[test]
fn in_place_failure_names_the_kept_temp_file() {
    use super::text::in_place_failure;
    let kept = in_place_failure("저장 실패".into(), Some("/etc/.a.conf.aynx-save-1-0"));
    assert!(kept.starts_with("저장 실패"), "{kept}");
    assert!(kept.contains("/etc/.a.conf.aynx-save-1-0"), "{kept}");
    // 임시 파일을 남기지 않았으면(치웠거나 만들 수 없었으면) 문구를 늘리지 않는다
    assert_eq!(in_place_failure("저장 실패".into(), None), "저장 실패");
}
