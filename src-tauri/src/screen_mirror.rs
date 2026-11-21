//! **창이 없을 때 세션 서버가 거울을 잇는다** — 세션마다 서버 해석기([`vt::Interp`])를 두고 배처가 늘 먹이지만,
//! 거울에 **쓰는 것은 붙은 주 창이 없을 때뿐**이다(창이 붙어 있으면 프런트가 거울의 주인).
//!
//! - 시청자(원격 웹)만 붙은 동안도 서버가 쓴다 — 시청자는 거울에 보고하지 않는다.
//! - 서버가 펜을 쥔 동안 `C`·`D` 밖의 출력은 "더러움" 표시만 한다 — 주기 시계가 없으니 읽는 쪽이 읽기 직전에 [`flush_dirty`] 를 부른다.
//! - 창이 다시 붙어도 서버가 쓴 블록 · 마지막 명령은 남는다 — `context::update` 의 모르는 값 무시 · `push_block` 의 번호 밀기 ·
//!   `src/lib/context.ts` 의 `shouldReportMirror` 가 함께 지킨다.
//!
//! **권한은 넓어지지 않는다**: 쓰기 문지기는 거울 항목의 `opted_in`(서버는 바꾸지 않는다) **그리고** 로컬 타일이면 세션 코어의 "AI 읽기 허용"이다.
//! 읽기 문지기는 그대로 `context::ai_readable`. 항목이 없으면(창이 한 번도 보고하지 않았다) 쓰지 않는다.
//!
//! **잠금 순서**: 해석기 → (세션 코어 — 읽기 허용 한 번, 곧바로 놓음) → 컨텍스트. 슬롯 잠금 안에서는 원자 값만 만진다
//! ([`Tap::on_attach`] · [`Tap::on_detach`]). 등록표는 잎 잠금이다.

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

/// SSH 는 늘 참이다 — 호스트 권한은 읽을 때 본다.
type Allow = fn(&str) -> bool;

pub(crate) struct Tap {
    stream: String,
    pen: AtomicU8,
    dirty: AtomicBool,
    interp: Mutex<vt::Interp>,
    /// 없으면(AI 평면이 아직 없다) 따라가기만 한다.
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

    pub(crate) fn server_pen(&self) -> bool {
        self.pen.load(Ordering::SeqCst) == PEN_SERVER
    }

    /// 배처 스레드에서 슬롯 잠금 밖으로 부른다.
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

    /// 슬롯 · 코어 잠금 안에서 불린다 — 원자 값만 만진다.
    pub(crate) fn on_attach(&self) {
        self.pen.store(PEN_WINDOW, Ordering::SeqCst);
    }

    /// 창이 마지막으로 올린 거울은 상태 전이 때의 것이라(프런트는 `C`·`D` 에만 올린다) 다음 읽기에 지금 화면으로 한 번 쓴다.
    pub(crate) fn on_detach(&self) {
        self.pen.store(PEN_SERVER, Ordering::SeqCst);
        self.dirty.store(true, Ordering::SeqCst);
    }

    pub(crate) fn resize(&self, cols: u16, rows: u16) {
        self.lock().resize(cols, rows);
    }

    /// 더럽지 않아도 해석기 잠금은 한 번 잡는다 — 다른 읽기가 막 쓰는 중이면 그 쓰기가 끝난 뒤에 돌아와야 부른 쪽이 최신 거울을 읽는다.
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

    /// `output::set_tap` 이 해석기 잠금 → 슬롯 잠금 순서로 쓴다.
    pub(crate) fn interp_guard(&self) -> std::sync::MutexGuard<'_, vt::Interp> {
        self.lock()
    }
}

/// 약한 참조 — 해석기는 출력 슬롯이 쥐고, 세션이 끝나 슬롯이 사라지면 함께 간다.
static TAPS: LazyLock<Mutex<HashMap<String, Weak<Tap>>>> = LazyLock::new(Default::default);

fn taps() -> std::sync::MutexGuard<'static, HashMap<String, Weak<Tap>>> {
    TAPS.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn register(tap: &Arc<Tap>) {
    let mut map = taps();
    map.retain(|_, w| w.strong_count() > 0);
    map.insert(tap.stream.clone(), Arc::downgrade(tap));
}

pub(crate) fn install(slot: &crate::output::OutputSlot, stream: &str, kind: Kind, cols: u16, rows: u16) {
    let store = crate::server::hub::ai().map(|p| p.ctx().clone());
    let tap = Tap::new(stream, kind, cols, rows, store);
    register(&tap);
    crate::output::set_tap(slot, tap);
}

/// 펜을 쥐었어도 쓰기 문지기가 닫혀 있으면 잇지 않는 것이다. 등록표 잠금을 먼저 놓고 본다 — 로컬 문지기는 세션 코어를 잠깐 잡는다.
pub(crate) fn server_pen(stream: &str) -> bool {
    let tap = taps().get(stream).and_then(Weak::upgrade);
    tap.is_some_and(|t| t.server_pen() && (t.allow)(&t.stream))
}

/// 메신저 다리의 넣기 문지기만 본다. 거울 쓰기 문지기(AI 읽기 허용)와 무관하다 — 판정에만 쓰고 어디로도 내보내지 않는다.
pub(crate) fn input_view(stream: &str) -> Option<vt::InputView> {
    let tap = taps().get(stream).and_then(Weak::upgrade)?;
    let view = tap.lock().input_view();
    Some(view)
}

/// 거울을 읽기 **직전**, 컨텍스트 잠금 밖에서 부른다.
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
