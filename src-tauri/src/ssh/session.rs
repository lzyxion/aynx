//! 세션 표 — [`SshSessions`]/[`SshSession`] · 연결 공유 풀([`TRANSPORTS`] · [`unpin_shared`]) ·
//! 표를 읽는 조각 함수(`handle_of`·`attach_parts`·`stats_of` …) · 셸 채널 조작([`write`] · [`resize`] · [`session_info`] ·
//! [`release_ssh`]) · 종료 마감([`finish_exit`]).
//!
//! **③-3b2 부터 이 표는 세션 서버 프로세스에 산다**([`table`] — 전역 한 벌). 예전의 Tauri 명령(`write_ssh`·`resize_ssh`·
//! `pause/resume_ssh_output`·`close_ssh`·`session_info`)은 서버 op 가 됐다(`server::sessions` — 쓰기·크기·닫기는 로컬과 같은
//! kind 무관 op, 역압은 ACK 크레딧). GUI 의 표는 비어 있다 — GUI 가 원격에 닿는 길은 서버 op(`ssh_exec` · 채널 터널)뿐이다.
//!
//! 불변식:
//! - 표의 잠금은 `await` 전에 반드시 푼다(조각 함수로 나눈 이유).
//! - **이 표는 자원만 쥔다**(셸 채널·전송로 자리·포워드·SFTP·신호 토큰·로그). 대화형 타일의 표·임대·종료 장부
//!   (누가 붙어 있나 · 회차 · 떨어짐/끝남/끊김)는 [`crate::session_core`] 다 — 옛 `owner` 라벨도 거기 `Entry::home`
//!   으로 옮겼다(2026-10-08 ②-2). write·resize·pause·resume·close 는 임대 열쇠 `(stream, session_epoch, lease_epoch)`
//!   를 받아 코어에 먼저 묻는다(옛 임대면 `[stale-lease]`). 헤드리스 위임 세션은 코어에 오르지 않는다(창이 없다).
//! - **종료는 Rust 가 마감한다**([`finish_exit`]) — 채널 exit/close·전송로 끊김에 마지막 배치 뒤 코어에 `Exited`/
//!   `Disconnected` 를 적고, `ssh-exit` 를 쏜 뒤 자원을 회수한다([`release_ssh`]). 떨어진 채 끝났으면 표에서도 곧바로 빠진다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use russh::client::{Handle, Msg};
use russh::{ChannelWriteHalf, Disconnect};

use crate::output::{Chunk, Gate, OutputSlot, OutputStats};
use crate::session_core::{core, End, Kind};
use crate::ssh_pool::{ExitToken, TransportPool, TransportSignal};

use super::*;

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

/// 열려 있는 세션의 러시 핸들.
///
/// [`crate::port_forward`] 가 이 핸들로 direct-tcpip 채널을 연다 — 포워드는 세션이
/// 살아 있는 동안만 유효하므로 `Arc` 를 복제해 들고 있어도 세션 수명이 늘어나지 않는다
/// (맵에서 지워지고 `disconnect` 가 불리면 그 위의 채널도 함께 죽는다).
pub(crate) type SessionHandle = Arc<Handle<SshHandler>>;

/// 대화형 셸 채널에 딸린 조각들 — **헤드리스 세션에는 없다**(`None`).
///
/// 헤드리스 접속([`open_headless_session`](crate::headless::open_headless_session))은 `request_pty`·`request_shell` 을 하지 않으므로
/// 쓰기 채널도, 출력 배칭도, 웹뷰 슬롯도 없다. 그 넷을 한 묶음으로 옵션화해, 셸 없는 세션도
/// 같은 [`SshSessions`] 표에 1급으로 산다(핸들은 실행 브로커가 `handle_of` 로 그대로 집는다).
pub(crate) struct ShellPipe {
    /// 셸 채널의 쓰기 쪽. 읽기 쪽은 펌프 태스크가 가져갔다.
    pub(super) writer: Arc<ChannelWriteHalf<Msg>>,
    /// 출력 수문 ([`crate::output::Gate`]). 펌프 태스크가 같은 것을 들고 async 대기한다.
    pub(super) gate: Arc<Gate>,
    /// 지금 이 세션의 출력을 받는 웹뷰 채널 ([`crate::output::OutputSlot`]).
    /// 탭을 다른 창으로 옮기면 여기만 갈아 끼운다 (docs/log/2026-09-02-tear-out.md).
    pub(super) output: OutputSlot,
    /// 이 세션이 웹뷰로 내보낸 양 — 진단 전용 ([`crate::output::OutputStats`] · `session_stats`).
    /// 로컬 세션의 같은 이름 필드와 뜻이 같다 (계수기는 공용 배처에 얹혀 있다).
    pub(super) stats: Arc<OutputStats>,
    /// **이 앱이 셸 채널을 닫았다**는 종 — `close_ssh` 가 울리고 펌프가 듣는다
    /// ([`super::open::until_closed`]: 러시가 서버의 닫힘 답을 읽기 쪽에 넘기지 않는다).
    pub(super) closed: Arc<tokio::sync::Notify>,
    /// 이 앱이 닫는 중 — 펌프가 끝을 정돈된 종료(`exit`)로 적어 살아 있는 타일이 자동 재접속을 돌지 않게 한다(③-3b2 — 서버의
    /// [모든 세션 종료] 가 붙은 타일의 SSH 도 닫는다).
    pub(super) closing: Arc<std::sync::atomic::AtomicBool>,
    /// 배처로 가는 **표식 입구** — 종료 마감([`finish_exit`])이 마지막 배치를 배처 뒤로 정렬해 최종 오프셋을 받는다
    /// (`crate::output::flush_mark` — 로컬 `spawn_exit_watch` 와 같은 길). 표에서 빠질 때 함께 떨어진다.
    pub(super) mark: std::sync::Mutex<std::sync::mpsc::Sender<Chunk>>,
}

