use super::*;

/// 테스트마다 겹치지 않는 임시 경로 (settings.rs 의 같은 헬퍼와 동일한 규칙).
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("aynx-배치-{tag}-{}-{nanos}", std::process::id()));
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

/// 프런트가 보낼 법한 모양 — 백엔드는 이 구조를 **모른 채** 문자열로만 다룬다.
const SAMPLE: &str = r#"{"version":1,"tabs":[{"id":"t1","name":"운영","tree":{"split":"row","panes":[{"host":"web-01"},{"host":"db-01"}]}}]}"#;

#[test]
fn save_then_load_returns_the_same_string() {
    let tmp = TempDir::new("왕복");
    let path = tmp.path("workspaces.json");

    assert!(save_at(&path, SAMPLE).expect("저장"));
    assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(SAMPLE));
}

/// 백엔드는 스키마를 검사하지 않는다 — JSON 이 아니어도 그대로 왕복한다
/// (판단은 프런트 몫. `theme` 프리셋 키를 그대로 보관하는 것과 같은 분담).
#[test]
fn content_is_stored_verbatim_without_validation() {
    let tmp = TempDir::new("무검증");
    let path = tmp.path("workspaces.json");

    let junk = "{이건 JSON 이 아니다";
    save_at(&path, junk).expect("저장");
    assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(junk));
}

/// 모양 프로필도 **같은 헬퍼·같은 무검증 왕복**이다 (`theme-profiles.json`).
///
/// 백엔드는 `appearance` 안을 들여다보지 않는다 — 색 문자열이든 모르는 키든 그대로
/// 나갔다 그대로 돌아온다 (판단은 프런트의 `parseProfiles`).
#[test]
fn theme_profiles_round_trip_verbatim() {
    let tmp = TempDir::new("모양프로필");
    let path = tmp.path("theme-profiles.json");

    let sample = r##"{"version":1,"active":"P1","profiles":[{"id":"P1","name":"밤","savedAt":1,"appearance":{"app":{"accent":"#d9705a","mode":"dark"},"terminal":{"theme":"dynamic"},"wallpaper":{"file":"wallpaper.jpg"}}}]}"##;
    assert!(save_at(&path, sample).expect("저장"));
    assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(sample));

    // 같은 내용이면 디스크를 안 때린다 (프리셋과 같은 규칙).
    assert!(!save_at(&path, sample).expect("같은 내용"));

    // 파일이 따로다 — 프리셋 파일을 건드리지 않는다.
    let layouts = tmp.path("layouts.json");
    assert!(!layouts.exists());
}

#[test]
fn missing_file_loads_as_none() {
    let tmp = TempDir::new("없는파일");
    assert_eq!(
        load_at(&tmp.path("전혀-없는-파일.json")).expect("읽기"),
        None
    );
}

#[test]
fn save_creates_missing_directories() {
    let tmp = TempDir::new("폴더생성");
    // 첫 실행 — `<config_dir>/aynx` 가 통째로 없는 상황.
    let path = tmp.path("aynx").join("nested").join("workspaces.json");
    assert!(!path.parent().expect("부모").exists());

    save_at(&path, SAMPLE).expect("저장");
    assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(SAMPLE));
}

/// 디바운스 틱마다 같은 내용이 들어와도 디스크는 한 번만 맞는다.
#[test]
fn unchanged_content_is_not_rewritten() {
    let tmp = TempDir::new("무변경");
    let path = tmp.path("workspaces.json");

    assert!(
        save_at(&path, SAMPLE).expect("첫 저장"),
        "첫 저장은 실제로 써야 한다"
    );
    assert!(
        !save_at(&path, SAMPLE).expect("같은 내용"),
        "같은 내용은 쓰지 않는다"
    );
    assert!(!save_at(&path, SAMPLE).expect("또 같은 내용"));

    // 한 글자만 달라도 다시 쓴다.
    let changed = SAMPLE.replace("운영", "개발");
    assert!(save_at(&path, &changed).expect("바뀐 내용"));
    assert_eq!(
        load_at(&path).expect("읽기").as_deref(),
        Some(changed.as_str())
    );
}

/// 파일이 없을 때의 첫 저장도 "무변경" 으로 오해하면 안 된다 (`None != Some(json)`).
#[test]
fn first_save_into_an_empty_directory_actually_writes() {
    let tmp = TempDir::new("첫저장");
    let path = tmp.path("workspaces.json");
    assert!(!path.exists());
    assert!(save_at(&path, SAMPLE).expect("저장"));
    assert!(path.exists());
}

