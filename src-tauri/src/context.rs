//! 세션 컨텍스트 저장소 — AI(MCP)에게 **읽기 전용**으로 내줄 라이브 세션 데이터.
//!
//! 설계안의 "AI 통합" 절(앱 안에 AI 를 넣지 않고, 앱을 AI 에게 열어준다)을 그대로 옮긴 것이다.
//! 프런트(xterm·OSC 133 상태 기계)가 이미 손에 쥔 것 — 열린 세션 목록, 마지막 명령의
//! 명령문·출력·종료 코드, 스크롤백 — 을 Tauri 명령으로 이 저장소에 **거울처럼 비춘다**.
//! MCP 서버([`crate::mcp`])는 그 거울을 표준 프로토콜(JSON-RPC over HTTP)로 읽기만 한다. ③-3c 부터 이 저장소는 **세션 서버
//! 프로세스**에 산다(`crate::server::ai`) — GUI 를 꺼도 거울이 남는다.
//!
//! **거울의 주인은 창이 있으면 프런트, 없으면 세션 서버다**(2026-11-09 — [`crate::screen_mirror`]). 세션 서버가 출력 바이트를 같은 뜻으로
//! 해석하는 해석기를 세션마다 두고, 붙은 주 창이 없는 동안(트레이 · GUI 종료 · 리로드 틈) 그 해석기가 [`update`] · [`push_server_block`]
//! 으로 잇는다 — 그 동안 MCP 는 `stale` 을 달지 않는다(`mirror:"server"` — `crate::mcp::sessions::enrich_sessions`). 쓰기 문지기
//! (`opted_in` · 로컬은 세션 코어의 읽기 허용)도 읽기 문지기([`ai_readable`])도 그대로다 — 서버는 사람이 정한 값을 바꾸지 않는다.
//!
//! ```text
//!   프런트 (거울 원본)                 Rust (거울)                  외부 CLI 에이전트
//!   ─────────────────                 ───────────                  ───────────────
//!   report_session ─────────────►  ContextStore  ◄──── tools/call ──── Claude Code
//!   update_session_context ─────►  (HashMap)      (list_sessions / get_last_command
//!   push_session_block ─────────►                  / get_scrollback / list_commands
//!   drop_session ───────────────►                  / get_command)
//! ```
//!
//! ## 프라이버시가 이 모듈의 뼈대다
//!
//! 세션 출력이 외부 모델로 나가는 경로가 생기므로 세션 로깅과 같은 방침을 쓴다:
//! **기본 꺼짐.** 쓰기 쪽 문지기는 `opted_in`(프런트가 정한다), 읽기 쪽 문지기는 [`ai_readable`] 이다.
//!
//! ## 누가 AI 권한을 정하나 (2026-10-07)
//!
//! - **원격(SSH) 창 타일**: 그 호스트 별칭([`SessionContext::host_alias`])의 `delegation.toml` 권한 하나
//!   ([`crate::delegation`]) — 헤드리스 세션과 같은 표를 본다. 프런트는 호스트 단계가 `read` 이상일 때만
//!   `opted_in = true` 로 보고해 거울을 채운다. 별칭이 없는(호스트 목록 밖) 원격 타일은 **언제나 off**.
//! - **로컬 창 타일**: 타일마다 "AI 읽기 허용"(`opted_in`) 하나 — 읽기만 있고 실행 권한은 없다.
//! - **헤드리스 세션**: 접속 때의 `read` 스냅샷([`SessionContext::delegation_read`]) **그리고** 지금의 `read`.
//!
//! 판정 셋은 이 모듈에 모여 있다 — 읽기 [`ai_readable`] · 작업안 대상 [`ai_plan_eligible`] · 자동 실행
//! [`ai_auto_executable`]. 모두 `&Delegation` 을 받으므로 권한이 바뀌면 다음 MCP 호출부터 바로 반영된다
//! (부르는 쪽이 요청 하나에 `delegation.toml` 을 한 번 읽는다 — 동기 Tauri 명령 안에서는 읽지 않는다).
//!
//! ## 프라이버시 게이트
//!
//! - `report_session`(GUI 프록시 → 서버 거울 묶음 `crate::server::ai`) 이 옵트아웃(`opted_in == false`)으로 오면 **그 즉시** 라이브
//!   필드(status·last·scrollback)를 비운다. "나중에 안 보냄" 이 아니라 "지금 당장 지움" 이라야
//!   프라이버시 스위치를 끈 순간 이미 공유된 데이터가 남지 않는다.
//! - `update_session_context` 는 옵트인된 항목에만 쓴다 — 옵트아웃/미등록이면 조용히 무시한다.
//! - MCP 도구 읽기([`crate::mcp`])는 [`ai_readable`] 인 항목만 본다.
//!
//! 즉 프라이버시 게이트가 **쓰기·읽기 양쪽**에 걸려 있어, 어느 한쪽 실수로 새지 않는다.
//!
//! ## 쓰기 도구는 없다
//!
//! 이 저장소를 읽는 도구는 전부 읽기 전용이다. `send_command` 류(AI 에게 실행 권한을 주는 것)는
//! 설계안 caution 대로 만들지 않는다 — AI 는 관찰·제안, 실행은 사람 손에 남긴다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::session_owner::SessionOwnerKind;

