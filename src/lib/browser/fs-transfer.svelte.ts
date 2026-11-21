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
import { isDirLike, type SftpEntry } from "$lib/sftp-browser";
import { humanSize, limitLabel } from "$lib/sftp";
import {
  DEVICE_DOWNLOAD_GAP_MS,
  DEVICE_DOWNLOAD_MAX_BYTES,
  deviceDownloadSkip,
  deviceDownloadTooBig,
  deviceTooBigReport,
  saveBlobToDevice,
} from "$lib/browser/device-download";

/**
 * 묶음 전송 엔진 — 붙여넣기 · 드롭 · 다운로드 · 내보내기 · 가져오기가 전부 여기로 모인다
 * (docs/log/2026-09-04-fs-cross-place-move.md). 규칙이 한 벌이어야 여러 길이 조용히 어긋나지 않는다.
 */

/** 전부 읽기 함수다 — 값으로 받으면 한 프레임 낡는다 */
export interface TransferHost {
  backend: () => FsBackend;
  hasCwd: () => boolean;
  offline: () => boolean;
  selPaths: () => string[];
  reload: (keep?: readonly string[]) => Promise<boolean>;
  setError: (message: string | null) => void;
  /** 세션이 사라진 것은 `null` */
  failureOf: (e: unknown) => string | null;
  notice: (message: string) => void;
  /** 목적지가 이 타일이면 어차피 다시 읽으므로 내 신호를 내가 소비해 두 번 읽지 않는다 */
  consumeSignal: (tick: number) => void;
}

interface Move {
  src: FsBackend;
  paths: string[];
  destDir: string;
  mode: FsClipMode;
  route: FsRoute;
  /**
   * 대화상자로 고른 화면 밖 폴더로 보냈다 — 끝나고 이 목록을 다시 읽지 않는다(골라 둔 것만 잃는다).
   * 원격 파일을 로컬 타일에 끌어다 놓은 다운로드는 거짓이다 — 이 목록에 떨어진다.
   */
  outbound: boolean;
}

export interface TransferJob {
  /** `0` 이면 취소할 수 없는 전송(같은 곳 안의 이동 = 이름 바꾸기 한 번)이다 — [취소] 를 그리지 않는다 */
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

  /** 짐을 다시 만들지 않고 이 주문서로 실행한다 — 대화상자 사이에 선택이 바뀌었을 수 있다 */
  get pending(): { conflicts: Conflict[] } | null {
    return this.#pending;
  }

  /** 드롭 · 다운로드가 겹치지 않게 하는 유일한 문 */
  get busy(): boolean {
    return this.#job !== null || this.#pending !== null;
  }

  get percent(): number {
    const j = this.#job;
    return j && j.bytesTotal > 0 ? Math.min(100, Math.round((j.bytesDone / j.bytesTotal) * 100)) : 0;
  }

  dismiss(): void {
    this.#pending = null;
  }

  canReceive(dir: string): boolean {
    const b = this.#host.backend();
    return b.online && this.#host.hasCwd() && !b.isSyntheticRoot(dir);
  }

  // ── 들어오는 짐 ──

  /** 충돌이 없으면 `"fail"` 정책으로 간다 — 그 사이 같은 이름이 생겼으면 조용히 덮지 않고 오류로 멈춘다 */
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
    // 출발지가 끊긴 채로 부르면 "세션을 찾을 수 없습니다" 가 전송 실패로 늦게 도착한다
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

  /** 클립보드는 여기서 비우지 않는다 — 충돌 대화상자에서 [취소] 하면 담아 둔 것이 사라진다(`#runPlan` 이 비운다) */
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

  // ── 나가는 짐 ──

  /**
   * 한 번에 하나만 받는다 — russh-sftp 는 읽기를 파이프라이닝하지 않아 여러 건을 동시에 걸면 같은 채널에서
   * 서로를 밀어내며 전부 느려진다 (docs/log/2026-09-03-sftp-browser-backend.md 4절).
   */
  async startDownload(paths: readonly string[]): Promise<void> {
    const backend = this.#host.backend();
    if (this.#host.offline() || this.busy || !backend.downloadPaths || paths.length === 0) return;
    const dir = await this.#pickFolder(t("files.transfer.pick.download"));
    if (dir === null) return;
    await this.#start(
      { src: backend, paths: [...paths], destDir: dir, mode: "copy", route: "download", outbound: true },
      (p, d) => this.#localConflictsAt(p, d),
    );
  }

