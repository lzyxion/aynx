//! 대화형 SSH 타일 열기 — 세션 서버 op `open_ssh` 의 몸 [`open_ssh`] 과 조립(`open_ssh_session_inner`).
//!
//! **③-3b2 부터 세션 서버 프로세스에서 돈다.** GUI 의 Tauri 명령 `open_ssh_session`(이름·인자 그대로 —
//! `server::proxy`)이 몸을 [`OpenSsh`] 하나로 묶어 보낸다. 사람이 친 비밀번호·암호구·호스트 키 결정은 그 몸으로 **GUI →
//! 서버 한 방향**이고, 서버는 그 값을 로그에 남기지 않는다. 접속 관문(호스트 키·비밀번호·암호구)은 예전 계약 그대로
//! "끊고 재시도" 다 — 실패 [`SshOpenError`] 가 파이프로 돌아가 GUI 모달이 묻고, 답을 실은 새 `open_ssh` 가 온다
//! (사람 쪽 UI 는 GUI). 접속 **도중**에 사람에게 묻는 것(원격 새 워크트리의 첫 커밋)은 서버 이벤트 `ssh-worktree-prep` →
//! GUI 막대 → op `worktree_answer` 왕복이다(`crate::remote_worktree`).
//!
//! 위층을 부르는 자리: `remote_worktree` · `setup_script` · `port_forward` · `agent_signal` · `mcp` ·
//! `session_log` · `host_history` · `vault` 를 접속 앞뒤로 직접 조립한다.
//!
//! 불변식:
//! - 원격 타일에는 MCP 토큰을 주지 않는다 — 스트림별 신호 전용 토큰만 `-R` 로.
//! - **열기 = 세션 코어의 새 회차**(2026-10-08 ②-2). 시작하자마자 스트림별 예약을 잡고(같은 스트림이 살아 있으면
//!   `[session-alive]` — 프런트는 붙는다, 여는 중이면 `[session-busy]`), 표에 올리는 순간 코어에 회차를 적는다
//!   (`register_session` — generation 검사와 같은 잠금). 재접속도 이 길이다 — 끝난·끊긴 항목을 새 회차가 덮는다.
//!   떨어진 세션에 **다시 붙는 것**은 이 길이 아니다(`crate::session_core::commands::attach_session` — autorun·셸 통합
//!   스니펫·훅 설치를 다시 보내지 않는다).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};

use russh::client::Msg;
use russh::{Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf};

use tokio::sync::Notify;

use crate::i18n::tr;
use crate::output::{Chunk, Gate, OutputStats};
use crate::session_core::{core, Keys, Kind};
use crate::ssh_config;
use crate::ssh_pool::{ExitTarget, TransportSignal};

use super::*;

const TERM: &str = "xterm-256color";

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// [`open_ssh_session`] 의 성공 반환 — `open_local_session` 의 `{ id, shell }` 과 같은 모양이다.
///
/// id 하나였던 것을 구조체로 넓힌 이유는 tmux 하나 때문이다: **어느 tmux 세션에 붙었는지는
/// 백엔드만 안다**(장부가 세션 표에 있다). 프런트는 그 이름을 타일(`PaneSpec.tmux`)에 적어
/// 두었다가 **재접속 때 힌트로 되돌려 준다** — 그래야 끊겼다 붙은 타일이 자기 자리로 돌아온다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshOpenResult {
    /// 세션 id (예전의 반환값 그대로).
    pub id: u32,
    /// 이 타일이 붙은 tmux 세션 이름. tmux 호스트가 아니면 `None`.
    pub tmux: Option<String>,
    /// 세션 코어의 열쇠 셋 — 프런트 손잡이가 이 뒤의 모든 be 호출(write·resize·pause·resume·close)에 동봉한다
    /// (`crate::session_core` 머리말 "임대 규칙" — 로컬 `LocalSession.lease` 와 같은 것).
    pub lease: Keys,
}

/// 진행 중인 열기의 스트림 예약 — 표에 올리지 못한 채 떨어지면(실패·창 사라짐) 스스로 푼다(`crate::pty` 의 짝).
struct Reservation {
    stream: String,
    committed: bool,
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if !self.committed {
            core().unreserve(&self.stream);
        }
    }
}

/// 열기에 스트림이 없을 때(옛 배치·시험) 쓰는 이름 — 코어 표의 열쇠는 있어야 한다.
fn anonymous_stream() -> String {
    static ANON: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    format!("ssh-anon-{}", ANON.fetch_add(1, Ordering::Relaxed))
}

/// 세션 서버 op `open_ssh` 의 몸 — 예전 Tauri 명령 `open_ssh_session` 의 인자 그대로(GUI 프록시가 묶어 보낸다).
///
/// **`Debug` 를 파생하지 않는다** — 비밀번호·암호구가 실린다(예전 명령이 인자를 구조체로 묶지 않던 이유와 같다 —
/// `#[derive(Debug)]` 한 줄로 새는 사고를 막는다). serde 오류 문구도 값을 되풀이할 수 있어 부른 쪽이 고정 문구로 바꾼다.
///
/// - `password` 는 **저장하지 않는다** — 프런트가 `password_required` 를 받고 사용자에게 입력받은 값을 이 한 번에만 싣는다.
/// - `tmux_name` 은 **재접속 힌트**(직전에 붙어 있던 tmux 세션 이름) — 있으면 그 이름으로 `-A -D`, 없으면 빈 `aynx-N`.
/// - `adhoc` 은 **빠른 접속**([`AdhocTarget`]) — `~/.ssh/config` 를 보지 않는다. `alias` 는 화면용 `user@host:port`.
/// - `host_key_decision` 은 **사람이 호스트 키 다이얼로그에서 고른 것**([`HostKeyDecision`]). 없으면 미상·바뀐 키를 거부한다.
/// - `start`·`no_tmux`·`force_tmux` — 프로젝트 타일의 첫 접속 재료(예전 명령의 주석 그대로). 에이전트 신호를 세울지는
///   프런트가 싣지 않는다 — 서버가 [`signal_stream`] 한 곳에서 정한다(2026-10-27 — 옛 `agentStream` 칸은 걷었다 · 옛 프런트가
///   실어 보내도 serde 가 모르는 칸으로 버린다).
/// - `stream` 은 세션 코어의 열쇠, `window` 는 책임 창 라벨(세션 코어 `home`).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenSsh {
    pub alias: String,
    #[serde(default)]
    pub host_key_decision: Option<HostKeyDecision>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub passphrase_for: Option<String>,
    #[serde(default)]
    pub declined_keys: Option<Vec<String>>,
    #[serde(default)]
    pub tmux_name: Option<String>,
    #[serde(default)]
    pub adhoc: Option<AdhocTarget>,
    #[serde(default)]
    pub start: Option<SshStart>,
    #[serde(default)]
    pub no_tmux: Option<bool>,
    #[serde(default)]
    pub force_tmux: Option<bool>,
    pub stream: String,
    pub window: String,
    pub cols: u16,
    pub rows: u16,
}

/// SSH 세션을 연다 — 세션 서버 op `open_ssh`.
///
/// **접속 이력** (docs/log/2026-09-23-host-history.md) — 결과가 정해진 **뒤에** 설정 호스트의 성공·실패를
/// [`crate::host_history::record`] 로 한 줄 적는다(기다리지 않는다 — 바뀌면 서버 이벤트 `host-history-changed`). 빠른 접속은
/// 별칭이 없어 적지 않고, 비밀번호·암호구·호스트 키 질문은 실패가 아니라 적지 않는다. 헤드리스 위임 접속은 이 길을 지나지
/// 않는다.
///
/// 표에 올린 뒤의 출력은 **아직 아무 창에도 가지 않는다**(링에만 적힌다) — 부른 쪽(`server::sessions`)이 돌려받은 열쇠로
/// 연결 싱크를 꽂고 링을 0 부터 재생한다(보안 알림·첫 프롬프트가 그 임대로 간다). `conn` 은 이 임대를 쥔 연결.
pub(crate) async fn open_ssh(o: OpenSsh, conn: u64) -> Result<SshOpenResult, SshOpenError> {
    // 빠른 접속에는 별칭이 없다 — `alias` 는 화면용 `user@host:port` 라 이력의 열쇠가 못 된다.
    let history_alias = o.adhoc.is_none().then(|| o.alias.clone());
    let result = open_ssh_session_inner(o, conn).await;
    if let (Some(alias), Some(outcome)) = (history_alias, crate::host_history::outcome_of(&result))
    {
        crate::host_history::record(&alias, outcome);
    }
    result
}

