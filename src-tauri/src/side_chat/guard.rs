//! **프로듀서 승인 정책**(오케스트레이션 2단계 단계 2 — 설계 4-3 · R9 · 사용자 결정 U2/O2) — 어댑터(`claude` · `codex`)를 감싸는 순수 층.
//!
//! 프로듀서 채팅에서 **사람이 [허용] 할 수 있는 카드는 둘뿐**이다: Claude 의 `Read`(스튜디오 밖 경로 — 안쪽은 미리 허용 `Read(./**)`) ·
//! Aynx MCP 의 DB 도구(`mcp__<Aynx 서버>__db_*` — 행이 모델 제공자로 간다 · 연결 AI 권한 상한은 서버 그대로). 그 밖의 모든 승인 요청(Codex
//! 명령 실행 · 파일 변경 · 권한 확대 · 모르는 MCP 도구 · Claude 의 그 밖 도구)은 **카드 없이** 곧바로 거절 답을 짓고(`encode_decision(Deny)` —
//! 어댑터가 CLI 에 하는 고정 답과 같은 등급: 사람의 결정이 아니다) 알림 `notice{denied-by-policy, 요청 종류 낱말}` 만 낸다. 거절한 요청은
//! 권한 표(`pending`)에 적히지 않으므로 사람의 [`Adapter::encode_decision`](원격 · 다른 창의 `producer_chat_decide` 포함)이 우회로가 되지 않는다.
//!
//! 순수 — 프로세스 · 파일 · 환경을 모른다(어댑터 규칙 그대로).

use std::collections::BTreeSet;

use super::event::{Cli, Decision, Dropped, Ev, PermKind, Step, UserImage};
use super::Adapter;

/// 정책 거절 때 모델에게 가는 문장(영어 — 모델이 읽는다).
pub(crate) const DENIED_BY_POLICY: &str =
    "Aynx producer chats cannot change files, run commands outside the read-only sandbox or widen permissions — hand that work to a worker (spawn_worker)";

/// 알림 낱말.
pub(crate) const NOTICE: &str = "denied-by-policy";

/// 카드가 될 수 있는 요청인가 — Claude `Read` · Aynx MCP 의 DB 도구. 순수.
pub(crate) fn card_allowed(kind: PermKind, tool_name: &str, aynx_server: &str) -> bool {
    let db = tool_name.strip_prefix("mcp__").and_then(|r| r.strip_prefix(aynx_server)).and_then(|r| r.strip_prefix("__")).is_some_and(|t| {
        t.starts_with("db_") || t == "list_db_connections"
    });
    match kind {
        PermKind::Tool => tool_name == "Read" || db,
        PermKind::McpTool => db,
        PermKind::Command | PermKind::FileChange => false,
    }
}

fn kind_word(k: PermKind) -> &'static str {
    match k {
        PermKind::Tool => "tool",
        PermKind::Command => "command",
        PermKind::FileChange => "fileChange",
        PermKind::McpTool => "mcpTool",
    }
}

/// 어댑터를 감싼다 — 승인 요청만 거르고 나머지는 그대로 넘긴다.
pub(crate) struct ProducerGuard {
    inner: Box<dyn Adapter>,
    aynx: String,
    /// 정책으로 거절한 요청 id — 그 뒤 CLI 가 알리는 끝(`permissionResolved`)도 내지 않는다(화면에 카드가 선 적이 없다).
    denied: BTreeSet<String>,
}

impl ProducerGuard {
    pub(crate) fn new(inner: Box<dyn Adapter>, aynx_server: &str) -> ProducerGuard {
        ProducerGuard { inner, aynx: aynx_server.to_string(), denied: BTreeSet::new() }
    }

    fn filter(&mut self, step: Step) -> Step {
        let mut out = Step { evs: Vec::new(), stdin: step.stdin };
        for ev in step.evs {
            match ev {
                Ev::Permission { request_id, kind, tool_name, title, detail } => {
                    if card_allowed(kind, &tool_name, &self.aynx) {
                        out.evs.push(Ev::Permission { request_id, kind, tool_name, title, detail });
                        continue;
                    }
                    if let Ok(d) = self.inner.encode_decision(&request_id, Decision::Deny, Some(DENIED_BY_POLICY)) {
                        out.stdin.extend(d.stdin);
                    }
                    self.denied.insert(request_id);
                    out.evs.push(Ev::Notice { code: NOTICE, detail: Some(kind_word(kind).to_string()) });
                }
                Ev::PermissionResolved { ref request_id, .. } if self.denied.contains(request_id) => {
                    let id = request_id.clone();
                    self.denied.remove(&id);
                }
                other => out.evs.push(other),
            }
        }
        out
    }
}

impl Adapter for ProducerGuard {
    fn cli(&self) -> Cli {
        self.inner.cli()
    }

