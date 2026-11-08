use super::*;

#[test]
fn mcp_environment_entries_round_trip_encrypted_and_never_expose_values_in_metadata() {
    let dir = temp_dir("mcp-env");
    let mut open = create_at(&dir, Some("master"), T_M, T_T, T_P).unwrap();
    open.put(
        Kind::McpEnv,
        "global/postgres/DATABASE_URL:ref".into(),
        Zeroizing::new("postgres://user:secret@localhost/db".into()),
    );
    open.put(
        Kind::McpEnv,
        "project/postgres/EMPTY:ref".into(),
        Zeroizing::new(String::new()),
    );
    save_at(&dir, &open).unwrap();
    let back = open_at(&dir, Some("master")).unwrap();
    assert_eq!(
        back.find(Kind::McpEnv, "global/postgres/DATABASE_URL:ref")
            .unwrap()
            .value
            .as_str(),
        "postgres://user:secret@localhost/db"
    );
    assert_eq!(
        back.find(Kind::McpEnv, "project/postgres/EMPTY:ref")
            .unwrap()
            .value
            .as_str(),
        ""
    );
    assert!(!format!("{:?}", back.entries).contains("postgres://"));
    let raw = std::fs::read_to_string(vault_path(&dir)).unwrap();
    assert!(!raw.contains("postgres://"));
    assert!(!raw.contains("DATABASE_URL"));
    assert_eq!(Kind::parse("mcp_env"), Some(Kind::McpEnv));
    std::fs::remove_dir_all(dir).unwrap();
}

/// **테스트용 Argon2 파라미터** — 값이 작다.
///
/// 진짜 기본값(64 MiB · 3회)은 디버그 빌드에서 수 초가 걸린다. 여기서 재는 것은
/// "봉투가 왕복하는가" 이지 "Argon2 가 느린가" 가 아니다. 파라미터가 **봉투 머리에
/// 적혀 다시 읽힌다**는 성질 자체를 이 테스트들이 증명한다(작은 값으로 쓴 금고가
/// 작은 값으로 열린다).
const T_M: u32 = 64;
const T_T: u32 = 1;
const T_P: u32 = 1;

/// 겹치지 않는 임시 폴더 하나 (`keygen.rs` 의 `temp_dir` 과 같은 꼴).
fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("aynx-vault-{tag}-{}-{nanos}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("임시 폴더");
    dir
}

fn entry(kind: Kind, target: &str, value: &str) -> Entry {
    Entry {
        kind,
        target: target.to_string(),
        value: Zeroizing::new(value.to_string()),
    }
}

// ── 왕복 ────────────────────────────────────────────────────────────────

