//! russh 기반 SSH 세션.
//!
//! 로컬 PTY([`crate::pty`])와 같은 모양의 명령 집합(open/write/resize/close)을
//! 제공하되, 접속 전에 두 단계의 관문을 통과해야 한다는 점이 다르다.
//!
//! ```text
//!  alias
//!    │  ssh_config::load_default() → host/port/user/keepalive/ProxyJump
//!    ▼
//!  (ProxyJump 가 있으면 먼저 점프 호스트에 같은 방식으로 접속 →
//!   channel_open_direct_tcpip(대상) → into_stream() 이 아래 connect 의 전송로가 된다.
//!   docs/log/2026-09-01-jump-host.md)
//!    ▼
//!  client::connect ──► Handler::check_server_key
//!    │                   ├─ StrictHostKeyChecking no   → 조회 없이 통과 (경고 한 줄을 터미널에 흘린다)
//!    │                   ├─ Known                     → 통과
//!    │                   ├─ Unknown + accept-new       → 모달 없이 통과 + learn
//!    │                   ├─ Unknown + accept_new=true  → known_hosts::learn 후 통과
//!    │                   ├─ Unknown + accept_new=false → 거부 (지문을 기록해 두고 끊음)
//!    │                   └─ Changed                    → 거부 (MITM 경고 — accept-new 로도 안 뚫린다)
//!    │                  (UserKnownHostsFile /dev/null 이면 learn 만 생략한다.
//!    │                   docs/log/2026-09-02-strict-host-key.md)
//!    ▼  (거부면 connect 가 실패 → 기록해 둔 지문으로 SshOpenError 를 만든다)
//!  ssh-agent 명명 파이프 인증 (키 바이트는 앱이 만지지 않는다)
//!    │   실패 → password 인자가 있으면 비밀번호 인증
//!    │          없으면 서버가 password 를 받는지 보고 PasswordRequired 로 되돌린다
//!    │          (호스트 키와 같은 "끊고 재시도" 계약 — 비밀번호는 앱에 남지 않는다)
//!    ▼
//!  channel_open_session → request_pty → request_shell
//!    ▼
//!  ChannelReadHalf → 4ms/64KB 배칭 → on_data 채널
//! ```
//!
//! 셸이 서면 `sessions.toml` 의 `on_connect` 를 첫 입력으로 흘려보낸다
//! ([`prepare_on_connect`] — docs/log/2026-09-01-on-connect.md).
//!
//! **같은 호스트의 둘째 타일은 위 사다리를 다시 오르지 않는다** — 이미 서 있는 전송로
//! 위에 `channel_open_session` 하나를 더 열 뿐이다(연결 공유 ·
//! docs/log/2026-09-23-ssh-connection-sharing.md). 장부와 종료 팬아웃은
//! [`crate::ssh_pool`] 에 있고, 이 모듈에서 그것을 만지는 자리는 셋뿐이다:
//! [`open_ssh_session`](풀 보기·등록) · [`unpin_shared`](내려놓기 — **마지막 사용자만**
//! 전송로를 끊는다) · [`session_info`](`shared_with`·`joined`). 세션마다 남는 것은
//! 그대로다: 셸 채널 · 포워드 · SFTP · 세션 로그 · tmux 이름.
//!
//! 세션이 끝나면 `ssh-exit` 이벤트가 **정확히 한 번** 나간다
//! ([`ExitSignal`] · [`classify_exit`]). 페이로드의 `reason` 이 `"exit"` 이면 사용자가
//! 셸을 끝낸 것이고, `"error"` 면 연결이 사라진 것이다 — 프런트는 후자에서만
//! 자동 재연결을 돌린다 (docs/log/2026-09-01-reconnect.md). 재연결은 **기존
//! `open_ssh_session` 을 다시 부르는 것**이라 이 모듈에 전용 명령이 따로 없다 — 세션 코어에서는
//! **새 회차**다(새 채널 = 새 세션). 종료는 Rust 가 마감한다(`session::finish_exit` — 코어에 `Exited`/
//! `Disconnected` → 이벤트 → 자원 회수). 대화형 타일의 표·임대(누가 붙어 있나)는 [`crate::session_core`] 다 —
//! 페이지 리로드는 채널을 닫지 않고 떨어뜨린다(2026-10-08 ②-2).
//!
//! `check_server_key` 는 async 콜백이고 Handler 는 `connect` 가 소유해 버리기 때문에,
//! 거부 사유를 밖으로 꺼내려면 공유 슬롯([`SshHandler::reject`])이 필요하다.
//! connect 가 실패한 뒤 그 슬롯을 읽어 [`SshOpenError`] 로 옮긴다.
//!
//! 맡지 않는 것: `~/.ssh/config` 해석은 `crate::ssh_config`, 전송로 장부는 `crate::ssh_pool`,
//! 포워드는 `crate::port_forward`, 셸 통합 부트스트랩 글자는 `crate::shell_integration`.
//!
//! 불변식:
//! - 비밀번호·키 암호구는 볼트(`crate::vault`)에만 — 볼트를 켜지 않았으면 한 번 쓰고 버린다
//!   (docs/log/2026-09-19-vault.md · docs/log/2026-09-19-identity-file-auth.md).
//! - 원격 타일에는 MCP 토큰을 주지 않는다 — 스트림별 신호 전용 토큰만 `-R` 로 (docs/log/2026-09-24-remote-agent-signals.md).
//! - 헤드리스 위임 접속은 [`crate::headless`] 가 맡는다 — 에이전트 포워딩이 없다 (docs/log/2026-09-23-agent-forwarding.md).
//!   `ssh` 는 `headless` 를 부르지 않는다(기능 층이 원시를 부르는 한 방향).
//!
//! 현재 위층을 부름: [`open`] 의 `open_ssh_session`(·`_inner`)이 접속 앞뒤로 기능 모듈을 직접 조립한다 —
//! `remote_worktree::prepare` · `setup_script::remote_start_command` · `port_forward::ensure_agent_signal_forward` ·
//! `server::proxy::signal_issue`(세션 서버의 신호 토큰 — ③-3a) · `session_log::start` · `host_history::record`.
//!
//! ## 자식 모듈 (역할별 — 다른 모듈은 아래 재수출로 `crate::ssh::X` 를 그대로 쓴다)
//!
//! | 파일 | 맡는 것 |
//! |---|---|
//! | `ssh/error.rs` | `SshOpenError`·`OpenCause`·`OpenDiag`·실패 분류·`HostKeyDecision` |
//! | `ssh/params.rs` | 별칭/빠른 접속 → `ConnectParams`, ProxyJump·`IdentityFile` 후보 |
//! | `ssh/remote_cmd.rs` | 첫 입력 글자 — `on_connect`·tmux 명령·프로젝트 시작 줄·`sh_quote` |
//! | `ssh/handler.rs` | russh `SshHandler`(호스트 키 콜백)·`ExitSignal`·보안 완화 문구 |
//! | `ssh/session.rs` | 세션 표·연결 공유 풀·표 조각 함수·write/resize/pause/resume/close/session_info 명령 |
//! | `ssh/auth.rs` | 에이전트 → 키 파일 → 비밀번호 인증, `vault_keys_for` |
//! | `ssh/connect.rs` | 홉 열기·`connect_transport`(호스트 키 검증까지) |
//! | `ssh/open.rs` | `open_ssh_session` 명령과 조립 |
//! | `ssh/exec.rs` | PTY 없는 exec 채널(`run_exec*`) |
//! | `ssh/commands.rs` | tmux 폴더·목록, 원격 홈, 호스트 키 잊기 명령 |
//!
//! Tauri 명령은 재수출로 등록되지 않는다 — `lib.rs` 는 `ssh::session::write_ssh` 처럼 정의 경로를 쓴다.

mod auth;
pub(crate) mod commands;
mod connect;
mod error;
mod exec;
mod handler;
pub(crate) mod open;
mod params;
mod remote_cmd;
pub(crate) mod session;

pub(crate) use auth::*;
pub(crate) use commands::*;
pub(crate) use connect::*;
pub(crate) use error::*;
pub(crate) use exec::*;
pub(crate) use handler::*;
pub(crate) use params::*;
pub(crate) use remote_cmd::*;
pub(crate) use session::*;

#[cfg(test)]
mod tests;
