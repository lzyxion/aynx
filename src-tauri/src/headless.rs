//! 헤드리스 위임 접속 — 타일·PTY·셸 없이 위임 대상에 붙는다([`open_delegated`] — 세션 서버 op `headless_open`).
//!
//! **③-3b2 부터 세션 서버 프로세스에서 돈다** — 전송로는 서버의 SSH 표에 오르고, 볼트의 키 암호구(`vault_passphrase` 위임
//! 호스트)는 서버 안에서 직접 읽는다(`server::hub::vault` — 값이 파이프를 타지 않는다). GUI 쪽(`server::ssh_ops`)은 Tauri 명령
//! `open_headless_session`·`close_headless_session` 과 실행기의 자동 접속을 이 op 로 옮기고, 받은 세션 id 로 **거울·라우팅**
//! (아직 GUI — ③-3c)을 잇는다. 끊기면 서버 이벤트 `headless-exit{id, alias}` 로 GUI 가 라우팅·거울을 정돈한다.
//!
//! 기능 층이다: [`crate::ssh`] 의 원시(전송로·인증·세션 표)를 부르고, `ssh` 는 이 모듈을 부르지 않는다.
//! `delegation` 을 직접 읽는다(관문은 서버가 — GUI 가 우회할 길이 없다).
//!
//! 불변식:
//! - `delegation.toml` 에서 헤드리스 접속이 위임된 별칭에만(누적 판정 — 단계 'Ask' 이상 + `connect`),
//!   신원 스냅샷이 맞을 때만 선다([`crate::delegation::Delegation::connect_granted`]).
//! - 무상호작용 — 비밀번호를 받지 않고(볼트에서도 꺼내지 않는다), 미상 호스트 키를 자동 수락하지 않는다.
//!   볼트의 **키 암호구**는 호스트별 `vault_passphrase` 위임이 켜졌을 때만.
//! - 에이전트 포워딩이 없다 (docs/log/2026-09-23-agent-forwarding.md).
//! - `await` 위로 잠금을 들고 가지 않는다.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use crate::i18n::tr;
use crate::ssh_config;
use crate::ssh_pool::{ExitTarget, TransportSignal};

use crate::ssh::{
    authenticate, connect_transport, now_ms, release_ssh, resolve_params, table, vault_keys_for,
    ConnectedAs, ExitSignal, KeyUnlock, SshOpenError, SshSession, StoredKey, Transport, NEXT_ID,
};

/// 헤드리스 접속 실패에 **처방 한 줄**을 덧붙인다 — **순수 함수**(유닛 테스트 대상).
///
/// 덧붙이는 조건은 하나다: `diag.locked_identity` — 즉 `IdentityFile` 이 **있었고 암호구로
/// 잠겨** 무인 접속이 열지 못했다. 그 자리에서 사람에게 물을 수는 없으므로(무상호작용 원칙)
/// 남는 길은 둘뿐이고, 문장이 그 둘을 그대로 가리킨다 — 호스트별 위임 `볼트의 키 암호구
/// 사용` 을 켜거나 키를 에이전트에 올리거나 (docs/log/2026-09-22-delegation-vault-passphrase.md).
///
/// **사람이 있는 접속에는 쓰지 않는다** — 그 경로는 잠긴 키를 만나면 암호구 모달로 되돌아간다.
fn headless_locked_key_hint(err: SshOpenError) -> SshOpenError {
    let locked = match &err {
        SshOpenError::Auth { diag, .. } | SshOpenError::PasswordRequired { diag, .. } => {
            diag.locked_identity
        }
        _ => false,
    };
    if !locked {
        return err;
    }
    let hint = tr!(
        ko: " — IdentityFile 에 암호구가 있어 무인 접속에서 열지 못했습니다: 호스트 설정 › AI 의 '볼트의 키 암호구 사용' 을 켜거나 `ssh-add` 로 에이전트에 올리세요",
        en: " — the IdentityFile has a passphrase, so the unattended connection could not open it: turn on 'Use the key passphrase from the vault' in Host settings › AI, or add the key to the agent with `ssh-add`"
    );
    match err {
        SshOpenError::Auth { message, diag } => SshOpenError::Auth {
            message: format!("{message}{hint}"),
            diag,
        },
        SshOpenError::PasswordRequired {
            message,
            diag,
            stored_rejected,
        } => SshOpenError::PasswordRequired {
            message: format!("{message}{hint}"),
            diag,
            stored_rejected,
        },
        other => other,
    }
}

