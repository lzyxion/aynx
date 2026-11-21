//! 앨범 역할·수락 판정의 공통 자료형과 계산.
use serde_json::{json, Value};
use super::model::*;
use super::turn::Grade;

/// 한 턴에 붙일 역할 — 지금 앨범 구성의 값(CLI · 종류는 첫 턴에 Attempt 사본으로 고정된다). `Debug` 에 지침 본문을 싣지 않는다(길이만).
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct TurnRole {
    pub id: String,
    pub name: String,
    pub kind: AttemptKind,
    pub cli: WorkerCli,
    pub grade: Grade,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub allowed_commands: Vec<String>,
    pub instructions: Option<String>,
}

impl std::fmt::Debug for TurnRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TurnRole")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("cli", &self.cli)
            .field("grade", &self.grade)
            .field("model", &self.model)
            .field("effort", &self.effort)
            .field("allowed_commands", &self.allowed_commands.len())
            .field("instructions_len", &self.instructions.as_ref().map_or(0, String::len))
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Unmet {
    pub role: String,
    pub role_name: Option<String>,
    pub need: u32,
    pub have: u32,
    pub last: &'static str,
}

impl Unmet {
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "rule": "judgment",
            "role": self.role,
            "roleName": self.role_name,
            "need": self.need,
            "have": self.have,
            "last": self.last,
        })
    }
}

fn judgments_of<'r>(run: &'r Run, task: &Task, role: &str) -> Vec<&'r ReviewReport> {
    let Some(cur) = super::review::current_report(run, task) else { return Vec::new() };
    run.review_reports
        .iter()
        .filter(|r| r.task_id == task.id && r.report_id == cur && r.state == ReviewReportState::Current)
        .filter(|r| {
            run.attempts
                .iter()
                .find(|a| a.id == r.attempt_id)
                .and_then(|a| a.role_id.as_deref())
                == Some(role)
        })
        .collect()
}

pub(crate) fn accept_rules_for(
    run: &Run, task: &Task, rules: &crate::orchestration::config::AcceptRules,
    name: impl Fn(&str) -> Option<String>,
) -> (Vec<Unmet>, Vec<String>) {
    let mut unmet = Vec::new();
    let mut judgments = Vec::new();
    for q in &rules.require {
        let js = judgments_of(run, task, &q.role);
        let passes: Vec<&ReviewReport> = js.iter().copied().filter(|r| r.verdict == ReviewVerdict::Pass).collect();
        let last = js.last().map_or("none", |r| r.verdict.as_str());
        let have = passes.len() as u32;
        if have >= q.passes && last == "pass" {
            judgments.extend(passes.iter().map(|r| r.review_id.clone()));
        } else {
            unmet.push(Unmet {
                role: q.role.clone(),
                role_name: name(&q.role),
                need: q.passes,
                have,
                last,
            });
        }
    }
    (unmet, judgments)
}

pub(crate) fn role_history(run: &Run, task: &Task) -> Value {
    Value::Array(
        run.attempts
            .iter()
            .filter(|a| a.task_id == task.id)
            .map(|a| {
                let outcome = if let Some(r) = run.review_reports.iter().find(|r| r.attempt_id == a.id) {
                    r.verdict.as_str().to_string()
                } else if let Some(r) = run.report_of(&a.id) {
                    r.outcome.as_str().to_string()
                } else if a.blocked.is_some() {
                    "blocked".to_string()
                } else {
                    a.state.as_str().to_string()
                };
                json!({
                    "attemptId": a.id,
                    "role": a.role_id,
                    "roleName": a.role_name,
                    "kind": a.kind.map(AttemptKind::as_str).unwrap_or(if a.is_reviewer() { "judge" } else { "write" }),
                    "outcome": outcome,
                })
            })
            .collect(),
    )
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AcceptGate {
    pub judgments: Vec<String>,
    /// 사람 수락이 넘은 규칙.
    pub waived: Vec<Waiver>,
    /// 사람이 무효화할 활성 판정이 있다.
    pub drop_active: bool,
}
