//! **사이드 채팅 프로세스 표**(v2 2단계 — 설계 docs/log/2026-10-23-side-chat-v2-design.md 1절 · 2절 · 4절) — 세션 서버 프로세스에 한 벌.
//! 열쇠는 채팅 id(`side_chat::store::id_ok` 모양 — 그 채팅 폴더 이름), 값은 보는 창들(창 · 연결 — 2026-11-01 여럿) · 대화 id · 연결 · 그리고 **프로세스
//! 칸**([`chat_proc::Core`] — 세대 `ProcId` · 잡에 든 CLI 하나 · 그 stdin · 어댑터(`side_chat::{claude,codex}`) · 상태 · 사건 번호(`seq`) ·
//! 지금 턴 꼬리 · 기다리는 권한 요청). 프로세스 몸(띄우기 · 세 스레드 · 걸음 · 끝)은 공용 코어 `server::chat_proc`(오케스트레이션 2단계
//! 단계 1 에서 이 파일에서 옮겨 감 — 프로듀서 레지스트리가 같은 코어를 쓴다)이고, 이 파일은 그 주인([`chat_proc::Host`])이다.
//! **세션 코어(`session_core`)에 오르지 않는다** — 떨어진 세션 목록 · MCP 에 섞이지 않고,
//! 출력 프레임 · ACK 크레딧도 쓰지 않는다(그것은 세션 임대의 바이트 흐름). 본보기는 `db::table`(같은 꼴의 자원 표).
//!
//! ## op(`serve` 가 블로킹 풀 태스크로 — 판 21 · [`super::ipc::frame::SIDE_CHAT_VIEWERS_PROTOCOL`])
//!
//! | op | 등급 | 몸 → 답 |
//! | --- | --- | --- |
//! | `side_chat_open` | 쓰기 | `{chat, cli, model, effort?, mode: {kind: fresh} \| {kind: resume, conv, project?} \| {kind: fork, from}, window}` → 스냅숏(아래) · **띄우지 않는다**(뜻만 적는다) · 같은 채팅 · 같은 CLI 면 다시 붙기 · `fork` · `project` 는 아래 "타일 대화 이어 가기" |
//! | `side_chat_send` | 쓰기 | `{chat, epoch, text, clientId?, linkName?, images?, files?}` → `{epoch, link}` · 프로세스가 없으면 **여기서 띄운다**(악수 · 준비를 기다려 — `turn::START_MS`) · `images` = 붙인 그림 경로(첨부 자리 안만 — `chat_images`) · `files` = 그림 밖 첨부(판 32 — 첨부 자리 안만 · 서버가 채팅 자기 폴더의 `attachments/` 에 사본 — `chat_files`) |
//! | `side_chat_interrupt` | 쓰기 | `{chat, epoch}` → bool(끊기를 보냈나 — 도는 턴이 없으면 false) |
//! | `side_chat_set_model` | 쓰기 | `{chat, epoch, model}` → bool(산 프로세스에 보냈나 — 없으면 다음 띄우기에 쓴다) |
//! | `side_chat_set_effort` | 쓰기 | `{chat, epoch, effort: 낱말 \| null}` → bool(산 프로세스에 보냈나 — 없으면 다음 띄우기의 `--effort` · 첫 `turn/start`) · `null` = CLI 기본 · 악수가 알린 목록 밖이면 `[bad-effort]` |
//! | `side_chat_decide` | 쓰기 | `{chat, epoch, requestId, decision: allow\|deny, message?}` → true · 기다리는 요청이 아니면 `[unknown-request]` |
//! | `side_chat_close` | 쓰기 | `{chat}` → bool(표에 있었나) · 프로세스는 잡째 끝낸다 |
//! | `side_chat_attach` | 읽기 | `{chat, window}` → 스냅숏 · 그 창을 보는 창에 **덧붙인다**(F5 · 웹뷰 크래시 뒤 새 페이지 · 다른 창) · 없으면 `[session-gone]` |
//! | `side_chat_list` | 읽기 | `{}` → `[{chat, cli, model, effort, epoch, status, conversationId, viewers, detached}]`(`viewers` = 보는 창 **수** — 남의 창 라벨은 돌려주지 않는다) |
//! | `side_chat_link` | 쓰기 | `{chat, epoch?, stream: 스트림 \| null}` → `{link, changed}` · 서버 거울의 창 타일만(`[bad-link]`) · 바뀌면 다음 보내기에 연결 머리글(5단계 — 아래 "연결") |
//! | `side_chat_seen` | 쓰기 | `{chat, epoch, seq}` → `{sent}` · 어느 창에서 사람이 그 채팅의 턴 끝(사건 `turnEnded` 의 `epoch` · `seq`)을 봤다 — 표는 그대로 · 그 채팅이 표에 있고 세대가 같고 번호가 앞서지 않으면 `side-chat-seen{chat, epoch, seq}` 방송(판 31 — 아래 "완료 확인 공유") |
//!
//! 스냅숏 = `{link, chat, cli, model, effort, epoch, leaseEpoch, seq, status, conversationId, cwd, forkFrom, liveTurn: [Ev], pending: [Ev]}`
//! (`link` = `null` \| `{stream, code, label, kind, readable, closed}` · `cwd` = CLI 가 도는 폴더(`null` = 채팅 자기 폴더) — 화면의 이름표일
//! 뿐 다시 받지 않는다) — 그 뒤 사건은
//! `side-chat-event{windows, chat, epoch, seq, ev}`(`windows` = 지금 보는 창 라벨들 · `seq` 는 채팅마다 1씩 — 빈틈이면 다시 attach). 옛 `epoch` 는
//! `[stale-chat]`. `leaseEpoch` 는 그 채팅에 창이 붙을 때마다 +1.
//!
//! ## 보는 창 여럿(2026-11-01 — 원격 웹 창의 사이드 채팅 · docs/log/2026-11-01-remote-side-chat.md)
//!
//! 예전에는 임대 하나(창 · 연결)를 `open` · `attach` 가 덮어써, 원격 창이 붙으면 주 창이 소리 없이 끊겼다. 이제 **보는 창 목록**(창 라벨 +
//! 연결 · 같은 라벨은 하나)이고 `open` · `attach` 는 덧붙인다. 사건 몸의 `windows` 에 그 라벨을 모두 싣고 GUI 가 그 창들의 통로로만 보낸다.
//! [`detach_window`] 는 그 창 하나만 뗀다 · [`conn_gone`] 은 그 연결의 창들을 뗀다. **떼어 둠(TTL)은 보는 창이 0 이 된 순간부터**다(프로듀서
//! `server::producer` 의 구독 0 → TTL 과 같은 꼴). 두 창이 같은 권한 카드에 답하면 먼저 온 것만 먹고 둘째는 `[unknown-request]` 다.
//! `userAccepted` 사건에는 사람이 보낸 글(연결 머리글 없는 본문)과 붙인 그림의 파일 이름을 얹는다(`Host::shape` — 다른 창이 보낸 글을 곧바로
//! 그리게 · 로그 · `Debug` 에는 없다).
//! `epoch` 은 프로세스 세대 [`chat_proc::ProcId`] — **서버 전역 단조 증가 · 재사용 없음**(0 = 아직 안 띄움). 닫고 다시 연 같은 채팅도 옛
//! 세대와 겹치지 않는다(오케스트레이션 2단계 단계 1 — 예전에는 채팅마다 1부터 다시 셌다).
//!
//! ## 완료 확인 공유(2026-11-13 — 판 31 · `src/lib/app/agent-seen.svelte.ts`)
//!
//! 배너(끝남 · 실패)는 창마다 산다 — 집 PC 에서 그 채팅을 봐도 원격 창의 배너가 남았다(거꾸로도). AI 타일의 `agent_state_seen` 과 같은 결로,
//! 사람이 본 창이 `side_chat_seen{chat, epoch, seq}` 를 보내고 서버는 **표를 바꾸지 않고** 방송만 한다. 몸은 채팅 id · 세대 · 사건 번호뿐이라
//! (본문 · 토큰 없음) 사건(`side-chat-event`)과 달리 `client::RELAYED` 로 모든 창에 간다. 낡음(그 뒤 다음 턴이 섰다)은 받는 창이 제 사본의
//! 마지막 턴 끝 번호와 견줘 버린다 — 서버는 없는 채팅 · 다른 세대 · 아직 없는 번호만 거른다.
//!
//! ## 띄우기(설계 2절 · CLAUDE.md "③ 사이드 채팅 프로세스")
//!
//! - **게으르게** — `side_chat_send` 에서만 [`spawn`] 한다(고르기 · 부팅 · `open` 은 안 띄움). 그 안의 `chat_proc::start` 가 코어의
//!   잡 생성(stdin 파이프) 하나로 띄운다(`SPAWN_LOCK` · 생성과 동시에 Job · `CREATE_NO_WINDOW` — 검증 · 헤드리스 턴과 같은 몸).
//! - 실행 파일은 PATH 의 `.exe` 만 · 인자는 어댑터의 고정 배열(`claude::argv` · `codex::argv` — 모델 · 강도 · 대화 id 를 Rust 가 다시 본다)
//!   을 `turn::quote_argv` 로 · 사용자 추가 인자 없음 · 환경은 `turn::headless_env`(= `pty::scrub_env_names` 공용 정화).
//! - cwd = `<데이터 루트>/sidechat/<id>/`(`side_chat::store`) — 갈라 온 채팅만 그 대화의 기록된 폴더(아래). 서버 임시 자리 `<데이터 루트>/sidechat/.run/<id>-<epoch>/`(`.` 이 든 이름이라
//!   채팅 id 와 겹치지 않는다)에 Claude 의 `--settings`(훅 끔) · `--mcp-config`(빈 것) · `--append-system-prompt-file`(검색 지침 + 전역 CLAUDE.md +
//!   `sidechat/CLAUDE.md` — **읽기만**)을 쓰고 프로세스가 끝나면 지운다. Codex 는 `~/.codex/config.toml` 을 **읽기만** 해 MCP 서버 이름을
//!   얻는다(`codex::mcp_server_names` — 하나씩 끈다).
//! - 대화 id 는 **턴이 한 번 선 뒤에만** 이어 가기 대상으로 적는다(첫 턴 전에 죽은 새 대화는 CLI 에 아직 없다 — 다음 보내기는 새 대화).
//!
//! ## 타일 대화 이어 가기(6단계 — 설계 2절 · spike "2차")
//!
//! - `open{mode: fork{from}}` — `from` 은 **그 CLI 의 대화 id 하나**(화면은 타일의 `agentLink` 에서 `{agent, id}` 만 준다 — 경로 없음). cwd 는
//!   서버가 대화 색인(`agent_sessions::recorded_cwd_in` — 목록 · 재개와 같은 판정)의 **기록된 시작 cwd** 로 정한다: 색인에 없으면
//!   `[conversation-not-found]`, 그 폴더가 없거나 절대 경로가 아니면 `[conversation-folder-missing]`. 첫 띄우기는 **갈라 오기**(Claude
//!   `--resume <from> --fork-session --session-id <새 id>` · Codex `thread/fork{excludeTurns}`) — 원본 파일 · 도는 타일은 그대로다.
//! - 턴이 한 번 선 뒤의 다시 띄우기는 그 채팅 **자신의 새 대화**를 잇는다(보통 이어 가기 — 같은 cwd). 서버 표를 잃은 뒤(재시작 · TTL)
//!   화면은 `resume{conv, project: true}` 로 다시 열고, 서버는 그 cwd 를 **새 대화의 색인**에서 다시 얻는다(갈라 온 대화는 그 폴더로
//!   기록된다 — 경로를 어디에도 저장하지 않는다). `project` 없는 이어 가기는 늘 채팅 자기 폴더다.
//! - **타일의 대화를 그냥 이어 가는 길은 없다** — Claude 는 쓰는 이 잠금이 없어 도는 타일과 한 파일에 둘이 쓰면 대화가 갈라진다(spike
//!   함정 2). `fork` 만 원본 id 를 받고, 이어 가기의 id 는 화면이 이 채팅 프로세스의 `turnStarted` 에서 받은 것뿐이다.
//!
//! ## stdin — 사람의 글과 사람의 결정뿐(설계 2절 ③ · 4절)
//!
//! stdin 에 줄을 넣는 것은 코어의 쓰기 스레드 하나(순서대로 — 이 파일은 `chat_proc::apply` 로만 넘긴다)이고, 그 줄을 짓는 것은 어댑터뿐이다:
//! 악수 · CLI 가 물은 것에 대한 고정 답(`on_line`
//! 의 `Step.stdin`) · 사람 글(`encode_user` — op `side_chat_send` 에서만 · 연결이 바뀐 뒤 첫 글은 앞에 앱 고정 연결 머리글 · 사람이 붙인 그림은
//! 그 글의 일부 — 서버가 첨부 자리 안의 그림 파일인지 본 것만) · 끊기 · 모델 바꾸기 · 강도 바꾸기(`encode_set_effort` — op
//! `side_chat_set_effort` 에서만 · 사람이 칩에서 고른 낱말) · 사람의 결정(`encode_decision` — op
//! `side_chat_decide` 에서만). MCP · 오케스트레이션 · AI 문자열에서 여기로 오는 길은 없다(시험 `side_chat_stdin_only_human`).
//!
//! ## 연결 · 채팅 MCP 토큰(5단계 — v1 결정 10 · 설계 8절 1 (a))
//!
//! - **채팅 토큰**(`crate::chat_token`)은 [`spawn`] 의 [`prepare`] 가 그 세대로 뽑고(세션 서버에 MCP 포트가 있을 때) 끝 정리(코어 끝 →
//!   `Host::on_ending` — 끝 사건 전) ·
//!   띄우기 실패가 거둔다. 값은 Claude 임시 자리의 `--mcp-config`(Aynx 서버 하나 · `--strict-mcp-config` 그대로) · Codex 프로세스 환경
//!   (`bearer_token_env_var` · 사용자 MCP 는 그대로 끈다)에만 — 로그 · 이벤트 · 스냅숏에 없다. 읽기 도구 일곱은 CLI 에 미리 허용한다(판정은 서버).
//! - **연결**은 op `side_chat_link` 만 바꾸고 채팅과 함께 산다(닫기 · TTL · 모두 닫기에서 잊는다 — 프런트가 `chats.json` 에서 다시 건다).
//!   바뀌면 `link_note` → [`op_send`] 가 사람 글 앞에 **앱 고정 머리글**(`side_chat::event::link_header` — 타일 표시 이름(입력 칸 칩이
//!   보낼 때 실은 `linkName` · 없으면 거울 이름 — 타일 코드 없음) · 스트림 id 만)을 붙인다. 값 · 출력은 붙이지 않는다(AI 가 도구로 읽는다).
//!
//! ## 외부 MCP(2026-10-25)
//!
//! - 사람이 설정 › MCP 에서 **사이드 채팅**을 고른 외부 서버만 싣는다(`agent_mcp::side_chat_servers` — **이 프로세스가 저장된 설정을 직접
//!   읽는다** · op 몸에 서버 목록 칸이 없다: 프런트가 서버를 끼워 넣을 길이 없다 — 시험 `side_chat_ops_take_no_server_list`). 범위는 AI 타일과
//!   같다(채팅 cwd 의 프로젝트 — 갈라 온 채팅만 있을 수 있다 · 같은 이름은 프로젝트 항목). 사용자 CLI 설정의 서버는 여전히 싣지 않는다
//!   (Claude `--strict-mcp-config` · Codex 하나씩 끄기 — 같은 이름의 외부 서버는 Codex 에 싣지 않고 `mcp-name-taken`).
//! - 비밀 값은 AI 타일과 같은 브로커(`mcp_launch` — stdio 도우미 · HTTP 헤더 프록시)가 티켓으로 — 인자 · 파일 · 프런트에 값이 없다. 볼트가
//!   잠겼으면 비밀 값이 있는 서버만 빼고 `mcp-locked` 로 알린다(채팅은 뜬다).
//! - **이름은 첫 보내기 전에도**(2026-11-13): 프로세스는 첫 보내기에 뜨지만 `open` 이 띄우지 않고 실을 예정 이름(`planned_mcp` — 같은
//!   빼기 규칙 · 이름만)을 스냅숏 `mcpServers` 에 싣는다 — 입력 칸 `[+]` › MCP 가 새 채팅에서도 선다. 띄우면 실린 목록이 갈음한다.
//! - **묻지 않기**(`side_chat_no_ask` — 설정에서만): Claude `--allowedTools mcp__<서버>` · Codex `default_tools_approval_mode='approve'`. 끈 서버는
//!   부를 때마다 권한 카드(`permission{kind: mcpTool}` — Claude `can_use_tool` · Codex MCP 승인 elicitation · `prompt`).
//!
//! ## 사건 · 중계
//!
//! (코어 `chat_proc`) stdout 은 스레드 하나가 `turn::LineSplitter`(32 MiB)로 줄을 나눠 `adapter.on_line` 에 넣고, stderr 는 `turn::TailRing`(8 KiB — 준비 전에
//! 끝났을 때 마지막 줄만 `notice{stderr}` 로). `textDelta` 는 같은 item 끼리 50ms 모아 하나로 낸다(감시 스레드가 그 틈마다 비운다).
//! 사건은 이 파일의 `Host::on_event` 가 `hub::emit` 으로 GUI 연결에 내고 몸에 **보는 창 이름들**(`windows`)을 싣는다 — 몸에 대화 본문이 있어 GUI 는 모든 창에
//! 방송하지 않고 그 창들에만 중계한다(3단계 — `client.rs` 의 `RELAYED` 에 **넣지 않는다**: 넣으면 모든 창으로 샌다 · GUI 는 그 창이 건
//! Tauri `Channel` 하나로만 보낸다 — `server::side_chat_proxy` 머리말). 서버 → GUI 연결은
//! 지금도 GUI 프로세스 하나라 연결별로 가르는 새 길은 만들지 않았다.
//!
//! ## 수명(설계 1절 표 — `db::table` 과 같은 꼴)
//!
//! | 사건 | 프로세스 |
//! |---|---|
//! | F5 · 웹뷰 크래시 · 창 파괴(원격 창 끝 포함 — `detach_window` · `close_window`) | 그 창만 뗌(남은 창이 없으면 떼어 둠) → 새 페이지의 `side_chat_attach` 가 다시 붙는다 |
//! | GUI 재시작 · kill(`conn_gone`) | 그 연결의 창을 뗌 → 떼어 둠 →[`DETACH_TTL`] 안에 다시 붙으면 그대로 · **도는 턴은 끝까지** · TTL 뒤 쉬는 순간 닫음(권한 요청을 기다리는 턴은 사람이 없어 끝나지 않으니 TTL 에 닫는다) |
//! | 마지막 창 → 트레이 | 산다(연결 그대로) · 권한 요청은 기다림 |
//! | 트레이 [모든 세션 종료](`close_all`) · 서버 끝 | 닫음([`close_all`]) |
//! | 프로세스가 끝남 · 다시 뜸 | 기다리던 권한 요청은 `permissionResolved{by: closed}`(`adapter.close_pending`) + `exited{code, reason}` |
//!
//! **서버 고아 자진 종료(`serve::Busy`)는 사이드 채팅을 세지 않는다** — `db::table` 과 같은 근거(붙은 채팅은 GUI 연결이 `clients` 로 이미
//! 세이고, 떼어 둔 것의 TTL 은 고아 시계와 같은 순간에 시작한다 · 끝날 때 [`close_all`]).
//!
//! **로그**: 채팅 id · 세대 · pid · 끝 코드 · 버린 줄 수만. 글 · 모델 답 · 도구 출력 · 경로는 남기지 않는다.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use super::chat_proc::{self, Core, Launch, ProcExit, ProcId, Spot, Status};
use super::ipc::WireError;
use super::{hub, log};
use crate::errors::{with_reason, SESSION_GONE};
use crate::orchestration::turn;
use crate::side_chat::event::{model_ok, uuid_ok, word_ok, Mode};
use crate::side_chat::{claude, codex, store, Adapter, Cli, Decision, Ev};

