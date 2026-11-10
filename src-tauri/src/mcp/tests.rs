use super::*;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::context::{
    mark_delegated_disconnected, push_block, report, report_delegated, update, LastCommand,
};
use crate::context::{
    CommandBlockMirror, SessionContext, Store, HISTORY_DEFAULT, SCROLLBACK_DEFAULT,
};
use crate::operations::{self, OperationStore, ResultStore};
use crate::ssh_config::ConfigIndex;
use crate::tile_env::base_url;
use crate::tile_env::{MCP_TOKEN_ENV, MCP_URL_ENV, SIGNAL_TOKEN_ENV, STREAM_ENV};

/// 이력 블록 하나 — `running` 이면 아직 안 끝난 것으로 만든다.
fn block(id: i64, line: &str, running: bool) -> CommandBlockMirror {
    CommandBlockMirror {
        id,
        command_line: line.to_string(),
        cwd: Some("/srv/app".to_string()),
        started_at: 1_000 + id,
        ended_at: if running { None } else { Some(2_000 + id) },
        exit: if running { None } else { Some(0) },
        running,
        excerpt_head: vec![format!("{line} head")],
        excerpt_tail: vec![format!("{line} tail")],
        truncated: false,
        capture: "complete".to_string(),
    }
}

fn store_with_samples() -> HashMap<String, SessionContext> {
    let mut m = HashMap::new();
    // `code` 는 프런트가 넘겨 주는 표시용 손잡이 — 여기선 `list_sessions` 가 그대로 내는지
    // 볼 수 있게 대표 값 하나를 넣어 둔다 (id=키 와 갈라진 별개 필드다).
    report(
        &mut m,
        "w:1".into(),
        "web-01".into(),
        "ssh".into(),
        "p2".into(),
        true,
    );
    // 이력 세 건 — 오래된 것부터 들어간다(도구는 최신순으로 내보낸다).
    push_block(&mut m, "w:1", block(1, "ls", false));
    push_block(&mut m, "w:1", block(2, "npm run build", false));
    push_block(&mut m, "w:1", block(3, "tail -f app.log", true));
    update(
        &mut m,
        "w:1",
        Some("fail".into()),
        Some(LastCommand {
            command_line: "systemctl status nginx".into(),
            output: "inactive (dead)".into(),
            exit: Some(3),
            running: false,
        }),
        vec!["line1".into(), "line2".into(), "line3".into()],
    );
    // 옵트아웃 세션 — 도구에 절대 보이면 안 된다.
    report(
        &mut m,
        "w:2".into(),
        "prod-db".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    m
}

// ---- 인증 ----

#[test]
fn authorization_requires_exact_bearer_token() {
    assert!(authorized(Some("Bearer abc123"), "abc123"));
    assert!(authorized(Some("Bearer  abc123  "), "abc123")); // 공백은 trim
    assert!(!authorized(Some("Bearer wrong"), "abc123"));
    assert!(!authorized(Some("abc123"), "abc123")); // 접두사 없음
    assert!(!authorized(Some("Basic abc123"), "abc123"));
    assert!(!authorized(None, "abc123"));
}

/// 빈 토큰은 무엇으로도 열리지 않는다 — F5 로 토큰 없이 도는 상태가 생겼을 때의 그물.
#[test]
fn empty_token_authorizes_nothing() {
    assert!(!authorized(Some("Bearer "), ""));
    assert!(!authorized(Some("Bearer x"), ""));
    assert!(!authorized(None, ""));
}

// ---- 출처 확인 (F4) ----

#[test]
fn local_origin_only_accepts_our_loopback_host() {
    let port = 58599;
    assert!(local_origin_ok(Some("127.0.0.1:58599"), None, port));
    assert!(local_origin_ok(Some("localhost:58599"), None, port));
    assert!(local_origin_ok(Some("LOCALHOST:58599"), None, port)); // 호스트는 대소문자 무시
    assert!(local_origin_ok(Some("  127.0.0.1:58599  "), None, port)); // 앞뒤 공백

    assert!(!local_origin_ok(Some("127.0.0.1:1234"), None, port)); // 다른 포트
    assert!(!local_origin_ok(Some("evil.com"), None, port));
    assert!(!local_origin_ok(Some("evil.com:58599"), None, port)); // DNS 리바인딩
    assert!(!local_origin_ok(Some("127.0.0.1"), None, port)); // 포트 없음
    assert!(!local_origin_ok(None, None, port));

    // Origin 이 붙었다 = 브라우저다. 값이 우리 URL 이어도 거부한다.
    assert!(!local_origin_ok(
        Some("127.0.0.1:58599"),
        Some("http://127.0.0.1:58599"),
        port
    ));
    assert!(!local_origin_ok(
        Some("127.0.0.1:58599"),
        Some("null"),
        port
    ));
}

// ---- 활동 도장 (상태바 `✦ AI 연결`) ----

#[test]
fn activity_stamps_only_the_three_methods_we_answer() {
    assert_eq!(
        activity_of(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#, 7),
        Some(McpActivity {
            client: None,
            at_ms: 7
        })
    );
    assert_eq!(
        activity_of(
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_sessions"}}"#,
            8
        ),
        Some(McpActivity {
            client: None,
            at_ms: 8
        })
    );
    // 알림·모르는 메서드·깨진 본문은 도장을 찍지 않는다.
    assert_eq!(
        activity_of(
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            9
        ),
        None
    );
    assert_eq!(
        activity_of(r#"{"jsonrpc":"2.0","id":9,"method":"no/such"}"#, 9),
        None
    );
    assert_eq!(activity_of("not json", 9), None);
    assert_eq!(activity_of(r#"{"id":1}"#, 9), None);
}

#[test]
fn activity_takes_the_client_name_from_initialize_only() {
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"claude","version":"1.2"}}}"#;
    assert_eq!(
        activity_of(body, 100),
        Some(McpActivity {
            client: Some("claude".into()),
            at_ms: 100
        })
    );
    // 이름이 없거나 빈 문자열이면 "모른다" 다 — 화면이 빈 괄호를 그리지 않게.
    assert_eq!(
        activity_of(r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#, 100),
        Some(McpActivity {
            client: None,
            at_ms: 100
        })
    );
    assert_eq!(
        activity_of(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"  "}}}"#,
            100
        ),
        Some(McpActivity {
            client: None,
            at_ms: 100
        })
    );
}

#[test]
fn merging_keeps_the_remembered_client_but_always_moves_the_clock() {
    let first = merge_activity(
        None,
        McpActivity {
            client: Some("claude".into()),
            at_ms: 10,
        },
    );
    assert_eq!(
        first,
        McpActivity {
            client: Some("claude".into()),
            at_ms: 10
        }
    );

    // 이름 없는 요청이 뒤따라도 이름은 살아남고 시각만 간다.
    let second = merge_activity(
        Some(&first),
        McpActivity {
            client: None,
            at_ms: 20,
        },
    );
    assert_eq!(
        second,
        McpActivity {
            client: Some("claude".into()),
            at_ms: 20
        }
    );

    // 다른 클라이언트가 `initialize` 를 다시 보내면 마지막에 쓴 쪽이 이긴다.
    let third = merge_activity(
        Some(&second),
        McpActivity {
            client: Some("codex".into()),
            at_ms: 30,
        },
    );
    assert_eq!(
        third,
        McpActivity {
            client: Some("codex".into()),
            at_ms: 30
        }
    );
}

// ---- JSON-RPC 디스패치 ----

fn parse_json(reply: RpcReply) -> Value {
    match reply {
        RpcReply::Json(s) => serde_json::from_str(&s).unwrap(),
        RpcReply::Accepted => panic!("결과를 기대했는데 202(알림)였다"),
    }
}

/// 읽기 전용 테스트용 dispatch — 빈 작업안 저장소·우편함을 매번 새로 붙여 준다(읽기 도구는
/// 둘을 건드리지 않으므로 매 호출 새로 만들어도 무해하다). 작업안 도구 테스트는 저장소를
/// 재사용해야 해서 [`dispatch`] 를 직접 부른다.
fn dispatch_t(m: &HashMap<String, SessionContext>, body: &str) -> RpcReply {
    let ops: OperationStore = Default::default();
    let results: ResultStore = Default::default();
    let signal = McpSignal::default();
    let (m, delegation) = emulate_app(m);
    dispatch_with(&store_of(&m), &ops, &results, &signal, body, || delegation)
}

/// 테스트의 맵 하나를 진짜 [`Store`](잠금 달린 것)로 감싼다 — `dispatch` 가 2026-09-22 부터
/// **잠그지 않은** 저장소를 받는다(잠금은 `tools_call` 안쪽, `wait_for_operation` 은 그
/// 앞에서 갈라진다). 테스트 맵은 작아서 복제가 무해하다.
fn store_of(m: &HashMap<String, SessionContext>) -> Store {
    Arc::new(Mutex::new(m.clone()))
}

/// **디스패치 테스트의 AI 권한 하네스** — 실제 `delegation.toml` 에 기대지 않고, 앱이 하는 일을 흉내 낸다
/// (2026-10-07 호스트 하나 = AI 권한 하나).
///
/// 앱에서는 프런트가 원격 타일의 `opted_in` 을 **호스트 단계(read 이상)** 로 비춰 보낸다. 그래서 이
/// 하네스는 별칭이 비어 있는 원격 창 타일에 **자기 키를 별칭으로** 달고, `opted_in` 인 원격 타일의
/// 별칭에는 'Ask'(read+propose)를, 접속 때 `read` 가 있던 헤드리스 세션의 별칭에는 '읽기
/// 전용'(read)을 준다 — 예전 판정(창=`opted_in`·헤드리스=`delegation_read`)으로 쓴 테스트가 그대로 뜻을
/// 지닌다. 별칭이 이미 있는 타일은 건드리지 않는다(그 테스트는 권한을 직접 짠다 — [`dispatch_d`]).
/// 별칭 없는 원격 타일·로컬 타일의 규칙은 순수 판정 테스트(`context/tests.rs`)가 본다.
fn emulate_app(
    m: &HashMap<String, SessionContext>,
) -> (HashMap<String, SessionContext>, crate::delegation::Delegation) {
    use crate::session_owner::SessionOwnerKind;
    let mut m = m.clone();
    let mut toml = String::new();
    let mut grant = |alias: &str, propose: bool| {
        toml.push_str(&format!(
            "[[target]]\nalias = {alias:?}\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\npropose = {propose}\n\n"
        ));
    };
    for (key, c) in m.iter_mut() {
        match c.owner_kind {
            SessionOwnerKind::Window if c.kind == "ssh" => {
                let alias = c.host_alias.get_or_insert_with(|| key.clone()).clone();
                if c.opted_in && alias == *key {
                    grant(&alias, true);
                }
            }
            SessionOwnerKind::Window => {}
            SessionOwnerKind::Delegated => {
                if c.delegation_read {
                    grant(&c.label, false);
                }
            }
        }
    }
    let delegation = crate::delegation::Delegation::parse(&toml).expect("하네스 위임");
    (m, delegation)
}

/// 권한을 **직접 짠** 디스패치 — 하네스([`emulate_app`])를 거치지 않는다.
fn dispatch_d(
    m: &HashMap<String, SessionContext>,
    delegation: crate::delegation::Delegation,
    body: &str,
) -> RpcReply {
    let ops: OperationStore = Default::default();
    let results: ResultStore = Default::default();
    let signal = McpSignal::default();
    dispatch_with(&store_of(m), &ops, &results, &signal, body, || delegation)
}

/// 작업안 도구 테스트용 — 그 도구들은 결과 저장소를 쓰지 않으므로 throwaway 를 끼워 준다
/// (테스트가 `ops` 를 여러 dispatch 에 걸쳐 공유하므로 그건 밖에서 넘긴다).
fn dispatch_o(
    m: &HashMap<String, SessionContext>,
    ops: &OperationStore,
    signal: &McpSignal,
    body: &str,
) -> RpcReply {
    let results: ResultStore = Default::default();
    let (m, delegation) = emulate_app(m);
    dispatch_with(&store_of(&m), ops, &results, signal, body, || delegation)
}