#[test]
fn round_trips_with_a_master_password() {
    let dir = temp_dir("마스터");
    let mut open = create_at(&dir, Some("열려라 참깨"), T_M, T_T, T_P).expect("생성");
    assert!(open.kdf.has_master());
    // 마스터 금고 옆에는 키 파일이 **없다**.
    assert!(!key_path(&dir).exists());

    open.entries
        .push(entry(Kind::HostPassword, "web-01", "hunter2"));
    open.entries.push(entry(
        Kind::KeyPassphrase,
        r"C:\k\id_ed25519",
        "pass phrase 🔒",
    ));
    save_at(&dir, &open).expect("저장");

    let back = open_at(&dir, Some("열려라 참깨")).expect("열기");
    assert_eq!(back.entries.len(), 2);
    assert_eq!(
        back.find(Kind::HostPassword, "web-01")
            .unwrap()
            .value
            .as_str(),
        "hunter2"
    );
    assert_eq!(
        back.find(Kind::KeyPassphrase, r"C:\k\id_ed25519")
            .unwrap()
            .value
            .as_str(),
        "pass phrase 🔒"
    );

    // 비밀은 **봉투 바깥에 한 글자도 없다** — 대상 이름조차.
    let raw = std::fs::read_to_string(vault_path(&dir)).unwrap();
    assert!(!raw.contains("hunter2"), "{raw}");
    assert!(!raw.contains("web-01"), "{raw}");
    assert!(!raw.contains("열려라"), "{raw}");
    assert!(raw.contains("\"argon2id\""), "{raw}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn round_trips_with_a_key_file() {
    let dir = temp_dir("키파일");
    let mut open = create_at(&dir, None, T_M, T_T, T_P).expect("생성");
    assert!(!open.kdf.has_master());
    // 키 파일 금고에는 키 파일이 **있다**.
    assert!(key_path(&dir).exists());

    open.entries
        .push(entry(Kind::HostPassword, "db-01", "s3cret"));
    save_at(&dir, &open).expect("저장");

    // 마스터를 주지 않아도 열린다 — 그것이 이 원천의 뜻이다.
    let back = open_at(&dir, None).expect("열기");
    assert_eq!(
        back.find(Kind::HostPassword, "db-01")
            .unwrap()
            .value
            .as_str(),
        "s3cret"
    );

    // 키 파일이 사라지면 못 연다 (DPAPI 도, 항등 스텁도 마찬가지다).
    std::fs::remove_file(key_path(&dir)).unwrap();
    assert!(open_at(&dir, None).is_err());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_vault_is_never_created_on_top_of_an_existing_one() {
    let dir = temp_dir("덮어쓰기");
    create_at(&dir, None, T_M, T_T, T_P).expect("생성");
    let err = create_at(&dir, Some("x"), T_M, T_T, T_P).unwrap_err();
    assert!(errors::has_reason(&err, errors::EXISTS), "{err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_absent_vault_says_so_with_its_reason_code() {
    let dir = temp_dir("없음");
    let err = open_at(&dir, None).unwrap_err();
    assert!(errors::has_reason(&err, errors::VAULT_ABSENT), "{err}");
    let _ = std::fs::remove_dir_all(&dir);
}

// ── 틀린 마스터 · 변조 ──────────────────────────────────────────────────

#[test]
fn a_wrong_master_password_is_refused_with_its_reason_code() {
    let dir = temp_dir("틀린마스터");
    let mut open = create_at(&dir, Some("correct horse"), T_M, T_T, T_P).expect("생성");
    open.entries
        .push(entry(Kind::HostPassword, "web-01", "hunter2"));
    save_at(&dir, &open).expect("저장");

    let err = open_at(&dir, Some("battery staple")).unwrap_err();
    assert!(
        errors::has_reason(&err, errors::VAULT_WRONG_MASTER),
        "{err}"
    );
    // 빈 마스터도 같은 갈래다 (특별 취급이 없다).
    assert!(open_at(&dir, Some("")).is_err());
    // 마스터를 아예 안 주면 "잠겨 있다" 다.
    let err = open_at(&dir, None).unwrap_err();
    assert!(errors::has_reason(&err, errors::VAULT_LOCKED), "{err}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 한 바이트만 뒤집어도 **오류**이고, 패닉이 아니다.
#[test]
fn a_tampered_ciphertext_is_an_error_not_a_panic() {
    let dir = temp_dir("변조");
    let mut open = create_at(&dir, None, T_M, T_T, T_P).expect("생성");
    open.entries
        .push(entry(Kind::HostPassword, "web-01", "hunter2"));
    save_at(&dir, &open).expect("저장");

    let raw = std::fs::read_to_string(vault_path(&dir)).unwrap();
    let mut env: Envelope = serde_json::from_str(&raw).unwrap();

    // ① 본문 한 바이트.
    let mut body = BASE64.decode(env.ciphertext.as_bytes()).unwrap();
    body[0] ^= 0x01;
    let tampered = Envelope {
        ciphertext: BASE64.encode(&body),
        ..env.clone()
    };
    std::fs::write(vault_path(&dir), serde_json::to_vec(&tampered).unwrap()).unwrap();
    assert!(open_at(&dir, None).is_err(), "본문 변조가 통과했다");

    // ② 논스 한 바이트.
    let mut nonce = BASE64.decode(env.nonce.as_bytes()).unwrap();
    nonce[3] ^= 0x80;
    let tampered = Envelope {
        nonce: BASE64.encode(&nonce),
        ..env.clone()
    };
    std::fs::write(vault_path(&dir), serde_json::to_vec(&tampered).unwrap()).unwrap();
    assert!(open_at(&dir, None).is_err(), "논스 변조가 통과했다");

    // ③ 머리를 바꿔치기 — 키 파일 금고를 마스터 금고인 척 만든다. AAD 가 막는다.
    env.kdf = Kdf::Argon2id {
        salt: BASE64.encode(&[0u8; SALT_LEN]),
        m_cost: T_M,
        t_cost: T_T,
        p_cost: T_P,
    };
    std::fs::write(vault_path(&dir), serde_json::to_vec(&env).unwrap()).unwrap();
    assert!(
        open_at(&dir, Some("아무거나")).is_err(),
        "머리 바꿔치기가 통과했다"
    );

    // ④ 판이 바뀌면 **모르는 형식**이라 열지 않는다 (지어내지 않는다).
    env.version = 99;
    std::fs::write(vault_path(&dir), serde_json::to_vec(&env).unwrap()).unwrap();
    assert!(read_envelope(&dir).is_err());

    // ⑤ 아예 JSON 이 아니면 그것도 오류다.
    std::fs::write(vault_path(&dir), b"not a vault at all").unwrap();
    assert!(read_envelope(&dir).is_err());

    let _ = std::fs::remove_dir_all(&dir);
}

// ── 마스터 걸기·풀기 ────────────────────────────────────────────────────

#[test]
fn setting_and_removing_a_master_re_encrypts_and_toggles_the_key_file() {
    let dir = temp_dir("마스터전환");

    // ① 키 파일로 시작 — 항목 하나를 넣는다.
    let mut open = create_at(&dir, None, T_M, T_T, T_P).expect("생성");
    open.entries
        .push(entry(Kind::HostPassword, "web-01", "hunter2"));
    save_at(&dir, &open).expect("저장");
    assert!(key_path(&dir).exists());
    let before = std::fs::read_to_string(vault_path(&dir)).unwrap();

    // ② 마스터를 건다 — 키 파일이 사라지고 항목은 살아남는다.
    let after_set = set_master_at(&dir, Some("sesame"), None, T_M, T_T, T_P).expect("마스터 걸기");
    assert!(after_set.kdf.has_master());
    assert!(
        !key_path(&dir).exists(),
        "마스터를 걸었는데 키 파일이 남았다"
    );
    let back = open_at(&dir, Some("sesame")).expect("열기");
    assert_eq!(
        back.find(Kind::HostPassword, "web-01")
            .unwrap()
            .value
            .as_str(),
        "hunter2"
    );
    // 다시 암호화됐다 — 파일이 글자로 달라졌다.
    let now = std::fs::read_to_string(vault_path(&dir)).unwrap();
    assert_ne!(before, now);
    // 옛 방식(키 파일)으로는 더 이상 열리지 않는다.
    assert!(open_at(&dir, None).is_err());

    // ③ 현재 마스터가 틀리면 **아무것도 바뀌지 않는다**.
    let err = set_master_at(&dir, None, Some("틀림"), T_M, T_T, T_P).unwrap_err();
    assert!(
        errors::has_reason(&err, errors::VAULT_WRONG_MASTER),
        "{err}"
    );
    assert!(!key_path(&dir).exists(), "실패했는데 키 파일이 생겼다");
    assert!(
        open_at(&dir, Some("sesame")).is_ok(),
        "실패가 금고를 망가뜨렸다"
    );

    // ④ 마스터를 푼다 — 키 파일이 생기고 항목은 살아남는다.
    let after_clear =
        set_master_at(&dir, None, Some("sesame"), T_M, T_T, T_P).expect("마스터 풀기");
    assert!(!after_clear.kdf.has_master());
    assert!(key_path(&dir).exists(), "마스터를 풀었는데 키 파일이 없다");
    let back = open_at(&dir, None).expect("열기");
    assert_eq!(
        back.find(Kind::HostPassword, "web-01")
            .unwrap()
            .value
            .as_str(),
        "hunter2"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// ── 쓰기 ────────────────────────────────────────────────────────────────

#[test]
fn a_successful_write_leaves_no_temporary_file() {
    let dir = temp_dir("임시파일");
    let open = create_at(&dir, None, T_M, T_T, T_P).expect("생성");
    save_at(&dir, &open).expect("저장");

    let left: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(left.is_empty(), "임시 파일이 남았다: {left:?}");

    // 남는 것은 금고와 키 파일 **둘뿐**이다 (임시 이름이 겹치지 않는다는 증거이기도 하다).
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec![VAULT_FILE.to_string(), KEY_FILE.to_string()].tap_sorted()
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// 위 테스트가 쓰는 작은 도우미 — 이름 목록을 정렬해 돌려준다.
trait TapSorted {
    fn tap_sorted(self) -> Self;
}
impl TapSorted for Vec<String> {
    fn tap_sorted(mut self) -> Self {
        self.sort();
        self
    }
}

#[test]
fn writing_twice_uses_a_fresh_nonce() {
    let dir = temp_dir("논스");
    let open = create_at(&dir, None, T_M, T_T, T_P).expect("생성");
    let first: Envelope =
        serde_json::from_str(&std::fs::read_to_string(vault_path(&dir)).unwrap()).unwrap();
    save_at(&dir, &open).expect("저장");
    let second: Envelope =
        serde_json::from_str(&std::fs::read_to_string(vault_path(&dir)).unwrap()).unwrap();
    assert_ne!(first.nonce, second.nonce, "같은 논스를 두 번 썼다");
    let _ = std::fs::remove_dir_all(&dir);
}

// ── 항목 다루기 ─────────────────────────────────────────────────────────

#[test]
fn putting_the_same_target_replaces_instead_of_piling_up() {
    let dir = temp_dir("갈아끼우기");
    let mut open = create_at(&dir, None, T_M, T_T, T_P).expect("생성");
    open.put(
        Kind::HostPassword,
        "web-01".into(),
        Zeroizing::new("a".into()),
    );
    open.put(
        Kind::HostPassword,
        "web-01".into(),
        Zeroizing::new("b".into()),
    );
    // 종류가 다르면 **다른 항목**이다 (별칭과 경로는 이름 공간이 다르다).
    open.put(
        Kind::KeyPassphrase,
        "web-01".into(),
        Zeroizing::new("c".into()),
    );
    assert_eq!(open.entries.len(), 2);
    assert_eq!(
        open.find(Kind::HostPassword, "web-01")
            .unwrap()
            .value
            .as_str(),
        "b"
    );
    assert_eq!(
        open.find(Kind::KeyPassphrase, "web-01")
            .unwrap()
            .value
            .as_str(),
        "c"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn entry_kinds_parse_back_from_their_wire_names() {
    for k in [Kind::HostPassword, Kind::KeyPassphrase, Kind::McpEnv, Kind::DbPassword] {
        assert_eq!(Kind::parse(k.wire()), Some(k));
    }
    assert_eq!(Kind::DbPassword.wire(), "db_password");
    assert_eq!(Kind::DbPassword.target_field(), "conn");
    assert_eq!(Kind::parse("HostPassword"), None);
    assert_eq!(Kind::parse(""), None);
    assert!(parse_kind("nope").is_err());
}

#[test]
fn values_are_refused_when_empty_or_absurd() {
    assert!(check_value("").is_err());
    assert!(check_value("x").is_ok());
    assert!(check_value(&"x".repeat(MAX_VALUE_LEN)).is_ok());
    assert!(check_value(&"x".repeat(MAX_VALUE_LEN + 1)).is_err());
    assert!(check_target("  ").is_err());
    assert!(check_target("web-01").is_ok());
}

/// DB 연결 id 규칙 — `db::conns::validate_one` 과 볼트 `db_password` 대상이 같은 함수 하나를 쓴다.
#[test]
fn db_connection_ids_follow_the_preset_rule() {
    for ok in ["abcd1234", "Xk3_pg-main01", &"a".repeat(32)] {
        assert!(db_conn_id_ok(ok), "{ok}");
    }
    for bad in ["", "abc1234", &"a".repeat(33), "abcd 1234", " abcd1234", "abcd/1234", "가나다라마바사아", "abcd.1234"] {
        assert!(!db_conn_id_ok(bad), "{bad}");
    }
}

/// `db_password` 는 id 모양이 아닌 대상을 받지 않고, 담긴 값은 서버 안 조회 문으로만 나온다.
#[test]
fn db_passwords_are_keyed_by_preset_id_and_answer_only_inside() {
    let dir = temp_dir("db-password");
    let v = Vault::new(Some(dir.clone()));
    create_at(&dir, None, T_M, T_T, T_P).expect("만들기");
    v.unlock(None).expect("열기");
    let pw = || Zeroizing::new("db-s3cret".to_string());
    // 호스트 별칭처럼 생긴 짧은 이름·공백 섞인 id 는 거절한다.
    assert!(v.store(Kind::DbPassword, "web-01".into(), pw()).is_err());
    assert!(v.store(Kind::DbPassword, " Xk3_pg-main01".into(), pw()).is_err());
    v.store(Kind::DbPassword, "Xk3_pg-main01".into(), pw()).unwrap();
    // 같은 글자라도 호스트 비밀번호와는 다른 이름 공간이다.
    assert!(v.has(Kind::DbPassword, "Xk3_pg-main01").unwrap());
    assert!(!v.has(Kind::HostPassword, "Xk3_pg-main01").unwrap());
    assert!(v.password_for("Xk3_pg-main01").is_none());
    assert_eq!(v.db_password_for("Xk3_pg-main01").as_deref().map(String::as_str), Some("db-s3cret"));
    assert!(v.db_password_for("other_id01").is_none());
    let items = v.list().unwrap();
    assert_eq!(items, vec![VaultItem { kind: "db_password", target: "Xk3_pg-main01".into() }]);
    let shown = format!("{:?} {:?} {:?}", v.status(), items, v);
    assert!(!shown.contains("db-s3cret"), "{shown}");
    // 디스크에서 다시 열어도 같은 종류·대상으로 돌아온다(평문 칸 이름 `conn`).
    let back = open_at(&dir, None).expect("다시 열기");
    assert_eq!(back.find(Kind::DbPassword, "Xk3_pg-main01").unwrap().value.as_str(), "db-s3cret");
    // 잠기면 None(접속을 실패시키지 않고 다시 묻게), 지우면 사라진다.
    v.lock(LockReason::User);
    assert!(v.db_password_for("Xk3_pg-main01").is_none());
    v.unlock(None).unwrap();
    v.delete(Kind::DbPassword, "Xk3_pg-main01").unwrap();
    assert!(v.db_password_for("Xk3_pg-main01").is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

// ── 비밀이 `Debug` 로 새지 않는다 ───────────────────────────────────────

#[test]
fn debug_output_never_carries_a_secret() {
    let e = entry(Kind::HostPassword, "web-01", "hunter2");
    let shown = format!("{e:?}");
    assert!(!shown.contains("hunter2"), "{shown}");
    assert!(shown.contains("***"), "{shown}");
    // 대상은 비밀이 아니다 — 진단에 필요하다.
    assert!(shown.contains("web-01"), "{shown}");
    let db = format!("{:?}", entry(Kind::DbPassword, "Xk3_pg-main01", "db-hunter2"));
    assert!(!db.contains("db-hunter2") && db.contains("***") && db.contains("Xk3_pg-main01"), "{db}");

    let open = Open {
        key: Zeroizing::new([7u8; KEY_LEN]),
        kdf: Kdf::Keyfile,
        entries: vec![e],
    };
    let shown = format!("{open:?}");
    assert!(!shown.contains("hunter2"), "{shown}");
    assert!(!shown.contains('7'), "키 바이트가 찍혔다: {shown}");
    assert!(shown.contains("***"), "{shown}");

    // 상태 전체를 찍어도 마찬가지다.
    let shown = format!("{:?}", VaultState::Unlocked(open));
    assert!(!shown.contains("hunter2"), "{shown}");
}

/// 봉투 머리(`Kdf`)는 **비밀이 아니므로** `Debug` 에 그대로 나와도 된다 —
/// 소금과 파라미터뿐이고, 둘 다 파일에 평문으로 적히는 값이다.
#[test]
fn the_header_debug_shows_only_public_parameters() {
    let shown = format!(
        "{:?}",
        Kdf::Argon2id {
            salt: "AAAA".into(),
            m_cost: 1,
            t_cost: 2,
            p_cost: 3
        }
    );
    assert!(shown.contains("m_cost"), "{shown}");
}

// ── 프런트 계약 ─────────────────────────────────────────────────────────

#[test]
fn the_status_payload_is_camel_case_and_has_no_place_for_a_secret() {
    let json: serde_json::Value = serde_json::to_value(VaultStatus {
        state: "unlocked",
        has_master: true,
        entry_count: 2,
        lock_reason: Some("windows_zero"),
        relock: true,
    })
    .unwrap();
    let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    // 유휴 시계가 사라지며 `autoLockMinutes` 도 함께 빠졌다 (2026-09-19 저녁). 잠근 까닭·relock 은 ③-3b1.
    assert_eq!(keys, ["entryCount", "hasMaster", "lockReason", "relock", "state"]);

    // 목록에도 값이 실릴 자리가 없다 — 칸이 둘뿐이다.
    let json: serde_json::Value = serde_json::to_value(VaultItem {
        kind: "host_password",
        target: "web-01".into(),
    })
    .unwrap();
    let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["kind", "target"]);
}

/// 평문 JSON 의 모양이 문서(모듈 머리말)와 같은가 — 종류마다 대상 칸 이름이 다르다.
#[test]
fn the_plaintext_shape_matches_the_documented_one() {
    let entries = vec![
        entry(Kind::HostPassword, "web-01", "a"),
        entry(Kind::KeyPassphrase, "/home/wl/.ssh/id_ed25519", "b"),
        entry(Kind::DbPassword, "Xk3_pg-main01", "c"),
    ];
    let json = serde_json::to_string(&PlainOut {
        entries: &entries,
        updated_at: "2026-09-19T00:00:00+09:00".into(),
    })
    .unwrap();
    assert!(json.contains(r#""kind":"db_password","conn":"Xk3_pg-main01""#), "{json}");
    assert!(
        json.contains(r#""kind":"host_password","alias":"web-01""#),
        "{json}"
    );
    assert!(
        json.contains(r#""kind":"key_passphrase","path":"#),
        "{json}"
    );

    // 그리고 그 글자가 그대로 다시 읽힌다.
    let back: PlainIn = serde_json::from_str(&json).unwrap();
    let back: Vec<Entry> = back.entries.into_iter().map(Entry::from).collect();
    assert_eq!(back, entries);
}

// ── DPAPI (Windows 에서만) ──────────────────────────────────────────────

/// 감싸고 다시 푸는 왕복. 감싼 결과가 **원문과 다르다**는 것도 함께 본다 —
/// 항등 스텁이 실수로 Windows 에 들어오면 여기서 걸린다.
#[cfg(windows)]
#[test]
fn dpapi_wraps_and_unwraps_the_same_bytes() {
    let raw = [0xABu8; KEY_LEN];
    let wrapped = protect_key_bytes(&raw).expect("감싸기");
    assert_ne!(wrapped.as_slice(), &raw[..], "감싸지 않았다");
    assert!(wrapped.len() > raw.len(), "DPAPI 블롭이 너무 짧다");
    let back = unprotect_key_bytes(&wrapped).expect("풀기");
    assert_eq!(back.as_slice(), &raw[..]);

    // 상한 바이트를 뒤집으면 무결성 검사에 걸린다 — 패닉이 아니라 오류다.
    let mut broken = wrapped.clone();
    let last = broken.len() - 1;
    broken[last] ^= 0xFF;
    assert!(unprotect_key_bytes(&broken).is_err());

    // 금고가 아닌 짧은 바이트도 조용히 실패한다.
    assert!(unprotect_key_bytes(b"nope").is_err());
}

// ── 인증 연결 (단계 ② · docs/log/2026-09-19-vault.md) ──────────────────

/// **마스터 금고는 열려 있을 때만 조회를 받아 준다.**
///
/// [`Vault::password_for`]·[`Vault::passphrase_for`] 는 [`Vault::with_open`] → [`ensure_open`] 한 문만
/// 지난다. 그러니 "마스터가 걸린 금고를 마스터 없이 열려 하면 잠긴다" 를 여기서 못
/// 박으면 그 둘도 함께 못 박힌다 — 전역 상태를 건드리지 않고 같은 사실을 본다.
#[test]
fn a_master_vault_is_consulted_only_while_unlocked() {
    let dir = temp_dir("locked-lookup");
    let open = create_at(&dir, Some("master"), T_M, T_T, T_P).expect("만들기");
    assert!(open.kdf.has_master());

    // 아직 아무것도 안 봤다(=`Unopened`) → 디스크를 보고 거절한다.
    let mut state = VaultState::Unopened;
    let err = ensure_open(&mut state, &dir).expect_err("잠겨야 한다");
    assert!(errors::has_reason(&err, errors::VAULT_LOCKED), "{err}");
    // **상태는 그대로다** — `Locked` 를 놓는 것은 `vault_lock` 하나뿐이다.
    assert!(matches!(state, VaultState::Unopened));

    // 그리고 다시 물어도 같은 답이다(조회가 금고를 열지 않는다).
    let err = ensure_open(&mut state, &dir).expect_err("여전히 잠겨야 한다");
    assert!(errors::has_reason(&err, errors::VAULT_LOCKED), "{err}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// **키 파일 금고는 처음 쓸 때 한 번 조용히 열린다** — 앱을 켠 직후가 그 상태다.
#[test]
fn a_keyfile_vault_opens_silently_on_first_use() {
    let dir = temp_dir("keyfile-first-use");
    create_at(&dir, None, T_M, T_T, T_P).expect("만들기");

    let mut state = VaultState::Unopened;
    ensure_open(&mut state, &dir).expect("키 파일 금고는 첫 사용에 열린다");
    assert!(matches!(state, VaultState::Unlocked(_)));

    let _ = std::fs::remove_dir_all(&dir);
}

// ── 가림막과 함께 잠긴다 (2026-09-19 저녁) ──────────────────────────────

/// **잠근 키 파일 금고는 스스로 다시 열리지 않는다.**
///
/// 이것이 이 판의 심장이다. 앞선 판에서 `Locked` 인 키 파일 금고는 다음 접근에 조용히
/// 다시 열렸다("잠금이 뜻을 갖지 않는다"). 이제 가림막이 그 잠금을 걸므로, 조용히 열리면
/// **화면에 적은 말이 거짓이 된다** — `ensure_open` 은 디스크를 보지도 않는다.
#[test]
fn a_locked_keyfile_vault_does_not_reopen_itself() {
    let dir = temp_dir("veil-lock");
    create_at(&dir, None, T_M, T_T, T_P).expect("만들기");

    // 가림막이 걸렸다 = `vault_lock` 이 놓는 그 상태.
    let mut state = VaultState::Locked;
    let err = ensure_open(&mut state, &dir).expect_err("잠겨 있어야 한다");
    assert!(errors::has_reason(&err, errors::VAULT_LOCKED), "{err}");
    assert!(matches!(state, VaultState::Locked));

    // 다시 여는 길은 `vault_unlock` 하나이고, 마스터가 없으므로 **빈 값으로 열린다**.
    let open = open_at(&dir, None).expect("빈 Enter 로 열린다");
    assert!(!open.kdf.has_master());

    // 아무 값을 줘도 같다 — 키 파일 금고는 `master` 를 보지 않는다(확인 관문일 뿐).
    open_at(&dir, Some("")).expect("빈 문자열도 같다");
    open_at(&dir, Some("아무거나")).expect("키 파일 금고는 값을 보지 않는다");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 마스터 금고에서 그 문은 **여전히 암호를 요구한다** — 관문이 하나가 되어도 등급은
/// 그대로다.
#[test]
fn a_locked_master_vault_still_needs_its_password() {
    let dir = temp_dir("veil-lock-master");
    create_at(&dir, Some("master"), T_M, T_T, T_P).expect("만들기");

    // 빈 Enter(= `None`)로는 안 열린다.
    let err = open_at(&dir, None).expect_err("마스터가 필요하다");
    assert!(errors::has_reason(&err, errors::VAULT_LOCKED), "{err}");

    // 틀린 암호도 안 열린다 — "틀렸다" 와 "상했다" 를 구분해 말하지 않는다.
    let err = open_at(&dir, Some("nope")).expect_err("틀린 마스터");
    assert!(
        errors::has_reason(&err, errors::VAULT_WRONG_MASTER),
        "{err}"
    );

    // 맞으면 열린다.
    open_at(&dir, Some("master")).expect("맞는 마스터");

    let _ = std::fs::remove_dir_all(&dir);
}

// ── 가림막이 곧 관문 (2026-09-19 밤) ────────────────────────────────────

/// **열려 있는 금고에도 `vault_unlock` 은 봉투에 값을 맞춰 본다.**
///
/// 가림막이 곧 관문이 되면서 이 성질이 계약이 됐다: 창 A 의 가림막이 볼트를 잠갔다가
/// 창 B 의 접속이 다시 열어 둘 수 있고, 그래도 창 A 의 가림막은 **자기 관문을 그대로
/// 세운다**(화면 잠금은 편의보다 일관성이 먼저다). 그때 사람이 친 암호는 그냥 통과해서는
/// 안 되고, 틀린 암호도 열려 있다는 이유로 받아들여져서는 안 된다.
///
/// 그 성질은 [`Vault::unlock`] 이 전역 상태를 보지 않고 [`open_at`] 하나만 부르기 때문에
/// 공짜로 온다 — 여기서 못 박는 것은 **디스크 왕복이 그 판정**이라는 사실이고, 열린
/// 금고를 다시 열어도 **담긴 것이 그대로**라는 것이다(다시 열기가 비우기가 아니다).
#[test]
fn unlocking_an_open_vault_verifies_the_master_again() {
    let dir = temp_dir("veil-gate-reunlock");
    let mut open = create_at(&dir, Some("master"), T_M, T_T, T_P).expect("만들기");
    open.put(
        Kind::HostPassword,
        "web-01".to_string(),
        Zeroizing::new("hunter2".to_string()),
    );
    save_at(&dir, &open).expect("저장");

    // 금고는 지금 메모리에서 열려 있다(`open`). 그래도 문은 값을 본다.
    let err = open_at(&dir, Some("nope")).expect_err("틀린 마스터");
    assert!(
        errors::has_reason(&err, errors::VAULT_WRONG_MASTER),
        "{err}"
    );

    // 맞는 암호는 **항목 그대로** 다시 연다.
    let again = open_at(&dir, Some("master")).expect("맞는 마스터");
    assert_eq!(again.entries.len(), 1);
    assert_eq!(
        again
            .find(Kind::HostPassword, "web-01")
            .map(|e| e.value.as_str()),
        Some("hunter2"),
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// 비-Windows 스텁의 계약 — 항등이다(모듈 머리말이 그렇게 적혀 있다).
#[cfg(not(windows))]
#[test]
fn the_non_windows_stub_is_the_identity() {
    let raw = [0xABu8; KEY_LEN];
    assert_eq!(protect_key_bytes(&raw).unwrap(), raw.to_vec());
    assert_eq!(unprotect_key_bytes(&raw).unwrap(), raw.to_vec());
}

#[test]
fn unused_mcp_environment_targets_exclude_all_protected_references_and_other_kinds() {
    let entries = vec![
        entry(Kind::McpEnv, "saved-disabled", "a"),
        entry(Kind::McpEnv, "active-ticket", "b"),
        entry(Kind::McpEnv, "pending-dialog", "c"),
        entry(Kind::McpEnv, "unused", "d"),
        entry(Kind::HostPassword, "unused", "e"),
        entry(Kind::KeyPassphrase, "key", "f"),
    ];
    let keep = ["saved-disabled", "active-ticket", "pending-dialog"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    assert_eq!(
        unused_mcp_env(&entries, &keep),
        HashSet::from(["unused".into()])
    );
    assert_eq!(
        unused_mcp_env(&entries, &HashSet::new()),
        HashSet::from([
            "saved-disabled".into(),
            "active-ticket".into(),
            "pending-dialog".into(),
            "unused".into(),
        ])
    );
}

#[test]
fn pruning_mcp_environment_persists_only_unused_entry_removal() {
    let dir = temp_dir("mcp-prune");
    let mut open = create_at(&dir, Some("master"), T_M, T_T, T_P).unwrap();
    for reference in ["saved-disabled", "active-ticket", "pending-dialog", "unused"] {
        open.put(Kind::McpEnv, reference.into(), Zeroizing::new("fixture".into()));
    }
    open.put(Kind::HostPassword, "unused".into(), Zeroizing::new("host".into()));
    open.put(Kind::KeyPassphrase, "key".into(), Zeroizing::new("key".into()));
    save_at(&dir, &open).unwrap();
    let keep = ["saved-disabled", "active-ticket", "pending-dialog"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    prune_mcp_env_at(&dir, &mut open, &keep).unwrap();
    let back = open_at(&dir, Some("master")).unwrap();
    assert_eq!(back.entries.len(), 5);
    assert!(back.find(Kind::McpEnv, "unused").is_none());
    for reference in &keep {
        assert!(back.find(Kind::McpEnv, reference).is_some());
    }
    assert!(back.find(Kind::HostPassword, "unused").is_some());
    assert!(back.find(Kind::KeyPassphrase, "key").is_some());
    let raw = std::fs::read_to_string(vault_path(&dir)).unwrap();
    prune_mcp_env_at(&dir, &mut open, &keep).unwrap();
    assert_eq!(std::fs::read_to_string(vault_path(&dir)).unwrap(), raw);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn mcp_secret_values_reject_header_injection_controls() {
    assert!(mcp_value_ok(""));
    assert!(mcp_value_ok("Bearer fixture"));
    for value in ["fixture\r", "fixture\n", "fixture\0"] {
        assert!(!mcp_value_ok(value));
    }
    assert!(!mcp_value_ok(&"a".repeat(MAX_VALUE_LEN + 1)));
}

// ── 잠근 까닭 (③-3b1 · 세션 서버의 한 벌) ─────────────────────────────

/// **창 0개 잠금은 덮이지 않고, 열려 있던 금고만 relock 을 단다.**
///
/// - 열린 금고 → `WindowsZero` = relock(다음 GUI 가 가림막을 세운다) · 그 위의 `Shade` 는 까닭을 바꾸지 않는다(정지가
///   폐기로 바뀌지 않게) · 해제하면 까닭·relock 이 지워진다.
/// - 가림막으로 잠긴 금고 → 다시 가림막 = 까닭 그대로 `Shade`(티켓을 다시 거둔다) · 그 위의 `WindowsZero` 는 relock 없음
///   (사람이 이미 잠근 금고를 "열려 있던" 것으로 꾸미지 않는다).
/// - 아직 안 연(`Unopened`) 키 파일 금고도 잠긴다 — 창이 없는 동안 브로커 요청이 조용히 열면 안 된다.
#[test]
fn lock_reasons_keep_windows_zero_and_relock_only_an_open_vault() {
    let dir = temp_dir("lock-reasons");
    create_at(&dir, None, T_M, T_T, T_P).expect("만들기");
    let v = Vault::new(Some(dir.clone()));

    // Unopened 키 파일 금고 — 창 0개로 잠그면 조용히 다시 열리지 않는다(relock 은 없다 — 열린 적이 없다).
    assert_eq!(v.lock(LockReason::WindowsZero), LockReason::WindowsZero);
    assert!(v.mcp_env_for("x").is_err());
    let st = v.status();
    assert_eq!((st.state, st.lock_reason, st.relock), ("locked", Some("windows_zero"), false));

    v.unlock(None).expect("빈 Enter");
    assert!(v.is_unlocked());
    assert_eq!(v.lock(LockReason::WindowsZero), LockReason::WindowsZero);
    let st = v.status();
    assert_eq!((st.state, st.lock_reason, st.relock), ("locked", Some("windows_zero"), true));
    assert_eq!(v.lock(LockReason::Shade), LockReason::WindowsZero, "정지가 폐기로 바뀌지 않는다");

    v.unlock(None).expect("빈 Enter");
    let st = v.status();
    assert_eq!((st.state, st.lock_reason, st.relock), ("unlocked", None, false));

    assert_eq!(v.lock(LockReason::Shade), LockReason::Shade);
    assert_eq!(v.lock(LockReason::User), LockReason::User, "가림막·사람 잠금은 다시 걸 때마다 까닭을 갈아 적는다");
    assert_eq!(v.lock(LockReason::WindowsZero), LockReason::WindowsZero);
    assert!(!v.status().relock, "이미 잠긴 금고에는 relock 을 달지 않는다");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 값은 담고 지우고 정리하는 동안 **조회 문으로만** 나온다 — 상태·목록에는 없다.
#[test]
fn a_vault_instance_stores_and_answers_without_values() {
    let dir = temp_dir("instance");
    let v = Vault::new(Some(dir.clone()));
    assert_eq!(v.status().state, "absent");
    create_at(&dir, Some("master"), T_M, T_T, T_P).expect("만들기");
    v.unlock(Some("master")).expect("열기");
    v.store(Kind::HostPassword, "web-01".into(), Zeroizing::new("hunter2".into())).unwrap();
    assert!(v.store(Kind::McpEnv, "x".into(), Zeroizing::new("v".into())).is_err(), "MCP 값은 따로 담는다");
    let reference = v.store_mcp_env("global/pg/DATABASE_URL", Zeroizing::new("postgres://s3cret".into())).unwrap();
    assert!(v.has(Kind::HostPassword, "web-01").unwrap());
    let shown = format!("{:?} {:?} {:?}", v.status(), v.list().unwrap(), v);
    assert!(!shown.contains("hunter2") && !shown.contains("s3cret"), "{shown}");
    assert_eq!(v.password_for("web-01").as_deref().map(String::as_str), Some("hunter2"));
    // 저장된 설정에도 티켓에도 없는 MCP 참조는 정리된다(pending 은 저장으로 빠진다).
    v.prune_mcp_env(HashSet::from([reference.clone()]), HashSet::new()).unwrap();
    assert!(v.has(Kind::McpEnv, &reference).unwrap());
    v.prune_mcp_env(HashSet::new(), HashSet::new()).unwrap();
    assert!(!v.has(Kind::McpEnv, &reference).unwrap());
    // 마스터 금고는 잠근 뒤 빈 값으로 안 열린다.
    v.lock(LockReason::User);
    assert!(v.password_for("web-01").is_none());
    assert!(v.unlock(None).is_err());
    v.unlock(Some("master")).unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

// ── 잠금 뒤 끝난 열기 (재리뷰 R01 · 2026-10-10) ────────────────────────

/// **KDF 가 도는 동안 걸린 잠금을 늦게 끝난 열기가 되돌리지 못한다.**
///
/// `unlock` 은 세대를 쥐고(`begin`) → 락 밖에서 KDF(`open_at`) → 락 안에서 같은 세대일 때만 연다(`apply_unlocked`).
/// 스레드 없이 그 틈에 잠금을 끼워 넣는다 — 창 0개 잠금이면 까닭·relock 도 그 잠금이 놓은 그대로여야 한다.
#[test]
fn a_lock_during_unlock_wins_and_keeps_its_reason() {
    let dir = temp_dir("unlock-race");
    create_at(&dir, None, T_M, T_T, T_P).expect("만들기");
    let v = Vault::new(Some(dir.clone()));
    v.unlock(None).expect("빈 Enter");

    // 열린 금고 — 해제(다시 열기)가 KDF 를 도는 사이 마지막 창이 닫혔다.
    let generation = v.begin();
    let open = open_at(&dir, None).expect("KDF");
    assert_eq!(v.lock(LockReason::WindowsZero), LockReason::WindowsZero);
    let err = v.apply_unlocked(generation, open).expect_err("잠금 뒤의 열기는 무효");
    assert!(errors::has_reason(&err, errors::VAULT_LOCKED), "{err}");
    let st = v.status();
    assert_eq!((st.state, st.lock_reason, st.relock), ("locked", Some("windows_zero"), true));

    // 창 0개로 잠긴 금고에 가림막이 다시 걸려도(까닭은 그대로) 그 사이 시작된 해제는 진다.
    let generation = v.begin();
    let open = open_at(&dir, None).expect("KDF");
    assert_eq!(v.lock(LockReason::Shade), LockReason::WindowsZero);
    assert!(v.apply_unlocked(generation, open).is_err());
    assert_eq!(v.status().state, "locked");

    // 사이에 잠금이 없으면 예전 그대로 열린다.
    v.unlock(None).expect("빈 Enter");
    assert!(v.is_unlocked());

    let _ = std::fs::remove_dir_all(&dir);
}

/// 원격 웹 R1a-2 — `verify_master` 는 **확인만** 한다: 맞음·틀림·마스터 없음·금고 없음을 가르고, 잠긴 금고를 열지도·열린
/// 금고를 잠그지도·까닭을 바꾸지도 않는다.
#[test]
fn verify_master_checks_without_changing_state() {
    // 금고 없음
    let empty = temp_dir("verify-none");
    assert_eq!(Vault::new(Some(empty.clone())).verify_master("x"), Ok(MasterCheck::NoVault));
    let _ = std::fs::remove_dir_all(&empty);

    // 마스터 금고(작은 파라미터 — 봉투가 파라미터를 들고 있다)
    let dir = temp_dir("verify-master");
    let mut open = create_at(&dir, Some("master"), T_M, T_T, T_P).expect("만들기");
    open.put(Kind::HostPassword, "web-01".into(), Zeroizing::new("hunter2".into()));
    save_at(&dir, &open).expect("저장");
    drop(open);
    let v = Vault::new(Some(dir.clone()));
    v.lock(LockReason::Shade);
    assert_eq!(v.verify_master("master"), Ok(MasterCheck::Ok));
    assert_eq!(v.verify_master("nope"), Ok(MasterCheck::Bad));
    assert_eq!(v.verify_master(""), Ok(MasterCheck::Bad));
    // 맞는 암호로 확인해도 잠긴 채 · 까닭 그대로
    assert!(!v.is_unlocked());
    assert_eq!(v.status().lock_reason, Some("shade"));
    // 열린 금고에서 틀린 암호를 확인해도 잠기지 않는다
    v.unlock(Some("master")).expect("열기");
    assert_eq!(v.verify_master("nope"), Ok(MasterCheck::Bad));
    assert!(v.is_unlocked());
    let _ = std::fs::remove_dir_all(&dir);

    // 키 파일 금고 — 마스터 없음(무엇을 넣어도)
    let kf = temp_dir("verify-keyfile");
    create_at(&kf, None, T_M, T_T, T_P).expect("만들기");
    let v = Vault::new(Some(kf.clone()));
    assert_eq!(v.verify_master("anything"), Ok(MasterCheck::NoMaster));
    assert_eq!(v.verify_master(""), Ok(MasterCheck::NoMaster));
    let _ = std::fs::remove_dir_all(&kf);

    assert_eq!(
        [MasterCheck::Ok, MasterCheck::Bad, MasterCheck::NoMaster, MasterCheck::NoVault].map(MasterCheck::wire),
        ["ok", "bad", "no-master", "no-vault"]
    );
}
