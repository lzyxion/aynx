//! **감독 사건**(리뷰 F11 · 설계 C-7 "알림 — 서버가 낸다" · 10-15 결정 ①) — 창이 하나도 없어도 사람이 개입해야 할 일을 놓치지 않게,
//! 오케스트레이션 사건(작업자 권한 대기 · 부트스트랩 사람 필요 · 멈춤 · `needs-recovery` · 비정상 종료 · 생성 실패 · 한도 · 조정자 종료 ·
//! Run 끝 · 사람이 풀어야 하는 `commit_changes` 거절)을 **서버가 사건 id 와 함께** 만든다.
//!
//! 흐름:
//! - 사건은 상태가 바뀌는 그 잠금 안에서 선다([`Orchestration::raise`] — id = `<runId>#<seq>:<kind>`, 같은 사건은 한 번). 미확인 큐(상한
//!   [`NOTICES_MAX`])에 넣고 서버 이벤트 [`EVT_NOTICE`] 를 낸다.
//! - **붙은 GUI 가 없으면** 세션 서버가 기존 메신저 길(작업안 알림과 같은 자리 — `server::ai::AiPlane::start_timers`)로 보낸다. 메신저가
//!   꺼져 있으면 큐만.
//! - 주 창은 이벤트로 받은 사건과, 창이 없던 동안 쌓인 사건(op `orchestration_notices_take`)을 **사건 id 로 한 번만** 보이고 확인한다
//!   (op `orchestration_notices_ack`). 보드의 알림은 이 길 하나로 모였다(보드가 따로 알리지 않는다 — 중복 없음).
//! - 확인된 사건은 서버 메모리의 최근 목록([`RECENT_MAX`])으로 옮긴다 — F5 · 재부착으로 다시 뜬 주 창이 알림 센터에만 다시 적는다
//!   (op `orchestration_notices{recent: true}` · 실기 b 고침 A).
//!
//! 불변식: 사건에는 토큰 · 프롬프트 본문이 없다(Run 이름 · Task 제목 · 종류 낱말 · Attempt id 만). 제목은 사람이 쓴 것이라 메신저에는
//! 길이를 잘라 싣는다. 저장소 경로는 사건과 메신저 글에 싣지 않는다([`message_text`]).

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};

use super::store::{Orchestration, Slot};

/// 서버 이벤트 — 감독 사건 하나(몸 = [`Notice`]). GUI 가 같은 이름으로 창에 중계한다(`client::RELAYED`).
pub(crate) const EVT_NOTICE: &str = "orchestration-notice";

/// 미확인 큐 상한(넘으면 오래된 것부터 버린다).
pub(crate) const NOTICES_MAX: usize = 100;

/// 감독 사건 하나 — 비밀 · 본문 없음.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Notice {
    pub id: String,
    pub run_id: String,
    pub run_name: String,
    /// `worker-exited` · `reviewer-exited`(판정 없이 끝난 검토자) · `exit-unconfirmed` · `spawn-failed` ·
    /// `limit` · `coordinator-exited`(이미 멈춘 Run 이면 `detail` = `already-paused`) · `run-ended` · `commit-rejected`(10-15 — `detail` = 거절 사유 낱말).
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_title: Option<String>,
    /// 짧은 낱말(한도 이름 · 끝 상태) — 사람 글이 아니다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub at: u64,
}

/// 확인된 사건을 몇 개까지 남기나(실기 b — 아래 [`Notices`] 의 `recent`).
pub(crate) const RECENT_MAX: usize = 50;

/// 미확인 큐 + **확인된 최근 사건**(실기 b 고침 A). 창의 알림 센터는 페이지 메모리라(`app/notifications` — 디스크에 쓰지 않는다) F5 · 웹뷰
/// 크래시 재부착이 지난 줄을 지우는데, 사건은 보인 순간 확인돼 미확인 큐에서도 빠진다 — 그래서 다시 뜬 주 창이 "지난 알림이 없습니다" 였다.
/// 확인된 것을 서버 메모리에 조금 남겨 다시 뜬 주 창이 알림 센터에만(토스트 없이) 다시 적는다. 디스크에는 쓰지 않는다(서버가 끝나면 사라진다).
#[derive(Default)]
pub(crate) struct Notices(Mutex<VecDeque<Notice>>, Mutex<VecDeque<Notice>>);

