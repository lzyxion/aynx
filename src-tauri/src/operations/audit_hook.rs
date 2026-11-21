//! 감사 연결 — 상태 이름 · 대상별 요약 [`audit_target_results`] · executor 의 감사 출구 [`AuditSink`] · 대상 라벨 [`build_target_labels`].
//!
//! 불변식: 감사는 **순수 부가 기록**이다(실행·상태기계를 바꾸지 않고, 실패해도 실행을 막지 않는다). 출력 꼬리는
//! 설정이 켜져 있고 **지금 AI 읽기 공유 중인** 대상만 싣는다.

use std::collections::{HashMap, HashSet};
use std::sync::mpsc;

use super::*;

/// 직렬화형과 한 진실을 유지하려고 serde 를 거친다(따로 match 를 두면 어긋날 수 있다).
pub(super) fn op_state_name(state: OperationState) -> String {
    serde_json::to_value(state)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

pub(super) fn target_state_name(state: TargetState) -> String {
    serde_json::to_value(state)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// 저장소에 칸이 없으면 `pending` — 감사가 실행을 방해하지 않는 쪽으로 관대하게 읽는다. 출력 꼬리는 `excerpt_for` 에 든 대상만 싣는다
/// (MCP `get_operation_results` 가 `redacted` 로 가리는 대상은 감사 파일에도 남기지 않는다 · docs/log/2026-09-28-run-history.md).
pub(super) fn audit_target_results(
    results: &ResultStore,
    operation_id: &str,
    targets: &[String],
    excerpt_for: &HashSet<String>,
) -> Vec<crate::audit::AuditTargetResult> {
    let guard = results.lock().ok();
    let per = guard.as_ref().and_then(|m| m.get(operation_id));
    targets
        .iter()
        .map(|stream_id| match per.and_then(|p| p.get(stream_id)) {
            Some(r) => {
                let excerpt = excerpt_for.contains(stream_id);
                crate::audit::AuditTargetResult {
                    stream_id: stream_id.clone(),
                    state: target_state_name(r.state),
                    exit_code: r.exit_code,
                    started_at: r.started_at,
                    ended_at: r.ended_at,
                    stdout_tail: if excerpt {
                        crate::audit::tail_excerpt(&r.stdout)
                    } else {
                        None
                    },
                    stderr_tail: if excerpt {
                        crate::audit::tail_excerpt(&r.stderr)
                    } else {
                        None
                    },
                }
            }
            None => crate::audit::AuditTargetResult {
                stream_id: stream_id.clone(),
                state: target_state_name(TargetState::Pending),
                ..Default::default()
            },
        })
        .collect()
}

/// `excerpt` 는 승인 시점의 정책 그대로(끝날 때 설정 파일을 다시 읽지 않는다). `ctx` 는 끝나는 순간 대상이 AI 읽기 공유 중인지 다시 보는 거울이다.
pub(crate) struct AuditSink {
    pub tx: Option<mpsc::Sender<crate::audit::AuditRecord>>,
    pub ctx: Option<crate::context::Store>,
    pub excerpt: bool,
}

impl AuditSink {
    /// "읽을 수 있다" 는 MCP 읽기 도구와 같은 판정([`crate::context::ai_readable`])이고, 권한은 끝나는 순간의 `delegation.toml` 을 본다.
    pub(super) fn excerpt_targets(&self, targets: &[String]) -> HashSet<String> {
        if !self.excerpt {
            return HashSet::new();
        }
        let Some(ctx) = &self.ctx else {
            return HashSet::new();
        };
        // 파일 읽기는 컨텍스트 잠금 **앞**에서 한 번.
        let delegation = crate::delegation::Delegation::load_default();
        ctx.lock()
            .map(|m| {
                excerpt_targets_in(&m, &delegation, targets)
            })
            .unwrap_or_default()
    }
}

pub(super) fn excerpt_targets_in(
    ctx: &HashMap<String, crate::context::SessionContext>,
    delegation: &crate::delegation::Delegation,
    targets: &[String],
) -> HashSet<String> {
    targets
        .iter()
        .filter(|id| {
            ctx.get(*id)
                .is_some_and(|c| crate::context::ai_readable(c, delegation))
        })
        .cloned()
        .collect()
}

/// 대상 streamId 들을 거울에서 사람이 읽는 스냅샷으로 푼다 — 거울에 없는 대상은 빠진다(id 만 `targets` 에 남는다).
/// host/account(SSH user@host)는 거울에 안정 host 키가 없어 담지 않는다(지어내지 않는다).
pub(super) fn build_target_labels(
    ctx: &HashMap<String, crate::context::SessionContext>,
    targets: &[String],
) -> Vec<crate::audit::AuditTargetLabel> {
    targets
        .iter()
        .filter_map(|id| {
            ctx.get(id).map(|c| crate::audit::AuditTargetLabel {
                id: id.clone(),
                label: c.label.clone(),
                code: c.code.clone(),
            })
        })
        .collect()
}
