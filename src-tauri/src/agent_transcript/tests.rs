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
        sdk(json!("[연결된 타일: pwsh · 세션 s1] [연결된 타일: 세션 s2] [연결된 타일: Claude Code · dev-01 · 세션 s3] 셋 다 봐 줘")),
    ]);
    let p = page(&file, None, 40, claude_events);
    assert_eq!(roles(&p), ["user", "assistant", "user", "user", "user", "user", "user"]);
    assert_eq!(
        texts(&p),
        [
            "p2 타일의 dir 목록 확인 가능??",
            "[연결된 타일: p2 · 세션 s1] 에이전트 글은 그대로",
            "Write 40 facts.",
            "<div>html</div>",
            "앞에 글 [연결된 타일: p2 · 세션 s1] 뒤",
            "[연결된 타일: p2 · 세션 s 1] 닮은 글",
            "셋 다 봐 줘",
        ]
    );
    let link = |i: usize| p.items[i].link.as_ref().map(|l| serde_json::to_value(l).unwrap());
    assert_eq!(link(0), Some(json!({"labels": ["p2 PowerShell 7"], "unlinked": false})));
    assert_eq!(link(1), None);
    assert_eq!(link(2), Some(json!({"labels": [], "unlinked": true})));
    assert_eq!(link(3), Some(json!({"labels": [""], "unlinked": false})));
    assert_eq!((link(4), link(5)), (None, None));
    // 여러 타일 연결의 머리글 — 연결 순서 그대로 · 이름 없는 타일은 빈 글자
    assert_eq!(link(6), Some(json!({"labels": ["pwsh", "", "Claude Code · dev-01"], "unlinked": false})));
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
    assert_eq!(serde_json::to_value(p.items[0].link.as_ref().unwrap()).unwrap(), json!({"labels": ["p1 pwsh"], "unlinked": false}));
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

/// codex-cli 0.172 코드 모드 롤아웃(실기 기록에서 줄만 추리고 경로를 `C:/repo` 로 바꿈) — `exec` 의 JS 조각이 안쪽 도구 호출로
/// 읽히고, 사람이 거절한 호출 · 끊긴 턴 표식이 남는다.
#[test]
fn codex_code_mode_exec_reads_as_the_inner_tool_call() {
    let file = include_str!("fixtures/codex-code-mode.jsonl");
    let p = page(file, None, 200, codex_events);
    let tools: Vec<&ToolCall> = p.items.iter().filter_map(|i| i.tool.as_ref()).collect();
    assert_eq!(tools.len(), 3);
    let cmd = "Set-Content -LiteralPath 'note-codex.txt' -Value 'hello' -Encoding ascii -ErrorAction Stop";
    // 거절된 호출 — 실시간 줄과 같은 `command` · 줄을 이은 명령 전체 · 거절 표지
    let joined = format!("{cmd} [System.IO.File]::ReadAllText((Resolve-Path 'note-codex.txt').Path) -ceq \"hello`r`n\"");
    assert_eq!(tools[0].name, "command");
    assert_eq!(tools[0].summary, format!("{}…", cap(&joined, SUMMARY_MAX_CHARS).0.trim_end()));
    assert!(tools[0].summary.contains("[System.IO.File]"), "첫 줄만이 아니라 둘째 줄까지");
    let input: Value = serde_json::from_str(tools[0].input.as_deref().unwrap()).unwrap();
    assert!(input["cmd"].as_str().unwrap().starts_with(cmd) && input["workdir"] == r"C:\repo", "{input}");
    assert!(!tools[0].input.as_deref().unwrap().contains("tools."), "JS 조각이 아니라 명령 글");
    assert!(tools[0].denied && tools[0].error);
    // 허용된 호출 — 안쪽 결과의 `output` 만
    assert_eq!((tools[1].name.as_str(), tools[1].summary.as_str()), ("command", tools[0].summary.as_str()));
    assert_eq!(tools[1].output.as_deref(), Some("True\r\n"));
    assert!(!tools[1].denied && !tools[1].error);
    // MCP — 완료 표지(`McpToolCall.server`)로 원래 서버 이름을 되찾는다 · 결과 글
    assert_eq!(tools[2].name, "mcp__aynx-sessions-dev__list_sessions");
    assert_eq!(tools[2].output.as_deref(), Some("[]"));
    // 끊긴 턴은 사람 말 뒤 표식 하나(부분 글은 롤아웃에 없다)
    let at = p.items.iter().position(|i| i.role == "interrupted").unwrap();
    assert_eq!(p.items[at - 1].role, "user");
    assert!(p.items[at - 1].text.as_deref().unwrap().contains("2000"));
}

