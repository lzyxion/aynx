//! `~/.ssh/sessions.toml` — 세션 메타데이터(색·그룹·태그) **읽기 전용** 로더.
//!
//! `~/.ssh/config` 를 대체하지 않고 **보강만** 한다. 접속에 필요한 값(HostName/User/Port…)은
//! 여전히 ssh config 가 원본이고, 이 파일은 "이 호스트를 화면에서 어떻게 보여줄지"만 담는다.
//! 그래서 파일이 없거나 깨져도 **오류가 아니라 경고**로 다루고 메타데이터만 비운다.
//!
//! 희소 오버라이드 모델 — 기본값은 `[defaults]` 한 벌, 여러 세션이 공유하는 값은
//! `[presets.<이름>]`, 호스트별로 **다른 것만** `[hosts.<별칭>]` 에 적는다.
//!
//! ```toml
//! [defaults]
//! color = "#8a8a8a"
//! scrollback = 5000
//!
//! [presets.prod]
//! identity = "~/.ssh/id_prod"
//! on_connect = "cd /srv/app"
//!
//! [hosts.web-01]
//! group = "prod/web"     # 중첩 테이블이 아니라 경로 문자열
//! preset = "prod"
//! tags = ["web"]
//! color = "#c25b4a"
//! icon = "🐧"
//! forwards = [{ local_port = 15432, remote_host = "localhost", remote_port = 5432 }]
//! ```
//!
//! 병합 우선순위: `hosts.<별칭>` > `presets.<preset>` > `[defaults]`.
//! **예외는 `forwards` 하나** — 상속하면 곧 포트 충돌이라 호스트 블록에서만 읽는다
//! ([`HostMeta::forwards`] · docs/log/2026-09-17-forward-presets.md).
//! 호스트는 **구체 이름으로만** 참조한다(글롭 없음). ssh config 의 구체 별칭과
//! 대소문자를 무시하고 맞춘다.
//!
//! 소비는 바깥에서 한다 — `on_connect` 은 [`crate::ssh`] 가 셸 확립 직후 첫 입력으로 보내고,
//! `scrollback` 은 `list_hosts` 의 `meta` 를 타고 프런트의 xterm 생성 옵션으로 간다
//! (docs/log/2026-09-01-on-connect.md). `identity` 는 아직 파싱·병합까지만 한다.
//!
//! ## 쓰기 (2026-09-01)
//!
//! `~/.ssh/config` 와 달리 **이 파일은 앱 소유**라 GUI 로 고쳐도 된다 (ssh·VS Code 는 이 파일을
//! 모른다). 그래도 **사용자가 손으로 적은 주석·키 순서·들여쓰기는 보존한다** — 그래서
//! `toml` 로 역직렬화 후 재직렬화하지 않고 [`toml_edit`] (cargo 가 `Cargo.toml` 을 고칠 때 쓰는
//! 포맷 보존 편집기) 로 **해당 키만** 갈아 끼운다. 쓰기 범위는 `[hosts."<별칭>"]` 하나뿐이고
//! `[defaults]`·`[presets.*]` 편집은 아직 GUI 로 만들지 않았다.
//!
//! 읽기는 [`get_host_meta`], 쓰기는 [`set_host_meta`] 두 명령이다. **읽기 쪽은 병합하지 않고
//! 호스트 자기 테이블의 원본 값만** 준다 — 폼에 병합값을 채우면 `[defaults]`·`preset` 에서
//! 상속받던 값이 저장 순간 호스트 블록에 굳어 버린다 (ssh config 수정 모달과 같은 함정).
//!
//! 맡지 않는 것: 접속 값(HostName·User·Port…)은 `crate::ssh_config`, `~/.ssh/config` 쓰기는 `crate::config_edit`.
//! 현재 위층을 부름: 포워드 프리셋 검증에 `port_forward::validate`·`ForwardKind` 를 쓴다(저장과 실행이 같은 규칙).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use toml_edit::{Array, DocumentMut, Item, Table, TableLike, Value};

use crate::i18n::tr;

/// **호스트별 포트 포워딩 프리셋 한 줄** — 접속하면 자동으로 여는 `ssh -L` 하나.
///
/// ```toml
/// [hosts.web-01]
/// forwards = [{ local_port = 15432, remote_host = "localhost", remote_port = 5432 }]
/// ```
///
/// 인라인 테이블의 배열로 쓴다 (`[[hosts.web-01.forwards]]` 로 손으로 적은 것도 그대로
/// 읽힌다 — serde 는 두 표기를 구분하지 않는다). 쓰기를 인라인으로 고른 이유는
/// [`patch_document`] 의 `put` 한 함수가 **값**(`toml_edit::Value`)만 다루기 때문이다:
/// 배열 오브 테이블은 `Item::ArrayOfTables` 라 그 통로를 탈 수 없고, 그러려면 키 하나를
/// 위해 두 번째 쓰기 경로가 생긴다.
///
/// 검증은 [`crate::port_forward::validate`] 를 그대로 쓴다 — 저장과 실행이 같은 규칙이어야
/// "적혔는데 안 열리는 줄" 이 생기지 않는다.
///
/// **종류(`kind`)** 는 2026-09-23 에 붙었다 (docs/log/2026-09-23-remote-dynamic-forwarding.md).
/// 없으면 로컬이다 — 그 전에 적힌 줄은 전부 로컬이었다. 파일에도 **로컬이면 적지 않는다**
/// ([`forward_value`]): 예전 앱이 같은 파일을 읽어도 그 줄은 그대로 뜻이 통한다. 원격·동적은
/// 쓰지 않는 칸을 파일에서 뺀다(원격: `remote_host` · 동적: `remote_host`·`remote_port`) —
/// 그래서 두 칸이 `#[serde(default)]` 다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ForwardPreset {
    /// 로컬(-L) · 원격(-R) · 동적(-D). 없으면 로컬.
    #[serde(default)]
    pub kind: crate::port_forward::ForwardKind,
    /// 내 PC 의 `127.0.0.1:<이 포트>` (루프백 전용 — `port_forward` 모듈 문서 참고).
    /// 로컬·동적은 **듣는** 포트, 원격은 서버에서 온 연결을 **이어 줄** 포트다.
    pub local_port: u16,
    /// **원격 서버에서 본** 호스트 이름 (`localhost` 가 대부분이다). 로컬만 쓴다.
    #[serde(default)]
    pub remote_host: String,
    /// 로컬: 목적지 포트 · 원격: 서버가 `127.0.0.1` 에서 들을 포트 · 동적: 안 쓴다(0).
    #[serde(default)]
    pub remote_port: u16,
}