/// [`open_ssh`] 의 몸통 — 이력 기록을 결과 한 자리에서 하려고 떼어 냈을 뿐, 안쪽은
/// 예전 명령과 같은 순서다. 각 단계는 아래의 이름 붙은 함수이고(await·잠금·이벤트·정리의 순서는
/// 그대로), 이 함수는 그 단계들을 차례로 부르는 목차다.
async fn open_ssh_session_inner(o: OpenSsh, conn: u64) -> Result<SshOpenResult, SshOpenError> {
    let OpenSsh {
        alias,
        host_key_decision,
        password,
        passphrase,
        passphrase_for,
        declined_keys,
        tmux_name,
        adhoc,
        mut start,
        no_tmux,
        force_tmux,
        stream,
        window,
        cols,
        rows,
    } = o;
    let no_tmux = no_tmux.unwrap_or(false);
    let force_tmux = force_tmux.unwrap_or(false);
    let state = table();
    // **스트림별 예약**을 가장 먼저 잡는다 — 같은 스트림이 살아 있으면(떨어진 채 산 세션 포함) 새로 열지 않고
    // 거절한다(프런트는 붙는다). 접속하는 사이 같은 스트림의 둘째 열기도 여기서 막힌다(`[session-busy]`).
    let stream = if stream.trim().is_empty() {
        anonymous_stream()
    } else {
        stream
    };
    core()
        .reserve(&stream)
        .map_err(|e| SshOpenError::other(e.message()))?;
    let mut reservation = Reservation {
        stream: stream.clone(),
        committed: false,
    };
    // 암호구는 **이 함수의 몸통 하나**에만 산다. `Zeroizing` 이 드롭 순간 그 바이트를
    // 0 으로 덮는다 — 성공하든, 실패하든, 중간에 `?` 로 되돌아가든 같은 자리다.
    // (`zeroize` 는 이미 러시 경유 전이 의존이라 새로 받는 크레이트가 없다.)
    let passphrase = passphrase.map(zeroize::Zeroizing::new);
    let declined_keys = declined_keys.unwrap_or_default();
    // (창의 generation 검사 — 여는 사이 창이 리로드·파괴됐나 — 는 GUI 의 일이다: 프록시가 답을 받은 뒤 `crate::reap::admit`
    //  으로 보고 늦었으면 곧바로 닫는다. 서버는 창을 모른다.)
    let params = resolve_open_params(&alias, adhoc.as_ref())?;

    // ── 연결 공유 — **이 호스트의 전송로가 이미 서 있으면 그 위에 채널만 연다** ───────
    // (docs/log/2026-09-23-ssh-connection-sharing.md)
    //
    // 게이트를 **여기서부터** 잡는 이유는 하나다: "풀 보기 → 접속·인증 → 등록" 이 한
    // 덩어리여야 동시에 누른 두 타일이 둘 다 차갑게 붙는 일이 없다(연결 둘 · 인증 둘 ·
    // 볼트 관문 둘). 게이트는 **키마다 하나**라 다른 호스트를 여는 타일은 여기서 기다리지
    // 않는다. 잠금은 `tokio::sync::Mutex` 다 — 이 아래로 `await` 가 잔뜩 있다.
    let share_key = transport_key(&params, &alias, adhoc.is_some());
    let share_gate = TRANSPORTS.gate(&share_key);
    let coalesce = share_gate.lock().await;

    // 세션 id 를 **먼저** 뽑는다 — 풀의 사용자 장부가 이 번호로 적힌다. `exit.bind(id)` 는
    // 예전 그대로 셸이 선 뒤다(접속에 실패한 세션은 `ssh-exit` 를 쏘지 않는다).
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let exit = Arc::new(ExitSignal::new());

    // `accept-new` 자동 수락은 홉 안(Handler)에서 일어나고 배너는 밖에서 쓴다 — 두 홉이
    // 같은 플래그를 공유하면 어느 쪽이 자동 수락했든 한 줄이 뜬다. 바뀐 키 수락도 같은 자리다.
    // **얹혀 붙는 타일에서는 둘 다 거짓으로 남는다** — 그 타일은 아무 키도 수락하지 않았다
    // (수락한 것은 전송로를 세운 타일이고, 그 화면에 이미 한 줄이 떴다).
    let auto_accepted = Arc::new(AtomicBool::new(false));
    let changed_accepted = Arc::new(AtomicBool::new(false));

    let credentials = Credentials {
        host_key_decision,
        password,
        passphrase: passphrase.as_ref().map(|p| p.as_str()),
        passphrase_for: passphrase_for.as_deref(),
        declined_keys: &declined_keys,
        unattended: None,
    };
    let (shared, joined) = acquire_transport(
        id,
        &alias,
        &params,
        &share_key,
        credentials,
        &auto_accepted,
        &changed_accepted,
    )
    .await?;

    let pin = pin_session(
        &shared,
        &share_key,
        Arc::clone(&exit) as Arc<dyn ExitTarget>,
    );
    let handle = Arc::clone(&shared.handle);
    let ctx = OpenCtx {
        id,
        alias: &alias,
        params: &params,
        share_key: &share_key,
        shared: &shared,
        joined,
        handle: &handle,
        pin: &pin,
        window: &window,
        auto_accepted: &auto_accepted,
        changed_accepted: &changed_accepted,
    };

    // 원격 훅 자동 설치가 볼 에이전트 — 설정 스크립트가 명령 자리를 `sh … && <에이전트>` 로 바꾸기 **전**에 읽는다.
    let hook_agent = start
        .as_ref()
        .and_then(|s| s.command.as_deref())
        .and_then(crate::agent_args::agent_of_line)
        .map(|(id, _)| id);
    // 앱이 AI 를 띄우는 타일인가 — 신호 판정([`signal_stream`])의 한 갈래. 이것도 명령 자리가 바뀌기 **전**에 읽는다.
    let ai_launch = start
        .as_ref()
        .and_then(|s| s.command.as_deref())
        .is_some_and(launches_ai);
    // 설정 `[ai] codex_no_daemon`(기본 켬) — 앱이 띄우는 원격 codex 의 `--no-daemon` 과 신호 환경의 표식이 같은 값을 본다.
    let codex_no_daemon = crate::settings::codex_no_daemon();
    codex_start_no_daemon(&mut start, codex_no_daemon);
    let _coalesce = prepare_remote_worktree(
        &ctx,
        &share_gate,
        coalesce,
        tmux_name.as_deref(),
        &mut start,
    )
    .await?;
    compose_setup_script(&ctx, &mut start).await;
    let host_agent = host_agent(&alias, adhoc.is_some(), codex_no_daemon);
    let (signal_key, signal_notice, plain_signal) = arm_agent_signal(
        &ctx,
        &mut start,
        signal_stream(ai_launch, host_agent.agent, &stream),
        &stream,
        codex_no_daemon,
        &host_agent,
    )
    .await;
    let host = resolve_host_options(
        &ctx,
        adhoc.is_some(),
        no_tmux,
        force_tmux,
        start.as_ref(),
        host_agent.agent,
    );

    // ── 여기서부터는 **자리를 이미 차지한 뒤**다 ─────────────────────────────────
    // 풀의 사용자 장부와 전송로 종료 명단에 이 세션이 올라가 있으므로, 아래에서 실패하면
    // 그 둘을 도로 내놓아야 한다([`unpin_shared`]). 그 정리를 `?` 마다 베껴 적지 않으려고
    // 남은 몸통을 블록 하나로 묶는다 — 안쪽 단계의 순서는 예전과 같다.
    let outcome: Result<SshOpenResult, SshOpenError> = async {
        // 에이전트 활성화의 설치(훅 · PATH 심)는 셸 통합 준비와 **나란히** 돈다 — 둘 다 첫 입력 전에 끝나고, 늦어지는
        // 몫은 둘 중 긴 쪽뿐이다.
        let (plan, ()) = tokio::join!(
            plan_bootstrap(&ctx, &host),
            auto_remote_agent(&ctx, &host, hook_agent, &stream),
        );
        // 시작 명령 없는 tmux 아닌 타일의 신호 환경 — 셸 통합 exec 런처를 타면 타이핑하지 않고([`signal_rides_launcher`]),
        // 못 타면 첫 입력 맨 앞에 한 줄로 타이핑하고 그 에코를 펌프가 지운다(2026-10-27 — 화면에 남기지 않는다).
        let launcher_signal = if host.use_tmux {
            None
        } else {
            plain_signal
                .as_ref()
                .filter(|env| signal_rides_launcher(plan, env))
        };
        let typed_signal = if host.use_tmux {
            None
        } else {
            typed_signal_line(plan, plain_signal.as_ref())
        };
        let shell = open_shell_channel(&ctx, &host, plan, launcher_signal, cols, rows).await?;

        let (reader, writer) = shell.channel.split();

        // id 는 **풀의 자리를 잡을 때 이미 뽑아 두었다**(연결 공유). 여기서 하는 일은 예전
        // 그대로 `bind` 하나다 — 펌프를 띄우기 전에 심어야 즉시 끊기는 세션도 ssh-exit 를 받고,
        // 접속에 실패한 세션은 여전히 `id == 0` 인 채로 조용히 끝난다.
        exit.bind(id);

        let (pipe, feed) = start_output(
            &ctx,
            shell.agent_notice.as_deref(),
            signal_notice.as_deref(),
            host.logging,
        );
        spawn_output_pump(
            reader,
            feed,
            exit,
            echo_filters(plan, typed_signal.as_deref()),
            shell.agent_requested,
        );

        let chosen_tmux = choose_tmux_name(&ctx, state, tmux_name.as_deref(), host.use_tmux).await;
        send_bootstrap(
            &writer,
            chosen_tmux.as_ref(),
            start.as_ref(),
            plain_signal.as_ref(),
            plan,
            typed_signal.as_deref(),
            host.on_connect.as_deref(),
        )
        .await;
        let lease = register_session(
            &ctx,
            state,
            &stream,
            conn,
            writer,
            pipe,
            &host,
            &signal_key,
            &chosen_tmux,
        );

        Ok(SshOpenResult {
            id,
            tmux: chosen_tmux.map(|(name, _)| name),
            lease,
        })
    }
    .await;

    // 실패했으면 차지한 자리를 도로 내놓는다 — 마지막 사용자였으면 전송로도 여기서 끊긴다.
    match outcome {
        Ok(opened) => {
            reservation.committed = true;
            Ok(opened)
        }
        Err(e) => {
            release_failed_open(&shared, id, &signal_key, &pin).await;
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// 단계 — `open_ssh_session_inner` 가 위에서부터 차례로 부른다
// ---------------------------------------------------------------------------

/// 전송로를 얻은 뒤 여러 단계를 흘러가는 값들 — 다 만들어진 뒤로는 읽기만 한다.
struct OpenCtx<'a> {
    id: u32,
    alias: &'a str,
    params: &'a ConnectParams,
    share_key: &'a str,
    shared: &'a SharedTransport,
    /// 이미 서 있던 전송로에 얹혀 붙었는가(연결 공유의 따뜻한 길).
    joined: bool,
    handle: &'a SessionHandle,
    pin: &'a SharedPin,
    /// 책임 창 라벨(세션 코어 `home` · 원격 워크트리 막대의 주인).
    window: &'a str,
    auto_accepted: &'a AtomicBool,
    changed_accepted: &'a AtomicBool,
}

/// 차가운 길의 인증 재료. **`Debug` 를 붙이지 않는다** — 비밀번호·암호구가 실린다
/// ([`open_ssh_session`] 이 인자를 구조체로 묶지 않는 것과 같은 이유). 이 값은
/// [`acquire_transport`] 한 번에 소비되고 사라진다.
struct Credentials<'a> {
    host_key_decision: Option<HostKeyDecision>,
    password: Option<String>,
    passphrase: Option<&'a str>,
    passphrase_for: Option<&'a str>,
    declined_keys: &'a [String],
    /// **물을 사람이 없는 열기**(AI 전용 DB 연결의 경유 — 쿼리 타일 3a)면 그때 쓸 볼트 키 암호구들(헤드리스 규칙 — 호스트에
    /// `vault_passphrase` 위임이 있을 때만 채워진다). `Some` 이면 차가운 길이 **볼트의 SSH 비밀번호를 보지 않고**, 잠긴 키는 묻지 않고
    /// 건너뛴다([`KeyUnlock::Skip`]). `None` = 사람이 있는 열기(예전 그대로).
    unattended: Option<&'a [StoredKey]>,
}

/// `sessions.toml` 과 프로젝트 토글로 정해지는 이 타일의 선택들 ([`resolve_host_options`]).
struct HostOptions {
    use_tmux: bool,
    on_connect: Option<String>,
    logging: bool,
    shell_integration: bool,
    /// 서버 쪽 준비의 종류 — tmux 호스트도 셸 통합 옵션이 켜져 있으면 파일만 심는다([`remote_prep`]).
    prep: RemotePrep,
    forward_agent: bool,
    /// 에이전트 활성화 — 접속할 때 훅 · PATH 심을 서버에 심는가 (`agent` · 옛 `remote_hooks` · 기본 켬 · [`auto_remote_agent`]).
    agent: bool,
}

/// 이 호스트의 에이전트용 파일 선택 ([`host_agent`] → [`arm_agent_signal`]).
struct HostAgent {
    /// 셸 통합(적지 않은 것이 켬) — 끈 호스트에는 신호 파일을 쓰지 않는다("이 서버엔 아무것도 심지 마라").
    files: bool,
    /// 에이전트 활성화(적지 않은 것이 켬 · 빠른 접속은 끔) — 이 스위치 자체가 에이전트용 파일을 심어도 된다는 동의다.
    agent: bool,
    /// 타일 파일에 실을 에이전트 키 — `agent` 일 때만.
    keys: Option<crate::remote_signal_file::AgentKeys>,
}

/// 셸 채널과 그것을 여는 동안 정해진 에이전트 포워딩 결과 ([`open_shell_channel`]).
struct ShellChannel {
    channel: Channel<Msg>,
    agent_requested: bool,
    agent_notice: Option<String>,
}

/// 세션 표에 적힐 출력 쪽 조각들 ([`start_output`] → [`register_session`]).
struct OutputPipe {
    gate: Arc<Gate>,
    output: crate::output::OutputSlot,
    stats: Arc<OutputStats>,
    log_file: Option<String>,
    closed: Arc<Notify>,
    /// 이 앱이 닫는 중이다(`closed` 와 함께 선다) — 펌프가 끝을 정돈된 종료로 적는다.
    closing: Arc<AtomicBool>,
    /// 배처로 가는 표식 입구 — 종료 마감이 최종 오프셋을 받는다(`super::session::finish_exit`).
    mark: mpsc::Sender<Chunk>,
}

/// 펌프 태스크가 가져가는 송신 쪽 ([`start_output`] → [`spawn_output_pump`]).
struct PumpFeed {
    tx: mpsc::Sender<Chunk>,
    pump_gate: Arc<Gate>,
    log_tx: Option<mpsc::Sender<Vec<u8>>>,
    /// `close_ssh` 가 울리는 종 — [`until_closed`] 참고.
    closed: Arc<Notify>,
    closing: Arc<AtomicBool>,
}

/// 이 세션을 전송로의 종료 명단에 올린다. 내려갈 때 `token` 으로 뺀다([`unpin_shared`]).
/// 대상은 타일의 `ExitSignal` 이거나 쿼리 타일 자리의 [`DeathHook`] 이다([`acquire_shared`]).
fn pin_session(
    shared: &SharedTransport,
    share_key: &str,
    target: Arc<dyn ExitTarget>,
) -> SharedPin {
    let token = shared.signal.join(target);
    SharedPin {
        key: share_key.to_owned(),
        signal: Arc::clone(&shared.signal),
        token,
    }
}

/// 자리를 차지한 뒤 실패했을 때의 정리 꼬리 — 포워딩 장부 → 신호 포워드 → 신호 토큰 → 풀의 자리
/// 순서로 도로 내놓는다. 마지막 사용자였으면 전송로도 여기서 끊긴다([`unpin_shared`]).
async fn release_failed_open(
    shared: &SharedTransport,
    id: u32,
    signal_key: &Option<(String, u64)>,
    pin: &SharedPin,
) {
    // 켜 두었던 포워딩 장부부터 내린다(켜지 않았으면 아무 일도 없다).
    crate::agent_forward::disable(shared.transport_id, id);
    // 에이전트 신호 — 이 세션이 쓰겠다고 올린 포워드와 뽑은 토큰을 거둔다.
    crate::port_forward::stop_session_forwards(id);
    if let Some((stream, owner)) = signal_key {
        if crate::agent_signal::revoke(stream, *owner) == Some(true) {
            crate::remote_signal_file::remove(&shared.handle, stream).await;
        }
    }
    unpin_shared(pin, id).await;
}

/// 별칭(또는 빠른 접속)을 접속 파라미터로 푼다. 실패하면 아무것도 차지하지 않은 채 돌아간다
/// (정리할 것 없음).
fn resolve_open_params(
    alias: &str,
    adhoc: Option<&AdhocTarget>,
) -> Result<ConnectParams, SshOpenError> {
    let username = std::env::var("USERNAME").ok();
    let params = match adhoc {
        // 빠른 접속 — config 를 아예 읽지 않는다 (`resolve_adhoc` 의 설명 참고).
        Some(target) => resolve_adhoc(target, username.as_deref())?,
        None => {
            let config = ssh_config::load_default().map_err(SshOpenError::other)?;
            resolve_params(alias, &config.hosts, username.as_deref())?
        }
    };
    Ok(params)
}

/// 풀에서 이 호스트의 전송로를 얻는다 — 있으면 얹혀 붙고(따뜻한 길), 없으면 접속·인증해 풀에
/// 올린다(차가운 길). 실패하면 풀에 아무것도 올리지 않은 채 돌아간다(정리할 것 없음 — 게이트는
/// 호출자의 드롭이 놓는다). 반환의 `bool` 은 `joined`.
async fn acquire_transport(
    id: u32,
    alias: &str,
    params: &ConnectParams,
    share_key: &str,
    credentials: Credentials<'_>,
    auto_accepted: &Arc<AtomicBool>,
    changed_accepted: &Arc<AtomicBool>,
) -> Result<(SharedTransport, bool), SshOpenError> {
    let Credentials {
        host_key_decision,
        password,
        passphrase,
        passphrase_for,
        declined_keys,
        unattended,
    } = credentials;
    let (shared, joined) = match TRANSPORTS.join(share_key, id) {
        // ── 따뜻한 길 — TCP 도, 인증도, 볼트 관문도 없다. 채널 하나만 더 연다 ──────
        Some(existing) => (existing, true),
        // ── 차가운 길 — 여기 안쪽은 오늘까지와 한 글자도 다르지 않다 ────────────────
        None => {
            // ── 금고를 **한 번만** 본다 (2026-09-19 ② · docs/log/2026-09-19-vault.md) ──
            // 금고 조회는 디스크를 읽고 잠기지 않았으면 복호까지 한다 — 인증 루프 안에서
            // 부르면 그만큼 비동기 실행자를 붙든다. 그래서 **블로킹 풀에서 한 번**에 꺼내
            // 이 아래로는 값만 들고 간다 (`Zeroizing` 이라 이 스코프가 끝나면 0 으로 덮인다).
            //
            // 사람이 방금 친 값이 있으면 그 갈래는 **묻지 않는다**: 재시도로 들어온
            // 비밀번호·암호구가 금고의 값보다 언제나 새롭다.
            //
            // **물을 사람이 없는 열기**(`unattended`)는 헤드리스와 같은 규칙이다: 볼트의 SSH 비밀번호는 보지 않고, 키 암호구는
            // 부르는 쪽이 위임(`vault_passphrase`)을 확인하고 넘긴 것만 쓰며, 잠긴 키는 묻지 않고 건너뛴다.
            let (stored_password, stored_keys) = match unattended {
                Some(keys) => (None, keys.to_vec()),
                None => vault_secrets(alias, params, password.is_none(), passphrase.is_none()).await,
            };

            let unlock = match unattended {
                Some(_) => KeyUnlock::Skip { stored: &stored_keys },
                None => KeyUnlock::Ask {
                    for_path: passphrase_for,
                    passphrase,
                    declined: declined_keys,
                    stored: &stored_keys,
                },
            };

            // 전송로가 죽으면 **올라탄 세션 전부**가 각자 `ssh-exit` 를 받는다. 그와 함께
            // 이 항목을 장부에서 뺀다 — 죽은 전송로가 풀에 남아 있으면 다음 타일이 그
            // 위에 채널을 열려다 실패하는 막다른 길이 된다.
            let signal = {
                let key = share_key.to_owned();
                TransportSignal::new(Some(Box::new(move || TRANSPORTS.evict(&key))))
            };

            let Transport {
                mut handle,
                jump: jump_handle,
                server_version,
                transport_id,
            } = connect_transport(
                params,
                host_key_decision,
                auto_accepted,
                changed_accepted,
                &signal,
                unlock,
            )
            .await?;

            let auth_used = authenticate(
                &mut handle,
                &params.user,
                password,
                params.identity_file.as_deref(),
                params.identities_only,
                unlock,
                stored_password,
            )
            .await?;

            let shared = SharedTransport {
                handle: Arc::new(handle),
                transport_id,
                jump: jump_handle,
                signal,
                server_version,
                method: auth_used.method,
                identity: auth_used.identity,
                identity_stored: auth_used.identity_stored,
                jump_label: params.jump.as_ref().map(|j| j.label.clone()),
                keepalive_secs: params.keepalive_interval.map(|d| d.as_secs()),
            };
            // 장부에 올리는 것은 **인증까지 끝난 뒤**다 — 실패한 전송로를 남이 타는 일이 없다.
            // (게이트를 쥔 채라 이 자리에 같은 키가 있을 수 없다. 그래도 있었다면 옛
            // 전송로가 돌아오고, 그것은 아무도 안 쓰는 것이므로 그대로 떨어뜨린다.)
            let _displaced = TRANSPORTS.insert(share_key, id, shared.clone());
            (shared, false)
        }
    };
    Ok((shared, joined))
}

// ---------------------------------------------------------------------------
// 공유 전송로만 빌리기 — 쿼리 타일의 SSH 터널 (docs/log/2026-10-12-query-tile.md)
// ---------------------------------------------------------------------------
//
// **세션이 아니다.** 셸도, 세션 표(`table()`)의 줄도, 세션 코어의 회차도 없다 — 풀의 사용자 장부와 전송로의
// 종료 명단에 핀 하나만 꽂는다. 표에 올리면 "셸 없는 세션 + 같은 별칭" 이 헤드리스로 재사용되고(`crate::headless`)
// `ssh_find`·MCP 세션 목록·떨어진 세션 목록에도 보이게 된다 — 그래서 이 구획은 `table()` 을 부르지 않는다
// (시험 `acquire_shared_never_touches_the_session_table` 이 소스를 훑어 지킨다).
//
// 관문은 타일 열기와 **같은 길**이다: 별칭 해석([`resolve_open_params`]) → 키별 게이트 → [`acquire_transport`]
// (따뜻하면 인증 없음 · 차가우면 호스트 키 결정·볼트·비밀번호·암호구) — 실패는 같은 [`SshOpenError`] 라 프런트가 타일의
// 관문 루프(묻고 답을 실어 다시 부르기)를 그대로 쓴다.

/// [`acquire_shared`] 의 관문 재료 — [`OpenSsh`] 의 인증 칸과 같은 꼴·같은 뜻이다. **`Debug` 없음**(비밀번호·암호구).
#[derive(Default)]
pub(crate) struct SharedCreds {
    pub host_key_decision: Option<HostKeyDecision>,
    pub password: Option<String>,
    /// 드롭 순간 0 으로 덮인다 — 타일 열기의 `passphrase` 와 같은 규칙.
    pub passphrase: Option<zeroize::Zeroizing<String>>,
    pub passphrase_for: Option<String>,
    pub declined_keys: Vec<String>,
    /// **물을 사람이 없다**(AI 전용 DB 연결 — `db::ai`). 헤드리스와 같은 관문: 사람의 답(호스트 키 결정 · 비밀번호 · 암호구)을
    /// 받지 않고, 볼트의 SSH 비밀번호를 쓰지 않으며, 볼트의 키 암호구는 그 호스트에 `vault_passphrase` 위임이 있을 때만(볼트가
    /// 잠겼으면 실패). 따뜻한 전송로(사람이 이미 연 같은 호스트)에는 그대로 얹힌다 — 인증이 없다.
    pub unattended: Option<Unattended>,
}

/// [`SharedCreds::unattended`] 의 재료.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Unattended {
    /// 그 경유 호스트에 `vault_passphrase` 위임이 있다(`Delegation::vault_passphrase_granted` — 부르는 쪽이 본다).
    pub vault_passphrase: bool,
}

