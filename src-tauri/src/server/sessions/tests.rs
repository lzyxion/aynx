use super::*;
use super::io::{credits, new_credit, plug, retire_credit, sink, viewer_credits, ViewerSink};
use super::lifecycle::exit_for_stop;
use crate::output;
use crate::pty::LocalExit;
use crate::server::credit::ViewerCredit;
use crate::server::ipc::frame::Ack;
use crate::server::ipc::Frame;
use crate::session_core::{core, CoreError, Keys, Kind};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;

/// 서버가 끝나며 닫은 세션은 `server-stopped` 로 나간다(종료 코드·세부를 지운다) — 평소에는 그대로.
#[test]
fn exit_during_server_stop_reads_as_server_stopped() {
    let ev = LocalExit {
        id: 7,
        reason: "exit".into(),
        code: "exit".into(),
        exit_code: Some(1),
        detail: None,
        stream: Some("s".into()),
        session_epoch: Some(2),
        removed: false,
    };
    let normal = exit_for_stop(ev.clone(), false);
    assert_eq!((normal.code.as_str(), normal.exit_code), ("exit", Some(1)));
    let stopped = exit_for_stop(ev, true);
    assert_eq!((stopped.code.as_str(), stopped.exit_code), ("server-stopped", None));
    assert_eq!((stopped.stream.as_deref(), stopped.session_epoch), (Some("s"), Some(2)));
}

/// **SSH 도 연결이 끊기면 떨어진다**(③-3b2) — 그 연결이 쥔 SSH 임대가 `Detached` 로(세션은 산다 — 자원 표는 그대로),
/// 다른 연결의 임대는 그대로. 크레딧은 `(종류, id)` 로 갈려 로컬 같은 번호를 건드리지 않는다.
#[test]
fn conn_gone_detaches_ssh_leases_too() {
    let stream = "ss3b2-conn-gone-ssh";
    let other = "ss3b2-conn-gone-other";
    {
        let mut c = core();
        c.conn_opened(77_001);
        c.conn_opened(77_002);
        c.commit(stream, Kind::Ssh, 3_900_001, "main", Instant::now());
        c.set_lease_conn(stream, 77_001);
        c.commit(other, Kind::Ssh, 3_900_002, "main", Instant::now());
        c.set_lease_conn(other, 77_002);
    }
    let gate = Arc::new(output::Gate::new());
    let _ssh_credit = new_credit(Kind::Ssh, 3_900_001, Arc::clone(&gate));
    let _local_credit = new_credit(Kind::Local, 3_900_001, Arc::new(output::Gate::new()));
    conn_gone(77_001);
    {
        let c = core();
        assert_eq!(c.state_of_stream(stream), Some("detached"));
        assert_eq!(c.state_of_stream(other), Some("attached"), "다른 연결의 임대는 그대로");
    }
    assert!(!credits().contains_key(&(Kind::Ssh, 3_900_001)), "SSH 크레딧은 거뒀다");
    assert!(credits().contains_key(&(Kind::Local, 3_900_001)), "같은 번호의 로컬 크레딧은 남는다");
    retire_credit(3_900_001);
    let mut c = core();
    c.remove_id(Kind::Ssh, 3_900_001);
    c.remove_id(Kind::Ssh, 3_900_002);
}

