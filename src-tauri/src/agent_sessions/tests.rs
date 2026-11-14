use super::*;
use serde_json::json;

/// Claude 가 대화를 넣는 폴더 이름(픽스처가 진짜 배치를 본뜨는 데 쓴다) — 시작 cwd 의 영숫자가 아닌
/// 글자를 전부 `-` 로, 끝 구분자는 떼고. JS 정규식이 UTF-16 단위로 바꾸므로 BMP 밖 글자는 `-` 둘.
fn claude_dir_name(cwd: &str) -> String {
    let t = cwd.trim().trim_end_matches(['/', '\\']);
    let mut out = String::with_capacity(t.len());
    for c in t.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else {
            for _ in 0..c.len_utf16() {
                out.push('-');
            }
        }
    }
    out
}

const U1: &str = "11111111-2222-4333-8444-555555555555";
const U2: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U3: &str = "01a07989-25f8-7e72-99aa-000000000001";
const U4: &str = "01a07989-25f8-7e72-99aa-000000000002";

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-asess-{}-{tag}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn lines(vs: &[Value]) -> String {
    vs.iter().map(|v| v.to_string() + "\n").collect()
}

fn chunk(stem: &str, head: Vec<Value>, tail: Vec<Value>) -> Chunk {
    Chunk {
        stem: stem.into(),
        head,
        tail,
    }
}

fn claude() -> &'static SessionTarget {
    target("claude").unwrap()
}

fn codex() -> &'static SessionTarget {
    target("codex").unwrap()
}

// ---- 합성 픽스처 (실제 줄의 **모양**만 본떴다 — 내용은 지어낸 것) ----

fn c_user(text: Value, cwd: &str, extra: Value) -> Value {
    let mut v = json!({
        "type": "user", "isSidechain": false, "cwd": cwd, "gitBranch": "main",
        "sessionId": U1, "timestamp": "2026-09-20T01:02:03.000Z",
        "message": { "role": "user", "content": text },
    });
    for (k, x) in extra.as_object().unwrap() {
        v[k] = x.clone();
    }
    v
}

fn c_assistant(model: &str, branch: &str) -> Value {
    json!({ "type": "assistant", "isSidechain": false, "cwd": "C:\\w\\proj", "gitBranch": branch,
            "timestamp": "2026-09-20T01:05:00.000Z", "message": { "model": model, "content": [] } })
}

fn claude_file(cwd: &str) -> Vec<Value> {
    vec![
        json!({"type": "mode", "mode": "x", "sessionId": U1}),
        json!({"type": "queue-operation", "operation": "enqueue", "timestamp": "2026-09-20T01:00:00.000Z"}),
        c_user(
            json!("<local-command-caveat>Caveat: generated</local-command-caveat>"),
            cwd,
            json!({"isMeta": true}),
        ),
        c_user(json!("<command-name>/model</command-name>"), cwd, json!({})),
        c_user(json!("[Request interrupted by user]"), cwd, json!({})),
        c_user(
            json!("<task-notification>done</task-notification>"),
            cwd,
            json!({"origin": {"kind": "task-notification"}}),
        ),
        c_user(
            json!([{"type": "tool_result", "content": "x"}]),
            cwd,
            json!({}),
        ),
        c_user(
            json!([{"type": "text", "text": "  Fix the flaky\n  build   script  "}]),
            cwd,
            json!({"origin": {"kind": "human"}}),
        ),
        c_assistant("claude-opus-5", "main"),
        json!({"type": "ai-title", "aiTitle": "First title", "sessionId": U1}),
    ]
}

#[test]
fn uuid_shape_accepts_only_8_4_4_4_12_hex() {
    assert!(uuid_shape(U1) && uuid_shape(U3) && uuid_shape(&U2.to_uppercase()));
    assert!(!uuid_shape(""));
    assert!(!uuid_shape("11111111-2222-4333-8444-55555555555"));
    assert!(!uuid_shape("11111111-2222-4333-8444-5555555555555"));
    assert!(!uuid_shape("11111111_2222-4333-8444-555555555555"));
    assert!(!uuid_shape("1111111g-2222-4333-8444-555555555555"));
    assert!(!uuid_shape("11111111-2222-4333-8444-55555555555\""));
    assert!(!uuid_shape("11111111-2222-4333-8444-5555555555&x"));
}

#[test]
fn one_line_collapses_whitespace_and_cuts_at_80() {
    assert_eq!(one_line("  a\n\tb   c \r\n").as_deref(), Some("a b c"));
    assert_eq!(one_line(" \n "), None);
    let long = "가".repeat(100);
    let got = one_line(&long).unwrap();
    assert_eq!(got.chars().count(), 81, "80자 + …");
    assert!(got.ends_with('…'));
    assert_eq!(
        one_line(&"a".repeat(80)).unwrap(),
        "a".repeat(80),
        "딱 80자는 자르지 않는다"
    );
}

