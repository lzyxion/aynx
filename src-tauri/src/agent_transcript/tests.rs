use super::*;
use serde_json::json;
use std::io::Cursor;

// ---- 합성 픽스처 (실제 줄의 **모양**만 본떴다 — 내용은 지어낸 것) ----

pub(crate) const U1: &str = "11111111-2222-4333-8444-555555555555";
pub(crate) const X1: &str = "01a07989-25f8-7e72-99aa-000000000001";

pub(crate) fn lines(vs: &[Value]) -> String {
    vs.iter().map(|v| v.to_string() + "\n").collect()
}

pub(crate) fn c_user(content: Value, extra: Value) -> Value {
    let mut v = json!({"type": "user", "isSidechain": false, "cwd": "/w/p", "sessionId": U1,
        "timestamp": "2026-09-20T01:00:00.000Z", "message": {"role": "user", "content": content}});
    for (k, x) in extra.as_object().unwrap() {
        v[k] = x.clone();
    }
    v
}

pub(crate) fn c_asst(parts: Value) -> Value {
    json!({"type": "assistant", "isSidechain": false, "cwd": "/w/p", "timestamp": "2026-09-20T01:00:01.000Z",
           "message": {"model": "m", "content": parts}})
}

pub(crate) fn c_tool(id: &str, name: &str, input: Value) -> Value {
    c_asst(json!([{"type": "tool_use", "id": id, "name": name, "input": input}]))
}

pub(crate) fn c_result(id: &str, content: Value) -> Value {
    c_user(
        json!([{"type": "tool_result", "tool_use_id": id, "content": content}]),
        json!({}),
    )
}

fn page(s: &str, before: Option<u64>, limit: usize, parse: LineEvents) -> TranscriptPage {
    read_page_from(
        Cursor::new(s.as_bytes().to_vec()),
        s.len() as u64,
        before,
        limit,
        parse,
    )
    .unwrap()
}

fn roles(p: &TranscriptPage) -> Vec<&'static str> {
    p.items.iter().map(|i| i.role).collect()
}

fn texts(p: &TranscriptPage) -> Vec<String> {
    p.items
        .iter()
        .map(|i| i.text.clone().unwrap_or_default())
        .collect()
}

#[test]
fn claude_lines_normalise_and_skip_injected_meta_and_sidechain_lines() {
    let file = lines(&[
        json!({"type": "mode", "mode": "x"}),
        c_user(
            json!("<local-command-caveat>Caveat</local-command-caveat>"),
            json!({"isMeta": true}),
        ),
        c_user(json!("<command-name>/model</command-name>"), json!({})),
        c_user(
            json!("<task-notification>done</task-notification>"),
            json!({"origin": {"kind": "task-notification"}}),
        ),
        c_user(
            json!("Make the build <b>faster</b>"),
            json!({"origin": {"kind": "human"}}),
        ),
        c_asst(json!([{"type": "thinking", "thinking": "secret plan", "signature": "s"}])),
        c_asst(json!([{"type": "thinking", "thinking": "more", "signature": "s"}])),
        c_asst(json!([{"type": "text", "text": "Sure — here is how."}])),
        c_user(json!("side question"), json!({"isSidechain": true})),
        c_user(json!("summary text"), json!({"isCompactSummary": true})),
        json!({"type": "system", "subtype": "x", "content": "hook said"}),
        json!({"type": "ai-title", "aiTitle": "T"}),
        c_user(json!("[Request interrupted by user]"), json!({})),
        c_user(
            json!([{"type": "text", "text": "look at this"}, {"type": "image", "source": {}}]),
            json!({"origin": {"kind": "human"}}),
        ),
    ]);
    let p = page(&file, None, 40, claude_events);
    assert_eq!(
        roles(&p),
        ["user", "assistant", "interrupted", "user"],
        "생각은 싣지 않는다 · 끊김 표식은 사람 말이 아니라 중단 한 줄"
    );
    assert_eq!(
        texts(&p)[0],
        "Make the build <b>faster</b>",
        "사람이 친 글은 태그 모양이어도 그대로(화면이 글자로 그린다)"
    );
    assert_eq!(p.items[0].at, ms_of(&json!("2026-09-20T01:00:00.000Z")));
    assert_eq!(
        (texts(&p)[3].as_str(), p.items[3].images),
        ("look at this", 1)
    );
    assert!(p.cursor.is_none(), "파일 맨 앞까지 읽었다");
}

/// 사이드 채팅 v2 — stream-json 으로 보낸 대화(spike 3차 1a 의 실제 줄 모양: `origin` 없음 · `entrypoint:"sdk-cli"` ·
/// `promptSource:"sdk"`). 사람이 보낸 글은 `<` · `Caveat:` 로 시작해도 보이고, `set_model` 이 남긴 `/model` 세 줄과 끊김 표식은 숨는다.
#[test]
fn claude_sdk_cli_user_lines_are_human_but_local_commands_hide() {
    let sdk = |content: Value, extra: Value| {
        let mut v = c_user(content, json!({"userType": "external", "entrypoint": "sdk-cli", "version": "2.1.309"}));
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        v
    };
    let prompt = json!({"promptSource": "sdk", "turnOrigin": "sdk", "permissionMode": "default"});
    let file = lines(&[
        sdk(json!("What is the code word from your instructions? Reply with it only."), prompt.clone()),
        c_asst(json!([{"type": "text", "text": "ZEBRA-7731"}])),
        sdk(
            json!("<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user.</local-command-caveat>"),
            json!({"isMeta": true}),
        ),
        sdk(
            json!("<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>sonnet</command-args>"),
            json!({}),
        ),
        sdk(json!("<local-command-stdout>Set model to `sonnet (claude-sonnet-5-5)`</local-command-stdout>"), json!({})),
        sdk(json!("<div>pasted html</div> 이거 고쳐 줘"), prompt.clone()),
        sdk(json!("Caveat: 이 줄은 사람이 쓴 것"), prompt.clone()),
        sdk(json!([{"type": "text", "text": "[Request interrupted by user]"}]), json!({})),
        // 같은 모양이라도 TUI 의 옛 줄(entrypoint 없음 · origin 없음)은 예전처럼 모양으로 거른다
        c_user(json!("<div>old line</div>"), json!({})),
    ]);
    let p = page(&file, None, 40, claude_events);
    assert_eq!(roles(&p), ["user", "assistant", "user", "user", "interrupted"]);
    assert_eq!(
        texts(&p),
        [
            "What is the code word from your instructions? Reply with it only.",
            "ZEBRA-7731",
            "<div>pasted html</div> 이거 고쳐 줘",
            "Caveat: 이 줄은 사람이 쓴 것",
            "",
        ]
    );
}

/// 시험 `wake_note_parsed_from_transcript`(2단계 단계 4 — 설계 3-6) — 프로듀서 채팅 기록의 사람 말이 **앱이 깨움의 꼴**이면 `wake` 칸(앨범 · 세대 ·
/// 범위 시작 · 글 전체의 SHA)이 선다. 글은 그대로 둔다(표지는 화면이 앨범의 `wakes` 기록과 맞출 때만 — 표시용). 닮은 글 · 에이전트 글은 칸이 없다.
#[test]
fn wake_notes_are_tagged_in_the_transcript() {
    let run = format!("run-{}", "a".repeat(32));
    let wake = format!("{} Album {run} (gen 2) changed after seq 41: task task-{} integrated. Read get_run.", crate::orchestration::wake::PREFIX, "b".repeat(32));
    let sdk = |content: Value| c_user(content, json!({"entrypoint": "sdk-cli", "promptSource": "sdk"}));
    let file = lines(&[
        sdk(json!(wake)),
        c_asst(json!([{"type": "text", "text": wake}])),
        sdk(json!(format!("{} Album run-x (gen 2) changed after seq 41: hi", crate::orchestration::wake::PREFIX))),
    ]);
    let p = page(&file, None, 40, claude_events);
    assert_eq!(texts(&p)[0], wake, "글은 그대로");
    let tag = serde_json::to_value(p.items[0].wake.as_ref().unwrap()).unwrap();
    assert_eq!(tag, json!({ "runId": run, "gen": 2, "fromSeq": 41, "sha": crate::orchestration::verify::sha256_hex(wake.as_bytes()) }));
    assert!(p.items[1].wake.is_none() && p.items[2].wake.is_none());
    assert!(serde_json::to_value(&p.items[2]).unwrap().get("wake").is_none());
}

