//! AI 가 읽는 계약 글자 — `initialize` 결과와 핸드셰이크 안내([`INSTRUCTIONS`]), `tools/list` 의
//! 도구 스키마 — 전역 토큰의 13개([`tools_list_result`]) + DB 뒷면이 있을 때의 DB 도구 7개(권한과 무관하게 늘 — `mcp/db.rs` · 쿼리 타일 3a · 3b,
//! [`tools_list_result_for`]) · 역할별 목록([`tools_list_for`] — 조정자는 전역과 같은 목록 + 조율 도구, 작업자는 작업자 도구만, 검토자는 검토 도구만 ·
//! 조율 도구 스키마는 `crate::orchestration`). 전부 영어다(MCP 표면은 표시 언어를 타지 않는다 — i18n.rs 머리말).
//!
//! 불변식:
//! - 13개 도구는 전부 읽기·계획이다. 작업안 도구 설명은 하나같이 **"이 도구는 명령을 실행하지 않는다"** 를 못 박는다.
//! - 조율 도구(조정자 — 2026-10-14)는 자기 Run 의 Task 를 정의 · 갱신하고 기다릴 뿐이다 — 명령 실행 · PTY 입력은 없다.
//! - 승인·실행·취소·키 전송·권한 응답 도구와 위임 쓰기 도구는 **어느 역할의** 목록에도 없다 — 승인은 사용자가 앱에서만 한다.
//! - DB 도구는 구조 · 읽기 조회 · **쓰기 작업안 초안**(3b — `create_db_write_plan`, 저장만 · 사람 승인 · 자동 승인 없음)이다. `db_query` 설명은
//!   **"행이 모델 제공자로 간다"** 를 밝힌다. 목록 · 권한 판정은 전역이든 조정자든 같다(작업자에게는 없다) — 목록은 단계를 타지 않고
//!   판정은 호출마다 서버다(2026-11-09 — CLI 가 목록을 캐시하므로 권한을 올리면 재연결 없이 바로 쓰이게).

use serde_json::{json, Value};

use super::*;

/// `initialize` 가 돌려주는 프로토콜 버전 (모듈 문서의 "프로토콜 버전" 참고).
pub(super) const PROTOCOL_VERSION: &str = "2024-11-05";

/// `initialize` 결과.
///
/// `instructions` 는 **접속하는 AI(Claude·Codex 등)가 핸드셰이크에서 받는 CLI-무관 안내**다 —
/// 이 서버가 읽기·계획 전용이고 무엇도 실행하지 않는다는 것, 그리고 정점 루프의 순서를 알려 준다.
/// 요점은 둘이다: 승인은 오직 사용자가 앱에서 한다(이 서버로는 불가) · 그러니 [`wait_for_operation`]
/// 으로 **잠깐만**(합쳐 5분쯤) 기다리고 그래도 대기면 **사람에게 턴을 넘겨라** — 승인하는 순간
/// 앱이 혼자 돌리고 결과는 남는다(docs/log/2026-09-22-wait-for-operation.md).
/// 안내의 갈래 — 오케스트레이션 절은 **조율 도구가 목록에 실리는 프로듀서 채팅**에만 싣는다(설계 3-6 · 2단계 2-7). 타일은 맡긴 저장소가 있으면
/// 안내 한 줄([`TILE_ORCHESTRATION_HINT`]). 작업자 · 검토자는 작업자 한 줄.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Instructions {
    Base,
    /// 사람이 이미 연 앨범의 프로듀서(옛 start_run 안내를 받지 않는다).
    Album,
    /// 로컬 AI 타일 · 감싸개 셸 타일 + 맡긴 저장소 하나 이상 — 기본 안내 + 한 줄(조율 도구는 없다).
    TileHint,
    Worker,
    /// 사이드 채팅(5단계 — `mcp/chat_read.rs`) — 기본 안내 대신 짧은 연결 안내 하나(작업안 · DB 절이 없다 · 그 도구가 없다).
    SideChat,
}

