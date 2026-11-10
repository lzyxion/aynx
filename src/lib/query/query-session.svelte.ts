// **쿼리 타일의 세션 상태** — `QueryView.svelte` 에서 그대로 옮긴 컨트롤러(2026-10-27 분할 10차).
// `QueryView` 가 하나 만들고(`createQuerySession` — 타일 명세 · 편집기 손잡이 · 끝났나 · 행 상한 · 스크립트 탭은 게터로) 값은 게터로 읽는다.
//
// 쥐는 것: 연결(`conn` — 열기 · 잃기 · 끊긴 손잡이 `lost`) · 결과 · 알림(탭마다 `outcomes` · `notes`) · 도는 실행(`running` — 연결에 하나 ·
// 결과는 보낸 탭) · 실행 · 스크립트 실행 · 취소 · **쓰기 토글**(`onPill` → 규칙 `query/write-toggle`) · 커밋 방식(`setAutoCommit` → `query/auto-commit`) ·
// **트랜잭션 작업**(`txCall` · `seeTx` · `refreshTx` → 규칙 `query/tx-work`). 판정 · 규칙은 순수 모듈 그대로 부르고, 진실은 서버의 답이다
// (쓰기 상태는 저장하지 않는다 — 머리말은 `QueryView.svelte`).
//
// **`$effect` · 리스너 · `onMount` · `onDestroy` 는 없다** — 부모가 원래 자리에서 부른다:
// - 작업 시계 효과의 몸은 `syncTxClock()`(부모 `$effect` 가 부른다 — `tx` 를 읽어 추적),
// - 서버 이벤트 `db-state` 리스너는 부모(`seeTx` · `lostTx` · `loseConn` 을 부른다),
// - 언마운트는 부모 `onDestroy` 가 `stopTimers()` → (탭 저장) → `release()` 순서로 부른다(도는 쿼리 취소 · 이관 예외 · 닫기).
// `await` 뒤에는 게터(`h.disposed` · `h.editor` · `h.sc`)와 이 안의 상태를 그때그때 다시 읽는다(옮기기 전과 같다).
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { askDbWrite, openDbForTile } from "$lib/app/query.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { isHandoff } from "$lib/tear";
import type { PaneSpec, QueryRowLimit, QuerySpec } from "$lib/session";
import type { RunShown } from "$lib/query/RunResults.svelte";
import { runTarget } from "$lib/query/statement-at";
import { editorRange, scriptTarget } from "$lib/query/script-run";
import { queryErrorPanel, queryPanel, runMarks, scriptPanel, type PanelList, type PanelRow, type RunMark } from "$lib/query/run-panel";
import { docKey, type ScriptTabsController } from "$lib/query/script-controller.svelte.js";
import {
  classifyDbError,
  dbCancel,
  dbClose,
  dbQuery,
  dbScript,
  dbSetWrite,
  dbTx,
  errorMessage,
  type DbErrorKind,
  type DbOpened,
  type DbQueryResult,
  type DbTxAction,
  type DbTxView,
} from "$lib/query/query-backend";
import { toggleWrite, writePill } from "$lib/query/write-toggle";
import {
  freshEnded,
  runBlocked,
  txAfterDisconnect,
  txButtons,
  txChip,
  txEndLost,
  txEndNote,
  txIdOf,
  txOpen,
  txSending,
  type TxEndNote,
  type TxSeen,
} from "$lib/query/tx-work";
import { autoCommitOff, autoCommitToggle, runRoute } from "$lib/query/auto-commit";

/** 세션이 쓰는 편집기 — `query/SqlEditor.svelte` 의 손잡이 중 실행 · 결과가 쓰는 것 */
export interface QuerySessionEditor {
  getText(): string;
  selection(): { from: number; to: number };
  textOf(key: string): string | null;
  setMarks(key: string, marks: readonly RunMark[]): void;
  select(from: number, to: number): void;
}

