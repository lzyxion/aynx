use super::*;

/// 테스트마다 겹치지 않는 임시 폴더 (끝나면 지운다).
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("aynx-월페이퍼-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("임시 폴더");
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn set_of(names: &[&str]) -> HashSet<String> {
    names.iter().map(|s| s.to_string()).collect()
}

// ── 확장자 검증 ────────────────────────────────────────────────────────

#[test]
fn allowed_extensions_pass_and_are_lowercased() {
    for raw in ["a.png", "a.JPG", "b.Jpeg", "c.WEBP", "d.gif", "e.BMP"] {
        let ext = checked_ext(Path::new(raw)).expect(raw);
        assert!(ALLOWED_EXTS.contains(&ext.as_str()), "{raw} → {ext}");
        assert_eq!(ext, ext.to_ascii_lowercase(), "{raw}");
    }
    // 경로가 길어도 마지막 확장자만 본다.
    assert_eq!(
        checked_ext(Path::new(r"C:\사진\밤 바다.jpeg")).unwrap(),
        "jpeg"
    );
    // 점이 여럿이어도 마지막 조각이 확장자다.
    assert_eq!(checked_ext(Path::new("a.tar.png")).unwrap(), "png");
}

#[test]
fn other_extensions_are_refused() {
    // SVG 는 스크립트를 품을 수 있어 일부러 목록 밖이다.
    for raw in ["a.svg", "a.exe", "a.txt", "a.jpg.exe", "확장자없음"] {
        let err = checked_ext(Path::new(raw)).expect_err(raw);
        assert!(!err.is_empty(), "{raw}");
    }
}

/// 이름 한 조각만 통과한다 — 경로가 섞인 값은 있어도 "없다" 로 본다 (모양 프로필이
/// 가리키는 배경을 묻는 자리라 손편집 값이 들어올 수 있다).
#[test]
fn exists_in_accepts_only_bare_names() {
    let tmp = TempDir::new("사본유무");
    let dir = &tmp.0;
    std::fs::create_dir_all(dir.join("sub")).expect("임시 폴더");
    std::fs::write(dir.join("wallpaper.jpg"), b"x").expect("쓰기");
    std::fs::write(dir.join("sub").join("wallpaper.png"), b"x").expect("쓰기");

    assert!(exists_in(dir, "wallpaper.jpg"));
    assert_eq!(
        resolve_in(dir, "wallpaper.jpg").as_deref(),
        Some(&*dir.join("wallpaper.jpg").to_string_lossy())
    );
    assert!(
        !exists_in(dir, "wallpaper.png"),
        "다른 확장자의 사본은 없다"
    );
    for bad in [
        "sub/wallpaper.png",
        r"sub\wallpaper.png",
        "../wallpaper.jpg",
        "",
        ".",
    ] {
        assert!(!exists_in(dir, bad), "경로는 통과하면 안 된다: {bad:?}");
        assert!(resolve_in(dir, bad).is_none(), "{bad:?}");
    }
    // 폴더는 파일이 아니다.
    assert!(!exists_in(dir, "sub"));
}

#[test]
fn human_size_is_readable() {
    assert_eq!(human_mb(50 * 1024 * 1024), "50.0MB");
    assert_eq!(human_mb(1024 * 1024 / 2), "0.5MB");
}

// ── 해시 이름 ──────────────────────────────────────────────────────────

#[test]
fn hashed_name_is_prefix_twelve_hex_and_ext() {
    let hex = "0123456789abcdef0123456789abcdef01234567";
    assert_eq!(hashed_name(hex, "jpg"), "wp-0123456789ab.jpg");
    assert!(is_managed_name(&hashed_name(hex, "webp")));
}

#[test]
fn managed_names_are_only_ours() {
    for ok in [
        "wp-0123456789ab.jpg",
        "wp-ffffffffffff.png",
        "wallpaper.jpg",
        "wallpaper.webp",
    ] {
        assert!(is_managed_name(ok), "{ok}");
    }
    for no in [
        "settings.toml",
        "theme-profiles.json",
        "vault.bin",
        "wp-0123456789ab.svg",       // 목록 밖 확장자
        "wp-0123456789AB.jpg",       // 대문자는 우리가 안 만든다
        "wp-0123456789a.jpg",        // 자릿수
        "wp-0123456789abc.jpg",      // 자릿수
        "wp-0123456789ag.jpg",       // 16진수 아님
        "wp-0123456789ab.jpg.1.tmp", // 복사 중인 임시 파일
        "wallpaper",
        "my-wallpaper.jpg",
    ] {
        assert!(!is_managed_name(no), "{no}");
    }
}

/// 같은 내용은 같은 이름 하나 — 두 번 걸어도 사본이 늘지 않는다. 다른 내용은 다른 이름.
#[test]
fn copy_hashed_dedupes_by_content() {
    let src = TempDir::new("원본");
    let dst = TempDir::new("사본");
    let a = src.0.join("밤 바다.jpg");
    let a2 = src.0.join("복사본.JPG");
    let b = src.0.join("낮.jpg");
    std::fs::write(&a, b"night-sea").unwrap();
    std::fs::write(&a2, b"night-sea").unwrap();
    std::fs::write(&b, b"daylight").unwrap();

    let na = copy_hashed(&a, "jpg", &dst.0).unwrap();
    let na2 = copy_hashed(&a2, "jpg", &dst.0).unwrap();
    let nb = copy_hashed(&b, "jpg", &dst.0).unwrap();
    assert_eq!(na, na2, "같은 내용 = 같은 이름");
    assert_ne!(na, nb, "다른 내용 = 다른 이름");
    assert!(is_managed_name(&na) && is_managed_name(&nb));
    assert_eq!(std::fs::read(dst.0.join(&na)).unwrap(), b"night-sea");

    // 사본 폴더에는 두 장만 — 임시 파일도 남지 않는다.
    let mut names: Vec<String> = std::fs::read_dir(&dst.0)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().into_string().unwrap())
        .collect();
    names.sort();
    let mut want = vec![na.clone(), nb.clone()];
    want.sort();
    assert_eq!(names, want);

    // 이미 걸린 사본 자신을 다시 골라도 그대로다 (복사하지 않는다).
    assert_eq!(copy_hashed(&dst.0.join(&na), "jpg", &dst.0).unwrap(), na);
}