/// `initialize` 결과 — 갈래([`Instructions`])마다 안내 글이 다르다.
pub(super) fn initialize_result_for(kind: Instructions) -> Value {
    let text = match kind {
        Instructions::Base => INSTRUCTIONS.to_string(),
        Instructions::Album => format!("{INSTRUCTIONS} {ALBUM_INSTRUCTIONS}"),
        Instructions::TileHint => format!("{INSTRUCTIONS} {TILE_ORCHESTRATION_HINT}"),
        Instructions::Worker => format!("{INSTRUCTIONS} {WORKER_INSTRUCTIONS}"),
        Instructions::SideChat => super::chat_read::INSTRUCTIONS.to_string(),
    };
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": MCP_NAME, "version": "0.1.0" },
        "instructions": text
    })
}

/// 새 길의 계약. 구성과 검증 명령은 사람이 이미 고른 값이며 MCP 쓰기 도구는 없다.
const ALBUM_INSTRUCTIONS: &str = "\
Orchestration (Aynx): the album is already open. Call get_run first without arguments to read runId and gen. \
Pass runId and gen on every other coordination call. Retry the same write with the same requestId; use a new requestId for a different call. \
Split the work into tasks whose changes do not overlap, then spawn_worker with an artist id from get_run roles; never implement in the main working folder yourself. \
Only a person changes the album's artists, permissions or verification command. If an artist cannot do the work (role-read-only, a blocked report, a missing artist), tell the person exactly what to change in [Album permissions] and stop. \
After they widen the album's permissions continue the same idle worker with send_prompt. On busy wait_run until=ready with the attemptIds it returns. \
Read reports with get_diff and read_worker; obtain the judgments acceptRules require before accepting with update_task. On rework-limit stop and tell the person. \
The app runs verification; only a person can override a failure. If get_run shows persist.ok false, tell the person. \
When everything is accepted call complete_run and report the exported branch; you cannot merge: a person merges into main with [Merge] on the album page, or the album merges itself after you complete it if the person turned on auto-merge. Mention auto-merge only when the complete_run result has an autoMerge field. \
If this chat restarted or was opened to take over, call adopt_run only for the album in your producer instructions. A run a person paused stays paused until they resume it; tell them its state and end your turn.";

/// 타일의 안내 한 줄(2단계 2-7 · 사용자 결정 U3) — 맡긴 저장소가 하나라도 있는 PC 의 로컬 AI 타일 · 감싸개 셸 타일. 조율 도구는 목록에 없다
/// (불러도 모르는 도구 — `orchestration::is_tool_for`).
pub(super) const TILE_ORCHESTRATION_HINT: &str = "\
Orchestration (Aynx): albums that split work across several workers open only from the producer chat of the Aynx orchestration tab — \
to split work across workers, tell the person to open the Aynx orchestration tab or use [Continue in orchestration] on this tile (the conversation is copied there).";

/// 작업자 · 검토자 한 줄(헤드리스 턴 — 역할별 실패 지침은 턴 지침 파일에 있다 · `orchestration::spawn`).
pub(super) const WORKER_INSTRUCTIONS: &str = "\
If you were started as an orchestration worker, commit your work with commit_changes (the app runs git for you — selection \"all\" or a list of files) and call report_done exactly once when you finish (also when you failed or are blocked). \
If you were started as a reviewer, call report_review exactly once.";

