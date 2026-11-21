//! 타일 MCP 토큰 — 로컬 AI 타일 · 셸 통합 감싸개가 있는 로컬 셸 타일마다 따로 뽑는 MCP 토큰의 세션 서버 표(`/mcp` 가 이것으로 어느 타일의 호출인지 안다).
//!
//! 요청마다 토큰의 `(stream, sessionEpoch)` 가 세션 코어의 지금 회차 · 생존과 같아야 한다 — 아니면 `stale-tile`(표에서 아직 거두지 못한 틈도 막는다).
//! F5 · 웹뷰 크래시 재부착은 회차를 바꾸지 않아 그대로다 · 회수는 주인 번호가 같을 때만(새 세션이 갈아 치운 칸은 건드리지 않는다).
//!
//! ## 불변식
//!
//! - 값은 GUI Rust 만 서버 op `mcp_tile_token`(살아 있는 회차일 때만)으로 받아 그 타일의 `--mcp-config` 파일에 쓴다 · 셸에는 서버가 `open` 에서 넣는다.
//!   **프런트 · 로그 · `Debug` · 영속 파일 · 이벤트에 없다**(`Debug` 를 파생하지 않는다 — 시험 `tile_token_never_reaches_frontend`).
//! - **원격 타일에는 없다** — 원격 타일은 신호 전용 토큰뿐이다(`crate::agent_signal` 머리말 — 바꾸지 않는다). 이 표는 로컬 세션(`Kind::Local`)만 본다.
//! - **타일은 오케스트레이션 자리가 되지 못한다** — 타일 토큰의 목록에는 타일 도구 · 조율 도구가 없고, 불러도 모르는 도구다(`crate::orchestration::is_tool_for`).
//!   토큰은 "어느 타일인가" 만 말한다.
//! - **타일 토큰은 같은 계정 안의 보안 경계가 아니다**(→ docs/invariants.md 전문 9). 탈취한 토큰의 재사용은 그 세션이 사는 동안만이다.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use crate::tile_env::stream_ok;

/// 401 몸의 낱말.
pub(crate) const STALE_TILE: &str = "stale-tile";

/// `owner` 는 그 세션의 신호 토큰과 같은 주인 번호다. **`Debug` 를 파생하지 않는다**(토큰).
struct Entry {
    token: String,
    owner: u64,
    epoch: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Auth {
    Tile(String),
    /// 회차가 다르거나 세션이 끝났다(또는 아직 회차가 서지 않았다) — `stale-tile`.
    Stale,
}

#[derive(Default)]
pub(crate) struct TileTokens {
    map: HashMap<String, Entry>,
}

impl TileTokens {
    pub(crate) fn insert(&mut self, stream: &str, token: String, owner: u64) {
        self.map.insert(stream.to_string(), Entry { token, owner, epoch: None });
    }

    pub(crate) fn bind_epoch(&mut self, stream: &str, owner: u64, epoch: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(e) if e.owner == owner => {
                e.epoch = Some(epoch);
                true
            }
            _ => false,
        }
    }

    pub(crate) fn revoke(&mut self, stream: &str, owner: u64) -> bool {
        if self.map.get(stream).is_some_and(|e| e.owner == owner) {
            self.map.remove(stream);
            return true;
        }
        false
    }


    /// 모르는 토큰이면 `None` — 다른 토큰 표가 본다. 운영 길은 같은 판정을 표의 잠금 밖에서 하는 전역 [`authenticate`](fn@authenticate).
    #[cfg(test)]
    pub(crate) fn authenticate(&self, header: Option<&str>, live: impl Fn(&str) -> Option<u64>) -> Option<Auth> {
        let (stream, epoch) = self.lookup(header)?;
        Some(match epoch {
            Some(e) if live(&stream) == Some(e) => Auth::Tile(stream),
            _ => Auth::Stale,
        })
    }

    /// 상수 시간 비교로 **전부** 훑는다 — 어느 칸에서 맞았는지가 시간으로 새지 않게.
    fn lookup(&self, header: Option<&str>) -> Option<(String, Option<u64>)> {
        let presented = header?.strip_prefix("Bearer ")?.trim();
        if presented.is_empty() {
            return None;
        }
        let mut hit: Option<(&String, Option<u64>)> = None;
        for (stream, e) in &self.map {
            if crate::token::ct_eq(e.token.as_bytes(), presented.as_bytes()) {
                hit = Some((stream, e.epoch));
            }
        }
        hit.map(|(s, e)| (s.clone(), e))
    }