pub struct SshSession {
    /// 세션을 살려 두는 핸들. 맵에서 지워지면 세션도 정리된다.
    pub(crate) handle: SessionHandle,
    /// 점프 호스트의 핸들 (ProxyJump 를 쓴 세션만). **대상 세션의 전송로가 이 핸들의
    /// direct-tcpip 채널 위에 얹혀 있으므로 반드시 함께 살려 둬야 한다** —
    /// 이것이 떨어지면 점프 세션이 정리되고, 그 위의 채널도 닫히며, 대상 세션은
    /// 전송로가 사라져 `Handler::disconnected` 경로로 `ssh-exit{reason:"error"}` 를
    /// 낸다 (= 프런트가 자동 재연결을 돌리는 기존 경로 그대로다).
    pub(crate) jump: Option<Arc<Handle<SshHandler>>>,
    /// 대화형 셸 채널 조각들 — 헤드리스 세션이면 `None`([`ShellPipe`]).
    pub(crate) shell: Option<ShellPipe>,
    /// 이 세션이 탄 전송로의 번호 ([`SshHandler::transport_id`]) — 원격 포워드(-R)가 길잡이
    /// 표에 적는 열쇠다 ([`transport_of`]).
    pub(crate) transport_id: u64,
    /// **이 세션이 공유 전송로에 꽂힌 자리** ([`SharedPin`]). `None` 이면 풀 밖의 세션이라
    /// (헤드리스 위임) 닫을 때 자기 전송로를 그냥 끊는다 — 오늘까지의 동작 그대로다.
    pub(crate) shared: Option<SharedPin>,
    /// **이미 서 있던 전송로에 얹혔다** (내가 세운 것이 아니다). `info` 의 인증 한 벌은
    /// 그 전송로를 세운 세션의 것이므로, 말풍선이 "(공유 연결)" 한 마디를 앞에 붙인다.
    pub(crate) joined: bool,
    /// **이 세션이 에이전트 포워딩을 청했다** (호스트 설정이 켰다). 말풍선 한 마디와, 닫을 때
    /// 전송로의 포워딩 장부에서 빼는 일([`crate::agent_forward::disable`])에 쓴다.
    /// 헤드리스 위임 세션은 언제나 `false` 다.
    pub(crate) agent_forward: bool,
    /// 원격 AI 타일이 받은 **신호 전용 토큰**의 열쇠(스트림 · 주인 번호) — 닫을 때 거둔다
    /// ([`crate::agent_signal::revoke`]). 토큰 값은 여기 남기지 않는다.
    pub(crate) signal: Option<(String, u64)>,
    // (옛 `owner` 라벨·`owner_kind` 는 2026-10-08 ②-2 에 걷었다 — 창 타일의 "어느 창" 은 세션 코어의 `Entry::home`
    //  이 쥐고, 헤드리스 위임 세션은 코어에 오르지 않는 것으로 갈린다.)
    /// 이 세션이 붙은 호스트 별칭 — **tmux 이름 장부의 열쇠**([`tmux`](Self::tmux)).
    pub(crate) alias: String,
    /// **이 세션이 물고 있는 tmux 세션 이름**(`aynx-1` …). tmux 로 붙지 않았으면 `None`.
    ///
    /// 이름 장부가 이 표인 이유는 하나다 — 세션은 **앱 전역**이라 창을 가리지 않는다.
    /// 다른 창에서 같은 호스트에 새 타일을 열어도 여기 적힌 이름은 보이므로, 두 타일이
    /// 같은 tmux 세션에 붙어 서로의 화면을 흔드는 일이 없다([`pick_tmux_name`]).
    pub(crate) tmux: Option<String>,
    /// **이 세션이 쓰고 있는 세션 로그 파일** (`[hosts.<별칭>] log = true` 인 호스트만).
    /// 로깅이 꺼져 있거나 파일을 열지 못했으면 `None` — 그때는 타일 메뉴의
    /// "세션 로그 열기" 가 흐려진다 ([`crate::session_log::session_log_path`]).
    ///
    /// 경로 문자열 한 칸이라 tee 경로에는 아무 비용도 없다. 쓰기 스레드의 수명은 여전히
    /// 펌프 태스크가 쥔 송신자가 정한다 — 이 값은 **어디에 쓰고 있는가**만 말한다.
    pub(crate) log_path: Option<String>,
    /// **접속 상태 표시**가 읽는 한 벌 ([`session_info`] · docs/log/2026-09-17-connect-diagnostics.md).
    ///
    /// 전부 **접속하는 순간 이미 알고 있던 값**이라 여기 적는 데 드는 비용이 없다. 세션이
    /// 살아 있는 동안 바뀌지 않으므로 갱신 경로도 없다(바뀌는 것은 RTT 하나뿐이고 그것은
    /// 물을 때마다 잰다).
    pub(crate) info: ConnectedAs,
}

