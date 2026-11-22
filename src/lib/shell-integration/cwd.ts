// 현재 폴더 보고의 순수 파서와 WSL 경로 → 윈도우 경로 변환.
//
//   OSC 7 ; file://<host>/<path>   사실상의 표준
//   OSC 9 ; 9 ; <path>             Windows Terminal 확장 (URL 이 아니라 평범한 경로)
//
// 경로 구분자는 셸이 준 그대로 둔다 — 원격 POSIX 경로를 Windows 모양으로 고치면 못 쓰는 값이 된다.
// PowerShell · WSL 은 이 길만 맞다 — `Set-Location` 은 프로세스 cwd 를 안 바꾸고 WSL pid 는 `wsl.exe` 라 PEB 읽기가 틀린 폴더를 준다
// (Rust `shell_integration.rs` · docs/log/2026-09-08-local-shell-hook-osc7.md).

/** 망가진 이스케이프면 원문을 그대로 (버리는 것보다 낫다) */
function decodePercent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 호스트는 버린다 — 쓰는 곳(로컬 파일 브라우저)은 이 기기의 디스크만 본다. */
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

/**
 * 버퍼 끝에 붙일 OSC 7 — 화면 직렬화는 폴더를 싣지 않아, 빠지면 다시 붙은 창이 다음 프롬프트까지 폴더를 모른다.
 * 파서를 거쳐 같은 값으로 돌아오지 않는 경로(상대 · UNC 등)는 싣지 않는다 — 틀린 폴더보다 칩이 없는 편이 낫다.
 */
export function cwdSuffix(cwd: string | null | undefined): string {
  if (!cwd) return "";
  const path = cwd.replace(/[%\s\u0000-\u001f\u007f-\u009f]/g, (c) => encodeURIComponent(c));
  const body = `file://${path.startsWith("/") ? "" : "/"}${path}`;
  return parseOsc7Cwd(body) === cwd ? `\x1b]7;${body}\x07` : "";
}

const WSL_UNC = "\\\\wsl.localhost\\";

/**
 * `/mnt/c/work` → `C:\work`(원래 윈도우 디스크 — UNC 로 가면 같은 파일을 느린 길로 본다) · 그 밖은 `\\wsl.localhost\<배포판>\…`.
 * 구분자를 백슬래시로 바꾸는 유일한 자리다 — UNC 는 백슬래시가 필수다(`//wsl.localhost/…` 는 안 열린다).
 */
export function wslCwdToWindows(distro: string, posixPath: string): string | null {
  const name = distro.trim();
  const path = posixPath.trim();
  if (name === "" || !path.startsWith("/")) return null;

  const mount = /^\/mnt\/([A-Za-z])(\/.*)?$/.exec(path);
  if (mount) {
    const rest = (mount[2] ?? "").replace(/\//g, "\\").replace(/\\+$/, "");
    return `${mount[1].toUpperCase()}:\\${rest.replace(/^\\/, "")}`;
  }

  const body = path.replace(/\/+$/, "").replace(/\//g, "\\");
  return `${WSL_UNC}${name}${body}`;
}

/** `9;` 로 시작하는 것만 우리 것 — OSC 9 는 iTerm2 의 알림(`9;<문구>`)으로도 쓰인다. `file://` 로 오면 OSC 7 파서에 넘긴다. */
export function parseOsc9Cwd(data: string): string | null {
  if (!data.startsWith("9;")) return null;
  const body = data.slice(2).trim();
  if (body === "") return null;
  if (body.toLowerCase().startsWith("file://")) return parseOsc7Cwd(body);
  return body;
}
