use super::*;
use std::time::{Duration, SystemTime};

const ID: &str = "11111111-2222-4333-8444-555555555555";

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aynx-delete-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn claude() -> &'static SessionTarget {
    target("claude").unwrap()
}

/// 가짜 Claude 설정 폴더 하나 — `<d>/config/projects/proj/<ID>.jsonl`(사용자 · 응답 줄) + 딸린 폴더 `<ID>/subagents/a.jsonl` ·
/// `<ID>/tool-results/x.txt`. 수정 시각은 10분 전. → (projects 루트, 대화 파일, 딸린 폴더).
fn claude_convo(d: &Path) -> (PathBuf, PathBuf, PathBuf) {
    let root = d.join("config").join("projects");
    let dir = root.join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    let cwd = d.to_string_lossy();
    let body = [
        json!({"type": "user", "cwd": cwd, "sessionId": ID, "timestamp": "2026-09-20T01:02:03.000Z",
               "message": {"role": "user", "content": "first prompt"}}),
        json!({"type": "assistant", "cwd": cwd, "timestamp": "2026-09-20T01:05:00.000Z",
               "message": {"id": "m1", "model": "m", "content": [],
                           "usage": {"input_tokens": 10, "output_tokens": 5}}, "requestId": "r1"}),
    ]
    .iter()
    .map(|v| v.to_string() + "\n")
    .collect::<String>();
    let p = dir.join(format!("{ID}.jsonl"));
    std::fs::write(&p, body).unwrap();
    let comp = dir.join(ID);
    std::fs::create_dir_all(comp.join("subagents")).unwrap();
    std::fs::create_dir_all(comp.join("tool-results")).unwrap();
    std::fs::write(comp.join("subagents").join("a.jsonl"), "{}\n").unwrap();
    std::fs::write(comp.join("tool-results").join("x.txt"), "big output").unwrap();
    age(&p, 10 * 60_000);
    (root, p, comp)
}

/// 수정 시각을 `ago` 밀리초 전으로.
fn age(path: &Path, ago_ms: u64) {
    let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    f.set_modified(SystemTime::now() - Duration::from_millis(ago_ms)).unwrap();
}

fn listed(root: &Path, cwd: &Path) -> usize {
    scan(&[(claude(), vec![root.to_path_buf()])], &[cwd.to_string_lossy().into_owned()], 10).groups[0]
        .sessions
        .len()
}