/// 사이드 채팅 — 사람 말 맨 앞의 **앱 연결 머리글**은 걷혀 `link` 칸이 되고(실제 기록 줄 모양 · Claude sdk-cli · Codex 사용자 말),
/// 닮은 글 · 가운데의 머리글 · 에이전트 글은 그대로다. 걷은 뒤 `<` 로 시작하는 사람 글도 사람 말로 남는다.
#[test]
fn link_headers_are_stripped_into_a_link_field() {
    let sdk = |content: Value| c_user(content, json!({"entrypoint": "sdk-cli", "promptSource": "sdk"}));
    let file = lines(&[
        sdk(json!("[연결된 타일: p2 PowerShell 7 · 세션 8dd8bbdab0b3d4136ee55ab8e750d144] p2 타일의 dir 목록 확인 가능??")),
        c_asst(json!([{"type": "text", "text": "[연결된 타일: p2 · 세션 s1] 에이전트 글은 그대로"}])),
        sdk(json!("[연결된 타일 없음 — 사람이 연결을 끊었습니다] Write 40 facts.")),
        sdk(json!("[연결된 타일: 세션 s1] <div>html</div>")),
        sdk(json!("앞에 글 [연결된 타일: p2 · 세션 s1] 뒤")),
        sdk(json!("[연결된 타일: p2 · 세션 s 1] 닮은 글")),
    ]);
    let p = page(&file, None, 40, claude_events);
    assert_eq!(roles(&p), ["user", "assistant", "user", "user", "user", "user"]);
    assert_eq!(
        texts(&p),
        [
            "p2 타일의 dir 목록 확인 가능??",
            "[연결된 타일: p2 · 세션 s1] 에이전트 글은 그대로",
            "Write 40 facts.",
            "<div>html</div>",
            "앞에 글 [연결된 타일: p2 · 세션 s1] 뒤",
            "[연결된 타일: p2 · 세션 s 1] 닮은 글",
        ]
    );
    let link = |i: usize| p.items[i].link.as_ref().map(|l| serde_json::to_value(l).unwrap());
    assert_eq!(link(0), Some(json!({"label": "p2 PowerShell 7"})));
    assert_eq!(link(1), None);
    assert_eq!(link(2), Some(json!({"unlinked": true})));
    assert_eq!(link(3), Some(json!({"label": ""})));
    assert_eq!((link(4), link(5)), (None, None));
    // 화면으로 가는 꼴 — 없으면 칸이 없고, 스트림 id 는 어디에도 없다
    let wire = serde_json::to_string(&p.items).unwrap();
    assert!(!wire.contains("8dd8bbdab0b3d4136ee55ab8e750d144"));
    assert!(serde_json::to_value(&p.items[4]).unwrap().get("link").is_none());

    let codex = lines(&[
        x_meta(),
        x_item(json!({"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "[연결된 타일: p1 pwsh · 세션 abc] 마지막 명령?"}]})),
    ]);
    let p = page(&codex, None, 40, codex_events);
    assert_eq!(texts(&p), ["마지막 명령?"]);
    assert_eq!(serde_json::to_value(p.items[0].link.as_ref().unwrap()).unwrap(), json!({"label": "p1 pwsh"}));
}

/// 프로듀서(단계 5) — 갈라 온 Codex 프로듀서의 첫 사람 말 앞 **앱 지침 머리글**(`server::producer::launch::fork_brief`)은 걷혀 `brief` 칸이
/// 되고 사람이 친 글만 남는다. 가운데의 머리글 · 닫는 틀이 없는 글 · 에이전트 글은 그대로 · 걷지 않은 줄에는 칸이 없다.
#[test]
fn producer_briefs_are_stripped_from_the_first_message() {
    let brief = crate::server::producer::album_brief_for_test("C:/repo");
    let user = |text: String| x_item(json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}));
    let codex = lines(&[
        x_meta(),
        user(format!("{brief}이 저장소 정리 계획을 세워 줘")),
        user(format!("앞 {brief}뒤")),
        user(crate::side_chat::event::BRIEF_OPEN.to_string() + "닫는 틀 없음"),
    ]);
    let p = page(&codex, None, 40, codex_events);
    assert_eq!(texts(&p)[0], "이 저장소 정리 계획을 세워 줘");
    assert!(p.items[0].brief && !p.items[1].brief && !p.items[2].brief);
    assert!(texts(&p)[1].starts_with("앞 [Aynx producer brief"));
    assert!(serde_json::to_value(&p.items[1]).unwrap().get("brief").is_none());
    assert_eq!(serde_json::to_value(&p.items[0]).unwrap()["brief"], true);
    assert!(!serde_json::to_string(&p.items[0]).unwrap().contains("producer (coordinator)"), "지침 글은 화면으로 가지 않는다");
}

/// 끊김 · 거절 — 기록에 남는 것으로 다시 세운다. Claude: 끊김 표식(문자열 · 부분 배열 · 도구 결과 뒤) → `interrupted` 한 줄, 거절된 도구 결과
/// (`permissionDecision{decision: reject}` — 2.1.309 실기 2차 줄 모양) → `denied`, 허용된 도구의 오류 · 끊어 멈춘 도구(`user_abort`)는 거절이 아니다.
#[test]
fn claude_interrupts_and_denials_are_rebuilt_from_the_transcript() {
    let sdk = |content: Value, extra: Value| {
        let mut v = c_user(content, json!({"entrypoint": "sdk-cli"}));
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        v
    };
    let denied_result = |id: &str, text: &str, decision: Value| {
        sdk(
            json!([{"type": "tool_result", "content": text, "is_error": true, "tool_use_id": id}]),
            json!({"toolUseResult": format!("Error: {text}"), "toolDenialKind": "permission-rule", "permissionDecision": decision}),
        )
    };
    let file = lines(&[
        sdk(json!("Use WebFetch on https://example.com"), json!({"promptSource": "sdk"})),
        c_tool("t1", "WebFetch", json!({"url": "https://example.com"})),
        denied_result("t1", "사용자가 거절했습니다", json!({"decision": "reject", "source": "user_reject", "reasonCode": "unknown"})),
        c_tool("t2", "mcp__aynx__get_last_command", json!({})),
        sdk(
            json!([{"type": "tool_result", "content": "not-linked: …", "is_error": true, "tool_use_id": "t2"}]),
            json!({"permissionDecision": {"decision": "accept", "source": "config"}}),
        ),
        c_tool("t3", "Bash", json!({"command": "ls"})),
        denied_result("t3", "규칙이 막음", json!({"decision": "reject", "source": "config"})),
        c_tool("t4", "Bash", json!({"command": "sleep 9"})),
        sdk(
            json!([{"type": "tool_result", "content": "aborted", "is_error": true, "tool_use_id": "t4"},
                   {"type": "text", "text": "[Request interrupted by user for tool use]"}]),
            json!({"permissionDecision": {"decision": "reject", "source": "user_abort"}}),
        ),
        c_asst(json!([{"type": "text", "text": "partial"}])),
        sdk(json!([{"type": "text", "text": "[Request interrupted by user]"}]), json!({})),
        sdk(json!("[Request interrupted by user]"), json!({})),
    ]);
    let p = page(&file, None, 40, claude_events);
    assert_eq!(
        roles(&p),
        ["user", "tool", "tool", "tool", "tool", "interrupted", "assistant", "interrupted", "interrupted"]
    );
    let flags: Vec<(bool, bool)> =
        p.items[1..5].iter().map(|i| i.tool.as_ref().map(|t| (t.error, t.denied)).unwrap()).collect();
    assert_eq!(flags, [(true, true), (true, false), (true, true), (true, false)]);
    let wire = serde_json::to_value(&p.items[1]).unwrap();
    assert_eq!(wire["tool"]["denied"], true);
    assert_eq!(serde_json::to_value(&p.items[5]).unwrap()["role"], "interrupted");
    // 메신저의 턴 끝 발췌는 표지를 건너뛴다(끊김 표식 뒤에도 앞의 에이전트 글)
    assert_eq!(tail(&file, claude_events).text.as_deref(), Some("partial"));
}

/// Codex 0.163 롤아웃 — 끊긴 턴(`event_msg turn_aborted{reason: interrupted}`) → `interrupted`, 권한에서 거절된 항목(`event_msg item_completed`
/// 의 `status: declined` — 그 호출과 결과 줄 사이) → 그 호출이 `denied`. 다른 끝 이유 · 실패 상태 · 사본 `event_msg` 는 아무것도 아니다.
#[test]
fn codex_interrupts_and_declines_are_rebuilt_from_the_rollout() {
    let ev = |payload: Value| json!({"type": "event_msg", "timestamp": "2026-10-23T06:15:16.760Z", "payload": payload});
    let file = lines(&[
        x_meta(),
        x_item(json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Create a.txt"}]})),
        x_item(json!({"type": "custom_tool_call", "status": "completed", "call_id": "call_1", "name": "exec",
            "input": "const r = await tools.apply_patch(\"*** Begin Patch\\n*** Add File: a.txt\\n+hi\\n*** End Patch\");"})),
        ev(json!({"type": "item_completed", "item": {"type": "FileChange", "id": "exec-9", "changes": {}, "status": "declined",
            "stderr": "patch rejected by user"}})),
        x_item(json!({"type": "custom_tool_call_output", "call_id": "call_1",
            "output": [{"type": "input_text", "text": "Script failed\n"}, {"type": "input_text", "text": "Script error:\npatch rejected by user"}]})),
        x_item(json!({"type": "custom_tool_call", "status": "completed", "call_id": "call_2", "name": "exec", "input": "ls"})),
        ev(json!({"type": "item_completed", "item": {"type": "CommandExecution", "id": "exec-10", "status": "failed"}})),
        x_item(json!({"type": "custom_tool_call_output", "call_id": "call_2", "output": [{"type": "input_text", "text": "Script failed"}]})),
        ev(json!({"type": "item_completed", "item": {"type": "AgentMessage", "id": "m", "content": []}})),
        x_item(json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "DENIED"}]})),
        ev(json!({"type": "turn_aborted", "turn_id": "t", "reason": "interrupted"})),
        ev(json!({"type": "turn_aborted", "turn_id": "t2", "reason": "replaced"})),
        ev(json!({"type": "task_complete", "turn_id": "t3"})),
    ]);
    let p = page(&file, None, 40, codex_events);
    assert_eq!(roles(&p), ["user", "tool", "tool", "assistant", "interrupted"]);
    let denied: Vec<bool> = p.items[1..3].iter().map(|i| i.tool.as_ref().unwrap().denied).collect();
    assert_eq!(denied, [true, false]);
    // 거절 표지만 있고 짝이 없으면(호출이 쪽 밖 · 결과가 이미 붙음) 아무것도 바꾸지 않는다
    let lone = lines(&[x_meta(), ev(json!({"type": "item_completed", "item": {"status": "declined"}}))]);
    assert!(page(&lone, None, 40, codex_events).items.is_empty());
}

