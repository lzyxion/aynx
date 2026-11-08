//! 자동 승인 **묶음 프리셋**(bundle) — 순수 데이터 한 장의 **백엔드 쌍둥이**
//! (docs/log/2026-09-16-auto-approval-bundles.md).
//!
//! ## 왜 Rust 에도 같은 표가 있나 (경계는 백엔드다)
//!
//! 승인은 Tauri 명령 하나(`approve_operation`)로 들어오고, 자동 경로는 [`crate::policy`] 가
//! **독립적으로 다시** 판정한다. 그 판정이 보는 allowlist 는 사용자가 적은 `[[automation.allow]]`
//! **와 켜진 묶음이 펼친 규칙의 합집합**이다 — 즉 백엔드가 묶음을 스스로 펼칠 수 있어야 한다.
//! 프런트가 펼쳐서 보내 주는 구조였다면 프런트 버그·조작이 곧 범위 확장이 된다.
//!
//! ## 불변 (바닥은 그대로다)
//!
//! 묶음은 **기본 거부를 넓히지 않는다**. `[automation] bundles` 에 id 를 적는 것은 사람이고
//! (MCP 는 읽기 전용이라 AI 는 이 값을 바꿀 수 없다), 켠 뒤에도 규칙은 여전히 위험 배제 ·
//! 구획 분해 · 상한 · 빈도 한도라는 같은 문을 통과해야 한다. 묶음 안의 **명령 끄기**
//! (`[automation.bundle_off]`)는 좁히기만 한다 — 그 칸이 무엇을 적든 묶음보다 넓어지지 않는다.
//!
//! ## ⚠️ 묶음을 더하거나 규칙을 넓히는 것은 **보안 검토**다
//!
//! 여기 한 줄이 늘면 그 묶음을 켠 모든 사용자의 무인 실행 범위가 늘어난다. 새 항목은 세
//! 질문을 전부 통과해야 한다: ①읽기·관찰 전용인가 ②인자 하나로 쓰기가 되지 않는가
//! ③비밀을 뱉지 않는가. 그래서 **뺀 것들**: `find`(`-delete`·`-exec` 가 인자다) ·
//! `env`/`printenv`(토큰·비밀번호를 찍는다) · `top`(대화형이라 무인 경로에서 화면만 잡는다).
//!
//! ## 드리프트 잠금
//!
//! `src/lib/automation-presets.ts` 의 `BUNDLES` 와 **id·이름·설명·규칙·순서까지 같다**.
//! `automation-presets.test.ts`(vitest)가 **이 파일을 읽어** 두 표를 비교하므로, 한쪽만
//! 고치면 게이트가 깨진다. 그 파서가 기대하는 모양이라 아래 표의 **서식을 흐트러뜨리지 말 것**
//! (한 규칙 = 한 줄 `rule("exec", &["sub", …])` + 체인 `.deny(&[…])`·`.allow(&[…])`·
//! `.require(&[…])`·`.first_arg(&[…])`·`.max_args(n)`·`.key("…")`·`.any_order()`, 배열은 인라인
//! 리터럴 — 상수 이름을 쓰면 파서가 못 읽는다, 문자열은 한 줄짜리 리터럴). 표에 `#[rustfmt::skip]`
//! 이 붙은 이유도 이것이다.
//!
//! ## 인자 제약 (2026-10-05)
//!
//! 규칙은 exec+서브커맨드에 더해 **인자까지** 말한다(`AllowRule` 문서 "인자 제약"). 표에 새 줄을
//! 넣을 때는 ②번 질문을 "그 서브커맨드 뒤에 무엇이 와도 읽기인가" 로 읽고, 아니면 제약을 단다
//! (docs/log/2026-10-05-auto-approve-args.md).
//!
//! ## 세분화 (2026-10-05)
//!
//! 예전 두 묶음(`diag-readonly`·`git-readonly`)을 열 개로 나눴다 — 한 명령은 한 묶음에만 있다.
//! 묶음 안의 규칙은 **명령 키**([`PresetRule::command_key`])로 묶이고, 사용자는 묶음을 켠 채
//! 명령 하나만 끌 수 있다(`[automation.bundle_off]`). 옛 id 는 읽을 때 새 id 로 옮기되 **넓어지지
//! 않게** 옛 묶음에 없던 명령은 꺼 둔 채로 옮긴다([`migrate_legacy_bundles`]).
//!
//! **서브커맨드는 exec 바로 뒤** — 묶음 규칙은 서브커맨드가 있으면 그 낱말이 exec 바로 다음이어야
//! 한다(`sub_first`). 앞 플래그의 **값**이 서브커맨드로 위장하는 꼴(`git -C status push` = `status`
//! 디렉터리에서 `git push` · `kubectl -n describe delete pod x` · `docker -c ps rm x`)을 막는다.
//! 허용 플래그가 값 없는 출력 모양뿐인 `ip` 만 `.any_order()` 로 예외다(`ip -br addr`).

use std::collections::BTreeMap;

use crate::settings::{AllowRule, AutomationPrefs};

/// 묶음이 얹는 규칙 하나 — 사용자 규칙([`AllowRule`])과 **같은 칸**의 정적 쌍둥이.
///
/// `subcommands` 가 비면 서브커맨드 개념이 없다는 뜻이고, 나머지 다섯 칸(인자 제약)은 비어 있으면
/// 제약이 없다(`matches_structured_allow` · `AllowRule` 문서 "인자 제약"). 표에서는
/// [`rule`] + 체인(`.deny(…)` · `.allow(…)` · `.require(…)` · `.first_arg(…)` · `.max_args(n)` ·
/// `.key(…)` · `.any_order()`)으로 적는다.
#[derive(Clone, Copy)]
pub(crate) struct PresetRule {
    pub exec: &'static str,
    pub subcommands: &'static [&'static str],
    pub deny_flags: &'static [&'static str],
    pub allow_flags: &'static [&'static str],
    pub require_flags: &'static [&'static str],
    pub first_arg: &'static [&'static str],
    pub max_args: Option<u32>,
    /// 명령 키를 직접 정할 때만 — 없으면 [`command_key`](Self::command_key) 의 기본 규칙.
    pub key: Option<&'static str>,
    /// 서브커맨드 앞에 플래그가 와도 되는가 — 기본 `false`(서브커맨드는 exec 바로 뒤).
    pub any_order: bool,
}

