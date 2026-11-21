//! 자격증명 금고 — 비밀번호 · 키 암호구 · MCP 환경변수 · DB 비밀번호를 앱이 소유하는 파일 하나(`vault.bin`)에 담는다.
//!
//! ## 불변식(→ docs/invariants.md 전문 2 · 3 · 14)
//!
//! - 옵트인 — 사용자가 켜지 않으면 파일조차 만들지 않는다. 봉투 바깥에는 비밀이 없다(어떤 대상을 담았는지도 보이지 않는다).
//! - 볼트 값은 세션 서버 프로세스 밖으로 나가지 않는다 — 값을 돌려주는 op 는 없다(파이프에는 상태 · 종류 · 대상 · MCP 참조뿐).
//!   GUI → 서버 한 방향으로 가는 값은 사람이 폼에 친 마스터 · 비밀번호 · 암호구뿐이다.
//!   값을 쓰는 `*_for` 는 서버 안에서만 부르고 IPC 표면에 없다. AI(MCP)에게는 어떤 문도 없다.
//! - 예외는 외부 MCP 환경변수(`mcp_env`) — 볼트가 열린 동안 브로커가 `aynx mcp-run` 도우미를 거쳐 평문으로 넘기므로 같은 계정의
//!   프로세스(그 타일의 AI 에이전트 포함)에 노출된다고 본다. 알고 받은 한계다(디스크 · 설정 · 프런트 · MCP RPC 에는 값이 없고, 잠기면 브로커도 내주지 않는다).
//! - 가림막이 걸리면(무입력 · 손 · 마스터 유무와 무관) 볼트도 잠기고, 보는 창이 0개여도 잠긴다. `Locked` 를 놓는 것은 [`Vault::lock`]
//!   하나뿐이고, `Locked` 에서는 키 파일 금고도 조용히 다시 열지 않는다 — 다시 여는 길은 [`Vault::unlock`] 하나(마스터 없으면 빈 값 — 확인 관문).
//! - 볼트 자체의 유휴 시계는 두지 않는다 — 자리 비움은 가림막의 시계 하나가 센다.
//! - 틀린 마스터와 손상을 구분해 말하지 않는다 — 구분하는 문구는 신탁이 된다([`unseal`]).
//! - 키 파일 금고(마스터 없음)는 브라우저 저장 비밀번호와 같은 등급이다 — 그 계정에서 도는 악성 코드 · 잃어버린 노트북은 못 지킨다(알고 받은 한계).
//! - OS 자격증명 저장소를 붙인다면 키를 감싸는 자리 [`protect_key_bytes`] 가 그 문이다.
//! - 비밀은 [`Zeroizing`] 에 담고 `Debug` 는 손으로 구현해 `***` 만 찍는다. `static` 의 `Drop` 은 프로세스 종료 때 돌지 않으므로
//!   종료 시 지우기를 `Drop` 에 기대지 않는다 — 상태가 바뀌는 자리마다 옛 상태를 떨어뜨린다.
//!
//! ## 암호 구성 — 바꾸면 기존 볼트를 못 연다
//!
//! XChaCha20-Poly1305 · 쓸 때마다 무작위 24바이트 논스 · AAD `aynx-vault/1/<kdf 종류>` · 마스터는 Argon2id(소금 · m/t/p 는 봉투 머리에 —
//! 올려도 옛 금고가 열린다) · 키 파일은 `vault.key` 32바이트(Windows 는 DPAPI 로 사용자 계정에 묶는다) · 봉투 판 [`VERSION`].

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

// ── 상수 ──

const VAULT_FILE: &str = "vault.bin";

/// 마스터 비밀번호가 없을 때만 있다.
const KEY_FILE: &str = "vault.key";

/// 모르는 판은 열지 않는다 — 아는 척 열면 옛 앱이 새 금고를 망가뜨린다.
const VERSION: u32 = 1;

const KEY_LEN: usize = 32;

const NONCE_LEN: usize = 24;

const SALT_LEN: usize = 16;