/// 세션 하나가 **어떻게 붙어 있는가** — 표에 적혀 [`session_info`] 로 나간다.
///
/// 여기에 **비밀번호는 없다.** `identity` 는 에이전트가 키에 붙여 둔 설명 한 줄이고
/// (`ssh-add -l` 이 보여 주는 것과 같다), 키 바이트는 예나 지금이나 앱에 들어오지 않는다.
pub(crate) struct ConnectedAs {
    /// 서버 배너(`OpenSSH_9.6p1 …`). 읽지 못했으면 `None`.
    pub(crate) server_version: Option<String>,
    pub(crate) method: AuthMethod,
    pub(crate) identity: Option<String>,
    /// 그 키 파일을 **금고에 담긴 암호구로** 열었는가 (`identity` 의 출처 한 칸).
    pub(crate) identity_stored: bool,
    /// 경유 호스트 별칭 (`ProxyJump`). 직접 접속이면 `None`.
    pub(crate) jump: Option<String>,
    /// 접속한 시각 (Unix epoch 밀리초) — 화면이 "접속 12분 전" 을 만든다.
    pub(crate) connected_at_ms: u64,
    /// 이 세션의 `ServerAliveInterval` (0 = 안 보냄이면 `None`).
    pub(crate) keepalive_secs: Option<u64>,
}

/// 지금 시각 (Unix epoch 밀리초). 시계가 1970 이전이면 0 — 표시 전용이라 실패가 없다.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Default)]
pub struct SshSessions(pub Mutex<HashMap<u32, SshSession>>);

/// 이 프로세스의 SSH 세션 표 — **세션 서버에서만 채워진다**(③-3b2). 예전 Tauri 관리 상태(`tauri::State<SshSessions>`)를
/// 전역 한 벌로 바꿨다: 서버에는 Tauri 가 없고, 표는 예나 지금이나 앱(프로세스) 전역이다.
static SSH: LazyLock<SshSessions> = LazyLock::new(SshSessions::default);

/// 세션 표.
pub(crate) fn table() -> &'static SshSessions {
    &SSH
}

// ---------------------------------------------------------------------------
// 연결 공유 (docs/log/2026-09-23-ssh-connection-sharing.md)
// ---------------------------------------------------------------------------

/// 여러 세션이 함께 타는 **전송로 한 벌**. 풀([`TRANSPORTS`])에 이 모양으로 산다.
///
/// 전부 복제가 싼 값(`Arc` · 짧은 문자열)이라 `Clone` 이다 — 풀에서 꺼낼 때 잠금을
/// 문장 하나 안에서 끝내려면 참조가 아니라 값이 나와야 한다.
#[derive(Clone)]
pub(crate) struct SharedTransport {
    pub(super) handle: SessionHandle,
    /// 이 전송로의 번호 ([`SshHandler::transport_id`]) — 얹혀 붙은 세션도 같은 번호를 받는다.
    pub(super) transport_id: u64,
    pub(super) jump: Option<Arc<Handle<SshHandler>>>,
    /// 이 전송로의 죽음을 올라탄 세션 전부에 뿌리는 신호. 새 세션은 여기에 자기
    /// `ExitSignal` 을 얹는다([`TransportSignal::join`]).
    pub(super) signal: Arc<TransportSignal>,
    /// **이 전송로를 실제로 인증한 한 벌.** 나중에 얹힌 세션도 이 값을 그대로 보고한다 —
    /// 그 세션을 서버에 들여보낸 것이 바로 이 인증이기 때문이다(말풍선은 그 사실에
    /// `joined` 한 칸을 덧붙여 "이건 공유 연결" 이라고 말한다).
    pub(super) server_version: Option<String>,
    pub(super) method: AuthMethod,
    pub(super) identity: Option<String>,
    pub(super) identity_stored: bool,
    pub(super) jump_label: Option<String>,
    pub(super) keepalive_secs: Option<u64>,
}

/// 세션 하나가 **공유 전송로에 꽂혀 있는 자리** — 놓을 때 빼야 할 것 둘.
#[derive(Clone)]
pub(crate) struct SharedPin {
    /// 풀의 열쇠 ([`transport_key`]).
    pub(super) key: String,
    pub(super) signal: Arc<TransportSignal>,
    /// 이 세션이 `signal` 안에서 차지한 자리 ([`TransportSignal::leave`] 의 인자).
    pub(super) token: ExitToken,
}

/// 살아 있는 전송로 장부. **앱 전역**이다 — 전송로는 창의 것이 아니라 앱의 것이고
/// (탭은 창 사이를 건너다닌다), 그래서 `close_ssh`·`reap`·헤드리스 종료의 시그니처가
/// 한 칸도 안 늘었다. `vault.rs`·`port_forward.rs` 의 전역과 같은 자리다.
pub(crate) static TRANSPORTS: LazyLock<TransportPool<SharedTransport>> =
    LazyLock::new(TransportPool::new);

