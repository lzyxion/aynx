//! `[automation]` — 자동 승인 정책(구조적 allowlist 규칙 `AllowRule` · `AutomationPrefs` · 기본값 · 상한 · 정리 `sanitize`).
//! `settings.rs` 에서 그대로 옮겼다 — 바깥 경로는 `crate::settings::{AllowRule, AutomationPrefs, MIN_MAX_CONCURRENCY, MAX_MAX_CONCURRENCY}` 재수출 그대로.

/// 자동 승인 **구조적 allowlist 규칙**(슬라이스 A4b) — 실행 파일 하나 + 허용 서브커맨드들.
///
/// 평탄한 `allow_patterns`(단어 경계 prefix)가 너무 거칠다는 문제를 좁힌다: `apt-get` 을 열면
/// `apt-get install <무엇이든>` 까지, `docker` 를 열면 `docker run …` 까지 열려 버린다. 사용자는
/// `settings.toml` 에 `[[automation.allow]]` 로 **실행 파일 + 허용 서브커맨드**를 손으로 적고
/// (delegation.toml 처럼), AI 는 여전히 자유롭게 명령을 제안하되 aynx 이 **자동 경로에서만** 검증한다
/// (판정은 `policy.rs`·`policy.ts` 의 `matches_structured_allow`, 드리프트 잠금). 범위는 전역이다.
/// **편집 UI 는 후속** — 지금은 파일 직접 편집이다.
///
/// ## 인자 제약 (2026-10-05 — docs/log/2026-10-05-auto-approve-args.md)
///
/// exec+서브커맨드만 보면 `ip link set eth0 down`·`git branch -D main`·`journalctl --vacuum-time=1s`
/// 가 '읽기' 규칙으로 통과한다. 그래서 규칙이 **인자까지** 말할 수 있다 — 아래 다섯 칸은 전부
/// **선택**이고, 비어 있으면(= 옛 모양) 예전 의미 그대로다(옛 규칙을 몰래 좁히거나 넓히지 않는다).
/// 직렬화도 빈 칸은 쓰지 않아, 옛 파일은 저장해도 글자 그대로 남는다.
///
/// - `deny_flags` — 명령 **어디에든** 이 플래그가 있으면 불허. `-f` 는 묶인 짧은 플래그(`-fn`)도,
///   `--follow` 는 `--follow=…`·줄임(`--fol`)도 잡는다. 끝의 `*` 는 접두(`--vacuum-*`).
///   `-` 로 시작하지 않거나 `*` 가 끝이 아닌 항목이 있으면 **그 규칙 전체가 매칭되지 않는다**(안전한 쪽).
/// - `allow_flags` — 비어 있지 않으면 **모든 플래그**가 이 목록에 있어야 한다(`--sort=x` 는 `--sort`
///   로 본다, `-av` 는 `-a`·`-v` 둘 다 있으면 통과). 줄임은 받지 않는다.
/// - `require_flags` — 이 플래그가 **정확히** 있어야 한다(`--no-stream=false` 같은 값 붙은 꼴이
///   하나라도 있으면 불허).
/// - `first_arg` — 서브커맨드(없으면 exec) 뒤 **첫 비플래그 인자**가 없거나 이 중 하나여야 한다
///   (끝의 `*` 는 접두 — `date` 의 `+*`).
/// - `max_args` — 서브커맨드(없으면 exec) 뒤 비플래그 인자 수 상한(`0` = 인자 없이).
/// - `sub_first` — 서브커맨드가 exec 바로 다음 낱말이어야 한다(그 앞 플래그 불허).
///
/// 판정은 따옴표를 벗긴 낱말로 한다(`'-f'` 도 `-f` 다). `--` 뒤 낱말은 플래그가 아니라 인자다.
///
/// ```toml
/// [[automation.allow]]
/// exec = "systemctl"
/// subcommands = ["is-active", "status", "show", "list-units"]
///
/// [[automation.allow]]
/// exec = "df"        # subcommands 생략/빈 값 = 서브커맨드 개념 없음(플래그만이면 통과)
///
/// [[automation.allow]]
/// exec = "journalctl"
/// deny_flags = ["-f", "--follow", "--vacuum-*"]
///
/// [[automation.allow]]
/// exec = "ip"
/// subcommands = ["addr"]
/// first_arg = ["show", "list"]   # `ip addr` · `ip addr show dev eth0` 만
/// ```
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AllowRule {
    /// 실행 파일 이름 — 명령 첫 토큰의 **basename** 과 정확·대소문자 구분 비교
    /// (`/usr/bin/systemctl` → `systemctl`).
    pub exec: String,
    /// 허용 서브커맨드 목록. **비면** 서브커맨드 개념이 없다는 뜻(플래그만 붙는 `df -h` 류는
    /// 무엇이든 통과). 비어 있지 않으면 명령의 첫 비플래그 토큰이 이 목록에 있어야 통과한다.
    #[serde(default)]
    pub subcommands: Vec<String>,
    /// 명령 어디에든 있으면 불허하는 플래그들(위 "인자 제약"). 비면 제약 없음.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deny_flags: Vec<String>,
    /// 비어 있지 않으면 모든 플래그가 여기 있어야 한다. 비면 제약 없음.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow_flags: Vec<String>,
    /// 반드시 (정확히) 있어야 하는 플래그들. 비면 제약 없음.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub require_flags: Vec<String>,
    /// 서브커맨드 뒤 첫 비플래그 인자가 없거나 이 중 하나여야 한다. 비면 제약 없음.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub first_arg: Vec<String>,
    /// 서브커맨드 뒤 비플래그 인자 수 상한. `None` = 제약 없음, `Some(0)` = 인자 없이.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_args: Option<u32>,
    /// 서브커맨드가 **exec 바로 다음 낱말**이어야 한다(앞에 플래그가 오면 불허). 앞 플래그의 값이
    /// 서브커맨드로 위장하는 꼴(`git -C status push` · `kubectl -n get delete pod x`)을 막는다.
    /// 묶음 규칙은 서브커맨드가 있으면 늘 켜진다(`automation_presets` 머리말). 기본 `false`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sub_first: bool,
}