#[test]
fn initialize_returns_protocol_and_server_info() {
    let m = store_with_samples();
    let v = parse_json(dispatch_t(
        &m,
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#,
    ));
    assert_eq!(v["id"], 1);
    assert_eq!(v["result"]["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(v["result"]["serverInfo"]["name"], MCP_NAME);
    assert!(v["result"]["capabilities"]["tools"].is_object());
    // 핸드셰이크 안내 — 읽기·계획 전용이고 실행은 사용자만, 그리고 잠깐 기다렸다 넘기라는 요점.
    let instr = v["result"]["instructions"]
        .as_str()
        .expect("instructions 문자열");
    assert!(instr.contains("read-and-plan-only"), "{instr}");
    assert!(instr.contains("get_operation_results"), "{instr}");
    // 기다림은 **롱폴 도구 하나**로 접혔다(2026-09-22) — 루프 폴링을 시키던 문장은 사라졌다.
    assert!(instr.contains("wait_for_operation"), "{instr}");
    assert!(!instr.contains("keep polling"), "{instr}");
    assert!(
        !instr.contains("poll get_operation every few seconds"),
        "{instr}"
    );
    // 그리고 **턴을 넘기라**고 말한다 — 앱이 승인 즉시 알아서 돌리므로 지키고 있을 이유가 없다.
    assert!(instr.contains("end your turn"), "{instr}");
    assert!(instr.contains("5 minutes"), "{instr}");
    // 만료를 말한다 — 얼마나 기다릴지와, 만료되면 조용히 다시 올리지 말라는 것.
    assert!(instr.contains("expiresAt"), "{instr}");
    // 자동 승인 범위 안내(2026-09-16) — 범위를 읽는 도구·cwd 권고를 핸드셰이크에서 말한다.
    assert!(instr.contains("get_auto_approval_policy"), "{instr}");
    assert!(instr.contains("cwd"), "{instr}");
}

#[test]
fn initialized_notification_yields_accepted() {
    let m = store_with_samples();
    // id 없음 = 알림 → 202.
    assert_eq!(
        dispatch_t(
            &m,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
        ),
        RpcReply::Accepted
    );
}

#[test]
fn tools_list_has_all_tools_with_schemas() {
    let m = store_with_samples();
    let v = parse_json(dispatch_t(
        &m,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
    ));
    let tools = v["result"]["tools"].as_array().unwrap();
    // 읽기 7 + 단계 8 작업안 3 + 검토 대기 롱폴 1 + 단계 9 결과 읽기 1 + 자동 승인 정책 읽기 1 = 13.
    // 전부 읽기/계획이다(실행 0).
    assert_eq!(tools.len(), 13);
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"list_sessions"));
    assert!(names.contains(&"get_last_command"));
    assert!(names.contains(&"get_scrollback"));
    assert!(names.contains(&"list_commands"));
    assert!(names.contains(&"get_command"));
    assert!(names.contains(&"get_session_snapshot"));
    assert!(names.contains(&"compare_command_results"));
    assert!(names.contains(&"create_execution_plan"));
    assert!(names.contains(&"request_execution"));
    assert!(names.contains(&"get_operation"));
    // 검토 대기 롱폴(2026-09-22) — 폴링 대신 기다린다. 기다렸다 **읽을** 뿐이다.
    assert!(names.contains(&"wait_for_operation"));
    // 단계 9 결과 읽기 — 새 도구가 목록에 있다(대상별 출력을 읽기 전용으로).
    assert!(names.contains(&"get_operation_results"));
    // 자동 승인 **범위 읽기**(2026-09-16) — 읽기일 뿐, 정책을 바꾸는 도구가 아니다.
    assert!(names.contains(&"get_auto_approval_policy"));
    // 실행 도구는 없다 — 이 서버에 실행 경로가 없다는 계약을 목록으로도 못 박는다.
    assert!(!names.contains(&"send_command"));
    assert!(!names.contains(&"execute"));
    // 단계 9 경계: 승인·취소·실행은 **Tauri 명령 전용**이라 MCP 도구 목록에 절대 없다.
    // AI 는 승인/실행/취소에 닿을 표면이 없어야 한다(보안 불변). 도구 수는 12(전부 읽기/계획) —
    // 단계 9 에서 늘어난 것은 결과 **읽기**(get_operation_results)이고, 2026-09-16 에 늘어난
    // 것도 정책 **읽기**(get_auto_approval_policy)뿐이라 실행/승인 표면은 0 그대로다.
    assert!(!names.contains(&"approve"));
    assert!(!names.contains(&"approve_operation"));
    assert!(!names.contains(&"cancel"));
    assert!(!names.contains(&"cancel_operation"));
    assert!(!names.contains(&"execute_operation"));
    assert!(!names.contains(&"run_command"));
    // 정책을 **바꾸는** 도구도 없다 — 읽기 도구가 생겼다고 쓰기 표면이 열리지 않는다.
    assert!(!names.contains(&"set_auto_approval_policy"));
    assert!(!names.contains(&"update_auto_approval_policy"));
    assert!(!names.contains(&"add_allow_pattern"));
    // 각 도구에 inputSchema 가 있다.
    for t in tools {
        assert_eq!(t["inputSchema"]["type"], "object");
    }
    // **역할별 목록**(2026-10-14 오케스트레이션) — 전역 = 위의 13개 그대로 · 조정자 = 13개 + 조율 넷 · 작업자 = 작업자 도구만.
    // 어느 역할에도 실행 · 승인 · 취소 · 정책 쓰기 · 키 전송 · 권한 응답 도구는 없다.
    use crate::orchestration::Caller;
    let forbidden = [
        "send_command",
        "execute",
        "approve",
        "approve_operation",
        "cancel",
        "cancel_operation",
        "execute_operation",
        "run_command",
        "set_auto_approval_policy",
        "update_auto_approval_policy",
        "add_allow_pattern",
        "send_keys",
        "respond_permission",
    ];
    let coordinator = Caller::Coordinator { run_id: "run-x".into(), gen: 1 };
    let worker = Caller::Worker { run_id: "run-x".into(), gen: 1, attempt_id: "att-x".into() };
    // (3차 5단계) 전역 토큰의 목록은 맡긴 저장소가 있어도 바뀌지 않는다.
    let global_list = tools_list_for(&Caller::Global, false, true);
    assert_eq!(global_list, tools_list_result(), "전역 토큰의 목록은 바뀌지 않는다");
    // DB 도구의 가시성은 전역 · 조정자에게 같다(조정자에게 더 주지도 덜 주지도 않는다) — 작업자에겐 없다.
    for db in [false, true] {
        let names = |c: &Caller, listed: bool| -> Vec<String> {
            tools_list_for(c, db, listed)["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
        };
        let g = names(&Caller::Global, false);
        assert_eq!(g.len(), if db { 13 + 7 } else { 13 }, "DB 뒷면이 있으면 DB 도구 일곱 다 (2026-11-09)");
        let c = names(&coordinator, false);
        let tile = Caller::Tile { stream: "tile-x".into() };
        // (오케스트레이션 탭 2단계 6절) 타일은 맡긴 저장소 유무와 무관하게 전역과 같은 목록(조율 · 타일 도구 없음).
        assert_eq!(names(&tile, false), g, "타일 = 전역 ({db:?})");
        assert_eq!(names(&tile, true), g, "타일 = 전역 — 조율 도구 없음 ({db:?})");
        assert_eq!(g, tools_list_result_for(db)["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect::<Vec<_>>(), "{db:?}");
        assert_eq!(&c[..g.len()], &g[..], "조정자 = 전역과 같은 목록 + 타일 도구 + 조율 도구 ({db:?})");
        // (3차 6단계) worktree 셋을 걷어 15 → 12.
        assert_eq!(c.len(), g.len() + 11, "start_run · adopt_run + 조율 넷 + spawn/stop + send_prompt + read_worker + get_diff + complete_run ({db:?})");
        assert_eq!(names(&worker, true), vec!["get_task".to_string(), "report_done".to_string(), "commit_changes".to_string()], "작업자는 DB 도구가 없다 ({db:?})");
    }
    // 조정자 = 13 + 타일 도구 둘 + 조율 열 (3차 6단계 — worktree 도구 셋을 걷어 28 → 25).
    for (caller, expect) in [(&Caller::Global, 13usize), (&coordinator, 24), (&worker, 3)] {
        let list = tools_list_for(caller, false, false);
        let role_tools = list["tools"].as_array().unwrap();
        assert_eq!(role_tools.len(), expect, "{caller:?}");
        for t in role_tools {
            let n = t["name"].as_str().unwrap();
            assert!(!forbidden.contains(&n), "{caller:?} 에 금지 도구 {n}");
            assert_eq!(t["inputSchema"]["type"], "object", "{n}");
            assert!(!t["description"].as_str().unwrap().is_empty(), "{n}");
        }
    }
    let coord_names: Vec<String> = tools_list_for(&coordinator, false, false)["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect();
    for n in [
        "get_run",
        "create_task",
        "update_task",
        "wait_run",
        "spawn_worker",
        "stop_worker",
        "send_prompt",
        "read_worker",
        "get_diff",
        "complete_run",
    ] {
        assert!(coord_names.iter().any(|x| x == n), "{n}");
    }
    // (3차 6단계 · Q6) worktree 도구 셋은 어느 목록에도 없다.
    let global_names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    for n in ["list_worktrees", "create_worktree", "remove_worktree"] {
        assert!(!global_names.contains(&n) && !coord_names.iter().any(|x| x == n), "{n}");
    }
    assert_eq!(tools_list_for(&worker, true, true)["tools"][0]["name"], "get_task");
    // 설명이 AI 가 읽는 유일한 계약이다 — 이력 도구는 세 제약을 반드시 말한다.
    let find = |n: &str| {
        tools.iter().find(|t| t["name"] == n).unwrap()["description"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let list = find("list_commands");
    assert!(list.contains("AI-readable"), "{list}");
    assert!(list.contains("in memory"), "{list}");
    assert!(list.contains("200 blocks"), "{list}");
    let get = find("get_command");
    assert!(get.contains("AI-readable"), "{get}");
    assert!(get.contains("excerpt"), "{get}");
    assert!(get.contains("truncated"), "{get}");
    // 새 도구는 신선도 가드(capturedAt/contextVersion)의 뜻을 반드시 말한다.
    let snap = find("get_session_snapshot");
    assert!(snap.contains("capturedAt"), "{snap}");
    assert!(snap.contains("contextVersion"), "{snap}");
    assert!(snap.contains("epoch ms"), "{snap}");
    let cmp = find("compare_command_results");
    assert!(cmp.contains("groups"), "{cmp}");
    assert!(cmp.contains("unmatched"), "{cmp}");
    // 작업안 도구 셋은 하나같이 "실행하지 않는다" 를 못 박는다 — 계약으로 실행 부재를 강제한다.
    for t in [
        "create_execution_plan",
        "request_execution",
        "get_operation",
    ] {
        let d = find(t);
        assert!(d.contains("does not run the command"), "{t}: {d}");
    }
    // 롱폴 도구도 같은 계약을 말한다(실행·승인·취소 0) + **언제 멈추고 사람에게 넘기는지**.
    let w = find("wait_for_operation");
    assert!(w.contains("runs, approves and cancels nothing"), "{w}");
    assert!(w.contains("5 minutes"), "{w}");
    assert!(w.contains("end your turn"), "{w}");
    assert!(w.contains("1..120"), "{w}");
    // 자동 승인 정책 도구는 **읽기 전용**이라는 것과, 범위 안에 드는 법을 설명으로 말한다.
    let pol = find("get_auto_approval_policy");
    assert!(pol.contains("read-only"), "{pol}");
    assert!(pol.contains("cwd"), "{pol}");
    assert!(pol.contains("pipes"), "{pol}");
}

/// `get_auto_approval_policy` — 모양과 **읽기 전용**을 못 박는다.
///
/// 값 자체는 개발 기계의 `settings.toml` 에 달렸으므로 **모양만** 본다(기본값이면 전부 끔).
/// 요점은 필드 구성과, 응답 어디에도 정책을 바꾸는 길이 없다는 것이다.
#[test]
fn get_auto_approval_policy_reads_scope_without_any_write_surface() {
    let m = store_with_samples();
    let v = call_text(
        &m,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_auto_approval_policy","arguments":{}}}"#,
    );
    assert!(v["enabled"].is_boolean(), "{v}");
    assert!(v["allow"].is_array(), "{v}");
    assert!(v["rules"].is_array(), "{v}");
    // 묶음 — **전부** 이름과 켬/끔으로 나온다(켜는 길은 응답 어디에도 없다).
    let bundles = v["bundles"].as_array().expect("bundles 배열");
    assert_eq!(
        bundles.len(),
        crate::automation_presets::BUNDLES.len(),
        "{v}"
    );
    for b in bundles {
        assert!(b["id"].is_string(), "{b}");
        assert!(b["name"].is_string(), "{b}");
        assert!(b["enabled"].is_boolean(), "{b}");
        assert!(b["commandsOff"].is_array(), "{b}");
    }
    // 규칙은 출처를 말한다 — `user` 또는 `bundle:<id>`.
    for r in v["rules"].as_array().expect("rules 배열") {
        let src = r["source"].as_str().expect("source 문자열");
        assert!(src == "user" || src.starts_with("bundle:"), "{r}");
    }
    assert!(v["caps"]["maxTargets"].is_number(), "{v}");
    assert!(v["caps"]["maxConcurrency"].is_number(), "{v}");
    assert!(v["rateLimit"]["maxPerWindow"].is_number(), "{v}");
    assert!(v["rateLimit"]["windowSeconds"].is_number(), "{v}");
    // 위임은 **숫자 요약**만 — 별칭·호스트·사용자 이름은 응답에 없어야 한다.
    assert!(v["delegationAutoExecute"]["anyGranted"].is_boolean(), "{v}");
    assert!(
        v["delegationAutoExecute"]["grantedCount"].is_number(),
        "{v}"
    );
    let text = v.to_string();
    for leak in [
        "alias",
        "expect_user",
        "expect_host",
        "expect_port",
        "token",
    ] {
        assert!(!text.contains(leak), "{leak} 가 새면 안 된다: {text}");
    }
    // note 가 계약을 말한다: 읽기 전용 · 조각마다 판정 · cwd 권고.
    // (MCP 표면은 **영어 전용**이라 영어로 확인한다 — i18n.rs 머리말.)
    let note = v["note"].as_str().expect("note 문자열");
    assert!(note.contains("Read-only"), "{note}");
    assert!(note.contains("in every segment"), "{note}");
    assert!(note.contains("cwd"), "{note}");
}

/// 묶음 이름·설명은 **id 마다 영어 짝이 있어야 한다**.
///
/// MCP 로 나가는 글자는 AI 가 읽으므로 영어 전용이고, 한국어 원본은 TS 와 글자까지 잠긴
/// 드리프트 표라 손대지 않는다([`bundle_text_en`]). 묶음이 하나 늘었는데 영어를 안 적으면
/// 폴백이 조용히 한국어를 내보내므로, 그 순간 여기서 멈춘다.
#[test]
fn every_bundle_has_english_text_for_the_ai() {
    for b in crate::automation_presets::BUNDLES {
        let (name, description) = bundle_text_en(b);
        assert_ne!(name, b.name, "{} 의 영어 이름이 없다", b.id);
        assert_ne!(description, b.description, "{} 의 영어 설명이 없다", b.id);
        // 한글이 남아 있으면 폴백을 탄 것이다 (문장 부호 `—` 는 영어 문구에도 쓴다).
        let hangul = |s: &str| s.chars().any(|c| ('\u{AC00}'..='\u{D7A3}').contains(&c));
        assert!(!hangul(name), "{} 의 영어 이름에 한글이 있다: {name}", b.id);
        assert!(
            !hangul(description),
            "{} 의 영어 설명에 한글이 있다: {description}",
            b.id
        );
    }
}

// ---- get_operation_results — 대상별 결과 읽기(옵트인 재검사 · 발췌) ----

#[test]
fn get_operation_results_redacts_opted_out_and_truncates_long_output() {
    use crate::operations::{TargetResult, TargetState};

    let m = store_with_samples(); // w:1 공유(code p2) · w:2 옵트아웃(prod-db)
    let results: ResultStore = Default::default();

    // 공유 대상 w:1 — 긴 stdout(발췌 상한 초과) · 성공. 옵트아웃 대상 w:2 — 실패.
    let long = "a".repeat(RESULT_FIELD_CAP + 500);
    {
        let mut rmap = results.lock().unwrap();
        let mut per: HashMap<String, TargetResult> = HashMap::new();
        per.insert(
            "w:1".into(),
            TargetResult {
                state: TargetState::Succeeded,
                exit_code: Some(0),
                stdout: long.clone(),
                stderr: String::new(),
                stdout_truncated: true,
                stderr_truncated: false,
                started_at: Some(10),
                ended_at: Some(20),
                error_class: None,
                db: None,
            },
        );
        per.insert(
            "w:2".into(),
            TargetResult {
                state: TargetState::Failed,
                exit_code: Some(3),
                stdout: "secret prod output".into(),
                stderr: "boom".into(),
                stdout_truncated: true,
                stderr_truncated: true,
                started_at: Some(11),
                ended_at: Some(22),
                error_class: Some("종료 코드 3".into()),
                db: None,
            },
        );
        rmap.insert("op1".into(), per);
    }

    let args = json!({ "operationId": "op1" });
    let (m, delegation) = emulate_app(&m);
    let v = get_operation_results(&m, &delegation, &results, Some(&args), &DbEnv::none()).expect("결과");
    assert_eq!(v["operationId"], "op1");
    let arr = v["results"].as_array().unwrap();
    assert_eq!(arr.len(), 2); // 안정 순서(streamId) → w:1, w:2

    // 공유 대상: 출력이 발췌되고(뒤 상한만), code 가 붙고, redacted=false.
    let a = &arr[0];
    assert_eq!(a["id"], "w:1");
    assert_eq!(a["code"], "p2");
    assert_eq!(a["redacted"], false);
    assert_eq!(a["exitCode"], 0);
    assert_eq!(a["outputTruncated"], true);
    assert_eq!(a["stdoutTruncated"], true); // exec 원시가 앞을 버린 표시는 그대로 실린다
    assert_eq!(a["stderrTruncated"], false);
    assert_eq!(
        a["stdout"].as_str().unwrap().chars().count(),
        RESULT_FIELD_CAP
    );

    // 옵트아웃 대상: 출력은 검열되고(빈 문자열·redacted=true·code 없음) 상태·종료·시각은 남는다.
    let b = &arr[1];
    assert_eq!(b["id"], "w:2");
    assert_eq!(b["redacted"], true);
    assert_eq!(b["stdout"], "");
    assert_eq!(b["stderr"], "");
    assert_eq!(b["stdoutTruncated"], false); // 검열된 대상엔 잘림 표시도 싣지 않는다
    assert_eq!(b["stderrTruncated"], false);
    assert!(
        b.get("code").is_none(),
        "옵트아웃 대상엔 code 를 붙이지 않는다"
    );
    assert_eq!(b["exitCode"], 3); // 상태·종료 코드는 세션 내용이 아니라 남긴다
    assert_eq!(b["state"], "failed");
    assert_eq!(b["errorClass"], "종료 코드 3");
}

#[test]
fn get_operation_results_is_empty_when_no_results_yet() {
    let m = store_with_samples();
    let results: ResultStore = Default::default();
    let args = json!({ "operationId": "nope" });
    let (m, delegation) = emulate_app(&m);
    let v = get_operation_results(&m, &delegation, &results, Some(&args), &DbEnv::none()).expect("빈 결과");
    assert_eq!(v["results"].as_array().unwrap().len(), 0);
}

#[test]
fn unknown_method_is_a_jsonrpc_error() {
    let m = store_with_samples();
    let v = parse_json(dispatch_t(
        &m,
        r#"{"jsonrpc":"2.0","id":9,"method":"no/such"}"#,
    ));
    assert_eq!(v["error"]["code"], -32601);
    assert!(v.get("result").is_none());
}

#[test]
fn malformed_json_is_parse_error() {
    let m = store_with_samples();
    let v = parse_json(dispatch_t(&m, "not json at all"));
    assert_eq!(v["error"]["code"], -32700);
}

// ---- tools/call ----

/// 도구-결과의 텍스트(문자열화된 JSON)를 다시 파싱해 돌려준다.
fn call_text(m: &HashMap<String, SessionContext>, body: &str) -> Value {
    let v = parse_json(dispatch_t(m, body));
    assert!(
        v["result"]["isError"].as_bool() != Some(true),
        "예상치 못한 오류 결과: {v}"
    );
    let text = v["result"]["content"][0]["text"].as_str().unwrap();
    serde_json::from_str(text).unwrap()
}

// list_sessions 는 `~/.ssh/config` 를 읽는 얇은 래퍼라(파일 의존), 목록 로직은 순수 열거기
// [`enrich_sessions`] 를 **주입된 Delegation** 으로 본다. 하네스([`emulate_app`])의 위임에는 헤드리스
// 접속 권한이 없어 합성 항목이 없고, 오늘과 같은 목록에 `connected` 필드만 더해진다.
fn enrich_t(m: &HashMap<String, SessionContext>, config: Option<&ConfigIndex>) -> Value {
    let (m, delegation) = emulate_app(m);
    enrich_sessions(&m, &delegation, config)
}

#[test]
fn list_sessions_shows_only_opted_in() {
    let m = store_with_samples();
    let arr = enrich_t(&m, None);
    let arr = arr.as_array().unwrap();
    // 옵트인 1개만 (prod-db 는 옵트아웃이라 숨는다). 위임 목록이 비어 합성 항목도 없다.
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], "w:1");
    // `code` 는 프런트가 넘겨 준 표시용 손잡이(이제 키를 파싱하지 않는다) — `id`(=거울
    // 키=streamId)는 정확 지목용으로 그대로 남는다.
    assert_eq!(arr[0]["code"], "p2");
    assert_eq!(arr[0]["label"], "web-01");
    assert_eq!(arr[0]["status"], "fail");
    assert_eq!(arr[0]["running"], false);
    assert_eq!(arr[0]["lastExit"], 3);
    // A3b-1 — 마지막 명령문(관제판 위임 로스터용).
    assert_eq!(arr[0]["lastCommand"], "systemctl status nginx");
    // 이력이 어디 있는지 알려 주는 값싼 숫자.
    assert_eq!(arr[0]["commands"], 3);
    // A3a — 라이브 거울에서 온 항목은 언제나 connected:true.
    assert_eq!(arr[0]["connected"], true);
    // SessionLifecycle — 창 세션은 언제나 dropped:false.
    assert_eq!(arr[0]["dropped"], false);
    // 보통 세션은 블록 모드 — 블록 도구를 물어볼 값이 있다.
    assert_eq!(arr[0]["mode"], "blocks");
}

// ---- 화면만 있는 세션(간이 모드 · tmux) — docs/log/2026-09-16-tmux-toggle.md ----

/// tmux 타일 하나만 든 저장소. `screen_only` 는 `report_session`(명령 층)이 찍는 필드라
/// 순수 `report` 뒤에 직접 세운다 — 여기서 보는 것은 **소비 쪽**(MCP)의 계약이다.
fn screen_only_store() -> HashMap<String, SessionContext> {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:tmux".into(),
        "web-01".into(),
        "ssh".into(),
        "p1".into(),
        true,
    );
    m.get_mut("w:tmux").unwrap().screen_only = true;
    m
}

#[test]
fn screen_only_sessions_are_listed_with_mode_screen() {
    let m = screen_only_store();
    let arr = enrich_t(&m, None);
    let arr = arr.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    // 세션은 **숨지 않는다** — 읽기(스크롤백)는 그대로 되고, 모드만 다르다.
    assert_eq!(arr[0]["mode"], "screen");
    assert_eq!(arr[0]["commands"], 0);
    // 스냅샷도 같은 칸을 낸다 (두 곳의 뜻이 갈리면 AI 가 어느 쪽을 믿을지 모른다).
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_session_snapshot","arguments":{"session":"w:tmux"}}}"#;
    assert_eq!(call_text(&m, body)["mode"], "screen");
}

/// 블록 도구는 **조용히 비어 있지 않다** — 왜 비었는지가 같은 응답에 있다.
/// (빈 결과와 "원래 없음" 이 구분되지 않으면 AI 는 기다리거나 재시도한다.)
#[test]
fn block_tools_say_screen_only_instead_of_going_quiet() {
    let m = screen_only_store();

    let last = call_text(
        &m,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_last_command","arguments":{"session":"w:tmux"}}}"#,
    );
    assert_eq!(last["mode"], "screen");
    assert_eq!(last["screenOnly"], true);
    assert!(
        last["note"].as_str().is_some_and(|s| s.contains("tmux")),
        "{last}"
    );

    let list = call_text(
        &m,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:tmux"}}}"#,
    );
    assert_eq!(list["commands"].as_array().unwrap().len(), 0);
    assert_eq!(list["total"], 0);
    assert_eq!(list["screenOnly"], true);
    assert_eq!(list["mode"], "screen");

    // get_command 는 오류다 — 다만 "밀려난 번호" 가 아니라 **모드**를 말하는 오류다.
    let v = parse_json(dispatch_t(
        &m,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_command","arguments":{"session":"w:tmux","id":"last"}}}"#,
    ));
    assert_eq!(v["result"]["isError"], true);
    let text = v["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("tmux"), "{text}");
}

/// 비교에서는 `unmatched` 에 들어가되, **왜** 못 맞췄는지를 `screenOnly` 가 가른다
/// ("이번에 안 돌렸다" 는 다시 돌리면 되고, 이쪽은 몇 번을 비교해도 같다).
#[test]
fn compare_separates_screen_only_from_merely_unmatched() {
    let mut m = screen_only_store();
    // 블록이 있는 보통 세션 하나 + 대상 명령이 없는 보통 세션 하나.
    report(
        &mut m,
        "a".into(),
        "host-a".into(),
        "ssh".into(),
        "p2".into(),
        true,
    );
    push_block(&mut m, "a", cblock(1, "run check", Some(0), "OK"));
    report(
        &mut m,
        "d".into(),
        "host-d".into(),
        "ssh".into(),
        "p3".into(),
        true,
    );
    push_block(&mut m, "d", cblock(1, "ls", Some(0), "files"));

    let v = call_text(
        &m,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_command_results","arguments":{"command":"check"}}}"#,
    );
    let unmatched: Vec<&str> = v["unmatched"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap())
        .collect();
    // 둘 다 못 맞췄지만…
    assert!(unmatched.contains(&"d"), "{v}");
    assert!(unmatched.contains(&"w:tmux"), "{v}");
    // …원래 블록이 없는 쪽만 따로 적힌다.
    assert_eq!(v["screenOnly"], json!(["w:tmux"]));
    assert_eq!(v["summary"]["matched"], 1);
}

/// 핸드셰이크 안내가 `mode:"screen"` 을 한 문장으로 말한다 (AI 가 도구를 고르는 근거).
#[test]
fn instructions_mention_screen_mode() {
    assert!(INSTRUCTIONS.contains("mode"), "{INSTRUCTIONS}");
    assert!(INSTRUCTIONS.contains("screen"), "{INSTRUCTIONS}");
    assert!(INSTRUCTIONS.contains("get_scrollback"), "{INSTRUCTIONS}");
}

#[test]
fn delegated_session_visibility_is_gated_by_read_grant_not_optin() {
    // 헤드리스 세션의 가시성은 delegation `read` 권한이 지배한다 — opted_in 은 늘 false 다.
    let mut m = HashMap::new();
    // read=true → 보인다. read=false → 숨는다. 창 세션(opted_in)은 기존 그대로 보인다.
    report_delegated(
        &mut m,
        "f-on".into(),
        "Remote-SSH".into(),
        "Remote-SSH".into(),
        true,
    );
    report_delegated(
        &mut m,
        "f-off".into(),
        "Locked".into(),
        "Locked".into(),
        false,
    );
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        "p2".into(),
        true,
    );
    report(
        &mut m,
        "w:2".into(),
        "db".into(),
        "ssh".into(),
        "p3".into(),
        false,
    );

    // 빈 위임 목록(합성 없음)으로 목록 로직만 본다 — 라이브 가시성 게이트를 확인한다.
    let arr = enrich_t(&m, None);
    let ids: Vec<&str> = arr
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    // read=true 위임 + opted_in 창 세션만. read=false 위임와 opted_out 창은 숨는다.
    assert_eq!(ids, vec!["f-on", "w:1"]);
    // 읽기 도구(get_last_command)도 같은 게이트: read=false 위임 대상은 "없음" 처럼 거부된다.
    let deny = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_last_command","arguments":{"session":"f-off"}}}"#;
    let v = parse_json(dispatch_t(&m, deny));
    assert_eq!(
        v["result"]["isError"], true,
        "read=false 위임 대상은 읽기 도구에서 숨는다"
    );
}

#[test]
fn enrich_surfaces_not_live_read_targets_and_live_wins_over_synthetic() {
    // 손수 지은 거울: 옵트인 창 · 라이브 위임 delegated:A · 옵트아웃 창.
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        "p2".into(),
        true,
    );
    report_delegated(&mut m, "delegated:A".into(), "A".into(), "A".into(), true);
    report(
        &mut m,
        "w:2".into(),
        "db".into(),
        "ssh".into(),
        "p3".into(),
        false,
    );
    // 창 타일은 호스트 별칭의 권한을 따른다 — web 은 읽기 전용, db 는 권한 없음.
    m.get_mut("w:1").unwrap().host_alias = Some("web".into());
    m.get_mut("w:2").unwrap().host_alias = Some("db".into());

    // 손수 지은 위임: 헤드리스 접속까지 준 A·B, 읽기만 준 C·web.
    let delegation = crate::delegation::Delegation::parse(
        "\
[[target]]
alias = \"A\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
connect = true

[[target]]
alias = \"B\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
connect = true

[[target]]
alias = \"C\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true

[[target]]
alias = \"web\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
",
    )
    .unwrap();

    let arr = enrich_sessions(&m, &delegation, None);
    let arr = arr.as_array().unwrap();
    let ids: Vec<&str> = arr.iter().map(|s| s["id"].as_str().unwrap()).collect();
    // delegated:A(라이브·중복 아님) · delegated:B(합성) · w:1(호스트 web 이 읽기 전용). 권한 없는 w:2 와
    // 읽기만 준 C·web 의 합성 항목은 없다 — 읽기만 준 호스트는 타일로만 보인다(붙을 수 없는 유령 줄 없음).
    // id 정렬: "delegated:A" < "delegated:B" < "w:1".
    assert_eq!(ids, vec!["delegated:A", "delegated:B", "w:1"]);

    // delegated:A 는 라이브라 connected:true 이고 딱 하나만(합성으로 중복되지 않는다).
    let a: Vec<&Value> = arr.iter().filter(|s| s["id"] == "delegated:A").collect();
    assert_eq!(a.len(), 1, "라이브가 합성을 이겨 중복이 없다");
    assert_eq!(a[0]["connected"], true);
    // 떨어지지 않은 라이브 위임 — dropped:false.
    assert_eq!(a[0]["dropped"], false);

    // delegated:B 는 미접속 합성 발견 항목 — 데이터 없음, 떨어진 것도 아니다.
    let b = arr.iter().find(|s| s["id"] == "delegated:B").unwrap();
    assert_eq!(b["connected"], false);
    assert_eq!(b["dropped"], false);
    assert_eq!(b["code"], "B");
    assert_eq!(b["label"], "B");
    assert_eq!(b["kind"], "ssh");
    assert_eq!(b["status"], Value::Null);
    assert_eq!(b["running"], false);
    assert_eq!(b["lastExit"], Value::Null);
    // 미접속 합성 항목은 마지막 명령문도 없다.
    assert_eq!(b["lastCommand"], Value::Null);
    assert_eq!(b["commands"], 0);

    // w:1(창) 은 오늘 그대로 + connected:true·dropped:false.
    let w = arr.iter().find(|s| s["id"] == "w:1").unwrap();
    assert_eq!(w["connected"], true);
    assert_eq!(w["dropped"], false);
}

#[test]
fn enrich_marks_dropped_delegated_as_disconnected_and_suppresses_synthetic() {
    // SessionLifecycle — 떨어진 헤드리스 세션은 거울에 남아 connected:false·dropped:true 로 나가고,
    // 같은 별칭의 합성 발견 항목은 억눌린다(키가 겹친다) → 로스터는 '끊김'을, '미접속'이 아니라.
    let mut m = HashMap::new();
    report_delegated(&mut m, "delegated:A".into(), "A".into(), "A".into(), true);
    mark_delegated_disconnected(&mut m, "delegated:A");

    // delegation.toml 은 A 를 read 위임한다 — 라이브(떨어진) 항목이 합성보다 우선이다.
    let delegation = crate::delegation::Delegation::parse(
        "\
[[target]]
alias = \"A\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
",
    )
    .unwrap();

    let arr = enrich_sessions(&m, &delegation, None);
    let arr = arr.as_array().unwrap();
    // delegated:A 딱 하나 — 합성 발견 항목이 키 충돌로 억눌렸다(미접속으로 새지 않는다).
    let a: Vec<&Value> = arr.iter().filter(|s| s["id"] == "delegated:A").collect();
    assert_eq!(a.len(), 1, "떨어진 라이브 항목이 합성을 억눌러 중복이 없다");
    assert_eq!(
        a[0]["connected"], false,
        "떨어진 헤드리스 세션은 connected:false"
    );
    assert_eq!(
        a[0]["dropped"], true,
        "떨어진 헤드리스 세션은 dropped:true (끊김)"
    );
}

/// **고아 위임** — `~/.ssh/config` 에 없는 별칭의 합성 항목은 `aliasKnown:false` 로 나간다.
/// 라이브 항목은 그 집합과 무관하게 언제나 `true` 이고, 집합이 `None`(설정을 못 읽었다)이면
/// 아무것도 고아로 칠하지 않는다.
#[test]
fn enrich_marks_unknown_aliases_so_the_roster_can_call_them_orphans() {
    let mut m = HashMap::new();
    report_delegated(
        &mut m,
        "delegated:live".into(),
        "live".into(),
        "live".into(),
        true,
    );
    // 미접속 합성 항목은 헤드리스 접속이 위임된 대상만이다(2026-10-07).
    let delegation = crate::delegation::Delegation::parse(
        "\
[[target]]
alias = \"kept\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
connect = true

[[target]]
alias = \"Gone\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
connect = true

[[target]]
alias = \"live\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
connect = true
",
    )
    .unwrap();

    // config 에는 `kept` 만 있다 (`Gone` 은 이름이 바뀌어 사라진 고아다). 키는 소문자다.
    let known: ConfigIndex = [
        ("kept".to_string(), Some("deploy".to_string())),
        ("live".to_string(), Some("deploy".to_string())),
    ]
    .into_iter()
    .collect();
    let arr = enrich_sessions(&m, &delegation, Some(&known));
    let arr = arr.as_array().unwrap();
    let of = |id: &str| arr.iter().find(|s| s["id"] == id).unwrap().clone();

    assert_eq!(of("delegated:kept")["aliasKnown"], true);
    assert_eq!(
        of("delegated:Gone")["aliasKnown"],
        false,
        "설정에 없는 별칭 = 고아"
    );
    // 라이브 항목(합성이 억눌린 쪽)은 언제나 true.
    assert_eq!(of("delegated:live")["aliasKnown"], true);

    // 설정을 못 읽었으면(None) 아무것도 고아가 아니다.
    let arr = enrich_sessions(&m, &delegation, None);
    let arr = arr.as_array().unwrap();
    assert!(arr.iter().all(|s| s["aliasKnown"] == true));
}

// ---- 관제판 호스트별 목록의 네 칸 (docs/log/2026-09-21-console-host-groups.md) ----

/// 계정은 세 갈래로 정해진다 — 로컬은 없음 · 빠른 접속은 이름 자체 · 별칭은 색인.
#[test]
fn session_user_reads_config_or_the_adhoc_label() {
    let index: ConfigIndex = [
        ("web-01".to_string(), Some("deploy".to_string())),
        // `User` 가 없는 블록인데 `USERNAME` 도 없었던 경우 — 값이 `None` 이다.
        ("bare".to_string(), None),
    ]
    .into_iter()
    .collect();

    // 로컬 셸에는 답이 없다 — 프런트가 셸 이름을 쓴다.
    assert_eq!(session_user("local", "PowerShell 7", Some(&index)), None);
    // 별칭은 색인에서 (대소문자 무관).
    assert_eq!(
        session_user("ssh", "WEB-01", Some(&index)),
        Some("deploy".to_string())
    );
    assert_eq!(session_user("ssh", "bare", Some(&index)), None);
    // 설정에 없는 별칭.
    assert_eq!(session_user("ssh", "gone", Some(&index)), None);
    // 설정을 못 읽었으면 별칭으로는 아무것도 못 편다.
    assert_eq!(session_user("ssh", "web-01", None), None);
    // 빠른 접속 타일의 이름은 그 자체가 신원이다 — 색인 없이도 읽는다.
    assert_eq!(
        session_user("ssh", "root@10.0.0.9:2222", None),
        Some("root".to_string())
    );
    // `@` 가 들어갔다고 다 빠른 접속은 아니다.
    assert_eq!(adhoc_user("@host"), None);
    assert_eq!(adhoc_user("user@"), None);
    assert_eq!(adhoc_user("a b@host"), None);
    assert_eq!(adhoc_user("just-an-alias"), None);
}

/// 창 세션은 소유 창 라벨과 붙은 시각을 싣고, 헤드리스는 창이 없어 `windowLabel:null` 이다.
#[test]
fn enrich_carries_window_label_and_timestamps() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web-01".into(),
        "ssh".into(),
        "p2".into(),
        true,
    );
    m.get_mut("w:1").unwrap().owner = "main".into();
    push_block(&mut m, "w:1", block(7, "uptime", false));
    report_delegated(&mut m, "delegated:A".into(), "A".into(), "A".into(), true);

    let index: ConfigIndex = [("web-01".to_string(), Some("deploy".to_string()))]
        .into_iter()
        .collect();
    let arr = enrich_t(&m, Some(&index));
    let arr = arr.as_array().unwrap();
    let of = |id: &str| arr.iter().find(|s| s["id"] == id).unwrap().clone();

    let w = of("w:1");
    assert_eq!(w["windowLabel"], "main", "창 타일은 소유 창 라벨을 싣는다");
    assert_eq!(w["user"], "deploy");
    assert!(
        w["connectedAt"].as_u64().unwrap_or(0) > 0,
        "붙은 시각이 찍힌다"
    );
    // 마지막 활동 = 마지막 블록의 끝 시각(끝났으면 `endedAt`).
    assert_eq!(w["lastActivityAt"], 2_007);

    let f = of("delegated:A");
    assert_eq!(f["windowLabel"], Value::Null, "헤드리스에는 창이 없다");
    assert_eq!(
        f["lastActivityAt"],
        Value::Null,
        "블록이 없으면 활동도 없다"
    );
    assert!(f["connectedAt"].as_u64().unwrap_or(0) > 0);
}