/// 풀의 열쇠를 만든다 — **순수 함수** (유닛 테스트 대상).
///
/// ## 규칙: **설정 호스트는 별칭, 빠른 접속은 `user@host:port`**
///
/// 같은 서버를 가리키는 별칭 둘(`web-01` 과 `web-01-admin`)을 합치지 **않는다**. 합치려면
/// "두 블록의 설정이 같다" 를 증명해야 하는데, ssh config 에는 우리가 읽지 않는 줄이
/// 얼마든지 있고(`SetEnv`·`RemoteCommand`·`RequestTTY`…) 그중 하나라도 다르면 합친
/// 연결은 **사용자가 적어 둔 것과 다르게 동작한다.** 반대 방향의 손해는 "연결이 하나 더
/// 선다" 뿐이라, 애매하면 나누는 쪽을 고른다. 빠른 접속(`adhoc`)에는 블록 자체가 없으므로
/// 그 자리를 `user@host:port` 가 대신한다 — 같은 곳을 두 번 치면 그 둘은 합쳐진다.
///
/// 별칭만으로는 부족한 자리가 하나 있다: 앱이 도는 중에 `~/.ssh/config` 를 고치면 **같은
/// 별칭이 다른 서버**를 가리킨다. 그래서 해석된 결과(`user@host:port` · 경유 체인 ·
/// `IdentitiesOnly` · `IdentityFile`)를 열쇠에 함께 굽는다 — 별칭보다 좁아지기만 할 뿐이라
/// 위 규칙을 깨지 않는다.
///
/// 구분자는 `\x1f`(Unit Separator)다. 사용자가 적을 수 있는 글자(`@`·`:`·공백)로 이으면
/// 서로 다른 조합이 같은 문자열이 될 수 있다.
pub(crate) fn transport_key(params: &ConnectParams, alias: &str, adhoc: bool) -> String {
    const SEP: char = '\x1f';
    // 별칭은 config 매칭과 같은 규칙으로 대소문자를 무시한다 (`resolve_params`).
    let name = if adhoc {
        String::new()
    } else {
        alias.to_ascii_lowercase()
    };
    let jump = params
        .jump
        .as_ref()
        .map(|j| format!("{}@{}:{}", j.user, j.host, j.port))
        .unwrap_or_default();
    format!(
        "{name}{SEP}{}@{}:{}{SEP}{jump}{SEP}{}{SEP}{}",
        params.user,
        params.host,
        params.port,
        params.identities_only,
        params.identity_file.as_deref().unwrap_or("")
    )
}

pub(crate) static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// 세션 id 의 바탕을 정한다 — 세션 서버가 뜰 때 한 번(`serve::run`). 서버가 다시 떠도 GUI 가 쥔 옛 id(타일·SFTP 캐시·
/// 포워드 목록)와 겹치지 않게 시각에서 뽑는다(로컬 `pty::seed_ids` 와 같은 규칙).
pub(crate) fn seed_ids(base: u32) {
    NEXT_ID.store(base.max(1), Ordering::Relaxed);
}

/// 다음에 발급될 세션 id — [`crate::reap`] 의 기준선 (로컬 쪽 `next_id` 와 같은 역할).
pub(crate) fn next_id() -> u32 {
    NEXT_ID.load(Ordering::Relaxed)
}

/// 세션 하나를 공유 전송로에서 **내린다** — 이 파일에서 전송로를 끊는 자리는 여기 하나다.
///
/// 하는 일 둘: ① 전송로의 종료 명단에서 이 세션을 뺀다(닫힌 타일이 남의 끊김을 받지
/// 않는다) ② 풀의 사용자 장부에서 빼고, **마지막 사용자였을 때만** 전송로와 경유를 끊는다.
/// 남은 타일이 있으면 아무것도 끊지 않는다 — 이 기능의 전부가 그 한 줄이다.
///
/// 점프를 대상 **뒤에** 끊는 순서는 예전 그대로다 (대상의 작별 인사가 아직 그 통로를 타고
/// 나가야 한다 — docs/log/2026-09-01-jump-host.md).
pub(super) async fn unpin_shared(pin: &SharedPin, id: u32) {
    pin.signal.leave(pin.token);
    let Some(last) = TRANSPORTS.release(&pin.key, id) else {
        return;
    };
    let _ = last
        .handle
        .disconnect(Disconnect::ByApplication, "closed by user", "en")
        .await;
    if let Some(jump) = &last.jump {
        let _ = jump
            .disconnect(Disconnect::ByApplication, "closed by user", "en")
            .await;
    }
}

/// 맵에서 세션 조각을 꺼내 온다. `await` 전에 잠금을 반드시 풀어야 하므로 분리했다.
fn writer_of(
    state: &SshSessions,
    id: u32,
) -> Result<Arc<ChannelWriteHalf<Msg>>, String> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        // 헤드리스 세션은 셸 채널이 없다(`shell == None`) — 쓸 대상이 없으므로 없는 세션과 같다.
        .and_then(|s| s.shell.as_ref())
        .map(|sh| Arc::clone(&sh.writer))
        .ok_or_else(|| "no such ssh session".to_string())
}

/// 창 이관에 필요한 세 조각 — 출력 슬롯 · 수문 · 쓰기 쪽(창 크기 통보용). 없으면 `None`.
/// `writer_of` 와 같은 이유로 분리했다 — 잠금을 `await` 전에 반드시 풀어야 한다.
pub(crate) fn attach_parts(
    state: &SshSessions,
    id: u32,
) -> Option<(OutputSlot, Arc<Gate>, Arc<ChannelWriteHalf<Msg>>)> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        // 이관은 타일이 붙은 셸 세션에만 뜻이 있다 — 헤드리스는 붙일 웹뷰가 없다.
        .and_then(|s| s.shell.as_ref())
        .map(|sh| {
            (
                Arc::clone(&sh.output),
                Arc::clone(&sh.gate),
                Arc::clone(&sh.writer),
            )
        })
}

