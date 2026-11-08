//! **수락 전 검증**(통합 설계 4단계 — docs/log/2026-10-15-orchestration-integration-design.md 1절 D3 · D4 · D5 · N2, 5절, 9절 위험 5,
//! 0b 실측, 검토 R1 · R8 · R9 · R10 · R14).
//!
//! 흐름: 통합 후보 커밋 C 가 서면(`accept.rs` 의 `drive_job` → [`Orchestration::after_candidate`]) —
//! - Run 에 검증 명령이 없으면 곧바로 올리기(`commit_job`).
//! - **기본 = 후보마다 사람 확인**: Job `awaiting-approval` + 알림 `verify-approval`. 사람이 보드 [검증 실행](Tauri 명령 →
//!   op `orchestration_approve_verify`)을 누르면 승인은 `{jobId, 후보 C, 명령 해시, 통합 머리 old}` 에 묶인다(하나라도 다르면
//!   `approval-stale` — 다시 확인). 30분이면 `approval-expired` → Task reported.
//! - Run 옵션 '검증 자동 실행'(사람이 시작 대화에서 위험 확인과 함께 켬)이면 확인 없이 곧바로.
//! - 검증([`Orchestration::run_verify`]): Run 전용 검증 worktree(분리 HEAD)에서 `checkout --detach --force C` → `clean -ffdx`(보존 폴더만
//!   `-e`) → 깨끗한지 → **추적 symlink 대상이 자리 안인지**(하나라도 밖이면 그 후보 거절 `symlink-outside` + 사람 알림) →
//!   `cmd.exe /d /s /v:off /c "<사람 글자>"`(잡 선귀속 · 허용 목록 env) → 잡 비움 · 파이프 EOF 확인 → 추적 파일 변경 검사 → 결과.
//!   통과면 올리기, 아니면 Job 거둠 · Task reported · 알림 `verify-failed`(조정자 수락 거절 — `verify-failed`).
//! - 사람 덮어쓰기([`Orchestration::override_verify`]) — **실패한 그 Job** 의 `{후보, 실패 검증 id, 그때 머리}` 에 묶인 새 Job 으로 올린다.
//!   실패 결과는 실패로 남는다.
//!
//! 불변식:
//! - **명령 글자는 사람만**(Run 시작 op — Tauri 대화 하나, `ops.rs` 의 `validate_start`) 정한다. MCP 스키마 · 조정자 · 작업자 인자 어디에도
//!   없고 Run 도중 바꾸는 길도 없다. 실행 글자는 `Run.verify.command` 에서만 온다(시험 `server_spawns_only_turns_and_verify`).
//! - 검증은 **위임된 실행**이다 — 실행 대상 코드(테스트 · scripts)는 작업자 AI 가 바꿀 수 있고 사용자 권한 · 샌드박스 없이 돈다. 그래서
//!   실행은 사람 확인(후보별) 또는 사람이 켠 자동 실행 범위 안에서만. 승인 손은 Tauri 명령뿐(MCP 도구 없음 — AI 자가 승인 금지).
//! - 프로세스: 신뢰된 `GetSystemDirectoryW()\cmd.exe` · `raw_arg` 와 같은 **고정 직렬화**(인자 배열 인용은 거짓 pass — 0b A) · 보간 없음 ·
//!   잡 **생성과 동시에** 귀속(실패면 시작 안 함) · 허용 목록 env(차단 목록 아님) · 출력은 바이트 고리 버퍼(끝 16 KiB) · 시한 하나가
//!   checkout ~ 파이프 배출을 덮는다 · 맏이가 끝나도 잡을 끝내고 활성 0 · EOF 확인 뒤에만 결과(아니면 `stop-unconfirmed`).
//! - OS 를 타는 몸은 `server::os::verify_spawn` 하나(비Windows 는 명시적 스텁 — 저장소 맡기기 폼이 검증 칸을 끈다).
//! - 출력 꼬리 본문은 **메모리만**(`Slot.verify_tails`) — 영속 · 감사에는 바이트 수 · 해시만. 꼬리는 조정자(모델 제공자)와 보드에 간다.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::git::{child_env, hex40, Git};
use super::integrate::{abort_job_in, refs, run_base, TxOutcome};
use super::merge::RefOp;
use super::model::*;
use super::report::{acceptable, review_target};
use super::store::{
    human_detail, human_slot, not_found_run, on_hold, reason, revoke_run, settle_stopping, state_error, OrchError,
    Orchestration, Slot,
};
use crate::audit::OrchestrationAudit;
use crate::server::{log, os};

/// 명령 글자 상한(글자 수).
pub(crate) const COMMAND_MAX: usize = 1000;
/// 시한 기본 · 상한(분).
pub(crate) const TIMEOUT_DEFAULT_MINUTES: u32 = 10;
pub(crate) const TIMEOUT_MAX_MINUTES: u32 = 60;
/// 사람 확인 대기 시한.
pub(crate) const APPROVAL_TTL_MS: u64 = 30 * 60 * 1000;
/// 같은 보고당 검증 횟수(첫 + 재 2 — R14).
pub(crate) const VERIFY_PER_REPORT: usize = 3;
/// Run 당 검증 횟수.
pub(crate) const VERIFY_PER_RUN: usize = 50;
/// 서버 전체 동시 검증.
const SERVER_VERIFY_MAX: usize = 2;
/// 출력 고리 버퍼(바이트 — 개행 없는 출력도 이 단위로 자른다).
pub(crate) const RING_BYTES: usize = 16 * 1024;
/// 조정자 · 보드에 보이는 꼬리(바이트).
pub(crate) const TAIL_VIEW_BYTES: usize = 8 * 1024;
/// 잡 비움 · 파이프 EOF 확인의 상한.
const STOP_CONFIRM: Duration = Duration::from_secs(5);
const KEEP_MAX: usize = 8;
const KEY_FILES_MAX: usize = 8;
const EXTRA_ENV_MAX: usize = 16;
const REL_MAX: usize = 200;

/// 허용 목록 판(결과의 `envPolicy` 머리).
const ENV_POLICY: &str = "allow-v1";

/// 허용 목록 환경(통합 설계 5-3 — 차단 목록이 아니다). 깨지는 최소는 `PATH` 하나고, 나머지는 도구가 캐시 · 설정 · 임시를 **어디에** 쓰는지를
/// 정한다(0b C — `LOCALAPPDATA` 가 빠지면 npm 이 홈에 캐시를 새로 만든다). `ComSpec` · `TEMP` · `TMP` · `CI` 는 서버가 따로 정한다.
pub(crate) const ENV_ALLOW: &[&str] = &[
    "SystemRoot",
    "SystemDrive",
    "windir",
    "PATH",
    "PATHEXT",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "CommonProgramFiles",
    "CommonProgramFiles(x86)",
    "CommonProgramW6432",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
    "USERNAME",
];

/// 서버가 값을 정하는 이름 — 추가 이름으로 받지 않는다.
const ENV_SERVER_SET: &[&str] = &["ComSpec", "TEMP", "TMP", "CI"];

// ---------------------------------------------------------------------------
// 검증 칸의 입력 — 순수
// ---------------------------------------------------------------------------

/// 검증 칸 — 저장소 맡기기(`delegation::repo`)가 이 꼴로 넘기고 `start_run` 이 Run 사본을 만들 때 쓴다(3차 6단계에 사람의 시작 대화 op 는 걷었다).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyInput {
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub timeout_minutes: Option<u32>,
    #[serde(default)]
    #[serde(alias = "auto")]
    pub auto_run: bool,
    #[serde(default)]
    pub keep_dirs: Vec<String>,
    #[serde(default)]
    pub cache_key_files: Vec<String>,
    #[serde(default)]
    #[serde(alias = "extraEnv")]
    pub extra_env_names: Vec<String>,
}