  /**
   * 네이티브 끌어내기가 거절되는 자리(UNC · `MAX_PATH` 를 넘는 경로 — 플러그인이 패닉한다)의 대체 길이다
   * (docs/log/2026-09-04-native-drag-out.md).
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

  /** 동시에 읽지 않는다 — 응답이 ws 메시지 하나씩이라 겹치면 관문의 보내기 줄 상한에 걸린다(`device-download.ts`) */
  async downloadToDevice(paths: readonly string[]): Promise<void> {
    const backend = this.#host.backend();
    if (this.#host.offline() || this.busy || paths.length === 0) return;
    this.#host.setError(null);
    const list = [...paths];
    const labelKey: Key = "files.transfer.route.download";
    // 처음부터 세워 두어 파일 사이(`stat` · 틈)에도 `busy` 가 참이다 — 다른 전송이 끼지 않게
    this.#job = {
      op: nextOp(),
      labelKey,
      filesDone: 0,
      filesTotal: list.length,
      bytesDone: 0,
      bytesTotal: 0,
      current: "",
      canceling: false,
    };
    const tooBig: number[] = [];
    let received = 0;
    let canceled = false;
    let failure: { error: unknown } | null = null;

    try {
      for (const path of list) {
        if (this.#job?.canceling) {
          canceled = true;
          break;
        }
        // 메뉴가 본 목록은 낡았을 수 있다
        let entry: SftpEntry;
        try {
          entry = await backend.stat(path);
        } catch (e) {
          failure = { error: e };
          break;
        }
        // lstat 이라 링크의 크기는 링크 자신의 것이다 — 진짜 크기는 첫 진행 메시지의 `bytesTotal` 로 아래에서 본다
        const link = entry.kind === "symlink";
        const skip = deviceDownloadSkip({ dir: isDirLike(entry), link, size: entry.size });
        if (skip === "dir") continue;
        if (skip === "toobig") {
          tooBig.push(entry.size);
          continue;
        }
        const before: TransferJob | null = this.#job;
        if (!before || before.canceling) {
          canceled = true;
          break;
        }
        // [취소]는 지금 파일의 `op` 를 끊고, 고리는 `canceling` 으로 끊긴다
        const op = nextOp();
        this.#job = { ...before, op, filesDone: received, bytesDone: 0, bytesTotal: link ? 0 : entry.size, current: path };
        let lateBig: number | null = null;
        const onProgress = (p: TransferProgress) => {
          const j = this.#job;
          if (!j || j.op !== p.op) return;
          // 파일 수는 묶음의 것을 지킨다 — `readImage` 의 진행은 파일 하나 기준이다
          this.#job = { ...j, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal };
          if (lateBig === null && deviceDownloadTooBig(p.bytesTotal)) {
            lateBig = p.bytesTotal;
            void backend.cancel(op).catch(() => {});
          }
        };

        let bytes: ArrayBuffer;
        try {
          bytes = await backend.readImage(path, op, onProgress);
        } catch (e) {
          // 늦게 안 상한 초과는 우리가 건 취소다 — 건너뛰고 다음으로
          if (lateBig !== null) {
            tooBig.push(lateBig);
            continue;
          }
          const message = e instanceof Error ? e.message : String(e);
          if (isTransferCanceled(message)) canceled = true;
          else failure = { error: e };
          break;
        }
        if (lateBig !== null) {
          tooBig.push(lateBig);
          continue;
        }
        if (received > 0) await new Promise((r) => setTimeout(r, DEVICE_DOWNLOAD_GAP_MS));
        // octet-stream — 그림 · PDF 가 새 탭으로 열리지 않고 받아진다
        saveBlobToDevice(new Blob([bytes], { type: "application/octet-stream" }), baseNameOf(path));
        received += 1;
        const after: TransferJob | null = this.#job;
        if (after) this.#job = { ...after, filesDone: received };
      }
    } finally {
      this.#job = null;
    }

    if (canceled) {
      this.#host.notice(t("files.transfer.canceled"));
      return;
    }
    if (failure !== null) {
      this.#host.setError(this.#host.failureOf(failure.error));
      return;
    }
    const report = deviceTooBigReport(tooBig);
    if (report !== null) {
      this.#host.setError(
        report.kind === "one"
          ? deviceTooBigText(report.size)
          : t("files.transfer.toobig.device.many", {
              count: report.count,
              max: limitLabel(DEVICE_DOWNLOAD_MAX_BYTES),
            }),
      );
    }
    if (received === 0) return;
    const text = t("files.transfer.done.download", { count: received });
    toast.success(text);
    recordNotification({ kind: "transfer", text, level: "success" });
  }

  /** 웹 표준 DnD 는 디렉터리를 `File` 로 주지 않는다 — 폴더만은 대화상자로 경로를 받는다 */
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

  /** 멈추는 것은 다음 청크에서다 */
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

  async resolveConflicts(policy: OnConflict): Promise<void> {
    const p = this.#pending;
    this.#pending = null;
    if (!p) return;
    await this.#runPlan(p, policy);
  }

  // ── 안쪽 ──

  async #pickFolder(title: string): Promise<string | null> {
    try {
      const dir = await openDialog({ directory: true, multiple: false, title });
      return typeof dir === "string" ? dir : null;
    } catch (e) {
      this.#host.setError(this.#host.failureOf(e));
      return null;
    }
  }

  /** 다른 백엔드면 `conflicts` 를 쓸 수 없다 — `sftp_conflicts` 에 `C:\a\b` 를 넘기면 원격 경로로 읽는다 */
  async #conflictsOf(
    src: FsBackend,
    paths: readonly string[],
    destDir: string,
  ): Promise<Conflict[]> {
    const backend = this.#host.backend();
    if (src.key === backend.key) return backend.conflicts(paths, destDir);
    return namesIn(backend, paths, destDir);
  }

  /** `backend.conflicts` 는 이 타일의 백엔드(원격)에게 묻는다 — 여기서 알아야 하는 것은 로컬 디스크다 */
  async #localConflictsAt(paths: readonly string[], destDir: string): Promise<Conflict[]> {
    const local = backendFromKey(LOCAL_KEY);
    if (!local) return [];
    return namesIn(local, paths, destDir);
  }

  async #start(
    move: Move,
    findConflicts: (paths: readonly string[], destDir: string) => Promise<Conflict[]>,
  ): Promise<void> {
    // 막대 · [취소] 가 하나라 두 전송을 겹치지 않는다
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

  /** 백엔드의 이동 오류 문구("N개 이동 완료, M번째에서 중단")는 그대로 세운다 — 항목 단위로 끊으니 그 문구가 참이다 */
  async #runPlan(move: Move, policy: OnConflict): Promise<void> {
    const backend = this.#host.backend();
    const { src, paths, destDir, mode, route, outbound } = move;
    const op = nextOp();
    const labelKey = routeLabel(route, mode);
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
        // 다운로드는 출발지 쪽 명령이다 — 로컬 백엔드에는 세션이 없다
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

    // 원본 타일에게 알린다 — 실패 · 취소에도(그때가 "몇 개는 이미 옮겨졌다" 라 원본 목록이 가장 낡아 있다)
    if (mode === "cut") this.#host.consumeSignal(notifyFsRefresh(src.key));

    // 취소에도 목록은 다시 읽는다 — 이미 끝난 파일은 그대로 남아 있다
    if (failure !== null && isTransferCanceled(failure)) {
      this.#host.notice(t("files.transfer.canceled"));
      if (!outbound) await this.#host.reload(this.#host.selPaths());
      return;
    }
    if (failure !== null) {
      // 다시 읽은 다음에 오류를 세운다 — `load` 는 시작할 때 `error` 를 비운다
      if (!outbound) await this.#host.reload(this.#host.selPaths());
      this.#host.setError(failure);
      return;
    }

    const landed = made ?? [];
    if (!outbound) await this.#host.reload(landed);
    // 나가는 전송이 바꾼 것은 대화상자로 고른 로컬 폴더다 — 그 폴더를 연 다른 타일에 알린다
    if (outbound) this.#host.consumeSignal(notifyFsRefresh(LOCAL_KEY));

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

    const text = outbound
      ? t(route === "download" ? "files.transfer.done.out.download" : "files.transfer.done.out.export", {
          count: landed.length,
          dir: destDir,
        })
      : t(routeDoneLabel(route, mode), { count: landed.length });
    toast.success(text);
    recordNotification({ kind: "transfer", text, level: "success" });
  }
}

function deviceTooBigText(size: number): string {
  return t("files.transfer.toobig.device", { size: humanSize(size), max: limitLabel(DEVICE_DOWNLOAD_MAX_BYTES) });
}

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