/// Codex 0.163 롤아웃의 그림 만들기(10-24 실측 모양) — `event_msg item_completed{Extension · image_gen.generation · savedPath}` 가
/// 에이전트 말 `![지시문](경로)` 로 선다(사이드 채팅 실시간과 같은 글자). 그 `exec` 호출 · 결과(`input_image` 데이터 URL)는 도구
/// 한 항목 그대로이고 그림 말을 겹쳐 만들지 않는다. 끝나지 않은 · 경로 없는 그림은 아무것도 아니다.
#[test]
fn codex_generated_images_are_rebuilt_as_markdown() {
    let ev = |payload: Value| json!({"type": "event_msg", "timestamp": "2026-10-24T04:18:03.110Z", "payload": payload});
    let path = r"C:\Users\me\.codex\generated_images\t\exec-1.png";
    let file = lines(&[
        x_meta(),
        x_item(json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "red circle"}]})),
        x_item(json!({"type": "custom_tool_call", "status": "completed", "call_id": "call_9", "name": "exec",
            "input": "const result = await tools.image_gen__imagegen({prompt:\"red circle\"});"})),
        ev(json!({"type": "item_completed", "item": {"type": "Extension", "kind": "image_gen.generation", "id": "exec-1",
            "status": "completed", "revisedPrompt": "A red circle", "result": "iVBORw0KGgo", "savedPath": path}})),
        x_item(json!({"type": "custom_tool_call_output", "call_id": "call_9", "output": [
            {"type": "input_text", "text": "Script completed"},
            {"type": "input_image", "image_url": "data:image/png;base64,iVBORw0KGgo", "detail": "high"}]})),
        ev(json!({"type": "item_completed", "item": {"type": "Extension", "kind": "image_gen.generation", "id": "exec-2",
            "status": "in_progress", "savedPath": path}})),
        ev(json!({"type": "item_completed", "item": {"type": "Extension", "kind": "image_gen.generation", "id": "exec-3",
            "status": "completed", "savedPath": ""}})),
        x_item(json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done"}]})),
    ]);
    let p = page(&file, None, 40, codex_events);
    assert_eq!(roles(&p), ["user", "tool", "assistant", "assistant"]);
    assert_eq!(texts(&p)[2], format!("![A red circle]({path})"));
    let out = p.items[1].tool.as_ref().unwrap().output.as_deref().unwrap();
    assert!(!out.contains("base64"), "데이터 URL 은 도구 결과 글에 실리지 않는다: {out}");
}

#[test]
fn claude_tool_calls_pair_with_their_results_even_in_parallel() {
    let file = lines(&[
        c_user(json!("go"), json!({"origin": {"kind": "human"}})),
        c_tool(
            "t1",
            "Bash",
            json!({"command": "git status\n# and more", "description": "Show status"}),
        ),
        c_tool(
            "t2",
            "Edit",
            json!({"file_path": "src/x.ts", "old_string": "a", "new_string": "b"}),
        ),
        c_result("t2", json!([{"type": "text", "text": "edited"}])),
        c_user(
            json!([{"type": "tool_result", "tool_use_id": "t1", "content": "On branch main", "is_error": true}]),
            json!({}),
        ),
    ]);
    let p = page(&file, None, 40, claude_events);
    assert_eq!(roles(&p), ["user", "tool", "tool"]);
    let a = p.items[1].tool.as_ref().unwrap();
    assert_eq!(
        (a.name.as_str(), a.summary.as_str()),
        ("Bash", "git status")
    );
    assert_eq!(
        a.input.as_deref(),
        Some("git status\n# and more"),
        "명령은 글자 그대로"
    );
    assert_eq!(
        (a.output.as_deref(), a.error),
        (Some("On branch main"), true)
    );
    let b = p.items[2].tool.as_ref().unwrap();
    assert_eq!(
        (b.name.as_str(), b.summary.as_str(), b.output.as_deref()),
        ("Edit", "src/x.ts", Some("edited"))
    );
    assert!(
        b.input.as_deref().unwrap().contains("\"old_string\""),
        "그 밖의 입력은 JSON"
    );
}

fn tail(s: &str, parse: LineEvents) -> TurnTail {
    turn_tail_from(Cursor::new(s.as_bytes().to_vec()), s.len() as u64, parse).unwrap()
}

