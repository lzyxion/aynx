//! 자격증명 금고 — 호스트 비밀번호와 키 파일 암호구를 **앱이 소유하는 파일 하나**에 담는다.
//!
//! ## 왜 있는가 (2026-09-19 결정)
//!
//! 이 앱은 그동안 **아무 비밀도 기억하지 않았다**. 비밀번호·암호구는 모달에서 받아 그 접속에
//! 한 번 쓰고 버렸고, 다음 접속에 다시 물었다. 서명은 ssh-agent 에 맡겼다([`crate::ssh`]).
//! 그 선은 안전했지만, **에이전트를 쓰지 않는 사람에게는 매번 묻는 앱**이었다 — 호스트 열 개를
//! 여는 아침이면 암호구를 열 번 친다.
//!
//! Tabby·MobaXterm 이 그 자리에 두는 것이 금고다. 사용자가 **명시적으로 켜면**(옵트인) 그때만
//! 비밀이 디스크로 간다. 켜지 않으면 이 모듈은 파일조차 만들지 않는다 — 그 경우 앱의 동작은
//! 지금까지와 **글자 그대로 같다**.
//!
//! ## 왜 OS 자격증명 저장소가 아닌가
//!
//! Windows Credential Manager · macOS Keychain · libsecret 을 쓰면 암호를 우리가 안 만져도
//! 된다. 그런데 이 앱의 목표는 **세 OS 에서 같은 제품**이다(CLAUDE.md). OS 저장소를 쓰면
//! 셋의 능력이 다르다 — 잠금 개념도, "언제 다시 묻는가" 도, 백업·이전 방법도 다르다. 결과는
//! OS 마다 다른 UX 와, 프런트가 OS 를 알아야 하는 분기다. 그래서 **파일 하나**로 간다:
//! 형식이 한 벌이고, 사용자가 통째로 백업·이전할 수 있고, 화면이 한 가지다.
//! (OS 저장소는 버린 것이 아니라 **미결정**이다 — CLAUDE.md 의 "OS 자격증명 저장은 보류".)
//!
//! ## 파일 — `<config_dir>/aynx/vault.bin`
//!
//! 판(version)이 붙은 JSON 봉투이고, **본문은 통째로 암호화**돼 있다. 봉투 바깥에는 비밀이
//! 없다: 어떤 호스트의 비밀번호를 담았는지조차 밖에서 보이지 않는다.
//!
//! ```json
//! {
//!   "version": 1,
//!   "kdf": { "kind": "argon2id", "salt": "<b64>", "m_cost": 65536, "t_cost": 3, "p_cost": 1 },
//!   "nonce": "<b64 24바이트>",
//!   "ciphertext": "<b64>"
//! }
//! ```
//!
//! 평문(복호화하면 나오는 것)은 이렇다:
//!
//! ```json
//! {
//!   "entries": [
//!     { "kind": "host_password",  "alias": "web-01",              "value": "…" },
//!     { "kind": "key_passphrase", "path":  "C:\\Users\\wl\\.ssh\\id_ed25519", "value": "…" },
//!     { "kind": "db_password",    "conn":  "Xk3_pg-main01",       "value": "…" }
//!   ],
//!   "updated_at": "2026-09-19T12:34:56+09:00"
//! }
//! ```
//!
//! - AEAD 는 **XChaCha20-Poly1305** (`chacha20poly1305` 크레이트). 논스가 24바이트라 **매번
//!   무작위로 뽑아도** 충돌을 걱정하지 않는다(12바이트 논스였다면 카운터를 관리해야 한다).
//! - 쓸 때마다 논스를 새로 뽑는다. 같은 키 + 같은 논스로 두 번 쓰는 일이 없다.
//! - AAD 로 `aynx-vault/1/<kdf 종류>` 를 묶는다 — 다른 판·다른 키 원천의 봉투를 이 자리에
//!   끼워 넣지 못한다.
//! - 쓰기는 **임시 파일 + rename** 이다. 중간에 끊겨도 반쯤 쓰인 금고가 남지 않는다.
//! - 권한은 가능한 OS 에서 0600 ([`restrict_file`]).
//!
//! ## 키 원천 둘 — 위협 모델이 다르다
//!
//! **① 마스터 비밀번호** (`kdf.kind = "argon2id"`)
//! : Argon2id 로 비밀번호에서 32바이트 키를 만든다. 파라미터(m/t/p)와 소금은 봉투 머리에
//!   적어 두므로, 나중에 값을 올려도 옛 금고가 계속 열린다. **디스크에는 그 밖의 아무것도
//!   없다** — 비밀번호를 모르면 파일을 통째로 가져가도 열 수 없다. 대신 앱을 쓰는 동안
//!   한 번은 물어야 하고, 가림막이 걸리면 다시 묻는다(아래 "잠금").
//!
//! **② 키 파일** (`kdf.kind = "keyfile"`, 마스터 비밀번호 없음)
//! : `<config_dir>/aynx/vault.key` 에 32바이트 무작위 키를 둔다. Windows 에서는 DPAPI
//!   (`CryptProtectData`)로 **이 사용자 계정에 묶어** 감싼다. 아무것도 묻지 않는 대신,
//!   **이 사용자의 설정 폴더를 읽을 수 있는 자는 금고를 열 수 있다.** 브라우저가 저장한
//!   비밀번호와 **정확히 같은 등급**이다 — 잃어버린 노트북에서는 지켜 주지 못하고, 그 계정에서
//!   도는 악성 코드에게도 지켜 주지 못한다. 지켜 주는 것은 "다른 사용자 계정" 과 "설정 폴더째
//!   복사해 간 파일을 다른 기계에서 여는 것"(DPAPI 가 막는다)뿐이다.
//!   이 정직한 한 줄은 화면에도 그대로 나가야 한다(UI 는 후속 단계).
//!
//! 바꾸는 것은 [`Vault::set_master`] 하나다. 마스터를 걸면 `vault.key` 를 **지우고**, 마스터를
//! 풀면 `vault.key` 를 **만든다**. 어느 쪽이든 항목을 새 키로 다시 암호화하며, 바꾸려면
//! **지금 열 수 있어야** 한다(현재 마스터를 요구한다).
//!
//! ## 값은 **세션 서버 프로세스** 밖으로 나가지 않는다 (③-3b1 · 2026-10-09)
//!
//! 살아 있는 금고([`Vault`] 한 벌 — 열림·잠김 상태·키·`pending`)는 **세션 서버 프로세스**(`aynx session-server`)
//! 에만 있다. GUI 의 `vault_*` Tauri 명령은 같은 이름의 서버 op 프록시이고(`server::vault_proxy`), 파이프에 실리는
//! 것은 상태·종류·대상·MCP 참조뿐이다 — **값을 돌려주는 op 는 없다**(`server::vault_ops` 머리말의 표). 값이 GUI → 서버
//! 한 방향으로 가는 것은 사람이 폼에 친 마스터·비밀번호·암호구뿐이다. 값을 실제로 쓰는 것은 서버 안의
//! [`Vault::password_for`]·[`Vault::passphrase_for`]·[`Vault::mcp_env_for`]·[`Vault::db_password_for`] 이고 IPC 표면에 없다. AI(MCP)에게는
//! **어떤 문도 열려 있지 않다**. SSH 인증·헤드리스도 서버 프로세스에서 돌아(③-3b2) 같은 프로세스 안에서 직접 읽는다
//! (`server::hub::vault`) — ③-3b1 의 과도기 op 는 지웠다.
//!
//! 예외는 외부 MCP 환경변수(`mcp_env`)다. 볼트가 열린 동안 루프백 실행 브로커가
//! 별도 `aynx mcp-run` 도우미를 거쳐 서버 자식 환경에 평문으로 넘긴다. 브로커는 티켓만
//! 확인하고 상대 프로세스는 확인하지 않는다. 티켓은 Claude 설정 파일·Codex 인자(스크롤백·
//! 셸 히스토리)에 남고 앱이 떠 있는 동안 다시 쓸 수 있어, 같은 사용자 계정의 프로세스와
//! 그 타일의 AI 에이전트에도 노출된다고 본다. 마스터 암호는 여는 순간만 지키며, 평문
//! `.mcp.json`과 같은 등급으로 알고 받은 한계다. 디스크·설정 파일·프런트·MCP RPC에는
//! 값이 없고 잠기면 브로커도 내주지 않는다 —
//! [사건 기록](../../docs/log/2026-10-03-mcp-scopes-env.md).
//!
//! 메모리 안에서도 비밀은 [`Zeroizing`] 에 담아 드롭 순간 0 으로 덮고, [`Debug`] 는 손으로
//! 구현해 값 자리에 `***` 만 찍는다 — 실수로 `{:?}` 를 로그에 적어도 새지 않는다.
//!
//! ## 잠금 — **가림막이 걸리면 함께 잠긴다** (2026-09-19 저녁, 사용자 결정)
//!
//! 규칙이 하나다: **프라이버시 가림막(`app/veil`)이 걸리는 순간 금고도 잠근다.** 무입력
//! 자동 가림(`[lock] idle`)이든 손으로 누른 `Ctrl+Shift+B` 든 같고, **마스터 비밀번호가
//! 있든 없든** 같다. ③-3b1 부터는 **보는 창이 없어도** 잠근다 — GUI 가 마지막 창을 파괴할 때, 그리고 세션 서버가
//! 클라이언트 0 이 되는 순간(GUI kill 대비)이다([`LockReason::WindowsZero`] — 이 잠금은 HTTP 티켓을 폐기하지 않고
//! 정지한다). 서버가 끝나면 메모리와 함께 사라진다.
//!
//! 그래서 이 모듈에는 **자기 유휴 시계가 없다.** 앞선 판에는 `[vault] auto_lock_minutes` 와
//! `should_lock(last_used, now, minutes)` 가 있었고, "무엇이 타이머를 되감는가" 를 가르느라
//! 문이 둘(`with_open`/`peek_open`)이었다. 자리를 비우는 사건은 이미 가림막이 세고 있는데
//! 같은 사건을 두 번째 시계로 또 세면, 사용자는 두 칸(프라이버시 `무입력 자동 잠금` · 볼트
//! `자동 잠금`)을 맞춰 놓아야 "자리를 비우면 둘 다" 를 얻는다. 시계를 하나로 줄이고 그
//! 설정 칸을 지웠다 (`settings.toml` 의 옛 `[vault] auto_lock_minutes` 는 읽지 않지만
//! **지우지도 않는다** — `settings.rs` 의 `VaultPrefs` 가 그 칸을 그대로 왕복시킨다).
//!
//! 상태 셋의 뜻은 이렇다 ([`VaultState`]):
//!
//! | 상태 | 뜻 | 누가 만드는가 |
//! | --- | --- | --- |
//! | `Unopened` | 아직 디스크를 안 봤다 (앱 시작 직후) | 처음 · 파일이 사라졌을 때 |
//! | `Locked` | **사람이(또는 가림막·창 0개가) 잠갔다** | [`Vault::lock`] **하나뿐** |
//! | `Unlocked` | 열려 있다 | [`Vault::create`]·[`Vault::unlock`]·첫 사용(키 파일 금고) |
//!
//! `Unopened` 에서 [`ensure_open`] 은 디스크를 본다: 키 파일 금고는 **조용히 한 번 열고**,
//! 마스터 금고는 [`crate::errors::vault_locked`] 를 낸다(프런트가 그 이유 코드를 보고 잠금
//! 해제 모달을 연다). `Locked` 에서는 **어느 쪽도 열지 않는다** — 키 파일 금고가 가림막
//! 뒤에서 조용히 다시 열리면 "잠갔다" 가 거짓이 되기 때문이다. 그때 다시 여는 길은
//! [`Vault::unlock`] 하나이고, 마스터가 없는 금고에서는 그 문이 **빈 값 하나로 열린다**
//! (보호가 아니라 확인 관문이다 — 화면이 그렇게 말한다).
//!
//! 앱이 끝나면 프로세스와 함께 사라진다. 정직하게 적자면 **`static` 의 `Drop` 은 프로세스
//! 종료 때 돌지 않는다** — 그러니 "종료 시 지운다" 를 `Drop` 에 기대지 않는다. 대신 상태가
//! 바뀌는 모든 자리(잠금·재암호화·삭제)에서 옛 상태를 떨어뜨려 [`Zeroizing`] 이 덮게 한다.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use data_encoding::BASE64;
use zeroize::Zeroizing;