/// 값은 봉투 머리에 적히므로 올려도 옛 금고가 그대로 열린다.
const DEFAULT_M_COST: u32 = 64 * 1024;
const DEFAULT_T_COST: u32 = 3;
const DEFAULT_P_COST: u32 = 1;

/// 손으로 부풀린 봉투가 여는 순간 메모리를 다 먹지 못하게(`m_cost` 는 그대로 할당량이다).
const MAX_M_COST: u32 = 1024 * 1024;

const MAX_T_COST: u32 = 64;

const MAX_VALUE_LEN: usize = 4096;

const MAX_ENTRIES: usize = 2000;

const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// 봉인된 `vault.bin` 이 이 글자를 AAD 로 들고 있다 — 바꾸면 기존 볼트가 "열 수 없음" 이 된다(옛 접두사로 열어 다시 봉인하는 길과 함께만).
const AAD_PREFIX: &str = "aynx-vault/1/";

// ── 항목 ──

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// 대상 = 호스트 별칭(`~/.ssh/config` 의 `Host`).
    HostPassword,
    /// 대상 = 개인키 파일 경로.
    KeyPassphrase,
    McpEnv,
    /// 대상 = DB 연결의 고정 `id`(`db-connections.json`) — 호스트 별칭이 아니다.
    DbPassword,
}

/// 볼트 열쇠의 규칙이라 여기 둔다(`db::conns::validate_one` 이 부른다 — 볼트는 바닥 모듈이라 위로 부르지 않는다).
pub(crate) fn db_conn_id_ok(id: &str) -> bool {
    (8..=32).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

impl Kind {
    /// 파일 · 프런트에 글자 그대로 적힌다 — 바꾸지 않는다.
    fn wire(self) -> &'static str {
        match self {
            Kind::HostPassword => "host_password",
            Kind::KeyPassphrase => "key_passphrase",
            Kind::McpEnv => "mcp_env",
            Kind::DbPassword => "db_password",
        }
    }

    /// 봉인된 평문의 칸 이름 — [`WireEntry`] 와 맞아야 한다.
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

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Entry {
    kind: Kind,
    target: String,
    value: Zeroizing<String>,
}

/// 손으로 구현한다 — `derive` 면 `{entry:?}` 한 줄이 비밀번호를 콘솔에 뱉는다.
impl std::fmt::Debug for Entry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Entry")
            .field("kind", &self.kind)
            .field("target", &self.target)
            .field("value", &"***")
            .finish()
    }
}

/// 손으로 쓴다 — 중간에 `String` 사본이 생기면 그 사본은 0 으로 덮이지 않는다.
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

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WireEntry {
    HostPassword { alias: String, value: String },
    KeyPassphrase { path: String, value: String },
    McpEnv { reference: String, value: String },
    DbPassword { conn: String, value: String },
}

impl From<WireEntry> for Entry {
    /// `value` 를 옮긴다(복사하지 않는다) — 사본은 0 으로 덮이지 않는다.
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

#[derive(serde::Serialize)]
struct PlainOut<'a> {
    entries: &'a [Entry],
    updated_at: String,
}

#[derive(serde::Deserialize)]
struct PlainIn {
    #[serde(default)]
    entries: Vec<WireEntry>,
    #[serde(default)]
    #[allow(dead_code)]
    updated_at: String,
}

// ── 봉투 ──

/// 봉투 머리에 글자 그대로 적힌다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Kdf {
    Argon2id {
        salt: String,
        m_cost: u32,
        t_cost: u32,
        p_cost: u32,
    },
    Keyfile,
}