/// 아직 안 붙은 위임 줄도 **누구로 붙을 것인가**는 말한다 — 나머지 셋은 전부 `null`.
#[test]
fn enrich_gives_unconnected_targets_a_user_but_no_clock() {
    let m = HashMap::new();
    // 미접속 합성 항목은 헤드리스 접속이 위임된 대상만이다(2026-10-07).
    let delegation = crate::delegation::Delegation::parse(
        "\
[[target]]
alias = \"db-01\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true
connect = true
",
    )
    .unwrap();
    let index: ConfigIndex = [("db-01".to_string(), Some("ops".to_string()))]
        .into_iter()
        .collect();
    let arr = enrich_sessions(&m, &delegation, Some(&index));
    let arr = arr.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["user"], "ops");
    assert_eq!(arr[0]["connectedAt"], Value::Null);
    assert_eq!(arr[0]["lastActivityAt"], Value::Null);
    assert_eq!(arr[0]["windowLabel"], Value::Null);
}

/// 이력이 없는 세션은 `commands: 0` — "여긴 물어볼 것이 없다".
#[test]
fn list_sessions_counts_zero_when_no_history() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "local".into(),
        String::new(),
        true,
    );
    let arr = enrich_t(&m, None);
    assert_eq!(arr.as_array().unwrap()[0]["commands"], 0);
}

// ---- list_commands ----

/// 목록은 **최신순**이고 출력 텍스트를 싣지 않는다(목록을 가볍게 유지한다).
#[test]
fn list_commands_is_newest_first_and_carries_no_excerpt() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:1"}}}"#;
    let v = call_text(&m, body);
    let cmds = v["commands"].as_array().unwrap();
    assert_eq!(cmds.len(), 3);
    assert_eq!(v["total"], 3);
    assert_eq!(cmds[0]["id"], 3);
    assert_eq!(cmds[0]["commandLine"], "tail -f app.log");
    assert_eq!(cmds[2]["id"], 1);
    // 메타는 camelCase 계약 그대로.
    assert_eq!(cmds[1]["cwd"], "/srv/app");
    assert_eq!(cmds[1]["startedAt"], 1002);
    assert_eq!(cmds[1]["endedAt"], 2002);
    assert_eq!(cmds[1]["exit"], 0);
    assert_eq!(cmds[1]["truncated"], false);
    // 발췌는 목록에 없다 — get_command 로만 나간다.
    assert!(cmds[0].get("excerpt").is_none(), "{v}");
}

/// `limit` 은 **최신** 쪽을 남기고, 상한(200)·하한(1)으로 클램프된다.
#[test]
fn list_commands_limit_keeps_the_newest_and_clamps() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:1","limit":2}}}"#;
    let v = call_text(&m, body);
    let cmds = v["commands"].as_array().unwrap();
    assert_eq!(cmds.len(), 2);
    assert_eq!(cmds[0]["id"], 3);
    assert_eq!(cmds[1]["id"], 2);
    // 자르기 **전** 개수는 그대로 알려 준다.
    assert_eq!(v["total"], 3);

    // 상한을 넘겨도 오류가 아니다 — 가진 만큼만 나온다.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:1","limit":99999}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["commands"].as_array().unwrap().len(), 3);

    // 0 은 1 로 클램프(빈 목록을 돌려주는 것보다 한 건이라도 주는 쪽이 쓸모 있다).
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:1","limit":0}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["commands"].as_array().unwrap().len(), 1);
}

/// 기본 개수는 50 — 이력이 상한(200)까지 차 있어도 목록은 그만큼만 나온다.
#[test]
fn list_commands_defaults_to_fifty() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    for i in 0..120 {
        push_block(&mut m, "w:1", block(i, "cmd", false));
    }
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:1"}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["commands"].as_array().unwrap().len(), HISTORY_DEFAULT);
    assert_eq!(v["total"], 120);
    assert_eq!(v["commands"][0]["id"], 119);
}

/// `running_only` 필터는 죽어 있어(이력엔 완료 블록만 든다) 제거됐다 — 모든 블록이
/// 최신순으로 나온다. 실행 중 명령은 `get_last_command` 가 답한다.
#[test]
fn list_commands_returns_all_blocks_newest_first() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:1"}}}"#;
    let v = call_text(&m, body);
    let cmds = v["commands"].as_array().unwrap();
    assert_eq!(cmds.len(), 3);
    assert_eq!(cmds[0]["id"], 3); // 최신순
    assert_eq!(cmds[2]["id"], 1);
}

/// 이력이 아예 없어도 오류가 아니다 — 빈 목록이 정직한 답이다.
#[test]
fn list_commands_on_empty_history_is_an_empty_list() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "local".into(),
        String::new(),
        true,
    );
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:1"}}}"#;
    let v = call_text(&m, body);
    assert!(v["commands"].as_array().unwrap().is_empty());
    assert_eq!(v["total"], 0);
}

// ---- get_command ----

#[test]
fn get_command_by_id_returns_meta_and_excerpt() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_command","arguments":{"session":"w:1","id":2}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["id"], 2);
    assert_eq!(v["commandLine"], "npm run build");
    assert_eq!(v["excerpt"]["head"][0], "npm run build head");
    assert_eq!(v["excerpt"]["tail"][0], "npm run build tail");
    assert_eq!(v["excerpt"]["truncated"], false);
    assert_eq!(v["excerpt"]["capture"], "complete");
    // bytes 는 머리+꼬리의 대략치(줄바꿈 한 바이트 포함) — UTF-8 바이트 수.
    assert_eq!(
        v["excerpt"]["bytes"],
        ("npm run build head".len() * 2 + 2) as u64
    );
    // 전문 왕복은 아직 없다 — 계약만 미리 세워 둔다.
    assert_eq!(v["fullAvailable"], false);
}

#[test]
fn get_command_last_returns_the_newest_block() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_command","arguments":{"session":"w:1","id":"last"}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["id"], 3);
    assert_eq!(v["commandLine"], "tail -f app.log");
    assert_eq!(v["running"], true);
}

#[test]
fn get_command_unknown_id_is_an_error_result() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_command","arguments":{"session":"w:1","id":999}}}"#;
    let v = parse_json(dispatch_t(&m, body));
    assert_eq!(v["result"]["isError"], true);
    let text = v["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("it fell off"), "{text}");

    // "last" 아닌 문자열도 오류(조용히 0번으로 떨어지지 않는다).
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_command","arguments":{"session":"w:1","id":"first"}}}"#;
    assert_eq!(parse_json(dispatch_t(&m, body))["result"]["isError"], true);

    // id 를 빼면 오류.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_command","arguments":{"session":"w:1"}}}"#;
    assert_eq!(parse_json(dispatch_t(&m, body))["result"]["isError"], true);
}

#[test]
fn get_command_last_on_empty_history_is_an_error_result() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "local".into(),
        String::new(),
        true,
    );
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_command","arguments":{"session":"w:1","id":"last"}}}"#;
    assert_eq!(parse_json(dispatch_t(&m, body))["result"]["isError"], true);
}

/// **프라이버시**: 옵트아웃 세션은 이력 도구 둘 다에서 "없음" 과 같은 오류다.
#[test]
fn history_tools_reject_opted_out_sessions() {
    let m = store_with_samples();
    for body in [
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"w:2"}}}"#,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_command","arguments":{"session":"w:2","id":"last"}}}"#,
        // 없는 세션도 같은 오류 — 존재를 흘리지 않는다.
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_commands","arguments":{"session":"ghost"}}}"#,
    ] {
        let v = parse_json(dispatch_t(&m, body));
        assert_eq!(v["result"]["isError"], true, "{body}");
        let text = v["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("Unknown or unshared session"), "{text}");
    }
}

#[test]
fn get_last_command_returns_camel_case_block() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_last_command","arguments":{"session":"w:1"}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["commandLine"], "systemctl status nginx");
    assert_eq!(v["exit"], 3);
    assert_eq!(v["running"], false);
}

