//! Delegation — `~/.aynx/delegation.toml` 에 사용자가 **명시적으로 위임한** 헤드리스 대상 목록.
//!
//! 2026-09-21 까지 이 파일의 이름은 `fleet.toml`(“함대”)이었다. 여기 적히는 것은 배(船)가
//! 아니라 **사용자가 호스트마다 AI 에게 준 권한 다섯**이라 이름을 `delegation` 으로 바꿨다 —
//! 스키마는 그대로이고, 옛 파일은 [`migrate_legacy_file`] 이 한 번 옮긴다
//! (docs/log/2026-09-21-rename-fleet-to-delegation.md).
//!
//! ## 이 파일이 여는 유일한 문(門)
//!
//! 헤드리스 접속([`crate::headless::open_headless_session`])은 타일도 셸도 없이 원격에 붙어 세션을
//! 만든다 — 사람이 그 자리에서 승인하는 절차가 없다. 그래서 **그 능력은 사용자가 위임한
//! 별칭에만** 생긴다(보안 불변: "명시적으로 위임한 범위 안에서만 실행").
//! 위임의 형식은 사전 정책(자동 승인)이되 **범위·한도가 명시된** 것이고, 이 파일이 그 정책이다.
//!
//! 적는 길은 둘이고 **둘 다 사람의 손**이다: 파일을 직접 고치거나, **호스트 폼의 "AI"
//! 칸·타일 머리줄의 AI 권한 팝오버**(Tauri 명령 [`delegation_set_target`]·[`delegation_rename_target`]·
//! [`delegation_remove_targets`])를 쓰거나. **MCP 에는 이 파일을 건드리는 도구가 하나도 없다** — 승인
//! 명령과 같은 규칙이라 AI 는 자기 위임을 넓힐 표면이 없다 (docs/log/2026-09-21-fleet-delegation-ui.md).
//! 세 쓰기 명령은 성공하면 앱 전역 이벤트 [`CHANGED_EVENT`] 를 내고, 모든 창이 권한을 다시 읽는다.
//!
//! ## 호스트 하나 = AI 권한 하나 (2026-10-07)
//!
//! 이 파일은 헤드리스 세션만이 아니라 **그 별칭의 모든 원격 세션**(사람이 연 창 타일 포함)의 AI 권한이다.
//! 권한은 **누적 단계 다섯** — `off` < `read`(읽기 전용) < `approve`(승인 후 실행) < `auto`(자동 승인 실행) <
//! `all`(모두 승인 — 2026-10-23, docs/log/2026-10-23-approve-all.md) — 이고, 저장 형식은 예전 불리언 그대로다(`approve_all` 이 늘었다). 판정은 **누적으로** 읽는다(옛 파일의 비누적 조합도 이 규칙으로
//! 해석된다 · 마이그레이션 없음):
//! - 읽기 = `read` ([`Delegation::read_granted`])
//! - 작업안 대상 = `read && propose` ([`Delegation::propose_granted`])
//! - 자동 실행 = `read && propose && auto_execute` ([`Delegation::auto_execute_granted`])
//! - 모두 승인 = 자동 실행 `&& approve_all` ([`Delegation::approve_all_granted`]) — 대상이 전부 이 단계인 작업안은 허용 목록 ·
//!   위험 판정 · 메타문자 · 빈도 한도 없이 자동 승인된다(caps · 전체 스위치 `[automation] auto_approve` · 감사 · 만료는 그대로).
//! - 헤드리스 접속 = 작업안 대상 `&& connect` ([`Delegation::connect_granted`]) — 접속은 'Ask'
//!   이상에서만 켤 수 있다. 볼트의 키 암호구는 그 위에 `&& vault_passphrase`.
//!
//! 쓰기는 [`normalize_grants`] 가 같은 의존을 정규화해 파일이 늘 누적 모양이 되게 한다.
//!
//! 그물은 둘이다.
//! - 헤드리스 접속 권한이 없으면 헤드리스 접속 자체가 없다([`Delegation::connect_granted`]).
//! - 별칭이 config 에서 다른 곳을 가리키게 바뀌면(재지목·config 변경) 신원 스냅샷이
//!   어긋나 거부된다([`Delegation::identity_matches`]).
//!
//! 파일이 없으면 위임이 하나도 없는 **빈 위임 목록**이다 — 앱을 오류로 세우지 않는다(없음 = 아무 권한 없음).
//!
//! 같은 파일에 DB 연결의 AI 권한 `[[database]]`([`database`])와 오케스트레이션 **저장소 맡기기** `[[repo]]`([`repo`] — 역할 표 ·
//! 수락 규칙 · 검증 · 한도, 3차 1단계)가 함께 산다. 구성 묶음은 따로 `<설정 루트>/orchestration-presets.toml`([`presets`]).
//!
//! ```toml
//! [[target]]
//! alias        = "Remote-SSH"
//! expect_user  = "innobe"
//! expect_host  = "localhost"
//! expect_port  = 1220
//! connect      = true
//! read         = true
//! propose      = true
//! vault_passphrase = false   # 이 호스트의 헤드리스 접속만 볼트의 키 암호구를 쓴다
//! auto_execute = false
//! client       = "any"      # "any" | "claude" | "codex"
//! ```

use std::path::{Path, PathBuf};

