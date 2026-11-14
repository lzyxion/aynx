import { Channel, invoke } from "./ipc";
import { localWatch, type FsWatch } from "./fs-watch";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { editRemoteFile } from "$lib/sftp";
import {
  localConflicts,
  localCopy,
  localMove,
  localRemoveMany,
  localToSftpMove,
  localWriteFile,
  sftpConflicts,
  sftpCopy,
  sftpCopyBetween,
  sftpDownloadPaths,
  sftpMove,
  sftpMoveBetween,
  sftpRemoveMany,
  sftpToLocalMove,
  sftpUploadPaths,
  transferCancel,
  type Conflict,
  type OnConflict,
  type OnProgress,
  type TransferProgress,
} from "$lib/fs-ops";
import {
  crumbsOf as posixCrumbsOf,
  errorOf,
  joinPath as posixJoinPath,
  parentOf as posixParentOf,
  sftpDownload,
  sftpHome,
  sftpList,
  sftpMkdir,
  sftpCreateFile,
  sftpRemove,
  sftpRename,
  sftpStat,
  type SftpEntry,
} from "$lib/sftp-browser";
import { withReason } from "$lib/error-reason";
import { translateNow } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";
import type { Tr } from "$lib/session";

/**
 * **파일 브라우저의 백엔드 어댑터** (docs/log/2026-09-03-local-fs-tile.md).
 *
 * `SftpBrowser.svelte` 는 원격 전용이었다 — `sessionId` 를 받아 `sftp_*` 명령을 직접
 * 불렀다. 로컬 디스크를 같은 화면으로 열려면 그 화면이 "어디에 물어보는가" 를 몰라야
 * 한다. 그래서 명령 묶음과 경로 문법을 **값 하나**([`FsBackend`])로 싸서 프롭으로 넘긴다.
 *
 * ```text
 *                    ┌── remoteBackend(session) ──→ sftp_*   (POSIX 경로, `/`)
 *   SftpBrowser ─────┤
 *                    └── localBackend()          ──→ local_* (윈도우 경로, `\`)
 * ```
 *
 * ## 능력 플래그가 왜 있는가
 *
 * 두 백엔드는 **할 수 있는 일이 다르다**: 로컬에는 업로드·다운로드·원격 편집이 없고
 * (파일이 이미 여기 있다), 원격에는 "기본 앱으로 열기"·"탐색기에서 보기" 가 없다.
 * 화면이 `kind === "localfs"` 같은 종류 검사로 버튼을 켜고 끄면 종류가 하나 늘 때마다
 * 그 검사를 전부 다시 찾아야 하므로, **버튼이 묻는 질문 그대로** 플래그를 둔다
 * (`canUpload`·`canDownload`·`canEdit`·`canOpenExternal`·`canReveal`·`canView`).
 *
 * 플래그와 선택 메서드는 **짝이 맞아야 한다** — 플래그가 참이면 그 메서드가 있어야 한다.
 * 화면은 플래그로 그릴지 말지를 정하고, 부를 때는 `?.` 로 한 번 더 방어한다.
 *
 * ## `key` — 이 백엔드가 "같은 것" 인가
 *
 * 원격 백엔드는 세션 id 를 물고 있고, 재연결하면 **새 세션 id** 가 온다. 브라우저는 그때
 * 보고 있던 경로를 다시 읽어야 하는데, 객체 신원(`===`)으로 판단하면 부모가 리렌더할
 * 때마다 새 객체가 내려와 헛되이 다시 읽는다. 그래서 비교는 이 문자열 하나로 한다
 * (`"ssh:12"` · `"local"`). 재연결 추적의 뜻은 예전 `sessionId` 비교와 정확히 같다.
 */
export interface FsBackend {
  /** **같은 원본인가** 의 비교 키 — 값이 바뀌면 브라우저가 보던 경로를 다시 읽는다 */
  readonly key: string;
  /** 지금 명령을 부를 수 있는가 (원격은 세션이 없으면 거짓, 로컬은 언제나 참) */
  readonly online: boolean;
  /** 경로 구분자 — 화면 문구와 이름 검증이 본다 */
  readonly sep: "/" | "\\";
  /**
   * 이 폴더로 **밖에서 온 파일 내용**을 넣을 수 있는가 — 원격은 업로드, 로컬은 가져오기다.
   *
   * 예전에는 원격에만 참이었다("로컬 타일에서 업로드는 뜻이 없다"). 탐색기에서 로컬 타일로
   * 파일을 끌어다 놓는 길이 생기면서 그 말이 틀어졌다: OS 파일 드롭은 웹 표준 DnD 로
   * 들어와 **경로가 아니라 내용**(`File`)을 주므로 (`dragDropEnabled: false`) 로컬끼리도
   * `local_copy` 가 아니라 바이트를 쓰는 문 하나가 필요하다 ([`uploadBytes`]). 화면은 이
   * 플래그로 그 UI 를 그리고, 글자만 자리에 맞춰 고른다("⬆ 업로드" ↔ "⬆ 가져오기").
   */
  readonly canUpload: boolean;
  /** 파일을 내려받을 수 있는가 (원격만) */
  readonly canDownload: boolean;
  /** 파일을 로컬 편집기로 열어 되올릴 수 있는가 (원격만) */
  readonly canEdit: boolean;
  /** 기본 앱으로 열 수 있는가 (로컬만) */
  readonly canOpenExternal: boolean;
  /** 탐색기에서 보여 줄 수 있는가 (로컬만) */
  readonly canReveal: boolean;
  /**
   * 파일 내용을 **글자로 읽어** 문서 보기 타일에 줄 수 있는가 ([`readText`]) — 지금은 둘 다
   * 참이다. 둘 다 할 수 있는 일인데도 플래그를 두는 것은 뷰어가 이 값 하나만 보고 "미리
   * 보기" 를 켜기 때문이다: 백엔드가 늘 때 그쪽이 못 하면 여기만 거짓으로 두면 된다.
   * 세션이 없는 원격(`online === false`)에서도 참이다 — 다른 플래그와 같이 **능력**을 말하고
   * 지금 부를 수 있는지는 `online` 이 말한다(부르면 `[session-gone]` 으로 실패한다).
   */
  readonly canView: boolean;
  /**
   * 문서 편집 타일이 **저장할 수 있는가** ([`writeText`]) — 지금은 둘 다 참이다
   * (docs/log/2026-09-27-doc-edit.md "R — 저장 명령"). `canView` 와 같이 **능력**이고, 지금
   * 부를 수 있는지는 `online` 이 말한다(세션 없는 원격은 `[session-gone]` 으로 실패한다).
   */
  readonly canWrite: boolean;