#[test]
fn get_scrollback_defaults_and_tails() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    let lines: Vec<String> = (0..500).map(|i| format!("L{i}")).collect();
    update(&mut m, "w:1", None, None, lines);

    // 기본 200 줄 tail.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_scrollback","arguments":{"session":"w:1"}}}"#;
    let v = call_text(&m, body);
    let got = v["lines"].as_array().unwrap();
    assert_eq!(got.len(), SCROLLBACK_DEFAULT);
    assert_eq!(got.last().unwrap(), "L499");
    assert_eq!(got.first().unwrap(), "L300");

    // lines=10 이면 마지막 10줄.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_scrollback","arguments":{"session":"w:1","lines":10}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["lines"].as_array().unwrap().len(), 10);

    // lines 가 상한을 넘겨도 1000 으로 클램프(가진 게 500뿐이면 500).
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_scrollback","arguments":{"session":"w:1","lines":99999}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["lines"].as_array().unwrap().len(), 500);
}

#[test]
fn tool_call_on_opted_out_session_is_an_error_result() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_last_command","arguments":{"session":"w:2"}}}"#;
    let v = parse_json(dispatch_t(&m, body));
    // 전송은 정상(200/result), 다만 isError:true.
    assert_eq!(v["result"]["isError"], true);
    let text = v["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("Unknown or unshared session"), "{text}");
}

#[test]
fn tool_call_unknown_tool_is_an_error_result() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"send_command","arguments":{}}}"#;
    let v = parse_json(dispatch_t(&m, body));
    assert_eq!(v["result"]["isError"], true);
}

// ---- get_session_snapshot ----

#[test]
fn get_session_snapshot_gathers_identity_live_and_freshness() {
    let m = store_with_samples();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_session_snapshot","arguments":{"session":"w:1"}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["id"], "w:1");
    assert_eq!(v["code"], "p2");
    assert_eq!(v["label"], "web-01");
    assert_eq!(v["kind"], "ssh");
    assert_eq!(v["status"], "fail");
    // cwd 는 가장 최근 이력 블록에서 온다.
    assert_eq!(v["cwd"], "/srv/app");
    // last: 라이브 요약의 명령문·종료·실행 + 마지막 블록(id=3, running)의 시각.
    assert_eq!(v["last"]["commandLine"], "systemctl status nginx");
    assert_eq!(v["last"]["exit"], 3);
    assert_eq!(v["last"]["running"], false);
    assert_eq!(v["last"]["startedAt"], 1003); // block(3) started_at
    assert!(v["last"]["endedAt"].is_null()); // block(3) 는 실행 중이라 ended_at 없음
    assert_eq!(v["commands"], 3);
    // scrollbackLines 는 줄 수만 — 내용이 아니다(store_with_samples 는 3줄).
    assert_eq!(v["scrollbackLines"], 3);
    // 신선도 가드: 갱신이 있었으니 둘 다 양수다.
    assert!(v["capturedAt"].as_u64().unwrap() > 0);
    assert!(v["contextVersion"].as_u64().unwrap() > 0);
}

#[test]
fn get_session_snapshot_with_no_last_and_no_history_is_null_and_zero() {
    let mut m = HashMap::new();
    report(
        &mut m,
        "w:1".into(),
        "web".into(),
        "local".into(),
        String::new(),
        true,
    );
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_session_snapshot","arguments":{"session":"w:1"}}}"#;
    let v = call_text(&m, body);
    assert!(v["last"].is_null());
    assert!(v["cwd"].is_null());
    assert_eq!(v["commands"], 0);
    assert_eq!(v["scrollbackLines"], 0);
}

#[test]
fn get_session_snapshot_rejects_opted_out_and_unknown() {
    let m = store_with_samples();
    for session in ["w:2", "ghost"] {
        let body = format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"get_session_snapshot","arguments":{{"session":"{session}"}}}}}}"#
        );
        let v = parse_json(dispatch_t(&m, &body));
        assert_eq!(v["result"]["isError"], true, "{session}");
    }
}

// ---- compare_command_results ----

/// 발췌·종료 코드를 마음대로 정하는 비교용 블록.
fn cblock(id: i64, line: &str, exit: Option<i64>, out: &str) -> CommandBlockMirror {
    CommandBlockMirror {
        id,
        command_line: line.to_string(),
        cwd: Some("/srv".to_string()),
        started_at: 1_000 + id,
        ended_at: Some(2_000 + id),
        exit,
        running: false,
        excerpt_head: vec![format!("{out} head")],
        excerpt_tail: vec![format!("{out} tail")],
        truncated: false,
        capture: "complete".to_string(),
    }
}

/// 같은 명령을 여러 호스트에 돌린 비교 시나리오를 만든다.
/// a,b = 같은 결과(exit0/OK) · c = 다른 결과(exit1/FAIL) · d = 대상 없음 · e = 옵트아웃.
fn compare_store() -> HashMap<String, SessionContext> {
    let mut m = HashMap::new();
    for (id, code) in [("a", "p1"), ("b", "p2"), ("c", "p3"), ("d", "p4")] {
        report(
            &mut m,
            id.into(),
            format!("host-{id}"),
            "ssh".into(),
            code.into(),
            true,
        );
    }
    push_block(&mut m, "a", cblock(1, "run check", Some(0), "OK"));
    push_block(&mut m, "b", cblock(1, "run check", Some(0), "OK"));
    push_block(&mut m, "c", cblock(1, "run check", Some(1), "FAIL"));
    // d 는 check 를 안 돌렸다 — 대상 블록이 없어 unmatched 가 된다.
    push_block(&mut m, "d", cblock(1, "ls", Some(0), "files"));
    // e 는 옵트아웃 — 비교에서 조용히 빠진다(존재를 흘리지 않는다).
    report(
        &mut m,
        "e".into(),
        "host-e".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    push_block(&mut m, "e", cblock(1, "run check", Some(0), "OK"));
    m
}

#[test]
fn compare_folds_equal_results_and_lists_unmatched() {
    let m = compare_store();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_command_results","arguments":{"command":"check"}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["command"], "check");
    let groups = v["groups"].as_array().unwrap();
    // 두 그룹: 다수(a,b) 먼저, 소수(c=이상치) 뒤.
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0]["exit"], 0);
    let g0: Vec<&str> = groups[0]["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(g0, vec!["a", "b"]);
    assert_eq!(groups[0]["excerpt"]["head"][0], "OK head");
    // 세션 멤버는 {id, code, label}.
    assert_eq!(groups[0]["sessions"][0]["code"], "p1");
    assert_eq!(groups[0]["sessions"][0]["label"], "host-a");
    assert_eq!(groups[1]["exit"], 1);
    assert_eq!(groups[1]["sessions"][0]["id"], "c");
    // d 는 대상 블록이 없어 unmatched, e(옵트아웃)는 흔적조차 없다.
    assert_eq!(v["unmatched"].as_array().unwrap(), &vec![json!("d")]);
    assert_eq!(v["summary"]["sessionsCompared"], 4); // a,b,c,d (e 제외)
    assert_eq!(v["summary"]["distinctGroups"], 2);
    assert_eq!(v["summary"]["matched"], 3);
}

#[test]
fn compare_without_command_uses_each_last_block() {
    let m = compare_store();
    // command 생략 — 각 세션의 마지막 블록. a,b(OK/0) 접히고 c(FAIL/1)·d(files/0) 각각.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_command_results","arguments":{}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["command"], "(the last one in each session)");
    // a,b 같은 결과 → 한 그룹, c·d 는 각각 다른 그룹 = 3 그룹.
    assert_eq!(v["summary"]["distinctGroups"], 3);
    assert_eq!(v["summary"]["matched"], 4);
    assert_eq!(v["summary"]["sessionsCompared"], 4);
    assert!(v["unmatched"].as_array().unwrap().is_empty());
    // 다수 그룹이 앞이다(a,b).
    assert_eq!(v["groups"][0]["sessions"].as_array().unwrap().len(), 2);
}

#[test]
fn compare_respects_explicit_session_list_and_privacy() {
    let m = compare_store();
    // 명시 목록: a, c, e(옵트아웃). e 는 조용히 빠진다 — 비교 수에도 안 든다.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_command_results","arguments":{"command":"check","sessions":["a","c","e"]}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["summary"]["sessionsCompared"], 2); // a, c (e 옵트아웃 제외)
    assert_eq!(v["summary"]["distinctGroups"], 2); // a=OK, c=FAIL
    assert_eq!(v["summary"]["matched"], 2);
    assert!(v["unmatched"].as_array().unwrap().is_empty());
}

#[test]
fn compare_all_same_folds_into_one_group() {
    let m = compare_store();
    // a,b 만 비교 — 같은 결과라 한 그룹(차이 없음).
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_command_results","arguments":{"command":"check","sessions":["a","b"]}}}"#;
    let v = call_text(&m, body);
    assert_eq!(v["summary"]["distinctGroups"], 1);
    assert_eq!(v["groups"].as_array().unwrap().len(), 1);
    assert_eq!(v["groups"][0]["sessions"].as_array().unwrap().len(), 2);
}

// ---- 단계 8 작업안 도구 (실행 0) ----

/// 공유(opt-in) 세션 둘 + 옵트아웃 하나.
fn plan_store() -> HashMap<String, SessionContext> {
    let mut m = HashMap::new();
    report(
        &mut m,
        "web-1".into(),
        "web-01".into(),
        "ssh".into(),
        "p1".into(),
        true,
    );
    report(
        &mut m,
        "web-2".into(),
        "web-02".into(),
        "ssh".into(),
        "p2".into(),
        true,
    );
    report(
        &mut m,
        "prod".into(),
        "prod-db".into(),
        "ssh".into(),
        String::new(),
        false,
    );
    m
}

/// tool-result 텍스트(문자열화 JSON)를 파싱한다 — 오류가 아니길 단언한다.
fn ok_text(reply: RpcReply) -> Value {
    let v = parse_json(reply);
    assert!(
        v["result"]["isError"].as_bool() != Some(true),
        "예상치 못한 오류: {v}"
    );
    serde_json::from_str(v["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
}

#[test]
fn create_plan_saves_a_draft_and_filters_non_shared_targets() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    // web-1(공유)·prod(옵트아웃)·ghost(없음) — 공유 web-1 만 남는다(존재를 흘리지 않는다).
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"uptime","targets":["web-1","prod","ghost"],"title":"업타임 점검"}}}"#;
    let v = ok_text(dispatch_o(&m, &ops, &signal, body));
    assert_eq!(v["operation"]["state"], "draft");
    assert_eq!(v["operation"]["command"], "uptime");
    assert_eq!(
        v["operation"]["targets"].as_array().unwrap(),
        &vec![json!("web-1")]
    );
    // 기본값(메타데이터)도 실려 나간다.
    assert_eq!(v["operation"]["mode"], "adhoc");
    assert_eq!(v["operation"]["concurrency"], 1);
    assert_eq!(v["operation"]["timeoutSeconds"], 60);
    // 저장소에 초안 하나 — **실행되지 않았다**(상태가 draft 그대로, 대기도 아니다).
    let opmap = ops.lock().unwrap();
    assert_eq!(opmap.len(), 1);
    assert_eq!(
        operations::list_pending(&opmap).len(),
        0,
        "요청 전이라 대기가 아니다"
    );
}

#[test]
fn clamp_int_arg_defaults_clamps_and_rejects_non_integers() {
    // 없음/null → 기본값.
    assert_eq!(clamp_int_arg(None, 60, 1, 3600, "t"), Ok(60));
    assert_eq!(clamp_int_arg(Some(&Value::Null), 1, 1, 16, "c"), Ok(1));
    // 정수 → 범위로 클램프(큰 값은 상한, 0 은 하한 — 조용히 잘리지 않는다).
    assert_eq!(clamp_int_arg(Some(&json!(4)), 1, 1, 16, "c"), Ok(4));
    assert_eq!(clamp_int_arg(Some(&json!(999)), 1, 1, 16, "c"), Ok(16));
    assert_eq!(clamp_int_arg(Some(&json!(0)), 1, 1, 16, "c"), Ok(1));
    assert_eq!(
        clamp_int_arg(Some(&json!(10_000_000_000u64)), 60, 1, 3600, "t"),
        Ok(3600)
    );
    // 그 밖(문자열·실수·음수) → 오류(조용한 기본값 대체 없음).
    assert!(clamp_int_arg(Some(&json!("4")), 1, 1, 16, "c").is_err());
    assert!(clamp_int_arg(Some(&json!(2.5)), 1, 1, 16, "c").is_err());
    assert!(clamp_int_arg(Some(&json!(-3)), 1, 1, 16, "c").is_err());
}

#[test]
fn create_plan_dedups_targets_and_validates_concurrency() {
    // 중복 대상은 첫 등장 순서로 하나만 남는다(옵트인 필터 뒤).
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"uptime","targets":["web-2","web-1","web-2","web-1"],"concurrency":999}}}"#;
    let v = ok_text(dispatch_o(&m, &ops, &signal, body));
    assert_eq!(
        v["operation"]["targets"].as_array().unwrap(),
        &vec![json!("web-2"), json!("web-1")],
        "중복 제거·첫 등장 순서"
    );
    assert_eq!(
        v["operation"]["concurrency"], 16,
        "동시 실행은 상한으로 클램프"
    );

    // 잘못된 concurrency(문자열)는 오류이고 아무것도 저장하지 않는다.
    let ops2: OperationStore = Default::default();
    let bad = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"uptime","targets":["web-1"],"concurrency":"many"}}}"#;
    let e = parse_json(dispatch_o(&m, &ops2, &signal, bad));
    assert_eq!(e["result"]["isError"], true);
    assert!(ops2.lock().unwrap().is_empty(), "검증 실패면 저장 안 함");
}

#[test]
fn create_plan_with_no_shared_targets_is_an_error_and_saves_nothing() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"rm -rf /","targets":["prod","ghost"]}}}"#;
    let v = parse_json(dispatch_o(&m, &ops, &signal, body));
    assert_eq!(v["result"]["isError"], true);
    assert!(
        ops.lock().unwrap().is_empty(),
        "대상이 없으면 작업안도 없다"
    );
}

#[test]
fn create_plan_replays_same_idempotency_key_and_key_is_optional() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    // 같은 키로 두 번(재시도) — 두 번째는 새로 만들지 않고 첫 작업안을 그대로 돌려준다.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"uptime","targets":["web-1"],"idempotencyKey":"k1"}}}"#;
    let first = ok_text(dispatch_o(&m, &ops, &signal, body));
    let second = ok_text(dispatch_o(&m, &ops, &signal, body));
    let id1 = first["operationId"].as_str().unwrap();
    let id2 = second["operationId"].as_str().unwrap();
    assert_eq!(id1, id2, "같은 키 재시도는 같은 작업안을 재생한다");
    assert_eq!(first["operation"]["idempotencyKey"], "k1");
    assert_eq!(
        ops.lock().unwrap().len(),
        1,
        "재시도가 중복 저장하지 않는다"
    );

    // 키를 안 주면 예전 그대로 — 부를 때마다 새 작업안(하위 호환).
    let nokey = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"uptime","targets":["web-1"]}}}"#;
    let a = ok_text(dispatch_o(&m, &ops, &signal, nokey));
    let b = ok_text(dispatch_o(&m, &ops, &signal, nokey));
    assert_ne!(
        a["operationId"], b["operationId"],
        "키 없으면 매번 새 작업안"
    );
    assert_eq!(ops.lock().unwrap().len(), 3, "키 있는 1개 + 키 없는 2개");

    // 공백/NUL/과대 키는 오류(cwd·validate 와 같은 검증).
    let ops2: OperationStore = Default::default();
    let blank = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"uptime","targets":["web-1"],"idempotencyKey":"   "}}}"#;
    let e = parse_json(dispatch_o(&m, &ops2, &signal, blank));
    assert_eq!(e["result"]["isError"], true);
    assert!(ops2.lock().unwrap().is_empty(), "검증 실패면 저장 안 함");
}

/// `create_execution_plan` 을 선택 문자열 인자 하나(`name` = `value`)만 얹어 부른다 — 성공이면
/// 작업안 JSON, 오류면 오류 문장. 검증 실패면 저장소가 비어 있어야 한다(여기서 단언).
fn plan_with_optional_arg(name: &str, value: Option<Value>) -> Result<Value, String> {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let mut arguments = json!({"summary": "s", "effect": "read", "command": "uptime", "targets": ["web-1"]});
    if let Some(v) = value {
        arguments[name] = v;
    }
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "create_execution_plan", "arguments": arguments}
    })
    .to_string();
    let v = parse_json(dispatch_o(&m, &ops, &signal, &body));
    let text = v["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_string();
    if v["result"]["isError"] == true {
        assert!(
            ops.lock().unwrap().is_empty(),
            "{name}: 검증 실패면 저장 안 함"
        );
        Err(text)
    } else {
        Ok(serde_json::from_str(&text).unwrap())
    }
}

/// 승인 요약(docs/log/2026-10-21-approval-summary.md) — `summary` · `effect` 는 필수이고, 앱 분석은 원문으로 따로 매겨 어긋남을 적는다.
#[test]
fn create_plan_requires_summary_and_effect_and_flags_a_weaker_declaration() {
    let m = plan_store();
    let signal = McpSignal::default();
    let call = |arguments: Value| {
        let ops: OperationStore = Default::default();
        let body = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "create_execution_plan", "arguments": arguments}})
        .to_string();
        let v = parse_json(dispatch_o(&m, &ops, &signal, &body));
        let text = v["result"]["content"][0]["text"].as_str().unwrap().to_string();
        let stored = ops.lock().unwrap().len();
        (v["result"]["isError"] == true, text, stored)
    };
    // 없음 · 빈 글 · 제어 글자뿐 · 모르는 효과 → 오류, 저장 없음.
    for args in [
        json!({"command": "uptime", "targets": ["web-1"], "effect": "read"}),
        json!({"command": "uptime", "targets": ["web-1"], "summary": " \n\t ", "effect": "read"}),
        json!({"command": "uptime", "targets": ["web-1"], "summary": "\u{0007}", "effect": "read"}),
        json!({"command": "uptime", "targets": ["web-1"], "summary": "업타임"}),
        json!({"command": "uptime", "targets": ["web-1"], "summary": "업타임", "effect": "remove"}),
        json!({"command": "uptime", "targets": ["web-1"], "summary": 7, "effect": "read"}),
    ] {
        let (err, text, stored) = call(args.clone());
        assert!(err, "{args} → {text}");
        assert!(text.contains("summary") || text.contains("effect"), "{text}");
        assert_eq!(stored, 0, "검증 실패면 저장 안 함");
    }
    // 다듬기 — 줄바꿈은 빈칸, 300자에서 자름.
    let long = format!("로그\n{}", "가".repeat(400));
    let (err, text, _) = call(json!({"command": "du -ah /var/log | sort -rh | head", "targets": ["web-1"], "summary": long, "effect": "read"}));
    assert!(!err, "{text}");
    let v: Value = serde_json::from_str(&text).unwrap();
    let s = v["operation"]["summary"].as_str().unwrap();
    assert!(s.starts_with("로그 가") && s.chars().count() == 300 && s.ends_with('…'), "{s}");
    assert_eq!(v["operation"]["effect"], "read");
    assert_eq!(v["operation"]["analysis"]["effect"], "read");
    assert_eq!(v["operation"]["analysis"]["programs"], json!(["du", "sort", "head"]));
    assert_eq!(v["operation"]["mismatch"], false);
    // 선언이 약하다 — 읽기라 했지만 원문에 삭제.
    let (err, text, _) = call(json!({"command": "sudo find /var/log -name '*.gz' -delete", "targets": ["web-1"], "summary": "로그 크기 보기", "effect": "read"}));
    assert!(!err, "{text}");
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["operation"]["mismatch"], true);
    assert_eq!(v["operation"]["analysis"]["effect"], "delete");
    assert_eq!(v["operation"]["analysis"]["sudo"], true);
    assert_eq!(v["operation"]["targetLabels"]["web-1"], "web-1", "호스트 별칭이 먼저: {v}");
}