/// 프런트가 mirror 하는 스크롤백을 저장소에서 유지하는 상한. 넘치면 **뒤(tail)를 남긴다** —
/// 최근 줄이 항상 살아 있어야 "방금 왜 실패했어" 가 답이 된다.
pub(crate) const SCROLLBACK_CAP: usize = 1000;

/// `get_scrollback` 이 줄 수를 안 주면 돌려주는 기본 줄 수.
pub(crate) const SCROLLBACK_DEFAULT: usize = 200;

/// 거울이 쥐는 블록 이력의 개수 상한 — 프런트 링(타일당 200블록)과 **같은 값**이다.
/// 넘치면 **오래된 것부터** 버린다 (프런트 축출 규칙과 같다).
pub(crate) const HISTORY_CAP: usize = 200;

/// `list_commands` 가 개수를 안 주면 돌려주는 기본 블록 수([`SCROLLBACK_DEFAULT`] 와 같은 역할).
pub(crate) const HISTORY_DEFAULT: usize = 50;

/// 거울이 쥐는 블록 이력의 총량 상한(바이트). 프런트 링은 4MB 지만 거울은 **공유 타일만**
/// 들고 있고 발췌를 그대로 나르므로 더 좁게 잡는다 — 이 저장소는 MCP 응답의 재료일 뿐
/// 원본이 아니다 (원본은 웹뷰 안의 링이다).
pub(crate) const HISTORY_BYTES_CAP: usize = 1024 * 1024;

/// 마지막 명령 한 건 — OSC 133 상태 기계가 구조화한 명령 블록 그대로다.
///
/// 프런트에서 이 모양(camelCase)으로 올라오고, MCP `get_last_command` 결과로 그대로 나간다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCommand {
    /// 프롬프트에 입력된 명령문(OSC 133 `B..C` 구간). 예: `systemctl status nginx`.
    pub command_line: String,
    /// 그 명령의 출력(`C..D` 구간). 길 수 있으므로 프런트가 적당히 잘라 보낸다.
    pub output: String,
    /// 종료 코드(`D;<code>`). 아직 안 끝났거나 코드를 못 읽었으면 `None`.
    pub exit: Option<i64>,
    /// 지금 실행 중인가(=`C` 는 봤는데 `D` 는 아직). `true` 면 `exit` 는 보통 `None`.
    pub running: bool,
}

/// 명령 블록 하나의 **거울** — 프런트 `CommandBlock` 을 한 겹으로 편 모양이다
/// (docs/log/2026-09-08-block-history-store.md).
///
/// 프런트 모양을 그대로 받지 않는 이유 셋: ①`paneId` 는 저장소 키에 이미 들어 있다
/// ②중첩 `excerpt` 를 펴면 이 구조체가 한 겹으로 끝난다 ③`bytes`(프런트 축출 계산용)는
/// 밖에서 아무 뜻이 없다. [`LastCommand`] 와 같은 camelCase 계약이다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBlockMirror {
    /// 타일 안에서 단조 증가하는 번호 — MCP 가 `(session, id)` 로 블록을 지목한다.
    pub id: i64,
    /// 프롬프트에 입력된 명령문(OSC 133 `A..C` 의 화면 텍스트).
    pub command_line: String,
    /// 그 명령이 시작된 폴더(OSC 7). 셸이 말한 적 없으면 `None`.
    pub cwd: Option<String>,
    /// `C` 를 본 시각 (epoch ms).
    pub started_at: i64,
    /// `D` 를 본 시각 (epoch ms). `None` 이면 아직 실행 중.
    pub ended_at: Option<i64>,
    /// 종료 코드(`D;<code>`). 못 읽었거나 아직 안 끝났으면 `None`.
    pub exit: Option<i64>,
    /// 지금 실행 중인가 — 파생값이지만 **계약에는 명시한다**([`LastCommand::running`] 과 같다).
    pub running: bool,
    /// 출력 발췌의 머리 (앞 20줄).
    pub excerpt_head: Vec<String>,
    /// 출력 발췌의 꼬리 (뒤 500줄) — **오류가 끝에 나오기 때문에** 머리보다 길다.
    pub excerpt_tail: Vec<String>,
    /// 발췌가 무언가를 버렸는가. AI 가 "이게 전부인가" 를 추측하지 않게 하는 깃발이다.
    pub truncated: bool,
    /// 발췌를 어떻게 담았나 — `"complete"`(전부) · `"partial"`(가운데 잘림) ·
    /// `"unavailable"`(마커 유실로 출력을 못 읽었거나 아직 실행 중). `truncated` 만으로는
    /// "무출력" 과 "못 읽음" 이 구분되지 않아 프런트 발췌가 그대로 실어 보내는 값이다.
    pub capture: String,
}