/// 위임 대상 하나. 권한 불(不)값은 **적지 않으면 `false`** (`#[serde(default)]`) — 위임은
/// 명시로만 생긴다. `client` 는 적지 않으면 `"any"`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct DelegationTarget {
    /// `~/.ssh/config` 의 별칭. [`crate::ssh::resolve_params`] 가 이 이름을 편다.
    pub alias: String,
    /// 신원 스냅샷: 이 별칭이 접속할 것으로 사용자가 기대하는 사용자 이름.
    pub expect_user: String,
    /// 신원 스냅샷: 기대 호스트(HostName 해석 결과).
    pub expect_host: String,
    /// 신원 스냅샷: 기대 포트.
    pub expect_port: u16,
    /// 헤드리스 접속을 허용하는가. **이 문이 열려야 접속이 있다** — 판정은 누적이라
    /// `propose` 단계 아래면 이 칸은 무시된다([`Delegation::connect_granted`]).
    #[serde(default)]
    pub connect: bool,
    /// AI(MCP) 읽기 가시성 — 이 별칭의 창 타일·헤드리스 세션 모두(단계 `read` 이상).
    #[serde(default)]
    pub read: bool,
    /// AI 가 이 별칭의 세션을 작업안 대상으로 삼을 수 있는가(단계 `approve` 이상 — `read` 가 함께 있어야 한다).
    #[serde(default)]
    pub propose: bool,
    /// 자동 승인 규칙에 맞으면 사람 없이 실행할 수 있는가(단계 `auto` — `read`·`propose` 가 함께 있어야 한다).
    #[serde(default)]
    pub auto_execute: bool,
    /// **모두 승인**(2026-10-23 — 단계 `all`, `auto_execute` 위에서만). 대상이 전부 이 단계인 작업안은 명령을 가리지 않고
    /// 자동 승인된다(docs/log/2026-10-23-approve-all.md). 옛 판은 이 키를 모른 채 버린다(= 'Auto' 로 좁아진다).
    #[serde(default)]
    pub approve_all: bool,
    /// **볼트에 담긴 이 호스트 키의 암호구를 헤드리스 접속에서 쓸 수 있는가** (2026-09-22).
    ///
    /// 기본 불변("헤드리스 위임은 볼트를 쓰지 않는다")을 **없애는 것이 아니라 좁히는** 칸이다:
    /// 이 칸이 켜진 호스트에서만 무인 접속이 `IdentityFile` 을 볼트의 암호구로 열고, 그
    /// 밖의 모든 호스트에서는 예전 그대로 볼트를 보지 않는다. 비밀번호는 **여전히** 쓰지
    /// 않는다 — 열리는 것은 키 암호구 하나뿐이다
    /// (docs/log/2026-09-22-delegation-vault-passphrase.md).
    #[serde(default)]
    pub vault_passphrase: bool,
    /// 어느 CLI 에 위임하는가(`"any"`·`"claude"`·`"codex"`). **A1 은 파싱만 한다**.
    #[serde(default = "default_client")]
    pub client: String,
}

fn default_client() -> String {
    "any".to_string()
}

/// `delegation.toml` 전체 — 호스트 `[[target]]` 배열과 DB 연결 `[[database]]` 배열(3단계 3a — [`database`]).
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct Delegation {
    #[serde(default, rename = "target")]
    targets: Vec<DelegationTarget>,
    /// DB 연결의 AI 권한(3단계 3a) — 옛 판은 이 키를 모른 채 버린다(호스트 위임은 그대로 읽힌다).
    #[serde(default, rename = "database")]
    databases: Vec<database::DatabaseTarget>,
}

impl Delegation {
    /// TOML 본문을 파싱한다 — **순수 함수**(테스트 대상). 문법 오류는 사람이 읽을 문자열.
    ///
    /// 번역하지 않는다 — 이 문자열이 닿는 곳은 화면이 아니라 [`Delegation::load_at`] 의
    /// `eprintln!` 하나뿐이다(깨진 `delegation.toml` 은 빈 위임 목록이 되고 UI 에는 아무 말도 안 간다).
    /// `delegation.toml` 을 화면에서 손보는 입구가 생기면 그때 `tr!` 로 옮긴다.
    pub fn parse(content: &str) -> Result<Delegation, String> {
        toml::from_str(content).map_err(|e| format!("delegation.toml 을 해석할 수 없습니다: {e}"))
    }

    /// `~/.aynx/delegation.toml` 을 읽는다. **없거나 못 읽으면 빈 위임 목록**(위임 없음) — 앱을 세우지 않는다.
    ///
    /// 읽기 직전에 [`migrate_legacy_file`] 이 옛 이름(`fleet.toml`)을 **한 번** 옮긴다 —
    /// 2026-09-21 개명의 이사 통로다 (docs/log/2026-09-21-rename-fleet-to-delegation.md).
    pub fn load_default() -> Delegation {
        match delegation_path() {
            Some(path) => {
                migrate_legacy_file(&path);
                Delegation::load_at(&path)
            }
            None => Delegation::default(),
        }
    }