/// 요청한 타일의 이름표 — 타일 토큰 · 거울에 있을 때만(전역 토큰은 누구인지 모른다).
#[test]
fn requester_label_only_for_tile_callers_in_the_mirror() {
    use crate::orchestration::Caller;
    let m = plan_store();
    assert_eq!(super::plan::requester_label(&Caller::Global, &m), None);
    assert_eq!(super::plan::requester_label(&Caller::Tile { stream: "web-1".into() }, &m).as_deref(), Some("p1 web-01"));
    assert_eq!(super::plan::requester_label(&Caller::Tile { stream: "nope".into() }, &m), None);
}

#[test]
fn create_plan_validates_optional_string_args_cwd_validate_idempotency_key() {
    // 세 선택 인자(cwd · validate · idempotencyKey)는 같은 규칙으로 검증한다 — 인자 이름만 다르다.
    for (arg, field) in [
        ("cwd", "cwd"),
        ("validate", "validate"),
        ("idempotencyKey", "idempotencyKey"),
    ] {
        // 없음 → null(기본).
        let v = plan_with_optional_arg(arg, None).unwrap();
        assert_eq!(v["operation"][field], Value::Null, "{arg}: 없으면 null");
        // 문자열이 아니면(숫자·null) 없는 것과 같다 — 오류가 아니다.
        let v = plan_with_optional_arg(arg, Some(json!(42))).unwrap();
        assert_eq!(
            v["operation"][field],
            Value::Null,
            "{arg}: 비문자열은 없음 취급"
        );
        let v = plan_with_optional_arg(arg, Some(Value::Null)).unwrap();
        assert_eq!(
            v["operation"][field],
            Value::Null,
            "{arg}: null 은 없음 취급"
        );
        // 유효 → 앞뒤 공백을 떼어 저장.
        let v = plan_with_optional_arg(arg, Some(json!("  /srv/app x  "))).unwrap();
        assert_eq!(v["operation"][field], "/srv/app x", "{arg}: 앞뒤 공백 제거");
        // 비어/공백뿐 → 오류.
        assert_eq!(
            plan_with_optional_arg(arg, Some(json!(""))),
            Err(format!("{arg} cannot be empty"))
        );
        assert_eq!(
            plan_with_optional_arg(arg, Some(json!(" \t\n "))),
            Err(format!("{arg} cannot be empty"))
        );
        // NUL → 오류.
        assert_eq!(
            plan_with_optional_arg(arg, Some(json!("a\u{0}b"))),
            Err(format!("{arg} contains a NUL byte"))
        );
        // 길이 — 떼어 낸 뒤 4096 바이트까지는 통과, 4097 은 오류(바이트 기준: 한글 3바이트).
        let ok = "a".repeat(4096);
        let v = plan_with_optional_arg(arg, Some(json!(format!("  {ok}  ")))).unwrap();
        assert_eq!(v["operation"][field], ok.as_str(), "{arg}: 4096B 까지 통과");
        let too_long = format!("{arg} is too long (4096 bytes at most)");
        assert_eq!(
            plan_with_optional_arg(arg, Some(json!("a".repeat(4097)))),
            Err(too_long.clone())
        );
        assert_eq!(
            plan_with_optional_arg(arg, Some(json!("가".repeat(1366)))),
            Err(too_long)
        );
        // 검사 순서 — 비었는지가 먼저, 그다음 NUL, 그다음 길이.
        assert_eq!(
            plan_with_optional_arg(arg, Some(json!(format!("\u{0}{}", "a".repeat(5000))))),
            Err(format!("{arg} contains a NUL byte"))
        );
    }
}

#[test]
fn create_plan_checks_optional_args_in_order_cwd_then_validate_then_key() {
    // 셋 다 잘못이면 cwd 오류가 먼저, cwd 가 맞으면 validate, 그다음 idempotencyKey.
    let m = plan_store();
    let signal = McpSignal::default();
    let call = |args: Value| {
        let ops: OperationStore = Default::default();
        let mut arguments = json!({"summary": "s", "effect": "read", "command": "uptime", "targets": ["web-1"]});
        for (k, v) in args.as_object().unwrap() {
            arguments[k] = v.clone();
        }
        let body = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "create_execution_plan", "arguments": arguments}})
        .to_string();
        let v = parse_json(dispatch_o(&m, &ops, &signal, &body));
        assert_eq!(v["result"]["isError"], true);
        v["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .to_string()
    };
    assert_eq!(
        call(json!({"cwd": "", "validate": "", "idempotencyKey": ""})),
        "cwd cannot be empty"
    );
    assert_eq!(
        call(json!({"cwd": "/x", "validate": "", "idempotencyKey": ""})),
        "validate cannot be empty"
    );
    assert_eq!(
        call(json!({"cwd": "/x", "validate": "true", "idempotencyKey": ""})),
        "idempotencyKey cannot be empty"
    );
}

/// 단계가 다른 두 별칭을 담은 hand-built Delegation — `Deleg-Yes` 는 'Ask'(read+propose),
/// `Deleg-No` 는 '읽기 전용'(read), `Deleg-Odd` 는 읽기 없이 propose 만 적힌 비누적 옛 조합.
/// `Delegation::load_default()`(실제 파일)에 의존하지 않도록 순수 파서로 짓는다.
fn eligibility_delegation() -> crate::delegation::Delegation {
    crate::delegation::Delegation::parse(
        "\
[[target]]
alias = \"Deleg-Yes\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true

[[target]]
alias = \"Deleg-No\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = false

[[target]]
alias = \"Deleg-Odd\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
propose = true
",
    )
    .unwrap()
}

fn ctx_of(
    owner_kind: crate::session_owner::SessionOwnerKind,
    opted_in: bool,
    label: &str,
) -> SessionContext {
    SessionContext {
        owner_kind,
        opted_in,
        label: label.to_string(),
        ..Default::default()
    }
}

/// 창 타일 하나 — `kind`(`"ssh"`/`"local"`)와 호스트 별칭(`None` = 호스트 목록 밖)을 정한다.
fn tile_of(kind: &str, opted_in: bool, host_alias: Option<&str>) -> SessionContext {
    SessionContext {
        kind: kind.to_string(),
        opted_in,
        label: host_alias.unwrap_or("adhoc").to_string(),
        host_alias: host_alias.map(str::to_string),
        ..Default::default()
    }
}

#[test]
fn plan_target_eligible_follows_the_host_permission_for_tiles_and_headless_alike() {
    use crate::session_owner::SessionOwnerKind::Delegated;
    let delegation = eligibility_delegation();

    // 원격 창 타일: 호스트 별칭의 누적 read && propose — 타일의 opted_in 은 보지 않는다.
    assert!(plan_target_eligible(
        &tile_of("ssh", false, Some("Deleg-Yes")),
        &delegation
    ));
    assert!(
        !plan_target_eligible(&tile_of("ssh", true, Some("Deleg-No")), &delegation),
        "읽기 전용 호스트의 타일은 대상이 아니다"
    );
    assert!(
        !plan_target_eligible(&tile_of("ssh", true, Some("Deleg-Odd")), &delegation),
        "비누적 옛 조합(read 없이 propose)은 대상이 아니다"
    );
    assert!(
        !plan_target_eligible(&tile_of("ssh", true, None), &delegation),
        "호스트 목록 밖 원격 타일은 대상이 아니다"
    );
    // 로컬 타일: 읽기 허용이 켜져 있어도 실행 권한이 없다(예전엔 opted_in 이면 대상이었다).
    assert!(!plan_target_eligible(
        &tile_of("local", true, None),
        &delegation
    ));

    // 헤드리스 세션: 같은 별칭 권한.
    assert!(
        plan_target_eligible(&ctx_of(Delegated, false, "Deleg-Yes"), &delegation),
        "승인 후 실행 위임(opted_in=false)은 대상이다"
    );
    assert!(
        !plan_target_eligible(&ctx_of(Delegated, false, "Deleg-No"), &delegation),
        "읽기 전용 위임 대상은 대상이 아니다"
    );
    // 목록에 없는 위임 별칭도 제외(위임은 명시로만).
    assert!(!plan_target_eligible(
        &ctx_of(Delegated, false, "Not-Listed"),
        &delegation
    ));
}

#[test]
fn plan_filter_mixes_window_tiles_and_delegated_targets_by_host_permission() {
    // 디스패치 필터가 하는 일을 순수 helper 로 재현한다(실제 위임 파일 불필요):
    // 창 타일과 헤드리스 세션이 **같은 호스트 권한**으로 섞여 대상이 되고, 나머지는 빠진다.
    use crate::session_owner::SessionOwnerKind::Delegated;
    let delegation = eligibility_delegation();
    let entries = [
        ("w-yes", tile_of("ssh", true, Some("Deleg-Yes"))), // 승인 후 실행 호스트 → 남는다
        ("w-no", tile_of("ssh", true, Some("Deleg-No"))),   // 읽기 전용 호스트 → 빠진다
        ("w-local", tile_of("local", true, None)),          // 로컬 → 빠진다
        ("f-yes", ctx_of(Delegated, false, "Deleg-Yes")),   // 헤드리스 → 남는다
        ("f-no", ctx_of(Delegated, false, "Deleg-No")),     // 헤드리스 읽기 전용 → 빠진다
    ];
    let kept: Vec<&str> = entries
        .iter()
        .filter(|(_, c)| plan_target_eligible(c, &delegation))
        .map(|(id, _)| *id)
        .collect();
    assert_eq!(
        kept,
        vec!["w-yes", "f-yes"],
        "'Ask' 이상인 호스트의 세션만 남는다"
    );
}

/// 디스패치를 거친 끝에서 끝 — 로컬 타일은 읽히지만 작업안 대상이 될 수 없다.
#[test]
fn create_execution_plan_rejects_local_tiles_and_read_only_hosts() {
    let mut m = HashMap::new();
    m.insert("loc".to_string(), tile_of("local", true, None));
    m.insert("ro".to_string(), tile_of("ssh", true, Some("Deleg-No")));
    m.insert("ok".to_string(), tile_of("ssh", true, Some("Deleg-Yes")));
    let body = |targets: &str| {
        format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"create_execution_plan","arguments":{{"summary":"s","effect":"read","command":"uptime","targets":{targets}}}}}}}"#
        )
    };
    // 로컬·읽기 전용만 → 남는 대상이 없어 오류.
    let v = parse_json(dispatch_d(&m, eligibility_delegation(), &body(r#"["loc","ro"]"#)));
    assert_eq!(v["result"]["isError"], true, "{v}");
    // 섞어 주면 승인 후 실행 호스트의 타일만 남는다.
    let v = parse_json(dispatch_d(
        &m,
        eligibility_delegation(),
        &body(r#"["loc","ro","ok"]"#),
    ));
    let text = v["result"]["content"][0]["text"].as_str().unwrap();
    let created: Value = serde_json::from_str(text).unwrap();
    assert_eq!(created["operation"]["targets"], json!(["ok"]), "{created}");
    // 읽기는 된다 — 로컬(읽기 허용)과 읽기 전용 호스트의 타일은 목록에 보인다.
    let v = parse_json(dispatch_d(
        &m,
        eligibility_delegation(),
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_sessions","arguments":{}}}"#,
    ));
    let text = v["result"]["content"][0]["text"].as_str().unwrap();
    let mut ids: Vec<String> = serde_json::from_str::<Value>(text).unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_string())
        .collect();
    ids.sort();
    assert_eq!(ids, vec!["loc", "ok", "ro"]);
}

#[test]
fn plan_target_id_eligible_accepts_not_live_delegated_id_by_read_and_propose() {
    use crate::session_owner::SessionOwnerKind::Window;
    // read/propose 조합을 손으로 짠 위임 — 거울 없이 판정한다(실제 delegation.toml 불필요, A2b).
    let delegation = crate::delegation::Delegation::parse(
        "\
[[target]]
alias = \"both\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = true

[[target]]
alias = \"no-read\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = false
propose = true

[[target]]
alias = \"no-propose\"
expect_user = \"u\"
expect_host = \"h\"
expect_port = 22
read = true
propose = false
",
    )
    .unwrap();
    let empty: HashMap<String, SessionContext> = HashMap::new();

    // (b) 거울에 없는 delegated:<alias> — read+propose 둘 다면 자격.
    assert!(
        plan_target_id_eligible("delegated:both", &empty, &delegation),
        "read+propose 위임된 not-live 위임 id 는 대상이다"
    );
    // read 없으면 거부(propose 만으론 부족 — not-live 경로는 둘 다 요구).
    assert!(
        !plan_target_id_eligible("delegated:no-read", &empty, &delegation),
        "read 없는 not-live 위임 id 는 거부"
    );
    // propose 없으면 거부.
    assert!(
        !plan_target_id_eligible("delegated:no-propose", &empty, &delegation),
        "propose 없는 not-live 위임 id 는 거부"
    );
    // 목록에 없는 별칭·delegation 접두 없는 미지 id 는 거부(위임은 명시로만).
    assert!(!plan_target_id_eligible(
        "delegated:ghost",
        &empty,
        &delegation
    ));
    assert!(!plan_target_id_eligible(
        "some-random-id",
        &empty,
        &delegation
    ));

    // (a) 거울에 있는 창 타일은 호스트 별칭의 권한으로 자격(id 형태 무관).
    let mut m: HashMap<String, SessionContext> = HashMap::new();
    let mut w = ctx_of(Window, true, "web");
    w.kind = "ssh".into();
    w.host_alias = Some("both".into());
    m.insert("w".into(), w);
    assert!(
        plan_target_id_eligible("w", &m, &delegation),
        "승인 후 실행 호스트의 창 타일은 (a)로 자격"
    );
    // 같은 타일이라도 별칭이 없으면(호스트 목록 밖) 자격이 없다 — opted_in 과 무관.
    m.get_mut("w").unwrap().host_alias = None;
    assert!(!plan_target_id_eligible("w", &m, &delegation));
}

#[test]
fn request_execution_flags_review_without_executing() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    // 1) 초안 저장.
    let created = ok_text(dispatch_o(
        &m,
        &ops,
        &signal,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"systemctl restart nginx","targets":["web-1","web-2"],"title":"nginx 재시작"}}}"#,
    ));
    let id = created["operationId"].as_str().unwrap().to_string();
    // 2) 검토 요청 — 상태만 awaitingApproval 로. **실행이 아니다.**
    let body = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"request_execution","arguments":{{"operationId":"{id}"}}}}}}"#
    );
    let v = ok_text(dispatch_o(&m, &ops, &signal, &body));
    assert_eq!(v["state"], "awaitingApproval");
    // 검토 대기 만료(TTL) — 요청 시각은 찍혔고, 만료 창의 길이도 응답에 실린다. 값 자체는
    // 사용자의 `settings.toml` 을 타므로(기본 30분·0 이면 만료 없음) **칸이 있는지**만 본다.
    assert!(v["requestedAt"].is_i64(), "requestedAt 이 찍힌다: {v}");
    assert!(
        v.get("expiresAt").is_some(),
        "expiresAt 칸이 있다(만료 없음이면 null): {v}"
    );
    assert!(
        v.get("approvalTtlSeconds").is_some(),
        "approvalTtlSeconds 칸이 있다: {v}"
    );
    // 우편함(전역 등록 해제 이관의 한 줄)은 ③-3c 부터 GUI 의 `McpState` 에 있다 — 신호에는 내보내기 칸만 남았다.
    // 저장소 상태는 awaitingApproval — 실행/승인 상태로 넘어가지 않는다(그런 상태가 없다).
    assert_eq!(
        ops.lock().unwrap()[&id].state,
        operations::OperationState::AwaitingApproval
    );
}

/// **내보내기가 꽂히기 전에도** 검토 요청은 그대로 선다 — emit 은 조용히 건너뛴다.
///
/// 서버 스레드는 `setup` 이 손잡이를 꽂기 전(부팅 몇 밀리초)이나 창이 없는 판에서도 돌 수
/// 있다. 그 자리에서 패닉하거나 오류를 내면 AI 는 이유도 모른 채 요청에 실패한다
/// (docs/log/2026-09-22-review-request-signal.md).
#[test]
fn signal_without_app_handle_is_a_quiet_noop() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default(); // 내보내기 칸이 비어 있다.
    assert!(signal.emit.lock().unwrap().is_none());
    // 꽂힌 것 없는 emit 두 번 — 아무 일도 일어나지 않아야 한다(패닉 없음).
    signal.emit_state("op-none", operations::OperationState::Expired);
    signal.emit_state("op-none", operations::OperationState::AwaitingApproval);

    let created = ok_text(dispatch_o(
        &m,
        &ops,
        &signal,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"uptime","targets":["web-1"]}}}"#,
    ));
    let id = created["operationId"].as_str().unwrap().to_string();
    let body = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"request_execution","arguments":{{"operationId":"{id}"}}}}}}"#
    );
    let v = ok_text(dispatch_o(&m, &ops, &signal, &body));
    assert_eq!(
        v["state"], "awaitingApproval",
        "손잡이가 없어도 요청은 선다: {v}"
    );
}

#[test]
fn get_operation_reads_state_and_unknown_is_error() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let created = ok_text(dispatch_o(
        &m,
        &ops,
        &signal,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"ls","targets":["web-1"]}}}"#,
    ));
    let id = created["operationId"].as_str().unwrap().to_string();
    let body = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"get_operation","arguments":{{"operationId":"{id}"}}}}}}"#
    );
    let v = ok_text(dispatch_o(&m, &ops, &signal, &body));
    assert_eq!(v["operationId"], id);
    assert_eq!(v["state"], "draft");
    // 초안은 아직 요청 전 — 두 시각은 null 이고 TTL 칸만 있다.
    assert!(v["requestedAt"].is_null(), "{v}");
    assert!(v["expiresAt"].is_null(), "{v}");
    assert!(v.get("approvalTtlSeconds").is_some(), "{v}");
    // 없는 id → 오류.
    let bad = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_operation","arguments":{"operationId":"op-nope"}}}"#;
    assert_eq!(
        parse_json(dispatch_o(&m, &ops, &signal, bad))["result"]["isError"],
        true
    );
}

// ---- 검토 대기 롱폴 (`wait_for_operation`, 2026-09-22) ----

/// 초안 하나를 만들고 id 를 준다(작업안 도구 테스트의 공통 첫 줄).
fn new_draft(
    m: &HashMap<String, SessionContext>,
    ops: &OperationStore,
    signal: &McpSignal,
) -> String {
    let created = ok_text(dispatch_o(
        m,
        ops,
        signal,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_execution_plan","arguments":{"summary":"s","effect":"read","command":"uptime","targets":["web-1"]}}}"#,
    ));
    created["operationId"].as_str().unwrap().to_string()
}

fn wait_body(id: &str, timeout: u32) -> String {
    format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"wait_for_operation","arguments":{{"operationId":"{id}","timeoutSeconds":{timeout}}}}}}}"#
    )
}

/// **기다릴 것이 없으면 즉시 돌아온다.** 초안은 기다림 셋에 없다 — 검토를 요청하지 않은
/// 작업안을 기다리면 영원히 안 오므로, 그 자리에서 상태를 돌려주고 끝낸다.
#[test]
fn wait_returns_at_once_for_a_draft() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let id = new_draft(&m, &ops, &signal);

    let t0 = std::time::Instant::now();
    let v = ok_text(dispatch_o(&m, &ops, &signal, &wait_body(&id, 60)));
    assert!(
        t0.elapsed() < Duration::from_secs(2),
        "즉시 돌아와야 한다: {:?}",
        t0.elapsed()
    );
    assert_eq!(v["state"], "draft");
    assert_eq!(v["timedOut"], false);
    assert_eq!(v["waitedSeconds"], 0);
    // `get_operation` 과 같은 칸들이 그대로 실린다(모양이 하나여야 갈아탈 수 있다).
    assert!(v.get("expiresAt").is_some(), "{v}");
    assert!(v.get("approvalTtlSeconds").is_some(), "{v}");

    // 없는 id 는 기다리지 않고 오류다.
    let bad = wait_body("op-nope", 60);
    assert_eq!(
        parse_json(dispatch_o(&m, &ops, &signal, &bad))["result"]["isError"],
        true
    );
}

