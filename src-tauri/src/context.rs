//! 세션 컨텍스트 저장소 — AI(MCP)에게 읽기 전용으로 내줄 라이브 세션 거울. 세션 서버 프로세스에 살아 GUI 를 꺼도 남는다.
//!
//! - 거울의 주인은 창이 있으면 프런트, 없으면 세션 서버의 해석기다([`crate::screen_mirror`]). 서버는 사람이 정한 쓰기 문지기(`opted_in` ·
//!   로컬은 세션 코어의 읽기 허용)도 읽기 문지기([`ai_readable`])도 바꾸지 않는다.
//! - 프라이버시 게이트는 쓰기 · 읽기 양쪽에 건다(기본 꺼짐). 옵트아웃이 오면 그 즉시 라이브 필드를 비운다 — "나중에 안 보냄" 이 아니라
//!   "지금 지움" 이라야 끈 순간 이미 공유된 데이터가 남지 않는다. 옵트인이 아닌 항목에의 쓰기는 조용히 무시한다.
//! - AI 권한: 원격 창 타일은 그 호스트 별칭의 `delegation.toml` 권한 하나(별칭 없는 원격 타일은 언제나 off) · 로컬 타일은 타일별 읽기
//!   허용뿐(실행 권한 없음) · 헤드리스 세션은 접속 때의 `read` 스냅샷 그리고 지금의 `read`. 판정은 이 모듈에 모으고 `&Delegation` 을
//!   받는다 — 부르는 쪽이 요청 하나에 한 번 읽고, 동기 Tauri 명령 안에서는 읽지 않는다.
//! - 쓰기 도구는 없다 — `send_command` 류는 만들지 않는다(→ docs/invariants.md 전문 4).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::session_owner::SessionOwnerKind;

/// 넘치면 뒤(tail)를 남긴다 — 최근 줄이 살아 있어야 "방금 왜 실패했어" 가 답이 된다.
pub(crate) const SCROLLBACK_CAP: usize = 1000;

pub(crate) const SCROLLBACK_DEFAULT: usize = 200;

/// 프런트 링(타일당 200블록)과 같은 값이다. 넘치면 오래된 것부터 버린다.
pub(crate) const HISTORY_CAP: usize = 200;

pub(crate) const HISTORY_DEFAULT: usize = 50;

/// 프런트 링(4MB)보다 좁다 — 거울은 공유 타일만 쥐는 MCP 응답의 재료일 뿐 원본이 아니다.
pub(crate) const HISTORY_BYTES_CAP: usize = 1024 * 1024;

/// 프런트에서 이 모양(camelCase)으로 올라와 MCP `get_last_command` 결과로 그대로 나간다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCommand {
    pub command_line: String,
    pub output: String,
    pub exit: Option<i64>,
    pub running: bool,
}

/// 명령 블록 하나의 거울 — 프런트 `CommandBlock` 을 한 겹으로 편 모양 · [`LastCommand`] 와 같은 camelCase 계약
/// (docs/log/2026-09-08-block-history-store.md).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBlockMirror {
    /// 타일 안에서 단조 증가 — MCP 가 `(session, id)` 로 블록을 지목한다.
    pub id: i64,
    pub command_line: String,
    pub cwd: Option<String>,
    /// epoch ms.
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub exit: Option<i64>,
    /// 파생값이지만 계약에 명시한다.
    pub running: bool,
    pub excerpt_head: Vec<String>,
    pub excerpt_tail: Vec<String>,
    pub truncated: bool,
    /// `"complete"` · `"partial"`(가운데 잘림) · `"unavailable"`(출력을 못 읽음 · 실행 중) — `truncated` 만으로는 "무출력" 과
    /// "못 읽음" 이 갈리지 않는다.
    pub capture: String,
}

impl CommandBlockMirror {
    /// 줄바꿈을 한 바이트로 친다 — MCP `get_command` 이 `excerpt.bytes` 로 그대로 내보낸다.
    pub(crate) fn excerpt_bytes(&self) -> usize {
        self.excerpt_head
            .iter()
            .chain(self.excerpt_tail.iter())
            .map(|l| l.len() + 1)
            .sum()
    }

    /// 상한 계산에만 쓴다(정확한 힙 크기가 아니다).
    fn bytes(&self) -> usize {
        self.excerpt_bytes() + self.command_line.len() + self.cwd.as_ref().map_or(0, String::len)
    }
}