impl CommandBlockMirror {
    /// 발췌(머리+꼬리)가 차지하는 대략의 양 — 줄바꿈을 한 바이트로 친다.
    ///
    /// MCP `get_command` 이 `excerpt.bytes` 로 그대로 내보낸다: AI 가 "발췌가 얼마나 실렸나"
    /// 를 [`truncated`](Self::truncated) 와 함께 보고 전문을 더 캘지 판단하는 재료다.
    pub(crate) fn excerpt_bytes(&self) -> usize {
        self.excerpt_head
            .iter()
            .chain(self.excerpt_tail.iter())
            .map(|l| l.len() + 1)
            .sum()
    }

    /// 이 블록이 차지하는 대략의 양 — 상한 계산에만 쓴다(정확한 힙 크기가 아니다).
    fn bytes(&self) -> usize {
        self.excerpt_bytes() + self.command_line.len() + self.cwd.as_ref().map_or(0, String::len)
    }
}

/// 세션 하나의 공유 상태. 정체성(label·kind·opted_in)과 라이브 필드(status·last·scrollback)로 나뉜다.
///
/// 정체성은 `report_session`(GUI 프록시 → 서버 거울 묶음 `crate::server::ai`) 이, 라이브 필드는 `update_session_context` 가 갱신한다.
/// 옵트아웃되면 라이브 필드만 비고 정체성은 남는다(다시 옵트인할 수 있게).
#[derive(Debug, Clone, Default)]
pub struct SessionContext {
    /// 추가 표시 메타데이터. 공유 게이트/stream 키/실제 창 owner와 무관하다.
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
    pub tab_key: Option<String>,
    /// 사람이 읽는 이름 — SSH 별칭(`web-01`)이나 로컬 셸 라벨. 프런트가 정한다.
    pub label: String,
    /// **타일 코드** — 사람이 헤더에서 보고 AI 가 짝짓는 짧은 손잡이(`p2` / `t7·p2`).
    ///
    /// 저장소 키(=streamId, 이관·리로드를 넘는 안정 신원)와 갈라 둔 **현재 타일 위치**다
    /// (2026-09-09 · 정체성 분리). 예전엔 이 모듈의 소비자(MCP)가 키를 파싱해 만들었지만,
    /// 이제 키가 불투명한 streamId 라 파싱할 수 없다 — 프런트가 `report_session`(GUI 프록시 → 서버 거울 묶음 `crate::server::ai`) 으로 넘겨
    /// 주고 [`crate::mcp`] 의 `list_sessions` 가 그대로 낸다. `code` 라는 이름으로 직렬화된다.
    pub code: String,
    /// 종류 — `"ssh"` / `"local"` 등. 프런트가 정하는 자유 문자열이라 여기선 해석하지 않는다.
    pub kind: String,
    /// **소유 창 라벨**(표시용 `label` 이 아니라 OS 창 라벨) — `report_session`(GUI 프록시 → 서버 거울 묶음 `crate::server::ai`) 이 webview 에서
    /// 찍는다. 창이 갑작스레 파괴돼(프런트 정리 미실행) 세션이 [`crate::reap`] 으로 거둬질 때,
    /// 그 창의 거울을 함께 되거두는 열쇠다(안 그러면 죽은 세션의 공유 데이터가 남아 프라이버시
    /// 누수). 이관/찢기로 다른 창이 다시 보고하면 새 창 라벨로 자연히 갱신된다.
    pub owner: String,
    /// **쓰기 쪽 프라이버시 문지기** — `false` 면 거울에 라이브 데이터를 받지 않는다.
    ///
    /// 로컬 타일에서는 읽기 가시성 그 자체("AI 읽기 허용")다. 원격 타일에서는 프런트가 호스트 단계
    /// (`read` 이상)를 그대로 비춰 보내는 값이고, **읽기 판정은 이 값이 아니라 호스트 권한**을 본다
    /// ([`ai_readable`]).
    pub opted_in: bool,
    /// **이 원격 타일이 따르는 호스트 별칭** — 호스트 목록(`~/.ssh/config`)에 있는 별칭일 때만
    /// `report_session`(GUI 프록시 → 서버 거울 묶음 `crate::server::ai`) 이 싣는다. 로컬 타일·빠른 접속(목록 밖) 타일은 `None`
    /// 이고, 그런 원격 타일의 AI 권한은 **off 고정**이다. 헤드리스 세션은 쓰지 않는다(별칭 = `label`).
    pub host_alias: Option<String>,
    /// 명령 상태 — `"running"` / `"ok"` / `"fail"` / `None`(모름). OSC 133 상태 기계의 요약.
    pub status: Option<String>,
    /// 마지막 명령 블록. 아직 아무 명령도 안 돌았으면 `None`.
    ///
    /// [`history`](Self::history) 가 생긴 뒤에도 **그대로 둔다** — `get_last_command` 는 이미
    /// 등록된 계약이고, "마지막 한 건" 은 목록의 꼬리와 늘 같지도 않다(이쪽은 실행 중인
    /// 명령도 매 전이마다 갱신된다).
    pub last: Option<LastCommand>,
    /// 블록 이력 — 오래된 것부터, 최대 [`HISTORY_CAP`] 건 · [`HISTORY_BYTES_CAP`] 바이트.
    ///
    /// 스크롤백이 **통째로 교체**되는 것과 달리 이쪽은 [`push_block`] 으로 하나씩 쌓인다
    /// (블록 하나에 이력 전부를 다시 실어 보내면 IPC 가 수 MB 를 나른다).
    pub history: Vec<CommandBlockMirror>,
    /// 스크롤백 tail — 최대 [`SCROLLBACK_CAP`] 줄. 프런트의 거울이라 매 갱신에 통째로 교체한다.
    pub scrollback: Vec<String>,
    /// 이 거울 항목이 마지막으로 갱신된 시각(epoch ms). **신선도 가드.**
    ///
    /// 프런트가 넘기는 값이 아니라 **Rust 가 갱신 때마다 자체로 찍는다**([`touch`]) — 프런트
    /// 계약(명령 시그니처)은 그대로다. AI 가 여러 세션을 비교할 때 "이 상태가 언제 것인가" 를
    /// 알아 오래된 거울을 현재 상태로 오인하지 않게 하는 값이다 (설계 "다중 세션 비교").
    pub captured_at: u64,
    /// 갱신마다 +1 하는 단조 카운터. [`captured_at`](Self::captured_at) 과 짝으로, 시계가
    /// 뒤로 가도(NTP 보정 등) "무언가 바뀌었다" 를 놓치지 않게 하는 버전 표식이다.
    pub context_version: u64,
    /// 소유 주체 — 창인가 위임인가([`SessionOwnerKind`]). 기본은 `Window`(프런트가 만든 세션은
    /// 전부 여기 해당). 헤드리스 세션만 [`report_delegated`] 이 `Delegated` 로 찍는다.
    pub owner_kind: SessionOwnerKind,
    /// **헤드리스 세션의 AI 읽기 가시성 스냅샷** — 접속 때의 `~/.aynx/delegation.toml` `read` 권한.
    /// [`ai_readable`] 이 이 값과 **지금의** `read` 를 함께 본다. 창 세션에서는 쓰지 않는다(항상 `false`).
    pub delegation_read: bool,
    /// **헤드리스 세션이 떨어졌는가** — 라이브 전송로가 끊긴(네트워크 손실·keepalive 타임아웃) 뒤
    /// 거울 항목을 **지우지 않고** 표시만 바꾸는 깃발이다([`mark_delegated_disconnected`]). 지우면
    /// 로스터에서 항목이 사라져 '미접속'(붙은 적 없음)과 뒤섞이므로, 남겨 두고 '끊김'으로 낸다
    /// ([`crate::mcp::sessions::enrich_sessions`] 가 `connected:false`·`dropped:true` 로 표면화). 재연결은
    /// 같은 `delegated:<alias>` 키로 [`report_delegated`] 을 다시 부르므로 이 깃발은 자연히 `false` 로 돌아온다.
    /// **창 세션은 이 값을 절대 쓰지 않는다**(항상 `false`).
    pub disconnected: bool,
    /// **화면만 있는 세션인가**(간이 모드 — tmux 타일). 기본 `false`
    /// (docs/log/2026-09-16-tmux-toggle.md).
    ///
    /// tmux 안에서는 OSC 133 마커가 바깥 터미널까지 오지 않으므로 이 세션에는 블록이
    /// **영영 생기지 않는다**. 그 사실을 AI 에게 **말해 주는** 것이 이 깃발의 전부다:
    /// [`crate::mcp`] 가 `mode: "screen" | "blocks"` 로 표면화하고, 블록 도구들은 조용한
    /// 빈 결과 대신 "이 세션에는 블록이 없다" 를 명시한다. 빈 결과와 "원래 없다" 를 가르지
    /// 않으면 AI 는 "아직 아무것도 안 돌았다" 로 읽고 기다린다.
    ///
    /// 읽기는 여전히 되고(스크롤백), 실행 경로(비-PTY exec)는 이 값과 무관하다.
    pub screen_only: bool,
    /// **이 거울이 가리키는 세션이 붙은 시각**(epoch ms). 0 이면 모른다(옛 항목·미접속).
    ///
    /// 관제판의 호스트별 목록이 "경과" 한 칸을 그린다 — 마지막 활동이 없는 세션(붙자마자
    /// 아무 명령도 안 돈 타일)에서 그 칸이 비지 않게 하는 바닥값이고, 말풍선의 "접속 시각"
    /// 그 자체이기도 하다 (docs/log/2026-09-21-console-host-groups.md).
    ///
    /// **항목이 처음 생길 때 한 번** 찍고, 끊겼던 헤드리스 세션이 다시 보고되면 다시 찍는다
    /// ([`report_delegated`] 의 회복 한 줄과 같은 자리). 창 타일의 재연결은 같은 키로 다시
    /// 보고되므로 여기서는 처음 값이 남는데, 창 타일의 경과는 프런트가 자기 세션 id 가
    /// 바뀌는 순간(`app/sessions.svelte.ts` 의 `noteSession`)을 보고 따로 쥔다 — 그쪽이
    /// 재연결을 정확히 아는 유일한 자리다. 즉 이 칸은 **다른 창·헤드리스 세션용**이다.
    pub connected_at: u64,
    /// **프런트 블록 번호의 밀림**(2026-11-09) — 거울 번호 = 프런트 번호 + 이 값. 처음 0(번호가 그대로다). 새로 뜬 페이지(GUI 재시작 ·
    /// 리로드)의 프런트는 블록 번호를 1 부터 다시 매기는데, 그 번호가 거울에 이미 있는 **다른** 블록(옛 페이지 · 서버 해석기가 쓴 것)과
    /// 겹치면 [`push_block`] 이 이 값을 지금 가장 큰 번호로 올려 뒤로 민다 — 덮어쓰지 않는다. 옵트아웃 때 0 으로 돌아간다.
    pub front_shift: i64,
}

