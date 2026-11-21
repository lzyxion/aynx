//! 대화형 SSH 타일 열기 — 세션 서버 op `open_ssh` 의 몸.
//!
//! 사람이 친 비밀번호 · 암호구 · 호스트 키 결정은 **GUI → 서버 한 방향**이고, 서버는 그 값을 로그에 남기지 않는다.
//! 접속 관문(호스트 키 · 비밀번호 · 암호구)은 "끊고 재시도" 다 — 실패가 GUI 모달로 돌아가 묻고, 답을 실은 새 `open_ssh` 가 온다.
//!
//! 불변식:
//! - **원격 타일에는 MCP 토큰을 주지 않는다** — 스트림별 신호 전용 토큰만 `-R` 로(→ docs/invariants.md 전문 11).
//! - **열기 = 세션 코어의 새 회차** — 시작하자마자 스트림별 예약을 잡고(살아 있으면 `[session-alive]` · 여는 중이면 `[session-busy]`),
//!   표에 올리는 순간 코어에 회차를 적는다. 떨어진 세션에 다시 붙는 것은 이 길이 아니다(autorun · 셸 통합 스니펫 · 훅 설치를 다시 보내지 않는다).

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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshOpenResult {
    pub id: u32,
    /// 어느 tmux 세션에 붙었는지는 백엔드만 안다 — 프런트가 타일(`PaneSpec.tmux`)에 적어 두었다가 재접속 힌트로 되돌려 준다.
    pub tmux: Option<String>,
    /// 프런트 손잡이가 이 뒤의 모든 호출에 동봉한다(`crate::session_core` 머리말 "임대 규칙").
    pub lease: Keys,
}

/// 표에 올리지 못한 채 떨어지면 스스로 푼다.
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

/// 열기에 스트림이 없을 때(옛 배치 · 시험) — 코어 표의 열쇠는 있어야 한다.
fn anonymous_stream() -> String {
    static ANON: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    format!("ssh-anon-{}", ANON.fetch_add(1, Ordering::Relaxed))
}

/// **`Debug` 를 파생하지 않는다** — 비밀번호 · 암호구가 실린다. serde 오류 문구도 값을 되풀이할 수 있어 부른 쪽이 고정 문구로 바꾼다.
///
/// - `password` 는 **저장하지 않는다** — 이 한 번에만 실린다.
/// - `host_key_decision` 이 없으면 미상 · 바뀐 키를 거부한다.
/// - 에이전트 신호를 세울지는 프런트가 싣지 않는다 — 서버가 [`signal_stream`] 한 곳에서 정한다.
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

