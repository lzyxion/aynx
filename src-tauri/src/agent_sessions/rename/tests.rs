use super::*;
use std::time::{Duration, SystemTime};

const ID: &str = "11111111-2222-4333-8444-555555555555";

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aynx-rename-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn claude() -> &'static SessionTarget {
    target("claude").unwrap()
}

/// Claude 대화 하나(사용자 · 응답 줄 — 목록에 오르는 최소 모양)를 `<root>/<proj>/<id>.jsonl` 에. `tail` 은 끝에 붙일 날 글자.
fn claude_convo(root: &Path, cwd: &Path, tail: &str) -> PathBuf {
    let dir = root.join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    let cwd = cwd.to_string_lossy();
    let body = [
        json!({"type": "user", "cwd": cwd, "sessionId": ID, "timestamp": "2026-09-20T01:02:03.000Z",
               "message": {"role": "user", "content": "first prompt"}}),
        json!({"type": "assistant", "cwd": cwd, "timestamp": "2026-09-20T01:05:00.000Z",
               "message": {"model": "m", "content": []}}),
    ]
    .iter()
    .map(|v| v.to_string() + "\n")
    .collect::<String>();
    let p = dir.join(format!("{ID}.jsonl"));
    std::fs::write(&p, body + tail).unwrap();
    p
}

/// 수정 시각을 `ago` 밀리초 전으로.
fn age(path: &Path, ago_ms: u64) {
    let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    f.set_modified(SystemTime::now() - Duration::from_millis(ago_ms)).unwrap();
}

fn listed_title(root: &Path, cwd: &Path) -> (String, TitleSource) {
    let list = scan(&[(claude(), vec![root.to_path_buf()])], &[cwd.to_string_lossy().into_owned()], 10);
    let s = &list.groups[0].sessions[0];
    (s.title.clone(), s.title_source)
}

#[test]
fn clean_name_folds_whitespace_and_refuses_empty_control_and_long() {
    assert_eq!(clean_name("  my\n  name\t ").unwrap(), "my name");
    assert!(clean_name("   \n").is_err());
    assert!(clean_name("a\u{7}b").is_err());
    assert!(clean_name("a\u{200b}b").is_ok(), "제어 문자가 아닌 것은 받는다");
    let max: String = "가".repeat(TITLE_MAX_CHARS);
    assert_eq!(clean_name(&max).unwrap(), max);
    assert!(clean_name(&format!("{max}x")).is_err(), "자르지 않고 거절");
}

