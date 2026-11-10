//! **창이 없을 때 세션 서버가 거울을 잇는다**(2026-11-09 — 원칙 1 "붙은 접근": 사람이 연 세션이 살아 있는 동안 AI 가 그 위에서 일한다 ·
//! 창을 닫아도 · 가림막이 서도 · `docs/log/2026-11-09-db-borrowed-password.md` 11절).
//!
//! AI(MCP)가 읽는 세션 거울([`crate::context`])은 원래 **프런트**(xterm · OSC 133 상태 기계)가 해석해 비춘다. 그 길은 그대로 둔다 —
//! **창이 붙어 있으면 프런트가 거울의 주인**이다. 세션의 출력 바이트는 세션 서버의 배처([`crate::output::spawn_batcher_with`])를 이미
//! 지나므로, 세션마다 **서버 해석기**([`vt::Interp`] — `vt100` 화면 + 글자 스크롤백 + OSC 133)를 하나 두고 배처가 배치마다 먹인다
//! (로컬 PTY · SSH 같은 길). 해석기는 **언제나 따라간다**(창이 붙어 있어도 — 떨어지는 순간 화면을 다시 세울 필요가 없게) — 그러나
//! 거울에 **쓰는 것은 붙은 창이 없을 때뿐**이다.
//!
//! ## 거울 주인(펜) 전환
//!
//! - 처음은 창(`PEN_WINDOW`). 주 싱크가 빠지면(`output::clear_output` — 떨어지기 · 연결 끊김 · 리로드 · GUI 종료) 서버(`PEN_SERVER`) ·
//!   주 싱크가 꽂히면(`attach_output` · `swap_output` · `swap_output_replaying`) 다시 창이다. 시청자(원격 웹)만 붙은 동안도 서버다 —
//!   시청자는 거울에 보고하지 않는다(`Terminal.svelte` 의 `viewer`).
//! - 서버가 펜을 쥔 동안: `C`·`D`(상태 전이 · 블록)는 **그 자리에서** 쓰고, 그 밖의 출력은 "더러움" 표시만 한다 — MCP 도구 · 관제판이
//!   읽기 직전에 [`flush_dirty`] 가 지금 화면을 한 장 쓴다(주기 시계가 없다 — 읽는 순간이 늘 최신이다).
//! - 창이 다시 붙으면 프런트가 다시 보고 · 갱신한다 — 서버가 쓴 블록 · 마지막 명령은 남는다(2026-11-10): 새 페이지의 첫 꺼짐 보고는
//!   세션이 서기 전엔 나가지 않고(`src/lib/context.ts` 의 `shouldReportMirror` — 붙기가 토글을 되살리기 전의 꺼짐이 옵트아웃으로 지웠다),
//!   모르는(`null`) 상태 · 마지막 명령의 갱신은 아는 값을 지우지 않으며(`context::update`), 재생이 다시 만든 블록은 프런트가 올리지 않는다.
//!   블록 번호는 `context::push_block` 이 어긋나지 않게 한다(저장소 번호가 정본 — 새 대의 프런트 번호가 다른 블록과 겹치면 뒤로 민다 ·
//!   같은 블록의 다시 보내기는 그대로).
//!
//! ## 권한은 넓어지지 않는다
//!
//! 쓰기 문지기는 거울 항목의 `opted_in`(사람이 마지막으로 정한 값 — 서버는 이 값을 바꾸지 않는다) **그리고** 로컬 타일이면 세션 코어의
//! "AI 읽기 허용"(`Entry::ai_read` — 같은 사람 설정의 서버 사본)이다. 읽기 문지기는 그대로 `context::ai_readable`(원격 = 지금의 호스트
//! AI 권한 · 목록에 없는 원격 = 끔). 항목이 없으면(창이 한 번도 보고하지 않았다) 쓰지 않는다. 상한은 거울의 것 그대로(`context::update`
//! · `push_block` 이 다시 지킨다).
//!
//! ## 잠금 순서
//!
//! 해석기 잠금 → (세션 코어 — 읽기 허용 한 번, 곧바로 놓음) → 컨텍스트. 슬롯 잠금 안에서는 원자 값만 만진다([`Tap::on_attach`] ·
//! [`Tap::on_detach`] — `plug` 가 코어 잠금 안에서 싱크를 꽂는다). 등록표는 잎 잠금이다(쥔 채 다른 잠금을 잡지 않는다).

