//! 띄우기 — 이 폴더의 유일한 생성(잡 생성 · stdin 파이프 — `SPAWN_LOCK` · 생성과 동시에 Job · `CREATE_NO_WINDOW` — 검증 ·
//! 헤드리스 턴과 같은 몸)과 세 스레드. 무엇을 · 어디서 · 어떤 환경으로 띄울지는 주인이 지은 [`Launch`] 그대로다.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use super::io::{finalize, flush_due, on_line, push};
use super::{lock, Host, Proc, ProcId, Status, DELTA_MS};
use crate::orchestration::turn;
use crate::server::os;
use crate::side_chat::{Adapter, Ev};

/// stdout 한 줄 상한(바이트 — 넘은 줄은 그 자리에서 버린다). 헤드리스 턴의 1 MiB(`turn::LINE_MAX`)가 아닌 까닭: Codex 의
/// `item/completed{imageGeneration}` 이 그림 바이트(base64 `result` — 10-24 실측 1.3 MB)를 한 줄에 품어, 1 MiB 면 그 끝 줄이 통째로
/// 버려져 카드가 영영 돈다. 그림은 큰 것도 몇 MB 라 넉넉히 32 MiB(항목마다 한 줄씩만 쥔다 · 바이트는 어댑터가 버린다).
const STDOUT_LINE_MAX: usize = 32 * 1024 * 1024;
/// 프로세스가 끝난 뒤 stdout 이 EOF 에 닿기를 기다리는 시간.
const DRAIN_WAIT: Duration = Duration::from_secs(5);

/// 서버 임시 자리 — 우리가 쓴 파일만 지우고 폴더를 지운다(재귀 삭제 없음 — 정션을 따라가지 않게).
pub(crate) struct Spot {
    dir: PathBuf,
    files: Vec<PathBuf>,
}

impl Spot {
    /// 폴더는 부르는 쪽이 이미 만들었다.
    pub(crate) fn new(dir: PathBuf) -> Spot {
        Spot { dir, files: Vec::new() }
    }

    pub(crate) fn write(&mut self, name: &str, body: &str) -> Result<String, String> {
        let p = self.dir.join(name);
        self.files.push(p.clone());
        crate::fs_atomic::write_atomic(&p, body.as_bytes()).map_err(|e| format!("{name}: {e}"))?;
        Ok(p.to_string_lossy().replace('\\', "/"))
    }
}

impl Drop for Spot {
    fn drop(&mut self) {
        for p in self.files.drain(..) {
            let _ = std::fs::remove_file(&p);
        }
        let _ = std::fs::remove_dir(&self.dir);
    }
}

/// 실행 재료(주인이 짓는다) — **`Debug` 를 파생하지 않는다**(인자에 파일 경로 · 환경에 사용자 값 · 토큰).
pub(crate) struct Launch {
    /// CLI 이름(실패 문구 — `claude` · `codex`).
    pub name: &'static str,
    pub exe: String,
    pub argv: Vec<String>,
    pub cwd: PathBuf,
    /// 주인이 공용 정화(`turn::headless_env`)로 지은 환경 — 그대로 넘긴다.
    pub env: Vec<(String, String)>,
    pub adapter: Box<dyn Adapter>,
    pub spot: Spot,
    /// 띄운 뒤 곧바로 낼 알림(실린 외부 MCP 이름 · 뺀 서버).
    pub notices: Vec<Ev>,
}

/// **프로세스를 띄운다** — 세대 `proc`(주인이 [`ProcId::next`] 로 뽑아 토큰 · 임시 자리 이름에 이미 썼다)으로. 부르는 쪽이 주인 잠금을
/// 쥐고 있다 — 스레드들은 그 잠금이 풀린 뒤에야 줄을 반영한다(세대 · 프로세스 칸이 먼저 선다). 성공이면 맏 프로세스 pid, 실패면
/// `(이유 낱말, 문구)` — 그 세대의 토큰은 부르는 쪽이 거둔다.
pub(crate) fn start<H: Host>(h: &Arc<H>, st: &mut H::St, proc: ProcId, l: Launch) -> Result<u32, (&'static str, String)> {
    let mut job = os::spawn_in_job(&l.exe, &turn::quote_argv(&l.argv), &l.cwd, &l.env, os::Stdin::Pipe)
        .map_err(|(w, m)| (w, format!("could not start {}: {m}", l.name)))?;
    let (Some(input), Some(out), Some(err)) = (job.stdin.take(), job.stdout.take(), job.stderr.take()) else {
        job.terminate();
        return Err(("pipe", "the process pipes are missing".into()));
    };
    let job = Arc::new(job);
    // 쓰기 스레드 — stdin 줄을 순서대로(막혀도 주인 잠금을 쥐지 않는다).
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut f = input;
        for line in rx {
            if f.write_all(line.as_bytes()).and_then(|_| f.write_all(b"\n")).and_then(|_| f.flush()).is_err() {
                break;
            }
        }
    });
    // stderr — 끝 8 KiB 만.
    let ring = Arc::new(Mutex::new(turn::TailRing::new(turn::STDERR_TAIL)));
    {
        let ring = Arc::clone(&ring);
        std::thread::spawn(move || {
            let mut f = err;
            let mut buf = vec![0u8; 16 * 1024];
            loop {
                match f.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => lock(&ring).push(&buf[..n]),
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(_) => break,
                }
            }
        });
    }
    // stdout — 줄 → 어댑터.
    let (done_tx, done_rx) = mpsc::channel::<()>();
    {
        let h = Arc::clone(h);
        std::thread::spawn(move || {
            let mut f = out;
            let mut split = turn::LineSplitter::new(STDOUT_LINE_MAX);
            let mut lines = Vec::new();
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match f.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        split.push(&buf[..n], &mut lines);
                        for l in lines.drain(..) {
                            if let turn::Line::Full(b) = l {
                                on_line(&*h, proc, &String::from_utf8_lossy(&b));
                            }
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(_) => break,
                }
            }
            let _ = done_tx.send(());
        });
    }
    // 감시 — 끝을 기다리며 모은 조각을 제때 낸다 → 끝나면 남은 것을 거두고 끝 사건 하나.
    {
        let (h, job) = (Arc::clone(h), Arc::clone(&job));
        std::thread::spawn(move || {
            let code = loop {
                if let Some(c) = job.wait(DELTA_MS as u32) {
                    break Some(c);
                }
                flush_due(&*h, proc);
            };
            job.terminate();
            let _ = done_rx.recv_timeout(DRAIN_WAIT);
            finalize(&*h, proc, code);
        });
    }
    let mut adapter = l.adapter;
    for line in adapter.handshake() {
        let _ = tx.send(line);
    }
    let pid = job.pid;
    let core = H::core(st);
    core.id = proc;
    core.status = Status::Starting;
    core.live_turn.clear();
    core.pending.clear();
    core.delta = None;
    core.proc = Some(Proc { job, stdin: tx, adapter, closing: None, stderr: ring, _spot: l.spot });
    for n in l.notices {
        push(&**h, st, n);
    }
    Ok(pid)
}