/// 옵트아웃되면 라이브 필드(status · last · scrollback · history)만 비고 정체성은 남는다(다시 옵트인할 수 있게).
#[derive(Debug, Clone, Default)]
pub struct SessionContext {
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
    pub tab_key: Option<String>,
    pub label: String,
    /// 타일 코드(`p2` / `t7·p2`) — 저장소 키(streamId)와 갈라 둔 지금의 타일 위치. 키는 불투명이라 파싱할 수 없어 프런트가 넘긴다.
    pub code: String,
    /// `"ssh"` / `"local"` 등 — 프런트가 정한다. `"ssh"` 인 창 타일은 호스트 권한을 본다.
    pub kind: String,
    /// 소유 창 라벨(표시용 `label` 이 아니라 OS 창 라벨) — 창이 갑자기 파괴돼 [`crate::reap`] 이 거둘 때 그 창의 거울을 함께 되거두는
    /// 열쇠다(안 거두면 죽은 세션의 공유 데이터가 남는다).
    pub owner: String,
    /// 쓰기 쪽 프라이버시 문지기. 로컬 타일에서는 읽기 가시성 그 자체이고, 원격 타일의 읽기 판정은 이 값이 아니라 호스트 권한을 본다.
    pub opted_in: bool,
    /// 호스트 목록에 있는 별칭일 때만 실린다 — `None` 인 원격 타일의 AI 권한은 off 고정이다. 헤드리스 세션은 쓰지 않는다(별칭 = `label`).
    pub host_alias: Option<String>,
    /// `"running"` / `"ok"` / `"fail"` / `None`(모름).
    pub status: Option<String>,
    /// [`history`](Self::history) 의 꼬리와 늘 같지 않다(실행 중인 명령도 매 전이마다 갱신된다) — `get_last_command` 계약이라 그대로 둔다.
    pub last: Option<LastCommand>,
    /// 오래된 것부터. 스크롤백과 달리 [`push_block`] 으로 하나씩 쌓는다 — 통째로 다시 보내면 IPC 가 수 MB 를 나른다.
    pub history: Vec<CommandBlockMirror>,
    /// tail — 매 갱신에 통째로 교체한다.
    pub scrollback: Vec<String>,
    /// 마지막 갱신 시각(epoch ms) — 프런트가 아니라 Rust 가 [`touch`] 로 찍는다. AI 가 오래된 거울을 현재 상태로 오인하지 않게.
    pub captured_at: u64,
    /// 갱신마다 +1 — 시계가 뒤로 가도(NTP 보정 등) 바뀜을 놓치지 않는 버전 표식.
    pub context_version: u64,
    /// 헤드리스 세션만 [`report_delegated`] 이 `Delegated` 로 찍는다.
    pub owner_kind: SessionOwnerKind,
    /// 헤드리스 세션의 접속 때 `read` 스냅샷 — [`ai_readable`] 이 지금의 `read` 와 함께 본다. 창 세션은 늘 `false`.
    pub delegation_read: bool,
    /// 헤드리스 세션이 떨어졌다 — 항목을 지우면 '미접속'(붙은 적 없음)과 뒤섞여 남겨 두고 '끊김' 으로 낸다. 창 세션은 늘 `false`.
    pub disconnected: bool,
    /// tmux 타일 — OSC 133 마커가 오지 않아 블록이 영영 생기지 않는다. MCP 가 "블록 없음" 을 밝히지 않으면 AI 는 "아직 안 돌았다" 로
    /// 읽고 기다린다 (docs/log/2026-09-16-tmux-toggle.md).
    pub screen_only: bool,
    /// 붙은 시각(epoch ms · 0 = 모름). 항목이 처음 생길 때와 끊겼던 헤드리스 세션이 돌아올 때만 찍는다 — 창 타일의 재연결 경과는
    /// 프런트(`app/sessions.svelte.ts` 의 `noteSession`)가 따로 쥔다 (docs/log/2026-09-21-console-host-groups.md).
    pub connected_at: u64,
    /// 거울 번호 = 프런트 번호 + 이 값. 새로 뜬 페이지가 1 부터 다시 센 번호가 다른 블록과 겹치면 [`push_block`] 이 올려 뒤로 민다 —
    /// 덮어쓰지 않는다. 옵트아웃 때 0 으로 돌아간다.
    pub front_shift: i64,
}

