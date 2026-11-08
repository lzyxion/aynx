use super::*;
use std::io::Cursor;

const ID: &str = "11111111-2222-4333-8444-555555555555";

/// 서버가 낼 줄들을 앞에 쌓아 두고 교환을 돌린다 → (결과, 우리가 보낸 줄들).
fn exchange(server: &[Value], method: &str, params: Value) -> (Result<Value, RpcFail>, Vec<Value>) {
    let input: String = server.iter().map(|v| v.to_string() + "\n").collect();
    let mut r = Cursor::new(input.into_bytes());
    let mut w: Vec<u8> = Vec::new();
    let out = request_over(&mut r, &mut w, method, params, "9.9.9");
    let sent = String::from_utf8(w)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    (out, sent)
}

#[test]
fn exchange_initializes_then_sends_the_one_request() {
    let (out, sent) = exchange(
        &[
            json!({"id": 1, "result": {"userAgent": "x"}}),
            json!({"method": "remoteControl/status/changed", "params": {}}),
            json!({"id": 99, "method": "item/tool/requestUserInput", "params": {}}),
            json!({"id": 2, "result": {"ok": 1}}),
        ],
        "thread/name/set",
        json!({"threadId": ID, "name": "이름 \"q\""}),
    );
    assert_eq!(out, Ok(json!({"ok": 1})), "답의 result 를 돌려준다");
    assert_eq!(sent[0]["method"], "initialize");
    assert_eq!(sent[0]["params"]["clientInfo"], json!({"name": "aynx", "version": "9.9.9"}));
    assert_eq!(sent[1], json!({"jsonrpc": "2.0", "method": "initialized", "params": {}}));
    assert_eq!(sent[2]["id"], 2);
    assert_eq!(sent[2]["method"], "thread/name/set");
    assert_eq!(sent[2]["params"], json!({"threadId": ID, "name": "이름 \"q\""}));
    // 서버 요청에는 "다루지 않음" 으로 답했다(영영 기다리지 않게).
    assert_eq!(sent[3]["id"], 99);
    assert_eq!(sent[3]["error"]["code"], UNSUPPORTED);
    assert_eq!(sent.len(), 4);
}

#[test]
fn exchange_sends_thread_delete_and_accepts_an_empty_result() {
    // 0.164 실측 답: {"id":2,"result":{}}
    let (out, sent) = exchange(
        &[json!({"id": 1, "result": {}}), json!({"id": 2, "result": {}})],
        "thread/delete",
        json!({"threadId": ID}),
    );
    assert_eq!(out, Ok(json!({})));
    assert_eq!(sent[2], json!({"jsonrpc": "2.0", "id": 2, "method": "thread/delete", "params": {"threadId": ID}}));
}

#[test]
fn exchange_reports_server_errors_and_early_close() {
    let (out, _) = exchange(
        &[
            json!({"id": 1, "result": {}}),
            json!({"id": 2, "error": {"code": -32600, "message": "no rollout found for thread id x"}}),
        ],
        "thread/name/set",
        json!({}),
    );
    assert_eq!(out, Err(RpcFail::Error("no rollout found for thread id x".into())));
    let (out, sent) = exchange(&[json!({"id": 1, "error": {"code": -1, "message": "bad init"}})], "thread/delete", json!({}));
    assert_eq!(out, Err(RpcFail::Error("bad init".into())));
    assert_eq!(sent.len(), 1, "initialize 가 실패하면 요청을 보내지 않는다");
    let (out, _) = exchange(&[json!({"id": 1, "result": {}})], "thread/delete", json!({}));
    assert_eq!(out, Err(RpcFail::Closed));
}

#[test]
fn app_server_args_are_fixed() {
    assert_eq!(
        APP_SERVER_ARGS,
        ["app-server", "--disable", "hooks", "--disable", "plugins", "--disable", "apps"]
    );
}