/// `link` → `target` 폴더 링크 — Windows 는 정션(관리자 권한 없이 된다), 그 밖은 심볼릭 링크.
fn dir_link(target: &Path, link: &Path) {
    #[cfg(windows)]
    {
        let st = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(st.success(), "mklink /J");
    }
    #[cfg(not(windows))]
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[test]
fn claude_delete_removes_the_file_and_its_folder_and_the_list_drops_it() {
    let d = temp_dir("claude");
    let (root, p, comp) = claude_convo(&d);
    let config = root.parent().unwrap().to_path_buf();
    // 설정 폴더의 짝: 빈 session-env/<id>/ 는 걷고, file-history/<id>/ 는 남긴다(포크가 그 백업을 가리킬 수 있다).
    std::fs::create_dir_all(config.join("session-env").join(ID)).unwrap();
    std::fs::create_dir_all(config.join("file-history").join(ID)).unwrap();
    std::fs::write(config.join("file-history").join(ID).join("abc@v1"), "backup").unwrap();
    // 다른 대화의 session-env 는 그대로.
    std::fs::create_dir_all(config.join("session-env").join("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).unwrap();
    assert_eq!(listed(&root, &d), 1);
    delete_in(claude(), std::slice::from_ref(&root), &ID.to_ascii_uppercase(), now_ms(), &[]).unwrap();
    assert!(!p.exists());
    assert!(!comp.exists(), "딸린 폴더(서브에이전트 · 도구 출력)도");
    assert!(root.join("proj").is_dir(), "프로젝트 폴더는 남는다");
    assert!(!config.join("session-env").join(ID).exists());
    assert!(config.join("session-env").join("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee").is_dir());
    assert!(config.join("file-history").join(ID).join("abc@v1").is_file());
    assert_eq!(listed(&root, &d), 0, "목록에서 빠졌다");
    // 캐시에도 없다 — 같은 id 로 다시 찾으면 못 찾는다.
    assert!(conversation_file(claude(), std::slice::from_ref(&root), ID).is_err());
    let cache = CACHE.lock().unwrap();
    assert!(!cache.keys().any(|k| k.starts_with(&d)), "목록 캐시에 지운 파일이 남지 않는다");
    drop(cache);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn claude_delete_without_a_companion_folder_removes_just_the_file() {
    let d = temp_dir("plain");
    let (root, p, comp) = claude_convo(&d);
    std::fs::remove_dir_all(&comp).unwrap();
    // 같은 이름의 **파일**은 이 대화의 것이 아니다 — 두고 간다.
    std::fs::write(&comp, "not ours").unwrap();
    delete_in(claude(), std::slice::from_ref(&root), ID, now_ms(), &[]).unwrap();
    assert!(!p.exists());
    assert_eq!(std::fs::read_to_string(&comp).unwrap(), "not ours");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn claude_delete_refuses_a_link_inside_the_companion_folder_and_removes_nothing() {
    let d = temp_dir("link");
    let (root, p, comp) = claude_convo(&d);
    // 링크가 가리키는 다른 곳(다른 저장소 흉내) — 지워지면 안 된다.
    let outside = d.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("precious.txt"), "keep").unwrap();
    dir_link(&outside, &comp.join("subagents").join("linked"));
    let err = delete_in(claude(), std::slice::from_ref(&root), ID, now_ms(), &[]).unwrap_err();
    assert!(err.contains("linked"), "{err}");
    assert!(p.is_file(), "대화 파일도 그대로");
    assert!(comp.join("tool-results").join("x.txt").is_file());
    assert_eq!(std::fs::read_to_string(outside.join("precious.txt")).unwrap(), "keep");
    // 딸린 폴더 자신이 링크여도 거절.
    let (root2, p2, comp2) = claude_convo(&d.join("b"));
    std::fs::remove_dir_all(&comp2).unwrap();
    dir_link(&outside, &comp2);
    assert!(delete_in(claude(), std::slice::from_ref(&root2), ID, now_ms(), &[]).is_err());
    assert!(p2.is_file());
    assert!(outside.join("precious.txt").is_file());
    // 링크를 걷고 나면 지울 수 있다(링크 자체만 — 가리킨 곳은 그대로).
    remove_link(&comp.join("subagents").join("linked")).unwrap();
    delete_in(claude(), std::slice::from_ref(&root), ID, now_ms(), &[]).unwrap();
    assert!(!p.exists() && !comp.exists());
    assert!(outside.join("precious.txt").is_file());
    let _ = remove_link(&comp2);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn remove_tree_removes_links_as_links_and_never_follows_them() {
    // 미리 본 뒤 걸음 사이에 링크가 생긴 경우의 방어 — remove_tree 는 링크를 만나면 링크만 걷는다.
    let d = temp_dir("tree");
    let outside = d.join("outside");
    std::fs::create_dir_all(outside.join("deep")).unwrap();
    std::fs::write(outside.join("deep").join("precious.txt"), "keep").unwrap();
    let tree = d.join("tree");
    std::fs::create_dir_all(tree.join("a").join("b")).unwrap();
    std::fs::write(tree.join("a").join("b").join("f.txt"), "x").unwrap();
    dir_link(&outside, &tree.join("a").join("j"));
    assert_eq!(find_link(&tree).unwrap(), Some(tree.join("a").join("j")));
    remove_tree(&tree).unwrap();
    assert!(!tree.exists());
    assert_eq!(std::fs::read_to_string(outside.join("deep").join("precious.txt")).unwrap(), "keep");
    assert_eq!(find_link(&outside).unwrap(), None);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn delete_refuses_a_just_written_conversation_bad_id_and_unknown_id() {
    let d = temp_dir("guard");
    let (root, p, comp) = claude_convo(&d);
    // 방금 쓰였다 — 다른 곳에서 열린 CLI 가 덧붙이는 중일 수 있다.
    age(&p, 0);
    assert!(delete_in(claude(), std::slice::from_ref(&root), ID, now_ms(), &[]).is_err());
    assert!(p.is_file() && comp.is_dir(), "아무것도 지우지 않았다");
    age(&p, 3 * 60_000);
    assert!(delete_in(claude(), std::slice::from_ref(&root), "not-a-uuid", now_ms(), &[]).is_err());
    assert!(delete_in(claude(), std::slice::from_ref(&root), "../proj/x", now_ms(), &[]).is_err());
    assert!(delete_in(claude(), std::slice::from_ref(&root), "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", now_ms(), &[]).is_err());
    assert!(p.is_file() && comp.is_dir());
    // 다른 루트(그 대화가 없는 곳)를 넘기면 못 찾는다 — 화면은 경로를 넘기지 못한다.
    let other = d.join("other-root");
    std::fs::create_dir_all(&other).unwrap();
    assert!(delete_in(claude(), std::slice::from_ref(&other), ID, now_ms(), &[]).is_err());
    assert!(p.is_file());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn every_target_has_a_delete_adapter() {
    for t in TARGETS {
        assert!(t.delete.is_some(), "{}", t.id);
    }
}

#[test]
fn codex_fork_refusal_is_translated_and_other_errors_pass_through() {
    let fork = codex_delete_error(
        "cannot delete thread 01a16c7c-d7e9-7cb3-ac47-61af4e94b398: forked history still references it",
    );
    assert!(!fork.contains("forked history"), "{fork}");
    let other = codex_delete_error("no rollout found for thread id x");
    assert!(other.contains("no rollout found for thread id x"), "{other}");
}

/// **진짜 Codex** 로 — 이 시험이 만든 버리는 스레드만(`AYNX_DELETE_PARENT` 와 그 포크 `AYNX_DELETE_FORK` — 사용자 대화에 쓰지 말 것).
/// 앱과 같은 길(`delete_in` · 진짜 루트 · 2분 창)을 지난다: 포크가 있는 동안 부모는 Codex 가 거절 → 포크 지우기 → 부모 지우기.
#[test]
#[ignore]
fn real_codex_deletes_threads() {
    let parent = std::env::var("AYNX_DELETE_PARENT").expect("AYNX_DELETE_PARENT");
    let fork = std::env::var("AYNX_DELETE_FORK").expect("AYNX_DELETE_FORK");
    let t = target("codex").unwrap();
    let roots = (t.roots)();
    let err = delete_in(t, &roots, &parent, now_ms(), &[]).unwrap_err();
    eprintln!("parent while forked → {err}");
    assert!(conversation_file(t, &roots, &parent).is_ok(), "거절이면 그대로");
    delete_in(t, &roots, &fork, now_ms(), &[]).unwrap();
    assert!(conversation_file(t, &roots, &fork).is_err());
    delete_in(t, &roots, &parent, now_ms(), &[]).unwrap();
    assert!(conversation_file(t, &roots, &parent).is_err());
    let err = delete_in(t, &roots, &parent, now_ms(), &[]).unwrap_err();
    eprintln!("again → {err}");
}