    #[cfg(test)]
    pub(crate) fn token_for(&self, stream: &str, live: impl Fn(&str) -> Option<u64>) -> Option<String> {
        let e = self.map.get(stream)?;
        let epoch = e.epoch?;
        (live(stream) == Some(epoch)).then(|| e.token.clone())
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.map.len()
    }
}

/// 잠금 순서 — 세션 코어 잠금을 쥔 채 이 잠금을 잡지 않고, 이 잠금을 쥔 채 세션 코어를 잡지 않는다([`authenticate`] 는 표에서 꺼낸 뒤 놓고 코어를 본다).
static TILES: LazyLock<Mutex<TileTokens>> = LazyLock::new(Default::default);

fn tiles() -> std::sync::MutexGuard<'static, TileTokens> {
    TILES.lock().unwrap_or_else(|e| e.into_inner())
}

fn live_epoch(stream: &str) -> Option<u64> {
    crate::session_core::core().live_epoch(stream)
}

/// 서버의 `open` 이 셸을 띄우기 **전에** 뽑는다. `None` 이면 그 타일은 MCP 토큰 없이 연다.
pub(crate) fn issue(stream: &str, owner: u64) -> Option<String> {
    if !stream_ok(stream) {
        return None;
    }
    let token = crate::token::generate_token()?;
    tiles().insert(stream, token.clone(), owner);
    Some(token)
}

pub(crate) fn bind_epoch(stream: &str, owner: u64, epoch: u64) -> bool {
    tiles().bind_epoch(stream, owner, epoch)
}

pub(crate) fn revoke(stream: &str, owner: u64) -> bool {
    tiles().revoke(stream, owner)
}

pub(crate) fn authenticate(header: Option<&str>) -> Option<Auth> {
    let (stream, epoch) = tiles().lookup(header)?;
    Some(match epoch {
        Some(e) if live_epoch(&stream) == Some(e) => Auth::Tile(stream),
        _ => Auth::Stale,
    })
}

/// **GUI Rust 만**(서버 op `mcp_tile_token`). 로그 금지.
pub(crate) fn token_for(stream: &str) -> Option<String> {
    let epoch_tok = {
        let t = tiles();
        let e = t.map.get(stream)?;
        (e.epoch?, e.token.clone())
    };
    (live_epoch(stream) == Some(epoch_tok.0)).then_some(epoch_tok.1)
}

/// 시험 전용 가짜 AI 타일 — 전역 세션 코어 · 표를 함께 쓰므로 손잡이 · 스트림은 시험마다 겹치지 않는다.
#[cfg(test)]
pub(crate) struct FakeTile {
    pub stream: String,
    pub token: String,
    id: u32,
    owner: u64,
}

#[cfg(test)]
impl FakeTile {
    pub(crate) fn open(tag: &str) -> FakeTile {
        use std::sync::atomic::{AtomicU32, Ordering};
        static SEQ: AtomicU32 = AtomicU32::new(3_900_000_000);
        let id = SEQ.fetch_add(1, Ordering::SeqCst);
        let owner = 90_000_000_000 + u64::from(id);
        let stream = format!("tile-{tag}-{id}");
        let mut t = FakeTile {
            stream,
            token: String::new(),
            id,
            owner,
        };
        t.reopen_session();
        t
    }

    /// 서버 `open` 과 같은 순서(뽑고 → 회차가 서면 묶는다).
    fn reopen_session(&mut self) {
        self.token = issue(&self.stream, self.owner).expect("토큰");
        let keys = crate::session_core::core().commit(
            &self.stream,
            crate::session_core::Kind::Local,
            self.id,
            &format!("test-window-{}", self.id),
            std::time::Instant::now(),
        );
        assert!(bind_epoch(&self.stream, self.owner, keys.session_epoch));
    }

    pub(crate) fn header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    pub(crate) fn caller(&self) -> crate::orchestration::Caller {
        match authenticate(Some(&self.header())) {
            Some(Auth::Tile(stream)) => crate::orchestration::Caller::Tile { stream },
            other => panic!("타일 토큰이 풀리지 않는다: {other:?}"),
        }
    }

