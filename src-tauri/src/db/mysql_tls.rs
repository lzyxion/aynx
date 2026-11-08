//! **MySQL · MariaDB 의 TLS**(쿼리 타일 9단계) — mysql_async 는 우리 `ClientConfig`·검증기를 받지 않는다(스파이크 함정 2). 그래서
//! 모드를 드라이버의 `SslOpts` 손잡이로 옮기고, 드라이버에 없는 둘(prefer · verify-ca)은 여기서 만든다. 모드의 뜻·신뢰 기준·오류
//! 문구는 PG 와 같다(`tls`).
//!
//! | 모드 | `SslOpts` |
//! |---|---|
//! | `disable` | 없음(평문) |
//! | `prefer` | `accept_invalid_certs` — 서버가 SSL 을 받지 않으면(`NoClientSslFlagFromServer`) **SSL 없이 다시 붙는다**([`Mysql::connect`](super::mysql::Mysql::connect)) |
//! | `require` | `accept_invalid_certs` |
//! | `verify-ca` | 탐침(**CA 파일만** 믿는 체인 검증) + 본 접속은 기본 검증(webpki-roots + CA 파일) + 이름 = **탐침이 읽은 인증서의 이름**(아래) |
//! | `verify-full` | 기본 검증(webpki-roots + CA 파일) + 이름 = 프리셋 host |
//!
//! 모든 TLS 모드에서 이름은 `tls_hostname_override` 로 준다 — 드라이버는 터널(`127.0.0.1:<임시>`)에 붙으므로 그대로 두면 SNI·이름이
//! `127.0.0.1` 이 된다.
//!
//! ## verify-ca — 탐침(드라이버의 `skip_domain_validation` 이 이 rustls 에서 죽어 있다)
//!
//! mysql_async 0.37 의 `skip_domain_validation` 은 검증 오류의 **글자**에 `NotValidForName` 이 있는지로 이름 오류를 가른다
//! (`io/tls/rustls_io.rs`). rustls 0.23(std)은 이름 오류를 `NotValidForNameContext` 로 만들고 그 `Display` 는
//! `certificate not valid for name …` 이라 그 글자가 없다 — 그 손잡이를 켜도 이름이 틀리면 그대로 실패한다(소스 확인 · 9단계 통합
//! 시험 `MEASURE`). 그래서 verify-ca 는 **두 번** 붙는다:
//! 1. 탐침 — 같은 주소로 TCP 를 열어 서버 인사 패킷을 읽고(`CLIENT_SSL` 이 없으면 곧바로 "서버가 TLS 를 받지 않는다") SSL 요청
//!    패킷을 보낸 뒤 **체인만 보는 검증기**(`tls::ChainOnly` — PG verify-ca 와 같은 것, 신뢰 기준은 **CA 파일만** —
//!    `tls::ca_only_roots`)로 TLS 핸드셰이크를 하고 서버 인증서의 SAN 이름 하나를 읽고 끊는다(인증 전 — 비밀번호를 보내지 않는다).
//! 2. 본 접속 — 그 이름을 `tls_hostname_override` 로 주고 드라이버의 **기본(전체) 검증**으로 붙는다. 드라이버는 신뢰 기준에
//!    webpki-roots 를 **늘 넣는다**(`with_root_certs` 는 더하기만 — 뺄 손잡이가 없다). 그래도 verify-ca 의 뜻("CA 파일이 발급한
//!    인증서만")이 서는 것은 탐침이 **같은 주소의 같은 서버 인증서** 체인을 CA 파일만으로 이미 확인했고, 본 접속은 그 인증서의
//!    이름으로 다시 전체 검증하기 때문이다.
//!
//! **한계(알고 받음)**: 탐침과 본 접속 사이(밀리초 — 같은 TCP 목적지에 두 번 붙는 틈)에 서버(또는 그 사이의 중간자)가 인증서를
//! 바꾸면, 본 접속은 "그 이름으로 **공개 CA** 가 발급한 인증서" 도 받는다 — 그 틈에서만 verify-full 수준(webpki-roots + 이름)으로
//! 내려간다. 이름은 탐침이 CA 파일로 확인한 인증서에서 왔으므로 아무 이름이나 받는 것은 아니다. 막으려면 드라이버가 우리 검증기를
//! 받아야 한다(포크 — 스파이크 함정 2).
//!
//! SAN 이 없는 인증서(옛 CN 만)는 webpki 가 어차피 이름을 못 맞추므로 MySQL verify-ca 로는 붙지 않는다(분명한 문구).