    /// 경로를 받는 읽기 — **테스트 대상**. 없는 파일은 빈 위임 목록, 깨진 파일은 경고 한 줄 뒤 빈 위임 목록.
    fn load_at(path: &Path) -> Delegation {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            // 파일이 없는 것은 오류가 아니다 — 위임이 하나도 없는 것이다.
            Err(_) => return Delegation::default(),
        };
        match Delegation::parse(&content) {
            Ok(delegation) => delegation,
            Err(e) => {
                // 깨진 위임 정책으로 접속을 여느니, 위임이 없는 것으로 본다(안전한 쪽).
                eprintln!("[aynx] {e} — 위임 목록을 비웁니다");
                Delegation::default()
            }
        }
    }

    /// 별칭으로 대상을 찾는다. SSH config 처럼 **대소문자를 무시**한다.
    pub fn target(&self, alias: &str) -> Option<&DelegationTarget> {
        self.targets
            .iter()
            .find(|t| t.alias.eq_ignore_ascii_case(alias))
    }

    /// **헤드리스 접속이 위임된**(누적 판정 [`connect_granted`](Self::connect_granted)) 대상만 돌려준다 —
    /// 세션 목록의 "미접속 위임" 발견 항목의 재료.
    ///
    /// 아직 접속하지 않은(라이브 거울에 없는) 위임 대상을 AI·사람 콘솔이 목록에서 미리 볼 수
    /// 있게 하는 값이다(A3a). 2026-10-07 부터 `read` 는 **그 호스트의 모든 원격 세션**(창 타일 포함)의
    /// 읽기 권한이라, `read` 만으로 합성 항목을 내면 읽기만 준 호스트마다 붙을 수도 없는 헤드리스
    /// 유령 줄이 생긴다 — 그래서 앱이 실제로 타일 없이 붙을 수 있는 대상(접속 위임)만 낸다. 그런
    /// 대상은 누적 규칙상 늘 `read` 도 있다.
    pub fn headless_targets(&self) -> Vec<&DelegationTarget> {
        self.targets
            .iter()
            .filter(|t| t.read && t.propose && t.connect)
            .collect()
    }

    /// 이 별칭에 **헤드리스 접속이 위임**됐는가. 목록에 없으면 `false`.
    ///
    /// **누적 판정**: 접속은 'Ask' 이상에서만 켤 수 있으므로 [`propose_granted`](Self::propose_granted)
    /// 가 함께 참이어야 한다 — 옛 파일의 `connect = true` + `propose = false` 는 접속이 없다.
    pub fn connect_granted(&self, alias: &str) -> bool {
        self.target(alias).is_some_and(|t| t.read && t.propose && t.connect)
    }

    /// 이 별칭이 AI 읽기에 **공유**됐는가(단계 `read` 이상). 목록에 없으면 `false`.
    pub fn read_granted(&self, alias: &str) -> bool {
        self.target(alias).is_some_and(|t| t.read)
    }

    /// 이 별칭의 세션이 **작업안 대상**이 될 수 있는가(단계 `approve` 이상). 목록에 없으면 `false`.
    ///
    /// **누적 판정** `read && propose` — 읽을 수 없는 대상에 실행을 제안할 수는 없다. 창 타일·헤드리스
    /// 세션의 대상 자격과 실행 시점 재검사가 이 문 하나를 본다.
    pub fn propose_granted(&self, alias: &str) -> bool {
        self.target(alias).is_some_and(|t| t.read && t.propose)
    }

    /// 이 별칭에 **승인 없는 자동 실행이 위임**됐는가(단계 `auto`). 목록에 없으면 `false`.
    ///
    /// **누적 판정** `read && propose && auto_execute`. 무인 자동 승인(#10b)이 명령·상한·전역 정책을
    /// 통과한 뒤 **대상별로 또 한 번** 보는 문이다 — 이 문이 없으면 자동 실행은 없다(A4a).
    pub fn auto_execute_granted(&self, alias: &str) -> bool {
        self.target(alias)
            .is_some_and(|t| t.read && t.propose && t.auto_execute)
    }

    /// 이 별칭이 **모두 승인**(단계 `all`)인가. 목록에 없으면 `false`.
    ///
    /// **누적 판정** [`auto_execute_granted`](Self::auto_execute_granted)` && approve_all`. 작업안의 대상이 **전부** 이 단계일 때만
    /// 자동 승인이 명령 정책(허용 목록 · 위험 · 메타문자)과 빈도 한도를 건너뛴다(`operations::gate::approve_all_plan`).
    pub fn approve_all_granted(&self, alias: &str) -> bool {
        self.auto_execute_granted(alias) && self.target(alias).is_some_and(|t| t.approve_all)
    }

    /// 모두 승인(누적 판정)인 호스트가 **몇이나 되는가** — 요약용 숫자 하나(MCP `get_auto_approval_policy`). 별칭은 내보내지 않는다.
    pub fn approve_all_granted_count(&self) -> usize {
        self.targets
            .iter()
            .filter(|t| t.read && t.propose && t.auto_execute && t.approve_all)
            .count()
    }

    /// 이 별칭에 **볼트의 키 암호구 사용이 위임**됐는가. 목록에 없으면 `false`.
    ///
    /// 헤드리스 접속([`connect_granted`](Self::connect_granted))이 있을 때만 참이다(누적).
    /// [`crate::headless::connect_delegated`] 만 이 문을 본다 — 사람이 있는 접속은 예나 지금이나
    /// 볼트를 그대로 쓴다(이 칸과 무관하다).
    pub fn vault_passphrase_granted(&self, alias: &str) -> bool {
        self.connect_granted(alias) && self.target(alias).is_some_and(|t| t.vault_passphrase)
    }

    /// 자동 실행이 위임된(누적 판정) 대상이 **몇이나 되는가** — 요약용 숫자 하나.
    ///
    /// MCP `get_auto_approval_policy`(읽기 전용)가 AI 에게 "무인 실행이 열린 대상이 있는가" 를
    /// 알려 줄 때 쓴다. **별칭·호스트·사용자 이름은 절대 내보내지 않는다** — 숫자만 나간다
    /// (위임 파일은 위임 정책이지 주소록이 아니다).
    pub fn auto_execute_granted_count(&self) -> usize {
        self.targets
            .iter()
            .filter(|t| t.read && t.propose && t.auto_execute)
            .count()
    }

    /// 해석된 (user, host, port)가 별칭의 신원 스냅샷과 **모두 일치**하는가.
    ///
    /// 셋 중 하나라도 다르면 `false` — 별칭이 config 에서 다른 곳을 가리키게 바뀌었다는 뜻이라
    /// 헤드리스 접속을 거부해야 한다(사용자가 위임한 그 서버가 아닐 수 있다).
    pub fn identity_matches(&self, alias: &str, user: &str, host: &str, port: u16) -> bool {
        self.target(alias).is_some_and(|t| {
            t.expect_user == user && t.expect_host == host && t.expect_port == port
        })
    }
}

/// `~/.aynx/delegation.toml` 경로 (`mcp.json` 과 같은 폴더).
fn delegation_path() -> Option<PathBuf> {
    Some(crate::instance::home_root()?.join("delegation.toml"))
}

/// 2026-09-21 개명 이전의 파일 이름 — **이 상수가 옛 이름이 남은 유일한 자리**다.
const LEGACY_FILE_NAME: &str = "fleet.toml";