impl Kdf {
    /// AAD 에 실린다 — 바꾸면 기존 볼트를 못 연다.
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Envelope {
    version: u32,
    kdf: Kdf,
    nonce: String,
    ciphertext: String,
}

// ── 열린 금고 ──

struct Open {
    key: Zeroizing<[u8; KEY_LEN]>,
    /// 다시 쓸 때 소금 · 파라미터를 그대로 재사용한다.
    kdf: Kdf,
    entries: Vec<Entry>,
}

/// [`Entry`] 와 같은 이유로 손으로 쓴다.
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

/// `Unopened` 는 "파일이 없다" 와 "아직 디스크를 안 봤다" 를 일부러 나누지 않는다 — 앱 밖에서 금고가 생기거나 사라져도 다음 호출이 따라잡는다.
/// `Locked` 를 놓는 것은 [`Vault::lock`] 하나뿐이다 — 조회 한 번이 등 뒤에서 잠금을 바꾸지 않게.
#[derive(Debug)]
enum VaultState {
    Unopened,
    Locked,
    Unlocked(Open),
}

// ── OS 를 타는 자리 ① — 키 파일 감싸기 ──

/// 키 파일 감싸기 — OS 분기는 이 함수 하나뿐이고, OS 자격증명 저장소를 붙인다면 이 자리가 그 문이다(전문 14).
///
/// - Windows: DPAPI — 이 사용자 계정으로만 풀린다(복사해 간 파일이 다른 기계 · 계정에서 열리지 않는다).
/// - 그 밖: 항등 스텁 — 지켜 주는 것은 파일 권한(0600)뿐이다. 시험할 기계가 없어 지어내지 않는다 — 그 OS 에서는 마스터 비밀번호가 정직한 권유다.
fn protect_key_bytes(raw: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    let out = dpapi(raw, DpapiWay::Protect);

    #[cfg(not(windows))]
    let out = Ok(raw.to_vec());

    out
}

/// [`protect_key_bytes`] 의 역방향 — 같은 규칙.
fn unprotect_key_bytes(wrapped: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    let out = dpapi(wrapped, DpapiWay::Unprotect);

    #[cfg(not(windows))]
    let out = Ok(wrapped.to_vec());

    out
}

#[cfg(windows)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum DpapiWay {
    Protect,
    Unprotect,
}

/// 패닉하지 않는다 · 반환 버퍼를 반드시 `LocalFree` 한다.
///
/// 추가 엔트로피는 쓰지 않는다 — 바이너리 안의 상수일 수밖에 없어 지켜 주는 것 없이 형식만 굳는다(넣으면 옛 키 파일이 안 열린다).
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

    // UI_FORBIDDEN: OS 대화상자를 띄우면 블로킹 풀 스레드가 사람을 기다리며 멈춘다(세션 열기 도중에도 불린다).
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
    unsafe { LocalFree(out_blob.pbData.cast()) };
    Ok(out)
}

// ── OS 를 타는 자리 ② — 파일 권한 ──

/// OS 분기는 이 함수 하나. Windows 는 일부러 아무것도 하지 않는다 — 프로필 아래 새 파일은 상속 ACL 로 이미 그 사용자(+관리자)에게만 열린다.
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

// ── 파일 입출력 ──

fn vault_path(dir: &Path) -> PathBuf {
    dir.join(VAULT_FILE)
}

fn key_path(dir: &Path) -> PathBuf {
    dir.join(KEY_FILE)
}

/// 임시 이름은 `<이름>.tmp` — `with_extension` 이면 `vault.bin` 과 `vault.key` 가 같은 `vault.tmp` 를 써 [`set_master_at`] 에서 서로를 덮는다.
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
        // 이름을 바꾸기 전에 내린다 — 아니면 전원이 끊겼을 때 이름은 새것인데 내용이 빈 금고가 남는다.
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
        return Err(tr!(
            ko: "이 금고는 더 새로운 판(v{v})입니다 — 앱을 최신으로 올리세요",
            en: "This vault is a newer version (v{v}) — update the app",
            v = env.version,
        ));
    }
    Ok(Some(env))
}

// ── 키 유도 ──

/// 못 얻으면 키를 만들지 않는다 — 예측 가능한 키로 금고를 만들지 않는다.
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

/// 파라미터는 봉투가 준 것을 쓴다(기본값이 아니다) — 그래야 올린 뒤에도 옛 금고가 열린다.
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

// ── 암·복호화 ──

fn cipher_for(key: &[u8; KEY_LEN]) -> Result<XChaCha20Poly1305, String> {
    XChaCha20Poly1305::new_from_slice(key).map_err(
        |_| tr!(ko: "금고 키의 길이가 맞지 않습니다", en: "The vault key has the wrong length"),
    )
}

