//! 원격 웹의 **신원과 열림** — 기기 페어링 · 기기 토큰 · 원격 가림막 세션 · 실패 빈도 제한(R1a-2 — 설계 3절).
//!
//! 이 파일은 **상태 기계뿐**이다(시각은 부르는 쪽이 넣는다 — 시험이 시계를 흉내 내지 않는다). HTTP·쿠키·쪽 그리기는
//! `gate.rs`, 디스크 쓰기의 순서는 [`Auth::persist_blocking`] 하나.
//!
//! ## 신뢰 단계 (설계 3절 표)
//!
//! | 단계 | 근거 | 받는 것 |
//! | --- | --- | --- |
//! | 0 미페어링 | — | 페어링 쪽만 |
//! | 1 페어링됨 | 기기 쿠키(`__Host-pl_dev`) — 집 PC 사람이 6자리 코드를 견주고 [허용] 한 기기 | 원격 가림막 쪽만 |
//! | 2 열림 | 기기 쿠키 + 세션 쿠키(`__Host-pl_ses`) — 원격 가림막을 걷음(마스터 암호, 없으면 단추) | 앱 |
//!
//! - **기기 토큰은 값을 남기지 않는다** — `<설정 루트>/remote-devices.json` 에는 `sha256(토큰)` 만(값은 쿠키에만). 비교는
//!   기기 전부를 상수시간으로 훑는다(`subtle` — 앞에서 빠져나가지 않는다). 토큰은 32바이트 무작위 base64url(43자).
//! - **페어링은 한 번에 하나** — 대기 중인 요청이 있으면 다른 요청은 거절(`Busy`), 120초에 끝나고, 요청 자체가 분당 5번.
//!   요청한 브라우저는 무작위 **폴 비밀**(해시만 쥔다)로만 결과를 받는다 — 다른 브라우저가 같은 요청의 토큰을 가로채지 못한다.
//!   기기는 **허용 뒤 그 브라우저가 결과를 받는 순간** 만든다(허용만 하고 받지 않은 토큰이 어디에도 없게).
//! - **Tailscale 헤더(`Tailscale-User-Login`·`-Name`)는 참고**로만 적는다 — 같은 PC 의 아무 프로세스나 127.0.0.1 에 붙어 위조할
//!   수 있다(설계 2.2). 판정에 쓰지 않는다.
//! - **`X-Forwarded-For` 도 같은 참고**다 — 같은 프로세스가 똑같이 위조할 수 있으므로 기본 기기 이름(`<Tailscale 기기 이름> · <브라우저>`)을
//!   고르는 데만 쓰고 판정에 쓰지 않는다. CLI 인자에 닿는 것은 파싱된 `IpAddr` 뿐이고([`client_ip_from_forwarded`]), IP 자체는 저장 · 로그 · 프런트 어디에도 없다.
//! - **세션은 메모리에만** — 세션 → 기기. 무입력 시한 = 앱의 `[app] idle_lock_min`(없으면 15분), 절대 상한 12시간. 기기를 폐기하면
//!   그 기기의 세션도 곧바로 사라진다. 관문을 끄면(`[remote] enabled = false`) 모든 세션이 사라진다.
//! - **잠금 해제 실패**는 기기마다(5번 → 60초, 두 배씩 · 상한 1시간)와 전역(20번 → 같은 규칙) 두 겹 — 세션 서버의
//!   `vault_verify_master` 도 따로 센다(셋째 겹). 로그엔 횟수만.
//! - 열린 세션 수([`AuthState::unlocked_devices`])는 상태바·이벤트 `remote-sessions` 의 원천이다. 볼트 "창 0개" 셈은 세션 수가
//!   아니라 **살아 있는 원격 창(ws 연결)** 으로 한다(R1a-3 — `windows.rs`).
//! - **원격 창 부팅 표(R1a-3)**: 열린 세션이 앱 셸(`index.html`)을 받을 때마다 1회용 표를 하나 뽑는다 — 표 = 창 라벨
//!   `remote-<기기>-<세대>` + 그 세션. 페이지는 그 표로 `/remote/ws` 에 붙고, 관문은 표가 가리킨 라벨로 숨은 창을 만든다
//!   ([`AuthState::issue_ticket`] · [`AuthState::take_ticket`]). 60초 · 한 번 · 같은 기기·같은 세션에서만 통한다.
//! - **재확인 표(R1a-4)**: 원격의 승인·AI 권한 올리기(`deny::REAUTH`) 앞에서 관문이 마스터를 다시 확인하고(마스터가 없으면 그대로)
//!   1회용 표를 준다 — 60초 · 그 세션 · 그 명령 · 한 번([`AuthState::issue_reauth`] · [`AuthState::take_reauth`]). 실패 셈은 잠금
//!   해제와 같은 두 겹(기기·전역)을 쓴다.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use data_encoding::{BASE64URL_NOPAD, HEXLOWER};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use crate::fail_limit::FailLimiter;

