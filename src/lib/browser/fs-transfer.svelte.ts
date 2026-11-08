import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "$lib/toast.svelte";
import { recordNotification } from "$lib/app/notifications.svelte.js";
import { backendFromKey, baseNameOf, LOCAL_KEY, type FsBackend } from "$lib/fs-backend";
import { clearFsClip, fsClip, type FsClipMode } from "$lib/fs-clipboard.svelte";
import { notifyFsRefresh } from "$lib/fs-refresh.svelte";
import {
  isTransferCanceled,
  nextOp,
  type Conflict,
  type OnConflict,
  type TransferProgress,
} from "$lib/fs-ops";
import { routeBetween, routeDoneLabel, routeLabel, type FsRoute } from "$lib/fs-route";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";

/**
 * **묶음 전송 엔진** — 붙여넣기 · 타일 간 드롭 · 다운로드 · 내보내기 · 가져오기가 전부
 * 이 한 곳으로 모인다 (docs/log/2026-09-04-fs-batch-ops-backend.md ·
 * docs/log/2026-09-04-fs-cross-place-move.md).
 *
 * 뜻이 글자 그대로 같기 때문이다 — "저 백엔드의 이 경로들을 이 폴더로". 갈리는 것은 어디서
 * 시작했는가뿐이고, 규칙(방향 판정·충돌 대화상자·진행률·취소·끝난 뒤 선택·양쪽 타일
 * 새로고침)은 한 벌이어야 여러 길이 조용히 어긋나지 않는다.
 *
 * 화면(`SftpBrowser.svelte`)에서 떼어 낸 이유는 이것이 **화면이 아니기 때문**이다: 여기에는
 * 마크업도 이벤트 핸들러도 없고, 필요한 바깥 값은 전부 [`TransferHost`] 의 읽기 함수로 온다.
 * 떼어 내고 나니 타일에 남은 것은 "무엇을 골랐는가" 와 "어디를 보고 있는가" 뿐이다.
 */

/** 이 엔진이 타일에게 묻는 것들 — 전부 **읽기 함수**다 (값으로 받으면 한 프레임 낡는다) */
export interface TransferHost {
  backend: () => FsBackend;
  hasCwd: () => boolean;
  offline: () => boolean;
  /** 지금 골라져 있는 절대 경로들 — 새로고침 뒤 그대로 골라 두는 데 쓴다 */
  selPaths: () => string[];
  /** 목록을 다시 읽는다 (`load(cwd, keep)`) */
  reload: (keep?: readonly string[]) => Promise<boolean>;
  /** 그 자리에 남아야 하는 실패를 화면에 세운다 */
  setError: (message: string | null) => void;
  /** 예외 하나를 화면 문구로 — 세션이 사라진 것은 `null`(배너가 이미 말한다) */
  failureOf: (e: unknown) => string | null;
  /** 사실 전달 (성공의 결) */
  notice: (message: string) => void;
  /**
   * 내가 보낸 형제 타일 새로고침 신호를 **내가 소비했다**고 표시한다 — 목적지가 이 타일이면
   * 아래에서 어차피 다시 읽으므로 두 번 읽지 않는다.
   */
  consumeSignal: (tick: number) => void;
}

/**
 * 전송 하나의 **주문서** — 붙여넣기·드롭·다운로드·내보내기가 전부 이 모양으로 모인다.
 * 충돌 대화상자가 떠 있는 동안 그대로 들고 있다가([`Transfers.pending`]) 정책만 얹어 실행한다.
 */
interface Move {
  src: FsBackend;
  paths: string[];
  destDir: string;
  mode: FsClipMode;
  route: FsRoute;
  /**
   * **나가는 전송인가** — 이 타일에서 골라 *화면 밖*(대화상자로 고른 폴더)으로 보냈다
   * (툴바·메뉴의 [다운로드]와 [탐색기로 내보내기…]).
   *
   * 그때는 바뀐 것이 **저쪽 폴더**이지 이 목록이 아니므로 끝나고 다시 읽을 이유가 없다
   * (한 번 더 읽으면서 골라 둔 것만 잃는다). 원격 파일을 로컬 타일에 끌어다 놓은
   * 다운로드는 이 값이 거짓이다 — 그쪽은 실제로 **이 목록에** 파일이 떨어진다.
   */
  outbound: boolean;
}

