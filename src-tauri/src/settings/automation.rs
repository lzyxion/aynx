//! `[automation]` — 자동 승인 정책. 상수의 기본값 · 범위는 프런트 `settings/model/options.ts` 와 같아야 한다.

/// 자동 승인 구조적 allowlist 규칙(`[[automation.allow]]`) — 실행 파일 하나 + 허용 서브커맨드 · 인자 제약. 판정은 `policy.rs` · `policy.ts`.
/// 인자 제약 칸은 전부 선택이고 비면 옛 의미 그대로다(옛 규칙을 몰래 좁히거나 넓히지 않는다) · 빈 칸은 쓰지 않아 옛 파일이 글자 그대로 남는다.
/// 판정은 따옴표를 벗긴 낱말로 한다. `--` 뒤 낱말은 플래그가 아니라 인자다.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AllowRule {
    /// 명령 첫 토큰의 basename 과 정확 · 대소문자 구분 비교.
    pub exec: String,
    /// 비면 서브커맨드 개념이 없다(플래그만이면 통과). 비어 있지 않으면 첫 비플래그 토큰이 이 목록에 있어야 한다.
    #[serde(default)]
    pub subcommands: Vec<String>,
    /// 명령 어디에든 있으면 불허 — `-f` 는 묶인 짧은 플래그도, `--follow` 는 `=…` · 줄임도 잡고 끝의 `*` 는 접두다.
    /// `-` 로 시작하지 않거나 `*` 가 끝이 아닌 항목이 있으면 그 규칙 전체가 매칭되지 않는다(안전한 쪽).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deny_flags: Vec<String>,
    /// 비어 있지 않으면 모든 플래그가 여기 있어야 한다(줄임은 받지 않는다).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow_flags: Vec<String>,
    /// 정확히 있어야 한다 — 값 붙은 꼴(`--no-stream=false`)이 하나라도 있으면 불허.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub require_flags: Vec<String>,
    /// 서브커맨드(없으면 exec) 뒤 첫 비플래그 인자가 없거나 이 중 하나여야 한다(끝의 `*` 는 접두).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub first_arg: Vec<String>,
    /// 서브커맨드(없으면 exec) 뒤 비플래그 인자 수 상한. `Some(0)` = 인자 없이.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_args: Option<u32>,
    /// 서브커맨드가 exec 바로 다음 낱말이어야 한다 — 앞 플래그의 값이 서브커맨드로 위장하는 꼴(`git -C status push`)을 막는다.
    /// 묶음 규칙은 서브커맨드가 있으면 늘 켜진다(`automation_presets` 머리말).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sub_first: bool,
}

/// 자동 승인 정책. 기본은 전부 끔 · 비움이다(알리는 칸 둘만 켬). 판단의 입력일 뿐이고 approve 는 Tauri 명령 전용이다.
/// `max_targets` · `max_concurrency` 는 [`crate::operations::approval::approve_operation`] 진입에서 수동 · 자동 공통으로 강제하는 하드 경계다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AutomationPrefs {
    #[serde(default)]
    pub auto_approve: bool,
    /// 단어 경계 prefix 매칭(`"df"` 는 `df -h` 는 되고 `dfx` 는 아니다).
    #[serde(default)]
    pub allow_patterns: Vec<String>,
    /// 켜 둔 묶음 프리셋 id. 모르는 id 는 지우지 않고 무시한다 — 새 판의 묶음을 켠 파일을 옛 판이 저장해도 잃지 않게.
    #[serde(default)]
    pub bundles: Vec<String>,
    #[serde(default = "default_max_targets")]
    pub max_targets: u32,
    #[serde(default = "default_max_concurrency")]
    pub max_concurrency: u32,
    /// 슬라이딩 창 안의 자동 승인 최대 건수 — 넘으면 사람 승인을 기다린다(무인 루프 방지). 0 은 1 로 올라온다.
    #[serde(default = "default_auto_max_per_window")]
    pub auto_max_per_window: u32,
    /// 초.
    #[serde(default = "default_auto_window_secs")]
    pub auto_window_secs: u32,
    /// 검토 대기 만료(분). `0` = 만료 없음(접지 않는다). `auto_approve` 와 무관하게 돈다.
    #[serde(default = "default_approval_ttl_minutes")]
    pub approval_ttl_minutes: u32,
    #[serde(default = "default_notify_review_requests")]
    pub notify_review_requests: bool,
    /// 끄는 것은 OS 알림뿐이다 — 토스트와 알림 센터 기록은 끄는 칸을 만들지 않는다.
    #[serde(default = "default_notify_operation_results")]
    pub notify_operation_results: bool,
    /// `0` = 지우지 않음. 감사 로그를 끄는 칸이 아니다 — "모든 실행을 기록" 은 불변이다.
    #[serde(default = "default_audit_retention_days")]
    pub audit_retention_days: u32,
    /// 출력 꼬리를 감사 로그에 싣는가 — 원격 출력에 비밀이 섞일 수 있어 옵트인. 켜도 AI 읽기 공유가 꺼진 대상은 싣지 않는다.
    #[serde(default)]
    pub audit_output_excerpt: bool,
    /// 켜면 `|` 로 이은 명령을 단계마다 본다 — 다른 명령을 실행하는 단계는 허용 목록에 있어도 거절한다([`crate::policy::pipe_stage_refused`]).
    /// 정책 칸이라 원격 웹에서 못 바꾼다(`remote/deny.rs`).
    #[serde(default)]
    pub allow_pipes: bool,
    /// 켜 둔 묶음 안에서 끈 명령 — 묶음 id → 명령 키. 좁히기만 한다(모르는 묶음 · 키는 지우지 않고 보존).
    /// 표라 스칼라 칸보다 뒤에 직렬화돼야 한다 — `allow` 바로 앞.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub bundle_off: std::collections::BTreeMap<String, Vec<String>>,
    /// `allow_patterns` 와 OR 로 합쳐진다. 배열-of-테이블이라 맨 아래 필드여야 한다(스칼라보다 뒤에 직렬화).
    #[serde(default)]
    pub allow: Vec<AllowRule>,
}

