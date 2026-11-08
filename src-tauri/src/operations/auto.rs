//! **사전 정책 자동 승인의 시계** — 세션 서버가 돌린다(③-4 · 설계 4.4 "작업안 실행·자동 승인·결과 알림 — 서버로(창 0개에도)").
//!
//! 예전에는 주 창의 프런트 타이머(`app/auto-approve.svelte.ts`, 2초)가 검토 대기 목록을 훑어 정책이 통과시키는 것을 Tauri 명령
//! `approve_operation(id, "auto")` 로 승인했다 — 그래서 **창이 하나도 없으면 자동 승인도 멈췄다**(③-3c 한계). 이제 같은 판정을
//! 세션 서버가 2초마다 한다([`sweep`] — `server::ai::AiPlane::start_timers`). GUI 가 꺼져 있어도 돈다.
//!
//! ## 옮기면서 보존한 것 (프런트 판과 같은 순서·조건)
//!
//! 1. `[automation] auto_approve` 가 꺼져 있으면 아무것도 하지 않는다(파일만 한 번 읽는다).
//! 2. **같은 작업안은 한 번만 시도한다**([`AutoState::attempted`]) — 권위 게이트가 거부해도 다시 하지 않는다.
//! 3. **사람이 검토 카드를 열어 둔 작업안은 건드리지 않는다**([`AutoState::reviewing`]) — GUI 가 창마다 열린 검토 패널의 id 를
//!    op `ops_reviewing` 으로 알린다(GUI 가 없으면 빈 집합 — 연결이 0 이 되면 서버가 비운다). 훑기 직전에 한 번 더 본다.
//! 4. 정책 사전 판정은 `policy::should_auto_approve`(프런트 `shouldAutoApprove` 와 같은 5조건) — 정책 밖의 작업안은 시도하지
//!    않는다(그래서 거부 사유도 남지 않는다 — 사람이 승인할 것). **예외: 대상이 전부 'YOLO'**(2026-10-23 — [`AllView`] ·
//!    `gate::approve_all_plan`)이면 명령을 보지 않고 시도한다(대상 수 상한은 본다 · DB 작업안 포함).
//! 5. 승인 자체는 **[`approve_in`](super::approval::approve_in)`(method: "auto")` 하나**로 간다 — 만료(TTL)·상한·자동 승인 정책·
//!    대상별 자동 실행 권한 재검사·빈도 한도·감사(`approved` · method auto)가 전부 그 안에 있다. 이 파일은 판정을 새로 만들지
//!    않는다. 거부 사유는 [`AutoState::refusals`] 에 두고 이벤트 [`EVT_AUTO_REFUSED`] 로 알린다(검토 카드가 읽는다 — `ops_list`
//!    의 `autoRefusals`).
//!
//! **이 길은 파이프의 승인 프레임이 아니다** — 서버 안의 함수 호출이다. 승인 등급 프레임은 여전히 GUI 의 Tauri 명령
//! `approve_operation` 하나만 만든다(시험 `approve_frames_come_from_one_place`). 서버 안에서 `approve_in` 을 부르는 곳은 파이프의
//! `ops_approve` 와 이 파일의 [`sweep`] 둘뿐이고, 이 파일은 `"auto"` 만 싣는다(시험 `auto_approve_has_one_entry`). MCP 에는 여기로
//! 오는 길이 없다(MCP 도구는 읽기·계획뿐 — `crate::mcp`).

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde_json::json;

use super::approval::OpsPlane;
use super::*;

/// 서버가 훑는 주기 — 프런트 판과 같은 값싼 왕복.
pub(crate) const SWEEP_EVERY: std::time::Duration = std::time::Duration::from_secs(2);

/// 자동 승인이 거부됐다 — `{operationId, reason}`. GUI 가 같은 이름으로 창에 중계한다(검토 카드).
pub(crate) const EVT_AUTO_REFUSED: &str = "operation-auto-refused";