#[test]
fn empty_input_is_rejected_and_leaves_the_old_file_alone() {
    let tmp = TempDir::new("빈입력");
    let path = tmp.path("workspaces.json");
    save_at(&path, SAMPLE).expect("저장");

    for bad in ["", "   ", "\n\t "] {
        assert!(
            save_at(&path, bad).is_err(),
            "빈 입력을 받아들이면 안 된다: {bad:?}"
        );
    }
    // 거절당한 저장이 이전 배치를 날리지 않았다.
    assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(SAMPLE));

    // 파일이 없는 상태에서도 마찬가지로 거절이고, 파일이 생기지도 않는다.
    let fresh = tmp.path("fresh.json");
    assert!(save_at(&fresh, "").is_err());
    assert!(!fresh.exists());
}

/// 저장이 끝난 뒤 임시 파일이 남아 있으면 안 된다 (rename 으로 갈아친다).
#[test]
fn no_temp_file_is_left_behind() {
    let tmp = TempDir::new("임시파일");
    let path = tmp.path("workspaces.json");
    save_at(&path, SAMPLE).expect("첫 저장");
    save_at(&path, "{\"version\":2}").expect("덮어쓰기");

    let leftovers: Vec<_> = std::fs::read_dir(&tmp.0)
        .expect("디렉터리 읽기")
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "임시 파일이 남았다: {leftovers:?}");
}