/// 전송로가 죽었을 때 부를 훅 — **동기**로, 전송로 핸들러 안에서 불린다(잠금 잡고 값 대입 정도만 — `.await` 없음).
/// 인자는 전송 계층의 실패 설명(`None` = 정돈된 끝).
pub(crate) type DeathHook = Box<dyn Fn(Option<String>) + Send + Sync>;

/// [`DeathHook`] 을 종료 명단의 대상으로 — "정확히 한 번" 은 `TransportSignal` 이 지킨다.
struct HookTarget(Option<DeathHook>);

impl ExitTarget for HookTarget {
    fn fire(&self, failure: Option<String>) {
        if let Some(hook) = &self.0 {
            hook(failure);
        }
    }
}

/// 공유 전송로에 꽂힌 **세션이 아닌** 자리 하나 — [`release`](Self::release) 로 놓는다(드롭도 놓는다).
/// 마지막 사용자였을 때만 전송로가 끊긴다([`unpin_shared`]) — 같은 호스트의 터미널 타일이 살아 있으면 그대로 산다.
pub(crate) struct SharedLease {
    /// 풀의 사용자 장부에 적힌 번호 — 세션 id 와 같은 수열([`NEXT_ID`])이라 겹치지 않는다. 세션 표에는 없다.
    id: u32,
    pin: SharedPin,
    handle: SessionHandle,
    released: bool,
}

impl SharedLease {
    /// 이 전송로의 핸들 — `channel_open_direct_tcpip` 을 여기서 연다(`crate::port_forward::TunnelListener`).
    pub(crate) fn handle(&self) -> &SessionHandle {
        &self.handle
    }

    /// 전송로가 이미 끝났나 — 얹힌 순간과 죽음이 엇갈렸으면 훅은 오지 않는다(명단에 오르기 전에 울렸다).
    pub(crate) fn is_dead(&self) -> bool {
        self.pin.signal.has_fired()
    }

    /// 자리를 놓는다 — 종료 명단에서 빼고, 마지막 사용자였으면 전송로·경유를 끊는다.
    pub(crate) async fn release(mut self) {
        self.released = true;
        unpin_shared(&self.pin, self.id).await;
    }
}

impl Drop for SharedLease {
    /// [`release`](SharedLease::release) 없이 떨어졌을 때의 그물 — 런타임 위면 같은 정리를 태스크로 던진다.
    /// 런타임 밖이면 장부만 정리한다(끊기 인사는 못 보낸다 — 핸들이 떨어지며 전송로도 내려간다).
    fn drop(&mut self) {
        if self.released {
            return;
        }
        let (pin, id) = (self.pin.clone(), self.id);
        match tokio::runtime::Handle::try_current() {
            Ok(rt) => {
                rt.spawn(async move { unpin_shared(&pin, id).await });
            }
            Err(_) => {
                pin.signal.leave(pin.token);
                let _ = TRANSPORTS.release(&pin.key, id);
            }
        }
    }
}

/// 이 호스트의 공유 전송로를 **빌린다**(세션을 만들지 않는다) — 따뜻하면 얹히고, 차가우면 타일 열기와 같은 관문으로
/// 접속·인증해 풀에 올린다. `on_death` 는 전송로가 죽으면 한 번 불린다([`DeathHook`]).
///
/// 실패하면 아무것도 차지하지 않은 채 돌아간다([`acquire_transport`] 의 계약 — 핀은 성공 뒤에야 꽂는다).
pub(crate) async fn acquire_shared(
    alias: &str,
    adhoc: Option<&AdhocTarget>,
    creds: SharedCreds,
    on_death: Option<DeathHook>,
) -> Result<SharedLease, SshOpenError> {
    let SharedCreds {
        host_key_decision,
        password,
        passphrase,
        passphrase_for,
        declined_keys,
        unattended,
    } = creds;
    let params = resolve_open_params(alias, adhoc)?;
    // 물을 사람이 없는 열기 — 사람의 답은 버리고(받을 수 없는 자리다), 볼트의 키 암호구는 위임이 있을 때만(헤드리스 규칙).
    let (host_key_decision, password, passphrase, passphrase_for, unattended_keys) = match unattended {
        None => (host_key_decision, password, passphrase, passphrase_for, None),
        Some(u) => {
            let keys: Vec<StoredKey> = if u.vault_passphrase {
                if !crate::server::hub::vault().is_some_and(|v| v.is_unlocked()) {
                    return Err(SshOpenError::other(tr!(
                        ko: "볼트가 잠겨 있어 무인 접속에 키 암호구를 쓸 수 없습니다 (가림막을 걷으면 열립니다)",
                        en: "The vault is locked, so the unattended connection cannot use the key passphrase (lifting the privacy veil opens it)"
                    )));
                }
                vault_keys_for(&params).await
            } else {
                Vec::new()
            };
            (None, None, None, None, Some(keys))
        }
    };
    let share_key = transport_key(&params, alias, adhoc.is_some());
    let share_gate = TRANSPORTS.gate(&share_key);
    let _coalesce = share_gate.lock().await;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let auto_accepted = Arc::new(AtomicBool::new(false));
    let changed_accepted = Arc::new(AtomicBool::new(false));
    let credentials = Credentials {
        host_key_decision,
        password,
        passphrase: passphrase.as_ref().map(|p| p.as_str()),
        passphrase_for: passphrase_for.as_deref(),
        declined_keys: &declined_keys,
        unattended: unattended_keys.as_deref(),
    };
    // 얹혔나(따뜻한 길) · 키 자동 수락 여부는 쿼리 타일이 보이지 않는다 — 관문 공용 함수의 몫만 받는다.
    let (shared, _joined) = acquire_transport(
        id,
        alias,
        &params,
        &share_key,
        credentials,
        &auto_accepted,
        &changed_accepted,
    )
    .await?;
    // 타일이 아닌 핀이다 — 정보 카드의 "공유 중인 다른 타일 수" 에서 빼고 "DB 연결 N" 으로 센다(`TransportPool::count_users`).
    TRANSPORTS.mark_pin(id);
    let pin = pin_session(&shared, &share_key, Arc::new(HookTarget(on_death)));
    Ok(SharedLease {
        id,
        pin,
        handle: Arc::clone(&shared.handle),
        released: false,
    })
}

