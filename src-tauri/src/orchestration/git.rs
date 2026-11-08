//! **서버 집행 git 실행기**(공용 — 설계 2026-10-15-orchestration-integration-design 4-3 머리 · 10절 1단계). `commit_changes`(`commit.rs`)와
//! 조정자 `get_diff`(`diff.rs`)가 함께 쓴다 — 다음 단계의 통합(`merge-tree` · ref 트랜잭션)도 이 위에 선다.
//!
//! 불변식:
//! - **신뢰된 절대 경로의 git**(PATH 의 절대 폴더에서 찾은 것 · 처음 한 번) · 셸 없음 · 인자 배열.
//! - 환경은 서버 자기 환경에서 **`GIT_*` 를 모두 걷은 것**(`GIT_CONFIG_PARAMETERS` · `GIT_ATTR_SOURCE` · `GIT_DIR` 류 포함 —
//!   [`child_env`]) + `GIT_TERMINAL_PROMPT=0`. 고정 `-c`: 빈 훅 폴더 · fsmonitor · 서명 · editor · pager · 자동 정리 끔.
//! - **종료 코드를 보존한다**(`merge-tree` 의 1 = 충돌처럼 0 이 아닌 코드도 뜻이 있다) — [`Out::code`]. 성공만 보는 쪽은 [`Git::ok`].
//! - **출력 상한**(바이트) — stdout 은 [`Git::limit`] 까지만 담고 그 뒤는 읽어 버린다(파이프가 막혀 git 이 멈추지 않게 · 끝 코드가
//!   그대로 서게). 넘었으면 [`Out::truncated`]. 성공을 요구하는 [`Git::ok`] 는 잘린 출력을 `output-too-large` 로 거절한다(잘린 글을
//!   전부인 척 쓰지 않는다). stderr 는 [`STDERR_MAX`] 까지.
//! - 시한 하나(기본 [`GIT_TIMEOUT`] — 실행기마다 [`Git::timeout`] 으로 줄일 수 있다) — 넘으면 끝낸다.

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::store::{reason, OrchError};