/// 기기 파일 이름 — `<설정 루트>/remote-devices.json`.
pub(crate) const DEVICES_FILE: &str = "remote-devices.json";
/// 기기 상한 — 혼자 쓰는 도구라 넉넉하다.
pub(crate) const MAX_DEVICES: usize = 20;
/// 페어링 요청 하나의 수명.
pub(crate) const PAIR_TTL: Duration = Duration::from_secs(120);
/// 페어링 요청 빈도 — 이 시간 동안 이 수까지.
const PAIR_RATE_WINDOW: Duration = Duration::from_secs(60);
const PAIR_RATE_MAX: usize = 5;
/// 세션의 절대 상한(무입력과 무관).
pub(crate) const SESSION_MAX: Duration = Duration::from_secs(12 * 60 * 60);
/// 무입력 시한 기본값 — `[app] idle_lock_min` 이 없을 때.
pub(crate) const DEFAULT_IDLE: Duration = Duration::from_secs(15 * 60);
/// 기기 하나의 잠금 해제 실패 제한.
const DEVICE_FAILS: FailLimiter = FailLimiter::new(5, Duration::from_secs(60), Duration::from_secs(60 * 60));
/// 모든 기기를 합친 잠금 해제 실패 제한.
const GLOBAL_FAILS: FailLimiter = FailLimiter::new(20, Duration::from_secs(60), Duration::from_secs(60 * 60));
/// 표시 문자열 칸의 상한(기기 이름·Tailscale 헤더).
const MAX_LABEL: usize = 80;

// ── 비밀 한 벌 ─────────────────────────────────────────────────────────────

/// 32바이트 무작위 base64url — 기기 토큰·세션 토큰·폴 비밀. **`Debug` 가 값을 찍지 않는다**, 떨어지면 0 으로 덮인다.
pub(crate) struct Secret(Zeroizing<String>);

impl Secret {
    /// OS 엔트로피를 못 얻으면 `None` — 예측 가능한 토큰을 내느니 거절한다(`token::generate_token` 과 같은 판단).
    pub(crate) fn generate() -> Option<Secret> {
        let mut buf = Zeroizing::new([0u8; 32]);
        getrandom::fill(buf.as_mut()).ok()?;
        Some(Secret(Zeroizing::new(BASE64URL_NOPAD.encode(buf.as_ref()))))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(***)")
    }
}

/// 비밀 문자열 모양인가 — base64url 43자. 다른 모양은 해시조차 하지 않는다.
pub(crate) fn secret_shape(s: &str) -> bool {
    s.len() == 43 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn sha(s: &str) -> [u8; 32] {
    Sha256::digest(s.as_bytes()).into()
}

/// 무작위 짧은 id(hex 16자) — 기기 id·페어링 요청 id. 창 라벨 `remote-<id>` 에 그대로 쓸 수 있는 글자만.
fn short_id() -> Option<String> {
    let mut buf = [0u8; 8];
    getrandom::fill(&mut buf).ok()?;
    Some(HEXLOWER.encode(&buf))
}

/// 6자리 코드 — 거절 표집으로 치우침 없이.
fn six_digits() -> Option<String> {
    loop {
        let mut buf = [0u8; 4];
        getrandom::fill(&mut buf).ok()?;
        let n = u32::from_le_bytes(buf);
        // 4_294_000_000 = 1_000_000 의 배수 중 u32 안의 가장 큰 것
        if n < 4_294_000_000 {
            return Some(format!("{:06}", n % 1_000_000));
        }
    }
}

/// 화면에 보일 짧은 글자 — 제어 문자를 걷고 길이를 자른다.
pub(crate) fn label(raw: &str) -> String {
    raw.chars().filter(|c| !c.is_control()).take(MAX_LABEL).collect::<String>().trim().to_string()
}

/// `User-Agent` → 브라우저 이름(모르면 빈 글자).
fn browser_from_ua(ua: &str) -> &'static str {
    if ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/") {
        "Edge"
    } else if ua.contains("SamsungBrowser/") {
        "Samsung Internet"
    } else if ua.contains("Firefox/") || ua.contains("FxiOS/") {
        "Firefox"
    } else if ua.contains("Chrome/") || ua.contains("CriOS/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        ""
    }
}

/// `X-Forwarded-For` 값 → 클라이언트 IP. **값 전체가 주소 하나일 때만**(쉼표 목록 · 그 밖의 글자는 `None`).
/// 머리의 글자가 CLI 인자로 새지 않게 `IpAddr` 로만 내보낸다. 참고용 — 판정에 쓰지 않는다(머리말).
pub(crate) fn client_ip_from_forwarded(value: &str) -> Option<IpAddr> {
    value.trim().parse().ok()
}