/// 이 세션의 AI 권한을 정하는 **호스트 별칭** — 원격 창 타일은 [`SessionContext::host_alias`],
/// 헤드리스 세션은 `label`(= 위임 별칭). 로컬 타일과 별칭 없는 원격 타일은 `None`(호스트 권한이 없다).
fn permission_alias(ctx: &SessionContext) -> Option<&str> {
    match ctx.owner_kind {
        SessionOwnerKind::Window if ctx.kind == "ssh" => ctx.host_alias.as_deref(),
        SessionOwnerKind::Window => None,
        SessionOwnerKind::Delegated => Some(ctx.label.as_str()),
    }
}

/// **AI 읽기 도구의 가시성 게이트** — `list_sessions`·`get_*` 등이 세션을 보이는가.
///
/// - 원격 창 타일: 호스트 별칭이 있고 그 별칭에 `read` 가 있을 때만. 별칭이 없으면 언제나 거짓이다.
///   타일의 `opted_in` 은 보지 않는다(호스트 권한이 정한다 — 쓰기 쪽 게이트일 뿐이다).
/// - 로컬 창 타일: 타일의 "AI 읽기 허용"(`opted_in`).
/// - 헤드리스 세션: 접속 때의 스냅샷([`SessionContext::delegation_read`]) **그리고** 지금의 `read` —
///   권한을 내리면 다시 붙지 않아도 바로 숨는다.
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

