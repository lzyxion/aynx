//! 사전 정책 자동 승인의 시계 — 세션 서버가 2초마다 훑는다(GUI 가 없어도 돈다).
//!
//! - 같은 작업안은 한 번만 시도한다(게이트가 거부해도 다시 하지 않는다) · 사람이 검토 카드를 열어 둔 작업안은 건드리지 않는다.
//! - 정책 밖은 시도하지 않는다 — 예외: 대상이 전부 'YOLO' 면 명령을 보지 않는다(대상 수 상한은 본다 · DB 작업안 포함).
//! - 승인은 `approve_in(…, "auto")` 하나로 간다 — 만료 · 상한 · 정책 · 대상별 권한 재검사 · 빈도 · 감사는 그 안이고 이 파일은 판정을 새로 만들지 않는다.
//! - 이 길은 파이프의 승인 프레임이 아니다 — 승인 등급 프레임은 GUI 의 `approve_operation` 하나(시험 `approve_frames_come_from_one_place`),
//!   서버 안 `approve_in` 호출은 `ops_approve` 와 이 파일(`"auto"` 만) 둘뿐(시험 `auto_approve_has_one_entry`) · MCP 에서 오는 길은 없다.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde_json::json;

use super::approval::OpsPlane;
use super::*;

pub(crate) const SWEEP_EVERY: std::time::Duration = std::time::Duration::from_secs(2);

/// `{operationId, reason}` — GUI 가 같은 이름으로 창에 중계한다.
pub(crate) const EVT_AUTO_REFUSED: &str = "operation-auto-refused";

/// 서버 메모리뿐 — 작업안도 서버와 함께 사라지므로 영속하지 않는다.
#[derive(Default)]
pub(crate) struct AutoState {
    attempted: Mutex<HashSet<String>>,
    reviewing: Mutex<HashSet<String>>,
    refusals: Mutex<HashMap<String, String>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AutoState {
    pub(crate) fn set_reviewing(&self, ids: impl IntoIterator<Item = String>) {
        *lock(&self.reviewing) = ids.into_iter().collect();
    }

    pub(crate) fn clear_reviewing(&self) {
        lock(&self.reviewing).clear();
    }

    pub(crate) fn refusals(&self) -> HashMap<String, String> {
        lock(&self.refusals).clone()
    }
}

/// 모두 승인 판정의 재료 — "시도할까" · "카드에 이유를 쓸까" 에만 쓴다. 권위 판정은 승인 몸(`approve_in_with`)이 자기 것을 따로 뜬다.
#[derive(Default)]
pub(crate) struct AllView {
    ctx: HashMap<String, crate::context::SessionContext>,
    delegation: crate::delegation::Delegation,
    db: Option<super::db_exec::DbFacts>,
}

impl AllView {
    /// DB 사실은 대기 중 DB 작업안이 있을 때만 읽는다(파일 I/O · 블로킹).
    pub(crate) fn load(p: &OpsPlane, pending: &[Operation], delegation: crate::delegation::Delegation) -> AllView {
        let ctx = p
            .env
            .ctx
            .lock()
            .map(|m| crate::context::permission_snapshot(&m))
            .unwrap_or_default();
        let db = pending
            .iter()
            .any(|o| o.state == OperationState::AwaitingApproval && o.db.is_some())
            .then(|| p.db.facts());
        AllView { ctx, delegation, db }
    }

    pub(crate) fn plan(&self, op: &Operation) -> bool {
        approve_all_plan(&op.targets, op.db.as_ref(), &self.ctx, &self.delegation, self.db.as_ref())
    }