use crate::errors;
use crate::i18n::tr;

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/// 금고 파일 이름 — `<config_dir>/aynx/vault.bin`.
const VAULT_FILE: &str = "vault.bin";

/// 마스터 비밀번호가 **없을 때만** 있는 키 파일.
const KEY_FILE: &str = "vault.key";

/// 봉투 판. 형식을 바꾸면 올리고, 모르는 판은 **열지 않는다**(지어내지 않는다).
const VERSION: u32 = 1;

/// AEAD 키 길이(바이트).
const KEY_LEN: usize = 32;

/// XChaCha20 의 논스 길이(바이트). 24바이트라 무작위로 뽑아도 안전하다.
const NONCE_LEN: usize = 24;

/// Argon2id 소금 길이(바이트). `argon2::RECOMMENDED_SALT_LEN` 과 같은 값이다.
const SALT_LEN: usize = 16;

/// 기본 Argon2id 파라미터 — 64 MiB · 3회 · 1레인.
///
/// 메모리를 크게 잡는 것이 요점이다(GPU 사전 공격에 값을 물린다). 이 기계에서 한 번
/// 유도하는 데 드는 시간은 0.1초 안팎이고, 잠금 해제는 하루에 몇 번뿐이라 체감되지 않는다.
/// **값은 봉투 머리에 적히므로** 나중에 올려도 옛 금고가 그대로 열린다.
const DEFAULT_M_COST: u32 = 64 * 1024;
const DEFAULT_T_COST: u32 = 3;
const DEFAULT_P_COST: u32 = 1;

/// 손으로 고친 파일이 우리를 굶기지 못하게 하는 상한 — 1 GiB.
///
/// `m_cost` 는 그대로 할당량이다. 누가 `m_cost = 4000000000` 이 적힌 봉투를 놓아두면
/// 여는 순간 메모리를 다 먹는다. 여는 쪽에서 먼저 막는다.
const MAX_M_COST: u32 = 1024 * 1024;

/// 같은 이유의 상한 — 반복 횟수.
const MAX_T_COST: u32 = 64;

/// 값 하나의 길이 상한. 비밀번호·암호구는 길어야 수백 글자다.
const MAX_VALUE_LEN: usize = 4096;

/// 항목 수 상한. 호스트 수백 개를 넘길 이유가 없고, 손으로 부풀린 파일을 여기서 자른다.
const MAX_ENTRIES: usize = 2000;

/// 금고 파일 크기 상한 — 읽기 전에 본다.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// AAD 접두사. 판과 키 원천을 봉투에 묶는다 (모듈 머리말).
///
/// 이미 봉인된 `vault.bin` 이 이 글자를 AAD 로 들고 있어, 바꾸면 기존 볼트가 "열 수 없음" 이 된다 — 바꿀 일은
/// 옛 접두사로 한 번 더 열어 보고 새 접두사로 다시 봉인하는 길을 함께 만들 때뿐이다(AYNX 개명 때 그렇게 옮겼다).
/// 옛 형식에서 옮기는 길은 2026-10-22 2차에 걷었다 — 다시 봉인을 실기로 확인한 뒤
/// (docs/log/2026-10-22-rename-aynx.md). 키 파일 · DPAPI 감싸기는 접두사와 무관하다.
const AAD_PREFIX: &str = "aynx-vault/1/";

// ---------------------------------------------------------------------------
// 항목
// ---------------------------------------------------------------------------

/// 금고에 담기는 비밀의 종류. 대상(`target`)의 뜻이 종류마다 다르다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// 호스트 별칭(`~/.ssh/config` 의 `Host`)의 로그인 비밀번호.
    HostPassword,
    /// 개인키 **파일 경로**의 암호구.
    KeyPassphrase,
    /// 외부 MCP 서버의 환경변수·HTTP 헤더 비밀 값.
    McpEnv,
    /// 쿼리 타일 DB 연결의 비밀번호 — 대상은 **DB 연결의 고정 `id`**(`db-connections.json`, 호스트 별칭 아님 —
    /// 호스트 이름을 바꾸거나 경유 없는 연결에서도 같은 열쇠다). 모양은 [`db_conn_id_ok`].
    DbPassword,
}

/// DB 연결 id(볼트 `db_password` 의 대상이자 `db-connections.json` 의 `id`)의 모양 — 8~32자 `[A-Za-z0-9_-]`.
///
/// 규칙이 여기 있는 것은 **볼트 열쇠의 규칙**이기 때문이다(`db::conns::validate_one` 이 이것을 부른다 —
/// 볼트는 바닥 모듈이라 위로 부르지 않는다). 앞뒤 공백도 거절한다(다듬는 것은 부르는 쪽 몫).
pub(crate) fn db_conn_id_ok(id: &str) -> bool {
    (8..=32).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

impl Kind {
    /// 파일·프런트에 적히는 글자. **언어를 타지 않는 기계용 값**이다.
    fn wire(self) -> &'static str {
        match self {
            Kind::HostPassword => "host_password",
            Kind::KeyPassphrase => "key_passphrase",
            Kind::McpEnv => "mcp_env",
            Kind::DbPassword => "db_password",
        }
    }

    /// 대상이 담기는 JSON 칸 이름 — 종류마다 다르다(`alias` 대 `path`).
    fn target_field(self) -> &'static str {
        match self {
            Kind::HostPassword => "alias",
            Kind::KeyPassphrase => "path",
            Kind::McpEnv => "reference",
            Kind::DbPassword => "conn",
        }
    }

    fn parse(s: &str) -> Option<Kind> {
        match s {
            "host_password" => Some(Kind::HostPassword),
            "key_passphrase" => Some(Kind::KeyPassphrase),
            "mcp_env" => Some(Kind::McpEnv),
            "db_password" => Some(Kind::DbPassword),
            _ => None,
        }
    }
}

/// 금고 항목 하나. **값은 [`Zeroizing`] 이고 [`Debug`] 에 실리지 않는다.**
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Entry {
    kind: Kind,
    /// 호스트 별칭 또는 개인키 경로.
    target: String,
    value: Zeroizing<String>,
}