/// 표에 올린 뒤의 출력은 **아직 아무 창에도 가지 않는다**(링에만 적힌다) — 부른 쪽이 돌려받은 열쇠로 싱크를 꽂고 링을 0 부터 재생한다
/// (보안 알림 · 첫 프롬프트가 그 임대로 간다). `conn` 은 이 임대를 쥔 연결.
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
    // **스트림별 예약**을 가장 먼저 잡는다 — 접속하는 사이 같은 스트림의 둘째 열기도 여기서 막힌다.
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
    // 암호구는 이 함수의 몸통 하나에만 산다 — 어느 길로 나가든 드롭 순간 0 으로 덮는다.
    let passphrase = passphrase.map(zeroize::Zeroizing::new);
    let declined_keys = declined_keys.unwrap_or_default();
    // 창의 generation 검사는 GUI 의 일이다(프록시가 답을 받은 뒤 `crate::reap::admit`) — 서버는 창을 모른다.
    let params = resolve_open_params(&alias, adhoc.as_ref())?;

    // ── 연결 공유 ──
    // 게이트를 여기서부터 잡는다 — "풀 보기 → 접속 · 인증 → 등록" 이 한 덩어리여야 동시에 누른 두 타일이 둘 다 차갑게 붙지 않는다.
    // 게이트는 키마다 하나다.
    let share_key = transport_key(&params, &alias, adhoc.is_some());
    let share_gate = TRANSPORTS.gate(&share_key);
    let coalesce = share_gate.lock().await;

    // id 는 풀의 사용자 장부 때문에 먼저 뽑지만 `exit.bind(id)` 는 셸이 선 뒤다(접속에 실패한 세션은 `ssh-exit` 를 쏘지 않는다).
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let exit = Arc::new(ExitSignal::new());

    // 두 홉이 같은 플래그를 공유한다 — 어느 쪽이 수락했든 배너 한 줄. 얹혀 붙는 타일에서는 둘 다 거짓으로 남는다.
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

    // 설정 스크립트가 명령 자리를 `sh … && <에이전트>` 로 바꾸기 **전**에 읽는다.
    let hook_agent = start
        .as_ref()
        .and_then(|s| s.command.as_deref())
        .and_then(crate::agent_args::agent_of_line)
        .map(|(id, _)| id);
    // 이것도 명령 자리가 바뀌기 **전**에 읽는다.
    let ai_launch = start
        .as_ref()
        .and_then(|s| s.command.as_deref())
        .is_some_and(launches_ai);
    // 앱이 띄우는 원격 codex 의 `--no-daemon` 과 신호 환경의 표식이 같은 값을 본다.
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

    // ── 여기서부터는 자리를 이미 차지한 뒤다 ──
    // 아래에서 실패하면 풀 장부 · 전송로 종료 명단의 자리를 도로 내놓아야 한다 — 그래서 남은 몸통을 블록 하나로 묶는다.
    let outcome: Result<SshOpenResult, SshOpenError> = async {
        // 둘 다 첫 입력 전에 끝나야 한다.
        let (plan, ()) = tokio::join!(
            plan_bootstrap(&ctx, &host),
            auto_remote_agent(&ctx, &host, hook_agent, &stream),
        );
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

        // 펌프를 띄우기 **전에** 심어야 즉시 끊기는 세션도 ssh-exit 를 받는다.
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
// 단계
// ---------------------------------------------------------------------------

struct OpenCtx<'a> {
    id: u32,
    alias: &'a str,
    params: &'a ConnectParams,
    share_key: &'a str,
    shared: &'a SharedTransport,
    joined: bool,
    handle: &'a SessionHandle,
    pin: &'a SharedPin,
    window: &'a str,
    auto_accepted: &'a AtomicBool,
    changed_accepted: &'a AtomicBool,
}

/// **`Debug` 를 붙이지 않는다** — 비밀번호 · 암호구가 실린다. [`acquire_transport`] 한 번에 소비된다.
struct Credentials<'a> {
    host_key_decision: Option<HostKeyDecision>,
    password: Option<String>,
    passphrase: Option<&'a str>,
    passphrase_for: Option<&'a str>,
    declined_keys: &'a [String],
    /// **물을 사람이 없는 열기**(AI 전용 DB 연결의 경유)의 볼트 키 암호구들 — 헤드리스 규칙대로 호스트에 `vault_passphrase` 위임이 있을 때만 채워진다.
    /// `Some` 이면 **볼트의 SSH 비밀번호를 보지 않고** 잠긴 키는 묻지 않고 건너뛴다. `None` = 사람이 있는 열기.
    unattended: Option<&'a [StoredKey]>,
}

struct HostOptions {
    use_tmux: bool,
    on_connect: Option<String>,
    logging: bool,
    shell_integration: bool,
    prep: RemotePrep,
    forward_agent: bool,
    /// 에이전트 활성화 — 접속할 때 훅 · PATH 심을 서버에 심는가.
    agent: bool,
}

struct HostAgent {
    /// 셸 통합을 끈 호스트에는 신호 파일을 쓰지 않는다("이 서버엔 아무것도 심지 마라").
    files: bool,
    /// 에이전트 활성화(빠른 접속은 끔) — 이 스위치 자체가 에이전트용 파일을 심어도 된다는 동의다.
    agent: bool,
    keys: Option<crate::remote_signal_file::AgentKeys>,
}

struct ShellChannel {
    channel: Channel<Msg>,
    agent_requested: bool,
    agent_notice: Option<String>,
}

struct OutputPipe {
    gate: Arc<Gate>,
    output: crate::output::OutputSlot,
    stats: Arc<OutputStats>,
    log_file: Option<String>,
    closed: Arc<Notify>,
    closing: Arc<AtomicBool>,
    mark: mpsc::Sender<Chunk>,
}

struct PumpFeed {
    tx: mpsc::Sender<Chunk>,
    pump_gate: Arc<Gate>,
    log_tx: Option<mpsc::Sender<Vec<u8>>>,
    closed: Arc<Notify>,
    closing: Arc<AtomicBool>,
}