/// 자동 승인의 기억 — 서버 메모리(서버가 다시 뜨면 작업안도 함께 사라지므로 함께 사라져도 된다).
#[derive(Default)]
pub(crate) struct AutoState {
    /// 이미 시도한 작업안(한 번만).
    attempted: Mutex<HashSet<String>>,
    /// 사람이 지금 검토 카드를 열어 둔 작업안(GUI 가 알린다 — 없으면 빈 집합).
    reviewing: Mutex<HashSet<String>>,
    /// 거부 사유 — 작업안이 대기를 떠나면 걷는다.
    refusals: Mutex<HashMap<String, String>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AutoState {
    /// GUI 가 알린 "검토 중" 집합으로 갈아 끼운다(op `ops_reviewing`).
    pub(crate) fn set_reviewing(&self, ids: impl IntoIterator<Item = String>) {
        *lock(&self.reviewing) = ids.into_iter().collect();
    }

    /// GUI 가 하나도 없다 — 검토 중인 사람도 없다.
    pub(crate) fn clear_reviewing(&self) {
        lock(&self.reviewing).clear();
    }

    /// 대기 중인 작업안의 거부 사유(`ops_list` 의 `autoRefusals`).
    pub(crate) fn refusals(&self) -> HashMap<String, String> {
        lock(&self.refusals).clone()
    }
}

/// **모두 승인 판정의 재료**(2026-10-23) — 거울의 정체성 스냅샷 · 위임 · (DB 작업안이 있을 때만) DB 사실. 훑기 · `ops_list` 가 한 번
/// 떠서 작업안마다 [`AllView::plan`] 으로 묻는다. 승인 몸([`approve_in_with`](super::approval::approve_in_with))은 자기 것을 따로 뜬다 —
/// 여기 값은 "시도할까" · "카드에 이유를 쓸까" 에만 쓴다(권위 판정은 승인 몸).
#[derive(Default)]
pub(crate) struct AllView {
    ctx: HashMap<String, crate::context::SessionContext>,
    delegation: crate::delegation::Delegation,
    db: Option<super::db_exec::DbFacts>,
}

impl AllView {
    /// 지금의 재료를 뜬다 — DB 사실은 대기 중 DB 작업안이 있을 때만 읽는다(파일 I/O · 블로킹).
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

    /// 이 작업안의 대상이 전부 'YOLO' 인가([`approve_all_plan`]).
    pub(crate) fn plan(&self, op: &Operation) -> bool {
        approve_all_plan(&op.targets, op.db.as_ref(), &self.ctx, &self.delegation, self.db.as_ref())
    }

    /// 이 대상이 'Auto' 이상인가(`auto_off` 이유를 말할지 — 그 사람은 자동을 기대한다).
    fn host_auto(&self, id: &str) -> bool {
        match crate::routing::delegated_alias_of(id) {
            Some(alias) => self.delegation.auto_execute_granted(alias),
            None => self.ctx.get(id).is_some_and(|c| crate::context::ai_auto_executable(c, &self.delegation)),
        }
    }
}

/// **이번 훑기에서 시도할 작업안** — 대기 목록(오래된 것부터)에서 아직 시도하지 않았고 · 사람이 검토 중이 아니고 · 정책이
/// 통과시키는 것(또는 대상이 전부 'YOLO' — `approve_all`). **순수**(시험 대상).
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
            // 모두 승인(2026-10-23) — 명령을 가리지 않는다(DB 작업안 포함 — 승인 몸이 같은 판정을 다시 한다). 대상 수 상한은 정책 판정
            // (`should_auto_approve`)과 같이 여기서도 본다 — 넘으면 시도하지 않고 카드가 이유(`max_targets`)를 말한다.
            (approve_all(op) && op.targets.len() <= prefs.max_targets as usize)
                // DB 작업안(쿼리 타일 3b)은 그 밖에는 자동 승인 대상이 아니다 — 시도하지도 않는다(승인 몸도 `auto` 를 거부한다).
                || (op.db.is_none()
                    && !op.targets.iter().any(|t| is_db_target(t))
                    && crate::policy::should_auto_approve(&op.command, op.targets.len(), prefs))
        })
        .map(|op| op.operation_id.clone())
        .collect()
}

/// **곧 자동 승인될 작업안** — 다음 훑기가 시도할 집합([`candidates`] 그대로 · 시도한 것 · 검토 중인 것 제외). `ops_list` 가
/// `autoPending` 으로 실어 검토 카드가 이것은 그리지 않는다(승인 요약 10-22 — 자동 승인될 작업안이 카드로 번쩍였다 사라지지 않게).
/// 이 함수는 **승인하지 않는다** — 읽기만 한다(승인은 여전히 [`sweep`] → `approve_in(…, "auto")` 하나).
///
/// 숨김은 영구가 아니다: 훑기가 한 번 시도하면 `attempted` 에 들어가 여기서 빠진다 — 승인됐으면 대기를 떠났고, 거부됐으면 사유와 함께
/// 카드에 선다. 자동 승인을 끄거나 정책이 바뀌어도 곧바로 빠진다(설정은 부를 때마다 새로 읽는다).
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

