//! 작업안 실행이 끝났다는 **창 밖 알림**(③-4 — 설계 4.4 "결과 알림") — 창이 하나도 없을 때 Rust 가 직접 짓는 한 줄과 메신저.
//!
//! 창이 있으면 알림은 지금처럼 주 창의 프런트가 한다(`app/operation-notify.svelte.ts` — 토스트·알림 센터·OS 알림·메신저). 창이
//! 없으면 그 모듈이 돌지 않으므로 둘로 나눈다:
//!
//! | 어디 | 누가 | 무엇을 |
//! | --- | --- | --- |
//! | GUI 가 트레이에만 있다(창 0개 · 연결 있음) | GUI Rust(`tray`) | OS 알림 한 장 · 메신저(켰으면) |
//! | GUI 가 아예 없다(세션 서버 혼자 · 연결 0) | 세션 서버(`server::auto_approve`) | 메신저(켰으면) · **미전달 큐**에 한 줄 — GUI 가 다시 붙어 주 창이 뜨면 "그동안 끝난 실행 N건" 한 줄로 꺼내 간다 |
//!
//! 메신저 웹훅은 볼트와 무관한 파일 하나(`crate::messenger`)라 서버가 그대로 읽는다. 창이 없는 동안은 사람이 자리에 없다고 보아
//! `[messenger] when` 을 따지지 않는다(`enabled` · `operation_results` 만 본다). 명령 줄은 `include_command` 를 켠 사람에게만
//! 싣는다 — 아니면 제목, 그것도 없으면 "작업안". 문구는 이 파일 하나가 짓는다(두 프로세스가 같은 말을 한다).
//!
//! **승인 대기**(승인 요약 — docs/log/2026-10-21-approval-summary.md)도 같은 세 갈래다: 창이 있으면 프런트가 새 대기를 보고
//! `messenger_send{operation}` 으로 id 만 넘기고([`pending_from_gui`]), 트레이 GUI · 세션 서버 혼자면 각자 `awaitingApproval` 이벤트에서
//! 보낸다([`send_pending_messenger`]). 셋 다 [`PENDING_GRACE`] 뒤에 **아직 사람을 기다리는지**([`still_pending`]) 다시 보므로 자동 승인된
//! 것은 나가지 않는다. 한 통의 글은 [`pending_message`] 하나가 짓는다 — 승인 단추 · 링크는 없다.

use serde::{Deserialize, Serialize};

use crate::i18n::tr;

use super::*;

/// 끝난 실행 한 건 — 미전달 큐의 줄(op `ops_unseen_take`)이자 알림 문구의 재료. 비밀 없음(명령은 작업안에 이미 평문이다).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinishedRun {
    pub operation_id: String,
    /// `succeeded` · `partial` · `failed` · `cancelled`
    pub state: String,
    pub title: Option<String>,
    pub command: String,
    /// 사전 정책 자동 승인으로 돌았나
    pub auto: bool,
    /// 사람이 도중에 취소했나(집계는 `partial` 일 수 있다)
    #[serde(default)]
    pub cancelled_by_user: bool,
    pub finished_at: u64,
}

/// **미전달 큐** — GUI 가 하나도 붙어 있지 않을 때 끝난 실행(세션 서버가 쥔다). 주 창이 다시 뜨면 op `ops_unseen_take` 로
/// 꺼내 "그동안 끝난 실행 N건" 한 줄로 알린다. 상한 [`UNSEEN_MAX`](넘으면 오래된 것부터 버린다 — 개수만 틀어질 뿐).
#[derive(Default)]
pub(crate) struct Unseen(std::sync::Mutex<std::collections::VecDeque<FinishedRun>>);

/// 미전달 큐 상한.
pub(crate) const UNSEEN_MAX: usize = 100;

impl Unseen {
    pub(crate) fn push(&self, run: FinishedRun) {
        let mut q = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if q.iter().any(|r| r.operation_id == run.operation_id) {
            return;
        }
        if q.len() >= UNSEEN_MAX {
            q.pop_front();
        }
        q.push_back(run);
    }

    /// 꺼내고 비운다.
    pub(crate) fn take(&self) -> Vec<FinishedRun> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).drain(..).collect()
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

/// 실행이 끝난 상태인가(성공·일부·실패·취소).
pub(crate) fn is_finished(state: &OperationState) -> bool {
    matches!(
        state,
        OperationState::Succeeded | OperationState::Partial | OperationState::Failed | OperationState::Cancelled
    )
}

