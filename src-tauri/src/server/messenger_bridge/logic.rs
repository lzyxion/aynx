//! 메신저 다리의 순수 층 — 잠금 · 파일 · 네트워크 · 시계는 모른다(시각은 인자로 받는다). 불변식은 `server::messenger_bridge` 머리말.

use std::collections::{HashMap, VecDeque};

use crate::agent_state::Phase;
use crate::i18n::tr;
use crate::session_core::Kind;

/// 이보다 오래된 글(초)은 넣지 않는다 — 서버가 꺼져 있던 동안 쌓인 것.
pub(crate) const STALE_SECS: i64 = 120;
pub(crate) const TEXT_MAX_CHARS: usize = 8000;
pub(crate) const PAIR_TTL_MS: u64 = 10 * 60 * 1000;
/// 같은 계정에 코드를 다시 답하는 간격.
pub(crate) const PAIR_REPEAT_MS: u64 = 30_000;
/// 타일 고르기 단추를 기다리는 동안 글을 쥐는 시간.
pub(crate) const HOLD_MS: u64 = 120_000;
pub(crate) const SENT_KEEP: usize = 200;
/// 다리 턴이 끝난 뒤 그 턴의 프런트 알림을 걸러 내는 동안.
pub(crate) const TURN_KEEP_MS: u64 = 120_000;

// ---------------------------------------------------------------------------
// 보낸 이 · 지난 글
// ---------------------------------------------------------------------------

