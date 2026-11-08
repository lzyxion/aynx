//! **타일 MCP 토큰**(오케스트레이션 3차 4단계 — 설계 `docs/log/2026-10-16-orchestration-headless-design.md` 3-1 · 리뷰 D4) — 로컬 AI 타일(2026-10-26 부터
//! 셸 통합 감싸개가 있는 로컬 셸 타일도 — 그 셸에서 친 `claude` · `codex` 가 AI 타일과 같게, `crate::agent_tile`)마다
//! 따로 뽑는 MCP 토큰의 **세션 서버 표**. 예전에는 모든 AI 타일이 서버 전역 토큰 하나(`mcp.json`)를 썼고 `/mcp` 는 **어느 타일의 호출인지**
//! 몰랐다 — 읽기 권한(타일별 AI 읽기 허용) · 작업안 요청 이름표가 이 표로 타일을 안다.
//!
//! ## 수명 — 신호 전용 토큰과 같은 틀(`crate::agent_signal`)
//!
//! | 사건 | 토큰 |
//! | --- | --- |
//! | 세션 `open`(AI 타일 · 감싸개가 있는 로컬 셸 타일 — 몸의 `mcp`, 2026-10-26) | 서버가 뽑아 셸 환경(`instance::mcp_token_env`)에 넣는다 → 회차(`sessionEpoch`)가 서면 그 회차에 묶는다([`bind_epoch`]) |
//! | GUI 재부착(F5 · 웹뷰 크래시 — 임대만 풀림) | 그대로(세션 · 회차가 그대로다) |
//! | 세션 회수(셸 끝 · 타일 닫기 · 서버 끝) · 회차 +1(같은 스트림의 새 세션) | 폐기([`revoke`] — 주인 번호가 같을 때만 · 새 세션이 갈아 치운 것은 건드리지 않는다) |
//! | 서버 재시작 | 표가 메모리뿐이라 전부 새로 |
//!
//! **요청마다** 토큰이 가리키는 `(stream, sessionEpoch)` 가 세션 코어의 지금 회차 · 생존과 같은지 본다([`authenticate`]) — 회차가 바뀌었거나
//! 세션이 끝났으면 인증 실패 `stale-tile`(표에서 아직 거두지 못한 틈도 막는다).
//!
//! ## 불변식
//!
//! - **값은 GUI Rust 만** 서버 op `mcp_tile_token`(그 스트림 · 살아 있는 회차일 때만)으로 받아 Claude 실행 설정 파일(`--mcp-config` — 타일마다
//!   하나)에 쓴다. 셸에는 서버가 `open` 에서 직접 넣는다. **프런트 · 로그 · `Debug` · 영속 파일 · 이벤트에 없다**(`Debug` 를 파생하지 않는다 —
//!   시험 `tile_token_never_reaches_frontend`).
//! - **원격 타일에는 없다** — 원격 타일은 신호 전용 토큰뿐이다(`crate::agent_signal` 머리말 — 바꾸지 않는다). 이 표는 로컬 세션(`Kind::Local`)만 본다.
//! - **타일은 오케스트레이션 자리가 되지 못한다**(오케스트레이션 탭 2단계 — aynx-notes `docs/log/2026-10-30-orchestration-structured-producer.md`
//!   6절): 타일 토큰의 목록에는 타일 도구 · 조율 도구가 없고, 불러도 모르는 도구다(`crate::orchestration::is_tool_for`). 조정자는 오케스트레이션 탭의 프로듀서 채팅(`crate::chat_token` 종류 `producer`)이다. 1단계(10-29)의 칸 — 프로듀서
//!   표지 · 멱등 기록 · 호출 표지 · 시작 폴더 — 는 걷었다. 토큰은 "어느 타일인가" 만 말한다.
//! - **타일 토큰은 같은 계정 안의 보안 경계가 아니다**(역할 토큰과 같은 등급 — 설계 C-1 (가)). 탈취한 토큰의 재사용은 그 세션이 사는 동안만이다.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use crate::tile_env::stream_ok;

/// 인증 실패 낱말 — 토큰은 알지만 그 세션의 회차가 바뀌었거나 세션이 끝났다(401 몸).
pub(crate) const STALE_TILE: &str = "stale-tile";