/// 호스트 하나에 대해 3계층을 병합한 **최종** 메타데이터. 프런트로 이 모양 그대로 나간다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct HostMeta {
    /// CSS 색 문자열 그대로 (`#c25b4a`, `tomato`, `rgb(…)` …). 앱은 해석하지 않는다.
    pub color: Option<String>,
    /// 사이드바에 띄울 짧은 이모지 문자열 (`🐧` 등). 앱은 해석하지 않는다.
    pub icon: Option<String>,
    /// `"prod/web"` 같은 경로 문자열. 중첩 구조가 아니라 문자열 하나다.
    pub group: Option<String>,
    /// 값이 없으면 **빈 배열** (프런트에서 null 체크가 필요 없게).
    pub tags: Vec<String>,
    /// 터미널 스크롤백 줄 수. 프런트가 xterm 생성 시 1회 적용하고 범위를 클램프한다.
    pub scrollback: Option<u32>,
    /// 셸이 선 직후 첫 입력으로 보낼 명령 (`crate::ssh::prepare_on_connect`).
    pub on_connect: Option<String>,
    /// 아직 파싱·병합만 하고 소비는 후속 작업 (에이전트 공개키 매칭).
    pub identity: Option<String>,
    /// **세션 로깅** — 이 호스트에 접속하면 원격이 보낸 **원시 바이트**를
    /// `<data_dir>/aynx/logs/` 아래 파일로 tee 한다 (`crate::session_log`).
    ///
    /// 기본은 꺼짐(`None` = 끔). 켜면 화면에 표시된 것이 그대로 파일에 남는다 —
    /// 비밀번호 프롬프트의 에코, `cat` 한 토큰, 환경 변수까지 전부다. 그래서 GUI 는
    /// 이 칸 옆에 경고 문구를 붙인다.
    pub log: Option<bool>,
    /// **셸 통합(OSC 133) 주입** — 이 호스트에 접속할 때 `~/.aynx/integration.sh` 를 심고
    /// `. ~/.aynx/integration.sh` 한 줄을 타이핑할 것인가 (`crate::shell_integration`).
    ///
    /// `None`(안 적음) 과 `Some(true)` 는 같다 = 주입한다. **`Some(false)` 만 옵트아웃**이고,
    /// 그때는 SFTP 업로드도 `source` 타이핑도 `~/.aynx` 생성도 전부 생략한다 —
    /// "이 서버엔 아무것도 심지 마라" 를 글자 그대로 지킨다 (`crate::ssh::open_ssh_session`).
    /// `[defaults]` 에 `shell_integration = false` 를 적으면 전체 기본을 끌 수도 있다.
    ///
    /// 끄더라도 **이미 심어진 파일을 앱이 지우지는 않는다** — 서버에서 `rm -rf ~/.aynx`.
    pub shell_integration: Option<bool>,
    /// **tmux 로 접속** — 이 호스트에 붙으면 셸 대신 tmux 세션에 붙는다(없으면 만든다).
    ///
    /// 기본은 꺼짐(`None` = 끔 · `log` 와 같은 규칙). 켜면 그 타일은 **"화면만 있는 세션"**
    /// (간이 모드)이 된다 — OSC 133 셸 통합을 **주입하지 않고**(마커가 tmux 격자를 넘지
    /// 못한다), 그래서 명령 이력·마지막 출력 복사·`#` 블록 검색·AI 의 명령 읽기가 전부
    /// 꺼진다. 활동 표시와 화면 검색은 그대로다.
    ///
    /// **켜면 이 호스트의 `on_connect` 은 실행되지 않는다**(v1) — 첫 입력 한 줄을 tmux
    /// 명령이 통째로 쓰기 때문이다. 조립·이름 규칙은 [`crate::ssh::tmux_attach_command`].
    pub tmux: Option<bool>,
    /// **포트 포워딩 프리셋** — 이 호스트에 붙으면 자동으로 여는 `ssh -L` 목록.
    /// 값이 없으면 **빈 배열** (`tags` 와 같은 규칙 — 프런트에서 null 체크가 필요 없게).
    ///
    /// **이 칸만 `[defaults]`·`presets.*` 에서 상속받지 않는다.** 다른 키는 "이 무리의
    /// 서버는 대개 이렇다" 를 적는 자리지만, 포워드는 **그 서버 한 대의 포트 짝**이다 —
    /// `[defaults]` 에 `15432 → localhost:5432` 를 적으면 DB 가 없는 웹 서버에 붙을 때마다
    /// 실패 토스트가 뜨고, 반대로 두 호스트에 같은 로컬 포트를 물리면 둘째가 "포트가 이미
    /// 사용 중" 으로 죽는다. 상속이 곧 충돌인 유일한 칸이라 [`apply`] 를 타지 않고
    /// [`SessionsMeta::resolve`] 가 **호스트 자기 블록에서만** 읽는다
    /// (docs/log/2026-09-17-forward-presets.md).
    pub forwards: Vec<ForwardPreset>,
    /// **에이전트 포워딩** (`ssh -A`) — `~/.ssh/config` 의 `ForwardAgent` 를 이 호스트에서
    /// **덮어쓴다**. `None` = 덮어쓰지 않음(config 의 줄을 따른다) · `Some(true)` 켬 ·
    /// `Some(false)` 끔 (config 에 `yes` 가 적혀 있어도).
    ///
    /// `forwards` 처럼 **상속하지 않는다** — `[defaults]`·`presets.*` 에 적으면 무시하고 경고한다.
    /// 켜는 순간 그 서버의 관리자가 내 에이전트로 서명할 수 있게 되므로, "이 무리의 서버는
    /// 대개 이렇다" 로 한꺼번에 켜는 자리를 앱 파일에 두지 않는다 (config 의 `Host *` 는
    /// 사람이 OpenSSH 에 적은 것이라 그대로 존중한다). docs/log/2026-09-23-agent-forwarding.md
    pub forward_agent: Option<bool>,
    /// **에이전트 활성화** (2026-10-26 — 옛 `remote_hooks` 를 넓혔다) — 이 호스트에 접속할 때(사람 타일 · 빠른 접속
    /// 제외) 서버에 에이전트용 파일을 심는가: 상태 신호 훅(`~/.claude/settings.json` · `~/.codex/hooks.json` —
    /// `crate::agent_hooks::remote_auto_install`) · PATH 심(`~/.config/aynx/bin/{claude,codex}` — `crate::agent_shim`) ·
    /// 타일 파일의 추가 인자 키(`crate::remote_signal_file`). 그래서 손으로 친 `claude` · `codex` 도 앱이 띄운 것과 같다.
    ///
    /// **기본 끔**(2026-10-26 사용자 결정 — 켜면 평범한 타일에도 첫 입력 export 가 쳐진다): `None`(안 적음)과 `Some(false)` 는
    /// 같다 = 심지 않는다. **`Some(true)` 만 켬**이다. `[defaults]`·preset 에서 상속한다. 셸 통합과는 독립이다 — 이 스위치 자체가 "에이전트용 파일을 심어도
    /// 된다" 는 동의다. 옛 키 `remote_hooks` 도 같은 뜻으로 읽는다(저장은 새 키 `agent`).
    pub agent: Option<bool>,
    /// **원격 에이전트 추가 인자** — 에이전트 id(`crate::agent_args::TARGETS`) → 사람이 적은 한 줄. **키별로 상속**한다
    /// (`[defaults.agent_args]` → `[presets.<p>.agent_args]` → `[hosts.<h>.agent_args]`) — **빈 문자열 = 붙이지 않음**으로
    /// 위 계층을 덮는다. 로컬 전역 `[ai.args]` 는 원격에 번지지 않는다. 값이 없으면 빈 맵.
    pub agent_args: BTreeMap<String, String>,
    /// `agent_args` 의 키별 출처 — `color_from` 과 같은 규칙(호스트 자기 값이면 그 키가 없다 · `resolve` 만 채운다).
    pub agent_args_from: BTreeMap<String, MetaLayer>,
    /// `color` 가 **어느 위 계층에서 왔는가** — 호스트 자기 블록 값이거나 값이 없으면 `None`.
    /// [`SessionsMeta::resolve`] 만 채운다(`raw_host` 는 늘 `None`). 호스트 폼이 빈 칸의 곁말로
    /// "프리셋 prod 의 색 · #4a90d9" 를 말하는 데 쓴다 (docs/log/2026-09-29-hostform-display-tidy.md).
    pub color_from: Option<MetaLayer>,
    /// `icon` 의 출처 — `color_from` 과 같은 규칙.
    pub icon_from: Option<MetaLayer>,
}

/// 상속값의 **출처 계층** — `[defaults]` 또는 `[presets.<이름>]`.
/// 프런트로는 `{"kind":"defaults"}` / `{"kind":"preset","name":"prod"}` 로 나간다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", content = "name", rename_all = "lowercase")]
pub enum MetaLayer {
    Defaults,
    Preset(String),
}

/// 그룹 하나(`[groups."prod/web"]`)의 메타데이터. 호스트가 아니라 **그룹 경로 자체**에
/// 붙는 값이라, 그 경로 아래 호스트들을 사이드바에서 어떻게 묶어 보여줄지에만 쓴다.
///
/// 아이콘과 색 두 칸이다(색은 2026-09-29 — docs/log/2026-09-29-folder-project-icons.md). [`HostMeta`]
/// 처럼 필드마다 `Option` 이다("적지 않음"과 빈 값을 구분). 프런트로 이 모양 그대로 나간다(없으면 `null`).
///
/// **그룹의 값은 호스트에 내려가지 않는다** — 폴더 자신의 얼굴(독 폴더 줄 · 팔레트 그룹 줄)에만 쓴다.
/// 호스트 상속은 여전히 `[presets]` · `[defaults]` 두 계층뿐이다([`SessionsMeta::resolve`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GroupMeta {
    /// 그룹 머리에 띄울 아이콘 — 이모지 또는 `svg:…` 문자열 (`🌐` 등). 앱은 해석하지 않는다.
    pub icon: Option<String>,
    /// 폴더 아이콘의 색 — CSS 색 문자열(`#4a90d9`). 단색(선) 아이콘과 기본 폴더에만 입는다.
    #[serde(default)]
    pub color: Option<String>,
}

/// TOML 테이블 하나(`[defaults]` / `[presets.x]` / `[hosts.x]`)를 그대로 담는 원본 블록.
///
/// 모든 필드가 `Option` 인 것이 핵심이다 — "적지 않음"과 "빈 값으로 덮어씀"을 구분해야
/// 희소 오버라이드가 성립한다. 모르는 키는 serde 기본 동작대로 조용히 버린다.
#[derive(Debug, Clone, Default, serde::Deserialize)]
struct MetaBlock {
    color: Option<String>,
    icon: Option<String>,
    group: Option<String>,
    tags: Option<Vec<String>>,
    scrollback: Option<u32>,
    on_connect: Option<String>,
    identity: Option<String>,
    log: Option<bool>,
    shell_integration: Option<bool>,
    tmux: Option<bool>,
    agent: Option<bool>,
    /// 옛 이름 — `agent` 가 없을 때만 같은 뜻으로 읽는다([`HostMeta::agent`]).
    remote_hooks: Option<bool>,
    agent_args: Option<BTreeMap<String, String>>,
    /// `[hosts.*]` 에서만 읽는다 — 상속하지 않는 유일한 칸이다 ([`HostMeta::forwards`]).
    /// 다른 테이블에 적혀 있으면 [`SessionsMeta::parse`] 가 경고 한 줄을 낸다.
    forwards: Option<Vec<ForwardPreset>>,
    /// `[hosts.*]` 에서만 읽는다 — `forwards` 와 같은 규칙 ([`HostMeta::forward_agent`]).
    forward_agent: Option<bool>,
    /// `[hosts.*]` 에서만 의미가 있다 — 다른 테이블에 있으면 무시하고 경고한다.
    preset: Option<String>,
}

/// 파일 최상위 구조. 세 섹션 모두 없어도 된다.
#[derive(Debug, Clone, Default, serde::Deserialize)]
struct RawFile {
    #[serde(default)]
    defaults: MetaBlock,
    #[serde(default)]
    presets: BTreeMap<String, MetaBlock>,
    #[serde(default)]
    hosts: BTreeMap<String, MetaBlock>,
}

