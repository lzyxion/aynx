//! TLS 통합 시험 — 자체 CA 인증서(SAN `db.test` · `mydb.test` · `localhost` — **IP SAN 없음**)를 넣은 PG · MySQL · MariaDB 와
//! TLS 를 끈 같은 셋, 임시 sshd 가 있을 때만 돈다(`#[ignore]` + `AYNX_TEST_TLS_*`). 사용자의 ssh 설정 · `known_hosts` · 볼트는 건드리지 않는다.
//!
//! ```text
//! cargo test --lib db::tls_tests -- --ignored --nocapture --test-threads=1
//! ```
//!
//! sshd 는 `AllowTcpForwarding yes` 와 `PerSourcePenalties no` 가 있어야 한다 — OpenSSH 9.8+ 는 끊긴 preauth 연결을 실패한 인증으로
//! 세어 그 주소를 막는다(시험이 접속을 여러 번 연다).

use mysql_async::prelude::Queryable;
use serde_json::Value;
use zeroize::Zeroizing;

use super::mysql::Mysql;
use super::net::{NetTarget, OpenError, OpenSecrets};
use super::pg::Pg;
use crate::db::conns::DbTlsMode;
use crate::ssh::open::SharedCreds;
use crate::ssh::{AdhocTarget, HostKeyDecision, SshOpenError};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn port(name: &str) -> Option<u16> {
    env(name)?.parse().ok()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Engine {
    Pg,
    My,
}

fn target(engine: Engine, host: &str, port: u16, tls: DbTlsMode, ca: Option<String>) -> NetTarget {
    NetTarget {
        id: "Test9_tls-matrix".into(),
        host: host.into(),
        port,
        database: None,
        user: Some(if engine == Engine::Pg { "postgres" } else { "root" }.into()),
        tls,
        tls_ca: ca,
        via: None,
        adhoc: None,
    }
}

fn ssh_creds(ssh_pw: Option<&str>, declined: &[String]) -> SharedCreds {
    SharedCreds {
        host_key_decision: Some(HostKeyDecision::Once),
        password: ssh_pw.map(str::to_string),
        passphrase: None,
        passphrase_for: None,
        declined_keys: declined.to_vec(),
        unattended: None,
    }
}

/// `Ok(tls 인가)` / `Err(문구)`.
async fn probe(engine: Engine, t: NetTarget, pw: &str, ssh_pw: Option<&str>) -> Result<bool, String> {
    let mut declined: Vec<String> = Vec::new();
    for _ in 0..6 {
        let secrets = OpenSecrets {
            password: Some(Zeroizing::new(pw.to_string())),
            ssh: ssh_creds(ssh_pw, &declined),
            vault: true,
            from_vault: false,
        };
        let r = match engine {
            Engine::Pg => match Pg::connect("tls-matrix", t.clone(), secrets).await {
                Ok(p) => {
                    let out = p.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()", 10, 5000).await;
                    p.shutdown();
                    let out = out.map_err(|e| format!("{e:?}"))?;
                    return Ok(out.rows[0][0] == Value::Bool(true));
                }
                Err(e) => e,
            },
            Engine::My => match Mysql::connect("tls-matrix", t.clone(), secrets).await {
                Ok(m) => {
                    let out = m.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'", 10, 5000).await;
                    m.shutdown();
                    let out = out.map_err(|e| format!("{e:?}"))?;
                    return Ok(out.rows[0][1].as_str().is_some_and(|c| !c.is_empty()));
                }
                Err(e) => e,
            },
        };
        match r {
            OpenError::Ssh(SshOpenError::PassphraseRequired { path, .. }) => declined.push(path),
            OpenError::Ssh(e) => return Err(format!("ssh {e:?}")),
            OpenError::Msg(m) => return Err(m),
        }
    }
    Err("관문 고리가 끝나지 않음".into())
}

fn one_line(s: &str) -> String {
    s.replace('\n', " / ")
}

/// 이름 틀림은 `127.0.0.1` 로 붙어 만든다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_TLS_* 가 있을 때만 — 자체 CA 인증서를 넣은 DB 컨테이너"]
async fn tls_modes_by_engine() {
    let (Some(ca), Some(pw)) = (env("AYNX_TEST_TLS_CA"), env("AYNX_TEST_TLS_PW")) else {
        eprintln!("AYNX_TEST_TLS_CA · _PW 없음 — 건너뜀");
        return;
    };
    let other = env("AYNX_TEST_TLS_OTHER_CA");
    let missing = std::env::temp_dir().join("aynx-no-such-ca.pem").to_string_lossy().into_owned();
    let bad = std::env::temp_dir().join("aynx-bad-ca.pem");
    std::fs::write(&bad, "not a pem\n").unwrap();
    let bad = bad.to_string_lossy().into_owned();
    let sets = [
        ("PG", Engine::Pg, "AYNX_TEST_TLS_PG", "AYNX_TEST_TLS_PG_PLAIN"),
        ("MySQL", Engine::My, "AYNX_TEST_TLS_MYSQL", "AYNX_TEST_TLS_MYSQL_PLAIN"),
        ("MariaDB", Engine::My, "AYNX_TEST_TLS_MARIADB", "AYNX_TEST_TLS_MARIADB_PLAIN"),
    ];
    use DbTlsMode::*;
    for (tag, engine, tls_var, plain_var) in sets {
        let (Some(tp), Some(pp)) = (port(tls_var), port(plain_var)) else {
            eprintln!("{tls_var} · {plain_var} 없음 — {tag} 건너뜀");
            continue;
        };
        let run = |host: &'static str, p: u16, mode: DbTlsMode, ca: Option<String>| {
            let pw = pw.clone();
            async move { probe(engine, target(engine, host, p, mode, ca), &pw, None).await }
        };
        let ok = |label: &str, r: Result<bool, String>, want_tls: bool| {
            println!("MEASURE[{tag}] {label}: {}", match &r { Ok(t) => format!("OK tls={t}"), Err(m) => format!("ERR {}", one_line(m)) });
            assert_eq!(r.as_ref().ok(), Some(&want_tls), "[{tag}] {label}: {r:?}");
        };
        let fail = |label: &str, r: Result<bool, String>, needle: &str| {
            println!("MEASURE[{tag}] {label}: {}", match &r { Ok(t) => format!("OK tls={t}"), Err(m) => format!("ERR {}", one_line(m)) });
            let m = r.expect_err(&format!("[{tag}] {label} 은 실패해야"));
            assert!(m.contains(needle), "[{tag}] {label}: {m}");
        };
        // ── TLS 서버 ──
        ok("tls disable", run("localhost", tp, Disable, None).await, false);
        ok("tls prefer", run("localhost", tp, Prefer, None).await, true);
        ok("tls require", run("localhost", tp, Require, None).await, true);
        ok("tls require(이름 틀림 · CA 없음 — 검증 안 함)", run("127.0.0.1", tp, Require, None).await, true);
        ok("tls verify-ca", run("localhost", tp, VerifyCa, Some(ca.clone())).await, true);
        ok("tls verify-ca(이름 틀림 — 이름은 안 봄)", run("127.0.0.1", tp, VerifyCa, Some(ca.clone())).await, true);
        fail("tls verify-ca(CA 없음)", run("localhost", tp, VerifyCa, None).await, "CA 검증은 CA 파일이 필요합니다");
        if let Some(o) = &other {
            fail("tls verify-ca(다른 CA)", run("localhost", tp, VerifyCa, Some(o.clone())).await, "알 수 없는 인증 기관");
        }
        ok("tls verify-full", run("localhost", tp, VerifyFull, Some(ca.clone())).await, true);
        fail("tls verify-full(이름 틀림 — IP SAN 없음)", run("127.0.0.1", tp, VerifyFull, Some(ca.clone())).await, "'127.0.0.1'");
        fail("tls verify-full(CA 없음)", run("localhost", tp, VerifyFull, None).await, "알 수 없는 인증 기관");
        fail("tls verify-full(CA 파일 없음)", run("localhost", tp, VerifyFull, Some(missing.clone())).await, &missing);
        fail("tls verify-full(PEM 아님)", run("localhost", tp, VerifyFull, Some(bad.clone())).await, "PEM");
        ok("tls require(없는 CA 파일 — 읽지 않음)", run("localhost", tp, Require, Some(missing.clone())).await, true);
        // ── TLS 를 끈 서버 ──
        ok("plain disable", run("localhost", pp, Disable, None).await, false);
        ok("plain prefer(평문으로)", run("localhost", pp, Prefer, None).await, false);
        fail("plain require", run("localhost", pp, Require, None).await, "TLS(SSL)를 받지 않습니다");
        fail("plain verify-ca", run("localhost", pp, VerifyCa, Some(ca.clone())).await, "TLS(SSL)를 받지 않습니다");
        fail("plain verify-full", run("localhost", pp, VerifyFull, Some(ca.clone())).await, "TLS(SSL)를 받지 않습니다");

        // 드라이버의 skip_domain_validation 이 이 rustls 에서 죽어 있는지(verify-ca 를 탐침으로 만든 까닭) — 단언 없이 출력만.
        if engine == Engine::My {
            let ssl = mysql_async::SslOpts::default()
                .with_root_certs(vec![std::fs::read(&ca).unwrap().into()])
                .with_danger_skip_domain_validation(true);
            let opts: mysql_async::Opts = mysql_async::OptsBuilder::default()
                .ip_or_hostname("127.0.0.1")
                .tcp_port(tp)
                .user(Some("root"))
                .pass(Some(pw.clone()))
                .prefer_socket(false)
                .ssl_opts(ssl)
                .into();
            let r = mysql_async::Conn::new(opts).await;
            println!(
                "MEASURE[{tag}] driver skip_domain_validation + 이름 틀림: {}",
                match &r { Ok(_) => "OK".to_string(), Err(e) => format!("ERR {e}") }
            );
            if let Ok(mut c) = r {
                let _: Option<u8> = c.query_first("SELECT 1").await.ok().flatten();
                let _ = c.disconnect().await;
            }
        }
    }
    let _ = std::fs::remove_file(&bad);
}