/// 상태 이름(직렬화 모양 그대로).
fn state_name(state: &OperationState) -> String {
    serde_json::to_value(state)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

impl FinishedRun {
    pub(crate) fn of(op: &Operation, finished_at: u64) -> FinishedRun {
        FinishedRun {
            operation_id: op.operation_id.clone(),
            state: state_name(&op.state),
            title: op.title.clone().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()),
            command: op.command.clone(),
            auto: op.approval_method.as_deref() == Some("auto"),
            cancelled_by_user: op.cancelled_by_user,
            finished_at,
        }
    }

    /// 이름표 — 제목, 없으면(명령 줄을 싣기로 했으면) 명령 앞부분, 그것도 없으면 "작업안".
    pub(crate) fn label(&self, include_command: bool) -> String {
        if let Some(t) = &self.title {
            return clip(t, 80);
        }
        if include_command && !self.command.trim().is_empty() {
            return clip(self.command.trim(), 80);
        }
        tr!(ko: "작업안", en: "Task plan")
    }

    /// 결과 한 토막 — `실행 성공` · `일부 실패` · `실패` · `취소됨`(+ ` · 자동 승인`).
    pub(crate) fn outcome(&self) -> String {
        let word = if self.cancelled_by_user || self.state == "cancelled" {
            tr!(ko: "실행 취소됨", en: "Run cancelled")
        } else {
            match self.state.as_str() {
                "succeeded" => tr!(ko: "실행 성공", en: "Run succeeded"),
                "partial" => tr!(ko: "실행 일부 실패", en: "Run partly failed"),
                _ => tr!(ko: "실행 실패", en: "Run failed"),
            }
        };
        if self.auto {
            format!("{word} · {}", tr!(ko: "자동 승인", en: "auto-approved"))
        } else {
            word
        }
    }
}

fn clip(text: &str, max: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        flat
    } else {
        let mut s: String = flat.chars().take(max.saturating_sub(1)).collect();
        s.push('…');
        s
    }
}

/// 창이 없을 때 메신저로 보낼까 — 켜진 채널이 있고 이 종류(`operation_results`, 기본 켬)가 켜졌을 때. `when` 은 보지 않는다
/// (창이 없으면 자리 비움이다 — 머리말).
pub(crate) fn messenger_wants(prefs: &crate::settings::MessengerPrefs) -> bool {
    !channels(prefs).is_empty() && prefs.operation_results != Some(false)
}

/// 켜진 채널 — 프런트 `messengerChannels` 와 같은 규칙(안 정하면 켬).
fn channels(prefs: &crate::settings::MessengerPrefs) -> Vec<crate::messenger::Channel> {
    let mut out = Vec::new();
    if prefs.discord != Some(false) {
        out.push(crate::messenger::Channel::Discord);
    }
    if prefs.slack != Some(false) {
        out.push(crate::messenger::Channel::Slack);
    }
    out
}

/// 창이 없을 때의 메신저 한 통 — 규칙을 지나면 보낸다. 실패는 로그 한 줄(던지지 않는다 — 알림 하나가 아무것도 막지 않는다).
/// 설정 파일을 읽으므로 async 문맥에서는 블로킹 풀로 읽는다.
pub(crate) async fn send_messenger(run: FinishedRun, log: impl Fn(String)) {
    let prefs = match tokio::task::spawn_blocking(crate::settings::messenger_prefs).await {
        Ok(p) => p,
        Err(_) => return,
    };
    if !messenger_wants(&prefs) {
        return;
    }
    let label = run.label(prefs.include_command == Some(true));
    let message = crate::messenger::Message::plain(crate::instance::window_title(crate::instance::DEV), label, run.outcome());
    if let Err(e) = crate::messenger::send_plain(message, channels(&prefs)).await {
        log(format!("messenger — run result not sent: {e}"));
    }
}

// ---------------------------------------------------------------------------
// 승인 대기 알림 — 승인 요약(docs/log/2026-10-21-approval-summary.md)
// ---------------------------------------------------------------------------

/// 검토 대기에 들어온 뒤 이만큼 기다렸다가 **다시 본다** — 서버의 사전 정책 자동 승인 훑기([`super::auto::SWEEP_EVERY`], 2초)가
/// 지나갈 시간이다. 자동 승인된 작업안은 그사이 대기를 떠나므로 보내지 않는다.
pub(crate) const PENDING_GRACE: std::time::Duration = std::time::Duration::from_secs(5);