/// 병합 전 원본을 그대로 들고 있다가 `resolve` 로 호스트별 결과를 만든다.
#[derive(Debug, Clone, Default)]
pub struct SessionsMeta {
    defaults: MetaBlock,
    presets: BTreeMap<String, MetaBlock>,
    /// 키는 **소문자로 정규화한** 별칭 (ssh config 의 구체 별칭과 대소문자 무시 매칭).
    hosts: BTreeMap<String, MetaBlock>,
}

impl SessionsMeta {
    /// `~/.ssh/sessions.toml` 을 읽는다. 파일이 없으면 빈 메타데이터 + 경고 없음.
    /// 읽기·파싱 실패는 **앱을 죽이지 않고** 경고 문자열로만 알린다.
    pub fn load_default() -> (Self, Vec<String>) {
        let Ok(path) = sessions_path() else {
            return (
                Self::default(),
                vec![
                    tr!(ko: "홈 디렉터리를 찾을 수 없습니다 — sessions.toml 을 읽지 않았습니다", en: "Could not find the home folder — sessions.toml was not read"),
                ],
            );
        };

        match std::fs::read_to_string(&path) {
            Ok(content) => Self::parse(&content),
            // 없는 것이 정상이다 — 메타데이터 없이 동작한다.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Self::default(), Vec::new()),
            Err(e) => (
                Self::default(),
                vec![
                    tr!(ko: "{path} 읽기 실패 — 메타데이터 없이 진행합니다: {e}", en: "Could not read {path} — going on without metadata: {e}", path = path.display()),
                ],
            ),
        }
    }

    /// TOML 문자열을 해석한다. 반환은 `(메타데이터, 경고들)`.
    /// TOML 자체가 깨졌으면 **빈 메타데이터 + 경고 한 줄** (부분 복구는 하지 않는다).
    pub fn parse(content: &str) -> (Self, Vec<String>) {
        let raw: RawFile = match toml::from_str(content) {
            Ok(raw) => raw,
            Err(e) => {
                return (
                    Self::default(),
                    vec![tr!(
                        ko: "sessions.toml 을 해석할 수 없습니다 — 메타데이터를 무시합니다: {why}",
                        en: "Could not parse sessions.toml — ignoring the metadata: {why}",
                        why = flatten(&e.to_string()),
                    )],
                );
            }
        };

        let mut warnings = Vec::new();

        // `preset` 은 [hosts.*] 전용이다. 다른 곳에 있으면 조용히 무시하지 말고 알린다.
        if raw.defaults.preset.is_some() {
            warnings.push(tr!(ko: "sessions.toml: [defaults] 의 preset 키는 무시됩니다", en: "sessions.toml: the preset key under [defaults] is ignored"));
        }
        for name in raw
            .presets
            .iter()
            .filter(|(_, b)| b.preset.is_some())
            .map(|(n, _)| n)
        {
            warnings.push(tr!(
                ko: "sessions.toml: [presets.{name}] 의 preset 키는 무시됩니다 — 프리셋은 중첩되지 않습니다",
                en: "sessions.toml: the preset key under [presets.{name}] is ignored — presets do not nest"
            ));
        }

        // `forwards` 도 [hosts.*] 전용이다 — 상속하지 않는 유일한 칸이라, 위 계층에 적어
        // 둔 사람은 "왜 안 열리지" 를 알 방법이 없다 (키 이름에는 그 규칙이 안 적혀 있다).
        if raw.defaults.forwards.is_some() {
            warnings.push(tr!(
                ko: "sessions.toml: [defaults] 의 forwards 키는 무시됩니다 — 포워딩은 호스트마다 적습니다",
                en: "sessions.toml: the forwards key under [defaults] is ignored — forwards are written per host"
            ));
        }
        for name in raw
            .presets
            .iter()
            .filter(|(_, b)| b.forwards.is_some())
            .map(|(n, _)| n)
        {
            warnings.push(tr!(
                ko: "sessions.toml: [presets.{name}] 의 forwards 키는 무시됩니다 — 포워딩은 호스트마다 적습니다",
                en: "sessions.toml: the forwards key under [presets.{name}] is ignored — forwards are written per host"
            ));
        }

        // `forward_agent` 도 [hosts.*] 전용이다 — 켜는 순간 그 서버가 내 에이전트로 서명할 수
        // 있게 되므로 무리 전체에 한꺼번에 켜는 자리를 두지 않는다 ([`HostMeta::forward_agent`]).
        if raw.defaults.forward_agent.is_some() {
            warnings.push(tr!(
                ko: "sessions.toml: [defaults] 의 forward_agent 키는 무시됩니다 — 에이전트 포워딩은 호스트마다 켭니다",
                en: "sessions.toml: the forward_agent key under [defaults] is ignored — agent forwarding is enabled per host"
            ));
        }
        for name in raw
            .presets
            .iter()
            .filter(|(_, b)| b.forward_agent.is_some())
            .map(|(n, _)| n)
        {
            warnings.push(tr!(
                ko: "sessions.toml: [presets.{name}] 의 forward_agent 키는 무시됩니다 — 에이전트 포워딩은 호스트마다 켭니다",
                en: "sessions.toml: the forward_agent key under [presets.{name}] is ignored — agent forwarding is enabled per host"
            ));
        }

        // 호스트 키는 소문자로 접어 둔다. 접었을 때 겹치는 테이블이 있으면 먼저 온 쪽만 쓴다.
        let mut hosts: BTreeMap<String, MetaBlock> = BTreeMap::new();
        for (name, block) in raw.hosts {
            if let Some(preset) = &block.preset {
                if !raw.presets.contains_key(preset) {
                    warnings.push(tr!(
                        ko: "sessions.toml: [hosts.{name}] 이 없는 preset '{preset}' 을 참조합니다 — 무시합니다",
                        en: "sessions.toml: [hosts.{name}] refers to a preset '{preset}' that does not exist — ignoring it"
                    ));
                }
            }
            let key = name.to_lowercase();
            if hosts.contains_key(&key) {
                warnings.push(tr!(
                    ko: "sessions.toml: [hosts.{name}] 은 대소문자만 다른 항목과 겹칩니다 — 먼저 나온 쪽을 씁니다",
                    en: "sessions.toml: [hosts.{name}] collides with an entry that differs only in case — the first one wins"
                ));
                continue;
            }
            hosts.insert(key, block);
        }

        (
            Self {
                defaults: raw.defaults,
                presets: raw.presets,
                hosts,
            },
            warnings,
        )
    }

    /// 호스트 하나의 병합 결과. `hosts.<별칭>` > `presets.<preset>` > `[defaults]`.
    /// 아무 항목도 없으면 `[defaults]` 만 반영된 결과가 나온다(그것도 없으면 전부 비어 있다).
    pub fn resolve(&self, host_name: &str) -> HostMeta {
        let mut meta = HostMeta::default();
        apply(&mut meta, &self.defaults);
        note_layer(&mut meta, &self.defaults, Some(MetaLayer::Defaults));

        let Some(block) = self.hosts.get(&host_name.to_lowercase()) else {
            return meta;
        };
        // 없는 preset 참조는 load 단계에서 이미 경고했다 — 여기서는 조용히 건너뛴다.
        if let Some((name, preset)) = block
            .preset
            .as_ref()
            .and_then(|n| self.presets.get(n).map(|p| (n, p)))
        {
            apply(&mut meta, preset);
            note_layer(&mut meta, preset, Some(MetaLayer::Preset(name.clone())));
        }
        apply(&mut meta, block);
        // 자기 블록에 적힌 값은 상속이 아니다 — 출처를 지운다.
        note_layer(&mut meta, block, None);
        // 상속하지 않는 유일한 칸 — 호스트 자기 블록에서만 온다 ([`HostMeta::forwards`]).
        meta.forwards = block.forwards.clone().unwrap_or_default();
        // 같은 이유로 상속하지 않는다 ([`HostMeta::forward_agent`]).
        meta.forward_agent = block.forward_agent;
        meta
    }
}

impl SessionsMeta {
    /// 호스트 **자기 테이블에 실제로 적힌 값만** 담은 결과 (병합하지 않는다).
    ///
    /// [`Self::resolve`] 와 짝이지만 쓰임이 정반대다 — `resolve` 는 "화면에 이렇게 보인다",
    /// 이쪽은 "파일에 이렇게 적혀 있다". 편집 폼은 반드시 이쪽으로 채워야 한다.
    /// `[defaults]` 나 preset 에서 온 값을 폼에 채우면 저장할 때 그 값이 호스트 테이블에
    /// 그대로 적혀 상속이 끊긴다 (상속값은 placeholder 로만 힌트를 준다).
    pub fn raw_host(&self, host_name: &str) -> HostMeta {
        let mut meta = HostMeta::default();
        if let Some(block) = self.hosts.get(&host_name.to_lowercase()) {
            apply(&mut meta, block);
            // `resolve` 와 같은 자리 — 상속이 없으므로 두 함수의 이 칸은 언제나 같은 값이다.
            meta.forwards = block.forwards.clone().unwrap_or_default();
            meta.forward_agent = block.forward_agent;
        }
        meta
    }
}