#[test]
fn prompt_titles_drop_trailing_tool_markup() {
    assert_eq!(
        prompt_title(
            "jwt의 구조를 그림으로 그려줘 <linked_content path=\"a.md\">본문</linked_content>"
        )
        .as_deref(),
        Some("jwt의 구조를 그림으로 그려줘")
    );
    assert_eq!(
        prompt_title("코드에 주석 <_x>").as_deref(),
        Some("코드에 주석")
    );
    assert_eq!(
        prompt_title("a < b 이고 c > d").as_deref(),
        Some("a d"),
        "태그가 아닌 `<` 는 자르지 않고 `<…>` 만 지운다"
    );
    assert_eq!(
        prompt_title("<linked_content>x</linked_content>"),
        None,
        "남는 것이 없으면 합성 제목으로"
    );
    assert_eq!(prompt_title("  \n <br> "), None);
    assert_eq!(
        prompt_title("plain prompt").as_deref(),
        Some("plain prompt")
    );
}

#[test]
fn codex_prompt_with_trailing_markup_becomes_a_clean_title() {
    let mut head = vec![codex_meta_line(U3, "/w", json!("cli"), None)];
    head.push(json!({"type": "event_msg", "payload": {"type": "user_message", "message": "Explain JWT <linked_content id=\"1\">secret body</linked_content>"}}));
    head.push(json!({"type": "turn_context", "payload": {"model": "m"}}));
    assert_eq!(
        codex_parse(&chunk("r", head, vec![]))
            .unwrap()
            .prompt
            .as_deref(),
        Some("Explain JWT")
    );
    let mut head = vec![codex_meta_line(U3, "/w", json!("cli"), None)];
    head.push(
        json!({"type": "event_msg", "payload": {"type": "user_message", "message": "Hi <b>"}}),
    );
    head.push(json!({"type": "turn_context", "payload": {"model": "m"}}));
    assert_eq!(
        codex_parse(&chunk("r", head, vec![]))
            .unwrap()
            .prompt
            .as_deref(),
        Some("Hi")
    );
}

#[test]
fn a_conversation_written_to_two_files_is_listed_once_newest_first() {
    let f = fixture("dup");
    let wt = f
        .dir
        .join("proj")
        .join(".worktrees")
        .join("one")
        .to_string_lossy()
        .into_owned();
    // 같은 id(U3)의 롤아웃이 하루 뒤 폴더에 하나 더 — 더 새 파일이 이긴다.
    let day = f.codex_root.join("2026").join("09").join("22");
    std::fs::create_dir_all(&day).unwrap();
    let mut a = vec![codex_meta_line(U3, &wt, json!("cli"), None)];
    a.extend(codex_body());
    a.push(json!({"type": "turn_context", "payload": {"model": "newer-model"}}));
    std::fs::write(
        day.join(format!("rollout-2026-09-22T00-00-00-{U3}.jsonl")),
        lines(&a),
    )
    .unwrap();
    let list = scan(&sources(&f), std::slice::from_ref(&wt), 10);
    let ids: Vec<&str> = list.groups[0]
        .sessions
        .iter()
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(ids, [U3], "한 번만");
    let _ = std::fs::remove_dir_all(&f.dir);
}

