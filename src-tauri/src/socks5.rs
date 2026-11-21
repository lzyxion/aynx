//! 동적 포워딩(`ssh -D`)이 쓰는 SOCKS5 의 최소 부분집합(RFC 1928 — CONNECT · 인증 없음만).
//!
//! - 도메인 이름은 **풀지 않고** 그 글자 그대로 서버에 넘긴다 — 사내 DNS 로만 풀리는 이름에 닿고, 내 PC 의 DNS 질의로 목적지가 새지 않는다.
//! - 인증(`02`)은 일부러 없다 — 리스너가 `127.0.0.1` 에만 서서 이 PC 의 프로세스만 닿는다(같은 PC 의 다른 사용자는 막지 못한다 — 알고 받은 한계).
//! - BIND · UDP ASSOCIATE 는 받지 않는다 — SSH direct-tcpip 는 나가는 TCP 하나뿐이다.

use std::net::{Ipv4Addr, Ipv6Addr};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const VERSION: u8 = 0x05;
pub const METHOD_NO_AUTH: u8 = 0x00;
pub const METHOD_NONE_ACCEPTABLE: u8 = 0xFF;

const CMD_CONNECT: u8 = 0x01;
const ATYP_IPV4: u8 = 0x01;
const ATYP_DOMAIN: u8 = 0x03;
const ATYP_IPV6: u8 = 0x04;

/// RFC 1928 §6 의 REP.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reply {
    Succeeded = 0x00,
    GeneralFailure = 0x01,
    ConnectionRefused = 0x05,
    CommandNotSupported = 0x07,
    AddressTypeNotSupported = 0x08,
}

/// 모자란 것은 오류가 아니라 `Ok(None)` 이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SocksError {
    BadVersion(u8),
    NoMethods,
    UnsupportedCommand(u8),
    UnsupportedAddressType(u8),
    BadDomain,
    TooLong,
}

impl SocksError {
    /// 요청 단계에서만 쓴다 — 인사 단계의 오류에는 요청 응답을 보내지 않는다.
    pub fn reply(&self) -> Reply {
        match self {
            SocksError::UnsupportedCommand(_) => Reply::CommandNotSupported,
            SocksError::UnsupportedAddressType(_) => Reply::AddressTypeNotSupported,
            _ => Reply::GeneralFailure,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Greeting {
    pub no_auth: bool,
}

/// `host` 는 IPv6 면 대괄호 없이, 도메인이면 받은 글자 그대로다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub host: String,
    pub port: u16,
}

/// 돌려주는 `usize` 는 소비한 바이트 수다. 모자라면 `Ok(None)`.
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

pub fn parse_request(buf: &[u8]) -> Result<Option<(Request, usize)>, SocksError> {
    if buf.len() < 4 {
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
    // buf[2] 는 RSV — 엄격히 따지지 않는다.
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

pub fn method_reply(method: u8) -> [u8; 2] {
    [VERSION, method]
}

/// 묶인 주소(BND)는 언제나 `0.0.0.0:0` — direct-tcpip 확인에 실리지 않고 CONNECT 클라이언트는 쓰지 않는다(OpenSSH `-D` 도 같다).
pub fn reply(code: Reply) -> [u8; 10] {
    [VERSION, code as u8, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]
}

type Parser<T> = fn(&[u8]) -> Result<Option<(T, usize)>, SocksError>;

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

/// 성공하면 목적지와 요청 뒤에 이미 따라온 바이트를 돌려준다 — 부르는 쪽은 채널을 연 뒤 [`reply`] 를 보내고,
/// 남은 바이트를 채널에 **먼저** 쓴 다음 중계한다. 실패 응답은 여기서 이미 보냈다. 시간 제한은 부르는 쪽이 건다.
pub async fn handshake<S>(stream: &mut S) -> Option<(Request, Vec<u8>)>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut buf = Vec::with_capacity(64);

    // ── 인사 ──
    let greeting = match read_frame(stream, &mut buf, parse_greeting).await {
        Ok(Some(g)) => g,
        Ok(None) | Err(_) => return None,
    };
    if !greeting.no_auth {
        let _ = stream
            .write_all(&method_reply(METHOD_NONE_ACCEPTABLE))
            .await;
        return None;
    }
    stream.write_all(&method_reply(METHOD_NO_AUTH)).await.ok()?;

    // ── 요청 ──
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
