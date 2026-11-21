//! 네트워크 DB 의 TLS(PG · MySQL/MariaDB 공용) — 모드 다섯은 libpq 의 이름 · 뜻이다.
//!
//! - **고른 모드 그대로** 동작한다 — libpq 의 "root.crt 가 있으면 require 가 verify-ca 처럼" 같은 숨은 동작은 없다.
//! - **신뢰 기준은 OS 인증서 저장소가 아니다** — mysql_async 가 OS 저장소를 못 써서 엔진 간 동작을 webpki-roots + CA 파일로 맞췄다.
//! - **verify-ca 는 CA 파일만 믿는다** — 공개 CA + 이름 무시는 아무 공개 CA 가 아무 이름에 발급한 인증서를 받아 검증이 없는 셈이다.
//! - 터널(`127.0.0.1:<임시>`)에 붙어도 SNI · 이름 검증은 **프리셋 host** 로 한다(그 자리는 엔진 파일에 있다).
//! - 암호 공급자는 늘 aws-lc-rs — 전역 기본 공급자에 기대지 않는다.
//! - CA 파일은 서버가 접속 순간 읽는다 — GUI 는 내용을 보내지 않는다.

use std::error::Error as StdError;
use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::{verify_server_cert_signed_by_trust_anchor, WebPkiServerVerifier};
use rustls::crypto::{aws_lc_rs, verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::server::ParsedCertificate;
use rustls::{CertificateError, ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};

use crate::i18n::tr;
use crate::db::conns::DbTlsMode;

const CA_FILE_MAX: u64 = 4 * 1024 * 1024;

pub(crate) fn verifies(mode: DbTlsMode) -> bool {
    matches!(mode, DbTlsMode::VerifyCa | DbTlsMode::VerifyFull)
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(aws_lc_rs::default_provider())
}

// ---------------------------------------------------------------------------
// CA 파일
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub(crate) struct CaFile {
    pub pem: Vec<u8>,
    pub certs: Vec<CertificateDer<'static>>,
}

pub(crate) fn parse_ca_pem(bytes: &[u8], path: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    let not_pem = || {
        tr!(
            ko: "CA 파일이 PEM 인증서가 아닙니다: {path} — '-----BEGIN CERTIFICATE-----' 블록이 있는 파일을 지정하세요",
            en: "The CA file is not a PEM certificate: {path} — choose a file with '-----BEGIN CERTIFICATE-----' blocks"
        )
    };
    let mut out = Vec::new();
    for c in CertificateDer::pem_slice_iter(bytes) {
        out.push(c.map_err(|_| not_pem())?);
    }
    if out.is_empty() {
        return Err(not_pem());
    }
    Ok(out)
}

pub(crate) async fn read_ca(mode: DbTlsMode, path: Option<&str>) -> Result<Option<CaFile>, String> {
    // 읽기가 관대해 파일에 CA 없는 verify-ca 가 남을 수 있다 — 전송로를 열기 전에 거절한다.
    mode.check_ca(path)?;
    let Some(path) = path.map(str::trim).filter(|p| !p.is_empty() && verifies(mode)) else {
        return Ok(None);
    };
    let unreadable = |e: &dyn std::fmt::Display| {
        tr!(
            ko: "CA 파일을 읽지 못했습니다: {path} — {e}",
            en: "Could not read the CA file: {path} — {e}"
        )
    };
    let meta = tokio::fs::metadata(path).await.map_err(|e| unreadable(&e))?;
    if !meta.is_file() || meta.len() > CA_FILE_MAX {
        return Err(unreadable(&tr!(
            ko: "파일이 아니거나 너무 큽니다(4 MiB 까지)",
            en: "not a file or too large (up to 4 MiB)"
        )));
    }
    let pem = tokio::fs::read(path).await.map_err(|e| unreadable(&e))?;
    let certs = parse_ca_pem(&pem, path)?;
    Ok(Some(CaFile { pem, certs }))
}

pub(crate) fn roots(ca: Option<&CaFile>) -> Result<RootCertStore, String> {
    let mut store = RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    add_ca(&mut store, ca)?;
    Ok(store)
}

pub(crate) fn ca_only_roots(ca: Option<&CaFile>) -> Result<RootCertStore, String> {
    let Some(ca) = ca.filter(|c| !c.certs.is_empty()) else {
        return Err(crate::db::conns::verify_ca_needs_ca());
    };
    let mut store = RootCertStore::empty();
    add_ca(&mut store, Some(ca))?;
    Ok(store)
}

fn add_ca(store: &mut RootCertStore, ca: Option<&CaFile>) -> Result<(), String> {
    for c in ca.map(|c| c.certs.as_slice()).unwrap_or_default() {
        store.add(c.clone()).map_err(|e| {
            tr!(
                ko: "CA 파일의 인증서를 신뢰 기준에 넣지 못했습니다: {e}",
                en: "Could not add the CA file's certificate to the trust roots: {e}"
            )
        })?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 검증기
// ---------------------------------------------------------------------------

/// prefer · require — 인증서를 믿을지 보지 않지만 핸드셰이크 서명은 확인한다(서버가 그 키를 쥐었는가).
#[derive(Debug)]
pub(crate) struct NoVerify {
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

/// verify-ca — 체인 · 유효 기간 · 용도만 보고 이름은 보지 않는다(libpq `verify-ca` 와 같은 뜻).
/// CRL · OCSP 는 보지 않는다(webpki 기본 검증기도 CRL 을 주지 않으면 같다).
#[derive(Debug)]
pub(crate) struct ChainOnly {
    roots: Arc<RootCertStore>,
    provider: Arc<CryptoProvider>,
}

impl ChainOnly {
    pub(crate) fn new(roots: RootCertStore) -> ChainOnly {
        ChainOnly {
            roots: Arc::new(roots),
            provider: provider(),
        }
    }
}

impl ServerCertVerifier for ChainOnly {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let cert = ParsedCertificate::try_from(end_entity)?;
        verify_server_cert_signed_by_trust_anchor(
            &cert,
            &self.roots,
            intermediates,
            now,
            self.provider.signature_verification_algorithms.all,
        )?;
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

pub(crate) fn verifier(mode: DbTlsMode, ca: Option<&CaFile>) -> Result<Option<Arc<dyn ServerCertVerifier>>, String> {
    Ok(Some(match mode {
        DbTlsMode::Disable => return Ok(None),
        DbTlsMode::Prefer | DbTlsMode::Require => Arc::new(NoVerify { provider: provider() }),
        DbTlsMode::VerifyCa => Arc::new(ChainOnly::new(ca_only_roots(ca)?)),
        DbTlsMode::VerifyFull => WebPkiServerVerifier::builder_with_provider(Arc::new(roots(ca)?), provider())
            .build()
            .map_err(|e| tr!(ko: "인증서 검증기를 만들지 못했습니다: {e}", en: "Could not build the certificate verifier: {e}"))?,
    }))
}

pub(crate) fn client_config(v: Arc<dyn ServerCertVerifier>) -> Result<ClientConfig, String> {
    Ok(ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| tr!(ko: "TLS 설정을 만들지 못했습니다: {e}", en: "Could not build the TLS settings: {e}"))?
        .dangerous()
        .with_custom_certificate_verifier(v)
        .with_no_client_auth())
}

// ---------------------------------------------------------------------------
// 오류
// ---------------------------------------------------------------------------

/// `io::Error` 는 `source()` 가 안쪽을 건너뛰므로 `get_ref()` 도 본다.
pub(crate) fn find_rustls<'a>(e: &'a (dyn StdError + 'static)) -> Option<&'a rustls::Error> {
    let mut cur: Option<&(dyn StdError + 'static)> = Some(e);
    while let Some(x) = cur {
        if let Some(r) = x.downcast_ref::<rustls::Error>() {
            return Some(r);
        }
        if let Some(inner) = x.downcast_ref::<std::io::Error>().and_then(|io| io.get_ref()) {
            let inner: &(dyn StdError + 'static) = inner;
            if let Some(r) = find_rustls(inner) {
                return Some(r);
            }
        }
        cur = x.source();
    }
    None
}

/// `name` = 확인한 이름(프리셋 host).
pub(crate) fn cert_error(err: &rustls::Error, name: &str) -> Option<String> {
    let rustls::Error::InvalidCertificate(c) = err else {
        return None;
    };
    use CertificateError as C;
    let why = match c {
        C::Expired | C::ExpiredContext { .. } => tr!(ko: "인증서가 만료되었습니다", en: "the certificate has expired"),
        C::NotValidYet | C::NotValidYetContext { .. } => tr!(
            ko: "인증서의 유효 기간이 아직 시작되지 않았습니다(이 PC 의 시계도 확인하세요)",
            en: "the certificate is not valid yet (check this PC's clock too)"
        ),
        C::NotValidForName | C::NotValidForNameContext { .. } => tr!(
            ko: "인증서의 이름이 '{name}' 과(와) 맞지 않습니다",
            en: "the certificate's name does not match '{name}'"
        ),
        C::UnknownIssuer => tr!(
            ko: "알 수 없는 인증 기관(CA)이 발급한 인증서입니다(자체 서명 포함)",
            en: "the certificate was issued by an unknown certificate authority (or is self-signed)"
        ),
        C::Revoked => tr!(ko: "폐기된 인증서입니다", en: "the certificate has been revoked"),
        C::InvalidPurpose | C::InvalidPurposeContext { .. } => tr!(
            ko: "서버용 인증서가 아닙니다(용도 확장)",
            en: "the certificate is not for servers (extended key usage)"
        ),
        other => other.to_string(),
    };
    Some(format!(
        "{}\n{}",
        tr!(
            ko: "서버 인증서를 확인하지 못했습니다. 사내·클라우드 인증서라면 연결 설정에 CA 파일을 지정하세요.",
            en: "Could not verify the server certificate. For a company or cloud certificate, set a CA file in the connection settings."
        ),
        tr!(ko: "원인: {why}", en: "Cause: {why}")
    ))
}

pub(crate) fn cert_error_in(e: &(dyn StdError + 'static), name: &str) -> Option<String> {
    find_rustls(e).and_then(|r| cert_error(r, name))
}

pub(crate) fn server_without_tls() -> String {
    tr!(
        ko: "이 DB 서버는 TLS(SSL)를 받지 않습니다 — 서버에서 SSL 을 켜거나, 연결 설정의 TLS 를 '끔' 또는 '가능하면 사용'으로 바꾸세요",
        en: "This database server does not accept TLS (SSL) — turn on SSL on the server, or set TLS to 'Off' or 'Use if available' in the connection settings"
    )
}