/// 스트림 한 칸 — 토큰 · 주인 번호(그 세션의 신호 토큰과 같은 번호 — 회수가 자기 것만 거두게) · 묶인 회차(열기가 서기 전엔 `None`).
/// **`Debug` 를 파생하지 않는다**(토큰).
struct Entry {
    token: String,
    owner: u64,
    epoch: Option<u64>,
    /// 앱이 띄운 로컬 AI 타일인가(`open` 몸의 `ai` — 2026-10-26: 감싸개가 있는 로컬 셸 타일도 토큰을 받으므로 표에 칸이 있다는 것만으로는
    /// AI 타일이 아니다 · [`is_ai_tile`]).
    ai: bool,
}

/// 토큰 확인 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Auth {
    /// 살아 있는 그 회차의 타일 — 스트림.
    Tile(String),
    /// 토큰은 표에 있지만 회차가 다르거나 세션이 끝났다(또는 아직 회차가 서지 않았다) — `stale-tile`.
    Stale,
}

/// 스트림 → 한 칸. 순수 자료구조라 시험이 제 것을 만든다 — 서버는 전역 하나([`TILES`]).
#[derive(Default)]
pub(crate) struct TileTokens {
    map: HashMap<String, Entry>,
}

impl TileTokens {
    /// 토큰 하나를 적는다(같은 스트림의 옛 칸은 갈아 치운다 — 새 세션 = 새 토큰).
    pub(crate) fn insert(&mut self, stream: &str, token: String, owner: u64) {
        self.map.insert(stream.to_string(), Entry { token, owner, epoch: None, ai: true });
    }

    /// 열기가 섰다 — 그 주인의 칸에 회차를 묶는다(주인이 다르면 아무것도 안 한다).
    pub(crate) fn bind_epoch(&mut self, stream: &str, owner: u64, epoch: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(e) if e.owner == owner => {
                e.epoch = Some(epoch);
                true
            }
            _ => false,
        }
    }

    /// 거둔다 — **그 스트림의 주인이 이 번호일 때만**(새 세션이 갈아 치운 칸은 둔다).
    pub(crate) fn revoke(&mut self, stream: &str, owner: u64) -> bool {
        if self.map.get(stream).is_some_and(|e| e.owner == owner) {
            self.map.remove(stream);
            return true;
        }
        false
    }


    /// `Authorization` 머리 → 확인 결과. 모르는 토큰 · 빈 토큰 · `Bearer` 없는 머리면 `None`(다른 토큰 표가 본다). `live` 는 세션 코어의
    /// "끝나지 않은 로컬 세션의 지금 회차"(시험이 끼운다). 비교는 상수 시간으로 **전부** 훑는다(어느 칸에서 맞았는지가 시간으로 새지 않게).
    /// 운영 길은 같은 판정을 표의 잠금 밖에서 하는 전역 [`authenticate`](fn@authenticate) — 이것은 그 판정을 시험이 세션 코어 없이 고정하는 자리.
    #[cfg(test)]
    pub(crate) fn authenticate(&self, header: Option<&str>, live: impl Fn(&str) -> Option<u64>) -> Option<Auth> {
        let (stream, epoch) = self.lookup(header)?;
        Some(match epoch {
            Some(e) if live(&stream) == Some(e) => Auth::Tile(stream),
            _ => Auth::Stale,
        })
    }

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

    /// 그 스트림의 토큰 — 회차가 서 있고 `live` 가 같은 회차일 때만(GUI Rust 의 실행 설정 파일용 — op `mcp_tile_token` · 운영 길은 전역 [`token_for`](fn@token_for)).
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

/// **세션 서버 프로세스의** 표 — `/mcp` 요청 스레드(인증)와 세션 op(뽑고 거두는 쪽)가 함께 본다. 잠금은 문장 하나 안에서 끝난다(세션 코어
/// 잠금을 쥔 채 이 잠금을 잡지 않고, 이 잠금을 쥔 채 세션 코어를 잡지 않는다 — [`authenticate`] 는 표에서 꺼낸 뒤 놓고 코어를 본다).
static TILES: LazyLock<Mutex<TileTokens>> = LazyLock::new(Default::default);

fn tiles() -> std::sync::MutexGuard<'static, TileTokens> {
    TILES.lock().unwrap_or_else(|e| e.into_inner())
}

/// 세션 코어의 "끝나지 않은 로컬 세션의 지금 회차".
fn live_epoch(stream: &str) -> Option<u64> {
    crate::session_core::core().live_epoch(stream)
}

