//! 사건 · 걸음 · 끝 — 주인의 잠금 아래에서만 돈다(op 는 주인이 쥔 잠금으로, 세 스레드는 [`Host::state`] 로).

use std::time::Duration;

use super::{lock, Core, Delta, Host, ProcExit, ProcId, Status, DELTA_MS};
use crate::side_chat::event::one_line;
use crate::side_chat::{Ev, Step};

/// 내보낸다 — 코어 장부에 반영하고 `seq` +1 → 주인([`Host::on_event`])이 주인 칸 반영 · 내보내기.
fn send_ev<H: Host>(h: &H, st: &mut H::St, mut ev: Ev) {
    h.shape(st, &mut ev);
    let core = H::core(st);
    core.record(&ev);
    core.seq += 1;
    let (proc, seq) = (core.id, core.seq);
    h.on_event(st, proc, seq, &ev);
}

/// 모으던 `textDelta` 를 낸다.
pub(crate) fn flush<H: Host>(h: &H, st: &mut H::St) {
    if let Some(d) = H::core(st).delta.take() {
        send_ev(h, st, Ev::TextDelta { item: d.item, text: d.text });
    }
}

/// 사건 하나 — `textDelta` 는 모으고, 그 밖의 사건 앞에서는 모은 것을 먼저 낸다(순서 그대로).
pub(crate) fn push<H: Host>(h: &H, st: &mut H::St, ev: Ev) {
    if let Ev::TextDelta { item, text } = ev {
        let same = matches!(&H::core(st).delta, Some(d) if d.item == item);
        if same {
            if let Some(d) = H::core(st).delta.as_mut() {
                d.text.push_str(&text);
            }
        } else {
            flush(h, st);
            H::core(st).delta = Some(Delta { item, text, since: std::time::Instant::now() });
        }
        if H::core(st).delta.as_ref().is_some_and(|d| d.since.elapsed() >= Duration::from_millis(DELTA_MS)) {
            flush(h, st);
        }
        return;
    }
    flush(h, st);
    send_ev(h, st, ev);
}

/// **어댑터의 한 걸음** — stdin 줄은 쓰기 스레드로, 사건은 [`push`]. 주인이 stdin 에 쓰는 길은 이것 하나다(머리말 "입력 전송기 하나").
/// 어댑터의 `exited`(악수 실패 = `protocol`)는 내보내지 않고 프로세스를 닫는다 — 끝 사건은 감시 스레드가 하나만 낸다([`finalize`]).
/// **쓰기 결과를 돌려준다**(2단계 단계 2 — 설계 3-4): 줄을 모두 쓰기 스레드에 넘겼나(스레드가 이미 죽었거나 프로세스 칸이 없으면 거짓 · 줄이
/// 없으면 참). 프로듀서 전송기는 이 값으로 `Dispatching` 을 확정하거나 `failed` 로 되돌리고, 사이드 채팅은 지금처럼 버린다.
pub(crate) fn apply<H: Host>(h: &H, st: &mut H::St, step: Step) -> bool {
    let mut written = true;
    match H::core(st).proc.as_ref() {
        Some(p) => {
            for line in step.stdin {
                if p.stdin.send(line).is_err() {
                    written = false;
                }
            }
        }
        None => written = step.stdin.is_empty(),
    }
    for ev in step.evs {
        if let Ev::Exited { reason, .. } = ev {
            H::core(st).kill(reason);
            continue;
        }
        push(h, st, ev);
    }
    written
}

/// stdout 한 줄(읽기 스레드) — 그 세대의 프로세스일 때만.
pub(super) fn on_line<H: Host>(h: &H, proc: ProcId, line: &str) {
    let mut st = h.state();
    let core: &mut Core = H::core(&mut st);
    if core.id != proc {
        return;
    }
    let Some(p) = core.proc.as_mut() else { return };
    let step = p.adapter.on_line(line);
    apply(h, &mut st, step);
}

/// 모은 조각이 [`DELTA_MS`] 를 넘겼으면 낸다(감시 스레드).
pub(super) fn flush_due<H: Host>(h: &H, proc: ProcId) {
    let mut st = h.state();
    let core = H::core(&mut st);
    if core.id == proc && core.delta.as_ref().is_some_and(|d| d.since.elapsed() >= Duration::from_millis(DELTA_MS)) {
        flush(h, &mut st);
    }
}

/// 프로세스가 끝났다 — 기다리던 권한 요청을 닫고(`by: closed`) 주인의 끝 정리([`Host::on_ending`]) 뒤 끝 사건 하나 → 잠금 밖에서
/// [`Host::on_exit`]. 임시 자리 · stdin 은 프로세스 칸과 함께 떨어진다. **정확히 같은 세대**일 때만(늦은 끝 정리는 새 세대에 닿지 않는다).
pub(super) fn finalize<H: Host>(h: &H, proc: ProcId, code: Option<i64>) {
    let mut st = h.state();
    let core = H::core(&mut st);
    if core.id != proc {
        return;
    }
    let Some(mut p) = core.proc.take() else { return };
    flush(h, &mut st);
    let before_ready = H::core(&mut st).status == Status::Starting;
    for ev in p.adapter.close_pending() {
        push(h, &mut st, ev);
    }
    // 준비 전에 끝났으면 stderr 마지막 줄(로그인 · 설치 문제를 화면이 밝힌다 — 사용자 자신의 CLI 출력이고 주인이 고른 곳에만 간다).
    if before_ready && p.closing.is_none() {
        let tail = String::from_utf8_lossy(lock(&p.stderr).bytes()).into_owned();
        if let Some(last) = tail.lines().rev().find(|l| !l.trim().is_empty()) {
            push(h, &mut st, Ev::Notice { code: "stderr", detail: Some(one_line(last)) });
        }
    }
    let reason = p.closing.unwrap_or(if code == Some(0) { "exit" } else { "crash" });
    let dropped = p.adapter.dropped();
    // 임시 자리(토큰이 든 `--mcp-config` 파일) · stdin 을 떨어뜨리고, 주인이 이 세대의 토큰을 끝 사건보다 먼저 거둔다(끝 사건을 본 쪽에게 남은 것이 없게).
    drop(p);
    h.on_ending(&mut st, proc);
    push(h, &mut st, Ev::Exited { code: code.map(|c| c as i32), reason });
    drop(st);
    h.on_exit(ProcExit { proc, code, reason, dropped });
}
