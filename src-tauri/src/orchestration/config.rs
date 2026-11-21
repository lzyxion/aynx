//! 앨범 구성의 공통 자료형과 입력 검사. 저장소 위임 파일은 읽지 않는다.
use serde::{Deserialize, Serialize};

pub(crate) const ROLES_MAX: usize = 8;
pub(crate) const NAME_MAX: usize = 40;
/// 바이트.
pub(crate) const INSTRUCTIONS_MAX: usize = 4 * 1024;
pub(crate) const MODEL_MAX: usize = 64;
pub(crate) const ALLOWED_MAX: usize = 32;
pub(crate) const ALLOWED_LEN_MAX: usize = 200;
pub(crate) const PASSES_MAX: u32 = 3;
pub(crate) const REWORK_MAX: u32 = 10;
pub(crate) const REWORK_DEFAULT: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RoleKind {
    Write,
    Judge,
}

impl RoleKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            RoleKind::Write => "write",
            RoleKind::Judge => "judge",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RoleCli {
    Claude,
    Codex,
}

impl RoleCli {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            RoleCli::Claude => "claude",
            RoleCli::Codex => "codex",
        }
    }
}

/// 꼴만 본다(빈 값 = CLI 기본) — 목록 검증은 하지 않는다(CLI 가 거절하면 턴 실패).
pub(crate) fn model_ok(s: &str) -> bool {
    s.chars().count() <= MODEL_MAX
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:[]-".contains(c))
}

/// 빈 값 = CLI 기본 · Claude `--effort` · Codex `model_reasoning_effort` 의 값(Codex 쪽은 확인 안 됨).
pub(crate) fn effort_ok(cli: RoleCli, s: &str) -> bool {
    match cli {
        RoleCli::Claude => matches!(s, "" | "low" | "medium" | "high" | "xhigh" | "max"),
        RoleCli::Codex => matches!(s, "" | "low" | "medium" | "high" | "xhigh"),
    }
}

/// (파일 키, 기본값, 상한) — 표 하나가 읽기 · 쓰기 · 자르기를 함께 맞춘다.
pub(crate) const LIMIT_TABLE: [(&str, u32, u32); 5] = [
    ("max_concurrent_workers", 3, 3),
    ("max_total_workers", 8, 8),
    ("coordination_minutes", 120, 120),
    ("turn_minutes", 60, 240),
    ("max_reviews", 6, 20),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcceptRule {
    pub role: String,
    pub passes: u32,
}

/// 표가 없으면 필수 판정 없음 · 되돌림 기본 3.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcceptRules {
    pub require: Vec<AcceptRule>,
    pub max_rework: u32,
}

impl Default for AcceptRules {
    fn default() -> Self {
        AcceptRules {
            require: Vec::new(),
            max_rework: REWORK_DEFAULT,
        }
    }
}

pub(crate) fn new_role_id(taken: &[String]) -> String {
    loop {
        let mut b = [0u8; 4];
        if getrandom::fill(&mut b).is_err() {
            let n = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.subsec_nanos() ^ (d.as_secs() as u32));
            b = n.to_le_bytes();
        }
        let id = format!("r-{:02x}{:02x}{:02x}{:02x}", b[0], b[1], b[2], b[3]);
        if !taken.contains(&id) {
            return id;
        }
    }
}
