use super::*;

// ── 인사 ────────────────────────────────────────────────────────────────

#[test]
fn greeting_with_no_auth() {
    assert_eq!(
        parse_greeting(&[5, 2, 0, 2]).unwrap(),
        Some((Greeting { no_auth: true }, 4))
    );
}

#[test]
fn greeting_without_no_auth() {
    // 사용자명/비밀번호(02)만 제안 — 받을 수 있는 방식이 없다.
    assert_eq!(
        parse_greeting(&[5, 1, 2]).unwrap(),
        Some((Greeting { no_auth: false }, 3))
    );
}

#[test]
fn greeting_truncated_asks_for_more() {
    assert_eq!(parse_greeting(&[]).unwrap(), None);
    assert_eq!(parse_greeting(&[5]).unwrap(), None);
    assert_eq!(parse_greeting(&[5, 2, 0]).unwrap(), None);
}

#[test]
fn greeting_rejects_socks4_and_empty_methods() {
    assert_eq!(parse_greeting(&[4, 1, 0]), Err(SocksError::BadVersion(4)));
    assert_eq!(parse_greeting(&[5, 0]), Err(SocksError::NoMethods));
}

/// 인사 뒤에 요청이 붙어 온 경우 — 소비한 길이만큼만 먹는다.
#[test]
fn greeting_reports_consumed_length() {
    let (_, used) = parse_greeting(&[5, 1, 0, 5, 1, 0]).unwrap().unwrap();
    assert_eq!(used, 3);
}

// ── 요청 ────────────────────────────────────────────────────────────────

#[test]
fn request_ipv4() {
    let frame = [5, 1, 0, 1, 10, 0, 0, 5, 0x15, 0x38]; // 10.0.0.5:5432
    assert_eq!(
        parse_request(&frame).unwrap(),
        Some((
            Request {
                host: "10.0.0.5".into(),
                port: 5432
            },
            10
        ))
    );
}

#[test]
fn request_domain_is_kept_verbatim() {
    let mut frame = vec![5, 1, 0, 3, 11];
    frame.extend_from_slice(b"ifconfig.me");
    frame.extend_from_slice(&443u16.to_be_bytes());
    assert_eq!(
        parse_request(&frame).unwrap(),
        Some((
            Request {
                host: "ifconfig.me".into(),
                port: 443
            },
            frame.len()
        ))
    );
}

#[test]
fn request_ipv6_has_no_brackets() {
    let mut frame = vec![5, 1, 0, 4];
    frame.extend_from_slice(&Ipv6Addr::LOCALHOST.octets());
    frame.extend_from_slice(&80u16.to_be_bytes());
    assert_eq!(
        parse_request(&frame).unwrap(),
        Some((
            Request {
                host: "::1".into(),
                port: 80
            },
            22
        ))
    );
}

#[test]
fn request_truncated_asks_for_more() {
    let full = [5, 1, 0, 1, 10, 0, 0, 5, 0x15, 0x38];
    for cut in 0..full.len() {
        assert_eq!(
            parse_request(&full[..cut]).unwrap(),
            None,
            "잘린 길이 {cut}"
        );
    }
    let mut domain = vec![5, 1, 0, 3, 4];
    domain.extend_from_slice(b"db01");
    // 포트 두 바이트가 아직 없다
    assert_eq!(parse_request(&domain).unwrap(), None);
}

#[test]
fn request_rejects_bind_and_udp_early() {
    assert_eq!(
        parse_request(&[5, 2]),
        Err(SocksError::UnsupportedCommand(2))
    );
    assert_eq!(
        parse_request(&[5, 3, 0, 1]),
        Err(SocksError::UnsupportedCommand(3))
    );
    assert_eq!(
        SocksError::UnsupportedCommand(2).reply(),
        Reply::CommandNotSupported
    );
}