/// **아무도 승인하지 않으면 `timedOut:true` 로 돌아온다** — 대기 상태 그대로.
/// 1초짜리 대기만 쓴다(테스트가 벽시계를 오래 먹지 않게).
#[test]
fn wait_times_out_while_awaiting_approval() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let id = new_draft(&m, &ops, &signal);
    let req = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"request_execution","arguments":{{"operationId":"{id}"}}}}}}"#
    );
    assert_eq!(
        ok_text(dispatch_o(&m, &ops, &signal, &req))["state"],
        "awaitingApproval"
    );

    let t0 = std::time::Instant::now();
    let v = ok_text(dispatch_o(&m, &ops, &signal, &wait_body(&id, 1)));
    let waited = t0.elapsed();
    assert!(
        waited >= Duration::from_millis(900),
        "1초는 기다린다: {waited:?}"
    );
    assert!(
        waited < Duration::from_secs(5),
        "1초짜리 대기가 오래 끌면 안 된다: {waited:?}"
    );
    assert_eq!(v["state"], "awaitingApproval");
    assert_eq!(v["timedOut"], true);
    assert_eq!(v["waitedSeconds"], 1);
}

/// **상태가 바뀌면 곧바로 돌아온다** — 다른 스레드(= 앱의 승인/거절 경로)가 저장소를
/// 고치는 것을 250ms 안에 본다. 여기서는 거절로 종료 상태를 만든다(승인은 `approved` 라
/// 여전히 기다림 셋이다 — 그것이 이 셋의 요점이다).
#[test]
fn wait_returns_promptly_when_another_thread_rejects() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let id = new_draft(&m, &ops, &signal);
    let req = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"request_execution","arguments":{{"operationId":"{id}"}}}}}}"#
    );
    ok_text(dispatch_o(&m, &ops, &signal, &req));

    let ops_other = Arc::clone(&ops);
    let id_other = id.clone();
    let changer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        let mut map = ops_other.lock().unwrap();
        operations::reject(&mut map, &id_other).unwrap();
    });

    let t0 = std::time::Instant::now();
    let v = ok_text(dispatch_o(&m, &ops, &signal, &wait_body(&id, 30)));
    let waited = t0.elapsed();
    changer.join().unwrap();
    assert_eq!(v["state"], "rejected");
    assert_eq!(v["timedOut"], false, "상태가 바뀌어 돌아온 것이다: {v}");
    assert!(
        waited < Duration::from_secs(5),
        "바뀌자마자 돌아와야 한다: {waited:?}"
    );
}

/// **TTL 로 만료된 검토 요청은 기다리지 않고 `expired`** — `get_operation` 과 같은 게으른
/// 만료를 매 확인마다 돌리기 때문이다.
///
/// TTL 을 **인자로** 넣어 부른다([`wait_for_operation_with`]) — 사용자의 `settings.toml`
/// 이 `0`(만료 없음)일 수도 있어 dispatch 로 부르면 판마다 답이 달라진다.
#[test]
fn wait_reports_expired_when_the_review_window_ran_out() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let id = new_draft(&m, &ops, &signal);
    {
        let mut map = ops.lock().unwrap();
        operations::request(&mut map, &id, operations::now_ms(), 60_000).unwrap();
        // 만료 시각을 과거로 — 시계를 기다리지 않고 "이미 늦은" 판을 만든다.
        map.get_mut(&id).unwrap().expires_at = Some(operations::now_ms() as i64 - 1);
    }

    let args = json!({ "operationId": id, "timeoutSeconds": 60 });
    let t0 = std::time::Instant::now();
    let v = wait_for_operation_with(&ops, &signal, Some(&args), 60_000).expect("만료도 결과다");
    assert!(
        t0.elapsed() < Duration::from_secs(2),
        "즉시 돌아와야 한다: {:?}",
        t0.elapsed()
    );
    assert_eq!(v["state"], "expired");
    assert_eq!(v["timedOut"], false);
}

/// `timeoutSeconds` 는 1..120 으로 클램프된다 — 0 을 줘도 한 번은 보고, 그 자리에서 끝난다.
#[test]
fn wait_timeout_argument_is_clamped_and_optional() {
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let id = new_draft(&m, &ops, &signal);
    // 0 → 1초로 클램프. 초안이라 어차피 즉시 돌아온다(대기 셋이 아니다).
    let v = ok_text(dispatch_o(&m, &ops, &signal, &wait_body(&id, 0)));
    assert_eq!(v["timedOut"], false);
    // 인자를 아예 안 주면 기본 60초 — 초안이라 역시 즉시.
    let body = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"wait_for_operation","arguments":{{"operationId":"{id}"}}}}}}"#
    );
    assert_eq!(
        ok_text(dispatch_o(&m, &ops, &signal, &body))["state"],
        "draft"
    );
    // 숫자가 아닌 값은 조용히 기본값이 되지 않고 오류다(`clamp_int_arg` 규칙).
    let bad = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"wait_for_operation","arguments":{{"operationId":"{id}","timeoutSeconds":"soon"}}}}}}"#
    );
    assert_eq!(
        parse_json(dispatch_o(&m, &ops, &signal, &bad))["result"]["isError"],
        true
    );
}

/// 기다림 셋은 셋뿐이다 — 순수 함수로 못 박는다(초안이 여기 들면 영원히 기다린다).
#[test]
fn waiting_state_is_awaiting_approved_running_only() {
    use operations::OperationState as S;
    for s in [S::AwaitingApproval, S::Approved, S::Running] {
        assert!(waiting_state(s), "{s:?}");
    }
    for s in [
        S::Draft,
        S::Rejected,
        S::Expired,
        S::Succeeded,
        S::Partial,
        S::Failed,
        S::Cancelled,
    ] {
        assert!(!waiting_state(s), "{s:?}");
    }
}

// ---- CLI 설치 감지 · 이관 해제 인자 ----

#[test]
fn ai_cli_list_maps_adapters_to_command_and_name() {
    assert_eq!(ADAPTERS.iter().map(|a| (a.id, a.display, a.bin)).collect::<Vec<_>>(),
        vec![("claude", "Claude Code", "claude"), ("codex", "Codex", "codex")]);
    assert_eq!(CliAdapter::remove_args(&["--scope", "user"], MCP_NAME),
        vec!["mcp", "remove", MCP_NAME, "--scope", "user"]);
}

#[test]
fn mcp_token_env_follows_the_instance() {
    assert_eq!(MCP_TOKEN_ENV, crate::instance::mcp_token_env(crate::instance::DEV));
    assert_eq!(crate::instance::mcp_token_env(false), "AYNX_MCP_TOKEN");
}

// ---- 실제 소켓 왕복 (401 · initialize) ----

/// 임시 포트에 서버를 띄우고 원시 HTTP 로 두드려 인증·initialize 를 확인한다.
///
/// **F4 의 회귀 그물이기도 하다**: 여기 요청들은 등록 URL(`endpoint_url` = `127.0.0.1:<port>`)
/// 을 실제로 두드리는 클라이언트와 똑같이 `Host: 127.0.0.1:{port}` 를 싣는다. 출처 확인이
/// 정상 경로를 막으면 이 테스트가 403 으로 먼저 깨진다.
#[test]
fn live_server_rejects_missing_auth_and_serves_initialize() {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::{Arc, Mutex};

    // 루프백 포트를 잡는 테스트끼리 직렬화한다 (crate::test_support 참고).
    let _net = crate::test_support::NET_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    let mut map = HashMap::new();
    report(
        &mut map,
        "w:1".into(),
        "web".into(),
        "ssh".into(),
        String::new(),
        true,
    );
    let store: Store = Arc::new(Mutex::new(map));

    let server = tiny_http::Server::http(("127.0.0.1", 0)).unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let token = "testtoken".to_string();
    let t2 = token.clone();
    let ops: OperationStore = Default::default();
    let results: ResultStore = Default::default();
    let signal: Arc<McpSignal> = Arc::new(McpSignal::default());
    // 활동 도장 — 서버가 실제로 찍는지 아래에서 확인한다(상태바 `✦ AI 연결` 의 출처).
    let last_seen: Arc<Mutex<Option<McpActivity>>> = Arc::new(Mutex::new(None));
    let seen = Arc::clone(&last_seen);
    std::thread::spawn(move || serve(server, store, ops, results, signal, last_seen, t2, port));

    // 원시 HTTP 요청을 보내고 상태 줄을 읽는 헬퍼.
    let send = |req: &str| -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).unwrap();
        buf
    };

    // 인증 없음 → 401.
    let no_auth = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    assert!(
        send(&no_auth).starts_with("HTTP/1.1 401"),
        "인증 없이 통과되면 안 된다"
    );
    // 401 은 **도장을 찍지 않는다** — 아무나 두드려서 "AI 연결됨" 을 켤 수 없어야 한다.
    assert_eq!(*seen.lock().unwrap(), None, "인증 전에는 활동 도장이 없다");

    // 올바른 토큰 + initialize → 200 + protocolVersion.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
    let ok = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let resp = send(&ok);
    assert!(resp.starts_with("HTTP/1.1 200"), "{resp}");
    assert!(resp.contains(PROTOCOL_VERSION), "{resp}");
    // 인증을 지난 `initialize` 는 도장을 남긴다(이름은 안 실었으니 `None`).
    let stamp = seen
        .lock()
        .unwrap()
        .clone()
        .expect("initialize 가 도장을 남겨야 한다");
    assert_eq!(stamp.client, None);
    assert!(stamp.at_ms > 0, "시각이 찍혀야 한다");

    // GET → 405.
    let get = format!(
        "GET /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nConnection: close\r\n\r\n"
    );
    assert!(send(&get).starts_with("HTTP/1.1 405"));

    // 남의 Host(DNS 리바인딩) → 토큰이 맞아도 403 (F4).
    let rebind = format!(
        "POST /mcp HTTP/1.1\r\nHost: evil.com:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    assert!(send(&rebind).starts_with("HTTP/1.1 403"));

    // 브라우저가 붙이는 Origin 이 있으면 역시 403.
    let with_origin = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    assert!(send(&with_origin).starts_with("HTTP/1.1 403"));

    // 본문 상한 초과(백로그 #7) → 413. Content-Length 만 크게 선언하면(본문은 안 보낸다)
    // 서버가 **읽기 전에** 거부한다 — 무제한 읽기 방지의 요점이다.
    let oversized = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        MAX_BODY_BYTES + 1
    );
    assert!(
        send(&oversized).starts_with("HTTP/1.1 413"),
        "상한 초과 본문은 413"
    );
}

/// ③-3a — `/agent-signal` 은 MCP 포트에 없다(세션 서버의 신호 평면이 받는다 — `crate::server::signal_http` 의 시험). 토큰이
/// 맞아도 404.
#[test]
fn mcp_port_no_longer_takes_agent_signals() {
    use std::io::{Read, Write};
    let _net = crate::test_support::NET_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let port = spawn_limited_server(None, 8);
    let body = r#"{"stream":"abc123","event":"stop"}"#;
    let req = format!(
        "POST /agent-signal HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.write_all(req.as_bytes()).unwrap();
    let mut buf = String::new();
    s.read_to_string(&mut buf).unwrap();
    assert!(buf.starts_with("HTTP/1.1 404"), "{buf}");
}

#[test]
fn agent_signal_is_not_an_mcp_tool() {
    let names: Vec<String> = tools_list_result()["tools"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["name"].as_str().map(str::to_owned))
        .collect();
    assert!(names.iter().all(|n| !n.contains("signal")), "{names:?}");
}

#[test]
fn base_url_is_the_endpoint_without_the_path() {
    assert_eq!(base_url(53812), "http://127.0.0.1:53812");
    assert_eq!(endpoint_url(53812), "http://127.0.0.1:53812/mcp");
    assert_eq!(MCP_URL_ENV, "AYNX_MCP_URL");
    assert_eq!(STREAM_ENV, "AYNX_STREAM");
    assert_eq!(SIGNAL_TOKEN_ENV, "AYNX_SIGNAL_TOKEN");
}

// ---- mcp.json 왕복 (③-3c 부터 세션 서버가 쓴다 — 포트는 지속하지 않는다) ----

/// 이 테스트 전용 임시 경로(같은 파일을 두 테스트가 밟지 않게 이름을 유일하게 만든다).
fn temp_config_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir()
        .join(format!("aynx-test-{}-{tag}-{nanos}", std::process::id()))
        .join("mcp.json")
}

#[test]
fn config_round_trips_port_and_token() {
    let path = temp_config_path("cfg");
    assert!(load_config_at(&path).is_none(), "없는 파일은 None 이다");

    save_config_at(&path, 58599, "deadbeef").unwrap(); // 부모 디렉터리도 만들어 준다
    let back = load_config_at(&path).expect("방금 쓴 파일을 읽어야 한다");
    assert_eq!(back.port, 58599);
    assert_eq!(back.token, "deadbeef");

    // 포트만 갈아도 토큰은 그대로 실려 나간다(재등록 없이 헤더가 살아 있어야 한다).
    save_config_at(&path, 61000, &back.token).unwrap();
    let back = load_config_at(&path).unwrap();
    assert_eq!(back.port, 61000);
    assert_eq!(back.token, "deadbeef");

    // 깨진 내용은 None — 새 포트·새 토큰으로 다시 시작한다.
    std::fs::write(&path, "{ not json").unwrap();
    assert!(load_config_at(&path).is_none());

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

// ---- 옛 홈 폴더 정리 ----

/// 이 테스트 전용 임시 "홈"(같은 폴더를 두 테스트가 밟지 않게 이름을 유일하게 만든다).
fn temp_home(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let home = std::env::temp_dir().join(format!("aynx-home-{}-{tag}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&home).expect("임시 홈");
    home
}

/// 실제 후보는 지금 비어 있다(2026-10-22 2차 — docs/log/2026-10-22-rename-aynx.md). 기계
/// (`settings::rename_first_legacy_dir` — 최근 이름 먼저 · 첫 하나만)는 다음 개명을 위해 남겼고, 가짜 이름으로 잰다.
const RECENT_LEGACY_HOME: &str = ".recent-name-for-test";
/// 규칙 시험용 가짜 더 옛 이름 — 실제 후보가 아니다.
const OLDER_FAKE_HOME: &str = ".older-name-for-test";
const HOME_CHAIN: &[&str] = &[RECENT_LEGACY_HOME, OLDER_FAKE_HOME];

#[test]
fn legacy_home_dir_candidates_are_empty_now() {
    assert!(LEGACY_HOME_DIRS.is_empty());
}

#[test]
fn recent_legacy_home_dir_wins_and_older_ones_are_left_alone() {
    let home = temp_home("이전-옛폴더셋");
    let recent = home.join(RECENT_LEGACY_HOME);
    let older = home.join(OLDER_FAKE_HOME);
    // 두 세대가 **동시에** 남아 있는 경우 — 가장 최근 것 하나만 옮긴다.
    save_config_at(&recent.join("mcp.json"), 4444, "recent").expect("최근 mcp.json");
    save_config_at(&older.join("mcp.json"), 2020, "older").expect("더 옛 mcp.json");

    assert!(migrate_home_dir_at(&home, HOME_CHAIN, HOME_DIR), "하나는 옮겼어야 한다");

    assert!(!recent.exists(), "최근 옛 폴더만 사라진다");
    let back = load_config_at(&home.join(HOME_DIR).join("mcp.json")).expect("보존된 설정");
    assert_eq!(back.port, 4444);
    assert_eq!(back.token, "recent");
    // 더 옛 폴더는 **그대로 남는다** — 합치지도, 지우지도 않는다.
    assert_eq!(load_config_at(&older.join("mcp.json")).unwrap().port, 2020);

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn legacy_home_dir_is_moved_and_mcp_json_survives() {
    let home = temp_home("이전");
    let old = home.join(RECENT_LEGACY_HOME);
    std::fs::create_dir_all(&old).expect("옛 폴더");
    save_config_at(&old.join("mcp.json"), 53812, "deadbeef").expect("옛 mcp.json");

    assert!(migrate_home_dir_at(&home, &[RECENT_LEGACY_HOME], HOME_DIR), "옮겼어야 한다");

    assert!(!old.exists(), "옛 폴더는 사라진다");
    let back = load_config_at(&home.join(HOME_DIR).join("mcp.json")).expect("보존된 설정");
    assert_eq!(back.port, 53812);
    assert_eq!(back.token, "deadbeef");

    // 두 번째 부팅 — 새 폴더가 이미 있으니 아무 일도 없다.
    assert!(!migrate_home_dir_at(&home, &[RECENT_LEGACY_HOME], HOME_DIR));

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn existing_home_dir_wins_and_every_legacy_is_left_alone() {
    let home = temp_home("이전-새폴더있음");
    let new = home.join(HOME_DIR);
    save_config_at(&new.join("mcp.json"), 2222, "new").expect("새 mcp.json");
    save_config_at(&home.join(RECENT_LEGACY_HOME).join("mcp.json"), 1111, "old")
        .expect("최근 옛 mcp.json");
    save_config_at(&home.join(OLDER_FAKE_HOME).join("mcp.json"), 1010, "older")
        .expect("더 옛 mcp.json");

    assert!(!migrate_home_dir_at(&home, HOME_CHAIN, HOME_DIR), "옮기지 않는다");

    // 새 것이 이기고, **옛 폴더도 하나도 지우지 않는다**.
    assert_eq!(load_config_at(&new.join("mcp.json")).unwrap().port, 2222);
    assert_eq!(
        load_config_at(&home.join(RECENT_LEGACY_HOME).join("mcp.json"))
            .unwrap()
            .port,
        1111
    );
    assert_eq!(
        load_config_at(&home.join(OLDER_FAKE_HOME).join("mcp.json"))
            .unwrap()
            .port,
        1010
    );

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn no_legacy_home_dir_is_a_noop() {
    let home = temp_home("이전-없음");
    assert!(!migrate_home_dir_at(&home, LEGACY_HOME_DIRS, HOME_DIR));
    assert!(!home.join(HOME_DIR).exists(), "새 폴더를 만들지도 않는다");
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn workspace_metadata_is_additive_and_does_not_change_visibility_or_identity() {
    let mut map = store_with_samples();
    let shared = map.get_mut("w:1").unwrap();
    shared.workspace_id = Some("workspace-A".into());
    shared.workspace_name = Some("Alpha".into());
    shared.tab_key = Some("persistent-tab".into());
    shared.owner = "tear-7".into();
    let hidden = map.get_mut("w:2").unwrap();
    hidden.workspace_id = Some("workspace-B".into());
    hidden.workspace_name = Some("Beta".into());
    let rows = enrich_t(&map, None);
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], "w:1");
    assert_eq!(rows[0]["code"], "p2");
    assert_eq!(rows[0]["windowLabel"], "tear-7");
    assert_eq!(rows[0]["workspaceId"], "workspace-A");
    assert_eq!(rows[0]["workspace"], "Alpha");
    assert_eq!(rows[0]["tabKey"], "persistent-tab");
    let legacy = enrich_t(&store_with_samples(), None);
    assert!(legacy[0]["workspace"].is_null());
    assert_eq!(legacy[0]["mode"], rows[0]["mode"]);
}

// ---- 읽기 시한 · 동시 요청 상한 (mcp/http.rs) ----

/// 시험용 서버 하나를 띄운다 — 시한·상한만 주입하고 나머지는 빈 저장소. 포트를 돌려준다.
fn spawn_limited_server(read_timeout: Option<Duration>, max_inflight: usize) -> u16 {
    spawn_limited_server_on(read_timeout, max_inflight, HashMap::new(), Default::default())
}

fn spawn_limited_server_on(
    read_timeout: Option<Duration>,
    max_inflight: usize,
    map: HashMap<String, SessionContext>,
    ops: OperationStore,
) -> u16 {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let server = match read_timeout {
        Some(t) => http_server_with(listener, t).unwrap(),
        None => tiny_http::Server::from_listener(listener, None).unwrap(),
    };
    let port = server.server_addr().to_ip().unwrap().port();
    let store: Store = Arc::new(Mutex::new(map));
    let results: ResultStore = Default::default();
    let signal: Arc<McpSignal> = Arc::new(McpSignal::default());
    let last_seen: Arc<Mutex<Option<McpActivity>>> = Arc::new(Mutex::new(None));
    std::thread::spawn(move || {
        serve_with(
            server,
            store,
            ops,
            results,
            signal,
            last_seen,
            "testtoken".into(),
            port,
            max_inflight,
        )
    });
    port
}

/// 연결 하나를 열어 `head` 만 쓰고, 서버가 닫을 때까지 읽는다(손님 쪽 시한 5초). 받은 것과 걸린 시간.
fn hold_and_read(port: u16, head: &str) -> (String, Duration) {
    use std::io::{Read, Write};
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let start = std::time::Instant::now();
    s.write_all(head.as_bytes()).unwrap();
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf); // 끊김(EOF·RST)이면 여기서 돌아온다
    (String::from_utf8_lossy(&buf).into_owned(), start.elapsed())
}

/// 본문(또는 헤더)을 안 보내고 붙드는 연결은 읽기 시한 안에 끊긴다 — 인증 전의 `/agent-signal` 이
/// 스레드를 무기한 잡지 못한다. 놀고 있던 리스너도 시한 때문에 죽지 않는다(Windows 의 `accept` 는
/// `SO_RCVTIMEO` 를 보지 않는다 — 리눅스는 본다, 그래서 그 OS 는 스텁이다).
#[cfg(windows)]
#[test]
fn live_server_drops_a_stalled_request_within_the_read_timeout() {
    let _net = crate::test_support::NET_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let port = spawn_limited_server(Some(Duration::from_millis(300)), 8);

    // 시한보다 오래 놀린 뒤에도 accept 가 산다.
    std::thread::sleep(Duration::from_millis(700));

    // ① 헤더 도중에 멈춤 → tiny_http 가 408 로 닫는다.
    let (got, took) = hold_and_read(port, "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    assert!(got.is_empty() || got.starts_with("HTTP/1.1 408"), "{got}");
    assert!(took < Duration::from_secs(3), "시한 안에 끊겨야 한다: {took:?}");
    assert!(took >= Duration::from_millis(200), "시한 전에 끊기면 다른 이유다: {took:?}");

    // ② 작은 본문(≤1 KB, tiny_http 가 미리 읽는 길)을 선언만 하고 안 보냄 → 408.
    let small = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Length: 100\r\n\r\n"
    );
    let (got, took) = hold_and_read(port, &small);
    assert!(got.is_empty() || got.starts_with("HTTP/1.1 408"), "{got}");
    assert!(took < Duration::from_secs(3), "{took:?}");
    assert!(took >= Duration::from_millis(200), "{took:?}");

    // ③ 큰 본문(우리 처리 스레드가 읽는 길) → 우리 쪽 읽기 실패로 400, 그리고 끊김.
    let big = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Length: 3000\r\n\r\n{{"
    );
    let (got, took) = hold_and_read(port, &big);
    assert!(got.is_empty() || got.starts_with("HTTP/1.1 400"), "{got}");
    assert!(took < Duration::from_secs(3), "{took:?}");
    assert!(took >= Duration::from_millis(200), "{took:?}");

    // 정상 요청은 그대로 지난다(서버가 살아 있다).
    let ok = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let (got, _) = hold_and_read(port, &ok);
    assert!(got.starts_with("HTTP/1.1 401"), "{got}");
}

/// 읽기 시한은 **응답 쪽 대기**를 자르지 않는다 — 시한(300ms)보다 긴 `wait_for_operation`(1초)이
/// keep-alive 연결에서도 200 을 끝까지 받는다(그 뒤 다음 요청을 기다리던 읽기가 408 로 닫는 것은 무해).
#[cfg(windows)]
#[test]
fn live_server_read_timeout_does_not_cut_a_long_wait() {
    let _net = crate::test_support::NET_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let m = plan_store();
    let ops: OperationStore = Default::default();
    let signal = McpSignal::default();
    let id = new_draft(&m, &ops, &signal);
    let req = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"request_execution","arguments":{{"operationId":"{id}"}}}}}}"#
    );
    let _ = dispatch_o(&m, &ops, &signal, &req);
    let port = spawn_limited_server_on(Some(Duration::from_millis(300)), 8, m, ops);

    let body = wait_body(&id, 1);
    let head = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let (got, took) = hold_and_read(port, &head);
    assert!(got.starts_with("HTTP/1.1 200"), "{got}");
    assert!(got.contains("timedOut"), "{got}");
    assert!(took >= Duration::from_millis(900), "실제로 기다렸어야 한다: {took:?}");
}