  /**
   * 최상위 뿌리 목록 — **로컬만**(`["C:\\", "D:\\"]`), 원격은 `null` 이다.
   * 로컬의 `list("")`(= "내 PC")가 이것으로 목록을 짓는다.
   */
  roots(): Promise<string[]> | null;
  /**
   * 이 경로가 **합성 루트**("내 PC")인가 — 로컬의 `""` 하나뿐이고 원격은 언제나 거짓.
   * 거기에는 만들 자리도 지울 것도 없으므로 화면이 그 조작들을 끈다.
   */
  isSyntheticRoot(path: string): boolean;

  home(): Promise<string>;
  /**
   * **장소 패널의 붙박이 자리** (docs/log/2026-10-07-file-tile-dolphin.md) — 로컬은 OS 가 알려 주는 홈 · 바탕 화면 ·
   * 문서 · 다운로드(Rust `local_places`), 원격은 홈(`~`) · `/`. 실패하면 빈 목록이다(패널이 그 무리를 접는다).
   */
  places(): Promise<BackendPlace[]>;
  /**
   * 이 경로가 사는 볼륨의 **남은 공간** — 모르면 `null`(상태 줄·장소 패널이 그 칸을 숨긴다). 로컬은 Rust 의 OS 함수
   * 하나(`fs_space::disk_space` — 아직 Windows 만, 나머지 OS 는 명시적 스텁), 원격은 서버가 `statvfs@openssh.com`
   * 확장을 알릴 때만. **던지지 않는다** — 못 읽은 것은 모르는 것과 같다.
   */
  freeSpace(path: string): Promise<DiskSpace | null>;
  list(path: string): Promise<SftpEntry[]>;
  stat(path: string): Promise<SftpEntry>;
  mkdir(path: string): Promise<string>;
  /** 빈 파일 하나를 만든다(파일 타일의 [새 파일…]) — 이미 있으면 `[exists]` 로 거절하고 덮어쓰지 않는다. 돌려주는 값은 만들어진 절대 경로 */
  createFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<string>;
  remove(path: string, recursive: boolean): Promise<void>;

  // ── 묶음 작업 (docs/log/2026-09-04-fs-batch-ops-backend.md) ────────────────
  //
  // 이 넷에는 능력 플래그가 없다 — **두 백엔드가 모두 할 수 있는 일**이라 물어볼 질문이
  // 없기 때문이다 (`canUpload` 처럼 한쪽에만 있는 것에만 플래그를 둔다는 규칙 그대로다).
  // 그래서 옵셔널도 아니다: 백엔드가 하나 늘면 이 넷을 반드시 채워야 화면이 그대로 돈다.