// ---------------------------------------------------------------------------
// 헤드리스 접속 (슬라이스 A1) — 타일·PTY·셸·출력 채널 없이 위임 대상에 붙는다.
//
// 사람이 그 자리에서 승인하는 절차가 없으므로, **이 능력은 사용자가 `~/.aynx/delegation.toml` 에
// `connect = true` 로 직접 위임한 별칭에만** 생긴다([`crate::delegation`]). 두 관문(위임 여부·신원
// 스냅샷)을 모두 통과해야 하고, 인증은 **무상호작용**이다(비밀번호 안 받음·미상 호스트 키
// 자동 수락 안 함). 성공하면 살아 있는 전송로를 [`SshSessions`] 에 1급으로 등록하고, 백엔드가
// 발급한 streamId 로 헤드리스 거울([`crate::context::report_delegated`])과 실행 라우팅
// ([`crate::routing`])을 **프런트 없이** 직접 잇는다.
// ---------------------------------------------------------------------------

/// 위임 대상 하나에 **헤드리스로** 접속한다 — 세션 서버 op `headless_open`·실행기의 자동 접속이 부른다. 세션 id 를 돌려준다
/// (거울·라우팅은 같은 프로세스의 AI 평면이 그 id 로 잇는다 — `server::ai::connect_delegated`).
///
/// **멱등 재사용** — 그 별칭의 헤드리스 전송로가 이미 살아 있으면 두 번째 접속을 열지 않고 그 id 를 돌려준다.
///
/// 아니면 A1 관문을 전부 지난다(하나라도 막히면 접속이 아예 없다):
/// 1. `~/.aynx/delegation.toml` 을 읽어 **`connect` 위임이 없으면 거부**(인가 게이트).
/// 2. `~/.ssh/config` 로 파라미터를 편 뒤 **신원 스냅샷**(expect_user/host/port)이 어긋나면 거부.
/// 3. **무상호작용 인증**: `password = None`, 호스트 키 결정 없음(미상·바뀐 키 거부). PTY·셸·출력·셸 통합 부트스트랩 없음.
/// 4. **에이전트 포워딩은 없다** — 이 전송로는 포워딩 장부에 오르지 않아 서버가 에이전트 채널을 열어도 훅이 거절한다
///    ([`crate::agent_forward::accept`] · docs/log/2026-09-23-agent-forwarding.md).
///
/// **`await` 위로 어떤 잠금도 들고 가지 않는다**(잠금은 잡은 문장 안에서 끝난다).
pub(crate) async fn open_delegated(alias: &str) -> Result<u32, SshOpenError> {
    // 멱등 재사용 — 이 별칭의 헤드리스(셸 없는) 전송로가 살아 있으면 그것.
    let existing = table()
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|(_, s)| s.shell.is_none() && s.alias == alias && !s.handle.is_closed())
        .map(|(id, _)| *id);
    if let Some(id) = existing {
        return Ok(id);
    }

    // 1) 인가 게이트 — 위임되지 않은 별칭에는 헤드리스 접속 경로가 없다.
    let delegation = crate::delegation::Delegation::load_default();
    if !delegation.connect_granted(alias) {
        return Err(SshOpenError::other(tr!(
            ko: "'{alias}' 은(는) delegation.toml 에서 connect 로 위임된 대상이 아닙니다 — 헤드리스 접속을 거부합니다",
            en: "'{alias}' is not delegated with connect in delegation.toml — refusing the headless connection"
        )));
    }

    // 2) 파라미터 해석 + 신원 스냅샷 검증.
    let config = ssh_config::load_default().map_err(SshOpenError::other)?;
    let username = std::env::var("USERNAME").ok();
    let params = resolve_params(alias, &config.hosts, username.as_deref())?;
    if !delegation.identity_matches(alias, &params.user, &params.host, params.port) {
        return Err(SshOpenError::other(tr!(
            ko: "'{alias}' 의 신원 스냅샷이 다릅니다 (별칭이 재지목됐거나 ssh config 가 바뀌었습니다) — 헤드리스 접속을 거부합니다",
            en: "The identity snapshot for '{alias}' differs (the alias was repointed, or the ssh config changed) — refusing the headless connection"
        )));
    }

    // 2b) **볼트의 키 암호구** — 이 호스트에 그 권한이 위임됐을 때만 (2026-09-22). 비밀번호는 여전히 아니다. 금고는 이
    // 프로세스(세션 서버)에 있다 — 잠겨 있으면 조용히 지나가지 않는다(사람이 켜 둔 권한이 말없이 무력해지지 않게).
    let stored_keys: Vec<StoredKey> = if delegation.vault_passphrase_granted(alias) {
        let unlocked = crate::server::hub::vault().is_some_and(|v| v.is_unlocked());
        if !unlocked {
            return Err(SshOpenError::other(tr!(
                ko: "볼트가 잠겨 있어 무인 접속에 키 암호구를 쓸 수 없습니다 (가림막을 걷으면 열립니다)",
                en: "The vault is locked, so the unattended connection cannot use the key passphrase (lifting the privacy veil opens it)"
            )));
        }
        vault_keys_for(&params).await
    } else {
        Vec::new()
    };
    let unlock = KeyUnlock::Skip {
        stored: &stored_keys,
    };

    // 3) 무상호작용 전송로 + 인증. exit 신호는 id 를 bind 하지 않는다(`ssh-exit` 이 없다 — 타일이 없다). 대신 **백엔드 종료
    //    훅**이 같은 프로세스의 AI 평면에 알린다(③-3c — `server::ai::on_headless_exit`: 라우팅을 지우고 거울을 '끊김'으로).
    //    훅은 동기 작업뿐이다.
    let id_cell = Arc::new(AtomicU32::new(0));
    let hook_id = Arc::clone(&id_cell);
    let hook_alias = alias.to_string();
    let on_exit: Box<dyn Fn() + Send + Sync> = Box::new(move || {
        crate::server::ai::on_headless_exit(hook_id.load(Ordering::SeqCst), &hook_alias);
    });
    let exit = Arc::new(ExitSignal::new_with_hook(Some(on_exit)));
    // **헤드리스는 연결 공유 풀을 쓰지 않는다 (v1)** — 위임 세션은 신원 스냅샷도 수명도 창 세션과 다르다. 그래서 신호도
    // **혼자 타는 것** 하나다.
    let signal = TransportSignal::solo(Arc::clone(&exit) as Arc<dyn ExitTarget>);
    let auto_accepted = Arc::new(AtomicBool::new(false));
    let changed_accepted = Arc::new(AtomicBool::new(false));
    let Transport {
        mut handle,
        jump: jump_handle,
        server_version,
        transport_id,
    } = connect_transport(
        &params,
        None,
        &auto_accepted,
        &changed_accepted,
        &signal,
        unlock,
    )
    .await
    .map_err(headless_locked_key_hint)?;
    // password = None · 금고의 비밀번호도 꺼내지 않는다(`stored_password = None`) — 헤드리스는 사람이 없는 자리다.
    let auth_used = authenticate(
        &mut handle,
        &params.user,
        None,
        params.identity_file.as_deref(),
        params.identities_only,
        unlock,
        None,
    )
    .await
    .map_err(headless_locked_key_hint)?;

    // ── 등록: 전송로(위임 소유) — 셸·PTY·출력 없음. 거울·라우팅은 GUI 가 이 id 로 잇는다. ──────────
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    id_cell.store(id, Ordering::SeqCst);
    table().0.lock().unwrap().insert(
        id,
        SshSession {
            handle: Arc::new(handle),
            transport_id,
            jump: jump_handle,
            // 헤드리스 — 셸 채널이 없다. 실행은 서버 op `ssh_exec` 가 전송로만 집는다.
            shell: None,
            // 풀 밖의 세션이다 — 닫을 때 자기 전송로를 그냥 끊는다.
            shared: None,
            joined: false,
            // **헤드리스 위임은 에이전트를 넘기지 않는다 — 호스트 설정이 켜져 있어도.**
            agent_forward: false,
            signal: None,
            alias: alias.to_string(),
            tmux: None,
            log_path: None,
            info: ConnectedAs {
                server_version,
                method: auth_used.method,
                identity: auth_used.identity,
                identity_stored: auth_used.identity_stored,
                jump: params.jump.as_ref().map(|j| j.label.clone()),
                connected_at_ms: now_ms(),
                keepalive_secs: params.keepalive_interval.map(|d| d.as_secs()),
            },
        },
    );
    crate::server::log::line(format!("headless {id} opened — {alias}"));
    Ok(id)
}

