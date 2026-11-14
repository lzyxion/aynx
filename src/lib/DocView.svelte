<script lang="ts">
  /**
   * **문서 보기 타일** — 파일 한 장을 읽기 전용으로 보여 준다 (docs/log/2026-09-27-doc-tile.md).
   *
   * ## 어디의 파일인지는 [`backend`] 만 안다
   *
   * 파일 브라우저(`SftpBrowser`)와 같은 규칙이다: 이 컴포넌트에는 `local_*` 도 `sftp_*` 도 세션 id 도 없고,
   * 읽기(`readText`)·외부로 열기·편집을 **능력 플래그**대로 부른다. 원격이면 상위가 원본 터미널의 세션을
   * 그때그때 조회해 백엔드를 내려 주므로(`PaneHost` 의 `docBackend`), 재연결하면 [`FsBackend.key`] 가 바뀌고
   * 아래 효과가 **같은 파일을 다시 읽는다**.
   *
   * ## 끊겨도 글은 남긴다
   *
   * 원본이 끊기면(대기 배너) · 사라지면(원본 없음 배너) 마지막으로 읽은 내용을 **그대로 둔다**. 읽던 글이
   * 연결 사정으로 사라지면 사람이 잃는 것만 있다. 세션이 없다는 실패(`[session-gone]`)는 빨간 오류로 적지
   * 않는다 — 배너가 같은 사실을 더 정확히 말한다(`browser/file-listing.svelte.ts` 의 `failureOf` 와 같은 규칙).
   *
   * ## HTML 을 만들지 않는다
   *
   * 마크다운은 `MarkdownBlocks`(구조 파싱 → 글자 보간), 코드는 `CodeView`(lowlight 의 hast 트리를 재귀로
   * 그린다) — 문서 글이 `{@html}` 로 들어가는 곳이 없어 원격 파일의 `<script>` 는 글자다. 예외는 둘이고 둘 다 남의
   * 그리기 엔진이 **자기 손으로 짠** 출력이다: ```mermaid 블록의 다이어그램(`diagrams` → `MermaidView` — mermaid
   * `securityLevel: "strict"` 의 SVG)과 수식(`DOC_TILE_MD` 의 `math` → `MathView` — KaTeX `trust: false` 의 HTML). 근거는
   * 각 머리말.
   *
   * 그림(`![alt](src)`)은 **문서와 같은 백엔드의 경로**만 불러온다(상대 · 절대 — 문서 링크와 같은 `resolveDocLink` 규칙).
   * 바이트를 `readPreview`(파일 타일 미리 보기 패널과 같은 문)로 받아 `blob:` URL 의 `<img>` 로 그린다 — 원격 파일의
   * 바이트가 HTML 이 되지 않고, SVG 도 `<img>` 라 스크립트가 돌지 않는다. `http`/`https` · `data:` · `file:` 같은 스킴 있는
   * 주소는 불러오지 않는다(문서를 여는 것만으로 바깥에 요청이 나가지 않게 — 대체 글자 + 툴팁). 캐시 · 거두기는
   * `doc-images.svelte.ts`, 판정은 `doc-images.ts`.
   *
   * ## 키보드
   *
   * 뿌리가 `[data-tile-focus]` 라 `Alt+화살표`로 들어오면 여기 포커스가 온다. ↑↓ · PgUp/PgDn · Home/End 로
   * 스크롤한다(수식 키가 섞이면 비켜난다 — 전역 단축키의 것이다). 새로고침은 **단추만**이다: `F5`·`Ctrl+R` 은
   * 개발용으로 살려 둔 브라우저 키라 가로채지 않는다. 선택 + `Ctrl+C` 는 브라우저 기본 복사 그대로다.
   *
   * ## 자동 새로고침
   *
   * 보이는 동안 주기마다 `stat` 을 묻고, 크기·시각이 바뀌면 다시 읽는다. `version` 이 같으면 **아무것도 바꾸지
   * 않는다** — 그린 블록 · 선택 · 스크롤 · 원문/보기가 그대로다. 규칙(주기 · 멈춤 · 들이는 법 · 맨 아래 붙기)은
   * 전부 `doc-refresh.ts` 의 순수 함수이고 여기는 타이머와 DOM 만 쥔다. 서 있는지 · 마지막으로 읽은 시각 · 주기는 도구줄
   * **새로고침 단추의 툴팁**이 말한다(예전 도구줄의 작은 점은 늘 떠 있어 걷었다). 도구줄에는 ⋯ 가 없다 — 한 타일에 ⋯ 가
   * 위아래 둘이던 것을 걷었다.
   *
   * ## 편집 (E1 — docs/log/2026-09-27-doc-edit.md)
   *
   * [편집]은 백엔드가 쓸 수 있고(`canWrite`) 파일이 편집할 만할 때(`editBlockOf` — 잘림 · 이진 · 깨진 UTF-8 이
   * 아닐 때)만 선다. 누르면 몸통이 `DocEditor`(CodeMirror — 늦게 받는다)로 바뀌고, 미리 보기였으면 **고정**된다.
   * 저장은 사람이 누른 저장뿐(`Ctrl+S` · [저장])이고, 편집을 시작할 때의 `version` 을 기대값으로 보내 디스크가
   * 그사이 바뀌었으면 쓰지 않고 충돌 띠를 세운다([덮어쓰기]만 기대값 없이 쓴다). 편집 중 자동 새로고침은 **글을
   * 바꾸지 않고** 띠만 세운다. 띠의 전이는 `doc-edit.ts` 의 순수 함수다. 충돌 · 바뀜 띠의 [비교]는 디스크를 따로 읽어 내 편집과
   * 나란히 보여 준다(읽기 전용 — `doc-compare.ts` · `doc/DocCompareView.svelte`, 편집 면은 가리기만 한다). 저장 안 한 변경은 `app/doc-dirty` 에
   * 적고(닫기 가드 · 머리줄 ● 가 읽는다), 저장 함수도 거기 등록한다 — 둘 다 [`paneId`] 가 있을 때만.
   *
   * 마크다운이면 편집 중에도 그린 결과를 본다. 넓은 타일(`isWideEdit` — 900px 이상)은 도구줄 맨 앞 세 칸 묶음
   * [원문만 | 나란히 | 미리 보기만](기본 나란히 — 고른 값과 경계 비율은 타일의 것: `PaneSpec.docEditView` · `docSplit`,
   * 미리 보기를 고정하지 않는다), 좁은 타일은 [원문 | 미리 보기] 두 칸 탭(저장하지 않는 한때 값). 편집기는 보기를 바꿔도
   * **내리지 않고 숨기기만** 한다(되돌리기 기록 · 커서가 산다). 미리 보기는 입력이 200ms 멈춘 뒤 다시 파싱한다(mermaid 는
   * 같은 원문이면 `MermaidView` 캐시). 스크롤 맞추기(나란히일 때만 · 기본 켬)는 **편집기 → 미리 보기 한 방향**이다:
   * 커서가 편집기 화면 안이면 커서 절, 밖이면 맨 위 줄의 절(`syncTarget`)로 미리 보기를 밀고 커서 절 제목에 옅은 판을
   * 깐다. 미리 보기 내용의 크기가 바뀌면(늦은 mermaid) 맞춰 둔 절로 한 번 다시 민다 — 사람이 미리 보기를 직접 밀었으면
   * 그대로 둔다. 줄 → 절은 `doc-edit-preview.ts` 의 `sectionLines`(원문 제목 줄 ↔ `headingSlugs`)다.
   *
   * ## 체크박스 (`- [ ]` · `- [x]`)
   *
   * 읽기 보기에서 누르면 **파일에 바로** 쓴다 — 그 줄의 `[ ]`↔`[x]` 한 글자(`doc-task.ts` 의 `toggleTaskLine`)를 지금
   * `version` 을 기대값으로 저장 경로(`writeText`)에 보낸다. 디스크가 그사이 바뀌었으면(충돌) 쓰지 않고 다시 읽은 뒤 토스트로
   * 알린다. 여러 번 눌러도 쓰기는 **차례로** 간다(앞 쓰기의 새 version 이 다음 기대값) — 쓰는 동안 그 체크박스는 막힌다.
   * 편집을 막는 사정(쓸 수 없는 백엔드 · 잘림 · 이진 · 깨진 UTF-8 · 끊김)이면 막힌 채 툴팁이 까닭을 말한다. 편집 중 미리
   * 보기의 체크박스는 파일이 아니라 **편집기 글**을 바꾼다(되돌리기 기록에 남는다 — 저장은 사람이 한다).
   *
   * 마크다운은 `DOC_TILE_MD`(`frontmatter` · `math`) 선택으로 파싱한다 — 파일 맨 앞 머리말이 접힘 상자가 되고(목차 · 앵커 ·
   * 줄↔절에서 빠진다), `$…$` · `$$…$$` · ```math 가 수식이 된다(KaTeX 는 처음 수식이 나올 때 받는다). 읽기 보기 · 편집 중
   * 미리 보기 · 줄↔절이 같은 선택을 써야 제목 짝이 맞는다. 기록 보기 같은 남의 말에는 이 선택이 없다(`$` 가 흔하다).
   *
   * ## 문서 안의 링크 (B7)
   *
   * 웹 링크 밖에 **문서 링크**도 Ctrl+클릭으로 산다(`doc-links.ts` 가 가른다): `#절` 만이면 이 문서의 그 제목으로
   * 스크롤하고(제목의 `data-slug` — GitHub 식 이름), 경로(`other.md` · `./docs/a.md#절`)면 [`onopenlink`] 로 올린다 —
   * 푸는 일 · 확인 · 자리 잡기는 상위(`openDocLink`)가 한다. 그렇게 연 타일이 받은 한 번짜리 [`anchor`] 는 글을 그린
   * 뒤 그 제목으로 스크롤하고 [`onanchordone`] 으로 돌려준다(못 찾아도 — 다시 시도하지 않는다).
   *
   * 같은 모양의 한 번짜리 [`line`] 은 터미널의 `파일:12` Ctrl+클릭에서 온다 — 코드 보기는 그 줄, 그린 마크다운은 그 줄이 든
   * 최상위 블록으로 스크롤하고 2초 강조한 뒤 [`onlinedone`] 으로 돌려준다(편집 중이면 아무것도 하지 않고 돌려준다 · 규칙은
   * `doc-line-jump.ts`).
   *
   * 각주(`[^id]`)의 위첨자 ↔ 글 끝 각주 항목 오가기는 **그냥 클릭**이고(근거는 `MarkdownBlocks` 머리말) 앵커와 같은 손잡이로
   * 그 상자(읽기 본문 · 편집 중 미리 보기)만 민다.
   *
   * ## 문서 안 검색
   *
   * `Ctrl+F`(앱의 `find` 키 — 포커스된 타일이 문서 타일이면 `app/tile-find.ts` 로 여기 온다)가 도구줄 아래 얇은 띠를 연다(`DomFindBar`):
   * 입력 칸 · "i / N" · [대소문자] · [이전] · [다음] · [닫기]. `Enter` · `F3` 다음 · `Shift+Enter` · `Shift+F3` 이전 · `Esc` 닫고 본문으로.
   * 미리 보기 · 원문 · 코드 파일 모두 같다(보이는 글자를 훑는다). 편집 중에는 띠 대신 편집기의 검색 패널이 열린다.
   * 칠은 **DOM 을 바꾸지 않는** CSS Custom Highlight 다(`doc-find-dom.ts` — 줄 번호 · mermaid SVG · 수식 · 단추는 빼고 훑는다).
   * 글이 다시 그려지면(자동 새로고침 · 보기 전환 · 늦은 mermaid) `MutationObserver` 가 다시 찾는다 — 고른 번호는 지키고
   * 스크롤은 하지 않는다. 지금 일치로 미는 것은 본문 상자만이다(`scrollIntoView` 를 쓰지 않는 까닭은 앵커 스크롤과 같다).
   *
   * ## 목차
   *
   * 그린 마크다운에만 선다(원문 · 편집 · 코드 파일에는 없다). 넓은 타일은 [목차] 토글(머리줄이면 이름 뒤 `tail` · 몸 위 줄이면 도구줄
   * 맨 앞)이 본문 왼쪽 곁 패널을 여닫고 — 켬은 타일의 것(`PaneSpec.docOutline`, 배치에 저장 · **미리 보기를 고정하지 않는다**) —, 좁은 타일
   * (`isNarrowOutline`)은 **그 자리에 같은 그림**(`side-panel`)의 "지금 절 ▾" 드롭다운 단추가 선다(메뉴 통로 `runOnMenu` 를 지난다). 지금 읽는 절은 본문
   * 스크롤과 본문 내용 상자의 크기 변화(늦게 그려지는 mermaid — `ResizeObserver`)를 rAF 로 묶어 다시 잰다(`currentSection`). 줄을 고르면 앵커 링크와 같은 [`scrollToAnchor`] 로 가고 포커스는
   * 본문(키보드 몸)으로 돌아온다. 규칙은 `doc-outline.ts`, 목록 그림은 `DocOutline.svelte`.
   *
   * ## 글자 크기
   *
   * 본문 상자 위 `Ctrl+휠` 이 타일의 글자 배율을 한 단계씩 바꾼다(80~200% — `doc-zoom.ts`, 타일의 것: `PaneSpec.docZoom`,
   * **미리 보기를 고정하지 않는다**). `zoom` 속성이 아니라 뿌리의 CSS 변수 `--doc-zoom` 을 글자 크기에 곱한다 — 미리 보기
   * (`.md-page`) · 코드 블록 · 원문/코드 파일(`CodeView` — 줄 번호 거터 포함) · 편집기(CodeMirror — 바뀌면 `remeasure`)가
   * 같이 커지고, 줄 바꿈은 타일 폭에 맞춰 다시 흐른다. mermaid 는 둘레 글자 크기로 다시 그린다(`doc-zoom-context`). 다이어그램
   * 위의 `Ctrl+휠` 은 그 다이어그램의 확대가 먼저 가진다(`MermaidView` 가 막은 사건은 건너뛴다). 100% 가 아니면 도구줄에 작은
   * "120%" 글자 단추가 서고 누르면 100% 다. 바꿀 때 읽던 자리는 스크롤 비율로 지킨다. 키보드(`Ctrl+=` · `Ctrl+-` ·
   * `Ctrl+0`)는 아직 없다 — 웹뷰 확대 단축키는 꺼져 있어(Tauri `zoomHotkeysEnabled` 기본 끔) 그 키는 지금 아무 일도 하지 않는다.
   */
  import { onDestroy, tick, untrack } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import CodeView from "$lib/CodeView.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import type DocEditor from "$lib/DocEditor.svelte";
  import DocOutline from "$lib/DocOutline.svelte";
  import DocToolbar from "$lib/doc/DocToolbar.svelte";
  import DocEditPane from "$lib/doc/DocEditPane.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { LOCAL_KEY, TEXT_VIEW_MAX_BYTES, type FsBackend } from "$lib/fs-backend";
  import { DOC_TILE_MD, blockStartLines, parseMarkdown } from "$lib/markdown";
  import { LINE_FLASH_MS, blockAtLine, jumpLineIndex } from "$lib/doc-line-jump";
  import { tooLargeToHighlight } from "$lib/highlight-size";
  import { autoRefreshOn, readAgo, pollIntervalOf } from "$lib/doc-refresh";
  import { isMarkdown, langOf } from "$lib/doc-lang";
  import { classifyDocHref, matchAnchor } from "$lib/doc-links";
  import { taskCharOf, taskMarkOf } from "$lib/doc-task";
  import { imageSrcsOf } from "$lib/doc-images";
  import { DocImageCache } from "$lib/doc-images.svelte";
  import { createDocOutline } from "$lib/doc/outline-controller.svelte.js";
  import { createDocDocument } from "$lib/doc/document-controller.svelte.js";
  import {
    DOC_SPLIT_DEFAULT,
    clampDocSplit,
    isWideEdit,
    narrowTabOf,
    sectionAt,
    sectionLines,
    splitAt,
    syncTarget,
    visibleEditView,
    type EditorViewport,
    type NarrowEditTab,
  } from "$lib/doc-edit-preview";
  import { DOC_ZOOM_DEFAULT, wheelDocZoom } from "$lib/doc-zoom";
  import { provideDocZoom } from "$lib/doc-zoom-context";
  import { editBlockOf } from "$lib/doc-edit";
  import { compareTexts, type CompareResult } from "$lib/doc-compare";
  import DocCompareView from "$lib/doc/DocCompareView.svelte";
  import { stripReason } from "$lib/error-reason";
  import { registerDocSaver, setDocDirty } from "$lib/app/doc-dirty.svelte";
  import {
    dropDocDraft,
    hasPendingDocDraft,
    pendingDocDraft,
    registerDocDraft,
    type DraftCapture,
  } from "$lib/app/doc-drafts.svelte.js";
  import { fitDocDraft, type DocDraft, type DraftSelection } from "$lib/doc-draft";
  import { writeClipboard } from "$lib/clipboard";
  import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
  import { registerTileFind } from "$lib/app/tile-find";
  import DomFindBar from "$lib/DomFindBar.svelte";
  import { DirtyBinding } from "$lib/doc-dirty-table";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { docMenuItems } from "$lib/doc-menu";
  import { runEditMenu, runReadMenu, selectionIn, type ReadMenuActions } from "$lib/doc/context-actions";
  import type { PaneMenuRow } from "$lib/pane/pane-menu";
  import { formatSize } from "$lib/sftp-browser";
  import type { DocEditView, DocMode } from "$lib/session";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { codeToTerminal } from "$lib/app/code-to-term.svelte.js";
  import { newDocState } from "$lib/app/new-doc.svelte.js";
  import { docHeadSpan, OUTLINE_PANEL_W } from "$lib/pane/head-span";

  let {
    paneId,
    path,
    backend,
    mode = "rendered",
    onmode,
    outline = false,
    onoutline,
    editView = "split",
    oneditview,
    split,
    onsplit,
    zoom = DOC_ZOOM_DEFAULT,
    onzoom,
    preview = false,
    onkeep,
    onunkeep,
    alias = "",
    sourceGone = false,
    onnotice,
    onopenlink,
    anchor,
    onanchordone,
    line,
    onlinedone,
    editOnce = false,
    oneditoncedone,
    onmenu,
  }: {
    /** 이 타일의 id — 저장 안 한 변경(`app/doc-dirty`)과 저장 함수를 이 이름으로 적는다. 없으면 적지 않는다 */
    paneId?: string;
    /** 보여 줄 파일의 절대 경로 (`PaneSpec.path`) */
    path: string;
    /** 어디서 읽는가 — 원격이면 원본 터미널의 세션을 빌린 어댑터, 로컬이면 디스크 */
    backend: FsBackend;
    /** 마크다운의 보기 (`PaneSpec.docMode` — 없으면 그린 보기) */
    mode?: DocMode;
    /** [원문]/[보기] — 상위가 패널 명세에 적는다(배치 저장·창 이관이 따라온다) */
    onmode?: (mode: DocMode) => void;
    /** 목차 곁 패널을 켰는가 (`PaneSpec.docOutline` — 없으면 꺼짐). 좁은 타일에서는 드롭다운이 대신한다 */
    outline?: boolean;
    /** [목차] 토글 — 상위가 패널 명세에 적는다(미리 보기는 고정하지 않는다) */
    onoutline?: (open: boolean) => void;
    /** 마크다운 편집 중 고른 보기 (`PaneSpec.docEditView` — 없으면 나란히). 좁은 타일에서는 두 칸 탭이 대신한다 */
    editView?: DocEditView;
    /** 세 칸 묶음 — 상위가 패널 명세에 적는다(미리 보기는 고정하지 않는다) */
    oneditview?: (view: DocEditView) => void;
    /** 나란히의 편집기 몫 (`PaneSpec.docSplit` — 없으면 0.5) */
    split?: number;
    /** 경계를 다 끌었다 · 더블클릭 · ←/→ — 상위가 패널 명세에 적는다 */
    onsplit?: (ratio: number) => void;
    /** 글자 크기 % (`PaneSpec.docZoom` — 없으면 100) */
    zoom?: number;
    /** `Ctrl+휠` · [100%] 단추 — 상위가 패널 명세에 적는다(미리 보기는 고정하지 않는다) */
    onzoom?: (zoom: number) => void;
    /**
     * 미리 보기 문서인가 (`PaneSpec.docPreview`) — 다음에 파일 타일에서 여는 파일이 이 칸을 갈아 끼운다.
     * 참일 때만 [고정] 단추가 선다.
     */
    preview?: boolean;
    /** [고정] — 상위가 미리 보기 표식을 지운다(붙박이). [원문]/[보기] 전환도 같은 일을 한다(상위 몫) */
    onkeep?: () => void;
    /** [고정 해제] · 편집 때문에 고정했던 타일의 [편집 종료] — 상위가 다시 미리 보기로 돌린다 */
    onunkeep?: () => void;
    /** 원본 터미널의 별칭 (대기 배너 문구에만 쓴다) */
    alias?: string;
    /** 원본 터미널 타일이 **아예 없어졌다** (닫혔거나 이관에서 빠졌다) — 원격만 */
    sourceGone?: boolean;
    onnotice?: (message: string) => void;
    /** 문서 안의 **경로** 링크 Ctrl+클릭 — 적힌 경로(퍼센트 인코딩을 푼 것)와 `#절`. 상위가 이 문서 기준으로 푼다 */
    onopenlink?: (link: string, anchor?: string) => void;
    /** 글을 그린 뒤 한 번 찾아갈 제목(앵커) — 저장되지 않는 한때 값(`app/doc-anchors`) */
    anchor?: string;
    /** [`anchor`] 를 썼다(스크롤했거나 못 찾았다) — 상위가 지운다 */
    onanchordone?: () => void;
    /** 글을 그린 뒤 한 번 찾아갈 줄(1 기준 — 터미널의 `파일:12`) — 저장되지 않는 한때 값(`app/doc-anchors`) */
    line?: number;
    /** [`line`] 을 썼다(스크롤했거나 못 찾았다 · 편집 중이었다) — 상위가 지운다 */
    onlinedone?: () => void;
    /** 글을 읽은 뒤 한 번 편집을 시작한다([새 문서…]로 만들어 연 타일) — 저장되지 않는 한때 값(`app/doc-anchors`) */
    editOnce?: boolean;
    /** [`editOnce`] 를 썼다(편집을 시작했거나 · 막혔거나 · 읽기가 실패했다) — 상위가 지운다 */
    oneditoncedone?: () => void;
    /**
     * 본문 우클릭 — 커서 자리에 타일 메뉴(`PaneMenu` — 터미널 본문 우클릭과 같은 상자)를 연다. 줄은 `doc-menu.ts` 가 짓고, 누른 줄의 열쇠는
     * `run` 으로 이 타일에 돌아온다(통로는 `PaneHost` 의 `runTileMenu` → `runOnMenu`). 없으면(상위가 넘기지 않음) 우클릭에 아무것도 뜨지 않는다
     */
    onmenu?: (x: number, y: number, menu: { rows: PaneMenuRow[]; run: (key: string) => void }) => void;
  } = $props();

  let bodyEl = $state<HTMLDivElement | null>(null);
  let rootEl = $state<HTMLDivElement | null>(null);

  // ── 문서 (불러오기 · 자동 새로고침 · 편집 · 저장 · 띠 · 체크박스 쓰기) ───────────────────────
  // 마지막으로 읽은 파일 · 읽는 중 · 오류 · 도장 · 편집 중 · 더러움 · 저장 · 띠 · 체크박스 쓰기 — `doc/document-controller.svelte.ts`
  // (2026-10-27 분할 9차). 효과(다시 읽기 · 박자 · 더러움 표 · 저장 함수 등록) · 정리는 아래 원래 자리 · 원래 순서 그대로이고, 편집 미리
  // 보기의 한때 값은 이 파일에 남아 편집 시작 · 다시 불러오기가 `onEditStart` · `onEditReload` 로 만진다.
  const dc = createDocDocument({
    get path() {
      return path;
    },
    get backend() {
      return backend;
    },
    get offline() {
      return offline;
    },
    get sourceGone() {
      return sourceGone;
    },
    get preview() {
      return preview;
    },
    get editor() {
      return editor;
    },
    get rootEl() {
      return rootEl;
    },
    scroller,
    onkeep: () => onkeep?.(),
    onunkeep: () => onunkeep?.(),
    onnotice: (message) => onnotice?.(message),
    onEditStart: previewOnEditStart,
    onEditReload: previewOnEditReload,
    stopPreviewTimer,
  });

  const offline = $derived(!backend.online);
  const markdown = $derived(isMarkdown(path));
  /** 마크다운을 그려서 보이는 중인가 — 아니면 코드 보기(원문 · 그 밖의 파일). 편집 중에는 늘 편집기다 */
  const rendered = $derived(markdown && mode !== "source" && !dc.editing);
  const lang = $derived(markdown ? "markdown" : langOf(path));
  const text = $derived(dc.file && !dc.file.binary ? dc.file.text : "");
  const blocks = $derived(rendered && text !== "" ? parseMarkdown(text, DOC_TILE_MD) : []);
  /** 코드 보기에서 강조를 껐는가 — 언어를 모르면 원래 평문이라 띠를 걸 일이 없다 */
  const plain = $derived(!rendered && lang !== null && text !== "" && tooLargeToHighlight(text));

  /**
   * 박자 — 숫자로 떼어 둔다. 상위가 백엔드 객체를 새로 내려 줄 때마다 타이머가 다시 서면(그래서 영영 울리지
   * 않으면) 안 된다: `$derived` 는 값이 같으면 아래 효과를 깨우지 않는다.
   */
  const pollMs = $derived(pollIntervalOf(backend.key));
  /** 자동 새로고침이 서 있는가(끊김 · 원본 없음 · 오류면 멈춤) — 타일 ⋯ 메뉴의 정보 줄이 말한다 */
  const autoOn = $derived(
    autoRefreshOn({ online: backend.online, sourceGone, hasFile: dc.file !== null, error: dc.error !== null }),
  );

  // ── 편집 (E1) ────────────────────────────────────────────────────────────────
  // 편집 상태 · 저장 · 띠 · 다시 불러오기는 `dc`(위). 여기는 편집기 손잡이와 단추 모양만.

  let editor = $state<ReturnType<typeof DocEditor> | null>(null);

  /** [편집] 단추가 서는가 — 쓸 수 있는 백엔드 · 읽은 글자 파일 */
  const showEdit = $derived(backend.canWrite === true && dc.file !== null && !dc.file.binary);

  /** 편집 단추의 툴팁 — 막혔으면 왜인지, 아니면 이름만(단추는 아이콘뿐이라 이것이 이름이다) */
  function editTitle(): string {
    if (dc.editBlock === "truncated") return t("files.doc.edit.block.truncated");
    if (dc.editBlock === "lossy") return t("files.doc.edit.block.lossy");
    if (offline) return t("files.doc.edit.block.offline");
    return t("files.doc.edit");
  }

  // 저장 안 한 변경 표(`app/doc-dirty`) — 표는 늘 `(paneId, editing && dirty || 걸어 둔 초안)` 과 같다(`DirtyBinding`).
  // 걸어 둔 초안(다른 창에서 옮겨 와 아직 편집기에 들이지 못한 글 — `app/doc-drafts`)도 저장 안 한 변경이다.
  // - 효과는 **정리 함수가 없다**: 정리 함수로 지우면 상위가 같은 타일을 다시 내려 줄 때(포커스 이동) 지운 뒤 다시
  //   적지 않아 ● 가 꺼지고 닫기가 묻지 않았다(편집 유실 — docs/log/2026-09-27-doc-edit.md). 지우기는 id 가 값으로
  //   바뀔 때(옛 id)와 `onDestroy` 뿐.
  // - 쓰기는 `untrack` — 표를 읽어 구독하면 제가 쓴 값에 다시 깨어난다(`effect_update_depth_exceeded`).
  const dirtyBinding = new DirtyBinding(setDocDirty);
  $effect(() => {
    const id = paneId;
    const value = (dc.editing && dc.dirty) || (!!id && hasPendingDocDraft(id));
    untrack(() => dirtyBinding.sync(id, value));
  });

  // 닫기 가드의 [저장하고 닫기]가 부를 저장 함수 — `paneId` 만 구독한다(`save` 는 부를 때 상태를 읽는다).
  // 다시 돌면 정리 함수(푼다)가 **먼저**, 몸통(등록)이 나중이라 등록이 남는다 — 효과 하나 안의 순서다.
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return untrack(() =>
      registerDocSaver(id, () => {
        // 걸어 둔 초안이 아직 편집기에 들지 않았다 — 저장할 글이 편집기에 없으니 "저장했다" 고 하면 닫기가 글을 버린다
        if (hasPendingDocDraft(id)) {
          onnotice?.(t("files.doc.draft.saveBlocked"));
          return Promise.resolve(false);
        }
        return dc.save();
      }),
    );
  });

  // ── 창을 넘는 초안 (`doc-draft.ts` · `app/doc-drafts`) ──────────────────────────
  //
  // 보내는 쪽: 이관 짐을 만드는 순간(`app/tear` — 동기) 편집기의 글 · 커서 · 기록을 뜬다. 편집 중 · 저장 안 한 변경 · 편집기가 섰을
  // 때만이고, 글이 상한을 넘으면 `null`(창 넘기기 거절). `still` 은 뜬 뒤 글이 그대로인가 — 원본을 내리기 직전에 다시 묻는다.
  // 받는 쪽: 걸어 둔 초안이 있으면 파일을 읽은 뒤 [편집]과 같은 문으로 그 글을 들인다(`dc.startEditFromDraft`). 편집기가 **실제로
  // 섰을 때만** 초안을 내린다 — 읽기 실패 · 편집할 수 없음 · 끊김 · 편집기 지연 로딩 실패면 초안을 쥔 채 띠로 말하고(다시 시도 ·
  // 초안 복사 · 초안 버리기), 그동안도 저장 안 한 변경으로 보인다(닫기 가드 · ●).

  function captureDraft(): DraftCapture | null {
    const ed = editor;
    if (!dc.editing || !dc.dirty || !ed) return null;
    const snap = ed.draft();
    const ref = ed.docRef();
    if (!snap || !ref) return null;
    const draft = fitDocDraft({
      text: snap.text,
      baseVersion: dc.baseVersion,
      eol: snap.eol,
      selection: snap.selection as DraftSelection | undefined,
      scrollPos: snap.scrollPos,
      history: snap.history,
    });
    if (!draft) return null;
    return {
      draft,
      still: () => editor === ed && dc.editing && ed.docRef() === ref,
      freeze: (on) => ed.setFrozen(on),
    };
  }

  $effect(() => {
    const id = paneId;
    if (!id) return;
    return untrack(() => registerDocDraft(id, captureDraft));
  });

  /** 걸어 둔 초안 — 다른 창에서 옮겨 와 아직 편집기에 들이지 않은 글 */
  const heldDraft = $derived(paneId ? pendingDocDraft(paneId) : undefined);
  /** 초안으로 세우던 편집기가 지연 로딩에 실패했다 — 저절로 다시 세우지 않는다([다시 시도]가 푼다) */
  let draftStalled = $state(false);
  /** 지금 편집기로 들이는 중인 초안 — 편집기가 서면 그것만 내린다 */
  let applyingDraft: DocDraft | null = null;

  /** 초안을 들이지 못하는 까닭 — 없으면 `null`(들일 수 있다 · 들이는 중 · 초안 없음) */
  const draftBlock = $derived.by<"wait" | "read" | "noedit" | "readonly" | "offline" | "editor" | null>(() => {
    if (!heldDraft || dc.editing) return null;
    if (draftStalled) return "editor";
    if (dc.file === null) return dc.error !== null ? "read" : "wait";
    if (dc.editBlock !== null) return "noedit";
    if (!backend.canWrite) return "readonly";
    if (offline) return "offline";
    return null;
  });

  // 들일 수 있게 되면(읽었다 · 다시 이어졌다) 한 번 — 편집 중이 아니고 막는 까닭이 없을 때
  $effect(() => {
    const d = heldDraft;
    if (!d || dc.editing || draftBlock !== null) return;
    untrack(() => {
      if (dc.startEditFromDraft(d)) applyingDraft = d;
    });
  });

  /** 편집기가 섰다 — 들이던 초안을 내린다(그 글은 이제 편집기에 있다) */
  function editorReady() {
    const d = applyingDraft;
    applyingDraft = null;
    if (d && paneId) dropDocDraft(paneId, d);
  }

  /** 편집기를 받지 못했다 — 초안으로 세우던 중이면 초안은 쥔 채 멈춘다(저절로 다시 받지 않는다) */
  function onEditorFailed(message: string) {
    if (applyingDraft) {
      applyingDraft = null;
      draftStalled = true;
    }
    dc.editorFailed(message);
  }

  /** 띠의 [다시 시도] — 읽기부터(읽지 못했으면) 또는 편집기 받기부터 */
  function retryDraft() {
    draftStalled = false;
    if (dc.file === null || dc.error !== null) void dc.load();
  }

  async function copyDraft() {
    const d = heldDraft;
    if (!d) return;
    if (!(await writeClipboard(d.text))) onnotice?.(t("files.doc.menu.copy.fail"));
  }

  async function discardDraft() {
    const d = heldDraft;
    if (!d || !paneId) return;
    const ok = await askConfirm(t("files.doc.draft.discard.confirm"), { kind: "warning", danger: true });
    if (ok && paneId) dropDocDraft(paneId, d);
  }

  onDestroy(() => {
    dirtyBinding.dispose();
    dc.dispose();
    stopPreviewTimer();
  });

  // ── 체크박스 ─────────────────────────────────────────────────────────────────

  // 읽기 보기의 체크박스 쓰기(차례로 · 막는 까닭 · 쓰는 중인 줄)는 `dc` — 편집 중 미리 보기의 것은 아래(편집기 글을 바꾼다)
  const readTasks = $derived({
    title: t("files.doc.task.toggle"),
    blocked: dc.taskBlocked,
    busy: dc.taskBusy,
    ontoggle: dc.toggleTask,
  });
  const editTasks = $derived({
    title: t("files.doc.task.toggle.edit"),
    blocked: null,
    busy: new Set<number>(),
    ontoggle: togglePreviewTask,
  });

  /**
   * 편집 중 미리 보기의 체크박스 — 파일이 아니라 편집기 글의 그 한 글자를 바꾼다(되돌리기 기록에 남는다). 미리 보기가
   * 아직 옛 글이면(입력이 멈추기 전) 지금 글로 다시 그리기만 한다 — 줄이 어긋난 채 고치지 않는다.
   */
  function togglePreviewTask(line: number, wasChecked: boolean) {
    if (!dc.editing || !editor) return;
    if (editor.getText() !== previewText) {
      flushPreview();
      return;
    }
    const lt = editor.lineText(line);
    const mark = lt === null ? null : taskMarkOf(lt);
    if (!mark || mark.checked !== wasChecked) return;
    if (editor.replaceInLine(line, mark.col, mark.col + 1, taskCharOf(!wasChecked))) flushPreview();
  }

  $effect(() => {
    const ms = pollMs;
    const id = setInterval(() => void dc.poll(), ms);
    return () => clearInterval(id);
  });

  /**
   * 경로·원본이 바뀌면 다시 읽는다 — 재연결로 세션이 바뀐 것도 여기 걸린다(`backend.key`).
   * 끊겨 있으면 읽지 않는다(부르면 `[session-gone]` 이고, 배너가 이미 그 사실을 말한다).
   */
  $effect(() => {
    const p = path;
    void backend.key;
    if (!backend.online || p === "") return;
    untrack(() => void dc.load());
  });

  /** 툴팁을 띄울 때의 지금 — 상대 시각("3초 전")을 그 순간 값으로 쓰려고 단추에 포인터·포커스가 올 때 잰다(시계를 돌리지 않는다) */
  let infoNow = $state(Date.now());

  /**
   * 자동 새로고침 정보 — 새로고침 단추 툴팁의 흐린 뒤쪽(`data-tip-sub`). 마지막으로 읽은 때를 상대 시각으로, 멈췄으면
   * "자동 새로고침 멈춤"(왜인지는 배너·띠가 이미 말한다). 아직 읽은 적 없으면 없다
   */
  const autoInfo = $derived.by(() => {
    if (!autoOn) return t("files.doc.autoinfo.off");
    if (!dc.updatedAt) return undefined;
    const ago = readAgo(infoNow - dc.updatedAt.getTime());
    return t(`files.doc.autoinfo.${ago.unit}`, { n: String(ago.n) });
  });

  /** [고정] — 단추는 누르자마자 사라지므로(미리 보기일 때만 선다) 포커스를 타일의 키보드 몸으로 되돌린다 */
  function keep() {
    onkeep?.();
    rootEl?.focus({ preventScroll: true });
  }

  /** [고정 해제] — [고정]과 같은 자리에서 바뀐다 */
  function unkeep() {
    onunkeep?.();
    rootEl?.focus({ preventScroll: true });
  }

  /** 링크 — `MarkdownBlocks` 가 이미 `http`/`https` 만 넘긴다(터미널 OSC 8 과 같은 규칙 · 같은 opener) */
  function openLink(href: string) {
    void openUrl(href).catch((e: unknown) => {
      console.error(`[aynx] 링크를 열지 못했습니다: ${href}`, e);
    });
  }

  /** 문서 링크 — `#절` 은 이 문서 안에서, 경로는 상위로. 그 밖(`mailto:` …)은 `MarkdownBlocks` 가 살리지 않는다 */
  function openDocLink(href: string) {
    const c = classifyDocHref(href);
    if (c.kind === "anchor") scrollToAnchor(c.anchor);
    else if (c.kind === "path") onopenlink?.(c.path, c.anchor);
  }

  /**
   * 코드 블록 머리 띠의 [터미널에 넣기](`DocCodeBlock`) — 셸 타일의 입력 줄에 넣기만(`app/code-to-term`). 문서 **타일**일 때만
   * (`paneId` — 새 터미널이 이 옆에 선다). 상자는 단추 아래 · 오른쪽 맞춤
   */
  const codeActions = $derived.by(() => {
    const id = paneId;
    if (!id) return undefined;
    return {
      onterm: (code: string, button: HTMLElement) => {
        const r = button.getBoundingClientRect();
        codeToTerminal(id, code, { x: r.right, y: r.bottom + 4, align: "right" }, button);
      },
    };
  });

  /**
   * 그 앵커의 제목으로 스크롤 — 본문 상자만 민다(`scrollIntoView` 는 조상의 넘침 숨김 상자까지 밀어 타일 배치를
   * 흔들 수 있다). 못 찾으면 `false`.
   */
  function scrollToAnchor(a: string): boolean {
    if (!bodyEl || !rendered) return false;
    return scrollBoxToAnchor(bodyEl, a);
  }

  /** 그 상자 안에서 앵커의 제목으로 — 읽기 본문 · 편집 중 미리 보기가 같이 쓴다 */
  function scrollBoxToAnchor(box: HTMLElement, a: string): boolean {
    const heads = [...box.querySelectorAll<HTMLElement>("[data-slug]")];
    const hit = matchAnchor(
      a,
      heads.map((h) => h.dataset.slug ?? ""),
    );
    const el = hit === null ? undefined : heads.find((h) => h.dataset.slug === hit);
    if (!el) return false;
    scrollBoxToEl(box, el);
    return true;
  }

  /** 그 상자를 밀어 안의 요소를 위쪽에 — 앵커 · 각주 오가기(`MarkdownBlocks` 의 `onjump`)가 같이 쓴다 */
  function scrollBoxToEl(box: HTMLElement, el: HTMLElement) {
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: Math.max(0, top - 8) });
  }

  /**
   * 걸린 앵커 — 글이 들어와 그려진 뒤 한 번. 읽기가 실패했으면(글 없이 오류) 그냥 돌려준다. 원문 보기면 제목이
   * 없으니 역시 돌려준다.
   */
  $effect(() => {
    const a = anchor;
    if (!a) return;
    if (dc.file === null) {
      if (dc.error !== null) untrack(() => onanchordone?.());
      return;
    }
    void blocks;
    untrack(() => {
      void tick().then(() => {
        scrollToAnchor(a);
        onanchordone?.();
      });
    });
  });

  // ── 편집으로 한 번 ([새 문서…] — `app/new-doc`) ─────────────────────────────────
  // 앵커 · 줄과 같은 한 번짜리다: 글을 읽으면 [편집] 단추와 같은 문(`dc.startEdit` — 막혔으면 아무것도 하지 않는다)으로 한 번 들어가고 돌려준다.
  // 읽기가 실패했으면 그냥 돌려준다. 편집기 지연 로딩이 실패하면 편집 면이 스스로 읽기 보기로 물러선다(`dc.editorFailed`).
  $effect(() => {
    if (!editOnce) return;
    if (dc.file === null) {
      if (dc.error !== null) untrack(() => oneditoncedone?.());
      return;
    }
    untrack(() => {
      if (!dc.editing) dc.startEdit();
      oneditoncedone?.();
    });
  });

  // ── 이 줄로 (터미널의 `파일:12` — `doc-line-jump.ts`) ─────────────────────────────
  // 앵커와 같은 한 번짜리다: 글이 들어와 그려진 뒤 한 번 가고 돌려준다(못 찾아도 · 다시 시도하지 않는다). 편집 중이면
  // 편집기를 건드리지 않고 그냥 돌려준다. 코드 보기는 그 줄에 `CodeView` 의 판을, 그린 마크다운은 그 줄이 든 최상위 블록에
  // 판(`.line-flash`)을 잠깐 깐다 — 커서 절 강조(`.sync-hl`)처럼 그린 요소에 클래스를 다는 방식이다.

  /** 코드 보기에서 강조 중인 줄(0 기준) — `CodeView` 의 `flashLine` */
  let codeFlash = $state<number | null>(null);
  /** 그린 마크다운에서 강조 중인 요소 */
  let flashEl: HTMLElement | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function stopLineFlash() {
    clearTimeout(flashTimer);
    flashTimer = undefined;
    codeFlash = null;
    flashEl?.classList.remove("line-flash");
    flashEl = null;
  }

  onDestroy(stopLineFlash);

  $effect(() => {
    const n = line;
    if (n === undefined) return;
    if (dc.editing) {
      untrack(() => onlinedone?.());
      return;
    }
    if (dc.file === null) {
      if (dc.error !== null) untrack(() => onlinedone?.());
      return;
    }
    void blocks;
    void text;
    untrack(() => {
      void tick().then(async () => {
        await jumpToLine(n);
        onlinedone?.();
      });
    });
  });

  /** 그 줄(1 기준)로 스크롤하고 잠깐 강조 — 못 찾으면 아무것도 하지 않는다 */
  async function jumpToLine(n: number) {
    const file = dc.file;
    if (!bodyEl || !file || file.binary || dc.editing) return;
    const idx = jumpLineIndex(n, text, file.truncated);
    if (idx === null) return;
    stopLineFlash();
    if (rendered) {
      const el = renderedBlockAt(idx);
      if (!el) return;
      scrollBoxToEl(bodyEl, el);
      el.classList.add("line-flash");
      flashEl = el;
    } else {
      // 판을 다시 세운다(같은 줄이어도 애니메이션이 처음부터) — 그려진 뒤 그 판 자리로 민다
      await tick();
      codeFlash = idx;
      await tick();
      const box = scroller();
      const band = box?.querySelector<HTMLElement>("[data-line-flash]");
      if (!box || !band) return;
      box.scrollTo({ top: Math.max(0, band.offsetTop - box.clientHeight / 3) });
    }
    flashTimer = setTimeout(stopLineFlash, LINE_FLASH_MS);
  }

  /**
   * 그린 마크다운에서 그 줄(0 기준)이 든 최상위 블록의 요소. `MarkdownBlocks` 는 최상위 블록마다 요소 하나를 뿌리(`.md`)의
   * 자식으로 그린다 — 개수가 맞을 때만 번호로 고른다. 어긋나면(그리는 모양이 바뀌었다 — 고칠 버그) 그 줄이 든 절의 제목으로
   * 물러선다(`sectionAt`). 그것도 없으면 `null`.
   */
  function renderedBlockAt(idx: number): HTMLElement | null {
    const root = pageEl?.querySelector<HTMLElement>(":scope > [data-markdown]");
    if (!root) return null;
    if (root.children.length === blocks.length) {
      const bi = blockAtLine(blockStartLines(text, DOC_TILE_MD), idx);
      const el = bi === null ? null : root.children[bi];
      return el instanceof HTMLElement ? el : null;
    }
    const slug = sectionAt(sectionLines(text, blocks, DOC_TILE_MD), idx);
    return slug === null ? null : root.querySelector<HTMLElement>(`[data-slug="${CSS.escape(slug)}"]`);
  }

  /** 지금 스크롤하는 상자 — 코드 보기는 `CodeView` 자신(`fill`)이, 그린 마크다운은 본문 상자가 민다 */
  function scroller(): HTMLElement | null {
    if (!bodyEl) return null;
    if (rendered) return bodyEl;
    return bodyEl.querySelector<HTMLElement>("[data-code-view]") ?? bodyEl;
  }

  // ── 목차 ─────────────────────────────────────────────────────────────────────
  // 목차 줄 · 자리 · 좁은가 · 곁 패널 · 지금 절(rAF) · 고른 자리 · 드롭다운 — `doc/outline-controller.svelte.ts`(2026-10-27 분할 6차).
  // 관찰자 · 리스너 · 효과는 아래 원래 자리 · 원래 순서 그대로다(타일 폭은 편집 보기도 읽어 여기 산다).

  /** 타일 폭 — 좁으면 곁 패널 대신 드롭다운. 못 쟀으면 0 */
  let tileWidth = $state(0);
  const oc = createDocOutline({
    get rendered() {
      return rendered;
    },
    get blocks() {
      return blocks;
    },
    get file() {
      return dc.file;
    },
    get text() {
      return text;
    },
    get outline() {
      return outline;
    },
    get tileWidth() {
      return tileWidth;
    },
    get bodyEl() {
      return bodyEl;
    },
    get rootEl() {
      return rootEl;
    },
    scrollToAnchor,
  });

  $effect(() => {
    const el = rootEl;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      tileWidth = entries[0]?.contentRect.width ?? 0;
      oc.scheduleTrack();
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // 본문 스크롤을 따라 지금 절을 다시 잰다. 휠 · 누름은 "사람이 직접 민다" 라 고른 자리를 놓는다.
  // 마크업 속성으로 달지 않는 것은 정적 상자에 손잡이를 붙이는 a11y 경고 때문이다(이 상자는 누를 것이 아니다)
  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    const release = () => oc.releasePick();
    el.addEventListener("scroll", oc.scheduleTrack, { passive: true });
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("pointerdown", release, { passive: true });
    return () => {
      el.removeEventListener("scroll", oc.scheduleTrack);
      el.removeEventListener("wheel", release);
      el.removeEventListener("pointerdown", release);
    };
  });

  // 본문 내용 상자(`.md-page`)의 크기가 바뀌면 제목 자리가 옮겨진다 — mermaid 처럼 늦게 그려지는 것 · 접혔다 펴지는
  // 표 · 늦게 온 글꼴. 스크롤이 없어도 그림 틀에 한 번 다시 잰다(처음 관찰 때도 한 번 불린다)
  let pageEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const el = pageEl;
    if (!el) return;
    const ro = new ResizeObserver(() => oc.scheduleTrack());
    ro.observe(el);
    return () => ro.disconnect();
  });

  // 글이 새로 그려졌거나 목차를 보이기 시작했으면 한 번 잰다
  $effect(() => {
    void oc.outlineItems;
    void oc.panelOpen;
    void oc.narrow;
    untrack(() => void tick().then(oc.scheduleTrack));
  });

  // 드롭다운은 좁은 타일의 것 — 넓어졌거나 목차 자리가 사라지면(원문 · 편집으로 바뀜) 닫는다
  $effect(() => {
    const keep = oc.narrow && oc.hasOutline;
    if (!keep) untrack(() => oc.closeOutlineDrop());
  });

  onDestroy(() => {
    oc.dispose();
  });

  // ── 띠의 [비교] (2026-11-11) ─────────────────────────────────────────────────
  //
  // `conflict` · `changed` 띠에만 선다. 누르는 순간 디스크를 **따로** 읽고(`dc.load` · `accept` 와 섞지 않는다 — 편집 상태 · 띠 ·
  // 기준 version 은 그대로) 편집기의 지금 글과 견준다(`doc-compare.ts`). 보기는 편집 면을 가리기만 한다(`DocEditPane` 의
  // `covered` — 편집기는 내리지 않는다). 띠가 사라지거나 `unsaved` 로 바뀌면 · 편집이 끝나면 닫는다.

  /** 비교 결과 — 서 있으면 비교 보기 */
  let compare = $state<CompareResult | null>(null);
  /** 디스크를 읽는 중 */
  let compareBusy = $state(false);
  /** 늦게 온 읽기가 닫은 뒤 · 새 [비교] 뒤에 보기를 세우지 않게 */
  let compareSeq = 0;
  /** 비교 보기의 스크롤 상자 — 찾기가 훑는다 */
  let compareEl = $state<HTMLDivElement | null>(null);

  /** [비교]를 띄울 띠인가 */
  function compareBand(): boolean {
    const b = dc.bands.band;
    return dc.editing && b !== null && b.kind !== "unsaved";
  }

  async function openCompare() {
    if (!compareBand() || compareBusy || offline || !backend.readText) return;
    const my = ++compareSeq;
    compareBusy = true;
    try {
      const got = await backend.readText(path);
      if (my !== compareSeq || !compareBand() || !editor) return;
      if (got.binary || got.truncated) {
        onnotice?.(t("files.doc.compare.unreadable"));
        return;
      }
      compare = compareTexts(got.text, editor.getText());
    } catch (e) {
      if (my !== compareSeq) return;
      onnotice?.(t("files.doc.compare.failed", { message: stripReason(e instanceof Error ? e.message : String(e)) }));
    } finally {
      if (my === compareSeq) compareBusy = false;
    }
  }

  /** 비교 보기를 닫는다 — `focus` 면 편집기로(돌아가기 · `Esc` · 보기 안에 포커스가 있었을 때) */
  function closeCompare(focus: boolean) {
    compareSeq++;
    compareBusy = false;
    compare = null;
    if (focus) void tick().then(() => editor?.focus());
  }

  // 띠가 내려갔다(저장 성공 · [무시] · [취소] · 편집 종료) · 저장 못 함 띠로 바뀌었다 — 비교 보기도 닫는다
  $effect(() => {
    if (compareBand()) return;
    untrack(() => {
      if (compare === null && !compareBusy) return;
      const inside = compareEl?.contains(document.activeElement) ?? false;
      closeCompare(dc.editing && inside);
    });
  });

  // ── 문서 안 검색 (Ctrl+F) ────────────────────────────────────────────────────

  /** 찾기 띠 — 훑기 · 칠 · 키는 `DomFindBar`(이 파일에서 떼어 냈다 — 대화 면 · diff 패치가 같이 쓴다) */
  let finder = $state<ReturnType<typeof DomFindBar> | null>(null);
  /** 찾을 글이 보이는가 — 읽은 글자 파일 · 편집 중이 아님, 또는 편집 중 비교 보기 */
  const findable = $derived(
    (dc.editing && compare !== null) || (!dc.editing && dc.file !== null && !dc.file.binary && text !== ""),
  );

  /** `find` 액션 — 편집 중이면 편집기의 검색 패널(비교 보기가 서 있으면 그 보기의 띠), 아니면 띠. 찾을 글이 없으면 `false`(터미널 검색으로 넘어간다) */
  function openFind(): boolean {
    if (dc.editing && compare !== null) return finder?.show() ?? false;
    if (dc.editing) {
      if (!editor) return false;
      editor.openSearch();
      return true;
    }
    if (!findable) return false;
    return finder?.show() ?? false;
  }

  // 찾을 글이 사라졌다(편집 시작 · 빈 파일 · 이진) — 띠를 닫는다. 포커스는 옮기지 않는다(편집기가 받는다)
  $effect(() => {
    if (!findable) untrack(() => finder?.close());
  });

  // ── 본문 우클릭 메뉴 (2026-10-25 — 줄은 `doc-menu.ts`) ──────────────────────────
  //
  // 읽기(그린 문서 · 원문/코드 · 편집 중 미리 보기)와 편집(편집기 안) 두 모양. 링크 · 고른 글은 **누른 순간의 것**을 묶어 둔다 — 메뉴가 떠 있는 동안
  // 포커스가 메뉴로 가 선택이 바뀔 수 있다(`PaneHost` 의 `TileMenu.term` 과 같은 까닭). 입력 칸(찾기 띠 · 편집기 검색 패널)은 네이티브 편집 메뉴 그대로다.

  /** 읽기 모양 줄이 부르는 동작(`doc/context-actions` 의 `runReadMenu`) — `editing` 은 실행 순간의 값 */
  const readActions: ReadMenuActions = {
    editing: () => dc.editing,
    openLink,
    openDocLink,
    openPreviewDocLink,
    openFind,
    startEdit: dc.startEdit,
  };

  function onBodyContextMenu(ev: MouseEvent) {
    // 앱 메뉴가 이미 받았다(그림 · SVG 메뉴) — 그대로 둔다
    if (ev.defaultPrevented || !onmenu) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target || target.closest("input, textarea")) return;
    ev.preventDefault();
    if (target.closest(".cm-editor") && editor) {
      const ed = editor;
      const hist = ed.historyState();
      const sel = ed.selectedText();
      const rows = docMenuItems(
        { mode: "edit", link: null, hasSelection: sel !== "", canFind: true, canEdit: false, markdown, canUndo: hist.undo, canRedo: hist.redo },
        t,
      );
      onmenu(ev.clientX, ev.clientY, { rows, run: (key) => runEditMenu(ed, key, sel, dc.save) });
      return;
    }
    const box = (compare !== null ? compareEl : dc.editing ? previewPageEl : rendered ? pageEl : bodyEl?.querySelector("[data-code-view]")) ?? bodyEl;
    if (!box) return;
    const link = target.closest("[data-href]")?.getAttribute("data-href") ?? null;
    const sel = selectionIn(box);
    const canEdit = !dc.editing && dc.file !== null && editBlockOf(dc.file) === null && backend.canWrite && !offline;
    const rows = docMenuItems(
      {
        mode: "read",
        link,
        hasSelection: sel !== "",
        canFind: findable,
        canEdit,
        markdown: false,
        canUndo: false,
        canRedo: false,
        newDoc: paneId ? newDocState(paneId) : null,
      },
      t,
    );
    onmenu(ev.clientX, ev.clientY, { rows, run: (key) => runReadMenu(key, { box, link, sel }, readActions) });
  }

  // `find` 액션의 문 — 제 타일 id 로 적는다(`app/tile-find.ts`)
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return untrack(() => registerTileFind(id, openFind));
  });

  // ── 편집 중 미리 보기 (마크다운) ─────────────────────────────────────────────

  /** 마크다운을 편집하는 중인가 — 미리 보기 · 보기 고르기는 이때만 */
  const mdEdit = $derived(dc.editing && markdown);
  /** 좁은 타일의 두 칸 탭 — 저장하지 않는다. 편집을 시작할 때 고른 값에서 정한다 */
  let narrowTab = $state<NarrowEditTab>("source");
  const wideEdit = $derived(isWideEdit(tileWidth));
  /** 지금 보이는 보기 — 넓으면 고른 값, 좁으면 탭 */
  const editShown = $derived<DocEditView>(mdEdit ? visibleEditView(editView, tileWidth, narrowTab) : "source");
  const showPreview = $derived(mdEdit && editShown !== "source");
  /** 끄는 동안의 비율 — 놓을 때 상위에 한 번 적는다(끄는 동안 배치 자동 저장을 두드리지 않게) */
  let dragSplit = $state<number | null>(null);
  let splitDrag: { left: number; width: number } | null = null;
  const splitRatio = $derived(dragSplit ?? clampDocSplit(split ?? DOC_SPLIT_DEFAULT));
  /** 스크롤 맞추기 — 타일의 한때 값(기본 켬) */
  let syncScroll = $state(true);
  const syncOn = $derived(mdEdit && syncScroll && editShown === "split");

  /** 미리 보기가 그리는 글 — 입력이 멈추고 [`PREVIEW_DELAY_MS`] 뒤에 편집기에서 옮겨 온다 */
  let previewText = $state("");
  const PREVIEW_DELAY_MS = 200;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  const previewBlocks = $derived(showPreview ? parseMarkdown(previewText, DOC_TILE_MD) : []);

  // ── 그림 ────────────────────────────────────────────────────────────────────

  /** 문서 속 그림 — 읽기 보기와 편집 미리 보기가 같은 캐시를 쓴다(같은 그림을 두 번 읽지 않는다) */
  const images = new DocImageCache();

  // 글의 그림 주소 · 백엔드(재연결 · 끊김) · 문서 version(바뀌면 읽은 그림의 바뀜을 다시 묻는다)을 따라 맞춘다
  $effect(() => {
    const srcs = [...imageSrcsOf(blocks), ...imageSrcsOf(previewBlocks)];
    const ctx = { backend, docPath: path, remote: backend.key !== LOCAL_KEY, gen: dc.file?.version ?? "" };
    void backend.online;
    untrack(() => images.sync(srcs, ctx));
  });

  onDestroy(() => images.dispose());
  const previewSections = $derived(showPreview ? sectionLines(previewText, previewBlocks, DOC_TILE_MD) : []);
  let previewEl = $state<HTMLDivElement | null>(null);
  /** 편집기 · 경계 · 미리 보기를 담는 줄 — 끄는 비율의 기준 폭 */
  let splitEl = $state<HTMLDivElement | null>(null);

  /** 편집기의 커서 줄 · 보이는 줄 범위(0 기준) */
  let cursorLine = $state(0);
  let edView = $state<EditorViewport>({ top: 0, bottom: Number.POSITIVE_INFINITY });
  /** 커서가 있는 절 — 옅은 판을 깐다 */
  const cursorSlug = $derived(syncOn ? syncTarget(previewSections, cursorLine, { top: cursorLine, bottom: cursorLine }) : null);
  /** 미리 보기를 데려갈 절 (`syncTarget` — 커서가 편집기 화면 밖이면 맨 위 줄의 절) */
  const syncSlug = $derived(syncOn ? syncTarget(previewSections, cursorLine, edView) : null);

  function stopPreviewTimer() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
  }

  /** 편집을 시작했다(`dc.startEdit` 의 원래 자리) — 미리 보기 글 · 좁은 타일 탭 · 커서 줄 · 화면 범위를 그 글로 */
  function previewOnEditStart(text: string) {
    previewText = text;
    narrowTab = narrowTabOf(editView);
    cursorLine = 0;
    edView = { top: 0, bottom: Number.POSITIVE_INFINITY };
  }

  /** 다시 불러오기로 편집을 새로 세운다(`dc.reloadForEdit` 의 원래 자리) — 타이머를 멈추고 미리 보기 글 · 커서 줄 · 화면 범위를 새 글로 */
  function previewOnEditReload(text: string) {
    stopPreviewTimer();
    previewText = text;
    cursorLine = 0;
    edView = { top: 0, bottom: Number.POSITIVE_INFINITY };
  }

  /** 편집기의 글이 바뀌었다 — 멈춘 뒤에 한 번 옮긴다 */
  function editorChanged() {
    if (!markdown) return;
    stopPreviewTimer();
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (dc.editing && editor) previewText = editor.getText();
    }, PREVIEW_DELAY_MS);
  }

  /** 기다리지 않고 지금 옮긴다 — 미리 보기를 막 열 때 */
  function flushPreview() {
    stopPreviewTimer();
    if (dc.editing && editor) previewText = editor.getText();
  }

  /** 미리 보기 상자를 그 절로 — `null` 이면 맨 위 */
  function scrollPreviewTo(slug: string | null) {
    const box = previewEl;
    if (!box) return;
    if (slug === null) box.scrollTo({ top: 0 });
    else scrollBoxToAnchor(box, slug);
  }

  /** 미리 보기를 막 보이기 시작했다 — 지금 글로 그리고 커서 절로 */
  async function revealPreviewAtCursor() {
    flushPreview();
    await tick();
    const line = editor?.cursorLine() ?? cursorLine;
    scrollPreviewTo(syncTarget(previewSections, line, { top: line, bottom: line }));
  }

  /** 세 칸 묶음 — 미리 보기가 새로 보이면 커서 절로 */
  function pickEditView(v: DocEditView) {
    const was = editShown;
    if (v !== editView) oneditview?.(v);
    if (was === "source" && v !== "source") void revealPreviewAtCursor();
    else if (v !== "preview") void tick().then(() => editor?.focus());
  }

  /** 좁은 타일의 두 칸 탭 */
  function pickNarrowTab(tab: NarrowEditTab) {
    if (tab === narrowTab) return;
    narrowTab = tab;
    if (tab === "preview") void revealPreviewAtCursor();
  }

  /** 두 칸 탭의 ←/→ — 탭 목록의 몸짓(고르면 바로 보인다) */
  function narrowTabKey(ev: KeyboardEvent) {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    const next: NarrowEditTab = narrowTab === "source" ? "preview" : "source";
    pickNarrowTab(next);
    void tick().then(() => rootEl?.querySelector<HTMLElement>(`[data-edit-tab="${next}"]`)?.focus());
  }

  /**
   * 스크롤 맞추기가 마지막으로 데려간 절(`null` = 맨 위) — 사람이 미리 보기를 직접 밀면(휠 · 누름) `undefined`.
   * 미리 보기 내용의 크기가 바뀌면(늦게 그려진 mermaid · 다시 파싱) 맞춰 둔 자리가 어긋나므로 이 절로 한 번 다시 민다 —
   * 사람이 밀어 둔 자리는 건드리지 않는다.
   */
  let alignedSlug: string | null | undefined = undefined;
  let previewPageEl = $state<HTMLDivElement | null>(null);
  let realignFrame = 0;

  // 스크롤 맞추기 — 데려갈 절이 **바뀔 때만** 민다(같은 절 안에서 치는 동안은 사람이 밀어 둔 미리 보기 그대로)
  $effect(() => {
    const slug = syncSlug;
    if (!syncOn) return;
    untrack(
      () =>
        void tick().then(() => {
          alignedSlug = slug;
          scrollPreviewTo(slug);
        }),
    );
  });

  // 미리 보기를 사람이 밀면 맞춰 둔 자리를 놓는다(위 `alignedSlug`) — 본문 상자의 `release` 와 같은 몸짓
  $effect(() => {
    const el = previewEl;
    if (!el) return;
    const release = () => (alignedSlug = undefined);
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("pointerdown", release, { passive: true });
    return () => {
      el.removeEventListener("wheel", release);
      el.removeEventListener("pointerdown", release);
    };
  });

  // 미리 보기 내용의 크기가 바뀌었다 — 맞춰 둔 절이 있으면 그림 틀에 한 번 다시 그 절로
  $effect(() => {
    const el = previewPageEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (realignFrame) return;
      realignFrame = requestAnimationFrame(() => {
        realignFrame = 0;
        if (syncOn && alignedSlug !== undefined) scrollPreviewTo(alignedSlug);
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    if (realignFrame) cancelAnimationFrame(realignFrame);
  });

  // 커서 절 제목의 옅은 판 — 다시 그리면 제목 요소가 새로 설 수 있어 그릴 때마다 다시 단다
  $effect(() => {
    const el = previewEl;
    const slug = cursorSlug;
    void previewBlocks;
    if (!el) return;
    untrack(
      () =>
        void tick().then(() => {
          for (const h of el.querySelectorAll(".sync-hl")) h.classList.remove("sync-hl");
          if (slug) el.querySelector(`[data-slug="${CSS.escape(slug)}"]`)?.classList.add("sync-hl");
        }),
    );
  });

  /** 미리 보기 속 문서 링크 — `#절` 은 미리 보기 상자 안에서, 경로는 읽기 보기와 같이 상위로 */
  function openPreviewDocLink(href: string) {
    const c = classifyDocHref(href);
    if (c.kind === "anchor") {
      if (previewEl) scrollBoxToAnchor(previewEl, c.anchor);
    } else if (c.kind === "path") onopenlink?.(c.path, c.anchor);
  }

  function startSplitDrag(ev: PointerEvent) {
    if (ev.button !== 0 || !splitEl) return;
    const r = splitEl.getBoundingClientRect();
    if (r.width <= 0) return;
    splitDrag = { left: r.left, width: r.width };
    dragSplit = splitRatio;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }

  function moveSplitDrag(ev: PointerEvent) {
    if (!splitDrag) return;
    dragSplit = splitAt(ev.clientX, splitDrag.left, splitDrag.width);
  }

  function endSplitDrag(ev: PointerEvent) {
    if (!splitDrag) return;
    splitDrag = null;
    const r = dragSplit;
    dragSplit = null;
    const el = ev.currentTarget as HTMLElement;
    if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    if (r !== null) onsplit?.(r);
  }

  /** 경계의 ←/→ — 한 번에 5%p (포커스한 경계만의 몸짓 — 전역 단축키가 아니다) */
  function splitKey(ev: KeyboardEvent) {
    const step = ev.key === "ArrowLeft" ? -0.05 : ev.key === "ArrowRight" ? 0.05 : 0;
    if (step === 0) return;
    ev.preventDefault();
    onsplit?.(clampDocSplit(splitRatio + step));
  }

  // ── 글자 크기 ────────────────────────────────────────────────────────────

  // mermaid 가 배율이 바뀌면 둘레 글자 크기로 다시 그리게 — 값은 CSS 변수가 옮긴다
  provideDocZoom(() => zoom);

  /** 바꾸기 직전 스크롤 상자의 읽던 자리(비율) — 배율이 들어온 뒤 같은 비율로 되놓는다 */
  let zoomAnchor: { el: HTMLElement; ratio: number } | null = null;

  function setZoom(next: number) {
    if (next === zoom) return;
    const el = scroller();
    zoomAnchor = el && el.scrollHeight > 0 ? { el, ratio: el.scrollTop / el.scrollHeight } : null;
    onzoom?.(next);
  }

  // 배율이 들어왔다(처음 그림 포함) — 글이 다시 흐른 뒤 읽던 자리로 · 편집기는 다시 잰다. 목차 지금 절 · 미리 보기 맞추기 ·
  // mermaid 맞춤 폭은 각자의 `ResizeObserver` 가 내용 크기 변화로 잡는다
  $effect(() => {
    void zoom;
    untrack(() =>
      void tick().then(() => {
        editor?.remeasure();
        const a = zoomAnchor;
        zoomAnchor = null;
        if (a && a.el.isConnected) a.el.scrollTop = a.ratio * a.el.scrollHeight;
      }),
    );
  });

  /**
   * `Ctrl+휠` — 굴린 양을 모아 한 눈금마다 한 단계(mermaid 확대와 같은 셈 — 터치패드 집기가 끝까지 튀지 않게). 다이어그램
   * 위면 `MermaidView` 가 이미 막았다(`defaultPrevented`) — 그 확대가 먼저다. 수동 등록인 까닭: `preventDefault` 를 하려면
   * passive 가 아니어야 한다(웹뷰 확대 단축키는 꺼져 있지만 페이지 스크롤은 막아야 한다).
   */
  /**
   * 본문 상자의 높이 — 확대한 mermaid 상자의 높이 상한(그 80%)을 CSS 변수 `--doc-mmd-max` 로 내려 준다. `70vh` 는 창 기준이라
   * 짧은 타일에서는 상자가 타일보다 커져 다이어그램 안을 미는 것과 문서를 미는 것이 엉켰다. 못 쟀으면 `MermaidView` 의 70vh
   */
  let bodyH = $state(0);
  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    const ro = new ResizeObserver((entries) => (bodyH = entries[0]?.contentRect.height ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  });
  const mermaidMax = $derived(bodyH > 0 ? `${Math.round(bodyH * 0.8)}px` : null);

  const ZOOM_WHEEL_STEP = 50;
  let zoomWheelAcc = 0;
  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey || ev.defaultPrevented) return;
      if ((ev.target as Element | null)?.closest?.("[data-mermaid]")) return;
      ev.preventDefault();
      zoomWheelAcc += ev.deltaMode === 0 ? ev.deltaY : ev.deltaY * 40;
      if (Math.abs(zoomWheelAcc) < ZOOM_WHEEL_STEP) return;
      const d = zoomWheelAcc;
      zoomWheelAcc = 0;
      setZoom(wheelDocZoom(zoom, d));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const LINE_PX = 40;

  function onkeydown(ev: KeyboardEvent) {
    // 편집 중 `Ctrl+S` — 편집기 안이면 편집기가 이미 잡았다(`defaultPrevented`). 도구줄 · 띠에 포커스가 있어도 저장
    if (dc.editing && !ev.defaultPrevented && ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && ev.code === "KeyS") {
      ev.preventDefault();
      void dc.save();
      return;
    }
    if (dc.editing) return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const target = ev.target as HTMLElement | null;
    if (target && target.closest("button, input, textarea, select, .cm-editor")) return;
    oc.releasePick();
    const el = scroller();
    if (!el) return;
    const page = Math.max(LINE_PX, el.clientHeight * 0.9);
    let handled = true;
    switch (ev.key) {
      case "ArrowDown":
        el.scrollBy({ top: LINE_PX });
        break;
      case "ArrowUp":
        el.scrollBy({ top: -LINE_PX });
        break;
      case "ArrowRight":
        el.scrollBy({ left: LINE_PX });
        break;
      case "ArrowLeft":
        el.scrollBy({ left: -LINE_PX });
        break;
      case "PageDown":
        el.scrollBy({ top: page });
        break;
      case "PageUp":
        el.scrollBy({ top: -page });
        break;
      case "Home":
        el.scrollTo({ top: 0 });
        break;
      case "End":
        el.scrollTo({ top: el.scrollHeight });
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
  }
  // 타일 제목줄 개편(2026-10-20) — 머리줄이 서 있으면 이 도구줄이 머리줄 가운데로 올라가 한 줄이 된다(`pane/pane-tools.svelte.ts`).
  // 머리줄이 없으면(설정 `tile_header` · 폰) 예전처럼 몸 맨 위에 그린다. 스니펫이라 어디에 그려지든 이 화면의 상태 · 단축키가 그대로다.
  const inHead = $derived(!!paneId && paneHeadShown(paneId));
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return setPaneTools(id, { bar: docBar, tail: docTail, span: () => headSpan });
  });
  // 머리줄 ④판(10-20 — 쿼리 타일과 같은 규칙 `pane/head-span`): 목차 토글은 이름 뒤(`tail`)이고, 목차 패널이 열려 있으면(넓은 타일 · 본문 **왼쪽**)
  // 왼쪽 무리(아이콘 · 이름 · 토글)가 패널 경계까지를 쥔다(`span` — 문서 도구가 본문 열 위에서 시작). 좁은 타일의 "지금 절 ▾" 도 같은 `tail` 자리다(10-20 실기 — 넓음 ↔ 좁음에 단추가 튀지 않게).
  const headSpan = $derived(docHeadSpan(oc.panelOpen));