const DEFAULT_MAX_TARGETS: u32 = 10;
const MIN_MAX_TARGETS: u32 = 1;
const MAX_MAX_TARGETS: u32 = 100;
/// 범위는 작업안 입력 정규화(`create_execution_plan`)도 같이 쓴다.
const DEFAULT_MAX_CONCURRENCY: u32 = 4;
pub(crate) const MIN_MAX_CONCURRENCY: u32 = 1;
pub(crate) const MAX_MAX_CONCURRENCY: u32 = 16;

/// 하한 1 — 자동 승인이 켜지면 늘 유한 상한이 걸린다.
const DEFAULT_AUTO_MAX_PER_WINDOW: u32 = 20;
const MIN_AUTO_MAX_PER_WINDOW: u32 = 1;
const MAX_AUTO_MAX_PER_WINDOW: u32 = 1000;
const DEFAULT_AUTO_WINDOW_SECS: u32 = 300;
const MIN_AUTO_WINDOW_SECS: u32 = 1;
const MAX_AUTO_WINDOW_SECS: u32 = 86_400;

/// 하한 0 은 "너무 짧음" 이 아니라 만료 없음이라는 답이다.
const DEFAULT_APPROVAL_TTL_MINUTES: u32 = 30;
const MIN_APPROVAL_TTL_MINUTES: u32 = 0;
const MAX_APPROVAL_TTL_MINUTES: u32 = 1440;

/// 알리기만 하는 칸이라 기본 켬 — 기본 침묵이 곧 놓침이다.
const DEFAULT_NOTIFY_REVIEW_REQUESTS: bool = true;

const DEFAULT_NOTIFY_OPERATION_RESULTS: bool = true;

/// 하한 0 = 지우지 않음.
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
    /// 이 값과 같으면 파일에 `[automation]` 을 안 쓴다.
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
    pub(super) fn is_default(&self) -> bool {
        *self == AutomationPrefs::default()
    }

    /// 읽기 · 쓰기 양쪽에서 통과시킨다(멱등). 옛 묶음 id 도 여기서 옮긴다.
    pub(crate) fn sanitize(&mut self) {
        self.max_targets = self.max_targets.clamp(MIN_MAX_TARGETS, MAX_MAX_TARGETS);
        self.max_concurrency = self
            .max_concurrency
            .clamp(MIN_MAX_CONCURRENCY, MAX_MAX_CONCURRENCY);
        self.auto_max_per_window = self
            .auto_max_per_window
            .clamp(MIN_AUTO_MAX_PER_WINDOW, MAX_AUTO_MAX_PER_WINDOW);
        self.auto_window_secs = self
            .auto_window_secs
            .clamp(MIN_AUTO_WINDOW_SECS, MAX_AUTO_WINDOW_SECS);
        self.approval_ttl_minutes = self
            .approval_ttl_minutes
            .clamp(MIN_APPROVAL_TTL_MINUTES, MAX_APPROVAL_TTL_MINUTES);
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

        // 모르는 묶음 id 는 버리지 않는다 — 새 판의 묶음을 켠 파일을 옛 판이 저장해도 살아 있어야 한다.
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

        // 모르는 묶음 · 키도 버리지 않는다 — 좁히기만 하는 칸이라 남아도 넓어지지 않는다.
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
        // 옛 묶음 id 를 새 id 로 — 넓어지지 않게 옛 묶음에 없던 명령은 꺼 둔 채로.
        crate::automation_presets::migrate_legacy_bundles(&mut self.bundles, &mut self.bundle_off);

        // 형식이 틀린 `deny_flags` 항목은 지우지 않는다 — 지우면 적은 금지가 사라져 규칙이 넓어진다(판정이 그 규칙을 통째로 끈다).
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
