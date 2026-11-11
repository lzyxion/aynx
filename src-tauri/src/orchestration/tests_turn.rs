//! 3차 2단계 시험(헤드리스 설계 docs/log/2026-10-16-orchestration-headless-design.md 9절 2단계 · 7-2) — **헤드리스 실행기 + 검토자**:
//! 인자 표(CLI × 등급 × 첫 턴/resume · 개발 덮기) · 설정 출처 통제 · 추출기(실측 S2 · S5 표본을 잘라 가짜 값으로 바꾼 fixture) · 이상 입력
//! 계약 `turn_outcome` · 공용 환경 정화 · 지침 턴 파일 회수 · 턴 기록에 프롬프트 없음 · 생성 시 Job · `SPAWN_LOCK` · **S8 동시 생성(가짜 CLI ·
//! 모델 호출 없음)**.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::model::*;
use super::spawn::{REVIEWER_ALLOWED_TOOLS, REVIEWER_CLAUDE_TOOLS, WORKER_ALLOWED_TOOLS};
use super::turn::*;

const CLAUDE_EDIT: &str = include_str!("turn_fixtures/claude-edit-a.jsonl");
const CLAUDE_JUDGE: &str = include_str!("turn_fixtures/claude-judge-b.jsonl");
const CODEX_EXEC: &str = include_str!("turn_fixtures/codex-exec.jsonl");
const CODEX_STDERR: &str = include_str!("turn_fixtures/codex-stderr.txt");

const S1: &str = "11111111-2222-4333-8444-555555555555";
const MCP: &str = "aynx-sessions-dev";
const PROMPT: &str = "[Aynx · worker att-1 · Task task-1]\nSECRET-PROMPT-BODY";

fn scratch(tag: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "aynx-turn-{}-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst),
        crate::operations::now_ms()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 인자 재료 하나(시험 값). `extra` = Codex 실행 환경 덧붙임.
#[allow(clippy::too_many_arguments)]
fn args<'a>(
    cli: WorkerCli,
    grade: Grade,
    resume: Option<&'a str>,
    allowed: &'a [String],
    model_args: &'a [String],
    extra: &'a [String],
    tools: &'a [&'a str],
) -> TurnArgs<'a> {
    TurnArgs {
        cli,
        exe: "C:/bin/x.exe",
        grade,
        resume,
        session_id: if resume.is_none() && cli == WorkerCli::Claude { Some(S1) } else { None },
        mcp_name: MCP,
        mcp_tools: tools,
        mcp_config: (cli == WorkerCli::Claude).then_some("C:/data/agent-mcp/orch-att-1.json"),
        mcp_url: "http://127.0.0.1:5555/mcp",
        token_env: "AYNX_MCP_TOKEN",
        allowed_commands: allowed,
        read_rule: None,
        add_dir: (grade == Grade::ReadOnly).then_some("C:/wt/x-rv"),
        cwd: Some("C:/wt/x"),
        codex_extra: extra,
        model_args,
        append_file: (cli == WorkerCli::Claude).then_some("C:/data/turns/att-1-t1.md"),
        developer_instructions: None,
        prompt: PROMPT,
    }
}

fn argv(cli: WorkerCli, grade: Grade, resume: Option<&str>) -> Vec<String> {
    let allowed = vec!["npm test".to_string(), "cargo test".to_string()];
    let tools: &[&str] = if grade == Grade::ReadOnly { REVIEWER_ALLOWED_TOOLS } else { WORKER_ALLOWED_TOOLS };
    turn_argv(&args(cli, grade, resume, &allowed, &[], &[], tools))
}

fn has(a: &[String], w: &str) -> bool {
    a.iter().any(|x| x == w)
}

fn after<'a>(a: &'a [String], w: &str) -> &'a str {
    &a[a.iter().position(|x| x == w).unwrap_or_else(|| panic!("{w} 없음 — {a:?}")) + 1]
}

// ---------------------------------------------------------------------------
// 인자 표
// ---------------------------------------------------------------------------

