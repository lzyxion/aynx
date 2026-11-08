//! GUI 쪽 띄우기 — 서버 exe 를 정하고, 분리 실행하고, 찾기 파일이 설 때까지 기다린다. 모두 **블로킹**(부르는 쪽이 블로킹 풀로).
//!
//! 순서(설계 4.1 · 스파이크 보정 1): `server.json` → pid 가 살아 있고 이미지가 믿을 exe 면 그 서버에 붙는다(`client`) →
//! 아니면 [`spawn`]: **breakaway → explorer 부모 → 같은 잡**(`os::spawn_server_detached`). 성공한 방식이 `launch_mode` 다 —
//! `same-job` 이면 "GUI 를 닫으면 세션도 닫힙니다" 를 상태로 밝힌다(조용한 실패 없음).
//!
//! ## 개발 빌드는 그림자 사본에서 띄운다
//!
//! 도는 exe 는 Windows 가 지우거나 덮지 못하게 잡는다 — 서버가 `target/debug/aynx.exe` 로 돌면 GUI 를 꺼도(서버는 산다)
//! 다음 `tauri dev` 의 cargo 가 그 파일을 갈지 못해 빌드가 멈춘다. 그래서 **개발 빌드만** exe 를
//! `data_root()/server-bin/<크기·시각 해시>/aynx.exe` 로 복사해 띄우고(`--origin` 에 원본 경로), 신원 확인은 "원본 exe 이거나
//! 그 폴더 아래" 로 넓힌다([`trusted_server_image`]). 릴리스는 설치 exe 를 그대로 띄운다 — 설치기는 이름으로 서버도 끈다(③ 첫판:
//! 설치 = 서버 종료, 판별 그림자 서버는 ③b).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use super::discovery::{self, Discovery};
use super::os::{self, SpawnMode};

/// 개발 빌드 그림자 사본의 뿌리.
fn shadow_root() -> Option<PathBuf> {
    Some(crate::instance::data_root()?.join("server-bin"))
}

/// 이 GUI 가 **서버로 믿는** 이미지인가 — 자기 exe 와 같거나, 개발 빌드면 그림자 사본 폴더 아래.
pub(crate) fn trusted_server_image(image: &str) -> bool {
    if os::own_image().is_some_and(|own| os::same_exe(image, &own)) {
        return true;
    }
    crate::instance::DEV && shadow_root().is_some_and(|root| os::exe_under(image, &root))
}

/// 띄울 exe — 릴리스는 자기 이미지, 개발은 그림자 사본(없으면 만든다 · 옛 사본은 지울 수 있는 것만 지운다).
fn server_exe() -> Result<String, String> {
    let own = os::own_image().ok_or("own image path unavailable")?;
    if !crate::instance::DEV {
        return Ok(own);
    }
    let root = shadow_root().ok_or("data root unavailable")?;
    let meta = std::fs::metadata(&own).map_err(|e| format!("stat {own}: {e}"))?;
    let stamp = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let key = super::ipc::transport::fnv1a64(&format!("{}-{stamp}", meta.len()));
    let name = std::path::Path::new(&own).file_name().ok_or("own image has no file name")?.to_owned();
    let dir = root.join(format!("{key:016x}"));
    let exe = dir.join(&name);
    if !exe.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
        let tmp = dir.join(format!(".{}.{}.tmp", name.to_string_lossy(), std::process::id()));
        std::fs::copy(&own, &tmp).map_err(|e| format!("copy server exe: {e}"))?;
        std::fs::rename(&tmp, &exe).map_err(|e| format!("rename server exe: {e}"))?;
    }
    // 옛 사본 — 도는 서버의 것은 잠겨 지워지지 않는다(그대로 둔다).
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            if e.path() != dir {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    Ok(exe.to_string_lossy().into_owned())
}

/// 찾기 파일이 가리키는 서버가 살아 있고 믿을 exe 인가.
pub(crate) fn live_discovery() -> Option<Discovery> {
    let d = discovery::read(&discovery::path()?)?;
    let img = os::image_path(d.pid)?;
    (os::pid_alive(d.pid) && trusted_server_image(&img)).then_some(d)
}

/// 서버를 분리 실행한다 — 방식과 pid.
pub(crate) fn spawn() -> Result<(SpawnMode, u32), String> {
    let exe = server_exe()?;
    let origin = os::own_image();
    let idle = std::env::var("AYNX_SERVER_IDLE_SECS")
        .ok()
        .filter(|v| v.parse::<u64>().is_ok());
    let args_for = |mode: SpawnMode| {
        let mut a = vec!["session-server".to_string(), "--launch-mode".into(), mode.as_str().into()];
        if crate::instance::DEV {
            if let Some(o) = &origin {
                a.push("--origin".into());
                a.push(o.clone());
            }
        }
        if let Some(v) = &idle {
            a.push("--idle-secs".into());
            a.push(v.clone());
        }
        a
    };
    os::spawn_server_detached(&exe, &args_for)
}

/// 방금 띄운 서버(`pid`)의 찾기 파일이 설 때까지 기다린다(최대 `limit`).
pub(crate) fn wait_for_discovery(pid: u32, limit: Duration) -> Option<Discovery> {
    let path = discovery::path()?;
    let deadline = Instant::now() + limit;
    loop {
        if let Some(d) = discovery::read(&path).filter(|d| d.pid == pid) {
            return Some(d);
        }
        if Instant::now() >= deadline || !os::pid_alive(pid) {
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// `pid` 가 끝날 때까지 기다린다(최대 `limit`) — 다시 시작의 앞 절반.
pub(crate) fn wait_for_exit(pid: u32, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    while os::pid_alive(pid) {
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    true
}