/// (이름표, 엔진, sshd 에서 본 이름, 포트, 모드, CA 파일, 실패면 문구 조각)
type SshCase = (&'static str, Engine, &'static str, u16, DbTlsMode, bool, Option<&'static str>);

/// 드라이버는 터널(`127.0.0.1:<임시>`)에 붙어도 이름 검증은 프리셋 host 로 선다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "AYNX_TEST_TLS_SSH · _CA 가 있을 때만 — 임시 sshd + TLS DB"]
async fn tls_verify_full_over_ssh_tunnel() {
    let (Some(ca), Some(pw), Some(ssh)) = (env("AYNX_TEST_TLS_CA"), env("AYNX_TEST_TLS_PW"), env("AYNX_TEST_TLS_SSH")) else {
        eprintln!("AYNX_TEST_TLS_SSH · _CA · _PW 없음 — 건너뜀");
        return;
    };
    let (cred, addr) = ssh.rsplit_once('@').unwrap();
    let (user, ssh_pw) = cred.split_once(':').unwrap();
    let (host, sport) = addr.rsplit_once(':').unwrap();
    let adhoc = AdhocTarget {
        host: host.into(),
        user: Some(user.into()),
        port: sport.parse().ok(),
    };
    let alias = format!("{user}@{host}:{sport}");
    let cases: [SshCase; 5] = [
        ("PG verify-full", Engine::Pg, "db.test", 5432, DbTlsMode::VerifyFull, true, None),
        ("PG verify-full(CA 없음)", Engine::Pg, "db.test", 5432, DbTlsMode::VerifyFull, false, Some("알 수 없는 인증 기관")),
        ("PG verify-full(이름 틀림 — 별칭 wrong.test)", Engine::Pg, "wrong.test", 5432, DbTlsMode::VerifyFull, true, Some("'wrong.test'")),
        ("MySQL verify-full", Engine::My, "mydb.test", 3306, DbTlsMode::VerifyFull, true, None),
        ("MySQL verify-ca(탐침도 터널로)", Engine::My, "mydb.test", 3306, DbTlsMode::VerifyCa, true, None),
    ];
    for (label, engine, th, tp, mode, with_ca, needle) in cases {
        let mut t = target(engine, th, tp, mode, with_ca.then(|| ca.clone()));
        t.via = Some(alias.clone());
        t.adhoc = Some(adhoc.clone());
        let r = probe(engine, t, &pw, Some(ssh_pw)).await;
        println!("MEASURE[ssh] {label}: {}", match &r { Ok(t) => format!("OK tls={t}"), Err(m) => format!("ERR {}", one_line(m)) });
        match needle {
            None => assert_eq!(r.as_ref().ok(), Some(&true), "{label}: {r:?}"),
            Some(n) => assert!(r.as_ref().is_err_and(|m| m.contains(n)), "{label}: {r:?}"),
        }
    }
}