    fn host_auto(&self, id: &str) -> bool {
        match crate::routing::delegated_alias_of(id) {
            Some(alias) => self.delegation.auto_execute_granted(alias),
            None => self.ctx.get(id).is_some_and(|c| crate::context::ai_auto_executable(c, &self.delegation)),
        }
    }
}

pub(crate) fn candidates(
    pending: &[Operation],
    attempted: &HashSet<String>,
    reviewing: &HashSet<String>,
    prefs: &crate::settings::AutomationPrefs,
    approve_all: impl Fn(&Operation) -> bool,
) -> Vec<String> {
    if !prefs.auto_approve {
        return Vec::new();
    }
    pending
        .iter()
        .filter(|op| op.state == OperationState::AwaitingApproval)
        .filter(|op| !attempted.contains(&op.operation_id) && !reviewing.contains(&op.operation_id))
        .filter(|op| {
            // 모두 승인은 명령을 가리지 않되 대상 수 상한은 여기서도 본다 — 넘으면 시도하지 않고 카드가 `max_targets` 를 말한다.
            (approve_all(op) && op.targets.len() <= prefs.max_targets as usize)
                // DB 작업안은 그 밖에는 자동 승인 대상이 아니다(승인 몸도 `auto` 를 거부한다).
                || (op.db.is_none()
                    && !op.targets.iter().any(|t| is_db_target(t))
                    && crate::policy::should_auto_approve(&op.command, op.targets.len(), prefs))
        })
        .map(|op| op.operation_id.clone())
        .collect()
}

/// 다음 훑기가 시도할 집합 — 검토 카드가 그리지 않는다(`autoPending`). 읽기만 하고 승인하지 않는다.
pub(crate) fn auto_pending(
    p: &OpsPlane,
    pending: &[Operation],
    prefs: &crate::settings::AutomationPrefs,
    all: &AllView,
) -> Vec<String> {
    let attempted = lock(&p.auto.attempted);
    let reviewing = lock(&p.auto.reviewing);
    candidates(pending, &attempted, &reviewing, prefs, |op| all.plan(op))
}

/// 대기가 왜 자동으로 넘어가지 않는가 — 정책 밖은 훑기가 시도하지 않아 거부 사유가 생기지 않으므로 여기서 말한다.
/// 판정은 새로 만들지 않고 설정의 자동 승인 시험 칸과 같은 `explain` 을 돌린다(승인하지 않는다).
pub(crate) fn why_not_auto(
    op: &Operation,
    prefs: &crate::settings::AutomationPrefs,
    host_auto: bool,
    approve_all: bool,
) -> Option<crate::policy::explain::Reason> {
    use crate::policy::explain::{explain, Reason, Verdict};
    let over_cap = || {
        (op.targets.len() > prefs.max_targets as usize).then(|| {
            Reason::new("max_targets")
                .with("n", op.targets.len().to_string())
                .with("max", prefs.max_targets.to_string())
        })
    };
    if approve_all {
        if !prefs.auto_approve {
            return Some(Reason::new("auto_off"));
        }
        return over_cap();
    }
    if op.db.is_some() || op.targets.iter().any(|t| is_db_target(t)) {
        return None;
    }
    if !prefs.auto_approve {
        return host_auto.then(|| Reason::new("auto_off"));
    }
    let t = explain(&op.command, prefs);
    if t.verdict != Verdict::Auto {
        return t.reasons.into_iter().next();
    }
    over_cap()
}

pub(crate) fn auto_why(
    p: &OpsPlane,
    pending: &[Operation],
    prefs: &crate::settings::AutomationPrefs,
    all: &AllView,
) -> std::collections::BTreeMap<String, crate::policy::explain::Reason> {
    let soon: HashSet<String> = auto_pending(p, pending, prefs, all).into_iter().collect();
    let refused = lock(&p.auto.refusals).clone();
    let reviewing = lock(&p.auto.reviewing).clone();
    pending
        .iter()
        .filter(|op| op.state == OperationState::AwaitingApproval)
        .filter(|op| !soon.contains(&op.operation_id) && !refused.contains_key(&op.operation_id) && !reviewing.contains(&op.operation_id))
        .filter_map(|op| {
            let auto = op.targets.iter().any(|t| all.host_auto(t));
            why_not_auto(op, prefs, auto, all.plan(op)).map(|r| (op.operation_id.clone(), r))
        })
        .collect()
}

/// 설정 · 위임 파일을 읽으므로 블로킹이다 — 블로킹 풀에서 부른다.
pub(crate) fn sweep(p: &OpsPlane) -> usize {
    let prefs = crate::settings::automation_prefs();
    if !prefs.auto_approve {
        return 0;
    }
    sweep_with(p, &prefs, crate::delegation::Delegation::load_default, |id| {
        super::approval::approve_in(p, id.to_string(), Some("auto".to_string()))
    })
}

pub(crate) fn sweep_with(
    p: &OpsPlane,
    prefs: &crate::settings::AutomationPrefs,
    delegation: impl FnOnce() -> crate::delegation::Delegation,
    mut approve: impl FnMut(&str) -> Result<Operation, String>,
) -> usize {
    // 목록 읽기(`list_in`)가 만료를 먼저 처리한다 — 만료된 것은 후보가 되지 않는다.
    let Ok(list) = super::commands::list_in(p) else {
        return 0;
    };
    let pending_ids: HashSet<String> = list.pending.iter().map(|o| o.operation_id.clone()).collect();
    let all = if list.pending.is_empty() { AllView::default() } else { AllView::load(p, &list.pending, delegation()) };
    let picked = {
        let attempted = lock(&p.auto.attempted);
        let reviewing = lock(&p.auto.reviewing);
        candidates(&list.pending, &attempted, &reviewing, prefs, |op| all.plan(op))
    };
    let mut approved = 0;
    for id in picked {
        // 훑는 사이 사람이 카드를 열었을 수 있다 — 바로 앞에서 한 번 더 본다.
        if lock(&p.auto.reviewing).contains(&id) {
            continue;
        }
        if !lock(&p.auto.attempted).insert(id.clone()) {
            continue;
        }
        match approve(&id) {
            Ok(_) => approved += 1,
            Err(reason) => {
                lock(&p.auto.refusals).insert(id.clone(), reason.clone());
                p.env.emit(EVT_AUTO_REFUSED, json!({ "operationId": id, "reason": reason }));
            }
        }
    }
    lock(&p.auto.attempted).retain(|id| pending_ids.contains(id));
    lock(&p.auto.refusals).retain(|id, _| pending_ids.contains(id));
    approved
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::operations::approval::approve_in_with;
    use std::sync::Arc;

    fn plane(audit_dir: Option<std::path::PathBuf>) -> OpsPlane {
        OpsPlane {
            env: OpEnv {
                emit: Arc::new(|_: &str, _: serde_json::Value| {}),
                ctx: crate::context::Store::default(),
                routing: crate::routing::RoutingTable::default(),
            },
            ops: OperationStore::default(),
            results: ResultStore::default(),
            cancels: Default::default(),
            rate: Arc::new(Default::default()),
            budget: ExecBudget::default().0,
            audit: crate::audit::Audit::in_dir(audit_dir),
            auto: AutoState::default(),
            unseen: Default::default(),
            db: crate::operations::db_exec::live_db(),
        }
    }

    fn awaiting(p: &OpsPlane, id: &str, command: &str, alias: &str, expires_at: Option<i64>) {
        let mut map = p.ops.lock().unwrap();
        create_plan(
            &mut map,
            id.into(),
            command.into(),
            vec![crate::routing::delegated_stream_id(alias)],
            None,
            None,
            "sequential".into(),
            "canary".into(),
            1,
            30,
            None,
            None,
            now_ms(),
            None,
        );
        request(&mut map, id, now_ms(), 0).unwrap();
        if let Some(e) = expires_at {
            map.get_mut(id).unwrap().expires_at = Some(e);
        }
    }

    fn prefs() -> crate::settings::AutomationPrefs {
        crate::settings::AutomationPrefs {
            auto_approve: true,
            allow_patterns: vec!["uptime".into()],
            auto_max_per_window: 2,
            auto_window_secs: 3600,
            ..Default::default()
        }
    }

    fn delegation() -> crate::delegation::Delegation {
        crate::delegation::Delegation::parse(
            "[[target]]\nalias = \"granted\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\npropose = true\nauto_execute = true\n\n[[target]]\nalias = \"readonly\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\n",
        )
        .unwrap()
    }

    fn view(p: &OpsPlane) -> AllView {
        let pending: Vec<Operation> = p.ops.lock().unwrap().values().cloned().collect();
        AllView::load(p, &pending, delegation())
    }

    fn state_of(p: &OpsPlane, id: &str) -> OperationState {
        p.ops.lock().unwrap()[id].state
    }

    #[test]
    fn candidates_follow_the_frontend_rules() {
        let p = plane(None);
        awaiting(&p, "op-a", "uptime", "granted", None);
        awaiting(&p, "op-b", "uptime", "granted", None);
        awaiting(&p, "op-c", "rm -rf /tmp/x", "granted", None);
        awaiting(&p, "op-d", "uptime | cat", "granted", None);
        let pending: Vec<Operation> = p.ops.lock().unwrap().values().cloned().collect();
        let mut got = candidates(&pending, &HashSet::new(), &HashSet::from(["op-b".to_string()]), &prefs(), |_| false);
        got.sort();
        assert_eq!(got, vec!["op-a".to_string()]);
        assert!(candidates(&pending, &HashSet::from(["op-a".to_string()]), &HashSet::new(), &prefs(), |_| false)
            .iter()
            .all(|id| id == "op-b"));
        let off = crate::settings::AutomationPrefs { auto_approve: false, ..prefs() };
        assert!(candidates(&pending, &HashSet::new(), &HashSet::new(), &off, |_| false).is_empty());
    }

    #[tokio::test]
    async fn why_not_auto_explains_what_the_sweep_never_tries() {
        let p = plane(None);
        awaiting(&p, "op-a1", "uptime", "granted", None);
        awaiting(&p, "op-a1-ro", "uptime", "readonly", None);
        let pending = || -> Vec<Operation> { p.ops.lock().unwrap().values().filter(|o| o.state == OperationState::AwaitingApproval).cloned().collect() };
        let off = crate::settings::AutomationPrefs { auto_approve: false, ..prefs() };
        assert_eq!(sweep_with(&p, &off, delegation, |_| panic!("자동 끔이면 시도하지 않는다")), 0);
        assert!(auto_pending(&p, &pending(), &off, &view(&p)).is_empty());
        assert!(p.auto.refusals().is_empty(), "시도하지 않았으니 거부 사유도 없다 — 예전 카드가 아무 말도 못 한 까닭");
        let why = auto_why(&p, &pending(), &off, &view(&p));
        assert_eq!(why.get("op-a1").map(|r| r.code), Some("auto_off"));
        assert!(!why.contains_key("op-a1-ro"), "자동 승인 실행이 아닌 호스트에는 말하지 않는다");

        awaiting(&p, "op-a2", "uptime | cat", "granted", None);
        sweep_with(&p, &prefs(), delegation, |id| approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation));
        assert!(!p.auto.refusals().contains_key("op-a2"), "정책 밖은 시도하지 않는다 — 거부 사유 없음");
        let why = auto_why(&p, &pending(), &prefs(), &view(&p));
        assert_eq!(why.get("op-a2").map(|r| r.code), Some("split_pipe"));
        let pipes = crate::settings::AutomationPrefs { allow_pipes: true, ..prefs() };
        let why = auto_why(&p, &pending(), &pipes, &view(&p));
        assert_eq!(why.get("op-a2").map(|r| r.code), Some("pipe_stage"));
        assert_eq!(why.get("op-a2").map(|r| r.args["segment"].as_str()), Some("cat"));
        assert!(!why.contains_key("op-a1-ro"), "거부 사유가 있는 것은 그 사유가 말한다(중복 없음)");
        assert!(p.auto.refusals().contains_key("op-a1-ro"));
    }