/// 아직 **사람을** 기다리는가 — 검토 대기이고 승인 방식이 찍히지 않았다.
pub(crate) fn still_pending(op: &Operation) -> bool {
    op.state == OperationState::AwaitingApproval && op.approval_method.is_none()
}

/// 이 프로세스가 이미 보낸 승인 대기(검토 요청은 멱등이라 같은 `awaitingApproval` 이벤트가 다시 올 수 있다).
static PENDING_SENT: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(Default::default);

/// 처음 보내는 작업안인가 — 참이면 이제 보낸 것으로 적는다. 기억은 [`UNSEEN_MAX`] 의 다섯 배에서 비운다(앱이 며칠 켜져 있어도 자라지 않게 —
/// 작업안 id 는 난수라 비운 뒤 같은 id 가 다시 올 일은 사실상 없다).
pub(crate) fn first_pending(id: &str) -> bool {
    let mut set = PENDING_SENT.lock().unwrap_or_else(|e| e.into_inner());
    if set.len() >= UNSEEN_MAX * 5 {
        set.clear();
    }
    set.insert(id.to_string())
}

/// 승인 대기를 보낼까 — 켜진 채널이 있고 이 종류(`operation_pending`, 기본 켬)가 켜졌을 때. 창이 없을 때는 `when` 을 보지 않는다
/// (창이 없으면 자리 비움이다 — 머리말). 창이 있을 때의 `when` 은 프런트가 본다.
pub(crate) fn pending_wants(prefs: &crate::settings::MessengerPrefs) -> bool {
    !channels(prefs).is_empty() && prefs.operation_pending != Some(false)
}

fn computed_word(c: Computed) -> String {
    match c {
        Computed::Read => tr!(ko: "읽기만", en: "read-only"),
        Computed::Write => tr!(ko: "쓰기", en: "write"),
        Computed::Unknown => tr!(ko: "확인 필요", en: "needs a look"),
        Computed::Delete => tr!(ko: "삭제", en: "delete"),
    }
}

fn declared_word(e: Effect) -> String {
    match e {
        Effect::Read => tr!(ko: "읽기", en: "read"),
        Effect::Write => tr!(ko: "쓰기", en: "write"),
        Effect::Delete => tr!(ko: "삭제", en: "delete"),
    }
}

/// 앱 분석 한 줄 — `읽기만 · du → sort → head · 선언과 일치` · DB 면 문장마다 `DELETE users · WHERE 있음` + 상한.
fn analysis_line(op: &Operation) -> Option<String> {
    let a = op.analysis.as_ref()?;
    let mut parts = vec![computed_word(a.effect)];
    if let Some(db) = &op.db {
        for s in a.statements.iter().take(3) {
            let mut one = match &s.table {
                Some(t) => format!("{} {t}", s.keyword),
                None => s.keyword.clone(),
            };
            match s.where_clause {
                Some(true) => one.push_str(&tr!(ko: " · WHERE 있음", en: " · has WHERE")),
                Some(false) => one.push_str(&tr!(ko: " · WHERE 없음 — 테이블 전체", en: " · no WHERE — whole table")),
                None => {}
            }
            parts.push(one);
        }
        if a.statements.len() > 3 {
            let n = a.statements.len() - 3;
            parts.push(tr!(ko: "외 {n}문장", en: "+{n} more"));
        }
        let max = db.max_affected;
        parts.push(tr!(ko: "상한 {max}행", en: "at most {max} rows"));
    } else {
        if !a.programs.is_empty() {
            let mut list: Vec<&str> = a.programs.iter().map(String::as_str).take(6).collect();
            if a.programs.len() > 6 {
                list.push("…");
            }
            parts.push(list.join(" → "));
        }
        if a.sudo {
            parts.push("sudo".into());
        }
    }
    if op.effect.is_some() {
        parts.push(if op.mismatch {
            tr!(ko: "AI 설명과 다름", en: "differs from the AI summary")
        } else {
            tr!(ko: "AI 설명과 일치", en: "matches the AI summary")
        });
    }
    let line = parts.join(" · ");
    Some(tr!(ko: "앱 분석: {line}", en: "App analysis: {line}"))
}