/// 핸드셰이크에서 내보내는 기본 안내(모듈 문서·[`initialize_result_for`] 참고) — 모든 호출자. 오케스트레이션 절은 [`ORCHESTRATION_INSTRUCTIONS`].
pub(super) const INSTRUCTIONS: &str = "\
This server (the session server of the aynx app) is a **read-and-plan-only** MCP server that serves context from several remote sessions — it runs nothing. \
The user decides in the app which sessions are visible: a remote (SSH) session follows its host's AI permission (Read or higher — the same for every tile of that host and for its headless sessions), and a local session is visible only while 'allow AI to read' is on for that tile (sessions you may not read are hidden entirely). \
Only remote sessions whose host's AI permission is 'Ask' or higher can be task plan targets — local sessions never can. \
The loop: \
1. Read — look at the state with list_sessions and get_session_snapshot. \
2. Propose — save a task plan (draft) with create_execution_plan: 'run this command on these targets'. \
Every plan (create_execution_plan and create_db_write_plan) needs a `summary` (plain text for the person approving it: what it does and why, at most 300 characters) and an `effect` (read, write or delete — the strongest thing it does). \
`reason` is optional: add it only when there is a why beyond the summary — it is kept in the run record and shown when the person expands the card. The person sees your summary marked as written by AI beside the app's own analysis of the raw command or SQL; if your effect is weaker than what the app finds, the card turns red and asks for a second click — so declare it honestly. \
3. Ask for review — ask the user to review it with request_execution. \
4. Wait — call wait_for_operation (it blocks server-side until the state changes, 60 s per call, 120 s at most) instead of polling get_operation in a loop. \
5. Read the results — read per-target output (stdout/stderr, exit code) with get_operation_results and decide what to do next. \
**Only the user approves and runs, in the app — this server can neither approve, run nor cancel.** \
**But the app itself runs the plan the moment the user approves — you do not have to be there for it, and the results stay readable afterwards.** \
So wait with wait_for_operation for **about 5 minutes in total** (a few calls) and no longer. \
If it is still awaitingApproval (or approved/running) when you stop waiting, hand the turn back to the user: tell them, in the user's own language, \
what is waiting, until when, and that the app will run it without you — e.g. 'Task plan «title» is awaiting your approval in aynx until HH:MM. The app runs it once you approve; tell me to continue and I will read the results.' \
(`expiresAt` is that time). Then **end your turn**. Do not keep waiting, and do not fall back to polling get_operation in a loop. \
When the user tells you they have approved, call get_operation and then get_operation_results. \
A review request expires at `expiresAt` (null = never; `approvalTtlSeconds` says how long the window is). \
If it comes back `expired`, tell the user that nobody approved it in time and do not silently re-request it. \
If the user turned it on, some task plans can be auto-approved without waiting for a person, but only when the **whole command** falls inside the allow list the user wrote \
(read the current scope with get_auto_approval_policy — it is read-only, and this server cannot change that policy). \
A session with `approveAll:true` in list_sessions (and a database with aiLevel 'all') is set to 'YOLO' by the user: while auto-approval is on, a plan whose targets are **all** such sessions (or that one database) \
is approved and run **at once, with no allow-list check and no person** — so plan there as carefully as if you ran it yourself. \
To be eligible for auto-approval, put **one simple command** in a task plan (or only allowed commands joined with `&&`), pass the directory as the **cwd argument** instead of `cd … &&`, \
and do not use redirects (> <), substitution ($ `) or subshells; use pipes (|) only if the policy says allowPipes, and then every stage must be allowed. Everything else waits for a person's approval — the same rule applies there: wait about 5 minutes, then hand the turn back. \
Look at a session's `mode` first: a session with `mode:\"screen\"` (attached through tmux, a 'screen-only session') **never** gets command blocks, \
so the block tools (get_last_command, list_commands, get_command, compare_command_results) return empty; read those sessions with get_scrollback. \
Databases: the db_* tools are always listed, but list_db_connections shows only the connections the user has shared with AI in the app (a connection set to Off never appears), \
and a call that needs more than a connection's AI permission is refused. When the user changes a permission in the app it applies from your next call — no reconnect needed. \
Start with list_db_connections (connId, engine, aiLevel), then read the structure with db_list_schemas, db_list_objects, db_describe_table and db_get_definition \
('Schema' or higher — no rows leave), and only then query with db_query ('Read' or higher). \
db_query is always read-only and runs on a separate AI-only connection — never the user's query tile or its transaction — and **the rows you read are sent to your model provider**, \
so keep queries narrow (filters, aggregates, LIMIT) and do not dump tables. \
To change data, a connection must be at 'Ask' or higher: propose a **database write plan** with create_db_write_plan (connId, statements — one SQL statement per item, \
maxAffected — required, count first with db_query), then request_execution, wait_for_operation and get_operation_results exactly like a task plan. \
It changes nothing until it is approved: a person approves it in the app (the auto-approval allow list never applies to database plans), \
except on a connection at 'YOLO' (aiLevel 'all'), where it is approved **at once, without a person** while the user's auto-approval switch is on; the app then runs all statements in one transaction on a separate write connection \
and rolls everything back if a statement fails or the affected rows exceed maxAffected. This server itself cannot write to a database, approve or run a plan, change a connection's AI permission, or read passwords. \
While a person keeps the connection open in a query tile, AI connections reuse the password that tile authenticated with (typed or from the vault) — also while aynx is locked; it is cleared when the last tile closes or the connection's target changes. Otherwise an AI connection uses the password stored in the vault — only on a connection the user allowed to open without a query tile (headless:true in list_db_connections; false means ask the user to open it in a query tile), and the vault must be unlocked. A SQLite connection has no password but follows the same rule: without a query tile it opens only when headless is true. \
If a tool says a person must open the connection in a query tile, save its password or unlock the vault, tell the user exactly that instead of retrying.";

