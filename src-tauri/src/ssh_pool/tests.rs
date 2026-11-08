use super::*;

// ---- 장부 (join / insert / release) ----

#[test]
fn insert_then_join_counts_users() {
    let pool: TransportPool<&str> = TransportPool::new();
    assert!(pool.join("web-01", 1).is_none(), "빈 풀에는 탈 것이 없다");
    assert!(pool.insert("web-01", 1, "handle").is_none());
    assert_eq!(pool.users("web-01"), 1);
    assert_eq!(pool.join("web-01", 2), Some("handle"));
    assert_eq!(pool.users("web-01"), 2);
    assert_eq!(pool.len(), 1, "둘째 타일이 전송로를 하나 더 만들지 않았다");
}

/// 정보 카드의 "공유 중인 다른 타일 수" 에 쿼리 타일의 DB 핀이 섞이지 않는다 — `(타일, 핀)` 으로 나눠 센다(9단계).
#[test]
fn db_pins_are_counted_apart_from_tiles() {
    let pool: TransportPool<&str> = TransportPool::new();
    pool.insert("web-01", 1, "handle"); // 터미널 타일
    pool.join("web-01", 2); // DB 핀
    pool.mark_pin(2);
    assert_eq!(pool.count_users("web-01"), (1, 1), "타일 하나 + DB 하나 — 공유 중인 다른 타일은 0");
    pool.join("web-01", 3); // 둘째 터미널 타일
    pool.join("web-01", 4); // 둘째 DB 핀
    pool.mark_pin(4);
    assert_eq!(pool.count_users("web-01"), (2, 2));
    assert_eq!(pool.users("web-01"), 4, "장부의 사용자 수(전송로를 끊을 때)는 핀까지 센다");
    // 핀이 내리면 표시도 지운다 — 같은 번호가 다시 쓰이지 않지만 표가 자라지 않게.
    assert!(pool.release("web-01", 2).is_none());
    assert_eq!(pool.count_users("web-01"), (2, 1));
    // DB 만 남은 전송로 — 타일 0 · 핀 1(정보 카드를 볼 타일이 없다).
    pool.release("web-01", 1);
    pool.release("web-01", 3);
    assert_eq!(pool.count_users("web-01"), (0, 1));
    assert_eq!(pool.count_users("nope"), (0, 0));
    // 내쫓긴(evict) 전송로의 핀이 늦게 release 돼도 표시는 지워진다.
    pool.evict("web-01");
    pool.release("web-01", 4);
    assert!(pool.pins.lock().unwrap().is_empty());
}

#[test]
fn only_the_last_release_hands_back_the_transport() {
    let pool: TransportPool<&str> = TransportPool::new();
    pool.insert("web-01", 1, "handle");
    pool.join("web-01", 2);
    pool.join("web-01", 3);
    assert!(pool.release("web-01", 2).is_none(), "아직 둘이 쓰고 있다");
    assert!(pool.release("web-01", 1).is_none(), "아직 하나가 쓰고 있다");
    assert_eq!(
        pool.release("web-01", 3),
        Some("handle"),
        "마지막이 내릴 때만 끊을 것을 받는다"
    );
    assert_eq!(pool.users("web-01"), 0);
    assert_eq!(pool.len(), 0);
}

#[test]
fn releasing_an_unknown_id_or_key_is_quiet() {
    let pool: TransportPool<&str> = TransportPool::new();
    assert!(pool.release("nope", 1).is_none());
    pool.insert("web-01", 1, "handle");
    // 모르는 id 는 사용자 수를 줄이지 못한다 — 남은 사용자가 있으니 끊지 않는다.
    assert!(pool.release("web-01", 99).is_none());
    assert_eq!(pool.users("web-01"), 1);
}

#[test]
fn keys_do_not_bleed_into_each_other() {
    let pool: TransportPool<&str> = TransportPool::new();
    pool.insert("web-01", 1, "a");
    pool.insert("db-01", 2, "b");
    assert_eq!(pool.join("db-01", 3), Some("b"));
    assert_eq!(pool.users("web-01"), 1);
    assert_eq!(pool.release("web-01", 1), Some("a"));
    assert_eq!(pool.users("db-01"), 2, "옆 전송로는 그대로다");
}

#[test]
fn evict_drops_the_entry_without_handing_it_back() {
    let pool: TransportPool<&str> = TransportPool::new();
    pool.insert("web-01", 1, "handle");
    pool.join("web-01", 2);
    pool.evict("web-01");
    assert_eq!(pool.len(), 0);
    // 남아 있던 세션이 닫혀도 끊을 것이 없다 (전송로는 이미 죽었다).
    assert!(pool.release("web-01", 2).is_none());
}