/// 제약 없는 규칙 — 표의 한 줄은 여기서 시작한다.
pub(crate) const fn rule(
    exec: &'static str,
    subcommands: &'static [&'static str],
) -> PresetRule {
    PresetRule {
        exec,
        subcommands,
        deny_flags: &[],
        allow_flags: &[],
        require_flags: &[],
        first_arg: &[],
        max_args: None,
        key: None,
        any_order: false,
    }
}

impl PresetRule {
    /// 어디에든 있으면 불허하는 플래그들.
    pub(crate) const fn deny(self, flags: &'static [&'static str]) -> Self {
        Self {
            deny_flags: flags,
            ..self
        }
    }
    /// 이 플래그들만 허용.
    pub(crate) const fn allow(self, flags: &'static [&'static str]) -> Self {
        Self {
            allow_flags: flags,
            ..self
        }
    }
    /// 반드시 있어야 하는 플래그들.
    pub(crate) const fn require(self, flags: &'static [&'static str]) -> Self {
        Self {
            require_flags: flags,
            ..self
        }
    }
    /// 서브커맨드 뒤 첫 인자는 없거나 이 중 하나.
    pub(crate) const fn first_arg(self, words: &'static [&'static str]) -> Self {
        Self {
            first_arg: words,
            ..self
        }
    }
    /// 서브커맨드 뒤 비플래그 인자 수 상한.
    pub(crate) const fn max_args(self, n: u32) -> Self {
        Self {
            max_args: Some(n),
            ..self
        }
    }
    /// 명령 키를 직접 정한다(같은 명령의 다른 꼴을 한 스위치로 묶을 때).
    pub(crate) const fn key(self, key: &'static str) -> Self {
        Self {
            key: Some(key),
            ..self
        }
    }
    /// 서브커맨드 앞 플래그를 받는다 — 허용 플래그가 값 없는 것뿐일 때만 쓴다(`ip`).
    pub(crate) const fn any_order(self) -> Self {
        Self {
            any_order: true,
            ..self
        }
    }

    /// **명령 키** — `[automation.bundle_off]` 에 적히는 안정된 이름. **바뀌면 안 된다**.
    ///
    /// `.key("…")` 가 있으면 그것, 없으면 서브커맨드가 **하나**일 때 `exec sub`(`docker logs` ·
    /// `ip addr`), 아니면 `exec`(`tail` · `systemctl` · `apt`). 같은 키의 규칙이 여럿이면 한 스위치다.
    /// TS `commandKey` 와 같은 규칙이다.
    pub(crate) fn command_key(&self) -> String {
        if let Some(k) = self.key {
            return k.to_string();
        }
        match self.subcommands {
            [one] => format!("{} {one}", self.exec),
            _ => self.exec.to_string(),
        }
    }

    /// 판정·내보내기용 [`AllowRule`] 로 펼친다. 서브커맨드가 있고 `.any_order()` 가 아니면
    /// `sub_first` 가 선다(모듈 머리말 "서브커맨드는 exec 바로 뒤").
    pub(crate) fn to_allow_rule(self) -> AllowRule {
        let own = |xs: &[&str]| xs.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();
        AllowRule {
            exec: self.exec.to_string(),
            subcommands: own(self.subcommands),
            deny_flags: own(self.deny_flags),
            allow_flags: own(self.allow_flags),
            require_flags: own(self.require_flags),
            first_arg: own(self.first_arg),
            max_args: self.max_args,
            sub_first: !self.subcommands.is_empty() && !self.any_order,
        }
    }
}

/// 묶음 하나 — 이름으로 말하는 위임 범위.
pub(crate) struct Bundle {
    /// `settings.toml` 의 `[automation] bundles` 에 적히는 키 — **바뀌면 안 된다**.
    pub id: &'static str,
    /// 설정 화면에 보이는 이름.
    pub name: &'static str,
    /// 한 줄 설명 — 무엇을 위임하는지 사람 말로.
    pub description: &'static str,
    /// 이 묶음이 허용 목록에 얹는 규칙들. 같은 exec 이 여러 줄이면 OR 이다(서브커맨드마다
    /// 제약이 달라서 — `git branch` 와 `git log` 는 다른 줄이다).
    pub rules: &'static [PresetRule],
}

impl Bundle {
    /// 이 묶음의 명령 키들 — 표 순서, 중복 없이.
    pub(crate) fn command_keys(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for r in self.rules {
            let k = r.command_key();
            if !out.contains(&k) {
                out.push(k);
            }
        }
        out
    }
}

