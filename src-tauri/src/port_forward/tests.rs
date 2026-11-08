use super::*;

/// 테스트끼리 전역 맵을 공유하므로 **세션 id 를 겹치지 않게** 잡는다
/// (실제 세션 id 는 1부터 증가하므로 실행 중인 앱과도 섞이지 않는 큰 값을 쓴다).
fn insert_dummy(session_id: u32, local_port: u16) -> u32 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    // abort 핸들을 얻으려면 태스크가 하나 필요하다. 영원히 대기하는 태스크로 대신한다.
    let task = tokio::spawn(std::future::pending::<()>());
    FORWARDS.lock().unwrap().insert(
        id,
        Forward {
            session_id,
            kind: ForwardKind::Local,
            local_port,
            remote_host: "localhost".into(),
            remote_port: 5432,
            conns: Arc::new(AtomicU64::new(0)),
            active: Arc::new(AtomicU64::new(0)),
            abort: Some(task.abort_handle()),
            relays: Arc::default(),
            remote: None,
            purpose: None,
            app_users: Default::default(),
        },
    );
    id
}

/// 앱이 건 포워드 하나를 흉내 낸다 — 서버 바인드 없이(전송로가 필요 없는 장부 쪽만 본다).
fn insert_app_dummy(users: &[u32]) -> u32 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    FORWARDS.lock().unwrap().insert(
        id,
        Forward {
            session_id: users[0],
            kind: ForwardKind::Remote,
            local_port: 5000,
            remote_host: String::new(),
            remote_port: 41234,
            conns: Arc::new(AtomicU64::new(0)),
            active: Arc::new(AtomicU64::new(0)),
            abort: None,
            relays: Arc::default(),
            remote: None,
            purpose: Some(ForwardPurpose::AgentSignal),
            app_users: users.iter().copied().collect(),
        },
    );
    id
}

#[tokio::test]
async fn app_forward_lives_until_its_last_user_closes_and_refuses_manual_removal() {
    let (a, b) = (930_001, 930_002);
    let id = insert_app_dummy(&[a, b]);
    // 쓰는 두 세션의 목록에 다 보이고, 까닭이 실린다.
    for s in [a, b] {
        let list = list_forwards(s);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].purpose, Some(ForwardPurpose::AgentSignal));
    }
    // 사람은 지울 수 없다.
    assert!(remove_forward(id).await.is_err());
    assert!(FORWARDS.lock().unwrap().contains_key(&id));
    // 첫 세션이 닫혀도 남는다(둘째가 쓴다) — 첫 세션 목록에서만 빠진다.
    assert_eq!(stop_session_forwards(a), 0);
    assert!(list_forwards(a).is_empty());
    assert_eq!(list_forwards(b).len(), 1);
    // 마지막이 닫히면 거둔다.
    assert_eq!(stop_session_forwards(b), 1);
    assert!(!FORWARDS.lock().unwrap().contains_key(&id));
}

#[test]
fn purpose_is_kebab_case_and_absent_for_manual_forwards() {
    assert_eq!(
        serde_json::to_value(ForwardPurpose::AgentSignal).unwrap(),
        "agent-signal"
    );
    let info = ForwardInfo {
        id: 1,
        session_id: 1,
        kind: ForwardKind::Local,
        local_port: 1,
        remote_host: String::new(),
        remote_port: 1,
        conns: 0,
        active_conns: 0,
        purpose: None,
    };
    assert!(serde_json::to_value(&info)
        .unwrap()
        .get("purpose")
        .is_none());
}

/// 포워드 하나의 중계 등록부를 꺼낸다 (accept 루프가 하는 일을 테스트가 대신하려고).
fn relays_of(id: u32) -> Arc<Mutex<Relays>> {
    FORWARDS
        .lock()
        .unwrap()
        .get(&id)
        .map(|f| Arc::clone(&f.relays))
        .unwrap()
}

/// 중계 태스크 하나를 흉내 낸다 — 활성 가드를 들고 **영원히 대기**하는 태스크.
/// 실제 중계도 대부분의 시간을 `copy_bidirectional` 안에서 이렇게 보낸다.
fn spawn_fake_relay(active: &Arc<AtomicU64>) -> AbortHandle {
    let guard = ActiveGuard::new(Arc::clone(active));
    tokio::spawn(async move {
        let _guard = guard;
        std::future::pending::<()>().await;
    })
    .abort_handle()
}