use std::sync::Arc;

use mysql_async::SslOpts;
use rustls::pki_types::ServerName;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::net::CONNECT_TIMEOUT;
use super::tls::{self, CaFile};
use crate::i18n::tr;
use crate::db::conns::DbTlsMode;

/// 모드 → 드라이버 TLS 손잡이 — **순수**(시험 대상). `name` = 인증서에서 맞춰 볼 이름(verify-full 은 프리셋 host, verify-ca 는 탐침이
/// 읽은 이름, prefer·require 는 SNI 로만 쓰인다). `disable` 은 `None`.
pub(crate) fn ssl_opts_for(mode: DbTlsMode, ca: Option<&CaFile>, name: &str) -> Option<SslOpts> {
    let base = SslOpts::default().with_danger_tls_hostname_override(Some(name.to_string()));
    match mode {
        DbTlsMode::Disable => None,
        DbTlsMode::Prefer | DbTlsMode::Require => Some(base.with_danger_accept_invalid_certs(true)),
        DbTlsMode::VerifyCa | DbTlsMode::VerifyFull => {
            // 드라이버의 `PathOrBuf` 는 공개되지 않았다 — `From<Vec<u8>>` 로 만든다(PEM 바이트 그대로).
            let roots = ca.map(|c| vec![c.pem.clone().into()]).unwrap_or_default();
            Some(base.with_root_certs(roots))
        }
    }
}

/// 서버 인사 패킷(Protocol::HandshakeV10)이 `CLIENT_SSL` 을 내거는가 — **순수**. 오류 패킷이면 그 글자.
pub(crate) fn greeting_offers_ssl(payload: &[u8]) -> Result<bool, String> {
    const CLIENT_SSL: u16 = 0x0800;
    match payload.first() {
        Some(0xff) => {
            // 오류 패킷: 0xff · 번호 2바이트 · (`#` + SQLSTATE 5) · 글자
            let rest = payload.get(3..).unwrap_or_default();
            let text = rest.strip_prefix(b"#").map_or(rest, |r| r.get(5..).unwrap_or_default());
            return Err(String::from_utf8_lossy(text).into_owned());
        }
        Some(10) => {}
        _ => return Err("unexpected greeting".into()),
    }
    let nul = payload[1..].iter().position(|&b| b == 0).ok_or("short greeting")? + 1;
    // 버전 글자 NUL · 연결 id 4 · 인증 자료 8 · 채움 1 · 능력 하위 2
    let at = nul + 1 + 4 + 8 + 1;
    let lower = payload.get(at..at + 2).ok_or("short greeting")?;
    Ok(u16::from_le_bytes([lower[0], lower[1]]) & CLIENT_SSL != 0)
}

/// SSL 요청 패킷(seq 1) — 능력(PROTOCOL_41 · SSL · SECURE_CONNECTION · LONG_PASSWORD) · 최대 패킷 16 MiB · utf8mb4 · 채움 23.
fn ssl_request() -> [u8; 36] {
    let mut p = [0u8; 36];
    p[..4].copy_from_slice(&[32, 0, 0, 1]);
    let caps: u32 = 0x0000_0001 | 0x0000_0200 | 0x0000_0800 | 0x0000_8000;
    p[4..8].copy_from_slice(&caps.to_le_bytes());
    p[8..12].copy_from_slice(&(16u32 * 1024 * 1024).to_le_bytes());
    p[12] = 45;
    p
}