/// 한 계층을 덮어쓴다. **적힌 키만** 덮어쓰는 것이 희소 오버라이드의 전부다.
/// `tags` 는 합치지 않고 통째로 교체한다 (빈 배열을 적으면 위 계층의 태그를 지운다).
///
/// **`forwards` 는 여기 없다** — 상속하지 않는 유일한 칸이라 [`SessionsMeta::resolve`] 와
/// [`SessionsMeta::raw_host`] 가 호스트 블록에서 직접 읽는다 ([`HostMeta::forwards`] 의 이유).
fn apply(meta: &mut HostMeta, block: &MetaBlock) {
    if let Some(v) = &block.color {
        meta.color = Some(v.clone());
    }
    if let Some(v) = &block.icon {
        meta.icon = Some(v.clone());
    }
    if let Some(v) = &block.group {
        meta.group = Some(v.clone());
    }
    if let Some(v) = &block.tags {
        meta.tags = v.clone();
    }
    if let Some(v) = block.scrollback {
        meta.scrollback = Some(v);
    }
    if let Some(v) = &block.on_connect {
        meta.on_connect = Some(v.clone());
    }
    if let Some(v) = &block.identity {
        meta.identity = Some(v.clone());
    }
    if let Some(v) = block.log {
        meta.log = Some(v);
    }
    if let Some(v) = block.shell_integration {
        meta.shell_integration = Some(v);
    }
    if let Some(v) = block.tmux {
        meta.tmux = Some(v);
    }
    // 새 키가 이긴다 — 옛 `remote_hooks` 는 같은 블록에 `agent` 가 없을 때만.
    if let Some(v) = block.agent.or(block.remote_hooks) {
        meta.agent = Some(v);
    }
    // 키별 상속 — 적힌 에이전트만 덮는다(빈 문자열도 값이다 = 붙이지 않음).
    if let Some(map) = &block.agent_args {
        for (id, line) in map {
            meta.agent_args.insert(id.clone(), line.clone());
        }
    }
}

/// 이 계층이 `color`·`icon`·`agent_args.<id>` 를 적었으면 그 칸의 출처를 `layer` 로 (`None` = 호스트 자기 값).
fn note_layer(meta: &mut HostMeta, block: &MetaBlock, layer: Option<MetaLayer>) {
    if let Some(map) = &block.agent_args {
        for id in map.keys() {
            match &layer {
                Some(l) => {
                    meta.agent_args_from.insert(id.clone(), l.clone());
                }
                None => {
                    meta.agent_args_from.remove(id);
                }
            }
        }
    }
    if block.color.is_some() {
        meta.color_from = layer.clone();
    }
    if block.icon.is_some() {
        meta.icon_from = layer;
    }
}

/// toml 의 오류 문구는 여러 줄(스팬 표시)이라 경고 목록 한 줄에 넣기 어렵다 — 한 줄로 접는다.
fn flatten(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------------------------------------------------------------------------
// 쓰기 — `[hosts."<별칭>"]` 국소 편집 (toml_edit)
// ---------------------------------------------------------------------------

/// `~/.ssh/sessions.toml` 경로. 파일이 있는지는 보지 않는다.
pub fn sessions_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("sessions.toml"))
        .ok_or_else(
            || tr!(ko: "홈 디렉터리를 찾을 수 없습니다", en: "Could not find the home folder"),
        )
}

/// 파일을 새로 만들 때만 얹는 머리글. 사람이 열었을 때 "이게 뭐 하는 파일인지" 가 먼저 보이게.
/// 이미 있는 파일에는 절대 덧붙이지 않는다.
const NEW_FILE_HEADER: &str = "\
# ~/.ssh/sessions.toml — 호스트 표시·동작 메타데이터 (aynx 전용, ssh 는 이 파일을 모릅니다)
# 앱에서 고칠 수 있지만 손으로 적은 주석·순서는 그대로 보존됩니다.

";

/// GUI 폼에서 올라오는 호스트 메타데이터 패치.
///
/// **`None` 은 "그대로 두기"가 아니라 "키를 지우기"다.** 폼이 열 칸을 모두 들고 있으므로
/// 매 저장이 이 열 키의 완전한 상태이고, 비운 칸은 곧 "상속/기본값으로 되돌리기"다.
/// (`preset`·`identity` 처럼 폼에 없는 키는 이 패치가 건드리지 않는다.)
///
/// 빈 문자열·공백만 있는 문자열·빈 배열도 "지우기"로 취급한다 — 파일에 `color = ""` 같은
/// 무의미한 키가 남지 않게.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(default)]
pub struct HostMetaPatch {
    pub color: Option<String>,
    pub icon: Option<String>,
    pub group: Option<String>,
    pub tags: Option<Vec<String>>,
    pub scrollback: Option<u32>,
    pub on_connect: Option<String>,
    /// 세션 로깅 체크박스. **`false` 는 `log = false` 가 아니라 키 삭제다** — 빈 칸과 같은
    /// 규칙이라 `[defaults]`·preset 의 값을 되물려받는다는 뜻이다. 상속을 개별 호스트에서만
    /// 끊고 싶으면 파일에 직접 `log = false` 를 적어야 한다 (`tags = []` 와 같은 한계).
    pub log: Option<bool>,
    /// 셸 통합 주입. **여기서만 `false` 가 "지우기" 가 아니라 `shell_integration = false`
    /// 로 그대로 적힌다** — 폼이 3값 select 이기 때문이다 (`기본(상속)` / `켬` / `끔`).
    ///
    /// 옵트아웃의 요점이 "상위 계층이 켜 놨어도 이 호스트만 끈다" 라, `log` 의
    /// "체크 해제 = 키 삭제" 규칙으로는 표현할 수 없는 상태다. 상속으로 되돌리는 것은
    /// `None`(= select 의 `기본`) 이 맡는다.
    pub shell_integration: Option<bool>,
    /// tmux 로 접속 체크박스. **`log` 와 같은 규칙** — `false`/`None` 은 둘 다 키 삭제다
    /// (기본이 꺼짐이므로 `tmux = false` 를 파일에 남길 이유가 없다). 상속을 개별 호스트에서만
    /// 끊고 싶으면 파일에 직접 `tmux = false` 를 적는다.
    pub tmux: Option<bool>,
    /// 포트 포워딩 프리셋 목록. **`tags` 와 같은 규칙** — 폼이 목록 전체를 들고 있으므로
    /// 매 저장이 완전한 상태이고, 빈 목록은 키 삭제다. 상속이 없는 칸이라 "지우기" 가
    /// 곧 "이 호스트는 자동으로 아무것도 열지 않는다" 로 끝난다 (`tags` 처럼 위 계층의
    /// 값이 되살아나지 않는다).
    pub forwards: Option<Vec<ForwardPreset>>,
    /// 에이전트 포워딩 덮어쓰기. **`shell_integration` 과 같은 규칙** — `false` 도 그대로
    /// `forward_agent = false` 로 적힌다(config 의 `ForwardAgent yes` 를 이 호스트에서만 끄는
    /// 것이 이 값의 존재 이유 중 하나다). `None` = 키 삭제 = config 를 따른다.
    pub forward_agent: Option<bool>,
    /// 에이전트 활성화 스위치. 기본이 끔이다 — `true` 는 `agent = true`, `false` 는 위 계층의 켬을 덮을 때 `agent = false`
    /// 로 적히고(폼이 그때만 보낸다), `None` 은 키 삭제(= 상속 · 기본 끔). 저장할 때 옛 키 `remote_hooks` 는 늘 지운다.
    #[serde(alias = "remote_hooks")]
    pub agent: Option<bool>,
    /// 원격 추가 인자 — 호스트 **자기 블록에 적을** 에이전트별 한 줄(없는 키 = 상속 · 빈 문자열 = 붙이지 않음).
    /// 빈 맵 · `None` 은 키 삭제다. 줄마다 `crate::agent_args::parse_args` 로 검사하고 어긋나면 저장하지 않는다.
    pub agent_args: Option<BTreeMap<String, String>>,
}

/// 프리셋 목록을 검사하고 **다듬은 목록**을 돌려준다 — **순수 함수** (유닛 테스트 대상).
///
/// 규칙은 [`crate::port_forward::validate`] 그대로에 하나가 더 붙는다: **한 호스트 안에서
/// 같은 자리를 두 번 잡으면 거절한다.** 겹친 채로 저장하면 접속할 때마다 둘째 줄이 "포트가
/// 이미 사용 중" 으로 실패하는데, 그 실패는 서버 사정이 아니라 **우리가 적어 둔 파일**
/// 때문이라 사용자가 원인을 찾을 자리가 없다.
///
/// "자리" 는 종류마다 다르다 ([`bind_slot`]): 로컬·동적은 내 PC 의 리스너(`local_port`)를
/// 함께 쓰고, 원격은 **서버의** 포트(`remote_port`)를 잡는다. 그래서 로컬 15432 와 원격
/// 15432 는 부딪히지 않지만, 로컬 1080 과 동적 1080 은 부딪힌다.
pub(crate) fn validate_forwards(list: &[ForwardPreset]) -> Result<Vec<ForwardPreset>, String> {
    use crate::port_forward::ForwardKind;
    let mut out: Vec<ForwardPreset> = Vec::with_capacity(list.len());
    for f in list {
        let (host, remote_port) =
            crate::port_forward::validate(f.kind, f.local_port, &f.remote_host, f.remote_port)?;
        let next = ForwardPreset {
            kind: f.kind,
            local_port: f.local_port,
            remote_host: host,
            remote_port,
        };
        if out.iter().any(|p| bind_slot(p) == bind_slot(&next)) {
            return Err(if next.kind == ForwardKind::Remote {
                tr!(
                    ko: "원격 포트 {port} 이 두 번 적혀 있습니다 — 한 호스트에서 같은 서버 포트를 두 번 열 수 없습니다",
                    en: "The remote port {port} appears twice — a host cannot open the same server port twice",
                    port = next.remote_port,
                )
            } else {
                tr!(
                    ko: "로컬 포트 {port} 이 두 번 적혀 있습니다 — 한 호스트에서 같은 포트를 두 번 열 수 없습니다",
                    en: "The local port {port} appears twice — a host cannot open the same local port twice",
                    port = next.local_port,
                )
            });
        }
        out.push(next);
    }
    Ok(out)
}