/// abort 는 런타임이 태스크를 실제로 버릴 때 듣는다 — 같은 틱에 0 을 기대하면 안 된다.
/// 짧게 양보하며 기다리되, 영원히 매달리지 않도록 횟수를 제한한다.
async fn wait_until(mut done: impl FnMut() -> bool) -> bool {
    for _ in 0..200 {
        if done() {
            return true;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    done()
}

const L: ForwardKind = ForwardKind::Local;
const R: ForwardKind = ForwardKind::Remote;
const D: ForwardKind = ForwardKind::Dynamic;

#[test]
fn rejects_zero_ports() {
    assert!(validate(L, 0, "localhost", 5432)
        .unwrap_err()
        .contains("로컬 포트"));
    assert!(validate(L, 15432, "localhost", 0)
        .unwrap_err()
        .contains("원격 포트"));
}

#[test]
fn rejects_empty_remote_host() {
    let err = validate(L, 15432, "   ", 5432).unwrap_err();
    assert!(err.contains("원격 호스트"), "{err}");
}

#[test]
fn trims_remote_host() {
    assert_eq!(
        validate(L, 15432, "  db.internal  ", 5432).unwrap(),
        ("db.internal".to_string(), 5432)
    );
}

/// 앞뒤 공백은 다듬고 **가운데 공백은 거절한다** — 고쳐 줄 방법이 없기 때문이다.
#[test]
fn rejects_inner_whitespace_in_remote_host() {
    let err = validate(L, 15432, "db 01", 5432).unwrap_err();
    assert!(err.contains("공백"), "{err}");
}

/// 원격(-R): 두 포트는 다 필요하고 호스트는 **보지도 않고 비운다** (감춘 칸의 옛 값).
#[test]
fn remote_needs_both_ports_and_ignores_host() {
    assert!(validate(R, 0, "", 18080).unwrap_err().contains("로컬 포트"));
    assert!(validate(R, 18080, "", 0).unwrap_err().contains("원격 포트"));
    assert_eq!(
        validate(R, 18080, "db 01", 18081).unwrap(),
        (String::new(), 18081)
    );
}

/// 동적(-D): 로컬 포트 하나뿐 — 원격 칸은 무엇이 있든 비운다.
#[test]
fn dynamic_needs_only_the_local_port() {
    assert!(validate(D, 0, "", 0).unwrap_err().contains("로컬 포트"));
    assert_eq!(validate(D, 1080, "", 0).unwrap(), (String::new(), 0));
    assert_eq!(
        validate(D, 1080, "  x y ", 5432).unwrap(),
        (String::new(), 0)
    );
}

/// 종류는 소문자로 오가고, **없으면 로컬**이다 (이 칸 이전의 프리셋·호출).
#[test]
fn kind_is_lowercase_and_defaults_to_local() {
    assert_eq!(serde_json::to_string(&D).unwrap(), "\"dynamic\"");
    assert_eq!(
        serde_json::from_str::<ForwardKind>("\"remote\"").unwrap(),
        R
    );
    assert_eq!(ForwardKind::default(), L);
}

/// 채널 열기 실패 → SOCKS5 코드: 서버가 "목적지에 못 붙었다" 만 `05`, 나머지는 `01`.
#[test]
fn socks_failure_maps_connect_failed_to_refused() {
    let refused = russh::Error::ChannelOpenFailure(ChannelOpenFailure::ConnectFailed);
    assert_eq!(socks_failure(&refused), socks5::Reply::ConnectionRefused);
    let prohibited =
        russh::Error::ChannelOpenFailure(ChannelOpenFailure::AdministrativelyProhibited);
    assert_eq!(socks_failure(&prohibited), socks5::Reply::GeneralFailure);
    assert_eq!(
        socks_failure(&russh::Error::SendError),
        socks5::Reply::GeneralFailure
    );
}

// ── 원격(-R) 길잡이 표 ──────────────────────────────────────────────────
// 전역 표를 공유하므로 **전송로 id 를 겹치지 않게** 잡는다 (실제 id 는 1부터 증가한다).

fn route(forward_id: u32, local_port: u16) -> RemoteRoute {
    RemoteRoute {
        forward_id,
        local_port,
        conns: Arc::default(),
        active: Arc::default(),
        relays: Arc::default(),
    }
}

/// 같은 서버 포트라도 **전송로가 다르면** 다른 길이다 — 서버 두 대가 각자 18080 을 가진다.
#[test]
fn remote_routes_are_keyed_by_transport_and_port() {
    assert!(route_remote(9_000_001, 18080, route(1, 3000)));
    assert!(route_remote(9_000_002, 18080, route(2, 4000)));
    assert_eq!(remote_route(9_000_001, 18080).unwrap().local_port, 3000);
    assert_eq!(remote_route(9_000_002, 18080).unwrap().local_port, 4000);
    // 걸지 않은 포트 · 모르는 전송로는 길이 없다 (채널을 거절한다).
    assert!(remote_route(9_000_001, 18081).is_none());
    assert!(remote_route(9_000_003, 18080).is_none());
    unroute_remote(9_000_001, 18080, 1);
    unroute_remote(9_000_002, 18080, 2);
}

/// 연결 공유: 한 전송로의 두 세션이 같은 서버 포트를 달라고 하면 **둘째는 거절**된다.
#[test]
fn same_port_on_one_transport_is_refused() {
    assert!(route_remote(9_000_011, 18080, route(11, 3000)));
    assert!(!route_remote(9_000_011, 18080, route(12, 3001)));
    // 거절된 쪽이 첫째의 길을 덮지 않았다.
    assert_eq!(remote_route(9_000_011, 18080).unwrap().forward_id, 11);
    unroute_remote(9_000_011, 18080, 11);
}

/// 지우기는 **그 자리의 주인일 때만** — 뒤늦은 정리가 남의 길을 지우지 않는다.
#[test]
fn unroute_only_removes_its_own_route() {
    assert!(route_remote(9_000_021, 18080, route(21, 3000)));
    unroute_remote(9_000_021, 18080, 99);
    assert!(
        remote_route(9_000_021, 18080).is_some(),
        "남의 id 로 지워졌다"
    );
    unroute_remote(9_000_021, 18080, 21);
    assert!(remote_route(9_000_021, 18080).is_none());
}

/// 서버가 주는 포트는 `u32` — 범위 밖이면 길이 없다 (잘라서 엉뚱한 포트로 가지 않는다).
#[test]
fn out_of_range_connected_port_has_no_route() {
    assert!(route_remote(9_000_031, 18080, route(31, 3000)));
    assert!(remote_route(9_000_031, 18080 + 65536).is_none());
    unroute_remote(9_000_031, 18080, 31);
}

#[tokio::test]
// 테스트 직렬화용 잠금이라 await 를 넘어 들고 있어야 한다
#[allow(clippy::await_holding_lock)]
async fn binds_loopback_and_rejects_duplicate_port() {
    // 루프백 포트를 잡는 테스트끼리 직렬화한다 (crate::test_support 참고).
    let _net = crate::test_support::NET_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    // 포트 0 으로 한 번 열어 **비어 있는 포트 번호**를 OS 에게 받아 온다
    // (고정 번호를 쓰면 개발 PC 에서 이미 쓰는 포트와 부딪힌다).
    let probe = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let port = probe.local_addr().unwrap().port();

    let held = bind_local(port);
    drop(probe); // 탐색용 리스너를 놓고 같은 번호를 우리 헬퍼로 다시 잡는다
    let held = held.await.unwrap();
    assert_eq!(held.local_addr().unwrap().ip().to_string(), "127.0.0.1");

    let err = bind_local(port).await.unwrap_err();
    assert_eq!(err, format!("포트 {port} 이 이미 사용 중입니다"));
}

#[tokio::test]
async fn lists_only_the_given_session() {
    let a = insert_dummy(900_001, 15432);
    let b = insert_dummy(900_001, 16379);
    let c = insert_dummy(900_002, 18080);

    let list = list_forwards(900_001);
    assert_eq!(list.iter().map(|i| i.id).collect::<Vec<_>>(), vec![a, b]);
    assert_eq!(list[0].local_port, 15432);
    assert_eq!(list[0].remote_host, "localhost");
    assert_eq!(list[0].conns, 0);
    assert_eq!(list[0].active_conns, 0);
    assert_eq!(
        list_forwards(900_002)
            .iter()
            .map(|i| i.id)
            .collect::<Vec<_>>(),
        vec![c]
    );

    stop_session_forwards(900_001);
    stop_session_forwards(900_002);
}

#[tokio::test]
async fn session_cleanup_stops_only_that_session() {
    insert_dummy(900_011, 15432);
    insert_dummy(900_011, 16379);
    insert_dummy(900_012, 18080);

    assert_eq!(stop_session_forwards(900_011), 2);
    assert!(list_forwards(900_011).is_empty());
    // 다른 세션의 포워드는 그대로 살아 있어야 한다.
    assert_eq!(list_forwards(900_012).len(), 1);

    // 두 번째 정리는 아무것도 하지 않는다 (맵이 비었다).
    assert_eq!(stop_session_forwards(900_011), 0);
    stop_session_forwards(900_012);
}

/// 활성 카운터의 계약: 만들면 오르고, **어떤 경로로 떨어지든** 내려간다.
#[test]
fn active_guard_counts_up_and_down() {
    let active = Arc::new(AtomicU64::new(0));

    let a = ActiveGuard::new(Arc::clone(&active));
    assert_eq!(active.load(Ordering::Relaxed), 1);

    // 동시에 두 연결이 붙은 모습
    let b = ActiveGuard::new(Arc::clone(&active));
    assert_eq!(active.load(Ordering::Relaxed), 2);

    drop(b);
    assert_eq!(active.load(Ordering::Relaxed), 1);

    // 조기 return·취소로 태스크가 사라지는 경우도 결국 이 drop 과 같다
    drop(a);
    assert_eq!(active.load(Ordering::Relaxed), 0);
}

/// 가드가 쓰는 카운터는 `Forward` 가 그대로 들고 있는 것이므로, 목록에도 즉시 보인다.
#[tokio::test]
async fn info_reports_live_active_count() {
    let id = insert_dummy(900_031, 15432);
    let active = FORWARDS
        .lock()
        .unwrap()
        .get(&id)
        .map(|f| Arc::clone(&f.active))
        .unwrap();

    let guard = ActiveGuard::new(active);
    assert_eq!(list_forwards(900_031)[0].active_conns, 1);

    drop(guard);
    assert_eq!(list_forwards(900_031)[0].active_conns, 0);

    stop_session_forwards(900_031);
}

#[tokio::test]
async fn remove_is_idempotent() {
    let id = insert_dummy(900_021, 15432);
    remove_forward(id).await.unwrap();
    assert!(list_forwards(900_021).is_empty());
    // 이미 사라진 id 도 오류가 아니다 (세션이 먼저 닫힌 뒤의 [중지] 클릭).
    remove_forward(id).await.unwrap();
}

/// 사용자 결정 2026-09-17 의 핵심: **[중지] 는 중계 중인 연결도 끊는다.**
/// 목록에서 사라졌는데 `active_conns` 가 남아 있으면 그 결정이 깨진 것이다.
#[tokio::test]
async fn remove_cuts_relayed_connections_and_active_reaches_zero() {
    let id = insert_dummy(900_041, 15432);
    let active = FORWARDS
        .lock()
        .unwrap()
        .get(&id)
        .map(|f| Arc::clone(&f.active))
        .unwrap();
    let relays = relays_of(id);

    // 연결 두 개가 중계 중인 모습 (accept 루프가 하는 등록을 손으로 한다).
    let a = spawn_fake_relay(&active);
    let b = spawn_fake_relay(&active);
    relays.lock().unwrap().register(a.clone());
    relays.lock().unwrap().register(b.clone());
    assert_eq!(list_forwards(900_041)[0].active_conns, 2);

    remove_forward(id).await.unwrap();

    assert!(
        wait_until(|| a.is_finished() && b.is_finished()).await,
        "중계 태스크가 안 끊겼다"
    );
    assert!(
        wait_until(|| active.load(Ordering::Relaxed) == 0).await,
        "active_conns 가 0 으로 돌아오지 않았다: {}",
        active.load(Ordering::Relaxed)
    );
}

/// 세션 정리도 같은 중지다 (`close_ssh` 경로).
#[tokio::test]
async fn session_cleanup_cuts_relayed_connections_too() {
    let id = insert_dummy(900_051, 15432);
    let active = FORWARDS
        .lock()
        .unwrap()
        .get(&id)
        .map(|f| Arc::clone(&f.active))
        .unwrap();
    let handle = spawn_fake_relay(&active);
    relays_of(id).lock().unwrap().register(handle.clone());

    assert_eq!(stop_session_forwards(900_051), 1);
    assert!(
        wait_until(|| handle.is_finished()).await,
        "중계 태스크가 안 끊겼다"
    );
    assert!(wait_until(|| active.load(Ordering::Relaxed) == 0).await);
}

/// 중지 **뒤에** 들어오는 등록 — accept 루프가 abort 를 듣기 전에 마지막 연결을 띄운
/// 경우다. 목록은 이미 비었으므로 그 태스크를 잡아 둘 곳이 없다 → 그 자리에서 끊는다.
#[tokio::test]
async fn register_after_stop_aborts_immediately() {
    let active = Arc::new(AtomicU64::new(0));
    let mut relays = Relays::default();
    relays.stop();

    let late = spawn_fake_relay(&active);
    relays.register(late.clone());

    assert!(
        wait_until(|| late.is_finished()).await,
        "중지 뒤 등록된 중계가 살아남았다"
    );
    assert!(
        relays.handles.is_empty(),
        "중지 뒤에는 목록에 쌓이지도 않는다"
    );
    assert!(wait_until(|| active.load(Ordering::Relaxed) == 0).await);
}

/// 끝난 핸들은 등록할 때마다 털어 낸다 — 오래 살아 있는 포워드에서 목록이
/// 누적 연결 수만큼 자라지 않게 하는 유일한 장치다.
#[tokio::test]
async fn register_prunes_finished_handles() {
    let mut relays = Relays::default();

    let done = tokio::spawn(async {}).abort_handle();
    relays.register(done.clone());
    assert!(wait_until(|| done.is_finished()).await);
    assert_eq!(relays.handles.len(), 1, "아직 털어 내기 전");

    let active = Arc::new(AtomicU64::new(0));
    let live = spawn_fake_relay(&active);
    relays.register(live.clone());
    assert_eq!(
        relays.handles.len(),
        1,
        "끝난 핸들은 사라지고 살아 있는 것만 남는다"
    );

    relays.stop();
    assert!(wait_until(|| live.is_finished()).await);
}

/// 태스크를 abort 하면 그 태스크가 쥔 **소켓이 드롭되어 닫힌다** — 중계의 로컬 쪽이
/// 실제로 끊기는지 진짜 소켓으로 확인한다 (원격 쪽은 러시의 `ChannelCloseOnDrop` 이
/// 같은 드롭에서 `ChannelMsg::Close` 를 보낸다 — 실서버가 있어야 보이므로 여기서는 못 본다).
#[tokio::test]
async fn aborting_a_relay_closes_the_local_socket() {
    use tokio::io::AsyncReadExt;

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut client = TcpStream::connect(addr).await.unwrap();
    let (server, _) = listener.accept().await.unwrap();

    let id = insert_dummy(900_061, addr.port());
    let active = FORWARDS
        .lock()
        .unwrap()
        .get(&id)
        .map(|f| Arc::clone(&f.active))
        .unwrap();

    // 중계 태스크가 소켓을 들고 파는 모습 (copy_bidirectional 안에서 대기하는 것과 같다).
    let guard = ActiveGuard::new(Arc::clone(&active));
    let task = tokio::spawn(async move {
        let _guard = guard;
        let _socket = server;
        std::future::pending::<()>().await;
    });
    relays_of(id).lock().unwrap().register(task.abort_handle());

    remove_forward(id).await.unwrap();

    // 소켓이 닫히면 클라이언트의 read 는 0 (EOF) 으로 돌아온다.
    let mut buf = [0u8; 1];
    let n = tokio::time::timeout(Duration::from_secs(5), client.read(&mut buf))
        .await
        .expect("중지했는데 클라이언트가 계속 붙어 있다")
        .unwrap();
    assert_eq!(n, 0, "EOF 가 아니라 데이터가 왔다");
    assert!(wait_until(|| active.load(Ordering::Relaxed) == 0).await);
}

// ---------------------------------------------------------------------------
// TunnelListener — 쿼리 타일의 앱 안쪽 터널
// ---------------------------------------------------------------------------

/// 러시 핸들 없이 리스너를 세운다 — accept 루프 자리에 "받아서 중계 하나를 흉내 내는" 가짜를 꽂는다.
async fn fake_tunnel(active: Arc<AtomicU64>) -> TunnelListener {
    let listener = bind_local(0).await.unwrap();
    TunnelListener::start(listener, move |listener, relays| {
        tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    continue;
                };
                let guard = ActiveGuard::new(Arc::clone(&active));
                let task = tokio::spawn(async move {
                    let _guard = guard;
                    let _socket = socket;
                    std::future::pending::<()>().await;
                });
                relays.lock().unwrap().register(task.abort_handle());
            }
        })
    })
    .unwrap()
}