/// 떨어진 세션 목록(③-4)의 메타 — 호스트 별칭 · tmux 세션 이름 · 마지막 출력 시각. 셸 채널이 없으면(헤드리스) `None`.
pub(crate) fn detached_meta_of(id: u32) -> Option<(String, Option<String>, Option<u64>)> {
    let row = table()
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|s| s.shell.as_ref().map(|sh| (s.alias.clone(), s.tmux.clone(), Arc::clone(&sh.output))));
    row.map(|(alias, tmux, slot)| (alias, tmux, crate::output::last_output_ms(&slot)))
}

/// 세션 하나의 출력 계수기를 꺼내 온다 (`crate::session_commands::session_stats` 가 쓴다).
/// 잠금은 이 함수 안에서 끝난다.
/// 이 세션이 쓰고 있는 세션 로그 파일 ([`SshSession::log_path`]). 잠금은 이 함수 안에서 끝난다.
pub(crate) fn log_path_of(state: &SshSessions, id: u32) -> Option<String> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|s| s.log_path.clone())
}

pub(crate) fn stats_of(state: &SshSessions, id: u32) -> Option<Arc<OutputStats>> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .and_then(|s| s.shell.as_ref())
        .map(|sh| Arc::clone(&sh.stats))
}

// ---------------------------------------------------------------------------
// 연결 상태 (docs/log/2026-09-17-connect-diagnostics.md)
// ---------------------------------------------------------------------------

/// **이 세션이 어떻게 붙어 있는가** — 머리줄 이름의 말풍선 한 장이 읽는 전부.
///
/// ## 여기 **없는** 것과 그 이유
///
/// - **비밀번호·키 바이트**: 앱이 애초에 들고 있지 않다. `identity` 는 에이전트가 키에
///   붙여 둔 설명 한 줄이다(`ssh-add -l` 의 그 글자).
/// - **`last_keepalive_ok_ms`**: 러시가 자동으로 보내는 keepalive 는 **응답을 버린다**
///   (`GlobalRequestResponse::Keepalive` = "ignore result"). 훅이 없으므로 싸게 알 길이
///   없다. 대신 [`SessionInfo::rtt_ms`] 가 **물을 때 한 번** 같은 요청
///   (`keepalive@openssh.com`, want_reply)을 직접 보내 왕복을 잰다 — 그 값이 성공했다는
///   것 자체가 "지금 이 순간 keepalive 가 오간다" 는 증거라 필드 둘을 둘 이유가 없었다.
/// - **user/host/port**: 화면이 이미 호스트 항목에서 안다(머리줄 말풍선 첫 줄). 같은 사실을
///   두 곳에서 만들면 둘이 어긋난다.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionInfo {
    /// 서버 배너 (`OpenSSH_9.6p1 Ubuntu-3ubuntu13.5`). 못 읽었으면 빈 문자열.
    pub server_version: String,
    pub auth_method: AuthMethod,
    pub identity: Option<String>,
    /// 그 키 파일을 **금고에 담긴 암호구로** 열었는가 — 말풍선이 "(저장됨)" 을 덧붙인다.
    pub identity_stored: bool,
    pub jump: Option<String>,
    pub connected_at_ms: u64,
    pub keepalive_secs: Option<u64>,
    /// 방금 잰 왕복 시간 (밀리초). 못 쟀으면 `None` — 값이 없는 것과 0 은 다르다.
    pub rtt_ms: Option<u64>,
    /// **같은 연결을 쓰는 다른 타일 수** (혼자면 0) — 연결 공유
    /// (docs/log/2026-09-23-ssh-connection-sharing.md). 지금 이 순간의 값이라 세션 표가
    /// 아니라 전송로 장부에서 센다.
    pub shared_with: u32,
    /// 같은 전송로를 빌린 **쿼리 타일의 DB 연결 수**(떼어 둔 것 · 비밀번호를 묻는 동안 세워 둔 것 포함) — 타일이 아니라
    /// [`shared_with`](Self::shared_with) 에서 뺐다(9단계). 0 이면 카드에 줄이 없다.
    pub db_conns: u32,
    /// **이미 서 있던 연결에 얹혔다.** 위의 `auth_method`·`identity` 는 그 연결을 세운
    /// 인증이라, 말풍선이 그 줄 앞에 "(공유 연결)" 한 마디를 붙인다.
    pub joined: bool,
    /// **이 세션이 에이전트 포워딩을 청했다** — 말풍선이 "에이전트 포워딩 켬" 을 단다.
    /// 서버가 거절했어도 참이다(그 사실은 터미널에 이미 한 줄이 떴다).
    pub agent_forward: bool,
}

/// RTT 를 재는 데 기다리는 최대 시간. 넘으면 `rtt_ms = None` 이고 **오류가 아니다** —
/// 말풍선 한 줄 때문에 사용자를 기다리게 하지 않는다.
const RTT_TIMEOUT_MS: u64 = 1500;