/** `QueryView` 가 넘기는 값 — **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). */
export interface QuerySessionHost {
  readonly pane: PaneSpec;
  /** 이 타일의 영속 키(`tileKey`) — 서버 DB 연결 표의 열쇠 */
  readonly stream: string;
  /** 타일 명세의 쿼리 칸(`pane.query ?? { connId: "" }`) */
  readonly spec: QuerySpec | { connId: string };
  readonly editor: QuerySessionEditor | null;
  /** 컴포넌트가 사라졌나(답을 기다리는 사이) */
  readonly disposed: boolean;
  /** 이 타일의 행 상한 */
  readonly maxRows: QueryRowLimit;
  /** 스크립트 탭(고른 탭 · 탭 목록 — 결과를 어느 탭에 내리나) */
  readonly sc: ScriptTabsController;
  /** 실행을 시작했다 — 아래 칸을 결과 쪽으로(DDL 보기 상태는 부모) */
  showResultTab(): void;
}

export type ConnState =
  | { state: "connecting" }
  | { state: "open"; o: DbOpened }
  | { state: "closed"; kind: DbErrorKind; message: string };

/** 보낸 글 — `base` = 편집기 시작 자리 · `text` = 보낸 때의 편집기 글(바뀌었으면 짚지 않는다 — 모르면 `null`) */
type Sent = { base: number; text: string | null };
export type Outcome = { kind: "none" } | { kind: "cancelled" } | { kind: "nothing" } | (RunShown & { sent: Sent });
const NONE: Outcome = { kind: "none" };
const NO_SENT: Sent = { base: 0, text: null };