/// 내려갈 때 `token` 으로 뺀다([`unpin_shared`]).
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

/// 자리를 차지한 뒤 실패했을 때의 정리 — 풀의 자리를 맨 끝에 내놓는다(신호 파일은 전송로가 살아 있을 때라야 지운다).
async fn release_failed_open(
    shared: &SharedTransport,
    id: u32,
    signal_key: &Option<(String, u64)>,
    pin: &SharedPin,
) {
    crate::agent_forward::disable(shared.transport_id, id);
    crate::port_forward::stop_session_forwards(id);
    if let Some((stream, owner)) = signal_key {
        if crate::agent_signal::revoke(stream, *owner) == Some(true) {
            crate::remote_signal_file::remove(&shared.handle, stream).await;
        }
    }
    unpin_shared(pin, id).await;
}

fn resolve_open_params(
    alias: &str,
    adhoc: Option<&AdhocTarget>,
) -> Result<ConnectParams, SshOpenError> {
    let username = std::env::var("USERNAME").ok();
    let params = match adhoc {
        // 빠른 접속은 config 를 아예 읽지 않는다.
        Some(target) => resolve_adhoc(target, username.as_deref())?,
        None => {
            let config = ssh_config::load_default().map_err(SshOpenError::other)?;
            resolve_params(alias, &config.hosts, username.as_deref())?
        }
    };
    Ok(params)
}

/// 있으면 얹혀 붙고(따뜻한 길), 없으면 접속 · 인증해 풀에 올린다(차가운 길). 실패하면 풀에 아무것도 올리지 않은 채 돌아간다.
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
        // ── 따뜻한 길 — TCP · 인증 · 볼트 관문 없이 채널 하나만 더 연다 ──
        Some(existing) => (existing, true),
        // ── 차가운 길 ──
        None => {
            // 볼트는 인증 루프 밖에서 **한 번만** 본다(디스크 · 복호가 실행자를 붙든다). 사람이 방금 친 값이 있으면 그 갈래는 묻지 않는다(언제나 더 새롭다).
            // **물을 사람이 없는 열기**는 헤드리스와 같은 규칙 — 볼트의 SSH 비밀번호는 보지 않고, 키 암호구는 위임(`vault_passphrase`)을 확인하고 넘긴 것만 쓴다.
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

            // 죽은 전송로가 풀에 남으면 다음 타일이 그 위에 채널을 열려다 실패하는 막다른 길이 된다 — 죽을 때 장부에서 뺀다.
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
            let _displaced = TRANSPORTS.insert(share_key, id, shared.clone());
            (shared, false)
        }
    };
    Ok((shared, joined))
}

// ---------------------------------------------------------------------------
// 공유 전송로만 빌리기 — 쿼리 타일의 SSH 터널
// ---------------------------------------------------------------------------
//
// **세션이 아니다** — 표에 올리면 헤드리스가 "셸 없는 세션 + 같은 별칭" 으로 재사용하고 세션 목록 어디에나 보인다.
// 그래서 이 구획은 `table()` 을 부르지 않는다(시험 `acquire_shared_never_touches_the_session_table` — 이 구획 머리 줄과
// 아래 "원격 새 워크트리를 준비한다" 주석 줄 글자로 구획을 자른다). 관문은 타일 열기와 같은 길이다.

/// [`OpenSsh`] 의 인증 칸과 같은 뜻이다. **`Debug` 없음**(비밀번호 · 암호구).
#[derive(Default)]
pub(crate) struct SharedCreds {
    pub host_key_decision: Option<HostKeyDecision>,
    pub password: Option<String>,
    pub passphrase: Option<zeroize::Zeroizing<String>>,
    pub passphrase_for: Option<String>,
    pub declined_keys: Vec<String>,
    /// **물을 사람이 없다**(AI 전용 DB 연결) — 헤드리스와 같은 관문: 사람의 답을 받지 않고 볼트의 SSH 비밀번호를 쓰지 않으며,
    /// 볼트의 키 암호구는 그 호스트에 `vault_passphrase` 위임이 있을 때만(볼트가 잠겼으면 실패). 따뜻한 전송로에는 인증 없이 그대로 얹힌다.
    pub unattended: Option<Unattended>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Unattended {
    /// 부르는 쪽이 위임(`Delegation::vault_passphrase_granted`)을 본다.
    pub vault_passphrase: bool,
}

/// **동기**로 전송로 핸들러 안에서 불린다 — 잠금 잡고 값 대입 정도만(`.await` 없음). `None` = 정돈된 끝.
pub(crate) type DeathHook = Box<dyn Fn(Option<String>) + Send + Sync>;

/// "정확히 한 번" 은 `TransportSignal` 이 지킨다.
struct HookTarget(Option<DeathHook>);

impl ExitTarget for HookTarget {
    fn fire(&self, failure: Option<String>) {
        if let Some(hook) = &self.0 {
            hook(failure);
        }
    }
}

/// 공유 전송로에 꽂힌 **세션이 아닌** 자리 — 드롭도 놓는다.
pub(crate) struct SharedLease {
    /// 세션 id 와 같은 수열([`NEXT_ID`])이라 겹치지 않는다. 세션 표에는 없다.
    id: u32,
    pin: SharedPin,
    handle: SessionHandle,
    released: bool,
}

impl SharedLease {
    pub(crate) fn handle(&self) -> &SessionHandle {
        &self.handle
    }

