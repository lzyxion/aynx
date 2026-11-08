use super::*;

// ── 이름 검증 ───────────────────────────────────────────────────────────

#[test]
fn plain_names_pass_and_outer_spaces_are_trimmed() {
    assert_eq!(validate_name("id_ed25519").unwrap(), "id_ed25519");
    assert_eq!(validate_name("  id_rsa_web01  ").unwrap(), "id_rsa_web01");
    assert_eq!(validate_name("key-2").unwrap(), "key-2"); // 가운데 `-` 는 괜찮다
}

#[test]
fn names_that_could_escape_the_folder_are_refused() {
    for bad in [
        "../evil",
        "..",
        "a/b",
        r"a\b",
        "C:key",
        "sub/../x",
        r"..\..\config",
    ] {
        assert!(validate_name(bad).is_err(), "통과하면 안 된다: {bad}");
    }
}

#[test]
fn names_that_are_not_a_file_name_are_refused() {
    for bad in ["", "   ", "my key", "id\tkey", "-t", "-", ".hidden", "."] {
        assert!(validate_name(bad).is_err(), "통과하면 안 된다: {bad:?}");
    }
    // 제어 문자도 막힌다 (이름이 파일 시스템과 화면에서 다르게 보이는 자리).
    assert!(validate_name("id\nkey").is_err());
}

#[test]
fn name_error_explains_what_is_allowed() {
    let err = validate_name("a/b").unwrap_err();
    assert!(err.contains("id_ed25519_web01"), "{err}");
}

// ── 종류 ────────────────────────────────────────────────────────────────

#[test]
fn kind_defaults_to_ed25519_and_takes_rsa() {
    assert_eq!(canonical_kind("").unwrap(), DEFAULT_KIND);
    assert_eq!(canonical_kind("  ").unwrap(), DEFAULT_KIND);
    assert_eq!(canonical_kind("ED25519").unwrap(), "ed25519");
    assert_eq!(canonical_kind("RSA").unwrap(), "rsa");
    let err = canonical_kind("ecdsa").unwrap_err();
    assert!(err.contains("ecdsa"), "{err}");
}

// ── 암호구 지우기 ───────────────────────────────────────────────────────

#[test]
fn the_n_flag_value_never_survives() {
    assert_eq!(
        strip_n_flag("ssh-keygen -t ed25519 -f key -N hunter2 -C wl@box"),
        "ssh-keygen -t ed25519 -f key -N *** -C wl@box"
    );
    // 여러 번 나와도 전부.
    assert_eq!(strip_n_flag("-N a -N b"), "-N *** -N ***");
    // 낱말 경계가 아니면 남의 문장이다 — 건드리지 않는다.
    assert_eq!(strip_n_flag("use --N foo"), "use --N foo");
    assert_eq!(strip_n_flag("x-N foo"), "x-N foo");
    // `-N` 이 없으면 원문 그대로.
    assert_eq!(strip_n_flag("permission denied"), "permission denied");
    assert_eq!(strip_n_flag(""), "");
}

#[test]
fn scrub_removes_the_passphrase_wherever_it_appears() {
    let raw = "ssh-keygen -N hunter2: passphrase \"hunter2\" is too short";
    let clean = scrub(raw, "hunter2");
    assert!(!clean.contains("hunter2"), "{clean}");
    assert!(clean.contains(SCRUBBED), "{clean}");

    // 암호구가 비면(= 암호구 없는 키) 치환할 것이 없다 — 본문이 상하지 않는다.
    assert_eq!(scrub("all is well", ""), "all is well");
    // 그래도 `-N` 플래그는 언제나 지운다.
    assert_eq!(scrub("-N secret", ""), "-N ***");
}

#[test]
fn scrub_survives_a_passphrase_with_regex_and_shell_metacharacters() {
    // 치환은 정규식이 아니라 문자열이라 메타문자가 그대로 잡힌다.
    let pass = r"a.*$(whoami)\";
    let clean = scrub(&format!("boom: {pass} here"), pass);
    assert_eq!(clean, format!("boom: {SCRUBBED} here"));
}

// ── 직렬화 계약 ─────────────────────────────────────────────────────────