#[test]
fn request_rejects_unknown_address_type() {
    let err = parse_request(&[5, 1, 0, 9, 0, 0]).unwrap_err();
    assert_eq!(err, SocksError::UnsupportedAddressType(9));
    assert_eq!(err.reply(), Reply::AddressTypeNotSupported);
}

#[test]
fn request_rejects_bad_version_and_bad_domain() {
    assert_eq!(parse_request(&[4, 1, 0, 1]), Err(SocksError::BadVersion(4)));
    assert_eq!(
        parse_request(&[5, 1, 0, 3, 0, 0, 80]),
        Err(SocksError::BadDomain)
    );
    assert_eq!(
        parse_request(&[5, 1, 0, 3, 2, 0xff, 0xfe, 0, 80]),
        Err(SocksError::BadDomain)
    );
}

// ── 응답 ────────────────────────────────────────────────────────────────

#[test]
fn replies_have_the_fixed_shape() {
    assert_eq!(method_reply(METHOD_NO_AUTH), [5, 0]);
    assert_eq!(method_reply(METHOD_NONE_ACCEPTABLE), [5, 0xFF]);
    assert_eq!(reply(Reply::Succeeded), [5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    assert_eq!(reply(Reply::ConnectionRefused)[1], 5);
    assert_eq!(reply(Reply::GeneralFailure)[1], 1);
    assert_eq!(reply(Reply::CommandNotSupported)[1], 7);
}

// ── 드라이버 (duplex 로 양쪽을 맞물린다) ──────────────────────────────────

#[tokio::test]
async fn handshake_happy_path_keeps_trailing_bytes() {
    let (mut client, mut server) = tokio::io::duplex(1024);
    let driver = tokio::spawn(async move { handshake(&mut server).await });

    client.write_all(&[5, 1, 0]).await.unwrap();
    let mut m = [0u8; 2];
    client.read_exact(&mut m).await.unwrap();
    assert_eq!(m, [5, 0]);

    // 요청 + 응답을 기다리지 않고 먼저 보낸 데이터 (`GET`)
    let mut req = vec![5, 1, 0, 3, 4];
    req.extend_from_slice(b"db01");
    req.extend_from_slice(&5432u16.to_be_bytes());
    req.extend_from_slice(b"GET");
    client.write_all(&req).await.unwrap();

    let (target, rest) = driver.await.unwrap().expect("핸드셰이크 실패");
    assert_eq!(
        target,
        Request {
            host: "db01".into(),
            port: 5432
        }
    );
    assert_eq!(rest, b"GET");
}

#[tokio::test]
async fn handshake_refuses_clients_without_no_auth() {
    let (mut client, mut server) = tokio::io::duplex(1024);
    let driver = tokio::spawn(async move { handshake(&mut server).await });
    client.write_all(&[5, 1, 2]).await.unwrap();
    let mut m = [0u8; 2];
    client.read_exact(&mut m).await.unwrap();
    assert_eq!(m, [5, 0xFF]);
    assert!(driver.await.unwrap().is_none());
}

#[tokio::test]
async fn handshake_answers_bind_with_command_not_supported() {
    let (mut client, mut server) = tokio::io::duplex(1024);
    let driver = tokio::spawn(async move { handshake(&mut server).await });
    client
        .write_all(&[5, 1, 0, 5, 2, 0, 1, 127, 0, 0, 1, 0, 80])
        .await
        .unwrap();
    let mut out = [0u8; 12];
    client.read_exact(&mut out).await.unwrap();
    assert_eq!(&out[..2], &[5, 0]);
    assert_eq!(out[2..], reply(Reply::CommandNotSupported));
    assert!(driver.await.unwrap().is_none());
}

#[tokio::test]
async fn handshake_gives_up_on_eof() {
    let (mut client, mut server) = tokio::io::duplex(1024);
    let driver = tokio::spawn(async move { handshake(&mut server).await });
    client.write_all(&[5, 1]).await.unwrap();
    drop(client);
    assert!(driver.await.unwrap().is_none());
}