impl Notices {
    fn push(&self, n: Notice) -> bool {
        let mut q = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if q.iter().any(|x| x.id == n.id) {
            return false;
        }
        if q.len() >= NOTICES_MAX {
            q.pop_front();
        }
        q.push_back(n);
        true
    }

    /// 지금 미확인 사건(오래된 것부터) — 지우지 않는다(확인은 [`Notices::ack`]).
    pub(crate) fn list(&self) -> Vec<Notice> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).iter().cloned().collect()
    }

    /// 확인 — 그 id 들을 큐에서 빼 최근 목록으로 옮긴다(상한 [`RECENT_MAX`] — 오래된 것부터 버린다). 뺀 수.
    pub(crate) fn ack(&self, ids: &[String]) -> usize {
        let mut q = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let (gone, keep): (VecDeque<Notice>, VecDeque<Notice>) = q.drain(..).partition(|n| ids.iter().any(|i| i == &n.id));
        *q = keep;
        drop(q);
        let n = gone.len();
        let mut r = self.1.lock().unwrap_or_else(|e| e.into_inner());
        for x in gone {
            if r.len() >= RECENT_MAX {
                r.pop_front();
            }
            r.push_back(x);
        }
        n
    }

    /// 확인된 최근 사건(오래된 것부터) — 다시 뜬 주 창이 알림 센터에 다시 적는다.
    pub(crate) fn recent(&self) -> Vec<Notice> {
        self.1.lock().unwrap_or_else(|e| e.into_inner()).iter().cloned().collect()
    }
}

/// 종류 낱말을 고정 글자로(이벤트 몸에서 다시 읽을 때 — 모르는 것은 `other`).
pub(crate) fn kind_word(k: &str) -> &'static str {
    // (3차 6단계) 2차 PTY 작업자의 종류(`permission` · `bootstrap` · `stalled` · `needs-recovery`)는 걷었다 — 헤드리스 작업자에게는 권한 화면 ·
    // 첫 화면 · 붙여넣기가 없어 서지 않는다(모르는 낱말은 `other`).
    match k {
        "worker-exited" => "worker-exited",
        "reviewer-exited" => "reviewer-exited",
        "exit-unconfirmed" => "exit-unconfirmed",
        "spawn-failed" => "spawn-failed",
        "limit" => "limit",
        "coordinator-exited" => "coordinator-exited",
        "run-ended" => "run-ended",
        "commit-rejected" => "commit-rejected",
        "verify-approval" => "verify-approval",
        "verify-failed" => "verify-failed",
        // 3차 3a — 헤드리스 작업자 · 맡기기.
        "worker-blocked" => "worker-blocked",
        "worker-idle" => "worker-idle",
        "turn-timeout" => "turn-timeout",
        "verify-needs-human" => "verify-needs-human",
        "repo-identity-changed" => "repo-identity-changed",
        // 3차 5단계 — AI 가 Run 을 연다.
        "run-adopted" => "run-adopted",
        // 2단계 단계 4 — 앱이 깨움(`wake.rs` — 꺼짐 · 무시 · 전송 실패 · 깨움 턴 시한).
        "wake-limit" => "wake-limit",
        "wake-ignored" => "wake-ignored",
        "wake-failed" => "wake-failed",
        "wake-turn-timeout" => "wake-turn-timeout",
        // 앨범 병합 — 자동 병합이 멈췄다(`album_merge.rs` — `detail` = 까닭 낱말).
        "auto-merge-stopped" => "auto-merge-stopped",
        _ => "other",
    }
}