/// 사건 이벤트 이름(서버 → GUI). 몸 `{windows, chat, epoch, seq, ev}`.
pub(crate) const EVENT: &str = "side-chat-event";
/// 완료 확인 방송 이름(op `side_chat_seen` — 머리말 "완료 확인 공유"). 몸 `{chat, epoch, seq}` — 본문 · 토큰 없음, GUI 가 모든 창에 중계한다.
pub(crate) const SEEN_EVENT: &str = "side-chat-seen";
/// op 실패 코드.
pub(crate) const SIDE_CHAT: &str = "side-chat";
/// 옛 프로세스 세대(`epoch`)의 호출 — 화면은 다시 attach 한다.
pub(crate) const STALE_CHAT: &str = "stale-chat";
/// 떼어 둔 채팅을 살려 두는 시간(설계 8절 4 — `db::table::DETACH_TTL` 과 같은 10분).
pub(crate) const DETACH_TTL: Duration = Duration::from_secs(600);
/// 보낸 글 하나의 상한(바이트).
const TEXT_MAX: usize = 256 * 1024;
/// 받아들여지기를 기다리는 사람 글 장부의 상한(`userAccepted` 에 본문을 얹는 데만 쓴다 — 넘으면 오래된 것부터 버린다).
const SENT_MAX: usize = 32;
/// 사용자 문서(CLAUDE.md · config.toml) 읽기 상한.
const DOC_MAX: u64 = 1024 * 1024;
// 사이드 채팅 지침 저장 상한(`store::INSTRUCTIONS_MAX`)은 읽기 상한과 같다 — 저장한 글이 읽기에서 잘리지 않게.
const _: () = assert!(DOC_MAX as usize == store::INSTRUCTIONS_MAX);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn fail(reason: &str, message: impl Into<String>) -> WireError {
    WireError::new(SIDE_CHAT, with_reason(reason, message.into()))
}