/// 세션 하나의 연결 상태를 돌려준다 — 세션 서버 op `ssh_info`(읽기)의 몸(GUI 의 같은 이름 Tauri 명령이 프록시다).
///
/// RTT 를 재려고 서버와 한 번 왕복한다. 잠금은 표에서 값을 복사해 나오는 문장 하나에서 끝나고(`ssh::attach_parts` 와
/// 같은 규칙), 왕복은 그 밖에서 일어난다.
pub(crate) async fn session_info(id: u32) -> Result<SessionInfo, String> {
    let state = table();
    // 잠금 안에서는 복사만 한다 — 아래 `await` 까지 들고 가면 그 세션의 출력·입력이 함께 선다.
    let (
        handle,
        server_version,
        method,
        identity,
        identity_stored,
        jump,
        connected_at_ms,
        keepalive_secs,
        share_key,
        joined,
        agent_forward,
    ) = {
        let map = state.0.lock().unwrap();
        let s = map.get(&id).ok_or_else(crate::errors::session_gone)?;
        (
            Arc::clone(&s.handle),
            s.info.server_version.clone(),
            s.info.method,
            s.info.identity.clone(),
            s.info.identity_stored,
            s.info.jump.clone(),
            s.info.connected_at_ms,
            s.info.keepalive_secs,
            s.shared.as_ref().map(|p| p.key.clone()),
            s.joined,
            s.agent_forward,
        )
    };

    // 같은 전송로를 쓰는 **다른** 타일 수 · 그 전송로를 빌린 DB 연결 수(타일이 아니다 — 따로 센다). 장부의 잠금은 이 한 줄에서 끝난다.
    let (tiles, db_pins) = share_key.as_deref().map_or((0, 0), |k| TRANSPORTS.count_users(k));
    let shared_with = tiles.saturating_sub(1) as u32;
    let db_conns = db_pins as u32;

    // `send_ping` 은 `keepalive@openssh.com` 을 want_reply 로 보내고 **응답까지** 기다린다
    // (러시 0.63 `Handle::send_ping`). 죽은 세션이면 채널 전송이 그 자리에서 실패하고,
    // 살아 있는데 답이 없으면 타임아웃이 끊는다 — 어느 쪽이든 `None` 이다.
    let started = std::time::Instant::now();
    let rtt_ms =
        match tokio::time::timeout(Duration::from_millis(RTT_TIMEOUT_MS), handle.send_ping()).await
        {
            Ok(Ok(())) => Some(started.elapsed().as_millis() as u64),
            _ => None,
        };

    Ok(SessionInfo {
        server_version: server_version.unwrap_or_default(),
        auth_method: method,
        identity,
        identity_stored,
        jump,
        connected_at_ms,
        keepalive_secs,
        rtt_ms,
        shared_with,
        db_conns,
        joined,
        agent_forward,
    })
}

/// 세션의 러시 핸들을 꺼내 온다 (포트 포워딩이 direct-tcpip 채널을 열 때 쓴다).
/// `writer_of` 와 같은 이유로 분리했다 — 잠금을 `await` 전에 반드시 풀어야 한다.
pub(crate) fn handle_of(state: &SshSessions, id: u32) -> Option<SessionHandle> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .map(|s| Arc::clone(&s.handle))
}

/// 세션의 러시 핸들과 **그 전송로의 번호**를 함께 꺼낸다 — 원격 포워드(-R)가 쓴다.
///
/// 번호가 필요한 이유는 [`SshHandler::transport_id`] 에 있다: 서버가 여는 채널은 세션이 아니라
/// 전송로에 도착한다. 잠금 규칙은 [`handle_of`] 와 같다.
pub(crate) fn transport_of(
    state: &SshSessions,
    id: u32,
) -> Option<(SessionHandle, u64)> {
    state
        .0
        .lock()
        .unwrap()
        .get(&id)
        .map(|s| (Arc::clone(&s.handle), s.transport_id))
}

/// 키 입력을 셸 채널로 — 세션 서버 op `write` 의 SSH 갈래(임대 검사는 부른 쪽 — `server::sessions`).
pub(crate) async fn write(id: u32, data: Vec<u8>) -> Result<(), String> {
    let writer = writer_of(table(), id)?;
    writer.data_bytes(data).await.map_err(|e| e.to_string())
}

/// 창 크기를 원격에 — 세션 서버 op `resize` 의 SSH 갈래.
pub(crate) async fn resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let writer = writer_of(table(), id)?;
    writer
        .window_change(cols as u32, rows as u32, 0, 0)
        .await
        .map_err(|e| e.to_string())
}

/// [`shut_shell`] 의 채널 닫기 시한 — 정리 경로라 짧게.
const SHELL_CLOSE_LIMIT: std::time::Duration = std::time::Duration::from_secs(2);