/// 페어링 요청의 기본 이름 — `<Tailscale 기기 이름> · <브라우저>`(브라우저를 모르면 기기 이름만), 기기 이름이 없으면 예전 그대로의 UA 이름.
pub(crate) fn pair_device_name(node: Option<&str>, ua: &str) -> String {
    let Some(node) = node else {
        return device_name_from_ua(ua);
    };
    match browser_from_ua(ua) {
        "" => node.to_string(),
        browser => format!("{node} · {browser}"),
    }
}

/// `User-Agent` → "Edge · Windows" 같은 짧은 이름(나중에 바꿀 수 있다 — 6번 커밋).
pub(crate) fn device_name_from_ua(ua: &str) -> String {
    let browser = browser_from_ua(ua);
    let os = if ua.contains("iPhone") {
        "iPhone"
    } else if ua.contains("iPad") {
        "iPad"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        "macOS"
    } else if ua.contains("CrOS") {
        "ChromeOS"
    } else if ua.contains("Linux") {
        "Linux"
    } else {
        ""
    };
    match (browser, os) {
        ("", "") => "브라우저".to_string(),
        (b, "") => b.to_string(),
        ("", o) => o.to_string(),
        (b, o) => format!("{b} · {o}"),
    }
}

// ── 기기 ───────────────────────────────────────────────────────────────────

/// 페어링된 기기 한 대 — 파일에 적히는 것. 토큰 값은 없다(해시만).
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Device {
    pub id: String,
    pub name: String,
    /// `sha256(토큰)` 소문자 hex 64자.
    pub token_sha256: String,
    /// RFC 3339.
    pub created: String,
    pub last_seen: String,
    /// 페어링 때 본 `Tailscale-User-Login`(참고만 — 판정에 쓰지 않는다).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tailscale_login: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tailscale_name: Option<String>,
}

/// 해시도 찍지 않는다(값은 아니지만 로그에 둘 까닭이 없다).
impl std::fmt::Debug for Device {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Device").field("id", &self.id).field("name", &self.name).finish_non_exhaustive()
    }
}

/// 프런트가 받는 기기 한 줄 — **해시 없음**(`remote_devices_list`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub created: String,
    pub last_seen: String,
    /// 지금 원격 가림막을 걷은 세션이 있는가(R1a-5 — 설정 화면의 "열림").
    pub unlocked: bool,
    /// 지금 붙은 원격 창(ws) 수(R1a-5 — `activity::live`).
    pub connected: usize,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DeviceFile {
    version: u32,
    #[serde(default)]
    devices: Vec<Device>,
}

/// 파일 내용 → 기기들. 모양이 틀린 줄(해시가 hex 64자가 아님·id 가 비었음)은 버린다 — 그 기기는 다시 페어링하면 된다.
/// 파일 전체를 못 읽으면 빈 목록(모든 기기가 미페어링으로 보인다 — 열리는 쪽이 아니라 닫히는 쪽으로 실패).
pub(crate) fn parse_devices(text: &str) -> Vec<Device> {
    let Ok(file) = serde_json::from_str::<DeviceFile>(text) else {
        return Vec::new();
    };
    file.devices
        .into_iter()
        .filter(|d| {
            d.token_sha256.len() == 64
                && d.token_sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                && !d.id.is_empty()
                && d.id.bytes().all(|b| b.is_ascii_alphanumeric())
        })
        .take(MAX_DEVICES)
        .collect()
}

pub(crate) fn render_devices(devices: &[Device]) -> String {
    serde_json::to_string_pretty(&DeviceFile {
        version: 1,
        devices: devices.to_vec(),
    })
    .unwrap_or_else(|_| "{\"version\":1,\"devices\":[]}".into())
}

// ── 페어링 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PairState {
    Pending,
    Allowed,
    Denied,
}

struct PairRequest {
    id: String,
    poll: [u8; 32],
    code: String,
    name: String,
    tailscale_login: Option<String>,
    tailscale_name: Option<String>,
    expires: Instant,
    state: PairState,
}

/// 집 PC 주 창에 보내는 것(이벤트 `remote-pair-request` · `remote_pair_pending`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairNotice {
    pub request_id: String,
    pub code: String,
    pub device_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tailscale_login: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tailscale_name: Option<String>,
    pub expires_in_ms: u64,
}

