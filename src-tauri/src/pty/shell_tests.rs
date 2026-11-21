use super::*;

fn argv(cmd: &CommandBuilder) -> Vec<String> {
    cmd.get_argv()
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect()
}

fn argv_of(id: &str) -> Vec<String> {
    argv(&shell_command(id, None, false).expect("알려진 id 인데 매핑에 실패했다"))
}

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
    assert_eq!(argv_of("gitbash"), [git_bash_exe(), "--login", "-i"]);
}

#[test]
fn gitbash_with_a_hook_swaps_login_for_rcfile() {
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

    let both = has(&[GIT_BASH, r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe"]);
    assert_eq!(find(&both, ""), Some(PathBuf::from(GIT_BASH)));
    let user = has(&[r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe"]);
    assert_eq!(find(&user, ""), Some(PathBuf::from(r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe")));
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
    assert_eq!(
        argv_of("wsl:Ubuntu-24.04"),
        ["wsl.exe", "-d", "Ubuntu-24.04"]
    );
    assert_eq!(argv_of("wsl:My Distro"), ["wsl.exe", "-d", "My Distro"]);
}

#[test]
fn unknown_ids_are_rejected() {
    for id in ["", "bash", "wsl", "wsl:", "pwsh.exe", "powershell -c calc"] {
        assert!(shell_command(id, None, false).is_err(), "{id:?} 를 받아들였다");
    }
}

#[test]
fn powershell_ids_dot_source_the_integration_script() {
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
    let path = r"C:\Users\me\AppData\Roaming\aynx\integration.ps1";
    let dot = r". 'C:\Users\me\AppData\Roaming\aynx\integration.ps1'";
    assert_eq!(
        argv(&shell_command("powershell", Some(path), true).unwrap()),
        ["powershell.exe", "-ExecutionPolicy", "RemoteSigned", "-NoExit", "-Command", dot]
    );
    assert_eq!(argv(&shell_command("powershell", None, true).unwrap()), ["powershell.exe"]);
    // PowerShell 7 은 대상이 아니다(기본 RemoteSigned).
    assert_eq!(
        argv(&shell_command("pwsh", Some(path), true).unwrap()),
        ["pwsh.exe", "-NoExit", "-Command", dot]
    );
}

#[test]
fn cmd_never_gets_a_hook() {
    let path = r"C:\cfg\aynx\integration.ps1";
    assert_eq!(argv_with("cmd", path), argv_of("cmd"));
}

#[test]
fn wsl_with_a_hook_goes_through_sh_c() {
    let rc = "/mnt/c/Users/wl/AppData/Roaming/aynx/integration-wsl.rc";
    let argv = argv_with("wsl:Ubuntu-24.04", rc);
    assert_eq!(&argv[..5], ["wsl.exe", "-d", "Ubuntu-24.04", "--", "sh"]);
    assert_eq!(argv[5], "-c");
    assert_eq!(argv[6], crate::shell_integration::wsl_launch_script(rc));
    assert_eq!(argv.len(), 7);
    assert_eq!(argv_with("wsl:My Distro", rc)[2], "My Distro");
}

#[test]
fn utf16le_decodes_with_and_without_bom() {
    assert_eq!(decode_utf16le(&[0x41, 0x00, 0x42, 0x00]), "AB");
    assert_eq!(decode_utf16le(&[0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00]), "AB");
    assert_eq!(decode_utf16le(&[0x41, 0x00, 0x42]), "A");
    assert_eq!(decode_utf16le(&[]), "");
    assert_eq!(decode_utf16le(&[0x00, 0xAC]), "가");
}

fn utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

#[test]
fn wsl_list_drops_blanks_and_docker_entries() {
    let raw = utf16le("Ubuntu-24.04\r\ndocker-desktop\r\n");
    assert_eq!(parse_wsl_list(&raw), ["Ubuntu-24.04"]);

    let with_bom = {
        let mut v = vec![0xFF, 0xFE];
        v.extend(utf16le("Ubuntu\r\n\r\ndocker-desktop-data\r\nDebian\r\n"));
        v
    };
    assert_eq!(parse_wsl_list(&with_bom), ["Ubuntu", "Debian"]);

    assert_eq!(
        parse_wsl_list(&utf16le("Alpine\nUbuntu")),
        ["Alpine", "Ubuntu"]
    );
    assert!(parse_wsl_list(&utf16le("\r\n")).is_empty());
    assert!(parse_wsl_list(&[]).is_empty());
}

#[test]
fn listed_shells_are_all_openable() {
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
                assert_eq!(id, if which_pwsh() { "pwsh" } else { "powershell" });
                assert_eq!(
                    list.shells.first().map(|s| s.id.as_str()),
                    Some(id.as_str())
                );
            }
        }
        None => {
            #[cfg(windows)]
            panic!("Windows 는 언제나 기본 셸을 고른다");
        }
    }
}