/// 내장 묶음 표 — **TS `automation-presets.ts` 의 `BUNDLES` 와 행·순서까지 같다**.
///
/// 2026-10-05 인자 제약으로 좁혔고(docs/log/2026-10-05-auto-approve-args.md), 같은 날 열 개로
/// 나눴다(그 문서 "세분화"). 한 명령은 한 묶음에만 있다.
#[rustfmt::skip]
pub(crate) const BUNDLES: &[Bundle] = &[
    Bundle {
        id: "system",
        name: "시스템 상태",
        description: "디스크·메모리·CPU·프로세스·로그인 사용자·시각을 보는 명령들. 시각·호스트 이름을 바꾸는 꼴은 막았다.",
        rules: &[
            // 인자로 상태를 바꾸는 것(`date -s`·`hostname 새이름`)은 인자를 막고, 끝나지 않는 것
            // (`free -s 1`·`vmstat 1`)은 그 플래그·인자를 막는다.
            rule("df", &[]),
            rule("free", &[]).deny(&["-s", "--seconds"]),
            rule("uptime", &[]),
            rule("hostname", &[]).allow(&["-s", "--short", "-f", "--fqdn", "--long", "-d", "--domain", "-i", "--ip-address", "-I", "--all-ip-addresses", "-A", "--all-fqdns"]).max_args(0),
            rule("whoami", &[]),
            rule("id", &[]),
            rule("date", &[]).allow(&["-u", "--utc", "--universal", "-R", "--rfc-email", "-I", "--iso-8601", "--rfc-3339"]).first_arg(&["+*"]).max_args(1),
            rule("uname", &[]),
            rule("ps", &[]),
            rule("nproc", &[]),
            rule("lscpu", &[]),
            rule("lsmem", &[]),
            rule("lsblk", &[]),
            rule("mount", &[]).allow(&["-l", "--show-labels"]).max_args(0),
            rule("vmstat", &[]).max_args(0),
            rule("iostat", &[]).max_args(0),
            rule("who", &[]),
            rule("w", &[]),
            rule("last", &[]),
            // 동사 없이(= status)·status·show 만 — set-time·set-timezone·set-ntp 는 없다.
            rule("timedatectl", &[]).max_args(0),
            rule("timedatectl", &["status", "show"]),
            rule("hostnamectl", &[]).max_args(0),
            rule("hostnamectl", &["status"]).key("hostnamectl"),
        ],
    },
    Bundle {
        id: "services",
        name: "서비스 점검",
        description: "서비스 상태·타이머·유닛 파일, nginx 설정 검사, crontab 목록. 시작·중지·재시작은 없다.",
        rules: &[
            // 상태 조회까지만. restart·stop 은 위험 분류기도 따로 잡는다.
            rule("systemctl", &["status", "is-active", "is-enabled", "list-units"]),
            rule("systemctl", &["list-timers"]),
            rule("systemctl", &["cat"]),
            // 설정 검사만 — `-c`(다른 설정)·`-g`(지시어 — load_module 로 코드 적재)·`-e`(로그 파일 쓰기)·
            // `-s`(신호) 는 없다.
            rule("nginx", &[]).allow(&["-t", "-T", "-q"]).require(&["-t"]).max_args(0),
            // 목록만 — 파일 인자는 설치이고, `-u 사용자` 의 값은 파일 인자와 구별할 수 없어 뺐다.
            rule("crontab", &[]).allow(&["-l"]).require(&["-l"]).max_args(0),
        ],
    },
    Bundle {
        id: "pkg",
        name: "패키지 조회",
        description: "설치된 패키지와 버전을 보는 명령들(apt·dpkg·rpm·pip·npm·snap). 설치·삭제·갱신은 없다.",
        rules: &[
            // `-o`·`-c` 는 apt 설정을 바꾼다(훅·경로).
            rule("apt", &["list", "show", "policy"]).deny(&["-o", "--option", "-c", "--config-file"]),
            rule("apt-cache", &["policy", "show", "search", "depends"]).deny(&["-o", "--option", "-c", "--config-file"]),
            rule("dpkg-query", &[]),
            // 조회 모드(-q)와 조회 플래그만 — `--qf`(매크로 확장)·`--pipe`·`-D`·`-E`·`-e`·`-i` 단독 설치는 없다.
            rule("rpm", &[]).allow(&["-q", "--query", "-a", "--all", "-i", "--info", "-l", "--list", "-f", "--file", "-p", "--package", "-c", "--configfiles", "-d", "--docfiles", "-R", "--requires", "--provides", "--whatprovides", "--whatrequires", "--changelog", "--last", "-s", "--state", "--scripts", "--triggers", "--conflicts", "--obsoletes", "--dump"]).require(&["-q"]),
            // `--python` 은 다른 인터프리터를 실행하고 `--log` 는 파일을 쓴다.
            rule("pip", &["list", "show", "freeze"]).deny(&["--python*", "--log*"]),
            rule("npm", &["ls"]).deny(&["--logs-dir*"]),
            rule("snap", &["list"]),
        ],
    },
    Bundle {
        id: "files",
        name: "파일 읽기",
        description: "파일 목록·내용·크기·해시를 읽는 명령들. 쓰지는 않지만 비밀 파일의 내용도 그대로 읽는다.",
        rules: &[
            // `find` 는 제외했다(-delete·-exec 가 인자다).
            rule("ls", &[]),
            rule("cat", &[]),
            rule("head", &[]),
            rule("tail", &[]).deny(&["-f", "-F", "--follow*"]),
            rule("wc", &[]),
            rule("grep", &[]),
            rule("stat", &[]),
            rule("du", &[]),
            // `-C` 는 magic 파일을 컴파일해 쓴다.
            rule("file", &[]).deny(&["-C", "--compile"]),
            rule("sha256sum", &[]),
            rule("md5sum", &[]),
            rule("readlink", &[]),
            rule("realpath", &[]),
            // `-o` 는 출력 파일을 쓰고 `-R` 은 디렉터리마다 00Tree.html 을 쓴다.
            rule("tree", &[]).deny(&["-o", "-R"]),
        ],
    },
    Bundle {
        id: "logs",
        name: "로그 읽기",
        description: "시스템 저널과 커널 로그를 읽는 명령들. 따라가기와 로그 삭제·회전은 막았다.",
        rules: &[
            rule("journalctl", &[]).deny(&["-f", "--follow", "--vacuum-*", "--rotate", "--flush", "--sync", "--relinquish-var", "--smart-relinquish-var", "--setup-keys", "--update-catalog", "--cursor-file"]),
            rule("dmesg", &[]).deny(&["-C", "--clear", "-c", "--read-clear", "-D", "--console-off", "-E", "--console-on", "-n", "--console-level", "-w", "--follow", "-W", "--follow-new"]),
        ],
    },
    Bundle {
        id: "network",
        name: "네트워크 조회",
        description: "소켓·주소·경로·이웃 표·이름 풀이·연결 확인. 주소·경로·이웃 표를 바꾸는 꼴과 소켓 끊기는 막았다.",
        rules: &[
            rule("ss", &[]).deny(&["-K", "--kill", "-E", "--events", "-D", "--diag"]),
            // 대상(addr·route·link) 뒤 낱말이 show·list(route 는 get 까지)이거나 없을 때만, 플래그는
            // 출력 모양을 바꾸는 것만(-batch·-netns·-force 없음). 값 받는 플래그가 없어 앞에 와도 된다.
            rule("ip", &["addr"]).allow(&["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"]).first_arg(&["show", "list"]).any_order(),
            rule("ip", &["route"]).allow(&["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"]).first_arg(&["show", "list", "get"]).any_order(),
            rule("ip", &["link"]).allow(&["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"]).first_arg(&["show", "list"]).any_order(),
            // `ip a`·`ip address` 는 addr 의 다른 철자 — 같은 제약. 키는 따로 둬서 옛 묶음에서 옮긴 설정에는 꺼진 채로 온다.
            rule("ip", &["a", "address"]).allow(&["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"]).first_arg(&["show", "list"]).any_order().key("ip address"),
            // 이웃(ARP·NDP) 표 보기만 — add·del·change·replace·flush 는 표를 바꾸고 get 은 프로브를 보낸다.
            rule("ip", &["neigh"]).allow(&["-4", "-6", "-br", "-brief", "-c", "-color", "-d", "-details", "-j", "-json", "-p", "-pretty", "-s", "-stats", "-statistics", "-h", "-human", "-o", "-oneline"]).first_arg(&["show", "list"]).any_order(),
            rule("netstat", &[]).deny(&["-c", "--continuous"]),
            rule("dig", &[]),
            rule("host", &[]),
            // 공개 데이터베이스만 — shadow·gshadow 는 없다.
            rule("getent", &[]).first_arg(&["hosts", "ahosts", "ahostsv4", "ahostsv6", "networks", "services", "protocols", "passwd", "group", "rpc", "ethers", "netgroup"]),
            rule("resolvectl", &["status", "query"]),
            // 횟수(-c)가 있어야 끝난다. 홍수(-f)·간격(-i)·미리 보내기(-l)·적응(-A)은 없다.
            rule("ping", &[]).require(&["-c"]).deny(&["-f", "-i", "-l", "-A"]),
            rule("traceroute", &[]),
        ],
    },
    Bundle {
        id: "docker",
        name: "컨테이너",
        description: "docker 컨테이너·이미지·네트워크·볼륨·compose 상태 조회. 실행·중지·삭제는 없다. inspect 는 환경 변수도 보여 준다.",
        rules: &[
            // 따라가기(-f)는 끝나지 않으므로 막고, `docker stats` 는 `--no-stream` 이 있어야 끝난다.
            rule("docker", &["ps"]),
            rule("docker", &["images"]),
            rule("docker", &["inspect"]),
            rule("docker", &["logs"]).deny(&["-f", "--follow"]),
            rule("docker", &["stats"]).require(&["--no-stream"]),
            rule("docker", &["version"]),
            rule("docker", &["info"]),
            rule("docker", &["network"]).allow(&["-f", "--filter", "--format", "--no-trunc", "-q", "--quiet", "-v", "--verbose"]).first_arg(&["ls", "inspect"]),
            rule("docker", &["volume"]).allow(&["-f", "--filter", "--format", "-q", "--quiet", "--cluster"]).first_arg(&["ls", "inspect"]),
            // compose 는 하위 동사의 플래그만 — 전역 `-p`·`-f`·`--env-file` 의 값이 동사로 위장하지 못하게.
            rule("docker", &["compose"]).allow(&["-a", "--all", "-q", "--quiet", "--services", "--format", "--status", "--filter", "--no-trunc", "--orphans", "--volumes", "--profiles", "--images", "--hash", "--no-interpolate", "--no-normalize", "--no-path-resolution", "--no-consistency", "--resolve-image-digests", "--environment", "--variables", "--networks"]).first_arg(&["ps", "config", "images"]),
            rule("docker", &["compose"]).allow(&["--tail", "-n", "-t", "--timestamps", "--since", "--until", "--no-color", "--no-log-prefix", "--index"]).first_arg(&["logs"]),
        ],
    },
    Bundle {
        id: "k8s",
        name: "쿠버네티스",
        description: "kubectl 조회(get·describe·logs·top·events)와 helm 목록·상태. 적용·삭제·exec 는 없다.",
        rules: &[
            rule("kubectl", &["describe"]),
            rule("kubectl", &["get"]).deny(&["-w", "--watch*"]),
            rule("kubectl", &["logs"]).deny(&["-f", "--follow"]),
            rule("kubectl", &["top"]),
            rule("kubectl", &["version"]),
            rule("kubectl", &["api-resources"]),
            rule("kubectl", &["events"]).deny(&["-w", "--watch*"]),
            rule("helm", &["list", "status"]),
        ],
    },
    Bundle {
        id: "git",
        name: "Git 조회",
        description: "저장소 상태를 읽는 git 서브커맨드들(태그는 목록만). 네트워크를 쓰는 fetch 는 따로 있다 — pull·checkout·reset·태그 만들기는 없다.",
        rules: &[
            // 공통 금지: 파일을 쓰는 `--output` · 설정/실행 경로를 바꾸는 `--config-env`·`--exec-path` ·
            // 임의 명령을 받는 `--upload-pack`.
            rule("git", &["status"]).deny(&["--output*", "--config-env*", "--exec-path*", "--upload-pack*"]),
            rule("git", &["log"]).deny(&["--output*", "--config-env*", "--exec-path*", "--upload-pack*"]),
            rule("git", &["diff"]).deny(&["--output*", "--config-env*", "--exec-path*", "--upload-pack*"]),
            rule("git", &["show"]).deny(&["--output*", "--config-env*", "--exec-path*", "--upload-pack*"]),
            rule("git", &["rev-parse"]).deny(&["--output*", "--config-env*", "--exec-path*", "--upload-pack*"]),
            rule("git", &["describe"]).deny(&["--output*", "--config-env*", "--exec-path*", "--upload-pack*"]),
            // branch 는 목록만 — 목록형 플래그만, 이름 인자 없음(`-D`·`-m`·`-c`·`-u`·새 이름 없음).
            rule("git", &["branch"]).allow(&["-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "-l", "--list", "--show-current", "--merged", "--no-merged", "--contains", "--no-contains", "--sort", "--color", "--no-color", "--column", "--no-column", "-i", "--ignore-case", "--abbrev", "--no-abbrev"]).max_args(0),
            // remote 는 목록(`-v`)·show·get-url 만(add·remove·rename·set-url·prune 없음).
            rule("git", &["remote"]).deny(&["--output*", "--config-env*", "--exec-path*", "--upload-pack*"]).first_arg(&["show", "get-url"]),
            // ls-files 는 쓰지 않는다 — 플래그는 출력 모양·고르기만. 저장소 밖 파일을 읽는 `-X`·`--exclude-from`·`--exclude-per-directory` 는 없다.
            rule("git", &["ls-files"]).allow(&["-c", "--cached", "-d", "--deleted", "-m", "--modified", "-o", "--others", "-i", "--ignored", "-s", "--stage", "-u", "--unmerged", "-k", "--killed", "-z", "-t", "-v", "-f", "--directory", "--no-empty-directory", "--eol", "--deduplicate", "-x", "--exclude", "--exclude-standard", "--error-unmatch", "--with-tree", "--full-name", "--recurse-submodules", "--abbrev", "--debug", "--sparse", "--format"]),
            // blame 은 출력 플래그만 — 아무 파일이나 읽어 그 내용을 찍는 `--contents`, 리비전 목록 파일을 읽는 `-S`·`--ignore-revs-file` 은 없다.
            rule("git", &["blame"]).allow(&["-L", "-l", "-t", "-b", "-f", "--show-name", "-n", "--show-number", "-s", "-e", "--show-email", "-w", "-c", "-p", "--porcelain", "--line-porcelain", "--incremental", "--root", "--show-stats", "--reverse", "--first-parent", "--encoding", "--date", "--abbrev", "-M", "-C", "--color-lines", "--color-by-age", "--ignore-rev", "--minimal", "--progress", "--no-progress", "--score-debug"]),
            // shortlog 는 요약·리비전 고르기 플래그만(`--output` 같은 diff 옵션 없음). 리비전이 없으면 stdin 을 읽지만 실행기가 stdin 을 곧바로 닫아(ssh/exec.rs) 빈 출력으로 끝난다.
            rule("git", &["shortlog"]).allow(&["-n", "--numbered", "-s", "--summary", "-e", "--email", "-c", "--committer", "--group", "--format", "-w", "--all", "--branches", "--tags", "--remotes", "--no-merges", "--merges", "--first-parent", "--since", "--after", "--until", "--before", "--author", "--date"]),
            // tag 는 목록만 — 이름 인자는 `-l`/`--list` 가 있을 때만(패턴). 목록 플래그 없이 이름을 주면 태그를 만든다. `-d`·`-a`·`-s`·`-u`·`-f`·`-m`·`-F`·`-v`(gpg 실행) 없음.
            rule("git", &["tag"]).allow(&["-l", "--list", "-n", "--sort", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--format", "--color", "--no-color", "--column", "--no-column", "-i", "--ignore-case", "--omit-empty"]).require(&["-l"]),
            rule("git", &["tag"]).allow(&["-l", "--list", "-n", "--sort", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--format", "--color", "--no-color", "--column", "--no-column", "-i", "--ignore-case", "--omit-empty"]).require(&["--list"]),
            rule("git", &["tag"]).allow(&["-l", "--list", "-n", "--sort", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--format", "--color", "--no-color", "--column", "--no-column", "-i", "--ignore-case", "--omit-empty"]).max_args(0),
        ],
    },
    Bundle {
        id: "gitfetch",
        name: "Git 갱신",
        description: "원격의 새 커밋을 받아 오는 git fetch. 작업 트리는 건드리지 않는다 — 원격 이름 하나까지, refspec 은 없다.",
        rules: &[
            // 원격 이름 하나까지 — refspec(`+a:main`)은 로컬 브랜치를 덮어쓸 수 있다.
            rule("git", &["fetch"]).deny(&["--output*", "--config-env*", "--exec-path*", "--upload-pack*"]).max_args(1),
        ],
    },
];

/// 옛 묶음 id → 옮겨 갈 새 묶음들과 **옛 묶음이 담고 있던 명령 키**.
///
/// 옮길 때 새 묶음의 키 가운데 여기 없는 것은 `bundle_off` 에 넣어 꺼 둔다 — 그래서 옮긴 뒤의
/// 허용 범위는 옛 묶음(2026-10-05 인자 제약으로 좁힌 판)과 **같거나 좁다**(새 규칙이 같은 키에서
/// 옛 규칙보다 넓지 않다는 것은 `policy/tests.rs` 의 공유 표 시험이 잡는다).
pub(crate) const LEGACY_BUNDLES: &[(&str, &[&str], &[&str])] = &[
    (
        "diag-readonly",
        &["system", "services", "files", "logs", "network", "docker", "k8s"],
        &[
            "df", "free", "uptime", "hostname", "whoami", "id", "date", "uname", "ps", "ls", "cat",
            "head", "tail", "wc", "grep", "stat", "du", "systemctl", "journalctl", "ss", "ip addr",
            "ip route", "ip link", "netstat", "dmesg", "lsblk", "mount", "docker ps",
            "docker images", "docker inspect", "docker logs", "docker stats", "kubectl describe",
            "kubectl get", "kubectl logs",
        ],
    ),
    (
        "git-readonly",
        &["git", "gitfetch"],
        &[
            "git status", "git log", "git diff", "git show", "git rev-parse", "git describe",
            "git fetch", "git branch", "git remote",
        ],
    ),
];

/// 옛 묶음 id 를 새 id 로 옮긴다 — **읽을 때마다** 부르고(멱등), 결과는 넓어지지 않는다. **순수**.
///
/// 규칙:
/// - 옛 id 자리에 새 id 들이 그 순서로 선다(옛 id 는 사라진다).
/// - 새 묶음이 **이미 켜져 있었으면** 그대로 둔다(이미 그만큼 열려 있었다 — 손대면 좁힐 뿐 뜻이 없다).
/// - 아니면 켜되, 그 묶음의 키 가운데 옛 묶음에 없던 것을 `bundle_off` 에 더해 꺼 둔다.
///
/// 저장할 때 새 형식으로 쓰이므로 대개 한 번만 일한다. 옛 버전이 다시 옛 id 를 적어도 다음에 또 옮긴다.
pub(crate) fn migrate_legacy_bundles(
    bundles: &mut Vec<String>,
    bundle_off: &mut BTreeMap<String, Vec<String>>,
) {
    if !bundles
        .iter()
        .any(|id| LEGACY_BUNDLES.iter().any(|(old, _, _)| old == id))
    {
        return;
    }
    let original = std::mem::take(bundles);
    // 옛 id 를 옮기기 **전**에 켜져 있던 새 id 들 — 이들은 건드리지 않는다.
    let explicit: Vec<String> = original
        .iter()
        .filter(|id| !LEGACY_BUNDLES.iter().any(|(old, _, _)| old == *id))
        .cloned()
        .collect();
    for id in original {
        let Some((_, targets, keys)) = LEGACY_BUNDLES.iter().find(|(old, _, _)| *old == id) else {
            if !bundles.contains(&id) {
                bundles.push(id);
            }
            continue;
        };
        for target in *targets {
            let target = (*target).to_string();
            if bundles.contains(&target) {
                continue;
            }
            bundles.push(target.clone());
            if explicit.contains(&target) {
                continue; // 이미 켜져 있던 묶음 — 아래에서 원래 자리에 다시 들어온다.
            }
            let Some(b) = bundle_by_id(&target) else {
                continue;
            };
            let fresh: Vec<String> = b
                .command_keys()
                .into_iter()
                .filter(|k| !keys.contains(&k.as_str()))
                .collect();
            if fresh.is_empty() {
                continue; // 전부 옛 명령 — 빈 칸을 지어내지 않는다.
            }
            let off = bundle_off.entry(target).or_default();
            for k in fresh {
                if !off.contains(&k) {
                    off.push(k);
                }
            }
        }
    }
}

/// id → 묶음. 모르는 id 는 `None`(파일에 적힌 채로 무시된다 — [`expand_bundles`]).
pub(crate) fn bundle_by_id(id: &str) -> Option<&'static Bundle> {
    BUNDLES.iter().find(|b| b.id == id)
}

/// 이 묶음에서 이 키를 꺼 두었는가.
pub(crate) fn is_off(bundle_off: &BTreeMap<String, Vec<String>>, bundle: &str, key: &str) -> bool {
    bundle_off
        .get(bundle)
        .is_some_and(|keys| keys.iter().any(|k| k == key))
}

/// 켜진 묶음 id 들을 **규칙 목록**으로 펼친다 — 꺼 둔 명령은 뺀다. **순수**.
///
/// 모르는 id 는 **조용히 건너뛴다** — 새 버전에서 생긴 묶음을 켜 둔 `settings.toml` 을 옛
/// 버전이 읽어도 값이 지워지지 않게(설정은 보존하고 해석만 안 한다). 모르는 키의 끄기도 같다.
/// TS `expandBundles` 와 같은 의미다.
pub(crate) fn expand_bundles(
    ids: &[String],
    bundle_off: &BTreeMap<String, Vec<String>>,
) -> Vec<AllowRule> {
    let mut out = Vec::new();
    for id in ids {
        let Some(b) = bundle_by_id(id) else {
            continue;
        };
        for r in b.rules {
            if is_off(bundle_off, b.id, &r.command_key()) {
                continue;
            }
            out.push(r.to_allow_rule());
        }
    }
    out
}

/// 자동 승인 판정이 실제로 보는 **구조적 규칙 전부** = 사용자가 직접 적은 `allow` + 켜진
/// 묶음이 펼친 규칙(꺼 둔 명령 제외). **순수**.
///
/// 순서는 사용자 규칙이 먼저다(매칭은 OR 이라 결과는 같고, 디버깅에 낫다).
/// [`crate::policy::command_passes_auto_policy`] 가 이 합집합을 본다 — 즉 **묶음의 효력은
/// 백엔드에서 난다**. TS `effectiveAllowRules` 와 같은 의미다.
pub(crate) fn effective_allow_rules(prefs: &AutomationPrefs) -> Vec<AllowRule> {
    let mut out = prefs.allow.clone();
    out.extend(expand_bundles(&prefs.bundles, &prefs.bundle_off));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none() -> BTreeMap<String, Vec<String>> {
        BTreeMap::new()
    }

    /// 표의 위생 — id 는 유일하고, 이름·설명·규칙이 비지 않는다. 한 명령 키는 한 묶음에만 있다.
    #[test]
    fn bundle_table_is_well_formed() {
        let mut seen = std::collections::HashSet::new();
        let mut keys_seen: std::collections::HashMap<String, &str> = Default::default();
        for b in BUNDLES {
            assert!(seen.insert(b.id), "묶음 id 가 중복이다: {}", b.id);
            assert!(
                !LEGACY_BUNDLES.iter().any(|(old, _, _)| *old == b.id),
                "옛 id 를 다시 쓰면 안 된다: {}",
                b.id
            );
            assert!(!b.name.trim().is_empty(), "{} 의 이름이 비었다", b.id);
            assert!(
                !b.description.trim().is_empty(),
                "{} 의 설명이 비었다",
                b.id
            );
            assert!(!b.rules.is_empty(), "{} 에 규칙이 없다", b.id);
            for k in b.command_keys() {
                if let Some(other) = keys_seen.insert(k.clone(), b.id) {
                    panic!("명령 키 {k} 가 {other} 와 {} 두 묶음에 있다", b.id);
                }
            }
            for r in b.rules {
                let exec = r.exec;
                assert!(!exec.trim().is_empty(), "{} 에 빈 exec 이 있다", b.id);
                for f in r.deny_flags.iter().chain(r.allow_flags).chain(r.require_flags) {
                    assert!(f.starts_with('-'), "{}/{exec} 의 플래그 항목이 `-` 로 시작하지 않는다: {f}", b.id);
                }
                for s in r.subcommands {
                    assert!(
                        !s.trim().is_empty(),
                        "{}/{} 에 빈 서브커맨드가 있다",
                        b.id,
                        exec
                    );
                    assert!(
                        !s.starts_with('-'),
                        "{}/{} 의 서브커맨드가 플래그다: {s}",
                        b.id,
                        exec
                    );
                }
                // 서브커맨드 앞 플래그를 받는 예외는 허용 플래그 목록이 있는 규칙만(값이 위장할 틈이 없게).
                if r.any_order {
                    assert!(!r.allow_flags.is_empty(), "{}/{exec} 의 any_order 는 allow_flags 가 있어야 한다", b.id);
                }
            }
        }
    }

    /// 옛 묶음의 옮김 표 — 새 id 는 실제로 있고, 옛 키는 그 새 묶음들 어딘가에 있다.
    #[test]
    fn legacy_table_points_at_real_bundles_and_keys() {
        for (old, targets, keys) in LEGACY_BUNDLES {
            let mut all: Vec<String> = Vec::new();
            for t in *targets {
                let b = bundle_by_id(t).unwrap_or_else(|| panic!("{old} → 없는 묶음 {t}"));
                all.extend(b.command_keys());
            }
            for k in *keys {
                assert!(all.iter().any(|x| x == k), "{old} 의 키 {k} 가 새 묶음에 없다");
            }
        }
    }

    /// **보안 검토의 못** — 묶음에 절대 들어오면 안 되는 실행 파일들. 목록을 넓히다 실수로
    /// 넣으면 여기서 깨진다(모듈 머리말의 "뺀 것들" 과 파괴적 동사).
    #[test]
    fn bundles_never_contain_the_excluded_execs() {
        const FORBIDDEN: &[&str] = &[
            "find", "env", "printenv", "top", "rm", "rmdir", "dd", "mkfs", "sudo", "su", "chmod",
            "chown", "kill", "killall", "pkill", "reboot", "shutdown", "halt", "poweroff",
            "truncate", "sh", "bash", "zsh", "eval",
        ];
        for b in BUNDLES {
            for r in b.rules {
                let exec = r.exec;
                assert!(!FORBIDDEN.contains(&exec), "{} 에 금지된 exec: {exec}", b.id);
            }
        }
    }

    /// 묶음 규칙은 **위험 분류기를 통과하는 형태**여야 한다 — `exec` 만으로도, 서브커맨드를
    /// 붙여도 `Dangerous` 로 분류되면 자동 승인이 절대 안 나므로 목록에 둘 이유가 없다
    /// (죽은 규칙을 표에 남기지 않는다).
    #[test]
    fn bundle_rules_are_not_self_defeating() {
        for b in BUNDLES {
            for r in b.rules {
                let (exec, subs) = (r.exec, r.subcommands);
                let probe = exec.to_string();
                assert_eq!(
                    crate::policy::classify_risk(&probe),
                    crate::policy::Risk::Safe,
                    "{}/{exec} 는 exec 만으로 위험 분류된다",
                    b.id
                );
                for s in subs {
                    let probe = format!("{exec} {s}");
                    assert_eq!(
                        crate::policy::classify_risk(&probe),
                        crate::policy::Risk::Safe,
                        "{}/{probe} 가 위험 분류된다",
                        b.id
                    );
                }
            }
        }
    }

    /// 명령 키 — `.key()` · 서브커맨드 하나 · 여럿/없음.
    #[test]
    fn command_keys_follow_the_rule() {
        assert_eq!(rule("tail", &[]).command_key(), "tail");
        assert_eq!(rule("docker", &["logs"]).command_key(), "docker logs");
        assert_eq!(rule("systemctl", &["status", "cat"]).command_key(), "systemctl");
        assert_eq!(rule("hostnamectl", &["status"]).key("hostnamectl").command_key(), "hostnamectl");
        let sys = bundle_by_id("system").unwrap().command_keys();
        // 같은 키의 두 줄(timedatectl)은 한 스위치다.
        assert_eq!(sys.iter().filter(|k| *k == "timedatectl").count(), 1);
        assert!(!sys.iter().any(|k| k == "timedatectl status"));
    }

    /// 모르는 id 는 조용히 무시되고, 아는 id 는 규칙으로 펼쳐진다.
    #[test]
    fn expand_bundles_skips_unknown_ids() {
        assert!(expand_bundles(&["nope".to_string()], &none()).is_empty());
        let rules = expand_bundles(&["git".to_string()], &none());
        let n = bundle_by_id("git").unwrap().rules.len();
        assert_eq!(rules.len(), n);
        assert_eq!(rules[0].exec, "git");
        assert_eq!(rules[0].subcommands, ["status"]);
        assert!(rules[0].sub_first, "묶음 규칙은 서브커맨드가 exec 바로 뒤");
        // 인자 제약도 함께 펼쳐진다(branch 줄은 인자 없이 · 목록형 플래그만).
        let branch = rules
            .iter()
            .find(|r| r.subcommands == ["branch"])
            .expect("git branch 줄");
        assert_eq!(branch.max_args, Some(0));
        assert!(branch.allow_flags.iter().any(|f| f == "-a"));
        // ip 는 예외(값 없는 출력 플래그만이라 앞에 와도 된다).
        let ip = expand_bundles(&["network".to_string()], &none());
        assert!(ip.iter().filter(|r| r.exec == "ip").all(|r| !r.sub_first));
        // 아는 id 와 모르는 id 가 섞여도 아는 것만 나온다(설정은 보존하고 해석만 안 한다).
        let mixed = expand_bundles(&["nope".to_string(), "git".to_string()], &none());
        assert_eq!(mixed.len(), n);
    }

    /// 꺼 둔 명령은 펼치기에서 빠진다 — 같은 키의 줄은 함께, 다른 묶음의 같은 이름은 그대로.
    #[test]
    fn expand_bundles_drops_commands_turned_off() {
        let mut off = none();
        off.insert("docker".to_string(), vec!["docker compose".to_string(), "nope".to_string()]);
        off.insert("files".to_string(), vec!["cat".to_string()]);
        let rules = expand_bundles(&["docker".to_string()], &off);
        assert!(!rules.iter().any(|r| r.subcommands == ["compose"]), "두 줄 모두 빠진다");
        assert!(rules.iter().any(|r| r.subcommands == ["ps"]));
        // files 의 끄기는 docker 에 영향이 없다(그리고 files 는 꺼져 있다).
        assert_eq!(rules.len(), bundle_by_id("docker").unwrap().rules.len() - 2);
    }

    /// 사용자 규칙 + 묶음 규칙의 합집합이고, **사용자 규칙이 앞**이다.
    #[test]
    fn effective_allow_rules_is_user_plus_bundles() {
        let prefs = AutomationPrefs {
            allow: vec![AllowRule {
                exec: "mytool".to_string(),
                ..Default::default()
            }],
            bundles: vec!["git".to_string()],
            ..Default::default()
        };
        let rules = effective_allow_rules(&prefs);
        assert_eq!(rules[0].exec, "mytool", "사용자 규칙이 먼저");
        assert!(rules.iter().any(|r| r.exec == "git"), "묶음 규칙이 얹힌다");
        // 묶음이 없으면 사용자 규칙 그대로다(기본 거부는 그대로 — 묶음은 켜야 생긴다).
        let none = AutomationPrefs {
            allow: prefs.allow.clone(),
            ..Default::default()
        };
        assert_eq!(effective_allow_rules(&none).len(), 1);
    }

    /// 옮기기 — 옛 id 자리에 새 id 들, 옛 묶음에 없던 명령은 꺼진 채로, 두 번 해도 같다.
    #[test]
    fn migrate_legacy_bundles_replaces_ids_and_turns_new_commands_off() {
        let mut ids = vec!["diag-readonly".to_string(), "git-readonly".to_string(), "future".to_string()];
        let mut off = none();
        migrate_legacy_bundles(&mut ids, &mut off);
        assert_eq!(
            ids,
            ["system", "services", "files", "logs", "network", "docker", "k8s", "git", "gitfetch", "future"]
        );
        let sys = &off["system"];
        for k in ["nproc", "lscpu", "lsmem", "vmstat", "iostat", "who", "w", "last", "timedatectl", "hostnamectl"] {
            assert!(sys.iter().any(|x| x == k), "{k} 는 꺼진 채로 옮겨진다: {sys:?}");
        }
        assert!(!sys.iter().any(|x| x == "df"), "옛 묶음에 있던 명령은 켜진 채로");
        assert_eq!(off["services"], ["systemctl list-timers", "systemctl cat", "nginx", "crontab"]);
        assert!(!off.contains_key("logs"), "logs 는 전부 옛 명령이다");
        // 10-10 조회 추가분은 옛 묶음에 없었다 — 꺼진 채로.
        assert_eq!(off["git"], ["git ls-files", "git blame", "git shortlog", "git tag"]);
        let net = &off["network"];
        for k in ["ip address", "ip neigh"] {
            assert!(net.iter().any(|x| x == k), "{k} 는 꺼진 채로 옮겨진다: {net:?}");
        }
        assert!(!net.iter().any(|x| x == "ip addr"), "옛 묶음에 있던 명령은 켜진 채로");
        // 멱등 — 다시 불러도 같다.
        let (ids2, off2) = (ids.clone(), off.clone());
        migrate_legacy_bundles(&mut ids, &mut off);
        assert_eq!((ids, off), (ids2, off2));
    }

    /// 이미 켜져 있던 새 묶음은 손대지 않는다(이미 그만큼 열려 있었다).
    #[test]
    fn migrate_legacy_bundles_keeps_explicit_new_bundles() {
        let mut ids = vec!["files".to_string(), "diag-readonly".to_string()];
        let mut off = none();
        off.insert("files".to_string(), vec!["cat".to_string()]);
        migrate_legacy_bundles(&mut ids, &mut off);
        assert_eq!(ids[0], "files");
        assert_eq!(ids.iter().filter(|i| *i == "files").count(), 1);
        assert_eq!(off["files"], ["cat"], "사용자의 끄기만 남고 새 끄기는 더하지 않는다");
        assert!(off["system"].iter().any(|k| k == "nproc"));
    }
}