/// **재리뷰 R02 — 연결이 끊긴 뒤 끝난 열기는 떨어진 세션으로**(GUI 를 꺼도 세션은 산다는 계약). 싱크를 꽂지 않고 크레딧도
/// 만들지 않으며 수문 임대를 푼다 — 죽은 연결로 나간 바이트의 ACK 를 기다리며 생산자가 멈추지 않게. 꽂은 **뒤에** 끊기면
/// 예전 그대로 `conn_gone` 이 뽑는다.
#[test]
fn open_finishing_after_conn_gone_is_left_detached() {
    let late = "rr-r02-late-open";
    let live = "rr-r02-live-open";
    let gate = output::Gate::new();
    let keys = {
        let mut c = core();
        c.conn_opened(78_001);
        c.reserve(late).expect("예약");
        c.reserve(live).expect("예약");
        c.commit(live, Kind::Ssh, 3_910_002, "main", Instant::now())
    };
    // 열기가 도는 사이 연결이 끊겼다.
    conn_gone(78_001);
    let late_keys = {
        let mut c = core();
        let k = c.commit(late, Kind::Ssh, 3_910_001, "main", Instant::now());
        assert!(!c.set_lease_conn(late, 78_001));
        k
    };
    let installed = plug(&late_keys, 78_001, &gate, || new_credit(Kind::Ssh, 3_910_001, Arc::new(output::Gate::new())));
    assert!(installed.is_none(), "끊긴 연결에는 싱크를 꽂지 않는다");
    assert!(!credits().contains_key(&(Kind::Ssh, 3_910_001)), "크레딧도 없다");
    gate.pause();
    assert!(gate.passable(), "수문 임대를 풀었다 — 떨어진 세션의 pause 는 먹지 않는다");
    {
        let mut c = core();
        assert_eq!(c.probe(late, Instant::now()).state, "detached");
        assert!(c.detached().iter().any(|r| r.stream == late));
    }

    // 산 연결은 예전 그대로 꽂고, 그 뒤 끊기면 `conn_gone` 이 떨어뜨리며 크레딧을 거둔다.
    core().conn_opened(78_002);
    assert!(core().set_lease_conn(live, 78_002));
    let live_gate = Arc::new(output::Gate::new());
    let plugged = plug(&keys, 78_002, &live_gate, || new_credit(Kind::Ssh, 3_910_002, Arc::clone(&live_gate)));
    assert!(plugged.is_some());
    conn_gone(78_002);
    assert_eq!(core().state_of_stream(live), Some("detached"));
    assert!(!credits().contains_key(&(Kind::Ssh, 3_910_002)));

    let mut c = core();
    c.remove_id(Kind::Ssh, 3_910_001);
    c.remove_id(Kind::Ssh, 3_910_002);
}