/// 이 타일의 셸 채널 하나를 닫고 펌프를 끝낸다 — [`close_ssh`] 와, 여는 사이 창이 사라져 표에 올리지
/// 못한 세션(`open::register_session`)이 함께 쓴다.
pub(super) async fn shut_shell(shell: &ShellPipe) {
    // 이 앱이 닫는다 — 펌프가 끝을 정돈된 종료로 적는다(읽기 쪽이 아래 닫기보다 먼저 끝나도).
    shell.closing.store(true, Ordering::SeqCst);
    // 수문을 먼저 열어야 대기 중인 펌프 태스크가 깨어난다(아래 종을 들으러 루프로 돌아간다).
    shell.gate.release();
    // 채널을 먼저 닫고 세션을 끊는다. 실패해도 핸들이 떨어지면 정리되므로 무시한다.
    // **이 닫기는 이 타일의 채널 하나에만 닿는다** — 같은 전송로 위의 옆 타일은
    // 자기 채널로 계속 살아 있다(연결 공유의 요점).
    // 짧은 정리 시한 아래에서 — russh 의 close 는 세션 루프로 가는 mpsc send 라 루프가 죽어
    // 있으면 끝나지 않을 수 있다. 정리 경로이므로 시한에 걸려도 오류로 올리지 않고 넘어간다.
    if tokio::time::timeout(SHELL_CLOSE_LIMIT, shell.writer.close())
        .await
        .is_err()
    {
        eprintln!(
            "[aynx] SSH 셸 채널 닫기가 {SHELL_CLOSE_LIMIT:?} 안에 끝나지 않아 건너뜁니다"
        );
    }
    // 그리고 펌프를 **우리가** 끝낸다 — 러시는 이 닫기에 대한 서버의 답을 읽기 쪽에 넘기지
    // 않아(`until_closed`), 공유 전송로에서는 `reader.wait()` 가 전송로가 끝날 때까지 안 끝난다.
    // 펌프가 끝나야 로그가 flush 되고 배칭 스레드가 서고 `ssh-exit` 가 한 번 나간다.
    shell.closed.notify_one();
}

/// 손잡이로 닫는다 — 임대 검사 없이(창 파괴 거둠 · 복원이 데려가지 않은 세션 · 서버 끝). 코어에서도 뺀다.
pub(crate) async fn close_ssh_by_id(id: u32) {
    core().remove_id(Kind::Ssh, id);
    release_ssh(table(), id).await;
}

/// 표의 SSH 세션(대화형·헤드리스) id 전부 — 서버 끝·[모든 세션 종료] 가 닫는다.
pub(crate) fn all_ids() -> Vec<u32> {
    let mut ids: Vec<u32> = table().0.lock().unwrap().keys().copied().collect();
    ids.sort_unstable();
    ids
}