    /// 서버의 `released` 와 같은 열쇠로 거둔다.
    pub(crate) fn close(&self) {
        crate::session_core::core().remove_id(crate::session_core::Kind::Local, self.id);
        revoke(&self.stream, self.owner);
    }

    /// 셸만 끝났다(회수 전) — 토큰은 표에 있지만 살아 있는 회차가 없다(`stale-tile`).
    pub(crate) fn exit(&self) {
        crate::session_core::core().ended(
            crate::session_core::Kind::Local,
            self.id,
            crate::session_core::End::Exited {
                reason: None,
                final_offset: 0,
            },
        );
    }

    /// 같은 스트림의 새 세션(회차 +1) — 옛 토큰을 돌려준다.
    pub(crate) fn recreate(&mut self) -> String {
        let old = self.token.clone();
        self.close();
        self.owner += 1;
        self.reopen_session();
        old
    }

    /// F5 · 웹뷰 크래시 재부착 — 회차는 그대로 두고 창만 떼었다 붙인다.
    pub(crate) fn reattach(&self) {
        let mut core = crate::session_core::core();
        let window = format!("test-window-{}", self.id);
        let detached = core.detach_window(&window, &std::collections::HashSet::new());
        assert_eq!(detached.len(), 1, "F5 — 임대만 풀린다");
        core.attach(&self.stream, None, &window, false).expect("새 페이지가 다시 붙는다");
    }
}

#[cfg(test)]
impl Drop for FakeTile {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(map: &'static [(&'static str, u64)]) -> impl Fn(&str) -> Option<u64> {
        move |s: &str| map.iter().find(|(k, _)| *k == s).map(|(_, e)| *e)
    }

    #[test]
    fn tile_token_bound_to_session_epoch() {
        let mut t = TileTokens::default();
        t.insert("tile-a", "tok-a".into(), 7);
        let auth = |t: &TileTokens, h: &str, l: &'static [(&'static str, u64)]| t.authenticate(Some(h), live(l));
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 1)]), Some(Auth::Stale));
        assert!(t.bind_epoch("tile-a", 7, 1));
        assert!(!t.bind_epoch("tile-a", 8, 1), "남의 주인 번호로는 못 묶는다");
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 1)]), Some(Auth::Tile("tile-a".into())));
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 1)]), Some(Auth::Tile("tile-a".into())));
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 2)]), Some(Auth::Stale));
        assert_eq!(auth(&t, "Bearer tok-a", &[]), Some(Auth::Stale));
        assert_eq!(auth(&t, "Bearer nope", &[("tile-a", 1)]), None);
        assert_eq!(auth(&t, "Bearer ", &[("tile-a", 1)]), None);
        assert_eq!(t.authenticate(Some("tok-a"), live(&[("tile-a", 1)])), None);
        assert_eq!(t.authenticate(None, live(&[("tile-a", 1)])), None);
        assert_eq!(t.token_for("tile-a", live(&[("tile-a", 1)])).as_deref(), Some("tok-a"));
        assert_eq!(t.token_for("tile-a", live(&[("tile-a", 2)])), None);
        t.insert("tile-a", "tok-a2".into(), 9);
        t.bind_epoch("tile-a", 9, 2);
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 2)]), None);
        assert_eq!(auth(&t, "Bearer tok-a2", &[("tile-a", 2)]), Some(Auth::Tile("tile-a".into())));
        assert!(!t.revoke("tile-a", 7));
        assert_eq!(t.len(), 1);
        assert!(t.revoke("tile-a", 9));
        assert_eq!(auth(&t, "Bearer tok-a2", &[("tile-a", 2)]), None, "회수 뒤엔 모르는 토큰(401)");
    }

    /// 타일 칸에 조정자 자리의 표지 · 기록 · 함수가 돌아오지 않는다(타일은 조정자 자리가 되지 못한다).
    #[test]
    fn tile_marks_are_gone() {
        let src = include_str!("tile_token.rs");
        let body = &src[..src.find("#[cfg(test)]\nmod tests").or_else(|| src.find("#[cfg(test)]\r\nmod tests")).unwrap()];
        for gone in [
            "fn set_producer",
            "fn is_producer",
            "producer: bool",
            "fn with_request",
            "fn call_mark",
            "fn still_caller",
            "fn note_agent_exit",
            "fn start_cwd",
            "fn set_start_cwd",
            "REQUESTS_MAX",
        ] {
            assert!(!body.contains(gone), "{gone} 가 남았다");
        }
    }
}