/** 쿼리 타일 세션 하나 벌을 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createQuerySession(h: QuerySessionHost) {
  let conn = $state<ConnState>({ state: "connecting" });
  const opened = $derived(conn.state === "open" ? conn.o : null);
  /** 끊긴 연결의 마지막 손잡이 · 임대 — 닫을 때 서버 표 칸을 거두려고(머리말 "수명"). 새로 열리면 비운다(서버가 옛 칸을 거뒀다). */
  let lost: { handle: number; lease: number } | null = null;

  /** 연결을 잃었다 — 띠를 세우고, 열려 있던 손잡이를 기억한다. */
  function loseConn(kind: DbErrorKind, message: string) {
    const o = opened;
    if (o) lost = { handle: o.handle, lease: o.lease };
    conn = { state: "closed", kind, message };
  }

  // ── 결과 · 알림 — 탭마다(머리말 "알림") ─────────────────────────────────

  // 결과는 얕은 상태 — 행 1만 개를 깊은 프록시로 감싸지 않게(바꿀 때는 새 객체로 — `setOutcome`)
  let outcomes = $state.raw<Record<number, Outcome>>({});
  function setOutcome(tab: number, o: Outcome) {
    outcomes = { ...outcomes, [tab]: o };
  }
  let notes = $state<Record<number, TxEndNote | null>>({});
  const outcome = $derived<Outcome>(outcomes[h.sc.activeN] ?? NONE);
  const note = $derived(notes[h.sc.activeN] ?? null);

  /** 닫은 탭의 결과 · 알림을 걷는다(스크립트 탭 컨트롤러의 `dropResults` — 원래 자리) */
  function dropResults(n: number) {
    const { [n]: _gone, ...rest } = outcomes;
    outcomes = rest;
    delete notes[n];
  }

  /** 결과가 없는 실패(쓰기 · 커밋 방식 바꾸기 · 작업 op) — 지금 탭의 결과 칸에 */
  function showError(message: string, tab = h.sc.activeN) {
    setOutcome(tab, { kind: "error", message, list: null, sent: NO_SENT });
  }

  /** 끝난 작업의 알림을 그 탭에 */
  function noteEnd(note: TxEndNote, tab: number) {
    if (h.sc.tabs.some((x) => x.n === tab)) notes[tab] = note;
  }

  /** 실행을 시작한다 — 조용한 알림(커밋됨 · 되돌림)은 모든 탭에서 걷는다 */
  function clearQuietNotes() {
    for (const k of Object.keys(notes)) {
      const n = Number(k);
      if (notes[n]?.level === "notice") notes[n] = null;
    }
  }

  // 트랜잭션 작업의 상태(1단계 — 함수 · 상태 표시는 아래 "트랜잭션 작업" 절)
  let tx = $state<TxSeen | null>(null);
  let txBusy = $state(false);
  /** 쓰기 · 자동 커밋을 바꾸는 중(`onPill` · `setAutoCommit`) */
  let switching = $state(false);
  /** 이미 알린 끝난 작업 id — 응답 · 이벤트 · 상태 조회가 같은 결과를 실어 와도 한 번만 */
  let announced: number | null = null;
  let txNow = $state(Date.now());
  let txTimer: ReturnType<typeof setInterval> | null = null;

  async function open() {
    if (conn.state === "connecting" && opening) return;
    conn = { state: "connecting" };
    opening = true;
    try {
      const r = await openDbForTile(h.stream, $state.snapshot(h.spec) as QuerySpec);
      if (r.ok) {
        if (h.disposed) {
          void dbClose(r.opened.handle, r.opened.lease).catch(() => {});
          return;
        }
        conn = { state: "open", o: r.opened };
        lost = null;
        seeTx(r.opened.tx);
        // 떼어 둔 동안 끝난 스크립트 — 요약을 지금 탭에 한 번 보인다(보낸 글을 모르니 편집기는 짚지 않는다).
        if (r.opened.lastScript) {
          const s = r.opened.lastScript;
          setOutcome(h.sc.activeN, { kind: "script", r: s, list: scriptPanel(s, null, r.opened.dialect), sent: NO_SENT });
        }
      } else if (!h.disposed) {
        conn = { state: "closed", kind: r.kind, message: r.message };
      }
    } finally {
      opening = false;
    }
  }
  let opening = false;

  /** 언마운트 — 시계 둘을 멈춘다(부모 `onDestroy` 의 원래 자리) */
  function stopTimers() {
    if (txTimer) clearInterval(txTimer);
    if (timer) clearInterval(timer);
  }

  /** 언마운트 — 도는 쿼리 취소 · 연결 닫기(부모 `onDestroy` 의 원래 자리 — 탭 저장 뒤) */
  function release() {
    const o = opened;
    if (o) {
      const handoff = isHandoff(h.pane.id);
      // 이관 중 열린 작업의 도는 문장은 끊지 않는다 — 끊으면 그 실행분이 되돌려진다(받는 창이 같은 작업에 다시 붙는다).
      if (running && !(handoff && txOpen(tx))) void dbCancel(o.handle, running.queryId).catch(() => {});
      // 이관(다른 창으로 옮기기)이면 받는 창이 같은 열쇠로 다시 붙는다 — 닫지 않는다(`Terminal` 의 이관 예외와 같은 이름표).
      // 닫기는 열린 작업을 서버가 되돌린다(닫기 전 물음은 `app/db-tx`).
      if (!handoff) void dbClose(o.handle, o.lease).catch(() => {});
    } else if (lost && !isHandoff(h.pane.id)) {
      // 끊긴 뒤 닫는다 — 서버 표에 남은 끊긴 칸을 거둔다(머리말 "수명"). 이관이면 받는 창의 `db_open` 이 거둔다.
      void dbClose(lost.handle, lost.lease).catch(() => {});
    }
  }

  /** 다른 갈래의 실패가 연결을 잃었다고 말하면 — 다시 열기 띠로 */
  function lostIfReopen(message: string): boolean {
    const kind = classifyDbError(message);
    if (kind !== "reopen" && kind !== "outdated" && kind !== "disconnected") return false;
    if (kind !== "outdated") lostTx();
    loseConn(kind, kind === "disconnected" ? t("pane.query.disconnected") : stripReason(message));
    return true;
  }

  // ── 실행 ─────────────────────────────────────────────────────────────────

  /** 도는 실행 — 연결에 하나(`tab` = 보낸 탭 — 결과는 그 탭에 내린다) */
  let running = $state<{ queryId: string; startedAt: number; tab: number } | null>(null);
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  /** 실행 · 작업 op 를 보낸 중 · 모드 바꾸는 중 · 끝내는 중이면 [실행] · [스크립트 실행] 을 막는다(Codex 검토 반영 2 — 서버도 바쁨으로 거절) */
  const runOff = $derived(runBlocked({ connected: opened !== null, running: running !== null, txBusy, switching, tx }));

  /** 실행을 시작한다 — 그 탭의 지난 결과 · 거터 표시를 걷는다 */
  function startRun(tab: number): string {
    const queryId = crypto.randomUUID();
    setOutcome(tab, NONE);
    h.editor?.setMarks(docKey(tab), []);
    h.showResultTab();
    clearQuietNotes();
    running = { queryId, startedAt: Date.now(), tab };
    now = Date.now();
    timer = setInterval(() => (now = Date.now()), 100);
    return queryId;
  }

  function endRun() {
    if (timer) clearInterval(timer);
    timer = null;
    running = null;
  }

  /** 거터 표시 — 보낸 뒤 그 탭의 글이 그대로일 때만(머리말 "실행") */
  function paint(tab: number, list: PanelList, base: number, whole: string, single: boolean) {
    const editor = h.editor;
    if (!editor || editor.textOf(docKey(tab)) !== whole) return;
    editor.setMarks(docKey(tab), runMarks(list, base, single));
  }

  /** 실행의 실패를 그 탭의 결과 칸에 — 이유 코드로 갈래를 가른다. 문장에 붙는 실패면 그 줄 · 거터 ✕(결과 불명은 ?) */
  function showRunError(m: string, tab: number, target: { from: number; text: string } | null, whole: string): DbErrorKind {
    const kind = classifyDbError(m);
    if (kind === "cancelled") setOutcome(tab, { kind: "cancelled" });
    else if (!lostIfReopen(m)) {
      const tag = kind === "needsWork" || kind === "unconfirmed" ? kind : undefined;
      const message = stripReason(m);
      const list =
        target === null
          ? null
          : queryErrorPanel(kind === "error" || kind === "needsWork" || kind === "unconfirmed" ? kind : "other", message, target.text);
      setOutcome(tab, { kind: "error", message, tag, list, sent: target ? { base: target.from, text: whole } : NO_SENT });
      if (list && target) paint(tab, list, target.from, whole, true);
    }
    return kind;
  }

  async function run() {
    const o = opened;
    const editor = h.editor;
    if (!o || runOff || !editor) return;
    const tab = h.sc.activeN;
    const whole = editor.getText();
    const target = runTarget(whole, o.dialect, editor.selection());
    if (!target) {
      setOutcome(tab, { kind: "nothing" });
      return;
    }
    // 자동 커밋 끔 · 작업 중의 여러 문장 — 스크립트 실행기로(한 번의 실행 · 커밋 안 함 — `query/auto-commit`).
    const route = runRoute({ text: target.text, dialect: o.dialect, inWork: txOpen(tx), autoCommitOff: acOff, scriptSupported });
    if (route === "script") return runScriptOn(target, whole);
    const queryId = startRun(tab);
    try {
      const txId = txSupported ? txIdOf(tx) : undefined;
      const r = await dbQuery({ handle: o.handle, lease: o.lease, sql: target.text, queryId, maxRows: h.maxRows, txId });
      if (!h.disposed && h.sc.tabs.some((x) => x.n === tab)) {
        const list = queryPanel(r, target.text);
        const inWork = r.tx?.state === "open" || r.tx?.state === "ending";
        setOutcome(tab, { kind: "result", r, list, inWork, writable: o.writable, sent: { base: target.from, text: whole } });
        paint(tab, list, target.from, whole, true);
      }
      if (!h.disposed) seeTx(r.tx, tab);
    } catch (e) {
      const m = errorMessage(e);
      if (h.disposed) return;
      const kind = showRunError(m, tab, target, whole);
      // 작업 안의 실패 · 낡은 작업 id — 서버의 작업 상태를 다시 읽는다(PG 오류면 작업이 되돌려졌다).
      if (txSupported && (txOpen(tx) || kind === "txStale") && conn.state === "open") void refreshTx(tab);
    } finally {
      endRun();
    }
  }

  /** 스크립트 실행 — 선택 영역, 없으면 글 전체(`query/script-run`) */
  async function runScript() {
    const o = opened;
    const editor = h.editor;
    if (!o || runOff || !editor || !scriptSupported) return;
    const whole = editor.getText();
    const target = scriptTarget(whole, editor.selection());
    if (!target) {
      setOutcome(h.sc.activeN, { kind: "nothing" });
      return;
    }
    await runScriptOn(target, whole);
  }

  /** 스크립트 한 벌을 보낸다 — `target` = 보낼 글과 편집기 자리 · `whole` = 보낸 때의 편집기 글(멈춘 문장 짚기 · 거터) */
  async function runScriptOn(target: { from: number; to: number; text: string }, whole: string) {
    const o = opened;
    if (!o || runOff || !scriptSupported) return;
    const tab = h.sc.activeN;
    const queryId = startRun(tab);
    try {
      const txId = txSupported ? txIdOf(tx) : undefined;
      const r = await dbScript({ handle: o.handle, lease: o.lease, sql: target.text, queryId, maxRows: h.maxRows, txId });
      if (h.disposed) return;
      if (h.sc.tabs.some((x) => x.n === tab)) {
        const list = scriptPanel(r, target.text, o.dialect);
        setOutcome(tab, { kind: "script", r, list, sent: { base: target.from, text: whole } });
        paint(tab, list, target.from, whole, false);
        // 멈춘 문장을 편집기에서 골라 준다(그 탭을 보고 있고 글이 그대로일 때만).
        const failed = list.rows.find((x) => x.status === "failed");
        if (failed && tab === h.sc.activeN) locate(failed);
      }
      seeTx(r.tx, tab);
    } catch (e) {
      const m = errorMessage(e);
      if (h.disposed) return;
      const kind = showRunError(m, tab, null, whole);
      if (txSupported && (txOpen(tx) || kind === "txStale") && conn.state === "open") void refreshTx(tab);
    } finally {
      endRun();
    }
  }

  /** 결과 목록의 문장을 편집기에서 고른다 — 보낸 뒤 글이 바뀌었으면 하지 않는다 */
  function locate(row: PanelRow) {
    const o = outcome;
    const editor = h.editor;
    if ((o.kind !== "script" && o.kind !== "result" && o.kind !== "error") || !editor || row.start === null || row.end === null) return;
    const range = editorRange({ start: row.start, end: row.end }, o.sent.base, o.sent.text !== null && editor.getText() === o.sent.text);
    if (range) editor.select(range.from, range.to);
  }

  /**
   * **데이터 탭의 조회 하나**(2026-11-10 — `query/data-tab`). 도는 실행 칸(`running`)을 함께 써서 연결당 하나 규칙 · [취소] · 막힘이
   * 쿼리 실행과 같다(데이터 탭 조회 중이면 [실행] 이 막히고, 실행 중이면 데이터 탭이 기다린다). 늘 **읽기 전용**(`readOnly` — 서버가 가드 ·
   * 엔진 모두 읽기 전용 · 열린 작업이면 거절)이고, 작업이 열려 있으면 보내지도 않는다. 결과는 부르는 쪽(데이터 탭)이 쥔다 — 탭 결과
   * 칸(`outcomes`)에 내리지 않는다. `null` = 보내지 못함(연결 없음 · 막힘 · 작업 열림).
   */
  async function runData(tab: number, sql: string, maxRows: number): Promise<{ ok: true; r: DbQueryResult } | { ok: false; message: string; cancelled: boolean } | null> {
    const o = opened;
    if (!o || runOff || txOpen(tx)) return null;
    const queryId = startRun(tab);
    try {
      return { ok: true, r: await dbQuery({ handle: o.handle, lease: o.lease, sql, queryId, maxRows, readOnly: true }) };
    } catch (e) {
      const m = errorMessage(e);
      const kind = classifyDbError(m);
      // 판이 낮은 서버(이 조회만 못 보낸다) — 연결은 그대로 둔다. 연결을 잃은 갈래만 [다시 열기] 띠로.
      if (!h.disposed && kind !== "outdated") lostIfReopen(m);
      return { ok: false, message: stripReason(m), cancelled: kind === "cancelled" };
    } finally {
      endRun();
    }
  }

  function cancel(): boolean {
    const o = opened;
    if (!o || !running) return false;
    void dbCancel(o.handle, running.queryId).catch(() => {});
    return true;
  }

  const elapsed = $derived(running ? Math.max(0, now - running.startedAt) : 0);

  // ── 쓰기 토글 — 서버의 답만 진실(저장하지 않는다) ─────────────────────────

  const pill = $derived(
    writePill({ writable: opened ? opened.writable : null, running: running !== null, switching: switching || txBusy || tx?.view.state === "ending" }),
  );

  async function onPill() {
    const o = opened;
    if (!o || pill.disabled) return;
    switching = true;
    try {
      const hadTx = txOpen(tx);
      const w = await toggleWrite({
        writable: o.writable,
        ask: () => askDbWrite($state.snapshot(h.spec) as QuerySpec),
        set: (on) => dbSetWrite(o.handle, o.lease, on),
        txOpen: hadTx,
        askRollback: askTxWriteOff,
      });
      // 그 사이 연결이 바뀌었으면(끊김 · 다시 열기) 옛 답은 버린다. 자동 커밋은 쓰기를 끄면 서버가 켬으로 돌리고, 다시 켜면 기본(켬)이다.
      if (w !== null && !h.disposed && opened === o)
        conn = { state: "open", o: { ...o, writable: w, autoCommit: o.autoCommit === undefined ? undefined : true } };
      // 작업 중 끄기 — 서버가 되돌렸다. 결과(되돌림)를 읽어 온다.
      if (w !== null && hadTx && txSupported) await refreshTx();
    } catch (e) {
      const m = errorMessage(e);
      if (!h.disposed && !lostIfReopen(m)) showError(stripReason(m));
    } finally {
      switching = false;
    }
  }

  // ── 커밋 방식(10-14 — 값은 서버의 것 · `query/auto-commit`) ───────────────────────

  const acOff = $derived(autoCommitOff({ autoCommit: opened?.autoCommit, writable: opened?.writable === true }));
  const acToggle = $derived(
    autoCommitToggle({
      autoCommit: opened?.autoCommit,
      writable: opened?.writable === true,
      txOpen: txOpen(tx),
      running: running !== null,
      busy: switching || txBusy,
      connected: opened !== null,
    }),
  );

  /** `[자동 | 수동 커밋]` 의 한 칸을 고른다 — 이미 그 값이면 아무것도 안 한다 */
  async function setAutoCommit(on: boolean) {
    const o = opened;
    if (!o || acToggle.disabled || acToggle.on === on) return;
    switching = true;
    try {
      const r = await dbSetWrite(o.handle, o.lease, true, on);
      if (!h.disposed && opened === o) conn = { state: "open", o: { ...o, writable: r.writable, autoCommit: r.autoCommit ?? o.autoCommit } };
    } catch (e) {
      const m = errorMessage(e);
      if (!h.disposed && !lostIfReopen(m)) showError(stripReason(m));
      // 작업이 열려 있어 거절됐다(다른 창 · 이벤트가 늦게 닿음) — 작업 상태를 다시 읽는다.
      if (txSupported && conn.state === "open") void refreshTx();
    } finally {
      switching = false;
    }
  }

  /** 라디오 묶음의 화살표 — 다른 칸으로(값이 둘뿐이라 ← → 모두 바꾸기) */
  function onModeKey(ev: KeyboardEvent) {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight" && ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
    ev.preventDefault();
    void setAutoCommit(!acToggle.on);
  }

  // ── 트랜잭션 작업(1단계) — 상태는 서버의 것(`query/tx-work`) ─────────────────────

  /** 판 9 서버인가 — 판 8 서버는 `opened.tx` 를 싣지 않는다(작업 단추를 숨긴다) */
  const txSupported = $derived(opened?.tx !== undefined);
  /** 판 10 서버인가 — 판 9 서버는 `opened.scripts` 를 싣지 않는다([스크립트 실행] 을 숨긴다) */
  const scriptSupported = $derived(opened?.scripts === true);
  /** [스크립트 실행] 의 말풍선 — 지금 모양(읽기 전용 · 쓰기 · 작업 중)이 하는 일 */
  const scriptTitle = $derived(
    txOpen(tx)
      ? t("pane.query.script.title.work")
      : acOff
        ? t("pane.query.script.title.manual")
        : opened?.writable
          ? t("pane.query.script.title.write")
          : t("pane.query.script.title.read"),
  );
  const chip = $derived(txChip(tx, txNow));
  const txb = $derived(
    txButtons({
      writable: opened?.writable === true,
      tx,
      now: txNow,
      running: running !== null,
      busy: txBusy || switching,
      connected: opened !== null,
    }),
  );
  /** 작업 단추가 서는가 — 쓰기 모드 · 판 9 서버 */
  const txShown = $derived(txSupported && opened?.writable === true);

  /** 서버가 말한 작업 상태를 받는다 — 새로 끝난 작업이면 알린다(`tab` = 알림을 내릴 탭 — 머리말 "알림") */
  function seeTx(view: DbTxView | undefined, tab = h.sc.activeN) {
    if (!view) return;
    tx = { view, at: Date.now() };
    txNow = Date.now();
    const e = freshEnded(view, announced);
    if (e) {
      announced = e.id;
      noteEnd(txEndNote(e), tab);
    }
  }

  /** 연결을 잃었다 — 열린 작업은 서버가 되돌렸다(다시 연결 전에는 물을 수 없으니 스스로 적는다) */
  function lostTx() {
    const next = txAfterDisconnect(tx, Date.now());
    if (next && next !== tx) seeTx(next.view);
  }

  async function refreshTx(tab = h.sc.activeN) {
    const o = opened;
    if (!o) return;
    try {
      const r = await dbTx(o.handle, o.lease, "state");
      if (!h.disposed && opened === o) seeTx(r.tx, tab);
    } catch {
      // 상태 조회의 실패는 다음 일이 다시 알려 준다(끊김 · 낡은 임대는 그 일의 띠가 선다)
    }
  }

  /**
   * 작업 op 하나. [커밋] · [되돌리기] 는 보내기 전에 화면에도 **끝내는 중**을 적고(`txSending`), 그 답은 **연결이 그 사이 닫혔어도 받는다**
   * (Codex 검토 반영 2 — 커밋 중 끊김 이벤트가 먼저 와도 "끊김 = 되돌림" 으로 앞질러 적지 않고, 서버가 말한 결과 불명 · 커밋됨을 보인다).
   * 답 없이 실패했는데 연결을 잃었으면 커밋은 결과 불명 · 되돌리기는 끊김(`txEndLost`). 알림은 누른 순간 보던 탭에.
   */
  async function txCall(action: DbTxAction) {
    const o = opened;
    if (!o || txBusy) return;
    const ending = action === "commit" || action === "rollback";
    if (ending && running) return;
    txBusy = true;
    const tab = h.sc.activeN;
    const id = action === "begin" ? 0 : txIdOf(tx);
    if (ending) tx = txSending(tx, Date.now());
    try {
      const r = await dbTx(o.handle, o.lease, action, id);
      if (h.disposed) return;
      if (opened !== o) {
        // 연결이 바뀌었다 — 끝내기의 답만 받는다(끊긴 연결이면 화면 상태로 · 새 연결이 섰으면 결과 알림만).
        if (!ending) return;
        if (opened === null) seeTx(r.tx, tab);
        else {
          const e = freshEnded(r.tx, announced);
          if (e) {
            announced = e.id;
            noteEnd(txEndNote(e), tab);
          }
        }
        return;
      }
      if (action === "begin") notes = {};
      seeTx(r.tx, tab);
    } catch (e) {
      const m = errorMessage(e);
      if (h.disposed) return;
      if (!lostIfReopen(m)) showError(stripReason(m), tab);
      if (ending && (opened !== o || conn.state !== "open")) {
        // 답 없이 연결을 잃었다 — 서버에 물을 수 없다.
        const next = txEndLost(tx, action === "commit", Date.now());
        if (next && next !== tx) seeTx(next.view, tab);
      } else if (ending) {
        // 서버가 받지 않았다(바쁨 · 낡음 · 거절 — 작업은 그대로) — 화면의 '끝내는 중' 을 걷고 서버의 진실을 읽는다.
        if (tx?.view.state === "ending") tx = { view: { ...tx.view, state: "open" }, at: Date.now() };
        await refreshTx(tab);
      } else if (classifyDbError(m) === "txStale") await refreshTx(tab);
    } finally {
      txBusy = false;
    }
  }

  /** 작업 중 쓰기 끄기 — 되돌린다는 확인(앱 확인 상자 · 못 띄우면 끄지 않는다) */
  async function askTxWriteOff(): Promise<boolean> {
    try {
      return await askConfirm(t("pane.query.tx.writeOff.body", { n: tx?.view.statements ?? 0 }), {
        title: t("pane.query.tx.writeOff.title"),
        kind: "warning",
        okLabel: t("pane.query.tx.writeOff.ok"),
        cancelLabel: t("pane.query.tx.writeOff.cancel"),
        danger: true,
      });
    } catch {
      return false;
    }
  }

  /** 열린 작업의 시계(표시만 — 경고 · 되돌림은 서버 이벤트) — 부모 `$effect` 의 몸(`tx` 를 읽어 추적한다) */
  function syncTxClock() {
    const on = txOpen(tx);
    if (on && !txTimer) txTimer = setInterval(() => (txNow = Date.now()), 1000);
    else if (!on && txTimer) {
      clearInterval(txTimer);
      txTimer = null;
    }
  }

  return {
    get conn() {
      return conn;
    },
    get opened() {
      return opened;
    },
    get outcome() {
      return outcome;
    },
    get note() {
      return note;
    },
    /** 탭마다의 알림(깊은 상태 — 부모의 [닫기] 가 지금 탭 칸을 비운다) */
    get notes() {
      return notes;
    },
    get tx() {
      return tx;
    },
    get txBusy() {
      return txBusy;
    },
    get switching() {
      return switching;
    },
    get running() {
      return running;
    },
    get runOff() {
      return runOff;
    },
    get elapsed() {
      return elapsed;
    },
    get pill() {
      return pill;
    },
    get acOff() {
      return acOff;
    },
    get acToggle() {
      return acToggle;
    },
    get txSupported() {
      return txSupported;
    },
    get scriptSupported() {
      return scriptSupported;
    },
    get scriptTitle() {
      return scriptTitle;
    },
    get chip() {
      return chip;
    },
    get txb() {
      return txb;
    },
    get txShown() {
      return txShown;
    },
    loseConn,
    dropResults,
    open,
    stopTimers,
    release,
    lostIfReopen,
    run,
    runScript,
    runData,
    locate,
    cancel,
    onPill,
    setAutoCommit,
    onModeKey,
    seeTx,
    lostTx,
    txCall,
    syncTxClock,
  };
}

export type QuerySession = ReturnType<typeof createQuerySession>;