/// 논스는 매번 새로 뽑는다 — 같은 키 + 같은 논스로 두 번 쓰지 않는다.
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

/// 실패는 언제나 `Err` 이고 패닉하지 않는다.
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

    // AEAD 는 "키가 틀렸다" 와 "파일이 상했다" 를 구분해 주지 않는다 — 구분하는 척하는 문구는 공격자에게 신탁이 된다.
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

// ── 폴더를 받는 층 ──

struct Source {
    kdf: Kdf,
    key: Zeroizing<[u8; KEY_LEN]>,
    /// 키 파일 원천일 때만 `Some`.
    key_file: Option<Zeroizing<[u8; KEY_LEN]>>,
}

/// 아직 아무것도 쓰지 않는다 — 쓰는 순서는 [`commit`] 이 정한다.
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

/// 순서 셋이 곧 안전이다 — 키 파일 먼저 쓰기 → 본문 쓰기 → (마스터로 바뀌었으면) 키 파일 지우기.
/// 뒤집으면 본문 쓰기가 실패했을 때 열 수 없는 금고가 남는다. 이 순서면 어느 단계가 실패해도 직전 금고가 열린다.
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
        // 남은 키 파일은 아무것도 열지 못한다 — 실패는 치명적이지 않다.
        let _ = std::fs::remove_file(key_path(dir));
    }
    Ok(())
}

/// 이미 있으면 거절한다 — 덮어쓰면 담겨 있던 비밀이 한 번에 사라진다.
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

/// 바꾸려면 지금 열 수 있어야 한다 — 현재 마스터 없이 바꾸면 항목을 버리는 것이다.
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

// ── 살아 있는 금고 한 벌 — 세션 서버 프로세스 안에만 있다 ──

fn app_dir() -> Result<PathBuf, String> {
    crate::instance::config_root().ok_or_else(|| {
        tr!(
            ko: "설정 디렉터리를 찾을 수 없습니다",
            en: "Could not find the settings folder",
        )
    })
}

/// `Locked` 에서는 디스크를 보지 않는다 — 키 파일 금고를 조용히 다시 열면 가림막이 건 잠금이 거짓말이 된다.
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

/// HTTP 헤더 프록시 티켓: `Shade` · `User` 는 폐기, `WindowsZero`(마지막 창 파괴 · 클라이언트 0)는 정지 — 해제하면 같은 티켓이 되산다.
/// stdio 실행 티켓은 어느 까닭에도 지우지 않는다(잠긴 동안 브로커가 값을 내주지 않을 뿐). `wire` 글자는 프런트와 맞춘다.
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MasterCheck {
    Ok,
    /// 빈 값 포함.
    Bad,
    NoMaster,
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

#[derive(Debug)]
struct Inner {
    state: VaultState,
    reason: Option<LockReason>,
    /// 열려 있던 금고를 창 0개 잠금이 닫았다 — 다음에 붙는 GUI 가 가림막을 세운다.
    relock: bool,
    /// [`Vault::lock`] 이 올린다. 느린 열기(KDF · 디스크)는 락 밖이라, 끝나서 세대가 같을 때만 연다 — 그 사이 걸린 잠금을 늦은 열기가 되돌리지 못하게.
    generation: u64,
}

/// 세션 서버 프로세스에만 있다 — GUI 프로세스에는 이 값이 없다(GUI 의 `vault_*` 명령은 서버 op 프록시).
pub(crate) struct Vault {
    /// `None` 이면 [`crate::instance::config_root`].
    dir: Option<PathBuf>,
    inner: Mutex<Inner>,
    /// 아직 저장된 설정에 나타나지 않은 참조 — 다른 창의 저장이 진행 중인 편집을 지우지 않게.
    /// 락 순서: 이 락을 먼저 쥐고 inner 락을 쥔다.
    pending: Mutex<HashSet<String>>,
}

impl std::fmt::Debug for Vault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Vault").field("dir", &self.dir).finish_non_exhaustive()
    }
}