/// 메신저 한 통의 글자(서버 — 창이 없을 때). 언어는 서버의 지금 언어.
pub(crate) fn message_text(n: &Notice) -> String {
    use crate::i18n::tr;
    let task = n.task_title.as_deref().map(|t| clip(t, 60));
    let who = match &task {
        Some(t) => format!(" · {t}"),
        None => String::new(),
    };
    let what = match n.kind {
        "worker-exited" => tr!(ko: "아티스트가 보고 없이 끝났습니다", en: "An artist exited without reporting"),
        "reviewer-exited" => tr!(ko: "검토자가 판정 없이 끝났습니다", en: "A reviewer exited without a verdict"),
        "exit-unconfirmed" => tr!(ko: "아티스트 프로세스 종료를 확인하지 못했습니다", en: "An artist's process exit is unconfirmed"),
        "spawn-failed" => tr!(ko: "아티스트를 띄우지 못했습니다", en: "An artist could not start"),
        "limit" => tr!(ko: "앨범이 한도에 닿았습니다", en: "The album reached a limit"),
        "coordinator-exited" if n.detail.as_deref() == Some("already-paused") => tr!(
            ko: "프로듀서가 끝났습니다(앨범은 이미 멈춰 있었습니다)",
            en: "The producer exited (the album was already paused)"
        ),
        "coordinator-exited" => tr!(ko: "프로듀서가 끝나 앨범이 멈췄습니다", en: "The producer exited — the album is paused"),
        "run-ended" => tr!(ko: "앨범이 끝났습니다", en: "The album ended"),
        "commit-rejected" => tr!(
            ko: "앱이 아티스트 커밋을 거절했습니다 — 사람이 손써야 합니다",
            en: "The app refused an artist's commit — a person must fix it"
        ),
        "verify-approval" => tr!(
            ko: "통합 후보의 검증이 사람 확인을 기다립니다",
            en: "An integration candidate's verification is waiting for your approval"
        ),
        "verify-failed" => tr!(ko: "수락 전 검증이 통과하지 않았습니다", en: "The pre-acceptance verification did not pass"),
        "worker-blocked" => tr!(
            ko: "아티스트가 맡긴 범위 밖의 것이 필요해 멈췄습니다 — 프로듀서가 무엇이 필요한지 알려 줍니다",
            en: "An artist is blocked — it needs something outside the delegated scope (the producer will tell you what)"
        ),
        "worker-idle" => tr!(ko: "아티스트의 턴이 보고 없이 끝났습니다", en: "An artist's turn ended without a report"),
        "turn-timeout" => tr!(ko: "아티스트 턴이 시한을 넘겨 끝냈습니다", en: "An artist's turn ran past its time limit and was ended"),
        "verify-needs-human" => tr!(
            ko: "앨범 구성이 바뀌어 검증을 무인으로 돌리지 않았습니다 — 사람 확인을 기다립니다",
            en: "The album configuration changed, so the verification was not run unattended — it waits for your approval"
        ),
        "repo-identity-changed" => tr!(
            ko: "저장소가 앨범을 시작한 그 저장소가 아닙니다 — 통합을 멈추고 보류했습니다",
            en: "The repository is not the one the album started with — integration was put on hold"
        ),
        "run-adopted" => tr!(
            ko: "다른 AI 타일이 멈춘 앨범을 이어받았습니다",
            en: "Another AI tile took over the paused album"
        ),
        "wake-limit" => tr!(
            ko: "앱이 프로듀서를 더 깨우지 않습니다 — 프로듀서 채팅에 말하면 이어 갑니다",
            en: "AYNX stopped waking the producer — message the producer chat to continue"
        ),
        "wake-ignored" => tr!(
            ko: "프로듀서가 앱의 깨움에 반응하지 않았습니다 — 앨범을 확인하세요",
            en: "The producer did not respond to AYNX's wake-up — check the album"
        ),
        "wake-failed" => tr!(
            ko: "앱이 프로듀서를 깨우지 못했습니다 — 프로듀서 채팅에 말하면 이어 갑니다",
            en: "AYNX could not wake the producer — message the producer chat to continue"
        ),
        "wake-turn-timeout" => tr!(
            ko: "앱이 깨운 프로듀서 턴이 시한을 넘겨 끊었습니다",
            en: "A producer turn started by AYNX ran past its time limit and was interrupted"
        ),
        "auto-merge-stopped" => tr!(
            ko: "자동 병합을 멈췄습니다 — 앨범에서 까닭을 보고 [병합] 하세요",
            en: "Auto-merge stopped — see why on the album page, then use [Merge]"
        ),
        _ => tr!(ko: "앨범에 사건이 있습니다", en: "Something happened in the album"),
    };
    // 거절 사유 낱말(고정 글자)은 사람이 무엇을 할지 고르는 재료라 싣는다.
    let why = match (n.kind, n.detail.as_deref()) {
        ("commit-rejected" | "verify-failed" | "verify-needs-human" | "spawn-failed" | "auto-merge-stopped", Some(d)) => format!(" ({})", clip(d, 40)),
        _ => String::new(),
    };
    format!("{what}{why}{who}")
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

impl Orchestration {
    /// 감독 사건 하나를 세운다 — **상태를 바꾼 그 잠금 안에서** 부른다(`slot.run.seq` 가 이미 그 사건으로 올랐다). 같은 id 면 아무 일 없음.
    pub(super) fn raise(&self, slot: &Slot, kind: &'static str, attempt_id: Option<&str>, detail: Option<&str>) {
        let r = &slot.run;
        let task_title = attempt_id
            .and_then(|a| r.attempts.iter().find(|x| x.id == a))
            .and_then(|a| r.task(&a.task_id))
            .map(|t| clip(&t.title, 120));
        let n = Notice {
            id: format!("{}#{}:{kind}:{}", r.id, r.seq, attempt_id.unwrap_or("-")),
            run_id: r.id.clone(),
            run_name: clip(&r.name, 80),
            kind,
            attempt_id: attempt_id.map(str::to_string),
            task_title,
            detail: detail.map(str::to_string),
            at: self.now(),
        };
        let body = serde_json::to_value(&n).unwrap_or(Value::Null);
        if self.notices.push(n) {
            (self.emit)(EVT_NOTICE, body);
        }
    }

    /// 미확인 사건(op `orchestration_notices`) — 창이 붙으면 주 창이 꺼내 보인다.
    pub(crate) fn notices_view(&self) -> Value {
        json!(self.notices.list())
    }

    /// 확인된 최근 사건(op `orchestration_notices{recent: true}`) — F5 · 재부착 뒤 주 창이 알림 센터에만 다시 적는다(토스트 없이).
    pub(crate) fn notices_recent_view(&self) -> Value {
        json!(self.notices.recent())
    }

    /// 확인(op `orchestration_notices_ack`) — 뺀 수.
    pub(crate) fn notices_ack(&self, ids: &[String]) -> usize {
        self.notices.ack(ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice(id: &str, kind: &'static str) -> Notice {
        Notice { id: id.into(), run_id: "run-x".into(), run_name: "앨범".into(), kind, attempt_id: None, task_title: None, detail: None, at: 1 }
    }

    /// 실기 b 고침 A — 확인된 사건은 미확인 큐에서 빠지고 최근 목록에 남는다(다시 뜬 주 창의 알림 센터) · 상한 · 확인 안 된 것은 남지 않는다.
    #[test]
    fn acked_notices_stay_recent() {
        let q = Notices::default();
        assert!(q.push(notice("a", "wake-limit")));
        assert!(q.push(notice("b", "worker-blocked")));
        assert!(q.recent().is_empty(), "확인 전에는 최근 목록에 없다");
        assert_eq!(q.ack(&["a".into(), "zz".into()]), 1);
        assert_eq!(q.list().iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["b"]);
        assert_eq!(q.recent().iter().map(|n| n.kind).collect::<Vec<_>>(), ["wake-limit"]);
        for i in 0..RECENT_MAX + 5 {
            let id = format!("n{i}");
            q.push(notice(&id, "run-ended"));
            q.ack(&[id]);
        }
        let r = q.recent();
        assert_eq!(r.len(), RECENT_MAX);
        assert_eq!(r.last().unwrap().id, format!("n{}", RECENT_MAX + 4), "새것이 뒤 · 오래된 것부터 버린다");
    }
}
