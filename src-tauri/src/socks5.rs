//! 동적 포워딩(`ssh -D`)이 쓰는 **SOCKS5 의 최소 부분집합** — 손으로 쓴 파서와 응답 빌더.
//!
//! [`crate::port_forward`] 의 동적 리스너가 연결마다 [`handshake`] 를 한 번 돌려 "어디로
//! 가고 싶은가" 를 알아낸 뒤, 그 목적지로 SSH direct-tcpip 채널을 연다.
//!
//! ## 받는 것 (RFC 1928 의 부분집합)
//!
//! | 단계 | 프레임 | 우리 답 |
//! | --- | --- | --- |
//! | 인사 | `05 nmethods methods…` | 인증 없음(`00`)이 목록에 있으면 `05 00`, 없으면 `05 FF` 후 끊기 |
//! | 요청 | `05 01 00 ATYP 주소 포트` (CONNECT) | 채널이 열리면 `05 00 00 01 0.0.0.0 0` |
//! | 요청 | `05 02`/`05 03` (BIND · UDP ASSOCIATE) | `05 07` (명령 미지원) 후 끊기 |
//! | 요청 | ATYP 가 `01`/`03`/`04` 밖 | `05 08` (주소 형식 미지원) 후 끊기 |
//!
//! ATYP 는 셋 다 받는다 — `01` IPv4 · `03` 도메인 이름 · `04` IPv6.
//!
//! ## 도메인 이름은 **풀지 않고** 서버에 넘긴다
//!
//! `curl --socks5-hostname` 처럼 클라이언트가 이름을 그대로 보내면, 우리는 그 글자를
//! `channel_open_direct_tcpip` 의 `host_to_connect` 에 그대로 싣는다. 이름을 푸는 것은
//! **원격 서버**다 — 그것이 SSH 위 SOCKS 의 요점이다(사내 DNS 로만 풀리는 이름에 닿고,
//! 내 PC 의 DNS 질의로 목적지가 새지 않는다).
//!
//! ## 빠진 것 (일부러)
//!
//! - **인증(사용자명/비밀번호 `02`)** — 리스너가 `127.0.0.1` 에만 서므로 이 PC 의 프로세스만
//!   닿는다. 같은 PC 의 다른 사용자까지 막아야 하면 그때 붙인다 (후속 과제).
//! - **SOCKS4/4a** — 버전 바이트가 `05` 가 아니면 끊는다.
//! - **BIND · UDP ASSOCIATE** — SSH direct-tcpip 는 나가는 TCP 하나뿐이라 실어 나를 길이 없다.
//!
//! 파서는 전부 **순수 함수**다(바이트 조각 → 결과). 비동기 드라이버([`handshake`])는 그
//! 위에 얹은 얇은 읽기 루프이고, 테스트는 `tokio::io::duplex` 로 양쪽을 맞물려 돈다.

use std::net::{Ipv4Addr, Ipv6Addr};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// SOCKS 버전 바이트. 5 가 아니면 이 모듈이 다룰 프레임이 아니다.
pub const VERSION: u8 = 0x05;
/// 인증 방식 "인증 없음".
pub const METHOD_NO_AUTH: u8 = 0x00;
/// 인증 방식 "받아들일 수 있는 것이 없음".
pub const METHOD_NONE_ACCEPTABLE: u8 = 0xFF;

const CMD_CONNECT: u8 = 0x01;
const ATYP_IPV4: u8 = 0x01;
const ATYP_DOMAIN: u8 = 0x03;
const ATYP_IPV6: u8 = 0x04;

/// 요청에 대한 응답 코드 (RFC 1928 §6 의 REP). 쓰는 것만 둔다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reply {
    Succeeded = 0x00,
    GeneralFailure = 0x01,
    ConnectionRefused = 0x05,
    CommandNotSupported = 0x07,
    AddressTypeNotSupported = 0x08,
}

/// 파싱이 **틀렸다** (모자란 것은 오류가 아니라 `Ok(None)` 이다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SocksError {
    /// 버전 바이트가 5 가 아니다 (SOCKS4 등).
    BadVersion(u8),
    /// 인사에 방식이 하나도 없다 (`nmethods = 0`).
    NoMethods,
    /// CONNECT 가 아닌 명령 (BIND `02` · UDP ASSOCIATE `03` …) → `05 07`.
    UnsupportedCommand(u8),
    /// 모르는 주소 형식 → `05 08`.
    UnsupportedAddressType(u8),
    /// 도메인 이름이 비었거나 UTF-8 이 아니다.
    BadDomain,
    /// 프레임 하나가 끝나지 않은 채 상한을 넘었다 — SOCKS 가 아닌 무언가다.
    TooLong,
}