/// 원격 브라우저에 주는 것 — 폴 비밀은 그 브라우저만 안다.
#[derive(Debug)]
pub(crate) struct PairTicket {
    pub poll: Secret,
    pub code: String,
    pub expires_in: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PairError {
    /// 다른 요청이 대기 중이다.
    Busy,
    /// 너무 잦다.
    RateLimited,
    /// 기기가 가득 찼다.
    Full,
    /// 무작위를 못 얻었다.
    Entropy,
}

/// 폴 한 번의 답.
#[derive(Debug)]
pub(crate) enum PairPoll {
    Pending,
    Denied,
    /// 끝났거나 모르는 요청(같은 답 — 어느 쪽인지 밝히지 않는다).
    Gone,
    /// 허용 — 새 기기 토큰(쿠키로만 나간다).
    Allowed { token: Secret, device_id: String },
}

// ── 세션 ───────────────────────────────────────────────────────────────────

struct Session {
    device_id: String,
    created: Instant,
    last: Instant,
    idle: Duration,
}

impl Session {
    fn alive(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.last) < self.idle && now.saturating_duration_since(self.created) < SESSION_MAX
    }
}

/// 원격 창 부팅 표 하나(R1a-3).
struct Ticket {
    device_id: String,
    session: [u8; 32],
    label: String,
    gen: u64,
    expires: Instant,
}

/// 부팅 표의 수명 — HTML 을 받고 번들을 내려받아 ws 를 열기까지는 넉넉하다.
pub(crate) const TICKET_TTL: Duration = Duration::from_secs(60);
/// 들고 있는 부팅 표 상한(새로 고침을 연타해도 쌓이지 않게 — 넘치면 가장 오래된 것부터 버린다).
const MAX_TICKETS: usize = 32;

/// 재확인 표 하나(R1a-4 — 설계 3절 단계 3): 그 세션 · 그 명령 · 한 번.
struct Reauth {
    session: [u8; 32],
    cmd: String,
    expires: Instant,
}

/// 재확인 표의 수명 — 암호를 친 뒤 그 명령을 보내기까지.
pub(crate) const REAUTH_TTL: Duration = Duration::from_secs(60);
/// 들고 있는 재확인 표 상한(넘치면 가장 오래된 것부터 버린다).
const MAX_REAUTHS: usize = 16;

/// 원격 창 라벨 — `remote-<기기 id>-<세대>`. 기기 id 는 hex 라 tauri 라벨 글자 규칙 안이다.
pub(crate) fn remote_label(device_id: &str, gen: u64) -> String {
    format!("{}{device_id}-{gen}", super::windows::REMOTE_PREFIX)
}

/// 세션 쿠키 값 → 세션 열쇠(`sha256`). 모양이 틀리면 `None`(해시조차 하지 않는다).
pub(crate) fn session_key(token: &str) -> Option<[u8; 32]> {
    secret_shape(token).then(|| sha(token))
}

/// 잠금 해제가 막힌 까닭.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Blocked {
    Device(Duration),
    Global(Duration),
}

impl Blocked {
    pub(crate) fn left(self) -> Duration {
        match self {
            Blocked::Device(d) | Blocked::Global(d) => d,
        }
    }
}

// ── 상태 ───────────────────────────────────────────────────────────────────

pub(crate) struct AuthState {
    devices: Vec<Device>,
    pairing: Option<PairRequest>,
    pair_times: VecDeque<Instant>,
    /// 열쇠 = `sha256(세션 토큰)`.
    sessions: HashMap<[u8; 32], Session>,
    device_fails: HashMap<String, FailLimiter>,
    global_fails: FailLimiter,
    /// 원격 창 부팅 표(R1a-3) — 열쇠 = `sha256(표)`.
    tickets: HashMap<[u8; 32], Ticket>,
    /// 재확인 표(R1a-4) — 열쇠 = `sha256(표)`.
    reauths: HashMap<[u8; 32], Reauth>,
    /// 다음 원격 창 세대 — 라벨 `remote-<기기>-<세대>` 의 끝. 앱이 도는 동안 줄지 않는다(라벨이 다시 쓰이지 않게).
    next_gen: u64,
}

impl AuthState {
    pub(crate) fn new(devices: Vec<Device>) -> Self {
        AuthState {
            devices,
            pairing: None,
            pair_times: VecDeque::new(),
            sessions: HashMap::new(),
            device_fails: HashMap::new(),
            global_fails: GLOBAL_FAILS,
            tickets: HashMap::new(),
            reauths: HashMap::new(),
            next_gen: 1,
        }
    }

    /// 기기 쿠키 → 기기 id. **모든 기기를 상수시간으로 훑는다**(일찍 빠져나가지 않는다).
    pub(crate) fn device_for(&self, token: &str) -> Option<String> {
        if !secret_shape(token) {
            return None;
        }
        let want = HEXLOWER.encode(&sha(token));
        let mut found: Option<&Device> = None;
        for d in &self.devices {
            if bool::from(d.token_sha256.as_bytes().ct_eq(want.as_bytes())) {
                found = Some(d);
            }
        }
        found.map(|d| d.id.clone())
    }