/// **이 대기가 왜 자동으로 넘어가지 않는가** — 사람 승인을 기다리는 작업안 하나의 이유(없으면 `None`). 순수(시험 대상).
///
/// 10-22 실기: 호스트를 'Auto' 로 두고 허용 명령을 올렸는데 카드가 그대로 섰고(전체 스위치 `[automation] auto_approve`
/// 가 꺼져 있었다), `uptime | cat` 은 카드에 아무 이유도 없었다(정책 밖이라 훑기가 **시도하지 않으므로** 거부 사유 `refusals` 가 생기지
/// 않는다). 그래서 시도 전에 걸러지는 이유를 여기서 말한다 — 판정은 새로 만들지 않고 설정 › 자동 승인 시험 칸과 **같은 길**
/// ([`crate::policy::explain::explain`])을 돌린다. 이 함수는 승인하지 않는다.
///
/// - 자동 승인이 꺼져 있으면 — 대상 호스트가 'Auto' 일 때만 `auto_off`(그 사람은 자동을 기대한다 · 아니면 잡음이다).
/// - 켜져 있으면 — 시험 칸의 첫 이유(제외 · 사람 승인) · 대상 수 상한(`max_targets`).
/// - 대상이 전부 'YOLO'(`approve_all` — 2026-10-23)이면 명령은 보지 않는다 — 전체 스위치가 꺼져 있으면 `auto_off`(DB 포함),
///   켜져 있으면 대상 수 상한만.
/// - 그 밖의 DB 작업안은 늘 사람 승인이라 말하지 않는다. 통과하는 것은 `None`(그것은 [`auto_pending`] 이거나 시도 뒤의 거부 사유다).
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

/// 대기 작업안마다 [`why_not_auto`] — 이미 거부 사유가 있거나 · 곧 자동 승인될 것([`auto_pending`])이거나 · 사람이 검토 중인 것은 뺀다.
/// `ops_list` 가 `autoWhy` 로 싣는다(검토 카드의 칩 한 칸 — 거부 사유와 같은 자리). 위임은 부르는 쪽이 한 번 읽어 넘긴다.
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

/// **한 번 훑는다** — 제품 진입점(서버 타이머). 설정·위임 파일을 읽으므로 **블로킹**(블로킹 풀에서 부른다). 승인한 수.
pub(crate) fn sweep(p: &OpsPlane) -> usize {
    let prefs = crate::settings::automation_prefs();
    if !prefs.auto_approve {
        return 0;
    }
    sweep_with(p, &prefs, crate::delegation::Delegation::load_default, |id| {
        super::approval::approve_in(p, id.to_string(), Some("auto".to_string()))
    })
}