/// **손으로 구현한 이유가 이것이다** — 값 자리에 `***` 만 찍는다.
///
/// `#[derive(Debug)]` 였다면 `{entry:?}` 한 줄이 비밀번호를 콘솔에 뱉는다. 이 앱에는
/// `eprintln!` 이 여럿 있고, 새로 쓰는 사람이 그 위험을 매번 기억할 수는 없다.
impl std::fmt::Debug for Entry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Entry")
            .field("kind", &self.kind)
            .field("target", &self.target)
            .field("value", &"***")
            .finish()
    }
}

/// 파일에 적히는 모양 — `{ "kind": …, "alias"|"path"|"reference"|"conn": …, "value": … }`.
///
/// 직렬화를 손으로 쓰는 것은 **비밀을 한 번 더 복사하지 않기 위해서**다
/// (`&str` 로 빌려 준다 — 중간에 `String` 사본이 생기면 그 사본은 지워지지 않는다).
impl serde::Serialize for Entry {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(Some(3))?;
        m.serialize_entry("kind", self.kind.wire())?;
        m.serialize_entry(self.kind.target_field(), &self.target)?;
        m.serialize_entry("value", self.value.as_str())?;
        m.end()
    }
}

/// 읽을 때의 모양. 내부 태그(`kind`)로 갈린다.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WireEntry {
    HostPassword { alias: String, value: String },
    KeyPassphrase { path: String, value: String },
    McpEnv { reference: String, value: String },
    DbPassword { conn: String, value: String },
}

impl From<WireEntry> for Entry {
    /// `value` 를 **옮긴다**(복사하지 않는다) — 그 힙 버퍼가 그대로 [`Zeroizing`] 의 것이 되어
    /// 드롭 때 0 으로 덮인다.
    fn from(w: WireEntry) -> Entry {
        match w {
            WireEntry::McpEnv { reference, value } => Entry {
                kind: Kind::McpEnv,
                target: reference,
                value: Zeroizing::new(value),
            },
            WireEntry::HostPassword { alias, value } => Entry {
                kind: Kind::HostPassword,
                target: alias,
                value: Zeroizing::new(value),
            },
            WireEntry::KeyPassphrase { path, value } => Entry {
                kind: Kind::KeyPassphrase,
                target: path,
                value: Zeroizing::new(value),
            },
            WireEntry::DbPassword { conn, value } => Entry {
                kind: Kind::DbPassword,
                target: conn,
                value: Zeroizing::new(value),
            },
        }
    }
}

/// 쓰기용 평문 — 항목을 **빌려서** 직렬화한다.
#[derive(serde::Serialize)]
struct PlainOut<'a> {
    entries: &'a [Entry],
    updated_at: String,
}

/// 읽기용 평문.
#[derive(serde::Deserialize)]
struct PlainIn {
    #[serde(default)]
    entries: Vec<WireEntry>,
    #[serde(default)]
    #[allow(dead_code)] // 사람이 파일을 들여다볼 때를 위한 기록일 뿐 — 코드가 읽지 않는다.
    updated_at: String,
}

// ---------------------------------------------------------------------------
// 봉투
// ---------------------------------------------------------------------------

/// 키를 어디서 얻는가 — 봉투 머리에 적힌다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Kdf {
    /// 마스터 비밀번호 → Argon2id. 소금·파라미터가 **여기** 적혀 있어야 나중에 다시 연다.
    Argon2id {
        salt: String,
        m_cost: u32,
        t_cost: u32,
        p_cost: u32,
    },
    /// `vault.key` 의 32바이트. 적을 것이 없다.
    Keyfile,
}

impl Kdf {
    /// AAD 에 실리는 이름 — 봉투를 그 키 원천에 묶는다.
    fn tag(&self) -> &'static str {
        match self {
            Kdf::Argon2id { .. } => "argon2id",
            Kdf::Keyfile => "keyfile",
        }
    }

    fn has_master(&self) -> bool {
        matches!(self, Kdf::Argon2id { .. })
    }
}

/// 디스크에 적히는 것 전부.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Envelope {
    version: u32,
    kdf: Kdf,
    nonce: String,
    ciphertext: String,
}

// ---------------------------------------------------------------------------
// 열린 금고 (메모리 안)
// ---------------------------------------------------------------------------

/// 열려 있는 금고. **키와 값이 전부 [`Zeroizing`] 이다.**
struct Open {
    key: Zeroizing<[u8; KEY_LEN]>,
    /// 어떤 키 원천으로 열었는가 — 다시 쓸 때 소금·파라미터를 그대로 재사용한다.
    kdf: Kdf,
    entries: Vec<Entry>,
}

/// [`Entry`] 와 같은 이유로 손으로 쓴다 — 키도 값도 찍히지 않는다.
impl std::fmt::Debug for Open {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Open")
            .field("key", &"***")
            .field("kdf", &self.kdf.tag())
            .field("entries", &self.entries.len())
            .finish()
    }
}

impl Open {
    fn find(&self, kind: Kind, target: &str) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|e| e.kind == kind && e.target == target)
    }

    /// 같은 (종류, 대상) 이 있으면 **갈아 끼우고** 없으면 뒤에 붙인다.
    fn put(&mut self, kind: Kind, target: String, value: Zeroizing<String>) {
        match self
            .entries
            .iter_mut()
            .find(|e| e.kind == kind && e.target == target)
        {
            Some(slot) => slot.value = value,
            None => self.entries.push(Entry {
                kind,
                target,
                value,
            }),
        }
    }
}

/// 금고의 지금 상태 — 모듈 머리말의 표 그대로다.
///
/// `Unopened` 는 "파일이 없다" 이자 **"아직 디스크를 안 봤다"** 이다 — 두 상태를 나누지 않는
/// 것이 의도다. [`ensure_open`] 은 이 상태에서 언제나 디스크를 다시 보므로, 앱 밖에서 금고가
/// 생기거나 사라져도 다음 호출이 곧바로 따라잡는다.
///
/// **`Locked` 를 놓는 것은 [`Vault::lock`] 하나뿐이다.** 그래야 "잠겼다" 가 언제나 사람의(또는
/// 가림막의) 결정을 뜻하고, 조회 한 번이 등 뒤에서 상태를 바꾸는 일이 없다.
#[derive(Debug)]
enum VaultState {
    Unopened,
    Locked,
    Unlocked(Open),
}

// ---------------------------------------------------------------------------
// OS 를 타는 자리 ① — 키 파일 감싸기 (DPAPI)
// ---------------------------------------------------------------------------

/// `vault.key` 에 적을 바이트로 감싼다 — **OS 분기는 이 함수 하나뿐이다**(CLAUDE.md,
/// [`crate::cwd::child_cwd`] 와 같은 꼴).
///
/// - **Windows**: DPAPI `CryptProtectData`. 결과는 **이 사용자 계정**으로만 풀린다 — 설정
///   폴더를 통째로 복사해 간 파일이 다른 기계·다른 계정에서 열리지 않는다.
/// - **그 밖**: **항등(감싸지 않는다)**. 스텁이고, 이 파일이 그 사실의 기록이다. 그때
///   지켜 주는 것은 파일 권한(0600)뿐이다. Linux 는 libsecret·kwallet, macOS 는 Keychain 이
///   이 자리의 답이지만 **실기에서 시험할 기계가 없으므로 지어내지 않는다** —
///   그 OS 에서는 "마스터 비밀번호를 쓰라" 가 정직한 권유다(화면이 그렇게 말해야 한다).
fn protect_key_bytes(raw: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    let out = dpapi(raw, DpapiWay::Protect);

    #[cfg(not(windows))]
    let out = Ok(raw.to_vec());

    out
}

/// [`protect_key_bytes`] 의 역방향. 같은 규칙, 같은 한 함수.
fn unprotect_key_bytes(wrapped: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    let out = dpapi(wrapped, DpapiWay::Unprotect);

    #[cfg(not(windows))]
    let out = Ok(wrapped.to_vec());

    out
}

/// DPAPI 를 어느 방향으로 부르는가.
#[cfg(windows)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum DpapiWay {
    Protect,
    Unprotect,
}

/// Windows DPAPI 한 쌍 — `CryptProtectData` / `CryptUnprotectData`.
///
/// 규칙 셋(`cwd.rs` 의 PEB 걷기와 같다): **패닉하지 않는다 · 반환 버퍼를 반드시 `LocalFree`
/// 한다 · 실패는 문구가 붙은 `Err` 다**.
///
/// 추가 엔트로피(`poptionalentropy`)는 **일부러 쓰지 않는다**. 그 값은 우리 바이너리 안의
/// 상수가 될 수밖에 없고, 바이너리는 공격자도 갖고 있다 — 지켜 주는 것이 없으면서 형식만
/// 굳어진다(나중에 바꾸면 옛 키 파일이 안 열린다). DPAPI 가 실제로 묶어 주는 것은
/// **사용자 계정**이고, 그것이 이 원천의 전부다.
#[cfg(windows)]
fn dpapi(input: &[u8], way: DpapiWay) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let len = u32::try_from(input.len())
        .map_err(|_| tr!(ko: "금고 키가 너무 깁니다", en: "The vault key is too long"))?;
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: len,
        // DPAPI 는 입력을 읽기만 한다 — 시그니처가 `*mut` 일 뿐이다.
        pbData: input.as_ptr().cast_mut(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // UI_FORBIDDEN: 이 경로는 세션 열기 도중에도 불릴 수 있다 — 어떤 경우에도 OS 대화상자를
    // 띄우지 않는다(띄우면 블로킹 풀 스레드에서 사람을 기다리며 멈춘다).
    let ok = unsafe {
        match way {
            DpapiWay::Protect => CryptProtectData(
                &in_blob,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            ),
            DpapiWay::Unprotect => CryptUnprotectData(
                &in_blob,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            ),
        }
    };

    if ok == 0 || out_blob.pbData.is_null() {
        return Err(match way {
            DpapiWay::Protect => tr!(
                ko: "금고 키를 이 계정으로 보호하지 못했습니다 (DPAPI)",
                en: "Could not protect the vault key for this account (DPAPI)",
            ),
            DpapiWay::Unprotect => tr!(
                ko: "금고 키를 풀지 못했습니다 — 다른 계정이나 다른 기계에서 만든 파일일 수 \
                     있습니다 (DPAPI)",
                en: "Could not unwrap the vault key — the file may have been created by a \
                     different account or machine (DPAPI)",
            ),
        });
    }

    let out =
        unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize) }.to_vec();
    // 어느 갈래로 나가든 반드시 돌려준다 — 위의 이른 반환에는 버퍼가 없다.
    unsafe { LocalFree(out_blob.pbData.cast()) };
    Ok(out)
}