/// 원격 새 워크트리를 준비한다(재료가 있을 때만) — 사람의 답을 기다리는 동안 공유 게이트를 놓았다가
/// 다시 잡아 돌려준다. 멈춤(`Cancelled`)이면 **자리를 내놓고**([`unpin_shared`]) `[cancelled]` 로
/// 돌아간다 — 포워딩·신호는 아직 켜지 않았으므로 그 둘은 거두지 않는다.
async fn prepare_remote_worktree<'g>(
    ctx: &OpenCtx<'_>,
    share_gate: &'g tokio::sync::Mutex<()>,
    coalesce: tokio::sync::MutexGuard<'g, ()>,
    tmux_name: Option<&str>,
    start: &mut Option<SshStart>,
) -> Result<tokio::sync::MutexGuard<'g, ()>, SshOpenError> {
    // ── 원격 새 워크트리 — 접속한 뒤 · 첫 입력 전에 (2026-09-29 B안 · docs/log/2026-09-29-remote-worktree-after-connect.md) ──
    // 이 전송로의 exec 로 저장소를 판정하고(첫 커밋이 없으면 **그 타일의 막대로 물어 답을 기다린다** — 시한 없음)
    // `git worktree add` 까지 앱이 한다. 첫 입력에는 git 명령이 없다 — 만든 폴더에서 시작만 한다.
    //
    // - 재접속 힌트(`tmux_name`)가 왔으면 재료를 버린다 — 재료는 한 번만 쓰인다(재접속 · 복원 · 이관에서 다시 만들지 않는다).
    // - 사람의 답을 기다리는 동안 **공유 게이트를 놓는다** — 쥔 채 기다리면 같은 호스트의 다른 타일이 전부 줄을 선다.
    //   다 끝나면 다시 잡고 이어 간다(아래 tmux 이름 고르기 · 등록이 예전처럼 게이트 안이다).
    // - 결말: 만들었다 → 재료만 떼고 이어 간다 · 셸로(사람이 골랐다 · 실패 — 막대는 프런트가 이미 세웠다) → 시작 재료를
    //   통째로 버린다(홈의 평범한 셸) · 멈춤(타일이 닫혔다 · 창이 사라졌다 · 연결이 죽었다) → 자리를 내놓고 `[cancelled]`.
    if tmux_name.is_some() {
        if let Some(st) = start.as_mut() {
            st.worktree = None;
        }
    }
    let wt_req = start
        .as_mut()
        .and_then(|st| st.worktree.take().map(|wt| (wt, st.cwd.clone())));
    let Some((wt, cwd)) = wt_req else {
        return Ok(coalesce);
    };
    drop(coalesce);
    let prepared = crate::remote_worktree::prepare(
        crate::remote_worktree::PrepTarget {
            handle: Arc::clone(ctx.handle),
            signal: Arc::clone(&ctx.shared.signal),
            alias: ctx.alias,
            owner: ctx.window,
            session: ctx.id,
            worktree: &wt,
            cwd: &cwd,
        },
    )
    .await;
    match prepared {
        crate::remote_worktree::Prepared::Ready => {}
        crate::remote_worktree::Prepared::PlainShell => *start = None,
        crate::remote_worktree::Prepared::Cancelled => {
            unpin_shared(ctx.pin, ctx.id).await;
            return Err(SshOpenError::other(
                crate::remote_worktree::cancelled_message(),
            ));
        }
    }
    Ok(share_gate.lock().await)
}

/// 프로젝트의 설정 스크립트를 첫 입력의 명령 자리에 짓는다(서버의 임시 파일 → 짧은 줄, 못 쓰면 긴 한 줄).
/// 실패는 접속을 막지 않는다 — 정리할 것 없음.
async fn compose_setup_script(ctx: &OpenCtx<'_>, start: &mut Option<SshStart>) {
    let alias = ctx.alias;
    // ── 설정 스크립트 (원격 새 워크트리 — docs/log/2026-09-28-project-agent-setup-script.md) ──────────
    // 프런트는 프로젝트 id 와 끝 신호 값만 싣는다. 스크립트는 여기서 `projects.json` 을 읽어 첫 입력의 명령 자리를
    // `sh -c '<스크립트>' && <에이전트>` 로 짓는다 — 성공할 때만 에이전트가 뜨고, 실패하면 셸에 머문다. 아래의 신호
    // 환경 export 는 그 명령 앞에 선다(에이전트가 물려받는다). 스크립트가 그사이 지워졌으면 명령은 예전 그대로다.
    //
    // 스크립트는 **이 전송로의 exec 로 서버 파일(`~/.cache/aynx/setup-<nonce>.sh`, 600)에 먼저 써 두고** 명령 자리에는
    // `sh "$HOME/.cache/aynx/setup-<nonce>.sh" && <에이전트>` 짧은 줄만 선다 — 긴 한 줄을 대화형 셸에 치면 에코와 줄
    // 편집기의 다시 그리기로 수십 줄이 두 번 찍혔다. 쓰지 못하면 예전의 긴 한 줄로 간다(스크립트는 로그에 남기지 않는다).
    if let Some(st) = start.as_mut() {
        if let Some(setup) = st.setup.take() {
            let (cwd, command) = (st.cwd.clone(), st.command.clone());
            let composed = tokio::task::spawn_blocking(move || {
                crate::setup_script::remote_start_command(
                    &setup.project_id,
                    &setup.nonce,
                    &cwd,
                    command.as_deref(),
                )
            })
            .await
            .ok()
            .flatten();
            if let Some(c) = composed {
                let wrote = run_exec(
                    Arc::clone(ctx.handle),
                    c.write_command,
                    SETUP_WRITE_TIMEOUT,
                    Arc::new(AtomicBool::new(false)),
                )
                .await;
                st.command = Some(if wrote.exit_code == Some(0) {
                    c.short
                } else {
                    eprintln!(
                        "설정 스크립트: {alias} 에 임시 파일을 쓰지 못해 긴 한 줄로 칩니다 (종료 코드 {:?})",
                        wrote.exit_code
                    );
                    c.long
                });
            }
        }
    }
}

/// 원격 타일의 에이전트 신호를 세운다 — 신호 토큰(같은 프로세스의 토큰 표 — `agent_signal::issue`) → `-R` 포워드(원격
/// 루프백 → 이 PC 의 서버 신호 포트 `server::hub::signal_port`) → `start.signal_env`(시작 명령 없는 타일은 반환의 셋째). 반환은
/// (거둘 토큰 열쇠, 타일에 띄울 한 줄, 시작 명령 없는 타일의 신호 환경). 포워드를 못 세우면 그 자리에서 토큰을 거둔다. 그
/// 뒤의 실패는 호출자가 거둔다(`stop_session_forwards` · `agent_signal::revoke`). ③-3b2: SSH 가 세션 서버로 와서 토큰은
/// **파이프를 타지 않는다**(③-3a 에서는 `signal_issue` 응답으로 GUI 에 갔다) — 값은 토큰 표 → 원격 서버의 파일(또는
/// export)로만 가고 로그에 남기지 않는다. 주인 연결(`conn`)은 없다 — 원격 세션은 GUI 연결과 함께 죽지 않으므로 고아 정리
/// 대상이 아니라 세션 자원 회수가 거둔다.
///
/// **에이전트 활성화**(2026-10-26 — [`HostAgent`])가 켜졌으면 신호와 무관하게 타일 파일(추가 인자 키 —
/// `crate::remote_signal_file::AgentKeys`)을 쓰고 셸에 스트림 id · PATH 심 폴더를 export 한다(신호를 세웠으면 그 파일 ·
/// 그 export 에 함께). 파일은 **에이전트 활성화가 켜졌거나 셸 통합이 켜졌을 때** 쓴다 — 못 쓰면 심이 인자 없이 돈다(로그 한 줄).
async fn arm_agent_signal(
    ctx: &OpenCtx<'_>,
    start: &mut Option<SshStart>,
    agent_stream: Option<&str>,
    tile_stream: &str,
    codex_no_daemon: bool,
    host: &HostAgent,
) -> (Option<(String, u64)>, Option<String>, Option<RemoteSignalEnv>) {
    let alias = ctx.alias;
    // ── 에이전트 신호 (원격 AI 타일 — docs/log/2026-09-24-remote-agent-signals.md) ─────────
    // 순서가 요점이다: 전송로 → **원격 포워드**(서버가 포트를 고른다) → 그 포트로 첫 입력을 짓는다.
    // 첫 입력(`on_connect` 의 프로젝트 줄 · tmux 줄)은 아래에서 `start` 로 지어지므로, 여기서
    // `start.signal_env` 를 채우면 두 길 다 export 머리를 얻는다. 서버가 포워딩을 막으면(`AllowTcp
    // Forwarding no`) 환경 없이 열고 타일에 한 줄을 띄운다 — 점은 추정으로 돈다.
    //
    // 포워드는 이 세션을 쓰는 쪽에 올려 두고 닫을 때(`close_ssh` → `stop_session_forwards`) 거둔다.
    // 토큰은 스트림에 뽑고 닫을 때 거둔다. 아래에서 여는 데 실패하면 둘 다 그 자리에서 거둔다.
    //
    // **어느 타일인가는 [`signal_stream`] 한 곳이 정한다**(`agent_stream` 이 `Some` 인가): 앱이 AI 를 띄운 타일, 또는
    // 호스트의 **에이전트 활성화**가 켜진 호스트의 **모든** 타일(평범한 셸 · 재접속 — 2026-10-27, 호스트 AI 권한은 더 이상
    // 관여하지 않는다). 시작 명령이 있으면 환경은 `start.signal_env` 로 첫 입력의 명령 앞에, 없으면 세 번째 반환값으로
    // 돌아가 tmux 줄([`tmux_attach_command_with_env`]) · 셸 통합 exec 런처 앞([`exec_launcher_with_signal`] — 타이핑 없음) ·
    // 그 밖에는 사용자 `on_connect` 앞([`signal_export_line`] — 에코는 펌프가 지운다)에 선다. 서버가
    // 포워딩을 막았다는 한 줄은 **시작 명령이 있는 타일에만** 띄운다 — 토글로 받는 평범한 타일마다 노랑 줄이 서면
    // 시끄럽다(콘솔 한 줄은 남는다).
    let mut signal_key: Option<(String, u64)> = None;
    let mut signal_notice: Option<String> = None;
    let mut plain_signal: Option<RemoteSignalEnv> = None;
    let mut env: Option<RemoteSignalEnv> = None;
    // 셸 통합을 끈 호스트라도 에이전트 활성화가 켜졌으면 그 스위치가 파일을 심어도 된다는 동의다.
    let write_file = host.files || host.agent;
    if let Some(stream) = agent_stream {
        let has_command = start
            .as_ref()
            .and_then(|st| st.command.as_deref())
            .is_some_and(|c| !c.trim().is_empty());
        let grant = match crate::server::hub::signal_port() {
            Some(port) if crate::tile_env::stream_ok(stream) => {
                crate::agent_signal::issue(stream, None).map(|g| (g, port))
            }
            _ => None,
        };
        if let Some((grant, signal_port)) = grant {
            crate::server::log::line(format!("signal token issued — remote stream {stream} · owner {}", grant.owner));
            match crate::port_forward::ensure_agent_signal_forward(
                Arc::clone(ctx.handle),
                ctx.shared.transport_id,
                ctx.id,
                signal_port,
            )
            .await
            {
                Ok(remote_port) => {
                    signal_key = Some((stream.to_owned(), grant.owner));
                    let url = crate::tile_env::base_url(remote_port);
                    // 주소·토큰은 서버의 신호 파일로(①b · `crate::remote_signal_file`) — 셸에는 스트림 id 만 간다.
                    // 셸 통합을 끈 호스트("아무것도 심지 마라")·쓰기 실패는 예전처럼 export 로 폴백.
                    let in_file = if write_file {
                        match crate::remote_signal_file::write(
                            ctx.handle,
                            stream,
                            Some((&url, &grant.token)),
                            host.keys.as_ref(),
                        )
                        .await
                        {
                            Ok(()) => {
                                crate::agent_signal::note_written(stream, grant.owner);
                                true
                            }
                            Err(e) => {
                                eprintln!(
                                    "에이전트 신호: {alias} 에 신호 파일을 쓰지 못해 환경변수로 넘깁니다 — {e}"
                                );
                                false
                            }
                        }
                    } else {
                        eprintln!(
                            "에이전트 신호: {alias} 는 셸 통합 옵트아웃 — 신호 파일 대신 환경변수로 넘깁니다"
                        );
                        false
                    };
                    env = Some(RemoteSignalEnv {
                        url,
                        token: grant.token,
                        stream: stream.to_owned(),
                        codex_no_daemon,
                        in_file,
                        agent_path: host.agent,
                    });
                }
                Err(reason) => {
                    crate::agent_signal::revoke(stream, grant.owner);
                    eprintln!(
                        "에이전트 신호: {alias} 에 원격 포워드를 세우지 못했습니다 — {reason}"
                    );
                    if has_command {
                        signal_notice =
                            Some(crate::port_forward::agent_signal_refused_notice(&reason));
                    }
                }
            }
        }
    }
    // 신호를 세우지 않았어도 에이전트 활성화면 — 타일 파일(추가 인자 키만)과 스트림 id · PATH 를 셸에. 비밀이 없다.
    let stream = agent_stream.unwrap_or(tile_stream);
    if env.is_none() && host.agent && crate::tile_env::stream_ok(stream) {
        if let Err(e) =
            crate::remote_signal_file::write(ctx.handle, stream, None, host.keys.as_ref()).await
        {
            eprintln!("에이전트 활성화: {alias} 에 타일 파일을 쓰지 못했습니다 — 심이 추가 인자 없이 돕니다 — {e}");
        }
        env = Some(RemoteSignalEnv {
            url: String::new(),
            token: String::new(),
            stream: stream.to_owned(),
            codex_no_daemon,
            in_file: true,
            agent_path: true,
        });
    }
    if let Some(env) = env {
        match start.as_mut() {
            Some(st) => st.signal_env = Some(env),
            None => plain_signal = Some(env),
        }
    }
    (signal_key, signal_notice, plain_signal)
}

