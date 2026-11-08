//! 첫 말로 앨범 시작(사람 op). 모양 → 신원 → ref → 프로세스 → 한 잠금 확정 → 단일 전송기.

use super::*;
use crate::orchestration::album_start::{checkpoint, repository, AlbumInput, ProducerConfig, StartRun};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartBody {
    chat: String,
    client_id: String,
    text: String,
    cli: String,
    model: String,
    effort: Option<String>,
    name: Option<String>,
    repo: String,
    #[serde(default)]
    fork: Option<Fork>,
    album: AlbumInput,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fork {
    agent: String,
    conv: String,
}

/// 시작 요청만 직렬화한다. 같은 (chat, clientId)는 처음 확정 결과(글 본문은 기억하지 않는다).
type StartResults = HashMap<(String, String), Value>;
static STARTS: LazyLock<Mutex<StartResults>> = LazyLock::new(Default::default);

/// 같은 채팅을 여는 옛 화면 · 이어받기도 시작 확정과 엇갈려 항목을 바꾸지 못하게 한다.
pub(super) fn open(b: OpenBody) -> Result<Value, WireError> {
    let _starts = lock(&STARTS);
    op_open(b)
}

fn cli(name: &str) -> Result<Cli, WireError> {
    match name {
        "claude" => Ok(Cli::Claude),
        "codex" => Ok(Cli::Codex),
        _ => Err(fail("bad-args", "프로듀서 CLI가 올바르지 않습니다")),
    }
}

pub(super) fn start(value: Value) -> Result<Value, WireError> {
    let b: StartBody = serde_json::from_value(value).map_err(|_| fail("bad-args", "앨범 시작 몸이 올바르지 않습니다"))?;
    // 멱등 조회는 모양 · 권한 재판정보다 앞이다. 이미 선 앨범의 첫 결과를 그대로 돌려준다.
    let mut starts = lock(&STARTS);
    let key = (b.chat.clone(), b.client_id.clone());
    if let Some(first) = starts.get(&key) {
        return Ok(first.clone());
    }
    let result = start_once(b);
    if let Ok(first) = &result {
        starts.insert(key, first.clone());
    }
    result
}

fn start_once(mut b: StartBody) -> Result<Value, WireError> {
    // 빈 강도 = 칸 없음(CLI 기본) — 모델의 빈 값과 같은 뜻. Run · 띄우기 인자에 빈 값이 새지 않게 여기서 한 번.
    b.effort = blank_none(b.effort);
    // ① 모양 검사. 지금 producer_chat_send는 그림 첨부를 받지 않으므로 같은 글 규칙이다.
    if !id_ok(&b.chat)
        || b.text.trim().is_empty()
        || b.text.len() > TEXT_MAX
        || b.client_id.is_empty()
        || b.client_id.len() > 128
        || !word_ok(&b.client_id)
        || !model_ok(&b.model)
        || b.effort.as_deref().is_some_and(|e| !word_ok(e))
        || b.name.as_ref().is_some_and(|n| !crate::orchestration::album_start::name_ok(n))
    {
        return Err(fail("bad-args", "앨범 시작 입력이 올바르지 않습니다"));
    }
    let cli = cli(&b.cli)?;
    let (album, limits, verify) = b.album.validate(now_ms()).map_err(|e| fail(e.code, e.message))?;
    checkpoint("shape").map_err(|e| fail(e.code, e.message))?;
    let o = orch().ok_or_else(|| fail("unavailable", "오케스트레이션이 없습니다"))?;
    // ② 귀속은 닫힌 채팅에도 남는다. 기존 채팅 항목을 덮어써서 세대를 잃지 않는다.
    if let Some(run) = o.producer_run(&b.chat) {
        return Err(fail("already-produced", json!({"runId": run}).to_string()));
    }
    if lock(&TABLE).chats.contains_key(&b.chat) {
        return Err(fail("chat-in-use", "새 초안의 채팅 id가 필요합니다"));
    }
    // ③ fork는 기록된 cwd에서 다시 정한다. 몸의 경로와 다르면 실행 전에 거절한다.
    let repo = repository(&b.repo).map_err(|e| fail(e.code, e.message))?;
    let fork_from = if let Some(f) = b.fork {
        if cli != self::cli(&f.agent)? {
            return Err(fail("bad-args", "갈라 올 대화의 CLI가 다릅니다"));
        }
        let probed = fork_repo(cli, &f.conv)?;
        if crate::worktree::comparable(&probed) != crate::worktree::comparable(&repo) {
            return Err(fail("out-of-scope:repo", "대화가 기록한 저장소와 다릅니다"));
        }
        Some(f.conv.to_ascii_lowercase())
    } else {
        None
    };
    let name = b
        .name
        .filter(|n| !n.trim().is_empty())
        .map(|n| n.trim().to_string())
        .unwrap_or_else(|| b.text.lines().next().unwrap_or("").chars().take(40).collect());
    let path = std::path::Path::new(&repo);
    let worktree_dir = path
        .parent()
        .zip(path.file_name())
        .map(|(p, n)| p.join(format!("{}-wt", n.to_string_lossy())).display().to_string())
        .ok_or_else(|| fail("not-a-repo", "작업 폴더를 정할 수 없습니다"))?;
    // ④~⑤ 아티스트와 상한 확인 뒤 ref 준비. 준비 객체가 확정 전 반환에서 ref를 거둔다.
    let mut prepared = o
        .prepare_album(
            StartRun {
                name,
                repo: repo.clone(),
                worktree_dir,
                limits,
                verify,
            },
            album,
            ProducerConfig {
                cli: b.cli,
                model: b.model.clone(),
                effort: b.effort.clone(),
            },
        )
        .map_err(|e| fail(e.code, e.message))?;
    let chat = Arc::new(ProducerChat {
        id: b.chat.clone(),
        st: Mutex::new(State {
            cli,
            model: b.model,
            effort: b.effort,
            repo: prepared.start.repo.clone(),
            album: Some(prepared.id.clone()),
            album_starting: true,
            conversation: None,
            fork_from,
            conv_seen: None,
            core: Core::new(),
            input: Input::default(),
            life: Life::Live,
            closing: None,
            held_exit: None,
            subs: Vec::new(),
            album_end_seen: None,
            read_only: false,
            last_turn_end: None,
            wake_view: None,
        }),
        cv: Condvar::new(),
    });
    {
        let mut t = lock(&TABLE);
        if t.chats.contains_key(&b.chat) {
            return Err(fail("chat-in-use", "채팅 id가 이미 사용 중입니다"));
        }
        t.chats.insert(b.chat.clone(), Arc::clone(&chat));
    }
    // ⑥ 준비 신호까지 기다린 뒤 L4를 놓는다. 실패는 토큰 · 프로세스 · 표 · ref 순으로 거둔다.
    let ready = ensure_ready(
        &chat,
        lock(&chat.st),
        Some(&PreSpawn {
            plan_tools: prepared.album.plan_tools,
        }),
    );
    let proc = match ready {
        Ok(st) => st.core.live().ok_or_else(|| fail("spawn-failed", "프로듀서가 끝났습니다")),
        Err(e) => Err(e),
    };
    let commit = proc.and_then(|proc| {
        checkpoint("ready").map_err(|e| fail(e.code, e.message))?;
        prepared.commit(&seat(&b.chat, proc)).map_err(|e| fail(e.code, e.message))
    });
    if let Err(e) = commit {
        close(&b.chat, EndWhy::AlbumStartFailed);
        // 잡 종료 뒤 감시 스레드가 임시 자리까지 거둔 다음 ref 소유자를 놓는다.
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut st = lock(&chat.st);
        while st.core.has_proc() {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            st = chat.cv.wait_timeout(st, left).unwrap_or_else(|e| e.into_inner()).0;
        }
        return Err(e);
    }
    // ⑨ Run 확정 뒤 첫 글. stdin 실패만 Run을 남기고 sent:false로 돌려준다.
    let mut st = lock(&chat.st);
    st.album_starting = false;
    let sent = match st.input.submit(&b.client_id, &b.text, now_ms(), true) {
        Ok(Submit::Dispatch { src, text }) => {
            if checkpoint("stdin").is_err() {
                st.input.write_failed();
                false
            } else {
                dispatch(&chat, &mut st, src, text)
            }
        }
        _ => false,
    };
    // 첫 글은 화면 입력 칸으로 돌려준다. 서버 대기열에도 남기면 사람이 다시 보낼 때 두 번 간다.
    if !sent {
        st.input = Input::default();
    }
    let result = json!({"runId": prepared.id, "gen": 1, "chat": b.chat, "sent": sent,
        "state": if sent { "dispatching" } else { "not-sent" }, "epoch": st.core.id()});
    drop(st);
    wake_reaper();
    Ok(result)
}

/// 대화 색인의 시작 cwd → git toplevel → 주 저장소 신원. 맡기기 파일은 보지 않는다.
fn fork_repo(cli: Cli, conv: &str) -> Result<String, WireError> {
    use crate::agent_sessions::{recorded_cwd_in, target, CwdMiss};
    let t = target(match cli {
        Cli::Claude => "claude",
        Cli::Codex => "codex",
    })
    .map_err(|_| fail("bad-args", "CLI가 올바르지 않습니다"))?;
    let cwd = recorded_cwd_in(t, &conv_roots(t), conv).map_err(|e| match e {
        CwdMiss::BadId => fail("bad-conversation", "대화 id가 올바르지 않습니다"),
        CwdMiss::NotFound => fail("conversation-not-found", "대화가 없습니다"),
        CwdMiss::NoFolder(_) => fail("conversation-folder-missing", "대화의 폴더가 없습니다"),
    })?;
    repository(&cwd).map_err(|e| fail(e.code, e.message))
}

pub(super) fn probe(value: Value) -> Result<Value, WireError> {
    let b: Fork = body(value)?;
    Ok(json!({"repo": fork_repo(cli(&b.agent)?, &b.conv)?}))
}

#[derive(Deserialize)]
struct RepoBody {
    repo: String,
}

pub(super) fn defaults(value: Value) -> Result<Value, WireError> {
    let b: RepoBody = body(value)?;
    let repo = repository(&b.repo).map_err(|e| fail(e.code, e.message))?;
    orch()
        .ok_or_else(|| fail("unavailable", "오케스트레이션이 없습니다"))?
        .album_defaults(&repo)
        .map_err(|e| fail(e.code, e.message))
}

pub(super) fn remove_artist(value: Value) -> Result<Value, WireError> {
    let _starts = lock(&STARTS);
    let id = value["id"].as_str().ok_or_else(|| fail("bad-args", "아티스트 id가 없습니다"))?;
    let o = orch().ok_or_else(|| fail("unavailable", "오케스트레이션이 없습니다"))?;
    let ids = o.artist_in_use(id);
    if !ids.is_empty() {
        return Err(fail("artist-in-use", json!({"runIds": ids}).to_string()));
    }
    crate::orchestration::artists::remove_on_server(id, |id| {
        let ids = o.artist_in_use(id);
        if ids.is_empty() {
            Ok(())
        } else {
            Err(crate::errors::with_reason("artist-in-use", json!({"runIds": ids}).to_string()))
        }
    })
    .map(|v| json!(v))
    .map_err(|e| fail("artist-remove", e))
}