/** 진행 중인 전송 하나 (타일마다 하나) */
export interface TransferJob {
  /**
   * `0` 이면 **취소할 수 없는 전송**이다: **같은 곳 안의** 이동은 이름 바꾸기 한 번이라
   * 중단할 청크 경계가 없다. 서로 다른 곳 사이의 이동은 바이트가 실제로 흐르므로 번호가
   * 붙는다. 취소할 수 없을 때는 [취소] 버튼을 아예 그리지 않는다 — 눌러도 아무 일이 없는
   * 버튼은 "먹통" 으로 읽힌다.
   */
  op: number;
  labelKey: Key;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  current: string;
  canceling: boolean;
}

export class Transfers {
  #host: TransferHost;
  #job = $state<TransferJob | null>(null);
  #pending = $state<(Move & { conflicts: Conflict[] }) | null>(null);

  constructor(host: TransferHost) {
    this.#host = host;
  }

  get job(): TransferJob | null {
    return this.#job;
  }

  /**
   * 대기 중인 전송 — **충돌 대화상자가 떠 있는 동안**의 주문서다. 정책을 고르면 그대로
   * [`#runPlan`] 으로 넘어간다 (짐을 다시 만들지 않는다 — 그 사이 선택이 바뀌었을 수 있다).
   */
  get pending(): { conflicts: Conflict[] } | null {
    return this.#pending;
  }

  /** 전송이나 확인이 걸려 있는가 — 드롭·다운로드가 겹치지 않게 하는 유일한 문 */
  get busy(): boolean {
    return this.#job !== null || this.#pending !== null;
  }

  /** 진행률 % (크기를 모르면 0 — 막대 대신 옮긴 바이트만 읽힌다) */
  get percent(): number {
    const j = this.#job;
    return j && j.bytesTotal > 0 ? Math.min(100, Math.round((j.bytesDone / j.bytesTotal) * 100)) : 0;
  }

  /** 충돌 대화상자의 [취소] · Escape */
  dismiss(): void {
    this.#pending = null;
  }

  /** 이 자리가 **받을 수 있는 폴더**인가 (합성 루트 "내 PC" 에는 놓을 자리가 없다) */
  canReceive(dir: string): boolean {
    const b = this.#host.backend();
    return b.online && this.#host.hasCwd() && !b.isSyntheticRoot(dir);
  }

  // -------------------------------------------------------------------------
  // 들어오는 짐 — 붙여넣기 · 드롭
  // -------------------------------------------------------------------------

  /**
   * 짐 하나를 이 타일의 `destDir` 로 — **붙여넣기와 드롭의 공통 몸통**.
   *
   * 충돌이 있으면 여기서 멈추고 대화상자를 띄운다. 없으면 곧바로 `"fail"` 정책으로 간다:
   * 못 물어봤으면 아무것도 없애지 않는다는 백엔드의 기본값 그대로다 (그 사이에 같은 이름이
   * 생겼다면 조용히 덮는 것보다 오류로 멈추는 편이 맞다).
   */
  async bringIn(
    src: FsBackend,
    paths: readonly string[],
    destDir: string,
    mode: FsClipMode,
  ): Promise<void> {
    if (paths.length === 0) return;
    if (!this.canReceive(destDir)) {
      toast.error(t("files.transfer.paste.blocked"));
      return;
    }
    // **출발지도 살아 있어야 한다** — 서버 사이 전송은 세션을 둘 쥐므로, 저쪽이 끊긴 채로
    // 명령을 부르면 "세션을 찾을 수 없습니다" 가 전송 실패로 늦게 도착한다.
    if (!src.online) {
      toast.error(t("files.transfer.source.offline"));
      return;
    }
    await this.#start(
      {
        src,
        paths: [...paths],
        destDir,
        mode,
        route: routeBetween(src.key, this.#host.backend().key),
        outbound: false,
      },
      (p, d) => this.#conflictsOf(src, p, d),
    );
  }

