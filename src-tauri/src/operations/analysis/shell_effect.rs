//! 명령 분류 표(`READ` · `WRITE` · `DELETE` · `OPAQUE`) · 감싸개(`sudo` · `env` · `xargs` …) 해석 · 구획별 효과 판정과
//! 줄 나누기 없는 한 명령의 분석(`analyze_flat`).

use super::shell_lex::{split_shell, texts_of};
use super::types::{stronger, Computed, PlanAnalysis, ProgramToken, Verdict};

// ---------------------------------------------------------------------------
// 셸 명령
// ---------------------------------------------------------------------------

/// 읽기만 하는 프로그램(인자와 무관하게 — 갈래가 있는 것은 [`classify`] 에서 따로).
const READ: &[&str] = &[
    "ls", "ll", "la", "dir", "cat", "tac", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "ag", "zcat", "zgrep",
    "zless", "bzcat", "xzcat", "du", "df", "sort", "uniq", "wc", "cut", "tr", "column", "nl", "fold", "paste", "join", "comm", "diff",
    "cmp", "jq", "yq", "echo", "printf", "pwd", "whoami", "id", "groups", "hostname", "uname", "date", "uptime", "free",
    "vmstat", "iostat", "mpstat", "sar", "top", "ps", "pgrep", "pidof", "which", "whereis", "type", "stat", "file", "readlink",
    "realpath", "basename", "dirname", "printenv", "test", "[", "true", "false", "sleep", "md5sum", "sha1sum", "sha256sum",
    "sha512sum", "cksum", "tree", "nproc", "lscpu", "lsblk", "blkid", "lsof", "lsmod", "lspci", "lsusb", "dmesg", "last",
    "lastlog", "w", "who", "getent", "dig", "nslookup", "host", "ping", "traceroute", "tracepath", "mtr", "ss", "netstat",
    "findmnt", "cd", "export", "alias", "locate", "strings", "hexdump", "xxd", "od", "base64", "awk", "gawk", "mawk", "sed",
    "env", "seq", "yes", "timedatectl", "systemd-analyze", "lsattr", "getfacl", "namei", "cal", "tput", "clear", "whois", ":",
];

/// 쓰는(바꾸는) 프로그램.
const WRITE: &[&str] = &[
    "mv", "cp", "tee", "ln", "mkdir", "touch", "chmod", "chown", "chgrp", "chattr", "setfacl", "install", "rsync", "scp", "patch",
    "gzip", "gunzip", "bzip2", "bunzip2", "xz", "unxz", "zip", "unzip", "kill", "pkill", "killall", "reboot", "shutdown", "halt",
    "poweroff", "useradd", "usermod", "groupadd", "passwd", "chpasswd", "apt", "apt-get", "dpkg", "yum", "dnf", "rpm", "zypper",
    "apk", "pacman", "snap", "pip", "pip3", "npm", "yarn", "pnpm", "gem", "cargo", "iptables", "ip6tables", "nft", "ufw",
    "firewall-cmd", "hostnamectl", "localectl", "modprobe", "rmmod", "insmod", "swapoff", "swapon", "umount", "renice", "ldconfig",
    "update-alternatives", "certbot", "make", "logrotate",
];

/// 지우는(되돌릴 수 없는) 프로그램.
const DELETE: &[&str] = &["rm", "rmdir", "shred", "unlink", "srm", "wipefs", "truncate", "dd", "userdel", "groupdel", "fstrim", "blkdiscard"];

/// 셸을 하나 더 거쳐 안을 볼 수 없는 것 — 늘 확인 필요.
const OPAQUE: &[&str] = &["sh", "bash", "zsh", "dash", "ksh", "fish", "eval", "source", ".", "ssh", "python", "python3", "perl", "ruby", "node", "php", "lua"];

/// 경로를 뗀 이름(`/usr/bin/rm` → `rm`).
pub(super) fn base(word: &str) -> &str {
    word.rsplit('/').next().unwrap_or(word)
}