/// 큰 배치(탭·타일이 많은 실사용 규모)도 그대로 왕복한다.
#[test]
fn large_payload_round_trips() {
    let tmp = TempDir::new("큰파일");
    let path = tmp.path("workspaces.json");

    let tabs: Vec<String> = (0..200)
        .map(|i| format!(r#"{{"id":"t{i}","name":"탭 {i}","host":"host-{i}"}}"#))
        .collect();
    let big = format!(r#"{{"version":1,"tabs":[{}]}}"#, tabs.join(","));

    save_at(&path, &big).expect("저장");
    assert_eq!(load_at(&path).expect("읽기").as_deref(), Some(big.as_str()));
    // 같은 큰 내용을 다시 저장하면 생략된다.
    assert!(!save_at(&path, &big).expect("같은 내용"));
}

// ---------------------------------------------------------------------------
// 모양 프로필 — 조작 단위 쓰기 (2026-11-03)
// ---------------------------------------------------------------------------

fn prof(id: &str, name: &str) -> serde_json::Value {
    serde_json::json!({ "id": id, "name": name, "savedAt": 1, "appearance": { "app": { "mode": "dark" } } })
}

fn read_doc(path: &Path) -> serde_json::Value {
    serde_json::from_str(&load_at(path).unwrap().unwrap()).unwrap()
}

fn ids(doc: &serde_json::Value) -> Vec<String> {
    doc["profiles"].as_array().unwrap().iter().map(|p| p["id"].as_str().unwrap().to_string()).collect()
}

/// 두 창이 각자 옛 사본을 들고 있어도 — 조작은 디스크의 최신 위에 얹히므로 서로의 변경을 지우지 않는다.
#[test]
fn profile_ops_from_two_windows_keep_each_others_changes() {
    let tmp = TempDir::new("profiles-merge");
    let path = tmp.path("theme-profiles.json");
    edit_profiles_at(&path, ProfileOp::Put { profile: prof("A", "밤"), max: 40, activate: true }).unwrap();
    edit_profiles_at(&path, ProfileOp::Put { profile: prof("B", "낮"), max: 40, activate: false }).unwrap();
    // 창 1: A 의 배치 자동 저장 · 창 2: B 이름 바꾸기 — 어느 쪽도 다른 쪽을 덮지 않는다
    let board = serde_json::json!({ "widgets": [], "clock": { "hour12": true, "seconds": false, "date": true, "size": 88 } });
    edit_profiles_at(&path, ProfileOp::Board { id: "A".into(), board: board.clone() }).unwrap();
    edit_profiles_at(&path, ProfileOp::Rename { id: "B".into(), name: "  아침 ".into() }).unwrap();
    let doc = read_doc(&path);
    assert_eq!(ids(&doc), ["B", "A"]);
    assert_eq!(doc["active"], "A");
    assert_eq!(doc["profiles"][1]["startBoard"], board);
    assert_eq!(doc["profiles"][1]["savedAt"], 1, "배치 칸 쓰기는 저장 시각 · 자리를 바꾸지 않는다");
    assert_eq!(doc["profiles"][0]["name"], "아침");
    // 덮어쓰기(Put)는 그 프로필 한 벌 전체 — 맨 앞으로 · activate 가 아니면 고른 것은 그대로
    edit_profiles_at(&path, ProfileOp::Put { profile: prof("A", "밤"), max: 40, activate: false }).unwrap();
    let doc = read_doc(&path);
    assert_eq!(ids(&doc), ["A", "B"]);
    assert_eq!(doc["active"], "A");
}

#[test]
fn profile_op_rules() {
    let mut doc = profile_doc(None);
    assert!(apply_profile_op(&mut doc, ProfileOp::Put { profile: prof("A", "밤"), max: 2, activate: true }).unwrap());
    apply_profile_op(&mut doc, ProfileOp::Put { profile: prof("B", "낮"), max: 2, activate: false }).unwrap();
    apply_profile_op(&mut doc, ProfileOp::Put { profile: prof("C", "새벽"), max: 2, activate: false }).unwrap();
    assert_eq!(ids(&doc), ["C", "B"], "상한을 넘으면 가장 오래된 것부터 민다");
    assert_eq!(doc["active"], serde_json::Value::Null, "밀려난 프로필은 고른 것으로 남지 않는다");
    // 이름 겹침(대소문자 · 공백 무시) · 빈 이름은 아무 일도 없다
    assert!(!apply_profile_op(&mut doc, ProfileOp::Rename { id: "C".into(), name: " 낮 ".into() }).unwrap());
    assert!(!apply_profile_op(&mut doc, ProfileOp::Rename { id: "C".into(), name: "  ".into() }).unwrap());
    // 없는 id 의 배치 · 고르기
    assert!(!apply_profile_op(&mut doc, ProfileOp::Board { id: "Z".into(), board: serde_json::json!({}) }).unwrap());
    assert!(!apply_profile_op(&mut doc, ProfileOp::Activate { id: Some("Z".into()) }).unwrap());
    assert!(apply_profile_op(&mut doc, ProfileOp::Activate { id: Some("B".into()) }).unwrap());
    // 고른 것을 지우면 고른 것도 비운다
    assert!(apply_profile_op(&mut doc, ProfileOp::Remove { id: "B".into() }).unwrap());
    assert_eq!(ids(&doc), ["C"]);
    assert_eq!(doc["active"], serde_json::Value::Null);
    // id 없는 Put 은 오류
    assert!(apply_profile_op(&mut doc, ProfileOp::Put { profile: serde_json::json!({ "name": "x" }), max: 40, activate: false }).is_err());
}

/// 없음 · 깨짐 · 모르는 판은 빈 목록에서 시작한다(예전 통째 쓰기와 같은 결과) · 무변경 조작은 바뀜으로 치지 않는다.
#[test]
fn profile_file_fallbacks_and_unchanged_ops() {
    let tmp = TempDir::new("profiles-fallback");
    let path = tmp.path("theme-profiles.json");
    for bad in ["{", r#"{"version":2,"profiles":[]}"#, r#"{"version":1}"#] {
        save_at(&path, bad).unwrap();
        let (json, changed) = edit_profiles_at(&path, ProfileOp::Activate { id: None }).unwrap();
        assert!(!changed);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&json).unwrap()["profiles"], serde_json::json!([]));
    }
    // 파일이 없으면 빈 목록을 써 둔다(다음 읽기가 같은 판을 보게)
    let other = tmp.path("none/theme-profiles.json");
    let (_, changed) = edit_profiles_at(&other, ProfileOp::Remove { id: "x".into() }).unwrap();
    assert!(!changed);
    assert!(load_at(&other).unwrap().is_some());
}

/// 옛 통째 쓰기 파일(모르는 칸 포함)을 그대로 이어받는다 — 모르는 칸을 버리지 않는다.
#[test]
fn profile_ops_keep_unknown_fields() {
    let tmp = TempDir::new("profiles-keep");
    let path = tmp.path("theme-profiles.json");
    save_at(&path, r##"{"version":1,"active":"P1","profiles":[{"id":"P1","name":"밤","savedAt":5,"appearance":{"app":{"accent":"#d9705a"}},"미래칸":{"x":1}}]}"##).unwrap();
    edit_profiles_at(&path, ProfileOp::Board { id: "P1".into(), board: serde_json::json!({ "widgets": [] }) }).unwrap();
    let doc = read_doc(&path);
    assert_eq!(doc["profiles"][0]["미래칸"]["x"], 1);
    assert_eq!(doc["profiles"][0]["appearance"]["app"]["accent"], "#d9705a");
    assert_eq!(doc["active"], "P1");
}