fn invalid(msg: impl Into<String>) -> OrchError {
    OrchError::new(reason::INVALID_ARGUMENT, msg)
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let d = Sha256::digest(bytes);
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// 저장소 안 상대 경로 하나(보존 폴더 · 캐시 키 파일) — `/` 로 편다. 절대 · 드라이브 · `..` · `.` · 빈 낱말 · 와일드카드 · `.git` 거절.
fn rel_path(s: &str, what: &str) -> Result<String, OrchError> {
    let t = s.trim().replace('\\', "/");
    let t = t.trim_end_matches('/').to_string();
    let bad = t.is_empty()
        || t.chars().count() > REL_MAX
        || t.starts_with('/')
        || t.contains(':')
        || t.chars().any(|c| c.is_control() || "*?[]!#\"<>|".contains(c))
        || t.split('/').any(|p| p.is_empty() || p == "." || p == ".." || p.eq_ignore_ascii_case(".git"));
    if bad {
        return Err(invalid(format!("{what} must be relative paths inside the repository (no .., no wildcards): {t}")));
    }
    Ok(t)
}

fn env_name_ok(n: &str) -> bool {
    let mut cs = n.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && n.len() <= 64
}

/// 시작 대화의 검증 칸 검사(사람의 Run 시작 op 만 부른다). 명령이 비면 `None`(검증 없음). 자동 실행은 위험 확인(`confirmed_risk`)이
/// 없으면 `risk-not-confirmed`. 이 OS 가 검증을 못 돌리면 `verify-unsupported`.
pub(crate) fn validate_input(input: VerifyInput, confirmed_risk: bool) -> Result<Option<VerifyConfig>, OrchError> {
    let command = input.command.trim().to_string();
    if command.is_empty() {
        return Ok(None);
    }
    if !os::verify_supported() {
        return Err(OrchError::new(reason::VERIFY_UNSUPPORTED, "verification is not supported on this OS"));
    }
    if command.chars().any(|c| c == '\r' || c == '\n' || c == '\0') {
        return Err(invalid("the verify command must be one line"));
    }
    if command.chars().count() > COMMAND_MAX {
        return Err(invalid(format!("the verify command must be at most {COMMAND_MAX} characters")));
    }
    if input.auto_run && !confirmed_risk {
        return Err(OrchError::new(
            reason::RISK_NOT_CONFIRMED,
            "running the verification automatically needs the risk confirmation",
        ));
    }
    let timeout_minutes = input
        .timeout_minutes
        .unwrap_or(TIMEOUT_DEFAULT_MINUTES)
        .clamp(1, TIMEOUT_MAX_MINUTES);
    let mut keep_dirs: Vec<String> = Vec::new();
    for k in &input.keep_dirs {
        if k.trim().is_empty() {
            continue;
        }
        let p = rel_path(k, "keepDirs")?;
        if !keep_dirs.iter().any(|x| x.eq_ignore_ascii_case(&p)) {
            keep_dirs.push(p);
        }
    }
    let mut cache_key_files: Vec<String> = Vec::new();
    for k in &input.cache_key_files {
        if k.trim().is_empty() {
            continue;
        }
        let p = rel_path(k, "cacheKeyFiles")?;
        if !cache_key_files.iter().any(|x| x.eq_ignore_ascii_case(&p)) {
            cache_key_files.push(p);
        }
    }
    if keep_dirs.len() > KEEP_MAX || cache_key_files.len() > KEY_FILES_MAX {
        return Err(invalid(format!("at most {KEEP_MAX} kept folders and {KEY_FILES_MAX} cache key files")));
    }
    let mut extra_env_names: Vec<String> = Vec::new();
    for n in &input.extra_env_names {
        let n = n.trim();
        if n.is_empty() {
            continue;
        }
        let up = n.to_ascii_uppercase();
        if !env_name_ok(n)
            || up.starts_with("AYNX")
            || up.starts_with("GIT_")
            || ENV_SERVER_SET.iter().any(|s| s.eq_ignore_ascii_case(n))
        {
            return Err(invalid(format!("environment variable name not allowed: {n}")));
        }
        if !extra_env_names.iter().any(|x| x.eq_ignore_ascii_case(n)) && !ENV_ALLOW.iter().any(|x| x.eq_ignore_ascii_case(n)) {
            extra_env_names.push(n.to_string());
        }
    }
    if extra_env_names.len() > EXTRA_ENV_MAX {
        return Err(invalid(format!("at most {EXTRA_ENV_MAX} extra environment variable names")));
    }
    Ok(Some(VerifyConfig {
        command_sha: sha256_hex(command.as_bytes()),
        command,
        timeout_minutes,
        auto_run: input.auto_run,
        keep_dirs,
        cache_key_files,
        extra_env_names,
    }))
}

// ---------------------------------------------------------------------------
// 명령 줄 · 환경 — 순수
// ---------------------------------------------------------------------------

/// **고정 직렬화**(0b A) — `"<cmd.exe>" /d /s /v:off /c "<사람 글자>"`. `/d` AutoRun 끔 · `/v:off` 지연 확장 끔 · `/s` = 바깥 따옴표 한 쌍만
/// 걷는다. Rust 인자 배열의 일반 인용(`\"` 넣기 · 끝 역슬래시 겹치기)을 쓰지 않는다 — 그것은 `node -e "process.exit(7)"` 를 0 으로 만든다.
pub(crate) fn cmd_line(cmd_exe: &str, command: &str) -> String {
    format!("\"{cmd_exe}\" /d /s /v:off /c \"{command}\"")
}

/// 허용 목록 환경 — 서버 환경에서 [`ENV_ALLOW`] + 사람이 고른 추가 이름(대소문자 무시)만 옮기고, `ComSpec`(= 신뢰된 cmd) · `TEMP`/`TMP`
/// (= Run 전용 임시 폴더) · `CI=1` 을 서버가 정한다. 순수.
pub(crate) fn build_env(
    vars: impl IntoIterator<Item = (OsString, OsString)>,
    extra: &[String],
    comspec: &str,
    temp: &Path,
) -> Vec<(String, String)> {
    let vars: Vec<(String, String)> = vars
        .into_iter()
        .map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned()))
        .collect();
    let mut out: Vec<(String, String)> = Vec::new();
    for name in ENV_ALLOW.iter().copied().chain(extra.iter().map(String::as_str)) {
        if ENV_SERVER_SET.iter().any(|s| s.eq_ignore_ascii_case(name)) || out.iter().any(|(k, _)| k.eq_ignore_ascii_case(name)) {
            continue;
        }
        if let Some((k, v)) = vars.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)) {
            out.push((k.clone(), v.clone()));
        }
    }
    let temp = temp.to_string_lossy().into_owned();
    out.push(("ComSpec".into(), comspec.to_string()));
    out.push(("TEMP".into(), temp.clone()));
    out.push(("TMP".into(), temp));
    out.push(("CI".into(), "1".into()));
    out
}

/// 환경 정책 표지 — 허용 목록 판 + 추가 이름(정렬 · 대문자)의 해시 앞 16.
pub(crate) fn env_policy(extra: &[String]) -> String {
    let mut names: Vec<String> = extra.iter().map(|n| n.to_ascii_uppercase()).collect();
    names.sort();
    let h = sha256_hex(names.join("\n").as_bytes());
    format!("{ENV_POLICY}:{}", &h[..16])
}

// ---------------------------------------------------------------------------
// 출력 — 바이트 고리 버퍼 · 꼬리
// ---------------------------------------------------------------------------

/// stdout · stderr 두 펌프가 함께 쓰는 고리 버퍼(끝 [`RING_BYTES`] 바이트) + 총 바이트.
#[derive(Default)]
pub(crate) struct Ring {
    buf: Vec<u8>,
    total: u64,
}

impl Ring {
    pub(crate) fn push(&mut self, b: &[u8]) {
        self.total += b.len() as u64;
        if b.len() >= RING_BYTES {
            self.buf.clear();
            self.buf.extend_from_slice(&b[b.len() - RING_BYTES..]);
            return;
        }
        self.buf.extend_from_slice(b);
        if self.buf.len() > RING_BYTES {
            let over = self.buf.len() - RING_BYTES;
            self.buf.drain(..over);
        }
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.buf
    }

    pub(crate) fn total(&self) -> u64 {
        self.total
    }
}

/// 보기용 꼬리 — 끝 [`TAIL_VIEW_BYTES`] 바이트를 손실 허용으로 읽고(cmd 내장은 ANSI 코드 페이지 · node 류는 UTF-8 — 0b A) 제어 문자를 걷는다
/// (TAB · LF 만 남김). 순수.
pub(crate) fn tail_view(bytes: &[u8]) -> String {
    let start = bytes.len().saturating_sub(TAIL_VIEW_BYTES);
    String::from_utf8_lossy(&bytes[start..])
        .chars()
        .filter(|c| !c.is_control() || *c == '\t' || *c == '\n')
        .collect()
}

// ---------------------------------------------------------------------------
// symlink 밖 검사 — 순수
// ---------------------------------------------------------------------------

/// 추적 symlink 하나(`rel` = 자리 기준 상대 경로 `/` 구분)의 대상이 자리 **밖**인가 — 글자로만 편다(대상이 없어도 판정한다). 절대 경로 ·
/// 드라이브 · 루트로 시작하면 밖, `..` 가 자리 위로 올라가면 밖.
pub(crate) fn link_outside(rel: &str, target: &Path) -> bool {
    let mut stack: Vec<String> = rel.split('/').filter(|p| !p.is_empty()).map(str::to_string).collect();
    stack.pop(); // 링크 자신 — 대상은 링크가 든 폴더 기준이다.
    for c in target.components() {
        match c {
            Component::Prefix(_) | Component::RootDir => return true,
            Component::CurDir => {}
            Component::ParentDir => {
                if stack.pop().is_none() {
                    return true;
                }
            }
            Component::Normal(n) => stack.push(n.to_string_lossy().into_owned()),
        }
    }
    false
}

/// `git ls-files -s -z` 의 출력에서 symlink(모드 120000) 경로들. 순수.
pub(crate) fn tracked_links(ls: &str) -> Vec<String> {
    ls.split('\0')
        .filter_map(|e| {
            let (meta, path) = e.split_once('\t')?;
            meta.starts_with("120000 ").then(|| path.to_string())
        })
        .collect()
}

/// `git status --porcelain=v2 --ignored -z` 가 "깨끗한가"(보존 폴더 안의 무시된 것만 남았나). 순수.
pub(crate) fn clean_status(status: &str, keep: &[String]) -> bool {
    status.split('\0').filter(|e| !e.is_empty()).all(|e| match e.strip_prefix("! ") {
        Some(p) => {
            let p = p.trim_end_matches('/');
            keep.iter().any(|k| {
                let k = k.to_ascii_lowercase();
                let pl = p.to_ascii_lowercase();
                pl == k || pl.starts_with(&format!("{k}/"))
            })
        }
        None => false,
    })
}

// ---------------------------------------------------------------------------
// 프로세스 — 실행 하나
// ---------------------------------------------------------------------------