// ---------------------------------------------------------------------------
// OS 를 타는 자리 ② — 파일 권한
// ---------------------------------------------------------------------------

/// 파일을 소유자만 읽게 만든다 — **OS 분기는 이 함수 하나뿐이다**.
///
/// Windows 는 [`crate::keygen`] 의 `restrict_dir` 과 같은 이유로 **일부러 아무것도 하지
/// 않는다**: 사용자 프로필 아래 새 파일은 상속 ACL 만으로 이미 그 사용자(+관리자)에게만
/// 열려 있고, ACL 을 직접 손대려면 얻는 것 없이 표면만 넓어진다.
pub(crate) fn restrict_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    let done = {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|e| {
            tr!(
                ko: "{path} 의 권한을 좁히지 못했습니다: {e}",
                en: "Could not restrict the permissions of {path}: {e}",
                path = path.display(),
            )
        })
    };

    #[cfg(not(unix))]
    let done = {
        let _ = path;
        Ok(())
    };

    done
}

// ---------------------------------------------------------------------------
// 파일 입출력
// ---------------------------------------------------------------------------

fn vault_path(dir: &Path) -> PathBuf {
    dir.join(VAULT_FILE)
}

fn key_path(dir: &Path) -> PathBuf {
    dir.join(KEY_FILE)
}

/// **임시 파일 + rename**. 중간에 끊겨도 반쯤 쓰인 금고가 남지 않는다.
///
/// 임시 이름은 `<이름>.tmp` 다 — 확장자를 갈아 끼우면(`with_extension`) `vault.bin` 과
/// `vault.key` 가 **같은 임시 이름**(`vault.tmp`)을 쓰게 되어, 둘을 잇달아 쓰는
/// [`set_master_at`] 에서 서로를 덮는다.
///
/// 실패하면 임시 파일을 치운다 — 성공한 쓰기 뒤에 `.tmp` 가 남지 않는 것이 이 함수의 계약이다.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let dir = path.parent().ok_or_else(
        || tr!(ko: "금고 폴더를 찾을 수 없습니다", en: "Could not find the vault folder"),
    )?;
    std::fs::create_dir_all(dir).map_err(|e| {
        tr!(
            ko: "{dir} 폴더를 만들지 못했습니다: {e}",
            en: "Could not create the folder {dir}: {e}",
            dir = dir.display(),
        )
    })?;

    let mut name = path
        .file_name()
        .ok_or_else(|| tr!(ko: "금고 파일 이름이 없습니다", en: "The vault file has no name"))?
        .to_os_string();
    name.push(".tmp");
    let tmp = dir.join(name);

    let write = || -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        // 이름을 바꾸기 **전에** 내용을 디스크로 내린다. 그러지 않으면 전원이 끊겼을 때
        // "이름은 새것인데 내용이 비어 있는" 금고가 남는다.
        f.sync_all()
    };
    if let Err(e) = write() {
        let _ = std::fs::remove_file(&tmp);
        return Err(tr!(
            ko: "{path} 를 쓰지 못했습니다: {e}",
            en: "Could not write {path}: {e}",
            path = path.display(),
        ));
    }
    if let Err(e) = restrict_file(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    // `std::fs::rename` 은 Windows 에서도 대상이 있으면 덮는다(MOVEFILE_REPLACE_EXISTING).
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(tr!(
            ko: "{path} 를 바꿔 넣지 못했습니다: {e}",
            en: "Could not swap in {path}: {e}",
            path = path.display(),
        ));
    }
    Ok(())
}

/// 봉투를 읽는다. 파일이 없으면 `Ok(None)` — **오류가 아니다**(금고를 아직 안 만든 사람이다).
fn read_envelope(dir: &Path) -> Result<Option<Envelope>, String> {
    let path = vault_path(dir);
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(tr!(
                ko: "{path} 를 읽지 못했습니다: {e}",
                en: "Could not read {path}: {e}",
                path = path.display(),
            ))
        }
    };
    if meta.len() > MAX_FILE_BYTES {
        return Err(tr!(
            ko: "금고 파일이 너무 큽니다 — 금고가 아닌 파일일 수 있습니다",
            en: "The vault file is too large — it may not be a vault",
        ));
    }
    let raw = std::fs::read(&path).map_err(|e| {
        tr!(
            ko: "{path} 를 읽지 못했습니다: {e}",
            en: "Could not read {path}: {e}",
            path = path.display(),
        )
    })?;
    let env: Envelope = serde_json::from_slice(&raw).map_err(|e| {
        tr!(
            ko: "금고 파일을 해석하지 못했습니다: {e}",
            en: "Could not parse the vault file: {e}",
        )
    })?;
    if env.version != VERSION {
        // **지어내지 않는다** — 모르는 판을 아는 척 열면 옛 앱이 새 금고를 망가뜨린다.
        return Err(tr!(
            ko: "이 금고는 더 새로운 판(v{v})입니다 — 앱을 최신으로 올리세요",
            en: "This vault is a newer version (v{v}) — update the app",
            v = env.version,
        ));
    }
    Ok(Some(env))
}

// ---------------------------------------------------------------------------
// 키 유도
// ---------------------------------------------------------------------------

/// OS 엔트로피 `N` 바이트. 못 얻으면 **키를 만들지 않는다** (`mcp.rs` 의 토큰과 같은 판단 —
/// 예측 가능한 키로 금고를 만드느니 안 만든다).
fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).map_err(|e| {
        tr!(
            ko: "무작위 바이트를 얻지 못했습니다: {e}",
            en: "Could not get random bytes: {e}",
        )
    })?;
    Ok(buf)
}

/// Argon2id — 마스터 비밀번호에서 32바이트를 만든다.
///
/// 파라미터는 **봉투가 준 것**을 쓴다(우리 기본값이 아니다) — 그래야 파라미터를 올린 뒤에도
/// 옛 금고가 열린다. 다만 손으로 부풀린 값에 굶지 않도록 [`MAX_M_COST`]·[`MAX_T_COST`] 로
/// 먼저 막는다.
fn derive_from_master(
    master: &str,
    salt: &[u8],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    if m_cost > MAX_M_COST || t_cost > MAX_T_COST {
        return Err(tr!(
            ko: "금고 머리의 KDF 파라미터가 허용 범위를 벗어났습니다",
            en: "The KDF parameters in the vault header are out of range",
        ));
    }
    let params = Params::new(m_cost, t_cost, p_cost, Some(KEY_LEN)).map_err(|e| {
        tr!(
            ko: "금고 KDF 파라미터가 올바르지 않습니다: {e}",
            en: "The vault KDF parameters are not valid: {e}",
        )
    })?;
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(master.as_bytes(), salt, key.as_mut())
        .map_err(|e| {
            tr!(
                ko: "마스터 비밀번호에서 키를 만들지 못했습니다: {e}",
                en: "Could not derive a key from the master password: {e}",
            )
        })?;
    Ok(key)
}

/// `vault.key` 를 읽어 32바이트를 꺼낸다 ([`unprotect_key_bytes`] 를 지난다).
fn read_key_file(dir: &Path) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let path = key_path(dir);
    let wrapped = std::fs::read(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            tr!(
                ko: "금고 키 파일이 없습니다 ({path}) — 이 금고는 열 수 없습니다",
                en: "The vault key file is missing ({path}) — this vault cannot be opened",
                path = path.display(),
            )
        } else {
            tr!(
                ko: "{path} 를 읽지 못했습니다: {e}",
                en: "Could not read {path}: {e}",
                path = path.display(),
            )
        }
    })?;
    let raw = Zeroizing::new(unprotect_key_bytes(&wrapped)?);
    let bytes: [u8; KEY_LEN] = raw.as_slice().try_into().map_err(|_| {
        tr!(
            ko: "금고 키 파일의 길이가 맞지 않습니다",
            en: "The vault key file has the wrong length",
        )
    })?;
    Ok(Zeroizing::new(bytes))
}