    #[cfg(test)]
    pub(crate) fn list(&self) -> Vec<DeviceInfo> {
        self.list_with(&HashSet::new(), &HashMap::new())
    }

    /// 기기 목록 + 지금 상태(열린 기기 · 기기마다 붙은 원격 창 수 — 부르는 쪽이 넣는다).
    pub(crate) fn list_with(&self, unlocked: &HashSet<String>, live: &HashMap<String, usize>) -> Vec<DeviceInfo> {
        self.devices
            .iter()
            .map(|d| DeviceInfo {
                id: d.id.clone(),
                name: d.name.clone(),
                created: d.created.clone(),
                last_seen: d.last_seen.clone(),
                unlocked: unlocked.contains(&d.id),
                connected: live.get(&d.id).copied().unwrap_or(0),
            })
            .collect()
    }

    /// 기기 이름(없으면 빈 글자) — 기록 줄·알림·원격 상태바.
    pub(crate) fn device_name(&self, device_id: &str) -> String {
        self.devices.iter().find(|d| d.id == device_id).map(|d| d.name.clone()).unwrap_or_default()
    }

    /// 기기 이름을 바꾼다(R1a-5) — 제어 문자를 걷고 길이를 자른다([`label`]). 빈 이름은 거절. 바뀌었으면 참.
    pub(crate) fn rename(&mut self, device_id: &str, name: &str) -> Result<bool, ()> {
        let name = label(name);
        if name.is_empty() {
            return Err(());
        }
        let Some(d) = self.devices.iter_mut().find(|d| d.id == device_id) else {
            return Err(());
        };
        if d.name == name {
            return Ok(false);
        }
        d.name = name;
        Ok(true)
    }

    /// 지금 열린(단계 2) 기기 id 들 — 죽은 세션은 여기서 걷는다.
    pub(crate) fn unlocked_ids(&mut self, now: Instant) -> HashSet<String> {
        self.sessions.retain(|_, s| s.alive(now));
        self.sessions.values().map(|s| s.device_id.clone()).collect()
    }

    /// 세션 열쇠 → 그 세션의 기기 id(살아 있든 아니든 — 기록 줄의 이름 찾기).
    pub(crate) fn session_device(&self, token: &str) -> Option<String> {
        if !secret_shape(token) {
            return None;
        }
        self.sessions.get(&sha(token)).map(|s| s.device_id.clone())
    }

    /// 세션 표의 열쇠(토큰의 sha) → 그 세션의 기기 id(R4 — 재확인 뒤 보낸 명령의 기록 줄).
    pub(crate) fn session_key_device(&self, key: &[u8; 32]) -> Option<String> {
        self.sessions.get(key).map(|s| s.device_id.clone())
    }

    pub(crate) fn snapshot(&self) -> String {
        render_devices(&self.devices)
    }

    pub(crate) fn touch_seen(&mut self, device_id: &str, stamp: &str) {
        if let Some(d) = self.devices.iter_mut().find(|d| d.id == device_id) {
            d.last_seen = stamp.to_string();
        }
    }

    // ── 페어링 ──

    fn live_pairing(&self, now: Instant) -> Option<&PairRequest> {
        self.pairing.as_ref().filter(|p| p.expires > now && p.state != PairState::Denied)
    }

    /// 지금 새 요청을 받으면 거절될 까닭 — 상태를 바꾸지 않는다. 관문이 CLI 를 부르기 전에 묻고, [`Self::pair_request`] 가 다시 묻는다.
    pub(crate) fn pair_refusal(&self, now: Instant) -> Option<PairError> {
        let recent = self
            .pair_times
            .iter()
            .filter(|t| now.saturating_duration_since(**t) < PAIR_RATE_WINDOW)
            .count();
        if recent >= PAIR_RATE_MAX {
            return Some(PairError::RateLimited);
        }
        if self.live_pairing(now).is_some() {
            return Some(PairError::Busy);
        }
        if self.devices.len() >= MAX_DEVICES {
            return Some(PairError::Full);
        }
        None
    }