pub(crate) mod vt;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, LazyLock, Mutex, Weak};

use crate::context::{CommandBlockMirror, Store};
use crate::session_core::Kind;

const PEN_WINDOW: u8 = 0;
const PEN_SERVER: u8 = 1;

/// 쓰기 직전의 추가 문지기 — 로컬 타일은 세션 코어의 "AI 읽기 허용", SSH 는 늘 참(호스트 권한은 읽을 때 본다).
type Allow = fn(&str) -> bool;

/// 세션 하나의 서버 해석기와 거울 펜.
pub(crate) struct Tap {
    stream: String,
    pen: AtomicU8,
    dirty: AtomicBool,
    interp: Mutex<vt::Interp>,
    /// 쓸 거울(세션 서버의 AI 평면) — 없으면(평면이 아직 없다) 따라가기만 한다.
    store: Option<Store>,
    allow: Allow,
}

fn local_ai_read(stream: &str) -> bool {
    crate::session_core::core().ai_read_of(stream)
}

fn always(_: &str) -> bool {
    true
}

impl Tap {
    pub(crate) fn new(stream: &str, kind: Kind, cols: u16, rows: u16, store: Option<Store>) -> Arc<Tap> {
        let allow: Allow = match kind {
            Kind::Local => local_ai_read,
            Kind::Ssh => always,
        };
        Tap::with_allow(stream, cols, rows, store, allow)
    }

