use super::*;
use crate::ssh::OpenDiag;

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("aynx-이력-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("임시 폴더 생성");
        Self(dir)
    }
    fn path(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn fail(cause: OpenCause, msg: &str) -> Outcome {
    Outcome::Fail {
        cause,
        message: Some(msg.to_string()),
    }
}

#[test]
fn success_counts_and_failure_keeps_cause() {
    let mut f = HistoryFile::default();
    apply(&mut f, "web-01", 100, &Outcome::Ok);
    apply(&mut f, "web-01", 200, &Outcome::Ok);
    apply(
        &mut f,
        "web-01",
        300,
        &fail(OpenCause::TcpRefused, "Connection refused"),
    );
    let e = &f.hosts["web-01"];
    assert_eq!(e.last_ok_at, Some(200));
    assert_eq!(e.count, 2);
    assert_eq!(e.last_fail_at, Some(300));
    assert_eq!(e.last_fail_cause.as_deref(), Some("tcp_refused"));
    assert_eq!(e.last_fail_message.as_deref(), Some("Connection refused"));
    // 빈 별칭은 적지 않는다.
    apply(&mut f, "  ", 1, &Outcome::Ok);
    assert_eq!(f.hosts.len(), 1);
}

#[test]
fn message_is_capped_and_paths_are_masked() {
    let long = "가".repeat(400);
    let m = short_message(&long).unwrap();
    assert_eq!(m.chars().count(), MESSAGE_CAP);
    assert!(m.ends_with('…'));

    let m =
        short_message("could not read C:\\Users\\me\\.ssh\\id_ed25519: denied\nsecond").unwrap();
    assert!(!m.contains("id_ed25519"), "{m}");
    assert!(!m.contains("second"));
    let m = short_message("open ~/.ssh/config failed at /home/me/key").unwrap();
    assert_eq!(m, "open … failed at …");
    assert_eq!(short_message("  \n "), None);
}

#[test]
fn prompts_are_not_failures_and_auth_has_no_message() {
    let pw: Result<(), SshOpenError> = Err(SshOpenError::password_required("x"));
    assert_eq!(outcome_of(&pw), None);
    let pp: Result<(), SshOpenError> = Err(SshOpenError::PassphraseRequired {
        path: "C:\\k".into(),
        fingerprint: None,
        wrong: false,
        stored_rejected: false,
    });
    assert_eq!(outcome_of(&pp), None);
    let hk: Result<(), SshOpenError> = Err(SshOpenError::HostKeyUnknown {
        fingerprint: "f".into(),
        key_type: "t".into(),
        host: "h".into(),
        port: 22,
        no_store: false,
    });
    assert_eq!(outcome_of(&hk), None);

    let auth: Result<(), SshOpenError> = Err(SshOpenError::auth_with(
        OpenCause::AuthKeyRejected,
        "agent key /k rejected",
    ));
    assert_eq!(
        outcome_of(&auth),
        Some(Outcome::Fail {
            cause: OpenCause::AuthKeyRejected,
            message: None
        })
    );
    let dns: Result<(), SshOpenError> = Err(SshOpenError::Other {
        message: "no such host".into(),
        diag: OpenDiag::of(OpenCause::Dns),
    });
    assert_eq!(
        outcome_of(&dns),
        Some(Outcome::Fail {
            cause: OpenCause::Dns,
            message: Some("no such host".into())
        })
    );
    assert_eq!(outcome_of::<u32>(&Ok(1)), Some(Outcome::Ok));
}

#[test]
fn corrupt_or_missing_file_starts_empty() {
    let tmp = TempDir::new("깨짐");
    let path = tmp.path("history.json");
    assert_eq!(load_file(&path), HistoryFile::default());
    std::fs::write(&path, "{ not json").unwrap();
    assert_eq!(load_file(&path), HistoryFile::default());
    // 깨진 파일 위에도 다음 기록은 성공한다.
    let changed = modify(&path, |f| {
        apply(f, "db", 5, &Outcome::Ok);
        true
    })
    .unwrap();
    assert!(changed);
    assert_eq!(load_file(&path).hosts["db"].count, 1);
}

#[test]
fn file_shape_round_trips() {
    let tmp = TempDir::new("왕복");
    let path = tmp.path("history.json");
    let mut f = HistoryFile::default();
    apply(&mut f, "a", 1, &Outcome::Ok);
    write_file(&path, &f).unwrap();
    let raw = std::fs::read_to_string(&path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["hosts"]["a"]["last_ok_at"], 1);
    assert!(v["hosts"]["a"]["last_fail_at"].is_null());
    assert_eq!(v["hosts"]["a"]["count"], 1);
    assert_eq!(load_file(&path), f);
}

#[test]
fn rename_and_forget_follow_alias_case_insensitively() {
    let mut f = HistoryFile::default();
    apply(&mut f, "Web", 10, &Outcome::Ok);
    apply(&mut f, "web-new", 20, &Outcome::Ok);
    apply(&mut f, "web-new", 30, &fail(OpenCause::Dns, "x"));
    assert!(rename(&mut f, "web", "web-new"));
    assert!(!f.hosts.contains_key("Web"));
    let e = &f.hosts["web-new"];
    assert_eq!(e.count, 2);
    assert_eq!(e.last_ok_at, Some(20));
    assert_eq!(e.last_fail_cause.as_deref(), Some("dns"));
    assert!(!rename(&mut f, "nope", "x"));

    assert!(forget(&mut f, "WEB-NEW"));
    assert!(f.hosts.is_empty());
    assert!(!forget(&mut f, "web-new"));
}