/// 짝 파일(`<설정 루트>/telegram-chat` 등)의 몸 — 글자 그대로 남는다.
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Paired {
    pub user_id: i64,
    pub chat_id: i64,
    pub name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Sender {
    Paired,
    /// 짝이 없을 때의 1:1 대화방 — 짝짓기 후보
    Stranger,
    /// 그 밖 전부(그룹 · 채널 · 짝이 있는데 다른 사람) — 조용히 버린다(답장도 로그 본문도 없음)
    Drop,
}

/// **보낸 이 문지기** — 1:1 대화방만. 짝이 있으면 그 사용자 · 대화방이 둘 다 맞아야 한다.
pub(crate) fn classify(paired: Option<&Paired>, from: Option<i64>, chat: i64, private: bool) -> Sender {
    let Some(from) = from.filter(|_| private) else {
        return Sender::Drop;
    };
    match paired {
        Some(p) if p.user_id == from && p.chat_id == chat => Sender::Paired,
        Some(_) => Sender::Drop,
        None => Sender::Stranger,
    }
}

pub(crate) fn is_stale(date_secs: i64, now_secs: i64) -> bool {
    now_secs - date_secs > STALE_SECS
}

// ---------------------------------------------------------------------------
// 글자 걷기
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Clean {
    Empty,
    TooLong,
    Text(String),
}

/// C0 제어 글자(ESC 포함 — `\n` · `\t` 만 남김) · DEL · C1 을 뺀다 — 그래서 붙여넣기 끝 표식 `ESC[201~` 를 글로 만들 수 없다.
pub(crate) fn clean_text(raw: &str) -> Clean {
    let unified = raw.replace("\r\n", "\n").replace('\r', "\n");
    let kept: String = unified
        .chars()
        .filter(|&c| c == '\n' || c == '\t' || !(c.is_control() || ('\u{80}'..='\u{9f}').contains(&c)))
        .collect();
    let text = kept.trim_end();
    if text.trim().is_empty() {
        return Clean::Empty;
    }
    if text.chars().count() > TEXT_MAX_CHARS {
        return Clean::TooLong;
    }
    Clean::Text(text.to_string())
}

/// 줄바꿈은 `\r` — 프런트 `pasteBytes` 와 같다. Enter(`\r`)는 따로 잠깐 뒤에 보낸다.
pub(crate) fn paste_bytes(clean: &str) -> Vec<u8> {
    format!("\x1b[200~{}\x1b[201~", clean.replace('\n', "\r")).into_bytes()
}

// ---------------------------------------------------------------------------
// 넣기 문지기
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentView {
    pub cli: Option<&'static str>,
    pub state: Option<Phase>,
    pub main_stopped: bool,
    pub subagents: usize,
    /// 한 번이라도 턴이 끝났나
    pub stopped_once: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub(crate) struct TileView {
    pub kind: Option<Kind>,
    /// `agent_state` 항목 — **없으면 무조건 거절**(`session-end` 가 항목을 지운다)
    pub agent: Option<AgentView>,
    /// 권한 카드 · Codex 질문 · TUI 물음이 서 있다
    pub asking: bool,
    /// 서버 해석기의 괄호 붙여넣기 모드 — 해석기가 없으면 `None`(거절)
    pub bracketed: Option<bool>,
    /// 모르면 `None`(막지 않는다)
    pub leftover: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    Off,
    NoTile,
    /// 원격(SSH) 타일에는 길이 없다
    Remote,
    /// CLI 가 없다 · 끝났다(항목 없음 = 셸로 돌아감)
    NoCli,
    Asking,
    /// 한 번도 턴이 끝나지 않았다 — 폴더 신뢰 질문에 Enter 가 답이 되지 않게
    NotReady,
    Running,
    NoBracketed,
    Leftover,
}

/// **넣기 문지기** — 입력을 기다리는 로컬 AI CLI 타일에만 넣는다(→ docs/invariants.md 전문 4). 전부 참이어야 넣는다.
pub(crate) fn gate(enabled: bool, t: &TileView) -> Result<&'static str, Refusal> {
    if !enabled {
        return Err(Refusal::Off);
    }
    match t.kind {
        None => return Err(Refusal::NoTile),
        Some(Kind::Ssh) => return Err(Refusal::Remote),
        Some(Kind::Local) => {}
    }
    let Some(a) = &t.agent else {
        return Err(Refusal::NoCli);
    };
    let Some(cli) = a.cli.filter(|c| matches!(*c, "claude" | "codex")) else {
        return Err(Refusal::NoCli);
    };
    if t.asking || a.state == Some(Phase::Permission) {
        return Err(Refusal::Asking);
    }
    if !a.stopped_once {
        return Err(Refusal::NotReady);
    }
    if a.state != Some(Phase::Finished) || !a.main_stopped || a.subagents > 0 {
        return Err(Refusal::Running);
    }
    if t.bracketed != Some(true) {
        return Err(Refusal::NoBracketed);
    }
    if t.leftover == Some(true) {
        return Err(Refusal::Leftover);
    }
    Ok(cli)
}

pub(crate) fn refusal_text(r: Refusal) -> String {
    match r {
        Refusal::Off => tr!(
            ko: "메신저에서 타일에 말하기가 꺼져 있습니다 — 메인 PC 의 설정에서 켜세요",
            en: "Talking to tiles from the messenger is off — turn it on in Settings on the main PC",
        ),
        Refusal::NoTile => tr!(ko: "그 타일이 없습니다(닫혔습니다)", en: "That tile is gone (closed)"),
        Refusal::Remote => tr!(ko: "원격(SSH) 타일에는 아직 보낼 수 없습니다", en: "Remote (SSH) tiles are not supported yet"),
        Refusal::NoCli => tr!(ko: "그 타일의 AI CLI 가 끝났습니다", en: "The AI CLI in that tile has exited"),
        Refusal::Asking => tr!(
            ko: "그 타일이 권한 · 질문에 답을 기다립니다 — 앱에서 답하세요",
            en: "That tile is waiting for a permission or question answer — answer it in the app",
        ),
        Refusal::NotReady => tr!(
            ko: "그 타일은 아직 첫 턴이 끝나지 않았습니다 — 첫 말은 PC 에서 보내세요",
            en: "That tile has not finished a turn yet — send the first message from the PC",
        ),
        Refusal::Running => tr!(
            ko: "그 타일이 아직 실행 중입니다 — 턴이 끝난 뒤 다시 보내세요",
            en: "That tile is still running — send again after the turn ends",
        ),
        Refusal::NoBracketed => tr!(
            ko: "그 타일의 입력 상태를 확인할 수 없어 보내지 않았습니다",
            en: "Could not confirm that tile's input state, so nothing was sent",
        ),
        Refusal::Leftover => tr!(
            ko: "그 타일 입력 줄에 치다 만 글이 있습니다 — 앱에서 비운 뒤 다시 보내세요",
            en: "That tile has unfinished text in its input line — clear it in the app and send again",
        ),
    }
}

/// "기다리는 타일이 없다" 목록의 짧은 까닭.
pub(crate) fn refusal_short(r: Refusal) -> String {
    match r {
        Refusal::Off => tr!(ko: "메신저에서 말하기가 꺼져 있습니다", en: "Messaging tiles is off"),
        Refusal::NoTile => tr!(ko: "닫혔습니다", en: "Closed"),
        Refusal::Remote => tr!(ko: "원격(SSH) 타일은 아직 지원하지 않습니다", en: "Remote (SSH) tiles are not supported yet"),
        Refusal::NoCli => tr!(ko: "AI CLI 가 끝났습니다", en: "The AI CLI has exited"),
        Refusal::Asking => tr!(ko: "권한 · 질문에 답을 기다립니다", en: "Waiting for a permission or question answer"),
        Refusal::NotReady => tr!(ko: "첫 말은 PC 에서 보내세요", en: "Send the first message from the PC"),
        Refusal::Running => tr!(ko: "실행 중", en: "Running"),
        Refusal::NoBracketed => tr!(ko: "입력 상태를 확인할 수 없습니다", en: "Could not confirm the input state"),
        Refusal::Leftover => tr!(ko: "입력 줄에 치다 만 글이 있습니다", en: "Unfinished text in the input line"),
    }
}

/// 꺼짐(`Off`)은 글 하나에 이미 거절했다.
pub(crate) fn listable(r: Refusal) -> bool {
    !matches!(r, Refusal::NoTile | Refusal::Off)
}

pub(crate) const NOWHERE_MAX_LINES: usize = 5;

/// 걷지 않은 글이다 — 걷기는 보내는 쪽.
pub(crate) fn nowhere_text(items: &[(String, Refusal)]) -> String {
    let mut out = tr!(ko: "입력을 기다리는 AI 타일이 없습니다", en: "No AI tile is waiting for input");
    let shown: Vec<&(String, Refusal)> = items.iter().filter(|(_, r)| listable(*r)).collect();
    for (label, r) in shown.iter().take(NOWHERE_MAX_LINES) {
        out.push_str(&format!("\n· {label} — {}", refusal_short(*r)));
    }
    if shown.len() > NOWHERE_MAX_LINES {
        let n = shown.len() - NOWHERE_MAX_LINES;
        out.push('\n');
        out.push_str(&tr!(ko: "외 {n}개", en: "and {n} more"));
    }
    out
}

// ---------------------------------------------------------------------------
// 입력 줄 판정 — 프런트 `pane/flip-model.ts` `tuiInputLeftover` 와 같다
// ---------------------------------------------------------------------------

/// 화면 줄 하나 = (글자, 흐린가) 덩어리들.
pub(crate) type Row = Vec<(String, bool)>;

/// 실측 글리프 — 프런트와 같다.
fn prompt_glyph(cli: &str) -> Option<&'static str> {
    match cli {
        "claude" => Some("❯"),
        "codex" => Some("›"),
        _ => None,
    }
}