/// 헤드리스 세션 하나를 닫는다(서버 op `headless_close`) — 셸 없는 세션만(타일 세션은 이 길로 닫지 않는다). 멱등.
pub(crate) async fn close_delegated(id: u32) {
    let headless = table()
        .0
        .lock()
        .unwrap()
        .get(&id)
        .is_some_and(|s| s.shell.is_none());
    if headless {
        release_ssh(table(), id).await;
        crate::server::log::line(format!("headless {id} closed"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::auth_failure;

    /// 헤드리스의 **처방 한 줄** — 그 칸이 켜진 실패에만 붙고, 문구가 길 둘을 그대로 가리킨다.
    #[test]
    fn the_headless_hint_names_the_grant_and_ssh_add() {
        let base = "ssh-agent 의 키 1개가 모두 거부되었습니다";
        let hinted =
            headless_locked_key_hint(auth_failure(base, true, false, false, false, false, true));
        let msg = match &hinted {
            SshOpenError::Auth { message, .. } => message.clone(),
            other => panic!("Auth 를 기대했다: {other:?}"),
        };
        assert!(msg.starts_with(base), "원래 사유를 잃지 않는다");
        assert!(
            msg.contains("볼트의 키 암호구 사용"),
            "위임 스위치를 가리킨다"
        );
        assert!(msg.contains("ssh-add"), "에이전트 길도 가리킨다");

        // 플래그가 없으면 한 글자도 덧붙이지 않는다.
        let plain = auth_failure(base, true, false, false, false, false, false);
        let plain_msg = match &plain {
            SshOpenError::Auth { message, .. } => message.clone(),
            other => panic!("Auth 를 기대했다: {other:?}"),
        };
        assert_eq!(
            match headless_locked_key_hint(plain) {
                SshOpenError::Auth { message, .. } => message,
                other => panic!("Auth 를 기대했다: {other:?}"),
            },
            plain_msg
        );

        // 다이얼로그 계약(암호구 요구)에는 `diag` 가 없다 — 그대로 지나간다.
        let dialog = SshOpenError::PassphraseRequired {
            path: "C:/k".into(),
            fingerprint: None,
            wrong: false,
            stored_rejected: false,
        };
        assert!(matches!(
            headless_locked_key_hint(dialog),
            SshOpenError::PassphraseRequired { .. }
        ));
    }
}