/// `tools/list` 결과 — 도구 13개와 각 JSON Schema(읽기 7 + 단계 8 작업안 3 + 검토 대기 롱폴 1
/// + 단계 9 결과 읽기 1 + 자동 승인 정책 읽기 1). 전부 읽기/계획이다.
///
/// 설명은 **AI 가 읽는 유일한 계약 문서**다. 읽기 도구는 셋을 반드시 말한다: 옵트인된 세션만
/// 보인다 · 이력은 메모리에만 있고 세션이 사는 동안만 산다 · 출력은 발췌라 `truncated` 가 붙는다.
/// 작업안 도구 셋은 하나같이 **"이 도구는 명령을 실행하지 않는다"** 를 못 박는다 — 실행 경로는
/// 이 서버에 없다(단계 8: 저장 + 검토 요청뿐).
#[cfg(test)]
pub(super) fn tools_list_result() -> Value {
    tools_list_result_for(false)
}

/// [`tools_list_result`] + DB 도구 일곱(`with_db` = DB 뒷면이 있나 — 권한과 무관하게 늘 전부, `mcp/db.rs` `tool_schemas`).
pub(super) fn tools_list_result_for(with_db: bool) -> Value {
    let mut v = base_tools();
    if with_db {
        if let Some(list) = v.get_mut("tools").and_then(Value::as_array_mut) {
            list.extend(super::db::tool_schemas());
        }
    }
    v
}

/// 호출자에 따른 `tools/list`(2026-10-14 · 3차 5단계 · 2단계 2-7) — 전역 · **타일** = 13개 + DB 도구 일곱(**조율 도구 없음** — 타일은 자리가
/// 되지 못한다) · (시험의) 조정자 = + 타일 도구 + 조율 도구 · 프로듀서 채팅 = 13(작업안은 칸) + DB + 타일 도구 + 조율 도구 · 작업자 = 작업자 도구만
/// (DB 도구 없음). **목록은 조정자가 돼도 · DB 권한이 바뀌어도 바뀌지 않는다**(Codex 는 대화 중 목록 갱신을 받지 않는다 — 설계 3-3 · 2026-11-09).
/// `db` 는 DB 뒷면이 있나(전역 · 타일 · 프로듀서에게 같다 — 작업자에겐 쓰지 않는다 · 권한은 호출마다 서버). `orchestration` 은 프로듀서의 "작업안 도구를 싣나".
pub(super) fn tools_list_for(caller: &crate::orchestration::Caller, db: bool, orchestration: bool) -> Value {
    use crate::orchestration::Caller;
    match caller {
        Caller::Global | Caller::Tile { .. } => tools_list_result_for(db),
        Caller::Coordinator { .. } => {
            let mut v = tools_list_result_for(db);
            if let Some(list) = v.get_mut("tools").and_then(Value::as_array_mut) {
                list.extend(crate::orchestration::tile_tool_schemas());
                list.extend(crate::orchestration::coordinator_tool_schemas());
            }
            v
        }
        Caller::Worker { .. } => json!({ "tools": crate::orchestration::worker_tool_schemas() }),
        // 검토자(5단계) — 검토 도구 셋만(DB · 13개 · 조율 도구 없음).
        Caller::Reviewer { .. } => json!({ "tools": crate::orchestration::reviewer_tool_schemas() }),
        // 사이드 채팅(5단계) — 세션 읽기 도구 일곱만(DB · 작업안 · 조율 없음). **늘 같다** — 연결 여부는 호출마다 서버가 판정한다.
        Caller::SideChat { .. } => super::chat_read::tools_list(),
        // 프로듀서 채팅(2단계 단계 2 — 설계 2-7): 13 + DB + 타일 도구 + 조율 도구 전부 — 작업안 도구(DB 쓰기 초안 포함)는 띄울 때의 "프로듀서
        // 작업안 도구" 값(`orchestration` 자리에 rpc 가 넣는다)이 켜졌을 때만. 목록은 그 프로세스 동안 고정이다.
        Caller::Producer { .. } => {
            let mut v = tools_list_result_for(db);
            if let Some(list) = v.get_mut("tools").and_then(Value::as_array_mut) {
                if !orchestration {
                    list.retain(|t| !t["name"].as_str().is_some_and(|n| super::rpc::PRODUCER_PLAN_TOOLS.contains(&n)));
                }
                list.extend(crate::orchestration::tile_tool_schemas());
                list.extend(crate::orchestration::coordinator_tool_schemas());
            }
            v
        }
    }
}