    /// 얹힌 순간과 죽음이 엇갈렸으면 훅은 오지 않는다(명단에 오르기 전에 울렸다) — 그래서 이것을 따로 본다.
    pub(crate) fn is_dead(&self) -> bool {
        self.pin.signal.has_fired()
    }

    pub(crate) async fn release(mut self) {
        self.released = true;
        unpin_shared(&self.pin, self.id).await;
    }
}

impl Drop for SharedLease {
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

/// 세션을 만들지 않는다. 실패하면 아무것도 차지하지 않은 채 돌아간다(핀은 성공 뒤에야 꽂는다).
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
    // 물을 사람이 없는 열기 — 사람의 답은 버리고, 볼트의 키 암호구는 위임이 있을 때만(헤드리스 규칙).
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
    // 타일이 아닌 핀이다 — 정보 카드의 "공유 중인 다른 타일 수" 에서 빼고 "DB 연결 N" 으로 센다.
    TRANSPORTS.mark_pin(id);
    let pin = pin_session(&shared, &share_key, Arc::new(HookTarget(on_death)));
    Ok(SharedLease {
        id,
        pin,
        handle: Arc::clone(&shared.handle),
        released: false,
    })
}

/// 원격 새 워크트리를 준비한다(재료가 있을 때만) — 사람의 답을 기다리는 동안 공유 게이트를 놓는다(쥔 채 기다리면 같은 호스트의 다른 타일이 전부 줄을 선다).
/// 멈춤(`Cancelled`)이면 자리를 내놓고 `[cancelled]` — 포워딩 · 신호는 아직 켜지 않았으므로 그 둘은 거두지 않는다.
async fn prepare_remote_worktree<'g>(
    ctx: &OpenCtx<'_>,
    share_gate: &'g tokio::sync::Mutex<()>,
    coalesce: tokio::sync::MutexGuard<'g, ()>,
    tmux_name: Option<&str>,
    start: &mut Option<SshStart>,
) -> Result<tokio::sync::MutexGuard<'g, ()>, SshOpenError> {
    // 재접속 힌트가 왔으면 재료를 버린다 — 재료는 한 번만 쓰인다(재접속 · 복원 · 이관에서 다시 만들지 않는다).
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