#[test]
fn claude_turn_tail_is_the_last_assistant_text_of_this_turn() {
    let file = lines(&[
        c_user(json!("old prompt"), json!({"origin": {"kind": "human"}})),
        c_asst(json!([{"type": "text", "text": "old answer"}])),
        c_user(json!("new prompt"), json!({"origin": {"kind": "human"}})),
        c_asst(json!([{"type": "text", "text": "Looking."}])),
        c_tool("t1", "Bash", json!({"command": "ls"})),
        c_result("t1", json!("a b")),
        c_asst(json!([{"type": "text", "text": "Done:

- split the **center**"}])),
        c_asst(json!([{"type": "thinking", "thinking": "secret plan", "signature": "s"}])),
        json!({"type": "system", "subtype": "x", "content": "hook said"}),
    ]);
    let t = tail(&file, claude_events);
    assert_eq!(
        t.text.as_deref(),
        Some(
            "Done:

- split the **center**"
        ),
        "생각은 건너뛰고 마지막 글"
    );
    assert!(
        t.pending_tool.is_none(),
        "결과가 있는 도구는 묻는 중이 아니다"
    );

    // 이번 턴에 에이전트 글이 없으면 지난 턴의 답을 가져오지 않는다.
    let file = lines(&[
        c_asst(json!([{"type": "text", "text": "old answer"}])),
        c_user(json!("new prompt"), json!({"origin": {"kind": "human"}})),
    ]);
    assert!(tail(&file, claude_events).text.is_none());
}

#[test]
fn claude_turn_tail_names_the_tool_awaiting_permission() {
    let file = lines(&[
        c_user(json!("go"), json!({"origin": {"kind": "human"}})),
        c_asst(json!([{"type": "text", "text": "I will edit the file."}])),
        c_tool("t9", "Edit", json!({"file_path": "src/x.ts"})),
    ]);
    let t = tail(&file, claude_events);
    assert_eq!(t.pending_tool.as_deref(), Some("Edit"));
    assert_eq!(t.text.as_deref(), Some("I will edit the file."));
    assert!(tail("", claude_events).text.is_none(), "빈 파일");
    assert!(
        tail(
            "not json
{",
            claude_events
        )
        .text
        .is_none(),
        "망가진 줄"
    );
}

#[test]
fn codex_turn_tail_skips_reasoning_and_injected_user_text() {
    let file = lines(&[
        x_meta(),
        x_item(
            json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "fix it"}]}),
        ),
        x_item(
            json!({"type": "reasoning", "summary": [{"type": "summary_text", "text": "hidden"}]}),
        ),
        x_item(
            json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Fixed the bug."}]}),
        ),
        x_item(
            json!({"type": "reasoning", "summary": [{"type": "summary_text", "text": "hidden 2"}]}),
        ),
    ]);
    let t = tail(&file, codex_events);
    assert_eq!(t.text.as_deref(), Some("Fixed the bug."));
    assert!(t.pending_tool.is_none());
}

pub(crate) fn x_meta() -> Value {
    json!({"type": "session_meta", "timestamp": "2026-09-21T00:00:00.000Z", "payload": {"id": X1, "cwd": "/w", "source": "cli"}})
}

pub(crate) fn x_item(payload: Value) -> Value {
    json!({"type": "response_item", "timestamp": "2026-09-21T00:00:05.000Z", "payload": payload})
}

#[test]
fn codex_lines_normalise_skip_injected_context_and_pair_calls() {
    let file = lines(&[
        x_meta(),
        x_item(
            json!({"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "<permissions instructions>"}]}),
        ),
        x_item(json!({"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "# AGENTS.md instructions for /w\n..."},
            {"type": "input_text", "text": "<environment_context>\n<cwd>/w</cwd>\n</environment_context>"}]})),
        json!({"type": "event_msg", "payload": {"type": "user_message", "message": "Add a retry loop"}}),
        x_item(
            json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Add a retry loop"}]}),
        ),
        json!({"type": "turn_context", "payload": {"model": "m"}}),
        x_item(json!({"type": "reasoning", "summary": [], "encrypted_content": "zz"})),
        x_item(
            json!({"type": "function_call", "name": "shell", "call_id": "c1", "arguments": "{\"command\":[\"bash\",\"-lc\",\"cargo test\"]}"}),
        ),
        x_item(
            json!({"type": "custom_tool_call", "name": "apply_patch", "call_id": "c2", "input": "*** Begin Patch\n*** Update File: src/a.rs\n@@\n-x\n+y\n*** End Patch"}),
        ),
        x_item(
            json!({"type": "function_call_output", "call_id": "c1", "output": "{\"output\":\"test result: ok\",\"metadata\":{}}"}),
        ),
        x_item(
            json!({"type": "custom_tool_call_output", "call_id": "c2", "output": [{"type": "input_text", "text": "Success"}]}),
        ),
        x_item(
            json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done."}]}),
        ),
    ]);
    let p = page(&file, None, 40, codex_events);
    assert_eq!(
        roles(&p),
        ["user", "tool", "tool", "assistant"],
        "주입된 것 · 개발자 말 · event_msg 사본 · 생각은 없다"
    );
    assert_eq!(texts(&p)[0], "Add a retry loop");
    let sh = p.items[1].tool.as_ref().unwrap();
    assert_eq!(
        (sh.name.as_str(), sh.summary.as_str(), sh.input.as_deref()),
        ("shell", "cargo test", Some("cargo test"))
    );
    assert_eq!(
        sh.output.as_deref(),
        Some("test result: ok"),
        "옛 모양의 JSON 출력은 output 만"
    );
    let pa = p.items[2].tool.as_ref().unwrap();
    assert_eq!(
        (pa.summary.as_str(), pa.output.as_deref()),
        ("src/a.rs", Some("Success"))
    );
    assert_eq!(texts(&p)[3], "Done.");
}

#[test]
fn long_texts_and_excerpts_are_cut_and_marked() {
    let long = "가".repeat(TEXT_MAX_CHARS + 10);
    let file = lines(&[
        c_asst(json!([{"type": "text", "text": long}])),
        c_tool(
            "t1",
            "Bash",
            json!({"command": "x".repeat(INPUT_MAX_CHARS + 5)}),
        ),
        c_result("t1", json!("y".repeat(OUTPUT_MAX_CHARS + 5))),
    ]);
    let p = page(&file, None, 40, claude_events);
    assert!(p.items[0].truncated);
    assert_eq!(
        p.items[0].text.as_ref().unwrap().chars().count(),
        TEXT_MAX_CHARS
    );
    let t = p.items[1].tool.as_ref().unwrap();
    assert!(t.input_truncated && t.output_truncated);
    assert_eq!(t.input.as_ref().unwrap().len(), INPUT_MAX_CHARS);
    assert_eq!(t.output.as_ref().unwrap().len(), OUTPUT_MAX_CHARS);
    assert!(t.summary.chars().count() <= SUMMARY_MAX_CHARS + 1 && t.summary.ends_with('…'));
}

/// 여러 쪽을 거꾸로 이어 붙이면 파일 전체를 한 번에 읽은 것과 같다 — 덩어리 경계([`CHUNK_BYTES`])를 여러 번
/// 넘는 큰 파일로(줄 하나가 덩어리보다 긴 것도 섞는다).
#[test]
fn backward_paging_is_seamless_across_chunk_boundaries() {
    let mut vs = vec![json!({"type": "mode"})];
    for i in 0..120 {
        let pad = if i % 17 == 0 {
            "z".repeat(300 * 1024)
        } else {
            "w".repeat(9_000)
        };
        vs.push(c_user(
            json!(format!("q{i} {}", &pad[..8])),
            json!({"origin": {"kind": "human"}}),
        ));
        vs.push(c_tool(
            &format!("t{i}"),
            "Read",
            json!({"file_path": format!("f{i}.rs")}),
        ));
        vs.push(json!({"type": "attachment", "attachment": {"blob": pad}}));
        vs.push(c_result(&format!("t{i}"), json!(format!("out{i}"))));
        vs.push(c_asst(json!([{"type": "text", "text": format!("a{i}")}])));
    }
    let file = lines(&vs);
    assert!(file.len() as u64 > 8 * CHUNK_BYTES);
    let whole = page(&file, None, LIMIT_MAX, claude_events);
    // 한 번에 200 개면 모자란다 — 끝까지 쪽을 넘긴다
    let mut got: Vec<String> = Vec::new();
    let mut before = None;
    let mut pages = 0;
    loop {
        let p = page(&file, before, 7, claude_events);
        pages += 1;
        let mut these: Vec<String> = p
            .items
            .iter()
            .map(|i| match &i.tool {
                Some(t) => format!(
                    "{}:{}:{}",
                    t.name,
                    t.summary,
                    t.output.clone().unwrap_or_default()
                ),
                None => i.text.clone().unwrap_or_default(),
            })
            .collect();
        these.append(&mut got);
        got = these;
        match p.cursor {
            Some(c) => {
                assert!(before.is_none_or(|b| c < b), "커서는 늘 앞으로(작아진다)");
                assert_eq!(file.as_bytes()[c as usize - 1], b'\n', "커서는 줄의 시작");
                before = Some(c);
            }
            None => break,
        }
    }
    assert!(pages > 10);
    assert_eq!(got.len(), 360, "사용자 · 도구 · 에이전트 × 120");
    assert!(
        got.iter()
            .filter(|s| s.starts_with("Read:"))
            .all(|s| !s.ends_with(':')),
        "쪽 경계가 호출과 결과를 가르지 않았다"
    );
    assert_eq!(got[0], "q0 zzzzzzzz");
    assert_eq!(got[1], "Read:f0.rs:out0");
    assert_eq!(got[359], "a119");
    assert!(
        whole.items.len() >= LIMIT_MAX && whole.cursor.is_some(),
        "한 쪽의 상한"
    );
}

#[test]
fn a_page_stops_before_the_next_visible_line_and_says_more_only_when_there_is() {
    let file = lines(&[
        json!({"type": "mode"}),
        c_user(json!("one"), json!({"origin": {"kind": "human"}})),
        c_asst(json!([{"type": "text", "text": "two"}])),
        json!({"type": "ai-title", "aiTitle": "T"}),
        c_user(json!("three"), json!({"origin": {"kind": "human"}})),
        json!({"type": "last-prompt"}),
    ]);
    let p = page(&file, None, 2, claude_events);
    assert_eq!(texts(&p), ["two", "three"]);
    let c = p.cursor.expect("더 있다");
    let q = page(&file, Some(c), 2, claude_events);
    assert_eq!(texts(&q), ["one"]);
    assert!(
        q.cursor.is_none(),
        "맨 앞의 메타 줄만 남았으면 '더 있다' 가 아니다"
    );
    // 딱 떨어지는 경우 — 남은 것이 메타뿐이면 첫 쪽부터 커서가 없다
    let r = page(&file, None, 3, claude_events);
    assert_eq!(texts(&r), ["one", "two", "three"]);
    assert!(r.cursor.is_none());
}

#[test]
fn a_half_written_last_line_and_blank_lines_are_skipped() {
    let mut file = lines(&[c_user(json!("hi"), json!({"origin": {"kind": "human"}}))]);
    file.push_str("\n\n");
    file.push_str(r#"{"type":"assistant","message":{"content":[{"type":"te"#);
    let p = page(&file, None, 10, claude_events);
    assert_eq!(texts(&p), ["hi"]);
}

#[test]
fn bad_cursors_are_refused() {
    let file = lines(&[
        c_user(json!("hi"), json!({})),
        c_user(json!("there"), json!({})),
    ]);
    let len = file.len() as u64;
    let run = |b| {
        read_page_from(
            Cursor::new(file.as_bytes().to_vec()),
            len,
            Some(b),
            5,
            claude_events,
        )
    };
    assert!(run(len + 1).is_err(), "파일 밖");
    assert!(run(3).is_err(), "줄 가운데");
    assert!(run(0).unwrap().items.is_empty() && run(0).unwrap().cursor.is_none());
    let first_end = file.find('\n').unwrap() as u64 + 1;
    assert_eq!(texts(&run(first_end).unwrap()), ["hi"]);
}

#[test]
fn an_orphan_result_stands_alone_without_a_name() {
    let file = lines(&[c_result("gone", json!("late output"))]);
    let p = page(&file, None, 5, claude_events);
    let t = p.items[0].tool.as_ref().unwrap();
    assert_eq!(
        (t.name.as_str(), t.output.as_deref()),
        ("", Some("late output"))
    );
}

#[test]
fn summaries_pick_the_telling_argument() {
    assert_eq!(
        tool_summary(&json!({"pattern": "fn main", "path": "src"})),
        "src"
    );
    assert_eq!(
        tool_summary(&json!({"url": "https://example.test/a"})),
        "https://example.test/a"
    );
    assert_eq!(
        tool_summary(&json!({"command": ["git", "log", "-1"]})),
        "git log -1"
    );
    assert_eq!(
        tool_summary(&json!({"command": ["pwsh", "-Command", "ls"]})),
        "ls"
    );
    assert_eq!(tool_summary(&json!({"other": 1})), "");
    assert_eq!(
        tool_summary(&json!("\n\n  first  line \nsecond")),
        "first line"
    );
    assert_eq!(
        tool_summary(&json!(
            "*** Begin Patch\n*** Add File: a.md\n*** Delete File: b.md"
        )),
        "a.md, b.md"
    );
}

// ---- 파일 찾기 — 목록의 색인에서만 (임시 루트 — 진짜 ~/.claude·~/.codex 는 밟지 않는다) ----

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aynx-atr-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn transcript_is_found_by_id_only_and_refuses_bad_ids() {
    let dir = temp_dir("find");
    let croot = dir.join("claude").join("projects");
    let pdir = croot.join("-w-p");
    std::fs::create_dir_all(&pdir).unwrap();
    std::fs::write(
        pdir.join(format!("{U1}.jsonl")),
        lines(&[
            c_user(json!("hello"), json!({"origin": {"kind": "human"}})),
            c_asst(json!([{"type": "text", "text": "hi"}])),
        ]),
    )
    .unwrap();
    let xroot = dir.join("codex").join("sessions");
    let day = xroot.join("2026").join("09").join("21");
    std::fs::create_dir_all(&day).unwrap();
    std::fs::write(
        day.join(format!("rollout-2026-09-21T00-00-00-{X1}.jsonl")),
        lines(&[
            x_meta(),
            json!({"type": "turn_context", "payload": {"model": "m"}}),
            x_item(json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "codex hello"}]})),
        ]),
    )
    .unwrap();
    let claude = crate::agent_sessions::target("claude").unwrap();
    let codex = crate::agent_sessions::target("codex").unwrap();
    let croots = vec![croot.clone()];
    let xroots = vec![xroot.clone()];
    let p = transcript_in(claude, &croots, &U1.to_uppercase(), None, None).unwrap();
    assert_eq!(texts(&p), ["hello", "hi"]);
    let p = transcript_in(codex, &xroots, X1, None, Some(10)).unwrap();
    assert_eq!(texts(&p), ["codex hello"]);
    for bad in [
        "",
        "x",
        "../../etc/passwd",
        &format!("{U1}/../x"),
        &format!("{U1}\""),
        "11111111-2222-4333-8444-55555555555;",
    ] {
        assert!(
            transcript_in(claude, &croots, bad, None, None).is_err(),
            "{bad}"
        );
    }
    assert!(
        transcript_in(
            claude,
            &croots,
            "99999999-9999-4999-8999-999999999999",
            None,
            None
        )
        .is_err(),
        "없는 대화"
    );
    assert!(
        transcript_in(codex, &xroots, U1, None, None).is_err(),
        "다른 에이전트의 id 는 그 에이전트 루트에 없다"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- 전방 증분 읽기(오케스트레이션 6단계 — `forward.rs`) — 같은 합성 표본 · 같은 줄 파서 ----

fn fwd(s: &str, start: u64, parse: LineEvents, budget: forward::Budget) -> forward::FwdPage {
    forward::read_forward_from(Cursor::new(s.as_bytes().to_vec()), s.len() as u64, start, parse, budget).unwrap()
}

fn fwd_roles(p: &forward::FwdPage) -> Vec<&'static str> {
    p.items.iter().map(|i| i.role).collect()
}