/// 프리셋 한 줄이 **잡는 자리** — `(서버 쪽인가, 포트)`. [`validate_forwards`] 의 겹침 판정.
fn bind_slot(f: &ForwardPreset) -> (bool, u16) {
    match f.kind {
        crate::port_forward::ForwardKind::Remote => (true, f.remote_port),
        _ => (false, f.local_port),
    }
}

/// 프리셋 하나를 TOML 인라인 테이블로. 키 순서는 화면·구조체와 같다 (읽는 사람의 눈이
/// 폼에서 파일로 옮겨 갈 때 순서가 바뀌면 같은 줄인지 한 번 더 확인하게 된다).
///
/// **로컬이면 `kind` 를 적지 않는다** — 이 칸 이전의 파일과 한 글자도 다르지 않게(예전 앱이
/// 읽어도 뜻이 같다). 원격·동적은 `kind` 를 맨 앞에 적고, 그 종류가 쓰지 않는 칸은 뺀다
/// ([`ForwardPreset`] 의 필드 주석).
fn forward_value(f: &ForwardPreset) -> Value {
    use crate::port_forward::ForwardKind;
    let mut table = toml_edit::InlineTable::new();
    match f.kind {
        ForwardKind::Local => {}
        ForwardKind::Remote => {
            table.insert("kind", Value::from("remote"));
        }
        ForwardKind::Dynamic => {
            table.insert("kind", Value::from("dynamic"));
        }
    }
    table.insert("local_port", Value::from(i64::from(f.local_port)));
    if f.kind == ForwardKind::Local {
        table.insert("remote_host", Value::from(f.remote_host.as_str()));
    }
    if f.kind != ForwardKind::Dynamic {
        table.insert("remote_port", Value::from(i64::from(f.remote_port)));
    }
    Value::InlineTable(table)
}

/// 패치를 "쓸 값"으로 정규화한 것. 각 필드의 `None` 이 곧 키 삭제다.
struct Desired {
    color: Option<Value>,
    icon: Option<Value>,
    group: Option<Value>,
    tags: Option<Value>,
    scrollback: Option<Value>,
    on_connect: Option<Value>,
    log: Option<Value>,
    shell_integration: Option<Value>,
    tmux: Option<Value>,
    forwards: Option<Value>,
    forward_agent: Option<Value>,
    agent: Option<Value>,
    agent_args: Option<Value>,
}

impl Desired {
    /// 열 칸이 모두 비었는가 (= 이 호스트의 우리 키를 전부 지우는 저장인가).
    fn is_all_empty(&self) -> bool {
        self.color.is_none()
            && self.icon.is_none()
            && self.group.is_none()
            && self.tags.is_none()
            && self.scrollback.is_none()
            && self.on_connect.is_none()
            && self.log.is_none()
            && self.shell_integration.is_none()
            && self.tmux.is_none()
            && self.forwards.is_none()
            && self.forward_agent.is_none()
            && self.agent.is_none()
            && self.agent_args.is_none()
    }
}

/// 앞뒤 공백을 떼고, 남은 것이 없으면 `None`.
fn clean(v: Option<&String>) -> Option<String> {
    v.map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// **검증이 있는 정규화** — `forwards` · `agent_args` 만 거절할 수 있다 (나머지 칸은 다듬거나
/// 지우는 것으로 언제나 뜻이 선다). 실패하면 파일에는 한 글자도 닿지 않는다.
fn normalize(patch: &HostMetaPatch) -> Result<Desired, String> {
    let tags = patch.tags.as_ref().map(|list| {
        list.iter()
            .map(|t| t.trim())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
    });

    // 빈 목록은 `tags` 와 같이 키 삭제다 — 검증은 줄이 하나라도 있을 때만 돈다.
    let forwards = match patch.forwards.as_deref() {
        None => None,
        Some([]) => None,
        Some(list) => Some(Value::Array(
            validate_forwards(list)?.iter().map(forward_value).collect(),
        )),
    };

    // 원격 추가 인자 — 인라인 테이블 하나(`agent_args = { claude = "…", codex = "" }` — `forwards` 와 같은 이유로
    // 값 통로만 탄다). 줄은 접속 때 쓰는 그 규칙(`parse_args`)으로 검사한다 — 저장과 실행이 같은 규칙.
    let agent_args = match &patch.agent_args {
        None => None,
        Some(map) if map.is_empty() => None,
        Some(map) => {
            let mut table = toml_edit::InlineTable::new();
            for (id, line) in map {
                let Some(display) = crate::agent_args::display_of(id) else {
                    return Err(tr!(ko: "모르는 에이전트입니다: {id}", en: "Unknown agent: {id}"));
                };
                let line = line.trim();
                crate::agent_args::parse_args(line).map_err(|e| {
                    tr!(
                        ko: "{display} 추가 인자: {why}",
                        en: "{display} extra arguments: {why}",
                        why = e.message()
                    )
                })?;
                table.insert(id, Value::from(line));
            }
            Some(Value::InlineTable(table))
        }
    };

    Ok(Desired {
        color: clean(patch.color.as_ref()).map(Value::from),
        icon: clean(patch.icon.as_ref()).map(Value::from),
        group: clean(patch.group.as_ref()).map(Value::from),
        // 빈 배열은 "태그 없음" 이지 "위 계층 태그 지우기" 가 아니다 — 키 자체를 지운다.
        // (`tags = []` 로 상속을 끊고 싶으면 파일을 직접 고쳐야 한다.)
        tags: tags
            .filter(|list| !list.is_empty())
            .map(|list| Value::Array(list.into_iter().collect::<Array>())),
        // 0 은 스크롤백으로 의미가 없다 — 빈 칸과 같이 "지우기" 로 본다.
        scrollback: patch
            .scrollback
            .filter(|n| *n > 0)
            .map(|n| Value::from(i64::from(n))),
        on_connect: clean(patch.on_connect.as_ref()).map(Value::from),
        // 체크를 푼 것은 "끔" 이 아니라 "안 적음" 이다 (위 필드 주석 참고).
        log: patch.log.filter(|v| *v).map(Value::from),
        // **여기만 `false` 를 거르지 않는다** — `shell_integration = false` 를 적는 것이
        // 이 칸의 존재 이유다 (상속으로 되돌리는 것은 `None` 이 맡는다).
        shell_integration: patch.shell_integration.map(Value::from),
        // `log` 와 같다 — 체크를 푼 것은 "끔" 이 아니라 "안 적음" 이다 (기본이 꺼짐이라
        // `tmux = false` 를 파일에 남길 이유가 없다).
        tmux: patch.tmux.filter(|v| *v).map(Value::from),
        forwards,
        // `shell_integration` 과 같다 — `false` 를 거르지 않는다 (config 의 `yes` 를 끄는 값).
        forward_agent: patch.forward_agent.map(Value::from),
        // 기본이 끔 — `true` · `false` 를 그대로 적는다(`false` 는 위 계층의 켬을 덮는 값). `None` 은 키 삭제(= 상속).
        agent: patch.agent.map(Value::from),
        agent_args,
    })
}

/// 값 하나를 갈아 끼우거나(`Some`) 지운다(`None`).
///
/// 이미 있던 줄은 **장식(앞뒤 공백·줄 끝 주석)을 그대로 물려받아** 값만 바뀐다 —
/// `color = "#c25b4a"  # 사내망` 의 주석이 색을 바꿨다고 사라지지 않는다.
fn put(table: &mut dyn TableLike, key: &str, new: Option<Value>) {
    let Some(mut new) = new else {
        table.remove(key);
        return;
    };
    match table.get_mut(key).and_then(Item::as_value_mut) {
        Some(old) => {
            *new.decor_mut() = old.decor().clone();
            *old = new;
        }
        None => {
            table.insert(key, Item::Value(new));
        }
    }
}

/// 이 항목 **바로 위에 사람이 적은 주석**이 붙어 있는가.
///
/// TOML 에는 "떠 있는 주석" 이 없다 — 주석은 언제나 바로 뒤 항목의 앞 장식이다. 그래서
/// `[hosts.web]` 헤더를 지우면 그 위에 적힌 주석(파일 머리글일 수도 있다)이 함께 사라진다.
/// 이 검사로 그런 테이블은 **비워만 두고 헤더는 남긴다** (빈 테이블은 파서에 무해하다).
fn has_leading_comment(hosts: &dyn TableLike, key: &str) -> bool {
    let prefix = |d: &toml_edit::Decor| {
        d.prefix()
            .and_then(|p| p.as_str())
            .is_some_and(|s| s.contains('#'))
    };
    let on_table = hosts
        .get(key)
        .and_then(Item::as_table)
        .is_some_and(|t| prefix(t.decor()));
    // 인라인 형태(`[hosts]` 아래 `web = { … }`)면 주석은 키 쪽 장식에 붙는다.
    let on_key = hosts.key(key).is_some_and(|k| prefix(k.leaf_decor()));
    on_table || on_key
}

/// toml_edit 은 줄바꿈을 항상 `\n` 으로 찍는다 — 원본이 CRLF 였으면 되돌려 준다.
/// (아니면 메모장으로 만든 파일이 저장 한 번에 통째로 LF 로 바뀌어 diff 가 전부 뜬다.)
///
/// `pub(crate)` 인 이유: `delegation.rs` 의 `delegation.toml` 쓰기도 같은 규칙이 필요하고, 두 벌로
/// 베껴 두면 한쪽만 고쳐질 자리다 (포맷 보존 쓰기는 이제 파일이 둘이다).
pub(crate) fn match_line_endings(original: &str, rendered: String) -> String {
    if original.contains("\r\n") && !rendered.contains("\r\n") {
        rendered.replace('\n', "\r\n")
    } else {
        rendered
    }
}

/// `[hosts.*]` 안에서 별칭에 해당하는 **기존 키**를 대소문자 무시로 찾는다.
///
/// 파일에 `[hosts.WEB]` 가 있는데 GUI 가 `web` 으로 저장하면 테이블이 둘로 갈라지고,
/// [`SessionsMeta::parse`] 는 그 상태를 "대소문자만 다른 항목" 경고로 처리한다.
/// 그래서 쓰기도 읽기와 같은 대소문자 규칙을 따라 **원래 표기 그대로** 다시 쓴다.
fn existing_key(hosts: &dyn TableLike, name: &str) -> Option<String> {
    let target = name.to_lowercase();
    hosts
        .iter()
        .map(|(k, _)| k.to_string())
        .find(|k| k.to_lowercase() == target)
}

/// TOML 문서 안에서 `[hosts."<name>"]` 의 우리 키 열 개만 갈아 끼운 **문서 전체**를 돌려준다.
///
/// 보장:
/// - `[defaults]`·`[presets.*]`·다른 호스트 테이블·주석·키 순서·들여쓰기는 그대로다.
/// - 이 호스트 테이블 안에서도 `preset`·`identity` 등 폼에 없는 키는 손대지 않는다.
/// - 우리 키를 전부 지운 결과 테이블이 비면 **테이블(헤더 줄)까지 지운다.**
/// - 지울 것뿐인데 테이블이 원래 없었으면 아무것도 만들지 않는다 (입력을 그대로 돌려준다).
pub(crate) fn patch_document(
    content: &str,
    name: &str,
    patch: &HostMetaPatch,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(tr!(ko: "별칭이 비어 있습니다", en: "The alias is empty"));
    }

    let mut doc = content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "sessions.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "sessions.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })?;

    let desired = normalize(patch)?;

    // `hosts` 가 없는데 지울 것뿐이면 빈 테이블조차 만들지 않는다.
    if desired.is_all_empty() && doc.get("hosts").is_none() {
        return Ok(content.to_string());
    }

    let hosts = doc
        .entry("hosts")
        .or_insert_with(|| {
            let mut t = Table::new();
            // 암시적 테이블 = `[hosts]` 헤더 없이 `[hosts.<별칭>]` 만 찍힌다 (문서의 예시 형태).
            t.set_implicit(true);
            Item::Table(t)
        })
        .as_table_like_mut()
        .ok_or_else(|| tr!(ko: "sessions.toml 의 hosts 가 테이블이 아닙니다 — 파일을 직접 고쳐 주세요", en: "hosts in sessions.toml is not a table — please fix the file by hand"))?;

    let key = existing_key(hosts, name).unwrap_or_else(|| name.to_string());
    if desired.is_all_empty() && hosts.get(&key).is_none() {
        return Ok(content.to_string());
    }

    {
        let table = hosts
            .entry(&key)
            .or_insert_with(|| Item::Table(Table::new()))
            .as_table_like_mut()
            .ok_or_else(|| {
                tr!(ko: "sessions.toml 의 [hosts.{key}] 이 테이블이 아닙니다 — 파일을 직접 고쳐 주세요", en: "[hosts.{key}] in sessions.toml is not a table — please fix the file by hand")
            })?;

        put(table, "color", desired.color);
        put(table, "icon", desired.icon);
        put(table, "group", desired.group);
        put(table, "tags", desired.tags);
        put(table, "scrollback", desired.scrollback);
        put(table, "on_connect", desired.on_connect);
        put(table, "log", desired.log);
        put(table, "shell_integration", desired.shell_integration);
        put(table, "tmux", desired.tmux);
        put(table, "forwards", desired.forwards);
        put(table, "forward_agent", desired.forward_agent);
        put(table, "agent", desired.agent);
        // 옛 이름은 저장할 때마다 걷는다 — 뜻은 방금 적은 `agent` 가 잇는다.
        put(table, "remote_hooks", None);
        put(table, "agent_args", desired.agent_args);
    }

    // 우리 키를 다 지웠고 `preset` 같은 남은 키도 없으면 헤더 줄까지 걷어낸다.
    // 단 그 위에 사람이 적은 주석이 붙어 있으면 주석이 딸려 나가므로 빈 테이블로 남긴다.
    let empty = hosts
        .get(&key)
        .and_then(Item::as_table_like)
        .is_some_and(|t| t.is_empty());
    if empty && !has_leading_comment(hosts, &key) {
        hosts.remove(&key);
    }

    Ok(match_line_endings(content, doc.to_string()))
}