fn is_assignment(word: &str) -> bool {
    match word.split_once('=') {
        Some((name, _)) => !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !name.starts_with(|c: char| c.is_ascii_digit()),
        None => false,
    }
}

/// 짧은 플래그 묶음(`-xvf`)이 글자 `ch` 를 품는가.
pub(super) fn short_has(word: &str, ch: char) -> bool {
    word.starts_with('-') && !word.starts_with("--") && word.len() >= 2 && word[1..].contains(ch)
}

/// 구획 하나 → (프로그램 이름 · 근거 · sudo). 앞의 감싸개(`sudo` · `env` · `nohup` · `time` · `xargs` …)는 벗기고 그 뒤를 본다.
fn segment(words: &[String]) -> (Option<String>, Verdict, bool) {
    let s = segment_at(words);
    (s.prog, s.verdict, s.sudo)
}

/// [`segment_at`] 의 결과 — 프로그램 · 근거 · sudo 와 줄 안 표시가 칠할 낱말 색인들.
pub(super) struct SegScan {
    pub(super) prog: Option<String>,
    pub(super) verdict: Verdict,
    sudo: bool,
    /// 프로그램 낱말의 색인(감싸개를 벗긴 뒤 — 줄 안 표시가 그 낱말을 칠한다). 프로그램이 없으면 `None`.
    pub(super) at: Option<usize>,
    /// 권한 올리기 낱말(`sudo` · `doas` · `pkexec` · `su`)의 색인들 — 감싸개 사슬 안의 것만(인자 자리의 글자 `sudo` 는 아니다).
    pub(super) sudo_at: Vec<usize>,
}

/// [`segment`] + 낱말 색인들([`SegScan`]).
pub(super) fn segment_at(words: &[String]) -> SegScan {
    let mut i = 0usize;
    let mut sudo = false;
    let mut sudo_at: Vec<usize> = Vec::new();
    let done = |prog: Option<String>, verdict: Verdict, sudo: bool, at: Option<usize>, sudo_at: Vec<usize>| SegScan { prog, verdict, sudo, at, sudo_at };
    // 앞의 변수 대입 · 묶음 괄호.
    while i < words.len() && (is_assignment(&words[i]) || words[i] == "{" || words[i] == "}" || words[i] == "!") {
        i += 1;
    }
    loop {
        let Some(w) = words.get(i) else {
            return done(None, Verdict::read(), sudo, None, sudo_at);
        };
        let name = base(w);
        match name {
            "sudo" | "doas" | "pkexec" => {
                sudo = true;
                sudo_at.push(i);
                i += 1;
                // 플래그 — 값을 받는 것은 다음 낱말까지.
                while let Some(f) = words.get(i) {
                    if !f.starts_with('-') {
                        break;
                    }
                    let takes = matches!(f.as_str(), "-u" | "-g" | "-C" | "-D" | "-h" | "-p" | "-r" | "-t" | "-U" | "-T");
                    i += if takes { 2 } else { 1 };
                    if f == "--" {
                        break;
                    }
                }
            }
            "su" => {
                // `su -c '…'` 의 안은 문자열 하나 — 볼 수 없다.
                sudo_at.push(i);
                return done(Some("su".into()), Verdict::of(Computed::Unknown, "su"), true, Some(i), sudo_at);
            }
            "env" => {
                i += 1;
                while let Some(f) = words.get(i) {
                    if f.starts_with('-') || is_assignment(f) {
                        i += if matches!(f.as_str(), "-u" | "-C" | "-S") { 2 } else { 1 };
                    } else {
                        break;
                    }
                }
                if i >= words.len() {
                    return done(Some("env".into()), Verdict::read(), sudo, None, sudo_at);
                }
            }
            "nohup" | "time" | "command" | "exec" | "builtin" | "stdbuf" | "nice" | "ionice" | "chrt" | "taskset" | "unbuffer" | "watch" | "timeout" | "xargs" => {
                i += 1;
                while let Some(f) = words.get(i) {
                    if !f.starts_with('-') {
                        break;
                    }
                    // 값을 받는 짧은 플래그(`nice -n 10` · `xargs -I {}` · `watch -n 2` · `timeout -s KILL`).
                    let takes = f.len() == 2 && matches!(f.as_str(), "-n" | "-I" | "-P" | "-L" | "-d" | "-a" | "-s" | "-E" | "-c" | "-p" | "-k" | "-i" | "-o" | "-e");
                    i += if takes { 2 } else { 1 };
                }
                // `timeout 5 cmd` — 시간 낱말.
                if name == "timeout" && words.get(i).is_some_and(|d| d.chars().next().is_some_and(|c| c.is_ascii_digit())) {
                    i += 1;
                }
                if i >= words.len() {
                    // `xargs` 홀로는 `echo` 다 — 읽기. 나머지 감싸개도 홀로는 하는 일이 없다.
                    return done(Some(name.to_string()), Verdict::read(), sudo, None, sudo_at);
                }
            }
            _ => {
                let prog = name.to_string();
                let v = classify(&prog, &words[i + 1..]);
                return done(Some(prog), v, sudo, Some(i), sudo_at);
            }
        }
    }
}

