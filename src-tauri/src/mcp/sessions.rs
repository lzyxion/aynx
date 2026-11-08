//! 세션 읽기 도구 — 옵트인 게이트 [`shared_entry`] · 읽기 모드(`blocks`/`screen`) ·
//! `list_sessions`(와 관제판의 `list_console_sessions` 명령 — 같은 [`enrich_sessions`]) ·
//! `get_last_command` · `get_scrollback`.
//!
//! 불변식:
//! - **AI 읽기가 허용된 세션만** 본다([`crate::context::ai_readable`] — 원격(창 타일·헤드리스)은 그 호스트
//!   별칭의 `read` 권한, 로컬 타일은 타일의 "AI 읽기 허용"). 미공유 세션은 존재도 숨긴다(없는 것과 같은 오류).
//! - 판정에 쓰는 `delegation.toml` 은 [`super::rpc`] 가 요청 하나에 한 번 읽어 넘긴다.
//! - `enrich_sessions` 의 칸은 **더하기만 한다** — 빼면 등록된 계약이 깨진다.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::context::{SessionContext, SCROLLBACK_CAP, SCROLLBACK_DEFAULT};

// ---------------------------------------------------------------------------
// 도구 구현 — **[`crate::context::ai_readable`] 인 세션만** 본다.
// ---------------------------------------------------------------------------

