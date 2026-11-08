//! 비밀 토큰의 두 원시 조작 — 뽑기([`generate_token`])와 상수시간 비교([`ct_eq`]).
//!
//! MCP 토큰(`crate::mcp`)과 신호 전용 토큰(`crate::agent_signal`)이 함께 쓴다. `mcp` 안에 있었을 때는
//! `agent_signal` 이 이 둘 때문에 `mcp` 를 불렀고 `mcp` 는 신호 경로 때문에 `agent_signal` 을 불러
//! 두 모듈이 서로 물렸다. 어느 쪽 상태도 모르는 순수 함수라 맨 아래에 둔다. 토큰 값은 어디에도
//! 찍지 않는다(뽑은 쪽의 책임 그대로).

/// 32바이트 무작위 토큰을 hex 로. `getrandom`(이미 전이 의존)으로 뽑는다.
///
/// OS 엔트로피를 못 얻으면 `None` 이다 — 부르는 쪽은 **MCP 를 끈다**(F5). 예전엔 시각·PID 로
/// 시드를 만들어 대신 썼지만, 그건 "누구든 맞힐 수 있는 토큰으로 열린 서버" 다. 시각과 PID 는
/// 같은 기기의 다른 프로세스에게 비밀이 아니고, 이 서버는 세션 컨텍스트를 읽어 준다 —
/// 예측 가능한 토큰으로 여느니 안 여는 쪽이 맞다. 결과는 어느 경우에도 로그에 남기지 않는다.
///
/// 신호 전용 토큰([`crate::agent_signal::issue`])도 같은 함수로 뽑는다.
pub(crate) fn generate_token() -> Option<String> {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).ok()?;
    Some(to_hex(&buf))
}

/// 바이트열을 소문자 hex 로 (크레이트 없이).
fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

/// 상수시간 바이트 비교 — 길이가 같을 때 **모든 바이트를 항상** 훑는다(F3).
///
/// 길이가 다르면 즉시 false 다(토큰 길이는 비밀이 아니다 — 늘 64자 hex). 같은 길이에서는
/// 분기 없이 XOR 을 `|=` 로만 누적한다: 중간에 `!= 0` 을 보고 빠져나가면 컴파일러가
/// 조기 종료를 남겨 원래 막으려던 타이밍 신호가 되살아난다.
pub(crate) fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_matches_only_identical_bytes() {
        assert!(ct_eq(b"abc123", b"abc123"));
        assert!(ct_eq(b"", b""));
        // 같은 길이, 마지막 한 바이트만 다름 — 조기 종료 없이 false 여야 한다.
        assert!(!ct_eq(b"abc123", b"abc124"));
        assert!(!ct_eq(b"abc123", b"zbc123"));
        // 길이가 다르면 즉시 false(길이는 비밀이 아니다).
        assert!(!ct_eq(b"abc", b"abc1"));
        assert!(!ct_eq(b"abc1", b"abc"));
    }

    #[test]
    fn token_generation_is_64_hex_chars() {
        let t = generate_token().expect("데스크톱에서 OS 엔트로피는 있다");
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        // 두 번 뽑으면 다르다(무작위).
        assert_ne!(Some(t), generate_token());
    }
}
