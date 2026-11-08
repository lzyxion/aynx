//! 타일 셸 환경변수의 **이름**과 그 값의 순수 모양 — 로컬 PTY(`crate::pty`)·원격 SSH(`crate::ssh`)
//! 가 셸에 심고, 셸 통합 감싸개·훅 스크립트가 읽는 약속이다.
//!
//! 이름은 한 번 정하면 셸 쪽 스크립트가 글자로 들고 있어 바뀌지 않는 **맨 아래 층의 상수**다. 예전엔
//! 쓰는 기능 모듈(`mcp` · `agent_signal` · `codex_launch` · `claude_usage`)에 흩어져 있어서, 이름 하나를
//! 얻으려고 세션 층이 기능 층을 불렀다. 앱 상태를 읽는 것(`claude_usage::tile_env` 등)은 여기
//! 두지 않는다 — 이 파일은 아무것도 모른다.

/// AI 타일 · 감싸개가 있는 로컬 셸 타일(2026-10-26)의 셸에 MCP 토큰을 싣는 환경변수 이름 — **인스턴스마다 다르다**(릴리스 `AYNX_MCP_TOKEN` ·
/// 개발 `AYNX_DEV_MCP_TOKEN`, [`crate::instance::mcp_token_env`]). 한 이름을 둘이 나눠 쓰면 어느
/// 환경에서든 두 토큰 중 하나만 담긴다. 등록은 이제 이 변수를 쓰지 않는다(claude 는 헤더,
/// codex 는 설정 파일의 고정 헤더) — 남은 독자는 옛 방식 등록과 훅 스크립트의 물러남뿐이다.
pub(crate) const MCP_TOKEN_ENV: &str = crate::instance::mcp_token_env(crate::instance::DEV);

/// AI 타일 환경의 **서버 바탕 주소**([`base_url`] — `http://127.0.0.1:<port>`, 경로 없음). 훅
/// 스크립트가 `$AYNX_MCP_URL/agent-signal` 로 쏜다. 비어 있으면(앱 밖에서 띄운 Claude Code) 스크립트는
/// 조용히 끝난다 (docs/log/2026-09-24-agent-hook-signals.md). 이름은 옛 것 그대로지만 ③-3a 부터 가리키는 곳은 **세션 서버의
/// 신호 평면 포트**다(로컬은 그 포트, 원격은 그리로 이어지는 `-R` 포워드) — MCP(`/mcp`) 포트가 아니다. 셸 스크립트가 글자로
/// 들고 있어 이름은 바꾸지 않는다.
pub(crate) const MCP_URL_ENV: &str = "AYNX_MCP_URL";

/// AI 타일 환경의 **스트림 id**(= 그 타일의 `historyStreamId`) — 훅 신호가 어느 타일의 것인지 가른다.
pub(crate) const STREAM_ENV: &str = "AYNX_STREAM";

/// AI 타일 환경의 **신호 전용 토큰**([`crate::agent_signal::issue`]) — `/agent-signal` 에서, 그 타일의
/// 스트림에만 통한다. 훅 스크립트는 이것을 먼저 쓰고 없으면 [`MCP_TOKEN_ENV`] 로 물러난다. **원격
/// 타일에는 이것만 간다** — MCP 토큰은 서버로 나가지 않는다(docs/log/2026-09-24-remote-agent-signals.md).
pub(crate) const SIGNAL_TOKEN_ENV: &str = "AYNX_SIGNAL_TOKEN";

/// 로컬 AI 타일 · 감싸개 셸 타일 환경의 **권한 결정 토큰**([`crate::tile_permission::issue`] — 2026-11-01) — `/agent-permission` 에서, 그
/// 타일의 스트림에만 통한다(신호 전용 토큰과 따로 · 서로 통하지 않는다). 타일 장식이 건 권한 훅의 도우미(`aynx agent-permission`)만 읽는다.
/// 원격 타일에는 가지 않는다.
pub(crate) const PERMISSION_TOKEN_ENV: &str = "AYNX_PERMISSION_TOKEN";

/// 포트 → 서버의 **바탕 주소**(경로 없음) — AI 타일 환경의 [`MCP_URL_ENV`] 값. 훅 스크립트가
/// 여기에 [`crate::agent_signal::PATH`] 를 붙여 쏜다.
pub(crate) fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// 스트림 id 상한 — 프런트의 `historyStreamId` 는 32자 hex 다. 넉넉히 두되 무한정 받지 않는다.
pub(crate) const STREAM_MAX_CHARS: usize = 128;

/// 스트림 id 로 받는 모양인가 — 영숫자와 `-`·`_`·`.`·`:` 만, 1..=[`STREAM_MAX_CHARS`] 자.
///
/// 이 값은 타일 환경변수(`AYNX_STREAM`)로 나가 훅 스크립트가 **이스케이프 없이** JSON 문자열 안에
/// 끼워 넣는다(`.cmd` 에서 JSON 이스케이프는 비싸다). 그래서 따옴표·역슬래시·공백이 애초에 들어갈
/// 수 없게 양쪽(심는 `crate::pty` 와 받는 [`crate::agent_signal::parse`])이 이 한 함수로 거른다.
pub(crate) fn stream_ok(s: &str) -> bool {
    !s.is_empty()
        && s.chars().count() <= STREAM_MAX_CHARS
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

/// 로컬 타일 셸 환경의 표식 — 설정(`[ai] codex_no_daemon`)이 켜졌을 때만 `1` 로 심는다(`crate::pty`).
/// 셸 통합의 `codex` 감싸개는 이것과 `AYNX_STREAM` 이 둘 다 있을 때만 선다.
pub(crate) const NO_DAEMON_ENV: &str = "AYNX_CODEX_NO_DAEMON";

/// 로컬 타일 셸 환경 — 값은 **한도 도우미 경로**(= 앱 실행 파일). Claude Code 의 mod(`crate::claude_usage`)가 이 경로의
/// `claude-usage` 갈래로 요금제 한도를 넘긴다. mod 폴더를 싣는 `CLAUDE_CODE_PLUGIN_DIRS` 와 함께 심는다.
pub(crate) const USAGE_HELPER_ENV: &str = "AYNX_CLAUDE_USAGE";

/// 로컬 셸 타일 환경 — 값은 그 타일의 **에이전트 장식 파일 경로**(`crate::agent_tile` — 2026-10-26 에이전트 활성화). 셸 통합의 `claude` ·
/// `codex` 감싸개가 그 파일의 낱말을 끼운다. 경로뿐이다(파일에도 토큰 값은 없다 — Claude 는 실행 설정 파일 경로, Codex 는 토큰 변수 이름).
pub(crate) const TILE_AGENT_ENV: &str = "AYNX_TILE_AGENT";

// (3차 6단계 · 헤드리스 설계 Q6) 조정자 타일의 `AYNX_CLI`(`aynx wt …` CLI 경로)는 걷었다 — CLI 와 worktree 도구 셋이 없다. 같은 이름의
// 훅 스크립트 지역 변수(`agent_hooks.rs` 의 `.cmd` — 어느 CLI 의 신호인가)는 다른 뜻이라 그대로다.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_shape_allows_hex_and_simple_ids_only() {
        assert!(stream_ok("0123abcd0123abcd0123abcd0123abcd"));
        assert!(stream_ok("p-1_x.y:z"));
        assert!(!stream_ok(""));
        assert!(!stream_ok("a%b"));
        assert!(!stream_ok(r"a\b"));
        assert!(!stream_ok("한글"));
    }
}