/// 옛 이름의 파일이 남아 있으면 **한 번** 새 이름으로 옮긴다 (docs/log/2026-09-21-rename-fleet-to-delegation.md).
///
/// 조건은 둘 다여야 한다: 새 파일이 **없고** 옛 파일이 **있다**. 새 파일이 이미 있으면 손대지
/// 않는다 — 둘 다 들고 있는 사람에게는 새 이름이 이긴다(옛 파일은 그 자리에 남아 사람이 지운다).
/// 내용은 한 글자도 건드리지 않는다: 스키마(`[[target]]`·키 이름)는 개명에서 바뀌지 않았다.
///
/// 실패는 **경고 한 줄**로 끝난다 (`load_at` 의 깨진 파일과 같은 규칙) — 이사에 실패했다고 앱을
/// 세울 이유가 없다. 그때는 위임이 하나도 없는 것으로 읽히고, 다음 실행에서 다시 시도한다.
fn migrate_legacy_file(path: &Path) {
    if path.exists() {
        return;
    }
    let Some(legacy) = path.parent().map(|dir| dir.join(LEGACY_FILE_NAME)) else {
        return;
    };
    if !legacy.exists() {
        return;
    }
    match std::fs::rename(&legacy, path) {
        Ok(()) => eprintln!(
            "[aynx] {} 을(를) {} 로 옮겼습니다 (fleet → delegation 개명)",
            legacy.display(),
            path.display()
        ),
        Err(e) => eprintln!(
            "[aynx] {} 을(를) {} 로 옮기지 못했습니다 — 이번 실행은 위임이 없는 것으로 봅니다: {e}",
            legacy.display(),
            path.display()
        ),
    }
}

// ---------------------------------------------------------------------------
// 쓰기 — `[[target]]` 국소 편집 (toml_edit)
//
// 규칙은 `sessions_meta.rs` 의 쓰기와 **같다**: `toml` 로 역직렬화 후 재직렬화하지 않고
// [`toml_edit`] 로 **해당 블록의 아는 키만** 갈아 끼운다. 사람이 손으로 적은 주석·키 순서·
// 들여쓰기·모르는 키(`client` 같은 것)는 한 글자도 바뀌지 않는다.
//
// 이 파일에만 있는 함정 하나: `[[target]]` 은 **배열 오브 테이블**이라 블록을 지우면 그
// 블록의 **앞 장식**(= TOML 에서 주석이 사는 유일한 자리)이 함께 사라진다. 첫 블록의 앞
// 장식은 **파일 머리글**일 수 있으므로 [`remove_indices`] 가 그것을 다음 블록 앞으로 옮긴다.
// ---------------------------------------------------------------------------

use toml_edit::{ArrayOfTables, Decor, DocumentMut, Item, Table, Value};

use crate::i18n::tr;
use crate::sessions_meta::match_line_endings;

/// 파일을 새로 만들 때만 얹는 머리글 (`sessions_meta::NEW_FILE_HEADER` 와 같은 규칙 —
/// 이미 있는 파일에는 절대 덧붙이지 않는다).
const NEW_FILE_HEADER: &str = "\
# ~/.aynx/delegation.toml — 호스트별 AI 권한 (aynx 전용)
# 호스트 폼 · DB 연결 폼의 \"AI 권한\" 칸이 이 파일을 고칩니다. 손으로 적은 주석·순서는 보존됩니다.

";

/// 화면이 켜고 끄는 **권한 다섯** — 신원 스냅샷은 여기 없다(그것은 Rust 가 계산한다).
///
/// `#[serde(default)]` 는 [`DelegationTarget`] 과 같은 뜻이다: 적지 않으면 `false`, 위임은 명시로만.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct DelegationGrants {
    #[serde(default)]
    pub connect: bool,
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub propose: bool,
    #[serde(default)]
    pub auto_execute: bool,
    /// 모두 승인(2026-10-23 — `auto_execute` 위에서만). 옛 프런트는 이 칸을 보내지 않는다(= 끔).
    #[serde(default)]
    pub approve_all: bool,
    /// 볼트의 키 암호구를 이 호스트의 **헤드리스 접속에서만** 쓴다 (2026-09-22 ·
    /// [`DelegationTarget::vault_passphrase`]).
    #[serde(default)]
    pub vault_passphrase: bool,
}

impl DelegationGrants {
    /// 다섯 중 하나라도 켜져 있는가 — 꺼져 있으면 파일에 **블록을 남기지 않는다**.
    fn any(&self) -> bool {
        self.connect || self.read || self.propose || self.auto_execute || self.approve_all || self.vault_passphrase
    }
}

/// 프런트가 보는 위임 한 줄 — **신원 스냅샷은 빼고** 별칭·권한·클라이언트만.
///
/// 스냅샷(`expect_user`/`expect_host`/`expect_port`)을 내보내지 않는 이유: 화면이 쓰지
/// 않는 값이고, 계산도 검사도 Rust 안에서 끝난다([`identity_snapshot`] ·
/// [`Delegation::identity_matches`]). 프런트가 그 값을 쥐면 "폼에서 고칠 수 있는 칸" 으로 보이고,
/// 그 순간 신원 그물이 사용자 입력으로 내려앉는다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DelegationTargetView {
    pub alias: String,
    pub connect: bool,
    pub read: bool,
    pub propose: bool,
    pub auto_execute: bool,
    pub approve_all: bool,
    pub vault_passphrase: bool,
    pub client: String,
    /// 이 별칭이 아직 `~/.ssh/config` 에 **있는가** — 거짓이면 **고아 위임**이다
    /// (호스트 이름을 바꾸면 `delegation.toml` 의 옛 블록이 그대로 남아 영영 붙지 않는다).
    ///
    /// 설정을 **못 읽었으면 전부 `true`** 다 — "모른다" 를 고아로 칠하지 않는다
    /// ([`crate::ssh_config::config_index`] 가 그때 `None` 을 낸다). 화면(설정 › 보안의
    /// 위임 표)과 부팅 알림이 이 한 칸으로 "정리 필요" 를 가른다
    /// (docs/log/2026-09-21-fleet-delegation-ui.md).
    pub alias_known: bool,
}

/// 별칭이 지금 가리키는 서버 — 위임을 적는 순간 박아 두는 **신원 스냅샷**.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IdentitySnapshot {
    pub user: String,
    pub host: String,
    pub port: u16,
}