    /// 새 페어링 요청 — 대기 중인 것(허용됐지만 아직 받아 가지 않은 것 포함)이 있으면 `Busy`.
    pub(crate) fn pair_request(
        &mut self,
        now: Instant,
        name: String,
        tailscale_login: Option<String>,
        tailscale_name: Option<String>,
    ) -> Result<(PairTicket, PairNotice), PairError> {
        while self.pair_times.front().is_some_and(|t| now.saturating_duration_since(*t) >= PAIR_RATE_WINDOW) {
            self.pair_times.pop_front();
        }
        if let Some(refused) = self.pair_refusal(now) {
            return Err(refused);
        }
        let (Some(poll), Some(id), Some(code)) = (Secret::generate(), short_id(), six_digits()) else {
            return Err(PairError::Entropy);
        };
        self.pair_times.push_back(now);
        let req = PairRequest {
            id: id.clone(),
            poll: sha(poll.as_str()),
            code: code.clone(),
            name: label(&name),
            tailscale_login: tailscale_login.map(|s| label(&s)).filter(|s| !s.is_empty()),
            tailscale_name: tailscale_name.map(|s| label(&s)).filter(|s| !s.is_empty()),
            expires: now + PAIR_TTL,
            state: PairState::Pending,
        };
        let notice = notice(&req, now);
        self.pairing = Some(req);
        Ok((
            PairTicket {
                poll,
                code,
                expires_in: PAIR_TTL,
            },
            notice,
        ))
    }

    /// 지금 사람의 답을 기다리는 요청(주 창이 새로 떴을 때).
    pub(crate) fn pair_pending(&self, now: Instant) -> Option<PairNotice> {
        self.live_pairing(now)
            .filter(|p| p.state == PairState::Pending)
            .map(|p| notice(p, now))
    }

    /// 집 PC 사람의 답. 모르는·끝난·이미 답한 요청이면 `Err`.
    pub(crate) fn pair_respond(&mut self, request_id: &str, allow: bool, now: Instant) -> Result<(), ()> {
        match self.pairing.as_mut() {
            Some(p) if p.id == request_id && p.state == PairState::Pending && p.expires > now => {
                p.state = if allow { PairState::Allowed } else { PairState::Denied };
                Ok(())
            }
            _ => Err(()),
        }
    }

    /// 원격 브라우저의 폴. 허용이면 **여기서** 기기를 만들고(해시만 남긴다) 토큰을 돌려준다 — 요청은 사라진다.
    pub(crate) fn pair_poll(&mut self, poll: &str, now: Instant, stamp: &str) -> PairPoll {
        if !secret_shape(poll) {
            return PairPoll::Gone;
        }
        let want = sha(poll);
        let Some(p) = self.pairing.as_ref() else {
            return PairPoll::Gone;
        };
        if !bool::from(p.poll.ct_eq(&want)) {
            return PairPoll::Gone;
        }
        if p.expires <= now {
            self.pairing = None;
            return PairPoll::Gone;
        }
        match p.state {
            PairState::Pending => PairPoll::Pending,
            PairState::Denied => {
                self.pairing = None;
                PairPoll::Denied
            }
            PairState::Allowed => {
                let Some(p) = self.pairing.take() else {
                    return PairPoll::Gone;
                };
                if self.devices.len() >= MAX_DEVICES {
                    return PairPoll::Denied;
                }
                let (Some(token), Some(device_id)) = (Secret::generate(), short_id()) else {
                    return PairPoll::Gone;
                };
                self.devices.push(Device {
                    id: device_id.clone(),
                    name: if p.name.is_empty() { "브라우저".into() } else { p.name },
                    token_sha256: HEXLOWER.encode(&sha(token.as_str())),
                    created: stamp.to_string(),
                    last_seen: stamp.to_string(),
                    tailscale_login: p.tailscale_login,
                    tailscale_name: p.tailscale_name,
                });
                PairPoll::Allowed { token, device_id }
            }
        }
    }

    // ── 원격 가림막 ──

    /// 이 기기의 잠금 해제가 지금 막혀 있는가(전역 먼저).
    pub(crate) fn unlock_blocked(&self, device_id: &str, now: Instant) -> Option<Blocked> {
        if let Some(d) = self.global_fails.blocked(now) {
            return Some(Blocked::Global(d));
        }
        self.device_fails
            .get(device_id)
            .and_then(|l| l.blocked(now))
            .map(Blocked::Device)
    }

    /// 실패 하나 — 이번 실패로 막혔으면 그 길이(기기·전역 중 긴 것). 로그용 누계도 돌려준다.
    pub(crate) fn unlock_failed(&mut self, device_id: &str, now: Instant) -> (Option<Duration>, u64) {
        let dev = self.device_fails.entry(device_id.to_string()).or_insert(DEVICE_FAILS);
        let a = dev.fail(now);
        let b = self.global_fails.fail(now);
        (a.max(b), self.global_fails.total())
    }

    /// 마스터 확인에 성공했다 — 이 기기의 실패 셈을 지운다(재확인 — 세션은 이미 열려 있다).
    pub(crate) fn unlock_succeeded(&mut self, device_id: &str) {
        if let Some(l) = self.device_fails.get_mut(device_id) {
            l.success();
        }
    }