#[test]
fn claude_dir_name_follows_the_slug_rule() {
    assert_eq!(claude_dir_name(r"C:\Users\me\.buzz"), "C--Users-me--buzz");
    assert_eq!(
        claude_dir_name(r"C:\Users\me\projects\proj\"),
        "C--Users-me-projects-proj"
    );
    assert_eq!(
        claude_dir_name("/home/me/my_site.github.io/"),
        "-home-me-my-site-github-io"
    );
    assert_eq!(claude_dir_name("/p/한글"), "-p---", "BMP 글자는 하나씩");
    assert_eq!(
        claude_dir_name("/p/😀"),
        "-p---",
        "BMP 밖은 UTF-16 두 단위라 둘"
    );
}

#[test]
fn claude_parse_picks_cwd_prompt_title_model_and_skips_injected_user_lines() {
    let p = claude_parse(&chunk(U1, claude_file(r"C:\w\proj"), vec![])).unwrap();
    assert_eq!(p.id, U1);
    assert_eq!(p.cwd, r"C:\w\proj");
    assert_eq!(
        p.prompt.as_deref(),
        Some("Fix the flaky build script"),
        "태그·끊김·작업 알림·도구 결과는 건너뛴다"
    );
    assert_eq!(p.ai_title.as_deref(), Some("First title"));
    assert_eq!(p.model.as_deref(), Some("claude-opus-5"));
    assert_eq!(p.branch.as_deref(), Some("main"));
    assert_eq!(p.started_at, ms_of(&json!("2026-09-20T01:02:03.000Z")));
    assert!(p.custom_title.is_none() && p.forked_from.is_none());
}

#[test]
fn claude_parse_later_titles_win_and_custom_beats_ai() {
    let tail = vec![
        json!({"type": "ai-title", "aiTitle": "Newer title"}),
        c_assistant("<synthetic>", "feature/x"),
        json!({"type": "custom-title", "customTitle": "  My name  "}),
    ];
    let p = claude_parse(&chunk(U1, claude_file("/w/p"), tail)).unwrap();
    assert_eq!(p.ai_title.as_deref(), Some("Newer title"));
    assert_eq!(p.custom_title.as_deref(), Some("My name"));
    assert_eq!(
        p.model.as_deref(),
        Some("claude-opus-5"),
        "<synthetic> 은 모델이 아니다"
    );
    assert_eq!(p.branch.as_deref(), Some("feature/x"), "마지막 브랜치");
    let r = record(claude(), &p, 5, None, true);
    assert_eq!(
        (r.title.as_str(), r.title_source),
        ("My name", TitleSource::Custom)
    );
}

#[test]
fn claude_parse_skips_empty_sidechain_and_non_uuid_files() {
    let meta_only = vec![
        json!({"type": "mode", "mode": "x"}),
        json!({"type": "permission-mode"}),
    ];
    assert!(
        claude_parse(&chunk(U1, meta_only, vec![])).is_none(),
        "대화가 없는 빈 세션"
    );
    let only_meta_user = vec![c_user(json!("<x>"), "/w", json!({"isMeta": true}))];
    assert!(claude_parse(&chunk(U1, only_meta_user, vec![])).is_none());
    let mut side = claude_file("/w");
    side[2]["isSidechain"] = json!(true);
    assert!(
        claude_parse(&chunk(U1, side, vec![])).is_none(),
        "사이드체인"
    );
    assert!(
        claude_parse(&chunk("agent-abc", claude_file("/w"), vec![])).is_none(),
        "id 모양이 아니다"
    );
    // 프롬프트가 태그뿐이어도 대화는 대화다 — 제목만 합성으로 떨어진다.
    let v = vec![
        c_user(json!("<command-name>/init</command-name>"), "/w", json!({})),
        c_assistant("m", "dev"),
    ];
    let p = claude_parse(&chunk(U1, v, vec![])).unwrap();
    assert!(p.prompt.is_none());
    let r = record(claude(), &p, 1, None, false);
    assert_eq!(
        (r.title.as_str(), r.title_source),
        ("Claude Code · dev", TitleSource::Fallback)
    );
    assert!(!r.cwd_exists);
}

#[test]
fn claude_prompt_is_taken_from_the_head_only() {
    let head = vec![
        c_user(json!("<command-name>/x</command-name>"), "/w", json!({})),
        c_assistant("m", "main"),
    ];
    let tail = vec![c_user(json!("a later prompt"), "/w", json!({}))];
    assert!(
        claude_parse(&chunk(U1, head, tail))
            .unwrap()
            .prompt
            .is_none(),
        "꼬리의 나중 프롬프트는 '첫' 프롬프트가 아니다"
    );
}

fn codex_meta_line(id: &str, cwd: &str, source: Value, forked: Option<&str>) -> Value {
    let mut pl = json!({
        "id": id, "timestamp": "2026-09-21T00:00:00.000Z", "cwd": cwd, "originator": "codex-tui",
        "source": source, "base_instructions": {"text": "long instructions"},
        "git": {"commit_hash": "abc", "branch": "wt/one"},
    });
    if let Some(f) = forked {
        pl["forked_from_id"] = json!(f);
    }
    json!({"type": "session_meta", "payload": pl})
}

fn codex_body() -> Vec<Value> {
    vec![
        json!({"type": "response_item", "payload": {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "<permissions instructions>"}]}}),
        json!({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "# AGENTS.md instructions for /w\n..."},
            {"type": "input_text", "text": "<environment_context>\n<cwd>/w</cwd>\n</environment_context>"}]}}),
        json!({"type": "event_msg", "payload": {"type": "user_message", "message": "<user_shell_command>ls</user_shell_command>"}}),
        json!({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Add a\nretry loop"}]}}),
        json!({"type": "turn_context", "payload": {"cwd": "/w", "model": "gpt-6-codex"}}),
    ]
}

#[test]
fn codex_parse_reads_meta_and_skips_injected_context() {
    let mut head = vec![codex_meta_line(U3, "/w", json!("cli"), None)];
    head.extend(codex_body());
    let p = codex_parse(&chunk("rollout-x", head, vec![])).unwrap();
    assert_eq!(p.id, U3);
    assert_eq!(p.cwd, "/w");
    assert_eq!(p.branch.as_deref(), Some("wt/one"));
    assert_eq!(
        p.prompt.as_deref(),
        Some("Add a retry loop"),
        "AGENTS.md·환경·셸 명령 블록은 건너뛴다"
    );
    assert_eq!(p.model.as_deref(), Some("gpt-6-codex"));
    assert!(p.forked_from.is_none() && p.ai_title.is_none());
}

#[test]
fn codex_parse_marks_forks_and_skips_exec_subagents_and_turnless_files() {
    let mut head = vec![codex_meta_line(U4, "/w", json!("vscode"), Some(U3))];
    head.extend(codex_body());
    assert_eq!(
        codex_parse(&chunk("r", head, vec![]))
            .unwrap()
            .forked_from
            .as_deref(),
        Some(U3)
    );
    for src in [json!("exec"), json!({"subagent": {"other": "guardian"}})] {
        let mut head = vec![codex_meta_line(U3, "/w", src, None)];
        head.extend(codex_body());
        assert!(codex_parse(&chunk("r", head, vec![])).is_none());
    }
    let head = vec![codex_meta_line(U3, "/w", json!("cli"), None)];
    assert!(
        codex_parse(&chunk("r", head, vec![])).is_none(),
        "턴이 없는 빈 롤아웃"
    );
    let head = vec![
        json!({"type": "turn_context"}),
        codex_meta_line(U3, "/w", json!("cli"), None),
    ];
    assert!(
        codex_parse(&chunk("r", head, vec![])).is_none(),
        "첫 줄이 session_meta 가 아니다"
    );
}

