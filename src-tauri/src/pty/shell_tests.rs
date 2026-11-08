use super::*;

/// CommandBuilder 의 argv 를 문자열 벡터로 (비교하기 쉽게).
fn argv(cmd: &CommandBuilder) -> Vec<String> {
    cmd.get_argv()
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect()
}

/// 훅 **없이** 본 argv — 이 기능이 생기기 전과 같은 모양이어야 한다.
fn argv_of(id: &str) -> Vec<String> {
    argv(&shell_command(id, None, false).expect("알려진 id 인데 매핑에 실패했다"))
}

/// 훅 경로를 준 argv.
fn argv_with(id: &str, path: &str) -> Vec<String> {
    argv(&shell_command(id, Some(path), false).expect("알려진 id 인데 매핑에 실패했다"))
}

#[test]
fn known_ids_map_to_their_exe() {
    assert_eq!(argv_of("pwsh"), ["pwsh.exe"]);
    assert_eq!(argv_of("powershell"), ["powershell.exe"]);
    assert_eq!(argv_of("cmd"), ["cmd.exe"]);
}

#[test]
fn gitbash_uses_absolute_path_and_login_shell() {
    // 훅이 없을 때(파일을 못 썼다 · 설정으로 껐다)는 이 기능이 생기기 전 그대로다.
    assert_eq!(argv_of("gitbash"), [git_bash_exe(), "--login", "-i"]);
}

#[test]
fn gitbash_with_a_hook_swaps_login_for_rcfile() {
    // `--login` 과 `--rcfile` 은 함께 못 쓴다 — bash 는 rcfile 을 대화형 non-login
    // 셸에서만 본다. 그래서 로그인 순서는 rc 가 대신 읽는다.
    let rc = "/c/Users/wl/AppData/Roaming/aynx/integration-gitbash.rc";
    assert_eq!(argv_with("gitbash", rc), [git_bash_exe(), "--rcfile", rc, "-i"]);
    assert!(!argv_with("gitbash", rc).contains(&"--login".to_string()));
}