/// 오염은 무시한다 — 모든 쓰기가 통째로 갈아 끼우기라 반쯤 바뀐 값이 남지 않는다.
fn lock_ignoring_poison<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 값도 대상 목록도 싣지 않는다 — 프런트로 나간다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    /// `"absent"` · `"locked"` · `"unlocked"`.
    pub state: &'static str,
    /// 거짓이면 잠금 해제는 빈 값(Enter)으로 열리는 확인 관문이다.
    pub has_master: bool,
    pub entry_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_reason: Option<&'static str>,
    /// 붙는 GUI 가 가림막을 잠그지 않고 세운다 — 티켓 정지를 폐기로 바꾸지 않게.
    pub relock: bool,
}

/// 종류와 대상뿐 — 값은 없다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct VaultItem {
    pub kind: &'static str,
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

/// 빈 값은 "지우기" 가 아니라 실수다.
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

/// 모든 메서드는 디스크를 읽을 수 있다 — 블로킹 문맥에서만 부른다.
impl Vault {
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

    /// KDF 전에 부른다.
    fn begin(&self) -> u64 {
        self.inner().generation
    }

    /// `begin` 뒤에 잠금이 걸렸으면 열지 않고 `[vault-locked]` 다(그 잠금이 놓은 상태 그대로).
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

    /// 모든 조회 · 쓰기가 지나는 문 하나. 클로저가 `true` 를 돌려주면 디스크에 다시 쓴다.
    fn with_open<T>(&self, f: impl FnOnce(&mut Open) -> Result<(T, bool), String>) -> Result<T, String> {
        let dir = self.dir()?;
        let mut g = self.inner();
        ensure_open(&mut g.state, &dir)?;
        let VaultState::Unlocked(open) = &mut g.state else {
            return Err(errors::vault_locked());
        };
        let (out, dirty) = f(open)?;
        if dirty {
            save_at(&dir, open)?;
        }
        Ok(out)
    }

    // ── 백엔드 전용 조회 — 여기서만 값이 나온다 · IPC 에 싣지 않는다 ──

    /// 없거나 잠겼으면 `None` — 잠긴 금고가 접속을 실패시키면 안 된다.
    pub(crate) fn password_for(&self, alias: &str) -> Option<Zeroizing<String>> {
        self.with_open(|open| Ok((open.find(Kind::HostPassword, alias).map(|e| e.value.clone()), false)))
            .ok()?
    }

    /// [`Vault::password_for`] 와 같은 규칙.
    pub(crate) fn passphrase_for(&self, path: &str) -> Option<Zeroizing<String>> {
        self.with_open(|open| Ok((open.find(Kind::KeyPassphrase, path).map(|e| e.value.clone()), false)))
            .ok()?
    }

    /// 서버 안 DB 드라이버만 읽는다. [`Vault::password_for`] 와 같은 규칙.
    pub(crate) fn db_password_for(&self, id: &str) -> Option<Zeroizing<String>> {
        self.with_open(|open| Ok((open.find(Kind::DbPassword, id).map(|e| e.value.clone()), false)))
            .ok()?
    }

    /// 브로커 · 헤더 프록시에서만 읽는다. 잠김 · 누락은 빈 값으로 바꾸지 않는다.
    pub(crate) fn mcp_env_for(&self, reference: &str) -> Result<Zeroizing<String>, String> {
        self.with_open(|open| {
            let value = open
                .find(Kind::McpEnv, reference)
                .map(|e| e.value.clone())
                .ok_or_else(|| tr!(ko: "MCP 비밀 값이 없습니다", en: "The stored MCP secret is missing"))?;
            Ok((value, false))
        })
    }

    /// 디스크를 보지 않는다.
    pub(crate) fn is_unlocked(&self) -> bool {
        matches!(self.inner().state, VaultState::Unlocked(_))
    }

    // ── 상태 · 조회(값 없음) ──

    /// 아직 안 연 키 파일 금고는 여기서 조용히 열린다(첫 사용). `locked` + `hasMaster=false` 를 프런트는 빈 값으로 여는 확인 관문으로 읽는다.
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

    /// 값은 없다.
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

