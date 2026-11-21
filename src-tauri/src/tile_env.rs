//! 타일 셸 환경변수의 이름과 그 값의 순수 모양 — 셸 통합 감싸개 · 훅 스크립트가 이름을 글자로 들고 있어 바꾸지 않는다.
//! 맨 아래 층이다 — 앱 상태를 읽는 것은 여기 두지 않는다.

/// **인스턴스마다 다르다**(릴리스 · 개발) — 한 이름을 둘이 나눠 쓰면 어느 환경에서든 두 토큰 중 하나만 담긴다.
pub(crate) const MCP_TOKEN_ENV: &str = crate::instance::mcp_token_env(crate::instance::DEV);

/// 이름과 달리 MCP(`/mcp`) 포트가 아니라 세션 서버의 **신호 평면 포트**다(원격은 그리로 이어지는 `-R` 포워드).
/// 비어 있으면(앱 밖에서 띄운 Claude Code) 훅 스크립트는 조용히 끝난다.
pub(crate) const MCP_URL_ENV: &str = "AYNX_MCP_URL";

/// = 그 타일의 `historyStreamId`.
pub(crate) const STREAM_ENV: &str = "AYNX_STREAM";

/// 신호 전용 토큰 — 그 타일의 스트림에만 통한다. **원격 타일에는 이것만 간다** — MCP 토큰은 원격으로 나가지 않는다(docs/log/2026-09-24-remote-agent-signals.md).
pub(crate) const SIGNAL_TOKEN_ENV: &str = "AYNX_SIGNAL_TOKEN";

/// 권한 결정 토큰 — 신호 전용 토큰과 따로다(서로의 경로에서 통하지 않는다). 원격 타일에는 가지 않는다.
pub(crate) const PERMISSION_TOKEN_ENV: &str = "AYNX_PERMISSION_TOKEN";

/// 경로 없음 — 훅 스크립트가 [`crate::agent_signal::PATH`] 를 붙인다.
pub(crate) fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// 프런트의 `historyStreamId` 는 32자 hex 다 — 넉넉히 두되 무한정 받지 않는다.
pub(crate) const STREAM_MAX_CHARS: usize = 128;

/// 훅 스크립트가 이 값을 **이스케이프 없이** JSON 문자열에 끼워 넣는다 — 따옴표 · 역슬래시 · 공백을 들이면 깨진다(심는 쪽 · 받는 쪽이 이 함수 하나로 거른다).
pub(crate) fn stream_ok(s: &str) -> bool {
    !s.is_empty()
        && s.chars().count() <= STREAM_MAX_CHARS
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

/// 셸 통합의 `codex` 감싸개는 이것과 `AYNX_STREAM` 이 둘 다 있을 때만 선다.
pub(crate) const NO_DAEMON_ENV: &str = "AYNX_CODEX_NO_DAEMON";

/// 값은 한도 도우미 경로(= 앱 실행 파일).
pub(crate) const USAGE_HELPER_ENV: &str = "AYNX_CLAUDE_USAGE";

/// 값은 그 타일의 에이전트 장식 파일 **경로뿐**이다(파일에도 토큰 값은 없다).
pub(crate) const TILE_AGENT_ENV: &str = "AYNX_TILE_AGENT";

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