/// 지정한 경로의 sessions.toml 에서 한 호스트의 메타데이터를 고쳐 쓴다.
///
/// 파일이 없으면 머리글 주석과 함께 새로 만든다 — 단 **쓸 값이 하나라도 있을 때만.**
/// 결과가 원본과 같으면 파일에 손도 대지 않는다 (수정 없이 저장해도 mtime 이 흔들리지 않게).
pub(crate) fn set_host_meta_at(
    path: &Path,
    name: &str,
    patch: &HostMetaPatch,
) -> Result<(), String> {
    let (content, existed) = match std::fs::read_to_string(path) {
        Ok(c) => (c, true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (String::new(), false),
        Err(e) => {
            return Err(
                tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
            )
        }
    };

    let patched = patch_document(&content, name, patch)?;

    if !existed {
        // 지울 것뿐이라 내용이 없으면 빈 파일을 만들지 않는다.
        if patched.trim().is_empty() {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| tr!(ko: "{parent} 디렉터리를 만들지 못했습니다: {e}", en: "Could not create the folder {parent}: {e}", parent = parent.display()))?;
        }
        return std::fs::write(path, format!("{NEW_FILE_HEADER}{patched}"))
            .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()));
    }

    if patched == content {
        return Ok(());
    }
    std::fs::write(path, patched.as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

/// 지정한 경로에서 호스트 자기 테이블의 **원본** 메타데이터를 읽는다.
/// 파일 없음·읽기 실패·깨진 TOML·항목 없음은 모두 [`HostMeta::default`] 다 (읽기는 오류가 없다).
pub(crate) fn get_host_meta_at(path: &Path, name: &str) -> HostMeta {
    let Ok(content) = std::fs::read_to_string(path) else {
        return HostMeta::default();
    };
    SessionsMeta::parse(&content).0.raw_host(name)
}

/// TOML 문서에서 `[hosts."<name>"]` 테이블을 통째로 걷어낸 **문서 전체**를 돌려준다.
///
/// 호스트 삭제의 메타 쪽 절반이다 — 편집([`patch_document`])이 우리 키만 손대는 것과 달리
/// 이쪽은 `preset`·`identity` 를 포함한 그 호스트 테이블 전체를 지운다 (호스트 자체가 사라지므로).
///
/// 보장(다른 쓰기들과 같은 규칙):
/// - `[defaults]`·`[presets.*]`·다른 호스트 테이블·주석·키 순서는 한 글자도 바뀌지 않는다.
/// - 이 테이블을 지워 `[hosts]` 가 비면 `[hosts]` 헤더까지 걷어낸다.
/// - **테이블 바로 위에 사람이 적은 주석**이 붙어 있으면 헤더를 지우지 않고 내용만 비운다
///   (TOML 주석은 뒤 항목의 앞 장식이라, 헤더를 지우면 파일 머리글일 수도 있는 주석이 딸려 나간다).
/// - 파일에 해당 테이블(또는 `hosts` 섹션)이 없으면 아무것도 만들지 않고 입력을 그대로 돌려준다.
pub(crate) fn remove_host_document(content: &str, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(tr!(ko: "별칭이 비어 있습니다", en: "The alias is empty"));
    }

    let mut doc = content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "sessions.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "sessions.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })?;

    // hosts 섹션이 없으면 지울 것이 없다 — 입력 그대로.
    let Some(hosts) = doc.get_mut("hosts").and_then(|i| i.as_table_like_mut()) else {
        return Ok(content.to_string());
    };
    // 읽기와 같은 대소문자 규칙으로 원래 표기 그대로의 키를 찾는다. 없으면 no-op.
    let Some(key) = existing_key(hosts, name) else {
        return Ok(content.to_string());
    };

    if has_leading_comment(hosts, &key) {
        // 주석 보존 — 헤더는 남기고 안의 키만 모두 비운다 (빈 테이블은 파서에 무해하다).
        if let Some(table) = hosts.get_mut(&key).and_then(Item::as_table_like_mut) {
            let keys: Vec<String> = table.iter().map(|(k, _)| k.to_string()).collect();
            for k in keys {
                table.remove(&k);
            }
        }
    } else {
        hosts.remove(&key);
    }

    // 호스트가 하나도 남지 않으면 `[hosts]` 헤더도 걷어낸다 (위에 주석이 붙어 있으면 비워만 둔다).
    let hosts_empty = doc
        .get("hosts")
        .and_then(Item::as_table_like)
        .is_some_and(|t| t.is_empty());
    if hosts_empty && !has_leading_comment(doc.as_table(), "hosts") {
        doc.remove("hosts");
    }

    Ok(match_line_endings(content, doc.to_string()))
}