    #[tokio::test]
    async fn auto_pending_hides_only_until_the_sweep_decides() {
        let p = plane(None);
        awaiting(&p, "op-ok", "uptime", "granted", None);
        awaiting(&p, "op-noperm", "uptime", "readonly", None);
        awaiting(&p, "op-manual", "rm -rf /tmp/x", "granted", None);
        let pending = || -> Vec<Operation> { p.ops.lock().unwrap().values().filter(|o| o.state == OperationState::AwaitingApproval).cloned().collect() };
        let mut before = auto_pending(&p, &pending(), &prefs(), &view(&p));
        before.sort();
        assert_eq!(before, vec!["op-noperm".to_string(), "op-ok".to_string()], "정책 밖(op-manual)은 처음부터 카드에");
        let off = crate::settings::AutomationPrefs { auto_approve: false, ..prefs() };
        assert!(auto_pending(&p, &pending(), &off, &view(&p)).is_empty(), "자동 끔이면 숨기지 않는다");
        p.auto.set_reviewing(["op-ok".to_string()]);
        assert_eq!(auto_pending(&p, &pending(), &prefs(), &view(&p)), vec!["op-noperm".to_string()], "사람이 보는 것은 숨기지 않는다");
        p.auto.clear_reviewing();

        sweep_with(&p, &prefs(), delegation, |id| approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation));
        assert!(auto_pending(&p, &pending(), &prefs(), &view(&p)).is_empty(), "훑기가 정하면 더는 숨기지 않는다");
        assert!(pending().iter().any(|o| o.operation_id == "op-noperm"), "거부된 것은 대기에 남아 카드에 선다");
        assert!(!pending().iter().any(|o| o.operation_id == "op-ok"), "승인된 것은 대기를 떠났다 — 카드 없음");
    }

    #[tokio::test]
    async fn server_sweep_keeps_every_gate() {
        let dir = std::env::temp_dir().join(format!("ss4-auto-audit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let p = plane(Some(dir.clone()));
        awaiting(&p, "op-ok", "uptime", "granted", None);
        awaiting(&p, "op-noperm", "uptime", "readonly", None);
        awaiting(&p, "op-review", "uptime", "granted", None);
        awaiting(&p, "op-old", "uptime", "granted", Some(1));
        p.auto.set_reviewing(["op-review".to_string()]);
        let mut calls: Vec<String> = Vec::new();
        let n = sweep_with(&p, &prefs(), delegation, |id| {
            calls.push(id.to_string());
            approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation)
        });
        assert_eq!(n, 1);
        // 실행기가 곧바로 상태를 넘길 수 있어(대상 접속 실패 등) "대기를 떠났다" 로 본다.
        assert_ne!(state_of(&p, "op-ok"), OperationState::AwaitingApproval);
        assert_eq!(p.ops.lock().unwrap()["op-ok"].approval_method.as_deref(), Some("auto"));
        assert_eq!(state_of(&p, "op-noperm"), OperationState::AwaitingApproval, "권한 재검사 — 사람 승인 대기로 남는다");
        assert!(p.auto.refusals().contains_key("op-noperm"));
        assert_eq!(state_of(&p, "op-review"), OperationState::AwaitingApproval, "검토 중인 카드는 건드리지 않는다");
        assert_eq!(state_of(&p, "op-old"), OperationState::Expired, "만료가 먼저다");
        assert!(!calls.contains(&"op-review".to_string()) && !calls.contains(&"op-old".to_string()));

        p.auto.clear_reviewing();
        let mut again: Vec<String> = Vec::new();
        sweep_with(&p, &prefs(), delegation, |id| {
            again.push(id.to_string());
            approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation)
        });
        assert_eq!(again, vec!["op-review".to_string()]);
        assert_ne!(state_of(&p, "op-review"), OperationState::AwaitingApproval);
        assert_eq!(p.ops.lock().unwrap()["op-review"].approval_method.as_deref(), Some("auto"));

        awaiting(&p, "op-third", "uptime", "granted", None);
        sweep_with(&p, &prefs(), delegation, |id| approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation));
        assert_eq!(state_of(&p, "op-third"), OperationState::AwaitingApproval);
        assert!(p.auto.refusals()["op-third"].contains('2'), "{:?}", p.auto.refusals());

        // 감사 로거는 별도 스레드다 — 잠깐 기다린다.
        let mut text = String::new();
        for _ in 0..50 {
            text = std::fs::read_dir(&dir)
                .map(|rd| {
                    rd.flatten()
                        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();
            if text.matches("\"approval_method\":\"auto\"").count() >= 2 || text.matches("\"approvalMethod\":\"auto\"").count() >= 2 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        assert!(
            text.matches("\"approval_method\":\"auto\"").count() + text.matches("\"approvalMethod\":\"auto\"").count() >= 2,
            "감사: {text}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── 모두 승인 ──────────────────────────────────────────

    fn yolo_delegation() -> crate::delegation::Delegation {
        let block = |alias: &str, all: bool| {
            format!(
                "[[target]]\nalias = \"{alias}\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\npropose = true\nauto_execute = true\napprove_all = {all}\n\n"
            )
        };
        crate::delegation::Delegation::parse(&format!("{}{}{}", block("yolo", true), block("yolo2", true), block("granted", false))).unwrap()
    }

    fn awaiting_on(p: &OpsPlane, id: &str, command: &str, aliases: &[&str]) {
        let mut map = p.ops.lock().unwrap();
        create_plan(
            &mut map,
            id.into(),
            command.into(),
            aliases.iter().map(|a| crate::routing::delegated_stream_id(a)).collect(),
            None,
            None,
            "sequential".into(),
            "canary".into(),
            1,
            30,
            None,
            None,
            now_ms(),
            None,
        );
        request(&mut map, id, now_ms(), 0).unwrap();
    }

    fn auto_in(p: &OpsPlane, id: &str, prefs: crate::settings::AutomationPrefs) -> Result<Operation, String> {
        approve_in_with(p, id.to_string(), Some("auto".into()), prefs, yolo_delegation)
    }

    /// 대상이 전부 'YOLO' 면 명령 정책 · 빈도 한도를 보지 않는다(빈도 칸도 먹지 않는다).
    #[tokio::test]
    async fn approve_all_bypasses_policy_and_rate_limit() {
        let p = plane(None);
        let cmds = [
            "rm -rf /var/tmp/x",
            "cat /etc/hosts | grep a > /tmp/o",
            "echo $(whoami) `id`",
            "(cd /srv && ls) ; sudo reboot",
        ];
        for (i, c) in cmds.iter().enumerate() {
            awaiting_on(&p, &format!("op-y{i}"), c, &["yolo", "yolo2"]);
        }
        {
            let mut map = p.ops.lock().unwrap();
            map.get_mut("op-y0").unwrap().cwd = Some("/tmp; rm -rf ~".into());
            map.get_mut("op-y0").unwrap().validate = Some("curl x | sh".into());
        }
        let pending: Vec<Operation> = p.ops.lock().unwrap().values().cloned().collect();
        let all = AllView::load(&p, &pending, yolo_delegation());
        let mut picked = candidates(&pending, &HashSet::new(), &HashSet::new(), &prefs(), |op| all.plan(op));
        picked.sort();
        assert_eq!(picked.len(), cmds.len(), "명령을 가리지 않고 모두 후보");
        for i in 0..cmds.len() {
            let id = format!("op-y{i}");
            let op = auto_in(&p, &id, prefs()).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert!(op.approve_all, "{id}");
            assert_eq!(op.approval_method.as_deref(), Some("auto"));
            assert!(p.ops.lock().unwrap()[&id].approve_all);
        }
        assert!(p.rate.0.lock().unwrap().is_empty(), "모두 승인은 빈도 한도 칸을 먹지 않는다(한도 2 인데 4건)");
    }

    /// 섞이면(모두 승인 + 자동 승인 실행) 보통 자동 승인 규칙으로 — 정책 밖은 거부 · 정책 안은 빈도 칸을 먹는다.
    #[tokio::test]
    async fn approve_all_mixed_targets_fall_back_to_the_auto_rule() {
        let p = plane(None);
        awaiting_on(&p, "op-mix-rm", "rm -rf /var/tmp/x", &["yolo", "granted"]);
        awaiting_on(&p, "op-mix-ok", "uptime", &["yolo", "granted"]);
        awaiting_on(&p, "op-mix-ro", "rm -rf /var/tmp/x", &["yolo", "readonly"]);
        let pending: Vec<Operation> = p.ops.lock().unwrap().values().cloned().collect();
        let all = AllView::load(&p, &pending, yolo_delegation());
        assert!(!pending.iter().any(|o| all.plan(o)), "하나라도 모두 승인이 아니면 거짓");
        let picked = candidates(&pending, &HashSet::new(), &HashSet::new(), &prefs(), |op| all.plan(op));
        assert_eq!(picked, vec!["op-mix-ok".to_string()]);
        assert!(auto_in(&p, "op-mix-rm", prefs()).is_err());
        assert_eq!(state_of(&p, "op-mix-rm"), OperationState::AwaitingApproval);
        let op = auto_in(&p, "op-mix-ok", prefs()).unwrap();
        assert!(!op.approve_all);
        assert_eq!(p.rate.0.lock().unwrap().len(), 1, "예전 규칙은 빈도 칸을 먹는다");
        assert!(auto_in(&p, "op-mix-ro", prefs()).is_err());
    }

    /// 전체 스위치(`[automation] auto_approve`)가 꺼지면 모두 승인 대상도 사람을 기다린다.
    #[tokio::test]
    async fn approve_all_respects_the_kill_switch() {
        let p = plane(None);
        awaiting_on(&p, "op-off", "rm -rf /var/tmp/x", &["yolo"]);
        let off = crate::settings::AutomationPrefs { auto_approve: false, ..prefs() };
        assert_eq!(sweep_with(&p, &off, yolo_delegation, |_| panic!("자동 끔이면 시도하지 않는다")), 0);
        let e = auto_in(&p, "op-off", off.clone()).unwrap_err();
        assert!(e.contains("자동 승인이 꺼져") || e.contains("Auto-approval is off"), "{e}");
        assert_eq!(state_of(&p, "op-off"), OperationState::AwaitingApproval);
        let pending: Vec<Operation> = p.ops.lock().unwrap().values().cloned().collect();
        let all = AllView::load(&p, &pending, yolo_delegation());
        assert_eq!(auto_why(&p, &pending, &off, &all).get("op-off").map(|r| r.code), Some("auto_off"));
        assert_eq!(sweep_with(&p, &prefs(), yolo_delegation, |id| auto_in(&p, id, prefs())), 1);
        assert!(p.ops.lock().unwrap()["op-off"].approve_all);
    }

    /// caps(대상 수 · 동시 실행) · 만료는 모두 승인에도 걸린다.
    #[tokio::test]
    async fn approve_all_still_honors_caps_and_expiry() {
        let p = plane(None);
        awaiting_on(&p, "op-cap", "uptime", &["yolo", "yolo2"]);
        let tight = crate::settings::AutomationPrefs { max_targets: 1, ..prefs() };
        let e = auto_in(&p, "op-cap", tight.clone()).unwrap_err();
        assert!(e.contains('2') && e.contains('1'), "{e}");
        assert_eq!(state_of(&p, "op-cap"), OperationState::AwaitingApproval);
        let pending: Vec<Operation> = p.ops.lock().unwrap().values().cloned().collect();
        let all = AllView::load(&p, &pending, yolo_delegation());
        assert_eq!(auto_why(&p, &pending, &tight, &all).get("op-cap").map(|r| r.code), Some("max_targets"));
        awaiting_on(&p, "op-conc", "uptime", &["yolo"]);
        p.ops.lock().unwrap().get_mut("op-conc").unwrap().concurrency = 99;
        let narrow = crate::settings::AutomationPrefs { max_concurrency: 2, ..prefs() };
        assert!(auto_in(&p, "op-conc", narrow).is_err(), "동시 실행 상한");
        awaiting_on(&p, "op-old-y", "uptime", &["yolo"]);
        p.ops.lock().unwrap().get_mut("op-old-y").unwrap().expires_at = Some(1);
        assert!(auto_in(&p, "op-old-y", prefs()).is_err());
        assert_eq!(state_of(&p, "op-old-y"), OperationState::Expired, "만료가 먼저다");
    }

    /// 창 타일 대상은 호스트 별칭의 단계를 본다 — 로컬 타일 · 별칭 없는 원격 · 거울에 없는 id 는 모두 승인이 아니다.
    #[test]
    fn approve_all_plan_reads_window_tiles_by_host() {
        let d = yolo_delegation();
        let tile = |kind: &str, alias: Option<&str>| crate::context::SessionContext {
            label: alias.unwrap_or("adhoc").into(),
            kind: kind.into(),
            host_alias: alias.map(str::to_string),
            ..Default::default()
        };
        let mut ctx = HashMap::new();
        ctx.insert("w-yolo".to_string(), tile("ssh", Some("YOLO")));
        ctx.insert("w-auto".to_string(), tile("ssh", Some("granted")));
        ctx.insert("w-local".to_string(), tile("local", None));
        ctx.insert("w-adhoc".to_string(), tile("ssh", None));
        let all = |ids: &[&str]| approve_all_plan(&ids.iter().map(|s| s.to_string()).collect::<Vec<_>>(), None, &ctx, &d, None);
        assert!(all(&["w-yolo", "delegated:yolo2"]));
        assert!(!all(&["w-yolo", "w-auto"]));
        assert!(!all(&["w-yolo", "w-local"]));
        assert!(!all(&["w-adhoc"]));
        assert!(!all(&["w-ghost"]));
        assert!(!all(&[]), "대상이 없으면 거짓");
        assert!(!all(&["db:x"]), "DB 대상은 DB 작업안 몸(`db`)이 있어야 한다");
    }
}