/// 7-2 `worker_args_never_interactive` · `worker_args_control_setting_sources` · `codex_network_always_on` · `resume_args_carry_this_turn_grade` —
/// CLI × 등급 × 첫 턴/resume 의 인자 표(설계 4-2 · 4-7 · 실측 결과 판정 표).
#[test]
fn turn_args_table() {
    for grade in [Grade::Edit, Grade::Full, Grade::ReadOnly] {
        for resume in [None, Some("01a143b6-0000-7000-8000-00000000abcd")] {
            // --- Claude
            let c = argv(WorkerCli::Claude, grade, resume.map(|_| S1));
            assert_eq!(&c[1..5], ["-p", "--output-format", "stream-json", "--verbose"], "늘 -p · stream-json");
            assert_eq!(after(&c, "--permission-prompts"), "none", "늘 묻지 않고 거절");
            assert!(has(&c, "--strict-mcp-config"));
            match resume {
                None => assert!(after(&c, "--session-id") == S1 && !has(&c, "--resume")),
                // S1 — `--resume` 과 `--session-id` 를 함께 주면 시작 오류.
                Some(_) => assert!(after(&c, "--resume") == S1 && !has(&c, "--session-id")),
            }
            match grade {
                Grade::Edit => {
                    // 후보 A — `--restricted --tools <이름>` · `--settings` 의 허용 규칙(S3 · S14).
                    assert!(has(&c, "--restricted") && !has(&c, "--setting-sources"));
                    assert_eq!(after(&c, "--tools"), CLAUDE_EDIT_TOOLS);
                    assert_eq!(after(&c, "--permission-mode"), "acceptEdits");
                    assert_eq!(after(&c, "--settings"), r#"{"permissions":{"allow":["Bash(npm test:*)","Bash(cargo test:*)"]}}"#);
                }
                Grade::Full => {
                    // 후보 B(+ bypass) — A 는 bypass 를 시작 오류로 거절한다(실측).
                    assert!(!has(&c, "--restricted") && after(&c, "--setting-sources").is_empty());
                    assert_eq!(after(&c, "--permission-mode"), "bypassPermissions");
                    let s: serde_json::Value = serde_json::from_str(after(&c, "--settings")).unwrap();
                    assert_eq!(s["disableAllHooks"], true, "B 는 훅을 끈다");
                }
                Grade::ReadOnly => {
                    assert!(!has(&c, "--restricted") && after(&c, "--setting-sources").is_empty());
                    assert_eq!(after(&c, "--tools"), CLAUDE_JUDGE_TOOLS);
                    assert!(!has(&c, "--permission-mode"));
                    assert_eq!(after(&c, "--settings"), r#"{"permissions":{"allow":[]},"disableAllHooks":true}"#, "판정형은 허용 규칙을 싣지 않는다");
                    assert_eq!(after(&c, "--add-dir"), "C:/wt/x-rv");
                }
            }
            // --- Codex
            let x = argv(WorkerCli::Codex, grade, resume);
            assert_eq!(&x[1..4], ["-a", "never", "exec"], "-a 는 exec 앞(최상위)");
            for w in ["--ignore-user-config", "--ignore-rules", "--json"] {
                assert!(has(&x, w), "{w}");
            }
            assert_eq!(x.iter().filter(|w| *w == "--disable").count(), 2);
            assert!(has(&x, "plugins") && has(&x, "hooks"));
            match resume {
                None => {
                    assert!(!has(&x, "resume"));
                    assert_eq!(after(&x, "-C"), "C:/wt/x");
                }
                Some(id) => {
                    // S6 — resume 에는 `-s` · `-C` 가 없다(이 턴의 샌드박스는 `-c sandbox_mode`, 폴더는 프로세스 cwd).
                    assert_eq!(x[4], "resume");
                    assert!(!has(&x, "-s") && !has(&x, "-C"));
                    assert_eq!(x[x.len() - 3], id, "thread id 는 `--` 앞");
                }
            }
            let joined = x.join(" ");
            match (grade, resume) {
                (Grade::Edit, None) => assert_eq!(after(&x, "-s"), "workspace-write"),
                (Grade::Edit, Some(_)) => assert!(joined.contains("sandbox_mode='workspace-write'")),
                (Grade::ReadOnly, None) => assert_eq!(after(&x, "-s"), "read-only"),
                (Grade::ReadOnly, Some(_)) => assert!(joined.contains("sandbox_mode='read-only'")),
                (Grade::Full, _) => assert!(has(&x, "--dangerously-bypass-approvals-and-sandbox") && !has(&x, "-s")),
            }
            // E20 · S5 — Codex `edit` 은 첫 턴 · resume 모두 unelevated + 네트워크 켬. 다른 등급에는 없다.
            assert_eq!(joined.contains("windows.sandbox='unelevated'"), grade == Grade::Edit, "{grade:?} {resume:?}");
            assert_eq!(joined.contains("sandbox_workspace_write.network_access=true"), grade == Grade::Edit);
            assert_eq!(has(&x, "--skip-git-repo-check"), grade == Grade::ReadOnly && resume.is_none());
            for a in [&c, &x] {
                // 2-3a — 인증을 끊는 `--bare` · 훅 신뢰 우회 · 새 대화 id 를 내는 `--fork-session` 은 어디에도 없다.
                for bad in ["--bare", "--dangerously-bypass-hook-trust", "--fork-session", "--no-daemon"] {
                    assert!(!has(a, bad), "{bad}");
                }
                // 옵션 전부 → `--` → 프롬프트 하나(1b), 프롬프트 첫 글자 `[`.
                assert_eq!(a[a.len() - 2], "--");
                assert!(a[a.len() - 1].starts_with('['));
                assert_eq!(a.iter().filter(|w| *w == "--").count(), 1);
            }
        }
    }
}

/// 역할 모델 · 강도 낱말과 Codex 추가 지침이 `--` 앞에 실린다(r3 · S19) — 지침은 TOML 문자열로 이스케이프된다.
#[test]
fn turn_args_carry_model_and_developer_instructions() {
    let m = super::spawn::role_model_args(WorkerCli::Codex, Some("gpt-6.1-sol"), Some("low"), (None, None));
    let mut a = args(WorkerCli::Codex, Grade::Edit, None, &[], &m, &[], WORKER_ALLOWED_TOOLS);
    a.developer_instructions = Some("say \"hi\"\nthen \\ stop");
    let x = turn_argv(&a);
    assert_eq!(after(&x, "-m"), "gpt-6.1-sol");
    assert!(x.iter().any(|w| w == "model_reasoning_effort=low"));
    assert!(x.iter().any(|w| w == r#"developer_instructions="say \"hi\"\nthen \\ stop""#), "{x:?}");
    assert!(x.iter().position(|w| w == "-m").unwrap() < x.iter().position(|w| w == "--").unwrap());
    let c = super::spawn::role_model_args(WorkerCli::Claude, Some("sonnet"), Some("high"), (None, None));
    let cl = turn_argv(&args(WorkerCli::Claude, Grade::Edit, None, &[], &c, &[], WORKER_ALLOWED_TOOLS));
    assert_eq!(after(&cl, "--model"), "sonnet");
    assert_eq!(after(&cl, "--effort"), "high");
    assert_eq!(after(&cl, "--append-system-prompt-file"), "C:/data/turns/att-1-t1.md");
    // 허용 명령 규칙 — 규칙 문법과 부딪히는 글자는 버린다(좁은 쪽).
    assert_eq!(command_rule("npm test"), Some("Bash(npm test:*)".into()));
    for bad in ["", "  ", "rm (x)", "a*", "x\ny"] {
        assert_eq!(command_rule(bad), None, "{bad:?}");
    }
}

/// 판정형(검토자)의 인자는 등급 칸과 무관하게 읽기 전용 고정이다 — 쓰기 도구 · 권한 · 우회 낱말이 없다(4-7).
#[test]
fn judge_args_have_no_write_tools() {
    assert_eq!(REVIEWER_CLAUDE_TOOLS, CLAUDE_JUDGE_TOOLS);
    for cli in [WorkerCli::Claude, WorkerCli::Codex] {
        let a = argv(cli, Grade::ReadOnly, None);
        for w in &a[..a.len() - 1] {
            for t in w.split(',') {
                assert!(!["Edit", "Write", "Bash", "PowerShell", "NotebookEdit", "WebFetch"].contains(&t), "{cli:?}: {t}");
            }
        }
        let j = a.join(" ");
        for bad in ["bypass", "acceptEdits", "workspace-write", "danger", "network_access", "Bash("] {
            assert!(!j.contains(bad), "{cli:?}: {bad}");
        }
    }
}

// ---------------------------------------------------------------------------
// 명령 줄 · 환경
// ---------------------------------------------------------------------------

#[test]
fn quote_argv_msvc_rules() {
    let q = |xs: &[&str]| quote_argv(&xs.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    assert_eq!(q(&["C:/bin/x.exe", "-p"]), "C:/bin/x.exe -p");
    assert_eq!(q(&["a", ""]), r#"a """#, "빈 값은 \"\" — `--setting-sources \"\"`");
    assert_eq!(q(&["a b"]), r#""a b""#);
    assert_eq!(q(&[r#"{"x":1}"#]), r#""{\"x\":1}""#);
    assert_eq!(q(&[r"C:\p\"]), r"C:\p\", "공백 · 따옴표 없으면 그대로");
    assert_eq!(q(&[r"C:\a b\"]), r#""C:\a b\\""#, "끝 역슬래시는 닫는 따옴표 앞에서 두 배");
    assert_eq!(q(&[r#"a\"b"#]), r#""a\\\"b""#);
    assert_eq!(q(&["[x]\nline"]), "\"[x]\nline\"");
}

/// 7-2 `headless_env_uses_tile_scrub`(D11) — 헤드리스 턴의 환경은 PTY 자식과 **같은 정화 목록 하나**로 걷는다.
#[test]
fn headless_env_uses_tile_scrub() {
    let mut inherited: Vec<(String, String)> = crate::pty::scrub_env_names().map(|n| (n.to_string(), "inherited".to_string())).collect();
    // 대소문자만 다른 이름도 걷는다(Windows 환경 이름).
    inherited.push(("aynx_mcp_token".into(), "lower".into()));
    for keep in ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "HTTPS_PROXY", "SystemRoot"] {
        inherited.push((keep.to_string(), "user".to_string()));
    }
    inherited.push(("PATH".into(), "C:/old".into()));
    let add = vec![("PATH".to_string(), "C:/filtered".to_string()), ("AYNX_MCP_TOKEN".to_string(), "turn-token".to_string())];
    let env = headless_env(inherited, &add);
    for n in crate::pty::scrub_env_names() {
        let left: Vec<&(String, String)> = env.iter().filter(|(k, _)| k.eq_ignore_ascii_case(n)).collect();
        assert!(left.iter().all(|(_, v)| v != "inherited" && v != "lower"), "{n} 이 물려받은 채로 남았다");
    }
    for keep in ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "HTTPS_PROXY", "SystemRoot"] {
        assert!(env.iter().any(|(k, v)| k == keep && v == "user"), "{keep} 는 남는다(인증 · 설정)");
    }
    let path: Vec<&String> = env.iter().filter(|(k, _)| k.eq_ignore_ascii_case("PATH")).map(|(_, v)| v).collect();
    assert_eq!(path, vec!["C:/filtered"], "더한 값이 이긴다(하나만)");
    assert!(env.iter().any(|(k, v)| k == "AYNX_MCP_TOKEN" && v == "turn-token"), "이 턴의 토큰만");
    // 목록은 한 함수 — PTY 쪽(`clean_tile_env`)과 헤드리스 쪽(`headless_env`)이 같은 `scrub_env_names` 를 부른다(소스 훑기).
    let pty = include_str!("../pty.rs");
    let clean = &pty[pty.find("fn clean_tile_env(").unwrap()..];
    let clean = &clean[..clean.find("\n}").unwrap()];
    assert!(clean.contains("scrub_env_names()"), "{clean}");
    let turn = include_str!("turn.rs");
    let he = &turn[turn.find("pub(crate) fn headless_env(").unwrap()..];
    let he = &he[..he.find("\n}").unwrap()];
    assert!(he.contains("crate::pty::scrub_env_names()"));
}

// ---------------------------------------------------------------------------
// 지침 턴 파일 · 턴 기록
// ---------------------------------------------------------------------------

#[test]
fn turn_instructions_file_is_reclaimed() {
    // 본문 — 고정 문장 · 역할 지침 · 읽은 문서 순서, 셋 다 비면 파일도 인자도 없다.
    assert_eq!(instructions_text("", None, &[]), None);
    assert_eq!(instructions_text("  ", Some(" "), &[("a", " ")]), None);
    let body = instructions_text("FIXED", Some("ROLE\r\nNOTE"), &[("User instructions", "GLOBAL")]).unwrap();
    let (f, r, g) = (body.find("FIXED").unwrap(), body.find("ROLE\nNOTE").unwrap(), body.find("GLOBAL").unwrap());
    assert!(f < r && r < g, "{body}");
    assert!(!body.contains('\r'));
    let big = "x".repeat(INSTRUCTIONS_DOC_MAX + 10);
    let cut = instructions_text("", None, &[("big", &big)]).unwrap();
    assert!(cut.contains("(truncated)") && cut.len() < INSTRUCTIONS_DOC_MAX + 400);
    // 파일은 턴 자원 — 떨어지면(트리 종료 확인 뒤 서버 손이 런타임 칸을 지울 때) 지워진다.
    let d = scratch("instr");
    let p = d.join("att-1-t1.md");
    std::fs::write(&p, &body).unwrap();
    {
        let _files = TurnFiles(vec![p.clone()]);
        assert!(p.is_file());
    }
    assert!(!p.exists(), "턴 자원은 떨어질 때 지운다");
    // 전역 CLAUDE.md 자리 — CLAUDE_CONFIG_DIR 이 이기고, 없으면 홈의 .claude.
    let home = PathBuf::from("C:/home/me");
    assert_eq!(global_claude_md(None, Some(home.clone())), Some(home.join(".claude").join("CLAUDE.md")));
    assert_eq!(
        global_claude_md(Some(std::ffi::OsStr::new("D:/cfg")), Some(home)),
        Some(PathBuf::from("D:/cfg").join("CLAUDE.md"))
    );
    assert_eq!(global_claude_md(None, None), None);
    let _ = std::fs::remove_dir_all(&d);
}

/// 7-2 `turn_args_label_has_no_prompt`(D11) — 턴 기록(영속 · 보드 · 감사로 가는 것)에는 프롬프트 · 지침 본문 · 토큰 · 설정 파일 경로 ·
/// 대화 id 가 없다. 권한 표시 칸만.
#[test]
fn turn_args_label_has_no_prompt() {
    let allowed = vec!["npm test".to_string()];
    let m = super::spawn::role_model_args(WorkerCli::Claude, Some("sonnet"), Some("high"), (None, None));
    let mut a = args(WorkerCli::Claude, Grade::Edit, None, &allowed, &m, &[], WORKER_ALLOWED_TOOLS);
    a.developer_instructions = Some("SECRET-INSTRUCTIONS");
    let label = args_label(&a, Some("abc123".into()));
    assert_eq!(label.cli, "claude");
    assert_eq!(label.grade, "edit");
    assert_eq!(label.settings_control, "restricted");
    assert_eq!(label.allowed_rules, vec!["Bash(npm test:*)"]);
    assert_eq!((label.model.as_deref(), label.effort.as_deref()), (Some("sonnet"), Some("high")));
    let rec = TurnRecord {
        n: 1,
        started_at: 1,
        ended_at: Some(2),
        outcome: "ok".into(),
        reason: None,
        exit_code: Some(0),
        denials: 1,
        denial_kinds: vec!["policy".into()],
        tools: 3,
        last_tool: Some("Read".into()),
        cli_version: Some("2.1.301".into()),
        model: Some("claude-sonnet-5-5".into()),
        args: label,
        anomalies: TurnAnomalies::default(),
    };
    let s = serde_json::to_string(&rec).unwrap();
    for secret in ["SECRET-PROMPT-BODY", "SECRET-INSTRUCTIONS", "orch-att-1.json", "att-1-t1.md", "AYNX_MCP_TOKEN", S1, "C:/wt", "127.0.0.1"] {
        assert!(!s.contains(secret), "{secret} 가 턴 기록에 샜다: {s}");
    }
    // Codex 표시 — 실효 샌드박스 · 네트워크(Q7 · E20).
    let x = args_label(&args(WorkerCli::Codex, Grade::Edit, Some("t"), &allowed, &[], &[], WORKER_ALLOWED_TOOLS), None);
    assert_eq!(x.sandbox.as_deref(), Some("workspace-write · network on"));
    assert!(x.allowed_rules.is_empty(), "Codex 에는 명령 단위 허용 목록이 없다(Q7)");
    assert!(x.resume);
    // 옛 Attempt(턴 칸 없음)를 읽는다 · 빈 칸은 쓰지 않는다(v2 파일 호환).
    let old: Attempt = serde_json::from_value(serde_json::json!({
        "id": "att-1", "taskId": "task-1", "cli": "claude", "gen": 1, "state": "reported", "startedAt": 1,
        "role": "reviewer", "stream": "orch-1"
    }))
    .unwrap();
    assert!(old.turns.is_empty());
    assert!(!serde_json::to_string(&old).unwrap().contains("turns"));
}

// ---------------------------------------------------------------------------
// 추출기 · 이상 입력
// ---------------------------------------------------------------------------

fn feed_all(e: &Expect, text: &str) -> TurnLog {
    let mut log = TurnLog::default();
    let mut split = LineSplitter::new(LINE_MAX);
    let mut lines = Vec::new();
    split.push(text.as_bytes(), &mut lines);
    for l in &lines {
        log.feed(e, l);
    }
    if split.finish() {
        log.feed(e, &Line::Cut);
    }
    log
}

fn expect_claude_edit() -> Expect {
    expect_for(&args(WorkerCli::Claude, Grade::Edit, None, &[], &[], &[], WORKER_ALLOWED_TOOLS))
}

#[test]
fn extractor_claude_edit_fixture() {
    let e = expect_claude_edit();
    assert_eq!(e.conversation.as_deref(), Some(S1));
    assert_eq!(e.mcp_server.as_deref(), Some(MCP));
    let log = feed_all(&e, CLAUDE_EDIT);
    assert!(log.init_seen && log.abort.is_none(), "{log:?}");
    assert_eq!(log.conversation.as_deref(), Some(S1));
    assert_eq!(log.model.as_deref(), Some("claude-haiku-5-5"));
    assert_eq!(log.cli_version.as_deref(), Some("2.1.301"));
    assert_eq!(log.tools, 5, "get_task · Bash · Write · Read · report_done");
    assert_eq!(log.last_tool.as_deref(), Some("mcp__aynx-sessions-dev__report_done"));
    assert_eq!(log.denials, 1, "permission_denied 사건과 result 의 거절 목록 중 큰 쪽");
    assert_eq!(log.ended, Some((true, Some("success".into()))));
    assert!(log.anomalies.is_zero(), "{:?}", log.anomalies);
    let out = turn_outcome(&log, &Exit { code: Some(0), killed: None, confirmed: true });
    assert_eq!(out, Outcome { outcome: "ok", reason: None });
    // 기록에 본문이 없다 — 뽑은 것은 낱말 · 수뿐.
    let dump = format!("{log:?}");
    for body in ["FAKE TASK BODY", "FAKE COMMAND", "FAKE SUMMARY", "FAKE FINAL TEXT", "FAKE DENIAL TEXT"] {
        assert!(!dump.contains(body), "{body}");
    }
}

#[test]
fn extractor_claude_judge_fixture() {
    let mut a = args(WorkerCli::Claude, Grade::ReadOnly, None, &[], &[], &[], REVIEWER_ALLOWED_TOOLS);
    a.session_id = Some("22222222-3333-4444-8555-666666666666");
    let e = expect_for(&a);
    assert!(e.judge && e.permission_mode.is_none());
    let log = feed_all(&e, CLAUDE_JUDGE);
    assert!(log.abort.is_none(), "{log:?}");
    assert_eq!(log.model.as_deref(), Some("claude-sonnet-5-5"), "실효 모델(보드 검토 칸)");
    assert_eq!(log.tools, 3);
    assert_eq!(turn_outcome(&log, &Exit { code: Some(0), killed: None, confirmed: true }).outcome, "ok");
    // 판정형인데 init 에 쓰기 도구가 있거나 넓은 권한 모드면 도구 사건 전에 끝낸다(`effective-mismatch`).
    for bad in [CLAUDE_JUDGE.replacen("\"Glob\",", "\"Glob\",\"Bash\",", 1), CLAUDE_JUDGE.replacen("\"default\"", "\"bypassPermissions\"", 1)] {
        let log = feed_all(&e, &bad);
        assert_eq!(log.abort, Some("effective-mismatch"));
        assert_eq!(turn_outcome(&log, &Exit { code: Some(0), killed: None, confirmed: true }), Outcome { outcome: "failed", reason: Some("effective-mismatch".into()) });
    }
}

#[test]
fn extractor_codex_fixture_and_stderr() {
    let a = args(WorkerCli::Codex, Grade::Edit, None, &[], &[], &[], WORKER_ALLOWED_TOOLS);
    let e = expect_for(&a);
    assert_eq!(e.conversation, None, "Codex 첫 턴은 thread.started 가 고정한다");
    let mut log = feed_all(&e, CODEX_EXEC);
    assert!(log.abort.is_none(), "{log:?}");
    assert_eq!(log.conversation.as_deref(), Some("01a143b6-0000-7000-8000-00000000abcd"));
    assert_eq!(log.tools, 4, "mcp get_task · file_change · command_execution · mcp report_done(완료 사건만)");
    assert_eq!(log.last_tool.as_deref(), Some("report_done"));
    assert_eq!(log.ended, Some((true, None)));
    assert!(log.anomalies.is_zero(), "{:?}", log.anomalies);
    for line in CODEX_STDERR.lines() {
        log.feed_stderr(&e, line);
    }
    assert_eq!(log.denials, 2, "거절은 stderr 에만 있다(S5)");
    assert_eq!(log.denial_kinds, vec!["outside-write", "policy"]);
    assert_eq!(turn_outcome(&log, &Exit { code: Some(0), killed: None, confirmed: true }).outcome, "ok");
    // resume 턴은 같은 thread id 여야 한다(D6).
    let ra = args(WorkerCli::Codex, Grade::Edit, Some("01a143b6-ffff-7000-8000-00000000abcd"), &[], &[], &[], WORKER_ALLOWED_TOOLS);
    let log = feed_all(&expect_for(&ra), CODEX_EXEC);
    assert_eq!(log.abort, Some("conversation-mismatch"));
    // Claude 의 stderr 는 거절로 세지 않는다(거절은 stdout 사건으로 온다).
    let mut cl = TurnLog::default();
    cl.feed_stderr(&expect_claude_edit(), "patch rejected: writing outside of the project");
    assert_eq!(cl.denials, 0);
}

/// F4 — 진행 문지기(가짜 시각): 처음 바뀐 것은 곧바로 · 그 뒤로는 바뀌었어도 2초에 한 번 · 안 바뀌면 조용 · 미룬 변화는 간격 뒤에 그때 값으로.
#[test]
fn progress_gate_two_seconds_on_change() {
    let e = expect_for(&args(WorkerCli::Codex, Grade::Edit, None, &[], &[], &[], WORKER_ALLOWED_TOOLS));
    let lines: Vec<&str> = CODEX_EXEC.lines().collect();
    let mut log = TurnLog::default();
    let feed = |log: &mut TurnLog, l: &str| {
        log.feed(&e, &Line::Full(l.as_bytes().to_vec()));
    };
    let mut g = ProgressGate::default();
    assert_eq!(g.due(0, log.progress()), None, "init 전 · 아무것도 없음");
    feed(&mut log, lines[0]);
    // Codex init 에는 모델 · 판이 없다 — 칸이 그대로면 보내지 않는다.
    assert_eq!(g.due(10, log.progress()), None);
    let mut sent: Vec<(u64, u32, Option<String>)> = Vec::new();
    let mut now = 100;
    for l in &lines[1..] {
        feed(&mut log, l);
        if let Some(p) = g.due(now, log.progress()) {
            sent.push((now, p.tools, p.last_tool.clone()));
        }
        now += 300;
    }
    assert_eq!(log.tools, 4);
    assert!(!sent.is_empty(), "처음 바뀐 것은 곧바로");
    for w in sent.windows(2) {
        assert!(w[1].0 - w[0].0 >= PROGRESS_EVERY_MS, "2초에 한 번까지: {sent:?}");
    }
    // 간격이 지난 뒤 다시 물으면 미룬 마지막 값이 나간다 · 그 뒤 안 바뀌면 조용.
    let last = g.due(now + PROGRESS_EVERY_MS, log.progress());
    if sent.last().map(|s| s.1) != Some(4) {
        let p = last.expect("미룬 변화");
        assert_eq!((p.tools, p.last_tool.as_deref()), (4, Some("report_done")));
    }
    assert_eq!(g.due(now + 10 * PROGRESS_EVERY_MS, log.progress()), None, "바뀌지 않으면 보내지 않는다");
    // 거절(stderr)도 진행 칸이다.
    for l in CODEX_STDERR.lines() {
        log.feed_stderr(&e, l);
    }
    let p = g.due(now + 20 * PROGRESS_EVERY_MS, log.progress()).expect("거절 수가 바뀌었다");
    assert_eq!((p.denials, p.denial_kinds.clone()), (2, vec!["outside-write", "policy"]));
}

/// F4 — 턴 도중에 고정해도 되는 대화 id: init 확인을 지난 것만(어긋난 resume id · 다른 Claude id · id 모양이 아닌 것 · init 전은 없음).
#[test]
fn early_conversation_only_after_checked_init() {
    let codex = expect_for(&args(WorkerCli::Codex, Grade::Edit, None, &[], &[], &[], WORKER_ALLOWED_TOOLS));
    let first = CODEX_EXEC.lines().next().unwrap();
    // init 전 — 없음.
    assert_eq!(TurnLog::default().early_conversation(), None);
    // 첫 줄(thread.started)만 받아도 선다 — 턴 끝을 기다리지 않는다.
    let log = feed_all(&codex, &format!("{first}\n"));
    assert_eq!(log.early_conversation(), Some("01a143b6-0000-7000-8000-00000000abcd"));
    // resume 턴인데 다른 id — 확인에 걸렸다(고정 없음).
    let ra = args(WorkerCli::Codex, Grade::Edit, Some("01a143b6-ffff-7000-8000-00000000abcd"), &[], &[], &[], WORKER_ALLOWED_TOOLS);
    assert_eq!(feed_all(&expect_for(&ra), &format!("{first}\n")).early_conversation(), None);
    // id 모양이 아니다(대화 폴더에서 찾을 수 없는 id) — 고정하지 않는다.
    let odd = feed_all(&codex, "{\"type\":\"thread.started\",\"thread_id\":\"not-a-uuid-123\"}\n");
    assert!(odd.init_seen && odd.abort.is_none(), "{odd:?}");
    assert_eq!(odd.early_conversation(), None);
    // Claude — 서버가 정한 id 와 같은 init 이면 그 id(같은 값 — 고정은 이미 서 있다), 다른 id 면 없음.
    let claude_init = CLAUDE_EDIT.lines().next().unwrap();
    assert_eq!(feed_all(&expect_claude_edit(), &format!("{claude_init}\n")).early_conversation(), Some(S1));
    let mut wrong = expect_claude_edit();
    wrong.conversation = Some("99999999-2222-4333-8444-555555555555".into());
    assert_eq!(feed_all(&wrong, &format!("{claude_init}\n")).early_conversation(), None);
}

/// 7-2 `turn_outcome_anomalies`(D10 — 4-4 이상 입력 표 전부).
#[test]
fn turn_outcome_anomalies() {
    let e = expect_claude_edit();
    let ok_exit = Exit { code: Some(0), killed: None, confirmed: true };
    let fail = |r: &str| Outcome { outcome: "failed", reason: Some(r.into()) };
    let lines: Vec<&str> = CLAUDE_EDIT.lines().collect();
    let init = lines[0];
    let result = *lines.last().unwrap();
    // 잘린 마지막 줄(EOF 가 줄 중간) — 버리고 센다 · 다른 규칙대로(여기서는 result 가 잘려 없음 → no-result).
    let cut = format!("{init}\n{}", &result[..result.len() / 2]);
    let log = feed_all(&e, &cut);
    assert_eq!(log.anomalies.truncated, 1);
    assert_eq!(turn_outcome(&log, &ok_exit), fail("no-result"));
    // 1 MiB 넘는 줄 — 버리고 센다(본문은 어디에도 없다) · 다른 규칙대로.
    let huge = format!("{{\"type\":\"assistant\",\"x\":\"{}\"}}", "y".repeat(LINE_MAX + 10));
    let log = feed_all(&e, &format!("{init}\n{huge}\n{result}\n"));
    assert_eq!(log.anomalies.oversized, 1);
    assert_eq!(turn_outcome(&log, &ok_exit).outcome, "ok");
    // 모르는 사건 · JSON 아닌 줄 · 빈 줄 — 무시 · 셈.
    let log = feed_all(&e, &format!("{init}\n{{\"type\":\"brand_new_event\"}}\nnot json at all\n\n[1,2]\n{result}\n"));
    assert_eq!((log.anomalies.unknown, log.anomalies.non_json), (1, 2));
    assert_eq!(turn_outcome(&log, &ok_exit).outcome, "ok");
    // init 없음 — 시작 시한(서버가 끝냄) · 그냥 끝남 둘 다 no-init.
    let log = feed_all(&e, &format!("{result}\n"));
    assert_eq!(turn_outcome(&log, &ok_exit), fail("no-init"));
    assert_eq!(turn_outcome(&TurnLog::default(), &Exit { code: None, killed: Some("no-init"), confirmed: true }), fail("no-init"));
    // result 없음 + 종료 코드 0 — 성공으로 세지 않는다.
    let log = feed_all(&e, &format!("{init}\n"));
    assert_eq!(turn_outcome(&log, &ok_exit), fail("no-result"));
    // result 성공인데 종료 코드 ≠ 0 · 그 반대 — exit-mismatch.
    let log = feed_all(&e, CLAUDE_EDIT);
    assert_eq!(turn_outcome(&log, &Exit { code: Some(1), killed: None, confirmed: true }), fail("exit-mismatch"));
    assert_eq!(turn_outcome(&log, &Exit { code: None, killed: None, confirmed: true }), fail("exit-mismatch"));
    let err_result = result.replace("\"subtype\":\"success\",\"is_error\":false", "\"subtype\":\"error_max_turns\",\"is_error\":true");
    let log = feed_all(&e, &format!("{init}\n{err_result}\n"));
    assert_eq!(turn_outcome(&log, &ok_exit), fail("exit-mismatch"));
    assert_eq!(turn_outcome(&log, &Exit { code: Some(1), killed: None, confirmed: true }), fail("error_max_turns"));
    // 같은 id 아님 — init 의 id 가 다름 · init 두 번(다른 id) · result 의 id 가 다름.
    let other = init.replace(S1, "99999999-2222-4333-8444-555555555555");
    let log = feed_all(&e, &format!("{other}\n{result}\n"));
    assert_eq!(log.abort, Some("conversation-mismatch"));
    assert_eq!(turn_outcome(&log, &ok_exit), fail("conversation-mismatch"));
    let mut two = TurnLog::default();
    assert_eq!(two.feed(&e, &Line::Full(init.as_bytes().to_vec())), None);
    assert_eq!(two.feed(&e, &Line::Full(other.as_bytes().to_vec())), Some("conversation-mismatch"), "처음 한 번 알린다");
    assert_eq!(two.feed(&e, &Line::Full(other.as_bytes().to_vec())), None, "두 번 알리지 않는다");
    let log = feed_all(&e, &format!("{init}\n{}\n", result.replace(S1, "99999999-2222-4333-8444-555555555555")));
    assert_eq!(log.abort, Some("conversation-mismatch"));
    // 우리 MCP 가 연결되지 않음 · 권한 모드가 이 턴의 등급이 아님 · 이름 안 댄 도구 — 도구 사건 전에 끝낸다.
    let log = feed_all(&e, &format!("{}\n", init.replace("\"connected\"", "\"failed\"")));
    assert_eq!(log.abort, Some("mcp-unavailable"));
    let log = feed_all(&e, &format!("{}\n", init.replace("\"acceptEdits\"", "\"bypassPermissions\"")));
    assert_eq!(log.abort, Some("effective-mismatch"));
    let log = feed_all(&e, &format!("{}\n", init.replace("\"Bash\",", "\"Bash\",\"PowerShell\",")));
    assert_eq!(log.abort, Some("effective-mismatch"));
    // 시한 · 중단 · 트리 미확인.
    let log = feed_all(&e, CLAUDE_EDIT);
    assert_eq!(turn_outcome(&log, &Exit { code: Some(1), killed: Some("timeout"), confirmed: true }), Outcome { outcome: "timeout", reason: None });
    assert_eq!(turn_outcome(&log, &Exit { code: Some(1), killed: Some("stopped"), confirmed: true }).outcome, "stopped");
    let un = turn_outcome(&log, &Exit { code: Some(0), killed: None, confirmed: false });
    assert_eq!(un, Outcome { outcome: "stop-unconfirmed", reason: Some("ok".into()) }, "확인 못 함 = 살아 있을 수 있음(idle 아님)");
    assert_eq!(
        turn_outcome(&log, &Exit { code: Some(1), killed: Some("timeout"), confirmed: false }).reason.as_deref(),
        Some("timeout")
    );
    assert_eq!(fail("no-result").label(), "turn failed:no-result");
}

#[test]
fn line_splitter_and_tail_ring() {
    let mut s = LineSplitter::new(8);
    let mut out = Vec::new();
    s.push(b"ab", &mut out);
    s.push(b"c\r\nde", &mut out);
    s.push(b"\n0123456789XYZ", &mut out);
    s.push(b"more\nok\n", &mut out);
    assert_eq!(out, vec![Line::Full(b"abc".to_vec()), Line::Full(b"de".to_vec()), Line::Oversized, Line::Full(b"ok".to_vec())]);
    assert!(!s.finish());
    s.push(b"tail", &mut out);
    assert!(s.finish(), "잘린 마지막 줄");
    // stderr 폭주 — 끝 N 바이트만 · 셈은 전부.
    let mut r = TailRing::new(STDERR_TAIL);
    for _ in 0..100 {
        r.push(&[b'e'; 1000]);
    }
    r.push(b"END");
    assert_eq!(r.bytes().len(), STDERR_TAIL);
    assert!(r.bytes().ends_with(b"END"));
    assert_eq!(r.total(), 100_003);
}

// ---------------------------------------------------------------------------
// OS — 생성 시 Job · SPAWN_LOCK · S8
// ---------------------------------------------------------------------------

/// 7-2 `headless_spawn_holds_spawn_lock`(D8 — 소스 훑기): 헤드리스 턴의 생성은 검증과 **같은 몸**(`spawn_in_job`)이고, 그 몸의
/// 상속 가능 핸들 켜기 · `CreateProcessW` · 자식 끝 닫기가 `pty::with_spawn_lock` 안이다. 서버 손은 그 몸만 부른다(`std::process` ·
/// portable-pty 로 턴을 띄우지 않는다).
#[test]
fn headless_spawn_holds_spawn_lock() {
    let os = include_str!("../server/os.rs");
    let body = &os[os.find("pub(super) fn spawn_in_job(").unwrap()..];
    let body = &body[..body.find("\n    pub(super) fn job_active").unwrap()];
    let lock = body.find("crate::pty::with_spawn_lock(|| {").expect("SPAWN_LOCK");
    let locked = &body[lock..lock + body[lock..].find("});").unwrap()];
    for must in ["SetHandleInformation(", "CreateProcessW(", "CREATE_NO_WINDOW"] {
        assert!(locked.contains(must), "{must} 는 잠금 안");
    }
    // 검증 감싸개는 이 몸을 부른다(OS 몸은 하나).
    let vs = &os[os.find("pub(crate) fn verify_spawn(").unwrap()..];
    let vs = &vs[..vs.find("\n}").unwrap()];
    assert!(vs.contains("spawn_in_job(app, cmdline, cwd, env, Stdin::Eof)"));
    let workers = include_str!("../server/workers.rs");
    let rt = &workers[workers.find("pub(crate) fn run_turn_blocking(").unwrap()..];
    let rt = &rt[..rt.find("\n}").unwrap()];
    assert!(rt.contains("os::spawn_in_job("));
    for bad in ["std::process::Command", "Command::new", "spawn_program", "open_worker_blocking"] {
        assert!(!rt.contains(bad), "{bad}");
    }
}

/// 7-2 `job_assigned_at_creation_or_turn_not_started` — 잡은 **생성과 동시에**(`PROC_THREAD_ATTRIBUTE_JOB_LIST`) 귀속되고, 배정이 안
/// 서면 프로세스가 서지 않는다(생성 뒤 pid 로 넣는 대체 경로가 없다). 진짜 프로세스로: 돌아온 순간 이미 잡 안이다.
#[cfg(windows)]
#[test]
fn job_assigned_at_creation_or_turn_not_started() {
    let os_src = include_str!("../server/os.rs");
    let body = &os_src[os_src.find("pub(super) fn spawn_in_job(").unwrap()..];
    let body = &body[..body.find("\n    pub(super) fn job_active").unwrap()];
    assert!(body.contains("PROC_THREAD_ATTRIBUTE_JOB_LIST"));
    assert!(!body.contains("AssignProcessToJobObject"), "생성 뒤 귀속 경로가 없다");
    // CreateProcessW 실패(잡 배정 실패 포함)면 손잡이를 닫고 Err — 프로세스는 시작하지 않았다.
    assert!(body.contains("if ok == 0 {") && body.contains("return Err((\"create\""));
    let cmd = crate::server::os::system_cmd().unwrap();
    let d = scratch("job");
    let argv = vec![cmd.clone(), "/d".into(), "/s".into(), "/c".into(), "ping -n 30 127.0.0.1 >nul".into()];
    let env = headless_env(std::env::vars(), &[]);
    let p = crate::server::os::spawn_in_job(&cmd, &quote_argv(&argv), &d, &env, crate::server::os::Stdin::Eof).expect("생성");
    assert!(p.in_job(), "돌아온 순간 이미 잡 안");
    assert!(p.active().unwrap_or(0) >= 1);
    p.terminate();
    let until = Instant::now() + Duration::from_secs(10);
    while p.active() != Some(0) && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(p.active(), Some(0), "잡을 끝내면 트리가 0");
    drop(p);
    // 없는 실행 파일 — 아무것도 서지 않고 Err.
    assert!(crate::server::os::spawn_in_job("C:/no/such.exe", "x", &d, &env, crate::server::os::Stdin::Eof).is_err());
    let _ = std::fs::remove_dir_all(&d);
}

/// 가짜 CLI — `cmd /d /s /c "type <fixture>"`(stdout 에 표본 JSONL 을 낸다 · 모델 호출 없음). cmd.exe 는 MSVC 의 `\"` 이스케이프를
/// 모르므로 안쪽 글자에 따옴표를 쓰지 않는다(임시 폴더 경로에는 빈칸이 없다 — 진짜 CLI 는 MSVC CRT · Rust 인자 파서라 `quote_argv` 그대로).
#[cfg(windows)]
pub(super) fn fake_turn(fixture: &Path, tail: &str, expect: Expect, run_ms: u64) -> crate::server::workers::TurnSpec {
    let cmd = crate::server::os::system_cmd().unwrap();
    assert!(!fixture.display().to_string().contains(' '), "시험 경로에 빈칸이 없어야 한다");
    let line = format!("type {}{tail}", fixture.display());
    let argv = vec![cmd.clone(), "/d".into(), "/s".into(), "/c".into(), line];
    crate::server::workers::TurnSpec {
        exe: cmd,
        cmdline: quote_argv(&argv),
        cwd: fixture.parent().unwrap().to_path_buf(),
        env: headless_env(std::env::vars(), &[]),
        expect,
        start_ms: 5_000,
        run_ms,
    }
}

#[cfg(windows)]
pub(super) fn codex_expect() -> Expect {
    expect_for(&args(WorkerCli::Codex, Grade::ReadOnly, None, &[], &[], &[], REVIEWER_ALLOWED_TOOLS))
}

/// 서버 손의 턴 실행기(진짜 프로세스 · 가짜 CLI): 정상 끝 · init 어긋남(곧바로 끝냄) · 시작 시한(no-init) · 실행 시한 · 중단.
#[cfg(windows)]
#[test]
fn run_turn_blocking_outcomes_with_fake_cli() {
    use crate::server::workers::run_turn_blocking;
    let d = scratch("run");
    let codex = d.join("codex.jsonl");
    std::fs::write(&codex, CODEX_EXEC).unwrap();
    let claude = d.join("claude.jsonl");
    std::fs::write(&claude, CLAUDE_EDIT).unwrap();
    let stderr = d.join("stderr.txt");
    std::fs::write(&stderr, CODEX_STDERR).unwrap();
    let never = AtomicBool::new(false);
    // 정상 — 표본을 내고(stdout) 거절 줄을 내고(stderr — 두 파이프를 함께 비운다) 끝난다.
    let tail = format!(" & type {} 1>&2", stderr.display());
    let (r, _) = run_turn_blocking(fake_turn(&codex, &tail, codex_expect(), 60_000), &never, |_| {}, |_| {}).unwrap();
    assert!(r.confirmed);
    assert_eq!(r.outcome, Outcome { outcome: "ok", reason: None });
    assert_eq!(r.log.conversation.as_deref(), Some("01a143b6-0000-7000-8000-00000000abcd"));
    assert_eq!(r.log.denials, 2, "stderr 의 거절 줄");
    assert!(String::from_utf8_lossy(&r.stderr_tail).contains("blocked by policy"), "stderr 꼬리는 메모리에만");
    // init 의 대화 id 가 다르다 — 도구 사건 전에 끝낸다(뒤의 긴 ping 을 기다리지 않는다).
    let mut wrong = expect_claude_edit();
    wrong.conversation = Some("99999999-2222-4333-8444-555555555555".into());
    let t0 = Instant::now();
    let (r, _) = run_turn_blocking(fake_turn(&claude, " & ping -n 30 127.0.0.1 >nul", wrong, 60_000), &never, |_| {}, |_| {}).unwrap();
    assert_eq!(r.outcome, Outcome { outcome: "failed", reason: Some("conversation-mismatch".into()) });
    assert!(r.confirmed && t0.elapsed() < Duration::from_secs(15));
    // 시작 시한 — init 이 오지 않는다.
    let empty = d.join("empty.jsonl");
    std::fs::write(&empty, "").unwrap();
    let mut spec = fake_turn(&empty, " & ping -n 30 127.0.0.1 >nul", codex_expect(), 60_000);
    spec.start_ms = 500;
    let (r, _) = run_turn_blocking(spec, &never, |_| {}, |_| {}).unwrap();
    assert_eq!(r.outcome, Outcome { outcome: "failed", reason: Some("no-init".into()) });
    assert!(r.confirmed);
    // 실행 시한 — init 은 왔지만 끝나지 않는다. 도는 동안(1.5초 — 진행 간격 2초 안) 진행 칸은 한 번만 나가고, 턴 끝 기록은 예전 그대로다(F4).
    let mut pulses: Vec<Pulse> = Vec::new();
    let (r, _) = run_turn_blocking(fake_turn(&codex, " & ping -n 30 127.0.0.1 >nul", codex_expect(), 1_500), &never, |_| {}, |p| pulses.push(p)).unwrap();
    assert_eq!(r.outcome.outcome, "timeout");
    assert!(r.confirmed, "잡을 끝내고 트리 0 · EOF 를 확인했다");
    assert_eq!(pulses[0], Pulse::Conversation("01a143b6-0000-7000-8000-00000000abcd".into()));
    let progress: Vec<&TurnProgress> = pulses.iter().filter_map(|p| if let Pulse::Progress(p) = p { Some(p) } else { None }).collect();
    assert_eq!(progress.len(), 1, "2초 안에는 한 번: {pulses:?}");
    assert!(progress[0].tools >= 1 && progress[0].tools <= r.log.tools);
    assert_eq!((r.log.tools, r.log.last_tool.as_deref()), (4, Some("report_done")), "턴 끝 값은 도중 공개와 무관");
    // 중단 — 깃발이 서면 잡을 끝내고 `stopped`.
    let stop = Arc::new(AtomicBool::new(false));
    let s2 = Arc::clone(&stop);
    let (r, _) = run_turn_blocking(fake_turn(&codex, " & ping -n 30 127.0.0.1 >nul", codex_expect(), 60_000), &stop, move |_| {
        s2.store(true, Ordering::SeqCst);
    }, |_| {})
    .unwrap();
    assert_eq!(r.outcome.outcome, "stopped");
    assert!(r.confirmed);
    let _ = std::fs::remove_dir_all(&d);
}

/// **S8 동시 생성(가짜 — 모델 호출 없음)**: 일반 타일(ConPTY — 오래 사는 자식) · 수락 전 검증 · 헤드리스 턴을 되풀이해 **동시에** 띄워도,
/// 검증 · 턴의 파이프 EOF · 트리 종료 확인이 멎지 않는다(ConPTY 자식이 우리 파이프를 교차 상속하면 그 자식이 끝날 때까지 EOF 가 서지 않아
/// 확인이 실패한다 — `SPAWN_LOCK` 이 막는다, D8).
#[cfg(windows)]
#[test]
fn s8_concurrent_conpty_verify_and_turns_do_not_stall() {
    use crate::server::workers::run_turn_blocking;
    let d = scratch("s8");
    let codex = d.join("codex.jsonl");
    std::fs::write(&codex, CODEX_EXEC).unwrap();
    let cmd = crate::server::os::system_cmd().unwrap();
    let verify_env = super::verify::build_env(std::env::vars_os(), &[], &cmd, &d);
    let mut tiles = Vec::new();
    for round in 0..3 {
        let mut hs = Vec::new();
        // 일반 타일 둘 — 10초쯤 사는 ConPTY 자식.
        for _ in 0..2 {
            let cmd = cmd.clone();
            let cwd = d.clone();
            hs.push(std::thread::spawn(move || {
                let argv = vec![cmd, "/d".into(), "/c".into(), "ping -n 11 127.0.0.1 >nul".into()];
                Err(Box::new(crate::pty::spawn_argv_for_test(&argv, &cwd).expect("ConPTY")))
            }));
        }
        // 검증 둘 · 헤드리스 턴 둘 — 각자 4.5초 안에 확인까지 끝나야 한다(ConPTY 자식보다 훨씬 먼저).
        for _ in 0..2 {
            let (env, cwd) = (verify_env.clone(), d.clone());
            hs.push(std::thread::spawn(move || {
                let t0 = Instant::now();
                let cancel = AtomicBool::new(false);
                let x = super::verify::execute("echo verify", &cwd, &env, Instant::now() + Duration::from_secs(20), &cancel);
                Ok((t0.elapsed(), x.confirmed && x.outcome == VerifyOutcome::Pass, "verify"))
            }));
            let spec = fake_turn(&codex, "", codex_expect(), 60_000);
            hs.push(std::thread::spawn(move || {
                let t0 = Instant::now();
                let never = AtomicBool::new(false);
                let (r, _) = run_turn_blocking(spec, &never, |_| {}, |_| {}).expect("턴 생성");
                Ok((t0.elapsed(), r.confirmed && r.outcome.outcome == "ok", "turn"))
            }));
        }
        for h in hs {
            match h.join().unwrap() {
                Err(tile) => tiles.push(tile),
                Ok((took, ok, what)) => {
                    assert!(ok, "round {round}: {what} 확인 실패");
                    assert!(took < Duration::from_millis(4_500), "round {round}: {what} 가 {took:?} 걸렸다 — 교차 상속 의심");
                }
            }
        }
    }
    for mut t in tiles {
        let _ = t.child.kill();
    }
    let _ = std::fs::remove_dir_all(&d);
}