    /// 걷음 — 실패 셈을 지우고 세션을 하나 연다(토큰은 쿠키로만 나간다).
    pub(crate) fn open_session(&mut self, device_id: &str, idle: Duration, now: Instant) -> Option<Secret> {
        if !self.devices.iter().any(|d| d.id == device_id) {
            return None;
        }
        let token = Secret::generate()?;
        if let Some(l) = self.device_fails.get_mut(device_id) {
            l.success();
        }
        self.sessions.insert(
            sha(token.as_str()),
            Session {
                device_id: device_id.to_string(),
                created: now,
                last: now,
                idle,
            },
        );
        Some(token)
    }

    /// 세션 쿠키가 이 기기의 살아 있는 세션인가 — 맞으면 무입력 시계를 되감는다. 죽은 세션은 여기서 지운다.
    pub(crate) fn session_for(&mut self, device_id: &str, token: &str, now: Instant) -> bool {
        if !secret_shape(token) {
            return false;
        }
        let key = sha(token);
        let Some(s) = self.sessions.get_mut(&key) else {
            return false;
        };
        if !s.alive(now) {
            self.sessions.remove(&key);
            return false;
        }
        if s.device_id != device_id {
            return false;
        }
        s.last = now;
        true
    }

    /// 세션 하나를 닫는다(원격 [잠그기]).
    pub(crate) fn close_session(&mut self, token: &str) -> bool {
        secret_shape(token) && self.sessions.remove(&sha(token)).is_some()
    }

    /// 기기를 폐기한다 — 그 기기의 세션·실패 셈도 함께. 있었으면 참.
    pub(crate) fn revoke(&mut self, device_id: &str) -> bool {
        let before = self.devices.len();
        self.devices.retain(|d| d.id != device_id);
        self.sessions.retain(|_, s| s.device_id != device_id);
        self.device_fails.remove(device_id);
        self.devices.len() != before
    }

    /// 모든 세션을 닫는다(관문을 끌 때) — 닫은 수.
    pub(crate) fn drop_sessions(&mut self) -> usize {
        let n = self.sessions.len();
        self.sessions.clear();
        n
    }

    /// 지금 열린(단계 2) **기기 수** — 죽은 세션은 여기서 걷는다(상태바·이벤트 `remote-sessions`).
    pub(crate) fn unlocked_devices(&mut self, now: Instant) -> usize {
        self.sessions.retain(|_, s| s.alive(now));
        let mut ids: Vec<&str> = self.sessions.values().map(|s| s.device_id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        ids.len()
    }

    // ── 원격 창(R1a-3) ──

    /// 세션이 아직 살아 있는가 — 시계를 되감지 않는다(ws 의 주기 확인). 죽은 세션은 여기서 지운다.
    pub(crate) fn session_alive(&mut self, key: &[u8; 32], now: Instant) -> bool {
        match self.sessions.get(key) {
            Some(s) if s.alive(now) => true,
            Some(_) => {
                self.sessions.remove(key);
                false
            }
            None => false,
        }
    }

    /// 원격 창에서 **사람이 입력했다** — 무입력 시계를 되감는다(살아 있을 때만). 프런트의 IPC 폴링은 되감지 않는다.
    pub(crate) fn touch_session(&mut self, key: &[u8; 32], now: Instant) -> bool {
        if !self.session_alive(key, now) {
            return false;
        }
        if let Some(s) = self.sessions.get_mut(key) {
            s.last = now;
        }
        true
    }

    /// 앱 셸을 내줄 때 — 부팅 표 하나(값은 그 HTML 에만) + 창 라벨 + 세대. 세션이 죽었거나 무작위를 못 얻으면 `None`.
    pub(crate) fn issue_ticket(&mut self, device_id: &str, session: &[u8; 32], now: Instant) -> Option<(Secret, String, u64)> {
        if !self.session_alive(session, now) {
            return None;
        }
        self.tickets.retain(|_, t| t.expires > now);
        while self.tickets.len() >= MAX_TICKETS {
            let oldest = self.tickets.iter().min_by_key(|(_, t)| t.expires).map(|(k, _)| *k)?;
            self.tickets.remove(&oldest);
        }
        let ticket = Secret::generate()?;
        let gen = self.next_gen;
        self.next_gen += 1;
        let label = remote_label(device_id, gen);
        self.tickets.insert(
            sha(ticket.as_str()),
            Ticket {
                device_id: device_id.to_string(),
                session: *session,
                label: label.clone(),
                gen,
                expires: now + TICKET_TTL,
            },
        );
        Some((ticket, label, gen))
    }

    /// `/remote/ws` 의 표 — **한 번만**, 같은 기기·같은 세션·시한 안·세션이 살아 있을 때만 `(라벨, 세대)`.
    pub(crate) fn take_ticket(&mut self, ticket: &str, device_id: &str, session: &[u8; 32], now: Instant) -> Option<(String, u64)> {
        if !secret_shape(ticket) {
            return None;
        }
        let t = self.tickets.remove(&sha(ticket))?;
        let ok = t.expires > now
            && t.device_id == device_id
            && bool::from(t.session.ct_eq(session))
            && self.session_alive(session, now);
        ok.then_some((t.label, t.gen))
    }
}

impl AuthState {
    // ── 재확인(R1a-4) ──