/// 이 호스트의 에이전트용 파일 선택 — `sessions.toml` 의 `shell_integration`(적지 않은 것이 켬 · 끈 호스트에는 신호 파일도
/// 쓰지 않는다 — "이 서버엔 아무것도 심지 마라") · `agent`(에이전트 활성화 — 적지 않은 것이 끔 · 빠른 접속은 끔) · `agent_args`
/// (키별 상속을 지난 원격 추가 인자). 읽기 실패는 켬 · 인자 없음으로 친다(보강 계층 — 접속을 막지 않는다).
fn host_agent(alias: &str, is_adhoc: bool, codex_no_daemon: bool) -> HostAgent {
    let (meta, _warnings) = crate::sessions_meta::SessionsMeta::load_default();
    let resolved = meta.resolve(alias);
    let agent = agent_enabled(is_adhoc, resolved.agent);
    HostAgent {
        files: resolved.shell_integration.unwrap_or(true),
        agent,
        keys: agent.then(|| crate::remote_signal_file::AgentKeys {
            args: agent_args_words(alias, &resolved.agent_args),
            no_daemon: codex_no_daemon,
        }),
    }
}

/// 이 열기의 에이전트 활성화 (**순수 함수**) — `sessions.toml` 의 `agent`(옛 `remote_hooks` — 적지 않은 것이 끔). 빠른 접속은
/// 호스트 설정이 없는 대상이라 늘 끔.
pub(crate) fn agent_enabled(is_adhoc: bool, resolved: Option<bool>) -> bool {
    !is_adhoc && resolved.unwrap_or(false)
}

/// 시작 명령이 **AI CLI 를 띄우는가** (**순수 함수**) — 프런트 `aiIconName`(`src/lib/pane-icons.ts`)과 같은 규칙: 대소문자를
/// 무시하고 `claude` · `codex` 를 품은 줄. 첫 낱말만 보는 [`crate::agent_args::agent_of_line`] 보다 너그럽다 — 신호 판정이
/// 2026-10-27 까지 프런트에서 이 규칙으로 돌았고(`npx … claude-code` 같은 줄도 받았다) 그 폭을 그대로 옮겼다.
pub(crate) fn launches_ai(command: &str) -> bool {
    let s = command.trim().to_ascii_lowercase();
    s.contains("claude") || s.contains("codex")
}

/// **원격 타일의 에이전트 신호를 세울 스트림** (**순수 함수 — 판정 자리는 여기 하나**, 2026-10-27 사용자 결정) — 받으면 그 타일의
/// 스트림, 아니면 `None`. 둘 중 하나면 세운다:
///
/// 1. **앱이 AI 를 띄운 타일**(`ai_launch` — 첫 입력의 시작 명령이 AI CLI · [`launches_ai`]). 빠른 접속도 받는다.
/// 2. **호스트의 에이전트 활성화**(`agent_on` — [`agent_enabled`] · 빠른 접속은 늘 끔)가 켜졌다 — 그 호스트의 **모든** 타일:
///    평범한 셸 · 재접속(시작 명령 없음) · tmux · 비-tmux. 토글 자체가 "에이전트용 파일을 심어도 된다" 는 동의이고, 신호를
///    받는 것이 그 훅이다. 신호 토큰은 그 타일의 상태 점만 바꾼다(MCP · 명령 불가 — `crate::agent_signal`).
///
/// **호스트 AI 권한은 관여하지 않는다**(2026-10-08 ~ 10-26 에는 프런트가 "AI 권한 Read 이상이면 모든 타일" 로 정했다) — AI 권한은
/// 읽기 · 제안/실행 · 헤드리스만 정한다. 헤드리스 위임 접속은 이 길(`open_ssh`)을 지나지 않는다. 프런트는 스트림 id 만
/// 싣는다(옛 `agentStream` 칸 · 프런트 `remoteAgentStream` 은 걷었다).
///
/// 재접속이 받는 것은 **새 셸**의 환경이다 — tmux 에 다시 붙으면 그 안에서 이미 돌던 셸·에이전트는 옛 포트·옛 토큰(닫을 때
/// 거뒀다)을 쥔 채라 신호 파일을 다시 읽지 않는 한 그 에이전트의 신호는 끊긴다(09-24 기록 7절 — 이 판정과 무관한 한계).
pub(crate) fn signal_stream(ai_launch: bool, agent_on: bool, stream: &str) -> Option<&str> {
    (ai_launch || agent_on).then_some(stream)
}

/// 원격 추가 인자(에이전트 id → 한 줄) → 심이 읽을 낱말 (**순수 함수**). 저장은 이미 같은 규칙(`parse_args`)을 지났지만
/// 손으로 고친 파일의 어긋난 줄은 버리고 로그 한 줄 — 접속을 막지 않는다. 빈 줄(= 붙이지 않음)은 빈 목록이다.
fn agent_args_words(
    alias: &str,
    lines: &std::collections::BTreeMap<String, String>,
) -> Vec<(&'static str, Vec<String>)> {
    crate::agent_shim::AGENTS
        .iter()
        .filter_map(|id| {
            let line = lines.get(*id)?;
            match crate::agent_args::parse_args(line) {
                Ok(words) => Some((*id, words)),
                Err(e) => {
                    eprintln!("에이전트 활성화: {alias} 의 {id} 추가 인자를 버립니다 — {}", e.message());
                    None
                }
            }
        })
        .collect()
}

/// 앱이 띄우는 원격 codex 에 `--no-daemon` (**순수 함수**) — 로컬의 autorun 문(`crate::agent_autorun::agent_autorun_command`)
/// 과 같은 규칙([`crate::codex_launch::codex_line`] · 설정 `[ai] codex_no_daemon`). SSH 첫 입력은 그 문을 지나지 않으므로
/// 여기서 건다 — 설정 스크립트가 명령 자리를 `sh … && <명령>` 으로 감싸기 **전**에(첫 낱말이 codex 여야 규칙이 선다).
/// tmux 타일은 서버 셸 통합(감싸개)이 없는 셸에서 명령을 돌리므로 이 자리가 유일한 길이다.
pub(crate) fn codex_start_no_daemon(start: &mut Option<SshStart>, enabled: bool) {
    if let Some(st) = start.as_mut() {
        if let Some(line) = st
            .command
            .as_deref()
            .and_then(|c| crate::codex_launch::codex_line(c, enabled))
        {
            st.command = Some(line);
        }
    }
}

/// **원격 훅 자동 설치** (2026-10-08 — docs/log/2026-09-24-remote-agent-signals.md "자동 설치") — 이 열기가 원격
/// AI 타일의 신호를 세웠고(`signal_armed`) 시작 명령이 Claude Code · Codex 이고 호스트 옵션이 켜져 있으면, 이 전송로의
/// exec 로 메뉴 설치와 같은 함수를 돌린다(`crate::agent_hooks::remote_auto_install` — 상한 5초). 새로 심었거나
/// 실패했으면 그 호스트에 앱 세션 동안 한 번 알린다. 실패는 접속을 막지 않는다 — 정리할 것 없음.
///
/// **에이전트 활성화**(2026-10-26)로 넓혔다 — 호스트 옵션이 켜져 있으면 **앱이 띄운 AI 타일이 아니어도**(평범한 셸 ·
/// 재접속 · tmux · 신호를 세우지 않은 타일) 모든 에이전트의 훅(시작 명령의 에이전트가 먼저)과 PATH 심(`crate::agent_shim` —
/// exec 한 번 · 이미 이 판이면 쓰지 않는다)을 심는다. 둘은 나란히 돈다. 헤드리스 위임 접속은 이 길을 지나지 않는다.
async fn auto_remote_agent(
    ctx: &OpenCtx<'_>,
    host: &HostOptions,
    agent: Option<&str>,
    stream: &str,
) {
    if !host.agent {
        return;
    }
    let shims = async {
        if let Err(e) = crate::agent_shim::remote_install(Arc::clone(ctx.handle).into()).await {
            eprintln!("에이전트 활성화: {} 에 PATH 심을 심지 못했습니다 — {e}", ctx.alias);
        }
    };
    let hooks = async {
        for t in crate::agent_hooks::auto_install_targets(host.agent, agent) {
            let outcome =
                crate::agent_hooks::remote_auto_install(t, Arc::clone(ctx.handle).into()).await;
            if let crate::agent_hooks::AutoInstall::Failed(reason) = &outcome {
                eprintln!("원격 훅: {} 에 {} 훅을 심지 못했습니다 — {reason}", ctx.alias, t.display);
            }
            if let Some(notice) =
                crate::agent_hooks::auto_notice_once(&outcome, t, ctx.alias, stream)
            {
                crate::server::hub::emit(
                    crate::agent_hooks::REMOTE_AUTO_EVENT,
                    serde_json::to_value(notice).unwrap_or_default(),
                );
            }
        }
    };
    tokio::join!(shims, hooks);
}