/// 스트림 하나에 토큰을 뽑는다(서버의 `open` — 셸을 띄우기 **전에**). `owner` 는 그 세션의 신호 토큰 주인 번호(회수가 같은 열쇠로 거둔다).
/// `ai` 는 앱이 띄운 AI 타일인가(아니면 감싸개가 있는 로컬 셸 타일 — 2026-10-26, 토큰 · 수명은 같다 · [`is_ai_tile`] 만 다르다).
/// 스트림 모양이 틀렸거나 OS 난수를 못 얻으면 `None`(그 타일은 MCP 토큰 없이 연다).
pub(crate) fn issue(stream: &str, owner: u64, ai: bool) -> Option<String> {
    if !stream_ok(stream) {
        return None;
    }
    let token = crate::token::generate_token()?;
    let mut t = tiles();
    t.insert(stream, token.clone(), owner);
    if let Some(e) = t.map.get_mut(stream) {
        e.ai = ai;
    }
    Some(token)
}

/// 열기가 섰다 — 회차를 묶는다.
pub(crate) fn bind_epoch(stream: &str, owner: u64, epoch: u64) -> bool {
    tiles().bind_epoch(stream, owner, epoch)
}

/// 세션 회수 · 열기 실패 — 자기 것만 거둔다.
pub(crate) fn revoke(stream: &str, owner: u64) -> bool {
    tiles().revoke(stream, owner)
}

/// `/mcp` 인증 — 타일 토큰이면 `Some`(살아 있는 회차면 [`Auth::Tile`], 아니면 [`Auth::Stale`]). 표의 잠금을 놓은 뒤 세션 코어를 본다.
pub(crate) fn authenticate(header: Option<&str>) -> Option<Auth> {
    let (stream, epoch) = tiles().lookup(header)?;
    Some(match epoch {
        Some(e) if live_epoch(&stream) == Some(e) => Auth::Tile(stream),
        _ => Auth::Stale,
    })
}

/// 이 스트림이 **앱이 띄운 로컬 AI 타일**인가(10-23) — 표에 칸이 있고 `open` 이 AI 타일(`ai`)로 적은 것. 감싸개가 있는 로컬 셸 타일도
/// 토큰을 받지만(2026-10-26) AI 타일이 아니다 — 그 타일의 AI 읽기 허용은 예전 그대로 사람이 켠다.
/// AI 타일에는 AI 읽기 허용이 없다 — 거울 신원 보고(`server::ai` 의 `Report`)와 세션 메타(`session_ai_read`)가 이 판정으로 켬을 끈다.
pub(crate) fn is_ai_tile(stream: &str) -> bool {
    tiles().map.get(stream).is_some_and(|e| e.ai)
}

/// 그 스트림의 토큰 — **GUI Rust 만**(서버 op `mcp_tile_token` — Claude 실행 설정 파일에 쓰려고). 로그 금지.
pub(crate) fn token_for(stream: &str) -> Option<String> {
    let epoch_tok = {
        let t = tiles();
        let e = t.map.get(stream)?;
        (e.epoch?, e.token.clone())
    };
    (live_epoch(stream) == Some(epoch_tok.0)).then_some(epoch_tok.1)
}