/// 지정한 경로의 sessions.toml 에서 한 호스트의 메타 테이블을 지운다.
///
/// 파일이 없거나 해당 테이블이 없는 것은 **깨끗한 no-op**(오류 아님) — 메타는 앱 소유라
/// 없어도 정상이다. 결과가 원본과 같으면 파일에 손도 대지 않는다 (mtime 이 흔들리지 않게).
pub(crate) fn remove_host_meta_at(path: &Path, name: &str) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        // 파일이 없으면 청소할 것도 없다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => {
            return Err(
                tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
            )
        }
    };

    let patched = remove_host_document(&content, name)?;
    if patched == content {
        return Ok(());
    }
    std::fs::write(path, patched.as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

/// 편집 폼 프리필용 — 호스트 자기 테이블에 **실제로 적힌** 값만 준다 (병합 결과가 아니다).
///
/// 화면 표시용 병합값은 `list_hosts` 의 `HostEntry::meta` 로 이미 내려가 있다. 둘을 섞지 말 것:
/// 병합값을 폼에 채워 저장하면 `[defaults]`·preset 상속이 그 자리에서 끊긴다.
///
/// 파일을 읽으므로 블로킹 풀에서 돈다 (모듈 아래 "명령은 전부 async" 주석).
#[tauri::command]
pub async fn get_host_meta(name: String) -> HostMeta {
    // 경로를 못 찾거나 조인이 실패하면 기본값 — 반환 타입에 오류 자리가 없다
    // (읽기는 오류를 내지 않는다는 이 모듈의 원칙과 같다).
    tauri::async_runtime::spawn_blocking(move || match sessions_path() {
        Ok(path) => get_host_meta_at(&path, &name),
        Err(_) => HostMeta::default(),
    })
    .await
    .unwrap_or_default()
}

/// 호스트 메타데이터를 저장한다. `[hosts."<별칭>"]` 밖은 한 글자도 바뀌지 않는다.
///
/// **patch = 전체 교체** — 호스트 폼이 전체를 보낸다; 부분 패치는 나머지 칸을 지운다.
/// [`HostMetaPatch`] 의 `None` 은 "그대로 두기" 가 아니라 "키 지우기" 다(그 구조체 머리말). 그래서
/// `{ tmux: true }` 만 보내면 그 호스트의 `icon`·`group`·`tags`… 가 전부 사라진다 — 2026-09-24
/// 실기에서 손으로 부른 부분 패치가 dev-01 의 icon·group 을 지웠다(`docs/log/2026-09-24-projects-live-test.md`
/// 발견 ⑥). 칸 하나만 바꾸려면 `get_host_meta` 로 원본을 읽어 그 칸만 고친 **전체**를 보낸다.
/// 폼에 없는 키(`preset`·`identity`)만은 이 패치가 건드리지 않는다.
///
/// 읽고-고쳐-쓰는 파일 작업이라 블로킹 풀에서 돈다.
#[tauri::command]
pub async fn set_host_meta(name: String, patch: HostMetaPatch) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_host_meta_at(&sessions_path()?, &name, &patch)
    })
    .await
    .map_err(|e| tr!(ko: "메타데이터를 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the metadata failed: {e}"))?
}

// ---------------------------------------------------------------------------
// 그룹 메타데이터 — `[groups."<경로>"]` 와 경로 접두사 일괄 재작성 (toml_edit)
//
// 그룹은 여태 호스트의 `group = "prod/web"` 문자열로만 **암시적으로** 존재했다. 여기서
// 그룹 경로 자체에 아이콘 같은 값을 달고(`[groups."prod/web"]`), 이름 바꾸기·중첩·해제·해산을
// **경로 접두사 재작성 한 벌**([`rename_group`])로 처리한다. 호스트 편집과 같은 규칙을 그대로
// 따른다 — toml_edit 국소 편집, 빈 값은 키 삭제, 주석·순서·다른 테이블 보존.
// ---------------------------------------------------------------------------

/// TOML 문자열에서 `[groups]` 테이블을 읽어 `경로 → GroupMeta` 로 편다.
///
/// **깨진 항목은 던지지 않고 건너뛴다** — 파일 전체가 깨졌으면 빈 맵, 그룹 항목이 테이블이
/// 아니거나 `icon` 이 문자열이 아니면 그 항목만 조용히 버린다. 읽기는 오류가 없다는 모듈의
/// 원칙([`SessionsMeta::parse`] 과 같다)을 그대로 따른다.
pub(crate) fn parse_group_meta(content: &str) -> HashMap<String, GroupMeta> {
    let mut map = HashMap::new();
    let Ok(doc) = content.parse::<DocumentMut>() else {
        return map;
    };
    let Some(groups) = doc.get("groups").and_then(Item::as_table_like) else {
        return map;
    };
    for (key, item) in groups.iter() {
        // 그룹 항목은 테이블이어야 한다 — 아니면(`groups.x = 1` 같은 것) 버린다.
        let Some(table) = item.as_table_like() else {
            continue;
        };
        // 빈/공백 값은 없는 것과 같이 본다 (쓰기 쪽이 애초에 그런 키를 남기지 않는다).
        let text = |k: &str| {
            table
                .get(k)
                .and_then(Item::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        map.insert(
            key.to_string(),
            GroupMeta {
                icon: text("icon"),
                color: text("color"),
            },
        );
    }
    map
}

/// TOML 문서에서 `[groups."<경로>"]` 의 `icon`·`color` 두 칸을 갈아 끼운 **문서 전체**를 돌려준다.
///
/// 두 칸은 **늘 함께** 온다(폴더 대화상자는 둘을 한 번에 저장한다) — 호스트 메타 쓰기([`patch_document`])와
/// 같은 규칙이다:
/// - 값이 있으면 제자리에서 값만 바뀌고(줄 끝 주석 보존) 없던 테이블은 끝에 새로 붙는다.
/// - 빈/공백/`None` 값은 **그 키를 지운다** — 그 결과 그룹 테이블이 비면 테이블째,
///   `[groups]` 마저 비면 그 헤더까지 걷어낸다 (위에 사람이 적은 주석이 붙어 있으면 비워만 둔다).
/// - `[groups]` 밖·다른 그룹·주석·키 순서는 한 글자도 바뀌지 않는다.
pub(crate) fn patch_group_meta_document(
    content: &str,
    group: &str,
    icon: Option<&str>,
    color: Option<&str>,
) -> Result<String, String> {
    let group = group.trim();
    if group.is_empty() {
        return Err(tr!(ko: "그룹 경로가 비어 있습니다", en: "The group path is empty"));
    }
    let icon = icon.map(str::trim).filter(|s| !s.is_empty());
    let color = color.map(str::trim).filter(|s| !s.is_empty());
    let fields = [("icon", icon), ("color", color)];

    let mut doc = content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "sessions.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "sessions.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })?;

    // `groups` 가 없는데 지울 것뿐이면 빈 테이블조차 만들지 않는다.
    if icon.is_none() && color.is_none() && doc.get("groups").is_none() {
        return Ok(content.to_string());
    }

    {
        let groups = doc
            .entry("groups")
            .or_insert_with(|| {
                let mut t = Table::new();
                // 암시적 테이블 = `[groups]` 헤더 없이 `[groups."<경로>"]` 만 찍힌다.
                t.set_implicit(true);
                Item::Table(t)
            })
            .as_table_like_mut()
            .ok_or_else(|| {
                tr!(ko: "sessions.toml 의 groups 가 테이블이 아닙니다 — 파일을 직접 고쳐 주세요", en: "groups in sessions.toml is not a table — please fix the file by hand")
            })?;

        if icon.is_some() || color.is_some() {
            let table = groups
                .entry(group)
                .or_insert_with(|| Item::Table(Table::new()))
                .as_table_like_mut()
                .ok_or_else(|| {
                    tr!(
                        ko: "sessions.toml 의 [groups.\"{group}\"] 이 테이블이 아닙니다 — 파일을 직접 고쳐 주세요",
                        en: "[groups.\"{group}\"] in sessions.toml is not a table — please fix the file by hand"
                    )
                })?;
            for (key, v) in fields {
                put(table, key, v.map(Value::from));
            }
        } else if let Some(table) = groups.get_mut(group).and_then(Item::as_table_like_mut) {
            for (key, _) in fields {
                table.remove(key);
            }
        }

        // 값을 다 지운 그룹 테이블은 헤더 줄까지 걷어낸다 (위에 주석이 붙어 있으면 비워만 둔다).
        let empty = groups
            .get(group)
            .and_then(Item::as_table_like)
            .is_some_and(|t| t.is_empty());
        if empty && !has_leading_comment(groups, group) {
            groups.remove(group);
        }
    }

    // 그룹이 하나도 남지 않으면 `[groups]` 헤더도 걷어낸다.
    let groups_empty = doc
        .get("groups")
        .and_then(Item::as_table_like)
        .is_some_and(|t| t.is_empty());
    if groups_empty && !has_leading_comment(doc.as_table(), "groups") {
        doc.remove("groups");
    }

    Ok(match_line_endings(content, doc.to_string()))
}

/// 그룹 경로 값 하나가 `from` 접두사에 걸릴 때의 새 값.
///
/// 반환은 두 겹이다: 바깥 `None` = **안 걸림**(그대로 둔다), `Some(None)` = 그룹을 지운다
/// (`to` 가 빈 문자열이고 값이 정확히 `from` 일 때 — 뿌리로 해산하면 그 호스트는 그룹이 없어진다),
/// `Some(Some(new))` = `new` 로 바꾼다.
///
/// - 값 == `from` → `to` (또는 `to == ""` 면 삭제).
/// - 값이 `from + "/"` 로 시작 → 앞 접두사만 갈아 끼운다. `rest` = `from` 뒤 나머지(`"/sub"`).
///   `to == ""` 면 앞의 `/` 를 떼어 `from/sub` → `sub`.
fn rewrite_group_path(value: &str, from: &str, to: &str) -> Option<Option<String>> {
    if value == from {
        return Some((!to.is_empty()).then(|| to.to_string()));
    }
    // `website` 가 `web` 접두사에 잘못 걸리지 않도록 반드시 `/` 경계에서만 자른다.
    let rest = value.strip_prefix(from).filter(|r| r.starts_with('/'))?;
    Some(Some(if to.is_empty() {
        rest[1..].to_string() // 앞의 `/` 를 뗀다
    } else {
        format!("{to}{rest}")
    }))
}