/// **작업안 대상 자격** — 이 세션을 실행-계획 대상으로 삼을 수 있는가([`ai_readable`] 의 실행 짝).
///
/// 원격(창 타일·헤드리스)은 그 별칭의 누적 `read && propose`(단계 'Ask' 이상). **로컬 타일과
/// 별칭 없는 원격 타일은 언제나 거짓** — 실행 권한이 없다(읽기 허용과 무관).
pub(crate) fn ai_plan_eligible(
    ctx: &SessionContext,
    delegation: &crate::delegation::Delegation,
) -> bool {
    permission_alias(ctx).is_some_and(|alias| delegation.propose_granted(alias))
}

/// **자동 실행 자격** — 자동 승인(`method == "auto"`)이 이 세션에 사람 없이 실행해도 되는가.
///
/// 원격은 그 별칭의 누적 `read && propose && auto_execute`(단계 'Auto'). 로컬·별칭 없는 원격은
/// 언제나 거짓 — 그런 대상이 섞인 작업안은 사람 승인으로 남는다.
pub(crate) fn ai_auto_executable(
    ctx: &SessionContext,
    delegation: &crate::delegation::Delegation,
) -> bool {
    permission_alias(ctx).is_some_and(|alias| delegation.auto_execute_granted(alias))
}