  /**
   * 지금 폴더에 붙여넣는다 — 잘라내기면 이동, 복사면 복사.
   *
   * 클립보드를 비우는 것은 [`#runPlan`] 이 **옮기기가 실제로 끝난 뒤** 한다 (여기서 미리
   * 비우면 충돌 대화상자에서 [취소] 를 눌렀을 때 담아 둔 것이 사라진다).
   */
  async pasteInto(destDir: string): Promise<void> {
    const clip = fsClip();
    if (!clip) return;
    const src = backendFromKey(clip.backendKey);
    if (!src) {
      toast.error(t("files.transfer.clip.gone"));
      return;
    }
    await this.bringIn(src, clip.paths, destDir, clip.mode);
  }

  // -------------------------------------------------------------------------
  // 나가는 짐 — 다운로드 · 내보내기 · (반대편) 폴더 가져오기
  // -------------------------------------------------------------------------

  /**
   * 고른 것들을 **로컬 폴더로 받는다** — 파일도 폴더도, 하나도 여럿도 같은 길이다
   * (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
   *
   * 대화상자가 묻는 것은 "어디에 저장할까(파일 이름)" 가 아니라 **"어느 폴더에 받을까"** 다 —
   * 여럿을 받을 때 이름을 하나만 묻는 것은 뜻이 되지 않는다. 그 뒤로는 붙여넣기·드롭과
   * **완전히 같은 몸통**을 지나므로 진행률 막대도, [취소] 버튼도, 끝난 뒤의 안내도 같다.
   *
   * **한 번에 하나만** 받는 규칙은 그대로다. 러시-sftp 는 읽기를 파이프라이닝하지 않아
   * 다운로드가 레이턴시에 묶여 있는데(docs/log/2026-09-03-sftp-browser-backend.md 4절),
   * 여러 건을 동시에 걸면 같은 채널에서 서로를 밀어내며 전부 느려지고 진행 막대도 어느
   * 것의 것인지 알 수 없게 된다.
   */
  async startDownload(paths: readonly string[]): Promise<void> {
    const backend = this.#host.backend();
    if (this.#host.offline() || this.busy || !backend.downloadPaths || paths.length === 0) return;
    const dir = await this.#pickFolder(t("files.transfer.pick.download"));
    if (dir === null) return;
    // `src` 가 이 타일 자신이고 길이 `download` 인 것이 이 주문서의 전부다.
    await this.#start(
      { src: backend, paths: [...paths], destDir: dir, mode: "copy", route: "download", outbound: true },
      (p, d) => this.#localConflictsAt(p, d),
    );
  }