/// 자동 승인 정책 — 로드맵 **단계 10b**(명령 패턴 allowlist · docs/log/2026-09-10-auto-approval.md).
///
/// **기본은 전부 끔·비움**이다. `auto_approve` 가 false 면(또는 이 섹션이 파일에 없으면) 아무
/// 작업안도 자동 승인되지 않고 단계 9 의 수동 동작 그대로다. 자동 승인 여부의 판단(위험·메타
/// 문자·allowlist·상한)은 **프런트 정책 평가기**(`src/lib/policy.ts`)가 하고, 여기 값은 그
/// 입력이다 — `classifyRisk` 를 Rust 로 포팅하지 않는 것이 이 분담의 요점이다(자동 승인은
/// 프런트 주도이고 approve 는 여전히 Tauri 명령 전용이다).
///
/// 두 상한(`max_targets`·`max_concurrency`)만은 성격이 다르다: **백엔드가
/// [`crate::operations::approval::approve_operation`] 진입에서 무조건 강제**하는 하드 경계라(수동·자동
/// 공통), 프런트가 버그여도 못 뚫는다. [`AutomationPrefs::sanitize`] 가 제정신 범위로 자른다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AutomationPrefs {
    /// 자동 승인을 켤 것인가. **기본 끔** — 켜야만 정책 평가기가 돈다.
    #[serde(default)]
    pub auto_approve: bool,
    /// 자동 승인 후보로 볼 **명령 패턴**들(단어 경계 prefix 매칭 — `"df"` 는 `df`·`df -h`,
    /// `dfx` 불가). 매칭·해석은 프런트가 한다(백엔드는 문자열을 보관·정리만). 빈 목록이면
    /// 어떤 명령도 매칭되지 않아 사실상 자동 승인이 없다.
    #[serde(default)]
    pub allow_patterns: Vec<String>,
    /// 켜 둔 **묶음 프리셋**(bundle) id 들 — `[automation] bundles = ["system", "git"]`.
    /// 옛 id(`diag-readonly`·`git-readonly`)는 읽을 때 새 id 로 옮긴다([`sanitize`](Self::sanitize)).
    ///
    /// 묶음은 이름으로 말하는 위임 범위다([`crate::automation_presets`]). 여기 적힌 id 가
    /// 펼쳐져 [`allow`](Self::allow) 와 **합쳐진** 것이 자동 승인 판정이 보는 규칙 전부다
    /// (`automation_presets::effective_allow_rules`). **모르는 id 는 지우지 않고 그대로 두되
    /// 무시한다** — 새 버전에서 생긴 묶음을 켜 둔 파일을 옛 버전이 읽어도 설정을 잃지 않게.
    ///
    /// 기본은 **빈 목록**이다(기본 거부는 그대로 — 묶음은 사람이 켜야 생긴다).
    #[serde(default)]
    pub bundles: Vec<String>,
    /// 자동 승인이 허용하는 **대상 수 상한**. 이 값을 넘는 작업안은 승인(수동·자동) 자체가
    /// 진입에서 거부된다. [`sanitize`](AutomationPrefs::sanitize)가 1..=100 으로 자른다.
    #[serde(default = "default_max_targets")]
    pub max_targets: u32,
    /// 동시 실행 수 상한 — 위와 같은 하드 경계다. 1..=16 으로 자른다.
    #[serde(default = "default_max_concurrency")]
    pub max_concurrency: u32,
    /// **자동 승인 폭주 방지**(슬라이스 A4c) — 슬라이딩 창(`auto_window_secs`) 안에서 자동
    /// 승인이 허용되는 **최대 건수**. allowlist·위임이 다 통과해도, 이 빈도 한도를 넘으면 자동
    /// 승인이 거부되고 사람 승인을 기다린다(무인 루프가 allowlist 명령을 무한히 밀지 못하게).
    /// [`sanitize`](AutomationPrefs::sanitize)가 1..=1000 으로 자른다(0 은 1 로 — 켜면 항상
    /// 유한 상한이 걸린다). `auto_approve` 가 꺼져 있으면 이 한도는 아무 일도 하지 않는다.
    #[serde(default = "default_auto_max_per_window")]
    pub auto_max_per_window: u32,
    /// 위 빈도 한도의 **슬라이딩 창 길이**(초). 1..=86400(하루)으로 자른다.
    #[serde(default = "default_auto_window_secs")]
    pub auto_window_secs: u32,
    /// **검토 대기 만료**(분) — AI 가 올린 작업안이 이 시간 안에 승인되지 않으면 만료된다
    /// (`[automation] approval_ttl_minutes`, 기본 30분). `0` 은 "만료 없음" 이라는 **사용자의
    /// 답**이라 그대로 산다(하한으로 접지 않는다 — `[vault] auto_lock_minutes` 와 같은 규칙).
    ///
    /// 자동 승인과 달리 이 칸은 **꺼도 되는 기능이 아니라 시계**다: `auto_approve` 가 꺼져
    /// 있어도 만료는 돈다(검토를 기다리는 것은 수동 승인 쪽이 더 흔하다). 타이머는 없고,
    /// 작업안 저장소를 **읽거나 전이할 때 그 자리에서** 판정한다
    /// ([`crate::operations::expire_stale`] — docs/log/2026-09-21-approval-ttl.md).
    /// [`sanitize`](AutomationPrefs::sanitize)가 0..=1440(하루)으로 자른다.
    #[serde(default = "default_approval_ttl_minutes")]
    pub approval_ttl_minutes: u32,
    /// **검토 요청 OS 알림**을 켤 것인가 (`[automation] notify_review_requests`, **기본 켬**).
    ///
    /// 이 섹션에서 **유일하게 기본이 `true`** 인 칸이다. 나머지는 "실행을 허락하는" 칸이라
    /// 기본 거부가 맞지만, 이것은 **사람에게 알리기만** 하는 칸이라 기본 침묵이 곧 놓침이다
    /// (docs/log/2026-09-22-review-notify.md).
    ///
    /// 판정도 발사도 **프런트**가 한다(`src/lib/review-notify.ts` ·
    /// `src/lib/app/pending-plans.svelte.ts`) — Rust 는 이 한 칸을 보관·정리만 한다.
    /// `approval_ttl_minutes` 와 같이 `auto_approve` 와 무관하게 먹는다(검토를 기다리는
    /// 작업안은 수동 승인 쪽이 더 흔하다). 정규화할 것이 없다(불리언).
    #[serde(default = "default_notify_review_requests")]
    pub notify_review_requests: bool,
    /// **실행 결과 OS 알림**을 켤 것인가 (`[automation] notify_operation_results`, **기본 켬**).
    ///
    /// [`notify_review_requests`](AutomationPrefs::notify_review_requests) 의 짝이다 — 그쪽이
    /// "검토해 달라" 를, 이쪽은 "작업안 실행이 끝났다" 를 창이 앞에 없을 때 알린다. 알리기만
    /// 하는 칸이라 기본 켬이다(docs/log/2026-09-28-run-result-notify.md). 이 칸이 끄는 것은
    /// **OS 알림뿐**이다 — 토스트와 알림 센터 기록은 끄는 칸이 없다(실행 결과를 조용히 삼키는
    /// 길을 만들지 않는다). 판정·발사는 프런트(`src/lib/operation-notify.ts` ·
    /// `src/lib/app/operation-notify.svelte.ts`)가 하고, Rust 는 보관만 한다.
    #[serde(default = "default_notify_operation_results")]
    pub notify_operation_results: bool,
    /// **감사 로그 보관 일수** (`[automation] audit_retention_days`, 기본 90, `0` = 지우지 않음).
    ///
    /// 감사 로그를 **끄는** 칸이 아니다 — "모든 실행을 기록" 은 불변이다. 쓰기 스레드가 앱 시작과
    /// 날짜가 바뀐 첫 쓰기에서 이 일수보다 오래된 **날짜 파일**(`audit-YYYYMMDD.jsonl`)을 통째로
    /// 지운다([`crate::audit::expired_audit_files`] · docs/log/2026-09-28-run-history.md).
    /// `0` 은 "영원히 남긴다" 는 답이라 그대로 산다(`approval_ttl_minutes` 와 같은 규칙).
    /// [`sanitize`](AutomationPrefs::sanitize)가 0..=3650(10년)으로 자른다.
    #[serde(default = "default_audit_retention_days")]
    pub audit_retention_days: u32,
    /// **실행 출력 발췌를 감사 로그에 남길 것인가** (`[automation] audit_output_excerpt`, **기본 끔**).
    ///
    /// 켜면 `finished` 레코드의 대상별 결과에 stdout·stderr 의 **꼬리**(스트림마다 줄·바이트 상한 —
    /// [`crate::audit::EXCERPT_MAX_LINES`]·[`crate::audit::EXCERPT_MAX_BYTES`])를 싣는다. 원격 출력에는
    /// 비밀이 섞일 수 있고 볼트 밖에는 비밀을 남기지 않는다는 원칙이 있어 **옵트인**이다(세션 로깅이
    /// 기본 꺼짐인 것과 같은 결). 켜 두어도 AI 읽기 공유가 꺼진 대상은 싣지 않는다.
    #[serde(default)]
    pub audit_output_excerpt: bool,
    /// **파이프(`|`)를 자동 승인 후보로 볼 것인가** (`[automation] allow_pipes`, **기본 끔** — 10-22 옵트인).
    ///
    /// 켜면 맨 `|` 로 이은 명령을 **단계마다** 본다: 단계 하나하나가 위험 아님 + 허용 목록을 저마다 통과해야 하고, 다른 명령을
    /// 실행하는 단계(`xargs` · 셸 · `env` · `sudo` · `tee` · `find -exec` …)는 허용 목록에 있어도 거절한다
    /// ([`crate::policy::pipe_stage_refused`]). 리다이렉트 · 치환 · 서브셸 · heredoc · `;` · `&` · `||` · 줄바꿈이 섞이면 여전히
    /// 사람 승인이다. 끄면 예전과 한 글자도 다르지 않다. 정책 칸이라 원격 웹에서 못 바꾼다(`remote/deny.rs` `settings_home_only`).
    #[serde(default)]
    pub allow_pipes: bool,
    /// 켜 둔 묶음 안에서 **끈 명령**들 — 묶음 id → 명령 키 목록(`automation_presets::PresetRule::command_key`).
    ///
    /// ```toml
    /// [automation.bundle_off]
    /// files = ["cat"]
    /// docker = ["docker inspect", "docker logs"]
    /// ```
    ///
    /// **좁히기만 한다** — 여기 무엇을 적든 묶음이 담은 것보다 넓어지지 않는다(모르는 묶음·키는
    /// 아무 일도 안 한다). 그래서 모르는 값도 지우지 않고 보존한다(`bundles` 와 같은 규칙). 묶음을 꺼도
    /// 남는다 — 다시 켜면 끈 명령이 그대로다. 비면 파일에 안 적힌다. 옛 묶음 id 를 옮길 때 옛 묶음에
    /// 없던 명령이 여기 들어간다(`automation_presets::migrate_legacy_bundles`).
    ///
    /// 표(table)라 `[[automation.allow]]` 처럼 스칼라 칸보다 **뒤에** 직렬화돼야 한다 — `allow` 바로 앞.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub bundle_off: std::collections::BTreeMap<String, Vec<String>>,
    /// 구조적 allowlist(슬라이스 A4b) — `[[automation.allow]]` 로 실행 파일+서브커맨드 단위 위임.
    /// 평탄한 `allow_patterns` 와 **OR** 로 합쳐진다(하위 호환: 둘 중 하나만 매칭해도 allowlist 통과).
    /// 배열-of-테이블(`[[automation.allow]]`)이라 이 테이블의 스칼라 필드보다 **뒤에** 직렬화돼야
    /// 하므로 구조체의 **맨 아래 필드**다 (`[terminal.dynamic]` 와 같은 이유).
    #[serde(default)]
    pub allow: Vec<AllowRule>,
}