/// 어긋남 확인 줄 — `확인해 주세요 — AI 설명은 '읽기'지만 원문에는 삭제(find -delete)`.
fn mismatch_line(op: &Operation) -> Option<String> {
    if !op.mismatch {
        return None;
    }
    let (declared, a) = (op.effect?, op.analysis.as_ref()?);
    let said = declared_word(declared);
    let found = match &a.cause {
        Some(c) => format!("{}({c})", computed_word(a.effect)),
        None => computed_word(a.effect),
    };
    Some(tr!(ko: "확인해 주세요 — AI 설명은 '{said}'지만 원문에는 {found}", en: "Please check — the AI said '{said}', but the raw text shows {found}"))
}

/// 대상 줄 — 원격은 이름(만들 때 붙여 둔 이름표 · 없으면 id) 다섯까지, DB 는 연결 이름 · 엔진 · DB.
fn targets_line(op: &Operation) -> String {
    if let Some(db) = &op.db {
        let mut s = format!("{} · {}", db.conn_name, db.engine);
        if let Some(d) = db.database.as_deref().filter(|d| !d.trim().is_empty()) {
            s.push_str(&format!(" · {d}"));
        }
        return tr!(ko: "연결: {s}", en: "Connection: {s}");
    }
    let names: Vec<&str> = op
        .targets
        .iter()
        .take(5)
        .map(|t| op.target_labels.get(t).map(String::as_str).unwrap_or(t.as_str()))
        .collect();
    let mut s = names.join(", ");
    if op.targets.len() > 5 {
        let n = op.targets.len() - 5;
        s.push_str(&tr!(ko: " 외 {n}곳", en: " +{n} more"));
    }
    tr!(ko: "대상: {s}", en: "Targets: {s}")
}

/// 만료 줄 — 이 PC 의 시계로 `HH:MM`(만료 없음이면 그렇게).
fn expiry_line(op: &Operation) -> String {
    match op.expires_at.and_then(chrono::DateTime::from_timestamp_millis) {
        Some(t) => {
            let at = t.with_timezone(&chrono::Local).format("%H:%M").to_string();
            tr!(ko: "만료: {at}", en: "Expires: {at}")
        }
        None => tr!(ko: "만료 없음", en: "No expiry"),
    }
}

/// **승인 대기 한 통** — 평문 구조(서식 · 걷기 · 멘션 막기는 채널이 — `messenger::Channel::render`). 순수(시험 대상).
///
/// 첫 줄 `앱 · 원격 명령 승인 대기 — 제목`, 그 아래 요청 타일 · (켰으면) AI 설명 · 앱 분석 한 줄 · (어긋나면) 주의 · 대상 · 만료 ·
/// (명령 줄 싣기를 켰으면) 원문 앞 300자 · 끝줄 "승인은 앱에서만". AI 가 쓴 글자(제목 · 설명)와 타일 이름은 **남의 글자**라 다른 줄과
/// 똑같이 채널이 걷는다. 승인 단추 · 링크는 없다.
pub(crate) fn pending_message(op: &Operation, include_summary: bool, include_command: bool, app: &str) -> crate::messenger::Message {
    let label = if op.db.is_some() {
        tr!(ko: "DB 쓰기 승인 대기", en: "Database write awaiting approval")
    } else {
        tr!(ko: "원격 명령 승인 대기", en: "Remote command awaiting approval")
    };
    let event = op
        .title
        .as_deref()
        .map(|t| clip(t, 80))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| tr!(ko: "작업안", en: "Task plan"));
    let mut lines = Vec::new();
    if let Some(who) = op.requested_by.as_deref().filter(|w| !w.trim().is_empty()) {
        lines.push(tr!(ko: "요청: AI · {who}", en: "Requested by: AI · {who}"));
    }
    if include_summary {
        if let Some(s) = op.summary.as_deref().filter(|s| !s.trim().is_empty()) {
            let s = clip(s, super::analysis::SUMMARY_MAX_CHARS);
            lines.push(tr!(ko: "AI 설명: {s}", en: "AI summary: {s}"));
        }
    }
    if let Some(l) = analysis_line(op) {
        lines.push(l);
    }
    if let Some(l) = mismatch_line(op) {
        lines.push(l);
    }
    lines.push(targets_line(op));
    lines.push(expiry_line(op));
    if include_command && !op.command.trim().is_empty() {
        let c = clip(&op.command, 300);
        lines.push(if op.db.is_some() {
            tr!(ko: "SQL: {c}", en: "SQL: {c}")
        } else {
            tr!(ko: "명령: {c}", en: "Command: {c}")
        });
    }
    lines.push(tr!(ko: "승인은 {app} 앱(또는 원격 웹)에서만", en: "Approve only in the {app} app (or its remote web)"));
    crate::messenger::Message::with_lines(app, label, event, lines, op.mismatch)
}