  /**
   * **탐색기로 내보내기** — 로컬 타일에서 고른 것을 대화상자로 고른 폴더에 복사한다
   * (docs/log/2026-09-04-native-drag-out.md).
   *
   * `Alt`+드래그(네이티브 끌어내기)가 **못 하는 자리의 대체 길**이다: 네트워크 경로(UNC)와
   * `MAX_PATH` 를 넘는 긴 경로는 셸이 항목을 만들지 못해 플러그인이 패닉하므로 부르기 전에
   * 거절되는데, 그때도 파일을 밖으로 꺼낼 방법은 있어야 한다. 원격 타일의 [다운로드] 와
   * 정확히 같은 짝이고, 그래서 몸통도 같다 — 길만 `same` 이다.
   */
  async exportToFolder(paths: readonly string[]): Promise<void> {
    const backend = this.#host.backend();
    if (this.busy || paths.length === 0 || backend.key !== LOCAL_KEY) return;
    const dir = await this.#pickFolder(t("files.transfer.pick.export"));
    if (dir === null) return;
    await this.#start(
      { src: backend, paths: [...paths], destDir: dir, mode: "copy", route: "same", outbound: true },
      (p, d) => this.#localConflictsAt(p, d),
    );
  }

  /**
   * **폴더 가져오기** — [탐색기로 내보내기…] 의 정확한 반대 방향.
   *
   * 파일은 탐색기에서 **끌어다 놓으면** 되는데(그 길은 `File` 객체 → `local_write_file`),
   * **폴더는 그 길로 오지 않는다** — 웹 표준 DnD 는 디렉터리를 `File` 로 주지 않는다.
   * 그래서 폴더만은 대화상자로 경로를 받아 평범한 `local_copy` 를 탄다. 몸통은 붙여넣기와
   * 같은 [`bringIn`] 이라 충돌 대화상자·진행률·[취소]·끝난 뒤 선택이 저절로 같다.
   *
   * 받을 폴더는 **부르는 쪽이 정한다** — 예전에는 언제나 지금 폴더(`cwd`)였지만, 트리 보기에서는
   * 고른 줄의 폴더가 대상이다 (docs/log/2026-09-25-file-tree-view.md 의 "대상 폴더").
   */
  async importFolders(destDir: string): Promise<void> {
    const backend = this.#host.backend();
    if (this.busy || backend.key !== LOCAL_KEY || !this.#host.hasCwd() || backend.isSyntheticRoot(destDir)) return;
    let picked: string | string[] | null;
    try {
      picked = await openDialog({ directory: true, multiple: true, title: t("files.transfer.pick.import") });
    } catch (e) {
      this.#host.setError(this.#host.failureOf(e));
      return;
    }
    const dirs = typeof picked === "string" ? [picked] : (picked ?? []);
    if (dirs.length === 0) return;
    await this.bringIn(backend, dirs, destDir, "copy");
  }

  /** 진행 중인 전송을 취소한다 — 깃발만 세우고 돌아온다 (멈추는 것은 다음 청크에서) */
  async cancelJob(): Promise<void> {
    const current = this.#job;
    if (!current || current.op === 0 || current.canceling) return;
    this.#job = { ...current, canceling: true };
    try {
      await this.#host.backend().cancel(current.op);
    } catch (e) {
      this.#host.setError(this.#host.failureOf(e));
    }
  }

  /** 충돌 대화상자에서 정책을 골랐다 */
  async resolveConflicts(policy: OnConflict): Promise<void> {
    const p = this.#pending;
    this.#pending = null;
    if (!p) return;
    await this.#runPlan(p, policy);
  }

  // -------------------------------------------------------------------------
  // 안쪽
  // -------------------------------------------------------------------------

  /** OS 폴더 선택 — 취소하거나 실패하면 `null` (실패는 그 자리에 오류 줄로 남긴다) */
  async #pickFolder(title: string): Promise<string | null> {
    try {
      const dir = await openDialog({ directory: true, multiple: false, title });
      return typeof dir === "string" ? dir : null;
    } catch (e) {
      this.#host.setError(this.#host.failureOf(e));
      return null;
    }
  }

  /**
   * 붙여넣기 **전에** 부딪힐 것을 묻는다.
   *
   * 같은 백엔드면 백엔드의 사전 조회 명령을 그대로 쓴다 (제자리 붙여넣기를 충돌로 세지
   * 않는 규칙까지 그쪽에 있다). **다른 백엔드면 그 명령을 쓸 수 없다** — `sftp_conflicts`
   * 에 `C:\a\b` 를 넘기면 그것을 원격 경로로 읽는다. 그래서 이름만 뽑아 목적지 목록과
   * 맞춰 본다: 왕복 하나가 늘지만, 물어볼 질문은 어차피 최상위 이름들뿐이다.
   */
  async #conflictsOf(
    src: FsBackend,
    paths: readonly string[],
    destDir: string,
  ): Promise<Conflict[]> {
    const backend = this.#host.backend();
    if (src.key === backend.key) return backend.conflicts(paths, destDir);
    return namesIn(backend, paths, destDir);
  }

  /**
   * 받을 **로컬 폴더**에 같은 이름이 이미 있는가 — 위 "다른 백엔드" 갈래와 같은 방법이다.
   *
   * 백엔드의 사전 조회 명령(`backend.conflicts`)을 못 쓰는 이유는 그것이 **이 타일의**
   * 백엔드, 즉 원격에게 묻기 때문이다 — 여기서 알아야 하는 것은 내 디스크의 사정이다.
   */
  async #localConflictsAt(paths: readonly string[], destDir: string): Promise<Conflict[]> {
    const local = backendFromKey(LOCAL_KEY);
    if (!local) return [];
    return namesIn(local, paths, destDir);
  }

  /**
   * 주문서 하나를 **띄운다** — 충돌을 먼저 묻고, 없으면 곧바로 `"fail"` 정책으로 실행한다.
   *
   * 부딪히는 것을 어떻게 묻는지는 길마다 다르므로(목적지가 이 타일인가 대화상자로 고른
   * 폴더인가) 그 조회만 인자로 받는다. 나머지 — 겹침 방지·대화상자·실행 — 는 한 벌이다.
   */
  async #start(
    move: Move,
    findConflicts: (paths: readonly string[], destDir: string) => Promise<Conflict[]>,
  ): Promise<void> {
    // 전송·확인이 이미 걸려 있으면 새 것을 겹치지 않는다 — 막대가 하나라 두 전송이 겹치면
    // 어느 것의 진행률인지 알 수 없고, 취소 버튼도 어느 쪽을 멈추는지 말할 수 없다.
    if (this.busy) {
      toast.error(t("files.transfer.busy"));
      return;
    }
    this.#host.setError(null);
    let found: Conflict[];
    try {
      found = await findConflicts(move.paths, move.destDir);
    } catch (e) {
      this.#host.setError(this.#host.failureOf(e));
      return;
    }
    if (found.length > 0) {
      this.#pending = { ...move, conflicts: found };
      return;
    }
    await this.#runPlan(move, "fail");
  }

  /**
   * 실제로 옮긴다 — 진행률·취소·끝난 뒤 선택·양쪽 타일 새로고침까지.
   *
   * ## 잘라내기는 **어디로 가든 진짜 이동**이다
   *
   * 백엔드의 이동 셋은 **항목 단위**로 걸음을 끊어, 항목 하나가 목적지에 완전히 놓인 뒤에만
   * 그 원본을 지운다. 그래서 중간에 멈춰도 "앞의 N개는 옮겨졌고 나머지는 손대지 않았다" 가
   * 언제나 참이고, 그 사실이 백엔드 오류 문구("N개 이동 완료, M번째에서 중단")에 실려 온다 —
   * 우리는 그 문구를 **그대로** 세운다.
   *
   * ## 원본 타일도 다시 읽는다
   *
   * 이동은 두 자리를 바꾼다. 목적지는 이 타일이라 아래에서 스스로 읽지만, 원본은 **다른
   * 타일**이라 알려 줄 길이 필요하다 (`notifyFsRefresh`). 실패·취소에도 알린다 — 그때가
   * 오히려 "몇 개는 이미 옮겨졌다" 인 순간이라 원본 목록이 가장 낡아 있다.
   */
  async #runPlan(move: Move, policy: OnConflict): Promise<void> {
    const backend = this.#host.backend();
    const { src, paths, destDir, mode, route, outbound } = move;
    const op = nextOp();
    const labelKey = routeLabel(route, mode);
    // 같은 곳 안의 이동에만 진행률도 취소도 없다 (이름 바꾸기 한 번이라 멈출 청크 경계가
    // 없다). 다른 곳 사이의 이동은 바이트가 실제로 흐르므로 막대도 [취소] 도 붙는다.
    const rename = route === "same" && mode === "cut";
    this.#job = {
      op: rename ? 0 : op,
      labelKey,
      filesDone: 0,
      filesTotal: paths.length,
      bytesDone: 0,
      bytesTotal: 0,
      current: "",
      canceling: false,
    };
    const onProgress = (p: TransferProgress) => {
      // 번호가 다르면 남의 전송이다 (겹칠 일은 없지만, 겹쳤을 때 막대가 뒤섞이지 않게).
      const j = this.#job;
      if (j && j.op === p.op) this.#job = { ...j, ...p, labelKey, canceling: j.canceling };
    };

    let made: string[] | null = null;
    let failure: string | null = null;
    try {
      if (route === "same") {
        made = rename
          ? await backend.move(paths, destDir, policy)
          : await backend.copy(paths, destDir, policy, op, onProgress);
      } else if (route === "upload") {
        made = mode === "cut"
          ? ((await backend.uploadPathsMove?.(paths, destDir, policy, op, onProgress)) ?? null)
          : ((await backend.uploadPaths?.(paths, destDir, policy, op, onProgress)) ?? null);
      } else if (route === "download") {
        // 다운로드는 **출발지 쪽** 명령이다 — 로컬 백엔드에는 세션이 없어 내려받을 문이 없다.
        made = mode === "cut"
          ? ((await src.downloadPathsMove?.(paths, destDir, policy, op, onProgress)) ?? null)
          : ((await src.downloadPaths?.(paths, destDir, policy, op, onProgress)) ?? null);
      } else {
        made = mode === "cut"
          ? ((await backend.moveFromRemote?.(src, paths, destDir, policy, op, onProgress)) ?? null)
          : ((await backend.copyFromRemote?.(src, paths, destDir, policy, op, onProgress)) ?? null);
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      this.#job = null;
    }

    // 원본 타일에게 "낡았다" 고 알린다 — **이동에만**(복사는 원본이 그대로다). 성공이든
    // 실패든 취소든 알리는 이유는 위 머리말 그대로다. 내 신호는 내가 소비한다.
    if (mode === "cut") this.#host.consumeSignal(notifyFsRefresh(src.key));

    // 취소는 오류가 아니다 — 사용자가 시킨 일이 시킨 대로 됐다. 다만 **목록은 다시 읽는다**:
    // 이미 끝난 파일은 그대로 남아 있으므로 화면이 그것을 보여 줘야 한다.
    if (failure !== null && isTransferCanceled(failure)) {
      this.#host.notice(t("files.transfer.canceled"));
      if (!outbound) await this.#host.reload(this.#host.selPaths());
      return;
    }
    if (failure !== null) {
      // **다시 읽은 다음에** 오류를 세운다 — `load` 는 시작할 때 `error` 를 비우므로
      // 순서를 뒤집으면 방금 적은 실패 문구가 그 자리에서 지워진다.
      if (!outbound) await this.#host.reload(this.#host.selPaths());
      this.#host.setError(failure);
      return;
    }

    const landed = made ?? [];
    // 붙여넣기가 이 폴더로 온 것이면 방금 놓인 것들을 골라 둔다. 하위 폴더에 놓았으면
    // 그 경로는 이 목록에 없으므로 정리 효과가 조용히 떨어낸다 (= 선택이 비워진다).
    if (!outbound) await this.#host.reload(landed);
    // 나가는 전송이 바꾼 것은 **대화상자로 고른 로컬 폴더**다 (다운로드도 내보내기도).
    // 그 폴더를 열어 둔 다른 타일이 있으면 알려 준다 — 내 목록은 안 바뀌었으므로 내 신호는
    // 내가 소비한다.
    if (outbound) this.#host.consumeSignal(notifyFsRefresh(LOCAL_KEY));

    // **옮긴 것이 클립보드에 담겨 있었으면 비운다** — 그 경로들은 이제 그 자리에 없다.
    // 판정을 여기서 하는 이유: 붙여넣기 쪽에서 미리 비우면 충돌 대화상자에서 [취소] 를
    // 눌렀을 때 담아 둔 것이 사라진다.
    const clip = fsClip();
    if (
      mode === "cut" &&
      clip !== null &&
      clip.mode === "cut" &&
      clip.backendKey === src.key &&
      paths.every((p) => clip.paths.includes(p))
    ) {
      clearFsClip();
    }

    // 완료는 **성공의 결**로 (거절·실패는 `toast.error`, 사실 전달은 `notice`).
    // 어디에 놓았는지가 안내의 절반이다 (고른 폴더는 화면 어디에도 안 남는다).
    const text = outbound
      ? t(route === "download" ? "files.transfer.done.out.download" : "files.transfer.done.out.export", {
          count: landed.length,
          dir: destDir,
        })
      : t(routeDoneLabel(route, mode), { count: landed.length });
    toast.success(text);
    // 알림 센터의 지난 알림 — 큰 전송은 끝나기 전에 다른 일로 넘어가 있기 쉽다
    // (docs/log/2026-09-25-notification-center.md).
    recordNotification({ kind: "transfer", text, level: "success" });
  }
}

/** 목적지 폴더를 한 번 읽고 **이름으로** 맞춰 본다 — 백엔드가 다를 때의 유일한 방법 */
async function namesIn(
  where: FsBackend,
  paths: readonly string[],
  destDir: string,
): Promise<Conflict[]> {
  const names = new Set(paths.map(baseNameOf));
  const list = await where.list(destDir);
  return list
    .filter((e) => names.has(e.name))
    .map((e) => ({ path: e.path, kind: e.kind === "dir" ? ("dir" as const) : ("file" as const) }));
}

export function createTransfers(host: TransferHost): Transfers {
  return new Transfers(host);
}