/// [`AutomationPrefs::max_targets`] 기본값·범위. 하드 경계라 백엔드가 강제한다.
const DEFAULT_MAX_TARGETS: u32 = 10;
const MIN_MAX_TARGETS: u32 = 1;
const MAX_MAX_TARGETS: u32 = 100;
/// [`AutomationPrefs::max_concurrency`] 기본값·범위. **범위는 `pub(crate)`** — 작업안 입력
/// 정규화([`crate::mcp`] 의 `create_execution_plan`)가 같은 동시 실행 상한을 재사용한다(두 벌
/// 하드코딩하지 않는다).
const DEFAULT_MAX_CONCURRENCY: u32 = 4;
pub(crate) const MIN_MAX_CONCURRENCY: u32 = 1;
pub(crate) const MAX_MAX_CONCURRENCY: u32 = 16;

/// [`AutomationPrefs::auto_max_per_window`] 기본값·범위(A4c 빈도 한도). 하한 1 이라 자동 승인이
/// 켜지면 언제나 유한 상한이 건다(0 을 넣어도 1 로 올라온다).
const DEFAULT_AUTO_MAX_PER_WINDOW: u32 = 20;
const MIN_AUTO_MAX_PER_WINDOW: u32 = 1;
const MAX_AUTO_MAX_PER_WINDOW: u32 = 1000;
/// [`AutomationPrefs::auto_window_secs`] 기본값·범위. 기본 300초(5분), 최대 하루.
const DEFAULT_AUTO_WINDOW_SECS: u32 = 300;
const MIN_AUTO_WINDOW_SECS: u32 = 1;
const MAX_AUTO_WINDOW_SECS: u32 = 86_400;