/// **모두 승인 자격**(2026-10-23) — 이 세션의 호스트가 단계 'YOLO' 인가([`ai_auto_executable`] 위의 단계).
///
/// 원격은 그 별칭의 누적 `… && auto_execute && approve_all`. 로컬·별칭 없는 원격은 언제나 거짓 — 그런 대상이 섞이면 작업안은
/// 예전 자동 승인 규칙(허용 목록 · 위험 · 빈도)으로 돌아간다(`operations::gate::approve_all_plan`).
pub(crate) fn ai_approve_all(
    ctx: &SessionContext,
    delegation: &crate::delegation::Delegation,
) -> bool {
    permission_alias(ctx).is_some_and(|alias| delegation.approve_all_granted(alias))
}

/// 권한 판정에 필요한 **정체성 칸만** 복제한다 — 컨텍스트 잠금을 먼저 풀고 판정해야 할 때 쓴다
/// (다른 잠금을 쥔 자리·`.await` 를 건너는 자리). 라이브 필드·스크롤백은 싣지 않는다.
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

/// [`permission_view`] 를 거울 전체에 — 키는 그대로다.
pub(crate) fn permission_snapshot(
    map: &HashMap<String, SessionContext>,
) -> HashMap<String, SessionContext> {
    map.iter()
        .map(|(k, c)| (k.clone(), permission_view(c)))
        .collect()
}

/// 지금 epoch ms — 신선도 가드([`SessionContext::captured_at`])가 쓴다.
///
/// 시계가 UNIX_EPOCH 이전이면(있을 수 없지만) 0 으로 떨어진다 — 패닉하지 않는다.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 거울 항목의 신선도 표식을 찍는다 — 갱신 지점([`report`]·[`update`]·[`push_block`])이 항목을
/// 실제로 건드린 **직후에만** 부른다(옵트아웃·미등록으로 아무것도 안 했으면 부르지 않는다).
///
/// 한 곳에 모은 이유는 프라이버시 게이트와 같다: 필드가 늘어도 세팅 규칙은 한 곳이다.
fn touch(entry: &mut SessionContext) {
    entry.captured_at = now_ms();
    entry.context_version += 1;
}

/// 저장소 본체 — 키는 프런트가 정한 불투명 문자열(`pane.historyStreamId`, crypto 난수).
///
/// **키는 절대 파싱하지 않는다** — 그냥 유일한 식별자다. 예전엔 `창라벨:타일id` 였지만
/// 이관·리로드를 넘지 못해 안정된 스트림 id 로 바뀌었다 (2026-09-09 · 정체성 분리). 표시용
/// 위치는 별도의 [`SessionContext::code`] 필드가 든다 — 형식이 바뀌어도 이 모듈은 무관하다.
pub type Store = Arc<Mutex<HashMap<String, SessionContext>>>;

// ---------------------------------------------------------------------------
// 순수 저장소 연산 (테스트 대상) — 명령 핸들러는 잠금만 잡고 이쪽을 부른다.
// ---------------------------------------------------------------------------

/// 세션 정체성+옵트인을 upsert 한다. 새 항목이면 라이브 필드는 빈 채로 만든다.
///
/// 핵심은 **옵트아웃이 라이브 필드를 즉시 지운다**는 것(프라이버시). 옵트인이 유지되면
/// 라이브 필드는 건드리지 않는다 — 정체성 갱신(라벨 변경 등)이 스크롤백을 날리면 안 된다.
pub(crate) fn report(
    map: &mut HashMap<String, SessionContext>,
    key: String,
    label: String,
    kind: String,
    code: String,
    opted_in: bool,
) {
    let entry = map.entry(key).or_default();
    // 붙은 시각은 **항목이 처음 생길 때만** 찍는다 — 정체성 갱신(라벨 변경·공유 토글)이
    // 매번 시계를 되감으면 경과가 영영 0 에 머문다 ([`SessionContext::connected_at`]).
    if entry.connected_at == 0 {
        entry.connected_at = now_ms();
    }
    entry.label = label;
    entry.kind = kind;
    entry.code = code;
    entry.opted_in = opted_in;
    if !opted_in {
        // 옵트아웃 = 지금 당장 공유 데이터 제거. 정체성만 남긴다.
        // **블록 이력도 같은 자리에서 비운다** — 프라이버시 게이트는 필드가 늘어도 한 곳이다.
        entry.status = None;
        entry.last = None;
        entry.scrollback.clear();
        entry.history.clear();
        entry.front_shift = 0;
    }
    // 신원 갱신도 거울을 건드린 것이다 — 신선도 표식을 찍는다(신선도 가드).
    touch(entry);
}