/// 권한 사이의 **의존 규칙을 정규화**한다 — **순수 함수**(유닛 테스트 대상).
///
/// 단계는 누적이다: `모두 승인 ⊂ 자동 실행 ⊂ 작업안 ⊂ 읽기` 이고, 헤드리스 `접속 ⊂ 작업안`, `볼트 암호구 ⊂ 접속` 이다
/// (2026-10-07 — 예전의 "작업안 ⊂ 접속" 은 뒤집혔다: 창 타일은 이미 붙어 있어 작업안이 접속에 매이지
/// 않는다). 화면이 스위치를 재워 애초에 만들 수 없는 조합이지만, 여기서 한 번 더 고치는 이유는 이
/// 명령이 **IPC 표면**이기 때문이다 — 화면 밖에서 온 호출이 비누적 조합을 적어도 파일은 늘 누적 모양이다.
/// 거부하지 않고 **좁히는 쪽으로만** 고친다(위에 놓인 칸을 끈다) — 넓히는 일은 없다.
pub(crate) fn normalize_grants(g: &DelegationGrants) -> DelegationGrants {
    let read = g.read;
    let propose = read && g.propose;
    let auto_execute = propose && g.auto_execute;
    let approve_all = auto_execute && g.approve_all;
    let connect = propose && g.connect;
    let vault_passphrase = connect && g.vault_passphrase;
    DelegationGrants {
        connect,
        read,
        propose,
        auto_execute,
        approve_all,
        vault_passphrase,
    }
}

/// toml 오류 문구는 여러 줄(스팬 표시)이라 한 줄로 접는다 (`sessions_meta::flatten` 과 같다).
fn flatten(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_doc(content: &str) -> Result<DocumentMut, String> {
    content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "delegation.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "delegation.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })
}

/// `[[target]]` 배열을 꺼낸다. 없으면 `Ok(None)`, **배열 오브 테이블이 아니면** 오류다
/// (`target = [{…}]` 같은 인라인 표기는 읽기는 되지만 이 쓰기 경로가 다루지 않는다 —
/// 조용히 다른 모양으로 갈아 끼우느니 손으로 고치라고 말한다).
fn targets_of(doc: &DocumentMut) -> Result<Option<&ArrayOfTables>, String> {
    match doc.get("target") {
        None => Ok(None),
        Some(Item::ArrayOfTables(arr)) => Ok(Some(arr)),
        Some(_) => Err(tr!(
            ko: "delegation.toml 의 target 이 [[target]] 블록 배열이 아닙니다 — 파일을 직접 고쳐 주세요",
            en: "target in delegation.toml is not an array of [[target]] blocks — please fix the file by hand"
        )),
    }
}

/// 별칭으로 블록 번호를 찾는다 — 읽기와 같은 **대소문자 무시** 규칙 ([`Delegation::target`]).
fn index_of(arr: &ArrayOfTables, alias: &str) -> Option<usize> {
    arr.iter().position(|t| {
        t.get("alias")
            .and_then(Item::as_str)
            .is_some_and(|a| a.eq_ignore_ascii_case(alias))
    })
}

/// 장식의 앞부분(그 항목 **위에 적힌 줄들**) 원문. 없거나 못 읽으면 빈 글자.
fn prefix_text(d: &Decor) -> String {
    d.prefix()
        .and_then(|p| p.as_str())
        .unwrap_or("")
        .to_string()
}

/// 값 하나를 갈아 끼운다 — 이미 있던 줄은 **장식(정렬 공백·줄 끝 주석)을 물려받아** 값만 바뀐다
/// (`sessions_meta::put` 과 같은 규칙. 이쪽은 지우는 경우가 없어 `Option` 을 받지 않는다).
fn put(table: &mut Table, key: &str, new: Value) {
    match table.get_mut(key).and_then(Item::as_value_mut) {
        Some(old) => {
            let mut new = new;
            *new.decor_mut() = old.decor().clone();
            *old = new;
        }
        None => {
            table.insert(key, Item::Value(new));
        }
    }
}

/// 블록들을 지우되 **그 위에 적힌 주석을 잃지 않는다** — 지운 블록의 앞 장식에 `#` 이 있으면
/// 다음에 살아남는 블록 앞으로 옮긴다. 옮길 곳이 없으면 그 글자를 돌려준다(호출부가 문서
/// 끝에 붙인다).
///
/// TOML 에는 떠 있는 주석이 없다 — 주석은 언제나 **바로 뒤 항목의 앞 장식**이다. 그래서
/// 첫 `[[target]]` 을 지우면 그 위의 파일 머리글이 함께 사라진다 (`sessions_meta` 가
/// `has_leading_comment` 로 "헤더를 남긴다" 로 푼 것과 같은 문제인데, 배열 오브 테이블은
/// 빈 블록을 남길 수 없어 **옮기기**로 푼다).
fn remove_indices(arr: &mut ArrayOfTables, doomed: &[usize]) -> String {
    // 1) 옮길 계획 — 원래 번호 기준으로 먼저 다 세운다(지우면서 세면 번호가 밀린다).
    let mut carry = String::new();
    let mut moved: Vec<(usize, String)> = Vec::new();
    for i in 0..arr.len() {
        let prefix = arr
            .get(i)
            .map(|t| prefix_text(t.decor()))
            .unwrap_or_default();
        if doomed.contains(&i) {
            if prefix.contains('#') {
                carry.push_str(&prefix);
            }
        } else if !carry.is_empty() {
            moved.push((i, format!("{carry}{prefix}")));
            carry.clear();
        }
    }
    // 2) 살아남는 블록에 옮긴 주석을 얹고, 3) 뒤에서부터 지운다(앞 번호가 밀리지 않게).
    for (i, prefix) in moved {
        if let Some(t) = arr.get_mut(i) {
            t.decor_mut().set_prefix(prefix);
        }
    }
    for i in doomed.iter().rev() {
        arr.remove(*i);
    }
    carry
}

/// 구조된 주석을 문서 끝에 붙인다 (살아남는 블록이 없어 옮길 곳이 없었던 경우).
fn with_rescued(rendered: String, carry: &str) -> String {
    if carry.is_empty() {
        rendered
    } else {
        format!("{rendered}{carry}")
    }
}