/// `sessions.toml` 보강과 프로젝트 토글로 tmux · `on_connect` · 로깅 · 셸 통합 · 에이전트 포워딩을
/// 정한다. 순수 판정(파일 읽기 실패도 접속을 막지 않는다) — 정리할 것 없음.
fn resolve_host_options(
    ctx: &OpenCtx<'_>,
    is_adhoc: bool,
    no_tmux: bool,
    force_tmux: bool,
    start: Option<&SshStart>,
    agent: bool,
) -> HostOptions {
    // sessions.toml 은 접속 파라미터가 아니라 **보강** 계층이다 — 읽기 실패·문법 오류는
    // 접속을 막지 않는다. 경고는 `list_hosts` 가 사이드바에 이미 보여주므로 여기서는 버린다.
    // (2026-09-19 저녁) 이 자리(에이전트 신호 뒤 · sessions.toml 앞)에 있던 `vault::touch()` 는
    // 사라졌다 — 금고에 자기 유휴 시계가 없어졌기 때문이다. 이제 잠그는 것은 **가림막 하나**이고
    // (`app/veil` → `vault_lock`), 접속 중에 등 뒤에서 잠길 일은 사람이 자리를 비웠을 때뿐이다
    // (그때는 잠기는 게 맞다).
    let (meta, _warnings) = crate::sessions_meta::SessionsMeta::load_default();
    let resolved = meta.resolve(ctx.alias);
    // **tmux 호스트는 첫 입력 한 줄을 통째로 쓴다** — `on_connect` 도 셸 통합 스니펫도
    // 자리가 없다(둘 다 `exec tmux` 뒤에는 닿지 못한다). v1 은 그 사실을 숨기지 않고
    // 그대로 끈다: 폼의 `on_connect` 칸 옆에 "tmux 를 켜면 실행되지 않습니다" 가 붙어 있다.
    //
    // 프로젝트 타일은 **프로젝트의 토글이 정한다**([`use_tmux_for`] · docs/log/2026-09-24-projects.md).
    let use_tmux = use_tmux_for(resolved.tmux, no_tmux, force_tmux);
    let on_connect = if use_tmux {
        None
    } else {
        // 프로젝트의 첫 입력(`cd -- … && claude`)은 사용자 `on_connect` **뒤에** 붙는다 — 그래야
        // `on_connect` 가 바꿔 둔 환경(`source .env` 등) 위에서 명령이 돈다. 둘 다 `\n` 으로
        // 끝나는 줄이라 이어 붙이면 그대로 두 줄이다.
        // 시작 명령 없는 타일의 신호 `export` 줄은 여기 없다 — 셸을 띄울 방법(계획)이 정해진 뒤 [`send_bootstrap`] 이
        // 런처에 싣거나(타이핑 없음) 이 앞에 붙인다([`typed_signal_line`]).
        let user = resolved.on_connect.as_deref().and_then(prepare_on_connect);
        let project = start.and_then(project_start_line);
        match (user, project) {
            (None, None) => None,
            (Some(u), None) => Some(u),
            (None, Some(p)) => Some(p),
            (Some(u), Some(p)) => Some(format!("{u}{p}")),
        }
    };
    // 세션 로깅은 **호스트 키(별칭) 기반**이라 SSH 세션에만 붙는다 — 로컬 셸은 sessions.toml
    // 에 항목이 없으므로 범위 밖이다 (docs/log/2026-09-02-triggers-webgl-logging.md).
    let logging = resolved.log.unwrap_or(false);
    // 셸 통합은 **적지 않은 것이 켬**이다 (`log` 와 반대) — 끄려면 `shell_integration = false`
    // 를 명시해야 한다. 그 한 값이 아래 부트스트랩의 세 가지(SFTP 업로드·source 타이핑·
    // `~/.aynx` 생성)를 통째로 가른다 (docs/log/2026-09-02-osc133.md 의 "호스트별 옵트아웃").
    // tmux 호스트의 **첫 입력**에는 통합 줄이 없다 — `exec tmux` 가 그 셸을 갈아 치우고, 마커는
    // tmux 격자를 넘지 못한다(간이 모드의 근거). 그래도 옵션이 켜져 있으면 **서버 파일은 심는다**
    // — 앱이 연 새 tmux 세션의 셸이 그 rc 로 뜬다([`crate::shell_integration::tmux_session_shell`]).
    let integration_option = resolved.shell_integration.unwrap_or(true);
    let shell_integration = !use_tmux && integration_option;
    let prep = remote_prep(integration_option, use_tmux);
    // **에이전트 포워딩** — 호스트 폼의 덮어쓰기(`sessions.toml`)가 있으면 그것, 없으면 config 의
    // `ForwardAgent`. 빠른 접속은 켜는 자리가 없는 대상이라 언제나 끔이다 (같은 이름의 호스트
    // 블록이 있어도 그 설정을 빌려 쓰지 않는다). docs/log/2026-09-23-agent-forwarding.md
    let forward_agent = !is_adhoc
        && crate::agent_forward::effective(ctx.params.forward_agent, resolved.forward_agent);
    // **에이전트 활성화**(`agent` · 옛 `remote_hooks`)는 [`host_agent`] 가 이미 읽었다 — 셸 통합처럼 적지 않은 것이
    // 켬, 빠른 접속은 호스트 설정이 없는 대상이라 끔.
    HostOptions {
        use_tmux,
        on_connect,
        logging,
        shell_integration,
        prep,
        forward_agent,
        agent,
    }
}

/// 셸을 열기 전 서버 쪽 준비의 종류 ([`plan_bootstrap`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemotePrep {
    /// 옵트아웃(`shell_integration = false`) — SFTP 채널조차 열지 않는다.
    Nothing,
    /// tmux 호스트 — 스니펫·rc 는 심되(새 tmux 세션의 셸이 rc 로 뜬다) 첫 입력은 tmux 한 줄뿐이다.
    /// 09-16 의 "화면만 있는 세션"(docs/log/2026-09-16-tmux-toggle.md)은 클라이언트 쪽 결정이라 그대로다.
    FilesOnly,
    /// 보통 호스트 — 파일을 심고 그것으로 셸을 띄운다(exec 런처 · 조용한 한 줄 · heredoc).
    Full,
}

/// 호스트의 셸 통합 옵션과 tmux 여부로 서버 쪽 준비를 정한다 — 순수 판정.
pub(crate) fn remote_prep(integration_option: bool, use_tmux: bool) -> RemotePrep {
    match (integration_option, use_tmux) {
        (false, _) => RemotePrep::Nothing,
        (true, true) => RemotePrep::FilesOnly,
        (true, false) => RemotePrep::Full,
    }
}

/// 서버 쪽 셸 통합 준비(SFTP 업로드 · 로그인 셸 묻기)를 하고 셸을 띄울 방법을 고른다.
/// 실패는 옛 경로로 물러날 뿐 접속을 막지 않는다 — 정리할 것 없음.
async fn plan_bootstrap(
    ctx: &OpenCtx<'_>,
    host: &HostOptions,
) -> crate::shell_integration::BootstrapPlan {
    let alias = ctx.alias;
    let handle = ctx.handle;
    let shell_integration = host.shell_integration;
    // ── 서버 쪽 준비는 **셸을 열기 전에** 끝낸다 ─────────────────────────────
    // 파일이 먼저 있어야 그것을 **시작 파일로 지정해** 셸을 띄울 수 있다
    // (docs/log/2026-09-08-ssh-exec-launcher.md). 뒤늦게 심으면 첫 프롬프트는 이미 훅 없이
    // 그려진 뒤고, 심는 명령 자체가 서버의 `~/.bash_history` 에 남는다.
    //
    // **옵트아웃이면 SFTP 채널조차 열지 않는다** (`sessions.toml` 의
    // `shell_integration = false`) — "이 서버엔 아무것도 심지 마라" 는 업로드도, 타이핑도,
    // `~/.aynx` 생성도 없다는 뜻이다.
    //
    // 실패해도 **접속을 막지 않는다**: 한 단계씩 옛 경로로 물러날 뿐이다.
    let setup = match host.prep {
        RemotePrep::Nothing => {
            eprintln!(
                "셸 통합: {alias} 는 옵트아웃(shell_integration = false) — 아무것도 심지 않습니다"
            );
            crate::shell_integration::RemoteSetup::Failed
        }
        // tmux 호스트 — 파일만 심고 계획은 옵트아웃(`shell_integration` 이 거짓)으로 떨어진다.
        // 이 함수는 `send_bootstrap`(첫 입력) 전에 끝나므로 새 tmux 세션의 셸은 새 rc 를 읽는다.
        RemotePrep::FilesOnly => {
            eprintln!("셸 통합: {alias} 는 tmux 호스트 — 파일만 심고 화면 통합은 붙이지 않습니다");
            if let Err(e) = crate::shell_integration::upload_via_handle(handle).await {
                eprintln!("셸 통합: tmux 호스트에 파일을 심지 못했습니다 ({e})");
            }
            crate::shell_integration::RemoteSetup::Failed
        }
        RemotePrep::Full => match crate::shell_integration::upload_via_handle(handle).await {
            Ok(true) => crate::shell_integration::RemoteSetup::ExecReady,
            Ok(false) => {
                eprintln!("셸 통합: /bin/sh 가 없는 서버 — exec 런처 대신 한 줄을 타이핑합니다");
                crate::shell_integration::RemoteSetup::FilesOnly
            }
            Err(e) => {
                eprintln!("셸 통합: SFTP 로 심지 못해 heredoc 으로 타이핑합니다 ({e})");
                crate::shell_integration::RemoteSetup::Failed
            }
        },
    };
    // 로그인 셸이 bash 인지는 **앱이 먼저 묻는다** (짧게 살았다 죽는 채널 하나 —
    // 접속당 exec 왕복 하나가 이 판정의 값이다). 런처 안의 `$SHELL` 판정에만 맡기면
    // zsh·fish 서버가 `"$SHELL" -l` 로 뜬 채 **훅을 잃는다** — 앱이 "런처를 보냈으니 됐다"
    // 고 믿어 옛 타이핑 부트스트랩을 건너뛰기 때문이다. 물어보면 그 서버들은 오늘까지와
    // 똑같이 `ShellQuiet` 로 간다. 알 필요가 없는 경로에서는 묻지도 않는다.
    let login_shell = if setup == crate::shell_integration::RemoteSetup::ExecReady {
        crate::shell_integration::probe_login_shell(handle).await
    } else {
        None
    };
    let plan =
        crate::shell_integration::bootstrap_plan(shell_integration, setup, login_shell.as_deref());
    if setup == crate::shell_integration::RemoteSetup::ExecReady
        && plan != crate::shell_integration::BootstrapPlan::Exec
    {
        eprintln!(
            "셸 통합: 로그인 셸이 bash 가 아닙니다({}) — 예전처럼 한 줄을 타이핑합니다",
            login_shell.as_deref().unwrap_or("알 수 없음")
        );
    }
    plan
}

/// 셸 채널을 연다 — 세션 채널 → PTY → (에이전트 포워딩 청하기) → 셸/런처. 채널이 안 열리면 얹혀
/// 붙던 전송로를 풀에서 뺀다(`evict`). 나머지 정리(포워딩 장부 · 신호 · 자리)는 호출자의 실패 꼬리가 한다.
async fn open_shell_channel(
    ctx: &OpenCtx<'_>,
    host: &HostOptions,
    plan: crate::shell_integration::BootstrapPlan,
    launcher_signal: Option<&RemoteSignalEnv>,
    cols: u16,
    rows: u16,
) -> Result<ShellChannel, SshOpenError> {
    let channel = match ctx.handle.channel_open_session().await {
        Ok(c) => c,
        Err(e) => {
            // **얹혀 붙던 전송로가 채널을 안 열어 준다 = 그 연결은 사실상 죽었다.** 장부에서
            // 빼 두지 않으면 다음 타일도 같은 막다른 길로 걸어 들어간다(죽은 항목은 보통
            // `Handler::disconnected` 훅이 치우지만, 그 사이로 이 요청이 끼어들 수 있다).
            if ctx.joined {
                TRANSPORTS.evict(ctx.share_key);
            }
            return Err(SshOpenError::other(
                tr!(ko: "셸 채널을 열지 못했습니다: {e}", en: "Could not open the shell channel: {e}"),
            ));
        }
    };
    channel
        .request_pty(true, TERM, cols as u32, rows as u32, 0, 0, &[])
        .await
        .map_err(|e| {
            SshOpenError::other(
                tr!(ko: "PTY 요청이 거부되었습니다: {e}", en: "The PTY request was refused: {e}"),
            )
        })?;
    // ── 에이전트 포워딩 (`auth-agent-req@openssh.com`) — PTY 뒤 · 셸 앞 (OpenSSH 와 같은 자리) ──
    // 장부에 **먼저** 적고 청한다: 서버는 셸이 뜨자마자 채널을 열 수 있다. 서버의 답은 이 채널의
    // 둘째 답으로 온다(`agent_forward::REQUEST_INDEX`) — 거절이면 펌프가 한 줄을 띄우고 세션은
    // 그대로 간다. 보내는 것부터 실패하면(채널이 이미 닫혔다) 여기서 한 줄을 띄운다.
    let mut agent_notice: Option<String> = None;
    let agent_requested = if host.forward_agent {
        crate::agent_forward::enable(ctx.shared.transport_id, ctx.id);
        match channel.agent_forward(true).await {
            Ok(()) => true,
            Err(_) => {
                agent_notice = Some(crate::agent_forward::refused_notice());
                false
            }
        }
    } else {
        false
    };
    // exec 경로만 셸을 **런처를 거쳐** 띄운다. 나머지 셋은 예전 그대로 `request_shell` 이고,
    // 채널의 수명·종료 처리(exit-status/eof/close)는 두 경우가 완전히 같다 — 아래 펌프는
    // 어느 쪽으로 열렸는지 알 필요가 없다.
    if plan == crate::shell_integration::BootstrapPlan::Exec {
        // 신호 환경(스트림 id · PATH 심 · codex 표식 — 비밀 없음)이 있으면 런처 앞에 싣는다 — 타이핑하지 않으니 화면에도
        // 이력에도 없다([`exec_launcher_with_signal`]).
        let launcher = match launcher_signal {
            Some(env) => exec_launcher_with_signal(env),
            None => crate::shell_integration::exec_launcher(),
        };
        eprintln!(
            "셸 통합: 시작 파일({})로 셸을 띄웁니다 — 타이핑하는 줄이 없습니다",
            crate::shell_integration::RC_PATH
        );
        channel
            .exec(true, launcher)
            .await
            .map_err(|e| SshOpenError::other(tr!(ko: "로그인 셸 실행 요청이 거부되었습니다: {e}", en: "The request to run the login shell was refused: {e}")))?;
    } else {
        channel.request_shell(true).await.map_err(|e| {
            SshOpenError::other(
                tr!(ko: "셸 요청이 거부되었습니다: {e}", en: "The shell request was refused: {e}"),
            )
        })?;
    }
    Ok(ShellChannel {
        channel,
        agent_requested,
        agent_notice,
    })
}