    fn handshake(&mut self) -> Vec<String> {
        self.inner.handshake()
    }

    fn on_line(&mut self, line: &str) -> Step {
        let step = self.inner.on_line(line);
        self.filter(step)
    }

    fn encode_user(&mut self, text: &str, images: &[UserImage], client_id: Option<&str>) -> Result<Step, &'static str> {
        self.inner.encode_user(text, images, client_id)
    }

    fn encode_interrupt(&mut self) -> Result<Step, &'static str> {
        self.inner.encode_interrupt()
    }

    fn encode_set_model(&mut self, model: &str) -> Result<Step, &'static str> {
        self.inner.encode_set_model(model)
    }

    fn encode_set_effort(&mut self, effort: Option<&str>) -> Result<Step, &'static str> {
        self.inner.encode_set_effort(effort)
    }

    /// 사람의 결정 — 카드로 선 요청만(정책으로 거절한 것은 어댑터 표에도 없다 — `unknown-request`).
    fn encode_decision(&mut self, request_id: &str, decision: Decision, message: Option<&str>) -> Result<Step, &'static str> {
        if self.denied.contains(request_id) {
            return Err("unknown-request");
        }
        self.inner.encode_decision(request_id, decision, message)
    }

    fn close_pending(&mut self) -> Vec<Ev> {
        let denied = std::mem::take(&mut self.denied);
        self.inner
            .close_pending()
            .into_iter()
            .filter(|e| !matches!(e, Ev::PermissionResolved { request_id, .. } if denied.contains(request_id)))
            .collect()
    }

    fn dropped(&self) -> Dropped {
        self.inner.dropped()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 시험 `producer_approval_allowlist`(설계 4-3) — 카드는 둘뿐(Claude `Read` · Aynx DB 도구) · 그 밖은 카드 없이 거절(Codex 명령 · 파일 ·
    /// 모르는 MCP · Claude 의 그 밖 도구 · 다른 서버의 `db_` 이름) · 거절한 요청은 사람의 결정이 받지 못한다.
    #[test]
    fn producer_approval_allowlist() {
        let s = "aynx-sessions";
        assert!(card_allowed(PermKind::Tool, "Read", s));
        assert!(card_allowed(PermKind::Tool, "mcp__aynx-sessions__db_query", s));
        assert!(card_allowed(PermKind::McpTool, "mcp__aynx-sessions__db_query", s));
        for (k, t) in [
            (PermKind::Tool, "Bash"),
            (PermKind::Tool, "Edit"),
            (PermKind::Tool, "WebFetch"),
            (PermKind::Tool, "mcp__other__db_query"),
            (PermKind::Tool, "mcp__aynx-sessions-x__db_query"),
            (PermKind::Tool, "mcp__aynx-sessions__create_execution_plan"),
            (PermKind::McpTool, "mcp__aynx-sessions__adopt_run"),
            (PermKind::McpTool, "mcp__aynx-sessions__"),
            (PermKind::Command, "commandExecution"),
            (PermKind::FileChange, "fileChange"),
        ] {
            assert!(!card_allowed(k, t, s), "{t}");
        }

        // 진짜 Claude 어댑터를 감싸 — Bash 요청은 카드 없이 거절 답 + 알림, Read 요청은 카드.
        let o = crate::side_chat::claude::Opts {
            exe: "claude.exe",
            mode: crate::side_chat::event::Mode::Fresh,
            session_id: "11111111-2222-4333-8444-555555555555",
            model: "",
            effort: None,
            settings_file: "s.json",
            mcp_config_file: "m.json",
            append_file: None,
            mcp_allowed: &[],
        };
        let mut g = ProducerGuard::new(Box::new(crate::side_chat::claude::Claude::new(&o)), s);
        let req = |id: &str, tool: &str| {
            serde_json::json!({"type": "control_request", "request_id": id, "request": {"subtype": "can_use_tool", "tool_name": tool, "input": {"command": "rm -rf x", "file_path": "C:/x"}}}).to_string()
        };
        let st = g.on_line(&req("q1", "Bash"));
        assert_eq!(st.evs, vec![Ev::Notice { code: NOTICE, detail: Some("tool".into()) }]);
        assert_eq!(st.stdin.len(), 1);
        assert!(st.stdin[0].contains("\"deny\"") && st.stdin[0].contains("q1"), "{}", st.stdin[0]);
        assert_eq!(g.encode_decision("q1", Decision::Allow, None).err(), Some("unknown-request"), "거절한 요청은 사람이 허용할 수 없다");
        let st = g.on_line(&req("q2", "Read"));
        assert!(matches!(&st.evs[..], [Ev::Permission { request_id, .. }] if request_id == "q2"));
        assert!(st.stdin.is_empty());
        assert!(g.encode_decision("q2", Decision::Allow, None).is_ok());
        assert!(g.close_pending().is_empty());
    }
}