#[test]
fn claude_rename_appends_one_custom_title_line_and_the_list_shows_it() {
    let d = temp_dir("claude");
    let root = d.join("projects");
    let p = claude_convo(&root, &d, "");
    age(&p, 10 * 60_000);
    let before = std::fs::metadata(&p).unwrap().modified().unwrap();
    // 목록을 먼저 한 번 — 캐시에 옛 제목이 앉은 뒤에도 바뀐 이름이 보여야 한다.
    assert_eq!(listed_title(&root, &d).1, TitleSource::Prompt);
    rename_in(claude(), std::slice::from_ref(&root), &ID.to_ascii_uppercase(), "  New\nname ", now_ms(), &[]).unwrap();
    let text = std::fs::read_to_string(&p).unwrap();
    let last = text.lines().last().unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(last).unwrap(),
        json!({"type": "custom-title", "customTitle": "New name", "sessionId": ID})
    );
    assert!(text.ends_with('\n'));
    assert_eq!(std::fs::metadata(&p).unwrap().modified().unwrap(), before, "수정 시각은 그대로");
    assert_eq!(listed_title(&root, &d), ("New name".to_string(), TitleSource::Custom));
    // 다시 바꾸면 나중 줄이 이긴다.
    rename_in(claude(), std::slice::from_ref(&root), ID, "Second", now_ms(), &[]).unwrap();
    assert_eq!(listed_title(&root, &d).0, "Second");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn claude_rename_starts_a_new_line_after_a_half_written_one() {
    let d = temp_dir("half");
    let root = d.join("projects");
    let p = claude_convo(&root, &d, "{\"type\":\"user\",\"cut");
    age(&p, 10 * 60_000);
    rename_in(claude(), std::slice::from_ref(&root), ID, "n", now_ms(), &[]).unwrap();
    let text = std::fs::read_to_string(&p).unwrap();
    assert!(text.ends_with("{\"type\":\"user\",\"cut\n{\"type\":\"custom-title\",\"customTitle\":\"n\",\"sessionId\":\"11111111-2222-4333-8444-555555555555\"}\n"));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn rename_refuses_a_just_written_conversation_bad_id_and_unknown_id() {
    let d = temp_dir("guard");
    let root = d.join("projects");
    let p = claude_convo(&root, &d, "");
    let size = std::fs::metadata(&p).unwrap().len();
    // 방금 쓰였다(지금 시각) — 다른 곳에서 열린 CLI 가 덧붙이는 중일 수 있다.
    assert!(rename_in(claude(), std::slice::from_ref(&root), ID, "x", now_ms(), &[]).is_err());
    assert_eq!(std::fs::metadata(&p).unwrap().len(), size, "아무것도 쓰지 않았다");
    // 창 밖(3분 전)이면 된다 — 시각은 받은 값으로 잰다.
    age(&p, 3 * 60_000);
    assert!(rename_in(claude(), std::slice::from_ref(&root), "not-a-uuid", "x", now_ms(), &[]).is_err());
    assert!(rename_in(claude(), std::slice::from_ref(&root), "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "x", now_ms(), &[]).is_err());
    assert!(rename_in(claude(), std::slice::from_ref(&root), ID, " ", now_ms(), &[]).is_err(), "빈 이름");
    assert_eq!(std::fs::metadata(&p).unwrap().len(), size);
    assert!(rename_in(claude(), std::slice::from_ref(&root), ID, "ok", now_ms(), &[]).is_ok());
    let _ = std::fs::remove_dir_all(&d);
}

/// 세션 서버 장부(`agent_state::convo`)와 같은 문 — 막 닫은 타일의 대화(놓인 뒤 쓰기 없음)는 2분 안이라도 곧바로 되고, Aynx 의 산
/// 스트림에 연결된 대화는 오래전에 쓰였어도 거절, 놓인 뒤 유예보다 늦게 쓰였으면 예전처럼 거절.
#[test]
fn rename_follows_the_server_ledger() {
    use crate::agent_state::convo::{ConvoLinkRow, RELEASE_GRACE_MS};
    let d = temp_dir("ledger");
    let root = d.join("projects");
    let p = claude_convo(&root, &d, "");
    age(&p, 30_000);
    let now = now_ms();
    let mtime = now - 30_000;
    let row = |streams: &[&str], released: i64| ConvoLinkRow {
        agent: "claude".into(),
        id: ID.to_ascii_uppercase(),
        streams: streams.iter().map(|s| (*s).to_owned()).collect(),
        released_at: Some(released as u64),
    };
    let roots = std::slice::from_ref(&root);
    // 놓인 뒤 유예보다 늦게 쓰였다 — 밖에서 열렸을 수 있다
    let err = rename_in(claude(), roots, ID, "x", now, &[row(&[], mtime - RELEASE_GRACE_MS - 1_000)]).unwrap_err();
    assert!(err.contains("2"), "{err}");
    // 산 스트림에 연결 — 거절(문구가 다르다)
    age(&p, 10 * 60_000);
    let linked = rename_in(claude(), roots, ID, "x", now, &[row(&["s1"], 0)]).unwrap_err();
    assert_ne!(linked, err);
    // 막 닫은 타일 — 놓인 시각 뒤로 쓰기가 없다(놓기 2초 전에 쓰였다)
    age(&p, 30_000);
    assert!(rename_in(claude(), roots, ID, "closed", now, &[row(&[], mtime + 2_000)]).is_ok());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn every_target_has_a_rename_adapter() {
    for t in TARGETS {
        assert!(t.rename.is_some(), "{}", t.id);
    }
}

/// **진짜 Codex** 로 — 버리는 스레드 id 를 `AYNX_RENAME_THREAD` 로 넘긴다(사용자 대화에 쓰지 말 것). 확인은 손으로:
/// `sqlite3 -readonly ~/.codex/state_5.sqlite "select name from threads where id='<id>'"` · `tail ~/.codex/session_index.jsonl`.
#[test]
#[ignore]
fn real_codex_sets_the_name() {
    let id = std::env::var("AYNX_RENAME_THREAD").expect("AYNX_RENAME_THREAD");
    let name = std::env::var("AYNX_RENAME_NAME").unwrap_or_else(|_| "aynx rename test".into());
    let exe = crate::orchestration::spawn::find_exe("codex", std::env::var_os("PATH").as_deref()).expect("codex.exe");
    let set = |id: &str, name: &str| {
        codex_rpc::request_with(&exe, None, "thread/name/set", json!({"threadId": id, "name": name}))
    };
    set(&id, &name).unwrap();
    // 없는 스레드는 Codex 의 오류 문구로 거절된다.
    let err = set("00000000-0000-4000-8000-000000000000", "x").unwrap_err();
    eprintln!("unknown thread → {err:?}");
}