/// 출력 길을 깐다 — 배칭 스레드 · 보안 완화/포워딩/신호 알림 줄 · 수문 · (옵트인) 세션 로그.
/// 실패 경로가 없다(로그를 못 열면 tee 없이 간다) — 정리할 것 없음.
fn start_output(
    ctx: &OpenCtx<'_>,
    agent_notice: Option<&str>,
    signal_notice: Option<&str>,
    logging: bool,
) -> (OutputPipe, PumpFeed) {
    let params = ctx.params;
    // 출력은 로컬 PTY 와 동일한 4ms/64KB 배칭을 거쳐 꼬리 링에 적힌다. 슬롯에는 **아직 싱크가 없다** — 표에 올린 뒤
    // 부른 쪽(`server::sessions`)이 그 임대의 연결 싱크를 꽂고 링을 0 부터 재생한다(③-3b2 — 출력 프레임의 머리에는 임대
    // 열쇠가 실려야 해서). 덩어리는 `Chunk` 로 보낸다 — 종료 마감이 같은 입구로 표식을 넣는다(`crate::output::flush_mark`).
    let (tx, rx) = mpsc::channel::<Chunk>();
    let output = crate::output::output_slot(None);
    let stats = Arc::new(OutputStats::default());
    crate::output::spawn_batcher(rx, Arc::clone(&output), Arc::clone(&stats));

    // ── 보안 완화 알림 ──────────────────────────────────────────────────────
    // 원격 바이트와 **같은 채널**에 직접 써서 프런트 수정 없이 터미널에 띄운다.
    // 펌프를 띄우기 전이자 on_connect 전송 전이라 반드시 화면 맨 위에 선다.
    // 세션 전체가 검증되지 않았는지는 홉 중 가장 약한 고리로 판단한다.
    let verification_off = params.strict.skips_verification()
        || params
            .jump
            .as_ref()
            .is_some_and(|j| j.strict.skips_verification());
    for line in security_notices(
        verification_off,
        ctx.auto_accepted.load(Ordering::SeqCst),
        ctx.changed_accepted.load(Ordering::SeqCst),
    ) {
        let _ = tx.send(Chunk::Data(line.as_bytes().to_vec()));
    }
    if let Some(line) = agent_notice {
        let _ = tx.send(Chunk::Data(line.as_bytes().to_vec()));
    }
    if let Some(line) = signal_notice {
        let _ = tx.send(Chunk::Data(line.as_bytes().to_vec()));
    }

    let gate = Arc::new(Gate::new());
    let pump_gate = Arc::clone(&gate);

    // ── 세션 로깅 (기본 꺼짐) ────────────────────────────────────────────────
    // 실패하면 `None` 이라 tee 없이 그대로 진행한다 — 로그를 못 쓴다고 접속이 막히면 안 된다.
    // 이 송신자는 아래 펌프 태스크가 소유한다: 태스크가 끝나면 떨어지고, 그때 쓰기 스레드가
    // flush 하고 파일을 닫는다 (crate::session_log).
    // 경로는 아래 세션 표에 적고(프런트가 "세션 로그 열기" 로 묻는 값), 송신자는 펌프가 쥔다.
    let started_log = if logging {
        crate::session_log::start(ctx.alias)
    } else {
        None
    };
    let log_file = started_log.as_ref().map(|l| l.path.clone());
    let log_tx = started_log.map(|l| l.tx);
    let closed = Arc::new(Notify::new());
    let closing = Arc::new(AtomicBool::new(false));

    (
        OutputPipe {
            gate,
            output,
            stats,
            log_file,
            closed: Arc::clone(&closed),
            closing: Arc::clone(&closing),
            mark: tx.clone(),
        },
        PumpFeed {
            tx,
            pump_gate,
            log_tx,
            closed,
            closing,
        },
    )
}

/// 첫 입력으로 **타이핑하는 우리 줄**의 에코를 지울 필터들 (**순수 함수** · 순서대로 이어 붙여 먹인다).
///
/// - 셸 통합의 조용한 한 줄([`crate::shell_integration::quiet_command_line`]) — [`crate::shell_integration::BootstrapPlan::ShellQuiet`] 에서만 (한 번).
/// - 신호 `export` 줄([`typed_signal_line`] — 런처를 못 탄 평범한 타일, 2026-10-27) — **둘**. 셸이 읽기 전에 도착한 입력은
///   터미널 드라이버가 한 번 에코하고, 줄 편집기(readline · ZLE)가 첫 프롬프트 뒤에 다시 그린다(실측 — 두 번 보였다). 같은
///   바늘의 필터 둘을 잇대면 앞이 첫 등장을, 뒤가 그다음 등장을 지운다(앞 필터가 부분 일치를 붙들고 있는 동안 뒤 필터는 그
///   바이트를 보지 못한다). 둘째가 오지 않는 셸이면 둘째 필터는 예산(8KB)을 다 쓰고 스스로 꺼진다.
///
/// **사용자의 `on_connect` 는 여기 없다** — 자기가 적은 명령은 자기 화면에 보여야 한다. exec 런처 · heredoc · 옵트아웃에서
/// 신호 줄도 없으면 빈 목록(통과)이다.
pub(crate) fn echo_filters(
    plan: crate::shell_integration::BootstrapPlan,
    typed_signal: Option<&str>,
) -> Vec<crate::shell_integration::EchoFilter> {
    use crate::shell_integration::EchoFilter;
    let mut filters = Vec::new();
    if plan == crate::shell_integration::BootstrapPlan::ShellQuiet {
        filters.push(EchoFilter::for_line(
            &crate::shell_integration::quiet_command_line(),
        ));
    }
    if let Some(line) = typed_signal {
        let needle = signal_echo_needle(line);
        filters.push(EchoFilter::for_line(needle));
        filters.push(EchoFilter::for_line(needle));
    }
    filters
}

/// 채널을 읽는 펌프 태스크를 띄운다 — 역압 · 로그 tee · 에코 지우기 · 종료 증거 수집, 끝나면
/// `ssh-exit` 를 **정확히 한 번** 쏜다. 실패 경로가 없다 — 정리할 것 없음.
fn spawn_output_pump(
    mut reader: ChannelReadHalf,
    feed: PumpFeed,
    exit: Arc<ExitSignal>,
    mut echo: Vec<crate::shell_integration::EchoFilter>,
    agent_requested: bool,
) {
    let PumpFeed {
        tx,
        pump_gate,
        log_tx,
        closed,
        closing,
    } = feed;
    // 에코 필터(`echo`)는 부르는 쪽이 펌프보다 **먼저** 지었다([`echo_filters`]) — 우리 줄을 보내기 전부터 서 있어야
    // 첫 바이트를 놓치지 않는다.
    tokio::spawn(async move {
        // 이 채널이 받은 요청 답(`Success`/`Failure`)의 수 — 에이전트 요청의 답을 가려낸다.
        let mut replies = 0usize;
        while let Some(msg) = until_closed(reader.wait(), &closed).await {
            match msg {
                ChannelMsg::Success | ChannelMsg::Failure => {
                    let failure = matches!(msg, ChannelMsg::Failure);
                    if crate::agent_forward::refused(agent_requested, replies, failure) {
                        let _ = tx.send(Chunk::Data(
                            crate::agent_forward::refused_notice().into_bytes(),
                        ));
                    }
                    replies += 1;
                }
                // stderr(ExtendedData)도 터미널에서는 같은 스트림이다.
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    // 수문이 닫혀 있으면 여기서 태스크가 **양보한 채** 멈춘다.
                    // 멈춘 동안 `reader.wait()` 를 부르지 않으므로 russh 가 채널 윈도우를
                    // 더 열지 않고, 윈도우가 소진되면 서버가 전송을 멈춘다 — 역압이
                    // 원격까지 전파되는 연쇄다 (블로킹이 아니라 async 대기여야 하는 이유:
                    // 이 태스크가 워커 스레드를 물고 있으면 같은 런타임의 keepalive·
                    // 다른 세션까지 함께 굶는다).
                    pump_gate.wait_async().await;
                    // 로그는 **배칭 전 · 역압 뒤**에 뜬다. 배칭 전이라 원격이 보낸 청크
                    // 경계까지 그대로 남고(시퀀스를 벗기지 않는다 — 4단계 로그 재생의 재료),
                    // 역압 뒤라 수문이 닫힌 동안 로그만 앞서 나가는 일이 없다.
                    if let Some(log) = &log_tx {
                        let _ = log.send(data.to_vec());
                    }
                    // 에코 지우기는 **로그 tee 뒤 · 배칭 앞**이다. 뒤인 이유: 로그는 서버가
                    // 실제로 보낸 것을 그대로 남기는 파일이라, 우리가 화면에서 감춘 줄도
                    // 거기엔 있어야 정직하다 (로그가 화면의 각색본이 되면 안 된다).
                    // 앞인 이유: 배치는 청크를 이어 붙여 경계를 지우므로, 그 전에 봐야
                    // "한 번만" 이라는 계약을 필터가 스스로 지킬 수 있다.
                    let mut out = data.to_vec();
                    for f in &mut echo {
                        out = f.feed(&out);
                    }
                    // 할 일을 마친 필터(지웠거나 예산을 다 썼다)는 내려놓는다 — 그 뒤 출력은 복사 한 번으로 지나간다.
                    echo.retain(|f| !f.is_done());
                    if out.is_empty() {
                        continue;
                    }
                    if tx.send(Chunk::Data(out)).is_err() {
                        break;
                    }
                }
                // 셸이 **스스로** 끝났다는 강한 증거 (종료 코드·신호 포함).
                // 기록만 해 두고 루프는 계속 돈다 (뒤이어 Close 가 와야 끝난다).
                ChannelMsg::ExitStatus { exit_status } => {
                    exit.note_shell_exit(ShellExit::Status(exit_status));
                }
                ChannelMsg::ExitSignal { signal_name, .. } => {
                    exit.note_shell_exit(ShellExit::Signal(format!("{signal_name:?}")));
                }
                // 정돈된 채널 닫힘 — 그 자체로 약한 정상 종료 증거다. 일부 sshd 는
                // `exit-status` 를 안 보내거나 (실기: 사내망 1220 서버에서 exit 가 끊김으로
                // 오판됐던 원인) **Eof 뒤에** 보내므로, Eof 에서는 끊지 않고 Close 까지
                // 마저 읽어 늦게 오는 status 를 줍는다. 전송로가 죽으면 이 메시지들 없이
                // `wait()` 가 `None` 을 주므로 끊김과 혼동되지 않는다.
                ChannelMsg::Eof => {
                    exit.note_shell_exit(ShellExit::Closed);
                }
                ChannelMsg::Close => {
                    exit.note_shell_exit(ShellExit::Closed);
                    break;
                }
                _ => {}
            }
        }
        drop(tx);
        // 이 앱이 닫았다(`shut_shell`) — 읽기 쪽이 먼저 끝났어도(마지막 사용자라 전송로까지 끊었다) 정돈된 종료다.
        if closing.load(Ordering::SeqCst) {
            exit.note_shell_exit(ShellExit::Closed);
        }
        // 펌프는 전송 계층 사유를 모른다 — 증거가 없으면 `classify_exit` 가 기본 문구를 쓴다.
        // (끊김이면 보통 `disconnected` 가 먼저 도착해 더 구체적인 문구로 이미 쏜 뒤다.)
        exit.fire(None);
    });
}