#[test]
fn forward_cursor_handles_partial_line_and_rotation() {
    let done = lines(&[
        c_user(json!("go"), json!({"origin": {"kind": "human"}})),
        c_asst(json!([{"type": "text", "text": "on it"}])),
    ]);
    // 쓰는 중인(줄바꿈 없는) 마지막 줄 — 읽지 않고 미룬다(위치는 그 줄의 시작).
    let half = c_asst(json!([{"type": "text", "text": "second"}])).to_string();
    let cut = &half[..half.len() / 2];
    let file = format!("{done}{cut}");
    let p = fwd(&file, 0, claude_events, forward::Budget::default());
    assert_eq!(fwd_roles(&p), ["user", "assistant"]);
    assert!(p.partial, "미완성 줄은 미뤘다고 말한다");
    assert_eq!(p.next, done.len() as u64, "커서는 미완성 줄의 시작");
    // 줄이 마저 쓰이면 그 줄부터 — 앞의 것은 다시 내지 않는다.
    let file = format!("{done}{half}\n");
    let p2 = fwd(&file, p.next, claude_events, forward::Budget::default());
    assert_eq!(fwd_roles(&p2), ["assistant"]);
    assert_eq!(p2.items[0].text.as_deref(), Some("second"));
    assert!(!p2.partial);
    assert_eq!(p2.next, file.len() as u64);

    // 커서 대 보기(세대) — 처음 · 그대로 · 줄었다 · 교체 · 시각이 뒤로 · 줄의 시작이 아니다.
    let g = |id: &str, size: u64, mtime: i64| forward::FileGen { id: id.into(), size, mtime_ms: mtime };
    let cur = forward::Cursor { gen: g("a-1", 100, 50), pos: 80, skip: 0 };
    let nl = |_: u64| Some(b'\n');
    assert_eq!(forward::resume_at(None, &g("a-1", 100, 50), nl), (0, false));
    assert_eq!(forward::resume_at(Some(&cur), &g("a-1", 140, 60), nl), (80, false), "자랐다 — 이어 읽는다");
    assert_eq!(forward::resume_at(Some(&cur), &g("a-1", 60, 60), nl), (0, true), "줄었다 — 처음부터");
    assert_eq!(forward::resume_at(Some(&cur), &g("b-2", 140, 60), nl), (0, true), "다른 파일로 교체");
    assert_eq!(forward::resume_at(Some(&cur), &g("a-1", 140, 40), nl), (0, true), "수정 시각이 뒤로");
    assert_eq!(forward::resume_at(Some(&cur), &g("a-1", 140, 60), |_| Some(b'x')), (0, true), "줄의 시작이 아니다");
    assert_eq!(forward::resume_at(Some(&cur), &g("", 140, 60), nl), (80, false), "식별을 못 읽으면 크기 · 시각 · 줄바꿈으로");

    // 글자 커서는 왕복하고, 모양이 틀리면 받지 않는다.
    assert!(forward::Cursor::decode(&cur.encode()) == Some(cur.clone()));
    for bad in ["", "t1", "t2.a.1.2.0", "t1.zz.1.2.0", "t1.a.10.2.11", "t1.a.1.2.0.9", "t1.a..2.0"] {
        assert!(forward::Cursor::decode(bad).is_none(), "{bad}");
    }

    // 진짜 파일 — 교체(지우고 새로 쓰기)되면 처음부터 + reset.
    let dir = temp_dir("fwd-rot");
    let path = dir.join("t.jsonl");
    std::fs::write(&path, &done).unwrap();
    let (p, c1, reset) = forward::read_forward(&path, None, claude_events, forward::Budget::default()).unwrap();
    assert_eq!((p.items.len(), reset), (2, false));
    let (p, c2, reset) = forward::read_forward(&path, Some(&c1), claude_events, forward::Budget::default()).unwrap();
    assert_eq!((p.items.len(), reset, c2.pos), (0, false, c1.pos), "새 것이 없으면 빈 쪽 · 같은 위치");
    std::fs::remove_file(&path).unwrap();
    std::fs::write(&path, lines(&[c_user(json!("fresh"), json!({"origin": {"kind": "human"}}))])).unwrap();
    let (p, _, reset) = forward::read_forward(&path, Some(&c2), claude_events, forward::Budget::default()).unwrap();
    assert!(reset, "줄어든 · 교체된 파일은 처음부터");
    assert_eq!(p.items[0].text.as_deref(), Some("fresh"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn forward_reader_emits_tool_result_update() {
    // Claude — 호출 줄 뒤에 결과가 늦게 붙는다.
    let first = lines(&[
        c_user(json!("go"), json!({"origin": {"kind": "human"}})),
        c_asst(json!([{"type": "thinking", "thinking": "secret", "signature": "s"}])),
        c_tool("t1", "Bash", json!({"command": "cargo test", "description": "run tests"})),
        c_user(json!("side"), json!({"isSidechain": true})),
    ]);
    let p = fwd(&first, 0, claude_events, forward::Budget::default());
    assert_eq!(fwd_roles(&p), ["user", "tool"], "생각 · sidechain 은 없다(기록 보기와 같은 파서)");
    let t = p.items[1].tool.as_ref().unwrap();
    assert_eq!((t.id.as_str(), t.name.as_str(), t.summary.as_str(), t.pending), ("t1", "Bash", "cargo test", true));
    let more = lines(&[
        c_result("t1", json!("test result: ok")),
        c_tool("t2", "Read", json!({"file_path": "src/a.rs"})),
        c_result("t2", json!([{"type": "text", "text": "fn a() {}"}])),
    ]);
    let file = format!("{first}{more}");
    let p2 = fwd(&file, p.next, claude_events, forward::Budget::default());
    assert_eq!(fwd_roles(&p2), ["tool", "tool"]);
    let up = &p2.items[0];
    assert!(up.update, "앞 쪽에서 낸 호출의 결과 — 갱신 항목");
    let ut = up.tool.as_ref().unwrap();
    assert_eq!((ut.id.as_str(), ut.output.as_deref(), ut.pending), ("t1", Some("test result: ok"), false));
    let same = p2.items[1].tool.as_ref().unwrap();
    assert!(!p2.items[1].update, "같은 쪽 안의 결과는 그 항목에 붙는다");
    assert_eq!((same.name.as_str(), same.output.as_deref(), same.pending), ("Read", Some("fn a() {}"), false));
    // 처음부터 한 번에 읽으면 갱신 항목 없이 짝이 맞는다.
    let all = fwd(&file, 0, claude_events, forward::Budget::default());
    assert!(all.items.iter().all(|i| !i.update));
    assert_eq!(all.items.len(), 3);

    // Codex — 같은 규칙(주입 · 생각 제외, function_call ↔ output).
    let cx = lines(&[
        x_meta(),
        x_item(json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "<environment_context>x</environment_context>"}]})),
        x_item(json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Add a retry loop"}]})),
        x_item(json!({"type": "reasoning", "summary": [], "encrypted_content": "zz"})),
        x_item(json!({"type": "function_call", "name": "shell", "call_id": "c1", "arguments": "{\"command\":[\"bash\",\"-lc\",\"cargo test\"]}"})),
    ]);
    let p = fwd(&cx, 0, codex_events, forward::Budget::default());
    assert_eq!(fwd_roles(&p), ["user", "tool"]);
    assert!(p.items[1].tool.as_ref().unwrap().pending);
    let cx2 = format!(
        "{cx}{}",
        lines(&[
            x_item(json!({"type": "function_call_output", "call_id": "c1", "output": "{\"output\":\"ok\",\"metadata\":{}}"})),
            x_item(json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done."}]})),
        ])
    );
    let p2 = fwd(&cx2, p.next, codex_events, forward::Budget::default());
    assert_eq!(fwd_roles(&p2), ["tool", "assistant"]);
    assert!(p2.items[0].update);
    assert_eq!(p2.items[0].tool.as_ref().unwrap().output.as_deref(), Some("ok"));
}

#[test]
fn forward_budget_caps_fields_items_and_bytes() {
    let big = "x".repeat(5000);
    let mut vs = vec![c_tool("t1", "Bash", json!({"command": big.clone()})), c_result("t1", json!(big.clone()))];
    for i in 0..80 {
        vs.push(c_asst(json!([{"type": "text", "text": format!("line {i}")}])));
    }
    let file = lines(&vs);
    let p = fwd(&file, 0, claude_events, forward::Budget::default());
    let t = p.items[0].tool.as_ref().unwrap();
    assert!(t.input.as_ref().unwrap().len() <= forward::FIELD_MAX_BYTES && t.input_truncated);
    assert!(t.output.as_ref().unwrap().len() <= forward::FIELD_MAX_BYTES && t.output_truncated);
    assert_eq!(p.items.len(), forward::ITEMS_MAX, "항목 상한");
    assert!(p.more);
    let p2 = fwd(&file, p.next, claude_events, forward::Budget::default());
    assert_eq!(p.items.len() + p2.items.len(), 81, "이어 읽으면 빠짐 · 겹침이 없다");
    assert!(!p2.more);
    // 글자 예산 — 넘기 전에 멈추고(첫 줄은 싣는다), 다음 커서에서 이어진다.
    let small = forward::Budget { items: 50, bytes: 600 };
    let p = fwd(&file, 0, claude_events, small);
    assert!(p.more && !p.items.is_empty() && p.items.len() < 10);
    // 말 하나도 자른다.
    let long = lines(&[c_asst(json!([{"type": "text", "text": "가".repeat(3000)}]))]);
    let p = fwd(&long, 0, claude_events, forward::Budget::default());
    assert!(p.items[0].truncated && p.items[0].text.as_ref().unwrap().len() <= forward::TEXT_MAX_BYTES);
}

// ---- 사람 말에 바로 실린 그림 (2026-10-24 실측 모양 — 바이트는 1×1 PNG) ----

const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/// 쪽의 그림 자리로 같은 파일에서 바이트를 다시 꺼낸다(로컬 · 원격이 같은 순수 검사).
fn pic_bytes(file: &str, p: &TranscriptImage) -> Result<Vec<u8>, String> {
    image_in_window(file.len() as u64, 0, file.as_bytes(), p.at, p.len, p.n)
}

/// Claude 붙여넣기(Alt+V) · 끌어 놓은 파일 — 사용자 줄 `[{text: "[Image #3] …"}, {image{source{base64}}}]` + 따로 선 `isMeta` 줄
/// `[Image: source: <경로>]`(건너뛴다). 그릴 수 있는 것만 자리가 서고(형식 · base64 아닌 것은 칩), 자리로 바이트가 다시 나온다.
#[test]
fn claude_pasted_images_get_pictures_and_bytes_come_back() {
    let file = lines(&[
        c_asst(json!([{"type": "text", "text": "앞 말"}])),
        c_user(
            json!([{"type": "text", "text": "[Image #3] [Image #4] 붙었나?"},
                   {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": PNG_1X1}},
                   {"type": "image", "source": {"type": "base64", "media_type": "image/tiff", "data": PNG_1X1}},
                   {"type": "image", "source": {"type": "base64", "media_type": "image/webp", "data": PNG_1X1}}]),
            json!({"origin": {"kind": "human"}, "imagePasteIds": [3, 4]}),
        ),
        c_user(json!([{"type": "text", "text": "[Image: source: C:/a/doro.webp]"}]), json!({"isMeta": true})),
        c_result("t1", json!([{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": PNG_1X1}}])),
    ]);
    let p = page(&file, None, 40, claude_events);
    let u = p.items.iter().find(|i| i.role == "user").unwrap();
    assert_eq!(u.images, 3);
    assert_eq!(u.pictures.iter().map(|x| (x.n, x.mime)).collect::<Vec<_>>(), [(0, "image/png"), (2, "image/webp")], "tiff 는 칩");
    let png = data_encoding::BASE64.decode(PNG_1X1.as_bytes()).unwrap();
    for pic in &u.pictures {
        assert_eq!(pic_bytes(&file, pic).unwrap(), png);
    }
    // 줄과 맞지 않는 자리 · 그림이 아닌 차례는 거절
    let pic = &u.pictures[0];
    assert!(image_in_window(file.len() as u64, 0, file.as_bytes(), pic.at + 1, pic.len - 1, 0).is_err());
    assert!(image_in_window(file.len() as u64, 0, file.as_bytes(), pic.at, pic.len - 1, 0).is_err());
    assert!(image_in_window(file.len() as u64, 0, file.as_bytes(), pic.at, pic.len, 1).is_err(), "tiff");
    assert!(image_in_window(file.len() as u64, 0, file.as_bytes(), pic.at, pic.len, 9).is_err());
    assert!(image_in_window(file.len() as u64, pic.at, &file.as_bytes()[pic.at as usize..], pic.at, pic.len, 0).is_err(), "앞 줄바꿈이 창 밖");
    // 도구 결과의 그림은 말이 아니다
    assert!(p.items.iter().filter(|i| i.role == "tool").all(|i| i.pictures.is_empty()));
}

/// Codex — `response_item message{role:user}` 의 `<image name=[Image #1] path=…>` + `input_image{image_url: data:…}` + `</image>`
/// (감싼 글은 주입으로 걸러진다). 같은 그림의 `event_msg item_completed{UserMessage · local_image{path}}` 는 사본이라 보지 않는다.
#[test]
fn codex_input_images_get_pictures() {
    let file = lines(&[
        x_meta(),
        x_item(json!({"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "<image name=[Image #1] path=\"C:/Temp/paste-1.png\">"},
            {"type": "input_image", "image_url": format!("data:image/png;base64,{PNG_1X1}"), "detail": "high"},
            {"type": "input_text", "text": "</image>"},
            {"type": "input_image", "image_url": "https://example.com/a.png"},
            {"type": "input_text", "text": "카드 배치 검토. [Image #1]"}]})),
        json!({"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "UserMessage", "content": [
            {"type": "local_image", "path": "C:/Temp/paste-1.png"}, {"type": "text", "text": "카드 배치 검토. [Image #1]"}]}}}),
    ]);
    let p = page(&file, None, 40, codex_events);
    assert_eq!(roles(&p), ["user"]);
    let u = &p.items[0];
    assert_eq!((u.text.as_deref(), u.images), (Some("카드 배치 검토. [Image #1]"), 2));
    assert_eq!(u.pictures.len(), 1, "주소 그림은 불러오지 않는다(칩)");
    assert_eq!(pic_bytes(&file, &u.pictures[0]).unwrap(), data_encoding::BASE64.decode(PNG_1X1.as_bytes()).unwrap());
    // 원격 창처럼 앞뒤가 잘린 조각에서도 같은 답
    let pic = &u.pictures[0];
    let (s, e) = (pic.at - 1, (pic.at + pic.len + 1).min(file.len() as u64));
    let w = &file.as_bytes()[s as usize..e as usize];
    assert!(image_in_window(file.len() as u64, s, w, pic.at, pic.len, pic.n).is_ok());
}

/// 최신 쪽은 마지막 답의 모델 · 강도를 싣는다(AI 타일 대화 면의 모델 키워드 — Claude 답 줄 · Codex `turn_context`). 더 오래된 쪽 ·
/// 부속 에이전트 줄 · 꺾쇠 이름은 아니다. 오케스트레이션 길(`page_of_file`)은 싣지 않는다.
#[test]
fn latest_page_carries_the_last_model_and_effort() {
    let mut old = c_asst(json!([{"type": "text", "text": "앞 답"}]));
    old["message"]["model"] = json!("claude-sonnet-5-5");
    old["effort"] = json!("low");
    let mut side = c_asst(json!([{"type": "text", "text": "부속"}]));
    side["isSidechain"] = json!(true);
    side["message"]["model"] = json!("claude-haiku-5-5");
    let mut synth = c_asst(json!([{"type": "text", "text": "합성"}]));
    synth["message"]["model"] = json!("<synthetic>");
    let mut new = c_asst(json!([{"type": "text", "text": "새 답"}]));
    new["message"]["model"] = json!("claude-opus-5-5");
    new["effort"] = json!("medium");
    let file = lines(&[old, new, side, synth]);
    // 값을 실은 줄(둘째 줄)의 첫머리
    let new_at = (file.find('\n').unwrap() + 1) as u64;
    let p = page(&file, None, 40, claude_events);
    assert_eq!(
        p.last,
        Some(LastModel { model: "claude-opus-5-5".into(), effort: Some("medium".into()), at: new_at })
    );
    let v = serde_json::to_value(&p).unwrap();
    assert_eq!(v["last"], json!({"model": "claude-opus-5-5", "effort": "medium", "at": new_at}));
    // 새 턴의 사람 말이 붙어도 last 와 그 자리는 그대로(값을 실은 줄이 아니다)
    let more = file.clone() + &lines(&[c_user(json!("다음 질문"), json!({}))]);
    assert_eq!(page(&more, None, 40, claude_events).last.map(|l| l.at), Some(new_at));
    // 원격(파일 끝의 창 하나 — 같은 리더)도 파일 기준 자리
    let mut w = 16usize;
    let p = loop {
        let start = more.len().saturating_sub(w);
        match page_in_window(more.len() as u64, start as u64, &more.as_bytes()[start..], None, 2, claude_events).unwrap() {
            WindowPage::Page(p) => break p,
            WindowPage::NeedMore => w *= 4,
        }
    };
    assert_eq!(p.last.map(|l| l.at), Some(new_at));
    // 더 오래된 쪽(커서 앞)은 싣지 않는다
    let first_len = (file.find('\n').unwrap() + 1) as u64;
    assert!(page(&file, Some(first_len), 40, claude_events).last.is_none());

    // Codex — `turn_context` 의 payload(보이는 항목이 없는 줄이어도)
    let file = lines(&[
        x_meta(),
        json!({"type": "turn_context", "payload": {"model": "gpt-6-sol", "effort": "low"}}),
        json!({"type": "turn_context", "payload": {"model": "gpt-6-astra", "effort": "high"}}),
        x_item(json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "답"}]})),
    ]);
    let p = page(&file, None, 40, codex_events);
    let tc_at = file.match_indices('\n').nth(1).map(|(i, _)| i as u64 + 1).unwrap();
    assert_eq!(p.last, Some(LastModel { model: "gpt-6-astra".into(), effort: Some("high".into()), at: tc_at }));
    // 강도 없는 턴 — 모델만
    let file = lines(&[json!({"type": "turn_context", "payload": {"model": "gpt-6-astra"}})]);
    assert_eq!(page(&file, None, 40, codex_events).last, Some(LastModel { model: "gpt-6-astra".into(), effort: None, at: 0 }));
    // 모델을 알 줄이 없으면 없음 · 직렬화에서도 빠진다
    let file = lines(&[x_meta()]);
    let p = page(&file, None, 40, codex_events);
    assert!(p.last.is_none());
    assert!(serde_json::to_value(&p).unwrap().get("last").is_none());

    // 오케스트레이션의 고정 파일 길은 싣지 않는다
    let dir = std::env::temp_dir().join(format!("aynx-last-model-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("c.jsonl");
    std::fs::write(&path, lines(&[json!({"type": "turn_context", "payload": {"model": "gpt-6-astra"}})])).unwrap();
    let p = page_of_file(std::fs::File::open(&path).unwrap(), None, None, codex_events).unwrap();
    assert!(p.last.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- AI 타일 대화 면의 첨부 경로 걷기(2026-11-14) ----

/// 맨 앞의 앱 첨부 자리 경로(붙여넣기 꼴 — `"…"` · `'…'` · 그대로 + 빈칸 하나)만 걷는다. 다른 폴더 · 상대 경로 · 가운데 · hex 아닌 폴더는 그대로.
#[test]
fn attach_paths_strip_only_the_app_attachment_folder_at_the_front() {
    let root_raw = r"C:\Users\Me\AppData\Roaming\aynx\attachments";
    let root = norm_path(root_raw);
    let hex = "ab".repeat(32);
    let a = format!(r"{root_raw}\{hex}\main.ts");
    let b = format!(r"{root_raw}\{hex}\스크린 샷.PNG");
    let got = |t: &str| strip_attach_paths(t, &root).map(|(n, r)| (n, r.to_string()));
    assert_eq!(got(&format!("\"{a}\" 이 파일 봐 줘")), Some((vec!["main.ts".to_string()], "이 파일 봐 줘".to_string())));
    assert_eq!(
        got(&format!("\"{a}\" \"{b}\" 둘 다")),
        Some((vec!["main.ts".to_string(), "스크린 샷.PNG".to_string()], "둘 다".to_string()))
    );
    assert_eq!(got(&format!("\"{a}\" ")), Some((vec!["main.ts".to_string()], String::new())));
    assert_eq!(got(&format!("\"{a}\"")), Some((vec!["main.ts".to_string()], String::new())));
    // 대소문자 · 구분자가 달라도 같은 자리(Windows)
    if cfg!(windows) {
        let lower = format!("c:/users/me/appdata/roaming/aynx/attachments/{hex}/x.pdf");
        assert_eq!(got(&format!("{lower} 봐")), Some((vec!["x.pdf".to_string()], "봐".to_string())));
    }
    // POSIX 꼴('…' · 그대로)
    let posix_root = norm_path("/home/me/.local/share/aynx/attachments");
    let p = format!("/home/me/.local/share/aynx/attachments/{hex}/a b.txt");
    assert_eq!(strip_attach_paths(&format!("'{p}' 봐"), &posix_root).map(|(n, r)| (n, r.to_string())), Some((vec!["a b.txt".to_string()], "봐".to_string())));
    for t in [
        "그냥 글".to_string(),
        // 다른 폴더 · 상대 경로 · 가운데의 경로 · hex 가 아닌 폴더 · 첨부 자리 바로 그 폴더 · 한 단계 더 깊음
        r#""C:\Users\Me\Documents\main.ts" 봐"#.to_string(),
        format!("attachments/{hex}/main.ts 봐"),
        format!("이것 \"{a}\" 봐"),
        format!(r#""{root_raw}\notes\main.ts" 봐"#),
        format!(r#""{root_raw}\{hex}" 봐"#),
        format!(r#""{root_raw}\{hex}\sub\main.ts" 봐"#),
        // 닫히지 않은 따옴표 · 경로 바로 뒤에 글자가 붙음
        format!("\"{a} 봐"),
        format!("\"{a}\"봐"),
    ] {
        assert!(strip_attach_paths(&t, &root).is_none(), "{t}");
    }
    // 앞의 것만 걷고 가운데 것은 글에 남긴다
    assert_eq!(got(&format!("\"{a}\" 이것과 \"{a}\"")).unwrap().1, format!("이것과 \"{a}\""));
    // 그림 자리표는 남기고 그 뒤의 경로도 걷는다(칩 차례: 그림 → 파일)
    assert_eq!(got(&format!("[Image #1] \"{a}\" 봐")), Some((vec!["main.ts".to_string()], "[Image #1] 봐".to_string())));
    assert!(got("[Image #1] 봐").is_none());
    assert!(is_image_name("스크린 샷.PNG") && !is_image_name("main.ts"));
}

/// 기록 읽기 통째 — Claude 사람 말 맨 앞의 앱 첨부 자리 경로(서버의 실제 자리)는 `files` 칩으로 · 글에서 걷힌다. 그림 말의 그림 경로는 칩 없이.
#[test]
fn claude_user_attach_paths_become_file_chips() {
    let root = crate::agent_attachments::attachments_root().unwrap();
    let hex = "cd".repeat(32);
    let ts = root.join(&hex).join("main.ts");
    let png = root.join(&hex).join("shot.png");
    let q = |p: &Path| format!("\"{}\"", p.to_string_lossy());
    let file = lines(&[
        c_user(json!(format!("{} 이 파일 봐 줘", q(&ts))), json!({})),
        c_user(
            json!([{"type": "text", "text": format!("{} {} 둘 다", q(&png), q(&ts))},
                   {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": PNG_1X1}}]),
            json!({}),
        ),
        c_user(json!(r#""C:\elsewhere\main.ts" 그대로"#), json!({})),
    ]);
    let p = page(&file, None, 40, claude_events);
    let us: Vec<_> = p.items.iter().filter(|i| i.role == "user").collect();
    assert_eq!((us[0].text.as_deref(), us[0].files.clone()), (Some("이 파일 봐 줘"), vec!["main.ts".to_string()]));
    assert_eq!((us[1].text.as_deref(), us[1].files.clone()), (Some("둘 다"), vec!["main.ts".to_string()]), "그림 경로는 칩 없이 — 그림 블록이 그린다");
    assert!(us[2].files.is_empty() && us[2].text.as_deref() == Some(r#""C:\elsewhere\main.ts" 그대로"#));
}

/// 실측 모양(2026-11-14 — Claude 2.1.325 · Codex 0.169.0 Windows TUI 에 대화 면과 같은 걸음: 파일 경로 붙여넣기 → 그림 경로 붙여넣기 → 글 → Enter).
/// 경로는 이 PC 의 실제 첨부 자리로 바꿔 짓는다(사용자 이름 · 임시 경로를 저장소에 남기지 않는다).
/// - Claude: 그림 경로는 `[Image #1]` 자리표 + 그림 블록(+ 따로 선 `isMeta` `[Image: source: …]` 줄) — 파일 경로만 글에 남는다.
/// - Codex: 이번엔 그림 경로도 바뀌지 않고 글로 남았다(그림 블록 없음) — 둘 다 칩.
#[test]
fn measured_tui_attach_shapes_become_file_chips() {
    let root = crate::agent_attachments::attachments_root().unwrap();
    let hex = "ab".repeat(32);
    let ts = root.join(&hex).join("main.ts").to_string_lossy().into_owned();
    let png = root.join(&hex).join("shot.png").to_string_lossy().into_owned();
    let said = "테스트입니다. 도구 쓰지 말고 '네' 한 글자만 답하세요.";
    let claude = lines(&[
        c_user(
            json!([{"type": "text", "text": format!("\"{ts}\" [Image #1] {said}")},
                   {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": PNG_1X1}}]),
            json!({"origin": {"kind": "human"}, "imagePasteIds": [1]}),
        ),
        c_user(json!([{"type": "text", "text": format!("[Image: source: {png}]")}]), json!({"isMeta": true})),
    ]);
    let p = page(&claude, None, 40, claude_events);
    let u = p.items.iter().find(|i| i.role == "user").unwrap();
    let want = format!("[Image #1] {said}");
    assert_eq!((u.text.as_deref(), u.files.clone(), u.images, u.pictures.len()), (Some(want.as_str()), vec!["main.ts".to_string()], 1, 1));
    assert_eq!(p.items.iter().filter(|i| i.role == "user").count(), 1, "isMeta 줄은 건너뛴다");

    let codex = lines(&[
        x_meta(),
        x_item(json!({"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": format!("\"{ts}\" \"{png}\" {said}")}]})),
    ]);
    let p = page(&codex, None, 40, codex_events);
    let u = p.items.iter().find(|i| i.role == "user").unwrap();
    assert_eq!(
        (u.text.as_deref(), u.files.clone(), u.images),
        (Some(said), vec!["main.ts".to_string(), "shot.png".to_string()], 0),
        "그림 블록이 없으면 그림 경로도 칩"
    );
}