/// 진행 중 검증의 손잡이 — 중단 · 취소 · 세대 교체가 깃발을 세우면 실행 고리가 잡을 끝낸다.
#[derive(Default)]
pub(crate) struct VerifyCtl {
    cancel: AtomicBool,
    why: Mutex<Option<String>>,
}

impl VerifyCtl {
    /// 취소를 건다(처음 사유만 남는다).
    pub(crate) fn signal(&self, why: &str) {
        let mut w = self.why.lock().unwrap_or_else(|e| e.into_inner());
        if w.is_none() {
            *w = Some(why.to_string());
        }
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub(crate) fn cancelled(&self) -> Option<String> {
        if !self.cancel.load(Ordering::SeqCst) {
            return None;
        }
        self.why.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub(crate) fn flag(&self) -> &AtomicBool {
        &self.cancel
    }
}

/// 실행 하나의 결과.
#[derive(Debug, Clone)]
pub(crate) struct Exec {
    pub exit_code: Option<i64>,
    pub outcome: VerifyOutcome,
    pub reason: Option<String>,
    pub out_bytes: u64,
    /// 고리 버퍼의 끝(바이트).
    pub tail: Vec<u8>,
    /// 잡 비움 · 파이프 EOF 를 확인했다(아니면 `outcome` 이 `stop-unconfirmed`).
    #[cfg_attr(not(test), allow(dead_code))]
    pub confirmed: bool,
    /// 종료를 확인하지 못한 트리의 손잡이(리뷰 F8) — 닫지 않고 넘긴다(Run 이 쥐고 서버 시계가 다시 끝내고 다시 확인한다).
    pub leftover: Option<Leftover>,
}

/// **종료 미확인 검증 트리의 손잡이**(리뷰 F8) — 잡 핸들을 쥔 채 Run(`Slot::verify_leftovers`)에 남는다. 그동안 그 검증은 **살아 있는
/// 자원**이다(`verify_trees` 를 내리지 않는다 — 재검증 · 자리 재사용 · Run 종료 · [Run 완료]가 막힌다). 서버 시계가 [`Leftover::reconfirm`]
/// 으로 다시 끝내고 잡이 비면 내려놓는다. 서버가 끝나면 핸들이 닫혀 잡 안의 것이 끝난다(`KILL_ON_JOB_CLOSE`).
#[derive(Clone)]
pub(crate) struct Leftover(Arc<os::VerifyProc>);

impl std::fmt::Debug for Leftover {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Leftover")
    }
}

impl Leftover {
    /// 시험 — 진짜 검증 프로세스 손잡이로 "종료 미확인" 자리를 만든다.
    #[cfg(test)]
    pub(crate) fn from_proc(p: os::VerifyProc) -> Self {
        Leftover(Arc::new(p))
    }

    /// 잡을 다시 끝내고 비었는지 본다(못 물으면 거짓).
    pub(crate) fn reconfirm(&self) -> bool {
        self.0.terminate();
        self.0.active() == Some(0)
    }
}

impl Exec {
    fn not_started(outcome: VerifyOutcome, why: &str) -> Self {
        Exec {
            exit_code: None,
            outcome,
            reason: Some(why.to_string()),
            out_bytes: 0,
            tail: Vec::new(),
            confirmed: true,
            leftover: None,
        }
    }
}

fn pump(mut f: std::fs::File, ring: Arc<Mutex<Ring>>, done: mpsc::Sender<()>) {
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match f.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => ring.lock().unwrap_or_else(|e| e.into_inner()).push(&buf[..n]),
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => break, // 깨진 파이프 = 쓰는 쪽이 모두 닫혔다(EOF)
            }
        }
        let _ = done.send(());
    });
}