/// 채널의 다음 메시지 — 단 **이 앱이 채널을 닫았으면**(`close_ssh` 가 `closed` 를 울렸다) `None`(끝).
///
/// 러시(0.63.1)는 **우리가 먼저 보낸** `CHANNEL_CLOSE` 에 서버가 답한 `CHANNEL_CLOSE` 를 읽기 쪽에
/// 넘기지 않는다 — 보내는 순간 채널을 제 표에서 지워(`session.rs` 의 `close`) 답이
/// `is_established_channel` 에 걸려 버려지고(`client/encrypted.rs` 의 `CHANNEL_CLOSE`), 읽기 쪽
/// 송신자도 전송로가 끝날 때까지 남는다. 그래서 `reader.wait()` 는 **전송로가 살아 있는 한**
/// 영영 안 끝난다 — 공유 전송로에서 옆 타일이 살아 있으면 닫은 타일의 펌프가 남아 로그가
/// flush 되지 않았다(docs/log/2026-09-30-shared-session-log-flush.md). 닫은 것은 우리이니 끝도 우리가 안다.
///
/// `biased` — 이미 도착해 쌓인 메시지를 **먼저** 다 읽은 뒤에야 닫힘을 본다(로그가 닫기 직전
/// 출력까지 담는다). `Notify::notify_one` 은 기다리는 이가 없어도 허가를 남기므로 순서 경쟁이 없다.
/// 원격이 먼저 닫는 길(Eof → 늦은 exit-status → Close)은 그대로다 — 종이 울리지 않는다.
pub(super) async fn until_closed<T>(
    next: impl std::future::Future<Output = Option<T>>,
    closed: &Notify,
) -> Option<T> {
    tokio::select! {
        biased;
        msg = next => msg,
        _ = closed.notified() => None,
    }
}

/// tmux 호스트면 이 타일이 붙을 tmux 세션 이름(과 `-D` 여부)을 고른다 — 힌트, 아니면 이 앱도
/// 서버도 쓰지 않는 가장 작은 `aynx-N`. 세션 표 잠금은 읽는 한 문장 동안만. 정리할 것 없음.
async fn choose_tmux_name(
    ctx: &OpenCtx<'_>,
    sessions: &SshSessions,
    tmux_name: Option<&str>,
    use_tmux: bool,
) -> Option<(String, bool)> {
    // ── 셸이 선 뒤에 보내는 것 (계획이 정한다) ───────────────────────────────
    // 셸이 이미 섰고 출력 펌프도 돌기 시작했으니 지금 보낸다. 프롬프트를 기다릴 필요는
    // 없다 — PTY 입력 큐에 쌓여 있다가 셸이 준비되는 대로 읽는다.
    //
    // **exec 경로에는 우리 줄이 없다.** 훅은 시작 파일이 이미 걸었으므로 여기 남는 것은
    // 사용자의 `on_connect` 뿐이고, 그것은 언제나 마지막이다 (셸 상태를 `exec`·`tmux attach`
    // 로 바꿔도 훅은 그 전에 걸린 뒤다 — `prepare_on_connect` 의 ①→② 계약).
    //
    // 나머지 셋은 오늘까지의 동작 그대로다. 실패해도 **세션은 이미 열려 있다** — 접속
    // 실패로 만들지 않는다. 스니펫이 안 들어가면 OSC 133 이 없는 세션이 될 뿐이고,
    // 프런트는 기존 활동 점으로 폴백한다.
    //
    // **tmux 호스트는 이 분기 전체를 건너뛴다** — 보낼 것이 tmux 한 줄뿐이다(위에서 `plan` 은
    // 이미 옵트아웃으로 떨어져 있고 `on_connect` 도 `None` 이다).
    //
    // 이름은 **지금** 고른다. 앞의 await 들(전송·인증)이 다 끝난 뒤라, 같은 호스트에 두 타일을
    // 동시에 여는 창이 겹칠 수 있는 구간이 잠금 한 번 폭으로 좁다. 그래도 남는 경쟁은 있고
    // (둘 다 표에 없는 사이 같은 번호를 고른다), 그 결과는 두 타일이 같은 tmux 세션을 보는
    // 것이라 **눈에 보이고 되돌릴 수 있다** — 실제로 겪기 전에 직렬화 잠금을 미리 세우지
    // 않는다(CLAUDE.md 의 "방어 기계를 미리 늘리지 않는다").
    if !use_tmux {
        return None;
    }
    // 힌트는 프런트(=배치 파일·세션 목록)를 한 바퀴 돌고 온 문자열이라 셸에 넣기 전에
    // 잠근다. 모양이 아니라 **위험**을 본다 — 목록에서 고른 남의 세션 이름에는 공백·한글이
    // 들어 있을 수 있다(`safe_tmux_target`, 셸 인용은 `sh_quote`).
    let hint = tmux_name.and_then(safe_tmux_target);
    // **새 타일은 서버에 남은 세션 이름도 피한다**(2026-09-29 dev-01 실기) — 이 앱이 모르는 분리된 `aynx-1`(어제
    // 것)을 고르면 `new-session -A` 가 거기 **붙어** `-c` · 시작 명령을 버린다(워크트리 타일이 `~` 에서 멈추고
    // 설정 스크립트 · 에이전트가 사라졌다). exec 왕복 하나로 묻고, 실패 · tmux 없음이면 빈 목록 = 예전 동작이다.
    // 앱 장부(`taken`)는 **이 await 뒤에** 읽는다 — 앱 안의 두 타일 경쟁 창을 예전 폭 그대로 둔다.
    let on_server = if hint.is_none() {
        let out = run_exec(
            Arc::clone(ctx.handle),
            tmux_list_command(),
            TMUX_QUERY_TIMEOUT,
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        if out.exit_code == Some(0) {
            parse_tmux_list(&out.stdout)
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };
    // 같은 별칭의 **살아 있는** 세션들이 물고 있는 이름. 두 곳에서 쓴다 — 새 이름을 고를 때
    // (구멍 메우기)와, 힌트에 `-D` 를 붙일지 정할 때([`kick_stale_for_hint`]).
    let taken: Vec<String> = sessions
        .0
        .lock()
        .unwrap()
        .values()
        .filter(|s| s.alias.eq_ignore_ascii_case(ctx.alias))
        .filter_map(|s| s.tmux.clone())
        .collect();
    Some(match hint {
        // 힌트가 왔다(재접속·복원·창 이관·목록에서 고른 세션) — 그 이름 그대로.
        // `-D` 는 **이 앱이 지금 물고 있지 않은 이름에만** 붙는다: 물고 있으면 떼어 낼 것이
        // 낡은 클라이언트가 아니라 옆 타일의 화면이므로, `-A` 만으로 함께 본다.
        Some(h) => (h.to_string(), kick_stale_for_hint(h, &taken)),
        // 새 타일 — 이 앱도 서버도 쓰지 않는 가장 작은 번호. `-D` 는 붙이지 않는다.
        None => (pick_new_tmux_name(&taken, &on_server), false),
    })
}

/// 셸이 선 뒤의 첫 입력(tmux 줄 · 셸 통합 부트스트랩 · `on_connect`)을 짓고 보낸다. 보내기 실패는
/// 무시한다(세션은 이미 열려 있다) — 정리할 것 없음.
async fn send_bootstrap(
    writer: &ChannelWriteHalf<Msg>,
    chosen_tmux: Option<&(String, bool)>,
    start: Option<&SshStart>,
    plain_signal: Option<&RemoteSignalEnv>,
    plan: crate::shell_integration::BootstrapPlan,
    typed_signal: Option<&str>,
    on_connect: Option<&str>,
) {
    use crate::shell_integration::BootstrapPlan;
    // 런처를 못 탄 신호 줄([`typed_signal_line`])은 사용자 `on_connect` **앞에** 선다 — 그 뒤의 명령과 사람이 이 셸에서
    // 띄울 에이전트가 물려받는다. 에코는 펌프의 필터([`echo_filters`])가 지운다.
    let joined = typed_signal.map(|line| format!("{line}{}", on_connect.unwrap_or("")));
    let on_connect = joined.as_deref().or(on_connect);
    let bootstrap = if let Some((name, kick)) = chosen_tmux {
        match start {
            // 프로젝트 타일 — 시작 폴더·명령을 tmux 세션의 것으로 얹는다(에이전트가 tmux 안에서 돈다).
            Some(st) => format!("{}\r", tmux_attach_command_with_start(name, *kick, st)),
            // 시작 명령 없는 타일 — 호스트 AI 권한이 신호를 줬으면 그 환경으로 새 세션의 셸을 띄운다.
            None => match plain_signal {
                Some(env) => format!("{}\r", tmux_attach_command_with_env(name, *kick, Some(env))),
                None => tmux_bootstrap(name, *kick),
            },
        }
    } else {
        match plan {
            BootstrapPlan::Exec => crate::shell_integration::build_bootstrap_exec(on_connect),
            BootstrapPlan::ShellQuiet => {
                crate::shell_integration::build_bootstrap_quiet(on_connect)
            }
            // 조립이 실패하는 유일한 경우는 스니펫 상수에 heredoc 종료 표식이 들어간 사고인데,
            // 그때도 접속은 막지 않고 `on_connect` 만 보내던 예전 동작으로 간다.
            BootstrapPlan::ShellHeredoc => {
                crate::shell_integration::build_bootstrap_heredoc(on_connect)
                    .unwrap_or_else(|_| on_connect.map(str::to_owned).unwrap_or_default())
            }
            BootstrapPlan::ShellOptOut => {
                crate::shell_integration::build_bootstrap_opt_out(on_connect)
            }
        }
    };
    if !bootstrap.is_empty() {
        let _ = writer.data_bytes(bootstrap.into_bytes()).await;
    }
}

/// 세션 표에 이 타일을 올린다 — 이 뒤로 같은 호스트의 다음 타일은 이 tmux 이름을 피해 간다.
/// **세션 코어 등록(새 회차·첫 임대 — 그 임대는 `conn` 연결의 것)** → 표 삽입 순서. 창의 generation 검사는 GUI 가 답을
/// 받은 뒤에 한다(③-3b2 — 서버는 창을 모른다; 늦었으면 GUI 가 곧바로 `close` 를 보낸다).
#[allow(clippy::too_many_arguments)]
fn register_session(
    ctx: &OpenCtx<'_>,
    sessions: &SshSessions,
    stream: &str,
    conn: u64,
    writer: ChannelWriteHalf<Msg>,
    pipe: OutputPipe,
    host: &HostOptions,
    signal_key: &Option<(String, u64)>,
    chosen_tmux: &Option<(String, bool)>,
) -> Keys {
    let shared = ctx.shared;
    let OutputPipe {
        gate,
        output,
        stats,
        log_file,
        closed,
        closing,
        mark,
    } = pipe;
    let record = SshSession {
        handle: Arc::clone(&shared.handle),
        transport_id: shared.transport_id,
        jump: shared.jump.clone(),
        shell: Some(ShellPipe {
            writer: Arc::new(writer),
            gate,
            output,
            stats,
            closed,
            closing,
            mark: std::sync::Mutex::new(mark),
        }),
        shared: Some(ctx.pin.clone()),
        joined: ctx.joined,
        agent_forward: host.forward_agent,
        signal: signal_key.clone(),
        alias: ctx.alias.to_string(),
        // 장부 등재 — 이 뒤로 같은 호스트의 다음 타일은 이 이름을 피해 간다.
        tmux: chosen_tmux.as_ref().map(|(name, _)| name.clone()),
        log_path: log_file,
        // **얹혀 붙은 세션도 전송로를 세운 그 인증을 보고한다** — 이 세션을 서버에
        // 들여보낸 것이 바로 그 인증이기 때문이다. 다른 것은 `joined` 한 칸뿐이고,
        // 말풍선이 그 한 칸으로 "(공유 연결)" 을 앞에 붙인다.
        info: ConnectedAs {
            server_version: shared.server_version.clone(),
            method: shared.method,
            identity: shared.identity.clone(),
            identity_stored: shared.identity_stored,
            jump: shared.jump_label.clone(),
            connected_at_ms: now_ms(),
            keepalive_secs: shared.keepalive_secs,
        },
    };
    let keys = {
        let mut core = core();
        let keys = core.commit(stream, Kind::Ssh, ctx.id, ctx.window, std::time::Instant::now());
        core.set_lease_conn(stream, conn);
        keys
    };
    sessions.0.lock().unwrap().insert(ctx.id, record);
    keys
}