/// 프로그램 하나 + 인자 → 근거. 갈래가 있는 프로그램(`find` · `git` · `sed` · `curl` …)은 인자를 본다.
fn classify(prog: &str, args: &[String]) -> Verdict {
    let has = |f: &str| args.iter().any(|a| a == f);
    let first_sub = || args.iter().find(|a| !a.starts_with('-')).map(String::as_str);
    match prog {
        "find" => {
            let mut v = Verdict::read();
            let mut k = 0usize;
            while k < args.len() {
                let a = args[k].as_str();
                match a {
                    "-delete" => v = stronger(v, Verdict::of(Computed::Delete, "find -delete")),
                    "-fprint" | "-fprint0" | "-fprintf" | "-fls" => v = stronger(v, Verdict::of(Computed::Write, format!("find {a}"))),
                    "-exec" | "-execdir" | "-ok" | "-okdir" => {
                        let end = args[k + 1..].iter().position(|x| x == ";" || x == "+").map_or(args.len(), |p| k + 1 + p);
                        let inner = &args[k + 1..end];
                        if !inner.is_empty() {
                            let (p, iv, _) = segment(inner);
                            if iv.effect != Computed::Read {
                                let cause = format!("find {a} {}", p.unwrap_or_default());
                                v = stronger(v, Verdict { effect: iv.effect, cause: Some(cause) });
                            }
                        }
                        k = end;
                    }
                    _ => {}
                }
                k += 1;
            }
            v
        }
        "git" => {
            // `git -C 폴더 · -c 키=값` 은 건너뛴다.
            let mut k = 0usize;
            while k < args.len() && args[k].starts_with('-') {
                k += if matches!(args[k].as_str(), "-C" | "-c") { 2 } else { 1 };
            }
            let sub = args.get(k).map(String::as_str).unwrap_or("");
            let rest = args.get(k + 1..).unwrap_or(&[]);
            let rest_has = |f: &str| rest.iter().any(|a| a == f);
            match sub {
                "" | "status" | "log" | "diff" | "show" | "blame" | "rev-parse" | "ls-files" | "ls-tree" | "ls-remote" | "describe" | "shortlog" | "grep" | "cat-file" | "show-ref" | "rev-list" | "version" | "help" => Verdict::read(),
                "clean" => Verdict::of(Computed::Delete, "git clean"),
                "reset" if rest_has("--hard") => Verdict::of(Computed::Delete, "git reset --hard"),
                // 근거는 적힌 플래그 그대로(`-D` · `-d` · `--delete`) — 줄 안 표시가 그 낱말을 찾는다.
                "branch" if rest_has("-D") || rest_has("-d") || rest_has("--delete") => {
                    let f = rest.iter().find(|a| matches!(a.as_str(), "-D" | "-d" | "--delete")).map_or("-d", String::as_str);
                    Verdict::of(Computed::Delete, format!("git branch {f}"))
                }
                // 목록만 보는 꼴(플래그뿐) — `git branch -a` · `git remote -v` · `git tag -l`.
                "branch" | "remote" | "tag" if rest.iter().all(|a| a.starts_with('-')) => Verdict::read(),
                other => Verdict::of(Computed::Write, format!("git {other}")),
            }
        }
        "docker" | "podman" => {
            let sub = first_sub().unwrap_or("");
            let second = args.iter().filter(|a| !a.starts_with('-')).nth(1).map(String::as_str).unwrap_or("");
            match sub {
                "" | "ps" | "images" | "logs" | "inspect" | "stats" | "top" | "version" | "info" | "port" | "history" | "diff" | "events" | "search" => Verdict::read(),
                "rm" | "rmi" => Verdict::of(Computed::Delete, format!("{prog} {sub}")),
                "system" | "volume" | "image" | "container" | "network" | "builder" if matches!(second, "prune" | "rm" | "remove") => {
                    Verdict::of(Computed::Delete, format!("{prog} {sub} {second}"))
                }
                "system" | "volume" | "image" | "container" | "network" if matches!(second, "ls" | "list" | "inspect" | "df" | "info") => Verdict::read(),
                other => Verdict::of(Computed::Write, format!("{prog} {other}")),
            }
        }
        "kubectl" | "oc" => match first_sub().unwrap_or("") {
            "" | "get" | "describe" | "logs" | "top" | "explain" | "version" | "api-resources" | "api-versions" | "cluster-info" | "auth" | "diff" => Verdict::read(),
            "delete" => Verdict::of(Computed::Delete, format!("{prog} delete")),
            other => Verdict::of(Computed::Write, format!("{prog} {other}")),
        },
        "systemctl" => match first_sub().unwrap_or("") {
            "" | "status" | "show" | "cat" | "is-active" | "is-enabled" | "is-failed" | "is-system-running" | "list-units" | "list-unit-files" | "list-timers" | "list-sockets" | "list-dependencies" | "list-jobs" | "help" => Verdict::read(),
            other => Verdict::of(Computed::Write, format!("systemctl {other}")),
        },
        "service" => match args.get(1).map(String::as_str) {
            Some("status") | None => Verdict::read(),
            Some(other) => Verdict::of(Computed::Write, format!("service {other}")),
        },
        "journalctl" => {
            if args.iter().any(|a| a.starts_with("--vacuum")) {
                Verdict::of(Computed::Delete, "journalctl --vacuum")
            } else if has("--rotate") || has("--flush") {
                Verdict::of(Computed::Write, "journalctl --rotate")
            } else {
                Verdict::read()
            }
        }
        "sed" => {
            if args.iter().any(|a| a == "--in-place" || a.starts_with("--in-place=") || short_has(a, 'i')) {
                Verdict::of(Computed::Write, "sed -i")
            } else {
                Verdict::read()
            }
        }
        "awk" | "gawk" if args.windows(2).any(|w| w[0] == "-i" && w[1] == "inplace") => Verdict::of(Computed::Write, "awk -i inplace"),
        "sort" if args.iter().any(|a| a == "-o" || a.starts_with("--output") || (short_has(a, 'o') && a.ends_with('o'))) => Verdict::of(Computed::Write, "sort -o"),
        "curl" => {
            let mut v = Verdict::read();
            let mut k = 0usize;
            while k < args.len() {
                let a = args[k].as_str();
                // 출력을 `/dev/null` 로 — 버리는 것이지 쓰는 것이 아니다(`-o /dev/null` · `--output /dev/null` · `--output=/dev/null` ·
                // 끝 글자가 `o` 인 묶음 `-sSo /dev/null`). 값 낱말까지 먹는다. 묶음의 나머지 글자는 그대로 본다.
                if a == "--output=/dev/null" {
                    k += 1;
                    continue;
                }
                let short = a.starts_with('-') && !a.starts_with("--") && a.len() >= 2;
                if args.get(k + 1).is_some_and(|n| n == "/dev/null") && (a == "--output" || (short && a.ends_with('o'))) {
                    let rest = if short { &a[1..a.len() - 1] } else { "" };
                    if rest.chars().any(|c| matches!(c, 'o' | 'O' | 'T' | 'd' | 'F')) {
                        v = stronger(v, Verdict::of(Computed::Write, format!("curl {a}")));
                    }
                    k += 2;
                    continue;
                }
                let writes = matches!(a, "-o" | "-O" | "--output" | "--remote-name" | "--remote-name-all" | "-T" | "--upload-file" | "-d" | "-F" | "--form" | "--json")
                    || a.starts_with("--data")
                    || a.starts_with("--output=")
                    || (a.starts_with('-') && !a.starts_with("--") && a[1..].chars().any(|c| matches!(c, 'o' | 'O' | 'T' | 'd' | 'F')));
                if writes {
                    v = stronger(v, Verdict::of(Computed::Write, format!("curl {a}")));
                }
                if a == "-X" || a == "--request" {
                    let m = args.get(k + 1).map(|s| s.to_ascii_uppercase()).unwrap_or_default();
                    if m != "GET" && m != "HEAD" {
                        v = stronger(v, Verdict::of(Computed::Write, format!("curl -X {m}")));
                    }
                    k += 1;
                }
                k += 1;
            }
            v
        }
        "openssl" => {
            // 파일로 쓰는 꼴(`-out` · `-keyout`)이 먼저 — 하위 명령과 무관하게 쓰기.
            if let Some(a) = args.iter().find(|a| *a == "-out" || *a == "-keyout" || a.starts_with("-out=")) {
                // 근거는 적힌 플래그(`-out` · `-keyout` — `-out=x` 는 `-out`).
                let f = if a == "-keyout" { "-keyout" } else { "-out" };
                return Verdict::of(Computed::Write, format!("openssl {f}"));
            }
            match first_sub() {
                Some("s_client" | "x509" | "verify" | "version" | "ciphers" | "s_time" | "crl" | "asn1parse" | "dgst" | "list" | "errstr" | "sess_id") => Verdict::read(),
                // 표 밖(`req` · `rsa` · `pkey` · `enc` · 대화형 홀로 …) — 확인 필요.
                Some(sub) => Verdict::of(Computed::Unknown, format!("openssl {sub}")),
                None => Verdict::of(Computed::Unknown, "openssl"),
            }
        }
        // 포트 훑기(`-z`)만 읽기 — 그 밖에는 데이터를 보낼 수 있다.
        "nc" | "ncat" | "netcat" => {
            if args.iter().any(|a| short_has(a, 'z')) {
                Verdict::read()
            } else {
                Verdict::of(Computed::Unknown, prog.to_string())
            }
        }
        "tcpdump" => {
            if args.iter().any(|a| short_has(a, 'w')) {
                Verdict::of(Computed::Write, "tcpdump -w")
            } else {
                Verdict::read()
            }
        }
        "wget" => {
            let to_stdout = args.windows(2).any(|w| w[0] == "-O" && w[1] == "-") || args.iter().any(|a| a == "-O-" || a == "-qO-" || a == "--spider" || a == "--output-document=-");
            if to_stdout {
                Verdict::read()
            } else {
                Verdict::of(Computed::Write, "wget")
            }
        }
        "tar" => {
            // 목록 보기 — `--list` · `-t…` 묶음 · 대시 없는 첫 묶음(`tar tzf a.tgz`).
            let lists = has("--list")
                || args.iter().any(|a| short_has(a, 't'))
                || args.first().is_some_and(|a| !a.starts_with('-') && a.chars().all(|c| c.is_ascii_alphabetic()) && a.contains('t'));
            if lists {
                Verdict::read()
            } else {
                Verdict::of(Computed::Write, "tar")
            }
        }
        "ip" => {
            if args.iter().any(|a| matches!(a.as_str(), "add" | "del" | "delete" | "set" | "flush" | "change" | "replace" | "append")) {
                Verdict::of(Computed::Write, "ip")
            } else {
                Verdict::read()
            }
        }
        "mount" => {
            if args.iter().all(|a| a.starts_with('-')) {
                Verdict::read()
            } else {
                Verdict::of(Computed::Write, "mount")
            }
        }
        "crontab" => {
            if has("-r") {
                Verdict::of(Computed::Delete, "crontab -r")
            } else if has("-l") {
                Verdict::read()
            } else {
                Verdict::of(Computed::Write, "crontab")
            }
        }
        "sysctl" => {
            if args.iter().any(|a| a == "-w" || a == "-p" || (!a.starts_with('-') && a.contains('='))) {
                Verdict::of(Computed::Write, "sysctl")
            } else {
                Verdict::read()
            }
        }
        "nginx" | "apachectl" | "httpd" => {
            if args.iter().any(|a| matches!(a.as_str(), "-t" | "-T" | "-v" | "-V" | "configtest" | "-S")) && !has("-s") {
                Verdict::read()
            } else {
                Verdict::of(Computed::Write, prog.to_string())
            }
        }
        _ => {
            if DELETE.contains(&prog) || prog.starts_with("mkfs") {
                Verdict::of(Computed::Delete, prog.to_string())
            } else if WRITE.contains(&prog) {
                Verdict::of(Computed::Write, prog.to_string())
            } else if READ.contains(&prog) && !OPAQUE.contains(&prog) {
                Verdict::read()
            } else {
                // 표 밖 · 안을 볼 수 없는 것(`OPAQUE`) — 확인 필요.
                Verdict::of(Computed::Unknown, prog.to_string())
            }
        }
    }
}