/// 빈 입력 줄의 안내 글은 두 CLI 모두 흐리게(SGR 2) 그린다 — 그래서 **흐리지 않은** 글만 센다.
pub(crate) fn input_leftover(cli: &str, rows: &[Row]) -> Option<bool> {
    let glyph = prompt_glyph(cli)?;
    for runs in rows.iter().rev() {
        let text: String = runs.iter().map(|(t, _)| t.as_str()).collect();
        if !text.trim_start().starts_with(glyph) {
            continue;
        }
        let mut seen = false;
        for (t, dim) in runs {
            let mut t = t.as_str();
            if !seen {
                let Some(at) = t.find(glyph) else { continue };
                seen = true;
                t = &t[at + glyph.len()..];
            }
            if !dim && t.chars().any(|c| !c.is_whitespace()) {
                return Some(true);
            }
        }
        return Some(false);
    }
    None
}

// ---------------------------------------------------------------------------
// 짝짓기
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub(crate) struct Pending {
    pub code: String,
    pub user_id: i64,
    pub chat_id: i64,
    pub name: String,
    pub created_ms: u64,
    pub replied_ms: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PairStep {
    /// 새 대기면 `fresh` — 설정 화면에 알린다
    Reply { code: String, fresh: bool },
    Quiet,
    /// 다른 계정이 대기 중 — 조용히(대기는 하나)
    Busy,
    NoCode,
}

/// 대기는 하나뿐이다.
#[derive(Default)]
pub(crate) struct Pairing {
    pending: Option<Pending>,
}

impl Pairing {
    fn expire(&mut self, now: u64) {
        if self.pending.as_ref().is_some_and(|p| now.saturating_sub(p.created_ms) >= PAIR_TTL_MS) {
            self.pending = None;
        }
    }

    pub(crate) fn current(&mut self, now: u64) -> Option<&Pending> {
        self.expire(now);
        self.pending.as_ref()
    }

    pub(crate) fn request(&mut self, user_id: i64, chat_id: i64, name: &str, now: u64, code: impl FnOnce() -> Option<String>) -> PairStep {
        self.expire(now);
        match &mut self.pending {
            Some(p) if p.user_id != user_id => PairStep::Busy,
            Some(p) if now.saturating_sub(p.replied_ms) < PAIR_REPEAT_MS => PairStep::Quiet,
            Some(p) => {
                p.replied_ms = now;
                p.chat_id = chat_id;
                PairStep::Reply { code: p.code.clone(), fresh: false }
            }
            None => {
                let Some(code) = code() else { return PairStep::NoCode };
                self.pending = Some(Pending { code: code.clone(), user_id, chat_id, name: name.to_string(), created_ms: now, replied_ms: now });
                PairStep::Reply { code, fresh: true }
            }
        }
    }

    /// 코드가 지금 대기의 것일 때만 꺼낸다 — 낡은 화면의 누름은 먹지 않는다.
    pub(crate) fn take(&mut self, code: &str, now: u64) -> Option<Pending> {
        self.expire(now);
        if self.pending.as_ref().is_some_and(|p| p.code == code) {
            self.pending.take()
        } else {
            None
        }
    }

    pub(crate) fn clear(&mut self) {
        self.pending = None;
    }
}

// ---------------------------------------------------------------------------
// 라우팅 — 보낸 메시지 id → 스트림 · 고르기 단추 · 다리 턴
// ---------------------------------------------------------------------------

/// 서버가 다시 뜨면 잊는다.
#[derive(Default)]
pub(crate) struct SentMap {
    order: VecDeque<i64>,
    map: HashMap<i64, String>,
}

impl SentMap {
    pub(crate) fn insert(&mut self, message_id: i64, stream: &str) {
        if self.map.insert(message_id, stream.to_string()).is_none() {
            self.order.push_back(message_id);
        }
        while self.order.len() > SENT_KEEP {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
    }

    pub(crate) fn get(&self, message_id: i64) -> Option<&str> {
        self.map.get(&message_id).map(String::as_str)
    }

    pub(crate) fn clear(&mut self) {
        self.order.clear();
        self.map.clear();
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.map.len()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Route {
    To(String),
    Nowhere,
    Choose(Vec<String>),
}

pub(crate) fn route(reply_target: Option<&str>, waiting: &[String]) -> Route {
    if let Some(s) = reply_target {
        return Route::To(s.to_string());
    }
    match waiting {
        [] => Route::Nowhere,
        [one] => Route::To(one.clone()),
        many => Route::Choose(many.to_vec()),
    }
}

/// 새 글이 오면 갈아 치운다.
pub(crate) struct Held {
    pub seq: u64,
    pub text: String,
    pub streams: Vec<String>,
    /// `streams` 와 같은 순서 — 고른 뒤 `→ <글자>` 줄도 같은 글자로
    pub labels: Vec<String>,
    pub at_ms: u64,
    /// 단추를 단 메시지(결과로 바꿔 쓴다)
    pub message_id: Option<i64>,
    /// 사용자가 보낸 그 글
    pub source_id: i64,
}

pub(crate) const PICK_LABEL_MAX: usize = 60;

pub(crate) fn clean_title(raw: &str) -> Option<String> {
    let kept: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let folded = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    (!folded.is_empty()).then_some(folded)
}

fn clip_chars(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

/// 자를 때는 제목 쪽을 줄이고 꼬리(` (1)`)는 남긴다.
fn fit_pick(label: &str, title: Option<&str>, tail: &str) -> String {
    let budget = PICK_LABEL_MAX.saturating_sub(tail.chars().count());
    let head = label.chars().count() + 3; // " — "
    match title {
        Some(t) if head + 2 <= budget => format!("{label} — {}{tail}", clip_chars(t, budget - head)),
        _ => format!("{}{tail}", clip_chars(label, budget)),
    }
}

/// 이름표가 서로 겹치는 것만 ` — <제목>` 을 붙이고, 그래도 같은 글자면 ` (1)` · ` (2)` 를 붙인다.
pub(crate) fn pick_labels(items: &[(String, Option<String>)]) -> Vec<String> {
    let dup = |l: &str| items.iter().filter(|(x, _)| x == l).count() > 1;
    let mut out: Vec<String> = items
        .iter()
        .map(|(l, t)| if dup(l) { fit_pick(l, t.as_deref(), "") } else { l.chars().take(PICK_LABEL_MAX).collect() })
        .collect();
    let first = out.clone();
    let mut seen: HashMap<String, usize> = HashMap::new();
    for (i, (l, t)) in items.iter().enumerate() {
        if first.iter().filter(|x| **x == first[i]).count() < 2 {
            continue;
        }
        let k = seen.entry(first[i].clone()).or_insert(0);
        *k += 1;
        out[i] = fit_pick(l, t.as_deref(), &format!(" ({k})"));
    }
    out
}

/// 64바이트 안 — 스트림 id 를 싣지 않는다.
pub(crate) fn pick_data(seq: u64, index: usize) -> String {
    format!("p:{seq}:{index}")
}

pub(crate) fn parse_pick(data: &str) -> Option<(u64, usize)> {
    let rest = data.strip_prefix("p:")?;
    let (seq, idx) = rest.split_once(':')?;
    Some((seq.parse().ok()?, idx.parse().ok()?))
}

#[derive(Clone, Copy)]
struct Turn {
    ended_ms: Option<u64>,
    asked: bool,
    /// 그 턴을 시작한 글 — 답 · 물음을 그 글의 자리에 다는 채널(Slack 의 스레드)이 쓴다
    source: Option<i64>,
}

/// 끝난 뒤 [`TURN_KEEP_MS`] 동안 그 턴의 프런트 알림을 거른다.
#[derive(Default)]
pub(crate) struct Turns {
    map: HashMap<String, Turn>,
}

impl Turns {
    fn prune(&mut self, now: u64) {
        self.map.retain(|_, t| t.ended_ms.is_none_or(|e| now.saturating_sub(e) < TURN_KEEP_MS));
    }

    pub(crate) fn begin(&mut self, stream: &str, now: u64) {
        self.prune(now);
        self.map.insert(stream.to_string(), Turn { ended_ms: None, asked: false, source: None });
    }

    pub(crate) fn begin_from(&mut self, stream: &str, now: u64, source: i64) {
        self.begin(stream, now);
        if let Some(t) = self.map.get_mut(stream) {
            t.source = Some(source);
        }
    }

    /// **돌고 있는** 다리 턴만 — 지난 턴의 자리에 새 글을 달지 않는다.
    pub(crate) fn source(&self, stream: &str) -> Option<i64> {
        self.map.get(stream).filter(|t| t.ended_ms.is_none()).and_then(|t| t.source)
    }

    /// 그 턴이 돌고 있었으면 끝내고 참(답을 보낼 차례).
    pub(crate) fn end(&mut self, stream: &str, now: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(t) if t.ended_ms.is_none() => {
                t.ended_ms = Some(now);
                true
            }
            _ => false,
        }
    }

    /// 도는 다리 턴의 첫 권한 물음이면 참(한 번만 알린다).
    pub(crate) fn first_ask(&mut self, stream: &str) -> bool {
        match self.map.get_mut(stream) {
            Some(t) if t.ended_ms.is_none() && !t.asked => {
                t.asked = true;
                true
            }
            _ => false,
        }
    }

    /// 그 스트림의 알림을 다리가 맡았나 — 돌고 있거나 막 끝났다.
    pub(crate) fn owns(&mut self, stream: &str, now: u64) -> bool {
        self.prune(now);
        self.map.contains_key(stream)
    }

    /// 그 스트림에 다리 턴이 돌고 있나(끝나지 않았다).
    pub(crate) fn running(&self, stream: &str) -> bool {
        self.map.get(stream).is_some_and(|t| t.ended_ms.is_none())
    }

    /// 사람이 끊었다 · CLI 가 끝났다 — 답을 보내지 않는다.
    pub(crate) fn drop_stream(&mut self, stream: &str) {
        self.map.remove(stream);
    }

    pub(crate) fn clear(&mut self) {
        self.map.clear();
    }
}

// ---------------------------------------------------------------------------
// 다리가 돌보는 스트림 · 보낸 카드 · 누름 판정
// ---------------------------------------------------------------------------

/// 신호의 권한 물음과 카드가 **같은 물음**이라고 보는 틈 — 이 안에 카드가 섰으면 신호 쪽 "앱에서 답하세요" 를 보내지 않는다.
pub(crate) const ASK_PAIR_MS: u64 = 10_000;
pub(crate) const SUMMARY_MAX_CHARS: usize = 300;

#[derive(Default)]
struct Tend {
    /// 이 돌봄 동안 "앱에서 답하세요"(질문 카드 · 단추 없는 카드)를 한 번 보냈다
    noted: bool,
    /// 그 스트림의 마지막 카드(`request`) 시각
    last_card_ms: Option<u64>,
    /// 카드를 기다리는 신호 물음 — 틈이 지나도 카드가 없으면 그때 한 통
    signal_seq: Option<u64>,
}

/// **다리가 돌보는 스트림** — 다리 턴 ∪ 단추 달린 권한 알림을 보낸 스트림. 다리는 이 스트림의 카드에만 답한다(→ docs/invariants.md 전문 4).
/// 돌보는 동안 다리는 그 스트림 권한 카드의 **보는 쪽 하나**다(`server::tile_permission` 의 다리 표지).
#[derive(Default)]
pub(crate) struct Tending {
    map: HashMap<String, Tend>,
    seq: u64,
}

impl Tending {
    pub(crate) fn tend(&mut self, stream: &str) {
        self.map.entry(stream.to_string()).or_default();
    }

    pub(crate) fn untend(&mut self, stream: &str) {
        self.map.remove(stream);
    }

    pub(crate) fn tends(&self, stream: &str) -> bool {
        self.map.contains_key(stream)
    }

    /// 돌보는 스트림에 카드가 섰다 — 기다리던 신호 물음은 이 카드가 맡는다.
    pub(crate) fn card(&mut self, stream: &str, now: u64) {
        if let Some(t) = self.map.get_mut(stream) {
            t.last_card_ms = Some(now);
            t.signal_seq = None;
        }
    }

    /// 신호의 권한 물음 — 카드가 이미 섰으면(`card_open` · 틈 안의 카드) `None`, 아니면 기다릴 번호(틈 뒤 [`Self::fire`]).
    pub(crate) fn signal(&mut self, stream: &str, now: u64, card_open: bool) -> Option<u64> {
        self.seq += 1;
        let seq = self.seq;
        let t = self.map.get_mut(stream)?;
        if card_open || t.last_card_ms.is_some_and(|c| now.saturating_sub(c) < ASK_PAIR_MS) {
            return None;
        }
        t.signal_seq = Some(seq);
        Some(seq)
    }

    /// 틈이 지났다 — 그 사이 카드가 서지 않았으면 참(한 번만).
    pub(crate) fn fire(&mut self, stream: &str, seq: u64) -> bool {
        match self.map.get_mut(stream) {
            Some(t) if t.signal_seq == Some(seq) => {
                t.signal_seq = None;
                true
            }
            _ => false,
        }
    }

    /// 이 돌봄의 첫 "앱에서 답하세요" 면 참.
    pub(crate) fn note_once(&mut self, stream: &str) -> bool {
        match self.map.get_mut(stream) {
            Some(t) if !t.noted => {
                t.noted = true;
                true
            }
            _ => false,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.map.clear();
    }
}

/// 다리가 단추 통을 보낸(보내는 중인) 카드 하나.
struct SentCard {
    stream: String,
    epoch: u64,
    label: String,
    /// 보낸 메시지 id — 보내는 중이면 `None`
    message_id: Option<i64>,
    /// 보내는 사이 다른 곳에서 풀렸다 — 보내고 나서 곧바로 바꿔 쓴다
    gone: Option<String>,
    /// 다리의 누름이 결정하는 중 — 그 결정의 `gone` 은 다리가 바꿔 쓴다
    deciding: bool,
}

/// (메시지 id, 이름표, 까닭).
pub(crate) type Rewrite = Option<(i64, String, String)>;

/// (스트림, 회차, 이름표, 메시지 id).
pub(crate) type Pressed = (String, u64, String, Option<i64>);

/// 열쇠 = 요청 id. 서버가 다시 뜨면 잊는다.
#[derive(Default)]
pub(crate) struct Cards {
    map: HashMap<String, SentCard>,
}

impl Cards {
    /// 보내기 전에 연다 — 이미 있으면 거짓(한 카드에 한 통).
    pub(crate) fn open(&mut self, id: &str, stream: &str, epoch: u64) -> bool {
        if self.map.contains_key(id) {
            return false;
        }
        self.map.insert(
            id.to_string(),
            SentCard { stream: stream.to_string(), epoch, label: String::new(), message_id: None, gone: None, deciding: false },
        );
        true
    }

    pub(crate) fn has(&self, id: &str) -> bool {
        self.map.contains_key(id)
    }

    /// 그 스트림에 아직 풀리지 않은 다리 카드가 있나.
    pub(crate) fn open_on(&self, stream: &str) -> bool {
        self.map.values().any(|c| c.stream == stream && c.gone.is_none())
    }

    /// 보냈다(`None` = 실패 — 표에서 뺀다). 보내는 사이 풀렸으면 바꿔 쓸 것.
    pub(crate) fn sent(&mut self, id: &str, message_id: Option<i64>, label: &str) -> Rewrite {
        let Some(mid) = message_id else {
            self.map.remove(id);
            return None;
        };
        let c = self.map.get_mut(id)?;
        c.label = label.to_string();
        if let Some(reason) = c.gone.take() {
            let label = c.label.clone();
            self.map.remove(id);
            return Some((mid, label, reason));
        }
        c.message_id = Some(mid);
        None
    }

    /// 카드가 풀렸다(사건 `gone`) — 다리가 결정하는 중이면 그대로(다리가 바꿔 쓴다), 보내는 중이면 적어 두고, 보냈으면 바꿔 쓸 것.
    pub(crate) fn gone(&mut self, id: &str, reason: &str) -> Rewrite {
        let c = self.map.get_mut(id)?;
        if c.deciding {
            return None;
        }
        match c.message_id {
            None => {
                c.gone = Some(reason.to_string());
                None
            }
            Some(mid) => {
                let label = c.label.clone();
                self.map.remove(id);
                Some((mid, label, reason.to_string()))
            }
        }
    }

    /// 누를 수 있는 카드인가 — 보낸 통이 있고 풀리지 않았고 다른 누름이 결정하는 중이 아니다.
    pub(crate) fn pressable(&self, id: &str) -> bool {
        self.map.get(id).is_some_and(|c| !c.deciding && c.gone.is_none() && c.message_id.is_some())
    }

    /// 누름이 잡는다([`Self::pressable`] 일 때만) — 그 뒤의 `gone` 은 다리가 바꿔 쓴다.
    pub(crate) fn begin_press(&mut self, id: &str) -> Option<Pressed> {
        if !self.pressable(id) {
            return None;
        }
        let c = self.map.get_mut(id)?;
        c.deciding = true;
        Some((c.stream.clone(), c.epoch, c.label.clone(), c.message_id))
    }

    /// 누름이 결정을 마쳤다 — 표에서 뺀다.
    pub(crate) fn end_press(&mut self, id: &str) {
        self.map.remove(id);
    }

    /// 단추 없이 끝난 카드(꺼져 있어 보내지 않음) — 표에서 뺀다.
    pub(crate) fn forget(&mut self, id: &str) {
        self.map.remove(id);
    }

    pub(crate) fn clear(&mut self) {
        self.map.clear();
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.map.len()
    }
}

/// 35바이트 — 단추 데이터 상한(64) 안.
pub(crate) fn card_press_data(allow: bool, id: &str) -> String {
    format!("{}:{id}", if allow { "pa" } else { "pd" })
}

pub(crate) fn parse_card_press(data: &str) -> Option<(bool, String)> {
    let (allow, id) = match data.split_once(':')? {
        ("pa", id) => (true, id),
        ("pd", id) => (false, id),
        _ => return None,
    };
    (id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())).then(|| (allow, id.to_string()))
}

/// 짝지은 계정은 이미 지났다. 다리가 보낸 카드이고 그 채널이 **지금** 켜져 있어야 한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Press {
    /// 다리가 보낸 (풀리지 않은) 카드가 아니다 — "이미 처리됐습니다"
    Stale,
    /// 꺼져 있다 — 누름을 거절한다
    Off,
    Go,
}

pub(crate) fn judge_press(known: bool, chat_on: bool) -> Press {
    if !known {
        Press::Stale
    } else if !chat_on {
        Press::Off
    } else {
        Press::Go
    }
}

/// 채널 서식 걷기는 전송이 한다.
pub(crate) fn card_summary(tool: &str, input: &serde_json::Value) -> String {
    let raw = if crate::tile_permission::tool_kind(tool) == "patch" {
        input.get("command").and_then(serde_json::Value::as_str).map(|p| crate::tile_permission::patch_files(p).join(", ")).unwrap_or_default()
    } else {
        crate::agent_transcript::tool_summary(input)
    };
    let flat: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let flat = flat.trim();
    if flat.chars().count() > SUMMARY_MAX_CHARS {
        format!("{}…", flat.chars().take(SUMMARY_MAX_CHARS - 1).collect::<String>())
    } else {
        flat.to_string()
    }
}

/// 걷지 않은 글.
pub(crate) fn tool_line(tool: &str, summary: &str) -> String {
    let tool: String = tool.chars().filter(|c| !c.is_control()).take(120).collect();
    if summary.is_empty() {
        tr!(ko: "묻는 도구: {tool}", en: "Tool: {tool}")
    } else {
        tr!(ko: "묻는 도구: {tool} · {summary}", en: "Tool: {tool} · {summary}")
    }
}

/// (글자, 단추 데이터).
pub(crate) type Button = (String, String);

/// 걷지 않은 글. 이름표 120자 · 도구 120자 · 요약 300자라 어느 채널 상한에도 들어간다.
pub(crate) fn card_text(label: &str, tool: &str, summary: &str) -> String {
    let head = tr!(ko: "🟡 확인 필요 · {label}", en: "🟡 Needs action · {label}");
    format!("{head}\n{}", tool_line(tool, summary))
}

pub(crate) fn card_buttons(id: &str) -> Vec<Button> {
    vec![
        (tr!(ko: "허용", en: "Allow"), card_press_data(true, id)),
        (tr!(ko: "거절", en: "Deny"), card_press_data(false, id)),
    ]
}

/// `reason` 은 사건 `gone` 의 까닭 낱말.
pub(crate) fn gone_text(reason: &str) -> String {
    match reason {
        "allowed" | "allowed-session" => tr!(ko: "앱에서 허용했습니다", en: "Allowed in the app"),
        "denied" => tr!(ko: "앱에서 거절했습니다", en: "Denied in the app"),
        "released" => tr!(ko: "터미널에서 답하도록 넘겼습니다", en: "Handed over to the terminal"),
        "terminal" => tr!(ko: "터미널에서 답했습니다", en: "Answered in the terminal"),
        "timeout" => tr!(ko: "시간이 지나 터미널로 넘어갔습니다", en: "Timed out — handed over to the terminal"),
        "no-viewer" => tr!(ko: "보는 곳이 없어 터미널로 넘어갔습니다", en: "Nobody was viewing — handed over to the terminal"),
        "session-ended" => tr!(ko: "타일이 닫혔습니다", en: "The tile was closed"),
        _ => tr!(ko: "다른 곳에서 처리됐습니다", en: "Handled elsewhere"),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PressResult {
    Allowed,
    Denied,
    /// 이미 풀렸다
    Already,
    /// 더 이상 메신저에서 답할 수 없다(돌봄이 끝남 · 회차 바뀜)
    Closed,
    /// 꺼져 있다
    Off,
}

pub(crate) fn press_text(r: PressResult) -> String {
    match r {
        PressResult::Allowed => tr!(ko: "허용했습니다", en: "Allowed"),
        PressResult::Denied => tr!(ko: "거절했습니다", en: "Denied"),
        PressResult::Already => tr!(ko: "이미 처리됐습니다", en: "Already handled"),
        PressResult::Closed => tr!(ko: "이 물음은 더 이상 메신저에서 답할 수 없습니다 — 앱에서 답하세요", en: "This can no longer be answered from the messenger — answer in the app"),
        PressResult::Off => tr!(
            ko: "메신저에서 답하기가 꺼져 있습니다 — 메인 PC 의 설정에서 켜거나 앱에서 답하세요",
            en: "Answering from the messenger is off — turn it on in Settings on the main PC, or answer in the app",
        ),
    }
}

pub(crate) fn result_text(label: &str, line: &str) -> String {
    if label.is_empty() {
        line.to_string()
    } else {
        format!("{label} · {line}")
    }
}

/// 창이 이름표를 알리지 않을 때 — 프로젝트 밖 타일은 프런트 이름표(`bridgeLabelText`)와 같은 글자가 되어야 한다.
pub(crate) fn fallback_label(cli: &str, cwd: Option<&str>) -> String {
    let folder = cwd
        .map(|c| c.trim_end_matches(['/', '\\']))
        .and_then(|c| c.rsplit(['/', '\\']).next())
        .filter(|f| !f.is_empty());
    match folder {
        Some(f) => format!("{cli} · {f}"),
        None => cli.to_string(),
    }
}

// ---------------------------------------------------------------------------
// 전송 공용 — 답 나누기 · 갓 붙은 연결의 물러남
// ---------------------------------------------------------------------------

fn cut_by(text: &str, max: usize, width: &impl Fn(char) -> usize) -> usize {
    let mut used = 0;
    for (i, c) in text.char_indices() {
        used += width(c);
        if used > max {
            return i;
        }
    }
    text.len()
}

/// `telegram::split_text` 와 같은 꼴이되 조각의 길이를 글자마다의 `width` 로 잰다.
pub(crate) fn split_by(text: &str, max: usize, parts: usize, more: &str, width: impl Fn(char) -> usize) -> Vec<String> {
    let total = |s: &str| s.chars().map(&width).sum::<usize>();
    let mut rest = text.trim_end();
    let mut out: Vec<String> = Vec::new();
    while !rest.is_empty() && out.len() < parts {
        let last = out.len() + 1 == parts;
        if total(rest) <= max {
            out.push(rest.to_string());
            rest = "";
            break;
        }
        let budget = if last { max.saturating_sub(total(more) + 1) } else { max };
        let hard = cut_by(rest, budget, &width).max(rest.chars().next().map_or(0, char::len_utf8));
        let head = &rest[..hard];
        let at = head
            .rfind("\n\n")
            .filter(|&i| i > hard / 3)
            .or_else(|| head.rfind('\n').filter(|&i| i > hard / 3))
            .unwrap_or(hard);
        out.push(rest[..at].trim_end().to_string());
        rest = rest[at..].trim_start_matches(['\n', '\r']);
    }
    if !rest.is_empty() {
        if let Some(last) = out.last_mut() {
            last.push('\n');
            last.push_str(more);
        }
    }
    out
}

/// 갓 붙은 연결이 곧 죽기를 거듭할 때의 물러남 — 두 배씩 늘고, 오래 산 연결 뒤에는 처음으로.
#[derive(Default)]
pub(crate) struct Flap {
    wait: Option<std::time::Duration>,
}

impl Flap {
    pub(crate) fn delay(&mut self, short: bool, first: std::time::Duration, max: std::time::Duration) -> Option<std::time::Duration> {
        if !short {
            self.wait = None;
            return None;
        }
        let w = self.wait.unwrap_or(first);
        self.wait = Some((w * 2).min(max));
        Some(w)
    }
}