/// 동시 상한을 넘는 요청은 스레드를 띄우기 전에 503 + `Retry-After` — 자리가 반납되면 다시 받는다.
#[test]
fn live_server_rejects_over_the_inflight_cap_with_503() {
    use std::io::Write;
    let _net = crate::test_support::NET_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    // 읽기 시한 없이(붙든 연결이 우리가 놓을 때까지 자리를 잡게) 상한 1.
    let port = spawn_limited_server(None, 1);

    // 자리 하나를 잡는다 — 1 KB 넘는 본문을 선언하고 일부만 보내면 우리 처리 스레드가 본문을 기다린다.
    let mut holder = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    holder
        .write_all(
            format!(
                "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer testtoken\r\nContent-Length: 3000\r\n\r\n{{"
            )
            .as_bytes(),
        )
        .unwrap();
    std::thread::sleep(Duration::from_millis(300));

    let req = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let (got, _) = hold_and_read(port, &req);
    assert!(got.starts_with("HTTP/1.1 503"), "{got}");
    assert!(got.contains("Retry-After: 1"), "{got}");

    // 붙든 연결을 놓으면 자리가 돌아온다.
    drop(holder);
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        let (got, _) = hold_and_read(port, &req);
        if got.starts_with("HTTP/1.1 401") {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "자리가 반납되지 않았다: {got}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

// ---- DB 도구(쿼리 타일 3단계 3a — 10-14 사용자 승인으로 `mcp_has_no_db_tools` 를 아래 시험들로 바꿨다) ----

mod db_tools {
    use super::*;
    use crate::audit::AuditRecord;
    use crate::db::ai::{AiDb, AiOutcome, AiRequest, DbAiLevel, DbConn, Grant};
    use crate::db::conns::DbEngine;
    use crate::delegation::database::{upsert_database_in_doc, DbIdentity};
    use crate::delegation::Delegation;

    const VIA: &str = "deploy@10.0.0.5:22";
    /// 가짜 뒷면이 돌려주는 칸 값 — 감사 로그에 이 글자가 있으면 안 된다.
    const SECRET_CELL: &str = "SECRET-CELL-VALUE-3a";

    fn conn(id: &str, name: &str, via: bool) -> DbConn {
        DbConn {
            id: id.into(),
            name: name.into(),
            engine: DbEngine::Postgres,
            via: via.then(|| "web-01".to_string()),
            path: None,
            host: Some("db.internal".into()),
            port: Some(5432),
            database: Some("app".into()),
            user: Some("readonly_user".into()),
            tls_mode: Some(Default::default()),
            tls_ca: None,
            folder: None,
        }
    }

    /// 가짜 DB 뒷면 — 부른 요청과 감사 줄을 모은다(엔진 없음).
    #[derive(Default)]
    struct FakeDb {
        conns: Vec<DbConn>,
        calls: Mutex<Vec<String>>,
        audits: Mutex<Vec<AuditRecord>>,
    }

    impl AiDb for FakeDb {
        fn connections(&self) -> Vec<DbConn> {
            self.conns.clone()
        }
        fn via_target(&self, _alias: &str) -> Option<String> {
            Some(VIA.into())
        }
        fn run(&self, _grant: &Grant, req: AiRequest) -> Result<AiOutcome, String> {
            self.calls.lock().unwrap().push(format!("{req:?}"));
            Ok(AiOutcome {
                value: json!({ "columns": [{ "name": "c", "type": "text" }], "rows": [[SECRET_CELL]], "rowCount": 1 }),
                rows: Some(1),
            })
        }
        fn audit(&self, rec: AuditRecord) {
            self.audits.lock().unwrap().push(rec);
        }
    }

    /// 연결마다 단계를 적은 위임(스냅샷은 그 연결 그대로 — `moved` 는 적은 뒤 주소를 바꾼 연결).
    fn delegation(grants: &[(&DbConn, DbAiLevel)]) -> Delegation {
        let mut doc = String::new();
        for (c, level) in grants {
            let vt = c.via.as_ref().map(|_| VIA.to_string());
            doc = upsert_database_in_doc(&doc, &c.id, &DbIdentity::of(c, vt), *level, Some(true)).unwrap();
        }
        Delegation::parse(&doc).unwrap()
    }

    fn call(fake: &Arc<FakeDb>, d: &Delegation, body: Value) -> Value {
        let store = Store::default();
        let ops: OperationStore = Default::default();
        let results: ResultStore = Default::default();
        let signal = McpSignal::default();
        let env = DbEnv::new(Arc::clone(fake) as Arc<dyn AiDb>);
        let d = d.clone();
        parse_json(dispatch_full(&store, &ops, &results, &signal, &body.to_string(), || d, &env))
    }

    fn tool_names(fake: &Arc<FakeDb>, d: &Delegation) -> Vec<String> {
        let v = call(fake, d, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
        v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
    }

    fn tool(fake: &Arc<FakeDb>, d: &Delegation, name: &str, args: Value) -> (bool, String) {
        let v = call(fake, d, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": name, "arguments": args } }));
        let r = &v["result"];
        (r["isError"].as_bool().unwrap_or(false), r["content"][0]["text"].as_str().unwrap().to_string())
    }

    fn db_tool_names(names: &[String]) -> Vec<String> {
        names.iter().filter(|n| crate::mcp::db::is_db_tool(n)).cloned().collect()
    }

    /// [`call`] 의 호출자 지정판 — 오케스트레이션 저장소 없이(조정자 묶음 없음).
    fn call_as(caller: &crate::orchestration::Caller, fake: &Arc<FakeDb>, d: &Delegation, body: Value) -> Value {
        let store = Store::default();
        let ops: OperationStore = Default::default();
        let results: ResultStore = Default::default();
        let signal = McpSignal::default();
        let env = DbEnv::new(Arc::clone(fake) as Arc<dyn AiDb>);
        let d = d.clone();
        parse_json(crate::mcp::dispatch_as(caller, None, &store, &ops, &results, &signal, &body.to_string(), || d, &env))
    }

    /// 3차 4단계 회귀 — **타일 토큰의 호출자**(`Caller::Tile`, 조정자로 묶이지 않음)도 DB 도구 · 읽기 13개 · 작업안 도구에서 전역 토큰과
    /// **같은 판정**을 받는다(목록 · 권한 거절 · 뒷면에 닿는 조회 · 없는 연결). 전역 토큰의 조율 도구는 `not-a-tile`.
    #[test]
    fn tile_caller_gets_same_db_and_read_judgment() {
        use crate::orchestration::Caller;
        let schema = conn("Schema_conn01", "구조만 DB", true);
        let read = conn("Read_conn0001", "읽기 DB", false);
        let fake = Arc::new(FakeDb { conns: vec![schema.clone(), read.clone()], ..Default::default() });
        let tile = Caller::Tile { stream: "tile-regress".into() };
        let list = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
        for d in [
            delegation(&[]),
            delegation(&[(&schema, DbAiLevel::Schema)]),
            delegation(&[(&schema, DbAiLevel::Schema), (&read, DbAiLevel::Read)]),
            delegation(&[(&read, DbAiLevel::Approve)]),
        ] {
            assert_eq!(call_as(&tile, &fake, &d, list.clone()), call_as(&Caller::Global, &fake, &d, list.clone()), "같은 목록");
            for (name, args) in [
                ("list_db_connections", json!({})),
                ("db_query", json!({ "connId": schema.id, "sql": "SELECT 1" })),
                ("db_query", json!({ "connId": read.id, "sql": "SELECT 1" })),
                ("db_list_schemas", json!({ "connId": "Nope_conn0001" })),
                ("create_db_write_plan", json!({ "summary": "s", "effect": "delete", "connId": schema.id, "statements": ["DELETE FROM t"], "maxAffected": 1 })),
                ("list_sessions", json!({})),
                ("get_scrollback", json!({ "sessionId": "nope" })),
                ("get_auto_approval_policy", json!({})),
                ("create_execution_plan", json!({ "summary": "s", "effect": "read", "command": "uptime", "targets": [] })),
                ("get_operation", json!({ "operationId": "op-nope" })),
            ] {
                let body = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": name, "arguments": args } });
                let t = call_as(&tile, &fake, &d, body.clone());
                let g = call_as(&Caller::Global, &fake, &d, body);
                assert_eq!(t["result"]["isError"], g["result"]["isError"], "{name}: {t} / {g}");
                assert_eq!(t["result"]["content"][0]["text"], g["result"]["content"][0]["text"], "{name}");
            }
        }
        // 조율 도구 — 전역 토큰은 not-a-tile(타일이 아니면 조정자가 될 수 없다).
        let body = json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "get_run", "arguments": {} } });
        let g = call_as(&Caller::Global, &fake, &delegation(&[]), body);
        assert_eq!(g["result"]["isError"], true);
        assert!(g["result"]["content"][0]["text"].as_str().unwrap().starts_with("not-a-tile"), "{g}");
    }

    /// 시험 `db_tools_listed_always_judged_per_call`(B-9 · 2026-11-09 — 옛 `db_tools_follow_ai_level`) — `tools/list` 는 **단계와 무관하게
    /// DB 도구 일곱**이고(CLI 가 목록을 캐시하므로), 도구는 호출마다 권한 판정을 지난다: 끔 · 스냅샷 어긋남 = 없는 연결(`list_db_connections`
    /// 에도 없다) · 구조만 = `db_query` 거절(뒷면에 닿지 않음) · 읽기 전용 = 조회가 뒷면에 닿는다 · 권한을 올리면 목록을 다시 받지 않고 다음
    /// 호출부터 통한다.
    #[test]
    fn db_tools_listed_always_judged_per_call() {
        let schema = conn("Schema_conn01", "구조만 DB", true);
        let read = conn("Read_conn0001", "읽기 DB", false);
        let off = conn("Off_conn00001", "끈 DB", false);
        let mut moved = conn("Moved_conn001", "옮긴 DB", false);
        let fake = Arc::new(FakeDb {
            conns: vec![schema.clone(), read.clone(), off.clone(), moved.clone()],
            ..Default::default()
        });
        // 권한을 적은 뒤 연결을 다른 서버로 고쳐 가리켰다(파일의 연결이 바뀜).
        let granted_moved = moved.clone();
        moved.host = Some("prod.internal".into());
        let fake_moved = Arc::new(FakeDb {
            conns: vec![schema.clone(), read.clone(), off.clone(), moved.clone()],
            ..Default::default()
        });

        let none = delegation(&[]);
        let only_moved = delegation(&[(&granted_moved, DbAiLevel::Read)]);
        let s_only = delegation(&[(&schema, DbAiLevel::Schema)]);
        let both = delegation(&[(&schema, DbAiLevel::Schema), (&read, DbAiLevel::Read), (&granted_moved, DbAiLevel::Read)]);
        let approve = delegation(&[(&schema, DbAiLevel::Schema), (&read, DbAiLevel::Approve)]);
        // 목록은 단계를 타지 않는다 — 권한이 하나도 없어도 · 끔 · 스냅샷 어긋남만 있어도 · 어느 단계든 13 + DB 일곱, 순서까지 같다.
        let full = tool_names(&fake, &approve);
        assert_eq!(full.len(), 13 + 7);
        assert_eq!(db_tool_names(&full), crate::mcp::db::DB_TOOLS);
        for (f, d) in [(&fake, &none), (&fake_moved, &only_moved), (&fake, &s_only), (&fake_moved, &both)] {
            assert_eq!(tool_names(f, d), full, "목록은 늘 같다");
        }
        // DB 뒷면이 없는 서버(시험의 단독 서버)는 DB 도구가 없다 — 13 그대로.
        let v = parse_json(dispatch_with(
            &Store::default(),
            &Default::default(),
            &Default::default(),
            &McpSignal::default(),
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string(),
            || approve.clone(),
        ));
        assert_eq!(v["result"]["tools"].as_array().unwrap().len(), 13);

        // 권한이 없으면(끔) 목록에 있는 도구도 없는 연결 · 구조만이면 조회 거절 — 판정은 호출마다 서버.
        let (err, text) = tool(&fake, &none, "db_list_schemas", json!({ "connId": schema.id }));
        assert!(err && text.contains("Unknown database connection"), "{text}");
        let (err, text) = tool(&fake, &s_only, "db_query", json!({ "connId": schema.id, "sql": "SELECT 1" }));
        assert!(err && text.contains("permission is 'Schema'"), "{text}");
        let (err, text) = tool(&fake, &both, "create_db_write_plan", json!({ "summary": "s", "effect": "delete", "connId": read.id, "statements": ["DELETE FROM t"], "maxAffected": 1 }));
        assert!(err && text.contains("needs 'Ask'"), "{text}");
        assert!(fake.calls.lock().unwrap().is_empty(), "거절은 뒷면에 닿지 않는다");

        // **즉시 적용** — 읽기 전용(Read)에서 받은 목록 그대로, 사람이 앱에서 Ask 로 올리면 `tools/list` 를 다시 받지 않고 다음 호출이 통한다.
        {
            let store = Store::default();
            let ops: OperationStore = Default::default();
            let results: ResultStore = Default::default();
            let signal = McpSignal::default();
            let env = DbEnv::new(Arc::clone(&fake) as Arc<dyn AiDb>);
            let at_read = delegation(&[(&read, DbAiLevel::Read)]);
            let raised = delegation(&[(&read, DbAiLevel::Approve)]);
            let send = |body: Value, d: &Delegation| {
                let d = d.clone();
                parse_json(dispatch_full(&store, &ops, &results, &signal, &body.to_string(), || d, &env))
            };
            let listed = send(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }), &at_read);
            assert!(listed["result"]["tools"].as_array().unwrap().iter().any(|t| t["name"] == crate::mcp::db::WRITE_PLAN_TOOL), "Read 에서도 목록에 있다");
            let plan = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "create_db_write_plan",
                "arguments": { "summary": "s", "effect": "write", "connId": read.id, "statements": ["UPDATE t SET a = 1 WHERE id = 7"], "maxAffected": 1 } } });
            let before = send(plan.clone(), &at_read);
            assert_eq!(before["result"]["isError"], true, "{before}");
            assert!(ops.lock().unwrap().is_empty());
            // 권한만 올린다 — 목록을 다시 받지 않는다.
            let after = send(plan, &raised);
            assert!(after["result"]["isError"].is_null(), "{after}");
            assert_eq!(ops.lock().unwrap().len(), 1, "올린 다음 호출에서 초안 하나");
            // 다시 내리면 다음 호출부터 거절(목록에는 남아 있어도 안전하다).
            let again = json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "create_db_write_plan",
                "arguments": { "summary": "s", "effect": "write", "connId": read.id, "statements": ["UPDATE t SET a = 2 WHERE id = 7"], "maxAffected": 1 } } });
            let lowered = send(again, &at_read);
            assert_eq!(lowered["result"]["isError"], true, "{lowered}");
            assert_eq!(ops.lock().unwrap().len(), 1);
        }
        assert!(fake.calls.lock().unwrap().is_empty(), "작업안 만들기는 DB 에 닿지 않는다");
        // 승인 후 실행이 아닌 연결에 쓰기 작업안 → 거절(작업안 없음 · 뒷면에 닿지 않음), 끔은 없는 연결.
        let (err, text) = tool(&fake, &approve, "create_db_write_plan", json!({ "summary": "s", "effect": "delete", "connId": schema.id, "statements": ["DELETE FROM t"], "maxAffected": 1 }));
        assert!(err && text.contains("needs 'Ask'"), "{text}");
        let (err, text) = tool(&fake, &approve, "create_db_write_plan", json!({ "summary": "s", "effect": "delete", "connId": off.id, "statements": ["DELETE FROM t"], "maxAffected": 1 }));
        assert!(err && text.contains("Unknown database connection"), "{text}");

        // 목록 — 끔 · 어긋난 연결은 없다.
        let (err, text) = tool(&fake_moved, &both, "list_db_connections", json!({}));
        assert!(!err, "{text}");
        let list: Value = serde_json::from_str(&text).unwrap();
        let ids: Vec<&str> = list.as_array().unwrap().iter().map(|r| r["connId"].as_str().unwrap()).collect();
        assert_eq!(ids, [schema.id.as_str(), read.id.as_str()]);
        assert_eq!(list[0]["aiLevel"], "schema");
        assert_eq!(list[0]["throughSsh"], true);
        assert_eq!(list[1]["aiLevel"], "read");

        // 구조만 연결에 조회 → 거절, 뒷면에 닿지 않는다.
        let (err, text) = tool(&fake_moved, &both, "db_query", json!({ "connId": schema.id, "sql": "SELECT 1" }));
        assert!(err && text.contains("permission is 'Schema'"), "{text}");
        // 끔 · 어긋난 연결 → 없는 연결과 같은 말.
        for id in [&off.id, &moved.id, &"Nope_conn0001".to_string()] {
            let (err, text) = tool(&fake_moved, &both, "db_list_schemas", json!({ "connId": id }));
            assert!(err && text.contains("Unknown database connection"), "{id}: {text}");
        }
        assert!(fake_moved.calls.lock().unwrap().is_empty(), "거절은 뒷면에 닿지 않는다");

        // 구조만 연결의 구조 도구 · 읽기 연결의 조회는 뒷면에 닿는다.
        let (err, text) = tool(&fake_moved, &both, "db_describe_table", json!({ "connId": schema.id, "schema": "public", "table": "users" }));
        assert!(!err, "{text}");
        let (err, text) = tool(&fake_moved, &both, "db_query", json!({ "connId": read.id, "sql": "SELECT c FROM t", "maxRows": 9999, "timeoutSeconds": 999 }));
        assert!(!err, "{text}");
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["connId"], read.id.as_str());
        let calls = fake_moved.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 2);
        assert!(calls[0].starts_with("Describe"), "{calls:?}");
        // 상한은 MCP 가 다듬어 넘긴다(행 500 · 60초).
        assert!(calls[1].contains("max_rows: 500") && calls[1].contains("timeout_ms: 60000"), "{calls:?}");

        // 감사 — 거절도 남고(`denied`) 성공은 `ok`, **결과 값은 없다**.
        let audits = fake_moved.audits.lock().unwrap().clone();
        assert_eq!(audits.len(), 6, "{audits:?}");
        assert!(audits.iter().all(|r| r.event == "db_read" && r.operation_id.is_empty()));
        let outcomes: Vec<&str> = audits.iter().map(|r| r.db.as_ref().unwrap().outcome.as_str()).collect();
        assert_eq!(outcomes, ["denied", "denied", "denied", "denied", "ok", "ok"]);
        let q = audits.last().unwrap();
        assert_eq!(q.command, "SELECT c FROM t");
        assert_eq!(q.targets, [format!("db:{}", read.id)]);
        assert_eq!(q.db.as_ref().unwrap().rows, Some(1));
        let line = serde_json::to_string(&audits).unwrap();
        assert!(!line.contains(SECRET_CELL), "감사에 결과 값: {line}");
    }

    /// (3b — 3a 의 `no_db_write_tools_and_no_secret_fields` 를 바꿔 강화했다) **DB 쓰기 도구는 작업안 초안 하나뿐이고 그것은 제안만
    /// 한다** · 비밀번호(·주소 · 사용자 · 경로)를 돌려주는 길이 없다:
    /// - 가장 높은 단계(승인 후 실행)에서도 DB 도구는 정해진 일곱이고, 이름에 쓰기 · 실행 · 승인 낱말이 든 것은 `create_db_write_plan` 하나다
    ///   (`exec` · `run` · `approve` · `commit` · `insert` · `update` · `delete` · 권한 · 비밀번호 도구는 없다). 목록 전체에 승인 · 실행 · 취소
    ///   도구가 없다.
    /// - 그 도구를 부르면 **뒷면(DB)에 닿지 않고**(연결 · 트랜잭션을 열지 않는다) 작업안 저장소에 `draft` 하나만 생긴다 — 대상은 `db:<id>`
    ///   하나, 답 · 작업안에 주소 · 사용자 · 경유 별칭이 없다.
    /// - MCP 소스는 실행 경로(`db::ai_write` · `operations::db_exec`)와 비밀번호에 닿지 않는다(승인 몸은 `auto_approve_has_one_entry` 가 막는다).
    #[test]
    fn db_write_tool_only_proposes_and_no_secret_fields() {
        let c = conn("Approve_conn1", "승인 DB", true);
        let fake = Arc::new(FakeDb { conns: vec![c.clone()], ..Default::default() });
        let d = delegation(&[(&c, DbAiLevel::Approve)]);
        let names = tool_names(&fake, &d);
        let db = db_tool_names(&names);
        assert_eq!(db, crate::mcp::db::DB_TOOLS);
        let writing: Vec<&String> = names.iter().filter(|n| n.contains("write")).collect();
        assert_eq!(writing, [crate::mcp::db::WRITE_PLAN_TOOL], "쓰기 낱말은 작업안 초안 하나");
        for n in names.iter().filter(|n| n.contains("db")) {
            for bad in ["exec", "run", "approve", "insert", "update", "delete", "commit", "set_ai", "permission", "password"] {
                assert!(!n.contains(bad), "{n}");
            }
        }
        for n in &names {
            for bad in ["approve", "cancel", "execute_", "reject", "send_command"] {
                assert!(!n.contains(bad), "승인 · 실행 · 취소 도구가 없다: {n}");
            }
        }
        // 쓰기 작업안 도구의 설명은 실행하지 않음 · 사람만 승인 · 자동 승인 없음 · 한 트랜잭션 · 되돌림 · maxAffected 를 밝힌다.
        let v = call(&fake, &d, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
        let w = v["result"]["tools"].as_array().unwrap().iter().find(|t| t["name"] == "create_db_write_plan").unwrap().clone();
        let desc = w["description"].as_str().unwrap();
        for must in ["changes no data", "only a person approves", "(YOLO)", "one transaction", "rolled back", "maxAffected", "unknown"] {
            assert!(desc.contains(must), "create_db_write_plan 설명에 {must}");
        }
        assert_eq!(w["inputSchema"]["required"], json!(["connId", "statements", "maxAffected", "summary", "effect"]));
        // 부르면 — 뒷면에 닿지 않고 초안 하나.
        let store = Store::default();
        let ops: OperationStore = Default::default();
        let results: ResultStore = Default::default();
        let env = DbEnv::new(Arc::clone(&fake) as Arc<dyn AiDb>);
        let body = json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "create_db_write_plan",
            "arguments": { "summary": "s", "effect": "write", "connId": c.id, "statements": ["UPDATE t SET a = 1 WHERE id = 7"], "maxAffected": 1, "title": "고치기" } } });
        let dd = d.clone();
        let v = parse_json(dispatch_full(&store, &ops, &results, &McpSignal::default(), &body.to_string(), || dd, &env));
        let text = v["result"]["content"][0]["text"].as_str().unwrap().to_string();
        assert!(v["result"]["isError"].is_null(), "{text}");
        assert!(fake.calls.lock().unwrap().is_empty(), "작업안 만들기는 DB 에 닿지 않는다");
        let map = ops.lock().unwrap();
        assert_eq!(map.len(), 1);
        let op = map.values().next().unwrap();
        assert_eq!(op.state, crate::operations::OperationState::Draft);
        assert_eq!(op.targets, [format!("db:{}", c.id)]);
        // 승인 요약 — 선언 · 앱 분석(문장 · 테이블 · WHERE) · 어긋남 없음(쓰기 선언 = UPDATE).
        assert_eq!(op.summary.as_deref(), Some("s"));
        assert_eq!(op.effect, Some(crate::operations::Effect::Write));
        let a = op.analysis.as_ref().unwrap();
        assert_eq!(a.effect, crate::operations::Computed::Write);
        assert_eq!(a.statements[0].table.as_deref(), Some("t"));
        assert_eq!(a.statements[0].where_clause, Some(true));
        assert!(!op.mismatch);
        assert!(results.lock().unwrap().is_empty(), "실행 칸이 없다");
        for leak in ["db.internal", "readonly_user", "5432", "web-01", VIA] {
            assert!(!text.contains(leak), "작업안 답에 {leak}: {text}");
        }
        drop(map);
        // `db_query` 설명은 행이 모델 제공자로 간다는 것과 읽기 전용을 밝힌다.
        let v = call(&fake, &d, json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }));
        let q = v["result"]["tools"].as_array().unwrap().iter().find(|t| t["name"] == "db_query").unwrap().clone();
        let desc = q["description"].as_str().unwrap();
        for must in ["read-only", "model provider", "500", "1 KiB", "256 KiB", "60", "READ ONLY", "AI-only connection"] {
            assert!(desc.contains(must), "db_query 설명에 {must}");
        }
        let (_, text) = tool(&fake, &d, "list_db_connections", json!({}));
        let list: Value = serde_json::from_str(&text).unwrap();
        let keys: Vec<&String> = list[0].as_object().unwrap().keys().collect();
        let mut keys: Vec<&str> = keys.into_iter().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["aiLevel", "connId", "database", "engine", "headless", "name", "throughSsh"]);
        for leak in ["db.internal", "readonly_user", "5432", "web-01", VIA] {
            assert!(!text.contains(leak), "목록에 {leak}");
        }
        // MCP 소스(DB 도구 포함)는 비밀번호에 닿지 않고, 실행 · 승인 경로에도 닿지 않는다.
        for f in mcp_sources() {
            let text = code_only(&std::fs::read_to_string(&f).unwrap());
            for needle in [
                // (승인 몸 이름은 `server::tests::auto_approve_has_one_entry` 가 MCP 소스 전부 — 이 파일까지 — 에서 이미 막는다.)
                "db_password", "password_for", "hub::vault", "Zeroizing", "OpenSecrets", "ai_write", "db_exec", "execute_db",
            ] {
                assert!(!text.contains(needle), "{} 에 {needle}", f.display());
            }
        }
    }

    /// 시험 `db_headless_listed_not_writable`(2026-11-09) — `list_db_connections` 의 `headless` 는 그 연결의 헤드리스 위임(새 블록 끔 ·
    /// 켬 · 칸 없는 옛 블록 켬 · 스냅샷 어긋남은 목록에서 빠짐)이고 SQLite 도 같은 칸(2026-11-09). **MCP 에는 이 칸을 쓰는 길이 없다**: 도구 목록 · MCP 소스에
    /// 위임 쓰기(`upsert_database_in_doc` · `db_ai_set` · `set_at` · `"headless"` 를 적는 `put`)가 없다.
    #[test]
    fn db_headless_listed_not_writable() {
        let on = conn("Head_on_conn1", "켬", false);
        let off = conn("Head_offconn1", "끔", true);
        let legacy = conn("Head_oldconn1", "옛", false);
        let sqlite = |id: &str, file: &str| {
            let mut c = conn(id, "파일", false);
            c.engine = DbEngine::Sqlite;
            c.host = None;
            c.port = None;
            c.user = None;
            c.database = None;
            c.path = Some(file.into());
            c
        };
        let lite = sqlite("Head_litconn1", "C:\\data\\x.db");
        let lite_on = sqlite("Head_liton001", "C:\\data\\y.db");
        let fake = Arc::new(FakeDb { conns: vec![on.clone(), off.clone(), legacy.clone(), lite.clone(), lite_on.clone()], ..Default::default() });
        let ident = |c: &DbConn| DbIdentity::of(c, c.via.as_ref().map(|_| VIA.to_string()));
        let mut doc = upsert_database_in_doc("", &on.id, &ident(&on), DbAiLevel::Read, Some(true)).unwrap();
        doc = upsert_database_in_doc(&doc, &off.id, &ident(&off), DbAiLevel::Read, None).unwrap();
        doc = upsert_database_in_doc(&doc, &lite.id, &ident(&lite), DbAiLevel::Schema, None).unwrap();
        doc = upsert_database_in_doc(&doc, &lite_on.id, &ident(&lite_on), DbAiLevel::Read, Some(true)).unwrap();
        let old = upsert_database_in_doc("", &legacy.id, &ident(&legacy), DbAiLevel::Schema, None).unwrap().replace("headless = false\n", "");
        doc.push_str(&old);
        let d = Delegation::parse(&doc).unwrap();
        let (err, text) = tool(&fake, &d, "list_db_connections", json!({}));
        assert!(!err, "{text}");
        let list: Value = serde_json::from_str(&text).unwrap();
        let flag = |id: &str| list.as_array().unwrap().iter().find(|r| r["connId"] == id).map(|r| r["headless"].clone());
        assert_eq!(flag(&on.id), Some(json!(true)));
        assert_eq!(flag(&off.id), Some(json!(false)), "새 블록은 끔");
        assert_eq!(flag(&legacy.id), Some(json!(true)), "칸 없는 옛 블록은 켬");
        assert_eq!(flag(&lite.id), Some(json!(false)), "SQLite 도 새 블록은 끔(2026-11-09)");
        assert_eq!(flag(&lite_on.id), Some(json!(true)), "SQLite 도 켠 칸은 켬");
        // MCP 에는 위임을 쓰는 표면이 없다.
        let names = tool_names(&fake, &d);
        assert!(!names.iter().any(|n| n.contains("headless") || n.contains("delegation") || n.contains("permission")), "{names:?}");
        for f in mcp_sources() {
            let text = code_only(&std::fs::read_to_string(&f).unwrap());
            for needle in ["upsert_database_in_doc", "db_ai_set", "set_at(", "\"headless\", Value", "write_if_changed"] {
                assert!(!text.contains(needle), "{} 에 {needle}", f.display());
            }
        }
    }

    /// 시험 `mcp_reaches_db_only_through_ai_facade`(B-9) — MCP 소스는 DB 평면에 `crate::db::ai`(+ 3b 의 사전 검증 `crate::db::ai_plan` —
    /// 연결 없는 순수 모듈)로만 닿는다: 타일 연결 표(`table`) · 서버 op(`db_ops` · `db_proxy`) · 엔진 · 쓰기 전환 · **쓰기 실행 모듈
    /// (`ai_write`)** 에 닿는 글자가 없다. (3b 강화: 예전 "`ai` 로 시작" 판정은 `ai_write` 도 통과시켰다 — 이제 모듈 이름을 정확히 본다.)
    #[test]
    fn mcp_reaches_db_only_through_ai_facade() {
        let files = mcp_sources();
        assert!(files.len() > 5);
        let mut uses_facade = false;
        for f in files {
            let text = code_only(&std::fs::read_to_string(&f).unwrap());
            for needle in [
                "db::table", "db::pg", "db::mysql", "db::sqlite", "db::script", "db::net", "db::tx", "db_proxy", "db_ops", "set_write",
                "set_mode", "tx_begin", "db_open", "db_test", "ai_write", "db_exec",
            ] {
                assert!(!text.contains(needle), "{} 에 {needle}", f.display());
            }
            // `crate::db::` 는 `ai` · `ai_plan` 둘로만(모듈 이름을 정확히).
            for (i, _) in text.match_indices("crate::db::") {
                let rest = &text[i + "crate::db::".len()..];
                assert!(
                    rest.starts_with("ai::") || rest.starts_with("ai_plan::") || rest.starts_with("ai;") || rest.starts_with("ai::{"),
                    "{} 에 crate::db::{}",
                    f.display(),
                    &rest[..rest.len().min(20)]
                );
                uses_facade = true;
            }
        }
        assert!(uses_facade, "MCP 는 db::ai 로 닿는다");
    }

    fn mcp_sources() -> Vec<PathBuf> {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = vec![root.join("mcp.rs")];
        files.extend(
            std::fs::read_dir(root.join("mcp"))
                .unwrap()
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "rs") && !p.ends_with("tests.rs")),
        );
        files
    }

    /// 주석 줄(`//`)을 뺀 코드 — 머리말이 금지어를 **설명**하는 것은 괜찮다.
    fn code_only(text: &str) -> String {
        text.lines()
            .map(|l| match l.find("//") {
                Some(i) => &l[..i],
                None => l,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// 모두 승인(2026-10-23) — `list_sessions` 가 세션마다 `approveAll` 을 밝힌다(호스트가 'YOLO' 일 때만 참 · 로컬 · 자동 승인 실행은 거짓).
/// 별칭은 이미 `label` 에 있다 — 새로 나가는 신원은 없다.
#[test]
fn list_sessions_marks_approve_all_hosts() {
    let delegation = crate::delegation::Delegation::parse(
        "[[target]]\nalias = \"yolo\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\npropose = true\nauto_execute = true\napprove_all = true\n\n\
         [[target]]\nalias = \"auto\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\npropose = true\nauto_execute = true\n",
    )
    .unwrap();
    let mut m = HashMap::new();
    m.insert("w-yolo".to_string(), tile_of("ssh", false, Some("yolo")));
    m.insert("w-auto".to_string(), tile_of("ssh", false, Some("auto")));
    m.insert("w-local".to_string(), tile_of("local", true, None));
    let v = enrich_sessions(&m, &delegation, None);
    let flag = |id: &str| {
        v.as_array().unwrap().iter().find(|s| s["id"] == id).map(|s| s["approveAll"].clone()).unwrap_or(Value::Null)
    };
    assert_eq!(flag("w-yolo"), json!(true));
    assert_eq!(flag("w-auto"), json!(false));
    assert_eq!(flag("w-local"), json!(false));
}

/// 사이드 채팅(v2 — 채팅 토큰 `Caller::SideChat`)과 **로컬 AI 타일 · 감싸개 셸 타일**(타일 토큰 — 오케스트레이션 탭 2단계 6절)은 맡긴 저장소가
/// 있어도 오케스트레이션 도구(타일 도구 · 조율 도구)를 목록에 받지 않는다 — 그 도구는 프로듀서 채팅만 받는다.
#[test]
fn side_chats_and_tiles_never_list_orchestration_tools() {
    use crate::orchestration::Caller;
    let tile = Caller::Tile { stream: "0123abcd0123abcd0123abcd0123abcd".into() };
    let side = Caller::SideChat { chat: "0123abcd0123abcd".into() };
    for c in [&tile, &side] {
        let v = super::schema::tools_list_for(c, true, true);
        let names: Vec<&str> = v["tools"].as_array().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
        for n in &names {
            assert!(!crate::orchestration::TILE_TOOLS.contains(n) && !crate::orchestration::COORDINATOR_TOOLS.contains(n), "{c:?}: {n}");
        }
    }
}