/// 별칭들의 `[[target]]` 블록을 통째로 걷어낸 **문서 전체**와 지운 개수 — **순수 함수**.
///
/// 보장: 남는 블록·주석·키 순서는 한 글자도 바뀌지 않는다. 걸리는 별칭이 없으면 입력을
/// 그대로 돌려준다(조용한 no-op). 비교는 읽기와 같은 **대소문자 무시**다.
pub(crate) fn remove_aliases_in_doc(
    content: &str,
    aliases: &[String],
) -> Result<(String, usize), String> {
    let wanted: Vec<String> = aliases
        .iter()
        .map(|a| a.trim().to_lowercase())
        .filter(|a| !a.is_empty())
        .collect();
    if wanted.is_empty() {
        return Ok((content.to_string(), 0));
    }

    let mut doc = parse_doc(content)?;
    // 모양 검사는 먼저 — 없으면 지울 것도 없다.
    if targets_of(&doc)?.is_none() {
        return Ok((content.to_string(), 0));
    }

    let carry;
    let removed;
    {
        let arr = doc
            .get_mut("target")
            .and_then(Item::as_array_of_tables_mut)
            .expect("targets_of 가 방금 배열 오브 테이블임을 확인했다");
        let doomed: Vec<usize> = arr
            .iter()
            .enumerate()
            .filter(|(_, t)| {
                t.get("alias")
                    .and_then(Item::as_str)
                    .is_some_and(|a| wanted.iter().any(|w| w == &a.trim().to_lowercase()))
            })
            .map(|(i, _)| i)
            .collect();
        removed = doomed.len();
        if removed == 0 {
            return Ok((content.to_string(), 0));
        }
        carry = remove_indices(arr, &doomed);
    }

    // 블록이 하나도 남지 않으면 키까지 걷어낸다 (빈 배열은 아무것도 그리지 않지만,
    // 다시 읽었을 때 "target 은 있는데 비었다" 라는 중간 상태를 남기지 않는다).
    let empty = targets_of(&doc)?.is_some_and(ArrayOfTables::is_empty);
    if empty {
        doc.remove("target");
    }

    Ok((
        match_line_endings(content, with_rescued(doc.to_string(), &carry)),
        removed,
    ))
}

/// 블록 하나의 `alias` **값만** 바꾼 문서 전체와 "바꿨는가" — **순수 함수**.
///
/// 신원 스냅샷은 손대지 않는다: 별칭이 바뀐 것이지 **서버가 바뀐 것이 아니다**
/// (`~/.ssh/config` 의 이름 변경은 같은 `HostName`/`User`/`Port` 를 그대로 옮긴다).
/// 대상이 없으면 조용한 no-op(`false`)이다 — 위임하지 않은 호스트의 이름을 바꾼 흔한 경우다.
pub(crate) fn rename_alias_in_doc(
    content: &str,
    from: &str,
    to: &str,
) -> Result<(String, bool), String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err(tr!(ko: "별칭이 비어 있습니다", en: "The alias is empty"));
    }
    // 글자가 똑같을 때만 no-op 이다 — 대소문자만 바꾸는 것도 이름 변경이다.
    if from == to {
        return Ok((content.to_string(), false));
    }

    let mut doc = parse_doc(content)?;
    let Some(index) = targets_of(&doc)?.and_then(|arr| index_of(arr, from)) else {
        return Ok((content.to_string(), false));
    };
    doc.get_mut("target")
        .and_then(Item::as_array_of_tables_mut)
        .and_then(|arr| arr.get_mut(index))
        .map(|t| put(t, "alias", Value::from(to)))
        .expect("방금 찾은 블록이 있어야 한다");

    Ok((match_line_endings(content, doc.to_string()), true))
}

/// 별칭 하나의 위임을 **적거나 지운다** — **순수 함수**(신원 스냅샷은 밖에서 계산해 넣는다).
///
/// - 권한이 하나도 없으면 [`remove_aliases_in_doc`] 로 넘긴다 — **죽은 블록을 남기지 않는다**
///   (`connect=false read=false …` 만 적힌 줄은 파일을 읽는 사람에게 "위임이 있다" 로 보인다).
/// - 있던 블록은 **아는 키만** 갈아 끼운다 — `client` 를 포함해 우리가 모르는 키는 그대로다.
/// - 새 블록은 `client` 를 적지 않는다 (= `"any"` · [`default_client`]).
/// - 권한 다섯은 `false` 도 **적는다**: 읽는 사람이 "적히지 않은 것" 과 "꺼 둔 것" 을 파일에서
///   구분할 필요는 없지만, 다섯이 나란히 보여야 무엇을 위임했는지가 한눈에 읽힌다.
pub(crate) fn upsert_target_in_doc(
    content: &str,
    alias: &str,
    snapshot: &IdentitySnapshot,
    grants: &DelegationGrants,
) -> Result<String, String> {
    let alias = alias.trim();
    if alias.is_empty() {
        return Err(tr!(ko: "별칭이 비어 있습니다", en: "The alias is empty"));
    }
    let grants = &normalize_grants(grants);

    if !grants.any() {
        return Ok(remove_aliases_in_doc(content, &[alias.to_string()])?.0);
    }

    let mut doc = parse_doc(content)?;
    let existing = targets_of(&doc)?.and_then(|arr| index_of(arr, alias));

    let arr = doc
        .entry("target")
        .or_insert_with(|| Item::ArrayOfTables(ArrayOfTables::new()))
        .as_array_of_tables_mut()
        .ok_or_else(|| {
            tr!(
                ko: "delegation.toml 의 target 이 [[target]] 블록 배열이 아닙니다 — 파일을 직접 고쳐 주세요",
                en: "target in delegation.toml is not an array of [[target]] blocks — please fix the file by hand"
            )
        })?;

    match existing {
        Some(i) => {
            let table = arr.get_mut(i).expect("방금 찾은 블록이 있어야 한다");
            // `alias` 는 건드리지 않는다 — 사용자가 적은 표기(대소문자)가 그대로 남는다.
            write_target(table, None, snapshot, grants);
        }
        None => {
            let mut table = Table::new();
            write_target(&mut table, Some(alias), snapshot, grants);
            arr.push(table);
        }
    }

    Ok(match_line_endings(content, doc.to_string()))
}