    /// 마스터를 다시 확인했다(또는 마스터가 없다) — 이 세션이 이 명령 한 번에 쓸 표. 세션이 죽었거나 무작위를 못 얻으면 `None`.
    pub(crate) fn issue_reauth(&mut self, session: &[u8; 32], cmd: &str, now: Instant) -> Option<Secret> {
        if !self.session_alive(session, now) {
            return None;
        }
        self.reauths.retain(|_, r| r.expires > now);
        while self.reauths.len() >= MAX_REAUTHS {
            let oldest = self.reauths.iter().min_by_key(|(_, r)| r.expires).map(|(k, _)| *k)?;
            self.reauths.remove(&oldest);
        }
        let ticket = Secret::generate()?;
        self.reauths.insert(
            sha(ticket.as_str()),
            Reauth {
                session: *session,
                cmd: cmd.to_string(),
                expires: now + REAUTH_TTL,
            },
        );
        Some(ticket)
    }

    /// `bridge` 의 문 — 표가 이 세션·이 명령의 것이고 시한 안이며 세션이 살아 있으면 참. **맞든 틀리든 그 표는 끝**(한 번).
    pub(crate) fn take_reauth(&mut self, ticket: &str, session: &[u8; 32], cmd: &str, now: Instant) -> bool {
        if !secret_shape(ticket) {
            return false;
        }
        let Some(r) = self.reauths.remove(&sha(ticket)) else {
            return false;
        };
        r.expires > now && bool::from(r.session.ct_eq(session)) && r.cmd == cmd && self.session_alive(session, now)
    }
}

fn notice(p: &PairRequest, now: Instant) -> PairNotice {
    PairNotice {
        request_id: p.id.clone(),
        code: p.code.clone(),
        device_name: p.name.clone(),
        tailscale_login: p.tailscale_login.clone(),
        tailscale_name: p.tailscale_name.clone(),
        expires_in_ms: p.expires.saturating_duration_since(now).as_millis() as u64,
    }
}

// ── 앱 전역 한 벌 + 디스크 ─────────────────────────────────────────────────

/// 관문이 쥐는 한 벌 — 상태 + 기기 파일 자리. 관문을 껐다 켜도(설정 저장) 같은 한 벌이다(세션만 지운다).
pub(crate) struct Auth {
    pub(crate) state: Mutex<AuthState>,
    path: Option<PathBuf>,
    /// 디스크 쓰기를 한 줄로 — 쓰는 순간의 상태를 이 락 안에서 찍으므로 마지막 쓰기가 늘 최신이다.
    persist: Mutex<()>,
}

impl Auth {
    /// 기기 파일을 읽어 세운다(없으면 빈 목록). **블로킹**(작은 파일 하나) — setup 에서 한 번.
    pub(crate) fn load(dir: Option<PathBuf>) -> Auth {
        let path = dir.map(|d| d.join(DEVICES_FILE));
        let devices = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|t| parse_devices(&t))
            .unwrap_or_default();
        Auth {
            state: Mutex::new(AuthState::new(devices)),
            path,
            persist: Mutex::new(()),
        }
    }

    /// 시험 전용 — 디스크 없이 상태 하나로.
    #[cfg(test)]
    pub(crate) fn for_test(state: AuthState) -> Auth {
        Auth {
            state: Mutex::new(state),
            path: None,
            persist: Mutex::new(()),
        }
    }

    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, AuthState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 지금 기기 목록을 파일로 — 원자 교체 · 가능한 OS 에서 0600. **블로킹**. 실패는 한 줄 로그(값 없음).
    pub(crate) fn persist_blocking(&self) {
        let Some(path) = &self.path else {
            return;
        };
        let _g = self.persist.lock().unwrap_or_else(|e| e.into_inner());
        let body = self.lock().snapshot();
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match crate::fs_atomic::write_atomic(path, body.as_bytes()) {
            Ok(()) => {
                let _ = crate::vault::restrict_file(path);
            }
            Err(e) => eprintln!("[aynx] 원격 기기 목록을 저장하지 못했습니다: {e}"),
        }
    }
}

/// 지금 시각 RFC 3339(로컬) — 기기의 `created`·`last_seen`.
pub(crate) fn stamp() -> String {
    chrono::Local::now().to_rfc3339()
}
