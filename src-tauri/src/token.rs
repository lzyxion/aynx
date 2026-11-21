//! 비밀 토큰의 두 원시 조작 — 뽑기와 상수시간 비교. 토큰 값은 어디에도 찍지 않는다.

/// OS 엔트로피를 못 얻으면 `None` — 부르는 쪽은 MCP 를 끈다. 시각·PID 시드로 대신하지 않는다(같은 기기의 프로세스가 맞힐 수 있다).
pub(crate) fn generate_token() -> Option<String> {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).ok()?;
    Some(to_hex(&buf))
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

/// 상수시간 비교 — 길이가 다르면 즉시 false(토큰 길이는 비밀이 아니다). 중간에 `!= 0` 으로 빠져나가면 타이밍 신호가 되살아난다.
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
        assert!(!ct_eq(b"abc123", b"abc124"));
        assert!(!ct_eq(b"abc123", b"zbc123"));
        assert!(!ct_eq(b"abc", b"abc1"));
        assert!(!ct_eq(b"abc1", b"abc"));
    }

    #[test]
    fn token_generation_is_64_hex_chars() {
        let t = generate_token().expect("데스크톱에서 OS 엔트로피는 있다");
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(Some(t), generate_token());
    }
}