/// 봉투의 머리를 보고 키를 얻는다.
fn derive_key(
    dir: &Path,
    kdf: &Kdf,
    master: Option<&str>,
) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    match kdf {
        Kdf::Argon2id {
            salt,
            m_cost,
            t_cost,
            p_cost,
        } => {
            let master = master.ok_or_else(errors::vault_locked)?;
            let salt = BASE64.decode(salt.as_bytes()).map_err(|_| {
                tr!(
                    ko: "금고 머리의 소금을 읽지 못했습니다",
                    en: "Could not read the salt in the vault header",
                )
            })?;
            derive_from_master(master, &salt, *m_cost, *t_cost, *p_cost)
        }
        Kdf::Keyfile => read_key_file(dir),
    }
}

// ---------------------------------------------------------------------------
// 암·복호화
// ---------------------------------------------------------------------------

fn cipher_for(key: &[u8; KEY_LEN]) -> Result<XChaCha20Poly1305, String> {
    XChaCha20Poly1305::new_from_slice(key).map_err(
        |_| tr!(ko: "금고 키의 길이가 맞지 않습니다", en: "The vault key has the wrong length"),
    )
}

/// 항목을 봉투로 만든다 — 논스는 **매번 새로** 뽑는다.
fn seal(key: &[u8; KEY_LEN], kdf: &Kdf, entries: &[Entry]) -> Result<Envelope, String> {
    let plain = Zeroizing::new(
        serde_json::to_vec(&PlainOut {
            entries,
            updated_at: chrono::Local::now().to_rfc3339(),
        })
        .map_err(|e| {
            tr!(
                ko: "금고 내용을 JSON 으로 바꾸지 못했습니다: {e}",
                en: "Could not turn the vault contents into JSON: {e}",
            )
        })?,
    );

    let nonce_bytes = random::<NONCE_LEN>()?;
    let nonce = XNonce::try_from(&nonce_bytes[..])
        .map_err(|_| tr!(ko: "논스를 만들지 못했습니다", en: "Could not build the nonce"))?;
    let aad = format!("{AAD_PREFIX}{}", kdf.tag());
    let ciphertext = cipher_for(key)?
        .encrypt(
            &nonce,
            Payload {
                msg: plain.as_slice(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| tr!(ko: "금고를 암호화하지 못했습니다", en: "Could not encrypt the vault"))?;

    Ok(Envelope {
        version: VERSION,
        kdf: kdf.clone(),
        nonce: BASE64.encode(&nonce_bytes),
        ciphertext: BASE64.encode(&ciphertext),
    })
}

/// 봉투를 연다. **실패는 언제나 `Err` 이고 절대 패닉하지 않는다** — 한 바이트만 뒤집혀도
/// Poly1305 태그가 어긋나 여기로 온다.
fn unseal(key: &[u8; KEY_LEN], env: &Envelope) -> Result<Vec<Entry>, String> {
    let nonce_bytes = BASE64.decode(env.nonce.as_bytes()).map_err(
        |_| tr!(ko: "금고 논스를 읽지 못했습니다", en: "Could not read the vault nonce"),
    )?;
    let nonce = XNonce::try_from(&nonce_bytes[..]).map_err(
        |_| tr!(ko: "금고 논스의 길이가 맞지 않습니다", en: "The vault nonce has the wrong length"),
    )?;
    let ciphertext = BASE64
        .decode(env.ciphertext.as_bytes())
        .map_err(|_| tr!(ko: "금고 본문을 읽지 못했습니다", en: "Could not read the vault body"))?;
    let aad = format!("{AAD_PREFIX}{}", env.kdf.tag());

    // 여기서 갈리는 것은 "키가 틀렸다" 와 "파일이 상했다" 인데, AEAD 는 둘을 구분해 주지
    // 않는다 — 구분해 주는 척하는 문구는 공격자에게 신탁이 된다 (`errors::vault_wrong_master`).
    let plain = Zeroizing::new(
        cipher_for(key)?
            .decrypt(
                &nonce,
                Payload {
                    msg: &ciphertext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| errors::vault_wrong_master())?,
    );

    let parsed: PlainIn = serde_json::from_slice(plain.as_slice()).map_err(|e| {
        tr!(
            ko: "금고 내용을 해석하지 못했습니다: {e}",
            en: "Could not parse the vault contents: {e}",
        )
    })?;
    let mut entries: Vec<Entry> = parsed.entries.into_iter().map(Entry::from).collect();
    entries.truncate(MAX_ENTRIES);
    Ok(entries)
}

// ---------------------------------------------------------------------------
// 폴더를 받는 층 (테스트 대상)
// ---------------------------------------------------------------------------

/// 갓 만든 키 원천 — 아직 디스크에 닿지 않은 한 벌.
struct Source {
    kdf: Kdf,
    key: Zeroizing<[u8; KEY_LEN]>,
    /// 키 파일 원천일 때만 `Some` — `vault.key` 에 (감싸서) 적을 바이트다.
    key_file: Option<Zeroizing<[u8; KEY_LEN]>>,
}

/// 새 키 원천을 만든다 — 마스터가 있으면 소금을 뽑고, 없으면 키 파일 바이트를 뽑는다.
///
/// **아직 아무것도 쓰지 않는다.** 쓰는 순서는 [`commit`] 이 정한다.
fn new_source(
    master: Option<&str>,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Source, String> {
    match master {
        Some(master) => {
            let salt = random::<SALT_LEN>()?;
            let key = derive_from_master(master, &salt, m_cost, t_cost, p_cost)?;
            Ok(Source {
                kdf: Kdf::Argon2id {
                    salt: BASE64.encode(&salt),
                    m_cost,
                    t_cost,
                    p_cost,
                },
                key,
                key_file: None,
            })
        }
        None => {
            let bytes = Zeroizing::new(random::<KEY_LEN>()?);
            Ok(Source {
                kdf: Kdf::Keyfile,
                key: bytes.clone(),
                key_file: Some(bytes),
            })
        }
    }
}

/// 새 키 원천으로 항목을 **다시 암호화해 디스크에 못 박는다**.
///
/// 순서가 곧 안전이다:
/// 1. 키 파일을 써야 하면 **먼저** 쓴다 (없으면 뒤의 금고를 열 수 없다).
/// 2. 금고 본문을 쓴다.
/// 3. 마스터로 바뀌었으면 그제야 키 파일을 **지운다**.
///
/// 뒤집으면 2번이 실패했을 때 열 수 없는 금고가 남는다. 이 순서에서는 어느 단계가
/// 실패해도 **직전까지의 금고가 그대로 열린다**(남는 것은 쓸모없는 키 파일 하나뿐이다).
fn commit(dir: &Path, source: &Source, entries: &[Entry]) -> Result<(), String> {
    let Source { kdf, key, key_file } = source;
    if let Some(bytes) = key_file {
        let wrapped = protect_key_bytes(bytes.as_slice())?;
        write_atomic(&key_path(dir), &wrapped)?;
    }

    let env = seal(key, kdf, entries)?;
    let body = serde_json::to_vec_pretty(&env).map_err(|e| {
        tr!(
            ko: "금고 봉투를 JSON 으로 바꾸지 못했습니다: {e}",
            en: "Could not turn the vault envelope into JSON: {e}",
        )
    })?;
    write_atomic(&vault_path(dir), &body)?;

    if kdf.has_master() {
        // 마스터가 걸린 금고 옆에 남은 키 파일은 **아무것도 열지 못하지만** 사람을 헷갈리게
        // 한다 ("키 파일이 있는데 왜 물어보지?"). 여기서 치운다. 실패는 치명적이지 않다.
        let _ = std::fs::remove_file(key_path(dir));
    }
    Ok(())
}

/// 금고를 새로 만든다. **이미 있으면 거절한다** — 덮어쓰면 담겨 있던 비밀이 한 번에 사라진다.
fn create_at(
    dir: &Path,
    master: Option<&str>,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Open, String> {
    if vault_path(dir).exists() {
        return Err(errors::exists(&vault_path(dir).display().to_string()));
    }
    let source = new_source(master, m_cost, t_cost, p_cost)?;
    commit(dir, &source, &[])?;
    Ok(Open {
        key: source.key,
        kdf: source.kdf,
        entries: Vec::new(),
    })
}

/// 금고를 연다. 파일이 없으면 [`errors::vault_absent`].
fn open_at(dir: &Path, master: Option<&str>) -> Result<Open, String> {
    let env = read_envelope(dir)?.ok_or_else(errors::vault_absent)?;
    let key = derive_key(dir, &env.kdf, master)?;
    let entries = unseal(&key, &env)?;
    Ok(Open {
        key,
        kdf: env.kdf,
        entries,
    })
}

/// 열려 있는 금고를 **같은 키로** 다시 쓴다 (항목이 바뀐 뒤).
///
/// `key_file: None` — 키 파일은 이미 제자리에 있다(있어야 이 금고가 열렸다).
fn save_at(dir: &Path, open: &Open) -> Result<(), String> {
    commit(
        dir,
        &Source {
            kdf: open.kdf.clone(),
            key: open.key.clone(),
            key_file: None,
        },
        &open.entries,
    )
}

/// 키 원천을 바꾼다 — 마스터를 걸거나 풀거나 갈아 끼운다.
///
/// **바꾸려면 지금 열 수 있어야 한다.** 현재 마스터를 모르면 항목을 옮길 수 없고, 못 옮기면
/// "바꾼다" 가 아니라 "버린다" 다.
fn set_master_at(
    dir: &Path,
    new: Option<&str>,
    current: Option<&str>,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Open, String> {
    let old = open_at(dir, current)?;
    let source = new_source(new, m_cost, t_cost, p_cost)?;
    commit(dir, &source, &old.entries)?;
    Ok(Open {
        key: source.key,
        kdf: source.kdf,
        entries: old.entries,
    })
}

// ---------------------------------------------------------------------------
// 살아 있는 금고 한 벌 — **세션 서버 프로세스 안에만 있다** (③-3b1)
// ---------------------------------------------------------------------------

/// `<config_dir>/aynx` — 설정과 같은 폴더다.
fn app_dir() -> Result<PathBuf, String> {
    crate::instance::config_root().ok_or_else(|| {
        tr!(
            ko: "설정 디렉터리를 찾을 수 없습니다",
            en: "Could not find the settings folder",
        )
    })
}

/// 상태를 "지금 쓸 수 있는 금고" 로 만든다 — **순수한 상태 기계**다(모듈 머리말의 표).
///
/// - `Unlocked` → 그대로 둔다.
/// - `Locked` → [`errors::vault_locked`]. **디스크를 보지 않는다** — 여기서 키 파일 금고를
///   조용히 다시 열면 가림막이 건 잠금이 거짓말이 된다.
/// - `Unopened` → 디스크를 본다. 파일이 없으면 [`errors::vault_absent`], 키 파일 금고는
///   **조용히 한 번 열고**, 마스터 금고는 [`errors::vault_locked`] 다(상태는 `Unopened` 인
///   채로 둔다 — 잠근 것은 사람이 아니라 "아직 안 열었다" 이기 때문이다).
///
/// **디스크를 읽는다** — 블로킹 문맥에서만 부른다.
fn ensure_open(state: &mut VaultState, dir: &Path) -> Result<(), String> {
    match state {
        VaultState::Unlocked(_) => return Ok(()),
        VaultState::Locked => return Err(errors::vault_locked()),
        VaultState::Unopened => {}
    }

    match read_envelope(dir)? {
        None => Err(errors::vault_absent()),
        Some(env) if env.kdf.has_master() => Err(errors::vault_locked()),
        Some(_) => {
            *state = VaultState::Unlocked(open_at(dir, None)?);
            Ok(())
        }
    }
}

/// 잠근 까닭 — **티켓을 어떻게 다룰지**가 이것으로 갈린다(`server::vault_ops` — 2026-10-09 결정 4).
///
/// | 까닭 | 누가 | HTTP 헤더 프록시 티켓 |
/// | --- | --- | --- |
/// | `Shade` | 가림막(무입력 자동·`Ctrl+Shift+B`) | **폐기** — 해제해도 되살지 않는다(새 AI 타일이 새 티켓) |
/// | `User` | 설정 › 보안 [잠그기] | 폐기(가림막과 같다) |
/// | `WindowsZero` | GUI 의 마지막 창 파괴 · 세션 서버의 클라이언트 0 | **정지** — 잠긴 동안 503, 해제하면 같은 티켓이 되산다 |
///
/// stdio 실행 티켓은 어느 까닭에도 지우지 않는다(예전 그대로 — 잠긴 동안 브로커가 값을 내주지 않을 뿐).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LockReason {
    Shade,
    User,
    WindowsZero,
}

impl LockReason {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            LockReason::Shade => "shade",
            LockReason::User => "user",
            LockReason::WindowsZero => "windows_zero",
        }
    }

    pub(crate) fn parse(s: &str) -> Option<LockReason> {
        match s {
            "shade" => Some(LockReason::Shade),
            "user" => Some(LockReason::User),
            "windows_zero" => Some(LockReason::WindowsZero),
            _ => None,
        }
    }
}

/// [`Vault::verify_master`] 의 답 — 값이 없는 네 갈래.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MasterCheck {
    /// 맞다.
    Ok,
    /// 틀렸다(빈 값 포함).
    Bad,
    /// 금고는 있지만 마스터가 없다(키 파일 금고).
    NoMaster,
    /// 금고가 없다.
    NoVault,
}

impl MasterCheck {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            MasterCheck::Ok => "ok",
            MasterCheck::Bad => "bad",
            MasterCheck::NoMaster => "no-master",
            MasterCheck::NoVault => "no-vault",
        }
    }
}