/// **시험 전용 가짜 AI 타일** — 세션 코어(전역)에 살아 있는 로컬 세션 하나 + 이 표의 타일 토큰을, 서버 `open` 과 같은 순서로(뽑고 → 회차가
/// 서면 묶는다) 세운다. 끝나면(drop) 서버 회수와 같은 열쇠로 거둔다. 손잡이 · 스트림은 시험마다 겹치지 않는다(전역 표를 함께 쓴다).
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

    /// 열기 = 서버 `open` 과 같은 순서(뽑고 → 회차가 서면 묶는다).
    fn reopen_session(&mut self) {
        self.token = issue(&self.stream, self.owner, true).expect("토큰");
        let keys = crate::session_core::core().commit(
            &self.stream,
            crate::session_core::Kind::Local,
            self.id,
            &format!("test-window-{}", self.id),
            std::time::Instant::now(),
        );
        assert!(bind_epoch(&self.stream, self.owner, keys.session_epoch));
    }

    /// `Authorization` 머리.
    pub(crate) fn header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    /// `/mcp` 인증과 같은 길로 정한 호출자(살아 있는 회차의 타일).
    pub(crate) fn caller(&self) -> crate::orchestration::Caller {
        match authenticate(Some(&self.header())) {
            Some(Auth::Tile(stream)) => crate::orchestration::Caller::Tile { stream },
            other => panic!("타일 토큰이 풀리지 않는다: {other:?}"),
        }
    }

    /// 세션 회수(셸 끝 · 타일 닫기 — 서버의 `released` 와 같은 열쇠로 토큰을 거둔다).
    pub(crate) fn close(&self) {
        crate::session_core::core().remove_id(crate::session_core::Kind::Local, self.id);
        revoke(&self.stream, self.owner);
    }

    /// 셸이 끝났다(붙은 채 — 코어에 `Exited` 로 남고 회수 전) — 토큰은 아직 표에 있지만 살아 있는 회차가 없다(`stale-tile`).
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

    /// 같은 스트림의 **새 세션**(회차 +1) — 옛 세션을 거두고 새로 연다(새 토큰). 옛 토큰을 돌려준다.
    pub(crate) fn recreate(&mut self) -> String {
        let old = self.token.clone();
        self.close();
        self.owner += 1;
        self.reopen_session();
        old
    }

    /// 세션 회차를 바꾸지 않고 살아 있는 채로(F5 · 웹뷰 크래시 재부착은 임대만 풀린다) — 코어의 붙은 창만 떼었다 붙인다.
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

    /// 시험 `tile_token_bound_to_session_epoch`(설계 7-2 · D4) — 토큰은 `(stream, sessionEpoch)` 에 묶인다: 회차가 서기 전 · 회차가 바뀜 ·
    /// 세션이 끝남 = `stale-tile`, 같은 회차가 살아 있는 동안(F5 · 웹뷰 크래시 재부착은 회차를 바꾸지 않는다)은 그대로. 새 세션(같은 스트림)이
    /// 갈아 치우면 옛 토큰은 모르는 토큰이고, 옛 세션의 늦은 회수는 새 칸을 거두지 못한다.
    #[test]
    fn tile_token_bound_to_session_epoch() {
        let mut t = TileTokens::default();
        t.insert("tile-a", "tok-a".into(), 7);
        let auth = |t: &TileTokens, h: &str, l: &'static [(&'static str, u64)]| t.authenticate(Some(h), live(l));
        // 열기가 서기 전(회차 없음) — stale.
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 1)]), Some(Auth::Stale));
        assert!(t.bind_epoch("tile-a", 7, 1));
        assert!(!t.bind_epoch("tile-a", 8, 1), "남의 주인 번호로는 못 묶는다");
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 1)]), Some(Auth::Tile("tile-a".into())));
        // 재부착(F5) — 회차 그대로 → 그대로.
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 1)]), Some(Auth::Tile("tile-a".into())));
        // 회차 +1(세션 재생성) · 세션 끝(살아 있는 회차 없음) — stale.
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 2)]), Some(Auth::Stale));
        assert_eq!(auth(&t, "Bearer tok-a", &[]), Some(Auth::Stale));
        // 모르는 토큰 · 빈 토큰 · Bearer 없는 머리는 이 표의 것이 아니다.
        assert_eq!(auth(&t, "Bearer nope", &[("tile-a", 1)]), None);
        assert_eq!(auth(&t, "Bearer ", &[("tile-a", 1)]), None);
        assert_eq!(t.authenticate(Some("tok-a"), live(&[("tile-a", 1)])), None);
        assert_eq!(t.authenticate(None, live(&[("tile-a", 1)])), None);
        // GUI Rust 의 값 읽기도 같은 규칙.
        assert_eq!(t.token_for("tile-a", live(&[("tile-a", 1)])).as_deref(), Some("tok-a"));
        assert_eq!(t.token_for("tile-a", live(&[("tile-a", 2)])), None);
        // 같은 스트림의 새 세션 — 새 토큰이 갈아 치운다(옛 토큰은 모르는 토큰).
        t.insert("tile-a", "tok-a2".into(), 9);
        t.bind_epoch("tile-a", 9, 2);
        assert_eq!(auth(&t, "Bearer tok-a", &[("tile-a", 2)]), None);
        assert_eq!(auth(&t, "Bearer tok-a2", &[("tile-a", 2)]), Some(Auth::Tile("tile-a".into())));
        // 옛 세션의 늦은 회수는 새 칸을 거두지 못한다 · 자기 회수는 거둔다.
        assert!(!t.revoke("tile-a", 7));
        assert_eq!(t.len(), 1);
        assert!(t.revoke("tile-a", 9));
        assert_eq!(auth(&t, "Bearer tok-a2", &[("tile-a", 2)]), None, "회수 뒤엔 모르는 토큰(401)");
    }

    /// 시험 `tile_marks_are_gone`(오케스트레이션 탭 2단계 · 6절) — 1단계의 타일 칸(프로듀서 표지 · 멱등 기록 · 호출 표지 · 시작 폴더)과 그 함수가
    /// 이 표에 남지 않는다(타일은 조정자 자리가 되지 못한다 — `orchestration::start`).
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