/// `from` 경로 접두사를 `to` 로 바꾼 **문서 전체**를 돌려준다 — 이름 바꾸기·중첩·해제·해산의
/// 단 하나의 원시 연산.
///
/// 재작성 범위:
/// - 모든 `[hosts.*]` 의 `group` 값 (정확히 `from` 이거나 `from/…` 하위). `to == ""` 면 정확히
///   `from` 인 호스트는 `group` 키를 잃는다(그룹 없음).
/// - 모든 `[groups."…"]` 테이블 키도 같은 규칙으로 이관한다. **목적지 키가 이미 있으면
///   옮겨온 쪽으로 덮어쓴다** — 그래야 이동/해산이 목적지의 낡은 메타에 가려지지 않는다.
///
/// 가드(한국어 오류): `from` 이 비었거나, `to == from` 이거나, `to` 가 `from` 의 하위
/// (`to.starts_with(from + "/")`)면 거부한다 — 그룹을 자기 안으로 넣는 순환이다.
/// 걸리는 호스트·그룹이 하나도 없으면 조용한 no-op(Ok, 내용 무변화)이다.
pub(crate) fn rename_group_document(content: &str, from: &str, to: &str) -> Result<String, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() {
        return Err(
            tr!(ko: "바꿀 그룹 경로가 비어 있습니다", en: "The group path to rename is empty"),
        );
    }
    if to == from {
        return Err(
            tr!(ko: "바꿀 이름이 원래 이름과 같습니다", en: "The new name is the same as the old one"),
        );
    }
    if to.starts_with(&format!("{from}/")) {
        return Err(
            tr!(ko: "그룹을 자기 하위 경로로 옮길 수 없습니다", en: "A group cannot be moved under itself"),
        );
    }

    let mut doc = content.parse::<DocumentMut>().map_err(|e| {
        tr!(
            ko: "sessions.toml 을 해석할 수 없어 저장하지 않았습니다 — 파일을 직접 고쳐 주세요: {why}",
            en: "sessions.toml could not be parsed, so nothing was saved — please fix the file by hand: {why}",
            why = flatten(&e.to_string()),
        )
    })?;

    // 1) 호스트들의 group 값 재작성.
    if let Some(hosts) = doc.get_mut("hosts").and_then(|i| i.as_table_like_mut()) {
        for (_, item) in hosts.iter_mut() {
            let Some(table) = item.as_table_like_mut() else {
                continue;
            };
            // 값을 미리 복제해 불변 대여를 끊는다 (곧바로 table 을 가변으로 만진다).
            let Some(current) = table
                .get("group")
                .and_then(Item::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            match rewrite_group_path(&current, from, to) {
                Some(Some(new)) => put(table, "group", Some(Value::from(new))),
                Some(None) => {
                    table.remove("group");
                }
                None => {}
            }
        }
    }

    // 2) `[groups."…"]` 테이블 키 이관. 먼저 옮길 목록을 모으고(이터레이터 무효화 방지) 적용한다.
    if let Some(groups) = doc.get_mut("groups").and_then(|i| i.as_table_like_mut()) {
        let migrations: Vec<(String, Option<String>)> = groups
            .iter()
            .filter_map(|(key, _)| {
                rewrite_group_path(key, from, to).map(|new| (key.to_string(), new))
            })
            .collect();
        for (old, new) in migrations {
            let Some(item) = groups.remove(&old) else {
                continue;
            };
            // `Some(None)` = 뿌리로 해산된 정확히-from 메타 → 옮기지 않고 버린다.
            if let Some(new) = new {
                // insert 는 목적지 키가 있으면 덮어쓴다 = "옮겨온 쪽 우선".
                groups.insert(&new, item);
            }
        }
    }

    Ok(match_line_endings(content, doc.to_string()))
}

/// 지정한 경로에서 `[groups]` 를 읽어 맵으로 준다. 파일 없음·깨진 파일·항목 없음은 모두 빈 맵.
pub(crate) fn list_group_meta_at(path: &Path) -> Result<HashMap<String, GroupMeta>, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(parse_group_meta(&content)),
        // 없는 것이 정상이다 — 그룹 메타 없이 동작한다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(
            tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
        ),
    }
}

/// 지정한 경로의 `[groups."<경로>"]` 아이콘·색을 고쳐 쓴다.
///
/// 파일이 없으면 머리글과 함께 새로 만든다 — 단 **쓸 값이 있을 때만.** 결과가 원본과 같으면
/// 파일에 손도 대지 않는다 (호스트 쓰기와 같은 규칙).
pub(crate) fn set_group_meta_at(
    path: &Path,
    group: &str,
    icon: Option<&str>,
    color: Option<&str>,
) -> Result<(), String> {
    let (content, existed) = match std::fs::read_to_string(path) {
        Ok(c) => (c, true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (String::new(), false),
        Err(e) => {
            return Err(
                tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
            )
        }
    };

    let patched = patch_group_meta_document(&content, group, icon, color)?;

    if !existed {
        // 지울 것뿐이라 내용이 없으면 빈 파일을 만들지 않는다.
        if patched.trim().is_empty() {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| tr!(ko: "{parent} 디렉터리를 만들지 못했습니다: {e}", en: "Could not create the folder {parent}: {e}", parent = parent.display()))?;
        }
        return std::fs::write(path, format!("{NEW_FILE_HEADER}{patched}"))
            .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()));
    }

    if patched == content {
        return Ok(());
    }
    std::fs::write(path, patched.as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

/// 지정한 경로에서 그룹 경로 접두사를 일괄 재작성한다. 파일이 없으면 이관 대상이 없으니
/// 입력 가드만 태우고 조용히 성공한다. 결과가 원본과 같으면 파일에 손도 대지 않는다.
pub(crate) fn rename_group_at(path: &Path, from: &str, to: &str) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // 대상이 없어도 잘못된 입력(빈 from·순환)은 여기서 걸러 준다.
            rename_group_document("", from, to)?;
            return Ok(());
        }
        Err(e) => {
            return Err(
                tr!(ko: "{path} 읽기 실패: {e}", en: "Could not read {path}: {e}", path = path.display()),
            )
        }
    };

    let patched = rename_group_document(&content, from, to)?;
    if patched == content {
        return Ok(());
    }
    std::fs::write(path, patched.as_bytes())
        .map_err(|e| tr!(ko: "{path} 쓰기 실패: {e}", en: "Could not write {path}: {e}", path = path.display()))
}

// ---------------------------------------------------------------------------
// 그룹 명령
//
// 이 모듈의 명령은 **전부 `async` + `spawn_blocking`** 이다. 하는 일이 하나같이
// `~/.ssh/sessions.toml` 을 읽거나 읽고-고쳐-쓰는 파일 작업인데, 동기 명령은 웹뷰 UI
// 스레드에서 그대로 돌기 때문이다 — 디스크가 바쁘면 그 몇십 ms 동안 살아 있는 터미널의
// 출력 채널이 함께 막히고, 한 번 막힌 채널은 영구히 침묵한다
// (docs/log/2026-09-05-async-commands.md · docs/conventions.md).
// ---------------------------------------------------------------------------

/// `[groups]` 테이블을 `경로 → GroupMeta` 맵으로 읽는다. 파일 없음·깨짐은 빈 맵(오류 아님).
#[tauri::command]
pub async fn list_group_meta() -> Result<HashMap<String, GroupMeta>, String> {
    tauri::async_runtime::spawn_blocking(|| list_group_meta_at(&sessions_path()?))
        .await
        .map_err(|e| tr!(ko: "그룹 정보를 읽는 작업이 실패했습니다: {e}", en: "The task that reads the group information failed: {e}"))?
}

/// 그룹 아이콘·색을 저장한다. 빈/공백/`None` 인 칸은 그 키를(둘 다 비면 테이블까지) 지운다.
/// `[groups."<경로>"]` 밖은 한 글자도 바뀌지 않는다.
#[tauri::command]
pub async fn set_group_meta(
    path: String,
    icon: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_group_meta_at(&sessions_path()?, &path, icon.as_deref(), color.as_deref())
    })
    .await
    .map_err(|e| tr!(ko: "그룹 정보를 저장하는 작업이 실패했습니다: {e}", en: "The task that saves the group information failed: {e}"))?
}

/// 그룹 경로 접두사 `from` 을 `to` 로 일괄 재작성한다 — 이름 바꾸기·중첩·해제(`to`=상위)·
/// 해산(`to == ""`)이 모두 이 하나로 이뤄진다. 호스트 `group` 값과 `[groups."…"]` 키가
/// 함께 옮겨진다. 순환(`to` 가 `from` 하위)은 거부한다.
#[tauri::command]
pub async fn rename_group(from: String, to: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_group_at(&sessions_path()?, &from, &to)
    })
    .await
    .map_err(|e| tr!(ko: "그룹 이름을 바꾸는 작업이 실패했습니다: {e}", en: "The task that renames the group failed: {e}"))?
}

#[cfg(test)]
mod tests;