/// git 한 번의 시한.
pub(crate) const GIT_TIMEOUT: Duration = Duration::from_secs(60);
/// stdout 기본 상한(바이트) — 큰 저장소의 `ls-files` · `status` 도 담는다.
pub(crate) const STDOUT_MAX: usize = 32 * 1024 * 1024;
/// stderr 상한(바이트) — 첫 줄만 쓴다.
pub(crate) const STDERR_MAX: usize = 64 * 1024;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 자식 git 의 환경 — `GIT_*`(대소문자 무시)를 모두 걷는다. 나머지(PATH · HOME · USERPROFILE · SystemRoot …)는 그대로(전역 설정의
/// 신원 · 실행에 필요). 순수.
pub(crate) fn child_env(vars: impl IntoIterator<Item = (OsString, OsString)>) -> Vec<(OsString, OsString)> {
    vars.into_iter()
        .filter(|(k, _)| !k.to_string_lossy().to_ascii_uppercase().starts_with("GIT_"))
        .collect()
}

/// 신뢰된 git 실행 파일 — PATH 의 **절대 폴더**에서 찾은 것(Windows 는 `git.exe` 만), 처음 한 번. 못 찾으면 `None`.
pub(crate) fn git_exe() -> Option<PathBuf> {
    static EXE: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    EXE.get_or_init(|| super::spawn::find_exe("git", std::env::var_os("PATH").as_deref()).filter(|p| p.is_absolute()))
        .clone()
}

pub(crate) fn hex40(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// git 한 번의 결과.
#[derive(Debug, Clone)]
pub(crate) struct Out {
    /// 끝 코드(신호로 죽었으면 `None`).
    pub code: Option<i32>,
    /// stdout(UTF-8 로 못 읽는 바이트는 바꿔 넣는다) — 상한까지.
    pub stdout: String,
    pub stderr: String,
    /// stdout 이 상한을 넘어 잘렸다.
    pub truncated: bool,
}

impl Out {
    /// 끝 코드 0 인가.
    pub(crate) fn ok(&self) -> bool {
        self.code == Some(0)
    }

    /// 사람 · 기록용 한 줄(stderr 첫 줄 · 240자까지).
    pub(crate) fn line(&self) -> String {
        let e = self.stderr.trim();
        let m = if e.is_empty() { "git failed" } else { e };
        m.lines().next().unwrap_or("git failed").chars().take(240).collect()
    }
}

/// git 부르기 — 셸 없음 · 인자 배열 · `GIT_*` 없는 환경 · 고정 `-c`.
pub(crate) struct Git<'a> {
    pub exe: PathBuf,
    pub dir: &'a Path,
    /// `core.hooksPath=<빈 폴더>`.
    pub hooks: String,
    /// [`child_env`] 를 지난 환경.
    pub env: &'a [(OsString, OsString)],
    /// stdout 상한(바이트).
    pub limit: usize,
    /// 실패(실행 못 함 · 시한 · 끝 코드 0 아님) 사유 낱말 — 부르는 쪽의 것(`commit-failed` · `git-failed`).
    pub fail_code: &'static str,
    /// 한 번의 시한 — 기본 [`GIT_TIMEOUT`]. 화면이 기다리는 가벼운 읽기(작업자 상세의 작업 중 파일)는 더 짧게 둔다.
    pub timeout: Duration,
}

impl<'a> Git<'a> {
    /// 실행기 하나 — 신뢰된 git 이 없으면 `fail_code` 로 거절.
    pub(crate) fn new(
        dir: &'a Path,
        hooks_dir: &Path,
        env: &'a [(OsString, OsString)],
        fail_code: &'static str,
    ) -> Result<Self, OrchError> {
        let exe = git_exe().ok_or_else(|| OrchError::new(fail_code, "git was not found on PATH"))?;
        Ok(Git {
            exe,
            dir,
            hooks: format!("core.hooksPath={}", hooks_dir.to_string_lossy()),
            env,
            limit: STDOUT_MAX,
            fail_code,
            timeout: GIT_TIMEOUT,
        })
    }

    fn failed(&self, msg: impl Into<String>) -> OrchError {
        OrchError::new(self.fail_code, msg)
    }

    /// 한 번 부른다 — 끝 코드가 0 이 아니어도 `Ok`(코드 보존). 실행 못 함 · 시한만 `Err`.
    pub(crate) fn run(&self, args: &[&str], extra_env: &[(&str, &str)], stdin: Option<&[u8]>) -> Result<Out, OrchError> {
        let mut cmd = Command::new(&self.exe);
        cmd.env_clear()
            .envs(self.env.iter().map(|(k, v)| (k.as_os_str(), v.as_os_str())))
            .env("GIT_TERMINAL_PROMPT", "0")
            .envs(extra_env.iter().copied())
            .arg("--no-pager")
            .arg("-C")
            .arg(self.dir);
        for c in [
            self.hooks.as_str(),
            "core.fsmonitor=false",
            "commit.gpgSign=false",
            "core.editor=:",
            "sequence.editor=:",
            "core.pager=cat",
            "gc.auto=0",
            "maintenance.auto=false",
        ] {
            cmd.arg("-c").arg(c);
        }
        cmd.args(args)
            .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let mut child = cmd.spawn().map_err(|e| self.failed(format!("could not run git: {e}")))?;
        let feed = stdin.map(|bytes| {
            let mut pipe = child.stdin.take();
            let bytes = bytes.to_vec();
            std::thread::spawn(move || {
                if let Some(p) = pipe.as_mut() {
                    let _ = p.write_all(&bytes);
                }
                drop(pipe);
            })
        });
        let out_t = pump(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>), self.limit);
        let err_t = pump(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>), STDERR_MAX);
        let deadline = Instant::now() + self.timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(st)) => break st,
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(self.failed("git did not finish in time"));
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(15)),
                Err(e) => {
                    let _ = child.kill();
                    return Err(self.failed(format!("could not wait for git: {e}")));
                }
            }
        };
        if let Some(f) = feed {
            let _ = f.join();
        }
        let (stdout, truncated) = out_t.join().unwrap_or_default();
        let (stderr, _) = err_t.join().unwrap_or_default();
        Ok(Out {
            code: status.code(),
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            truncated,
        })
    }

    /// 성공만 받는다 — 끝 코드 0 이 아니면 `fail_code`, 출력이 잘렸으면 `output-too-large`.
    pub(crate) fn ok(&self, args: &[&str], extra_env: &[(&str, &str)], stdin: Option<&[u8]>) -> Result<String, OrchError> {
        let o = self.run(args, extra_env, stdin)?;
        if !o.ok() {
            return Err(self.failed(o.line()));
        }
        if o.truncated {
            return Err(OrchError::new(
                reason::OUTPUT_TOO_LARGE,
                format!("git printed more than {} bytes — the app does not use a cut output", self.limit),
            ));
        }
        Ok(o.stdout)
    }
}