/// 검증 명령 하나를 돌린다 — 블로킹. `deadline` 이 실행 · 배출을 덮는다(넘으면 잡 종료 → `timeout`), `cancel` 이 서면 잡 종료 →
/// `cancelled`. 맏이가 끝나도 **잡을 끝내고**(남은 손자 · 고아) 활성 0 · 두 파이프 EOF 를 확인한 뒤 돌아온다 — 확인이 안 서면
/// `stop-unconfirmed`.
pub(crate) fn execute(command: &str, cwd: &Path, env: &[(String, String)], deadline: Instant, cancel: &AtomicBool) -> Exec {
    let Some(cmd_exe) = os::system_cmd() else {
        return Exec::not_started(VerifyOutcome::SpawnFailed, "cmd");
    };
    let line = cmd_line(&cmd_exe, command);
    let mut proc = match os::verify_spawn(&cmd_exe, &line, cwd, env) {
        Ok(p) => p,
        Err((why, msg)) => {
            log::line(format!("orchestration — verify could not start ({why}): {msg}"));
            return Exec::not_started(VerifyOutcome::SpawnFailed, why);
        }
    };
    let ring = Arc::new(Mutex::new(Ring::default()));
    let (tx, rx) = mpsc::channel::<()>();
    let mut pipes = 0;
    for f in [proc.stdout.take(), proc.stderr.take()].into_iter().flatten() {
        pump(f, ring.clone(), tx.clone());
        pipes += 1;
    }
    drop(tx);
    let mut exit_code = None;
    let mut outcome = loop {
        if cancel.load(Ordering::SeqCst) {
            break VerifyOutcome::Cancelled;
        }
        if Instant::now() >= deadline {
            break VerifyOutcome::Timeout;
        }
        if let Some(c) = proc.wait(50) {
            exit_code = Some(c);
            break if c == 0 { VerifyOutcome::Pass } else { VerifyOutcome::Fail };
        }
    };
    // 잔여 자식 정리 — 맏이가 끝났어도 잡 안의 손자 · 고아를 끝낸다(그들이 파이프를 쥐고 있으면 EOF 가 서지 않는다).
    proc.terminate();
    let until = Instant::now() + STOP_CONFIRM;
    let mut gone = false;
    while Instant::now() < until {
        if proc.active() == Some(0) {
            gone = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut eof = 0;
    while eof < pipes {
        let left = until.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left.max(Duration::from_millis(1))) {
            Ok(()) => eof += 1,
            Err(_) => break,
        }
    }
    let confirmed = gone && eof == pipes;
    let mut reason = None;
    let mut leftover = None;
    if !confirmed {
        reason = Some(outcome.as_str().to_string());
        outcome = VerifyOutcome::StopUnconfirmed;
        // 리뷰 F8 — 손잡이를 닫지 않고 넘긴다(다시 끝내고 다시 확인할 길).
        leftover = Some(Leftover(Arc::new(proc)));
    } else {
        drop(proc);
    }
    let r = ring.lock().unwrap_or_else(|e| e.into_inner());
    Exec {
        exit_code,
        outcome,
        reason,
        out_bytes: r.total(),
        tail: r.bytes().to_vec(),
        confirmed,
        leftover,
    }
}

// ---------------------------------------------------------------------------
// 자리 준비 — 블로킹(git)
// ---------------------------------------------------------------------------

/// 서버 전체 동시 검증 셈.
static RUNNING: AtomicUsize = AtomicUsize::new(0);

struct Permit;

impl Drop for Permit {
    fn drop(&mut self) {
        RUNNING.fetch_sub(1, Ordering::SeqCst);
    }
}

fn permit() -> Option<Permit> {
    let mut cur = RUNNING.load(Ordering::SeqCst);
    loop {
        if cur >= SERVER_VERIFY_MAX {
            return None;
        }
        match RUNNING.compare_exchange(cur, cur + 1, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return Some(Permit),
            Err(v) => cur = v,
        }
    }
}

/// 준비된 자리.
struct Prep {
    dir: PathBuf,
    temp: PathBuf,
    hermetic: bool,
    /// 이번 캐시 키(보존 폴더가 있을 때).
    key: Option<String>,
}

type PrepFail = (VerifyOutcome, String);

fn run8(run_id: &str) -> String {
    run_id.strip_prefix("run-").unwrap_or(run_id).chars().take(8).collect()
}

/// 링크면 링크만 걷고, 폴더면 안의 링크 · 정션을 링크만 걷은 뒤 지운다(대상을 따라가지 않는다 — 노트 저장소 사고와 같은 원리).
pub(super) fn remove_no_follow(p: &Path) -> Result<(), String> {
    let Ok(md) = std::fs::symlink_metadata(p) else { return Ok(()) };
    // 정션도 std 에서는 링크로 보인다(이름 대리 재분석 지점).
    if md.file_type().is_symlink() {
        return std::fs::remove_dir(p).or_else(|_| std::fs::remove_file(p)).map_err(|e| e.to_string());
    }
    if md.is_dir() {
        super::worktree::unlink_links(p, &[])?;
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

fn common_dir(g: &Git) -> Option<String> {
    let o = g.ok(&["rev-parse", "--path-format=absolute", "--git-common-dir"], &[], None).ok()?;
    Some(crate::worktree::comparable(o.trim()))
}

/// 검증 자리를 깨끗한 후보 C 로 맞춘다(통합 설계 5-2) — Run 전용 worktree(분리 HEAD · 훅 끔)를 만들거나 다시 쓰고, 캐시 키가 바뀌었으면
/// 보존 폴더를 지우고, `checkout --detach --force C` · `clean -ffdx`(보존만 `-e`) · 깨끗한지 · 추적 symlink 대상 검사.
#[allow(clippy::too_many_arguments)]
fn prepare(
    repo: &Path,
    wt_dir: &str,
    run_id: &str,
    cfg: &VerifyConfig,
    candidate: &str,
    last_key: Option<&str>,
    deadline: Instant,
    ctl: &VerifyCtl,
    sidecar: Option<&Path>,
) -> Result<Prep, PrepFail> {
    let fail = |o: VerifyOutcome, why: &str| -> PrepFail { (o, why.to_string()) };
    let check = || -> Result<(), PrepFail> {
        if let Some(w) = ctl.cancelled() {
            return Err((VerifyOutcome::Cancelled, w));
        }
        if Instant::now() >= deadline {
            return Err((VerifyOutcome::Timeout, "prepare".into()));
        }
        Ok(())
    };
    if !hex40(candidate) {
        return Err(fail(VerifyOutcome::SpawnFailed, "candidate"));
    }
    let wt_root = PathBuf::from(wt_dir);
    std::fs::create_dir_all(&wt_root).map_err(|_| fail(VerifyOutcome::SpawnFailed, "place"))?;
    let (dir_name, temp_name) = place_names(run_id);
    let dir_asked = wt_root.join(dir_name);
    let temp_asked = wt_root.join(temp_name);
    if !super::worktree::inside(&wt_root, &dir_asked) || !super::worktree::inside(&wt_root, &temp_asked) {
        return Err(fail(VerifyOutcome::SpawnFailed, "place"));
    }
    // 리뷰 F4 — 자리 이름이 링크(정션 · symlink)면 따라가지 않는다: 검증 자리는 거절, 임시 폴더는 링크만 걷는다(대상은 그대로).
    let is_link = |p: &Path| std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink());
    if is_link(&dir_asked) {
        return Err(fail(VerifyOutcome::SpawnFailed, "place"));
    }
    if is_link(&temp_asked) {
        std::fs::remove_dir(&temp_asked)
            .or_else(|_| std::fs::remove_file(&temp_asked))
            .map_err(|_| fail(VerifyOutcome::SpawnFailed, "temp"))?;
    }
    let dir = super::worktree::real_path(&dir_asked).ok_or_else(|| fail(VerifyOutcome::SpawnFailed, "place"))?;
    let temp = super::worktree::real_path(&temp_asked).ok_or_else(|| fail(VerifyOutcome::SpawnFailed, "place"))?;
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let rg = Git::new(repo, &hooks, &env, reason::VERIFY_FAILED).map_err(|_| fail(VerifyOutcome::SpawnFailed, "git"))?;
    check()?;
    // 리뷰 F2 — checkout 이 smudge · process 필터(LFS 포함)를 검증 잡 밖 · 서버 권한으로 돌리지 않게, **꺼낼 후보 트리 전체**에 필터가
    // 걸리면 실행 전에 거절한다(바뀐 경로만 본 통합 검사로는 그대로인 필터 파일을 못 잡는다 — 속성 출처 = 후보). 못 읽어도 거절.
    match super::git::tree_has_filters(&rg, candidate, &[candidate]) {
        Ok(false) => {}
        Ok(true) => return Err(fail(VerifyOutcome::SpawnFailed, reason::FILTERS_CONFIGURED)),
        Err(e) => {
            log::line(format!("orchestration — {run_id}: verify filter check failed: {}", e.message));
            return Err(fail(VerifyOutcome::SpawnFailed, reason::FILTERS_CONFIGURED));
        }
    }
    check()?;
    if std::fs::symlink_metadata(&dir).is_err() {
        let d = dir.to_string_lossy().into_owned();
        rg.ok(&["worktree", "add", "--force", "--detach", &d, candidate], &[], None).map_err(|e| {
            log::line(format!("orchestration — {run_id}: verify worktree add failed: {}", e.message));
            fail(VerifyOutcome::SpawnFailed, "checkout")
        })?;
        // 소유 기록(통합 설계 6-2 — 곁 파일 `role: verify`) — 폐기 정책이 이 줄로 "이 Run 의 서버 임시 자리" 를 안다.
        if let Some(side) = sidecar {
            if let Err(e) = crate::worktree::record_server_place(side, &d, repo, run_id, super::cleanup::ROLE_VERIFY) {
                log::line(format!("orchestration — {run_id}: worktrees.json not written for the verify folder: {e}"));
            }
        }
    }
    let vg = Git::new(&dir, &hooks, &env, reason::VERIFY_FAILED).map_err(|_| fail(VerifyOutcome::SpawnFailed, "git"))?;
    // 우리 자리인가 — 같은 저장소의 worktree 여야 한다(다른 폴더에서 checkout · clean 을 돌리지 않는다).
    if !dir.join(".git").is_file() || common_dir(&vg).is_none() || common_dir(&vg) != common_dir(&rg) {
        return Err(fail(VerifyOutcome::SpawnFailed, "place"));
    }
    check()?;
    // 캐시 키(N2) — 바뀌었거나 처음이면 보존 폴더를 지운다.
    let mut key = None;
    if !cfg.keep_dirs.is_empty() {
        let mut k = String::new();
        for f in &cfg.cache_key_files {
            let spec = format!("{candidate}:{f}");
            let o = vg.run(&["rev-parse", "--verify", "--quiet", &spec], &[], None).ok();
            let oid = o.filter(|o| o.ok()).map(|o| o.stdout.trim().to_string()).unwrap_or_else(|| "-".into());
            k.push_str(&format!("{f}={oid}\n"));
        }
        if last_key != Some(k.as_str()) {
            for d in &cfg.keep_dirs {
                let p = dir.join(d);
                if !super::worktree::inside(&dir, &p) && std::fs::symlink_metadata(&p).is_ok() {
                    // 보존 폴더 자리가 링크로 밖을 가리킨다 — 링크만 걷는다.
                    let _ = std::fs::remove_dir(&p).or_else(|_| std::fs::remove_file(&p));
                    continue;
                }
                if let Err(e) = remove_no_follow(&p) {
                    log::line(format!("orchestration — {run_id}: could not reset a kept folder: {e}"));
                    return Err(fail(VerifyOutcome::SpawnFailed, "not-clean"));
                }
            }
        }
        key = Some(k);
    }
    check()?;
    vg.ok(&["checkout", "--detach", "--force", candidate], &[], None)
        .map_err(|_| fail(VerifyOutcome::SpawnFailed, "checkout"))?;
    check()?;
    let mut clean: Vec<String> = vec!["clean".into(), "-ffdx".into()];
    for k in &cfg.keep_dirs {
        clean.push("-e".into());
        clean.push(format!("/{k}"));
    }
    let clean_args: Vec<&str> = clean.iter().map(String::as_str).collect();
    vg.ok(&clean_args, &[], None).map_err(|_| fail(VerifyOutcome::SpawnFailed, "not-clean"))?;
    check()?;
    let st = vg
        .ok(&["status", "--porcelain=v2", "--ignored", "-z"], &[], None)
        .map_err(|_| fail(VerifyOutcome::SpawnFailed, "not-clean"))?;
    if !clean_status(&st, &cfg.keep_dirs) {
        return Err(fail(VerifyOutcome::SpawnFailed, "not-clean"));
    }
    // 추적 symlink 의 대상(9절 위험 5 확정) — 하나라도 자리 밖이면 이 후보의 검증을 거절한다. 못 읽은 링크도 밖으로 본다(보수적).
    let ls = vg.ok(&["ls-files", "-s", "-z"], &[], None).map_err(|_| fail(VerifyOutcome::SpawnFailed, "git"))?;
    for rel in tracked_links(&ls) {
        let full = dir.join(&rel);
        let Ok(md) = std::fs::symlink_metadata(&full) else { continue };
        if !md.file_type().is_symlink() {
            continue; // core.symlinks=false — 대상 글자를 담은 보통 파일이다(따라갈 링크가 아니다).
        }
        let outside = match std::fs::read_link(&full) {
            Ok(t) => link_outside(&rel, &t),
            Err(_) => true,
        };
        if outside {
            return Err(fail(VerifyOutcome::SymlinkOutside, "symlink-outside"));
        }
    }
    // Run 전용 임시 폴더(TEMP · TMP) — 매번 비운다.
    if let Err(e) = remove_no_follow(&temp) {
        log::line(format!("orchestration — {run_id}: could not reset the verify temp folder: {e}"));
    }
    std::fs::create_dir_all(&temp).map_err(|_| fail(VerifyOutcome::SpawnFailed, "temp"))?;
    // 소유 기록(리뷰 F4) — 폐기 정책은 이름만이 아니라 이 줄(`role: temp`)이 있어야 이 폴더를 지운다.
    if let Some(side) = sidecar {
        let t = temp.to_string_lossy();
        if let Err(e) = crate::worktree::record_server_place(side, &t, repo, run_id, super::cleanup::ROLE_TEMP) {
            log::line(format!("orchestration — {run_id}: worktrees.json not written for the verify temp folder: {e}"));
        }
    }
    check()?;
    Ok(Prep {
        dir,
        temp,
        hermetic: cfg.keep_dirs.is_empty(),
        key,
    })
}

/// Run 전용 검증 자리 · 임시 폴더의 이름(`orch-<run8>-verify` · `orch-<run8>-tmp` — Run 자리 바로 아래). 폐기 정책(`cleanup.rs`)이 같은 이름을 쓴다.
pub(super) fn place_names(run_id: &str) -> (String, String) {
    let r8 = run8(run_id);
    (format!("orch-{r8}-verify"), format!("orch-{r8}-tmp"))
}

/// 검증 Job 끝마다 **쉬는 상태**(통합 설계 6-2) — `checkout --detach --force <C>` + `clean -ffdx`(보존 폴더만 `-e`). 폐기 정책은 이 상태와
/// 비교해 "예상 밖 변경" 을 가른다. 최선이다(실패는 로그 — 다음 Job 의 `prepare` 가 어차피 다시 맞추고, 폐기는 비교가 어긋나면 남긴다).
/// 우리 자리(같은 저장소의 worktree · Run 자리 안)일 때만 손댄다. 블로킹(git).
fn rest(repo: &Path, wt_dir: &str, run_id: &str, cfg: &VerifyConfig, candidate: &str) {
    if !hex40(candidate) {
        return;
    }
    let asked = PathBuf::from(wt_dir).join(place_names(run_id).0);
    // 리뷰 F4 — 자리 이름이 링크면 따라가 checkout · clean 하지 않는다.
    let link = std::fs::symlink_metadata(&asked).is_ok_and(|m| m.file_type().is_symlink());
    if link || !asked.join(".git").is_file() {
        return;
    }
    let Some(dir) = super::worktree::real_path(&asked) else { return };
    if !super::worktree::inside(Path::new(wt_dir), &dir) {
        return;
    }
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let (Ok(rg), Ok(vg)) = (
        Git::new(repo, &hooks, &env, reason::VERIFY_FAILED),
        Git::new(&dir, &hooks, &env, reason::VERIFY_FAILED),
    ) else {
        return;
    };
    if common_dir(&vg).is_none() || common_dir(&vg) != common_dir(&rg) {
        return;
    }
    let mut clean: Vec<String> = vec!["clean".into(), "-ffdx".into()];
    for k in &cfg.keep_dirs {
        clean.push("-e".into());
        clean.push(format!("/{k}"));
    }
    let clean_args: Vec<&str> = clean.iter().map(String::as_str).collect();
    let r = vg
        .ok(&["checkout", "--detach", "--force", candidate], &[], None)
        .and_then(|_| vg.ok(&clean_args, &[], None));
    if let Err(e) = r {
        log::line(format!("orchestration — {run_id}: the verify folder could not be put back to rest: {}", e.message));
    }
}

/// 끝난 뒤 검사한 것이 승인 후보 그대로가 아닌가(통합 설계 5-2 · 리뷰 F5) — **HEAD 가 후보 `candidate` 이고 index 가 그 트리와 같고**
/// 작업 트리의 추적 파일이 index 와 같아야 거짓. 명령이 `reset` · 새 커밋 · `checkout` 으로 다른 커밋을 검사하게 만들었거나 index 를
/// 바꿨으면 참. 읽지 못해도 참(보수적).
fn tracked_modified(dir: &Path, candidate: &str) -> bool {
    let env = child_env(std::env::vars_os());
    let hooks = super::worktree::empty_hooks_dir();
    let Ok(g) = Git::new(dir, &hooks, &env, reason::VERIFY_FAILED) else { return true };
    let head = g.ok(&["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], &[], None).ok();
    if head.as_deref().map(str::trim) != Some(candidate) {
        return true;
    }
    // index ↔ 후보 트리(작업 트리를 보지 않는다 — `--cached`). 끝 코드 0 = 같다 · 1 = 다르다.
    match g.run(&["diff-index", "--cached", "--quiet", "--no-ext-diff", candidate, "--"], &[], None) {
        Ok(o) if o.code == Some(0) => {}
        _ => return true,
    }
    match g.ok(&["status", "--porcelain=v2", "--untracked-files=no", "-z"], &[], None) {
        Ok(s) => !s.trim_matches('\0').trim().is_empty(),
        Err(_) => true,
    }
}

// ---------------------------------------------------------------------------
// 잠금 안의 조각
// ---------------------------------------------------------------------------

/// 올리기 관문(`commit_job` 이 잠금 안에서) — Run 에 검증이 있으면 **이 후보 · 이 명령 해시 · 이 머리**에 묶인 통과 결과, 또는 실패한 Job 에
/// 묶인 사람 덮어쓰기가 있어야 한다. 없으면 그 까닭 낱말.
pub(super) fn commit_gate(run: &Run, job: &IntegrationJob) -> Option<&'static str> {
    let cfg = run.verify.as_ref()?;
    if let Some(o) = &job.override_ {
        return (Some(&o.candidate) == job.candidate.as_ref() && Some(&o.old) == job.old.as_ref())
            .then_some(())
            .map_or(Some("verify-required"), |_| None);
    }
    let bound = match (&job.verify, &job.approval) {
        (Some(v), Some(a)) => {
            v.outcome == VerifyOutcome::Pass
                && Some(&v.candidate) == job.candidate.as_ref()
                && v.command_sha == cfg.command_sha
                && a.candidate == v.candidate
                && a.command_sha == cfg.command_sha
                && Some(&a.old) == job.old.as_ref()
        }
        _ => false,
    };
    (!bound).then_some("verify-required")
}

/// 같은 보고로 이미 돈 검증 수(허락이 선 Job — 재검증 한도 R14).
pub(super) fn verifies_of_report(run: &Run, report_id: &str) -> usize {
    run.jobs.iter().filter(|j| j.report_id == report_id && j.approval.is_some()).count()
}

/// 수락 관문 보탬(`integrate::begin_in`) — 검증이 있는 Run 에서 같은 보고의 검증을 다 썼으면 `verify-failed`, Run 한도면 `verify-limit`.
pub(super) fn begin_gate(run: &Run, report_id: &str) -> Result<(), OrchError> {
    if run.verify.is_none() {
        return Ok(());
    }
    if verifies_of_report(run, report_id) >= VERIFY_PER_REPORT {
        return Err(OrchError::new(
            reason::VERIFY_FAILED,
            format!(
                "this report was already verified {VERIFY_PER_REPORT} times without passing — reject it and start a new attempt"
            ),
        ));
    }
    if run.jobs.iter().filter(|j| j.approval.is_some()).count() >= VERIFY_PER_RUN {
        return Err(OrchError::new(
            reason::VERIFY_LIMIT,
            format!("this run already ran {VERIFY_PER_RUN} verifications"),
        ));
    }
    Ok(())
}

/// `candidate` → `verifying`(잠금 안) — 허락을 묶고 손잡이를 세운다. Run 한도면 `Err`.
fn begin_verifying_in(slot: &mut Slot, ji: usize, by: VerifyApprover, now: u64) -> Result<Arc<VerifyCtl>, OrchError> {
    let Some(cfg) = slot.run.verify.clone() else {
        return Err(OrchError::new(reason::INVALID_STATE, "this run has no verification"));
    };
    if !slot.verify_leftovers.is_empty() {
        // 리뷰 F8 — 종료를 확인하지 못한 앞 검증이 같은 자리를 아직 쓸 수 있다(checkout · clean 하지 않는다).
        return Err(OrchError::new(
            reason::VERIFY_FAILED,
            "the previous verification's process tree is not confirmed ended yet — try again later",
        ));
    }
    if slot.run.jobs.iter().filter(|j| j.approval.is_some()).count() >= VERIFY_PER_RUN {
        return Err(OrchError::new(
            reason::VERIFY_LIMIT,
            format!("this run already ran {VERIFY_PER_RUN} verifications"),
        ));
    }
    let job = &mut slot.run.jobs[ji];
    let (Some(candidate), Some(old)) = (job.candidate.clone(), job.old.clone()) else {
        return Err(OrchError::new(reason::INVALID_STATE, "the integration job has no candidate"));
    };
    job.phase = JobPhase::Verifying;
    job.approval = Some(VerifyApproval {
        by,
        candidate,
        command_sha: cfg.command_sha,
        old,
        at: now,
    });
    let (job_id, task_id) = (job.job_id.clone(), job.task_id.clone());
    let ctl = Arc::new(VerifyCtl::default());
    slot.verify_runs.insert(job_id.clone(), ctl.clone());
    slot.verify_trees += 1;
    slot.run.bump(now, Actor::Server, "verify_started", Some(&task_id), by.as_str());
    Ok(ctl)
}

/// 종료 미확인 검증 트리를 다시 끝내고 다시 확인한다(서버 시계 — 잠금 안, 리뷰 F8). 확인된 것은 내려놓고 `verify_trees` 를 내린다.
/// 하나라도 내려놓았으면 참(부른 쪽이 `settle_stopping` · 알림).
pub(super) fn reconfirm_leftovers(slot: &mut Slot) -> bool {
    if slot.verify_leftovers.is_empty() {
        return false;
    }
    let before = slot.verify_leftovers.len();
    slot.verify_leftovers.retain(|(_, l)| !l.reconfirm());
    let freed = before - slot.verify_leftovers.len();
    slot.verify_trees = slot.verify_trees.saturating_sub(freed as u32);
    if slot.verify_leftovers.is_empty() {
        slot.verify_unconfirmed = false;
    }
    freed > 0
}

/// 사람 확인 대기 시한이 지난 Job 을 거둔다(서버 시계 — 잠금 안). 거둔 Job 의 Attempt id(알림용).
pub(super) fn approval_timeouts(slot: &mut Slot, now: u64) -> Vec<String> {
    let idx: Vec<usize> = slot
        .run
        .jobs
        .iter()
        .enumerate()
        .filter(|(_, j)| j.phase == JobPhase::AwaitingApproval && j.awaiting_at.is_some_and(|t| now >= t + APPROVAL_TTL_MS))
        .map(|(i, _)| i)
        .collect();
    idx.into_iter()
        .map(|i| {
            abort_job_in(slot, i, now, Actor::Server, reason::APPROVAL_EXPIRED);
            slot.run.jobs[i].attempt_id.clone()
        })
        .collect()
}

/// 취소 · 중단 · 세대 교체가 검증 중인 Job 을 만났다 — 손잡이가 있으면 깃발만 세우고(트리 종료 확인 뒤 실행 쪽이 거둔다) 참.
pub(super) fn signal_cancel(slot: &Slot, job_id: &str, why: &str) -> bool {
    match slot.verify_runs.get(job_id) {
        Some(c) => {
            c.signal(why);
            true
        }
        None => false,
    }
}

/// 보기 — Task 마다 마지막 검증 결과 + 꼬리(메모리 — 끝 8 KiB).
pub(super) fn last_verify_view(slot: &Slot) -> Value {
    let mut out = serde_json::Map::new();
    for j in &slot.run.jobs {
        if let Some(v) = &j.verify {
            out.insert(
                j.task_id.clone(),
                json!({
                    "jobId": j.job_id,
                    "verifyId": v.verify_id,
                    "candidate": v.candidate,
                    "outcome": v.outcome,
                    "reason": v.reason,
                    "exitCode": v.exit_code,
                    "durationMs": v.duration_ms,
                    "outBytes": v.out_bytes,
                    "hermetic": v.hermetic,
                    "approvedBy": v.approved_by,
                    "at": v.at,
                    "tail": slot.verify_tails.get(&j.job_id),
                }),
            );
        }
    }
    Value::Object(out)
}

fn verify_audit(slot: &Slot, job: &IntegrationJob, actor: Actor) -> OrchestrationAudit {
    let task = slot.run.task(&job.task_id);
    OrchestrationAudit {
        gen: slot.run.gen,
        actor: actor.as_str().into(),
        run_state: Some(slot.run.state.as_str().into()),
        task_id: Some(job.task_id.clone()),
        task_version: task.map(|t| t.version),
        task_state: task.map(|t| t.state.as_str().into()),
        attempt_id: Some(job.attempt_id.clone()),
        commit_oid: job.candidate.clone(),
        job_id: Some(job.job_id.clone()),
        command_sha: slot.run.verify.as_ref().map(|c| c.command_sha.clone()),
        approved_by: job.approval.as_ref().map(|a| a.by.as_str().into()),
        ..Default::default()
    }
}

fn job_index(run: &Run, job_id: &str) -> Result<usize, OrchError> {
    run.jobs
        .iter()
        .position(|j| j.job_id == job_id)
        .ok_or_else(|| OrchError::new(reason::NOT_FOUND, format!("no integration job {job_id} in this run")))
}

// ---------------------------------------------------------------------------
// 흐름
// ---------------------------------------------------------------------------

/// 후보 뒤 갈래.
enum Next {
    Commit,
    Verify,
    Wait,
    Stop,
}

impl Orchestration {
    /// 후보가 선 뒤(⑤ — `drive_job` 이 부른다): 검증 없음 → 올리기, 자동 실행 → 검증 → 올리기, 기본 → 사람 확인 대기 + 알림. 블로킹.
    /// **무인 검증 권한을 실행 직전 지금 맡기기로 다시 판정**한다(헤드리스 설계 2-4 · D5 — 명령 글자의 사본 고정과 실행 권한 회수는 별개):
    /// 블록 · 받아들인 판 · 신원(Run 사본과도) · 지금 블록의 검증 명령 해시 = Run 사본 해시 · `verify_confirm` 꺼짐. 하나라도 어긋나면 무인으로
    /// 돌리지 않는다(사람 확인으로 내려간다 — 그 까닭 낱말). **블로킹**(파일 · git) — 잠금 밖에서.
    pub(super) fn unattended_verify_ok(&self, run_id: &str) -> Result<(), &'static str> {
        let inputs = self.run_inputs(run_id);
        let g = self.lock();
        let run = &g.runs.get(run_id).ok_or("not-found")?.run;
        let super::album::RunInputs::Album(i) = &inputs;
        super::album::unattended(run, i).map_err(|e| e.code)
    }

    pub(super) fn after_candidate(&self, run_id: &str, job_id: &str) {
        let now = self.now();
        let mut audits: Vec<(&'static str, OrchestrationAudit)> = Vec::new();
        // 자동 실행 Run 이면 무인 권한을 지금 맡기기로 다시 판정한다(잠금 밖 — 2-4 · D5).
        let wants_auto = self
            .lock()
            .runs
            .get(run_id)
            .and_then(|s| s.run.verify.as_ref().map(|c| s.run.album.as_ref().map_or(c.auto_run, |a| a.verify_auto)))
            .unwrap_or(false);
        let unattended = if wants_auto { self.unattended_verify_ok(run_id) } else { Err("not-auto") };
        let next = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id).filter(|s| s.run.state != RunState::Orphaned) else { return };
            let Ok(ji) = job_index(&slot.run, job_id) else { return };
            if slot.run.jobs[ji].phase != JobPhase::Candidate {
                return;
            }
            let wants_auto = slot.run.verify.as_ref().map(|c| slot.run.album.as_ref().map_or(c.auto_run, |a| a.verify_auto));
            let auto = wants_auto.map(|auto| auto && unattended.is_ok());
            if let (Some(true), Err(why)) = (wants_auto, unattended) {
                // 무인 권한이 거둬졌거나 바뀌었다 — 사람 확인으로(`verify-needs-human{reason}` — 2차 동작).
                let attempt = slot.run.jobs[ji].attempt_id.clone();
                let task_id = slot.run.jobs[ji].task_id.clone();
                slot.run.bump(now, Actor::Server, "verify_needs_human", Some(&task_id), why);
                self.raise(slot, "verify-needs-human", Some(&attempt), Some(why));
            }
            let next = match auto {
                None => Next::Commit,
                Some(true) => match begin_verifying_in(slot, ji, VerifyApprover::Auto, now) {
                    Ok(_) => {
                        audits.push(("verify_started", verify_audit(slot, &slot.run.jobs[ji], Actor::Server)));
                        Next::Verify
                    }
                    Err(e) => {
                        abort_job_in(slot, ji, now, Actor::Server, e.code);
                        self.raise(slot, "verify-failed", Some(&slot.run.jobs[ji].attempt_id), Some(e.code));
                        Next::Stop
                    }
                },
                Some(false) => {
                    let job = &mut slot.run.jobs[ji];
                    job.phase = JobPhase::AwaitingApproval;
                    job.awaiting_at = Some(now);
                    let (task_id, attempt) = (job.task_id.clone(), job.attempt_id.clone());
                    slot.run.bump(now, Actor::Server, "verify_awaiting_approval", Some(&task_id), job_id);
                    self.raise(slot, "verify-approval", Some(&attempt), None);
                    Next::Wait
                }
            };
            self.after_change(&g, run_id);
            next
        };
        for (e, d) in audits {
            self.audit(e, run_id, d);
        }
        match next {
            Next::Commit => {
                if let Err(e) = self.commit_job(run_id, job_id) {
                    log::line(format!("orchestration — {run_id}: integration commit: {e}"));
                }
            }
            Next::Verify => self.verify_then_commit(run_id, job_id),
            Next::Wait | Next::Stop => {}
        }
    }

    /// 검증 → (통과면) 올리기. 블로킹.
    fn verify_then_commit(&self, run_id: &str, job_id: &str) {
        if self.run_verify(run_id, job_id) {
            if let Err(e) = self.commit_job(run_id, job_id) {
                log::line(format!("orchestration — {run_id}: integration commit: {e}"));
            }
        }
    }

    /// 검증을 따로 스레드에서(사람 확인 뒤 — op 를 오래 붙들지 않게). 자기 참조가 없으면(시험) 부른 스레드에서 끝까지.
    fn launch_verify(&self, run_id: &str, job_id: &str) {
        let me = self.me.read().unwrap_or_else(|e| e.into_inner()).upgrade();
        if let Some(me) = me {
            let (r, j) = (run_id.to_string(), job_id.to_string());
            if std::thread::Builder::new()
                .name("orchestration-verify".into())
                .spawn(move || me.verify_then_commit(&r, &j))
                .is_ok()
            {
                return;
            }
        }
        self.verify_then_commit(run_id, job_id);
    }

    /// 검증 하나(`verifying` Job) — 블로킹. 통과 · 취소 없음이면 참(부른 쪽이 올린다). 결과는 장부에 적고, 실패면 Job 을 거둔다.
    pub(super) fn run_verify(&self, run_id: &str, job_id: &str) -> bool {
        // ① 잠금 안 — 재료 · 묶음 재대조(실행 직전 — 5-1).
        let snap = {
            let g = self.lock();
            g.runs.get(run_id).filter(|s| s.run.state != RunState::Orphaned).and_then(|s| {
                let job = s.run.jobs.iter().find(|j| j.job_id == job_id && j.phase == JobPhase::Verifying)?.clone();
                let ctl = s.verify_runs.get(job_id)?.clone();
                let cfg = s.run.verify.clone()?;
                let head = s.run.integration.as_ref()?.expected_head.clone();
                let ap = job.approval.clone()?;
                let bound = Some(&ap.candidate) == job.candidate.as_ref()
                    && ap.command_sha == cfg.command_sha
                    && Some(&ap.old) == job.old.as_ref()
                    && ap.old == head
                    && s.run.hold.is_none();
                Some((
                    PathBuf::from(&s.run.repo),
                    s.run.worktree_dir.clone(),
                    cfg,
                    ap,
                    ctl,
                    s.verify_cache_key.clone(),
                    bound,
                ))
            })
        };
        let Some((repo, wt_dir, cfg, ap, ctl, last_key, bound)) = snap else { return false };
        let unit = self.verify_minute_ms.load(Ordering::Relaxed);
        let started = Instant::now();
        let deadline = started + Duration::from_millis(unit.saturating_mul(u64::from(cfg.timeout_minutes)));
        let mut hermetic = cfg.keep_dirs.is_empty();
        let mut key = None;
        let sidecar = self.sidecar();
        let exec = if !bound {
            Exec::not_started(VerifyOutcome::SpawnFailed, reason::APPROVAL_STALE)
        } else {
            match permit() {
                None => Exec::not_started(VerifyOutcome::SpawnFailed, "server-busy"),
                Some(_permit) => match prepare(
                    &repo,
                    &wt_dir,
                    run_id,
                    &cfg,
                    &ap.candidate,
                    last_key.as_deref(),
                    deadline,
                    &ctl,
                    sidecar.as_deref(),
                ) {
                    Err((o, why)) => Exec::not_started(o, &why),
                    Ok(p) => {
                        hermetic = p.hermetic;
                        key = p.key.clone();
                        let comspec = os::system_cmd().unwrap_or_default();
                        let env = build_env(std::env::vars_os(), &cfg.extra_env_names, &comspec, &p.temp);
                        // 자동 권한이 후보 예약 뒤 거둬질 수 있다. 실행 직전에도 지금 앨범과 신원을 본다.
                        let mut e = match self.album_verify_preflight(run_id, ap.by == VerifyApprover::Auto) {
                            Ok(()) => execute(&cfg.command, &p.dir, &env, deadline, ctl.flag()),
                            Err(why) => Exec::not_started(VerifyOutcome::SpawnFailed, why),
                        };
                        if e.outcome == VerifyOutcome::Pass && tracked_modified(&p.dir, &ap.candidate) {
                            e.outcome = VerifyOutcome::ModifiedTracked;
                        }
                        e
                    }
                },
            }
        };
        // 쉬는 상태로(통합 설계 6-2) — 트리는 이미 끝났다(잡 비움 · EOF 확인 뒤). 자리를 만들지 못했으면 아무것도 안 한다.
        // 트리 종료를 확인하지 못했으면(`stop-unconfirmed`) 손대지 않는다 — 폐기 정책도 그 자리를 "아직 쓰는 중" 으로 본다.
        if bound && exec.outcome != VerifyOutcome::StopUnconfirmed {
            rest(&repo, &wt_dir, run_id, &cfg, &ap.candidate);
        }
        let tail = tail_view(&exec.tail);
        let now = self.now();
        let result = VerifyResult {
            verify_id: new_id("ver").unwrap_or_else(|| format!("ver-{now}")),
            job_id: job_id.to_string(),
            candidate: ap.candidate.clone(),
            command_sha: cfg.command_sha.clone(),
            env_policy: env_policy(&cfg.extra_env_names),
            hermetic,
            exit_code: exec.exit_code,
            outcome: exec.outcome,
            reason: exec.reason.clone(),
            duration_ms: started.elapsed().as_millis() as u64,
            out_bytes: exec.out_bytes,
            tail_sha256: sha256_hex(tail.as_bytes()),
            approved_by: ap.by,
            at: now,
        };
        self.finish_verify(run_id, job_id, result, tail, key, exec.leftover)
    }

    /// 검증 결과를 적는다(잠금 안) — 손잡이를 내리고(트리는 이미 끝났다) 결과 · 꼬리를 남긴다. 통과 · 취소 없음이면 참.
    fn finish_verify(
        &self,
        run_id: &str,
        job_id: &str,
        result: VerifyResult,
        tail: String,
        key: Option<String>,
        leftover: Option<Leftover>,
    ) -> bool {
        let now = self.now();
        let mut audits: Vec<(&'static str, OrchestrationAudit)> = Vec::new();
        let (pass, ended, gen) = {
            let mut g = self.lock();
            let Some(slot) = g.runs.get_mut(run_id) else { return false };
            let ctl = slot.verify_runs.remove(job_id);
            // 리뷰 F8 — 종료를 확인하지 못했으면 트리를 살아 있는 자원으로 남긴다(`verify_trees` 그대로 · 손잡이를 Run 이 쥔다).
            match (ctl.is_some(), leftover) {
                (true, Some(l)) => slot.verify_leftovers.push((job_id.to_string(), l)),
                (true, None) => slot.verify_trees = slot.verify_trees.saturating_sub(1),
                (false, _) => {}
            }
            slot.verify_tails.insert(job_id.to_string(), tail);
            if key.is_some() {
                slot.verify_cache_key = key;
            }
            let Ok(ji) = job_index(&slot.run, job_id) else { return false };
            let outcome = result.outcome;
            if outcome == VerifyOutcome::StopUnconfirmed {
                // 정리(통합 설계 6-2)는 이 서버 수명 동안 검증 자리를 "아직 쓰는 중" 으로 본다(트리가 남았을 수 있다).
                slot.verify_unconfirmed = true;
            }
            let (exit, dur, vid) = (result.exit_code, result.duration_ms, result.verify_id.clone());
            slot.run.jobs[ji].verify = Some(result);
            let task_id = slot.run.jobs[ji].task_id.clone();
            slot.run.bump(now, Actor::Server, "verify_finished", Some(&task_id), outcome.as_str());
            let mut d = verify_audit(slot, &slot.run.jobs[ji], Actor::Server);
            d.verify_id = Some(vid);
            d.exit_code = exit;
            d.duration_ms = Some(dur);
            d.reason = Some(outcome.as_str().into());
            audits.push(("verify_finished", d));
            let cancelled = ctl.and_then(|c| c.cancelled());
            let live = slot.run.jobs[ji].phase == JobPhase::Verifying;
            let pass = outcome == VerifyOutcome::Pass && cancelled.is_none() && live;
            if !pass && slot.run.jobs[ji].phase.cancellable() {
                let why = cancelled.clone().unwrap_or_else(|| format!("{}:{}", reason::VERIFY_FAILED, outcome.as_str()));
                abort_job_in(slot, ji, now, Actor::Server, &why);
                if cancelled.is_none() {
                    let attempt = slot.run.jobs[ji].attempt_id.clone();
                    self.raise(slot, "verify-failed", Some(&attempt), Some(outcome.as_str()));
                }
                let mut d = verify_audit(slot, &slot.run.jobs[ji], Actor::Server);
                d.reason = Some(why);
                audits.push(("integration_aborted", d));
            }
            let ended = settle_stopping(slot, now);
            if ended {
                self.raise(slot, "run-ended", None, Some(RunState::Stopped.as_str()));
            }
            let gen = slot.run.gen;
            if ended {
                revoke_run(&mut g, run_id);
            }
            self.after_change(&g, run_id);
            (pass, ended, gen)
        };
        for (e, d) in audits {
            self.audit(e, run_id, d);
        }
        if ended {
            self.audit(
                "run_ended",
                run_id,
                OrchestrationAudit {
                    actor: Actor::Server.as_str().into(),
                    ..human_detail(gen, RunState::Stopped)
                },
            );
        }
        pass
    }

    /// 사람 [검증 실행](op `orchestration_approve_verify` — Tauri 명령만, MCP 도구 없음). 승인은 `{jobId, candidate, commandSha, old}` 에
    /// 묶인다 — 지금 Job 의 후보 · Run 의 명령 해시 · 서버가 아는 통합 머리 · **실제 통합 ref** 가 모두 그것과 같을 때만. 다르면
    /// `approval-stale`(다시 보고 확인), 30분이 지났으면 `approval-expired`. 검증은 따로 스레드에서 돈다.
    pub(crate) fn approve_verify(
        &self,
        run_id: &str,
        job_id: &str,
        candidate: &str,
        command_sha: &str,
        old: &str,
    ) -> Result<Value, OrchError> {
        if !hex40(candidate) || !hex40(old) || command_sha.len() != 64 {
            return Err(invalid("candidate and old must be 40-hex object ids and commandSha a SHA-256"));
        }
        let git = self
            .integrator()
            .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))?;
        let (repo, work_ref) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            let integ = slot
                .run
                .integration
                .as_ref()
                .ok_or_else(|| OrchError::new(reason::INVALID_STATE, "this run has no integration ref"))?;
            (PathBuf::from(&slot.run.repo), integ.work_ref.clone())
        };
        let current = git
            .read_ref(&repo, &work_ref)
            .map_err(|e| OrchError::new(reason::INTEGRATION_FAILED, e.chars().take(240).collect::<String>()))?;
        let now = self.now();
        let (view, detail) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            match slot.run.state {
                RunState::Running | RunState::Paused => {}
                s => return Err(state_error(s)),
            }
            if let Some(h) = &slot.run.hold {
                return Err(on_hold(h));
            }
            let ji = job_index(&slot.run, job_id)?;
            let job = slot.run.jobs[ji].clone();
            if job.phase != JobPhase::AwaitingApproval {
                return Err(OrchError::new(
                    reason::INVALID_STATE,
                    format!("integration job {job_id} is {} — it is not waiting for a verification approval", job.phase.as_str()),
                ));
            }
            if job.awaiting_at.is_some_and(|t| now >= t + APPROVAL_TTL_MS) {
                abort_job_in(slot, ji, now, Actor::Server, reason::APPROVAL_EXPIRED);
                self.raise(slot, "verify-failed", Some(&job.attempt_id), Some(reason::APPROVAL_EXPIRED));
                self.after_change(&g, run_id);
                return Err(OrchError::new(reason::APPROVAL_EXPIRED, "the approval window (30 minutes) has passed"));
            }
            let cfg_sha = slot.run.verify.as_ref().map(|c| c.command_sha.clone());
            let head = slot.run.integration.as_ref().map(|i| i.expected_head.clone());
            let bound = job.candidate.as_deref() == Some(candidate)
                && job.old.as_deref() == Some(old)
                && cfg_sha.as_deref() == Some(command_sha)
                && head.as_deref() == Some(old);
            if !bound {
                return Err(OrchError::new(
                    reason::APPROVAL_STALE,
                    "the candidate, the command or the integration head changed — look at it again before approving",
                ));
            }
            if current.as_deref() != Some(old) {
                // 통합 ref 가 앱 밖에서 움직였다 — 이 후보는 낡았다(4-5 보류).
                abort_job_in(slot, ji, now, Actor::Server, "moved");
                self.hold_diverged(slot, "verify-approval", now);
                self.after_change(&g, run_id);
                return Err(OrchError::new(reason::RUN_ON_HOLD, "the integration ref moved — the run is on hold"));
            }
            let fresh = slot.run.task(&job.task_id).is_some_and(|t| {
                t.state == TaskState::Integrating && t.version == job.task_version
            }) && job.gen == slot.run.gen;
            if !fresh {
                return Err(OrchError::new(reason::APPROVAL_STALE, "the task changed meanwhile — look at it again"));
            }
            begin_verifying_in(slot, ji, VerifyApprover::Human, now)?;
            let seq = slot.run.bump(now, Actor::Human, "verify_approved", Some(&job.task_id), job_id);
            let mut d = verify_audit(slot, &slot.run.jobs[ji], Actor::Human);
            d.reason = Some("human".into());
            self.after_change(&g, run_id);
            (json!({ "runId": run_id, "jobId": job_id, "phase": JobPhase::Verifying, "latestSeq": seq }), d)
        };
        self.audit("verify_approved", run_id, detail.clone());
        self.audit("verify_started", run_id, detail);
        self.launch_verify(run_id, job_id);
        Ok(view)
    }

    /// 사람 [검증 실패인데 수락](op `orchestration_override_verify` — Tauri 명령만). 대상은 **실패한 그 Job**(`jobId` · 실패 `verifyId` ·
    /// 후보 `candidate`) — 그 Task 의 마지막 Job 이고, Task 가 여전히 같은 보고로 reported 이며, 통합 머리가 그 Job 의 `old` 그대로일 때만.
    /// 같은 후보로 새 Job 을 세워 곧바로 올린다(덮어쓰기 기록은 새 Job 에 · 실패 결과는 실패로 남는다). 블로킹(git).
    pub(crate) fn override_verify(&self, run_id: &str, job_id: &str, verify_id: &str, candidate: &str) -> Result<Value, OrchError> {
        if !hex40(candidate) {
            return Err(invalid("candidate must be a 40-hex object id"));
        }
        let git = self
            .integrator()
            .ok_or_else(|| OrchError::new(reason::INTEGRATION_FAILED, "this server has no integration git"))?;
        let (repo, work_ref) = {
            let g = self.lock();
            let slot = g.runs.get(run_id).ok_or_else(not_found_run)?;
            let integ = slot
                .run
                .integration
                .as_ref()
                .ok_or_else(|| OrchError::new(reason::INVALID_STATE, "this run has no integration ref"))?;
            (PathBuf::from(&slot.run.repo), integ.work_ref.clone())
        };
        let current = git
            .read_ref(&repo, &work_ref)
            .map_err(|e| OrchError::new(reason::INTEGRATION_FAILED, e.chars().take(240).collect::<String>()))?;
        let now = self.now();
        let (new_job, base, detail) = {
            let mut g = self.lock();
            let slot = human_slot(&mut g, run_id)?;
            match slot.run.state {
                RunState::Running | RunState::Paused => {}
                s => return Err(state_error(s)),
            }
            if let Some(h) = &slot.run.hold {
                return Err(on_hold(h));
            }
            if slot.run.verify.is_none() {
                return Err(OrchError::new(reason::INVALID_STATE, "this run has no verification"));
            }
            if let Some(j) = slot.run.live_job() {
                return Err(OrchError::new(
                    reason::INTEGRATION_BUSY,
                    format!("integration job {} of this run is still running", j.job_id),
                ));
            }
            let ji = job_index(&slot.run, job_id)?;
            let failed = slot.run.jobs[ji].clone();
            let v = failed.verify.clone().filter(|v| {
                !matches!(v.outcome, VerifyOutcome::Pass | VerifyOutcome::Cancelled)
                    && v.verify_id == verify_id
                    && v.candidate == candidate
            });
            if failed.phase != JobPhase::Aborted || v.is_none() || failed.candidate.as_deref() != Some(candidate) {
                return Err(OrchError::new(
                    reason::VERIFY_FAILED,
                    "only the failed verification of that exact candidate can be overridden",
                ));
            }
            let latest = slot.run.jobs.iter().rposition(|j| j.task_id == failed.task_id) == Some(ji);
            let head = slot.run.integration.as_ref().map(|i| i.expected_head.clone());
            let old_ok = failed.old.is_some() && head == failed.old && current == failed.old;
            if !latest || !old_ok {
                return Err(OrchError::new(
                    reason::APPROVAL_STALE,
                    "the integration head or the task moved since that verification — verify the new candidate instead",
                ));
            }
            let task = slot
                .run
                .task(&failed.task_id)
                .cloned()
                .ok_or_else(|| OrchError::new(reason::NOT_FOUND, "no such task"))?;
            if task.state != TaskState::Reported
                || review_target(&slot.run, &task).map(|r| r.report_id) != Some(failed.report_id.clone())
            {
                return Err(OrchError::new(
                    reason::APPROVAL_STALE,
                    "the task is no longer reported with that report — look at it again",
                ));
            }
            acceptable(&slot.run, &task)?;
            let new_id_ = new_id("job").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
            let request = new_id("hovr").ok_or_else(|| OrchError::new(reason::INTERNAL, "no randomness source"))?;
            let Some(t) = slot.run.tasks.iter_mut().find(|t| t.id == failed.task_id) else {
                return Err(OrchError::new(reason::NOT_FOUND, "no such task"));
            };
            t.state = TaskState::Integrating;
            t.version += 1;
            t.updated_at = now;
            let task_version = t.version;
            let gen = slot.run.gen;
            let job = IntegrationJob {
                job_id: new_id_.clone(),
                task_id: failed.task_id.clone(),
                gen,
                task_version,
                attempt_id: failed.attempt_id.clone(),
                report_id: failed.report_id.clone(),
                report_commit: failed.report_commit.clone(),
                merge_base: failed.merge_base.clone(),
                old: failed.old.clone(),
                candidate: failed.candidate.clone(),
                candidate_tree: failed.candidate_tree.clone(),
                phase: JobPhase::Candidate,
                outcome: None,
                request_id: request,
                by: Reviewer::Human,
                started_at: now,
                committing_at: None,
                awaiting_at: None,
                approval: None,
                verify: None,
                override_: Some(VerifyOverride {
                    failed_job_id: failed.job_id.clone(),
                    verify_id: verify_id.to_string(),
                    candidate: candidate.to_string(),
                    old: failed.old.clone().unwrap_or_default(),
                    by: Reviewer::Human,
                    at: now,
                }),
                // 검토(5단계) — 실패한 Job 의 검토 칸을 이어받는다(사람의 수락 — 필수 검토에 pass 가 없으면 면제).
                review_id: failed.review_id.clone(),
                review_waived: failed.review_waived || (slot.run.legacy_require_review() && failed.review_id.is_none()),
                // 수락 규칙(3a) — 실패한 Job 이 관문에서 판정한 것을 그대로 이어받는다(사람의 덮어쓰기 수락).
                waived: failed.waived.clone(),
                judgments: failed.judgments.clone(),
            };
            slot.run.jobs.push(job.clone());
            slot.run.bump(now, Actor::Human, "human_override_verify", Some(&failed.task_id), verify_id);
            let mut d = verify_audit(slot, &job, Actor::Human);
            d.verify_id = Some(verify_id.to_string());
            d.reason = Some(format!("override:{}", v.map(|v| v.outcome.as_str()).unwrap_or("fail")));
            let base = run_base(&slot.run);
            self.after_change(&g, run_id);
            (new_id_, base, d)
        };
        self.audit("human_override_verify", run_id, detail);
        // 새 Job 의 후보 ref 를 이 후보로 세운다(Job 마다 따로 — 올리기 트랜잭션이 `delete <ref> <C>` 로 함께 지운다).
        let keep = RefOp::Update { name: refs::candidate(&base, &new_job), new: candidate.to_string(), old: None };
        if !matches!(git.update_refs(&repo, &[keep]), Ok(TxOutcome::Committed)) {
            log::line(format!("orchestration — {run_id}: could not re-pin the candidate ref for an override"));
        }
        let phase = self.commit_job(run_id, &new_job)?;
        Ok(json!({ "runId": run_id, "jobId": new_job, "phase": phase }))
    }
}