/// 줄 나누기 없는 분석 — [`analyze_command`] 의 몸이자 줄 하나의 분석.
pub(super) fn analyze_flat(cmd: &str) -> PlanAnalysis {
    let split = split_shell(cmd);
    let mut programs = Vec::new();
    let mut tokens = Vec::new();
    let mut sudo = false;
    let mut verdict = Verdict::read();
    for seg in &split.segments {
        let (prog, v, s) = segment(&texts_of(seg));
        sudo |= s;
        if let Some(p) = prog {
            // 효과를 낸 꼴이 이 프로그램으로 시작하면 그 꼴을(`find -delete` · `sed -i` · `git reset --hard`), 아니면 이름만.
            let text = match &v.cause {
                Some(c) if c.starts_with(p.as_str()) => c.clone(),
                _ => p.clone(),
            };
            tokens.push(ProgramToken { text, effect: v.effect, special: false });
            programs.push(p);
        }
        verdict = stronger(verdict, v);
    }
    for sp in &split.specials {
        if let Some(c) = &sp.cause {
            tokens.push(ProgramToken { text: c.clone(), effect: sp.effect, special: true });
        }
    }
    verdict = stronger(verdict, split.extra);
    if split.segments.is_empty() && verdict.effect == Computed::Read {
        // 빈 명령 — 무엇을 하는지 알 수 없다.
        verdict = Verdict::of(Computed::Unknown, "?");
    }
    PlanAnalysis {
        effect: verdict.effect,
        cause: verdict.cause,
        programs,
        tokens,
        sudo,
        statements: Vec::new(),
        lines: Vec::new(),
    }
}