/// **헤드리스 세션의 거울을 등록한다** — 창이 없고 프런트 [`report`] 경로를 타지 않는다
/// ([`crate::headless::open_headless_session`] 이 백엔드에서 직접 부른다).
///
/// 접속 때의 `read_granted`(delegation.toml 의 `read`)를 스냅샷으로 남긴다 — [`ai_readable`] 이 그것과
/// 지금의 `read` 를 함께 본다. **`opted_in` 은 `false` 로 둔다**: 헤드리스 세션의 판정은 언제나 위임
/// 별칭(`label`)으로 하고 `opted_in` 을 보지 않는다. `owner` 는 비운다(창이 없다) —
/// [`reclaim_window`] 는 `owner` 문자열이 아니라 `owner_kind` 로 헤드리스 세션을 건너뛴다.
pub(crate) fn report_delegated(
    map: &mut HashMap<String, SessionContext>,
    key: String,
    label: String,
    code: String,
    read_granted: bool,
) {
    let entry = map.entry(key).or_default();
    // 새 접속이거나 **끊겼다 돌아온** 재연결이면 붙은 시각을 다시 찍는다 — 떨어져 있던
    // 시간이 경과에 섞이면 "방금 돌아왔다" 가 "세 시간째" 로 보인다.
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
    // 새로 접속했거나 재연결로 다시 보고된 헤드리스 세션은 **살아 있다** — 끊김 깃발을 내린다
    // (재연결이 같은 키로 이 함수를 부르므로 이 한 줄이 곧 회복이다).
    entry.disconnected = false;
    touch(entry);
}

/// **헤드리스 세션의 거울 항목을 '끊김'으로 표시한다** — 라이브 전송로가 떨어졌을 때
/// ([`crate::headless::connect_delegated`] 의 on-exit 훅이 부른다). 항목을 **지우지 않고** 깃발만 세워,
/// 로스터가 '미접속'(붙은 적 없음)이 아니라 '끊김'(떨어짐)을 보이게 한다.
///
/// 항목이 없거나 `owner_kind != Delegated` 이면 아무것도 하지 않는다 — 창 세션은 이 경로를 타지
/// 않는다(창의 드롭은 `ssh-exit` 이벤트로 프런트가 정리한다). 갱신했으면 신선도 표식을 찍는다.
pub(crate) fn mark_delegated_disconnected(map: &mut HashMap<String, SessionContext>, key: &str) {
    if let Some(entry) = map.get_mut(key) {
        if entry.owner_kind == SessionOwnerKind::Delegated {
            entry.disconnected = true;
            touch(entry);
        }
    }
}

/// **되거둘 streamId 를 고른다** — 순수 함수(테스트 대상). `reap` 이 죽은 창의 거울을 거둘 때 쓴다.
///
/// 세 조건을 모두 만족해야 거둔다(= 이 라벨 창이 남긴, 이미 죽은 세션의 거울):
/// - `owner == label` — 이 창이 소유한 거울.
/// - `captured_at <= reaped_before` — 사건 기준선 이후 **다시 보고되지 않았다**(다시 보고됐으면
///   살아난 것 — 리로드 뒤 새 페이지가 같은 streamId 로 재보고한 경우를 건드리지 않는다).
/// - `held` 에 없다 — **이관 중인 타일은 절대 거두지 않는다**(다른 창으로 넘어가는 세션의 거울은
///   그 창이 이어받아야 한다). held 는 사서함 짐에서 뽑은 streamId 다([`crate::reap::collect_held`]).
///
/// 로컬·SSH 를 한 규칙으로 덮는다 — 로컬은 라우팅이 없어 u32 로 못 잇지만, 이 셋이면 정확하다.
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