/// [`sweep`] 의 몸 — 승인 함수를 받는다(시험이 디스크 없이 `approve_in_with` 로 게이트 전부를 지난다).
pub(crate) fn sweep_with(
    p: &OpsPlane,
    prefs: &crate::settings::AutomationPrefs,
    delegation: impl FnOnce() -> crate::delegation::Delegation,
    mut approve: impl FnMut(&str) -> Result<Operation, String>,
) -> usize {
    // 목록 읽기가 만료(TTL)를 먼저 처리한다(`list_in` — 만료 이벤트·감사도 거기서).
    let Ok(list) = super::commands::list_in(p) else {
        return 0;
    };
    let pending_ids: HashSet<String> = list.pending.iter().map(|o| o.operation_id.clone()).collect();
    // 모두 승인 후보를 고를 재료 — 대기가 있을 때만 뜬다(권위 판정은 승인 몸이 다시 한다).
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
    // 대기를 떠난 것은 잊는다(승인돼 떠났거나 만료·거절됐다) — 기억이 작업안 수만큼 자라지 않게.
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

    /// 검토 대기 작업안 하나를 심는다 — 대상은 위임 스트림(`delegated:<alias>`).
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

    /// 순수 선별 — 켬일 때만 · 시도한 것·검토 중인 것 제외 · 정책 밖(허용 목록 밖·메타문자) 제외.
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

    /// 10-22 실기 재현 — A1: 호스트는 'Auto' 인데 전체 스위치가 꺼져 있으면 훑기는 아무것도 시도하지 않고(카드가 선다 — 맞다)
    /// 거부 사유도 없다 → 카드가 이유를 말해야 한다(`auto_off`). 자동 승인 실행이 아닌 호스트에는 말하지 않는다(잡음).
    /// A2: 켜져 있어도 `uptime | cat` 은 정책 밖이라 시도되지 않아 `refusals` 가 영영 비어 있다 → 시험 칸과 같은 이유(`split_pipe`).
    #[tokio::test]
    async fn why_not_auto_explains_what_the_sweep_never_tries() {
        let p = plane(None);
        awaiting(&p, "op-a1", "uptime", "granted", None);
        awaiting(&p, "op-a1-ro", "uptime", "readonly", None);
        let pending = || -> Vec<Operation> { p.ops.lock().unwrap().values().filter(|o| o.state == OperationState::AwaitingApproval).cloned().collect() };
        let off = crate::settings::AutomationPrefs { auto_approve: false, ..prefs() };
        // A1 — 훑기는 시도하지 않는다(사람 승인 대기가 맞다).
        assert_eq!(sweep_with(&p, &off, delegation, |_| panic!("자동 끔이면 시도하지 않는다")), 0);
        assert!(auto_pending(&p, &pending(), &off, &view(&p)).is_empty());
        assert!(p.auto.refusals().is_empty(), "시도하지 않았으니 거부 사유도 없다 — 예전 카드가 아무 말도 못 한 까닭");
        let why = auto_why(&p, &pending(), &off, &view(&p));
        assert_eq!(why.get("op-a1").map(|r| r.code), Some("auto_off"));
        assert!(!why.contains_key("op-a1-ro"), "자동 승인 실행이 아닌 호스트에는 말하지 않는다");

        // A2 — 켜져 있어도 파이프는 시도 전에 걸러진다.
        awaiting(&p, "op-a2", "uptime | cat", "granted", None);
        sweep_with(&p, &prefs(), delegation, |id| approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation));
        assert!(!p.auto.refusals().contains_key("op-a2"), "정책 밖은 시도하지 않는다 — 거부 사유 없음");
        let why = auto_why(&p, &pending(), &prefs(), &view(&p));
        assert_eq!(why.get("op-a2").map(|r| r.code), Some("split_pipe"));
        // 파이프 허용(10-22)을 켜면 어느 단계가 범위 밖인지(`cat` 은 허용 목록에 없다).
        let pipes = crate::settings::AutomationPrefs { allow_pipes: true, ..prefs() };
        let why = auto_why(&p, &pending(), &pipes, &view(&p));
        assert_eq!(why.get("op-a2").map(|r| r.code), Some("pipe_stage"));
        assert_eq!(why.get("op-a2").map(|r| r.args["segment"].as_str()), Some("cat"));
        assert!(!why.contains_key("op-a1-ro"), "거부 사유가 있는 것은 그 사유가 말한다(중복 없음)");
        assert!(p.auto.refusals().contains_key("op-a1-ro"));
    }

    /// 곧 자동 승인될 것(`autoPending`) — 훑기 전에는 후보, 훑기가 시도하면(승인 · 거부) 빠진다. 거부된 것은 대기에 남아 카드에 선다
    /// (영구히 숨지 않는다). 검토 중 · 정책 밖 · 자동 끔은 처음부터 아니다.
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

    /// 서버 훑기 — 권한 있는 대상은 auto 로 승인(감사 method auto), 권한 없는 대상은 **한 번만** 시도하고 거부 사유를 남김,
    /// 검토 중인 카드는 건드리지 않음, 만료(TTL)는 승인되지 않음, 빈도 한도 넘으면 거부.
    #[tokio::test]
    async fn server_sweep_keeps_every_gate() {
        let dir = std::env::temp_dir().join(format!("ss4-auto-audit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let p = plane(Some(dir.clone()));
        awaiting(&p, "op-ok", "uptime", "granted", None);
        awaiting(&p, "op-noperm", "uptime", "readonly", None);
        awaiting(&p, "op-review", "uptime", "granted", None);
        awaiting(&p, "op-old", "uptime", "granted", Some(1)); // 이미 지난 만료 시각
        p.auto.set_reviewing(["op-review".to_string()]);
        let mut calls: Vec<String> = Vec::new();
        let n = sweep_with(&p, &prefs(), delegation, |id| {
            calls.push(id.to_string());
            approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation)
        });
        assert_eq!(n, 1);
        // 승인됐다 — 실행기가 곧바로 상태를 넘길 수 있어(대상 접속 실패 등) "대기를 떠났다" 로 본다.
        assert_ne!(state_of(&p, "op-ok"), OperationState::AwaitingApproval);
        assert_eq!(p.ops.lock().unwrap()["op-ok"].approval_method.as_deref(), Some("auto"));
        assert_eq!(state_of(&p, "op-noperm"), OperationState::AwaitingApproval, "권한 재검사 — 사람 승인 대기로 남는다");
        assert!(p.auto.refusals().contains_key("op-noperm"));
        assert_eq!(state_of(&p, "op-review"), OperationState::AwaitingApproval, "검토 중인 카드는 건드리지 않는다");
        assert_eq!(state_of(&p, "op-old"), OperationState::Expired, "만료가 먼저다");
        assert!(!calls.contains(&"op-review".to_string()) && !calls.contains(&"op-old".to_string()));

        // 다시 훑어도 거부된 것은 다시 시도하지 않는다(한 번만). 검토를 닫으면(GUI 없음 = 빈 집합) 그때 승인.
        p.auto.clear_reviewing();
        let mut again: Vec<String> = Vec::new();
        sweep_with(&p, &prefs(), delegation, |id| {
            again.push(id.to_string());
            approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation)
        });
        assert_eq!(again, vec!["op-review".to_string()]);
        assert_ne!(state_of(&p, "op-review"), OperationState::AwaitingApproval);
        assert_eq!(p.ops.lock().unwrap()["op-review"].approval_method.as_deref(), Some("auto"));

        // 빈도 한도(창 안 2건) — 셋째는 거부되고 대기로 남는다.
        awaiting(&p, "op-third", "uptime", "granted", None);
        sweep_with(&p, &prefs(), delegation, |id| approve_in_with(&p, id.to_string(), Some("auto".into()), prefs(), delegation));
        assert_eq!(state_of(&p, "op-third"), OperationState::AwaitingApproval);
        assert!(p.auto.refusals()["op-third"].contains('2'), "{:?}", p.auto.refusals());

        // 감사 — 승인 두 건이 method auto 로 남는다(감사 로거는 별도 스레드 — 잠깐 기다린다).
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

    // ── 모두 승인(2026-10-23 — docs/log/2026-10-23-approve-all.md) ──────────────────────────────────────────

    /// 위임 셋 — `yolo`(모두 승인) · `yolo2`(모두 승인) · `granted`(자동 승인 실행).
    fn yolo_delegation() -> crate::delegation::Delegation {
        let block = |alias: &str, all: bool| {
            format!(
                "[[target]]\nalias = \"{alias}\"\nexpect_user = \"u\"\nexpect_host = \"h\"\nexpect_port = 22\nread = true\npropose = true\nauto_execute = true\napprove_all = {all}\n\n"
            )
        };
        crate::delegation::Delegation::parse(&format!("{}{}{}", block("yolo", true), block("yolo2", true), block("granted", false))).unwrap()
    }

    /// 대상 여럿인 검토 대기 작업안 — 대상은 위임 스트림들.
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

    /// 대상이 전부 'YOLO' 면 명령 정책을 보지 않는다 — 파이프 · 리다이렉트 · 치환 · 서브셸 · `rm -rf` · 이상한 cwd · 정책 밖 validate ·
    /// 허용 목록 밖 모두 자동 승인되고, 빈도 한도(창 안 2건)도 걸지 않는다(빈도 칸을 먹지도 않는다). 승인 방식은 `auto` 그대로, `approve_all` 표지.
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

    /// 섞이면(모두 승인 + 자동 승인 실행) 예전 규칙으로 — 정책 밖 명령은 후보도 아니고 직접 auto 로 불러도 거부된다. 정책 안 명령은 예전처럼
    /// 승인되되 `approve_all` 표지는 없다(빈도 칸을 먹는다).
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
        // 위임에 없는 호스트가 섞여도(읽기 전용) 모두 승인이 아니다.
        assert!(auto_in(&p, "op-mix-ro", prefs()).is_err());
    }

    /// 전체 스위치(`[automation] auto_approve`)가 꺼지면 모두 승인 대상도 사람을 기다린다 — 훑기는 시도하지 않고, 직접 auto 도 거부, 카드는
    /// 이유(`auto_off`)를 말한다. 수동 승인은 그대로 된다.
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
        // 켜면 훑기가 곧바로 승인한다(감사는 승인 몸이 남긴다).
        assert_eq!(sweep_with(&p, &prefs(), yolo_delegation, |id| auto_in(&p, id, prefs())), 1);
        assert!(p.ops.lock().unwrap()["op-off"].approve_all);
    }

    /// caps(대상 수 · 동시 실행)는 모두 승인에도 걸린다 — 거부되고 대기로 남으며 카드는 `max_targets` 를 말한다. 만료도 먼저다.
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

    /// 창 타일 대상 — 호스트 별칭의 단계를 본다(로컬 타일 · 별칭 없는 원격 · 거울에 없는 id 는 모두 승인이 아니다).
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