/// 실패는 접속을 막지 않는다.
async fn compose_setup_script(ctx: &OpenCtx<'_>, start: &mut Option<SshStart>) {
    let alias = ctx.alias;
    // 스크립트를 서버 임시 파일에 먼저 써 두고 짧은 줄만 친다 — 긴 한 줄을 대화형 셸에 치면 에코 · 줄 편집기 다시 그리기로 수십 줄이 두 번 찍힌다.
    // 쓰지 못하면 긴 한 줄로 간다(스크립트는 로그에 남기지 않는다).
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

/// 원격 타일의 에이전트 신호를 세운다 — 토큰 → `-R` 포워드 → 첫 입력의 신호 환경. 반환은 (거둘 토큰 열쇠, 타일에 띄울 한 줄, 시작 명령 없는 타일의 신호 환경).
///
/// 신호 토큰은 **파이프 · GUI 를 지나지 않는다** — 값은 토큰 표 → 원격 서버의 파일(또는 폴백 export)로만 가고 로그에 남기지 않는다(→ docs/invariants.md 전문 11).
/// 포워드를 못 세우면 그 자리에서 토큰을 거두고, 그 뒤의 실패는 호출자가 거둔다. 원격 세션은 GUI 연결과 함께 죽지 않아 주인 연결이 없다(세션 자원 회수가 거둔다).
async fn arm_agent_signal(
    ctx: &OpenCtx<'_>,
    start: &mut Option<SshStart>,
    agent_stream: Option<&str>,
    tile_stream: &str,
    codex_no_daemon: bool,
    host: &HostAgent,
) -> (Option<(String, u64)>, Option<String>, Option<RemoteSignalEnv>) {
    let alias = ctx.alias;
    // 순서가 요점이다: 전송로 → **원격 포워드**(서버가 포트를 고른다) → 그 포트로 첫 입력을 짓는다.
    // 서버가 포워딩을 막으면 환경 없이 열고(점은 추정으로 돈다), 그 한 줄은 시작 명령이 있는 타일에만 띄운다(평범한 타일마다 서면 시끄럽다).
    let mut signal_key: Option<(String, u64)> = None;
    let mut signal_notice: Option<String> = None;
    let mut plain_signal: Option<RemoteSignalEnv> = None;
    let mut env: Option<RemoteSignalEnv> = None;
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
                    // 주소 · 토큰은 서버의 신호 파일로 — 셸에는 스트림 id 만 간다. 파일을 못 쓰면 export 로 폴백.
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
    // 신호를 세우지 않았어도 에이전트 활성화면 타일 파일(추가 인자 키만)과 스트림 id · PATH 를 셸에 — 비밀이 없다.
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

/// `sessions.toml` 읽기 실패는 접속을 막지 않는다(보강 계층).
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

/// 적지 않은 것이 끔 · 빠른 접속은 호스트 설정이 없는 대상이라 늘 끔.
pub(crate) fn agent_enabled(is_adhoc: bool, resolved: Option<bool>) -> bool {
    !is_adhoc && resolved.unwrap_or(false)
}

/// 프런트 `aiIconName`(`src/lib/pane-icons.ts`)과 같은 규칙 — 첫 낱말만 보는 [`crate::agent_args::agent_of_line`] 보다 너그럽다(`npx … claude-code` 도 받는다).
pub(crate) fn launches_ai(command: &str) -> bool {
    let s = command.trim().to_ascii_lowercase();
    s.contains("claude") || s.contains("codex")
}

/// 원격 타일의 에이전트 신호를 세울 스트림 — **판정 자리는 여기 하나**(사용자 결정 · 시험 `remote_signal_decision_has_one_seat`).
/// 앱이 AI 를 띄운 타일(빠른 접속도), 또는 에이전트 활성화가 켜진 호스트의 **모든** 타일. 신호 토큰은 그 타일의 상태 점만 바꾼다.
/// **호스트 AI 권한은 관여하지 않는다** · 프런트는 스트림 id 만 싣는다(→ docs/invariants.md 전문 11).
/// 알고 받은 한계: tmux 에 다시 붙으면 그 안에서 이미 돌던 에이전트는 신호 파일을 다시 읽지 않는 한 옛 토큰을 쥔 채라 신호가 끊긴다.
pub(crate) fn signal_stream(ai_launch: bool, agent_on: bool, stream: &str) -> Option<&str> {
    (ai_launch || agent_on).then_some(stream)
}

/// 손으로 고친 파일의 어긋난 줄은 버리고 로그 한 줄 — 접속을 막지 않는다.
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

/// 로컬 autorun 과 같은 규칙 — 설정 스크립트가 명령 자리를 감싸기 **전**에 건다(첫 낱말이 codex 여야 규칙이 선다).
/// tmux 타일은 셸 통합 감싸개가 없는 셸에서 명령을 돌리므로 이 자리가 유일한 길이다.
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

/// 에이전트 활성화 호스트에 원격 훅 · PATH 심을 심는다. 실패는 접속을 막지 않는다 · 헤드리스 위임 접속은 이 길을 지나지 않는다.
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

fn resolve_host_options(
    ctx: &OpenCtx<'_>,
    is_adhoc: bool,
    no_tmux: bool,
    force_tmux: bool,
    start: Option<&SshStart>,
    agent: bool,
) -> HostOptions {
    // sessions.toml 은 **보강** 계층이다 — 읽기 실패 · 문법 오류는 접속을 막지 않는다(경고는 `list_hosts` 가 이미 보여 준다).
    let (meta, _warnings) = crate::sessions_meta::SessionsMeta::load_default();
    let resolved = meta.resolve(ctx.alias);
    // **tmux 호스트는 첫 입력 한 줄을 통째로 쓴다** — `on_connect` 도 셸 통합 스니펫도 `exec tmux` 뒤에는 닿지 못한다.
    let use_tmux = use_tmux_for(resolved.tmux, no_tmux, force_tmux);
    let on_connect = if use_tmux {
        None
    } else {
        // 프로젝트의 첫 입력은 사용자 `on_connect` **뒤에** 붙는다 — `on_connect` 가 바꿔 둔 환경(`source .env` 등) 위에서 명령이 돈다.
        let user = resolved.on_connect.as_deref().and_then(prepare_on_connect);
        let project = start.and_then(project_start_line);
        match (user, project) {
            (None, None) => None,
            (Some(u), None) => Some(u),
            (None, Some(p)) => Some(p),
            (Some(u), Some(p)) => Some(format!("{u}{p}")),
        }
    };
    let logging = resolved.log.unwrap_or(false);
    // 셸 통합은 **적지 않은 것이 켬**이다(`log` 와 반대). tmux 호스트도 옵션이 켜져 있으면 서버 파일은 심는다 — 앱이 연 새 tmux 세션의 셸이 그 rc 로 뜬다.
    let integration_option = resolved.shell_integration.unwrap_or(true);
    let shell_integration = !use_tmux && integration_option;
    let prep = remote_prep(integration_option, use_tmux);
    // 에이전트 포워딩 — 빠른 접속은 켜는 자리가 없는 대상이라 언제나 끔이다(같은 이름의 호스트 블록이 있어도 빌려 쓰지 않는다).
    let forward_agent = !is_adhoc
        && crate::agent_forward::effective(ctx.params.forward_agent, resolved.forward_agent);
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemotePrep {
    /// 옵트아웃 — "이 서버엔 아무것도 심지 마라" 라 SFTP 채널조차 열지 않는다.
    Nothing,
    /// tmux 호스트 — 파일은 심되 첫 입력은 tmux 한 줄뿐이다.
    FilesOnly,
    Full,
}

pub(crate) fn remote_prep(integration_option: bool, use_tmux: bool) -> RemotePrep {
    match (integration_option, use_tmux) {
        (false, _) => RemotePrep::Nothing,
        (true, true) => RemotePrep::FilesOnly,
        (true, false) => RemotePrep::Full,
    }
}

/// 실패는 한 단계씩 옛 경로로 물러날 뿐 접속을 막지 않는다.
async fn plan_bootstrap(
    ctx: &OpenCtx<'_>,
    host: &HostOptions,
) -> crate::shell_integration::BootstrapPlan {
    let alias = ctx.alias;
    let handle = ctx.handle;
    let shell_integration = host.shell_integration;
    // 서버 쪽 준비는 **셸을 열기 전에** 끝낸다 — 뒤늦게 심으면 첫 프롬프트는 이미 훅 없이 그려진 뒤고, 심는 명령이 `~/.bash_history` 에 남는다.
    let setup = match host.prep {
        RemotePrep::Nothing => {
            eprintln!(
                "셸 통합: {alias} 는 옵트아웃(shell_integration = false) — 아무것도 심지 않습니다"
            );
            crate::shell_integration::RemoteSetup::Failed
        }
        // 첫 입력 전에 끝나므로 새 tmux 세션의 셸은 새 rc 를 읽는다.
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
    // 로그인 셸이 bash 인지는 **앱이 먼저 묻는다** — 런처 안의 `$SHELL` 판정에만 맡기면 zsh · fish 서버가 훅을 잃는다(앱이 타이핑 부트스트랩을 건너뛴다).
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

/// 채널 요청 순서: 세션 채널 → PTY → (에이전트 포워딩) → 셸/런처. 나머지 정리는 호출자의 실패 꼬리가 한다.
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
            // 얹혀 붙던 전송로가 채널을 안 열어 준다 = 사실상 죽었다 — 빼 두지 않으면 다음 타일도 같은 막다른 길로 간다
            // (`Handler::disconnected` 훅이 치우기 전의 틈).
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
    // ── 에이전트 포워딩 — PTY 뒤 · 셸 앞(OpenSSH 와 같은 자리) ──
    // 장부에 **먼저** 적고 청한다 — 서버는 셸이 뜨자마자 채널을 열 수 있다. 서버의 답은 이 채널의 둘째 답으로 온다(`agent_forward::REQUEST_INDEX`).
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
    if plan == crate::shell_integration::BootstrapPlan::Exec {
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

/// 실패 경로가 없다(로그를 못 열면 tee 없이 간다).
fn start_output(
    ctx: &OpenCtx<'_>,
    agent_notice: Option<&str>,
    signal_notice: Option<&str>,
    logging: bool,
) -> (OutputPipe, PumpFeed) {
    let params = ctx.params;
    // 슬롯에는 **아직 싱크가 없다** — 출력 프레임의 머리에 임대 열쇠가 실려야 해서 표에 올린 뒤 부른 쪽이 꽂는다.
    let (tx, rx) = mpsc::channel::<Chunk>();
    let output = crate::output::output_slot(None);
    let stats = Arc::new(OutputStats::default());
    crate::output::spawn_batcher(rx, Arc::clone(&output), Arc::clone(&stats));

    // ── 보안 완화 알림 ──
    // 펌프 · on_connect 보다 먼저 써야 반드시 화면 맨 위에 선다. 검증 여부는 홉 중 가장 약한 고리로 판단한다.
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

    // ── 세션 로깅(기본 꺼짐) ──
    // 송신자는 펌프 태스크가 소유한다 — 태스크가 끝나 떨어질 때 쓰기 스레드가 flush 하고 파일을 닫는다.
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

/// 첫 입력으로 타이핑하는 **우리 줄**의 에코를 지울 필터들(순서대로 이어 먹인다).
/// 신호 줄은 필터 **둘** — 터미널 드라이버가 한 번 에코하고 줄 편집기(readline · ZLE)가 첫 프롬프트 뒤에 다시 그린다. 둘째가 안 오는 셸이면 예산을 다 쓰고 꺼진다.
/// **사용자의 `on_connect` 는 여기 없다** — 자기가 적은 명령은 자기 화면에 보여야 한다.
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

/// 끝나면 `ssh-exit` 를 **정확히 한 번** 쏜다.
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
    // 에코 필터는 우리 줄을 보내기 **전부터** 서 있어야 첫 바이트를 놓치지 않는다.
    tokio::spawn(async move {
        // 요청 답의 수 — 에이전트 요청의 답을 순번으로 가려낸다.
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
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    // 역압 — 멈춘 동안 `reader.wait()` 를 부르지 않아 채널 윈도우가 소진되면 서버가 전송을 멈춘다.
                    // 블로킹이 아니라 async 대기여야 한다 — 워커 스레드를 물면 같은 런타임의 keepalive · 다른 세션까지 굶는다.
                    pump_gate.wait_async().await;
                    // 로그는 **배칭 전 · 역압 뒤**에 뜬다 — 청크 경계까지 그대로 남고, 수문이 닫힌 동안 로그만 앞서 나가지 않는다.
                    if let Some(log) = &log_tx {
                        let _ = log.send(data.to_vec());
                    }
                    // 에코 지우기는 **로그 tee 뒤 · 배칭 앞**이다 — 로그는 서버가 보낸 그대로여야 하고, 배치는 청크 경계를 지운다.
                    let mut out = data.to_vec();
                    for f in &mut echo {
                        out = f.feed(&out);
                    }
                    echo.retain(|f| !f.is_done());
                    if out.is_empty() {
                        continue;
                    }
                    if tx.send(Chunk::Data(out)).is_err() {
                        break;
                    }
                }
                // 기록만 해 두고 루프는 계속 돈다(뒤이어 Close 가 와야 끝난다).
                ChannelMsg::ExitStatus { exit_status } => {
                    exit.note_shell_exit(ShellExit::Status(exit_status));
                }
                ChannelMsg::ExitSignal { signal_name, .. } => {
                    exit.note_shell_exit(ShellExit::Signal(format!("{signal_name:?}")));
                }
                // 일부 sshd 는 `exit-status` 를 안 보내거나 **Eof 뒤에** 보낸다 — Eof 에서는 끊지 않고 Close 까지 읽어 늦은 status 를 줍는다.
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
        // 이 앱이 닫았다 — 읽기 쪽이 먼저 끝났어도(전송로까지 끊었다) 정돈된 종료다.
        if closing.load(Ordering::SeqCst) {
            exit.note_shell_exit(ShellExit::Closed);
        }
        // 펌프는 전송 계층 사유를 모른다 — 끊김이면 보통 `disconnected` 가 먼저 더 구체적인 문구로 쏜 뒤다.
        exit.fire(None);
    });
}

/// 이 앱이 채널을 닫았으면 `None` — 러시 0.63.1 은 우리가 먼저 보낸 `CHANNEL_CLOSE` 의 답을 읽기 쪽에 넘기지 않아,
/// 공유 전송로에서는 `reader.wait()` 가 전송로가 살아 있는 한 영영 안 끝난다(펌프가 남아 로그가 flush 되지 않는다).
/// `biased` — 이미 쌓인 메시지를 **먼저** 다 읽은 뒤에야 닫힘을 본다(로그가 닫기 직전 출력까지 담는다).
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

/// 힌트, 아니면 이 앱도 서버도 쓰지 않는 가장 작은 `aynx-N` 과 `-D` 여부.
async fn choose_tmux_name(
    ctx: &OpenCtx<'_>,
    sessions: &SshSessions,
    tmux_name: Option<&str>,
    use_tmux: bool,
) -> Option<(String, bool)> {
    // 알고 받은 경쟁: 같은 호스트에 두 타일을 동시에 열면 같은 번호를 고를 수 있다 — 결과는 같은 tmux 세션을 함께 보는 것이라
    // 눈에 보이고 되돌릴 수 있어, 겪기 전에 직렬화 잠금을 세우지 않는다(CLAUDE.md "방어 기계를 미리 늘리지 않는다").
    if !use_tmux {
        return None;
    }
    // 힌트는 프런트를 한 바퀴 돌고 온 문자열이라 셸에 넣기 전에 잠근다.
    let hint = tmux_name.and_then(safe_tmux_target);
    // 새 타일은 서버에 남은 세션 이름도 피한다([`pick_new_tmux_name`]). 앱 장부(`taken`)는 **이 await 뒤에** 읽는다 — 경쟁 창을 좁게 둔다.
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
    let taken: Vec<String> = sessions
        .0
        .lock()
        .unwrap()
        .values()
        .filter(|s| s.alias.eq_ignore_ascii_case(ctx.alias))
        .filter_map(|s| s.tmux.clone())
        .collect();
    Some(match hint {
        Some(h) => (h.to_string(), kick_stale_for_hint(h, &taken)),
        None => (pick_new_tmux_name(&taken, &on_server), false),
    })
}

/// 프롬프트를 기다리지 않는다 — PTY 입력 큐에 쌓였다가 셸이 준비되는 대로 읽는다. 실패해도 세션은 이미 열려 있다(스니펫 없는 세션이 될 뿐).
/// exec 경로에는 우리 줄이 없다 — 훅은 시작 파일이 이미 걸었고 사용자 `on_connect` 가 언제나 마지막이다.
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
    // 런처를 못 탄 신호 줄은 사용자 `on_connect` **앞에** 선다 — 그 뒤의 명령과 이 셸에서 띄울 에이전트가 물려받는다.
    let joined = typed_signal.map(|line| format!("{line}{}", on_connect.unwrap_or("")));
    let on_connect = joined.as_deref().or(on_connect);
    let bootstrap = if let Some((name, kick)) = chosen_tmux {
        match start {
            Some(st) => format!("{}\r", tmux_attach_command_with_start(name, *kick, st)),
            // 시작 명령 없는 타일 — 신호 환경이 있으면 그 환경으로 새 세션의 셸을 띄운다.
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
            // 조립 실패(스니펫에 heredoc 종료 표식이 든 사고)여도 접속은 막지 않고 `on_connect` 만 보낸다.
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

/// 세션 코어 등록(새 회차 · 첫 임대) → 표 삽입 순서. 창의 generation 검사는 GUI 가 답을 받은 뒤에 한다(늦었으면 곧바로 `close`).
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
        tmux: chosen_tmux.as_ref().map(|(name, _)| name.clone()),
        log_path: log_file,
        // 얹혀 붙은 세션도 전송로를 세운 그 인증을 보고한다 — 다른 것은 `joined` 한 칸뿐이다.
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