    pub(crate) fn with_allow(stream: &str, cols: u16, rows: u16, store: Option<Store>, allow: Allow) -> Arc<Tap> {
        Arc::new(Tap {
            stream: stream.to_string(),
            pen: AtomicU8::new(PEN_WINDOW),
            dirty: AtomicBool::new(false),
            interp: Mutex::new(vt::Interp::new(cols, rows)),
            store,
            allow,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, vt::Interp> {
        self.interp.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 지금 서버가 거울을 쓰는가(붙은 주 창이 없다).
    pub(crate) fn server_pen(&self) -> bool {
        self.pen.load(Ordering::SeqCst) == PEN_SERVER
    }

    /// 배치 하나를 먹인다(배처 스레드 — 슬롯 잠금 밖). 서버가 펜을 쥐었으면 상태 전이 · 블록은 곧바로 쓰고, 나머지는 더러움 표시.
    pub(crate) fn feed(&self, bytes: &[u8]) {
        let mut interp = self.lock();
        let fed = interp.feed(bytes);
        if !self.server_pen() {
            return;
        }
        if fed.changed || !fed.blocks.is_empty() {
            self.dirty.store(false, Ordering::SeqCst);
            self.write(&interp, fed.blocks);
        } else {
            self.dirty.store(true, Ordering::SeqCst);
        }
    }

    /// 주 싱크가 꽂혔다 — 창이 주인이다(원자 값만 — 슬롯 · 코어 잠금 안에서 불린다).
    pub(crate) fn on_attach(&self) {
        self.pen.store(PEN_WINDOW, Ordering::SeqCst);
    }

    /// 주 싱크가 빠졌다 — 서버가 주인이다. 창이 마지막으로 올린 거울은 상태 전이 때의 것이라(프런트는 `C`·`D` 에만 올린다) 다음 읽기에
    /// 지금 화면으로 한 번 쓴다.
    pub(crate) fn on_detach(&self) {
        self.pen.store(PEN_SERVER, Ordering::SeqCst);
        self.dirty.store(true, Ordering::SeqCst);
    }

    pub(crate) fn resize(&self, cols: u16, rows: u16) {
        self.lock().resize(cols, rows);
    }

    /// 서버가 펜을 쥐었고 더러우면 지금 화면 한 장을 쓴다. 더럽지 않아도 해석기 잠금은 한 번 잡는다 — 다른 읽기가 막 쓰는 중이면(더러움을
    /// 먼저 가져갔다) 그 쓰기가 끝난 뒤에 돌아와야 부른 쪽이 최신 거울을 읽는다.
    pub(crate) fn flush(&self) {
        if !self.server_pen() {
            return;
        }
        let interp = self.lock();
        if self.dirty.swap(false, Ordering::SeqCst) && self.server_pen() {
            self.write(&interp, Vec::new());
        }
    }

    fn write(&self, interp: &vt::Interp, blocks: Vec<CommandBlockMirror>) {
        let Some(store) = &self.store else {
            return;
        };
        if !(self.allow)(&self.stream) {
            return;
        }
        let snap = interp.snapshot();
        let mut map = store.lock().unwrap_or_else(|e| e.into_inner());
        for block in blocks {
            crate::context::push_server_block(&mut map, &self.stream, block);
        }
        crate::context::update(&mut map, &self.stream, snap.status, snap.last, snap.tail);
    }

    /// 출력 슬롯이 처음 꽂힐 때 지금까지의 링 바이트로 따라잡는다(`output::set_tap` — 해석기 잠금 → 슬롯 잠금 순서로 부른다).
    pub(crate) fn interp_guard(&self) -> std::sync::MutexGuard<'_, vt::Interp> {
        self.lock()
    }
}

/// 스트림 → 해석기(약한 참조 — 해석기는 출력 슬롯이 쥐고, 세션이 끝나 슬롯이 사라지면 함께 간다).
static TAPS: LazyLock<Mutex<HashMap<String, Weak<Tap>>>> = LazyLock::new(Default::default);

fn taps() -> std::sync::MutexGuard<'static, HashMap<String, Weak<Tap>>> {
    TAPS.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn register(tap: &Arc<Tap>) {
    let mut map = taps();
    map.retain(|_, w| w.strong_count() > 0);
    map.insert(tap.stream.clone(), Arc::downgrade(tap));
}

/// 세션 열기(세션 서버)가 부른다 — 해석기를 만들어 등록하고 출력 슬롯에 꽂는다(지금까지 링에 적힌 바이트로 따라잡는다).
pub(crate) fn install(slot: &crate::output::OutputSlot, stream: &str, kind: Kind, cols: u16, rows: u16) {
    let store = crate::server::hub::ai().map(|p| p.ctx().clone());
    let tap = Tap::new(stream, kind, cols, rows, store);
    register(&tap);
    crate::output::set_tap(slot, tap);
}

/// 그 스트림의 거울을 지금 서버가 잇고 있는가 — MCP `list_sessions` 의 `stale` · `mirror` 칸. 펜을 쥐었어도 쓰기 문지기(로컬 타일의 읽기
/// 허용)가 닫혀 있으면 잇지 않는 것이다(등록표 잠금을 먼저 놓고 본다 — 로컬 문지기는 세션 코어를 잠깐 잡는다).
pub(crate) fn server_pen(stream: &str) -> bool {
    let tap = taps().get(stream).and_then(Weak::upgrade);
    tap.is_some_and(|t| t.server_pen() && (t.allow)(&t.stream))
}

/// 서버가 펜을 쥔 더러운 거울을 지금 화면으로 쓴다 — MCP 도구 · 관제판이 거울을 읽기 **직전**(컨텍스트 잠금 밖에서).
pub(crate) fn flush_dirty() {
    let live: Vec<Arc<Tap>> = {
        let mut map = taps();
        map.retain(|_, w| w.strong_count() > 0);
        map.values().filter_map(Weak::upgrade).collect()
    };
    for tap in live {
        tap.flush();
    }
}