impl SocksError {
    /// 이 오류를 요청 단계에서 만났을 때 클라이언트에게 돌려줄 코드. 인사 단계의 오류에는
    /// 요청 응답을 보내지 않는다(아직 요청을 받지 않았다) — 부르는 쪽이 가린다.
    pub fn reply(&self) -> Reply {
        match self {
            SocksError::UnsupportedCommand(_) => Reply::CommandNotSupported,
            SocksError::UnsupportedAddressType(_) => Reply::AddressTypeNotSupported,
            _ => Reply::GeneralFailure,
        }
    }
}

/// 인사 프레임을 읽은 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Greeting {
    /// 클라이언트가 "인증 없음" 을 제안했는가. 거짓이면 `05 FF` 로 끊는다.
    pub no_auth: bool,
}

/// CONNECT 요청의 목적지. `host` 는 IP 면 그 글자(IPv6 는 대괄호 없이), 도메인이면
/// **받은 글자 그대로**다 — 풀지 않는다(모듈 머리말).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub host: String,
    pub port: u16,
}

/// 인사 `05 nmethods methods…` — **순수 함수**.
///
/// 돌려주는 `usize` 는 소비한 바이트 수다. 모자라면 `Ok(None)` (더 읽어 와서 다시 부른다).
pub fn parse_greeting(buf: &[u8]) -> Result<Option<(Greeting, usize)>, SocksError> {
    let Some(&ver) = buf.first() else {
        return Ok(None);
    };
    if ver != VERSION {
        return Err(SocksError::BadVersion(ver));
    }
    let Some(&n) = buf.get(1) else {
        return Ok(None);
    };
    if n == 0 {
        return Err(SocksError::NoMethods);
    }
    let end = 2 + usize::from(n);
    let Some(methods) = buf.get(2..end) else {
        return Ok(None);
    };
    Ok(Some((
        Greeting {
            no_auth: methods.contains(&METHOD_NO_AUTH),
        },
        end,
    )))
}

/// 요청 `05 CMD 00 ATYP 주소 포트` — **순수 함수**. CONNECT 만 받는다.
///
/// 명령·주소 형식이 틀렸으면 **주소를 끝까지 읽기 전에도** 오류를 낸다 — 어차피 응답을
/// 하나 보내고 끊을 연결이라 나머지 바이트를 기다릴 이유가 없다.
pub fn parse_request(buf: &[u8]) -> Result<Option<(Request, usize)>, SocksError> {
    if buf.len() < 4 {
        // 버전은 보이는 즉시 가려 준다 (나머지를 기다리지 않는다).
        if let Some(&ver) = buf.first() {
            if ver != VERSION {
                return Err(SocksError::BadVersion(ver));
            }
        }
        if let Some(&cmd) = buf.get(1) {
            if cmd != CMD_CONNECT {
                return Err(SocksError::UnsupportedCommand(cmd));
            }
        }
        return Ok(None);
    }
    let (ver, cmd, atyp) = (buf[0], buf[1], buf[3]);
    if ver != VERSION {
        return Err(SocksError::BadVersion(ver));
    }
    if cmd != CMD_CONNECT {
        return Err(SocksError::UnsupportedCommand(cmd));
    }
    // buf[2] 는 RSV — 0 이어야 하지만 엄격히 따지지 않는다 (curl·브라우저 모두 0 을 보낸다).
    let (host, addr_end) = match atyp {
        ATYP_IPV4 => {
            let Some(b) = buf.get(4..8) else {
                return Ok(None);
            };
            (Ipv4Addr::new(b[0], b[1], b[2], b[3]).to_string(), 8)
        }
        ATYP_IPV6 => {
            let Some(b) = buf.get(4..20) else {
                return Ok(None);
            };
            let mut octets = [0u8; 16];
            octets.copy_from_slice(b);
            (Ipv6Addr::from(octets).to_string(), 20)
        }
        ATYP_DOMAIN => {
            let Some(&len) = buf.get(4) else {
                return Ok(None);
            };
            if len == 0 {
                return Err(SocksError::BadDomain);
            }
            let end = 5 + usize::from(len);
            let Some(b) = buf.get(5..end) else {
                return Ok(None);
            };
            let name = std::str::from_utf8(b).map_err(|_| SocksError::BadDomain)?;
            (name.to_string(), end)
        }
        other => return Err(SocksError::UnsupportedAddressType(other)),
    };
    let Some(p) = buf.get(addr_end..addr_end + 2) else {
        return Ok(None);
    };
    let port = u16::from_be_bytes([p[0], p[1]]);
    Ok(Some((Request { host, port }, addr_end + 2)))
}

