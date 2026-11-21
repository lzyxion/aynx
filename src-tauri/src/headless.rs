//! 헤드리스 위임 접속 — 타일·PTY·셸 없이 위임 대상에 붙는다(세션 서버 op `headless_open`).
//!
//! 기능 층이다: [`crate::ssh`] 의 원시를 부르고, `ssh` 는 이 모듈을 부르지 않는다.
//!
//! 불변식:
//! - 관문은 세션 서버가 `delegation` 을 직접 읽어 선다 — GUI 가 우회할 길이 없다.
//! - `delegation.toml` 에서 헤드리스 접속이 위임된 별칭에만(누적 판정 — 단계 'Ask' 이상 + `connect`),
//!   신원 스냅샷이 맞을 때만 선다([`crate::delegation::Delegation::connect_granted`]).
//! - 무상호작용 — 비밀번호를 받지 않고(볼트에서도 꺼내지 않는다), 미상 호스트 키를 자동 수락하지 않는다.
//!   볼트의 **키 암호구**는 호스트별 `vault_passphrase` 위임이 켜졌을 때만 · 볼트 값은 서버 안에서 읽어 파이프를 타지 않는다.
//! - 에이전트 포워딩이 없다 — 호스트 설정이 켜져 있어도 (docs/log/2026-09-23-agent-forwarding.md).
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

/// 헤드리스 접속 실패가 암호구로 잠긴 `IdentityFile` 때문이면 처방 한 줄을 덧붙인다 — 사람이 있는 접속에는 쓰지 않는다
/// (그 경로는 암호구 모달로 되돌아간다) (docs/log/2026-09-22-delegation-vault-passphrase.md).
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

/// 위임 대상 하나에 **헤드리스로** 접속해 세션 id 를 돌려준다 — 그 별칭의 헤드리스 전송로가 살아 있으면 그 id 를 다시 쓴다.
pub(crate) async fn open_delegated(alias: &str) -> Result<u32, SshOpenError> {
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

    let delegation = crate::delegation::Delegation::load_default();
    if !delegation.connect_granted(alias) {
        return Err(SshOpenError::other(tr!(
            ko: "'{alias}' 은(는) delegation.toml 에서 connect 로 위임된 대상이 아닙니다 — 헤드리스 접속을 거부합니다",
            en: "'{alias}' is not delegated with connect in delegation.toml — refusing the headless connection"
        )));
    }

    let config = ssh_config::load_default().map_err(SshOpenError::other)?;
    let username = std::env::var("USERNAME").ok();
    let params = resolve_params(alias, &config.hosts, username.as_deref())?;
    if !delegation.identity_matches(alias, &params.user, &params.host, params.port) {
        return Err(SshOpenError::other(tr!(
            ko: "'{alias}' 의 신원 스냅샷이 다릅니다 (별칭이 재지목됐거나 ssh config 가 바뀌었습니다) — 헤드리스 접속을 거부합니다",
            en: "The identity snapshot for '{alias}' differs (the alias was repointed, or the ssh config changed) — refusing the headless connection"
        )));
    }

    // 볼트가 잠겨 있으면 조용히 지나가지 않는다 — 사람이 켜 둔 권한이 말없이 무력해지지 않게.
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

    // exit 신호는 id 를 bind 하지 않는다(타일이 없다) — 종료 훅이 AI 평면에 알린다. 훅은 동기 작업뿐이다.
    let id_cell = Arc::new(AtomicU32::new(0));
    let hook_id = Arc::clone(&id_cell);
    let hook_alias = alias.to_string();
    let on_exit: Box<dyn Fn() + Send + Sync> = Box::new(move || {
        crate::server::ai::on_headless_exit(hook_id.load(Ordering::SeqCst), &hook_alias);
    });
    let exit = Arc::new(ExitSignal::new_with_hook(Some(on_exit)));
    // 헤드리스는 연결 공유 풀을 쓰지 않는다 — 위임 세션은 신원 스냅샷도 수명도 창 세션과 다르다.
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

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    id_cell.store(id, Ordering::SeqCst);
    table().0.lock().unwrap().insert(
        id,
        SshSession {
            handle: Arc::new(handle),
            transport_id,
            jump: jump_handle,
            shell: None,
            shared: None,
            joined: false,
    // 헤드리스 위임은 에이전트를 넘기지 않는다 — 호스트 설정이 켜져 있어도.
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