    pub(crate) fn has(&self, kind: Kind, target: &str) -> Result<bool, String> {
        self.with_open(|open| Ok((open.find(kind, target).is_some(), false)))
    }

    // ── 상태 바꾸기 ──

    pub(crate) fn create(&self, master: Option<&str>) -> Result<(), String> {
        let dir = self.dir()?;
        if let Some(m) = master {
            check_value(m)?;
        }
        let generation = self.begin();
        let open = create_at(&dir, master, DEFAULT_M_COST, DEFAULT_T_COST, DEFAULT_P_COST)?;
        self.apply_unlocked(generation, open)
    }

    /// 마스터 없는 키 파일 금고는 `None`(빈 Enter)으로 열린다(확인 관문). 이미 열려 있어도 디스크의 봉투로 다시 확인한다 —
    /// 틀린 암호가 열려 있다는 이유로 통과하지 않는다(시험 `unlocking_an_open_vault_verifies_the_master_again`).
    pub(crate) fn unlock(&self, master: Option<&str>) -> Result<(), String> {
        let dir = self.dir()?;
        let generation = self.begin();
        let open = open_at(&dir, master)?;
        self.apply_unlocked(generation, open)
    }

    /// 확인만 한다 — 상태(열림 · 잠김 · 까닭 · 세대)를 바꾸지 않고 값도 돌려주지 않는다. 상한 파일과 틀린 암호를 가르지 않는다([`unseal`]).
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
                drop(entries);
                Ok(MasterCheck::Ok)
            }
            Err(e) if errors::has_reason(&e, errors::VAULT_WRONG_MASTER) => Ok(MasterCheck::Bad),
            Err(e) => Err(e),
        }
    }

    /// 돌려주는 것은 잠금 뒤의 까닭이다(부르는 쪽이 그것으로 티켓을 다룬다). 이미 창 0개로 잠겨 있으면 까닭을 바꾸지 않는다 —
    /// 다음 GUI 가 가림막을 세워도 티켓 정지가 폐기로 바뀌지 않게. `Unopened` 도 잠근다 — 창 0개인 동안 키 파일 금고가 브로커 요청에 조용히 열리면 안 된다.
    pub(crate) fn lock(&self, reason: LockReason) -> LockReason {
        let mut g = self.inner();
        // 어느 갈래든 진행 중인 열기를 무효로 한다.
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

    /// `new = None` 은 마스터 풀기. 틀리면 아무것도 바뀌지 않는다.
    pub(crate) fn set_master(&self, new: Option<&str>, current: Option<&str>) -> Result<(), String> {
        let dir = self.dir()?;
        if let Some(m) = new {
            check_value(m)?;
        }
        let generation = self.begin();
        let open = set_master_at(&dir, new, current, DEFAULT_M_COST, DEFAULT_T_COST, DEFAULT_P_COST)?;
        self.apply_unlocked(generation, open)
    }

    /// 멱등 — 없던 것을 지우는 것도 성공이다.
    pub(crate) fn delete(&self, kind: Kind, target: &str) -> Result<(), String> {
        self.with_open(|open| {
            let before = open.entries.len();
            open.entries.retain(|e| !(e.kind == kind && e.target == target));
            Ok(((), open.entries.len() != before))
        })
    }

    /// 금고 파일은 남고 비워진다(키 원천은 사용자가 정한 설정이다).
    pub(crate) fn delete_all(&self) -> Result<(), String> {
        self.with_open(|open| {
            let dirty = !open.entries.is_empty();
            open.entries.clear();
            Ok(((), dirty))
        })
    }

    /// MCP 값은 [`Vault::store_mcp_env`] 로만 담는다.
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

    /// 매 편집마다 새 참조를 만든다 — 설정 취소가 기존 값을 되돌릴 수 있어야 한다. 돌려주는 것은 참조이지 값이 아니다.
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

    /// `active` 는 부르는 쪽이 브로커에서 모아 그 락을 놓은 뒤 준다. 정리하려고 볼트를 열지는 않는다.
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

// ── 테스트 ──

#[cfg(test)]
mod tests;

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
