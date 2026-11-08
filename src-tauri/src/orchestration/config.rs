//! 앨범 구성의 공통 자료형과 입력 검사. 저장소 위임 파일은 읽지 않는다.
use serde::{Deserialize, Serialize};

/// 역할 이름 글자 수 상한.
pub(crate) const ROLES_MAX: usize = 8;
pub(crate) const NAME_MAX: usize = 40;
/// 역할 설명 글자 수 상한.
/// 역할 지침 바이트 상한(4 KiB).
pub(crate) const INSTRUCTIONS_MAX: usize = 4 * 1024;
/// 모델 이름 글자 수 상한.
pub(crate) const MODEL_MAX: usize = 64;
/// 허용 명령 개수 · 한 줄 길이 상한.
pub(crate) const ALLOWED_MAX: usize = 32;
pub(crate) const ALLOWED_LEN_MAX: usize = 200;
/// 필수 판정의 pass 수 상한(설계 2-1 — 1..=3).
pub(crate) const PASSES_MAX: u32 = 3;
/// 되돌림 한도(설계 2-1 — 0..=10 · 기본 3).
pub(crate) const REWORK_MAX: u32 = 10;
pub(crate) const REWORK_DEFAULT: u32 = 3;

/// 받아들인 판 해시 파일 이름(`<데이터 루트>/orchestration/`).
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

/// 역할의 CLI.
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

/// 모델 이름 꼴 — 빈 값(CLI 기본) 또는 `[A-Za-z0-9._:\[\]-]` ≤ 64(설계 2-1 [추측] — 목록 검증은 하지 않는다: CLI 가 거절하면 턴 실패).
pub(crate) fn model_ok(s: &str) -> bool {
    s.chars().count() <= MODEL_MAX
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:[]-".contains(c))
}

/// 추론 강도 — 빈 값(CLI 기본) 또는 CLI 별 값(Claude `--effort` [확인 — `--help` 2.1.301] · Codex `model_reasoning_effort` [추측]).
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

/// 수락 규칙(설계 U7 — 표가 없으면 필수 판정 없음 · 되돌림 기본 3).
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

// ---------------------------------------------------------------------------
// 파일의 날 모양 → 해석(좁은 쪽으로)
// ---------------------------------------------------------------------------

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