/// 인사 응답 `05 method`.
pub fn method_reply(method: u8) -> [u8; 2] {
    [VERSION, method]
}

/// 요청 응답 `05 REP 00 01 0.0.0.0 0` — 묶인 주소(BND)는 언제나 `0.0.0.0:0` 이다.
///
/// 채널의 서버 쪽 주소는 우리가 모르고(direct-tcpip 확인에는 실리지 않는다), 알려 줄
/// 이유도 없다 — CONNECT 클라이언트는 이 값을 쓰지 않는다 (OpenSSH 의 `-D` 도 같다).
pub fn reply(code: Reply) -> [u8; 10] {
    [VERSION, code as u8, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]
}

/// 파서 하나의 모양 — 바이트 조각 → (프레임, 소비한 길이) · 모자라면 `None`.
type Parser<T> = fn(&[u8]) -> Result<Option<(T, usize)>, SocksError>;

/// 버퍼에서 `parse` 가 프레임을 하나 꺼낼 때까지 읽는다. 꺼낸 만큼은 버퍼 앞에서 떼어 낸다.
/// EOF 에서 프레임이 모자라면 `None`.
async fn read_frame<S, T>(
    stream: &mut S,
    buf: &mut Vec<u8>,
    parse: Parser<T>,
) -> Result<Option<T>, SocksError>
where
    S: AsyncRead + Unpin,
{
    loop {
        if let Some((frame, used)) = parse(buf)? {
            buf.drain(..used);
            return Ok(Some(frame));
        }
        // 인사도 요청도 262 바이트를 넘지 않는다 — 그 이상 쌓이면 SOCKS 가 아니다.
        if buf.len() > 512 {
            return Err(SocksError::TooLong);
        }
        let mut chunk = [0u8; 512];
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => return Ok(None),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
}

/// 한 연결의 핸드셰이크를 끝까지 돈다 — 인사를 받고 답하고, CONNECT 요청을 받는다.
///
/// 성공하면 목적지와 **요청 뒤에 이미 따라온 바이트**(클라이언트가 응답을 기다리지 않고
/// 먼저 보낸 데이터 — 드물지만 있다)를 돌려준다. 부르는 쪽은 채널을 연 뒤 [`reply`] 를
/// 보내고, 남은 바이트를 채널에 먼저 쓴 다음 중계를 시작한다.
///
/// 실패하면 필요한 응답(`05 FF` · `05 07` · `05 08` · `05 01`)을 **여기서 이미 보냈다** —
/// 부르는 쪽은 소켓을 떨어뜨리기만 하면 된다. 시간 제한은 부르는 쪽이 건다.
pub async fn handshake<S>(stream: &mut S) -> Option<(Request, Vec<u8>)>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut buf = Vec::with_capacity(64);

    // ── 인사 ───────────────────────────────────────────────────────────────
    let greeting = match read_frame(stream, &mut buf, parse_greeting).await {
        Ok(Some(g)) => g,
        // 버전이 틀린 인사에는 SOCKS5 응답을 보내 봐야 읽을 사람이 없다 — 그냥 끊는다.
        Ok(None) | Err(_) => return None,
    };
    if !greeting.no_auth {
        let _ = stream
            .write_all(&method_reply(METHOD_NONE_ACCEPTABLE))
            .await;
        return None;
    }
    stream.write_all(&method_reply(METHOD_NO_AUTH)).await.ok()?;

    // ── 요청 ───────────────────────────────────────────────────────────────
    match read_frame(stream, &mut buf, parse_request).await {
        Ok(Some(req)) => Some((req, buf)),
        Ok(None) => None,
        Err(e) => {
            let _ = stream.write_all(&reply(e.reply())).await;
            None
        }
    }
}

#[cfg(test)]
mod tests;