/// [`AutomationPrefs::approval_ttl_minutes`] 기본값·범위. **하한이 `0`(만료 없음)** 인 것이
/// 다른 상한들과 갈리는 점이다 — 여기서 0 은 "너무 짧음" 이 아니라 사용자의 답이다.
const DEFAULT_APPROVAL_TTL_MINUTES: u32 = 30;
const MIN_APPROVAL_TTL_MINUTES: u32 = 0;
const MAX_APPROVAL_TTL_MINUTES: u32 = 1440;

/// [`AutomationPrefs::notify_review_requests`] 기본값 — **켬**. 이 섹션에서 유일하게 기본이
/// 참인 칸이다(실행을 허락하는 칸이 아니라 알리기만 하는 칸이라 기본 침묵이 곧 놓침이다).
const DEFAULT_NOTIFY_REVIEW_REQUESTS: bool = true;

/// [`AutomationPrefs::notify_operation_results`] 기본값 — **켬**(위 검토 요청 알림과 같은 이유).
const DEFAULT_NOTIFY_OPERATION_RESULTS: bool = true;

/// [`AutomationPrefs::audit_retention_days`] 기본값·범위. **하한이 `0`(지우지 않음)** — TTL 과 같은
/// 규칙이다(0 은 "너무 짧음" 이 아니라 사용자의 답이다). 위는 10년.
const DEFAULT_AUDIT_RETENTION_DAYS: u32 = 90;
pub(crate) const MAX_AUDIT_RETENTION_DAYS: u32 = 3650;