/// 서버 인증서의 SAN 이름들 — DNS 이름 먼저, 그다음 IP 주소(글자). 못 읽으면 빈 목록. **순수.**
pub(crate) fn cert_names(der: &[u8]) -> Vec<String> {
    use x509_cert::der::Decode;
    use x509_cert::ext::pkix::name::GeneralName;
    use x509_cert::ext::pkix::SubjectAltName;
    let Ok(cert) = x509_cert::Certificate::from_der(der) else {
        return Vec::new();
    };
    let Ok(Some((_, san))) = cert.tbs_certificate.get::<SubjectAltName>() else {
        return Vec::new();
    };
    let mut dns = Vec::new();
    let mut ips = Vec::new();
    for n in san.0 {
        match n {
            GeneralName::DnsName(d) => dns.push(d.as_str().to_string()),
            GeneralName::IpAddress(o) => {
                let b = o.as_bytes();
                if let Ok(a) = <[u8; 4]>::try_from(b) {
                    ips.push(std::net::IpAddr::from(a).to_string());
                } else if let Ok(a) = <[u8; 16]>::try_from(b) {
                    ips.push(std::net::IpAddr::from(a).to_string());
                }
            }
            _ => {}
        }
    }
    dns.extend(ips);
    dns
}

/// 그 인증서가 맞다고 할 이름 하나 — 와일드카드 `*.example.com` 은 그 아래 이름 하나로 바꾼다. 없으면 `None`. **순수.**
pub(crate) fn name_for(names: &[String]) -> Option<String> {
    let n = names.first()?;
    Some(match n.strip_prefix("*.") {
        Some(rest) => format!("aynx-verify-ca.{rest}"),
        None => n.clone(),
    })
}

/// verify-ca 탐침 — 서버 인증서의 체인을 확인하고 그 이름 하나를 돌려준다(위 머리말). `sni` = 프리셋 host. 실패는 사람 문구.
pub(crate) async fn probe_name(addr: (&str, u16), sni: &str, ca: Option<&CaFile>) -> Result<String, String> {
    let cant = |e: &dyn std::fmt::Display| {
        tr!(
            ko: "MySQL 서버 인증서를 확인하려고 붙지 못했습니다: {e}",
            en: "Could not connect to check the MySQL server certificate: {e}"
        )
    };
    let fut = async {
        let mut tcp = tokio::net::TcpStream::connect(addr).await.map_err(|e| cant(&e))?;
        let mut head = [0u8; 4];
        tcp.read_exact(&mut head).await.map_err(|e| cant(&e))?;
        let len = u32::from_le_bytes([head[0], head[1], head[2], 0]) as usize;
        if len == 0 || len > 64 * 1024 {
            return Err(cant(&"unexpected greeting"));
        }
        let mut payload = vec![0u8; len];
        tcp.read_exact(&mut payload).await.map_err(|e| cant(&e))?;
        if !greeting_offers_ssl(&payload).map_err(|e| cant(&e))? {
            return Err(tls::server_without_tls());
        }
        tcp.write_all(&ssl_request()).await.map_err(|e| cant(&e))?;
        let verifier = Arc::new(tls::ChainOnly::new(tls::ca_only_roots(ca)?));
        let config = tls::client_config(verifier)?;
        let name = ServerName::try_from(sni.to_string()).map_err(|e| cant(&e))?;
        let conn = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(name, tcp)
            .await
            .map_err(|e| tls::cert_error_in(&e, sni).unwrap_or_else(|| cant(&e)))?;
        let der = conn.get_ref().1.peer_certificates().and_then(|c| c.first()).map(|c| c.to_vec());
        Ok(der)
    };
    let der = tokio::time::timeout(CONNECT_TIMEOUT, fut).await.map_err(|_| cant(&"timed out"))??;
    der.as_deref()
        .map(cert_names)
        .and_then(|n| name_for(&n))
        .ok_or_else(|| {
            tr!(
                ko: "서버 인증서에 이름(SAN)이 없어 MySQL 의 CA 검증으로 붙을 수 없습니다 — SAN 이 있는 인증서를 쓰거나 TLS 를 '필수'로 바꾸세요(검증 안 함)",
                en: "The server certificate has no name (SAN), so MySQL cannot connect with 'Verify CA' — use a certificate with a SAN, or set TLS to 'Required' (not verified)"
            )
        })
}