</script>

<!-- 목차 곁 패널 토글 — 머리줄 안이면 테두리 없는 아이콘 단추(쿼리 타일의 트리 토글과 같은 결 — `inhead`), 몸 위 줄이면 예전 단추.
     제목이 없으면 흐린 채 서서 툴팁이 까닭을 말한다 -->
{#snippet outlineToggle(head: boolean)}
  <button
    type="button"
    class={head ? "outline-toggle inhead" : "btn ico"}
    data-head-act
    class:on={!head && oc.panelOpen}
    aria-pressed={oc.panelOpen}
    disabled={!oc.hasOutline}
    title={oc.hasOutline ? t("files.doc.outline") : t("files.doc.outline.none")}
    aria-label={t("files.doc.outline")}
    onclick={() => onoutline?.(!outline)}><UiIcon name="side-panel" size={head ? 14 : 13} /></button
  >
{/snippet}

<!-- 좁은 타일의 목차 드롭다운 단추 — 넓은 타일의 토글과 **같은 그림**(`side-panel`)에 ▾ 를 붙인 것(지금 절 이름은 글자로 두지 않고 말풍선에만 — 10-20 사용자, DB 타일 트리 드롭다운과 같은 꼴).
     머리줄 안이면 토글과 같은 자리(이름 뒤 `tail`) · 같은 결(테두리 없음 — 아이콘이 토글과 같은 x 에 선다)이라 넓음 ↔ 좁음 전환에 단추가 튀지 않는다.
     몸 위 줄이면 도구줄 맨 앞(예전 테두리 단추) -->
{#snippet outlineDropButton(head: boolean)}
  <button
    type="button"
    class={head ? "outline-drop inhead" : "btn outline-drop"}
    data-head-act
    bind:this={oc.outlineButton}
    title={t("files.doc.outline.drop.title", { name: oc.curName })}
    aria-label={t("files.doc.outline.drop.title", { name: oc.curName })}
    aria-haspopup="dialog"
    aria-expanded={oc.outlineDrop !== null}
    onclick={() => (oc.outlineDrop ? oc.closeOutlineDrop() : oc.openOutlineDrop())}
    ><UiIcon name="side-panel" size={head ? 14 : 13} /><UiIcon
      name="chevron-down"
      size={12}
    /></button
  >
{/snippet}

<!-- 이름 뒤 조각(머리줄이 그린다) — 넓은 타일은 목차 토글(패널이 열려 있으면 무리 오른쪽 끝 = 패널 경계), 좁은 타일은 같은 자리의 드롭다운 단추 -->
{#snippet docTail()}
  {#if oc.outlineSlot}
    {#if oc.narrow && oc.hasOutline}{@render outlineDropButton(true)}{:else}{@render outlineToggle(true)}{/if}
  {/if}
{/snippet}

<!-- 도구줄 — 머리줄이 서 있으면 머리줄 가운데(`head` = 참)에, 아니면 몸 맨 위에 그린다(위 `inHead` · `pane/pane-tools.svelte.ts`).
     머리줄 안에서 포커스 밖이면 조작 단추(`data-head-act`)는 접히고 글자 크기 · 미리 보기 핀 · 저장 표시(● · 저장됨)는 남는다
     ("늘 보임 / 드러날 때만"). 미리 보기 핀은 누르면 고정하는 단추지만 "다음 파일이 이 칸을 갈아 끼운다" 를 말하는 표지라 남긴다.
     **경로 글자는 없다**(10-20 사용자) — 이름은 머리줄이 말하고, 전체 경로는 타일 ⋯ 의 [경로 복사] 줄이 말풍선으로 보여 주고 복사한다 -->
{#snippet docBar(head: boolean)}
  <DocToolbar
    {head}
    {headSpan}
    outlineSlot={oc.outlineSlot}
    narrow={oc.narrow}
    hasOutline={oc.hasOutline}
    {outlineToggle}
    {outlineDropButton}
    {mdEdit}
    {wideEdit}
    {editView}
    {pickEditView}
    {editShown}
    bind:syncScroll
    {narrowTab}
    {narrowTabKey}
    {pickNarrowTab}
    {zoom}
    {setZoom}
    {preview}
    {keep}
    editing={dc.editing}
    {onunkeep}
    {unkeep}
    dirty={dc.dirty}
    savedFlash={dc.savedFlash}
    saving={dc.saving}
    {offline}
    save={dc.save}
    endEdit={dc.endEdit}
    {markdown}
    {rendered}
    {onmode}
    {showEdit}
    {editTitle}
    editBlock={dc.editBlock}
    startEdit={dc.startEdit}
    {backend}
    openExternally={dc.openExternally}
    editRemote={dc.editRemote}
    {autoInfo}
    bind:infoNow
    loading={dc.loading}
    load={dc.load}
  />
{/snippet}

<!--
  `tabindex="-1" data-tile-focus` — 이 상자가 **타일의 키보드 몸**이다 (`routeTileFocus` 가 여기 포커스를 준다).
  탭 순회에는 끼지 않는다.
-->
<div
  class="doc"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  bind:this={rootEl}
  style:--doc-zoom={zoom / 100}
  style:--doc-mmd-max={mermaidMax}
  {onkeydown}
>
  <!--
    도구줄 단추는 **아이콘만**이다 — 이름은 툴팁 · `aria-label`(같은 글)이고, 부연 설명은 두지 않는다. 툴팁이 이름과
    다른 것은 **비활성 까닭**뿐이다(편집 불가 · 목차 없음). 미리 보기의 **[고정] 핀**은 점선 테두리로 임시임을 말하고,
    다른 조작처럼 포커스 밖에서는 접힌다(`data-head-act` — 그때는 이름의 기울임이 말한다). 좁은 타일(`isNarrowOutline`)에서는 목차가 드롭다운으로 바뀐다.
  -->
  {#if !inHead}{@render docBar(false)}{/if}

  <!-- 문서 안 검색 띠 — 열기는 `openFind`(앱의 `find` 액션), 닫으면 키보드는 본문으로 -->
  <DomFindBar
    bind:this={finder}
    root={compare !== null ? compareEl : bodyEl}
    scroller={() => (compare !== null ? compareEl : scroller())}
    label={t("files.doc.find")}
    onclose={() => (compare !== null ? compareEl : rootEl)?.focus({ preventScroll: true })}
  />

  {#if oc.outlineDrop}
    <button
      type="button"
      class="menu-backdrop"
      tabindex="-1"
      aria-label={t("files.menu.close.aria")}
      onclick={oc.closeOutlineDrop}
      oncontextmenu={(ev) => {
        ev.preventDefault();
        oc.closeOutlineDrop();
      }}
    ></button>
    <div
      class="outline-pop menu-surface"
      role="dialog"
      aria-label={t("files.doc.outline")}
      style:left={`${oc.outlineDrop.x}px`}
      style:top={`${oc.outlineDrop.y}px`}
      style:width={`${oc.outlineDrop.w}px`}
      style:max-height={`${oc.outlineDrop.maxH}px`}
    >
      <!-- 항목은 메뉴 통로를 지난다 — 고른 줄을 먼저 쥐고, 닫고, 간다 -->
      <DocOutline
        items={oc.outlineItems}
        current={oc.curIdx}
        variant="drop"
        onpick={(it) => runOnMenu(() => it, oc.closeOutlineDrop, oc.pickOutline)}
        onescape={oc.escapeOutlineDrop}
      />
    </div>
  {/if}

  <!-- 편집 중 띠 — 충돌 · 디스크 바뀜(같은 문구, 단추만 다르다) · 저장 못 함(글은 그대로 — 복사는 된다) -->
  {#if dc.editing && dc.bands.band}
    {@const band = dc.bands.band}
    {#if band.kind === "conflict" || band.kind === "changed"}
      <p class="banner wait" role="alert">
        <span class="err-text">{t("files.doc.conflict")}</span>
        <span class="acts">
          <!-- [비교] — 디스크를 따로 읽어 내 편집과 나란히(읽기 전용). 비교 보기가 서 있어도 다시 누르면 새로 읽는다 -->
          <button
            type="button"
            class="retry primary"
            disabled={offline || compareBusy || !backend.readText}
            aria-busy={compareBusy}
            onclick={() => void openCompare()}
            >{compareBusy ? t("files.doc.compare.busy") : t("files.doc.compare")}</button
          >
          <!-- 띠의 단추를 누르면 비교 보기는 닫힌다(포커스는 옮기지 않는다 — 다시 불러오기는 새 편집기가 가져간다) -->
          <button
            type="button"
            class="retry"
            disabled={offline || dc.loading}
            onclick={() => {
              closeCompare(false);
              void dc.reloadForEdit();
            }}>{t("files.doc.conflict.reload")}</button
          >
          {#if band.kind === "conflict"}
            <button
              type="button"
              class="retry"
              disabled={offline || dc.saving}
              onclick={() => {
                closeCompare(false);
                void dc.save(true);
              }}>{t("files.doc.conflict.overwrite")}</button
            >
            <button type="button" class="retry" onclick={dc.dismissBand}
              >{t("files.doc.conflict.cancel")}</button
            >
          {:else}
            <button type="button" class="retry" onclick={dc.ignoreBand}
              >{t("files.doc.conflict.ignore")}</button
            >
          {/if}
        </span>
      </p>
    {:else}
      <p class="banner err" role="alert">
        <span class="err-text"
          >{band.why === "gone"
            ? t("files.doc.unsaved.gone")
            : band.why === "missing"
              ? t("files.doc.unsaved.missing")
              : t("files.doc.unsaved.error", { message: band.message ?? "" })}</span
        >
        <button type="button" class="retry" onclick={dc.dismissBand}
          >{t("files.doc.band.dismiss")}</button
        >
      </p>
    {/if}
  {/if}

  <!-- 배너 둘은 뜻이 다르다 — 기다리면 돌아온다(대기) · 돌아오지 않는다(원본 없음). 파일 브라우저와 같은 문구 -->
  {#if sourceGone}
    <p class="banner gone">{t("files.browser.source.gone")}</p>
  {:else if offline}
    <p class="banner wait">
      {alias ? t("files.browser.offline.alias", { alias }) : t("files.browser.offline")}
    </p>
  {/if}

  <!-- 다른 창에서 옮겨 온 저장 안 한 글 — 편집기에 들이기 전(읽는 중 · 막힘). 들일 수 있게 되면 저절로 편집으로 이어지고 띠는 사라진다 -->
  {#if heldDraft && !dc.editing}
    <p class="banner {draftBlock === 'wait' || draftBlock === 'offline' || draftBlock === null ? 'wait' : 'err'}" role="alert">
      <span class="err-text">{t(`files.doc.draft.${draftBlock ?? "wait"}`)}</span>
      <span class="acts">
        {#if draftBlock === "read" || draftBlock === "editor"}
          <button type="button" class="retry" disabled={offline} onclick={retryDraft}>{t("files.browser.retry")}</button>
        {/if}
        <button type="button" class="retry" onclick={() => void copyDraft()}>{t("files.doc.draft.copy")}</button>
        <button type="button" class="retry" onclick={() => void discardDraft()}>{t("files.doc.draft.discard")}</button>
      </span>
    </p>
  {/if}

  {#if dc.error}
    <p class="banner err">
      <span class="err-text">{dc.error}</span>
      <button type="button" class="retry" onclick={() => void dc.load()} disabled={offline}>
        {t("files.browser.retry")}
      </button>
    </p>
  {/if}

  {#if dc.file && !dc.file.binary}
    {#if dc.file.truncated}
      <!-- 두 수를 같은 형식기로 — 단위가 섞이면("2 MiB · 2.4MB") 비교가 안 된다. 형식기는 파일 목록의 것
           (`formatSize` — "4.1 MB")이 정본이다: 문서는 파일 타일에서 열리고, 두 화면이 나란히 선다 -->
      <p class="band">
        {t("files.doc.truncated", { shown: formatSize(TEXT_VIEW_MAX_BYTES), size: formatSize(dc.file.size) })}
      </p>
    {/if}
    {#if dc.file.lossy}
      <p class="band">{t("files.doc.lossy")}</p>
    {/if}
    {#if plain}
      <p class="band">{t("files.doc.plain")}</p>
    {/if}
  {/if}

  <!-- 본문 줄 — 넓은 타일에서 목차를 켰으면 왼쪽에 곁 패널. `.md-page` 의 가운데 배치는 남은 폭 안에서다 -->
  <div class="content">
    {#if oc.panelOpen}
      <nav class="outline-panel" aria-label={t("files.doc.outline")} style:--outline-w="{OUTLINE_PANEL_W}px">
        <DocOutline
          items={oc.outlineItems}
          current={oc.curIdx}
          variant="panel"
          onpick={oc.pickOutline}
          onescape={() => rootEl?.focus({ preventScroll: true })}
        />
      </nav>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="body" class:md={rendered} bind:this={bodyEl} oncontextmenu={onBodyContextMenu}>
      {#if dc.editing && dc.file}
        <!-- 편집 면 — 편집기 · 경계 · 미리 보기(`doc/DocEditPane.svelte`). 손에 쥘 넷은 `bind:` 로 돌아온다 -->
        <DocEditPane
          bind:editor
          bind:splitEl
          bind:previewEl
          bind:previewPageEl
          editGen={dc.editGen}
          text={dc.editText}
          restore={dc.editRestore}
          onready={editorReady}
          {path}
          {editShown}
          {splitRatio}
          dragging={dragSplit !== null}
          {showPreview}
          {previewBlocks}
          {images}
          tasks={editTasks}
          save={dc.save}
          setDirty={dc.setDirty}
          {editorChanged}
          oncursor={(line) => (cursorLine = line)}
          onviewport={(top, bottom) => (edView = { top, bottom })}
          editorFailed={onEditorFailed}
          {startSplitDrag}
          {moveSplitDrag}
          {endSplitDrag}
          {splitKey}
          {onsplit}
          {openLink}
          {openPreviewDocLink}
          onjump={(el) => previewEl && scrollBoxToEl(previewEl, el)}
          {codeActions}
          covered={compare !== null}
        />
        {#if compare !== null}
          <!-- 띠의 [비교] — 편집 면을 가리기만 한다(편집기는 위에 숨은 채 산다). 좁은 타일은 한 칸 -->
          <DocCompareView bind:scrollEl={compareEl} result={compare} wide={wideEdit} onback={() => closeCompare(true)} />
        {/if}
      {:else if dc.file === null}
        {#if dc.loading}<p class="note">{t("files.doc.loading")}</p>{/if}
      {:else if dc.file.binary}
        <div class="binary">
          <p class="note">{t("files.doc.binary")}</p>
          {#if backend.canOpenExternal}
            <button type="button" class="retry" onclick={() => void dc.openExternally()}>{t("files.menu.openexternal")}</button>
          {/if}
          {#if backend.canEdit}
            <button type="button" class="retry" disabled={offline} onclick={() => void dc.editRemote()}
              >{t("files.menu.edit.external")}</button
            >
          {/if}
        </div>
      {:else if text === ""}
        <p class="note">{t("files.doc.empty")}</p>
      {:else if rendered}
        <div class="md-page" bind:this={pageEl}>
          <MarkdownBlocks
            {blocks}
            onlink={openLink}
            ondoclink={openDocLink}
            onjump={(el) => bodyEl && scrollBoxToEl(bodyEl, el)}
            diagrams
            tasks={readTasks}
            {images}
            {codeActions}
          />
        </div>
      {:else}
        <CodeView code={text} {lang} lineNumbers fill flashLine={codeFlash} />
      {/if}
    </div>
  </div>
</div>

<style>
  /* 타일을 꽉 채운다 — 파일 브라우저와 같은 바탕(합성된 패널 색) */
  .doc {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* 글래스 크롬 타일이면 판(흐림 + `--glass-mid`)은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명 · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
    color: var(--fg);
    font-family: var(--font-ui);
  }

  .doc:focus {
    outline: none;
  }

  /*
   * 머리줄 안의 목차 토글(④판) — 쿼리 타일의 트리 토글(`QueryView` 의 `.tree-toggle.inhead`)과 같은 결: 테두리 없이 아이콘만, 호버 · 누르는
   * 순간 옅은 판(24px). 머리줄 왼쪽 무리의 칸이라 포커스 밖에서 접힐 때 지울 앞 간격 = 머리줄 `gap`(`--head-act-gap` — `PaneHeader` "드러냄" 절).
   */
  .outline-toggle.inhead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 24px;
    height: 24px;
    margin: 0;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    --head-act-gap: var(--space-2);
  }

  .outline-toggle.inhead:hover:not(:disabled) {
    color: var(--fg-2);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

  .outline-toggle.inhead:active:not(:disabled) {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 11%, var(--surface-hover));
  }

  .outline-toggle.inhead:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .outline-toggle.inhead:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 1.4em;
    padding: 3px 7px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* 아이콘만 선 단추 — 정사각 한 크기(목차 드롭다운처럼 글자가 내용인 단추만 이 밖이다) */
  .btn.ico {
    width: 24px;
    height: 24px;
    padding: 0;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  /* 켜진 토글(목차 · 원문 보기 · 편집 보기 · 스크롤 맞추기) — 파일 타일 도구줄(`.bar-btn.on`)과 같은 말: 강조 면 하나 */
  .btn.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  /* 좁은 타일 — 문구 옆에 단추가 들어갈 자리가 없으면 단추(무리)가 문구 아래 줄로 내려간다(`.err-text` 의 바탕 폭 · `.acts`) */
  .banner,
  .band {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 10px;
    font-size: 11px;
    line-height: 1.4;
    border-bottom: 1px solid var(--border);
  }

  /* 기다리면 돌아온다 — 경고(앰버) */
  .banner.wait {
    color: var(--warn);
    background: var(--warn-soft);
  }

  /* 돌아오지 않는다 · 실패 */
  .banner.gone,
  .banner.err {
    color: var(--err);
    background: var(--err-soft);
  }

  /* 알림 띠(잘림 · 대체 문자 · 강조 끔) — 고장이 아니라 사정이다: 흐린 글자 */
  .band {
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  /*
   * 문구 — 바탕 폭(16em)을 두어 줄 나눔이 "문구 16em + 단추" 가 한 줄에 드는가로 정해지게 한다. 들면 지금처럼 한 줄(문구가 남는 폭을
   * 채운다), 안 들면 단추가 아래 줄로 가고 문구는 한 줄을 다 쓴다. 바탕 폭 없이(`auto`) 줄지 않게만 하면 긴 문구가 넓은 타일에서도
   * 단추를 밀어 내리고, 줄 나눔 없이 줄게만 두면 `overflow-wrap: anywhere` 탓에 한 글자 폭까지 눌린다(긴 경로 · 오류 글을 꺾으려 둔 값).
   */
  .err-text {
    flex: 1 1 16em;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* 단추 무리 — 아래 줄로 갈 때 한 덩이로 간다. 그 줄에서도 넘치면 안에서 줄을 바꾼다 */
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    max-width: 100%;
  }

  .retry {
    flex: 0 0 auto;
    padding: 2px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .retry:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .retry:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* 띠의 먼저 볼 단추([비교]) — 강조색 채움 */
  .retry.primary {
    color: var(--on-accent);
    background: var(--accent);
    border-color: var(--accent);
  }

  .retry.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  /*
   * 본문 — 코드 보기는 `CodeView`(fill)가 스스로 스크롤하므로 여기는 넘치지 않게만 잡고, 그린 마크다운은
   * 이 상자가 세로로 민다. 글은 고를 수 있다(선택 + Ctrl+C).
   */
  .content {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* 목차 곁 패널 — 폭 고정(`--outline-w` = `pane/head-span` 의 `OUTLINE_PANEL_W` — 머리줄 무리 폭과 한 값), 목록은 제 상자에서 민다 */
  .outline-panel {
    flex: 0 0 var(--outline-w);
    width: var(--outline-w);
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--line);
  }

  /* 좁은 타일의 목차 드롭다운 — 높이 상한은 자리 셈이 준다, 목록이 그 안에서 민다 */
  .outline-pop {
    position: fixed;
    z-index: 41;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
  }

  /* 지금 절 단추 — 줄면 말줄임 */
  .btn.outline-drop {
    flex: 0 0 auto;
  }

  /*
   * 머리줄 안의 목차 드롭다운 단추(좁은 타일 — 이름 뒤 `tail`). 넓은 타일의 `.outline-toggle.inhead` 와 같은 결 · 높이이고, 왼쪽 안쪽 여백을
   * (24 − 14) / 2 = 5px 로 두어 아이콘이 토글의 아이콘과 같은 x 에 선다. 지금 절 이름은 말풍선에만 있다.
   */
  .outline-drop.inhead {
    /* 글자 없이 그림 둘(패널 · ▾)이라 줄지 않는다 — 줄면 ▾ 부터 잘린다(10-20) */
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    box-sizing: border-box;
    height: 24px;
    margin: 0;
    padding: 0 5px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    --head-act-gap: var(--space-2);
  }

  .outline-drop.inhead :global(svg) {
    flex: 0 0 auto;
  }

  .outline-drop.inhead:hover {
    color: var(--fg-2);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

  .outline-drop.inhead:active,
  .outline-drop.inhead[aria-expanded="true"] {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 11%, var(--surface-hover));
  }

  .outline-drop.inhead:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    user-select: text;
  }

  .body.md {
    overflow: auto;
  }

  /* 읽는 폭은 920px 까지 — 타일이 더 넓으면 양옆을 비워 가운데 둔다 */
  .md-page {
    max-width: 920px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-5);
    /* 글자 크기 배율(`--doc-zoom` — 위 "글자 크기"). 읽는 폭 상한은 그대로라 크게 하면 한 줄에 드는 글자가 준다 */
    font-size: calc(var(--t-sm) * var(--doc-zoom, 1));
    line-height: 1.6;
    color: var(--fg-1);
  }

  /* "이 줄로" 의 블록 강조 — 커서 절 강조(`.sync-hl`)와 같은 둥근 판이되 선택 줄 색(`--accent-soft`), 2초에 걸쳐 사라진다.
     판을 가진 블록(코드 · 표)은 제 판이 덮으므로 바깥 고리(그림자)로도 보인다. 움직임 줄이기면 전환 없이 있다가 걷힌다 */
  .md-page :global(.line-flash) {
    border-radius: var(--radius);
    animation: doc-line-flash 2s ease-out forwards;
  }

  @keyframes -global-doc-line-flash {
    from {
      background-color: var(--accent-soft);
      box-shadow: 0 0 0 4px var(--accent-soft);
    }
    to {
      background-color: transparent;
      box-shadow: 0 0 0 4px transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .md-page :global(.line-flash) {
      animation: none;
      background-color: var(--accent-soft);
      box-shadow: 0 0 0 4px var(--accent-soft);
    }
  }

  .note {
    margin: 0;
    padding: var(--space-4);
    font-size: 12px;
    color: var(--fg-2);
  }

  .binary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-right: var(--space-4);
  }
</style>