/// 이 파일이 받는 op 인가.
pub(crate) fn is_side_chat_op(op: &str) -> bool {
    matches!(
        op,
        "side_chat_open"
            | "side_chat_send"
            | "side_chat_interrupt"
            | "side_chat_set_model"
            | "side_chat_set_effort"
            | "side_chat_decide"
            | "side_chat_close"
            | "side_chat_attach"
            | "side_chat_list"
            | "side_chat_link"
            | "side_chat_seen"
    )
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

/// 보는 창 하나 — 사건을 받을 창 라벨 · 끊기면 뗄 연결(같은 라벨은 하나 — 머리말 "보는 창 여럿").
struct Viewer {
    window: String,
    conn: u64,
}

/// 보냈지만 아직 받아들여지지 않은 사람 글(`userAccepted` 에 얹는다 — `Host::shape`). **`Debug` 를 파생하지 않는다**(본문).
struct Sent {
    client_id: Option<String>,
    text: String,
    files: Vec<String>,
}

struct State {
    cli: Cli,
    model: String,
    effort: Option<String>,
    /// 이어 갈 대화(턴이 한 번 선 것만 — 머리말).
    conversation: Option<String>,
    /// 갈라 올 원본 대화(6단계 — `conversation` 이 서기 전의 첫 띄우기만 쓴다).
    fork_from: Option<String>,
    /// CLI 가 도는 폴더 — `None` = 채팅 자기 폴더 · 갈라 온 채팅은 그 대화의 기록된 폴더(머리말 "타일 대화 이어 가기").
    cwd: Option<PathBuf>,
    /// 지금 프로세스가 알린 대화 id(준비 · 바뀜 알림) — 턴이 서면 `conversation` 으로 옮긴다.
    conv_seen: Option<String>,
    /// 보는 창들(머리말 "보는 창 여럿").
    viewers: Vec<Viewer>,
    /// 창이 붙을 때마다 +1(스냅숏의 `leaseEpoch`).
    lease_epoch: u64,
    /// 받아들여지기를 기다리는 사람 글(차례대로 — [`SENT_MAX`]).
    sent: VecDeque<Sent>,
    /// 떼어 둔 시각(`None` = 붙어 있다 — 보는 창이 0 이 된 순간부터).
    detached: Option<Instant>,
    /// 프로세스 칸(공용 코어 — 세대 · 상태 · `seq` · 꼬리 · 기다리는 요청 · 산 프로세스).
    core: Core,
    /// 연결(`crate::chat_token`)이 서거나 바뀌었다 — 사람의 다음 글 앞에 연결 머리글을 붙인다(`op_send` — 붙인 뒤 내린다).
    link_note: bool,
    /// 지금(마지막) 프로세스에 실린 외부 MCP 서버 이름(`Ev::McpServers` — 스냅숏의 `mcpServers`). 프로세스가 없을 때 연 채팅은 실을 예정
    /// 이름([`planned_mcp`] — `op_open`).
    mcp: Vec<String>,
}

struct Chat {
    id: String,
    st: Mutex<State>,
    /// 상태가 바뀌었다(준비 기다리기 — `side_chat_send`).
    cv: Condvar,
}

#[derive(Default)]
struct Table {
    chats: HashMap<String, Arc<Chat>>,
    /// 지금 살아 있는 서버 연결 — 끊긴 뒤에 끝난 열기 · 붙기는 곧바로 떼어 둔다(`db::table` 과 같은 구멍 막기).
    conns: HashSet<u64>,
}

static TABLE: LazyLock<Mutex<Table>> = LazyLock::new(Default::default);

fn find(id: &str) -> Result<Arc<Chat>, WireError> {
    lock(&TABLE).chats.get(id).cloned().ok_or_else(|| {
        WireError::new(
            SIDE_CHAT,
            with_reason(SESSION_GONE, "this side chat is not open on the session server".into()),
        )
    })
}

fn check_epoch(st: &State, epoch: u64) -> Result<(), WireError> {
    if st.core.id().get() != epoch {
        return Err(fail(STALE_CHAT, format!("stale side chat process (now {})", st.core.id())));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 코어의 주인 — 사건 내보내기 · 끝 정리
// ---------------------------------------------------------------------------

/// 보는 창 라벨들(붙은 차례).
fn windows_of(st: &State) -> Vec<String> {
    st.viewers.iter().map(|v| v.window.clone()).collect()
}

/// 사건 몸 — **순수**(시험이 모양을 본다).
fn event_body(windows: &[String], chat: &str, proc: ProcId, seq: u64, ev: &Ev) -> Value {
    json!({ "windows": windows, "chat": chat, "epoch": proc, "seq": seq, "ev": ev })
}

impl chat_proc::Host for Chat {
    type St = State;

    fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.st)
    }

    fn core(st: &mut State) -> &mut Core {
        &mut st.core
    }

    /// `userAccepted` 에 그 글의 본문 · 그림 이름을 얹는다 — `clientId` 가 있으면 그 글(앞의 것은 버린다 — 받아들여지지 않고 끝난 글),
    /// 없으면 가장 오래된 글.
    fn shape(&self, st: &mut State, ev: &mut Ev) {
        if let Ev::UserAccepted { client_id, text, files } = ev {
            let at = match client_id.as_deref() {
                Some(id) => st.sent.iter().position(|s| s.client_id.as_deref() == Some(id)),
                None => (!st.sent.is_empty()).then_some(0),
            };
            if let Some(s) = at.and_then(|i| st.sent.drain(..=i).next_back()) {
                *text = Some(crate::side_chat::event::Said(s.text));
                *files = s.files;
            }
        }
    }

    /// 주인 칸(대화 id · 외부 MCP 이름 · 준비 기다리기)에 반영하고 내보낸다 — 몸에 보는 창 이름들을 싣는다(머리말 "사건 · 중계"). 보는 창이
    /// 없으면 `windows: []`(GUI 가 아무 창에도 보내지 않는다 — 다시 붙는 창은 스냅숏으로 맞춘다).
    fn on_event(&self, st: &mut State, proc: ProcId, seq: u64, ev: &Ev) {
        match ev {
            Ev::Ready { conversation_id, .. } => {
                if conversation_id.is_some() {
                    st.conv_seen = conversation_id.clone();
                }
                self.cv.notify_all();
            }
            Ev::TurnStarted { .. } => {
                if st.conv_seen.is_some() {
                    st.conversation = st.conv_seen.clone();
                }
            }
            Ev::Notice { code: "conversation-changed", detail: Some(id) } => {
                st.conv_seen = Some(id.clone());
                if st.core.status() == Status::Running {
                    st.conversation = Some(id.clone());
                }
            }
            Ev::McpServers { names } => st.mcp = names.clone(),
            Ev::Exited { .. } => self.cv.notify_all(),
            _ => {}
        }
        hub::emit(EVENT, event_body(&windows_of(st), &self.id, proc, seq, ev));
    }

    /// 끝 사건 전 — 이 세대의 채팅 토큰을 거두고(정확히 이 세대만 — 늦은 끝 정리가 새 세대의 칸을 건드리지 않는다), 그 대화를 놓았다고
    /// 서버 장부에 적는다(채팅 지우기가 곧바로 그 대화를 지울 때 "방금 쓰임"(2분)에 막히지 않게 — 타일이 쥐었으면 그대로).
    fn on_ending(&self, st: &mut State, proc: ProcId) {
        crate::chat_token::revoke(&self.id, proc);
        let agent = cli_name(st.cli);
        for conv in st.conversation.iter().chain(st.conv_seen.iter()) {
            crate::agent_state::note_released(agent, conv);
        }
    }

    fn on_exit(&self, e: ProcExit) {
        log::line(format!(
            "side chat {} — process {} ended ({}, code {:?}, dropped {} bad · {} unknown line(s))",
            self.id, e.proc, e.reason, e.code, e.dropped.bad, e.dropped.unknown
        ));
        wake_reaper();
    }
}

// ---------------------------------------------------------------------------
// 띄우기
// ---------------------------------------------------------------------------

fn read_capped(p: &Path) -> Option<String> {
    let f = std::fs::File::open(p).ok()?;
    let mut buf = Vec::new();
    f.take(DOC_MAX).read_to_end(&mut buf).ok()?;
    let s = String::from_utf8_lossy(&buf).into_owned();
    (!s.trim().is_empty()).then_some(s)
}

/// 지침 파일 본문 — 답변 · 검색 지침(`side_chat::fixed_guide` — 늘) + 전역 CLAUDE.md · `sidechat/CLAUDE.md`(둘 다 **읽기만** · 없으면 뺀다).
fn instructions(root: &Path) -> String {
    let global = turn::global_claude_md(std::env::var_os("CLAUDE_CONFIG_DIR").as_deref(), dirs::home_dir()).and_then(|p| read_capped(&p));
    let local = read_capped(&root.join(store::INSTRUCTIONS_FILE));
    let mut docs: Vec<(&str, &str)> = Vec::new();
    if let Some(g) = global.as_deref() {
        docs.push(("Global CLAUDE.md", g));
    }
    if let Some(l) = local.as_deref() {
        docs.push(("Side chat CLAUDE.md", l));
    }
    turn::instructions_text(&crate::side_chat::fixed_guide(), None, &docs).expect("고정 글이 있어 늘 Some")
}

/// 사용자 Codex 설정의 MCP 서버 이름 — `$CODEX_HOME/config.toml`(없으면 `~/.codex`) 을 **읽기만**.
fn codex_mcp_names() -> codex::McpNames {
    let home = match std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        Some(h) => PathBuf::from(h),
        None => match dirs::home_dir() {
            Some(h) => h.join(".codex"),
            None => return codex::McpNames::default(),
        },
    };
    read_capped(&home.join("config.toml")).map(|t| codex::mcp_server_names(&t)).unwrap_or_default()
}

fn cli_name(cli: Cli) -> &'static str {
    match cli {
        Cli::Claude => "claude",
        Cli::Codex => "codex",
    }
}

/// `<데이터 루트>/sidechat` — 시험은 임시 폴더로 바꾼다.
fn sidechat_root() -> Option<PathBuf> {
    #[cfg(test)]
    if let Some(f) = lock(&FAKE).as_ref() {
        return Some(f.root.clone());
    }
    store::root()
}

/// 채팅 MCP 재료 — **`Debug` 를 파생하지 않는다**(토큰).
struct ChatMcp {
    name: &'static str,
    url: String,
    token: String,
}

/// 세션 서버의 MCP 포트(시험은 가짜 CLI 의 값).
fn mcp_port() -> Option<u16> {
    #[cfg(test)]
    if let Some(f) = lock(&FAKE).as_ref() {
        return f.mcp_port;
    }
    hub::signal_port()
}

/// 이 세대의 채팅 토큰을 뽑는다(포트가 없거나 난수를 못 얻으면 `None` — 그 프로세스는 Aynx MCP 없이 뜬다).
fn chat_mcp(id: &str, proc: ProcId) -> Option<ChatMcp> {
    let port = mcp_port()?;
    let token = crate::chat_token::issue(id, proc)?;
    Some(ChatMcp {
        name: crate::instance::mcp_name(crate::instance::DEV),
        url: format!("{}/mcp", crate::tile_env::base_url(port)),
        token,
    })
}

/// 사람이 사이드 채팅에 고른 외부 서버 — **저장된 설정을 이 프로세스가 직접 읽는다**(`agent_mcp::side_chat_servers` — op 몸 · 프런트
/// 인자에서 받지 않는다). 시험은 [`set_fake_servers_for_test`] 의 목록.
fn picked_servers(cwd: &str) -> Vec<crate::agent_mcp::McpServer> {
    #[cfg(test)]
    {
        let _ = cwd;
        crate::agent_mcp::side_chat_selected(lock(&FAKE_SERVERS).as_deref().unwrap_or_default(), None)
    }
    #[cfg(not(test))]
    crate::agent_mcp::side_chat_servers(Some(cwd))
}

/// **외부 MCP 서버의 실행 모양**(2026-10-25 — 머리말 "외부 MCP") — 고른 서버마다 비밀 값이 있으면 브로커가 티켓을 박은 모양(stdio = `aynx
/// mcp-run` 도우미 · HTTP = 헤더 프록시 URL — 값은 볼트에서 그 자식 · 프록시로만)으로 바꾼다. 빼는 것과 알림(이름만):
/// 볼트가 잠겼는데 비밀 값이 있다 `mcp-locked`(채팅은 그 서버 없이 뜬다) · Codex 의 사용자 `config.toml` 과 같은 이름 `mcp-name-taken`
/// (표가 합쳐져 그쪽 칸이 섞인다) · 준비 실패 · 인자에 못 싣는 모양 `mcp-failed`.
fn external_mcp(cli: Cli, cwd: &str, user_names: &[String], notices: &mut Vec<Ev>) -> Vec<crate::agent_mcp::McpServer> {
    let picked = picked_servers(cwd);
    if picked.is_empty() {
        return Vec::new();
    }
    let vault_open = hub::vault().is_some_and(|v| v.is_unlocked());
    let broker = hub::broker();
    let (mut out, mut locked, mut taken, mut failed) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for s in picked {
        match mcp_skip(&s, cli, user_names, vault_open) {
            Some(Skip::Taken) => {
                taken.push(s.name);
                continue;
            }
            Some(Skip::Locked) => {
                locked.push(s.name);
                continue;
            }
            None => {}
        }
        let secret = !s.env.is_empty() || !s.headers.is_empty();
        let prepared = if !secret { Some(s.clone()) } else { broker.as_ref().and_then(|b| b.prepare(&s, Some(cwd)).ok()) };
        match prepared.filter(crate::agent_mcp::launch_ok) {
            Some(p) => out.push(p),
            None => failed.push(s.name),
        }
    }
    for (code, names) in [("mcp-locked", locked), ("mcp-name-taken", taken), ("mcp-failed", failed)] {
        if !names.is_empty() {
            notices.push(Ev::Notice { code, detail: Some(names.join(", ")) });
        }
    }
    out
}

/// 고른 외부 서버를 싣지 않을 까닭(띄우기 [`external_mcp`] 와 열기의 예정 이름 [`planned_mcp`] 이 같은 규칙을 쓴다).
enum Skip {
    /// Codex 사용자 `config.toml` 에 같은 이름(`mcp-name-taken`)
    Taken,
    /// 비밀 값이 있는데 볼트가 잠겼다(`mcp-locked`)
    Locked,
}

fn mcp_skip(s: &crate::agent_mcp::McpServer, cli: Cli, user_names: &[String], vault_open: bool) -> Option<Skip> {
    if cli == Cli::Codex && user_names.contains(&s.name) {
        return Some(Skip::Taken);
    }
    if !vault_open && (!s.env.is_empty() || !s.headers.is_empty()) {
        return Some(Skip::Locked);
    }
    None
}

/// **열 때의 예정 이름**(2026-11-13 — 첫 보내기 전에도 `[+]` › MCP 가 보이게) — 프로세스는 첫 보내기에 뜨므로(머리말 "게으르게") 그 전에는
/// 실린 목록(`Ev::McpServers`)이 없다. 띄우지 않고 [`external_mcp`] 와 같은 고르기 · 빼기 규칙([`mcp_skip`] — 같은 이름 · 볼트 잠김)만 적용한
/// **이름**을 스냅숏의 `mcpServers` 에 싣는다(값 · 티켓 · 토큰 없음). 띄우면 실제로 실린 목록이 이것을 갈음한다(준비 실패만 그때 빠진다).
/// 블로킹(설정 · 프로젝트 판정 · Codex 설정 파일 읽기) — 표 · 채팅 잠금 **앞**에서 부른다.
fn planned_mcp(cli: Cli, cwd: &str) -> Vec<String> {
    let picked = picked_servers(cwd);
    if picked.is_empty() {
        return Vec::new();
    }
    let user = if cli == Cli::Codex { codex_mcp_names().names } else { Vec::new() };
    let vault_open = hub::vault().is_some_and(|v| v.is_unlocked());
    picked.into_iter().filter(|s| mcp_skip(s, cli, &user, vault_open).is_none()).map(|s| s.name).collect()
}