/// 인자에서 `session` 문자열을 꺼내 옵트인된 항목을 찾는다. 없으면 사람이 읽을 오류 문자열.
pub(super) fn shared_entry<'a>(
    map: &'a HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<&'a SessionContext, String> {
    let session = args
        .and_then(|a| a.get("session"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The session argument is required".to_string())?;
    match map.get(session) {
        // 미공유는 존재를 숨긴다 — "없음" 과 같은 오류로. 가시성은 [`crate::context::ai_readable`]
        // 하나로: 원격은 호스트 별칭의 `read` 권한, 로컬은 타일의 읽기 허용(`opted_in`).
        Some(ctx) if crate::context::ai_readable(ctx, delegation) => Ok(ctx),
        _ => Err(format!("Unknown or unshared session: {session}")),
    }
}

// ---------------------------------------------------------------------------
// 세션의 **읽기 모드** — `blocks` / `screen` (docs/log/2026-09-16-tmux-toggle.md)
//
// tmux 로 붙은 타일은 셸 통합을 심지 않는다(마커가 tmux 격자를 넘지 못한다). 그 세션에는
// 명령 블록이 **영영 생기지 않으므로**, 블록 도구의 빈 결과를 "아직 아무것도 안 돌았다" 로
// 오인하지 않게 **모드를 먼저 말해 준다**. 도구 표면은 그대로였다 — 늘어난 것은 응답의
// 필드 하나(`mode`)와, 블록 도구가 빈 손으로 돌아올 때 함께 붙이는 `screenOnly`/`note` 뿐이다.
// ---------------------------------------------------------------------------

/// 블록 이력이 쌓이는 보통 세션.
const MODE_BLOCKS: &str = "blocks";
/// tmux 간이 모드 — 화면(스크롤백)만 있다.
pub(super) const MODE_SCREEN: &str = "screen";

/// AI 가 읽는 그 세션의 모드 문자열.
pub(super) fn mode_of(ctx: &SessionContext) -> &'static str {
    if ctx.screen_only {
        MODE_SCREEN
    } else {
        MODE_BLOCKS
    }
}

/// 블록 도구가 화면 전용 세션에 대해 함께 내보내는 안내 한 줄.
pub(super) const SCREEN_ONLY_NOTE: &str = "This session is attached through tmux, a 'screen-only session' (mode: screen) — \
shell integration markers do not survive tmux, so no command blocks are created. Read the screen with get_scrollback.";

/// `list_sessions` — 라이브 거울과 위임을 합친 세션 목록. **`~/.ssh/config` 를 읽는 얇은 래퍼**다.
///
/// 순수 알맹이는 [`enrich_sessions`] 이고(테스트 대상), 위임은 [`super::rpc`] 가 요청 하나에 한 번 읽은
/// 것을 받는다 — 이 함수 자체는 설정 파일을 읽으므로 단위 테스트는 [`enrich_sessions`] 를 본다.
pub(super) fn list_sessions(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
) -> Value {
    enrich_sessions(map, delegation, config_index().as_ref())
}

/// `~/.ssh/config` 색인은 [`crate::ssh_config`] 에 산다 — 읽는 자리가 둘이라(여기와
/// `delegation_list_targets` 의 고아 판정) 파서 곁에 두는 것이 맞다. 이름만 여기로 들여온다.
use crate::ssh_config::{config_index, ConfigIndex};

/// **이 세션이 어느 계정으로 붙어 있는가** — 순수 함수(테스트 대상).
///
/// 로컬 셸에는 답이 없다(`None`) — 관제판은 그 칸에 셸 이름을 넣는데, 그것은 프런트가 이미
/// 들고 있는 값이라 여기서 지어내지 않는다.
///
/// SSH 는 두 갈래다. **빠른 접속** 타일의 이름은 설정의 별칭이 아니라 `user@host[:port]`
/// 라 이름 자체가 신원이고(`~/.ssh/config` 에 없는 대상이다), 나머지는 별칭이므로 색인에서
/// 편다. 색인이 없거나(설정을 못 읽음) 별칭이 없으면 `None` — 화면은 그 칸을 비운다.
pub(super) fn session_user(kind: &str, label: &str, index: Option<&ConfigIndex>) -> Option<String> {
    if kind != "ssh" {
        return None;
    }
    if let Some(user) = adhoc_user(label) {
        return Some(user);
    }
    index?.get(&label.to_lowercase()).cloned().flatten()
}

/// `user@host[:port]`(빠른 접속 타일의 이름)에서 계정 자리만 떼어 낸다 — 아니면 `None`.
///
/// 별칭에 `@` 가 들어갈 수도 있으므로 뒤쪽이 비었거나 계정 자리에 공백·`:` 가 섞이면
/// 이름으로 보지 않는다(그런 글자는 `quickConnectLabel` 이 만들지 않는다).
pub(super) fn adhoc_user(label: &str) -> Option<String> {
    let (user, rest) = label.split_once('@')?;
    let ok = !user.is_empty()
        && !rest.is_empty()
        && !user.contains(':')
        && !user.chars().any(char::is_whitespace);
    ok.then(|| user.to_string())
}

/// **순수 열거기** — 라이브 거울([`ai_readable`] 통과분)과 아직 접속하지 않은 read-granted 위임
/// 대상을 합쳐 세션 목록을 만든다(A3a). `delegation` 를 주입받으므로 파일 없이 단위 테스트가 된다.
///
/// 두 갈래를 합친다.
/// - **라이브 거울**: [`ai_readable`] 인 모든 항목 → 오늘의 `list_sessions` 객체 + `connected: true`.
/// - **미접속 위임**: [`crate::delegation::Delegation::headless_targets`](헤드리스 접속이 위임된 대상) 중 그 id(`delegated:<alias>`)가 라이브
///   거울에 **없는** 대상 → 데이터 없는 합성 항목(`connected: false`, `status: null`,
///   `running: false`, `lastExit: null`, `commands: 0`).
///
/// **중복 제거는 라이브가 이긴다**: 헤드리스 세션이 이미 접속돼 거울에 키 `delegated:<alias>` 로 있으면
/// (라이브 갈래에서 `connected:true` 로 이미 나갔다) 그 별칭의 합성 항목은 만들지 않는다. 판정은
/// 거울 키 존재 여부 하나다. 미접속 위임 항목은 **읽기 전용 발견 항목**일 뿐 실행 대상이 아니다
/// (실행 자격은 A2b 의 read+propose 게이트가 따로 본다 — 이 함수는 실행에 관여하지 않는다).
///
/// `config` 는 `~/.ssh/config` 색인([`ConfigIndex`])이고 `None` 은 **확인할 수 없었다**(설정
/// 읽기 실패)는 뜻이다 — 그때는 전부 `aliasKnown: true`·`user: null` 로 낸다. 라이브 항목의
/// `aliasKnown` 은 언제나 `true` 다(붙어 있는 세션에게 "설정에 없다" 는 아무 뜻도 없다).
///
/// ## 관제판의 호스트별 목록이 읽는 네 칸 (2026-09-21)
/// `user`(어느 계정으로) · `connectedAt`(언제 붙었나) · `lastActivityAt`(마지막 명령이 언제
/// 끝났나) · `windowLabel`(어느 창의 타일인가, 헤드리스는 `null`). MCP `list_sessions` 도
/// 같은 함수를 지나므로 AI 도 같은 칸을 본다 — **더하기만 한다**(빼면 등록된 계약이 깨진다).
pub(super) fn enrich_sessions(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    config: Option<&ConfigIndex>,
) -> Value {
    // 세션 코어의 상태(붙음·떨어짐·끝남·끊김) — 창 타일의 거울 키(streamId)가 곧 코어의 스트림 열쇠다. 잠금은 이 한
    // 문장(코어 잠금은 다른 잠금을 쥔 채 잡히지 않는다 — 컨텍스트 → 코어 순서만 있다).
    // ③-3c 부터 이 함수는 **세션 서버 프로세스**에서 돈다 — 로컬·SSH 세션의 코어가 같은 프로세스라 칸이 채워진다(③-2 한계 2 해소).
    let core_states: HashMap<&str, (&'static str, u64)> = {
        let core = crate::session_core::core();
        map.keys()
            .filter_map(|k| core.status_of_stream(k).map(|s| (k.as_str(), s)))
            .collect()
    };
    let mut list: Vec<Value> = map
        .iter()
        .filter(|(_, c)| crate::context::ai_readable(c, delegation))
        .map(|(id, c)| {
            let running = matches!(c.status.as_deref(), Some("running"))
                || c.last.as_ref().is_some_and(|l| l.running);
            let last_exit = c.last.as_ref().and_then(|l| l.exit);
            // **끊김**은 헤드리스 세션에만 있다 — 라이브 거울 항목인데 전송로가 떨어져
            // [`crate::context::mark_delegated_disconnected`] 가 깃발을 세운 경우다. 창 세션은
            // `disconnected` 를 절대 쓰지 않으므로(항상 false) 언제나 connected:true·dropped:false 다.
            let dropped =
                c.owner_kind == crate::session_owner::SessionOwnerKind::Delegated && c.disconnected;
            // 창 타일의 SSH 전송로가 끊겼다(세션 코어 `Disconnected` — 재접속을 기다린다).
            let core_status = core_states.get(id.as_str()).copied();
            let core_state = core_status.map(|(s, _)| s);
            let link_lost = core_state == Some("disconnected");
            json!({
                "id": id,
                // 사용자가 타일 헤더에서 보는 코드(`p2` / `t7·p2`) — 같은 `label` 세션도 이걸로
                // 갈린다. `id`(=거울 키=streamId)는 이관·리로드를 넘는 **안정 신원**이라 정확
                // 지목에 쓰고, `code` 는 **현재 타일 위치**라 타일이 창을 옮기면 갱신된다. 예전엔
                // 여기서 키를 파싱해 만들었지만, 이제 키가 불투명 streamId 라 프런트가 준
                // 값(`ctx.code`)을 그대로 낸다 (2026-09-09 · 정체성 분리).
                "code": c.code,
                "workspaceId": c.workspace_id,
                "workspace": c.workspace_name,
                "tabKey": c.tab_key,
                "label": c.label,
                "kind": c.kind,
                "status": c.status,
                "running": running,
                "lastExit": last_exit,
                // A3b-1 — 마지막(끝난·또는 실행 중) 명령문. 관제판 위임 로스터가 유휴 세션의
                // "무엇을 했나" 를 한 칸에 보여 준다(없으면 null). `get_last_command` 와 같은 접근.
                "lastCommand": c.last.as_ref().map(|l| l.command_line.clone()),
                // 이력이 **어디에** 있는지만 알려 주는 값싼 숫자다 — AI 가 list_commands 를
                // 아무 세션에나 던져 보지 않게 한다(0 이면 물어볼 것이 없다).
                "commands": c.history.len(),
                // **무엇을 읽을 수 있는가** — `blocks`(보통) / `screen`(tmux 간이 모드).
                // 빈 이력과 "원래 블록이 생기지 않는다" 를 가르는 유일한 칸이다: 이게 없으면
                // AI 는 `commands: 0` 을 "아직 아무것도 안 돌았다" 로 읽고 기다린다.
                "mode": mode_of(c),
                // A3a — 이 항목이 지금 붙어 있는가. 라이브 거울에서 온 항목은 떨어지지 않았으면 true.
                // 떨어진 헤드리스 세션(`dropped`)은 거울에 남아 있으되 connected:false 로 나가 로스터에서
                // '끊김'으로 뜬다(합성 발견 항목은 키가 겹쳐 억눌리므로 '미접속'으로 새지 않는다).
                // 창 타일은 세션 코어가 `disconnected`(SSH 전송로 끊김 — 재접속 대기)면 false 다(2026-10-08 ②-2).
                "connected": !dropped && !link_lost,
                // ②-2 — **창이 이 세션에 붙어 있는가**(세션 코어). 페이지 리로드·웹뷰 크래시 동안 세션과 거울은
                // 살아 있되 붙은 창이 없다 — 그 사이 화면 거울(스크롤백)은 갱신되지 않는다. 끝났거나 끊겼어도 false.
                // 코어에 없는 세션(헤드리스 위임 · 옛 항목)은 null.
                "attached": core_state.map(|s| s == "attached"),
                // ③-3c — 코어의 상태 이름(`attached`·`detached`·`exited`·`disconnected`)과 실행 회차. 코어에 없으면 null.
                // **떨어진 세션의 거울은 지우지 않는다**(GUI 가 꺼져 있어도 셸은 살아 있다) — 대신 `stale` 로 "이 화면 거울은
                // 지금 갱신되지 않는다(붙은 창이 없다)" 를 밝힌다. 거울 값은 그 창이 마지막으로 보낸 것이다(`capturedAt` 참고).
                "state": core_state,
                "sessionEpoch": core_status.map(|(_, e)| e),
                "stale": core_state.is_some_and(|s| s != "attached"),
                // SessionLifecycle — 살아 있던 헤드리스 세션이 떨어졌는가. 창 세션은 언제나 false.
                "dropped": dropped,
                // 라이브 항목은 **언제나 참** — 붙어 있는 세션에게 "설정에 없는 별칭" 은 뜻이 없다
                // (고아 판정은 아직 붙은 적 없는 합성 항목에만 쓴다).
                "aliasKnown": true,
                // **모두 승인**(10-23) — 이 세션의 호스트가 'YOLO' 다(대상이 전부 이런 세션인 작업안은 명령을 가리지 않고 곧바로 자동
                // 승인된다 · 전체 스위치가 켜져 있을 때). AI 가 그 무게를 알고 계획하게 밝힌다 — 별칭은 이미 `label` 에 있다(새로 나가는 것 없음).
                "approveAll": crate::context::ai_approve_all(c, delegation),
                // ── 관제판 호스트별 목록의 네 칸 (2026-09-21) ──────────────────────
                // 어느 계정으로 붙어 있는가 — 로컬 셸은 null(프런트가 셸 이름을 쓴다).
                "user": session_user(&c.kind, &c.label, config),
                // 붙은 시각(epoch ms). 0 은 "모른다" 라 null 로 낸다.
                "connectedAt": (c.connected_at != 0).then_some(c.connected_at),
                // **마지막 활동** — 마지막 블록이 끝난 시각(아직 도는 중이면 시작 시각).
                // 이력이 비면 null 이고, 그때 화면은 `connectedAt` 을 바닥값으로 쓴다.
                "lastActivityAt": c.history.last().map(|b| b.ended_at.unwrap_or(b.started_at)),
                // 어느 창의 타일인가 — 헤드리스는 창이 없으므로 null 이다. 관제판이
                // "이 창" 과 "다른 창" 을 가르는 유일한 값이고, 다른 창의 줄에는 점프가 없다.
                "windowLabel": match c.owner_kind {
                    crate::session_owner::SessionOwnerKind::Delegated => Value::Null,
                    crate::session_owner::SessionOwnerKind::Window if !c.owner.is_empty() => {
                        json!(c.owner)
                    }
                    _ => Value::Null,
                }
            })
        })
        .collect();

    // 미접속 위임 발견 항목 — 헤드리스 접속이 위임됐지만 아직 거울에 없는 별칭만 합성한다(중복은 라이브가
    // 이긴다). 읽기만 준 호스트는 합성하지 않는다 — 그 호스트의 세션은 타일로만 보인다.
    for target in delegation.headless_targets() {
        let id = crate::routing::delegated_stream_id(&target.alias);
        if map.contains_key(&id) {
            continue; // 이미 접속됨 → 라이브 항목이 나갔으니 합성하지 않는다.
        }
        list.push(json!({
            "id": id,
            "code": target.alias,
            "label": target.alias,
            "kind": "ssh",
            "status": Value::Null,
            "running": false,
            "lastExit": Value::Null,
            // 헤드리스 미접속 발견 항목은 이력이 없다 → 마지막 명령문도 없음.
            "lastCommand": Value::Null,
            "commands": 0,
            // 헤드리스는 PTY 가 없어 tmux 에 붙을 수 없다 — 언제나 블록 쪽이다(실행 결과는
            // exec 채널로 오고 `get_operation_results` 가 낸다).
            "mode": MODE_BLOCKS,
            "connected": false,
            // 합성 발견 항목은 **한 번도 붙은 적 없다** — 떨어진 것이 아니므로 dropped 는 아니다
            // (로스터는 이 항목을 '끊김'이 아니라 '미접속'으로 낸다).
            "dropped": false,
            // **고아 위임**의 유일한 단서 — 이 별칭이 아직 `~/.ssh/config` 에 있는가.
            // 호스트 이름을 바꾸면 `delegation.toml` 의 옛 별칭은 영원히 '미접속'으로 남아
            // "언젠가 붙겠지" 처럼 보인다. 그 줄을 로스터가 '설정에 없음'으로 가른다.
            "aliasKnown": match config {
                Some(index) => index.contains_key(&target.alias.to_lowercase()),
                // 설정을 못 읽었다 = 모른다 — 모른다고 고아로 칠하지 않는다.
                None => true,
            },
            // 위임 줄에도 **누구로 붙을 것인가**는 있다 — 아직 안 붙었을 뿐이다.
            "user": session_user("ssh", &target.alias, config),
            // 붙은 적이 없으니 시각도 활동도 없고, 창도 없다.
            "connectedAt": Value::Null,
            "lastActivityAt": Value::Null,
            "windowLabel": Value::Null
        }));
    }

    // 안정된 순서 — id 로 정렬(HashMap 순서는 매번 다르다).
    list.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Value::Array(list)
}

/// 사람 콘솔용 전역 세션 목록(A3b 가 렌더) — 세션 서버 op `console_sessions`(GUI 명령 `list_console_sessions` 가 부른다).
/// MCP `list_sessions` 와 **같은 객체**를 낸다(순수 [`enrich_sessions`] 를 그대로 쓴다). **블로킹**(파일 둘 —
/// `delegation.toml` · `~/.ssh/config`) — 부르는 쪽이 블로킹 풀에서. 잠금이 오염됐어도 목록은 낸다(`into_inner`).
pub(crate) fn console_list(store: &crate::context::Store) -> Value {
    let delegation = crate::delegation::Delegation::load_default();
    let index = config_index();
    let map = store.lock().unwrap_or_else(|e| e.into_inner());
    enrich_sessions(&map, &delegation, index.as_ref())
}

/// `get_last_command` — `{ commandLine, output, exit, running }` 또는 오류.
pub(super) fn get_last_command(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let ctx = shared_entry(map, delegation, args)?;
    // 화면 전용 세션은 **조용히 비어 있지 않다** — 왜 비었는지를 같은 응답에 담는다
    // (오류로 내면 "일시적 실패" 로 읽혀 AI 가 재시도 루프에 들어간다).
    if ctx.screen_only {
        return Ok(json!({ "mode": MODE_SCREEN, "screenOnly": true, "note": SCREEN_ONLY_NOTE }));
    }
    match &ctx.last {
        Some(cmd) => Ok(serde_json::to_value(cmd).unwrap_or(Value::Null)),
        None => Err("No command has run in this session yet".to_string()),
    }
}

/// `get_scrollback` — `{ lines: [...] }`, 최근 N 줄(기본 200, 최대 1000).
pub(super) fn get_scrollback(
    map: &HashMap<String, SessionContext>,
    delegation: &crate::delegation::Delegation,
    args: Option<&Value>,
) -> Result<Value, String> {
    let ctx = shared_entry(map, delegation, args)?;
    let requested = args
        .and_then(|a| a.get("lines"))
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .unwrap_or(SCROLLBACK_DEFAULT)
        .clamp(1, SCROLLBACK_CAP);

    let total = ctx.scrollback.len();
    let start = total.saturating_sub(requested);
    let lines: Vec<&String> = ctx.scrollback[start..].iter().collect();
    Ok(json!({ "lines": lines }))
}