/// **꺼낼 트리의 필터 검사**(리뷰 F2 — 검토 · 검증 · 해결 seed 의 checkout/restore 전): `tree` 의 **전체 경로**(`ls-tree -r` — 바뀐
/// 경로만이 아니다, 그대로인 LFS 파일도 checkout 때 smudge 가 돈다) 중 `filter` 속성이 걸린 것이 있나. 속성 출처는 `attr_sources` 의
/// 트리마다 고정(`check-attr --source=<트리>` — `info/attributes` · `core.attributesFile` 은 git 이 늘 더해 읽으므로 검사도 같이 본다).
/// 필터 이름이 설정에 있는지는 보지 않는다(보수적 — merge 검사의 `filters` 와 같은 판정). 읽지 못하면 `Err`(부르는 쪽은 거절로 본다).
pub(crate) fn tree_has_filters(g: &Git<'_>, tree: &str, attr_sources: &[&str]) -> Result<bool, OrchError> {
    if !hex40(tree) || attr_sources.iter().any(|s| !hex40(s)) {
        return Err(g.failed("the filter check needs full object ids"));
    }
    let ls = g.ok(&["ls-tree", "-r", "-z", "--name-only", "--full-tree", tree], &[], None)?;
    let mut input: Vec<u8> = Vec::new();
    for p in ls.split('\0').filter(|p| !p.is_empty()) {
        input.extend_from_slice(p.as_bytes());
        input.push(0);
    }
    if input.is_empty() {
        return Ok(false);
    }
    for src in attr_sources {
        let s = format!("--source={src}");
        let a = g.ok(&["check-attr", &s, "-z", "--stdin", "filter"], &[], Some(&input))?;
        if super::merge::attr_refusal(&a) == Some("filters") {
            return Ok(true);
        }
    }
    Ok(false)
}

/// 파이프 하나를 끝까지 읽는다 — `max` 바이트까지만 담고 나머지는 버린다(읽기는 계속 — 자식이 쓰다 막히지 않게). `(담은 것, 잘림)`.
fn pump(pipe: Option<Box<dyn Read + Send>>, max: usize) -> std::thread::JoinHandle<(Vec<u8>, bool)> {
    std::thread::spawn(move || {
        let mut kept: Vec<u8> = Vec::new();
        let mut cut = false;
        if let Some(mut p) = pipe {
            let mut buf = [0u8; 64 * 1024];
            loop {
                match p.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let room = max.saturating_sub(kept.len());
                        if n > room {
                            cut = true;
                        }
                        kept.extend_from_slice(&buf[..n.min(room)]);
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(_) => break,
                }
            }
        }
        (kept, cut)
    })
}