#[test]
fn inserting_over_a_live_key_hands_the_old_transport_back() {
    let pool: TransportPool<&str> = TransportPool::new();
    pool.insert("web-01", 1, "old");
    assert_eq!(
        pool.insert("web-01", 2, "new"),
        Some("old"),
        "게이트 계약상 올 일이 없지만, 와도 소켓이 새지 않는다"
    );
    assert_eq!(pool.users("web-01"), 1);
    assert_eq!(pool.join("web-01", 3), Some("new"));
}

// ---- 합치기 자물쇠 ----

#[test]
fn the_gate_is_one_lock_per_key() {
    let pool: TransportPool<&str> = TransportPool::new();
    let a = pool.gate("web-01");
    let b = pool.gate("web-01");
    let c = pool.gate("db-01");
    assert!(Arc::ptr_eq(&a, &b), "같은 키는 같은 자물쇠");
    assert!(!Arc::ptr_eq(&a, &c), "다른 키는 서로를 막지 않는다");
}

#[tokio::test]
async fn the_gate_serializes_the_cold_path() {
    let pool: Arc<TransportPool<&str>> = Arc::new(TransportPool::new());
    let gate = pool.gate("web-01");
    let held = gate.lock().await;
    let waiter = {
        let pool = Arc::clone(&pool);
        tokio::spawn(async move {
            let gate = pool.gate("web-01");
            let _g = gate.lock().await;
            // 기다린 쪽은 잠금을 얻은 순간 **이미 등록된** 전송로를 본다.
            pool.join("web-01", 2)
        })
    };
    // 자물쇠를 쥔 쪽이 접속을 끝내고 등록한다.
    pool.insert("web-01", 1, "handle");
    drop(held);
    assert_eq!(waiter.await.unwrap(), Some("handle"));
    assert_eq!(pool.users("web-01"), 2);
}

#[test]
fn unused_gates_do_not_pile_up() {
    let pool: TransportPool<&str> = TransportPool::new();
    drop(pool.gate("a"));
    drop(pool.gate("b"));
    let _held = pool.gate("c");
    // "c" 는 밖에서 쥐고 있고, 방금 물은 "d" 도 남는다. 놓아 버린 둘은 치워졌다.
    let _d = pool.gate("d");
    assert_eq!(pool.gates.lock().unwrap().len(), 2);
}

// ---- 종료 팬아웃 ----

#[derive(Default)]
struct Counter {
    hits: Mutex<Vec<Option<String>>>,
}
impl ExitTarget for Counter {
    fn fire(&self, failure: Option<String>) {
        self.hits.lock().unwrap().push(failure);
    }
}
impl Counter {
    fn count(&self) -> usize {
        self.hits.lock().unwrap().len()
    }
}

#[test]
fn transport_death_reaches_every_session_once() {
    let signal = TransportSignal::new(None);
    let a = Arc::new(Counter::default());
    let b = Arc::new(Counter::default());
    let c = Arc::new(Counter::default());
    signal.join(Arc::clone(&a) as Arc<dyn ExitTarget>);
    signal.join(Arc::clone(&b) as Arc<dyn ExitTarget>);
    signal.join(Arc::clone(&c) as Arc<dyn ExitTarget>);

    signal.fire(Some("서버 무응답".into()));
    assert_eq!((a.count(), b.count(), c.count()), (1, 1, 1));
    assert_eq!(a.hits.lock().unwrap()[0].as_deref(), Some("서버 무응답"));

    // 두 번째 fire 는 아무 일도 하지 않는다 (`disconnected` 가 두 번 불려도 된다).
    signal.fire(None);
    assert_eq!((a.count(), b.count(), c.count()), (1, 1, 1));
}

#[test]
fn a_closed_tile_stops_getting_the_transports_news() {
    let signal = TransportSignal::new(None);
    let stays = Arc::new(Counter::default());
    let leaves = Arc::new(Counter::default());
    signal.join(Arc::clone(&stays) as Arc<dyn ExitTarget>);
    let token = signal.join(Arc::clone(&leaves) as Arc<dyn ExitTarget>);
    signal.leave(token);
    signal.fire(None);
    assert_eq!(stays.count(), 1);
    assert_eq!(leaves.count(), 0, "내린 타일은 남의 끊김을 받지 않는다");
}

#[test]
fn solo_signal_carries_exactly_one_target() {
    let only = Arc::new(Counter::default());
    let signal = TransportSignal::solo(Arc::clone(&only) as Arc<dyn ExitTarget>);
    signal.fire(None);
    assert_eq!(only.count(), 1);
}

#[test]
fn death_evicts_the_pool_entry_exactly_once() {
    let deaths = Arc::new(AtomicU64::new(0));
    let signal = {
        let deaths = Arc::clone(&deaths);
        TransportSignal::new(Some(Box::new(move || {
            deaths.fetch_add(1, Ordering::SeqCst);
        })))
    };
    signal.fire(None);
    signal.fire(None);
    assert_eq!(
        deaths.load(Ordering::SeqCst),
        1,
        "풀에서 빼는 일도 한 번뿐이다"
    );
}