/// 블록 한 장의 우리 키들. `alias` 는 **새로 만들 때만** 적는다(순서를 잡으려고 맨 앞).
fn write_target(
    table: &mut Table,
    alias: Option<&str>,
    snapshot: &IdentitySnapshot,
    grants: &DelegationGrants,
) {
    if let Some(a) = alias {
        put(table, "alias", Value::from(a));
    }
    put(table, "expect_user", Value::from(snapshot.user.as_str()));
    put(table, "expect_host", Value::from(snapshot.host.as_str()));
    put(table, "expect_port", Value::from(i64::from(snapshot.port)));
    put(table, "connect", Value::from(grants.connect));
    put(table, "read", Value::from(grants.read));
    put(table, "propose", Value::from(grants.propose));
    put(table, "auto_execute", Value::from(grants.auto_execute));
    // 2026-10-23 에 늘어난 칸 — 켤 때나 이미 적혀 있을 때만 적는다(모두 승인을 준 적 없는 블록은 한 글자도 바뀌지 않게).
    if grants.approve_all || table.contains_key("approve_all") {
        put(table, "approve_all", Value::from(grants.approve_all));
    }
    // 2026-09-22 에 늘어난 칸이라 **맨 뒤에 붙는다** — 이미 있던 블록의 키 순서를 흔들지
    // 않는 것이 이 쓰기 경로의 약속이다(`put` 은 없던 키를 표 끝에 넣는다).
    put(
        table,
        "vault_passphrase",
        Value::from(grants.vault_passphrase),
    );
}

// ---------------------------------------------------------------------------
// 파일 입출력 + 신원 스냅샷
// ---------------------------------------------------------------------------

fn path_or_err() -> Result<PathBuf, String> {
    delegation_path().ok_or_else(
        || tr!(ko: "홈 디렉터리를 찾을 수 없습니다", en: "Could not find the home folder"),
    )
}