// ── GC ────────────────────────────────────────────────────────────────

#[test]
fn profile_wallpapers_reads_only_the_file_field() {
    let json = r#"{"version":1,"active":null,"profiles":[
            {"id":"a","appearance":{"wallpaper":{"file":"wp-0123456789ab.jpg","dim":40}}},
            {"id":"b","appearance":{"wallpaper":{}}},
            {"id":"c"},
            {"id":"d","appearance":{"wallpaper":{"file":"wallpaper.png"}}}
        ]}"#;
    assert_eq!(
        profile_wallpapers(json).unwrap(),
        vec![
            "wp-0123456789ab.jpg".to_string(),
            "wallpaper.png".to_string()
        ]
    );
    // 모양이 틀리면 None — GC 를 건너뛰라는 뜻이다.
    assert!(profile_wallpapers("{ 깨짐").is_none());
    assert!(profile_wallpapers(r#"{"profiles":{}}"#).is_none());
    assert!(profile_wallpapers(r#"{"version":1}"#).is_none());
    assert_eq!(
        profile_wallpapers(r#"{"profiles":[]}"#).unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn referenced_unions_settings_profiles_and_extra_and_refuses_broken_json() {
    let json = r#"{"profiles":[{"appearance":{"wallpaper":{"file":"wp-aaaaaaaaaaaa.jpg"}}}]}"#;
    let keep = referenced(
        Some("wallpaper.jpg"),
        Some(json),
        Some("wp-bbbbbbbbbbbb.png"),
    )
    .unwrap();
    assert_eq!(
        keep,
        set_of(&[
            "wallpaper.jpg",
            "wp-aaaaaaaaaaaa.jpg",
            "wp-bbbbbbbbbbbb.png"
        ])
    );
    // 프로필 파일이 없는 것은 괜찮다.
    assert_eq!(referenced(None, None, None).unwrap(), HashSet::new());
    // 있는데 깨졌으면 None.
    assert!(referenced(Some("wallpaper.jpg"), Some("not json"), None).is_none());
}

/// 가리켜지는 것(설정·프로필 — 옛 이름 포함)은 남고, 아무도 안 가리키는 우리 사본만 지운다.
/// 우리 것이 아닌 파일은 이름이 비슷해도 건드리지 않는다.
#[test]
fn gc_keeps_referenced_and_deletes_unreferenced() {
    let tmp = TempDir::new("gc");
    let dir = &tmp.0;
    for name in [
        "wp-aaaaaaaaaaaa.jpg", // 설정이 가리킴
        "wp-bbbbbbbbbbbb.png", // 프로필이 가리킴
        "wallpaper.jpg",       // 옛 이름 — 프로필이 가리킴
        "wallpaper.png",       // 옛 이름 — 아무도 안 가리킴
        "wp-cccccccccccc.jpg", // 아무도 안 가리킴
        "settings.toml",
        "theme-profiles.json",
        "wp-note.txt",
    ] {
        std::fs::write(dir.join(name), b"x").unwrap();
    }
    let json = r#"{"profiles":[
            {"appearance":{"wallpaper":{"file":"wp-bbbbbbbbbbbb.png"}}},
            {"appearance":{"wallpaper":{"file":"wallpaper.jpg"}}}
        ]}"#;
    let keep = referenced(Some("wp-aaaaaaaaaaaa.jpg"), Some(json), None).unwrap();
    let mut removed = gc_in(dir, &keep);
    removed.sort();
    assert_eq!(
        removed,
        vec![
            "wallpaper.png".to_string(),
            "wp-cccccccccccc.jpg".to_string()
        ]
    );
    for kept in [
        "wp-aaaaaaaaaaaa.jpg",
        "wp-bbbbbbbbbbbb.png",
        "wallpaper.jpg",
        "settings.toml",
        "theme-profiles.json",
        "wp-note.txt",
    ] {
        assert!(dir.join(kept).is_file(), "{kept} 는 남아야 한다");
    }
    // 두 번 돌려도 더 지울 것이 없다.
    assert!(gc_in(dir, &keep).is_empty());
}

/// 편집 중인 설정의 이름(`extra`)도 지켜진다 — 파일에는 아직 없는 참조다.
#[test]
fn gc_keeps_the_unsaved_current_name() {
    let tmp = TempDir::new("gc-편집중");
    std::fs::write(tmp.0.join("wp-dddddddddddd.jpg"), b"x").unwrap();
    let keep = referenced(None, None, Some("wp-dddddddddddd.jpg")).unwrap();
    assert!(gc_in(&tmp.0, &keep).is_empty());
    assert!(tmp.0.join("wp-dddddddddddd.jpg").is_file());
}

// ── 바이트 사본 (랜덤 월페이퍼) ───────────────────────────────────────

#[test]
fn write_hashed_names_by_content_and_dedups() {
    let tmp = TempDir::new("bytes");
    let a = write_hashed(b"\xFF\xD8\xFFabc", "jpg", &tmp.0).expect("쓰기");
    assert!(is_managed_name(&a), "{a}");
    assert!(a.ends_with(".jpg"));
    assert_eq!(std::fs::read(tmp.0.join(&a)).unwrap(), b"\xFF\xD8\xFFabc");
    // 같은 내용이면 같은 이름, 다른 내용이면 다른 이름.
    assert_eq!(write_hashed(b"\xFF\xD8\xFFabc", "jpg", &tmp.0).unwrap(), a);
    assert_ne!(write_hashed(b"\xFF\xD8\xFFabd", "jpg", &tmp.0).unwrap(), a);
    // 임시 파일이 남지 않는다.
    let leftovers = std::fs::read_dir(&tmp.0)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .count();
    assert_eq!(leftovers, 0);
}