/// **그 채팅 CLI 가 도는 폴더** — 채팅 자기 폴더(없으면 만든다) · 갈라 온 채팅은 열 때 색인에서
/// 정한 폴더(그 사이 지워졌으면 `[conversation-folder-missing]`).
fn run_cwd(root: &Path, id: &str, forked: Option<&Path>) -> Result<PathBuf, WireError> {
    let own = store::chat_dir(root, id).ok_or_else(|| fail("bad-chat", "invalid side chat id"))?;
    std::fs::create_dir_all(&own).map_err(|e| fail("chat-dir", e.to_string()))?;
    match forked {
        Some(p) if p.is_dir() => Ok(p.to_path_buf()),
        Some(_) => Err(fail(FOLDER_MISSING, "the conversation's folder no longer exists")),
        None => Ok(own),
    }
}

/// 실행 재료([`chat_proc::Launch`])를 짓는다(파일을 쓰지만 아무것도 띄우지 않는다).
fn prepare(id: &str, st: &State, proc: ProcId) -> Result<Launch, WireError> {
    let root = sidechat_root().ok_or_else(|| fail("no-data-root", "the app data folder is unknown"))?;
    let cwd = run_cwd(&root, id, st.cwd.as_deref())?;
    let dir = root.join(".run").join(format!("{id}-{proc}"));
    std::fs::create_dir_all(&dir).map_err(|e| fail("temp-dir", e.to_string()))?;
    let mut spot = Spot::new(dir);
    let name = cli_name(st.cli);
    let exe = crate::orchestration::spawn::find_exe(name, std::env::var_os("PATH").as_deref())
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| fail("cli-not-found", format!("{name} was not found on PATH (an .exe is required)")));
    #[cfg(test)]
    let exe = match lock(&FAKE).as_ref() {
        Some(f) => Ok(f.exe.clone()),
        None => exe,
    };
    let exe = exe?;
    let bad = |w: &'static str| fail(w, "the side chat settings were refused");
    let mut add: Vec<(String, String)> = Vec::new();
    let mut notices = Vec::new();
    let fresh = if st.conversation.is_none() {
        Some(crate::orchestration::spawn::new_uuid().ok_or_else(|| fail("uuid", "no randomness"))?)
    } else {
        None
    };
    // 채팅 MCP(5단계) — 서버의 MCP 포트가 있으면 **이 세대의** 채팅 토큰을 뽑는다(`crate::chat_token` — 값은 이 프로세스의 실행 재료에만:
    // Claude 는 임시 자리의 `--mcp-config` 파일 · Codex 는 환경 변수). 실패한 띄우기는 부르는 쪽([`spawn`])이 거둔다.
    let mcp = chat_mcp(id, proc);
    let cwd_s = cwd.to_string_lossy().replace('\\', "/");
    // Codex 사용자 설정의 MCP 이름(하나씩 끈다 · 같은 이름의 외부 서버는 싣지 않는다)
    let user_names = if st.cli == Cli::Codex { codex_mcp_names() } else { codex::McpNames::default() };
    // 외부 MCP(2026-10-25) — 사람이 사이드 채팅에 고른 서버만(저장된 설정 · 이 프로세스가 읽는다). 이름은 머리줄 칩으로(`mcpServers`).
    let ext = external_mcp(st.cli, &cwd_s, &user_names.names, &mut notices);
    let names: Vec<String> = ext.iter().map(|s| s.name.clone()).collect();
    if !names.is_empty() || !st.mcp.is_empty() {
        notices.insert(0, Ev::McpServers { names });
    }
    let (argv, adapter): (Vec<String>, Box<dyn Adapter>) = match st.cli {
        Cli::Claude => {
            let settings = spot.write("settings.json", claude::SETTINGS_JSON).map_err(|e| fail("temp-file", e))?;
            let body = match &mcp {
                Some(m) => claude::mcp_config(m.name, &m.url, &m.token),
                None => claude::MCP_CONFIG_EMPTY.to_string(),
            };
            let mcp_file = spot.write("mcp.json", &claude::mcp_config_with(&body, &ext)).map_err(|e| fail("temp-file", e))?;
            // 읽기 도구는 묻지 않는다 — 판정(연결 · AI 읽기 허용 · 호스트 권한)은 호출마다 서버가 한다(`mcp/chat_read.rs`).
            let mut allowed: Vec<String> = match &mcp {
                Some(m) => crate::chat_token::READ_TOOLS.iter().map(|t| format!("mcp__{}__{t}", m.name)).collect(),
                None => Vec::new(),
            };
            // 묻지 않기를 켠 외부 서버만 통째로 미리 허용 — 나머지 외부 도구는 `can_use_tool` → 권한 카드
            allowed.extend(claude::no_ask_rules(&ext));
            // 파일 첨부(판 32) — 사본은 늘 채팅 자기 폴더의 `attachments/`(`chat_files`). 갈라 온 채팅은 cwd 가 다른 폴더라 그 폴더 **하나의 읽기**만
            // 더한다(`--add-dir` + `Read(//…/**)` — 쓰기 · 실행 도구는 `--tools` 에 없다). 자기 폴더가 cwd 인 채팅은 `Read(./**)` 에 이미 든다.
            let attach_dir = if st.cwd.is_some() { attach_read(id) } else { None };
            if let Some((_, rule)) = &attach_dir {
                allowed.push(rule.clone());
            }
            let append = Some(spot.write("instructions.md", &instructions(&root)).map_err(|e| fail("temp-file", e))?);
            let (mode, session_id) = match (st.conversation.as_deref(), fresh.as_deref()) {
                (Some(c), _) => (Mode::Resume { conv: c }, c),
                // 갈라 오기 — 새 대화가 이 id 로 선다(원본은 그대로)
                (None, Some(n)) => match st.fork_from.as_deref() {
                    Some(from) => (Mode::Fork { from }, n),
                    None => (Mode::Fresh, n),
                },
                (None, None) => unreachable!("새 대화 id 는 위에서 지었다"),
            };
            let o = claude::Opts {
                exe: &exe,
                mode,
                session_id,
                model: &st.model,
                effort: st.effort.as_deref(),
                settings_file: &settings,
                mcp_config_file: &mcp_file,
                append_file: append.as_deref(),
                mcp_allowed: &allowed,
            };
            let mut a = claude::argv(&o).map_err(bad)?;
            if let Some((dir, _)) = &attach_dir {
                a.extend(["--add-dir".to_string(), dir.clone()]);
            }
            (a, Box::new(claude::Claude::new(&o)))
        }
        Cli::Codex => {
            let names = user_names;
            if names.skipped > 0 {
                notices.push(Ev::Notice { code: "mcp-names-skipped", detail: Some(names.skipped.to_string()) });
            }
            let mode = match (st.conversation.as_deref(), st.fork_from.as_deref()) {
                (Some(c), _) => Mode::Resume { conv: c },
                (None, Some(from)) => Mode::Fork { from },
                (None, None) => Mode::Fresh,
            };
            let o = codex::Opts {
                exe: &exe,
                mode,
                cwd: &cwd_s,
                model: &st.model,
                effort: st.effort.as_deref(),
                mcp_names: &names.names,
                client_version: env!("CARGO_PKG_VERSION"),
                mcp: mcp.as_ref().map(|m| codex::Mcp {
                    name: m.name,
                    url: &m.url,
                    token_env: crate::tile_env::MCP_TOKEN_ENV,
                    tools: &crate::chat_token::READ_TOOLS,
                }),
                external: &ext,
            };
            if let Some(m) = &mcp {
                add.push((crate::tile_env::MCP_TOKEN_ENV.to_string(), m.token.clone()));
            }
            let mut argv = codex::argv(&o).map_err(bad)?;
            // Codex 실행 환경(Windows — 스토어 pwsh 를 뺀 PATH 등 · 작업자 턴과 같은 재료).
            let launch = crate::codex_launch::codex_launch_env();
            crate::codex_launch::apply_tile_path(&mut add, launch.as_ref());
            argv.extend(crate::codex_launch::codex_extra_args(launch.as_ref()));
            // 사이드 채팅 지침(사람이 설정 › 지침에서 쓴 글) — Claude 와 같은 파일을 이 프로세스가 직접 읽는다(op 몸으로 받지 않는다).
            let person = read_capped(&root.join(store::INSTRUCTIONS_FILE));
            (argv, Box::new(codex::Codex::new(&o).person_instructions(person.as_deref())))
        }
    };
    // 시험 — 인자는 위에서 검사만 하고 가짜 CLI(시험 실행 파일 자신)의 것으로 바꾼다.
    #[cfg(test)]
    let argv = match lock(&FAKE).as_ref() {
        Some(f) => {
            add.extend(f.env.iter().cloned());
            std::iter::once(f.exe.clone()).chain(f.args.iter().cloned()).collect()
        }
        None => argv,
    };
    let env = turn::headless_env(std::env::vars(), &add);
    Ok(Launch { name, exe, argv, cwd, env, adapter, spot, notices })
}

/// **프로세스를 띄운다** — `side_chat_send` 에서만(머리말 "게으르게"). 새 세대([`ProcId::next`] — 서버 전역 · 재사용 없음)를 뽑아 실행
/// 재료를 짓고 공용 코어(`chat_proc::start`)가 띄운다. 부르는 쪽이 채팅 잠금을 쥐고 있다 — 코어의 스레드들은 그 잠금이 풀린 뒤에야 줄을
/// 반영한다(세대 · 프로세스 칸이 먼저 선다).
fn spawn(chat: &Arc<Chat>, st: &mut State) -> Result<(), WireError> {
    let proc = ProcId::next();
    // 띄우지 못하면 이 세대의 채팅 토큰을 곧바로 거둔다(뽑은 것은 `prepare` — 5단계).
    let revoke = |e: WireError| {
        crate::chat_token::revoke(&chat.id, proc);
        e
    };
    let l = prepare(&chat.id, st, proc).map_err(revoke)?;
    let pid = chat_proc::start(chat, st, proc, l).map_err(|(w, m)| revoke(fail(w, m)))?;
    log::line(format!("side chat {} — started {} (process {proc}, pid {pid})", chat.id, cli_name(st.cli)));
    st.conv_seen = None;
    st.sent.clear();
    Ok(())
}