/// AI 권한을 정하는 호스트 별칭 — 헤드리스 세션은 `label`. 로컬 타일 · 별칭 없는 원격 타일은 `None`.
fn permission_alias(ctx: &SessionContext) -> Option<&str> {
    match ctx.owner_kind {
        SessionOwnerKind::Window if ctx.kind == "ssh" => ctx.host_alias.as_deref(),
        SessionOwnerKind::Window => None,
        SessionOwnerKind::Delegated => Some(ctx.label.as_str()),
    }
}

/// AI 읽기 도구의 가시성 게이트. 원격 창 타일은 호스트 별칭의 `read`(타일의 `opted_in` 은 보지 않는다 · 별칭이 없으면 거짓), 로컬
/// 타일은 `opted_in`, 헤드리스 세션은 접속 때 스냅샷 그리고 지금의 `read` — 권한을 내리면 다시 붙지 않아도 바로 숨는다.
pub(crate) fn ai_readable(ctx: &SessionContext, delegation: &crate::delegation::Delegation) -> bool {
    match ctx.owner_kind {
        SessionOwnerKind::Window if ctx.kind != "ssh" => ctx.opted_in,
        SessionOwnerKind::Window => {
            permission_alias(ctx).is_some_and(|alias| delegation.read_granted(alias))
        }
        SessionOwnerKind::Delegated => {
            ctx.delegation_read && delegation.read_granted(&ctx.label)
        }
    }
}

/// 작업안 대상 자격 — 별칭의 누적 `read && propose`(단계 'Ask' 이상). 로컬 타일 · 별칭 없는 원격 타일은 언제나 거짓(읽기 허용과 무관).
pub(crate) fn ai_plan_eligible(
    ctx: &SessionContext,
    delegation: &crate::delegation::Delegation,
) -> bool {
    permission_alias(ctx).is_some_and(|alias| delegation.propose_granted(alias))
}

/// 자동 실행 자격(단계 'Auto'). 로컬 · 별칭 없는 원격은 언제나 거짓 — 그런 대상이 섞인 작업안은 사람 승인으로 남는다.
pub(crate) fn ai_auto_executable(
    ctx: &SessionContext,
    delegation: &crate::delegation::Delegation,
) -> bool {
    permission_alias(ctx).is_some_and(|alias| delegation.auto_execute_granted(alias))
}

/// 모두 승인 자격(단계 'YOLO'). 로컬 · 별칭 없는 원격은 언제나 거짓 — 그런 대상이 섞이면 작업안은 허용 목록 · 위험 · 빈도의 자동 승인
/// 규칙으로 돌아간다(`operations::gate::approve_all_plan`).
pub(crate) fn ai_approve_all(
    ctx: &SessionContext,
    delegation: &crate::delegation::Delegation,
) -> bool {
    permission_alias(ctx).is_some_and(|alias| delegation.approve_all_granted(alias))
}

/// 판정에 필요한 정체성 칸만 복제한다 — 컨텍스트 잠금을 먼저 풀고 판정해야 할 때(다른 잠금을 쥔 자리 · `.await` 를 건너는 자리).
pub(crate) fn permission_view(c: &SessionContext) -> SessionContext {
    SessionContext {
        label: c.label.clone(),
        kind: c.kind.clone(),
        opted_in: c.opted_in,
        host_alias: c.host_alias.clone(),
        owner_kind: c.owner_kind,
        delegation_read: c.delegation_read,
        ..Default::default()
    }
}