/// 세션 하나의 **자원을 회수한다** — 표에서 빼고 포워드·SFTP·에이전트 포워딩·신호 토큰·서버 신호 파일·셸 채널·
/// 전송로 자리를 차례로 거둔다. 표에 없으면 아무 일도 없다(멱등 — 명시 닫기·종료 마감·창 거둠이 겹쳐 와도 한 번).
/// 코어 표는 만지지 않는다(부른 쪽의 몫). 헤드리스 세션도 이 길이다(`crate::headless::close_headless_session`).
pub(crate) async fn release_ssh(state: &SshSessions, id: u32) {
    // 이 세션에 걸린 포트 포워드를 **먼저** 멈춘다. 세션이 사라진 뒤에도 리스너가 남으면
    // 연결을 받아 놓고 곧바로 끊기만 하는 함정이 된다 (docs/log/2026-09-01-port-forward.md).
    // 원격이 먼저 끝난 경우(ssh-exit)도 프런트가 곧바로 이 명령을 부르므로 여기 한 곳이면 된다.
    crate::port_forward::stop_session_forwards(id);
    // SFTP 채널 터널도 같은 자리에서 거둔다 (docs/log/2026-09-02-sftp.md · ③-3b2 — GUI 의 SFTP 캐시·편집 감시는 GUI 가
    // `ssh-exit` 를 받아 버린다). 로컬 편집 파일은 남긴다 — 사용자가 편집기에 띄워 둔 작업물이다.
    crate::server::tunnel::close_session(id);

    let session = state.0.lock().unwrap().remove(&id);
    if let Some(session) = session {
        // 에이전트 포워딩 장부에서 뺀다 — 이 전송로에서 켠 마지막 세션이면 살아 있는 에이전트
        // 중계까지 여기서 끊긴다(옆 타일이 전송로를 살려 두어도). 켜지 않은 세션이면 무해하다.
        crate::agent_forward::disable(session.transport_id, id);
        // 원격 AI 타일이 받은 신호 전용 토큰을 거둔다(포워드는 위 `stop_session_forwards` 가 거뒀다 —
        // 이 호스트의 마지막 에이전트 타일일 때만 실제로 멈춘다).
        // 이 세션이 서버에 쓴 신호 파일(①b · `crate::remote_signal_file`)도 지운다 — 주인으로서 거뒀고 이 세션이 쓴
        // 것일 때만(재연결이 이미 새 파일을 썼으면 그대로 둔다). 전송로가 아직 살아 있을 때(아래 `unpin_shared` 앞)라야 닿는다.
        if let Some((stream, owner)) = &session.signal {
            // 토큰 표는 같은 프로세스(세션 서버)에 있다(③-3b2 — 파이프를 타지 않는다). 거뒀고 이 주인이 파일을 썼을 때만 지운다.
            if crate::agent_signal::revoke(stream, *owner) == Some(true) {
                crate::remote_signal_file::remove(&session.handle, stream).await;
            }
        }
        // 셸 채널이 있는 세션만 수문·쓰기 쪽을 정돈한다(헤드리스는 셸이 없다).
        if let Some(shell) = &session.shell {
            shut_shell(shell).await;
        }
        match &session.shared {
            // 공유 전송로에 꽂혀 있던 세션 — **마지막 사용자일 때만** 전송로가 끊긴다.
            // 창 정리(`reap`)·헤드리스 종료·프런트의 닫기가 전부 이 한 문을 지난다.
            Some(pin) => unpin_shared(pin, id).await,
            // 풀 밖의 세션(헤드리스 위임) — 오늘까지와 같이 제 전송로를 그냥 끊는다.
            None => {
                let _ = session
                    .handle
                    .disconnect(Disconnect::ByApplication, "closed by user", "en")
                    .await;
                // 점프는 대상 뒤에 끊는다 — 대상의 작별 인사가 아직 이 통로를 타고 나가야 한다.
                if let Some(jump) = &session.jump {
                    let _ = jump
                        .disconnect(Disconnect::ByApplication, "closed by user", "en")
                        .await;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 종료 마감 (2026-10-08 세션 코어 ②-2 — 설계 4.3 "종료는 Rust 가 마감")
// ---------------------------------------------------------------------------

/// 종료 마감 유예 — 펌프가 마지막으로 읽은 바이트가 배처에 닿을 틈(로컬 `pty::EXIT_DRAIN_GRACE` 와 같은 값).
const EXIT_DRAIN_GRACE: Duration = Duration::from_millis(50);
/// 표식 답을 기다리는 상한 — 배처가 이미 끝났으면 슬롯에서 직접 읽는다.
const EXIT_MARK_WAIT: Duration = Duration::from_millis(500);

/// `ssh-exit` 이벤트 페이로드 — 예전 `{ id, reason, message }` 에 세션 코어의 스트림·회차를 더했다(로컬 `local-exit` 과
/// 같은 모양). 표에 오르기 전에 끝났으면 둘은 없다. `removed` — 붙은 창 없이 끝나 표에서 지웠다(MCP 거울은 서버가 이미
/// 거뒀다 — ③-3c · GUI 는 출력 경로만 지운다).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SshExit {
    id: u32,
    reason: &'static str,
    message: Option<String>,
    stream: Option<String>,
    session_epoch: Option<u64>,
    removed: bool,
}

/// **세션 하나의 종료를 마감한다** — [`ExitSignal`] 이 정확히 한 번 부른다(창 세션만 — 헤드리스는 제 훅이 있다).
///
/// 순서: ① 유예 뒤 배처에 표식 → 그 앞 배치까지 적은 링 끝 = 최종 오프셋 ② 코어에 `Exited{사유, 최종 오프셋}`
/// (셸이 끝났다는 증거가 있으면) 또는 `Disconnected{시각, 사유}`(전송로 끊김) — 떨어져 있었으면 표에서 곧바로 지우고
/// 그 스트림의 거울도 거둔다 ③ `ssh-exit{id, reason, message, stream, sessionEpoch}` — 붙어 있던 창이 종료 배너·
/// 재접속을 돌린다 ④ 자원 회수([`release_ssh`] — 포워드·SFTP·토큰 revoke·서버 신호 파일·셸 채널·풀 자리). ③ 을 ④
/// 앞에 두는 이유: 죽은 전송로의 정리(채널 닫기 시한 등)가 재접속 배너를 늦추지 않게. 프런트의 닫기는 그 뒤에
/// 와도 멱등이다(코어 `close` 는 끝난 항목을 받고, 자원은 이미 없다).
pub(super) async fn finish_exit(event: ExitEvent) {
    let id = event.id;
    let parts = {
        let map = table().0.lock().unwrap();
        map.get(&id)
            .and_then(|s| s.shell.as_ref())
            .map(|sh| (Arc::clone(&sh.output), sh.mark.lock().unwrap().clone()))
    };
    tokio::time::sleep(EXIT_DRAIN_GRACE).await;
    let final_offset = match parts {
        Some((slot, mark)) => tokio::task::spawn_blocking(move || {
            crate::output::flush_mark(&mark, &slot, EXIT_MARK_WAIT)
        })
        .await
        .unwrap_or(0),
        None => 0,
    };
    let end = if event.reason == REASON_EXIT {
        End::Exited {
            reason: event.message.clone(),
            final_offset,
        }
    } else {
        End::Disconnected {
            at_ms: crate::session_core::now_ms(),
            reason: event.message.clone(),
        }
    };
    let exit = core().ended(Kind::Ssh, id, end);
    // 떨어진 채 끝나 표에서 빠졌으면 시청자에게 끝을 알린다(R2-A — 노트 `ViewerGone{Ended}`).
    crate::server::sessions::settle();
    let removed = exit.as_ref().is_some_and(|e| e.removed);
    if let Some(e) = exit.as_ref().filter(|e| e.removed) {
        crate::server::log::line(format!(
            "ssh {id} ended with no window attached (stream {}, {}) — removed · final offset {final_offset}",
            e.stream, event.reason
        ));
    }
    // 붙은 창이 없었으면(`removed`) 거울을 지울 손(`Terminal` 의 `dropSession`)도 없다 — 같은 프로세스의 AI 평면이 거둔다(③-3c).
    if let Some(e) = exit.as_ref().filter(|e| e.removed) {
        crate::server::ai::on_session_removed(&e.stream);
    }
    let body = SshExit {
        id,
        reason: event.reason,
        message: event.message,
        session_epoch: exit.as_ref().map(|e| e.session_epoch),
        stream: exit.map(|e| e.stream),
        removed,
    };
    crate::server::hub::emit("ssh-exit", serde_json::to_value(body).unwrap_or_default());
    if removed {
        // 떨어진 채 끝났다 — 떨어진 세션 목록에서 빠진다(③-4).
        crate::server::sessions::detached_changed();
    }
    // 출력 크레딧도 거둔다(ACK 를 받을 임대가 없다).
    crate::server::sessions::retire_ssh_credit(id);
    release_ssh(table(), id).await;
}