// ---------------------------------------------------------------------------
// op
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ModeBody {
    Fresh,
    Resume {
        conv: String,
        /// 갈라 온 채팅 자신의 대화 — cwd 를 그 대화의 색인에서 다시 얻는다(머리말 "타일 대화 이어 가기").
        #[serde(default)]
        project: bool,
    },
    Fork { from: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenBody {
    chat: String,
    cli: String,
    model: String,
    #[serde(default)]
    effort: Option<String>,
    mode: ModeBody,
    window: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendBody {
    chat: String,
    epoch: u64,
    text: String,
    #[serde(default)]
    client_id: Option<String>,
    /// 입력 칸 연결 칩의 지금 이름(머리글을 붙일 때만 쓴다 — `link_header_now`). 없으면 거울의 타일 이름.
    #[serde(default)]
    link_name: Option<String>,
    /// 사람이 이 글에 붙인 그림의 경로(입력 칸 칩 — 앱 첨부 자리의 사본). 서버가 다시 본다(`chat_images`).
    #[serde(default)]
    images: Vec<String>,
    /// 사람이 이 글에 붙인 그림 밖 파일의 경로(판 32 — 앱 첨부 자리의 사본). 서버가 다시 보고 채팅 자기 폴더로 옮겨 적는다(`chat_files`).
    #[serde(default)]
    files: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpochBody {
    chat: String,
    epoch: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeenBody {
    chat: String,
    epoch: u64,
    seq: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelBody {
    chat: String,
    epoch: u64,
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffortBody {
    chat: String,
    epoch: u64,
    /// `None` = CLI 기본.
    #[serde(default)]
    effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecideBody {
    chat: String,
    epoch: u64,
    request_id: String,
    decision: String,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatBody {
    chat: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachBody {
    chat: String,
    window: String,
}

fn body<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, WireError> {
    // serde 문구는 몸(사람 글)을 되풀이할 수 있다 — 싣지 않는다.
    serde_json::from_value(v).map_err(|_| WireError::new(super::ipc::frame::code::BAD_BODY, "bad side chat request body"))
}

/// op 하나(블로킹 — `serve` 가 블로킹 풀에서 부른다). `conn` 은 부른 서버 연결(임대).
pub(crate) fn handle(op: &str, b: Value, conn: u64) -> Result<Value, WireError> {
    match op {
        "side_chat_open" => op_open(body(b)?, conn),
        "side_chat_send" => op_send(body(b)?),
        "side_chat_interrupt" => op_interrupt(body(b)?),
        "side_chat_set_model" => op_set_model(body(b)?),
        "side_chat_set_effort" => op_set_effort(body(b)?),
        "side_chat_decide" => op_decide(body(b)?),
        "side_chat_close" => {
            let c: ChatBody = body(b)?;
            Ok(json!(close(&c.chat)))
        }
        "side_chat_attach" => op_attach(body(b)?, conn),
        "side_chat_list" => Ok(list()),
        "side_chat_link" => op_link(body(b)?),
        "side_chat_seen" => Ok(op_seen(body(b)?)),
        _ => Err(WireError::new(super::ipc::frame::code::UNKNOWN_OP, format!("unknown op: {op}"))),
    }
}

/// 스냅숏 — `link` 는 [`link_view`](부르는 쪽이 채팅 잠금 **앞**에서 — 권한 파일 읽기를 잠금 위에서 하지 않게).
fn snapshot(chat: &Chat, st: &State, link: Value) -> Value {
    json!({
        "link": link,
        "chat": chat.id,
        "cli": st.cli,
        "model": st.model,
        "effort": st.effort,
        "epoch": st.core.id(),
        "leaseEpoch": st.lease_epoch,
        "seq": st.core.seq(),
        "status": st.core.status(),
        "conversationId": st.conv_seen.as_ref().or(st.conversation.as_ref()),
        "cwd": st.cwd.as_ref().map(|p| p.to_string_lossy().replace('\\', "/")),
        "forkFrom": st.fork_from,
        "mcpServers": st.mcp,
        "liveTurn": st.core.live_turn(),
        "pending": st.core.pending(),
    })
}

/// 보는 창을 **덧붙인다** — 같은 라벨이면 연결만 갈음 · 회차 +1 · 떼어 둠 풀기. 연결이 이미 끊겼으면 덧붙이지 않는다(보는 창이 없으면
/// 곧바로 떼어 둔다). 모은 조각은 먼저 낸다(스냅숏 뒤 사건이 이어지게).
fn add_viewer(chat: &Chat, st: &mut State, window: String, conn: u64, conn_alive: bool) {
    st.lease_epoch += 1;
    if conn_alive {
        st.viewers.retain(|v| v.window != window);
        st.viewers.push(Viewer { window, conn });
        st.detached = None;
    } else if st.viewers.is_empty() && st.detached.is_none() {
        st.detached = Some(Instant::now());
    }
    chat_proc::flush(chat, st);
}

/// 갈라 올 대화의 폴더가 없다(색인의 기록된 cwd 가 지금 폴더가 아니거나 절대 경로가 아니다).
pub(crate) const FOLDER_MISSING: &str = "conversation-folder-missing";

/// 그 CLI 의 대화 id → **기록된 시작 cwd**(6단계 — 머리말 "타일 대화 이어 가기"). 색인(`agent_sessions` — 목록 · 재개와 같은 판정)에서만
/// 고르고 화면이 준 경로는 없다. 블로킹(파일을 찾는다) — op 는 블로킹 풀에서 돈다.
fn recorded_cwd(cli: Cli, id: &str) -> Result<PathBuf, WireError> {
    use crate::agent_sessions::{recorded_cwd_in, target, CwdMiss};
    let t = target(cli_name(cli)).map_err(|_| fail("bad-cli", "unknown side chat CLI"))?;
    match recorded_cwd_in(t, &conv_roots(t), id) {
        Ok(cwd) if Path::new(&cwd).is_absolute() => Ok(PathBuf::from(cwd)),
        Ok(_) | Err(CwdMiss::NoFolder(_)) => Err(fail(FOLDER_MISSING, "the conversation's folder no longer exists")),
        Err(CwdMiss::BadId) => Err(fail("bad-conversation", "invalid conversation id")),
        Err(CwdMiss::NotFound) => Err(fail("conversation-not-found", "that conversation was not found for this CLI")),
    }
}

/// 그 에이전트의 대화 루트(시험은 가짜 색인).
fn conv_roots(t: &'static crate::agent_sessions::SessionTarget) -> Vec<PathBuf> {
    #[cfg(test)]
    if let Some(f) = lock(&FAKE).as_ref() {
        return f.conv_roots.iter().filter(|(a, _)| *a == t.id).map(|(_, p)| p.clone()).collect();
    }
    (t.roots)()
}

fn op_open(b: OpenBody, conn: u64) -> Result<Value, WireError> {
    if !store::id_ok(&b.chat) {
        return Err(fail("bad-chat", "invalid side chat id"));
    }
    // 프로듀서 채팅 id(`pc-` — `server::producer`)는 이 표가 받지 않는다(표가 달라 섞일 일은 없지만 낱말을 밝힌다 — 설계 1-2 · 리뷰 F11).
    if b.chat.starts_with("pc-") {
        return Err(fail("wrong-chat-kind", "that id belongs to a producer chat — use producer_chat_*"));
    }
    let cli = match b.cli.as_str() {
        "claude" => Cli::Claude,
        "codex" => Cli::Codex,
        _ => return Err(fail("bad-cli", "unknown side chat CLI")),
    };
    // 빈 모델 = CLI 기본(`event::model_ok`)
    if !model_ok(&b.model) || b.effort.as_deref().is_some_and(|e| !word_ok(e)) {
        return Err(fail("bad-model", "invalid model"));
    }
    // 대화 · 갈라 올 원본 · 폴더 — 폴더는 색인에서만(파일을 찾는다 — 표 잠금 앞에서)
    let (conversation, fork_from, cwd) = match b.mode {
        ModeBody::Fresh => (None, None, None),
        ModeBody::Resume { conv, project } if uuid_ok(&conv) => {
            let cwd = if project { Some(recorded_cwd(cli, &conv)?) } else { None };
            (Some(conv), None, cwd)
        }
        ModeBody::Fork { from } if uuid_ok(&from) => {
            let from = from.to_ascii_lowercase();
            let cwd = recorded_cwd(cli, &from)?;
            (None, Some(from), Some(cwd))
        }
        ModeBody::Resume { .. } | ModeBody::Fork { .. } => {
            return Err(fail("bad-conversation", "invalid conversation id"))
        }
    };
    // 첫 보내기 전에도 보일 외부 MCP 이름(띄울 폴더 = 갈라 온 대화의 폴더, 아니면 채팅 폴더 — [`prepare`] 와 같은 자리) — 잠금 앞에서
    let plan_cwd = cwd.clone().or_else(|| sidechat_root().and_then(|r| store::chat_dir(&r, &b.chat)));
    let planned = plan_cwd.map(|p| planned_mcp(cli, &p.to_string_lossy().replace('\\', "/"))).unwrap_or_default();
    let (chat, alive, old) = {
        let mut t = lock(&TABLE);
        let alive = t.conns.contains(&conn);
        let old = t.chats.get(&b.chat).cloned();
        let reuse = old.as_ref().filter(|c| lock(&c.st).cli == cli).cloned();
        // 새 항목의 세대는 아직 없음(0) — CLI 를 바꾼 같은 채팅 · 닫고 다시 연 같은 채팅도 다음 띄우기가 서버 전역의 새 `ProcId` 를 받으니
        // 옛 프로세스의 늦은 끝 정리가 새 세대의 채팅 토큰을 거두지 않는다(예전의 "세대를 이어 세기"가 막지 못한 닫기 → 열기도 함께 닫힌다).
        let chat = match reuse {
            Some(c) => c,
            None => {
                let c = Arc::new(Chat {
                    id: b.chat.clone(),
                    st: Mutex::new(State {
                        cli,
                        model: b.model.clone(),
                        effort: b.effort.clone(),
                        conversation: conversation.clone(),
                        fork_from: fork_from.clone(),
                        cwd: cwd.clone(),
                        conv_seen: None,
                        viewers: Vec::new(),
                        lease_epoch: 0,
                        sent: VecDeque::new(),
                        detached: None,
                        core: Core::new(),
                        // 이미 걸린 연결(같은 채팅 — CLI 를 바꿈)은 새 프로세스의 첫 글에 다시 알린다.
                        link_note: crate::chat_token::link_of(&b.chat).is_some(),
                        mcp: Vec::new(),
                    }),
                    cv: Condvar::new(),
                });
                t.chats.insert(b.chat.clone(), Arc::clone(&c));
                c
            }
        };
        let replaced = old.filter(|o| !Arc::ptr_eq(o, &chat));
        (chat, alive, replaced)
    };
    // CLI 가 바뀐 같은 채팅 — 옛 프로세스를 닫는다.
    if let Some(o) = old {
        lock(&o.st).core.kill("closed");
    }
    let link = link_view(&chat.id);
    let mut st = lock(&chat.st);
    // 다시 붙기 — 프로세스가 없을 때만 띄울 뜻(모델 · 이어 갈 대화)을 바꾼다(도는 프로세스는 그대로).
    if !st.core.has_proc() {
        st.model = b.model;
        st.effort = b.effort;
        st.mcp = planned;
        if conversation.is_some() {
            st.conversation = conversation;
            st.cwd = cwd;
        } else if fork_from.is_some() && st.conversation.is_none() {
            st.fork_from = fork_from;
            st.cwd = cwd;
        }
    }
    add_viewer(&chat, &mut st, b.window, conn, alive);
    if !alive {
        wake_reaper();
    }
    Ok(snapshot(&chat, &st, link))
}

fn op_attach(b: AttachBody, conn: u64) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let alive = lock(&TABLE).conns.contains(&conn);
    let link = link_view(&chat.id);
    let mut st = lock(&chat.st);
    add_viewer(&chat, &mut st, b.window, conn, alive);
    if !alive {
        wake_reaper();
    }
    Ok(snapshot(&chat, &st, link))
}

/// **사람이 보낸 글** — 이 함수가 `encode_user` 를 부르는 유일한 곳이다(시험 `side_chat_stdin_only_human`). 프로세스가 없으면 여기서
/// 띄우고 준비를 기다린다.
fn op_send(b: SendBody) -> Result<Value, WireError> {
    if (b.text.trim().is_empty() && b.images.is_empty() && b.files.is_empty()) || b.text.len() > TEXT_MAX {
        return Err(fail("bad-text", "the message is empty or too long"));
    }
    if b.images.len() + b.files.len() > IMAGES_MAX {
        return Err(fail("too-many-attachments", "too many attachments in one message"));
    }
    let chat = find(&b.chat)?;
    // 그림 · 파일 — 파일을 읽고 쓰는 일이라 채팅 잠금 앞에서(CLI 는 채팅마다 고정 — 바꾸면 `open` 이 새 채팅을 세운다). Claude 만 그림
    // 바이트를 싣는다.
    let cli = lock(&chat.st).cli;
    let images = chat_images(&b.images, cli == Cli::Claude)?;
    let attached = chat_files(&chat.id, &b.files)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if !st.core.has_proc() {
        spawn(&chat, &mut st)?;
    }
    let deadline = Instant::now() + Duration::from_millis(turn::START_MS);
    while st.core.status() == Status::Starting && st.core.has_proc() {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            st.core.kill("start-timeout");
            return Err(fail("start-timeout", "the side chat CLI did not become ready in time"));
        }
        st = chat.cv.wait_timeout(st, left).unwrap_or_else(|e| e.into_inner()).0;
    }
    let epoch = st.core.id();
    // 연결이 서거나 바뀐 뒤의 첫 글 — 앱 고정 연결 머리글을 앞에 붙인다(5단계 · 서버가 아는 연결 · 거울의 타일 이름으로만 짓는다).
    let text = if st.link_note { format!("{}{}", link_header_now(&chat.id, b.link_name.as_deref()), b.text) } else { b.text.clone() };
    let text = with_file_refs(&text, &attached);
    let Some(a) = st.core.adapter() else {
        return Err(fail("exited", "the side chat CLI exited before it was ready"));
    };
    let step = a.encode_user(&text, &images, b.client_id.as_deref()).map_err(|w| fail(w, "the message was not sent"))?;
    // 붙인 머리글이 알린 연결(화면의 칩 — 기록 보기가 같은 글을 같은 함수로 읽는다). 붙이지 않았으면 없음.
    let link = if st.link_note { crate::side_chat::event::parse_link_note(&text).map(|(l, _)| l) } else { None };
    st.link_note = false;
    // 다른 창이 그 글을 곧바로 그리게 — 사람이 친 본문(머리글 없이) · 그림 파일 이름만 적어 둔다(`Host::shape` 가 `userAccepted` 에 얹는다).
    // 사건을 내는 읽기 스레드는 이 잠금이 풀린 뒤에야 반영하므로 apply 앞이든 뒤든 같다.
    let files = images
        .iter()
        .map(|im| im.path.as_str())
        .chain(attached.iter().map(|f| f.path.as_str()))
        .filter_map(|p| Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect();
    if st.sent.len() >= SENT_MAX {
        st.sent.pop_front();
    }
    st.sent.push_back(Sent { client_id: b.client_id, text: b.text, files });
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!({ "epoch": epoch, "link": link }))
}

/// 사람 글 하나에 붙이는 그림 수 상한.
const IMAGES_MAX: usize = 8;
/// 그림 한 장의 상한 — 기록 그림(`agent_transcript::IMAGE_MAX_BYTES`)과 같은 10 MB.
const IMAGE_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// **보내기에 붙인 그림을 다시 본다**(2026-10-24) — 화면이 준 경로는 앱 첨부 자리(`agent_attachments::attachments_root` — 끌어 놓기 ·
/// 붙여넣기의 사본 자리) 안의 실제 파일만 받는다. 실패는 이유 코드 하나: `too-many-images`(8장 넘음) · `image-missing`(없음 · 못 엶) ·
/// `image-outside`(실제 경로가 첨부 자리 밖 — 링크로 빠져나가도 같다) · `image-not-file` · `image-type`(png · jpg · jpeg · gif · webp 밖) ·
/// `image-too-big`(10 MB 넘음). 블로킹(파일을 읽는다) — op 는 블로킹 풀에서 돈다.
fn chat_images(paths: &[String], bytes: bool) -> Result<Vec<crate::side_chat::UserImage>, WireError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let root = crate::agent_attachments::attachments_root().map_err(|_| fail("image-outside", "the attachment folder is unavailable"))?;
    images_in(&root, paths, bytes)
}

fn images_in(root: &Path, paths: &[String], bytes: bool) -> Result<Vec<crate::side_chat::UserImage>, WireError> {
    if paths.len() > IMAGES_MAX {
        return Err(fail("too-many-images", "too many images in one message"));
    }
    let root = std::fs::canonicalize(root).map_err(|_| fail("image-outside", "the attachment folder is unavailable"))?;
    paths
        .iter()
        .map(|p| {
            let real = std::fs::canonicalize(p).map_err(|_| fail("image-missing", "an attached image is missing"))?;
            if real == root || !real.starts_with(&root) {
                return Err(fail("image-outside", "an attached image is outside the attachment folder"));
            }
            let meta = std::fs::metadata(&real).map_err(|_| fail("image-missing", "an attached image is missing"))?;
            if !meta.is_file() {
                return Err(fail("image-not-file", "an attachment is not a file"));
            }
            let ext = real.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
            let media_type = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                _ => return Err(fail("image-type", "only png, jpeg, gif and webp images can be attached")),
            };
            if meta.len() > IMAGE_MAX_BYTES {
                return Err(fail("image-too-big", "an attached image is larger than 10 MB"));
            }
            let data = if bytes {
                let raw = std::fs::read(&real).map_err(|_| fail("image-missing", "an attached image could not be read"))?;
                if raw.len() as u64 > IMAGE_MAX_BYTES {
                    return Err(fail("image-too-big", "an attached image is larger than 10 MB"));
                }
                Some(crate::setup_script::base64_encode(&raw))
            } else {
                None
            };
            Ok(crate::side_chat::UserImage { path: plain_path(&real), media_type, data })
        })
        .collect()
}

/// `canonicalize` 의 Windows 확장 머리(`\\?\C:\…`)를 걷은 글 — CLI 에 넘기는 경로(UNC 는 그대로).
fn plain_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => rest.to_string(),
        _ => s.into_owned(),
    }
}

/// 그림 밖 첨부 한 개의 상한 — 그림과 같은 10 MB(사용자 결정 2026-11-14).
const FILE_MAX_BYTES: u64 = IMAGE_MAX_BYTES;
/// 채팅 자기 폴더 안 사본 자리의 이름(`sidechat/<id>/attachments/`).
const FILES_DIR: &str = "attachments";

/// 채팅 자기 폴더로 옮겨 적은 첨부 하나 — CLI 가 읽을 경로(확장 머리 없음).
#[derive(Debug, PartialEq)]
pub(super) struct AttachedFile {
    path: String,
}

/// **보내기에 붙인 그림 밖 파일**(판 32 · 2026-11-14) — 화면이 준 경로는 그림과 같이 **앱 첨부 자리 안의 실제 파일만** 받고, 서버가
/// **늘 그 채팅 자기 폴더**(`<데이터 루트>/sidechat/<id>/`) 안 `attachments/` 에 사본을 둔다 — 갈라 온 채팅도 기록된 cwd(사용자 저장소)에는
/// 쓰지 않는다(사용자 결정). 자기 폴더가 cwd 인 채팅은 Claude 의 미리 허용 `Read(./**)`(`side_chat::claude::ALLOWED`)에 들고, 갈라 온 Claude
/// 채팅은 띄울 때 그 폴더 하나의 읽기를 더한다([`attach_read`]). 채팅을 지우면 폴더째 지워진다(`store::remove_chat_dir`). 사본 자리는
/// 서버가 정한다 — 화면은 경로를 보내지 않는다. 블로킹(파일을 읽고 쓴다).
fn chat_files(id: &str, paths: &[String]) -> Result<Vec<AttachedFile>, WireError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let root = crate::agent_attachments::attachments_root().map_err(|_| fail("file-outside", "the attachment folder is unavailable"))?;
    let chats = sidechat_root().ok_or_else(|| fail("no-data-root", "the app data folder is unknown"))?;
    let own = store::chat_dir(&chats, id).ok_or_else(|| fail("bad-chat", "invalid side chat id"))?;
    std::fs::create_dir_all(&own).map_err(|e| fail("chat-dir", e.to_string()))?;
    files_in(&root, &own, paths)
}

/// **갈라 온 Claude 채팅의 첨부 폴더 읽기**(판 32 · 2026-11-14) — 채팅 자기 폴더의 `attachments/` 를 지금 만들고(없으면 `--add-dir` 가 실패한다 ·
/// 링크 · 정션이면 [`files_dir`] 가 거절 → 더하지 않는다) → (`--add-dir` 경로, `--allowedTools` 규칙). 규칙은 오케스트레이션과 같은
/// [`crate::orchestration::spawn::claude_read_rule`](`C:\a\b` → `Read(//c/a/b/**)` — Claude Code 의 절대 경로 규칙은 `//` + POSIX 드라이브
/// 경로 · 1b 실측 형식). 경로에 규칙 문법 글자가 있으면 `None`(허용 없이 띄운다 — 그 읽기는 권한 카드).
fn attach_read(id: &str) -> Option<(String, String)> {
    let own = store::chat_dir(&sidechat_root()?, id)?;
    let dir = plain_path(&files_dir(&own).ok()?);
    let rule = crate::orchestration::spawn::claude_read_rule(Path::new(&dir))?;
    Some((dir, rule))
}

/// [`chat_files`] 의 몸(시험이 자리를 준다). 실패는 이유 코드 하나: `too-many-attachments` · `file-missing` · `file-outside`(실제 경로가 첨부
/// 자리 밖 — 링크 · `..` 로 빠져나가도 같다) · `file-not-file` · `file-too-big`(10 MB 넘음) · `file-dest`(사본 자리가 cwd 안의 실제 폴더가
/// 아니다 — `attachments` 가 링크 · 정션이거나 만들 수 없다) · `file-copy`. **모두 확인한 뒤에 옮긴다**(하나라도 틀리면 아무것도 쓰지 않는다).
/// 같은 이름은 덮지 않고 ` (2)` · ` (3)` … 를 붙인다(`create_new`).
pub(super) fn files_in(root: &Path, cwd: &Path, paths: &[String]) -> Result<Vec<AttachedFile>, WireError> {
    if paths.len() > IMAGES_MAX {
        return Err(fail("too-many-attachments", "too many attachments in one message"));
    }
    let root = std::fs::canonicalize(root).map_err(|_| fail("file-outside", "the attachment folder is unavailable"))?;
    let mut picked = Vec::with_capacity(paths.len());
    for p in paths {
        let real = std::fs::canonicalize(p).map_err(|_| fail("file-missing", "an attached file is missing"))?;
        if real == root || !real.starts_with(&root) {
            return Err(fail("file-outside", "an attached file is outside the attachment folder"));
        }
        let meta = std::fs::metadata(&real).map_err(|_| fail("file-missing", "an attached file is missing"))?;
        if !meta.is_file() {
            return Err(fail("file-not-file", "an attachment is not a file"));
        }
        if meta.len() > FILE_MAX_BYTES {
            return Err(fail("file-too-big", "an attached file is larger than 10 MB"));
        }
        let Some(name) = real.file_name().map(|n| n.to_os_string()) else {
            return Err(fail("file-missing", "an attached file has no name"));
        };
        picked.push((real, name));
    }
    let dest = files_dir(cwd)?;
    picked.into_iter().map(|(real, name)| copy_unique(&real, &dest, Path::new(&name))).collect()
}

/// `<채팅 폴더>/attachments` — 없으면 만들고, **링크 · 정션이 아닌 그 폴더 바로 아래 실제 폴더**인지 본다(밖으로 쓰지 않게).
fn files_dir(cwd: &Path) -> Result<PathBuf, WireError> {
    let bad = || fail("file-dest", "the attachment folder in the chat folder is not usable");
    let cwd = std::fs::canonicalize(cwd).map_err(|_| bad())?;
    let dir = cwd.join(FILES_DIR);
    match std::fs::symlink_metadata(&dir) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err(bad()),
        Ok(_) => {}
        Err(_) => std::fs::create_dir(&dir).map_err(|_| bad())?,
    }
    // 정션처럼 `is_symlink` 가 못 알아볼 수 있는 되돌림도 — 실제 경로가 그 자리 그대로여야 한다
    if std::fs::canonicalize(&dir).map_err(|_| bad())? != dir {
        return Err(bad());
    }
    Ok(dir)
}

/// `dir` 에 `name`(차면 `이름 (2).확장` …)으로 새로 만들어 옮겨 적는다 — 있는 파일은 덮지 않는다.
fn copy_unique(src: &Path, dir: &Path, name: &Path) -> Result<AttachedFile, WireError> {
    use std::io::{Read, Write};
    let copy_err = || fail("file-copy", "an attached file could not be copied");
    let stem = name.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = name.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1..=999u32 {
        let candidate = if n == 1 { dir.join(name) } else { dir.join(format!("{stem} ({n}){ext}")) };
        let mut out = match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(copy_err()),
        };
        let written = std::fs::File::open(src)
            .and_then(|f| std::io::copy(&mut f.take(FILE_MAX_BYTES + 1), &mut out))
            .and_then(|w| out.flush().map(|()| w));
        drop(out);
        match written {
            Ok(w) if w <= FILE_MAX_BYTES => return Ok(AttachedFile { path: plain_path(&candidate) }),
            Ok(_) => {
                let _ = std::fs::remove_file(&candidate);
                return Err(fail("file-too-big", "an attached file is larger than 10 MB"));
            }
            Err(_) => {
                let _ = std::fs::remove_file(&candidate);
                return Err(copy_err());
            }
        }
    }
    Err(copy_err())
}

/// **사람 글 끝에 붙인 파일의 경로** — 빈 줄 하나 뒤 한 줄에 하나 `Attached file: <절대 경로>`. **순수**.
///
/// 형식을 고른 이유: Claude 의 `@경로` 는 대화형 TUI 입력 칸이 펼치는 기능이고, 사이드 채팅이 쓰는 stream-json 입력 · Codex app-server
/// `turn/start` 의 글은 CLI 가 펼치지 않고 모델에 그대로 간다. 두 CLI 모두 모델이 이 글을 읽고 Read · 셸 읽기로 연다 — 그래서 CLI 문법에
/// 기대지 않는 **꾸밈 없는 꼬리표 + 절대 경로**(Claude Read 는 절대 경로를 받는다 · cwd 안이라 `Read(./**)` 미리 허용에 든다)로 둔다.
/// 영어 고정 — 모델에 가는 앱 고정 글이다(연결 머리글과 같은 결). 재료는 서버가 지은 사본 경로뿐(이름은 사람이 붙인 파일의 이름) — AI 문자열이
/// 끼지 않는다.
fn with_file_refs(text: &str, files: &[AttachedFile]) -> String {
    if files.is_empty() {
        return text.to_string();
    }
    use crate::side_chat::event::FILE_REF_PREFIX;
    let refs: Vec<String> = files.iter().map(|f| format!("{FILE_REF_PREFIX}{}", f.path)).collect();
    if text.trim().is_empty() {
        return refs.join("\n");
    }
    // 끝 줄바꿈만 걷는다(머리글만 있는 글의 `] ` 는 남긴다 — 기록 보기가 머리글 · 꼬리를 둘 다 떼어 읽는다: `parse_file_refs`)
    format!("{}\n\n{}", text.trim_end_matches(['\n', '\r']), refs.join("\n"))
}

/// **완료 확인 공유**(머리말) — 낡지 않았으면 방송하고 `{sent}`. 채팅이 없어도 오류가 아니다(이미 닫힌 채팅의 늦은 확인).
fn op_seen(b: SeenBody) -> Value {
    let payload = find(&b.chat).ok().and_then(|chat| {
        let st = lock(&chat.st);
        seen_payload(&chat.id, st.core.id().get(), st.core.seq(), b.epoch, b.seq)
    });
    let sent = payload.is_some();
    if let Some(p) = payload {
        hub::emit(SEEN_EVENT, p);
    }
    json!({ "sent": sent })
}

/// 방송할 몸 — **순수**. 세대가 다르거나(다시 떴다 · CLI 를 바꿨다) 서버가 아직 내지 않은 번호면 `None`.
fn seen_payload(chat: &str, cur_epoch: u64, cur_seq: u64, epoch: u64, seq: u64) -> Option<Value> {
    if epoch != cur_epoch || seq > cur_seq {
        return None;
    }
    Some(json!({ "chat": chat, "epoch": epoch, "seq": seq }))
}

fn op_interrupt(b: EpochBody) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    let Some(a) = st.core.adapter() else { return Ok(json!(false)) };
    match a.encode_interrupt() {
        Ok(step) => {
            chat_proc::apply(&*chat, &mut st, step);
            Ok(json!(true))
        }
        Err(_) => Ok(json!(false)),
    }
}