#[test]
fn payloads_serialize_in_camel_case_without_a_passphrase_field() {
    let json: serde_json::Value = serde_json::to_value(GeneratedKey {
        private_path: "C:/k".into(),
        public_path: "C:/k.pub".into(),
        fingerprint: "SHA256:aaaa".into(),
        public_key_line: "ssh-ed25519 AAAA wl@box".into(),
    })
    .unwrap();
    let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    // 계약을 못 박아 둔다 — 암호구가 실릴 자리가 **없다**.
    assert_eq!(
        keys,
        ["fingerprint", "privatePath", "publicKeyLine", "publicPath"]
    );

    let file = serde_json::to_string(&KeyFile {
        private_path: "C:/k".into(),
        public_path: "C:/k.pub".into(),
        fingerprint: "SHA256:aaaa".into(),
        comment: "wl@box".into(),
        kind: "ssh-ed25519".into(),
        public_line: "ssh-ed25519 AAAA wl@box".into(),
    })
    .unwrap();
    assert!(file.contains(r#""privatePath":"#), "{file}");
    assert!(file.contains(r#""publicLine":"#), "{file}");
}

// ── 진짜 `ssh-keygen` 이 있을 때만 (없으면 건너뛴다) ────────────────────

fn ssh_keygen_on_path() -> bool {
    let mut cmd = Command::new("ssh-keygen");
    cmd.arg("-?"); // 사용법을 뱉고 실패로 끝난다 — 우리가 보는 것은 "떴는가" 뿐이다
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output().is_ok()
}

/// 겹치지 않는 임시 폴더 하나 (테스트가 끝나면 지운다).
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "aynx-keygen-{tag}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[test]
fn makes_a_real_key_pair_and_lists_it() {
    if !ssh_keygen_on_path() {
        eprintln!("ssh-keygen 이 PATH 에 없어 건너뜀");
        return;
    }
    let dir = temp_dir("make");

    // ① 암호구 있는 ed25519 — 폴더가 아직 없는 상태에서 만든다.
    let made =
        generate_at(&dir, " id_ed25519_test ", "", "pass phrase 🔒", "wl@box").expect("생성 실패");
    assert!(Path::new(&made.private_path).is_file(), "{made:?}");
    assert!(Path::new(&made.public_path).is_file(), "{made:?}");
    assert!(made.fingerprint.starts_with("SHA256:"), "{made:?}");
    assert!(made.public_key_line.starts_with("ssh-ed25519 "), "{made:?}");
    assert!(made.public_key_line.ends_with(" wl@box"), "{made:?}");
    assert!(!made.public_key_line.contains('\n'), "{made:?}");
    // 이름의 바깥 공백이 다듬어져 파일 이름이 됐다.
    assert!(made.private_path.ends_with("id_ed25519_test"), "{made:?}");
    // 개인키 파일에 암호구가 걸렸다 = 새 형식 + 평문 헤더가 아니다.
    let pem = std::fs::read_to_string(&made.private_path).unwrap();
    assert!(
        pem.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"),
        "{pem:.60}"
    );
    assert!(!pem.contains("pass phrase"), "개인키에 암호구가 들어갔다");

    // ② 같은 이름으로 한 번 더 → 덮어쓰지 않고 거절.
    let again = generate_at(&dir, "id_ed25519_test", "ed25519", "", "").unwrap_err();
    assert!(again.contains("이미 있습니다"), "{again}");

    // ③ 목록이 방금 만든 것을 **같은 지문으로** 집어낸다.
    let listed = list_at(&dir).expect("목록 실패");
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(listed[0].fingerprint, made.fingerprint);
    assert_eq!(listed[0].public_line, made.public_key_line);
    assert_eq!(listed[0].kind, "ssh-ed25519");
    assert_eq!(listed[0].comment, "wl@box");
    assert_eq!(listed[0].private_path, made.private_path);

    // ④ 짝 없는 `.pub` 과 남의 파일은 목록에 오지 않는다.
    std::fs::write(dir.join("orphan.pub"), &made.public_key_line).unwrap();
    std::fs::write(dir.join("known_hosts"), "box ssh-ed25519 AAAA\n").unwrap();
    std::fs::write(dir.join("junk.pub"), "not a key at all\n").unwrap();
    std::fs::write(dir.join("junk"), "").unwrap();
    assert_eq!(list_at(&dir).unwrap().len(), 1);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_bad_kind_never_reaches_ssh_keygen() {
    // 검증이 프로세스보다 **앞**이라는 것 — 폴더가 없어도 이 오류가 먼저 난다.
    let dir = temp_dir("kind");
    let err = generate_at(&dir, "id_x", "ecdsa", "", "").unwrap_err();
    assert!(err.contains("ecdsa"), "{err}");
    assert!(!dir.exists(), "검증에 걸렸는데 폴더를 만들었다");
}

#[test]
fn listing_a_missing_folder_is_an_empty_list() {
    assert_eq!(list_at(&temp_dir("missing")).unwrap(), Vec::new());
}