#[cfg(windows)]
#[test]
fn git_bash_is_found_beyond_the_system_install() {
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};
    let has = |files: &[&str]| -> HashSet<PathBuf> { files.iter().map(PathBuf::from).collect() };
    let local = Path::new(r"C:\Users\me\AppData\Local");
    let find = |files: &HashSet<PathBuf>, path: &str| {
        let path = OsString::from(path);
        find_git_bash(Some(local), Some(&path), &|p| files.contains(p))
    };

    // 시스템 범위가 먼저다.
    let both = has(&[GIT_BASH, r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe"]);
    assert_eq!(find(&both, ""), Some(PathBuf::from(GIT_BASH)));
    // 사용자 범위 설치("Only for me").
    let user = has(&[r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe"]);
    assert_eq!(find(&user, ""), Some(PathBuf::from(r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe")));
    // PATH 의 git.exe 에서 거슬러 올라간 뿌리 — `cmd` 한 칸 · `mingw64\bin` 두 칸.
    let scoop = has(&[r"D:\scoop\apps\git\current\cmd\git.exe", r"D:\scoop\apps\git\current\bin\bash.exe"]);
    assert_eq!(
        find(&scoop, r"C:\Windows\System32;D:\scoop\apps\git\current\cmd"),
        Some(PathBuf::from(r"D:\scoop\apps\git\current\bin\bash.exe"))
    );
    let mingw = has(&[r"E:\Git\mingw64\bin\git.exe", r"E:\Git\bin\bash.exe"]);
    assert_eq!(find(&mingw, r"E:\Git\mingw64\bin"), Some(PathBuf::from(r"E:\Git\bin\bash.exe")));
    // PATH 의 bash.exe 는 보지 않는다 — System32 의 것은 WSL 이다.
    let wsl = has(&[r"C:\Windows\System32\bash.exe"]);
    assert_eq!(find(&wsl, r"C:\Windows\System32"), None);
}

#[test]
fn wsl_id_carries_the_distro_as_a_separate_arg() {
    // 배포판 이름은 반드시 별도 argv 원소여야 한다 (공백·하이픈이 있어도 안전).
    assert_eq!(
        argv_of("wsl:Ubuntu-24.04"),
        ["wsl.exe", "-d", "Ubuntu-24.04"]
    );
    assert_eq!(argv_of("wsl:My Distro"), ["wsl.exe", "-d", "My Distro"]);
}

#[test]
fn unknown_ids_are_rejected() {
    // 낡거나 손상된 id 로 엉뚱한 실행 파일이 돌면 안 된다.
    for id in ["", "bash", "wsl", "wsl:", "pwsh.exe", "powershell -c calc"] {
        assert!(shell_command(id, None, false).is_err(), "{id:?} 를 받아들였다");
    }
}

#[test]
fn powershell_ids_dot_source_the_integration_script() {
    // PowerShell 은 `Set-Location` 으로 프로세스 cwd 를 바꾸지 않는다 — 그래서 이 셋만
    // 훅을 받는다 (`-NoProfile` 은 **없다**: 사용자 프로파일이 그대로 돌아야 한다).
    let path = r"C:\Users\o'brien\AppData\Roaming\aynx\integration.ps1";
    let dot = r". 'C:\Users\o''brien\AppData\Roaming\aynx\integration.ps1'";
    assert_eq!(
        argv_with("pwsh", path),
        ["pwsh.exe", "-NoExit", "-Command", dot]
    );
    assert_eq!(
        argv_with("powershell", path),
        ["powershell.exe", "-NoExit", "-Command", dot]
    );
}

#[test]
fn restricted_powershell_51_gets_remote_signed_only_with_a_hook() {
    // 깨끗한 PC 의 5.1 기본 Restricted 가 점 소싱을 막던 것(`crate::ps_policy`) — 프로세스 범위 RemoteSigned 를 맨 앞에.
    let path = r"C:\Users\me\AppData\Roaming\aynx\integration.ps1";
    let dot = r". 'C:\Users\me\AppData\Roaming\aynx\integration.ps1'";
    assert_eq!(
        argv(&shell_command("powershell", Some(path), true).unwrap()),
        ["powershell.exe", "-ExecutionPolicy", "RemoteSigned", "-NoExit", "-Command", dot]
    );
    // 훅이 없으면 실을 스크립트가 없다 — 인자도 없다(이 기능 전과 바이트가 같다).
    assert_eq!(argv(&shell_command("powershell", None, true).unwrap()), ["powershell.exe"]);
    // PowerShell 7 은 대상이 아니다(기본 RemoteSigned · 정책이 레지스트리에 없다).
    assert_eq!(
        argv(&shell_command("pwsh", Some(path), true).unwrap()),
        ["pwsh.exe", "-NoExit", "-Command", dot]
    );
}

#[test]
fn cmd_never_gets_a_hook() {
    // cmd 에는 preexec/postexec 가 **원리적으로 없다** (설계 결정 4) — 훅 경로를 줘도
    // argv 가 달라지지 않는다. 그 타일의 폴더는 여전히 PEB(`crate::cwd`)가 답한다.
    let path = r"C:\cfg\aynx\integration.ps1";
    assert_eq!(argv_with("cmd", path), argv_of("cmd"));
}

#[test]
fn wsl_with_a_hook_goes_through_sh_c() {
    // 훅이 있으면 `sh -c` 한 겹을 거쳐 배포판 **안에서** `$SHELL` 을 본다.
    let rc = "/mnt/c/Users/wl/AppData/Roaming/aynx/integration-wsl.rc";
    let argv = argv_with("wsl:Ubuntu-24.04", rc);
    assert_eq!(&argv[..5], ["wsl.exe", "-d", "Ubuntu-24.04", "--", "sh"]);
    assert_eq!(argv[5], "-c");
    assert_eq!(argv[6], crate::shell_integration::wsl_launch_script(rc));
    assert_eq!(argv.len(), 7);
    // 배포판 이름은 여전히 별도 원소다 (공백이 있어도 안전).
    assert_eq!(argv_with("wsl:My Distro", rc)[2], "My Distro");
}

#[test]
fn utf16le_decodes_with_and_without_bom() {
    // "AB" = 41 00 42 00
    assert_eq!(decode_utf16le(&[0x41, 0x00, 0x42, 0x00]), "AB");
    assert_eq!(decode_utf16le(&[0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00]), "AB");
    // 홀수로 남은 꼬리 바이트는 버린다 (패닉하지 않는다).
    assert_eq!(decode_utf16le(&[0x41, 0x00, 0x42]), "A");
    assert_eq!(decode_utf16le(&[]), "");
    // 한글도 그대로 (가 = U+AC00)
    assert_eq!(decode_utf16le(&[0x00, 0xAC]), "가");
}

/// 문자열을 실기 wsl.exe 처럼 UTF-16LE 바이트로 만든다.
fn utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

#[test]
fn wsl_list_drops_blanks_and_docker_entries() {
    // 실기(`wsl -l -q`) 출력 형태: BOM 없음 · CRLF · UTF-16LE
    let raw = utf16le("Ubuntu-24.04\r\ndocker-desktop\r\n");
    assert_eq!(parse_wsl_list(&raw), ["Ubuntu-24.04"]);

    let with_bom = {
        let mut v = vec![0xFF, 0xFE];
        v.extend(utf16le("Ubuntu\r\n\r\ndocker-desktop-data\r\nDebian\r\n"));
        v
    };
    assert_eq!(parse_wsl_list(&with_bom), ["Ubuntu", "Debian"]);

    // LF 만 있어도, 아무것도 없어도 깨지지 않는다.
    assert_eq!(
        parse_wsl_list(&utf16le("Alpine\nUbuntu")),
        ["Alpine", "Ubuntu"]
    );
    assert!(parse_wsl_list(&utf16le("\r\n")).is_empty());
    assert!(parse_wsl_list(&[]).is_empty());
}

#[test]
fn listed_shells_are_all_openable() {
    // 목록에 넣은 id 는 전부 shell_command 가 알아봐야 한다 (계약 일치).
    // 명령([`list_shells`])은 이제 블로킹 풀 래퍼일 뿐이라 알맹이를 바로 부른다 —
    // 테스트에 Tauri 런타임을 세울 이유가 없다.
    let shells = list_shells_blocking();
    assert!(
        shells.iter().any(|s| s.id == "powershell"),
        "Windows PowerShell 이 목록에 없다"
    );
    for shell in &shells {
        assert!(
            shell_command(&shell.id, None, false).is_ok(),
            "목록에 있는데 열 수 없는 id: {}",
            shell.id
        );
        assert!(
            !shell.label.is_empty(),
            "{} 의 표시 이름이 비었다",
            shell.id
        );
    }
}

#[test]
fn os_default_is_openable_and_listed() {
    // 프런트는 이 값을 "처음부터 골라져 있는 셸" 로 보여 준다 — 목록에 없거나 열 수
    // 없는 id 면 설정 드롭다운이 아무것도 안 고른 채로 뜬다.
    let list = shell_list_blocking();
    match list.default_id {
        Some(id) => {
            assert!(
                shell_command(&id, None, false).is_ok(),
                "기본으로 고른 {id} 를 열 수 없다"
            );
            assert!(
                list.shells.iter().any(|s| s.id == id),
                "기본으로 고른 {id} 가 목록에 없다"
            );
            #[cfg(windows)]
            {
                // Windows 의 규칙: pwsh 가 있으면 pwsh, 없으면 Windows PowerShell.
                assert_eq!(id, if which_pwsh() { "pwsh" } else { "powershell" });
                // 목록의 첫 항목이기도 하다 (프런트가 순서에 기대지는 않는다).
                assert_eq!(
                    list.shells.first().map(|s| s.id.as_str()),
                    Some(id.as_str())
                );
            }
        }
        // 아직 구현하지 않은 OS 의 스텁 — Windows 에서는 여기 오면 안 된다.
        None => {
            #[cfg(windows)]
            panic!("Windows 는 언제나 기본 셸을 고른다");
        }
    }
}