#[test]
fn code_mode_calls_parse_only_a_single_literal_call() {
    let (n, v) = code_mode_call(r#"text(await tools.exec_command({cmd:"a \"b\"\nc",'workdir':`C:\\repo`, n: -1.5, ok: true, xs: [1, null,],}))"#).unwrap();
    assert_eq!(n, "exec_command");
    assert_eq!(v, json!({"cmd": "a \"b\"\nc", "workdir": "C:\\repo", "n": -1.5, "ok": true, "xs": [1, null]}));
    assert_eq!(code_mode_call("tools.list()").unwrap(), ("list".to_owned(), json!({})));
    assert_eq!(code_mode_call(r#"tools.apply_patch("*** Begin Patch\n")"#).unwrap().1, json!("*** Begin Patch\n"));
    assert_eq!(code_mode_call(r#"tools.x({a:"\u00e9\u{1F600}\x41"})"#).unwrap().1, json!({"a": "é😀A"}));
    for bad in [
        "ls",
        "tools.a({}); tools.b({})",
        "tools.a(cmd)",
        "tools.a({cmd: x})",
        "tools.a(`${x}`)",
        "tools.a({cmd: \"open",
        "tools.({})",
    ] {
        assert!(code_mode_call(bad).is_none(), "{bad}");
    }
    assert!(code_mode_result(&json!("plain")).is_none());
    assert!(code_mode_result(&json!([{"type": "input_text", "text": "other"}])).is_none());
    let bad_exit = json!([{"text": "Script completed\n"}, {"text": "{\"exit_code\":2,\"output\":\"nope\"}"}]);
    assert_eq!(code_mode_result(&bad_exit), Some(("nope".to_owned(), true, false)));
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
    assert_eq!(t.pending_input.as_deref(), Some("src/x.ts"), "묻는 도구의 입력 요약");
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

/// 채팅 타일의 첨부 꼬리(`with_file_refs` — `Attached file: <앱 첨부 자리>/<64hex>/<이름>`)는 두 CLI 모두 파일 칩으로 · 글에서 걷힌다.
/// 경로는 이 PC 의 실제 첨부 자리로 짓는다. 사이드 채팅 판정(`parse_file_refs` — `…/attachments/<이름>`)은 그대로다.
#[test]
fn chat_tile_attach_tails_become_file_chips() {
    use crate::side_chat::event::parse_file_refs;
    let root = crate::agent_attachments::attachments_root().unwrap();
    let hex = "ef".repeat(32);
    let memo = root.join(&hex).join("memo-heron.txt").to_string_lossy().into_owned();
    let ts = root.join(&hex).join("main (2).ts").to_string_lossy().into_owned();
    let tail = format!("이거 봐 줘\n\nAttached file: {memo}\nAttached file: {ts}");
    assert!(parse_file_refs(&tail).is_none(), "사이드 채팅 판정은 hex 폴더를 받지 않는다(그대로)");
    let claude = lines(&[
        c_user(json!(tail.clone()), json!({})),
        c_user(
            json!([{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": PNG_1X1}},
                   {"type": "text", "text": format!("Attached file: {memo}")}]),
            json!({}),
        ),
    ]);
    let p = page(&claude, None, 40, claude_events);
    let us: Vec<_> = p.items.iter().filter(|i| i.role == "user").collect();
    assert_eq!((us[0].text.as_deref(), us[0].files.clone()), (Some("이거 봐 줘"), vec!["memo-heron.txt".to_string(), "main (2).ts".to_string()]));
    assert_eq!((us[1].text.as_deref(), us[1].files.clone(), us[1].images), (Some(""), vec!["memo-heron.txt".to_string()], 1));
    let codex = lines(&[x_meta(), x_item(json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": tail.clone()}]}))]);
    let p = page(&codex, None, 40, codex_events);
    let u = p.items.iter().find(|i| i.role == "user").unwrap();
    assert_eq!((u.text.as_deref(), u.files.clone()), (Some("이거 봐 줘"), vec!["memo-heron.txt".to_string(), "main (2).ts".to_string()]));
    // 앱 첨부 자리 밖 · hex 가 아닌 폴더 · 가운데의 꼬리 · 한 단계 더 깊음은 글 그대로
    for t in [
        format!("봐\n\nAttached file: C:/elsewhere/{hex}/a.ts"),
        format!("봐\n\nAttached file: {}", root.join("notes").join("a.ts").to_string_lossy()),
        format!("Attached file: {memo}\n\n봐"),
        format!("봐\n\nAttached file: {}", root.join(&hex).join("sub").join("a.ts").to_string_lossy()),
    ] {
        let p = page(&lines(&[c_user(json!(t.clone()), json!({}))]), None, 40, claude_events);
        let u = p.items.iter().find(|i| i.role == "user").unwrap();
        assert!(u.files.is_empty() && u.text.as_deref() == Some(t.as_str()), "{t}");
    }
}

/// Codex 함수 호출 · 코드 모드의 `exec_command` 는 실시간 줄처럼 `command` · 줄을 이은 명령 — 다른 도구 이름은 그대로.
#[test]
fn codex_exec_command_reads_like_the_live_command_row() {
    let file = lines(&[
        x_meta(),
        x_item(json!({"type": "function_call", "name": "exec_command", "call_id": "c1", "arguments": "{\"cmd\":\"cd C:/repo\\ngit status\",\"workdir\":\"C:/repo\"}"})),
        x_item(json!({"type": "function_call", "name": "shell", "call_id": "c2", "arguments": "{\"command\":[\"bash\",\"-lc\",\"ls\\npwd\"]}"})),
    ]);
    let p = page(&file, None, 40, codex_events);
    let t: Vec<(&str, &str)> = p.items.iter().filter_map(|i| i.tool.as_ref()).map(|t| (t.name.as_str(), t.summary.as_str())).collect();
    assert_eq!(t, [("command", "cd C:/repo git status"), ("shell", "ls")]);
}

/// 코드 모드 MCP 이름 되돌리기 — 완료 표지가 호출 뒤에 와도 · 같은 alias 를 두 서버가 쓰면 되돌리지 않는다 · 표지가 없으면 그대로.
#[test]
fn codex_mcp_server_names_come_back_from_the_completion_marker() {
    let call = |id: &str, tool: &str| x_item(json!({"type": "custom_tool_call", "name": "exec", "call_id": id, "input": format!("text(await tools.{tool}({{}}))")}));
    let done = |server: &str| json!({"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "McpToolCall", "server": server, "tool": "t", "status": "completed"}}});
    let names = |file: &str| -> Vec<String> {
        page(file, None, 40, codex_events).items.iter().filter_map(|i| i.tool.as_ref()).map(|t| t.name.clone()).collect()
    };
    let one = lines(&[x_meta(), call("a", "mcp__my_db__query"), done("my-db"), call("b", "mcp__my_db__schema"), call("c", "mcp__other__x")]);
    assert_eq!(names(&one), ["mcp__my-db__query", "mcp__my-db__schema", "mcp__other__x"]);
    let clash = lines(&[x_meta(), call("a", "mcp__a_b__t"), done("a-b"), done("a.b"), call("b", "mcp__a_b__t")]);
    assert_eq!(names(&clash).last().map(String::as_str), Some("mcp__a_b__t"));
    let plain = lines(&[x_meta(), call("a", "mcp__srv__t"), done("srv")]);
    assert_eq!(names(&plain), ["mcp__srv__t"]);
}

/// Codex 계획 모드의 답(롤아웃에 `<proposed_plan>` 으로 감싼 assistant 글 — codex-cli 0.172 실측 꼴) — 글 전체가 그 한 쌍일 때만 꼬리표를 걷는다.
/// 일부만 감싼 글 · 꼬리표를 말하는 사람 글은 그대로다.
#[test]
fn codex_proposed_plan_wrapper_is_stripped_only_when_it_wraps_everything() {
    let file = include_str!("fixtures/codex-proposed-plan.jsonl");
    let p = page(file, None, 40, codex_events);
    assert_eq!(roles(&p), ["user", "assistant", "user", "assistant"]);
    let t = texts(&p);
    assert_eq!(
        t[1],
        "**Append `const c = 4;` to `main.ts`**\n\n1. Add `const c = 4;` on a new line after `const b = 3;`.\n2. Verify the final three declarations appear in order `a`, `b`, `c`."
    );
    assert_eq!(t[2], "What does <proposed_plan> mean?", "사람 글은 그대로");
    assert!(t[3].starts_with("Plan mode wraps") && t[3].contains("<proposed_plan>\n1. step\n</proposed_plan>"), "일부만 감싼 글은 그대로");
    // 꼬리표가 제 줄이 아니거나 · 두 쌍이거나 · 속이 비면 그대로
    for keep in [
        "<proposed_plan>inline</proposed_plan>",
        "<proposed_plan>\na\n</proposed_plan>\n<proposed_plan>\nb\n</proposed_plan>",
        "<proposed_plan>\n\n</proposed_plan>",
        "<proposed_plan>\nno end",
    ] {
        let one = lines(&[x_meta(), x_item(json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": keep}]}))]);
        assert_eq!(texts(&page(&one, None, 40, codex_events)), [keep], "{keep}");
    }
    let crlf = "\r\n<proposed_plan>\r\n1. a\r\n</proposed_plan>\r\n";
    let one = lines(&[x_meta(), x_item(json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": crlf}]}))]);
    assert_eq!(texts(&page(&one, None, 40, codex_events)), ["1. a"]);
}

/// 꼬리표를 걷은 글만 계획 표지를 단다 — 화면이 턴 뒤 · 다시 읽은 뒤에도 계획 덩어리로 그린다.
#[test]
fn codex_plan_text_keeps_a_plan_tag() {
    let p = page(include_str!("fixtures/codex-proposed-plan.jsonl"), None, 40, codex_events);
    let tagged: Vec<bool> = p.items.iter().map(|i| i.plan.is_some()).collect();
    assert_eq!(tagged, [false, true, false, false], "감싼 답만 · 사람 글 · 일부만 감싼 글은 아님");
    let j = serde_json::to_value(&p.items[1]).unwrap();
    assert_eq!(j["plan"], json!({}), "Codex 계획 표지는 빈 객체 — 본문은 text");
    assert!(serde_json::to_value(&p.items[0]).unwrap().get("plan").is_none(), "보통 줄에는 칸이 없다");
}

fn plan_items(p: &TranscriptPage) -> Vec<&TranscriptItem> {
    p.items.iter().filter(|i| i.tool.as_ref().is_some_and(|t| t.name == "ExitPlanMode")).collect()
}

/// Claude 2.1.332 실측(경로만 바꿈): 첫 `ExitPlanMode` 는 `input:{}` · 고친 계획의 호출은 `input.plan` 이 **앞 계획**(낡음)이다.
/// 본문은 승인 결과의 `toolUseResult.plan` · 그 앞 계획 파일 통째 쓰기에서만 — 호출 입력의 `plan` 은 쓰지 않는다.
#[test]
fn claude_plan_bodies_come_only_from_the_approved_result_or_the_last_full_write() {
    let p = page(include_str!("fixtures/claude-plan-turns.jsonl"), None, 200, claude_events);
    let plans = plan_items(&p);
    assert_eq!(plans.len(), 3);
    let tag = |i: usize| plans[i].plan.as_ref().expect("계획 표지");
    let head = |i: usize| tag(i).body.as_deref().map(|b| b.lines().next().unwrap_or("").to_owned());
    // 1) 거절 + 고칠 점 — 본문은 직전 Write(그때 카드에 보인 글)
    assert_eq!((tag(0).outcome, tag(0).feedback.as_deref(), head(0).as_deref()), (Some("kept"), Some("c 대신 d 로"), Some("# main.ts에 const c 추가")));
    // 2) 승인 — 호출 입력은 앞 계획(c)이지만 본문은 승인된 d
    assert!(plans[1].tool.as_ref().unwrap().input.as_deref().unwrap_or("").contains("const c 추가"), "픽스처: 호출 입력이 낡았다");
    assert_eq!((tag(1).outcome, tag(1).feedback.as_deref(), head(1).as_deref()), (Some("approved"), None, Some("# main.ts에 const d 추가")));
    // 3) 다음 턴 — 호출 입력은 d, 승인된 것은 e
    assert_eq!((tag(2).outcome, head(2).as_deref()), (Some("approved"), Some("# main.ts에 const e 추가")));
    for i in 0..3 {
        let f = tag(i).file.as_deref().unwrap_or("");
        assert!(f.ends_with(".md") && f.replace('\\', "/").contains("/.claude/plans/"), "{f}");
    }
    // 대화 면과 같은 파서 — 도구 줄 · 결과는 그대로
    assert!(plans.iter().all(|i| i.role == "tool" && i.tool.as_ref().unwrap().output.is_some()));
    assert!(plans[0].tool.as_ref().unwrap().denied);
}

#[test]
fn claude_plan_without_a_reliable_body_carries_only_the_file_and_outcome() {
    let f = "C:\\Users\\u\\.claude\\plans\\p.md";
    let deny = |id: &str, text: &str| {
        c_user(
            json!([{"type": "tool_result", "tool_use_id": id, "content": text, "is_error": true}]),
            json!({"permissionDecision": {"decision": "reject", "source": "user_reject"}}),
        )
    };
    // 쓰기 뒤 부분 고치기 → 파일 글을 모른다
    let edited = lines(&[
        c_tool("w1", "Write", json!({"file_path": f, "content": "# A"})),
        c_result("w1", json!("ok")),
        c_tool("e1", "Edit", json!({"file_path": f, "old_string": "A", "new_string": "B"})),
        c_result("e1", json!("ok")),
        c_tool("x1", "ExitPlanMode", json!({"plan": "# stale", "planFilePath": f})),
        deny("x1", crate::side_chat::claude::PLAN_KEEP),
    ]);
    let p = page(&edited, None, 40, claude_events);
    let t = plan_items(&p)[0].plan.as_ref().unwrap();
    assert_eq!((t.body.as_deref(), t.file.as_deref(), t.outcome, t.feedback.as_deref()), (None, Some(f), Some("kept"), None), "앱 기본 글은 고칠 점이 아니다");
    // 쓰기가 실패했거나 · 쪽에 없으면 본문 없음 · 결과 없는(기다리는) 호출은 결과 없음
    let failed = lines(&[
        c_tool("w1", "Write", json!({"file_path": f, "content": "# A"})),
        c_user(json!([{"type": "tool_result", "tool_use_id": "w1", "content": "denied", "is_error": true}]), json!({})),
        c_tool("x1", "ExitPlanMode", json!({})),
    ]);
    let p = page(&failed, None, 40, claude_events);
    let t = plan_items(&p)[0].plan.as_ref().unwrap();
    assert_eq!((t.body.as_deref(), t.file.as_deref(), t.outcome), (None, Some(f), None));
    let alone = lines(&[c_tool("x1", "ExitPlanMode", json!({"plan": "# stale"}))]);
    let p = page(&alone, None, 40, claude_events);
    let t = plan_items(&p)[0].plan.as_ref().unwrap();
    assert_eq!((t.body.as_deref(), t.file.as_deref()), (None, None), "입력의 plan 은 본문이 아니다");
    // 계획 파일이 아닌 쓰기는 경로를 대지 않는다
    let other = lines(&[
        c_tool("w1", "Write", json!({"file_path": "C:\\repo\\notes.md", "content": "# A"})),
        c_result("w1", json!("ok")),
        c_tool("x1", "ExitPlanMode", json!({})),
    ]);
    let p = page(&other, None, 40, claude_events);
    assert!(plan_items(&p)[0].plan.as_ref().unwrap().file.is_none());
}

/// codex-cli 0.172 실측(경로만 바꿈): 사람이 거절한 명령은 `exec` 가 "cell ID 7" 로 먼저 돌아오고 거절 글은 뒤의 `wait{cell_id:"7"}` 결과에 실린다.
#[test]
fn codex_wait_rows_do_not_steal_the_decline_of_the_command_they_wait_for() {
    let p = page(include_str!("fixtures/codex-wait-declined.jsonl"), None, 40, codex_events);
    let tools: Vec<(String, String, bool)> =
        p.items.iter().filter_map(|i| i.tool.as_ref()).map(|t| (t.name.clone(), t.summary.clone(), t.denied)).collect();
    assert_eq!(tools.len(), 2);
    assert_eq!((tools[0].0.as_str(), tools[0].2), ("command", true), "거절됨은 명령 줄에 — {:?}", tools[0].1);
    assert!(tools[0].1.starts_with("New-Item"));
    assert_eq!((tools[1].0.as_str(), tools[1].2), ("wait", false), "기다린 줄은 거절이 아니다");
    // 기다린 명령을 이 쪽에서 못 찾으면 예전 그대로(wait 줄에)
    let lone: String = include_str!("fixtures/codex-wait-declined.jsonl").lines().filter(|l| !l.contains("custom_tool_call")).map(|l| format!("{l}\n")).collect();
    let p = page(&lone, None, 40, codex_events);
    assert_eq!(p.items.iter().filter_map(|i| i.tool.as_ref()).map(|t| t.denied).collect::<Vec<_>>(), [true]);
}

// ---- 채팅 타일 되감기 — 기준점 · Claude 현재 갈래 · Codex 조각 잇기 ----

fn anchors(p: &TranscriptPage) -> Vec<(String, Option<String>)> {
    p.items.iter().filter(|i| i.role == "user").map(|i| (i.text.clone().unwrap_or_default(), i.anchor.clone())).collect()
}

fn user_texts(p: &TranscriptPage) -> Vec<String> {
    p.items.iter().filter(|i| i.role == "user").map(|i| i.text.clone().unwrap_or_default()).collect()
}

/// 기준점은 진짜 사람 말 줄의 `uuid` 뿐 — 도구 결과 · `isMeta` · 로컬 명령 · 압축 요약 · 끊김 표지 · `file-history-*` 줄에는 없다(직렬화에 칸째 없다).
#[test]
fn claude_records_carry_user_anchor() {
    let p = page(include_str!("fixtures/claude-anchor.jsonl"), None, 40, claude_events);
    assert_eq!(
        anchors(&p),
        [
            ("fix the build".to_string(), Some("aaaaaaa1-0000-4000-8000-000000000001".to_string())),
            ("<command-name>/compact</command-name>\n<command-message>compact</command-message>".to_string(), None),
            ("second ask".to_string(), Some("aaaaaaa7-0000-4000-8000-000000000007".to_string())),
            ("no uuid here".to_string(), None),
        ]
    );
    for it in p.items.iter().filter(|i| i.role != "user" || i.anchor.is_none()) {
        assert!(serde_json::to_value(it).unwrap().get("anchor").is_none(), "{}", it.role);
    }
    let v = serde_json::to_value(&p.items[0]).unwrap();
    assert_eq!(v["anchor"], "aaaaaaa1-0000-4000-8000-000000000001");
}

/// Codex 기준점 = 사람 말 `response_item` 의 `internal_chat_message_metadata_passthrough.turn_id` · 없으면 바로 뒤 `item_completed{UserMessage}.turn_id` ·
/// 주입 몫 · 다른 사람 말이 끼면 붙지 않는다.
#[test]
fn codex_records_carry_turn_anchor() {
    let (t1, t2, t3) = ("01a30000-0001-7000-8000-000000000001", "01a30000-0002-7000-8000-000000000002", "01a30000-0003-7000-8000-000000000003");
    let user = |text: &str, turn: Option<&str>| {
        let mut p = json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]});
        if let Some(t) = turn {
            p["internal_chat_message_metadata_passthrough"] = json!({"turn_id": t});
        }
        x_item(p)
    };
    let done = |turn: &str| json!({"type": "event_msg", "payload": {"type": "item_completed", "turn_id": turn, "item": {"type": "UserMessage", "content": []}}});
    let asst = |text: &str| x_item(json!({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}));
    let file = lines(&[
        x_meta(),
        user("<environment_context>x</environment_context>", Some(t1)),
        user("first", Some(t1)),
        done(t1),
        asst("a1"),
        user("second", None),
        done(t2),
        asst("a2"),
        user("third", None),
        asst("a3"),
        done(t3),
    ]);
    let p = page(&file, None, 40, codex_events);
    assert_eq!(
        anchors(&p),
        [("first".to_string(), Some(t1.to_string())), ("second".to_string(), Some(t2.to_string())), ("third".to_string(), None)],
        "주입 몫은 항목이 없다 · 늦은 기준점은 바로 앞 사람 말에만"
    );
    // 늦은 기준점만 든 줄은 쪽을 끊지 않는다 — 커서가 그 줄이 없을 때와 같다
    let without: String = file.lines().filter(|l| !l.contains("UserMessage")).map(|l| format!("{l}\n")).collect();
    let a = page(&file, None, 2, codex_events);
    let b = page(&without, None, 2, codex_events);
    assert_eq!(texts(&a), texts(&b));
}

/// 오케스트레이션 조정자의 판독(`page_of_file`)에는 기준점이 없다.
#[test]
fn read_worker_strips_anchor() {
    let dir = temp_dir("rw-anchor");
    for (name, body, parse) in [
        ("c.jsonl", include_str!("fixtures/claude-anchor.jsonl"), claude_events as LineEvents),
        ("x.jsonl", include_str!("fixtures/codex-revert-base.jsonl"), codex_events as LineEvents),
    ] {
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        let full = page(body, None, 40, parse);
        assert!(full.items.iter().any(|i| i.anchor.is_some()), "{name}: 화면 쪽에는 있다");
        let p = page_of_file(std::fs::File::open(&path).unwrap(), None, Some(40), parse).unwrap();
        assert_eq!(p.items.len(), full.items.len());
        assert!(p.items.iter().all(|i| i.anchor.is_none()), "{name}");
        assert!(!serde_json::to_string(&p).unwrap().contains("\"anchor\""), "{name}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

fn claude_file_page(path: &Path, limit: usize) -> TranscriptPage {
    let cut = claude_cut(path);
    let size = std::fs::metadata(path).unwrap().len();
    read_page_in(std::fs::File::open(path).unwrap(), size, None, limit, claude_events, &cut).unwrap()
}

/// 되감은 적 없는 기록은 갈래 읽기가 한 글자도 바꾸지 않는다 — 지금 있는 기록 재료 전부(쪽 · 커서 · 직렬화).
#[test]
fn branch_reader_leaves_unrewound_records_alone() {
    let dir = temp_dir("branch-same");
    let fixtures: [(&str, &str); 6] = [
        ("claude-plan-turns.jsonl", include_str!("fixtures/claude-plan-turns.jsonl")),
        ("claude-anchor.jsonl", include_str!("fixtures/claude-anchor.jsonl")),
        ("codex-code-mode.jsonl", include_str!("fixtures/codex-code-mode.jsonl")),
        ("codex-proposed-plan.jsonl", include_str!("fixtures/codex-proposed-plan.jsonl")),
        ("codex-wait-declined.jsonl", include_str!("fixtures/codex-wait-declined.jsonl")),
        ("codex-revert-base.jsonl", include_str!("fixtures/codex-revert-base.jsonl")),
    ];
    for (name, body) in fixtures {
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        assert!(claude_cut(&path).is_empty(), "{name}");
        for parse in [claude_events as LineEvents, codex_events as LineEvents] {
            for limit in [3, 40, 200] {
                let mut before = None;
                loop {
                    let plain = page(body, before, limit, parse);
                    let size = body.len() as u64;
                    let cut = claude_cut(&path);
                    let read = read_page_in(std::fs::File::open(&path).unwrap(), size, before, limit, parse, &cut).unwrap();
                    assert_eq!(serde_json::to_string(&read).unwrap(), serde_json::to_string(&plain).unwrap(), "{name} {limit} {before:?}");
                    match plain.cursor {
                        Some(c) => before = Some(c),
                        None => break,
                    }
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// 실측 기록(개인 경로 걷음 · 본문 줄임)에서 현재 갈래만 — 되감은 메시지와 그 뒤 버린 갈래는 빠지고, 되감은 뒤 이어진 말 · 압축 경계 너머는 남는다.
#[test]
fn claude_rewound_records_follow_the_current_branch() {
    let dir = temp_dir("branch");
    let starts = |p: &TranscriptPage| -> Vec<String> { user_texts(p).iter().map(|t| t.chars().take(24).collect()).collect() };
    // 한 번 되감고(cherry) 이어 감 · 압축 뒤까지
    let path = dir.join("continued.jsonl");
    std::fs::write(&path, include_str!("fixtures/claude-rewind-continued.jsonl")).unwrap();
    let p = claude_file_page(&path, 200);
    let users = starts(&p);
    assert!(!users.iter().any(|t| t.contains("cherry")), "{users:?}");
    assert_eq!(users.iter().filter(|t| t.starts_with("Remember the word")).count(), 3, "apple · banana · dates: {users:?}");
    assert_eq!(users.last().map(String::as_str), Some("Without using tools: whi"));
    // 쪽을 나눠 읽어도 같다
    let mut got = Vec::new();
    let mut before = None;
    loop {
        let size = std::fs::metadata(&path).unwrap().len();
        let q = read_page_in(std::fs::File::open(&path).unwrap(), size, before, 3, claude_events, &claude_cut(&path)).unwrap();
        let mut t = starts(&q);
        t.append(&mut got);
        got = t;
        match q.cursor {
            Some(c) => before = Some(c),
            None => break,
        }
    }
    assert_eq!(got, users);
    // 두 번 되감음 — 둘째는 첫 메시지 기준(잎 없음)이라 앞 대화가 모두 빠진다
    let path = dir.join("twice.jsonl");
    std::fs::write(&path, include_str!("fixtures/claude-rewind-twice.jsonl")).unwrap();
    let p = claude_file_page(&path, 200);
    assert_eq!(starts(&p), ["Without using tools: whi"]);
    assert!(p.items.iter().any(|i| i.role == "assistant"), "되감은 뒤의 답은 남는다");
    // resume 한 프로세스에서 턴 없이 되감음(cherry → banana)
    let path = dir.join("resumed.jsonl");
    std::fs::write(&path, include_str!("fixtures/claude-rewind-resumed.jsonl")).unwrap();
    let p = claude_file_page(&path, 200);
    assert_eq!(starts(&p), ["Remember the word apple.", "Without using tools: whi"]);
    // 되감기 판정 — 버린 갈래의 사람 줄은 기준점이 아니다 · 마지막 사람 말은 현재 갈래의 것
    let kept: Vec<String> = p.items.iter().filter_map(|i| i.anchor.clone()).collect();
    assert_eq!(kept.len(), 2);
    let point = |a: &str| claude_rewind_point(&path, a).map(|p| p.last_seen);
    assert_eq!(point(&kept[0]), Some(kept[1].clone()));
    assert_eq!(point(&kept[1]), Some(kept[1].clone()));
    let body = include_str!("fixtures/claude-rewind-resumed.jsonl");
    let gone: Vec<String> = page(body, None, 200, claude_events).items.into_iter().filter_map(|i| i.anchor).filter(|a| !kept.contains(a)).collect();
    assert!(!gone.is_empty(), "줄 순서로 읽으면 버린 갈래도 보인다");
    for g in &gone {
        assert_eq!(point(g), None, "버린 갈래");
    }
    assert_eq!(point("aaaaaaa1-0000-4000-8000-000000000001"), None, "없는 줄");
    // 표지 없이 끊긴 사슬 · 없는 cutUuid 는 줄 순서 그대로
    let broken: String = body.lines().map(|l| l.replace("\"rewound\":true", "\"rewound\":false")).map(|l| format!("{l}\n")).collect();
    std::fs::write(&path, &broken).unwrap();
    assert_eq!(texts(&claude_file_page(&path, 200)), texts(&page(&broken, None, 200, claude_events)));
    let unknown: String = body.lines().map(|l| if l.contains("\"cutUuid\"") { cut_to_unknown(l) } else { l.to_string() }).map(|l| format!("{l}\n")).collect();
    std::fs::write(&path, &unknown).unwrap();
    assert_eq!(texts(&claude_file_page(&path, 200)), texts(&page(&unknown, None, 200, claude_events)));
    // 파일이 자라면 늘어난 꼬리만 본다 — 표지가 새로 생기면 다시 판다
    let path = dir.join("grow.jsonl");
    let plain = include_str!("fixtures/claude-anchor.jsonl");
    std::fs::write(&path, plain).unwrap();
    assert!(claude_cut(&path).is_empty());
    // 되감기 op 가 먼저 읽어 "표지 없음" 을 기억한 뒤 CLI 가 표지를 덧붙인다 — 기억이 늦은 답을 내면 안 된다
    let from = plain.len() as u64;
    assert!(claude_rewind_point(&path, "aaaaaaa7-0000-4000-8000-000000000007").is_some());
    assert!(!claude_marked_since(&path, from));
    let mark = json!({"type": "last-prompt", "leafUuid": null, "rewound": true, "cutUuid": "aaaaaaa7-0000-4000-8000-000000000007"});
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "{mark}").unwrap();
    }
    assert!(claude_marked_since(&path, from));
    assert!(!claude_marked_since(&path, std::fs::metadata(&path).unwrap().len()), "그 뒤에는 새 표지가 없다");
    assert_eq!(claude_rewind_point(&path, "aaaaaaa7-0000-4000-8000-000000000007"), None, "잘린 기준점");
    let cut = claude_cut(&path);
    assert!(cut.contains("aaaaaaa7-0000-4000-8000-000000000007") && cut.contains("bbbbbbb2-0000-4000-8000-000000000002"), "그 메시지와 뒤 답");
    assert!(!cut.contains("aaaaaaa1-0000-4000-8000-000000000001"));
    assert_eq!(user_texts(&claude_file_page(&path, 40)).iter().filter(|t| *t == "second ask").count(), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 압축 경계 앞의 기준점 — 현재 갈래의 경계가 기준점 뒤에 있으면 `before_compact`(막지는 않는다 — 같은 프로세스는 받는다).
#[test]
fn claude_rewind_point_knows_the_compact_boundary() {
    let dir = temp_dir("rw-compact");
    let path = dir.join("continued.jsonl");
    std::fs::write(&path, include_str!("fixtures/claude-rewind-continued.jsonl")).unwrap();
    let anchors: Vec<String> = claude_file_page(&path, 200).items.iter().filter_map(|i| i.anchor.clone()).collect();
    assert!(anchors.len() >= 2, "{anchors:?}");
    let first = claude_rewind_point(&path, &anchors[0]).unwrap();
    assert!(first.before_compact, "경계 앞");
    let last = claude_rewind_point(&path, anchors.last().unwrap()).unwrap();
    assert!(!last.before_compact, "경계 뒤");
    assert_eq!(first.last_seen, last.last_seen);
    // 경계가 없는 기록
    let path = dir.join("plain.jsonl");
    std::fs::write(&path, include_str!("fixtures/claude-anchor.jsonl")).unwrap();
    assert!(!claude_rewind_point(&path, "aaaaaaa1-0000-4000-8000-000000000001").unwrap().before_compact);
    let _ = std::fs::remove_dir_all(&dir);
}

fn cut_to_unknown(l: &str) -> String {
    let mut v: Value = serde_json::from_str(l).unwrap();
    v["cutUuid"] = json!("deadbeef-0000-4000-8000-000000000000");
    v.to_string()
}

const XB: &str = "01a30000-0000-7000-8000-00000000000b";

/// 기준 재료의 앞 `n` 턴이 끝나는 바이트(그 턴 답 줄 끝).
fn base_cut(after: &str) -> u64 {
    let base = include_str!("fixtures/codex-revert-base.jsonl");
    let at = base.find(&format!("\"text\":\"{after}\"")).unwrap();
    (at + base[at..].find('\n').unwrap() + 1) as u64
}

/// 조각 재료 — 새 사람 말 · 턴 id · 조각이 가리키는 파일 id · 바이트.
fn seg(text: &str, turn: &str, thread: &str, offset: u64) -> String {
    let body = include_str!("fixtures/codex-revert-seg.jsonl").replace("\"NEW", &format!("\"{text}")).replace("01a30000-0006-7000-8000-000000000006", turn);
    let mut ls: Vec<Value> = body.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    ls[0]["payload"]["history_base"]["thread_id"] = json!(thread);
    ls[0]["payload"]["history_base"]["end_byte_offset"] = json!(offset);
    lines(&ls)
}

fn codex_day(tag: &str) -> (PathBuf, PathBuf) {
    let dir = temp_dir(tag);
    let root = dir.join("sessions");
    let day = root.join("2026").join("11").join("28");
    std::fs::create_dir_all(&day).unwrap();
    std::fs::write(day.join(format!("rollout-2026-11-28T01-00-00-{XB}.jsonl")), include_str!("fixtures/codex-revert-base.jsonl")).unwrap();
    (dir, root)
}

fn codex_all(root: &Path, limit: usize) -> (Vec<String>, TranscriptPage) {
    let codex = crate::agent_sessions::target("codex").unwrap();
    let roots = vec![root.to_path_buf()];
    let first = transcript_in(codex, &roots, XB, None, Some(200)).unwrap();
    let mut got = Vec::new();
    let mut before = None;
    loop {
        let p = transcript_in(codex, &roots, XB, before, Some(limit)).unwrap();
        let mut t = texts(&p);
        t.append(&mut got);
        got = t;
        match p.cursor {
            Some(c) => before = Some(c),
            None => break,
        }
    }
    assert_eq!(got, texts(&first), "쪽을 나눠 거꾸로 읽어도 같다");
    (user_texts(&first), first)
}

/// 되감은 Codex 대화 — 조각의 `history_base.thread_id` 를 **파일 이름의 id**(원본 = 대화 id · 조각 = 꼬리 `_<id>`)와 맞춰 앞 파일의 앞부분을 잇는다.
/// 원본을 가리킴 · 앞 조각을 가리킴(두 번 되감음) · 줄 경계가 아니거나 모자라면 그 조각만 · 그림 자리는 가상 흐름의 자리.
#[test]
fn codex_reverted_thread_reads_history_base() {
    let (s1, s2) = ("01a30000-00a1-7000-8000-0000000000a1", "01a30000-00a2-7000-8000-0000000000a2");
    let (t6, t7) = ("01a30000-0006-7000-8000-000000000006", "01a30000-0007-7000-8000-000000000007");
    // 되감기 전 — 원본 하나 그대로
    let (dir, root) = codex_day("seg-none");
    let (users, _) = codex_all(&root, 2);
    assert_eq!(users, ["one", "two", "three", "four", "five"]);
    let _ = std::fs::remove_dir_all(&dir);

    // 원본을 가리키는 조각 — 앞 세 턴 + 새 턴
    let (dir, root) = codex_day("seg-orig");
    let day = root.join("2026").join("11").join("28");
    let seg1 = day.join(format!("rollout-2026-11-28T01-01-00-{XB}_{s1}.jsonl"));
    std::fs::write(&seg1, seg("six", t6, XB, base_cut("three-done"))).unwrap();
    let (users, first) = codex_all(&root, 2);
    assert_eq!(users, ["one", "two", "three", "six"], "빠진 턴 없음");
    assert_eq!(first.items.iter().rfind(|i| i.role == "user").and_then(|i| i.anchor.as_deref()), Some(t6));
    // 그림 — 원본 첫 말의 그림을 가상 자리로 다시 꺼낸다
    let codex = crate::agent_sessions::target("codex").unwrap();
    let roots = vec![root.clone()];
    let pic = first.items.iter().find(|i| !i.pictures.is_empty()).unwrap().pictures[0].clone();
    let png = data_encoding::BASE64.decode(PNG_1X1.as_bytes()).unwrap();
    assert_eq!(image_in(source_of(codex, &roots, XB).unwrap(), pic.at, pic.len, pic.n).unwrap(), png);

    // 앞 조각을 가리키는 둘째 조각 — 원본 앞 세 턴 + 첫 조각의 앞(새 턴 전) + 새 턴
    let seg1_body = std::fs::read_to_string(&seg1).unwrap();
    let before_six = seg1_body.find("\"text\":\"six\"").map(|at| seg1_body[..at].rfind('\n').unwrap() + 1).unwrap() as u64;
    let seg2 = day.join(format!("rollout-2026-11-28T01-02-00-{XB}_{s2}.jsonl"));
    std::fs::write(&seg2, seg("seven", t7, s1, before_six)).unwrap();
    let (users, _) = codex_all(&root, 3);
    assert_eq!(users, ["one", "two", "three", "seven"], "두 번 되감음");
    // 압축 뒤처럼 앞 조각을 건너 원본을 가리켜도 된다
    std::fs::write(&seg2, seg("seven", t7, XB, base_cut("one-done"))).unwrap();
    assert_eq!(codex_all(&root, 3).0, ["one", "seven"]);

    // 줄 경계가 아니면 · 대상이 모자라면 · 가리키는 파일이 없으면 그 조각만
    for (thread, off) in [(XB, base_cut("three-done") - 2), (XB, 10_000_000), ("01a30000-ffff-7000-8000-00000000ffff", base_cut("two-done"))] {
        std::fs::write(&seg2, seg("seven", t7, thread, off)).unwrap();
        assert_eq!(codex_all(&root, 3).0, ["seven"], "{thread} {off}");
    }
    let _ = std::fs::remove_dir_all(&dir);

    // 이름 판정 — 조각 꼬리 · 원본 · 다른 대화
    let p = PathBuf::from(format!("C:/x/rollout-2026-11-28T01-01-00-{XB}_{s1}.jsonl"));
    assert_eq!(file_thread_id(&p, XB).as_deref(), Some(s1));
    assert_eq!(file_thread_id(&PathBuf::from(format!("C:/x/rollout-2026-11-28T01-00-00-{XB}.jsonl")), XB).as_deref(), Some(XB));
    assert_eq!(file_thread_id(&PathBuf::from("C:/x/rollout-2026-11-28T01-00-00-other.jsonl"), XB), None);
}