/// 상태 한 칸 + 잠근 까닭 — 한 락 안에서 함께 바뀐다.
#[derive(Debug)]
struct Inner {
    state: VaultState,
    /// 지금 `Locked` 인 까닭(아니면 `None`).
    reason: Option<LockReason>,
    /// **열려 있던** 금고를 창 0개 잠금이 닫았다 — 다음에 붙는 GUI 가 가림막(관문)을 세운다(`VaultStatus::relock`).
    relock: bool,
    /// 잠금 세대 — [`Vault::lock`] 이 올린다. 열기·만들기·키 원천 바꾸기는 느린 일(KDF·디스크)을 락 **밖**에서 하므로,
    /// 시작할 때 세대를 쥐고 끝나서 락 안에서 같을 때만 연다 — 그 사이에 걸린 잠금(가림막·창 0개)을 늦게 끝난 열기가
    /// 되돌리지 못하게(재리뷰 R01, 2026-10-10).
    generation: u64,
}

/// 금고 한 벌 — 열림·잠김 상태, 아직 설정에 안 나타난 MCP 참조(`pending`), 그리고 폴더.
///
/// **③-3b1 부터 세션 서버 프로세스에만 있다**(`server::serve` 가 한 벌 만들어 쥔다). GUI 프로세스에는 이 값이 없다 —
/// GUI 의 `vault_*` Tauri 명령은 같은 이름의 서버 op 프록시다(`server::vault_proxy`). 그래서 볼트 값은 서버 프로세스
/// 밖으로 나가지 않는다(파이프에는 상태·종류·대상·참조뿐 — 예외는 b2 까지의 과도기 op 하나, `server::vault_ops` 머리말).
///
/// 서버가 끝나면(정상·크래시) 메모리와 함께 사라진다 — 잠긴 것과 같다(파일은 늘 암호화 상태).
pub(crate) struct Vault {
    /// `None` 이면 [`crate::instance::config_root`] — 시험은 임시 폴더를 준다.
    dir: Option<PathBuf>,
    inner: Mutex<Inner>,
    /// 아직 저장된 설정에 나타나지 않은 참조. 다른 창의 저장이 진행 중인 편집을 지우지 않는다.
    /// 새 참조 저장과 정리는 이 락을 먼저 쥐고 inner 락을 쥔다.
    pending: Mutex<HashSet<String>>,
}

impl std::fmt::Debug for Vault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Vault").field("dir", &self.dir).finish_non_exhaustive()
    }
}

/// 잠금을 쥔다. **오염(poison)은 무시한다** — 지키는 것이 불변식이 아니라 상태 한 칸이고,
/// 모든 쓰기가 "통째로 갈아 끼우기" 라 반쯤 바뀐 값이 남을 수 없다
/// (`lib.rs` 의 `NET_TEST_LOCK` 과 같은 판단).
fn lock_ignoring_poison<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 금고의 지금 모습 — **값도, 대상 목록도 들어 있지 않다**.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    /// `"absent"` · `"locked"` · `"unlocked"`.
    pub state: &'static str,
    /// 마스터 비밀번호가 걸려 있는가. **잠금 해제 모달이 칸을 세울지가 이것으로 갈린다** —
    /// 거짓이면 빈 값 하나(Enter)로 열리는 확인 관문이다 (모듈 머리말의 "잠금").
    pub has_master: bool,
    /// 열려 있을 때만 실제 개수, 아니면 0.
    pub entry_count: usize,
    /// 잠긴 까닭(`"shade"`·`"user"`·`"windows_zero"`) — 잠겨 있지 않으면 `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_reason: Option<&'static str>,
    /// 열려 있던 금고를 창 0개 잠금이 닫았다 — 붙는 GUI 가 가림막을 **잠그지 않고**(티켓 정지를 폐기로 바꾸지 않게) 세운다.
    pub relock: bool,
}

/// 금고에 무엇이 들어 있는가 — **종류와 대상뿐이다**.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct VaultItem {
    /// `"host_password"` · `"key_passphrase"` · `"mcp_env"` · `"db_password"`.
    pub kind: &'static str,
    /// 호스트 별칭 · 개인키 경로 · MCP 참조 · DB 연결 id.
    pub target: String,
}

pub(crate) fn parse_kind(kind: &str) -> Result<Kind, String> {
    Kind::parse(kind).ok_or_else(|| {
        tr!(
            ko: "알 수 없는 금고 항목 종류입니다: {kind}",
            en: "Unknown vault entry type: {kind}",
        )
    })
}

/// 값 하나를 받아들일 수 있는지 — 빈 값은 "지우기" 가 아니라 **실수**다.
fn check_value(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(tr!(
            ko: "빈 값은 저장하지 않습니다",
            en: "An empty value is not stored",
        ));
    }
    if value.len() > MAX_VALUE_LEN {
        return Err(tr!(
            ko: "값이 너무 깁니다",
            en: "The value is too long",
        ));
    }
    Ok(())
}

fn check_target(target: &str) -> Result<(), String> {
    if target.trim().is_empty() {
        return Err(tr!(
            ko: "대상을 지정하세요",
            en: "Specify a target",
        ));
    }
    Ok(())
}

fn vault_full() -> String {
    tr!(
        ko: "금고에 담을 수 있는 항목 수를 넘었습니다",
        en: "The vault is full",
    )
}