/// 죽은 창의 거울을 **드롭**하고, 드롭한 streamId 를 돌려준다([`reclaim_streams`] 규칙).
///
/// 부르는 쪽([`crate::reap`])은 돌아온 streamId 로 라우팅·열린 작업안도 함께 정리한다(락은 각각
/// 따로 — 컨텍스트 잠금은 여기서 끝난다). 반환이 비면 아무 창도 손대지 않은 것이다.
pub(crate) fn reclaim_window(
    map: &mut HashMap<String, SessionContext>,
    label: &str,
    reaped_before: u64,
    held: &std::collections::HashSet<String>,
) -> Vec<String> {
    // **헤드리스 세션은 제외한다** — 창이 없으므로 창 정리로 거둬지지 않는다(명시적 닫힘·앱 종료로만
    // 사라진다). 순수 선별기 [`reclaim_streams`] 는 창 세션만 받으면 규칙이 그대로다.
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

/// 블록 하나를 이력에 **덧붙인다**(증분). 항목이 없거나 옵트인이 아니면 조용히 무시한다 —
/// [`update`] 와 같은 이유다(옵트아웃 직후에 도착한 마지막 한 건을 오류로 만들지 않는다).
///
/// 상한은 둘 다 **오래된 것부터** 깎는다. 개수(200)는 목록이 읽을 만한가를, 총량(1MB)은
/// 응답 하나가 감당할 만한가를 지킨다. 마지막 한 건은 상한을 넘겨도 남긴다 — 방금 들어온
/// 블록을 그 자리에서 버리면 "밀어 올렸는데 없다" 가 된다.
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
    // **프런트 번호 → 거울 번호**(2026-11-09). 같은 번호의 블록이 이미 있는데 **다른 블록**(시작 시각 · 명령문이 다르다)이면 새로 뜬
    // 페이지가 1 부터 다시 센 것이다(옛 페이지의 블록 · 창이 없던 동안 서버 해석기가 쓴 블록과 겹친다) — 덮어쓰지 않고 지금 가장 큰
    // 번호 뒤로 민다. 같은 블록의 다시 보내기(백필 · 이관이 실어 온 이력)는 같은 번호 그대로 갈아 끼운다.
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

/// **서버 해석기가 닫은 블록**을 이력에 덧붙인다(창이 없을 때 — [`crate::screen_mirror`]). 번호는 지금 가장 큰 번호 다음(프런트 번호와
/// 겹치지 않는다 — 창이 다시 붙어 프런트가 같은 번호를 보내면 [`push_block`] 이 뒤로 민다). 문지기는 [`push_block`] 과 같다.
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

/// 블록 하나를 이력에 넣는다(같은 번호면 갈아 끼운다) — 상한 · 신선도 표식은 여기 한 곳.
fn insert_block(entry: &mut SessionContext, block: CommandBlockMirror) {
    // **id 로 upsert 한다** — 같은 블록 번호가 이미 있으면 제자리에서 갈아 끼운다.
    // OFF→ON 백필(이력 전체를 한 배치로)과 증분 경로(`onblock`)가 같은 틱에서 겹치면 방금
    // 닫힌 블록 하나가 양쪽에 실릴 수 있는데(프런트에서 두 경로의 순서를 못 박기 어렵다),
    // 번호는 타일 안에서 단조 증가·불변이므로 그것으로 중복을 없앤다 — 정상 경로(번호마다
    // 한 번)에는 아무 영향이 없다 (docs/log/2026-09-09-share-backfill-and-header.md).
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
    // 이력이 실제로 늘었다 — 신선도 표식을 찍는다. (배치 [`push_blocks`] 는 블록마다 이 함수를
    // 거치므로 버전이 블록 수만큼 오른다 — 각 블록이 하나의 갱신이라 그대로 둔다.)
    touch(entry);
}

/// 블록 **여럿을 한 번에** 이어 붙인다 — 이관 직후의 거울 재구성 전용
/// (docs/log/2026-09-08-block-history-store.md 의 "거울 재구성").
///
/// 한 건씩 [`push_block`] 을 부르는 것과 **결과가 같도록** 그것을 그대로 돌린다: 상한도
/// 프라이버시 게이트도 한 곳에만 있어야 한다. 배치라고 규칙이 달라질 이유가 없고, 200건을
/// 훑는 상한 계산은 어차피 마이크로초대다.
pub(crate) fn push_blocks(
    map: &mut HashMap<String, SessionContext>,
    key: &str,
    blocks: Vec<CommandBlockMirror>,
) {
    for block in blocks {
        push_block(map, key, block);
    }
}

/// 라이브 필드를 갱신한다. 항목이 없거나 옵트인이 아니면 **조용히 무시**(Ok 반환)한다 —
/// 프런트가 옵트아웃 직후에도 마지막 배치를 보낼 수 있으므로 그것을 오류로 만들지 않는다.
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
    // **모름(`None`)은 아는 값을 지우지 않는다**(2026-11-10). 새로 뜬 페이지(GUI 재시작 · 리로드 · 트레이에서 다시 연 창)의 프런트는
    // 붙은 뒤 첫 갱신에서 상태 · 마지막 명령을 아직 모른다 — 그 `None` 이 창이 없던 동안 서버 해석기가 쓴 마지막 명령을 지우면
    // `commands` 는 있는데 `lastCommand` · `lastExit` 가 비는 엇갈린 거울이 된다. 지우는 길은 옵트아웃([`report`]) 하나다.
    if status.is_some() {
        entry.status = status;
    }
    if last.is_some() {
        entry.last = last;
    }
    entry.scrollback = scrollback_tail;
    // 거울이 상한을 넘겨 보내와도 저장소는 tail 만 쥔다.
    let len = entry.scrollback.len();
    if len > SCROLLBACK_CAP {
        entry.scrollback.drain(0..len - SCROLLBACK_CAP);
    }
    // 라이브 필드를 갱신했다 — 신선도 표식을 찍는다(신선도 가드).
    touch(entry);
}

// ---------------------------------------------------------------------------
// 프런트 거울 명령(`report_session`·`update_session_context`·`push_session_block(s)`·`drop_session`)은 ③-3c 부터 GUI 의 같은
// 이름 프록시(`crate::server::ai_proxy`)다 — 순서를 지키는 한 줄 큐로 모아(같은 키의 `update` 는 합친다) 세션 서버의 거울
// 묶음 op `ctx_batch` 로 보내고, 서버(`crate::server::ai`)가 위의 순수 연산을 부른다.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