pub(crate) fn permission_snapshot(
    map: &HashMap<String, SessionContext>,
) -> HashMap<String, SessionContext> {
    map.iter()
        .map(|(k, c)| (k.clone(), permission_view(c)))
        .collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 항목을 실제로 건드린 직후에만 부른다(옵트아웃 · 미등록으로 아무것도 안 했으면 부르지 않는다).
fn touch(entry: &mut SessionContext) {
    entry.captured_at = now_ms();
    entry.context_version += 1;
}

/// 키는 프런트가 정한 불투명 streamId 다 — 파싱하지 않는다(표시용 위치는 [`SessionContext::code`]).
pub type Store = Arc<Mutex<HashMap<String, SessionContext>>>;

// ---------------------------------------------------------------------------
// 순수 저장소 연산
// ---------------------------------------------------------------------------

/// 옵트아웃은 라이브 필드를 즉시 지운다. 옵트인이 유지되면 라이브 필드는 건드리지 않는다 — 정체성 갱신이 스크롤백을 날리면 안 된다.
pub(crate) fn report(
    map: &mut HashMap<String, SessionContext>,
    key: String,
    label: String,
    kind: String,
    code: String,
    opted_in: bool,
) {
    let entry = map.entry(key).or_default();
    // 처음 생길 때만 찍는다 — 정체성 갱신마다 되감으면 경과가 영영 0 에 머문다.
    if entry.connected_at == 0 {
        entry.connected_at = now_ms();
    }
    entry.label = label;
    entry.kind = kind;
    entry.code = code;
    entry.opted_in = opted_in;
    if !opted_in {
        // 옵트아웃 = 지금 당장 공유 데이터 제거 — 블록 이력도 같은 자리에서 비운다.
        entry.status = None;
        entry.last = None;
        entry.scrollback.clear();
        entry.history.clear();
        entry.front_shift = 0;
    }
    touch(entry);
}

/// 헤드리스 세션의 거울을 등록한다 — 판정은 언제나 위임 별칭(`label`)으로 해 `opted_in` 은 `false` 로 둔다. `owner` 는 비우고
/// [`reclaim_window`] 는 `owner_kind` 로 헤드리스 세션을 건너뛴다.
pub(crate) fn report_delegated(
    map: &mut HashMap<String, SessionContext>,
    key: String,
    label: String,
    code: String,
    read_granted: bool,
) {
    let entry = map.entry(key).or_default();
    // 끊겼다 돌아온 재연결도 다시 찍는다 — 떨어져 있던 시간이 경과에 섞이지 않게.
    if entry.connected_at == 0 || entry.disconnected {
        entry.connected_at = now_ms();
    }
    entry.label = label;
    entry.kind = "ssh".to_string();
    entry.code = code;
    entry.owner = String::new();
    entry.owner_kind = SessionOwnerKind::Delegated;
    entry.delegation_read = read_granted;
    entry.opted_in = false;
    // 재연결이 같은 키로 이 함수를 부르므로 이 한 줄이 곧 회복이다.
    entry.disconnected = false;
    touch(entry);
}

/// 항목을 지우지 않고 깃발만 세운다. 창 세션은 이 경로를 타지 않는다(창의 드롭은 `ssh-exit` 이벤트로 프런트가 정리한다).
pub(crate) fn mark_delegated_disconnected(map: &mut HashMap<String, SessionContext>, key: &str) {
    if let Some(entry) = map.get_mut(key) {
        if entry.owner_kind == SessionOwnerKind::Delegated {
            entry.disconnected = true;
            touch(entry);
        }
    }
}

/// 되거둘 streamId — `owner == label` 이고, 기준선 뒤 다시 보고되지 않았고(리로드 뒤 재보고는 살아난 것), `held` 에 없다
/// (이관 중인 타일의 거울은 받는 창이 이어받는다 — [`crate::reap::collect_held`]).
pub(crate) fn reclaim_streams(
    entries: &[(String, String, u64)],
    label: &str,
    reaped_before: u64,
    held: &std::collections::HashSet<String>,
) -> Vec<String> {
    let mut out: Vec<String> = entries
        .iter()
        .filter(|(sid, owner, cap)| owner == label && *cap <= reaped_before && !held.contains(sid))
        .map(|(sid, _, _)| sid.clone())
        .collect();
    out.sort();
    out
}

pub(crate) fn reclaim_window(
    map: &mut HashMap<String, SessionContext>,
    label: &str,
    reaped_before: u64,
    held: &std::collections::HashSet<String>,
) -> Vec<String> {
    // 헤드리스 세션은 제외한다 — 창 정리로 거두지 않는다(명시적 닫힘 · 앱 종료로만 사라진다).
    let entries: Vec<(String, String, u64)> = map
        .iter()
        .filter(|(_, c)| c.owner_kind != SessionOwnerKind::Delegated)
        .map(|(k, c)| (k.clone(), c.owner.clone(), c.captured_at))
        .collect();
    let reclaim = reclaim_streams(&entries, label, reaped_before, held);
    for sid in &reclaim {
        map.remove(sid);
    }
    reclaim
}

/// 옵트인이 아니면 조용히 무시한다(옵트아웃 직후 도착한 마지막 한 건을 오류로 만들지 않는다).
pub(crate) fn push_block(
    map: &mut HashMap<String, SessionContext>,
    key: &str,
    mut block: CommandBlockMirror,
) {
    let Some(entry) = map.get_mut(key) else {
        return;
    };
    if !entry.opted_in {
        return;
    }
    // 같은 번호에 다른 블록이 있으면 새로 뜬 페이지가 1 부터 다시 센 것이다 — 덮어쓰지 않고 가장 큰 번호 뒤로 민다.
    // 같은 블록의 다시 보내기(백필 · 이관이 실어 온 이력)는 같은 번호로 갈아 끼운다.
    let mut id = block.id + entry.front_shift;
    if entry
        .history
        .iter()
        .any(|b| b.id == id && (b.started_at != block.started_at || b.command_line != block.command_line))
    {
        let max = entry.history.iter().map(|b| b.id).max().unwrap_or(0);
        entry.front_shift = max;
        id = block.id + max;
    }
    block.id = id;
    insert_block(entry, block);
}

/// 서버 해석기가 닫은 블록(창이 없을 때) — 번호는 가장 큰 번호 다음이라, 창이 다시 붙어 같은 번호가 오면 [`push_block`] 이 뒤로 민다.
pub(crate) fn push_server_block(
    map: &mut HashMap<String, SessionContext>,
    key: &str,
    mut block: CommandBlockMirror,
) {
    let Some(entry) = map.get_mut(key) else {
        return;
    };
    if !entry.opted_in {
        return;
    }
    block.id = entry.history.iter().map(|b| b.id).max().unwrap_or(0) + 1;
    insert_block(entry, block);
}

fn insert_block(entry: &mut SessionContext, block: CommandBlockMirror) {
    // id 로 upsert — OFF→ON 백필과 증분 경로가 같은 틱에 겹치면 한 블록이 양쪽에 실릴 수 있다 (docs/log/2026-09-09-share-backfill-and-header.md).
    match entry.history.iter().position(|b| b.id == block.id) {
        Some(i) => entry.history[i] = block,
        None => entry.history.push(block),
    }
    while entry.history.len() > HISTORY_CAP {
        entry.history.remove(0);
    }
    let mut total: usize = entry.history.iter().map(CommandBlockMirror::bytes).sum();
    while total > HISTORY_BYTES_CAP && entry.history.len() > 1 {
        total -= entry.history.remove(0).bytes();
    }
    touch(entry);
}

/// 이관 직후의 거울 재구성 — 한 건씩 부른 것과 결과가 같도록 [`push_block`] 을 그대로 돌린다(상한 · 게이트는 한 곳).
pub(crate) fn push_blocks(
    map: &mut HashMap<String, SessionContext>,
    key: &str,
    blocks: Vec<CommandBlockMirror>,
) {
    for block in blocks {
        push_block(map, key, block);
    }
}

/// 옵트인이 아니면 조용히 무시한다 — 프런트가 옵트아웃 직후에도 마지막 배치를 보낼 수 있다.
pub(crate) fn update(
    map: &mut HashMap<String, SessionContext>,
    key: &str,
    status: Option<String>,
    last: Option<LastCommand>,
    scrollback_tail: Vec<String>,
) {
    let Some(entry) = map.get_mut(key) else {
        return;
    };
    if !entry.opted_in {
        return;
    }
    // 모름(`None`)은 아는 값을 지우지 않는다 — 새로 뜬 페이지의 첫 갱신이 서버 해석기가 쓴 마지막 명령을 지우면 거울이 엇갈린다.
    // 지우는 길은 옵트아웃([`report`]) 하나다.
    if status.is_some() {
        entry.status = status;
    }
    if last.is_some() {
        entry.last = last;
    }
    entry.scrollback = scrollback_tail;
    let len = entry.scrollback.len();
    if len > SCROLLBACK_CAP {
        entry.scrollback.drain(0..len - SCROLLBACK_CAP);
    }
    touch(entry);
}

// 프런트 거울 명령은 GUI 프록시(`crate::server::ai_proxy`)가 순서를 지켜 서버 op `ctx_batch` 로 보내고, 서버가 위의 순수 연산을 부른다.

#[cfg(test)]
mod tests;