/// 모든 메서드는 **디스크를 읽을 수 있다** — 블로킹 문맥에서만 부른다(서버는 `spawn_blocking`).
impl Vault {
    /// 새 한 벌 — `dir` 이 `None` 이면 앱 설정 폴더(dev·release 자동 분리 — `instance`).
    pub(crate) fn new(dir: Option<PathBuf>) -> Vault {
        Vault {
            dir,
            inner: Mutex::new(Inner {
                state: VaultState::Unopened,
                reason: None,
                relock: false,
                generation: 0,
            }),
            pending: Mutex::new(HashSet::new()),
        }
    }

    fn dir(&self) -> Result<PathBuf, String> {
        match &self.dir {
            Some(d) => Ok(d.clone()),
            None => app_dir(),
        }
    }

    fn inner(&self) -> std::sync::MutexGuard<'_, Inner> {
        lock_ignoring_poison(&self.inner)
    }

    /// 느린 상태 바꾸기의 첫 단계 — 지금 잠금 세대를 쥔다(KDF 전에 부른다).
    fn begin(&self) -> u64 {
        self.inner().generation
    }

    /// 느린 상태 바꾸기의 끝 — 열림으로 갈아 끼우고 잠근 까닭을 지운다. **`begin` 뒤에 잠금이 걸렸으면 열지 않고**
    /// `[vault-locked]` 다(`open` 은 버려지며 0 으로 덮인다 — 상태·까닭·relock 은 그 잠금이 놓은 그대로).
    fn apply_unlocked(&self, generation: u64, open: Open) -> Result<(), String> {
        let mut g = self.inner();
        if g.generation != generation {
            return Err(errors::vault_locked());
        }
        g.state = VaultState::Unlocked(open);
        g.reason = None;
        g.relock = false;
        Ok(())
    }

    /// 열린 금고 위에서 무언가를 한다 — **모든 조회·쓰기가 지나는 문 하나**.
    ///
    /// 클로저가 `true` 를 돌려주면 항목이 바뀐 것이므로 디스크에 다시 쓴다.
    fn with_open<T>(&self, f: impl FnOnce(&mut Open) -> Result<(T, bool), String>) -> Result<T, String> {
        let dir = self.dir()?;
        let mut g = self.inner();
        ensure_open(&mut g.state, &dir)?;
        let VaultState::Unlocked(open) = &mut g.state else {
            // `ensure_open` 이 `Ok` 를 줬다면 여기는 도달하지 않는다.
            return Err(errors::vault_locked());
        };
        let (out, dirty) = f(open)?;
        if dirty {
            save_at(&dir, open)?;
        }
        Ok(out)
    }

    // ── 백엔드 전용 조회 — **여기서만 값이 나온다** ─────────────────────────

    /// 호스트 별칭의 저장된 비밀번호. 없거나 금고가 잠겼으면 `None` — 잠긴 금고가 접속을 **실패**시키면 안 된다.
    pub(crate) fn password_for(&self, alias: &str) -> Option<Zeroizing<String>> {
        self.with_open(|open| Ok((open.find(Kind::HostPassword, alias).map(|e| e.value.clone()), false)))
            .ok()?
    }

    /// 개인키 파일 경로의 저장된 암호구. [`Vault::password_for`] 와 같은 규칙.
    pub(crate) fn passphrase_for(&self, path: &str) -> Option<Zeroizing<String>> {
        self.with_open(|open| Ok((open.find(Kind::KeyPassphrase, path).map(|e| e.value.clone()), false)))
            .ok()?
    }

    /// DB 연결 id 의 저장된 비밀번호 — 서버 안 DB 드라이버만 읽는다. [`Vault::password_for`] 와 같은 규칙
    /// (없거나 잠겼으면 `None` — 부르는 쪽이 사람에게 다시 묻는다).
    pub(crate) fn db_password_for(&self, id: &str) -> Option<Zeroizing<String>> {
        self.with_open(|open| Ok((open.find(Kind::DbPassword, id).map(|e| e.value.clone()), false)))
            .ok()?
    }

    /// MCP 값도 Rust 실행 경로(브로커·헤더 프록시)에서만 읽는다. 잠김·누락은 빈 값으로 바꾸지 않는다.
    pub(crate) fn mcp_env_for(&self, reference: &str) -> Result<Zeroizing<String>, String> {
        self.with_open(|open| {
            let value = open
                .find(Kind::McpEnv, reference)
                .map(|e| e.value.clone())
                .ok_or_else(|| tr!(ko: "MCP 비밀 값이 없습니다", en: "The stored MCP secret is missing"))?;
            Ok((value, false))
        })
    }

    /// 지금 메모리에서 열려 있는가 — **디스크를 보지 않는다**(헤더 프록시의 503 이유 고르기).
    pub(crate) fn is_unlocked(&self) -> bool {
        matches!(self.inner().state, VaultState::Unlocked(_))
    }

    // ── 상태·조회 (값 없음) ─────────────────────────────────────────────

    /// 금고가 있는가·잠겼는가·몇 개 들었는가. **오류를 내지 않는다.**
    ///
    /// 아직 안 연 키 파일 금고는 여기서 조용히 열린다(첫 사용) — 서버를 띄운 직후의 상태가 곧
    /// "열려 있다" 라는 뜻이다. 가림막·창 0개가 한 번 걸린 뒤에는 `locked` 이고, 마스터가 없으면
    /// `locked` + `hasMaster=false` 다 — 그 조합을 프런트는 **빈 값으로 여는 확인 관문**으로 읽는다.
    pub(crate) fn status(&self) -> VaultStatus {
        const ABSENT: VaultStatus = VaultStatus {
            state: "absent",
            has_master: false,
            entry_count: 0,
            lock_reason: None,
            relock: false,
        };
        let Ok(dir) = self.dir() else {
            return ABSENT;
        };
        let mut g = self.inner();
        let has_master = match read_envelope(&dir) {
            Ok(Some(env)) => env.kdf.has_master(),
            _ => {
                // 파일이 없거나 못 읽는다 — 둘 다 "아직 쓸 금고가 없다" 로 보인다.
                // 들고 있던 것이 있으면 여기서 떨어뜨린다(`Zeroizing` 이 덮는다).
                g.state = VaultState::Unopened;
                g.reason = None;
                g.relock = false;
                return ABSENT;
            }
        };
        let opened = ensure_open(&mut g.state, &dir).is_ok();
        let entry_count = match &g.state {
            VaultState::Unlocked(open) => open.entries.len(),
            _ => 0,
        };
        VaultStatus {
            state: if opened { "unlocked" } else { "locked" },
            has_master,
            entry_count,
            lock_reason: if opened { None } else { g.reason.map(LockReason::wire) },
            relock: !opened && g.relock,
        }
    }

    /// 무엇이 들어 있는가 — **값은 없다**. 종류·대상으로 정렬해 화면이 흔들리지 않게 한다.
    pub(crate) fn list(&self) -> Result<Vec<VaultItem>, String> {
        self.with_open(|open| {
            let mut items: Vec<VaultItem> = open
                .entries
                .iter()
                .map(|e| VaultItem {
                    kind: e.kind.wire(),
                    target: e.target.clone(),
                })
                .collect();
            items.sort_by(|a, b| a.kind.cmp(b.kind).then_with(|| a.target.cmp(&b.target)));
            Ok((items, false))
        })
    }

    /// 이 (종류, 대상) 이 담겨 있는가 — 잠겨 있으면 거절(부르는 쪽이 거짓으로 접는다).
    pub(crate) fn has(&self, kind: Kind, target: &str) -> Result<bool, String> {
        self.with_open(|open| Ok((open.find(kind, target).is_some(), false)))
    }

    // ── 상태 바꾸기 ─────────────────────────────────────────────────────

    /// 금고를 만든다. `master` 가 `None` 이면 키 파일 원천이다. 이미 있으면 `[exists]`.
    pub(crate) fn create(&self, master: Option<&str>) -> Result<(), String> {
        let dir = self.dir()?;
        if let Some(m) = master {
            check_value(m)?;
        }
        let generation = self.begin();
        let open = create_at(&dir, master, DEFAULT_M_COST, DEFAULT_T_COST, DEFAULT_P_COST)?;
        // 그 사이 잠겼으면 파일은 만들어졌어도 열린 채로 두지 않는다 — 다음 해제가 연다.
        self.apply_unlocked(generation, open)
    }

    /// 잠금을 푼다. 틀린 마스터는 `[vault-wrong-master]`.
    ///
    /// **`master` 가 `Option` 인 것이 계약이다** (2026-09-19 저녁): 마스터 없는 **키 파일 금고는 `None`(= 빈 Enter)
    /// 하나로 열린다**(확인 관문). **이미 열려 있어도 받아 준다** — 보는 것은 전역 상태가 아니라 디스크의 봉투라, 틀린
    /// 암호는 열려 있다는 이유로 통과하지 않는다 (유닛 `unlocking_an_open_vault_verifies_the_master_again`).
    /// 창 0개 잠금(`WindowsZero`)에서 풀면 정지됐던 HTTP 티켓이 그대로 되산다(티켓 표는 건드리지 않았다).
    /// KDF 가 도는 동안 잠금이 걸렸으면 `[vault-locked]` 이고 잠긴 채다([`Vault::apply_unlocked`]).
    pub(crate) fn unlock(&self, master: Option<&str>) -> Result<(), String> {
        let dir = self.dir()?;
        let generation = self.begin();
        let open = open_at(&dir, master)?;
        self.apply_unlocked(generation, open)
    }

    /// 마스터 암호가 맞는지 **확인만** 한다 — 상태(열림·잠김·까닭·세대)를 하나도 바꾸지 않고, 값도 돌려주지 않는다
    /// (원격 웹 R1a-2 — 원격 가림막·원격 승인의 재확인, 설계 3절 단계 3). 디스크의 봉투로 키를 유도해 열어 본 뒤 그 내용을
    /// 곧바로 떨어뜨린다(`Zeroizing`). 마스터가 없는(키 파일) 금고는 [`MasterCheck::NoMaster`], 금고가 없으면
    /// [`MasterCheck::NoVault`]. AEAD 실패는 "틀림" 하나로 접는다(상한 파일과 틀린 암호를 가르지 않는다 — [`unseal`]).
    /// 실패 빈도 제한은 부르는 쪽(`server::vault_ops`)이 진다. **블로킹**(Argon2).
    pub(crate) fn verify_master(&self, master: &str) -> Result<MasterCheck, String> {
        let dir = self.dir()?;
        let Some(env) = read_envelope(&dir)? else {
            return Ok(MasterCheck::NoVault);
        };
        if !env.kdf.has_master() {
            return Ok(MasterCheck::NoMaster);
        }
        if master.is_empty() {
            return Ok(MasterCheck::Bad);
        }
        let key = derive_key(&dir, &env.kdf, Some(master))?;
        match unseal(&key, &env) {
            Ok(entries) => {
                drop(entries); // 값은 Zeroizing — 떨어지며 덮인다
                Ok(MasterCheck::Ok)
            }
            Err(e) if errors::has_reason(&e, errors::VAULT_WRONG_MASTER) => Ok(MasterCheck::Bad),
            Err(e) => Err(e),
        }
    }

    /// 지금 잠근다 — 열려 있던 상태가 떨어지며 키와 값이 0 으로 덮인다. 돌려주는 것은 **잠금 뒤의 까닭**이다.
    ///
    /// **이미 창 0개로 잠겨 있으면 까닭을 바꾸지 않는다** — 창 0개로 잠긴(티켓 정지) 금고에 다음 GUI 가 가림막을
    /// 세워도 정지가 폐기로 바뀌지 않게. 그 밖의 이미 잠긴 금고는 새 까닭으로 갈아 적는다(가림막·사람 잠금은 다시
    /// 걸 때마다 HTTP 티켓을 거둔다 — 예전 그대로). 부르는 쪽(`server::vault_ops`)은 돌려받은 까닭으로 티켓을 다룬다.
    /// `Unopened` 도 잠근다 — 창이 하나도 없는 동안 키 파일 금고가 브로커 요청에 조용히 열리면 안 된다.
    pub(crate) fn lock(&self, reason: LockReason) -> LockReason {
        let mut g = self.inner();
        // 어느 갈래든 진행 중인 열기를 무효로 한다 — 이미 잠긴 금고에 다시 건 잠금도 그 사이 시작된 해제를 이긴다.
        g.generation = g.generation.wrapping_add(1);
        if matches!(g.state, VaultState::Locked) && g.reason == Some(LockReason::WindowsZero) {
            return LockReason::WindowsZero;
        }
        let was_open = matches!(g.state, VaultState::Unlocked(_));
        g.state = VaultState::Locked;
        g.reason = Some(reason);
        g.relock = reason == LockReason::WindowsZero && was_open;
        reason
    }

    /// 키 원천을 바꾼다 — 마스터 걸기(`new = Some`)·풀기(`new = None`)·갈아 끼우기. 틀리면 아무것도 바뀌지 않는다.
    pub(crate) fn set_master(&self, new: Option<&str>, current: Option<&str>) -> Result<(), String> {
        let dir = self.dir()?;
        if let Some(m) = new {
            check_value(m)?;
        }
        let generation = self.begin();
        let open = set_master_at(&dir, new, current, DEFAULT_M_COST, DEFAULT_T_COST, DEFAULT_P_COST)?;
        // 그 사이 잠겼으면 디스크의 키 원천은 바뀐 채, 메모리는 잠긴 채다 — 다음 해제는 새 원천으로 연다.
        self.apply_unlocked(generation, open)
    }

    /// 항목 하나를 지운다. 없던 것을 지우는 것은 **성공**이다(멱등).
    pub(crate) fn delete(&self, kind: Kind, target: &str) -> Result<(), String> {
        self.with_open(|open| {
            let before = open.entries.len();
            open.entries.retain(|e| !(e.kind == kind && e.target == target));
            Ok(((), open.entries.len() != before))
        })
    }

    /// 전부 지운다 — **금고 파일은 남고 비워진다**(키 원천은 사용자가 정한 설정이다).
    pub(crate) fn delete_all(&self) -> Result<(), String> {
        self.with_open(|open| {
            let dirty = !open.entries.is_empty();
            open.entries.clear();
            Ok(((), dirty))
        })
    }

    /// 호스트 비밀번호·키 암호구를 담는다. 같은 (종류, 대상) 이 있으면 **갈아 끼운다**.
    ///
    /// 값은 모달·폼이 준 그대로다(GUI → 서버 한 방향) — 이 함수 바깥으로는 나가지 않는다.
    pub(crate) fn store(&self, kind: Kind, target: String, value: Zeroizing<String>) -> Result<(), String> {
        if kind == Kind::McpEnv {
            return Err(tr!(ko: "MCP 비밀 값은 따로 담습니다", en: "MCP secrets are stored separately"));
        }
        check_target(&target)?;
        if kind == Kind::DbPassword && !db_conn_id_ok(&target) {
            return Err(tr!(
                ko: "DB 연결 id 가 올바르지 않습니다 — 8~32자의 영문·숫자·_·- 여야 합니다",
                en: "The database connection id is invalid — it must be 8 to 32 letters, digits, _ or -",
            ));
        }
        check_value(&value)?;
        self.with_open(|open| {
            if open.entries.len() >= MAX_ENTRIES && open.find(kind, &target).is_none() {
                return Err(vault_full());
            }
            open.put(kind, target, value);
            Ok(((), true))
        })
    }

    /// MCP 환경변수·헤더 값 — 매 편집마다 **새 참조**를 만든다(설정 취소가 기존 값을 되돌릴 수 있어야 한다).
    /// 돌려주는 것은 참조(`<label>:<무작위>`)이지 값이 아니다.
    pub(crate) fn store_mcp_env(&self, label: &str, value: Zeroizing<String>) -> Result<String, String> {
        if label.is_empty() || label.len() > 400 || label.chars().any(char::is_control) || !mcp_value_ok(&value) {
            return Err(tr!(ko: "MCP 비밀 값의 이름 또는 값이 올바르지 않습니다", en: "Invalid MCP secret name or value"));
        }
        let token = crate::token::generate_token()
            .ok_or_else(|| tr!(ko: "MCP 비밀 값 참조를 만들지 못했습니다", en: "Could not create an MCP secret reference"))?;
        let reference = format!("{label}:{token}");
        let mut pending = lock_ignoring_poison(&self.pending);
        self.with_open(|open| {
            if open.entries.len() >= MAX_ENTRIES {
                return Err(vault_full());
            }
            open.put(Kind::McpEnv, reference.clone(), value);
            Ok(((), true))
        })?;
        pending.insert(reference.clone());
        Ok(reference)
    }

    /// 설정 저장 뒤 — 저장된 설정(`saved`)·살아 있는 티켓(`active` — 부르는 쪽이 브로커에서 모아 락을 놓은 뒤 준다)·
    /// 아직 저장 안 된 편집(`pending`)에 없는 MCP 참조를 지운다. **정리하려고 볼트를 열지는 않는다.**
    pub(crate) fn prune_mcp_env(&self, saved: HashSet<String>, active: HashSet<String>) -> Result<(), String> {
        let mut keep = active;
        let mut pending = lock_ignoring_poison(&self.pending);
        pending.retain(|reference| !saved.contains(reference));
        keep.extend(saved);
        keep.extend(pending.iter().cloned());
        let mut g = self.inner();
        if let VaultState::Unlocked(open) = &mut g.state {
            let dir = self.dir()?;
            prune_mcp_env_at(&dir, open, &keep)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;

/// 비밀 값을 보지 않고 삭제할 MCP 참조만 계산한다. 다른 종류는 건드리지 않는다.
fn unused_mcp_env(entries: &[Entry], keep: &HashSet<String>) -> HashSet<String> {
    entries
        .iter()
        .filter(|entry| entry.kind == Kind::McpEnv && !keep.contains(&entry.target))
        .map(|entry| entry.target.clone())
        .collect()
}

fn prune_mcp_env_at(dir: &Path, open: &mut Open, keep: &HashSet<String>) -> Result<(), String> {
    let unused = unused_mcp_env(&open.entries, keep);
    if !unused.is_empty() {
        open.entries
            .retain(|entry| entry.kind != Kind::McpEnv || !unused.contains(&entry.target));
        save_at(dir, open)?;
    }
    Ok(())
}

pub(crate) fn mcp_value_ok(value: &str) -> bool {
    value.len() <= MAX_VALUE_LEN && !value.contains(['\r', '\n', '\0'])
}