/// **R2-A — 느린 시청자는 떨어지고 주는 멈추지 않는다.** ACK 하지 않는 시청자가 제 예산을 넘으면 그 싱크만 빠지고 코어에서도 떨어지며
/// (재동기화 신호 = 노트 `ViewerGone{Overflow}`), 주는 끝까지 같은 바이트를 받고 생산자의 수문은 열린 채다. 시청자의 ACK 는 시청자의
/// 크레딧으로 간다(주의 것을 건드리지 않는다).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn slow_viewer_is_dropped_without_pausing_the_producer() {
    let stream = "r2a-slow-viewer";
    let id = 3_920_001;
    let (pk, vk, fast) = {
        let mut c = core();
        c.reserve(stream).unwrap();
        let pk = c.commit(stream, Kind::Local, id, "main", Instant::now());
        let vk = c.attach_viewer(stream, None, "remote-a-1", true, None).unwrap().keys;
        let fast = c.attach_viewer(stream, None, "remote-b-1", true, None).unwrap().keys;
        (pk, vk, fast)
    };
    let (tx, mut rx) = mpsc::unbounded_channel::<Frame>();
    let ctx = ConnCtx { id: 0, tx, signal_port: None };
    let gate = Arc::new(output::Gate::new());
    let credit = new_credit(Kind::Local, id, Arc::clone(&gate));
    let slot = output::output_slot(Some(Box::new(sink(&ctx, &pk, credit))));
    let viewer = |keys: &Keys, budget: u64, route: u64| {
        let credit = ViewerCredit::with_budget(budget);
        viewer_credits().insert((Kind::Local, id, keys.lease_epoch), Arc::clone(&credit));
        ViewerSink {
            tx: ctx.tx.clone(),
            keys: keys.clone(),
            credit,
            route,
            rt: Some(tokio::runtime::Handle::current()),
            tripped: std::sync::atomic::AtomicBool::new(false),
        }
    };
    output::attach_viewer_output(&slot, vk.lease_epoch, viewer(&vk, 1000, 11), 0);
    output::attach_viewer_output(&slot, fast.lease_epoch, viewer(&fast, 1000, 12), 0);
    let (ptx, prx) = std::sync::mpsc::channel::<Vec<u8>>();
    output::spawn_batcher(prx, Arc::clone(&slot), Arc::new(output::OutputStats::default()));

    let mut main_bytes = Vec::new();
    let mut slow_bytes = Vec::new();
    let mut fast_bytes = Vec::new();
    for i in 0..6u8 {
        ptx.send(vec![b'a' + i; 600]).unwrap();
        // 배치마다 프레임을 거둔다 — 주와 빠른 시청자만 ACK 한다.
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(300);
        while let Ok(Some(f)) = tokio::time::timeout_at(deadline, rx.recv()).await {
            let Frame::Output { header, bytes } = f else { continue };
            let end = header.offset + bytes.len() as u64;
            match header.route {
                None => main_bytes.extend(bytes),
                Some(11) => slow_bytes.extend(bytes),
                Some(12) => fast_bytes.extend(bytes),
                other => panic!("모르는 경로 {other:?}"),
            }
            if header.route != Some(11) {
                ack(Ack { stream: stream.into(), session_epoch: 1, lease_epoch: header.lease_epoch, consumed: end });
            }
            if main_bytes.len() == (i as usize + 1) * 600 && fast_bytes.len() == main_bytes.len() {
                break;
            }
        }
        assert!(gate.passable(), "느린 시청자가 생산자를 세우지 않는다");
    }
    assert_eq!(main_bytes.len(), 3600, "주는 끝까지 받는다");
    assert_eq!(fast_bytes, main_bytes, "ACK 하는 시청자는 주와 같은 바이트");
    assert_eq!(slow_bytes, main_bytes[..600].to_vec(), "느린 시청자는 예산(1000)까지만 — 둘째 배치에서 떨어진다");
    // 떼는 일은 태스크로 — 코어에서 빠지고 노트를 비울 때까지 기다린다.
    for _ in 0..100 {
        if core().viewer_epochs(stream) == vec![fast.lease_epoch] {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(core().viewer_epochs(stream), vec![fast.lease_epoch], "느린 시청자만 코어에서 떨어졌다");
    assert_eq!(output::viewer_sinks(&slot), vec![fast.lease_epoch]);
    assert_eq!(
        core().holder(stream, 1, vk.lease_epoch).unwrap_err(),
        CoreError::Stale,
        "옛 시청자 열쇠는 낡았다 — 다시 붙어 새 열쇠로"
    );
    assert!(!viewer_credits().contains_key(&(Kind::Local, id, vk.lease_epoch)), "그 크레딧도 거뒀다");
    retire_credit(id);
    assert!(viewer_credits().keys().all(|(_, i, _)| *i != id));
    core().remove_id(Kind::Local, id);
    settle();
}

#[test]
fn inline_ops_are_map_only() {
    for op in [
        "probe", "detach", "detach_window", "checkpoint", "set_home", "live_streams", "stats", "ssh_log_path",
        "forward_list", "worktree_answer", "sessions_detached", "session_ai_read", "detach_viewer",
    ] {
        assert!(inline_op(op), "{op}");
    }
    for op in [
        "open", "open_ssh", "write", "resize", "close", "attach", "adopt", "close_all", "restore_done",
        "close_detached", "close_window", "local_cwd", "ssh_info", "forward_add", "forward_remove", "attach_viewer",
        "claim_size",
    ] {
        assert!(!inline_op(op), "{op} 은 기다림이 있어 태스크로 돈다");
    }
}