fn default_max_targets() -> u32 {
    DEFAULT_MAX_TARGETS
}

fn default_max_concurrency() -> u32 {
    DEFAULT_MAX_CONCURRENCY
}

fn default_auto_max_per_window() -> u32 {
    DEFAULT_AUTO_MAX_PER_WINDOW
}

fn default_auto_window_secs() -> u32 {
    DEFAULT_AUTO_WINDOW_SECS
}

fn default_approval_ttl_minutes() -> u32 {
    DEFAULT_APPROVAL_TTL_MINUTES
}

fn default_notify_review_requests() -> bool {
    DEFAULT_NOTIFY_REVIEW_REQUESTS
}

fn default_notify_operation_results() -> bool {
    DEFAULT_NOTIFY_OPERATION_RESULTS
}

fn default_audit_retention_days() -> u32 {
    DEFAULT_AUDIT_RETENTION_DAYS
}

impl Default for AutomationPrefs {
    /// **전부 끔·비움 + 상한 기본값**. 이 값과 같으면 파일에 `[automation]` 을 안 쓴다.
    /// 예외는 알리는 칸 둘뿐이다 — [`notify_review_requests`](AutomationPrefs::notify_review_requests)
    /// 와 [`notify_operation_results`](AutomationPrefs::notify_operation_results) 는 **켜진 채로
    /// 시작한다**(실행을 허락하는 칸이 아니라 알리는 칸이다).
    fn default() -> Self {
        AutomationPrefs {
            auto_approve: false,
            allow_patterns: Vec::new(),
            bundles: Vec::new(),
            max_targets: DEFAULT_MAX_TARGETS,
            max_concurrency: DEFAULT_MAX_CONCURRENCY,
            auto_max_per_window: DEFAULT_AUTO_MAX_PER_WINDOW,
            auto_window_secs: DEFAULT_AUTO_WINDOW_SECS,
            approval_ttl_minutes: DEFAULT_APPROVAL_TTL_MINUTES,
            notify_review_requests: DEFAULT_NOTIFY_REVIEW_REQUESTS,
            notify_operation_results: DEFAULT_NOTIFY_OPERATION_RESULTS,
            audit_retention_days: DEFAULT_AUDIT_RETENTION_DAYS,
            audit_output_excerpt: false,
            allow_pipes: false,
            bundle_off: std::collections::BTreeMap::new(),
            allow: Vec::new(),
        }
    }
}