/// 전역 토큰의 13개(설정 화면의 도구 목록도 여기서 읽는다 — `insight.rs`).
pub(super) fn base_tools() -> Value {
    json!({
        "tools": [
            {
                "name": "list_sessions",
                "description": "The AI-readable open sessions (remote: the host's AI permission is Read or higher; local: the tile allows AI to read), each with the state and exit code of its last command and how many blocks it holds (commands). \
    Each session's `code` (e.g. p2, t7·p2) is **exactly what the user sees in the tile header**, so use it when pointing a person at a tile (two sessions with the same label still differ by code). \
    The `session` tool argument still takes the exact `id`. \
    `mode` says what can be read in that session: `\"blocks\"` (the usual — command block history accumulates) or `\"screen\"` (attached through tmux, a 'screen-only session' — \
    shell integration markers do not survive tmux, so blocks are **never** created). A session with `mode:\"screen\"` is always empty in the block tools, so read it with get_scrollback.     `attached:false` means no app window is showing that tile right now (the window was closed, the app is in the tray or reloading — the shell and the connection are still alive).     While no window is attached the session server keeps the mirror itself (`mirror:\"server\"` — scrollback, last command and new command blocks stay live; `mirror:\"window\"` while a window shows it).     `stale:true` means nobody refreshes it any more (the session ended or the link dropped) — what you read is the last state; `null` for headless sessions.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            },
            {
                "name": "get_last_command",
                "description": "The last command of one session: command line, output, exit code and whether it is still running. \
    A `mode:\"screen\"` session (tmux) has no command blocks, so it returns `{mode:\"screen\", screenOnly:true, note}` — that is 'none by nature', not an empty result.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "session": { "type": "string", "description": "the id from list_sessions" } },
                    "required": ["session"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_scrollback",
                "description": "The most recent scrollback lines of one session (200 by default, 1000 at most).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "session": { "type": "string", "description": "the id from list_sessions" },
                        "lines": { "type": "number", "description": "how many recent lines to return (200 by default, 1000 at most)" }
                    },
                    "required": ["session"],
                    "additionalProperties": false
                }
            },
            {
                "name": "list_commands",
                "description": "Lists the **completed** command block history of one session, **newest first** (metadata only — output text is left out to keep the list light; get the body with get_command). \
    Only AI-readable sessions are visible. The history lives **in memory** only and **only while the session is alive**, up to 200 blocks per session (past that the oldest ones fall off). \
    A command that is **running right now** is not in this list — see get_last_command. \
    A `mode:\"screen\"` session (tmux) is always an empty list, with `screenOnly:true` and `note` attached — waiting will not fill it, so use get_scrollback.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "session": { "type": "string", "description": "the id from list_sessions" },
                        "limit": { "type": "number", "description": "how many recent blocks to return (50 by default, 200 at most)" }
                    },
                    "required": ["session"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_command",
                "description": "Returns one command block of a session together with an excerpt of its output. id is the number from list_commands or the string \"last\" (the most recent block). \
    Only AI-readable sessions are visible. The output is an **excerpt** (first 20 lines + last 500 lines) and truncated:true says something was cut — the full live buffer is not served yet (fullAvailable is always false), \
    so use get_scrollback when the excerpt is not enough. excerpt.capture is complete (everything), partial (the middle was cut) or unavailable (the marker scrolled out of the buffer, so the output could not be read) — \
    with unavailable, empty head/tail means \"could not read\", not \"no output\". excerpt.bytes is the excerpt's size in **UTF-8 bytes**. \
    The history is in memory only, alive only with the session and capped at 200 blocks, so a number that fell off is an error. \
    A `mode:\"screen\"` session (tmux) has no blocks at all, so it errors saying exactly that (different from a number that fell off).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "session": { "type": "string", "description": "the id from list_sessions" },
                        "id": {
                            "description": "a block number (the id from list_commands) or \"last\"",
                            "type": ["number", "string"]
                        }
                    },
                    "required": ["session", "id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_session_snapshot",
                "description": "A single-glance snapshot of one session: id, code, label, kind, status, mode (blocks|screen — same meaning as in list_sessions), cwd (the folder of the most recent block), last (the last command's commandLine, exit and running, plus the last block's startedAt/endedAt), commands (how many blocks it holds), scrollbackLines (the **number** of scrollback lines only — the content comes from get_scrollback), capturedAt, contextVersion. \
    Only AI-readable sessions are visible. capturedAt is not when this snapshot was made but **when the mirror was last refreshed (epoch ms)**, and contextVersion is a counter that rises with every refresh — together they answer \"is this state current?\" so that stale state is not mistaken for the present.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "session": { "type": "string", "description": "the id from list_sessions" } },
                    "required": ["session"],
                    "additionalProperties": false
                }
            },
            {
                "name": "compare_command_results",
                "description": "Folds **the results of the same command** across several sessions, grouping identical output so the differences stand out (e.g. run the same check on several hosts, then find the outlier). \
    With command, the target in each session is the **most recent** block whose commandLine **contains** it (an exact match counts); without it, the target is each session's **last block**. \
    With sessions (an array of ids) only those sessions are compared; without it **every AI-readable session** is (sessions you may not read drop out silently). \
    In the result, groups folds together the sessions that share the same (exit, output excerpt): one group means they all agree, two or more are exactly the difference (ordered by session count descending — the small groups are the outliers). \
    A session whose target block was not found leaves only its id in unmatched. summary holds sessionsCompared, distinctGroups and matched. \
    The excerpt and history limits are the same as in list_commands/get_command (memory only, alive with the session, an excerpt so truncated is possible). \
    A `mode:\"screen\"` session (tmux) has no block to compare, so it goes to unmatched, and those sessions are also listed separately in the `screenOnly` array.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "target the most recent command block in each session whose command line contains this string. Omit it for each session's last block." },
                        "sessions": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "an array of session ids to compare (the ids from list_sessions). Omit it for every shared session."
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "create_execution_plan",
                "description": "**Saves a task plan (draft)**: run this same command on these target sessions, this way. \
    ⚠️ This tool does not run the command. It only saves the plan and asks the user to review it — nothing goes out to a PTY or over SSH. \
    targets are the ids from list_sessions. Only remote sessions whose host's AI permission is **'Ask' or higher** can be targets — tiles and delegated hosts (headless sessions) alike; local sessions and hosts that are not in the host list never can (any other id drops out silently, and it is an error when none is left — permission to read is not consent to run). \
    Returns: operationId, the saved plan (state=draft), requestedAt and expiresAt (both null until you ask for review) and approvalTtlSeconds — how long a review request will stay open (null = review requests never expire). \
    summary and effect are required: the review card shows your summary (marked as written by AI) next to the app's own analysis of the command, and a mismatch is flagged in red. \
    Follow it with request_execution to ask for review.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "the command line to run on the targets (saved only — not run)" },
                        "summary": { "type": "string", "description": "required — plain text for the person approving it: what this does and why, in their language (300 characters at most, no markup)" },
                        "effect": { "type": "string", "enum": ["read", "write", "delete"], "description": "required — your honest declaration of the strongest effect on the targets; the app analyses the raw command itself and flags a weaker declaration to the person" },
                        "targets": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "an array of target session ids (the ids from list_sessions). Only shared ones are kept."
                        },
                        "cwd": { "type": "string", "description": "the working directory to run in (optional). With it the command runs there as 'cd -- <dir> && (command)'. Without it, the login default directory." },
                        "validate": { "type": "string", "description": "a check command to run on the canary target after the canary succeeds. It must exit 0 before the rest follow." },
                        "mode": { "type": "string", "description": "how to run it (free string, metadata — not interpreted; execution is always a sequential canary). Default adhoc" },
                        "strategy": { "type": "string", "description": "rollout strategy (free string, metadata). Default rolling" },
                        "concurrency": { "type": "number", "description": "how many run at once (metadata). Default 1" },
                        "timeoutSeconds": { "type": "number", "description": "per-target timeout in seconds (metadata). Default 60" },
                        "title": { "type": "string", "description": "a human-readable title (optional)" },
                        "reason": { "type": "string", "description": "optional — why, only when there is a reason beyond the summary (not a second summary); kept in the run record and shown when the person expands the card" },
                        "idempotencyKey": { "type": "string", "description": "idempotency key (optional). Calling again with the same key returns the existing plan instead of creating a new one — so a retry does not run twice." }
                    },
                    "required": ["command", "targets", "summary", "effect"],
                    "additionalProperties": false
                }
            },
            {
                "name": "request_execution",
                "description": "Asks the user to review a task plan (state draft→awaitingApproval). \
    ⚠️ This tool does not run the command — the user reviews it **in the app** and approves, rejects or edits the targets; this server (MCP) has no approve or run path. \
    After asking, wait with wait_for_operation (it blocks until the state changes, 60 s per call) — do not poll get_operation in a loop. \
    Wait **about 5 minutes in total**, then stop: if it is still awaitingApproval, tell the user in their own language that the plan is waiting for their approval in aynx until `expiresAt`, \
    that **the app runs it as soon as they approve — you do not need to stay** — and that the results stay readable, ask them to tell you once they have approved, and **end your turn**. \
    A review request expires at `expiresAt` (null = never); if it comes back `expired`, tell the user nobody approved it in time and do not silently re-request it. \
    Returns: the updated task plan with requestedAt, expiresAt and approvalTtlSeconds (null = review requests never expire).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "operationId": { "type": "string", "description": "the operationId returned by create_execution_plan" }
                    },
                    "required": ["operationId"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_operation",
                "description": "Returns the current state and fields of one task plan. \
    ⚠️ This tool does not run the command — it reads (saving a plan and asking for review are separate from actually running it). \
    Besides draft, awaitingApproval, rejected and expired, state also takes the values the execution broker sets once the user approves in the app: approved, running, succeeded, partial, failed, cancelled — this tool only reads that state, it neither approves nor runs. \
    A task plan waiting for review carries requestedAt (when it was sent for review) and expiresAt (when the review request runs out; null = never), plus approvalTtlSeconds for the current window. \
    Use this tool for a **single** check (for example when the user comes back and says they approved). To wait for a state change, call wait_for_operation instead — do not poll this tool in a loop. \
    If it comes back `expired`, tell the user nobody approved it in time and do not silently re-request it. \
    This tool gives the **aggregate** state only — per-target output (stdout/stderr, exit code) is read with get_operation_results.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "operationId": { "type": "string", "description": "the operationId returned by create_execution_plan" }
                    },
                    "required": ["operationId"],
                    "additionalProperties": false
                }
            },
            {
                "name": "wait_for_operation",
                "description": "Waits **server-side** until a task plan leaves the waiting states (awaitingApproval, approved, running), then returns the same fields as get_operation plus `timedOut` (true = the wait ran out while it was still waiting) and `waitedSeconds`. \
    ⚠️ This tool runs, approves and cancels nothing — it only waits and reads. \
    Use it instead of calling get_operation in a loop: one call replaces dozens, and it returns within milliseconds of the state actually changing. \
    timeoutSeconds is 60 by default and is clamped to 1..120. A plan in any other state (draft, rejected, expired, succeeded, partial, failed, cancelled) returns immediately with timedOut:false. \
    **Do not wait forever.** After request_execution, call this tool a few times — **about 5 minutes in total**, no more. \
    If it is still awaitingApproval (or approved/running) when you stop, tell the user in their own language that the plan is waiting for their approval in aynx until `expiresAt`, that **the app runs it as soon as they approve, so you do not need to stay**, that the results stay readable, and ask them to tell you once they have approved — then **end your turn**. \
    When the user comes back, call get_operation and then get_operation_results.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "operationId": { "type": "string", "description": "the operationId returned by create_execution_plan" },
                        "timeoutSeconds": { "type": "number", "description": "how long to wait in this one call, in seconds (60 by default, clamped to 1..120)" }
                    },
                    "required": ["operationId"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_operation_results",
                "description": "Reads the **per-target execution results** of one task plan (read-only — this tool does not run, approve or cancel). \
    Each target: id (= the id from list_sessions = streamId), code (the tile position, only while it is shared), state (pending, running, succeeded, failed, timedOut, cancelled), exitCode, stdout, stderr, startedAt, endedAt, errorClass, outputTruncated, stdoutTruncated, stderrTruncated, redacted. \
    It returns **as much as exists right now** regardless of the aggregate state, so partial results can be read as progress while it runs (meant for polling). \
    The output is an **excerpt** (each target and stream has a cap; past it the tail is kept and outputTruncated:true). stdoutTruncated / stderrTruncated are true when the beginning of that stream was already dropped at capture time (only the last 64 KiB were kept). \
    A target you may no longer read after the run (its host's AI permission was turned Off, or the tile's 'allow AI to read' was turned off) has its stdout/stderr emptied and redacted:true set — the state, exit code and timestamps stay. \
    Reading per-target output with this tool after get_operation shows a terminal state is the last step of the loop.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "operationId": { "type": "string", "description": "the operationId returned by create_execution_plan" }
                    },
                    "required": ["operationId"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_auto_approval_policy",
                "description": "Reads the **auto-approval scope** the user configured (read-only — this tool changes no policy and approves or runs nothing). \
    Auto-approval is **off by default**, and even when it is on a plan is approved without a person **only when the whole command falls inside this scope**. One step outside and it waits for a person. \
    Returns: enabled (whether auto-approval is on) · allowPipes (whether pipes may be auto-approved) · allow (flat patterns — a command must start with one of them on a **word-boundary prefix**) · rules (exec+subcommands rules; an exec whose subcommands are empty passes even with flags attached — unless the rule also carries argument limits: deny_flags (any of these flags anywhere, incl. bundled short flags like -fn and abbreviations like --fol, means manual), allow_flags (only these flags), require_flags (must be present exactly), first_arg (the first non-flag word after the subcommand must be absent or one of these; a trailing * is a prefix), max_args (at most this many non-flag words after the subcommand)) · \
    caps{maxTargets,maxConcurrency} · rateLimit{maxPerWindow,windowSeconds} · delegationAutoExecute{anyGranted,grantedCount} (only how many headless targets are delegated for unattended execution — aliases and hosts are never exported) · note. \
    To aim for auto-approval: put **one simple command** in a task plan (or join only allowed commands with `&&`, `||`, `;` — **every** segment must be on the allow list on its own), \
    pass the directory as the **cwd argument** instead of `cd … &&` (cd is just another executable, so the whole command goes manual when it is not on the list), \
    use pipes (|) only if allowPipes is true — then every stage must be allowed on its own, a stage that runs another command (xargs, sh, env, sudo, tee, find -exec …) is never allowed, and pipes cannot be mixed with `;` or `||`; \
    do not use redirects (> <), substitution ($ `), subshells (()) or background (&) — one of them and the whole command is manual. \
    Commands that look dangerous (rm, sudo, chmod, kill, reboot, systemctl restart, …) are not auto-approved even if you put them on the allow list.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            }
        ]
    })
}
