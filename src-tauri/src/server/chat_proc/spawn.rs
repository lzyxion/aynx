//! 띄우기 — 이 폴더의 유일한 생성(`os::spawn_in_job` 하나)과 세 스레드. 무엇을 · 어디서 · 어떤 환경으로 띄울지는 주인이 지은 [`Launch`] 그대로다.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use super::io::{finalize, flush_due, on_line, push};
use super::{lock, Host, Proc, ProcId, Status, DELTA_MS};
use crate::orchestration::turn;
use crate::server::os;
use crate::side_chat::{Adapter, Ev};

/// 헤드리스 턴의 1 MiB(`turn::LINE_MAX`)로 줄이지 않는다 — Codex 의 `item/completed{imageGeneration}` 이 그림 바이트를 한 줄에
/// 품어(MB 단위) 끝 줄이 버려지면 카드가 영영 돈다.
const STDOUT_LINE_MAX: usize = 32 * 1024 * 1024;
const DRAIN_WAIT: Duration = Duration::from_secs(5);

/// 우리가 쓴 파일만 지우고 폴더를 지운다 — 재귀 삭제는 정션을 따라가므로 쓰지 않는다.
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

/// **`Debug` 를 파생하지 않는다**(인자에 파일 경로 · 환경에 사용자 값 · 토큰).
pub(crate) struct Launch {
    pub name: &'static str,
    pub exe: String,
    pub argv: Vec<String>,
    pub cwd: PathBuf,
    /// 주인이 공용 정화(`turn::headless_env`)로 지은 환경 — 그대로 넘긴다.
    pub env: Vec<(String, String)>,
    pub adapter: Box<dyn Adapter>,
    pub spot: Spot,
    pub notices: Vec<Ev>,
}

/// 부르는 쪽이 주인 잠금을 쥐고 있다 — 스레드들은 그 잠금이 풀린 뒤에야 줄을 반영한다(세대 · 프로세스 칸이 먼저 선다).
/// 실패면 그 세대의 토큰은 부르는 쪽이 거둔다.
pub(crate) fn start<H: Host>(h: &Arc<H>, st: &mut H::St, proc: ProcId, l: Launch) -> Result<u32, (&'static str, String)> {
    let mut job = os::spawn_in_job(&l.exe, &turn::quote_argv(&l.argv), &l.cwd, &l.env, os::Stdin::Pipe)
        .map_err(|(w, m)| (w, format!("could not start {}: {m}", l.name)))?;
    let (Some(input), Some(out), Some(err)) = (job.stdin.take(), job.stdout.take(), job.stderr.take()) else {
        job.terminate();
        return Err(("pipe", "the process pipes are missing".into()));
    };
    let job = Arc::new(job);
    // 쓰기가 막혀도 주인 잠금을 쥐지 않게 따로 스레드에서.
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut f = input;
        for line in rx {
            if f.write_all(line.as_bytes()).and_then(|_| f.write_all(b"\n")).and_then(|_| f.flush()).is_err() {
                break;
            }
        }
    });
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