impl AutomationPrefs {
    /// 기본값과 완전히 같은가 — `skip_serializing_if` 가 이걸 보고 `[automation]` 을 생략한다.
    pub(super) fn is_default(&self) -> bool {
        *self == AutomationPrefs::default()
    }

    /// 읽고 쓰기 양쪽에서 통과시키는 정규화 — 상한을 제정신 범위로 자르고, 패턴의 공백·중복·
    /// 빈 값을 정리한다(순서 보존). 손으로 고친 파일의 `max_targets = 0` 도 여기서 1 로 올라온다.
    /// 옛 묶음 id 도 여기서 옮긴다(멱등 — `automation_presets::migrate_legacy_bundles`). 시험 칸
    /// (`policy::explain::test_auto_approval`)이 화면의 초안에도 같은 정리를 건다.
    pub(crate) fn sanitize(&mut self) {
        self.max_targets = self.max_targets.clamp(MIN_MAX_TARGETS, MAX_MAX_TARGETS);
        self.max_concurrency = self
            .max_concurrency
            .clamp(MIN_MAX_CONCURRENCY, MAX_MAX_CONCURRENCY);
        // A4c 빈도 한도 — 0(무한대로 읽힐 값)은 하한 1 로 올라와 켜면 언제나 유한 상한이 건다.
        self.auto_max_per_window = self
            .auto_max_per_window
            .clamp(MIN_AUTO_MAX_PER_WINDOW, MAX_AUTO_MAX_PER_WINDOW);
        self.auto_window_secs = self
            .auto_window_secs
            .clamp(MIN_AUTO_WINDOW_SECS, MAX_AUTO_WINDOW_SECS);
        // 검토 대기 만료 — **0 은 살려 둔다**("만료 없음" 이라는 답이다). 위만 하루로 자른다.
        self.approval_ttl_minutes = self
            .approval_ttl_minutes
            .clamp(MIN_APPROVAL_TTL_MINUTES, MAX_APPROVAL_TTL_MINUTES);
        // 감사 보관 일수 — **0 은 살려 둔다**("지우지 않음" 이라는 답이다). 위만 10년으로 자른다.
        self.audit_retention_days = self.audit_retention_days.min(MAX_AUDIT_RETENTION_DAYS);

        let mut seen = std::collections::HashSet::new();
        let mut cleaned = Vec::new();
        for p in std::mem::take(&mut self.allow_patterns) {
            let t = p.trim();
            if t.is_empty() {
                continue;
            }
            if seen.insert(t.to_string()) {
                cleaned.push(t.to_string());
            }
        }
        self.allow_patterns = cleaned;

        // 묶음 id — 패턴과 같은 규칙(공백 제거·빈 값 버림·중복 제거, 순서 보존)이되 **모르는
        // id 는 버리지 않는다**: 새 버전의 묶음을 켜 둔 파일을 옛 버전이 저장해도 값이 살아
        // 있어야 한다(해석만 안 하고 보존한다 — `automation_presets::expand_bundles`).
        let mut seen_bundles = std::collections::HashSet::new();
        let mut cleaned_bundles = Vec::new();
        for b in std::mem::take(&mut self.bundles) {
            let t = b.trim();
            if t.is_empty() {
                continue;
            }
            if seen_bundles.insert(t.to_string()) {
                cleaned_bundles.push(t.to_string());
            }
        }
        self.bundles = cleaned_bundles;

        // 묶음 안 끈 명령 — 공백 제거·빈 값 버림·중복 제거(순서 보존), 빈 목록은 칸째 버린다. 모르는
        // 묶음·키도 버리지 않는다(좁히기만 하는 칸이라 남아도 넓어지지 않는다).
        let mut cleaned_off = std::collections::BTreeMap::new();
        for (bundle, keys) in std::mem::take(&mut self.bundle_off) {
            let bundle = bundle.trim().to_string();
            if bundle.is_empty() {
                continue;
            }
            let entry: &mut Vec<String> = cleaned_off.entry(bundle).or_default();
            for k in keys {
                let t = k.trim();
                if !t.is_empty() && !entry.iter().any(|e| e == t) {
                    entry.push(t.to_string());
                }
            }
        }
        cleaned_off.retain(|_, keys: &mut Vec<String>| !keys.is_empty());
        self.bundle_off = cleaned_off;
        // 옛 묶음 id(`diag-readonly`·`git-readonly`)를 새 id 로 — 넓어지지 않게 옛 묶음에 없던 명령은 꺼 둔 채로.
        crate::automation_presets::migrate_legacy_bundles(&mut self.bundles, &mut self.bundle_off);

        // 구조적 allowlist(A4b) — exec·서브커맨드·인자 제약 목록의 공백을 떼고, exec 가 빈
        // 규칙과 빈 항목은 버린다. 순서·중복은 매칭 의미가 없어 손대지 않는다. 형식이 틀린
        // `deny_flags` 항목(`-` 로 시작 안 함 등)은 **지우지 않는다** — 지우면 사용자가 적은
        // 금지가 조용히 사라져 규칙이 넓어진다. 판정이 그 규칙을 통째로 꺼 둔다(`policy.rs`).
        fn clean(list: &mut Vec<String>) {
            *list = std::mem::take(list)
                .into_iter()
                .filter_map(|s| {
                    let t = s.trim();
                    if t.is_empty() {
                        None
                    } else {
                        Some(t.to_string())
                    }
                })
                .collect();
        }
        for rule in &mut self.allow {
            rule.exec = rule.exec.trim().to_string();
            clean(&mut rule.subcommands);
            clean(&mut rule.deny_flags);
            clean(&mut rule.allow_flags);
            clean(&mut rule.require_flags);
            clean(&mut rule.first_arg);
        }
        self.allow.retain(|r| !r.exec.is_empty());
    }
}