  /** 여럿을 이 폴더로 **복사**. 돌려주는 값은 실제로 놓인 자리들(이름이 밀렸으면 밀린 이름) */
  copy(
    paths: readonly string[],
    destDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  /** 여럿을 이 폴더로 **이동**. 이름 바꾸기 한 번이라 진행률도 취소도 없다 */
  move(paths: readonly string[], destDir: string, onConflict: OnConflict): Promise<string[]>;
  /** 여럿을 지운다 — **첫 실패에서 멈추고** 어디까지 했는지를 오류에 싣는다 */
  removeMany(paths: readonly string[], recursive: boolean): Promise<void>;
  /** 붙여넣기 **전에** 부딪힐 것을 묻는다 (최상위 항목만) */
  conflicts(paths: readonly string[], destDir: string): Promise<Conflict[]>;
  /** 전송 하나를 취소한다 — 번호는 프런트가 정한 `op` (없는 번호도 성공) */
  cancel(op: number): Promise<void>;

  // ── 서로 다른 곳 사이 (docs/log/2026-09-04-fs-batch-ops-backend.md "후속") ──────
  //
  // 넷 다 **원격 백엔드에만** 있다. 이유는 명령이 사는 곳이 그쪽이기 때문이다: 로컬끼리는
  // 애초에 백엔드가 하나뿐이고(`copy`/`move` 로 끝난다), 로컬↔원격도 서버 사이도 세션이
  // 있어야 부를 수 있는 명령이다.
  //
  // 방향에 따라 **누가 부르는지가 다르다**. 목적지가 원격이면 목적지가 부르고
  // (`copyFromRemote`·`moveFromRemote`·`uploadPathsMove`), 목적지가 로컬이면 출발지가
  // 부른다(`downloadPathsMove`) — 기존 `downloadPaths` 가 출발지 쪽 메서드인 것과 같은
  // 사정이다 (로컬 백엔드에는 세션이 없어 내려받을 문이 없다).

  /** 다른 **원격**의 경로들을 이 원격 폴더로 복사 (원격만) */
  copyFromRemote?(
    from: FsBackend,
    paths: readonly string[],
    destDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  /** 다른 **원격**의 경로들을 이 원격 폴더로 **이동** (항목 단위 — 하나가 놓인 뒤 그 원본 삭제) */
  moveFromRemote?(
    from: FsBackend,
    paths: readonly string[],
    destDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  /** 로컬 경로들을 이 원격 폴더로 **이동** (원격만 — `uploadPaths` 의 이동판) */
  uploadPathsMove?(
    localPaths: readonly string[],
    remoteDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  /** 이 원격의 경로들을 로컬 폴더로 **이동** (원격만 — `downloadPaths` 의 이동판) */
  downloadPathsMove?(
    remotePaths: readonly string[],
    localDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;

  /** 로컬 **경로들**을 이 원격 폴더로 (원격만 — `canUpload`) */
  uploadPaths?(
    localPaths: readonly string[],
    remoteDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  /** 원격 경로들을 로컬 폴더로 (원격만 — `canDownload`) */
  downloadPaths?(
    remotePaths: readonly string[],
    localDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;

  /**
   * **파일 내용 하나를 이 폴더에 쓴다** (로컬만 — `canUpload` 의 로컬 갈래).
   *
   * 원격의 짝은 `uploadFile`(`sftp.ts`)인데 그쪽은 세션을 받으므로 이 계약에 들어오지
   * 않는다 — 업로드 모달이 목적지 종류를 보고 둘 중 하나를 부른다.
   *
   * 돌려주는 값은 **실제로 놓인 경로**(정책이 `"rename"` 이면 밀린 이름), 건너뛰었으면 `null`.
   */
  uploadBytes?(destDir: string, file: File, onConflict: OnConflict, tr: Tr): Promise<string | null>;

  /** 파일 하나를 로컬 경로로 (원격만). 흐르는 값은 **받은 누적 바이트** */
  download?(remote: string, local: string, onBytes: (received: number) => void): Promise<number>;
  /** 로컬 편집기로 열고 저장을 감시한다 (원격만). 돌려주는 값은 안내에 쓸 파일 이름 */
  edit?(path: string): Promise<string>;
  /** OS 기본 앱으로 (로컬만) */
  openExternal?(path: string): Promise<void>;
  /** 탐색기에서 그 항목을 골라 보여 준다 (로컬만) */
  reveal?(path: string): Promise<void>;
  /**
   * 파일 하나를 **바이트 그대로** — 미리 보기 패널의 그림 (docs/log/2026-10-07-file-tile-dolphin.md "10"). 두 백엔드 모두
   * 있다(능력 플래그 없음). Rust 가 원시 바이트(`ipc::Response`)로 돌려주고 화면은 Blob URL 로 그린다 — 자산 프로토콜의
   * 허용 범위를 넓히지 않는 길이다. 상한(`browser/preview.ts` 의 `PREVIEW_MAX_BYTES`)을 넘거나 폴더면 실패한다.
   */
  readPreview(path: string): Promise<ArrayBuffer>;
  /**
   * **이미지 타일**의 큰 그림 한 장(2026-11-14) — [`readPreview`] 와 같은 원시 바이트이되 상한이 `image/read-plan.ts` 의 `IMAGE_MAX_BYTES`
   * (Rust `text_file::IMAGE_MAX_BYTES`)이고, 조각마다 진행률(`TransferProgress` — 파일 1 · 누적 바이트)을 `onProgress` 로 흘린다.
   * 취소는 같은 `op` 로 [`cancel`] — 백엔드가 다음 조각에서 멈추고 `[cancelled]` 로 실패한다. 두 백엔드 모두 있다(능력 플래그 없음).
   */
  readImage(path: string, op: number, onProgress: OnProgress | null): Promise<ArrayBuffer>;
  /** 파일 하나를 글자로 — 앞 2 MiB 까지 (`canView`). 폴더면 실패한다 */
  readText?(path: string): Promise<TextFile>;
  /**
   * 파일 하나를 이 글로 **저장** (`canWrite`). `expectedVersion` 이 있으면 디스크의 지금
   * version 이 그와 같을 때만 쓴다 — 다르면 `[conflict]`, 파일이 없으면 `[missing]`
   * (`$lib/error-reason`). `null` 은 사용자가 [덮어쓰기] 를 누른 강제 저장뿐이다.
   * 심링크면 대상 파일에 쓰고, 같은 폴더 임시 파일 → rename 으로 교체한다(권한은 원본 것).
   * 돌려주는 `version` 은 새 내용의 것 — 다음 저장의 `expectedVersion` 이다.
   */
  writeText?(path: string, text: string, expectedVersion: string | null): Promise<SavedFile>;
  /**
   * **보이는 폴더의 바뀜을 알려 달라** — 자동 새로고침(docs/log/2026-10-21-file-tile-auto-refresh.md). 로컬만(OS 변경 알림 ·
   * Rust `local_watch.rs`) — 원격은 없다(원격 파일 타일은 ⟳ 로만 읽는다 — 폴링도 신호도 없다).
   * 능력 플래그가 따로 없는 이유: 화면이 이것으로 그리는 것이 없고, 있으면 쓰고 없으면 감시 없이 선다.
   */
  watch?(onChange: (dirs: string[]) => void): FsWatch;

  /** 상위 디렉터리 — **더 갈 곳이 없으면 자기 자신**을 돌려준다 (화면의 ↑ 비활성 판정) */
  parentOf(path: string): string;
  joinPath(dir: string, name: string): string;
  crumbsOf(path: string): Crumb[];
}

/**
 * 문서 보기의 **읽기 상한** — 두 읽기 명령이 앞에서 이만큼만 읽는다. Rust `text_file::VIEW_MAX_BYTES` 의 짝이라
 * 그쪽이 바뀌면 여기도 고친다(잘림 띠의 "앞 N 만 표시" 가 이 값을 파일 목록과 같은 `formatSize` 로 적는다).
 */
export const TEXT_VIEW_MAX_BYTES = 2 * 1024 * 1024;

/**
 * **문서 보기 타일이 받는 파일 한 장** — Rust `text_file::TextFile` 의 짝(serde camelCase).
 *
 * 두 백엔드(`local_read_text` · `sftp_read_text`)가 같은 모양을 준다. 큰 파일은 **앞 2 MiB 만**
 * 읽혀 오고 `truncated` 가 참이다.
 */
export interface TextFile {
  /** UTF-8 로 푼 내용 (아닌 바이트는 대체 문자). `binary` 면 `""` */
  text: string;
  /** 파일 **전체** 크기 (바이트) — 잘렸으면 `text` 보다 크다 */
  size: number;
  /** 앞 2 MiB 에서 잘렸는가 */
  truncated: boolean;
  /** 앞 8 KiB 에 NUL 이 있었다 — 보여 주지 않는다 */
  binary: boolean;
  /** UTF-8 이 아닌 바이트가 있었다 (대체 문자로 바뀌었다) */
  lossy: boolean;
  /** 충돌 확인 키 — **불투명**하다. 같은지 비교만 한다 (2단계 저장이 쓴다) */
  version: string;
}

/** 저장이 돌려주는 값 — Rust `text_file::SavedFile` 의 짝. `version` 은 [`TextFile.version`] 과 같은 계산이다 */
export interface SavedFile {
  version: string;
  size: number;
}

/** 볼륨의 크기 — 바이트. Rust `fs_space::DiskSpace` 의 짝(`free` 는 이 사용자가 쓸 수 있는 만큼) */
export interface DiskSpace {
  free: number;
  total: number;
}

/**
 * 장소 패널의 붙박이 자리 하나 — Rust `local_browser::LocalPlace` 의 짝(원격은 어댑터가 짓는다). 이름은 종류로 사전을
 * 찾고(`browser/places.ts`), 백엔드가 이름을 정해 보내면(`label` — 원격의 `~` · `/`) 그것이 이긴다.
 */
export interface BackendPlace {
  kind: "home" | "desktop" | "documents" | "downloads" | "root";
  path: string;
  label?: string;
}

/** 빵부스러기 한 조각 */
export interface Crumb {
  label: string;
  path: string;
  /**
   * 합성 루트의 문구 키 (`내 PC`) — 있으면 `label` 대신 이것을 그린다. 그때 `label` 은 비어
   * 있다.
   *
   * 조각 대부분은 경로 조각 그대로라 번역할 것이 없다. 뿌리 하나만 앱이 지어낸 말이고,
   * 이 파일은 룬을 들이지 않는 순수 모듈이라 키만 실어 보낸다 (`LocationBar.svelte` 가 푼다).
   */
  labelKey?: Key;
}

/**
 * 이 이름을 **파일 이름 한 조각**으로 쓸 수 있는가 (못 쓰면 **문구 키**, 되면 `null`).
 *
 * 백엔드마다 금지 글자가 다르다 — 유닉스는 `/` 하나뿐이지만 윈도우는 `\ / : * ? " < > |`
 * 전부다. 화면이 미리 막는 이유는 그중 몇몇(`:` · `\`)이 백엔드에서 **경로로 해석되어**
 * "이름 바꾸기" 가 조용히 "다른 자리로 옮기기" 가 되기 때문이다.
 *
 * 판정의 근거가 `sep` 하나인 것이 요점이다: 경로 구분자가 곧 그 백엔드의 문법이므로,
 * 백엔드가 늘어도 이 함수는 그대로다.
 */
export function nameError(name: string, sep: string): Key | null {
  if (sep === "\\") {
    return /[\\/:*?"<>|]/.test(name) ? "files.ops.name.windows" : null;
  }
  return name.includes("/") ? "files.ops.name.posix" : null;
}

// ---------------------------------------------------------------------------
// 윈도우 경로 문법 — POSIX 판(`sftp-browser.ts`)의 짝
//
// 순수 함수다. 로컬 백엔드가 쓰지만 따로 export 하는 이유는 **문법이 곧 계약**이라
// 눈으로 확인할 수 있어야 하기 때문이다 (드라이브 뿌리·UNC 공유·구분자 방향).
// ---------------------------------------------------------------------------

/** 이 경로의 UNC 공유 뿌리(`\\server\share`) — UNC 가 아니면 `null` */
function uncRootOf(path: string): string | null {
  const m = /^\\\\([^\\]+)\\([^\\]+)/.exec(path);
  return m ? `\\\\${m[1]}\\${m[2]}` : null;
}

/**
 * 들어온 경로를 **하나의 모양**으로 맞춘다 — 백엔드가 `/` 와 `\` 를 모두 받지만
 * (docs/log/2026-09-03-local-fs-backend.md 4절) 화면은 한 벌로만 비교·표시해야 한다.
 *
 * ```text
 *   "C:/Users/wl/"   → "C:\Users\wl"
 *   "C:"             → "C:\"          (드라이브 문자만 오면 그 뿌리다)
 *   "C:\"            → "C:\"          (뿌리의 꼬리 구분자는 남긴다)
 *   "//srv/share/x"  → "\\srv\share\x"
 *   ""               → ""             (합성 루트 = 내 PC)
 * ```
 */
export function winNormalize(path: string): string {
  const raw = path.trim();
  if (raw === "") return "";
  const unc = /^[\\/]{2}[^\\/]/.test(raw);
  // 구분자를 `\` 하나로 접는다. UNC 의 앞 두 개도 함께 접히므로 뒤에서 되살린다.
  let out = raw.replace(/[\\/]+/g, "\\");
  if (unc) out = `\\${out}`;
  if (/^[A-Za-z]:$/.test(out)) return `${out}\\`;
  if (out.length > 1 && out.endsWith("\\") && !/^[A-Za-z]:\\$/.test(out)) {
    out = out.replace(/\\+$/, "");
  }
  return out;
}

/**
 * 상위 디렉터리. **드라이브 뿌리(`C:\`)와 UNC 공유 뿌리의 위는 `""`(내 PC)** 다 —
 * 거기가 이 브라우저의 꼭대기다. `""` 의 부모는 자기 자신이다 (더 갈 곳이 없다).
 *
 * 공유 뿌리에서도 내 PC 로 올라가는 것은, 서버의 공유 목록을 읽는 명령이 백엔드에 없어
 * 중간 층을 그릴 수 없기 때문이다 — 갈 곳 없이 ↑ 를 죽여 두는 것보다 낫다.
 */
export function winParentOf(path: string): string {
  const p = winNormalize(path);
  if (p === "") return "";
  if (/^[A-Za-z]:\\$/.test(p)) return "";
  const unc = uncRootOf(p);
  if (unc !== null && unc === p) return "";
  const at = p.lastIndexOf("\\");
  if (at < 0) return "";
  const head = p.slice(0, at);
  if (/^[A-Za-z]:$/.test(head)) return `${head}\\`;
  if (unc !== null && head.length < unc.length) return unc;
  return head === "" ? "" : head;
}

/** `"C:\a"` + `"b"` → `"C:\a\b"` (드라이브 뿌리에서도 `\\` 가 겹치지 않게) */
export function winJoinPath(dir: string, name: string): string {
  const base = winNormalize(dir);
  if (base === "") return winNormalize(name);
  return base.endsWith("\\") ? `${base}${name}` : `${base}\\${name}`;
}

/**
 * 빵부스러기 — 언제나 **내 PC** 부터다: `내 PC › C: › Users › you`.
 * UNC 는 공유 전체가 한 조각이다: `내 PC › \\srv\share › x`.
 */
export function winCrumbsOf(path: string): Crumb[] {
  const out: Crumb[] = [{ label: "", path: "", labelKey: "files.browser.mypc" }];
  const p = winNormalize(path);
  if (p === "") return out;

  const unc = uncRootOf(p);
  let head: string;
  if (unc !== null) {
    head = unc;
    out.push({ label: unc, path: unc });
  } else {
    const drive = /^([A-Za-z]:)/.exec(p);
    if (!drive) return out; // 모양을 못 알아보면 뿌리만 (상대 경로는 백엔드가 이미 거절한다)
    head = `${drive[1]}\\`;
    out.push({ label: drive[1], path: head });
  }

  let at = head;
  for (const seg of p.slice(head.length).split("\\")) {
    if (seg === "") continue;
    at = at.endsWith("\\") ? `${at}${seg}` : `${at}\\${seg}`;
    out.push({ label: seg, path: at });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 로컬 명령 여덟 개 — `local_*` 의 얇은 래퍼 (`sftp-browser.ts` 와 같은 규칙:
// 타입 붙이기와 오류 정규화만 하고 **실패를 삼키지 않는다**)
// ---------------------------------------------------------------------------

async function localHome(): Promise<string> {
  try {
    return await invoke<string>("local_home");
  } catch (e) {
    throw errorOf(e, "files.ops.fail.home");
  }
}

async function localPlaces(): Promise<BackendPlace[]> {
  try {
    return await invoke<BackendPlace[]>("local_places");
  } catch (e) {
    console.warn("[aynx] 장소 패널의 붙박이 폴더를 읽지 못했습니다 (무시):", e);
    return [];
  }
}

/** 남은 공간 — 로컬 · 원격 공용 꼴. 실패는 `null`(모르는 것과 같다 — `FsBackend.freeSpace`) */
async function freeSpaceOf(command: string, args: Record<string, unknown>): Promise<DiskSpace | null> {
  try {
    return (await invoke<DiskSpace | null>(command, args)) ?? null;
  } catch {
    return null;
  }
}

async function localRoots(): Promise<string[]> {
  try {
    return await invoke<string[]>("local_roots");
  } catch (e) {
    throw errorOf(e, "files.ops.fail.roots");
  }
}

async function localList(path: string): Promise<SftpEntry[]> {
  try {
    return await invoke<SftpEntry[]>("local_list", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.list", { path });
  }
}

async function localStat(path: string): Promise<SftpEntry> {
  try {
    return await invoke<SftpEntry>("local_stat", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.stat", { path });
  }
}

async function localMkdir(path: string): Promise<string> {
  try {
    return await invoke<string>("local_mkdir", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.mkdir", { path });
  }
}

async function localCreateFile(path: string): Promise<string> {
  try {
    return await invoke<string>("local_create_file", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.mkdir", { path });
  }
}

async function localRename(from: string, to: string): Promise<string> {
  try {
    return await invoke<string>("local_rename", { from, to });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.rename", { path: from });
  }
}

async function localRemove(path: string, recursive: boolean): Promise<void> {
  try {
    await invoke("local_remove", { path, recursive });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.remove", { path });
  }
}

async function localReadPreview(path: string): Promise<ArrayBuffer> {
  try {
    return await invoke<ArrayBuffer>("local_read_preview", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

/** 원격 파일 하나를 바이트로 — 로컬 짝([`localReadPreview`])과 같은 모양 */
async function sftpReadPreview(session: number, path: string): Promise<ArrayBuffer> {
  try {
    return await invoke<ArrayBuffer>("sftp_read_preview", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

/**
 * 큰 그림 한 장을 조각으로 — 로컬 · 원격 공용 몸통(진행률 채널은 늘 만든다: 백엔드가 그 인자를 필수로 받는다).
 * 실패는 감싸되 `[cancelled]` · `[session-gone]` 표식은 문구에 남는다(`errorOf` 는 백엔드 문구를 그대로 싣는다).
 */
async function readImageVia(command: string, args: Record<string, unknown>, path: string, onProgress: OnProgress | null): Promise<ArrayBuffer> {
  const channel = new Channel<TransferProgress>();
  if (onProgress) channel.onmessage = (p) => onProgress(p);
  try {
    return await invoke<ArrayBuffer>(command, { ...args, path, onProgress: channel });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

async function localReadText(path: string): Promise<TextFile> {
  try {
    return await invoke<TextFile>("local_read_text", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

/** 원격 파일 하나를 글자로 — 로컬 짝([`localReadText`])과 같은 모양이라 여기 함께 둔다 */
async function sftpReadText(session: number, path: string): Promise<TextFile> {
  try {
    return await invoke<TextFile>("sftp_read_text", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

/**
 * 저장 실패는 **감싸지 않고 그대로** 던진다 — `[conflict]`·`[missing]`·`[session-gone]` 표식이
 * 문구에 남아 있어야 화면이 `hasReason` 으로 갈래를 가른다 (`errorOf` 는 백엔드 문구를 그대로
 * 싣는다). 문구 앞머리 "저장하지 못했습니다" 는 백엔드 문구가 이미 말한다.
 */
async function localWriteText(path: string, text: string, expectedVersion: string | null): Promise<SavedFile> {
  try {
    return await invoke<SavedFile>("local_write_text", { path, text, expectedVersion });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.write", { name: baseNameOf(path) });
  }
}

/** 원격 저장 — 로컬 짝([`localWriteText`])과 같은 모양 */
async function sftpWriteText(
  session: number,
  path: string,
  text: string,
  expectedVersion: string | null,
): Promise<SavedFile> {
  try {
    return await invoke<SavedFile>("sftp_write_text", { session, path, text, expectedVersion });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.write", { name: baseNameOf(path) });
  }
}

/**
 * 드라이브 뿌리 하나를 목록 한 줄로. **크기·시각·권한은 모른다** — 지어내지 않고
 * 비워 두면 화면이 `—` 로 접는다 (`mode === null` 이 권한 칸을 접는 것과 같은 규칙).
 */
function rootEntry(root: string): SftpEntry {
  return {
    name: root.replace(/[\\/]+$/, ""), // "C:\" → "C:"
    path: root,
    kind: "dir",
    size: 0,
    mtime: null,
    mode: null,
    symlinkTarget: null,
    linkIsDir: false,
    hidden: false,
  };
}

// ---------------------------------------------------------------------------
// 팩토리 둘
// ---------------------------------------------------------------------------

/**
 * 세션이 없을 때의 실패 — **이유 코드 `[session-gone]`** 을 달아 던진다. 백엔드가 만드는
 * 같은 갈래와 표식이 같으므로 `isSessionGone` 이 한 번에 알아보고, 화면은 빨간 오류 대신
 * "연결 대기" 배너로 접는다 (`$lib/error-reason`).
 *
 * 문구는 사전에서 온다. 이 파일은 vitest 가 그대로 들여오는 순수 모듈이라 `t()`(룬)를
 * 들일 수 없고, 던지는 `Error` 의 `message` 에는 문구 **키**를 돌려줄 자리도 없다 —
 * 그 한 자리를 위해 `dict.translateNow` 가 있다 (그 함수의 머리말 참고).
 */
function noSession(): never {
  throw new Error(withReason("session-gone", translateNow("files.ops.session.gone")));
}

/**
 * 세션이 끊긴 원격 백엔드 하나 — **모든 타일이 나눠 쓰는 싱글턴**이다.
 * 상태가 없고(부르면 전부 같은 오류) 화면은 `online === false` 를 보고 이미 배너로
 * 덮으므로, 타일마다 새 객체를 만들 이유가 없다.
 */
const OFFLINE_REMOTE: FsBackend = makeRemote(null);

/**
 * 세션 id 하나당 백엔드 하나 — **객체 신원을 고정하려고** 캐시한다.
 *
 * `PaneHost` 는 포커스가 바뀔 때마다 리렌더하는데, 그때마다 새 객체를 내리면 브라우저의
 * `$effect` 와 `$derived` 가 아무 이유 없이 다시 돈다 (동작은 [`FsBackend.key`] 비교로
 * 지켜지지만 헛일이다). 세션 id 는 창 안에서 단조 증가하고 항목 하나는 클로저 몇 개뿐이라
 * 남겨 두는 값이 싸다.
 */
const REMOTE_CACHE = new Map<number, FsBackend>();

/**
 * **원격(SFTP) 백엔드** — 세션 하나를 빌려 쓴다.
 *
 * `session` 이 `null` 이면 "지금 연결이 없다" 는 뜻이라 [`OFFLINE_REMOTE`] 를 준다.
 * 재연결로 세션 id 가 바뀌면 [`key`] 가 바뀌고, 브라우저가 그것을 알아채 **보던 경로를
 * 그대로 다시 읽는다** (docs/log/2026-09-03-sftp-browser-tile.md 2절의 배선 그대로다).
 */
export function remoteBackend(session: number | null): FsBackend {
  if (session === null) return OFFLINE_REMOTE;
  const cached = REMOTE_CACHE.get(session);
  if (cached) return cached;
  const made = makeRemote(session);
  REMOTE_CACHE.set(session, made);
  return made;
}

/**
 * 백엔드 키에서 **SFTP 세션 번호**를 뽑는다 — 로컬이거나 세션이 없으면 `null`.
 *
 * 서버 사이 명령(`sftp_*_between`)은 세션을 **둘** 받는데, 화면은 세션 번호를 모른다
 * (그것이 [`FsBackend`] 를 둔 이유다). 그래서 어댑터가 상대 백엔드에게서 그 값을 꺼낼
 * 통로가 하나 필요하다. 키를 파싱하는 것은 [`backendFromKey`] 가 이미 하는 일이라
 * (키 ↔ 세션은 이 파일이 정한 표기다) 새 계약을 만들지 않고 그 표기를 재사용한다.
 */
function sessionOfKey(key: string): number | null {
  const m = /^ssh:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** 상대 원격의 세션 — 없으면 부르기 전에 멈춘다 (로컬을 원격 자리에 넘긴 배선 실수) */
function otherSession(from: FsBackend): number {
  const id = sessionOfKey(from.key);
  if (id === null) noSession();
  return id;
}

function makeRemote(session: number | null): FsBackend {
  const sid = () => (session === null ? noSession() : session);
  return {
    key: session === null ? "ssh:none" : `ssh:${session}`,
    online: session !== null,
    sep: "/",
    canUpload: true,
    canDownload: true,
    canEdit: true,
    canOpenExternal: false,
    canReveal: false,
    canView: true,
    canWrite: true,
    roots: () => null,
    isSyntheticRoot: () => false,
    home: () => sftpHome(sid()),
    // 원격의 붙박이는 홈과 `/` 둘 — 이름은 그 경로 문법 그대로 적는다(번역할 말이 아니다)
    places: async () => {
      if (session === null) return [];
      const root: BackendPlace = { kind: "root", path: "/", label: "/" };
      try {
        return [{ kind: "home", path: await sftpHome(session), label: "~" }, root];
      } catch {
        return [root];
      }
    },
    freeSpace: (path) =>
      session === null ? Promise.resolve(null) : freeSpaceOf("sftp_free_space", { session, path }),
    list: (path) => sftpList(sid(), path),
    stat: (path) => sftpStat(sid(), path),
    mkdir: (path) => sftpMkdir(sid(), path),
    createFile: (path) => sftpCreateFile(sid(), path),
    rename: (from, to) => sftpRename(sid(), from, to),
    remove: (path, recursive) => sftpRemove(sid(), path, recursive),
    copy: (paths, destDir, onConflict, op, onProgress) =>
      sftpCopy(sid(), paths, destDir, onConflict, op, onProgress),
    move: (paths, destDir, onConflict) => sftpMove(sid(), paths, destDir, onConflict),
    removeMany: (paths, recursive) => sftpRemoveMany(sid(), paths, recursive),
    conflicts: (paths, destDir) => sftpConflicts(sid(), paths, destDir),
    cancel: (op) => transferCancel(op),
    uploadPaths: (localPaths, remoteDir, onConflict, op, onProgress) =>
      sftpUploadPaths(sid(), localPaths, remoteDir, onConflict, op, onProgress),
    downloadPaths: (remotePaths, localDir, onConflict, op, onProgress) =>
      sftpDownloadPaths(sid(), remotePaths, localDir, onConflict, op, onProgress),
    copyFromRemote: (from, paths, destDir, onConflict, op, onProgress) =>
      sftpCopyBetween(otherSession(from), paths, sid(), destDir, onConflict, op, onProgress),
    moveFromRemote: (from, paths, destDir, onConflict, op, onProgress) =>
      sftpMoveBetween(otherSession(from), paths, sid(), destDir, onConflict, op, onProgress),
    uploadPathsMove: (localPaths, remoteDir, onConflict, op, onProgress) =>
      localToSftpMove(sid(), localPaths, remoteDir, onConflict, op, onProgress),
    downloadPathsMove: (remotePaths, localDir, onConflict, op, onProgress) =>
      sftpToLocalMove(sid(), remotePaths, localDir, onConflict, op, onProgress),
    download: (remote, local, onBytes) => sftpDownload(sid(), remote, local, onBytes),
    edit: async (path) => (await editRemoteFile(sid(), path)).file_name,
    readText: (path) => sftpReadText(sid(), path),
    // async — 세션 없음(`sid()` 의 던짐)도 거절된 약속으로 온다
    readPreview: async (path) => sftpReadPreview(sid(), path),
    readImage: async (path, op, onProgress) => readImageVia("sftp_read_image", { session: sid(), op }, path, onProgress),
    // async — 세션 없음(`sid()` 의 던짐)도 **거절된 약속**으로 온다: 저장 쪽은 `.catch` 하나로 받는다.
    writeText: async (path, text, expectedVersion) =>
      sftpWriteText(sid(), path, text, expectedVersion),
    parentOf: posixParentOf,
    joinPath: posixJoinPath,
    crumbsOf: posixCrumbsOf,
  };
}

/**
 * **로컬 디스크 백엔드** — 세션이 없다 (연결이라는 것이 없으므로 언제나 `online`).
 *
 * ## 합성 루트 `""` = "내 PC"
 *
 * 유닉스에는 `/` 라는 꼭대기가 있지만 윈도우에는 없다 — `C:\` 위에는 아무것도 없고,
 * 드라이브가 여러 개면 그 사이를 오갈 길이 필요하다. 그래서 **빈 경로를 꼭대기로 삼아**
 * `local_roots` 의 결과를 디렉터리 목록처럼 돌려준다. 그러면 ↑·빵부스러기·더블클릭이
 * 전부 평소 규칙 그대로 동작하고, 화면에는 종류 검사가 한 줄도 늘지 않는다.
 *
 * 백엔드에 그 자리를 위한 명령이 따로 있는 것은 아니다 — 만들기·이름 변경·삭제는
 * [`isSyntheticRoot`] 로 화면에서 끈다 (백엔드도 드라이브 뿌리를 거절한다).
 */
/**
 * 로컬 백엔드의 [`FsBackend.key`] — **창을 넘어도 같은 뜻**인 유일한 키다 (원격 키의 세션
 * 번호는 창마다 따로 도는 카운터다). 드래그·클립보드가 "이 짐이 로컬에서 왔는가" 를 물을
 * 때 문자열을 다시 적지 않도록 여기 한 곳에 둔다.
 */
export const LOCAL_KEY = "local";

const LOCAL: FsBackend = {
  key: LOCAL_KEY,
  online: true,
  sep: "\\",
  // 참이다 — **탐색기에서 끌어다 놓은 파일**을 받는 자리가 여기이기 때문이다
  // (`uploadBytes` 주석 · docs/log/2026-09-04-native-drag-out.md "반대 방향").
  canUpload: true,
  canDownload: false,
  canEdit: false,
  canOpenExternal: true,
  canReveal: true,
  canView: true,
  canWrite: true,
  roots: () => localRoots(),
  isSyntheticRoot: (path) => winNormalize(path) === "",
  home: () => localHome(),
  places: () => localPlaces(),
  // 합성 루트("내 PC")는 볼륨이 아니다 — 묻지 않는다
  freeSpace: (path) => (winNormalize(path) === "" ? Promise.resolve(null) : freeSpaceOf("local_free_space", { path })),
  list: async (path) => {
    if (winNormalize(path) === "") return (await localRoots()).map(rootEntry);
    return localList(path);
  },
  stat: (path) => localStat(path),
  mkdir: (path) => localMkdir(path),
  createFile: (path) => localCreateFile(path),
  rename: (from, to) => localRename(from, to),
  remove: (path, recursive) => localRemove(path, recursive),
  copy: (paths, destDir, onConflict, op, onProgress) =>
    localCopy(paths, destDir, onConflict, op, onProgress),
  move: (paths, destDir, onConflict) => localMove(paths, destDir, onConflict),
  removeMany: (paths, recursive) => localRemoveMany(paths, recursive),
  conflicts: (paths, destDir) => localConflicts(paths, destDir),
  cancel: (op) => transferCancel(op),
  uploadBytes: (destDir, file, onConflict, tr) => localWriteFile(destDir, file, onConflict, tr),
  openExternal: async (path) => {
    try {
      await openPath(path);
    } catch (e) {
      throw errorOf(e, "files.ops.fail.open", { path });
    }
  },
  reveal: async (path) => {
    try {
      await revealItemInDir(path);
    } catch (e) {
      throw errorOf(e, "files.ops.fail.reveal", { path });
    }
  },
  readText: (path) => localReadText(path),
  readPreview: (path) => localReadPreview(path),
  readImage: (path, op, onProgress) => readImageVia("local_read_image", { op }, path, onProgress),
  writeText: (path, text, expectedVersion) => localWriteText(path, text, expectedVersion),
  watch: (onChange) => localWatch(onChange),
  parentOf: winParentOf,
  joinPath: winJoinPath,
  crumbsOf: winCrumbsOf,
};

/**
 * 로컬 백엔드 — **언제나 같은 객체**다. 상태가 없고(세션도 캐시도 없다) 로컬 타일이
 * 몇 개든 같은 명령을 부르므로, 새로 만들면 브라우저의 효과만 헛되이 돌 뿐이다.
 */
export function localBackend(): FsBackend {
  return LOCAL;
}

/**
 * **키 하나로 백엔드를 되찾는다** — 드래그와 클립보드가 이것 없이는 성립하지 않는다.
 *
 * 타일 사이로 오가는 짐에는 백엔드 **객체**를 실을 수 없다 (드래그는 문자열만 나른다).
 * 그래서 짐에는 [`FsBackend.key`] 만 싣고, 받는 쪽이 여기서 펴서 그 원본에 명령을 건다 —
 * 원격 → 로컬 다운로드처럼 **출발지 쪽 명령**을 불러야 하는 방향이 있기 때문이다
 * (로컬 백엔드에는 세션이 없어 내려받을 문이 없다).
 *
 * 모르는 모양이면 `null` 이고, 그때 받는 쪽은 안내 한 줄로 물러난다. 재연결로 세션 id 가
 * 바뀐 뒤의 옛 키(`ssh:12`)는 **살아 있는 객체를 돌려주지만 그 명령이 실패한다** — 여기서
 * 미리 막지 않는 이유는 캐시가 "그 세션" 을 정확히 가리키고 있어서다: 새 세션으로 몰래
 * 바꿔치기하면 사용자가 A 서버에서 자른 것이 B 서버에 붙는다.
 */
export function backendFromKey(key: string): FsBackend | null {
  if (key === LOCAL.key) return LOCAL;
  const session = sessionOfKey(key);
  if (session === null) return null;
  return remoteBackend(session);
}

/**
 * 경로의 **마지막 조각**. 구분자 둘(`/` · `\`)을 함께 보므로 어느 백엔드의 경로든 통한다 —
 * 다른 백엔드로 붙여넣을 때 "저쪽에 어떤 이름으로 놓이는가" 를 미리 알아야 하는 자리
 * (충돌 사전 조회)가 이것을 쓴다. 꼬리 구분자는 먼저 떼어 낸다 (`C:\a\` → `a`).
 */
export function baseNameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at < 0 ? trimmed : trimmed.slice(at + 1);
}