/// 파일을 읽는다 — **없으면 빈 글자**(오류가 아니다. 위임이 하나도 없는 상태다).
fn read_or_empty(path: &Path) -> Result<(String, bool), String> {
    match std::fs::read_to_string(path) {
        Ok(c) => Ok((c, true)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((String::new(), false)),
        Err(e) => Err(
            tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
        ),
    }
}

/// 바뀐 것이 없으면 파일에 손도 대지 않는다 (`sessions_meta` 와 같은 규칙 — mtime 이 흔들리면
/// 파일을 지켜보는 도구가 헛돈다). 없던 파일은 **적을 것이 있을 때만** 머리글과 함께 만든다.
fn write_if_changed(path: &Path, before: &str, existed: bool, after: String) -> Result<(), String> {
    if existed {
        if after == before {
            return Ok(());
        }
        return crate::fs_atomic::replace_through_link(path, after.as_bytes())
            .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()));
    }
    if after.trim().is_empty() {
        return Ok(()); // 지울 것뿐이었다 — 빈 파일을 만들지 않는다
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            tr!(ko: "{parent} 디렉터리를 만들지 못했습니다: {e}", en: "Could not create the folder {parent}: {e}", parent = parent.display())
        })?;
    }
    crate::fs_atomic::replace_through_link(path, format!("{NEW_FILE_HEADER}{after}").as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

/// [`crate::ssh::SshOpenError`] 에서 **사람이 읽는 문구**만 꺼낸다.
///
/// [`crate::ssh::resolve_params`] 가 낼 수 있는 것은 `Other` 하나뿐이지만(사용자 이름을 알 수
/// 없음 · 경유 해석 실패), 계약이 늘어도 조용히 빈 글자가 되지 않게 전부 받는다.
fn open_error_text(e: crate::ssh::SshOpenError) -> String {
    use crate::ssh::SshOpenError as E;
    match e {
        E::PasswordRequired { message, .. }
        | E::Auth { message, .. }
        | E::Other { message, .. } => message,
        E::HostKeyUnknown { .. } | E::HostKeyChanged { .. } | E::PassphraseRequired { .. } => {
            tr!(ko: "이 별칭의 접속 정보를 해석할 수 없습니다", en: "Could not resolve the connection settings for this alias")
        }
    }
}

/// 별칭이 **지금** 가리키는 서버를 `~/.ssh/config` 에서 편다 — 위임을 적는 순간의 스냅샷.
///
/// 이 계산이 **Rust 안에 있어야 하는 이유**: 나중에 이 값을 검사하는 것도 Rust 이고
/// ([`Delegation::identity_matches`]), 두 계산이 한 함수([`crate::ssh::resolve_params`])를 지나야
/// "적어 둔 것과 검사하는 것" 이 어긋나지 않는다. 프런트가 계산해 보내면 그 순간부터 신원
/// 그물이 **사용자 입력**이 된다. `USERNAME` 폴백까지 [`crate::headless::connect_delegated`] 과 같은 길이다.
fn identity_snapshot(alias: &str) -> Result<IdentitySnapshot, String> {
    let config = crate::ssh_config::load_default()?;
    if !config
        .hosts
        .iter()
        .any(|h| h.name.eq_ignore_ascii_case(alias))
    {
        return Err(tr!(
            ko: "'{alias}' 은(는) ~/.ssh/config 에 없는 별칭입니다 — 위임할 대상을 찾을 수 없습니다",
            en: "'{alias}' is not an alias in ~/.ssh/config — there is nothing to delegate to"
        ));
    }
    let username = std::env::var("USERNAME").ok();
    let params = crate::ssh::resolve_params(alias, &config.hosts, username.as_deref())
        .map_err(open_error_text)?;
    Ok(IdentitySnapshot {
        user: params.user,
        host: params.host,
        port: params.port,
    })
}

/// 경로를 받는 저장 — **테스트 대상**은 위의 순수 함수들이고, 여기는 배선이다.
fn set_target_at(path: &Path, alias: &str, grants: &DelegationGrants) -> Result<(), String> {
    let grants = &normalize_grants(grants);
    let (before, existed) = read_or_empty(path)?;

    // 지우는 저장은 **config 를 보지 않는다** — 설정에서 이미 사라진 별칭(고아 위임)을
    // 화면에서 끄는 것이 이 길의 가장 중요한 쓰임이라, 여기서 "config 에 없다" 로 막으면
    // 고아를 지울 방법이 앱 안에 없어진다.
    let after = if grants.any() {
        upsert_target_in_doc(&before, alias, &identity_snapshot(alias)?, grants)?
    } else {
        remove_aliases_in_doc(&before, &[alias.to_string()])?.0
    };

    write_if_changed(path, &before, existed, after)
}

// ---------------------------------------------------------------------------
// 명령 — 전부 `async fn` (디스크를 만진다 · docs/conventions.md)
//
// **쓰기는 Tauri 명령에만 있다.** MCP 에는 대응하는 도구가 없고 앞으로도 두지 않는다 —
// 승인(`approve_operation`)과 같은 규칙이다: AI 가 자기 위임을 넓힐 표면을 만들지 않는다.
// ---------------------------------------------------------------------------

/// 위임이 바뀌었음을 모든 창에 알리는 앱 전역 이벤트(페이로드 없음 `()`) — 프런트는 이것을 듣고
/// [`delegation_list_targets`] 를 다시 읽는다(타일 머리줄 칩·호스트 폼·설정 › 보안이 같은 값을 본다).
pub const CHANGED_EVENT: &str = "delegation-changed";

/// 쓰기 명령이 **성공했을 때만** [`CHANGED_EVENT`] 를 낸다 — 실패는 아무것도 바뀌지 않았다.
/// 바뀐 것이 없는 성공(no-op)에도 내지만 해가 없다(다시 읽을 뿐이다).
fn announce_on_ok<T>(app: &tauri::AppHandle, out: Result<T, String>) -> Result<T, String> {
    if out.is_ok() {
        use tauri::Emitter;
        let _ = app.emit(CHANGED_EVENT, ());
    }
    out
}

/// 지금 위임된 대상 전부 — 호스트 폼의 프리필과 목록 표식·제거 확인 문구가 읽는다.
///
/// **오류가 없다**(`sessions_meta::get_host_meta` 와 같은 규칙): 파일이 없거나 깨졌으면
/// 위임이 없는 것이고, 그 사실로 화면을 세울 이유가 없다.
#[tauri::command]
pub async fn delegation_list_targets() -> Vec<DelegationTargetView> {
    tauri::async_runtime::spawn_blocking(|| {
        // 고아 판정은 `~/.ssh/config` 를 **한 번** 읽어 만든 색인 하나로 한다 — 세션 목록
        // (`enrich_sessions`)이 쓰는 바로 그 함수다(파서를 두 벌 두지 않는다).
        let known = crate::ssh_config::config_index();
        Delegation::load_default()
            .targets
            .into_iter()
            .map(|t| DelegationTargetView {
                // 설정을 못 읽었으면(`None`) 아무것도 고아가 아니다 — 모른다는 것이 답이다.
                alias_known: known
                    .as_ref()
                    .is_none_or(|i| i.contains_key(&t.alias.to_lowercase())),
                alias: t.alias,
                connect: t.connect,
                read: t.read,
                propose: t.propose,
                auto_execute: t.auto_execute,
                approve_all: t.approve_all,
                vault_passphrase: t.vault_passphrase,
                client: t.client,
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// 별칭 하나의 위임을 저장한다. 권한 다섯이 모두 꺼져 있으면 **블록을 지운다**.
///
/// 신원 스냅샷은 여기서 `~/.ssh/config` 로 계산한다([`identity_snapshot`]) — 프런트는 권한
/// 다섯만 보낸다.
#[tauri::command]
pub async fn delegation_set_target(
    app: tauri::AppHandle,
    alias: String,
    grants: DelegationGrants,
) -> Result<(), String> {
    let out = tauri::async_runtime::spawn_blocking(move || set_target_at(&path_or_err()?, &alias, &grants))
        .await
        .map_err(|e| tr!(ko: "위임을 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the delegation failed: {e}"))?;
    announce_on_ok(&app, out)
}

/// 호스트 이름 변경 팬아웃의 한 자리 — `alias` 한 칸만 옮긴다(스냅샷은 그대로: 같은 서버다).
/// 위임이 없던 호스트면 `false` (조용한 no-op).
#[tauri::command]
pub async fn delegation_rename_target(
    app: tauri::AppHandle,
    from: String,
    to: String,
) -> Result<bool, String> {
    let out = tauri::async_runtime::spawn_blocking(move || {
        let path = path_or_err()?;
        let (before, existed) = read_or_empty(&path)?;
        let (after, renamed) = rename_alias_in_doc(&before, &from, &to)?;
        write_if_changed(&path, &before, existed, after)?;
        Ok(renamed)
    })
    .await
    .map_err(|e| tr!(ko: "위임의 이름을 바꾸는 작업이 실패했습니다: {e}", en: "The task that renames the delegation failed: {e}"))?;
    announce_on_ok(&app, out)
}

/// 호스트 제거 팬아웃의 한 자리 — 별칭들의 블록을 걷어내고 **지운 개수**를 돌려준다.
#[tauri::command]
pub async fn delegation_remove_targets(
    app: tauri::AppHandle,
    aliases: Vec<String>,
) -> Result<usize, String> {
    let out = tauri::async_runtime::spawn_blocking(move || {
        let path = path_or_err()?;
        let (before, existed) = read_or_empty(&path)?;
        let (after, removed) = remove_aliases_in_doc(&before, &aliases)?;
        write_if_changed(&path, &before, existed, after)?;
        Ok(removed)
    })
    .await
    .map_err(|e| tr!(ko: "위임을 지우는 작업이 실패했습니다: {e}", en: "The task that removes the delegation failed: {e}"))?;
    announce_on_ok(&app, out)
}

pub(crate) mod database;

#[cfg(test)]
mod tests;
