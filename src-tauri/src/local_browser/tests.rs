use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

// ── `\\?\` 떼기 ─────────────────────────────────────────────────────────

#[test]
fn strips_the_verbatim_prefix() {
    assert_eq!(strip_verbatim(r"\\?\C:\Users\wl"), r"C:\Users\wl");
    assert_eq!(strip_verbatim(r"\\?\C:\"), r"C:\");
    // UNC 는 `\\서버\공유` 로 되돌린다 (`\\?\UNC\` 를 그대로 두면 열리지 않는다)
    assert_eq!(
        strip_verbatim(r"\\?\UNC\server\share\x"),
        r"\\server\share\x"
    );
    // 접두사가 없으면 손대지 않는다
    assert_eq!(strip_verbatim(r"C:\Users\wl"), r"C:\Users\wl");
    assert_eq!(strip_verbatim("/home/wl"), "/home/wl");
    assert_eq!(strip_verbatim(r"\\server\share"), r"\\server\share");
    // 이름 안에 우연히 들어간 문자열은 접두사가 아니다
    assert_eq!(strip_verbatim(r"C:\a\\?\b"), r"C:\a\\?\b");
}

// ── 뿌리 판정 ───────────────────────────────────────────────────────────

#[test]
fn detects_roots() {
    assert!(is_root_path(r"C:\"));
    assert!(is_root_path("C:/")); // 프런트가 슬래시로 줘도 같은 자리다
    assert!(is_root_path("C:"));
    assert!(is_root_path(r"c:\")); // 소문자로 우회하지 못한다
    assert!(is_root_path("/"));
    assert!(is_root_path("//"));
    assert!(is_root_path(r"C:\\"));
    assert!(!is_root_path(r"C:\Users"));
    assert!(!is_root_path("/home"));
    assert!(!is_root_path(r"\\server\share")); // UNC 공유는 드라이브 루트가 아니다
}

#[test]
fn finds_the_drive_root_of_a_path() {
    assert_eq!(drive_root_of(r"C:\Users\wl"), Some(r"C:\".to_string()));
    assert_eq!(drive_root_of(r"d:\x"), Some(r"D:\".to_string()));
    assert_eq!(drive_root_of("/home/wl"), None);
    assert_eq!(drive_root_of(""), None);
}

/// 드라이브 루트·유닉스 루트에는 부모가 없다 — 위로 가는 버튼이 멈춰야 하는 자리다.
#[test]
fn roots_have_no_parent() {
    assert!(parent_of(Path::new("/")).is_err());
    assert!(parent_of(Path::new(r"C:\")).is_err());
    assert!(parent_of(Path::new(r"C:\Users")).is_ok());
    // 루트는 파일 이름이 없으므로 자기 자신이 이름이다
    assert_eq!(leaf_name(Path::new("/")), "/");
    assert_eq!(leaf_name(Path::new(r"C:\Users\wl")), "wl");
}

#[test]
fn drive_letters_come_from_the_bitmask() {
    assert_eq!(drives_from_mask(0), Vec::<String>::new());
    assert_eq!(drives_from_mask(0b101), vec![r"A:\", r"C:\"]);
    assert_eq!(drives_from_mask(1 << 25), vec![r"Z:\"]);
}

// ── 보호 ────────────────────────────────────────────────────────────────

#[test]
fn protects_drive_roots_and_home() {
    let home = Some(r"C:\Users\wl");
    assert!(is_protected(r"C:\", home));
    assert!(is_protected("D:/", home));
    assert!(is_protected("/", home));
    assert!(is_protected(r"C:\Users\wl", home));
    assert!(is_protected(r"C:\Users\wl\", home)); // 꼬리 슬래시로 우회하지 못한다
    assert!(!is_protected(r"C:\Users\wl\projects", home));
    assert!(!is_protected(r"C:\Users\wl2", home)); // 접두사만 같은 남의 홈
    assert!(!is_protected(r"C:\Windows", home));
}

/// 홈을 못 찾아도 뿌리 보호는 선다.
#[test]
fn protects_roots_without_a_home() {
    assert!(is_protected(r"C:\", None));
    assert!(!is_protected(r"C:\Users", None));
}

#[test]
fn compares_paths_the_way_the_os_does() {
    if cfg!(windows) {
        assert!(same_path(r"c:\users\WL", r"C:\Users\wl"));
    } else {
        assert!(!same_path("/home/WL", "/home/wl"));
    }
    assert!(same_path("/home/wl/", "/home/wl"));
    assert!(!same_path("/home/wl", "/home/wl2"));
}

// ── 입력 경로 ───────────────────────────────────────────────────────────

#[test]
fn accepts_both_separators_on_windows() {
    if cfg!(windows) {
        assert_eq!(normalize_input("C:/Users/wl"), r"C:\Users\wl");
        assert!(absolute_input("C:/Users").is_ok());
    } else {
        // 유닉스에서 역슬래시는 멀쩡한 파일 이름 글자다 — 건드리지 않는다
        assert_eq!(normalize_input(r"/home/a\b"), r"/home/a\b");
    }
}

#[test]
fn refuses_relative_paths() {
    assert!(absolute_input("projects").is_err());
    assert!(absolute_input("./x").is_err());
    assert!(absolute_input("..").is_err());
    assert!(absolute_input("   ").is_err());
    assert!(list("projects/aynx").is_err());
    assert!(mkdir("newdir").is_err());
    assert!(remove("x", true).is_err());
}

#[test]
fn tells_a_bare_name_from_a_path() {
    assert!(is_bare_name("새 폴더"));
    assert!(is_bare_name("a.txt"));
    assert!(!is_bare_name("a/b"));
    assert!(!is_bare_name(r"a\b"));
    assert!(!is_bare_name("C:x"));
    assert!(!is_bare_name(".."));
    assert!(!is_bare_name(""));
}

// ── 경로 순회 방어 (F1) ─────────────────────────────────────────────────
//
// `plan_download`(sftp_browser) 은 살아 있는 `SftpSession` 이 있어야 돌아 단위 테스트가
// 안 된다. 그래서 그 경로가 기대는 **순수 가드 함수**를 여기서 잠근다.

#[test]
fn is_bare_name_rejects_traversal_and_streams() {
    // 원격 목록이 줄 수 있는 이름들 — 하나라도 통과하면 dest 밖에 쓴다.
    for bad in ["x/..", "../evil", "..", ".", r"a\b", "a:b", ""] {
        assert!(!is_bare_name(bad), "{bad:?} 는 거부돼야 한다");
    }
    // 멀쩡한 이름은 그대로 통과한다(과잉 차단은 기능을 망가뜨린다).
    for ok in ["a.txt", "새 폴더", "my report v2"] {
        assert!(is_bare_name(ok), "{ok:?} 는 통과해야 한다");
    }
}

#[test]
fn place_at_rejects_non_bare_name() {
    let dest = Path::new(r"C:\dest");
    for bad in ["../evil", "..", r"a\b", "a:b", "/etc/passwd", ""] {
        assert!(
            place_at(dest, bad, Kind::File, OnConflict::Rename).is_err(),
            "{bad:?} 는 자리를 얻으면 안 된다"
        );
    }
}

#[test]
fn contained_in_blocks_escape() {
    let root = Path::new(r"C:\dest");
    assert!(contained_in(root, Path::new(r"C:\dest\a\b")));
    assert!(!contained_in(root, Path::new(r"C:\dest2\x"))); // 접두사만 같은 이웃
    assert!(!contained_in(root, Path::new(r"C:\other")));
    assert!(!contained_in(root, root)); // 자기 자신은 "아래" 가 아니다
}

// ── 속성 매핑 ───────────────────────────────────────────────────────────

#[test]
fn maps_the_hidden_attribute() {
    assert!(hidden_from_attributes(FILE_ATTRIBUTE_HIDDEN));
    assert!(hidden_from_attributes(0x22)); // HIDDEN | ARCHIVE
    assert!(!hidden_from_attributes(0x20)); // ARCHIVE 만
    assert!(!hidden_from_attributes(0));
}

#[test]
fn reads_directory_bit_from_attributes() {
    assert!(is_directory_attribute(FILE_ATTRIBUTE_DIRECTORY));
    assert!(is_directory_attribute(0x410)); // DIRECTORY | REPARSE_POINT
    assert!(!is_directory_attribute(0x400)); // REPARSE_POINT 만 (파일 심링크)
}

#[test]
fn converts_file_times_to_unix_seconds() {
    let epoch = UNIX_EPOCH;
    assert_eq!(secs_since_epoch(epoch), 0);
    assert_eq!(
        secs_since_epoch(epoch + std::time::Duration::from_secs(1_700_000_000)),
        1_700_000_000
    );
    // 시계가 틀어진 채 만들어진 파일 — 음수로 준다 (0 으로 뭉개지 않는다)
    assert_eq!(
        secs_since_epoch(epoch - std::time::Duration::from_secs(86_400)),
        -86_400
    );
}

// ── 실제 파일시스템 ─────────────────────────────────────────────────────

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// 테스트용 임시 디렉터리. **실경로**로 돌려주므로 명령이 준 경로와 그대로 비교할
/// 수 있다 (윈도우의 `TEMP` 에는 8.3 짧은 이름이 섞여 들어온다).
fn temp_root(tag: &str) -> PathBuf {
    let serial = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("aynx-local-{}-{tag}-{serial}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::canonicalize(&dir).unwrap()
}

fn at(dir: &Path, name: &str) -> String {
    show(&dir.join(name))
}

fn names(entries: &[SftpEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.name.as_str()).collect()
}

/// 문서 보기 읽기 — 작은 파일은 통째로, 큰 파일은 앞 2 MiB 만, 폴더는 오류.
#[test]
fn read_text_reads_bounded_and_rejects_folders() {
    let root = temp_root("read-text");
    std::fs::write(root.join("a.md"), "# 제목\n").unwrap();
    let small = read_text(&at(&root, "a.md")).unwrap();
    assert_eq!(small.text, "# 제목\n");
    assert!(!small.truncated && !small.binary && !small.lossy);

    let big = vec![b'x'; VIEW_MAX_BYTES as usize + 10];
    std::fs::write(root.join("big.log"), &big).unwrap();
    let cut = read_text(&at(&root, "big.log")).unwrap();
    assert!(cut.truncated);
    assert_eq!(cut.size, VIEW_MAX_BYTES + 10);
    assert_eq!(cut.text.len() as u64, VIEW_MAX_BYTES);

    assert!(read_text(&show(&root)).is_err());
    assert!(read_text(&at(&root, "missing.txt")).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

/// 폴더에 저장 임시 파일(`.aynx-save-`)이 남지 않았는가.
fn no_save_temps(dir: &Path) -> bool {
    std::fs::read_dir(dir).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".aynx-save-")
    })
}

/// 저장 — 맞는 version 이면 쓰고 새 version 을 돌려준다(= 다음 읽기의 version),
/// 없는 version(null)이면 확인 없이 쓴다. 임시 파일은 남지 않는다.
#[test]
fn write_text_saves_and_returns_the_next_version() {
    let root = temp_root("write-ok");
    std::fs::write(root.join("a.md"), "옛 내용\r\n").unwrap();
    let path = at(&root, "a.md");
    let before = read_text(&path).unwrap().version;

    let saved = write_text(&path, "새 내용\r\n끝", Some(&before)).unwrap();
    assert_eq!(
        std::fs::read(root.join("a.md")).unwrap(),
        "새 내용\r\n끝".as_bytes()
    );
    let after = read_text(&path).unwrap();
    assert_eq!(saved.version, after.version);
    assert_eq!(saved.size, after.size);

    // 강제 저장(expected 없음)
    let forced = write_text(&path, "x", None).unwrap();
    assert_eq!(forced.size, 1);
    assert_eq!(std::fs::read_to_string(root.join("a.md")).unwrap(), "x");
    assert!(no_save_temps(&root));
    let _ = std::fs::remove_dir_all(&root);
}

/// 디스크가 편집 시작 뒤 바뀌었으면 `[conflict]` 이고 **쓰지 않는다**. 파일이 없으면 `[missing]`.
#[test]
fn write_text_refuses_a_stale_version_and_a_missing_file() {
    let root = temp_root("write-conflict");
    std::fs::write(root.join("a.txt"), "one").unwrap();
    let path = at(&root, "a.txt");
    let stale = read_text(&path).unwrap().version;
    std::fs::write(root.join("a.txt"), "two (밖에서 고침)").unwrap();

    let err = write_text(&path, "mine", Some(&stale)).unwrap_err();
    assert!(
        crate::errors::has_reason(&err, crate::errors::CONFLICT),
        "{err}"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("a.txt")).unwrap(),
        "two (밖에서 고침)"
    );

    let gone = at(&root, "gone.txt");
    for expected in [Some(stale.as_str()), None] {
        let err = write_text(&gone, "mine", expected).unwrap_err();
        assert!(
            crate::errors::has_reason(&err, crate::errors::MISSING),
            "{err}"
        );
    }
    assert!(
        !root.join("gone.txt").exists(),
        "저장은 파일을 새로 만들지 않는다"
    );
    // 폴더는 저장 대상이 아니다
    assert!(write_text(&show(&root), "x", None).is_err());
    // 2 MiB 를 넘는 글은 거절
    let big = "x".repeat(VIEW_MAX_BYTES as usize + 1);
    assert!(write_text(&path, &big, None).is_err());
    assert!(no_save_temps(&root));
    let _ = std::fs::remove_dir_all(&root);
}

/// 읽기 전용 파일은 저장하지 않는다 (윈도우는 읽기 전용 속성, 유닉스는 쓰기 비트 없음).
#[test]
fn write_text_refuses_a_read_only_file() {
    let root = temp_root("write-ro");
    let file = root.join("ro.txt");
    std::fs::write(&file, "keep").unwrap();
    let mut perms = std::fs::metadata(&file).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&file, perms.clone()).unwrap();

    assert!(write_text(&at(&root, "ro.txt"), "changed", None).is_err());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "keep");
    assert!(no_save_temps(&root));

    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(&file, perms).unwrap();
    let _ = std::fs::remove_dir_all(&root);
}

/// 심링크 경로로 저장하면 **대상 파일**이 바뀌고 링크는 링크로 남는다.
/// (윈도우에서 심링크를 만들 권한이 없으면 — 개발자 모드 꺼짐 — 건너뛴다.)
#[test]
fn write_text_through_a_symlink_keeps_the_link() {
    let root = temp_root("write-link");
    std::fs::write(root.join("real.conf"), "a=1\n").unwrap();
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(root.join("real.conf"), root.join("link.conf"));
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(root.join("real.conf"), root.join("link.conf"));
    if made.is_err() {
        let _ = std::fs::remove_dir_all(&root);
        return;
    }
    let link = at(&root, "link.conf");
    let before = read_text(&link).unwrap().version;
    write_text(&link, "a=2\n", Some(&before)).unwrap();

    assert!(std::fs::symlink_metadata(root.join("link.conf"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        std::fs::read_to_string(root.join("real.conf")).unwrap(),
        "a=2\n"
    );
    assert!(no_save_temps(&root));
    let _ = std::fs::remove_dir_all(&root);
}

/// 유닉스 — 원본의 권한 비트(실행 비트 포함)가 교체 뒤에도 그대로다.
#[cfg(unix)]
#[test]
fn write_text_keeps_the_mode() {
    let root = temp_root("write-mode");
    let file = root.join("run.sh");
    std::fs::write(&file, "#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o750)).unwrap();
    write_text(&at(&root, "run.sh"), "#!/bin/sh\necho hi\n", None).unwrap();
    let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode, 0o750);
    let _ = std::fs::remove_dir_all(&root);
}

/// 윈도우 — 숨김 속성이 교체 뒤에도 그대로다.
#[cfg(windows)]
#[test]
fn write_text_keeps_the_hidden_attribute() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = temp_root("write-hidden");
    let file = root.join("hidden.txt");
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .attributes(FILE_ATTRIBUTE_HIDDEN)
        .open(&file)
        .unwrap()
        .write_all(b"old")
        .unwrap();
    write_text(&at(&root, "hidden.txt"), "new", None).unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "new");
    let attrs = std::fs::metadata(&file).unwrap().file_attributes();
    assert_ne!(attrs & FILE_ATTRIBUTE_HIDDEN, 0);
    assert!(no_save_temps(&root));
    let _ = std::fs::remove_dir_all(&root);
}

/// 만들기 → 목록 → 이름 바꾸기 → 지우기 한 바퀴. 돌려주는 경로는 언제나
/// `\\?\` 없는 절대 경로다.
#[test]
fn creates_lists_renames_and_removes() {
    let root = temp_root("crud");

    let made = mkdir(&at(&root, "logs")).unwrap();
    assert_eq!(made, at(&root, "logs"));
    assert!(!made.starts_with(r"\\?\"), "{made}");
    std::fs::write(root.join("b.txt"), b"hello").unwrap();

    let listed = list(&show(&root)).unwrap();
    assert_eq!(names(&listed), vec!["logs", "b.txt"]); // 디렉터리가 먼저다
    assert_eq!(listed[0].kind, "dir");
    assert_eq!(listed[1].kind, "file");
    assert_eq!(listed[1].size, 5);
    assert!(listed[1].mtime.unwrap() > 1_600_000_000);
    assert_eq!(listed[1].hidden, Some(false));
    assert_eq!(listed[1].path, at(&root, "b.txt"));
    assert!(!listed[1].link_is_dir);

    // 이름 한 조각으로 바꾸면 같은 부모 아래에 선다
    let renamed = rename(&at(&root, "b.txt"), "c.txt").unwrap();
    assert_eq!(renamed, at(&root, "c.txt"));
    // 절대 경로로도 받는다 (윈도우에서는 `/` 로 줘도 같은 자리다)
    let moved = rename(&renamed, &at(&root, "logs/d.txt")).unwrap();
    assert_eq!(moved, show(&root.join("logs").join("d.txt")));

    let one = stat(&moved).unwrap();
    assert_eq!(one.name, "d.txt");
    assert_eq!(one.kind, "file");

    remove(&moved, false).unwrap();
    remove(&at(&root, "logs"), false).unwrap();
    assert!(list(&show(&root)).unwrap().is_empty());

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn refuses_to_remove_a_non_empty_directory_without_recursive() {
    let root = temp_root("nonempty");
    std::fs::create_dir(root.join("tree")).unwrap();
    std::fs::write(root.join("tree").join("a.txt"), b"x").unwrap();

    let error = remove(&at(&root, "tree"), false).unwrap_err();
    assert!(
        crate::errors::has_reason(&error, crate::errors::NOT_EMPTY),
        "{error}"
    );
    assert!(root.join("tree").exists());

    remove(&at(&root, "tree"), true).unwrap();
    assert!(!root.join("tree").exists());

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn refuses_to_overwrite_an_existing_name() {
    let root = temp_root("clash");
    std::fs::write(root.join("a.txt"), b"a").unwrap();
    std::fs::write(root.join("b.txt"), b"b").unwrap();

    let error = rename(&at(&root, "a.txt"), "b.txt").unwrap_err();
    assert!(
        crate::errors::has_reason(&error, crate::errors::EXISTS),
        "{error}"
    );
    assert_eq!(std::fs::read(root.join("b.txt")).unwrap(), b"b");

    let error = mkdir(&at(&root, "a.txt")).unwrap_err();
    assert!(
        crate::errors::has_reason(&error, crate::errors::EXISTS),
        "{error}"
    );

    // 새 파일 — 빈 파일 하나, 이미 있으면(파일이든 폴더든) 덮어쓰지 않고 거절
    let made = create_file(&at(&root, "new.txt")).unwrap();
    assert_eq!(made, at(&root, "new.txt"));
    assert_eq!(std::fs::read(root.join("new.txt")).unwrap(), b"");
    for taken in ["a.txt", "new.txt"] {
        let error = create_file(&at(&root, taken)).unwrap_err();
        assert!(crate::errors::has_reason(&error, crate::errors::EXISTS), "{error}");
    }
    assert_eq!(std::fs::read(root.join("a.txt")).unwrap(), b"a", "있던 파일은 그대로");

    let _ = std::fs::remove_dir_all(&root);
}

/// 뿌리와 홈은 어떤 경로 모양으로 와도 막힌다.
#[test]
fn refuses_to_touch_roots_and_home() {
    let root_path = if cfg!(windows) { r"C:\" } else { "/" };
    let error = remove(root_path, true).unwrap_err();
    assert!(error.contains("지울 수 없습니다"), "{error}");
    assert!(rename(root_path, "x").is_err());

    if let Ok(home) = home() {
        let error = remove(&home, true).unwrap_err();
        assert!(error.contains("지울 수 없습니다"), "{error}");
        let error = rename(&home, "wl2").unwrap_err();
        assert!(error.contains("이름을 바꿀 수 없습니다"), "{error}");
    }
}

#[test]
fn home_and_roots_are_absolute_and_stripped() {
    let home = home().unwrap();
    assert!(Path::new(&home).is_absolute(), "{home}");
    assert!(!home.starts_with(r"\\?\"), "{home}");

    let roots = roots();
    assert!(!roots.is_empty());
    for root in &roots {
        assert!(is_root_path(root), "{root}");
        assert!(!root.starts_with(r"\\?\"), "{root}");
    }
    if cfg!(windows) {
        // 홈이 있는 드라이브는 반드시 목록에 있다
        let drive = drive_root_of(&home).unwrap();
        assert!(roots.contains(&drive), "{roots:?} 에 {drive} 가 없다");
    } else {
        assert_eq!(roots, vec!["/".to_string()]);
    }
}

/// WSL 배포판의 루트를 **UNC 로** 목록할 수 있어야 한다 —
/// WSL 타일의 📂 가 `\\wsl.localhost\<배포판>\<경로>` 를 그대로 던지기 때문이다
/// (docs/log/2026-09-08-wsl-cwd-hook.md의 경로 매핑 ②).
///
/// 지나는 길이 두 군데 위험하다: `real_path` 의 `canonicalize` 가 UNC 를
/// `\\?\UNC\wsl.localhost\…` 로 바꾸고, 그 모양은 사용자에게 보일 값도 아니거니와
/// 프런트가 되돌려 보내면 다시 열리지도 않는다 — [`strip_verbatim`] 이 `\\wsl.localhost\…`
/// 로 되돌리는지 실기로 확인한다.
///
/// **WSL 이 없는 기계에서는 조용히 건너뛴다** (`Ubuntu-24.04` 라는 이름까지 고정이라
/// 다른 배포판만 있는 기계에서도 멈춘다) — 이 테스트는 CI 를 흔들 자격이 없다.
#[cfg(windows)]
#[test]
fn wsl_unc_paths_list_and_come_back_without_the_verbatim_prefix() {
    let root = r"\\wsl.localhost\Ubuntu-24.04\home";
    let Ok(entries) = list(root) else {
        return; // WSL 이 없거나 그 배포판이 없다
    };
    // 목록 자체가 나왔으면 경로 모양이 계약이다.
    for entry in &entries {
        assert!(!entry.path.starts_with(r"\\?\"), "{}", entry.path);
        assert!(
            entry.path.to_lowercase().starts_with(r"\\wsl.localhost\"),
            "{}",
            entry.path
        );
    }
    // 돌아온 경로를 그대로 다시 열 수 있어야 한다 (프런트가 하는 일이 그것이다).
    if let Some(dir) = entries.iter().find(|e| e.kind == "dir") {
        assert!(list(&dir.path).is_ok(), "{}", dir.path);
    }
    // 배포판 루트(= 공유의 뿌리)도 열려야 한다 — 셸이 `/` 에 있으면 그 경로가 온다.
    assert!(list(r"\\wsl.localhost\Ubuntu-24.04").is_ok());
}

/// 디렉터리 링크를 만든다. 만들지 못하면 `false` (테스트는 조용히 멈춘다).
///
/// 윈도우에서 **심링크**를 만들려면 관리자 권한이나 개발자 모드가 있어야 한다.
/// 없으면 **정션**(`mklink /J`)으로 물러선다 — 정션은 권한이 필요 없고, 이 모듈이
/// 지나는 길은 정확히 같다: 둘 다 name-surrogate reparse point 라 `is_symlink()`
/// 가 참이고, 디렉터리 쪽이라 `remove_dir` 로 링크만 지워야 한다.
#[cfg(windows)]
fn link_dir(target: &Path, link: &Path) -> bool {
    if std::os::windows::fs::symlink_dir(target, link).is_ok() {
        return true;
    }
    // `mklink` 는 cmd 내장 명령이라 셸을 거쳐야 한다. verbatim 경로는 받지 못하므로
    // 사람이 읽는 모양으로 넘긴다.
    std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(show(link))
        .arg(show(target))
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn link_dir(target: &Path, link: &Path) -> bool {
    std::os::unix::fs::symlink(target, link).is_ok()
}

/// 심링크·정션은 **따라가지 않는다** — 목록에서도, 지울 때도.
#[test]
fn does_not_follow_symlinks() {
    let root = temp_root("links");
    let target = root.join("target");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("keep.txt"), b"keep").unwrap();

    let link = root.join("link");
    if !link_dir(&target, &link) {
        // 링크를 만들 권한이 없다 — 여기서 멈춘다.
        let _ = std::fs::remove_dir_all(&root);
        return;
    }

    let listed = list(&show(&root)).unwrap();
    let link_entry = listed.iter().find(|e| e.name == "link").unwrap();
    assert_eq!(link_entry.kind, "symlink");
    assert!(link_entry.link_is_dir, "디렉터리를 가리키는 링크다");
    assert!(link_entry.symlink_target.is_some());
    assert!(
        !link_entry
            .symlink_target
            .as_deref()
            .unwrap()
            .starts_with(r"\\?\"),
        "{link_entry:?}"
    );

    // lstat 이라 stat 도 링크를 링크로 본다
    assert_eq!(stat(&at(&root, "link")).unwrap().kind, "symlink");

    // 링크만 지워지고 가리키던 디렉터리는 남는다
    remove(&at(&root, "link"), true).unwrap();
    assert!(!link.exists());
    assert!(target.join("keep.txt").exists(), "링크를 따라가 지웠다");

    let _ = std::fs::remove_dir_all(&root);
}

// ── 자기 하위 판정 ──────────────────────────────────────────────────────

#[test]
fn detects_self_and_descendants() {
    assert!(is_within(r"C:\a", r"C:\a")); // 자기 자신
    assert!(is_within(r"C:\a", r"C:\a\b"));
    assert!(is_within(r"C:\a\", r"C:\a\b\c"));
    // 접두사만 같은 이웃은 하위가 아니다
    assert!(!is_within(r"C:\a", r"C:\ab"));
    assert!(!is_within(r"C:\a\b", r"C:\a"));
    assert!(is_within("/a", "/a/b"));
    assert!(!is_within("/a", "/ab"));
    if cfg!(windows) {
        // 대소문자로 우회하지 못한다
        assert!(is_within(r"C:\A", r"c:\a\b"));
    }
}

// ── 복사 ────────────────────────────────────────────────────────────────

/// 트리 하나가 통째로, 원본을 건드리지 않고 건너간다.
#[test]
fn copies_a_tree_recursively() {
    let root = temp_root("copy-tree");
    let source = root.join("src");
    std::fs::create_dir_all(source.join("inner")).unwrap();
    std::fs::write(source.join("a.txt"), b"aaa").unwrap();
    std::fs::write(source.join("inner").join("b.txt"), b"bbbb").unwrap();
    let dest = root.join("dest");
    std::fs::create_dir(&dest).unwrap();

    let made = copy_many(
        &[show(&source)],
        &show(&dest),
        OnConflict::Fail,
        930_001,
        None,
    )
    .unwrap();
    assert_eq!(made, vec![show(&dest.join("src"))]);
    assert_eq!(
        std::fs::read(dest.join("src").join("a.txt")).unwrap(),
        b"aaa"
    );
    assert_eq!(
        std::fs::read(dest.join("src").join("inner").join("b.txt")).unwrap(),
        b"bbbb"
    );
    // 원본은 그대로다
    assert!(source.join("inner").join("b.txt").exists());

    let _ = std::fs::remove_dir_all(&root);
}

/// 충돌 네 모드가 각자 다른 답을 낸다 — 같은 자리에서 네 번 눌러 본다.
#[test]
fn applies_every_conflict_policy() {
    let root = temp_root("conflict");
    let source = root.join("src");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("a.txt"), b"new").unwrap();

    let dest = root.join("dest");
    std::fs::create_dir_all(dest.join("src")).unwrap();
    std::fs::write(dest.join("src").join("a.txt"), b"old").unwrap();
    std::fs::write(dest.join("src").join("keep.txt"), b"keep").unwrap();

    let copy = |policy| copy_many(&[show(&source)], &show(&dest), policy, 930_002, None);
    let old = || std::fs::read(dest.join("src").join("a.txt")).unwrap();

    // Fail — 아무것도 건드리지 않고 왜 못 했는지 말한다
    let error = copy(OnConflict::Fail).unwrap_err();
    assert!(
        crate::errors::has_reason(&error, crate::errors::EXISTS),
        "{error}"
    );
    assert_eq!(old(), b"old");

    // Skip — 조용히 지나간다 (만들어진 것이 없다)
    assert!(copy(OnConflict::Skip).unwrap().is_empty());
    assert_eq!(old(), b"old");

    // Rename — 옆에 새 이름으로 선다
    let made = copy(OnConflict::Rename).unwrap();
    assert_eq!(made, vec![show(&dest.join("src (2)"))]);
    assert_eq!(
        std::fs::read(dest.join("src (2)").join("a.txt")).unwrap(),
        b"new"
    );
    assert_eq!(old(), b"old");

    // Overwrite — 디렉터리는 **합치고** 파일만 덮어쓴다
    let made = copy(OnConflict::Overwrite).unwrap();
    assert_eq!(made, vec![show(&dest.join("src"))]);
    assert_eq!(old(), b"new");
    assert!(dest.join("src").join("keep.txt").exists(), "합쳐야 한다");

    let _ = std::fs::remove_dir_all(&root);
}

/// 자동 이름은 **빈자리가 나올 때까지** 민다 (`(2)` 가 차 있으면 `(3)`).
#[test]
fn renames_into_the_next_free_name() {
    let root = temp_root("auto-name");
    let source = root.join("src");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("a.tar.gz"), b"x").unwrap();

    let dest = root.join("dest");
    std::fs::create_dir(&dest).unwrap();
    std::fs::write(dest.join("a.tar.gz"), b"1").unwrap();
    std::fs::write(dest.join("a.tar (2).gz"), b"2").unwrap();

    let made = copy_many(
        &[show(&source.join("a.tar.gz"))],
        &show(&dest),
        OnConflict::Rename,
        930_003,
        None,
    )
    .unwrap();
    assert_eq!(made, vec![show(&dest.join("a.tar (3).gz"))]);
    assert_eq!(std::fs::read(dest.join("a.tar.gz")).unwrap(), b"1");

    let _ = std::fs::remove_dir_all(&root);
}

/// 자기 자신(이나 자기 안)으로 넣는 요청은 훑기 전에 막힌다 — 안 막으면 자기가
/// 만든 것을 다시 훑으며 디스크를 채운다.
#[test]
fn refuses_to_put_a_directory_inside_itself() {
    let root = temp_root("self");
    let dir = root.join("d");
    std::fs::create_dir_all(dir.join("inner")).unwrap();

    for dest in [dir.clone(), dir.join("inner")] {
        let error = copy_many(
            &[show(&dir)],
            &show(&dest),
            OnConflict::Overwrite,
            930_004,
            None,
        )
        .unwrap_err();
        assert!(error.contains("자기 자신"), "{error}");
        let error = move_many(&[show(&dir)], &show(&dest), OnConflict::Overwrite).unwrap_err();
        assert!(error.contains("자기 자신"), "{error}");
    }

    let _ = std::fs::remove_dir_all(&root);
}

/// 취소는 훑기 단계에서도 듣는다 (큰 트리는 훑는 데만 오래 걸린다).
#[test]
fn a_cancelled_copy_makes_nothing() {
    let root = temp_root("cancel");
    let source = root.join("src");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("a.txt"), b"x").unwrap();
    let dest = root.join("dest");
    std::fs::create_dir(&dest).unwrap();

    crate::fs_transfer::transfer_cancel(930_005).unwrap();
    let error = copy_many(
        &[show(&source)],
        &show(&dest),
        OnConflict::Fail,
        930_005,
        None,
    )
    .unwrap_err();
    assert_eq!(error, crate::errors::cancelled());
    assert!(!dest.join("src").exists());

    let _ = std::fs::remove_dir_all(&root);
}

/// 심링크는 **링크로** 복사된다 (가리키는 내용을 퍼 오지 않는다).
#[test]
fn copies_symlinks_as_links() {
    let root = temp_root("copy-link");
    let target = root.join("target");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("keep.txt"), b"keep").unwrap();
    let link = root.join("link");
    let dest = root.join("dest");
    std::fs::create_dir(&dest).unwrap();

    if !link_dir(&target, &link) {
        let _ = std::fs::remove_dir_all(&root);
        return;
    }

    match copy_many(
        &[show(&link)],
        &show(&dest),
        OnConflict::Fail,
        930_006,
        None,
    ) {
        Ok(made) => {
            assert_eq!(made, vec![show(&dest.join("link"))]);
            let copied = std::fs::symlink_metadata(dest.join("link")).unwrap();
            assert!(copied.file_type().is_symlink(), "링크로 복사해야 한다");
            // 적어 둔 문자열이 같다 = 내용을 퍼 온 것이 아니라 링크를 다시 만든 것이다
            assert_eq!(
                std::fs::read_link(dest.join("link")).unwrap(),
                std::fs::read_link(&link).unwrap()
            );
        }
        // 윈도우에서 심링크를 만들려면 권한이 필요하다 — 그렇다고 말해 주면 된다
        Err(error) => assert!(error.contains("링크를 만들지 못했습니다"), "{error}"),
    }

    let _ = std::fs::remove_dir_all(&root);
}

// ── 이동 ────────────────────────────────────────────────────────────────

/// 같은 볼륨은 `rename` 한 번, 대상 디렉터리가 이미 있으면 복사 뒤 삭제로 합친다.
#[test]
fn moves_by_rename_and_merges_by_copying() {
    let root = temp_root("move");
    let source = root.join("src");
    std::fs::create_dir_all(source.join("inner")).unwrap();
    std::fs::write(source.join("inner").join("b.txt"), b"bbb").unwrap();
    let dest = root.join("dest");
    std::fs::create_dir(&dest).unwrap();

    let made = move_many(&[show(&source)], &show(&dest), OnConflict::Fail).unwrap();
    assert_eq!(made, vec![show(&dest.join("src"))]);
    assert!(!source.exists(), "원본이 남으면 이동이 아니다");
    assert_eq!(
        std::fs::read(dest.join("src").join("inner").join("b.txt")).unwrap(),
        b"bbb"
    );

    // 이번에는 대상에 같은 이름이 이미 있다 — rename 이 거절되고 합치기로 물러선다
    std::fs::create_dir_all(source.join("inner")).unwrap();
    std::fs::write(source.join("inner").join("c.txt"), b"ccc").unwrap();
    let made = move_many(&[show(&source)], &show(&dest), OnConflict::Overwrite).unwrap();
    assert_eq!(made, vec![show(&dest.join("src"))]);
    assert!(!source.exists());
    let inner = dest.join("src").join("inner");
    assert!(inner.join("b.txt").exists(), "먼저 있던 것이 남아야 한다");
    assert!(inner.join("c.txt").exists());

    let _ = std::fs::remove_dir_all(&root);
}

/// **복사가 끝난 것을 확인한 뒤에만** 원본을 지운다 — 복사가 실패하면 원본은 그대로다.
///
/// 이 순서가 뒤집히면(지우고 나서 복사) 실패 한 번이 곧 데이터 손실이다. 로컬↔로컬은
/// 임시 디렉터리로 실제로 확인할 수 있는 유일한 방향이라 여기서 못 박는다 — 로컬↔원격 ·
/// 원격↔원격도 [`crate::sftp_browser`] 에서 같은 순서를 탄다.
#[test]
fn a_failed_copy_keeps_the_source() {
    let root = temp_root("move-fail");
    let source = root.join("src");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("b.txt"), b"new").unwrap();

    // 대상에 같은 이름이 이미 있어 `rename` 이 거절되고(합치기로 물러선다), 그 안의
    // 파일은 **읽기 전용**이라 덮어쓰기가 만들기에서 실패한다.
    let dest = root.join("dest");
    let landed = dest.join("src");
    std::fs::create_dir_all(&landed).unwrap();
    let blocked = landed.join("b.txt");
    std::fs::write(&blocked, b"old").unwrap();
    let mut readonly = std::fs::metadata(&blocked).unwrap().permissions();
    readonly.set_readonly(true);
    std::fs::set_permissions(&blocked, readonly).unwrap();

    let error = move_many(&[show(&source)], &show(&dest), OnConflict::Overwrite).unwrap_err();
    assert!(error.contains("b.txt"), "{error}");

    // 원본이 그대로 있어야 한다 — 복사 실패는 삭제로 이어지지 않는다
    assert!(source.exists(), "복사가 실패했는데 원본이 사라졌다");
    assert_eq!(std::fs::read(source.join("b.txt")).unwrap(), b"new");
    // 덮어쓰려던 남의 파일도 그대로다 (우리가 만든 자리가 아니다)
    assert_eq!(std::fs::read(&blocked).unwrap(), b"old");

    // 읽기 전용인 채로는 임시 디렉터리를 치울 수 없다
    let mut writable = std::fs::metadata(&blocked).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    writable.set_readonly(false);
    let _ = std::fs::set_permissions(&blocked, writable);
    let _ = std::fs::remove_dir_all(&root);
}

/// 건너뛴 항목은 **원본이 남는다** — 옮기지 않았으니 지울 것도 없다.
#[test]
fn a_skipped_item_keeps_its_source() {
    let root = temp_root("move-skip");
    let source = root.join("a.txt");
    std::fs::write(&source, b"mine").unwrap();
    let dest = root.join("dest");
    std::fs::create_dir(&dest).unwrap();
    std::fs::write(dest.join("a.txt"), b"theirs").unwrap();

    let made = move_many(&[show(&source)], &show(&dest), OnConflict::Skip).unwrap();
    assert!(made.is_empty(), "건너뛴 것은 결과에도 없다: {made:?}");
    assert_eq!(std::fs::read(&source).unwrap(), b"mine");
    assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"theirs");

    let _ = std::fs::remove_dir_all(&root);
}

/// 같은 디렉터리로 옮기라는 요청은 아무 일도 하지 않는다 (제자리다).
#[test]
fn moving_into_the_same_directory_is_a_no_op() {
    let root = temp_root("move-inplace");
    std::fs::write(root.join("a.txt"), b"a").unwrap();

    let made = move_many(&[at(&root, "a.txt")], &show(&root), OnConflict::Overwrite).unwrap();
    assert_eq!(made, vec![at(&root, "a.txt")]);
    assert_eq!(std::fs::read(root.join("a.txt")).unwrap(), b"a");

    let _ = std::fs::remove_dir_all(&root);
}

/// 드라이브 루트·홈은 옮길 수도 없다 (지우기·이름 바꾸기와 같은 보호).
///
/// 임시 디렉터리는 언제나 그 둘 **안**에 있으므로(윈도우의 `TEMP` 는 홈 아래다)
/// 실제로는 자기 하위 검사가 먼저 걸린다 — 어느 쪽이든 거절되는 것이 계약이다.
#[test]
fn refuses_to_move_roots_and_home() {
    let root = temp_root("move-guard");
    let drive = if cfg!(windows) { r"C:\" } else { "/" };
    for source in [drive.to_string(), home().unwrap()] {
        let error = move_many(
            std::slice::from_ref(&source),
            &show(&root),
            OnConflict::Fail,
        )
        .unwrap_err();
        assert!(
            error.contains("옮길 수 없습니다") || error.contains("자기 자신"),
            "{source}: {error}"
        );
    }
    // 보호 판정 자체는 순수 함수로 한 번 더 못 박는다
    assert!(is_protected(drive, home().ok().as_deref()));
    let _ = std::fs::remove_dir_all(&root);
}

// ── 여러 개 지우기 ──────────────────────────────────────────────────────

#[test]
fn removes_many_and_says_where_it_stopped() {
    let root = temp_root("rm-many");
    std::fs::write(root.join("a.txt"), b"a").unwrap();
    std::fs::write(root.join("b.txt"), b"b").unwrap();
    let missing = at(&root, "gone.txt");

    let error = remove_many(
        &[at(&root, "a.txt"), at(&root, "b.txt"), missing.clone()],
        true,
    )
    .unwrap_err();
    assert!(error.contains("2개를 지운 뒤"), "{error}");
    assert!(!root.join("a.txt").exists());
    assert!(!root.join("b.txt").exists());

    // 첫 항목에서 멈추면 개수 대신 원인만 말한다
    let error = remove_many(&[missing], true).unwrap_err();
    assert!(!error.contains("지운 뒤"), "{error}");
    assert!(error.contains("찾지 못했습니다"), "{error}");

    let _ = std::fs::remove_dir_all(&root);
}

// ── 충돌 사전 조회 ──────────────────────────────────────────────────────

#[test]
fn lists_conflicts_before_pasting() {
    let root = temp_root("conflicts");
    let source = root.join("src");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("a.txt"), b"a").unwrap();
    std::fs::create_dir(source.join("logs")).unwrap();

    let dest = root.join("dest");
    std::fs::create_dir(&dest).unwrap();
    std::fs::write(dest.join("a.txt"), b"other").unwrap();
    std::fs::create_dir(dest.join("logs")).unwrap();

    let found = conflicts(
        &[
            show(&source.join("a.txt")),
            show(&source.join("logs")),
            show(&source),
        ],
        &show(&dest),
    )
    .unwrap();
    assert_eq!(found.len(), 2, "{found:?}"); // src 는 dest 에 없다
    assert_eq!(found[0].path, show(&dest.join("a.txt")));
    assert_eq!(found[0].kind, "file");
    assert_eq!(found[1].kind, "dir");

    // 제자리(같은 디렉터리)는 물어볼 것이 없다
    assert!(conflicts(&[show(&source.join("a.txt"))], &show(&source))
        .unwrap()
        .is_empty());

    let _ = std::fs::remove_dir_all(&root);
}

/// 끊어진 링크는 오류가 아니다 — 목록에 링크로 남는다.
#[test]
fn broken_links_still_list() {
    let root = temp_root("broken");
    let link = root.join("gone");
    let missing = root.join("no-such-dir");

    if link_dir(&missing, &link) {
        let listed = list(&show(&root)).unwrap();
        let entry = listed.iter().find(|e| e.name == "gone").unwrap();
        assert_eq!(entry.kind, "symlink");
        assert!(!entry.link_is_dir);
    }

    let _ = std::fs::remove_dir_all(&root);
}

/// 장소 패널의 붙박이 폴더 — 홈이 맨 앞에 서고, 있는 폴더만 · 같은 경로는 한 번만 (docs/log/2026-10-07-file-tile-dolphin.md)
#[test]
fn places_start_with_home_and_hold_existing_unique_folders() {
    let list = places();
    if let Some(first) = list.first() {
        assert_eq!(first.kind, "home");
    }
    for p in &list {
        assert!(Path::new(&p.path).is_dir(), "{} 가 폴더가 아니다", p.path);
        assert!(!p.path.starts_with(r"\\?\"), "verbatim 접두사를 떼어야 한다: {}", p.path);
    }
    let mut paths: Vec<&str> = list.iter().map(|p| p.path.as_str()).collect();
    paths.sort_unstable();
    paths.dedup();
    assert_eq!(paths.len(), list.len());
}

/// 미리 보기 바이트 — 작은 파일은 통째로, 폴더는 거절 (상한 쪽은 20 MiB 파일을 만들기 아까워 판정 상수만 본다)
#[test]
fn read_preview_returns_bytes_and_rejects_folders() {
    let dir = std::env::temp_dir().join(format!("aynx-preview-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("a.png");
    std::fs::write(&file, [1u8, 2, 3]).unwrap();
    assert_eq!(read_preview(&file.to_string_lossy()).unwrap(), vec![1, 2, 3]);
    assert!(read_preview(&dir.to_string_lossy()).is_err());
    let _ = std::fs::remove_dir_all(&dir);
    const { assert!(PREVIEW_MAX_BYTES == 20 * 1024 * 1024) };
}