/// 창이 없을 때(트레이 GUI · 세션 서버 혼자)의 승인 대기 한 통 — 규칙을 지나면 보낸다. 실패는 로그 한 줄.
pub(crate) async fn send_pending_messenger(op: Operation, log: impl Fn(String)) {
    let prefs = match tokio::task::spawn_blocking(crate::settings::messenger_prefs).await {
        Ok(p) => p,
        Err(_) => return,
    };
    if !pending_wants(&prefs) {
        return;
    }
    let message = pending_message(
        &op,
        prefs.include_summary != Some(false),
        prefs.include_command == Some(true),
        crate::instance::window_title(crate::instance::DEV),
    );
    if let Err(e) = crate::messenger::send_plain(message, channels(&prefs)).await {
        log(format!("messenger — pending plan not sent: {e}"));
    }
}

/// GUI 의 프런트 길(`messenger_send` 의 `operation`) — 서버 목록에서 아직 사람을 기다리는지 다시 보고, 설정 파일의 칸을 다시 본 뒤
/// 한 통을 짓는다. 보낼 것이 없으면(대기를 떠났다 · 꺼짐 · 이미 보냄) `None`. `when` 은 프런트가 이미 판정했다.
pub(crate) async fn pending_from_gui(id: &str, app: &str) -> Option<crate::messenger::Message> {
    let op = crate::server::ai_proxy::pending_operation(id).await?;
    let prefs = tokio::task::spawn_blocking(crate::settings::messenger_prefs).await.ok()?;
    if !pending_wants(&prefs) || !first_pending(id) {
        return None;
    }
    Some(pending_message(&op, prefs.include_summary != Some(false), prefs.include_command == Some(true), app))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending_op(command: &str, effect: Effect) -> Operation {
        let mut map = std::collections::HashMap::new();
        create_plan(
            &mut map,
            "op-p".into(),
            command.into(),
            vec!["delegated:web-01".into(), "s-2".into()],
            None,
            None,
            "adhoc".into(),
            "rolling".into(),
            1,
            60,
            Some("오래된 압축 로그 지우기".into()),
            None,
            1,
            None,
        );
        let mut labels = std::collections::BTreeMap::new();
        labels.insert("delegated:web-01".to_string(), "web-01".to_string());
        let decl = Declaration {
            summary: "nginx 로그 크기를 보여 줍니다".into(),
            effect,
            requested_by: Some("t1 api".into()),
            target_labels: labels,
        };
        let mut op = declare(&mut map, "op-p", decl).unwrap();
        op.state = OperationState::AwaitingApproval;
        op
    }

    #[test]
    fn pending_message_lines_and_mismatch() {
        crate::i18n::set_lang(crate::i18n::Lang::Ko);
        let op = pending_op(r#"sudo find /var/log -name "*.gz" -mtime +7 -delete"#, Effect::Read);
        assert!(op.mismatch);
        let m = pending_message(&op, true, false, "Aynx");
        let text = m.debug_lines().join("\n");
        assert!(text.contains("요청: AI · t1 api"), "{text}");
        assert!(text.contains("AI 설명: nginx 로그 크기를 보여 줍니다"), "{text}");
        assert!(text.contains("앱 분석: 삭제 · find · sudo · AI 설명과 다름"), "{text}");
        assert!(text.contains("확인해 주세요 — AI 설명은 '읽기'지만 원문에는 삭제(find -delete)"), "{text}");
        assert!(text.contains("대상: web-01, s-2"), "{text}");
        assert!(text.contains("만료 없음"), "{text}");
        assert!(!text.contains("명령:"), "명령 줄은 include_command 를 켠 사람에게만");
        assert!(text.contains("승인은 Aynx 앱(또는 원격 웹)에서만"), "{text}");
        assert!(m.is_alert(), "어긋나면 경고 색");

        let quiet = pending_message(&op, false, true, "Aynx");
        let text = quiet.debug_lines().join("\n");
        assert!(!text.contains("AI 설명:"), "설명 끄면 싣지 않는다");
        assert!(text.contains("명령: sudo find"), "{text}");
    }

    #[test]
    fn pending_message_matching_read_is_calm() {
        crate::i18n::set_lang(crate::i18n::Lang::Ko);
        let op = pending_op("du -ah /var/log/nginx | sort -rh | head -n 10", Effect::Read);
        assert!(!op.mismatch);
        let m = pending_message(&op, true, false, "Aynx");
        let text = m.debug_lines().join("\n");
        assert!(text.contains("앱 분석: 읽기만 · du → sort → head · AI 설명과 일치"), "{text}");
        assert!(!text.contains("확인해 주세요"), "{text}");
        assert!(!m.is_alert());
    }

    #[test]
    fn pending_rules_and_dedupe() {
        let mut p = crate::settings::MessengerPrefs::default();
        assert!(pending_wants(&p), "채널 · 종류는 기본 켬");
        p.operation_pending = Some(false);
        assert!(!pending_wants(&p));
        assert!(first_pending("op-dedupe-1"));
        assert!(!first_pending("op-dedupe-1"), "한 작업안에 한 번");
        let mut op = pending_op("ls", Effect::Read);
        assert!(still_pending(&op));
        op.approval_method = Some("auto".into());
        assert!(!still_pending(&op), "자동 승인된 것은 보내지 않는다");
    }

    fn run(state: &str, title: Option<&str>, auto: bool) -> FinishedRun {
        FinishedRun {
            operation_id: "op-1".into(),
            state: state.into(),
            title: title.map(str::to_string),
            command: "systemctl   restart nginx".into(),
            auto,
            cancelled_by_user: false,
            finished_at: 1,
        }
    }

    #[test]
    fn label_prefers_title_then_command_only_when_allowed() {
        crate::i18n::set_lang(crate::i18n::Lang::Ko);
        assert_eq!(run("succeeded", Some("nginx 재시작"), false).label(false), "nginx 재시작");
        assert_eq!(run("succeeded", None, false).label(true), "systemctl restart nginx");
        assert_eq!(run("succeeded", None, false).label(false), "작업안", "명령 줄은 include_command 를 켠 사람에게만");
    }

    #[test]
    fn outcome_words_and_auto_mark() {
        crate::i18n::set_lang(crate::i18n::Lang::Ko);
        assert_eq!(run("succeeded", None, true).outcome(), "실행 성공 · 자동 승인");
        assert_eq!(run("partial", None, false).outcome(), "실행 일부 실패");
        assert_eq!(run("failed", None, false).outcome(), "실행 실패");
        let mut r = run("partial", None, false);
        r.cancelled_by_user = true;
        assert_eq!(r.outcome(), "실행 취소됨");
    }

    #[test]
    fn messenger_needs_a_channel_and_kind() {
        let mut p = crate::settings::MessengerPrefs::default();
        assert!(messenger_wants(&p), "채널 · 종류는 기본 켬");
        p.discord = Some(false);
        assert!(messenger_wants(&p), "한 채널이라도 켜져 있으면 보낸다");
        p.slack = Some(false);
        assert!(!messenger_wants(&p), "켜진 채널이 없으면 보내지 않는다");
        assert!(!pending_wants(&p), "승인 대기도 같다");
        p.discord = None;
        p.operation_results = Some(false);
        assert!(!messenger_wants(&p));
    }

    #[test]
    fn unseen_queue_is_bounded_deduped_and_drained() {
        let q = Unseen::default();
        for i in 0..(UNSEEN_MAX + 5) {
            let mut r = run("succeeded", None, true);
            r.operation_id = format!("op-{i}");
            q.push(r);
        }
        q.push(run("failed", None, false)); // op-1 은 이미 버려졌다(오래된 것부터) — 다시 들어온다
        q.push(run("failed", None, false)); // 같은 id 두 번은 한 줄
        let got = q.take();
        assert_eq!(got.len(), UNSEEN_MAX);
        assert_eq!(got.last().unwrap().operation_id, "op-1");
        assert_eq!(q.len(), 0, "꺼내면 비운다");
    }

    #[test]
    fn finished_states() {
        assert!(is_finished(&OperationState::Succeeded));
        assert!(is_finished(&OperationState::Cancelled));
        assert!(!is_finished(&OperationState::Running));
        assert!(!is_finished(&OperationState::Expired));
    }
}