fn op_set_model(b: ModelBody) -> Result<Value, WireError> {
    if !word_ok(&b.model) {
        return Err(fail("bad-model", "invalid model"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    st.model = b.model.clone();
    let Some(a) = st.core.adapter() else { return Ok(json!(false)) };
    let step = a.encode_set_model(&b.model).map_err(|w| fail(w, "the model was not changed"))?;
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

/// **추론 강도 바꾸기** — 이 함수가 `encode_set_effort` 를 부르는 유일한 곳이다(시험 `side_chat_stdin_only_human`). 다음 띄우기의
/// 재료로 적고, 산 프로세스면 다시 띄우지 않고 곧바로(Claude 제어 요청 · Codex 다음 턴).
fn op_set_effort(b: EffortBody) -> Result<Value, WireError> {
    if b.effort.as_deref().is_some_and(|e| !word_ok(e)) {
        return Err(fail("bad-effort", "invalid reasoning effort"));
    }
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    let Some(a) = st.core.adapter() else {
        st.effort = b.effort;
        return Ok(json!(false));
    };
    let step = a.encode_set_effort(b.effort.as_deref()).map_err(|w| fail(w, "the reasoning effort was not changed"))?;
    st.effort = b.effort;
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

/// **사람의 권한 결정** — 이 함수가 `encode_decision` 을 부르는 유일한 곳이다(MCP · 오케스트레이션에 이 길이 없다 — 시험).
fn op_decide(b: DecideBody) -> Result<Value, WireError> {
    let decision = match b.decision.as_str() {
        "allow" => Decision::Allow,
        "deny" => Decision::Deny,
        _ => return Err(fail("bad-decision", "unknown decision")),
    };
    let chat = find(&b.chat)?;
    let mut st = lock(&chat.st);
    check_epoch(&st, b.epoch)?;
    if !st.core.is_pending(&b.request_id) {
        return Err(fail("unknown-request", "no such permission request is waiting"));
    }
    let Some(a) = st.core.adapter() else {
        return Err(fail("unknown-request", "no such permission request is waiting"));
    };
    let step = a
        .encode_decision(&b.request_id, decision, b.message.as_deref())
        .map_err(|w| fail(w, "the decision was not sent"))?;
    chat_proc::apply(&*chat, &mut st, step);
    Ok(json!(true))
}

// ---------------------------------------------------------------------------
// 연결(5단계 — 세션 연결 칩 · `crate::chat_token`)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkBody {
    chat: String,
    #[serde(default)]
    epoch: Option<u64>,
    /// 연결할 타일의 스트림 id(`historyStreamId`) · `None` = 연결 끊기.
    #[serde(default)]
    stream: Option<String>,
}

/// 연결해도 되는 스트림인가 — **순수**: 모양이 맞고, 서버 거울에 있는 **창 타일**의 세션이다(헤드리스 · 모르는 스트림은 아니다). 읽기
/// 권한은 여기서 보지 않는다 — 꺼진 타일도 걸 수 있고(칩이 그 사실을 말한다) 판정은 MCP 호출마다(`mcp/chat_read.rs`).
pub(crate) fn link_target_ok(map: &HashMap<String, crate::context::SessionContext>, stream: &str) -> bool {
    crate::tile_env::stream_ok(stream)
        && map.get(stream).is_some_and(|c| c.owner_kind == crate::session_owner::SessionOwnerKind::Window)
}

/// 거울의 그 세션 — (코드 · 이름 · 종류 · 권한 판정용 칸).
fn mirror_of(stream: &str) -> Option<(String, String, String, crate::context::SessionContext)> {
    let plane = hub::ai()?;
    let m = plane.ctx().lock().unwrap_or_else(|e| e.into_inner());
    m.get(stream).map(|c| (c.code.clone(), c.label.clone(), c.kind.clone(), crate::context::permission_view(c)))
}

/// 그 채팅의 연결 — 화면용(`null` = 연결 없음 · `closed` = 거울에 없음 — 타일이 닫혔다 · `readable` = 지금 AI 가 읽을 수 있나).
fn link_view(chat: &str) -> Value {
    let Some(stream) = crate::chat_token::link_of(chat) else { return Value::Null };
    match mirror_of(&stream) {
        Some((code, label, kind, view)) => {
            let readable = crate::context::ai_readable(&view, &crate::delegation::Delegation::load_default());
            json!({ "stream": stream, "code": code, "label": label, "kind": kind, "readable": readable, "closed": false })
        }
        None => json!({ "stream": stream, "code": null, "label": null, "kind": null, "readable": false, "closed": true }),
    }
}

/// 지금 연결의 머리글(`side_chat::event::link_header`) — 이름은 화면이 보낼 때 실은 칩 이름(`hint`), 없으면 거울의 타일 이름
/// (`link_display_name` — 타일 코드는 넣지 않는다). 스트림은 늘 서버가 아는 연결이다(화면이 고를 수 없다).
fn link_header_now(chat: &str, hint: Option<&str>) -> String {
    let link = crate::chat_token::link_of(chat);
    let label = link.as_deref().and_then(mirror_of).map(|(_, label, ..)| label);
    let name = crate::side_chat::event::link_display_name(hint, label.as_deref());
    crate::side_chat::event::link_header(link.as_deref().map(|s| (s, name.as_str())))
}

/// **연결을 바꾼다**(사람이 칩에서 — Tauri 명령 `side_chat_link` · 주 창 · 원격 창). 스트림은 서버 거울에 있는 창 타일만
/// ([`link_target_ok`]). 바뀌었으면 다음 보내기에 머리글을 붙인다. → `{link, changed}`.
fn op_link(b: LinkBody) -> Result<Value, WireError> {
    let chat = find(&b.chat)?;
    if let Some(e) = b.epoch {
        check_epoch(&lock(&chat.st), e)?;
    }
    if let Some(s) = b.stream.as_deref() {
        let plane = hub::ai().ok_or_else(|| fail("no-mirror", "the session mirror is not available"))?;
        let ok = link_target_ok(&plane.ctx().lock().unwrap_or_else(|e| e.into_inner()), s);
        if !ok {
            return Err(fail("bad-link", "that tile is not an open session the server knows"));
        }
    }
    let changed = crate::chat_token::set_link(&b.chat, b.stream);
    if changed {
        lock(&chat.st).link_note = true;
    }
    Ok(json!({ "link": link_view(&b.chat), "changed": changed }))
}

/// 그 채팅의 **지금 산 프로세스 세대**(채팅 토큰 판정 — `crate::chat_token::authenticate`). 프로세스가 없거나 닫는 중이면 `None`.
pub(crate) fn live_proc(id: &str) -> Option<ProcId> {
    let chat = lock(&TABLE).chats.get(id).cloned()?;
    let live = lock(&chat.st).core.live();
    live
}

/// 닫는다(표에서 빼고 프로세스를 잡째 끝낸다). 표에 있었나.
fn close(id: &str) -> bool {
    let Some(chat) = lock(&TABLE).chats.remove(id) else { return false };
    lock(&chat.st).core.kill("closed");
    crate::chat_token::forget(id);
    true
}

fn list() -> Value {
    let chats: Vec<Arc<Chat>> = lock(&TABLE).chats.values().cloned().collect();
    let mut rows: Vec<Value> = chats
        .iter()
        .map(|c| {
            let st = lock(&c.st);
            json!({
                "chat": c.id,
                "cli": st.cli,
                "model": st.model,
                "effort": st.effort,
                "epoch": st.core.id(),
                "status": st.core.status(),
                "conversationId": st.conv_seen.as_ref().or(st.conversation.as_ref()),
                "viewers": st.viewers.len(),
                "detached": st.detached.is_some(),
            })
        })
        .collect();
    rows.sort_by(|a, b| a["chat"].as_str().cmp(&b["chat"].as_str()));
    json!(rows)
}

// ---------------------------------------------------------------------------
// 수명 — 떼어 두기 · TTL · 모두 닫기
// ---------------------------------------------------------------------------

/// 서버 연결이 섰다(`sessions::conn_opened`).
pub(crate) fn conn_opened(conn: u64) {
    lock(&TABLE).conns.insert(conn);
}

/// 고른 보는 창을 뗀다 — 남은 창이 없으면 그 순간부터 떼어 둔다(TTL). 창을 뗀 채팅 수.
fn detach_where(pick: impl Fn(&Viewer) -> bool) -> usize {
    let chats: Vec<Arc<Chat>> = lock(&TABLE).chats.values().cloned().collect();
    let now = Instant::now();
    let mut n = 0;
    for c in chats {
        let mut st = lock(&c.st);
        let before = st.viewers.len();
        st.viewers.retain(|v| !pick(v));
        if st.viewers.len() == before {
            continue;
        }
        n += 1;
        if st.viewers.is_empty() && st.detached.is_none() {
            st.detached = Some(now);
        }
    }
    if n > 0 {
        wake_reaper();
    }
    n
}

/// 서버 연결이 끊겼다(GUI 종료 · kill) — 그 연결의 보는 창을 뗀다(남은 창이 없으면 떼어 둔다 — TTL). 창을 뗀 채팅 수.
pub(crate) fn conn_gone(conn: u64) -> usize {
    lock(&TABLE).conns.remove(&conn);
    detach_where(|v| v.conn == conn)
}

/// 페이지 리로드 · 웹뷰 크래시 · 트레이로 가는 창 파괴 · 창 파괴(원격 창의 ws 끝 포함 — `close_window`) — **그 창 하나만** 뗀다(다른 창은
/// 계속 받는다 · 남은 창이 없으면 떼어 둔다 — 새 페이지가 `side_chat_attach`). 창을 뗀 채팅 수.
pub(crate) fn detach_window(window: &str) -> usize {
    detach_where(|v| v.window == window)
}

/// 시험 전용 — 그 채팅의 (보는 창 라벨들, 떼어 둠 여부).
#[cfg(test)]
pub(crate) fn viewers_for_test(id: &str) -> Option<(Vec<String>, bool)> {
    let chat = lock(&TABLE).chats.get(id).cloned()?;
    let st = lock(&chat.st);
    Some((windows_of(&st), st.detached.is_some()))
}

/// 모두 닫는다 — 트레이 [모든 세션 종료](`sessions` `close_all`) · 서버 끝. 닫은 수.
pub(crate) fn close_all() -> usize {
    let chats: Vec<Arc<Chat>> = lock(&TABLE).chats.drain().map(|(_, c)| c).collect();
    for c in &chats {
        lock(&c.st).core.kill("closed");
        crate::chat_token::forget(&c.id);
    }
    chats.len()
}

/// 표에 있는 채팅 수(붙었거나 떼어 둔) — `status` 의 진단 칸.
pub(crate) fn live_count() -> usize {
    lock(&TABLE).chats.len()
}

/// 떼어 둔 채팅을 살려 두는 시간 — 시험이 짧게 바꾼다(ms · 0 = [`DETACH_TTL`]).
static TTL_OVERRIDE_MS: AtomicU64 = AtomicU64::new(0);

fn ttl() -> Duration {
    match TTL_OVERRIDE_MS.load(Ordering::SeqCst) {
        0 => DETACH_TTL,
        ms => Duration::from_millis(ms),
    }
}

/// 시험 전용 — TTL 을 바꾼다(`None` = 원래대로).
#[cfg(test)]
pub(crate) fn set_detach_ttl_for_test(d: Option<Duration>) {
    TTL_OVERRIDE_MS.store(d.map_or(0, |d| d.as_millis().max(1) as u64), Ordering::SeqCst);
    REAPER_WAKE.notify_one();
}

/// TTL 이 지난 떼어 둔 채팅 중 **쉬는 것**(턴이 돌지 않거나 · 사람이 없어 끝날 수 없는 권한 요청을 기다리는 것)을 닫는다. 닫은 수와 다음
/// 볼 시각.
fn expire(now: Instant) -> (usize, Option<Instant>) {
    let ttl = ttl();
    let mut t = lock(&TABLE);
    let mut next: Option<Instant> = None;
    let mut doomed = Vec::new();
    for (id, c) in &t.chats {
        let st = lock(&c.st);
        let Some(at) = st.detached else { continue };
        let due = at + ttl;
        if due > now {
            next = Some(next.map_or(due, |n| n.min(due)));
        } else if st.core.status() == Status::Running && !st.core.has_pending() {
            // 도는 턴은 끝까지 — 턴이 끝나면(감시 · 끝 사건) 다시 본다. 혹시 몰라 1초 뒤에도.
            let again = now + Duration::from_secs(1);
            next = Some(next.map_or(again, |n| n.min(again)));
        } else {
            doomed.push(id.clone());
        }
    }
    let gone: Vec<Arc<Chat>> = doomed.iter().filter_map(|id| t.chats.remove(id)).collect();
    drop(t);
    for c in &gone {
        lock(&c.st).core.kill("closed");
        crate::chat_token::forget(&c.id);
    }
    (gone.len(), next)
}

static REAPER_WAKE: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);
static REAPER_RUNNING: AtomicBool = AtomicBool::new(false);

/// 시계를 깨운다 — 없으면(처음 · 시험 런타임이 바뀌었다) 지금 런타임에 띄운다(런타임 밖 스레드면 깨우기만).
fn wake_reaper() {
    if !REAPER_RUNNING.swap(true, Ordering::SeqCst) {
        match tokio::runtime::Handle::try_current() {
            Ok(rt) => {
                rt.spawn(reaper());
            }
            Err(_) => REAPER_RUNNING.store(false, Ordering::SeqCst),
        }
    }
    REAPER_WAKE.notify_one();
}

struct ReaperFlag;

impl Drop for ReaperFlag {
    fn drop(&mut self) {
        REAPER_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// **TTL 시계** — 표 하나에 태스크 하나(`db::table::reaper` 와 같은 꼴).
async fn reaper() {
    let _flag = ReaperFlag;
    loop {
        let (gone, next) = expire(Instant::now());
        if gone > 0 {
            log::line(format!("side chat: closed {gone} detached chat(s) after the {} s grace", ttl().as_secs()));
        }
        match next {
            Some(at) => {
                tokio::select! {
                    _ = tokio::time::sleep_until(at.into()) => {}
                    _ = REAPER_WAKE.notified() => {}
                }
            }
            None => REAPER_WAKE.notified().await,
        }
    }
}

// ---------------------------------------------------------------------------
// 시험 — 가짜 CLI
// ---------------------------------------------------------------------------

/// 시험 전용 — 실행 파일 · 인자 · 더할 환경 · 채팅 루트를 바꾼다(모델을 부르지 않는 가짜 CLI — `tests_side_chat.rs`).
#[cfg(test)]
pub(crate) struct FakeCli {
    pub exe: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub root: PathBuf,
    /// 세션 서버 MCP 포트 대신(`None` = MCP 없음 — 채팅 토큰을 뽑지 않는다).
    pub mcp_port: Option<u16>,
    /// 대화 색인의 루트 대신(`(에이전트 id, 루트)` — 6단계 갈라 오기의 기록된 cwd).
    pub conv_roots: Vec<(&'static str, PathBuf)>,
}

#[cfg(test)]
static FAKE: Mutex<Option<FakeCli>> = Mutex::new(None);

#[cfg(test)]
pub(crate) fn set_fake_for_test(f: Option<FakeCli>) {
    *lock(&FAKE) = f;
}

/// 시험 전용 — 저장된 설정 대신 읽을 외부 서버 목록(시험 빌드는 진짜 설정을 읽지 않는다 — `None` = 없음).
#[cfg(test)]
static FAKE_SERVERS: Mutex<Option<Vec<crate::agent_mcp::McpServer>>> = Mutex::new(None);

#[cfg(test)]
pub(crate) fn set_fake_servers_for_test(list: Option<Vec<crate::agent_mcp::McpServer>>) {
    *lock(&FAKE_SERVERS) = list;
}

#[cfg(test)]
mod image_tests {
    use super::*;

    fn reason(e: WireError) -> String {
        e.message
    }

    /// 그림 판정 — 첨부 자리 안의 그림 파일만 · 이유 코드 하나씩(2026-10-24).
    #[test]
    fn images_only_from_the_attachment_folder() {
        let base = std::env::temp_dir().join(format!("aynx-sidechat-img-{}", crate::token::generate_token().unwrap()));
        let root = base.join("attachments");
        let dir = root.join("a".repeat(64));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("붙임 1.PNG");
        std::fs::write(&png, [0x89, b'P', b'N', b'G']).unwrap();
        let txt = dir.join("note.txt");
        std::fs::write(&txt, b"x").unwrap();
        let outside = base.join("out.png");
        std::fs::write(&outside, b"x").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();

        let ok = images_in(&root, &[s(&png)], true).unwrap();
        assert_eq!(ok.len(), 1);
        assert_eq!(ok[0].media_type, "image/png");
        assert_eq!(ok[0].data.as_deref(), Some(crate::setup_script::base64_encode(&[0x89, b'P', b'N', b'G']).as_str()));
        assert!(!ok[0].path.starts_with(r"\?\"), "CLI 에는 확장 머리 없는 경로");
        assert!(Path::new(&ok[0].path).ends_with("붙임 1.PNG"));
        // Codex 몫은 바이트를 읽지 않는다
        assert_eq!(images_in(&root, &[s(&png)], false).unwrap()[0].data, None);
        // 첨부 자리 밖 · `..` 로 빠져나가기
        let escape = format!("{}/../../out.png", s(&dir));
        for p in [s(&outside), escape] {
            assert!(reason(images_in(&root, &[p], false).unwrap_err()).contains("[image-outside]"));
        }
        assert!(reason(images_in(&root, &[s(&root)], false).unwrap_err()).contains("[image-outside]"));
        assert!(reason(images_in(&root, &[s(&dir)], false).unwrap_err()).contains("[image-not-file]"));
        assert!(reason(images_in(&root, &[s(&txt)], false).unwrap_err()).contains("[image-type]"));
        assert!(reason(images_in(&root, &[s(&dir.join("없음.png"))], false).unwrap_err()).contains("[image-missing]"));
        let many: Vec<String> = (0..=IMAGES_MAX).map(|_| s(&png)).collect();
        assert!(reason(images_in(&root, &many, false).unwrap_err()).contains("[too-many-images]"));
        assert_eq!(images_in(&root, &many[..IMAGES_MAX], false).unwrap().len(), IMAGES_MAX);
        let big = dir.join("big.webp");
        std::fs::File::create(&big).unwrap().set_len(IMAGE_MAX_BYTES + 1).unwrap();
        assert!(reason(images_in(&root, &[s(&big)], false).unwrap_err()).contains("[image-too-big]"));
        assert!(chat_images(<&[String]>::default(), true).unwrap().is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }

    /// 파일 첨부(판 32) — 첨부 자리 안의 실제 파일만 · 사본은 채팅 자기 폴더의 `attachments/` · 같은 이름은 번호 · 이유 코드 하나씩.
    #[test]
    fn files_only_from_the_attachment_folder_into_the_chat_cwd() {
        let base = std::env::temp_dir().join(format!("aynx-sidechat-file-{}", crate::token::generate_token().unwrap()));
        let root = base.join("attachments");
        let dir = root.join("b".repeat(64));
        let cwd = base.join("chat");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&cwd).unwrap();
        let ts = dir.join("main.ts");
        std::fs::write(&ts, b"export {}").unwrap();
        let noext = dir.join("Makefile");
        std::fs::write(&noext, b"all:").unwrap();
        let outside = base.join("secret.txt");
        std::fs::write(&outside, b"x").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();

        let got = files_in(&root, &cwd, &[s(&ts), s(&noext)]).unwrap();
        let real_cwd = std::fs::canonicalize(&cwd).unwrap();
        let first = Path::new(&got[0].path);
        assert!(!got[0].path.starts_with(r"\\?\"), "CLI 에는 확장 머리 없는 경로");
        assert!(first.ends_with("attachments/main.ts") || first.ends_with(r"attachments\main.ts"));
        assert!(Path::new(&plain_path(&real_cwd)).join("attachments").join("main.ts") == first);
        assert_eq!(std::fs::read(first).unwrap(), b"export {}");
        assert!(Path::new(&got[1].path).ends_with("Makefile"));
        // 같은 이름은 덮지 않는다 — ` (2)` · ` (3)`
        let again = files_in(&root, &cwd, &[s(&ts), s(&ts)]).unwrap();
        assert!(Path::new(&again[0].path).ends_with("main (2).ts"));
        assert!(Path::new(&again[1].path).ends_with("main (3).ts"));
        assert_eq!(std::fs::read(first).unwrap(), b"export {}", "처음 사본은 그대로");
        // 첨부 자리 밖 · `..` 로 빠져나가기 · 폴더 · 없음
        let escape = format!("{}/../../secret.txt", s(&dir));
        for p in [s(&outside), escape, s(&cwd.join("attachments").join("main.ts"))] {
            assert!(reason(files_in(&root, &cwd, &[p]).unwrap_err()).contains("[file-outside]"));
        }
        assert!(reason(files_in(&root, &cwd, &[s(&root)]).unwrap_err()).contains("[file-outside]"));
        assert!(reason(files_in(&root, &cwd, &[s(&dir)]).unwrap_err()).contains("[file-not-file]"));
        assert!(reason(files_in(&root, &cwd, &[s(&dir.join("없음.ts"))]).unwrap_err()).contains("[file-missing]"));
        let many: Vec<String> = (0..=IMAGES_MAX).map(|_| s(&ts)).collect();
        assert!(reason(files_in(&root, &cwd, &many).unwrap_err()).contains("[too-many-attachments]"));
        let big = dir.join("big.pdf");
        std::fs::File::create(&big).unwrap().set_len(FILE_MAX_BYTES + 1).unwrap();
        // 하나라도 틀리면 아무것도 옮기지 않는다
        let before = std::fs::read_dir(cwd.join("attachments")).unwrap().count();
        assert!(reason(files_in(&root, &cwd, &[s(&noext), s(&big)]).unwrap_err()).contains("[file-too-big]"));
        assert_eq!(std::fs::read_dir(cwd.join("attachments")).unwrap().count(), before);
        assert!(chat_files("x", &[]).unwrap().is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }

    /// 글 끝의 경로 꼬리 — 빈 줄 하나 뒤 한 줄에 하나 · 파일이 없으면 글 그대로.
    #[test]
    fn file_refs_append_after_the_text() {
        let f = |p: &str| AttachedFile { path: p.to_string() };
        assert_eq!(with_file_refs("봐 줘", &[]), "봐 줘");
        assert_eq!(
            with_file_refs("봐 줘\n", &[f(r"C:\c\attachments\a.ts"), f(r"C:\c\attachments\b.pdf")]),
            "봐 줘\n\nAttached file: C:\\c\\attachments\\a.ts\nAttached file: C:\\c\\attachments\\b.pdf"
        );
        assert_eq!(with_file_refs("", &[f("/c/attachments/a.ts")]), "Attached file: /c/attachments/a.ts");
        // 기록 읽기(`parse_file_refs`)가 그대로 되읽는다 — 머리글만 있는 글(연결이 바뀐 뒤 파일만 보냄)도 머리글 · 꼬리 둘 다
        use crate::side_chat::event::{parse_file_refs, parse_link_note, LINK_HEADER_NONE};
        let made = with_file_refs("봐 줘", &[f(r"C:\c\attachments\a.ts"), f(r"C:\c\attachments\b (2).pdf")]);
        assert_eq!(parse_file_refs(&made), Some((vec!["a.ts".to_string(), "b (2).pdf".to_string()], "봐 줘")));
        let only = with_file_refs("", &[f("/c/attachments/a.ts")]);
        assert_eq!(parse_file_refs(&only), Some((vec!["a.ts".to_string()], "")));
        let both = with_file_refs(LINK_HEADER_NONE, &[f("/c/attachments/a.ts")]);
        let (names, rest) = parse_file_refs(&both).unwrap();
        assert_eq!((names, parse_link_note(rest).map(|(_, r)| r)), (vec!["a.ts".to_string()], Some("")));
    }
}