/// 루프백 임시 포트에만 서고, 포워딩 장부에는 오르지 않는다.
#[tokio::test]
async fn tunnel_binds_loopback_ephemeral_and_stays_off_the_forward_table() {
    let before = FORWARDS.lock().unwrap().len();
    let tunnel = fake_tunnel(Arc::new(AtomicU64::new(0))).await;
    let addr = tunnel.local_addr();
    assert_eq!(addr.ip(), std::net::IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_ne!(addr.port(), 0, "OS 가 고른 실제 포트가 실려야 한다");
    assert_eq!(FORWARDS.lock().unwrap().len(), before);
    // 리스너가 살아 있는 동안은 같은 포트를 다시 못 잡는다.
    assert!(TcpListener::bind(addr).await.is_err());
}

/// 닫으면 포트가 풀리고 중계 중인 연결도 끊긴다 — 드롭도 같다.
#[tokio::test]
async fn closing_a_tunnel_frees_the_port_and_cuts_relays() {
    use tokio::io::AsyncReadExt;

    for by_drop in [false, true] {
        let active = Arc::new(AtomicU64::new(0));
        let tunnel = fake_tunnel(Arc::clone(&active)).await;
        let addr = tunnel.local_addr();
        let mut client = TcpStream::connect(addr).await.unwrap();
        assert!(
            wait_until(|| active.load(Ordering::Relaxed) == 1).await,
            "중계가 서지 않았다"
        );

        // 닫기만 한 쪽은 값을 끝까지 쥐고 있는다 — 드롭 없이도 닫혀 있어야 한다.
        let _keep = if by_drop {
            drop(tunnel);
            None
        } else {
            tunnel.close();
            tunnel.close(); // 멱등
            Some(tunnel)
        };

        let mut buf = [0u8; 1];
        let n = tokio::time::timeout(Duration::from_secs(5), client.read(&mut buf))
            .await
            .expect("닫았는데 중계가 붙어 있다")
            .unwrap_or(0);
        assert_eq!(n, 0);
        assert!(wait_until(|| active.load(Ordering::Relaxed) == 0).await);
        let mut freed = false;
        for _ in 0..200 {
            if TcpListener::bind(addr).await.is_ok() {
                freed = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(freed, "닫았는데 포트가 풀리지 않았다 (by_drop={by_drop})");
    }
}

/// 목적지 검사는 로컬(-L) 포워드와 같은 규칙이다 — 리스너를 세우기 전에 거절한다.
#[test]
fn tunnel_target_uses_the_local_forward_rules() {
    assert!(validate_target("", 5432).is_err());
    assert!(validate_target("db 01", 5432).is_err());
    assert!(validate_target("db", 0).is_err());
    assert_eq!(
        validate_target("  db.internal ", 5432).unwrap(),
        ("db.internal".to_string(), 5432)
    );
    assert_eq!(
        validate_target("db", 5432),
        validate(ForwardKind::Local, 1, "db", 5432)
    );
}
