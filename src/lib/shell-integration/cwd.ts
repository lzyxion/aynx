// 현재 폴더 보고(OSC 7 · OSC 9;9)의 **순수 파서**와 WSL 경로 → 윈도우 경로 변환. 터미널을 모른다.
// 핸들러를 거는 쪽은 `cwd-handlers.ts`.

// ---------------------------------------------------------------------------
// 현재 폴더 보고 (OSC 7 · OSC 9;9) — 순수 파서
//
// OSC 133 이 "명령이 어디서 시작해 어떻게 끝났나" 라면, 이 둘은 "셸이 지금 어디에 있나"
// 다. 둘 다 **셸이 프롬프트마다 스스로 뱉는** 값이라 우리가 물어볼 필요가 없다.
//
//   OSC 7 ; file://<host>/<path>   사실상의 표준 (VS Code · iTerm2 · GNOME · konsole)
//   OSC 9 ; 9 ; <path>             Windows Terminal 확장 (URL 이 아니라 평범한 경로)
//
// **경로 구분자는 셸이 준 그대로 둔다.** 백슬래시로 바꾸지 않는다 — 파일 브라우저는 두
// 모양을 다 받고(`newLocalFsPane("C:/work")`), 원격 셸이 보낸 POSIX 경로를 Windows 모양으로
// 뜯어고치면 오히려 못 쓰는 값이 된다. 여기서 하는 일은 **퍼센트 인코딩을 풀고 호스트를
// 떼는 것**, 그리고 `file:///C:/…` 의 앞머리 슬래시 하나를 벗기는 것뿐이다
// (`/C:/Users/x` 는 Windows 에서 열 수 없는 경로다).
//
// 이 값을 **내는** 쪽은 이제 셋이다:
//
//   PowerShell    앱이 띄울 때 `integration.ps1` 을 점 소싱 (`PS_SNIPPET`)
//   WSL(bash)     앱이 띄울 때 `integration-wsl.rc` 를 `--rcfile` 로 (`SNIPPET` 그대로)
//   원격 bash·zsh 접속 직후 `~/.aynx/integration.sh` (`SNIPPET` 의 `__aynx_cwd`)
//
// **PowerShell 에서는 이 길만 맞다**: `Set-Location` 은 프로세스의 cwd 를 바꾸지 않아
// 백엔드의 PEB 읽기(`local_cwd`)는 셸이 시작한 폴더를 준다. **WSL 도 이 길뿐이다**:
// pid 는 `wsl.exe` 의 것이라 PEB 에 배포판 안의 폴더가 있을 리 없다 — 다만 그 값은 POSIX
// 경로라 [`wslCwdToWindows`] 로 한 번 옮겨야 로컬 브라우저가 연다. cmd.exe·Git Bash 는
// 반대로 훅이 없고 PEB 가 답이다. (`src-tauri/src/shell_integration.rs` ·
// docs/log/2026-09-08-local-shell-hook-osc7.md · docs/log/2026-09-08-wsl-cwd-hook.md)
// ---------------------------------------------------------------------------

/** 퍼센트 이스케이프를 푼다. 망가진 이스케이프면 원문을 그대로 (버리는 것보다 낫다) */
function decodePercent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * `OSC 7 ; file://<host>/<path>` 의 본문에서 경로를 뽑는다. 우리 것이 아니면 `null`.
 *
 * 호스트는 **버린다** — 이 값을 쓰는 곳(로컬 파일 브라우저)은 이 기기의 디스크만 보고,
 * 원격 셸이 보낸 호스트 이름을 여기서 판별해 봐야 할 일이 없다.
 */
export function parseOsc7Cwd(data: string): string | null {
  const raw = data.trim();
  if (!raw.toLowerCase().startsWith("file://")) return null;
  const rest = raw.slice("file://".length);
  const slash = rest.indexOf("/"); // 호스트 다음의 첫 슬래시부터가 경로다
  if (slash < 0) return null;
  const path = decodePercent(rest.slice(slash));
  // `/C:/Users/x` → `C:/Users/x` (드라이브 문자 앞의 슬래시는 URL 문법이지 경로가 아니다)
  const stripped = /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
  return stripped === "" ? null : stripped;
}

/** WSL 배포판의 파일을 윈도우 쪽에서 보는 UNC 앞머리 (`\\wsl$\…` 의 후계) */
const WSL_UNC = "\\\\wsl.localhost\\";

/**
 * WSL 셸이 말한 POSIX 경로 → **윈도우가 열 수 있는 경로** — 순수 함수.
 *
 * WSL 타일에서만 쓴다. 셸은 배포판 안에서 살아 `/home/me` 라고 말하는데, 그 값을 로컬 파일
 * 브라우저(이 컴퓨터의 디스크를 보는)에 그대로 넘기면 열리지 않는다. 규칙은 둘이다:
 *
 * | 셸이 말한 것 | 여는 자리 | 왜 |
 * | --- | --- | --- |
 * | `/mnt/c/work` | `C:\work` | 그 자리는 **원래 윈도우 디스크**다 — UNC 로 돌아가면 같은 파일을 느린 길로 본다 |
 * | `/home/me` | `\\wsl.localhost\<배포판>\home\me` | 배포판 안의 파일. 윈도우에는 이 길뿐이다 |
 *
 * 구분자를 **백슬래시로 바꾸는 유일한 자리**다 (`parseOsc7Cwd` 는 셸이 준 모양을 그대로
 * 둔다 — 원격 POSIX 경로까지 망가지기 때문). 여기서는 결과가 이미 "윈도우 경로" 라 그 걱정이
 * 없다. UNC 는 백슬래시가 **필수**다: `//wsl.localhost/…` 는 열리지 않는다.
 *
 * `null` = 우리가 다룰 값이 아니다 (상대 경로·빈 배포판 이름). 그때는 폴백이 홈을 연다.
 */
export function wslCwdToWindows(distro: string, posixPath: string): string | null {
  const name = distro.trim();
  const path = posixPath.trim();
  if (name === "" || !path.startsWith("/")) return null;

  // ① `/mnt/<드라이브>` — 마운트된 윈도우 디스크. 드라이브 문자는 대문자로 되돌린다.
  const mount = /^\/mnt\/([A-Za-z])(\/.*)?$/.exec(path);
  if (mount) {
    const rest = (mount[2] ?? "").replace(/\//g, "\\").replace(/\\+$/, "");
    return `${mount[1].toUpperCase()}:\\${rest.replace(/^\\/, "")}`;
  }

  // ② 배포판 안의 경로 — UNC. 루트(`/`)는 공유의 뿌리 그 자체다.
  const body = path.replace(/\/+$/, "").replace(/\//g, "\\");
  return `${WSL_UNC}${name}${body}`;
}

/**
 * `OSC 9 ; 9 ; <path>` (Windows Terminal) 의 본문에서 경로를 뽑는다. 우리 것이 아니면 `null`.
 *
 * OSC 9 는 **다른 뜻으로도 쓰인다** (iTerm2 의 `9;<알림 문구>`). 그래서 `9;` 로 시작하는
 * 것만 우리 것으로 보고 나머지는 건드리지 않는다. 값이 `file://` URL 로 오는 셸도 있어
 * 그 경우는 OSC 7 파서에 그대로 넘긴다.
 */
export function parseOsc9Cwd(data: string): string | null {
  if (!data.startsWith("9;")) return null;
  const body = data.slice(2).trim();
  if (body === "") return null;
  if (body.toLowerCase().startsWith("file://")) return parseOsc7Cwd(body);
  return body;
}