// ---- 파일 읽기 ----

#[test]
fn read_chunk_reads_only_head_and_tail_of_a_big_file() {
    let dir = temp_dir("chunk");
    let path = dir.join(format!("{U1}.jsonl"));
    let mut s = lines(&claude_file("/w"));
    let filler = json!({"type": "assistant", "message": {"model": "middle-model", "content": "x".repeat(1000)}}).to_string();
    while s.len() < 400 * 1024 {
        s.push_str(&filler);
        s.push('\n');
    }
    s.push_str(&lines(&[
        json!({"type": "ai-title", "aiTitle": "Tail title"}),
        c_assistant("tail-model", "main"),
    ]));
    std::fs::write(&path, &s).unwrap();
    let c = read_chunk(&path, 64 * 1024).unwrap();
    assert_eq!(c.stem, U1);
    let total: usize = c.head.len() + c.tail.len();
    assert!(total < 150, "가운데를 읽지 않았다: {total} 줄");
    let p = claude_parse(&c).unwrap();
    assert_eq!(p.ai_title.as_deref(), Some("Tail title"));
    assert_eq!(p.model.as_deref(), Some("tail-model"));
    assert_eq!(p.prompt.as_deref(), Some("Fix the flaky build script"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn read_chunk_drops_a_half_written_last_line() {
    let dir = temp_dir("half");
    let path = dir.join(format!("{U1}.jsonl"));
    let mut s = lines(&claude_file("/w"));
    s.push_str(r#"{"type":"ai-title","aiTi"#);
    std::fs::write(&path, &s).unwrap();
    let p = claude_parse(&read_chunk(&path, 64 * 1024).unwrap()).unwrap();
    assert_eq!(p.ai_title.as_deref(), Some("First title"));
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- 목록 (임시 루트 — 진짜 ~/.claude·~/.codex 는 밟지 않는다) ----

struct Fixture {
    dir: PathBuf,
    claude_root: PathBuf,
    codex_root: PathBuf,
}

fn fixture(tag: &str) -> Fixture {
    let dir = temp_dir(tag);
    let proj = dir.join("proj");
    let wt = proj.join(".worktrees").join("one");
    std::fs::create_dir_all(&wt).unwrap();
    let claude_root = dir.join("claude").join("projects");
    let codex_root = dir.join("codex").join("sessions");
    let proj_s = proj.to_string_lossy().into_owned();
    let wt_s = wt.to_string_lossy().into_owned();
    // Claude: 프로젝트에 둘(하나는 빈 대화) · 서브에이전트 파일 · 사라진 폴더 하나
    let pdir = claude_root.join(claude_dir_name(&proj_s));
    std::fs::create_dir_all(pdir.join(U1).join("subagents")).unwrap();
    std::fs::write(
        pdir.join(format!("{U1}.jsonl")),
        lines(&claude_file(&proj_s)),
    )
    .unwrap();
    std::fs::write(
        pdir.join(format!("{U2}.jsonl")),
        lines(&[json!({"type": "mode"})]),
    )
    .unwrap();
    std::fs::write(
        pdir.join(U1).join("subagents").join("agent-a1.jsonl"),
        lines(&claude_file(&proj_s)),
    )
    .unwrap();
    let gone = dir.join("gone").to_string_lossy().into_owned();
    let gdir = claude_root.join(claude_dir_name(&gone));
    std::fs::create_dir_all(&gdir).unwrap();
    let other_id = "22222222-2222-4222-8222-222222222222";
    std::fs::write(
        gdir.join(format!("{other_id}.jsonl")),
        lines(&claude_file(&gone)),
    )
    .unwrap();
    // Codex: 워크트리에 하나(이름표 있음) · 그 포크(프로젝트 하위 폴더에서 시작) · exec 하나
    let day = codex_root.join("2026").join("09").join("21");
    std::fs::create_dir_all(&day).unwrap();
    let mut a = vec![codex_meta_line(U3, &wt_s, json!("cli"), None)];
    a.extend(codex_body());
    std::fs::write(
        day.join(format!("rollout-2026-09-21T00-00-00-{U3}.jsonl")),
        lines(&a),
    )
    .unwrap();
    std::fs::create_dir_all(proj.join("src")).unwrap();
    let sub = proj.join("src").to_string_lossy().into_owned();
    let mut b = vec![codex_meta_line(U4, &sub, json!("cli"), Some(U3))];
    b.extend(codex_body());
    std::fs::write(
        day.join(format!("rollout-2026-09-21T01-00-00-{U3}_{U4}.jsonl")),
        lines(&b),
    )
    .unwrap();
    let mut e = vec![codex_meta_line(
        "33333333-3333-4333-8333-333333333333",
        &proj_s,
        json!("exec"),
        None,
    )];
    e.extend(codex_body());
    std::fs::write(
        day.join("rollout-2026-09-21T02-00-00-33333333-3333-4333-8333-333333333333.jsonl"),
        lines(&e),
    )
    .unwrap();
    std::fs::write(
        dir.join("codex").join("session_index.jsonl"),
        lines(&[
            json!({"id": U3, "thread_name": "old name", "updated_at": "x"}),
            json!({"id": U3, "thread_name": "Retry work", "updated_at": "y"}),
        ]),
    )
    .unwrap();
    Fixture {
        dir,
        claude_root,
        codex_root,
    }
}

fn sources(f: &Fixture) -> Vec<(&'static SessionTarget, Vec<PathBuf>)> {
    vec![
        (claude(), vec![f.claude_root.clone()]),
        (codex(), vec![f.codex_root.clone()]),
    ]
}

#[test]
fn scan_groups_by_the_deepest_registered_path_and_puts_the_rest_in_others() {
    let f = fixture("scan");
    let proj = f.dir.join("proj").to_string_lossy().into_owned();
    let wt = f
        .dir
        .join("proj")
        .join(".worktrees")
        .join("one")
        .to_string_lossy()
        .into_owned();
    let list = scan(&sources(&f), &[proj.clone(), wt.clone()], 10);
    let g_proj = &list.groups[0];
    let g_wt = &list.groups[1];
    assert_eq!(g_proj.cwd, proj);
    assert!(g_proj.exists && g_wt.exists);
    let gone = f.dir.join("nope").to_string_lossy().into_owned();
    assert!(
        !scan(&sources(&f), &[gone], 10).groups[0].exists,
        "사라진 등록 경로"
    );
    let proj_ids: Vec<&str> = g_proj.sessions.iter().map(|s| s.id.as_str()).collect();
    assert!(proj_ids.contains(&U1), "프로젝트의 Claude 대화");
    assert!(
        proj_ids.contains(&U4),
        "프로젝트 하위 폴더에서 시작한 포크도 프로젝트에"
    );
    assert!(!proj_ids.contains(&U2), "빈 대화는 없다");
    assert_eq!(proj_ids.len(), 2, "서브에이전트·exec 는 없다: {proj_ids:?}");
    assert_eq!(
        g_wt.sessions.len(),
        1,
        "워크트리가 프로젝트보다 깊어 이긴다"
    );
    let w = &g_wt.sessions[0];
    assert_eq!(
        (w.id.as_str(), w.title.as_str(), w.title_source),
        (U3, "Retry work", TitleSource::Custom)
    );
    assert!(w.cwd_exists);
    let fork = g_proj.sessions.iter().find(|s| s.id == U4).unwrap();
    assert_eq!(fork.forked_from.as_deref(), Some(U3));
    assert_eq!(fork.title_source, TitleSource::Prompt);
    assert_eq!(list.others.len(), 1, "어디에도 들지 않는 대화");
    assert!(!list.others[0].cwd_exists, "사라진 폴더");
    assert!(!list.others_more && !g_proj.more);
    // 최신순
    let ts: Vec<i64> = g_proj.sessions.iter().map(|s| s.updated_at).collect();
    assert!(ts.windows(2).all(|w| w[0] >= w[1]));
    let _ = std::fs::remove_dir_all(&f.dir);
}

#[test]
fn scan_compares_paths_without_case_or_separator_noise_on_windows_shapes() {
    let keys = vec![
        crate::worktree::comparable(r"C:\Work\Proj\"),
        crate::worktree::comparable("/srv/app"),
    ];
    assert_eq!(owner_of(&keys, "c:/work/proj"), Some(0));
    assert_eq!(owner_of(&keys, r"C:\WORK\Proj\sub"), Some(0));
    assert_eq!(
        owner_of(&keys, r"C:\Work\Project2"),
        None,
        "경로 경계에서만 조상이다"
    );
    assert_eq!(owner_of(&keys, "/srv/app/x"), Some(1));
    assert_eq!(
        owner_of(&keys, "/srv/App"),
        None,
        "POSIX 꼴은 대소문자를 가린다"
    );
}

#[test]
fn scan_limit_cuts_and_reports_more() {
    let f = fixture("limit");
    let proj = f.dir.join("proj").to_string_lossy().into_owned();
    let list = scan(&sources(&f), std::slice::from_ref(&proj), 1);
    assert_eq!(list.groups[0].sessions.len(), 1);
    assert!(list.groups[0].more);
    let _ = std::fs::remove_dir_all(&f.dir);
}

#[test]
fn a_changed_file_is_read_again() {
    let f = fixture("cache");
    let proj = f.dir.join("proj").to_string_lossy().into_owned();
    let one = |f: &Fixture| {
        scan(&sources(f), std::slice::from_ref(&proj), 10).groups[0]
            .sessions
            .iter()
            .find(|s| s.id == U1)
            .map(|s| s.title.clone())
            .unwrap()
    };
    assert_eq!(one(&f), "First title");
    let file = f
        .claude_root
        .join(claude_dir_name(&proj))
        .join(format!("{U1}.jsonl"));
    let mut s = std::fs::read_to_string(&file).unwrap();
    s.push_str(&lines(&[
        json!({"type": "ai-title", "aiTitle": "Renamed by AI"}),
    ]));
    std::fs::write(&file, s).unwrap();
    assert_eq!(one(&f), "Renamed by AI", "크기가 바뀌면 다시 읽는다");
    let _ = std::fs::remove_dir_all(&f.dir);
}

// ---- 명령 ----

#[test]
fn launch_spec_builds_resume_and_fork_commands_in_the_recorded_cwd() {
    let f = fixture("launch");
    let proj = f.dir.join("proj").to_string_lossy().into_owned();
    let wt = f
        .dir
        .join("proj")
        .join(".worktrees")
        .join("one")
        .to_string_lossy()
        .into_owned();
    let croot = vec![f.claude_root.clone()];
    let xroot = vec![f.codex_root.clone()];
    let r = launch_spec_in(claude(), &croot, U1, "resume", None).unwrap();
    assert_eq!(
        (r.cwd.as_str(), r.command.as_str()),
        (proj.as_str(), format!("claude --resume {U1}").as_str())
    );
    let r = launch_spec_in(claude(), &croot, &U1.to_uppercase(), "fork", None).unwrap();
    assert_eq!(
        r.command,
        format!("claude --resume {U1} --fork-session"),
        "id 는 소문자로"
    );
    let r = launch_spec_in(codex(), &xroot, U3, "resume", None).unwrap();
    assert_eq!(
        (r.cwd.as_str(), r.command.as_str()),
        (wt.as_str(), format!("codex resume {U3}").as_str())
    );
    let r = launch_spec_in(codex(), &xroot, U4, "fork", None).unwrap();
    assert_eq!(
        r.command,
        format!("codex fork {U4}"),
        "포크 파일 이름에 부모 id 가 있어도 자기 id 로 확정"
    );
    assert!(r.cwd.ends_with("src"));
    let _ = std::fs::remove_dir_all(&f.dir);
}

#[test]
fn launch_spec_refuses_bad_ids_modes_missing_sessions_and_missing_folders() {
    let f = fixture("launch-bad");
    let croot = vec![f.claude_root.clone()];
    for bad in [
        "",
        "x",
        "../../etc",
        &format!("{U1} && calc"),
        &format!("{U1}\""),
        "11111111-2222-4333-8444-55555555555;",
    ] {
        assert!(
            launch_spec_in(claude(), &croot, bad, "resume", None).is_err(),
            "{bad}"
        );
    }
    assert!(launch_spec_in(claude(), &croot, U1, "delete", None).is_err());
    assert!(launch_spec_in(
        claude(),
        &croot,
        "99999999-9999-4999-8999-999999999999",
        "resume",
        None
    )
    .is_err());
    let gone = "22222222-2222-4222-8222-222222222222";
    let err = launch_spec_in(claude(), &croot, gone, "resume", None).unwrap_err();
    assert!(err.contains("gone"), "{err}");
    assert!(target("gemini").is_err());
    let _ = std::fs::remove_dir_all(&f.dir);
}

#[test]
fn launch_spec_into_forks_in_the_given_folder_even_if_the_recorded_one_is_gone() {
    let f = fixture("launch-into");
    let here = f.dir.to_string_lossy().into_owned();
    let croot = vec![f.claude_root.clone()];
    let xroot = vec![f.codex_root.clone()];
    let r = launch_spec_in(claude(), &croot, U1, "fork", Some(&here)).unwrap();
    assert_eq!(
        (r.cwd.as_str(), r.command.as_str()),
        (
            here.as_str(),
            format!("claude --resume {U1} --fork-session").as_str()
        )
    );
    let r = launch_spec_in(codex(), &xroot, U4, "fork", Some(&here)).unwrap();
    assert_eq!(
        (r.cwd.as_str(), r.command.as_str()),
        (here.as_str(), format!("codex fork {U4}").as_str())
    );
    // 기록된 폴더가 지워진 대화도 — 병합 뒤 지운 워크트리의 대화를 지금 워크트리로
    let gone = "22222222-2222-4222-8222-222222222222";
    assert!(launch_spec_in(claude(), &croot, gone, "fork", None).is_err());
    let r = launch_spec_in(claude(), &croot, gone, "fork", Some(&here)).unwrap();
    assert_eq!(r.cwd, here);
    // 재개는 다른 폴더로 옮기지 않는다 · 없는 폴더 · 없는 대화
    assert!(launch_spec_in(claude(), &croot, U1, "resume", Some(&here)).is_err());
    let nowhere = f.dir.join("nowhere").to_string_lossy().into_owned();
    assert!(launch_spec_in(claude(), &croot, U1, "fork", Some(&nowhere)).is_err());
    let unknown = "99999999-9999-4999-8999-999999999999";
    assert!(launch_spec_in(claude(), &croot, unknown, "fork", Some(&here)).is_err());
    let _ = std::fs::remove_dir_all(&f.dir);
}

/// 사이드 채팅 "타일 대화 이어 가기" 의 cwd 판정 — 색인에서만 · 폴더가 있을 때만 · 까닭을 가른다.
#[test]
fn recorded_cwd_comes_only_from_the_index_and_needs_the_folder() {
    let f = fixture("recorded-cwd");
    let proj = f.dir.join("proj").to_string_lossy().into_owned();
    let croot = vec![f.claude_root.clone()];
    let xroot = vec![f.codex_root.clone()];
    assert_eq!(recorded_cwd_in(claude(), &croot, U1), Ok(proj.clone()));
    assert_eq!(recorded_cwd_in(claude(), &croot, &U1.to_uppercase()), Ok(proj));
    assert!(recorded_cwd_in(codex(), &xroot, U4).unwrap().ends_with("src"));
    assert_eq!(recorded_cwd_in(claude(), &croot, "../x"), Err(CwdMiss::BadId));
    let unknown = "99999999-9999-4999-8999-999999999999";
    assert_eq!(recorded_cwd_in(claude(), &croot, unknown), Err(CwdMiss::NotFound));
    // 다른 에이전트의 대화는 찾지 않는다(Codex 의 id 를 Claude 루트에서)
    assert_eq!(recorded_cwd_in(claude(), &croot, U3), Err(CwdMiss::NotFound));
    let gone = "22222222-2222-4222-8222-222222222222";
    assert!(matches!(recorded_cwd_in(claude(), &croot, gone), Err(CwdMiss::NoFolder(p)) if p.contains("gone")));
    let _ = std::fs::remove_dir_all(&f.dir);
}

#[test]
fn join_argv_accepts_only_plain_tokens() {
    assert_eq!(
        join_argv(&claude_resume(U1)).unwrap(),
        format!("claude --resume {U1}")
    );
    assert!(join_argv(&["claude".into(), "a b".into()]).is_err());
    assert!(join_argv(&["claude".into(), "a;b".into()]).is_err());
    assert!(join_argv(&["claude".into(), String::new()]).is_err());
    assert!(join_argv(&[]).is_err());
}

#[test]
fn every_target_has_distinct_ids_and_plain_commands() {
    let mut ids = std::collections::HashSet::new();
    for t in TARGETS {
        assert!(ids.insert(t.id));
        assert!(
            crate::agent_hooks::TARGETS.iter().any(|h| h.id == t.id),
            "훅 표와 같은 id: {}",
            t.id
        );
        assert!(join_argv(&(t.resume_argv)(U1)).is_ok());
        if let Some(f) = t.fork_argv {
            assert!(join_argv(&f(U1)).is_ok());
        }
    }
}

/// 재개·포크 명령 자체는 설정을 모른다 — `--no-daemon` 은 자동 실행의 문(`crate::codex_launch::codex_line`)이
/// 끼운다. 그 규칙이 이 명령들에 대고 옳은 자리(하위명령 뒤)에 끼우고, 끼운 줄도 명령 줄로 안전한지 본다.
#[test]
fn codex_resume_and_fork_get_no_daemon_after_the_subcommand() {
    use crate::codex_launch::{codex_argv, codex_line};
    let x = target("codex").unwrap();
    let v7 = "01a0dc8b-6ce8-77f1-9b8d-82e8a23c8840"; // Codex 대화 id(UUIDv7)도 UUID 모양이다
    assert!(uuid_shape(v7));
    let resume = codex_argv(&(x.resume_argv)(v7), true);
    assert_eq!(
        join_argv(&resume).unwrap(),
        format!("codex resume --no-daemon {v7}")
    );
    let fork = codex_argv(&(x.fork_argv.unwrap())(v7), true);
    assert_eq!(
        join_argv(&fork).unwrap(),
        format!("codex fork --no-daemon {v7}")
    );
    // 한 줄에 끼운 결과가 인자 목록에 끼운 결과와 같다(두 길이 한 규칙)
    let line = join_argv(&(x.resume_argv)(v7)).unwrap();
    assert_eq!(
        codex_line(&line, true).unwrap(),
        join_argv(&resume).unwrap()
    );
    assert_eq!(codex_line(&line, false), None, "설정 꺼짐 — 그대로");
    // Claude 명령은 건드리지 않는다
    let c = target("claude").unwrap();
    assert_eq!(codex_argv(&(c.resume_argv)(U1), true), (c.resume_argv)(U1));
}

/// 2026-10-24 실측(Claude 2.1.310): 큰 요청 기록 줄이 앞을 채우고 첫 사람 말(그림 붙임)이 꼬리보다 커서 앞 · 꼬리 어디에도 말 줄이
/// 없으면 파싱은 대화를 못 알아본다 — 그래도 id 로는 그 파일을 찾는다(이름이 곧 id). 없는 id 는 여전히 못 찾는다.
#[test]
fn claude_file_is_found_by_name_while_parsing_cannot_see_a_turn() {
    let root = temp_dir("named");
    let proj = root.join(claude_dir_name("C:\\w\\proj"));
    std::fs::create_dir_all(&proj).unwrap();
    let blob = "x".repeat(80 * 1024);
    let file = lines(&[
        json!({"type": "api-request-blob", "sessionId": U1, "message": {"role": "system", "content": blob}}),
        c_user(
            json!([{"type": "text", "text": "[Image #1] what is this"}, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": blob}}]),
            "C:\\w\\proj",
            json!({"origin": {"kind": "human"}}),
        ),
    ]);
    let p = proj.join(format!("{U1}.jsonl"));
    std::fs::write(&p, file).unwrap();
    let c = read_chunk(&p, 64 * 1024).unwrap();
    assert!(claude_parse(&c).is_none(), "앞 · 꼬리에 말 줄이 없다");
    let roots = [root.clone()];
    assert_eq!(conversation_file(claude(), &roots, &U1.to_ascii_uppercase()).unwrap(), p);
    assert!(conversation_file(claude(), &roots, U2).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

/// 2026-10-24 실측(Claude 2.1.310): 그림을 붙인 첫 말(한 줄 수십 KB)이 앞 64 KB 경계에 걸리고 뒤가 큰 요청 기록 줄이어도 — 앞 읽기가
/// 그 줄 끝까지 이어 읽어 대화 · cwd · 첫 프롬프트를 얻는다(목록에서 빠지지 않는다).
#[test]
fn claude_first_prompt_straddling_the_head_is_read_to_its_end() {
    let root = temp_dir("straddle");
    let proj = root.join(claude_dir_name("C:\\w\\proj"));
    std::fs::create_dir_all(&proj).unwrap();
    let blob = "x".repeat(90 * 1024);
    let file = lines(&[
        json!({"type": "mode", "mode": "x", "sessionId": U1}),
        c_user(
            json!([{"type": "text", "text": "[Image #1] what is this"}, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": blob}}]),
            "C:\\w\\proj",
            json!({"origin": {"kind": "human"}}),
        ),
        json!({"type": "api-request-blob", "sessionId": U1, "message": {"role": "system", "content": blob}}),
        json!({"type": "api-request-blob", "sessionId": U1, "message": {"role": "user", "content": blob}}),
    ]);
    let p = proj.join(format!("{U1}.jsonl"));
    std::fs::write(&p, file).unwrap();
    let c = read_chunk(&p, 64 * 1024).unwrap();
    let parsed = claude_parse(&c).expect("첫 말이 앞에 온전히 든다");
    assert_eq!(parsed.cwd, "C:\\w\\proj");
    assert!(parsed.prompt.as_deref().is_some_and(|t| t.contains("what is this")));
    let _ = std::fs::remove_dir_all(&root);
}

/// 2026-11-14 실측(Codex 0.168 — 모양만, 값은 지어냄): 한 턴 대화는 앞 128 KB 를 넘는 큰 줄(`world_state`) **바로 뒤**에 하나뿐인
/// `turn_context` 가 선다. 앞을 그 줄 끝까지 이어 읽으면 꼬리가 바로 거기서 시작하는데, 꼬리의 첫 줄을 잘린 줄로 버려 턴을 잃고
/// "대화가 아님" 이 됐다(AI 타일 대화 면 · 목록에서 빠짐). 꼬리를 한 바이트 앞부터 읽어 그 줄을 온전히 쥔다.
#[test]
fn codex_lone_turn_right_after_the_extended_head_is_kept() {
    let root = temp_dir("codex-seam");
    let day = root.join("2026").join("11").join("14");
    std::fs::create_dir_all(&day).unwrap();
    let pad = |n: usize| "x".repeat(n);
    let mut vs = vec![codex_meta_line(U3, "/w", json!("cli"), None)];
    vs[0]["payload"]["thread_source"] = json!("user");
    vs.push(json!({"type": "response_item", "payload": {"type": "additional_tools", "tools": pad(44 * 1024)}}));
    vs.push(json!({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Add a retry loop"}]}}));
    // 앞 128 KB 경계에 걸친 큰 줄 — 앞 읽기가 이 줄 끝까지 이어 읽는다
    vs.push(json!({"type": "world_state", "payload": {"blob": pad(100 * 1024)}}));
    vs.push(json!({"type": "turn_context", "payload": {"cwd": "/w", "model": "gpt-test", "effort": "high"}}));
    vs.push(json!({"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done."}]}}));
    let body = lines(&vs);
    let seam = body.find("{\"type\":\"turn_context\"").unwrap() as u64;
    assert!(seam > 128 * 1024 && body.len() as u64 - seam < 64 * 1024, "꼬리가 앞에 바로 붙는 모양");
    let p = day.join(format!("rollout-2026-11-14T00-00-00-{U3}.jsonl"));
    std::fs::write(&p, &body).unwrap();
    let parsed = codex_parse(&read_chunk(&p, 128 * 1024).unwrap()).expect("하나뿐인 turn_context 를 잃지 않는다");
    assert_eq!(parsed.model.as_deref(), Some("gpt-test"));
    assert_eq!(conversation_file(codex(), std::slice::from_ref(&root), U3).unwrap(), p);
    let _ = std::fs::remove_dir_all(&root);
}
