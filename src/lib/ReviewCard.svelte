<script lang="ts">
  /**
   * **화면 아래 가운데 검토 대기 카드** — AI 가 올린 작업안이 사람을 기다리는 동안 사라지지
   * 않는 한 장이고, **그 자리에서 승인·거절**을 받는다
   * (docs/log/2026-09-27-review-popup-card.md · 앞선 판 docs/log/2026-09-22-review-card.md).
   *
   * ## 왜 있는가
   *
   * 요청이 화면에 닿는 길은 2026-09-22 오전에 이미 고쳤다 — `operation-state` 가 요청 **그
   * 자리에서** 나온다(docs/log/2026-09-22-review-request-signal.md). 그때는 토스트 한 줄도
   * 함께 떴는데, 그것은 6초 뒤 사라지고 남는 흔적은 상태바의 작은 숫자 하나뿐이었다. 자리를
   * 비웠다 돌아온 사람은 여전히 아무것도 못 본다. 이 카드는 **대기가 0 이 될 때까지** 붙어
   * 있고, 그래서 같은 날 그 토스트(와 자동 승인 거부 토스트)를 **걷어 이 카드로 접었다** —
   * 한 사실을 두 자리에서 말하지 않는다.
   *
   * ## 승인 단추가 **여기 있다** (2026-09-27 — 앞선 판의 "일부러 없다" 를 뒤집었다)
   *
   * 앞선 판은 [검토] 와 [거절] 둘뿐이었다. 카드가 **한 줄 발췌**만 보여 주었기 때문이다 —
   * 거기서 승인이 나가면 사람이 실제로 무엇을 허락했는지 모른 채 누르는 길이 생긴다. 그
   * 규칙의 뜻은 "단추를 어디에 둘까" 가 아니라 **"승인은 명령 전문이 보이는 자리에서만"** 이다.
   *
   * **10-22 두 줄 접기**: 명령 · SQL 상자는 보이는 줄 두 줄에서 접힌다([전체 보기]). 그래서 이 원칙이 단추에 걸린다 — 잘린 채
   * 펼치지 않은 카드의 **첫 [승인]은 승인이 아니라 펼치기**다(전문을 보이고 "전체 명령을 확인한 뒤 다시 누르세요"). 그다음 누름이
   * 승인. 위험이면 첫 누름의 확인 상태가 펼치기를 겸해 **두 번을 넘지 않는다**(10-24). 다 보이는 짧은 명령은 예전 그대로다. 판정은
   * `review-card.ts` `approveStep` 하나 — 작업안 카드의 [실행 승인] 도 같은 판정을 쓴다(10-27 — 확인 패널을 걷고 카드에서 바로).
   *
   * 이 판의 카드는 그 조건을 스스로 채운다: 명령 **전문**(줄바꿈 그대로 · 넘치면 안에서
   * 스크롤)·위험 배지·대상 목록(첫 대상 = canary 표시)·경로·검증 명령·자동 승인 거부 사유를
   * 다 싣는다. 위험 명령은 관제판처럼 **한 번 더** 눌러야 나간다(첫 클릭은 확인 상태로 바꿀
   * 뿐). 그러니 원칙은 그대로이고 문이 하나 늘었을 뿐이다 — 그 대가로 카드 → [검토] → 전체
   * 화면 대시보드 → 승인 → 닫기라는, 하던 일의 맥락을 끊는 왕복이 사라졌다.
   *
   * ## 승인 요약 — 두 줄만 더한다 (2026-10-21 · docs/log/2026-10-21-approval-summary.md · 목업 "⓪ 작은 카드")
   *
   * 카드는 **커지지 않는다**(폭 그대로). 더한 것은 둘이다: ① `AI` 표지를 단 **AI 가 쓴 설명** 한 줄(두 줄에서 말줄임 · 누르면
   * 전부) ② **앱 분석 칩 줄**(두 줄까지) — 앱이 원문만 보고 매긴 효과(`읽기만 · 선언과 일치` 초록 / `선언과 다름 — 원문에 삭제`
   * 실패색) · 프로그램 사슬 · sudo · 자동 승인 거부 사유 · DB 면 문장마다 `DELETE users · WHERE 있음` · `WHERE 없음 — 테이블 전체`
   * (실패색) · 상한. 판정은 Rust 의 것 그대로다(`operations/analysis.rs` — 칩은 `analysisChips` 가 고를 뿐). **선언과 다름 · WHERE 없는
   * 쓰기**면 위험 명령과 똑같이 테두리가 실패색이고 [승인]을 두 번 눌러야 나간다. AI 설명은 믿지 않는 글자라 표지 없이 그리지 않는다.
   * 옛 작업안(설명 · 분석 없음)은 예전 그대로 그린다.
   *
   * ## 판결 띠 · 명령 나눠 보기 (2026-10-24 — 목업 "A + 명령 나눠 보기")
   *
   * 긴 명령의 카드가 "깔끔하지 않다" 는 실기 피드백(글자 벽 명령 상자 · 따로 선 [접기] 줄 · 명령을 되풀이하는 프로그램 사슬 칩 ·
   * 빨강 네 번 · 칩 모양 다섯)으로 다시 짰다. 위에서부터: ① **판결 띠**(`VerdictBand` — 가장자리까지 닿는 한 줄, 이 명령이 무엇인지 ·
   * AI 설명과 맞는지 · 오른쪽 끝에 ‹ › · 만료 · 접기 — 옛 "검토 대기" 머리줄 · 위험 배지 · 효과 / 어긋남 칩을 대신한다) ② 제목
   * ③ AI 설명 ④ 명령 — Rust 가 맨 위 줄을 둘 이상 실어 보낸 셸 명령은 **줄마다 한 행**(`CommandLines` — 번호 · 읽기 아닌 줄 강조 · AI 설명보다
   * 센 줄의 표지 · [원문 보기]), 그 밖은 두 줄 접기 그대로 ⑤ DB 면 연결 머리줄 · 문장 칩 ⑥ **메타 줄**(`ReviewMeta` — 대상 · 경로 ·
   * 검증 · sudo · 자동 승인 거부를 흐린 한 줄에) ⑦ 단추. 나눠 보기는 숨는 것이 없어 첫 [승인]이 펼치기로 쓰이지 않는다.
   *
   * 카드에 **없는** 것: "승인하면서 자동 승인 목록에 추가"(관제판의 체크박스). 목록을 넓히는
   * 결정은 제안된 규칙을 미리 보고 내려야 하는 별개의 결정이라 관제판에만 둔다.
   *
   * ## 포커스를 **절대** 뺏지 않는다 (보안 판단)
   *
   * 승인 단추가 생긴 순간 이것이 가장 위험한 자리다: 터미널에 치던 Enter 가 카드의 [승인]에
   * 닿으면 사람은 보지도 않은 작업안을 승인한다. 그래서 —
   *
   * 1. autofocus 도, 나타날 때·바뀔 때의 `focus()` 도 **없다**.
   * 2. 단추를 **마우스로** 눌러도 포커스가 옮겨 오지 않는다 — 카드 상자의 `mousedown` 이
   *    단추 위에서만 기본 동작을 막는다(`keepFocus`). 클릭은 그대로 나가고 포커스는 치던
   *    터미널에 남는다. 그래서 [거절]을 누른 뒤 치는 Enter 가 다음 작업안의 단추에 닿지 않는다.
   * 3. 키보드로 들어오는 길은 사람이 **스스로** 탭으로 옮겨 오는 것뿐이다. 그렇게 들어와 승인·
   *    거절을 누르면 곧바로 포커스를 **놓는다**(`dropFocus`) — 다음 작업안이 같은 자리에
   *    들어앉으므로, 손에 남은 두 번째 Enter 가 그것을 승인하면 안 된다.
   * 4. 카드 안에서 누른 Escape 는 위험 확인을 풀고 포커스를 놓는다(창의 Escape 사슬로 새지
   *    않게 여기서 끊는다). 전역 키바인딩은 조합(`Ctrl+Shift+…` 등)만 잡으므로 이 카드로
   *    길이 나지 않는다 — 카드는 창 키 표(`app/keys`)에 **어떤 자리도 없다**.
   *
   * ## 어디에 사는가 — 층과 자리
   *
   * `+page` 의 `.body` 안, **아래 가운데**다. 오른쪽 위는 토스트 기둥(`Toasts.svelte`, 120),
   * 위 가운데는 에이전트 알림 배너(`AgentNotifyBanners.svelte`, 105)의 자리라 둘 다 비켜 섰다.
   * `.body` 안에 두는 것이 요점이다: 아래 상태바가 서면 `.body` 가 그 위에서 끝나므로 카드는
   * 저절로 **상태바 바로 위**에 서고, 옆 상태바면 그 기둥 안쪽에 선다 — 상태바 높이를 숫자로
   * 적을 자리가 없다(배너와 같은 이유).
   *
   * z-index 는 **갈래마다 다르다**:
   * - 평소 카드 **95** — 사용량 화면(90) 위, 독·모달·기록 보기(100)
   *   아래. 접속 대화(호스트 키·암호)나 독이 뜨면 그것이 카드를 덮는다 — 사람이 지금 답해야
   *   할 것이 먼저고, 카드는 그 뒤에도 그대로 남아 있다. 팔레트·검색(110)·상태바의 알림 상자와
   *   셸 메뉴(121)·말풍선(130)도 모두 위라, 아래 상태바에서 위로 펼쳐지는 것들이 카드에 가려지지
   *   않는다.
   * - 가림막 아래에서는 카드가 서지 않는다 — 검토 대기 **수**는 가림막 화면(`Veil.svelte`)이 잠금 카드 밑에 그린다
   *   (2026-10-28 — 예전엔 이 카드가 가림막(115) 위 118 에 한 줄로 섰다).
   *
   * **메인 창 전용이다** — `startPendingPlans()` 는 `boot()` 이 메인 창에서만 걸므로 분리
   * (`tear-*`) 창에서는 목록이 영영 비어 있고 카드는 뜨지 않는다. 상태바 배지와 같은 규칙이다.
   */
  import {
    autoRefusals,
    pendingPlans,
    refreshPendingPlans,
  } from "$lib/app/pending-plans.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { openPlansAt, plansShown } from "$lib/app/plans.svelte.js";
  import { showNotice } from "$lib/app/notice";
  import { approveOperation, rejectOperation } from "$lib/operations";
  import { approveStep, hasFoldedDetail, reasonShown, reviewCardModel, splitLines } from "$lib/review-card";
  import AiNote from "$lib/AiNote.svelte";
  import AiSummaryLine from "$lib/AiSummaryLine.svelte";
  import AnalysisChips from "$lib/AnalysisChips.svelte";
  import CommandClamp from "$lib/CommandClamp.svelte";
  import CommandLines from "$lib/CommandLines.svelte";
  import ReviewMeta from "$lib/ReviewMeta.svelte";
  import VerdictBand from "$lib/VerdictBand.svelte";
  import { windowTargetLookup } from "$lib/console/window-rows";
  import { findDbConn } from "$lib/app/db-conns.svelte.js";
  import { DB_ENGINE_ICON, type DbEngine } from "$lib/db-conn";
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 만료 문구용 시계 — 30초에 한 칸. **카드가 떠 있는 동안만** 돈다(관제판의 경과 시계와
   * 같은 규칙): 대기가 0 이면 타이머도 없어야 앱이 조용하다.
   */
  const TICK_MS = 30_000;
  let now = $state(Date.now());

  /**
   * 사람이 ‹ › 로 고른 작업안 — **id 로** 쥔다(자리 번호로 쥐면 앞의 것이 빠질 때 다른 작업안이
   * 조용히 그 자리에 들어앉는다 · `reviewCardModel` 주석). `null` = 맨 앞.
   */
  let selectedId = $state<string | null>(null);

  /**
   * **[나중에]로 치운 작업안 id** (2026-11-13 사용자 요청 — 카드가 타일을 가리는 동안 타일 내용을 보고 싶다). 누른 그 순간 대기 중이던
   * 작업안을 **모두** 담는다 — 한 건만 치우면 다음 건이 같은 자리에 곧바로 떠 목적이 막힌다. 치운 것은 채팅 독의 작업안 칸(배지 수)에서
   * 승인 · 거절한다. **새 작업안은 여기 없으므로 카드가 다시 선다** — "새 요청은 한 번은 보여야 한다"(아래 접힘 주석)는 그대로다.
   * 창마다 · 이번 페이지 동안만(저장하지 않는다). 목록을 떠난 id 는 아래 효과가 버린다.
   */
  let deferred = $state<ReadonlySet<string>>(new Set());
  const shownPlans = $derived(pendingPlans().filter((o) => !deferred.has(o.operationId)));

  /**
   * **작업안이 보이는 동안에는 물러난다** (2026-10-07 작업안 타일 → 2026-10-25 채팅 독의 작업안 갈래 · 원격은 제 덮개).
   *
   * 작업안은 이 카드가 말하려던 것을 이미 더 크게 보여 준다 — 명령 전문 · 위험 배지 · 대상 목록 ·
   * 만료 · 승인/거절. 같은 작업안의 승인 단추가 한 화면에 두 벌이면 어느 쪽이 무엇을 가리키는지
   * 헷갈린다. 독이 닫혔거나 채팅 갈래를 보고 있으면 카드가 그대로 선다.
   * 판정은 `plansShown()` 하나다.
   */
  const model = $derived(
    plansShown()
      ? ({ kind: "hidden" } as const)
      : reviewCardModel(shownPlans, veilVisible(), now, autoRefusals(), selectedId, (id) => findDbConn(id)?.via),
  );

  /** DB 엔진 글자 → 이름(모르는 글자는 그대로) */
  function engineName(engine: string): string {
    return ["sqlite", "postgres", "mysql", "mariadb"].includes(engine)
      ? t(`app.query.engine.${engine}` as "app.query.engine.sqlite")
      : engine;
  }

  // 시계는 **불리언 하나**에 건다 — `model` 에 걸면 그 `model` 이 `now` 를 읽으므로, 아래에서
  // `now` 를 쓰는 순간 제 효과를 다시 깨운다(틱마다 인터벌을 새로 거는 헛바퀴).
  const showingCard = $derived(model.kind === "card");
  $effect(() => {
    if (!showingCard) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), TICK_MS);
    return () => clearInterval(id);
  });

  /**
   * 접힘 — 이 컴포넌트만의 상태다(저장하지 않는다). **영구 닫기는 없다**: 대기가 남아 있는
   * 동안 화면에서 지울 수 있으면 이 기능의 존재 이유가 사라진다. ([나중에] — 위 `deferred` — 는 그 대기를 채팅 독의 작업안 칸
   * 배지로 넘길 뿐이고 새 작업안은 다시 카드를 세운다 · 2026-11-13 사용자 결정.)
   *
   * 머리 작업안이 바뀌면 **다시 펴진다**. 접어 둔 채 새 요청이 오면 사람은 "1건" 이 "2건" 이
   * 된 것만 보고 무엇이 왔는지는 못 본다 — 새 요청은 한 번은 보여야 한다.
   */
  let collapsed = $state(false);
  let lastHead = $state<string | null>(null);
  $effect(() => {
    const id = model.kind === "card" ? model.headId : null;
    if (id === lastHead) return;
    lastHead = id;
    collapsed = false;
  });

  /**
   * **위험 확인 상태** — 위험 명령의 [승인]을 한 번 누른 작업안 id. 두 번째 클릭만 승인을
   * 보낸다(관제판의 [계속] → [확인했습니다 — 실행] 과 같은 두 걸음 · 재타이핑은 아니다).
   *
   * 다른 무엇이든 건드리면 풀린다 — ‹ › 로 넘기기 · 접기 · 머리 작업안이 바뀜 · Escape. 확인은
   * "지금 보고 있는 **이** 명령" 에 대한 것이라, 화면이 조금이라도 바뀐 뒤에 남아 있으면 다른
   * 것을 확인한 셈이 된다. 아래 효과가 머리·보이는 작업안이 바뀔 때마다 푼다.
   */
  let armedId = $state<string | null>(null);
  const armed = $derived(model.kind === "card" && armedId === model.op.operationId);

  /**
   * **명령 나눠 보기**의 줄들(10-24 — Rust 가 맨 위 줄을 둘 이상 실어 보낸 셸 명령) — 있으면 `CommandLines`, 없으면 두 줄 접기
   * `CommandClamp`. 나눠 보기는 아무것도 숨기지 않으므로 승인 판정의 `hidden` 은 거짓이다(`approve`).
   */
  const split = $derived(model.kind === "card" ? splitLines(model.op) : null);

  /**
   * 명령 · SQL 상자를 펼쳤는가 · 접으면 잘리는가 · "전체를 보고 다시 누르세요" 를 띄웠는가(10-22 — `CommandClamp`). 잘린 채 펼치지
   * 않았으면 첫 [승인]은 펼치기다(`approveStep` — 머리말 "승인은 명령 전문이 보이는 자리에서만"). 보이는 작업안이 바뀌면 셋 다 푼다.
   */
  let cmdExpanded = $state(false);
  let cmdTruncated = $state(false);
  let revealHint = $state(false);

  /**
   * 머리 id 와 보이는 작업안 id 를 **글자 하나로** 묶는다 — `model` 자체는 30초 시계와 목록
   * 갱신마다 새 객체라, 그것에 걸면 아무것도 바뀌지 않았는데 확인이 풀린다. 원시값 `$derived`
   * 는 값이 같으면 아래 효과를 깨우지 않는다.
   */
  const viewKey = $derived(model.kind === "card" ? `${model.headId}|${model.op.operationId}` : null);

  $effect(() => {
    // 머리가 바뀌거나 보이는 작업안이 바뀌면 확인·펼침을 푼다.
    void viewKey;
    armedId = null;
    cmdExpanded = false;
    cmdTruncated = false;
    revealHint = false;
  });

  // 고른 것이 목록을 떠났으면(승인·거절·만료) 쥐고 있던 id 도 버린다 — 모델은 이미 맨 앞으로
  // 떨어졌지만(순수 함수의 몫), 쥔 채로 두면 같은 id 가 되살아날 일은 없어도 상태가 거짓말을 한다.
  $effect(() => {
    if (selectedId !== null && !shownPlans.some((o) => o.operationId === selectedId)) {
      selectedId = null;
    }
  });

  // 치운 것 중 목록을 떠난 id(승인 · 거절 · 만료)는 버린다 — 집합이 끝없이 자라지 않게.
  $effect(() => {
    if (deferred.size === 0) return;
    const live = new Set(pendingPlans().map((o) => o.operationId));
    if ([...deferred].some((id) => !live.has(id))) {
      deferred = new Set([...deferred].filter((id) => live.has(id)));
    }
  });

  /** [나중에] — 지금 대기 중인 작업안을 모두 카드에서 치운다(위 `deferred` 주석). 포커스도 놓는다(머리말 3) */
  function later(): void {
    armedId = null;
    dropFocus();
    deferred = new Set([...deferred, ...pendingPlans().map((o) => o.operationId)]);
  }

  /** 승인·거절이 날아가는 동안 — 두 단추를 함께 막는다(두 번 보내지 않는다) */
  let busy = $state(false);

  /** 이 창의 타일로 대상 이름을 얹는 표 — 관제판 작업안 카드와 **같은 함수**다 */
  const targetLookup = $derived(windowTargetLookup(t));

  let root = $state<HTMLElement | null>(null);

  /** 만료 오른쪽 문구 — `null`=만료 없음 · `0`=곧 만료 · 그 외 N분 */
  function expiryText(minutes: number | null): string {
    if (minutes === null) return t("app.review.expires.none");
    if (minutes <= 0) return t("app.review.expires.soon");
    return t("app.review.expires", { n: minutes });
  }

  /** ‹ › — 목록 안에서 한 칸 옮긴다(끝에서 멈춘다 · 돌지 않는다) */
  function step(delta: number): void {
    if (model.kind !== "card") return;
    const list = shownPlans;
    const next = model.index + delta;
    if (next < 0 || next >= list.length) return;
    selectedId = list[next].operationId;
  }

  /**
   * 단추 위의 `mousedown` 기본 동작을 막는다 — 클릭은 그대로 나가되 **포커스는 옮겨 오지
   * 않는다**(머리말 "포커스를 절대 뺏지 않는다" 2). 단추가 아닌 곳(명령 상자)은 그대로 둔다 —
   * 거기는 글자를 긁어 복사하는 자리다.
   */
  function keepFocus(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    if ((ev.target as Element | null)?.closest("button")) ev.preventDefault();
  }

  /** 카드 안에 포커스가 있으면 놓는다(머리말 3) — 다음 작업안이 같은 단추 자리에 들어앉는다 */
  function dropFocus(): void {
    const el = document.activeElement;
    if (el instanceof HTMLElement && root?.contains(el)) el.blur();
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation(); // 창의 Escape 사슬(다른 모달·독 닫기)로 새지 않게
    armedId = null;
    dropFocus();
  }

  /**
   * [승인] — 위험 명령은 첫 클릭에 확인 상태로만 바뀌고 두 번째에 나간다.
   *
   * 오류 처리는 관제판 `doApprove` 와 같다 — 백엔드 사유를 `board.notice.rejected` 로 알리고
   * (상한 초과 · 위임 밖 대상 등) 목록을 다시 읽는다. 성공해도 곧바로 다시 읽는다: 승인된
   * 작업안이 대기에서 빠지는 것을 이벤트·30초 그물까지 기다리지 않는다. 결과는 작업안
   * 타일이 복구 루프에서 주워 그린다(자동 승인과 같은 길 — 낙관적 실행 뷰는 없다).
   */
  async function approve(): Promise<void> {
    if (model.kind !== "card" || busy) return;
    const { op, risk } = model;
    const step = approveStep({
      // 나눠 보기 · 원문 보기는 전문을 다 싣는다(안에서 스크롤) — 잘린 것이 없다.
      hidden: split === null && cmdTruncated && !cmdExpanded,
      risky: risk === "dangerous",
      armed: armedId === op.operationId,
    });
    if (step === "reveal") {
      // 잘린 명령을 승인하지 않는다 — 먼저 전문을 펼쳐 보인다(머리말 "승인은 명령 전문이 보이는 자리에서만").
      cmdExpanded = true;
      revealHint = true;
      return;
    }
    if (step === "arm") {
      // 확인 상태가 펼치기를 겸한다 — 승인 단추가 [확인했습니다 — 실행] 으로 바뀌는 그 순간 전문이 보인다(`approveStep`).
      // 다 보이는 짧은 명령 · 나눠 보기는 펼칠 것이 없다(펼치면 쓸모없는 [접기] 줄만 선다).
      if (cmdTruncated) cmdExpanded = true;
      armedId = op.operationId;
      revealHint = false;
      return;
    }
    revealHint = false;
    busy = true;
    armedId = null;
    dropFocus();
    try {
      const r = await approveOperation(op.operationId, "manual");
      if (r.error) showNotice(t("board.notice.rejected", { reason: r.error }));
      await refreshPendingPlans();
    } finally {
      busy = false;
    }
  }

  /**
   * [거절] — 거절하고 **곧바로** 목록을 다시 읽는다.
   *
   * `reject_operation`(Rust)은 거절한 그 작업안에 대해 `operation-state` 를 내보내지 않는다
   * (내보내는 것은 함께 쓸려 만료된 것들뿐이다 — `src-tauri/src/operations.rs`). 그래서
   * 이벤트만 기다리면 카드가 다음 건으로 넘어가는 데 30초 그물까지 걸린다.
   */
  async function reject(): Promise<void> {
    if (model.kind !== "card" || busy) return;
    const id = model.op.operationId;
    busy = true;
    armedId = null;
    dropFocus();
    try {
      const ok = await rejectOperation(id);
      if (ok === null) showNotice(t("app.review.reject.failed"));
      await refreshPendingPlans();
    } finally {
      busy = false;
    }
  }

  function collapse(): void {
    armedId = null;
    collapsed = true;
  }
</script>

<!--
  **이 카드는 `aria-live` 를 끈다.** 30초마다 바뀌는 만료 문구가 있어, 살아 있는 영역이면
  스크린리더가 그 틱마다 명령문까지 통째로 다시 읽는다. 카드는 "방금 일어난 일" 이 아니라
  **머물러 있는 상태**라 읽어 줄 거리가 처음 한 번뿐이다 — `role="group"` 에 이름만 붙인다.
  (앞선 판은 토스트 기둥의 `aria-live="polite"` 상자 안이라 그것을 끄는 것이 요점이었다.
  이제 제 자리에 서므로 끌 상자가 없지만, 명시해 둔다 — 누가 다시 live 상자 안에 넣어도 같은
  결론이 나게.)
-->
<!--
  가림막 아래(`veiled`)에서는 카드가 **아무것도 그리지 않는다** — 검토 대기 수는 가림막 화면이 잠금 카드 밑 요약에 그린다
  (2026-10-28 잠금 화면 통일 · `Veil.svelte`). 자리를 비운 사이 지나가는 사람에게 AI 가 무엇을 하려 했는지 보여 줄 이유가 없다는
  결정은 그대로다 — 그쪽도 수만 보인다.
-->
{#if model.kind === "card"}
  {@const op = model.op}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="rcard"
    class:danger={model.risk === "dangerous"}
    role="group"
    aria-live="off"
    aria-label={t("app.review.label")}
    bind:this={root}
    onmousedown={keepFocus}
    onkeydown={onKeydown}
  >
    {#if collapsed}
      <!-- 접힌 꼴 — 한 줄에 "검토 대기 N건 · [펼치기]" 만 -->
      <div class="line">
        <span class="dot" aria-hidden="true">●</span>
        <span class="count">{t("app.review.count", { n: model.total })}</span>
        <button
          type="button"
          class="expand btn btn-ghost btn-sm"
          title={t("app.review.expand")}
          onclick={() => (collapsed = false)}>{t("app.review.expand")}</button
        >
      </div>
    {:else}
      <!--
        **판결 띠**(10-24 "A + 명령 나눠 보기") — 카드 맨 위 가장자리까지 닿는 한 줄: 이 명령이 무엇인지 · AI 설명과 맞는지(`verdictOf`).
        예전의 "검토 대기" 머리줄 · 제목 줄의 위험 배지 · 효과 / 어긋남 칩이 하던 말을 여기 하나로 모았다. 오른쪽 끝은 ‹ i / N › · 만료 · 접기.
      -->
      <VerdictBand verdict={model.verdict}>
        {#snippet end()}
          {#if model.total > 1}
            <span class="nav">
              <button
                type="button"
                class="navbtn"
                aria-label={t("app.review.prev")}
                title={t("app.review.prev")}
                disabled={model.index === 0}
                onclick={() => step(-1)}
                ><UiIcon name="chevron-left" size={13} /></button
              >
              <span class="pos">{t("app.review.position", { i: model.index + 1, n: model.total })}</span>
              <button
                type="button"
                class="navbtn"
                aria-label={t("app.review.next")}
                title={t("app.review.next")}
                disabled={model.index >= model.total - 1}
                onclick={() => step(1)}><UiIcon name="chevron" size={13} /></button
              >
            </span>
          {/if}
          <span class="expiry" class:soon={model.expiryMinutes !== null && model.expiryMinutes <= 0}
            >{expiryText(model.expiryMinutes)}</span
          >
          <button
            type="button"
            class="chev"
            aria-label={t("app.review.collapse")}
            title={t("app.review.collapse")}
            onclick={collapse}><UiIcon name="chevron-down" size={13} /></button
          >
        {/snippet}
      </VerdictBand>

      <div class="scroll">
        <!-- 순서(10-24): 판결 띠 → 제목 → AI 설명 → 명령(DB 면 연결 머리줄 · 문장 · 문장 칩) → 메타 줄 → 단추 -->
        {#if op.title}
          <div class="title">{op.title}</div>
        {/if}

        <!-- **AI 가 쓴 설명**(승인 요약) — 작업안 카드와 같은 조각(`AiSummaryLine` — `AI` 표지 없이 그리지 않는다) -->
        <AiSummaryLine operationId={op.operationId} summary={op.summary} />

        {#if model.db}
          {@const d = model.db}
          <!--
            **DB 쓰기 작업안**(쿼리 타일 3b) — 셸 명령 상자 · 대상 대신: 연결 이름 · 엔진 · DB · 경유(화면의 연결 목록에서 찾은 별칭),
            문장 **전문**(SQL 구문 강조 — 이 상자가 있어서 승인 단추가 선다, 셸 명령과 같은 원칙), 문장 칩 · 상한, 한 트랜잭션 문장. 영향 행을
            세지 않는 문장(DDL · TRUNCATE · WITH …)이 있으면 상한이 막지 못한다는 줄을 경고색으로 — 그때 [승인]은 두 번 눌러야 나간다.
          -->
          <div class="dbhead" data-review-db={d.engine}>
            {#if d.engine in DB_ENGINE_ICON}
              <HostIcon icon={DB_ENGINE_ICON[d.engine as DbEngine]} size={14} label={engineName(d.engine)} />
            {:else}
              <UiIcon name="database" size={13} />
            {/if}
            <span class="dbname">{d.connName}</span>
            <span class="dbmeta"
              >{engineName(d.engine)}{#if d.database}&nbsp;· {d.database}{/if}{#if d.via}&nbsp;· {t("app.review.db.via", {
                  host: d.via,
                })}{/if}</span
            >
          </div>
          {#if split}
            <!--
              문장 나눠 보기(10-24) — 셸 명령과 같은 상자: 문장마다 한 행 · 동사 · 테이블 낱말 표시 · WHERE 없는 쓰기 줄은 실패색과
              "… · WHERE 없음" 표지. 문장 칩은 줄이 같은 말을 하므로 걷고 상한 칩만 남긴다. 숨는 것이 없다(승인 판정의 `hidden` 은 거짓).
            -->
            <CommandLines operationId={op.operationId} command={op.command} lines={split} reason={op.reason} maxRows={16} />
            <AnalysisChips {op} only={["limit"]} />
          {:else}
            <!-- 줄이 없는 옛 작업안 — SQL 구문 강조 접기 상자 + 문장 칩 · 상한 -->
            <CommandClamp
              text={d.sql}
              lang="sql"
              more={hasFoldedDetail(op)}
              expanded={cmdExpanded}
              onToggle={() => (cmdExpanded = !cmdExpanded)}
              onTruncated={(v) => (cmdTruncated = v)}
            />
            <AiNote label={t("app.review.reason.label")} text={reasonShown(op, cmdExpanded)} />
            <!-- DB 문장 칩 · 상한(작업안 카드와 같은 조각) — 효과 · 어긋남은 판결 띠가 말한다 -->
            <AnalysisChips {op} only={["stmt", "limit"]} />
          {/if}
        {:else if split}
          <!--
            **명령 나눠 보기**(10-24) — 맨 위 줄이 둘 이상인 셸 명령은 줄마다 한 행(번호 · 효과 점 · 원문 · AI 설명보다 센 줄의 표지).
            숨는 것이 없다(열네 줄 넘으면 상자 안에서 스크롤 · 원문 보기도 접지 않는다) — 그래서 [승인]이 펼치기로 쓰이지 않는다.
            AI 가 적은 요청 배경은 범례 줄의 [요청 배경] 이 연다.
          -->
          <!-- 열여섯 줄 — 실기의 9줄 명령(접혀 15줄)이 끝의 표지까지 스크롤 없이 보이는 높이 -->
          <CommandLines operationId={op.operationId} command={op.command} lines={split} reason={op.reason} maxRows={16} />
        {:else}
          <!--
            **명령 상자** — 두 줄에서 말줄임 + [전체 보기](`CommandClamp` — 작업안 카드와 같은 조각). 잘린 채로는 승인이 나가지
            않는다 — 첫 [승인]이 펼친다(머리말). 펼치면 열 줄까지 상자 **안에서** 스크롤한다(카드가 화면을 밀어 올리지 않게).
          -->
          <CommandClamp
            text={op.command}
            more={hasFoldedDetail(op)}
            expanded={cmdExpanded}
            onToggle={() => (cmdExpanded = !cmdExpanded)}
            onTruncated={(v) => (cmdTruncated = v)}
          />
          <!--
            AI 가 적은 이유 — 작은 카드에는 없다(설명과 겹치고 표지 없는 문단은 앱 글로 읽힌다 · 10-22). 펼쳤을 때만 `AI` 표지와 함께.
            기록 상세(작업안 타일의 기록)에는 늘 남는다.
          -->
          <AiNote label={t("app.review.reason.label")} text={reasonShown(op, cmdExpanded)} />
        {/if}

        <!--
          **메타 줄**(10-24) — 대상(첫 대상에 흐린 "(먼저)" = canary · 넷을 넘으면 "대상 N ▸" 로 접힘) · 경로 · 검증 · sudo · 자동 승인 거부
          사유(대상 호스트에 '무인 실행' 이 위임되지 않았을 때 등 — 서버 사유 그대로)를 흐린 한 줄에 ` · ` 로 잇는다(`ReviewMeta`).
        -->
        <ReviewMeta {op} {targetLookup} autoRefused={model.autoRefused} targets={model.db === null} />

        {#if model.db}
          {@const d = model.db}
          <div class="meta">
            {#if !op.analysis}
              <!-- 옛 작업안 — 상한은 이제 문장 칩 줄(`상한 N행`)이 말한다 -->
              <span class="metaline" data-review-db-max={d.maxAffected}
                >{t("app.review.db.max", { n: d.maxAffected, count: d.statementCount })}</span
              >
            {/if}
            <span class="metaline">{t("app.review.db.tx")}</span>
            {#if d.uncounted > 0}
              <span class="metaline warnline">{t("app.review.db.uncounted", { n: d.uncounted })}</span>
            {/if}
          </div>
        {/if}

        {#if revealHint}
          <!-- 잘린 명령에 [승인]을 눌렀다 — 펼쳐 보였으니 확인하고 다시(머리말 "승인은 명령 전문이 보이는 자리에서만") -->
          <p class="warn" data-reveal-hint>{t("app.review.cmd.revealHint")}</p>
        {/if}
        {#if armed}
          <!-- 위험 확인 상태 — 작업안 카드의 확인 상태와 같은 문장 -->
          <p class="warn">{t("board.confirm.warn")}</p>
        {/if}
      </div>

      <!-- 아랫줄 — (왼쪽) 작업안에서 보기 · (오른쪽) 거절 · 승인 -->
      <div class="line foot">
        <button
          type="button"
          class="link"
          onclick={() => openPlansAt(op.operationId)}>{t("app.review.plans")}</button
        >
        <button
          type="button"
          class="later btn btn-ghost btn-sm"
          title={t("app.review.later.title")}
          data-review-later
          onclick={later}>{t("app.review.later")}</button
        >
        <button
          type="button"
          class="reject btn btn-ghost btn-sm"
          disabled={busy}
          onclick={() => void reject()}>{t("app.review.reject")}</button
        >
        <!--
          승인 — 안전 = 채운 강조 한 번. 위험 = 실패색 테두리의 빈 단추(강조색으로 권하지 않는다) → 누르면 옅은 실패색 판의
          [확인했습니다 — 실행] 으로 바뀌고 그 두 번째 클릭만 나간다.
        -->
        {#if model.risk === "dangerous"}
          <button
            type="button"
            class="approve btn btn-sm {armed ? 'danger-solid' : 'danger-outline'}"
            title={t(armed ? "app.review.approve.danger.title" : "app.review.approve.arm.title")}
            disabled={busy}
            onclick={() => void approve()}
            >{armed ? t("app.review.approve.danger") : t("app.review.approve")}</button
          >
        {:else}
          <button
            type="button"
            class="approve btn btn-primary btn-sm"
            disabled={busy}
            onclick={() => void approve()}>{t("app.review.approve")}</button
          >
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /*
    토스트와 **같은 말투**다 — 글꼴·배경·테두리·그림자 토큰을 그대로 쓴다. 자리만 다르다:
    `.body` 의 아래 가운데(머리말의 "어디에 사는가"). 폭은 560 이 상한이고 좁은 창에서는 양옆
    16px 거터를 남긴다(가로 스크롤이 생기지 않게 — `.body` 가 `overflow:clip` 이기도 하다).
    `overflow: hidden` 은 맨 위 판결 띠가 둥근 모서리까지 닿게 하려는 것이다(띠는 음수 여백으로 가장자리에 붙는다).
  */
  .rcard {
    position: absolute;
    left: 50%;
    bottom: var(--space-3);
    z-index: 95;
    transform: translateX(-50%);
    box-sizing: border-box;
    width: min(560px, calc(100% - 32px));
    /* 짧은 창에서도 띠·아랫줄이 창 밖으로 나가지 않게 — 가운데(.scroll)가 줄어든다 */
    max-height: calc(100% - 2 * var(--space-3));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    overflow: hidden;
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-raised);
  }

  /* 판결 띠 — 카드의 위 · 양옆 가장자리까지(여백을 되돌린다). 띠 아래는 카드의 사이 간격 그대로 */
  .rcard > :global(.vband) {
    flex: none;
    margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-3)) 0;
  }

  /* 위험 명령 — 테두리만 실패색으로 물든다(배경까지 물들이면 명령 글자 대비가 흔들린다 · 무엇이 위험한지는 띠가 말한다) */
  .rcard.danger {
    border-color: color-mix(in srgb, var(--err) 45%, var(--line-strong));
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .nav {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .pos {
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  /* DB 작업안(쿼리 타일 3b) — 연결 머리줄 · 문장 상자(넘치면 안에서 스크롤) · 경고 줄 */
  .dbhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .dbname {
    font-weight: var(--fw-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dbmeta {
    color: var(--fg-2);
    font-size: var(--t-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warnline {
    color: var(--warn);
  }

  .expiry {
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }
  /* 만료가 지났다 — 다음 읽기에서 Rust 가 만료시킨다. 색으로만 급함을 말한다. */
  .expiry.soon {
    color: var(--warn);
  }

  .dot {
    flex: none;
    color: var(--warn);
  }

  /* 가운데 — 제목부터 경고까지. 창이 짧으면 이 칸만 줄고 안에서 스크롤한다 */
  .scroll {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    overflow-y: auto;
    user-select: text;
  }

  .title {
    min-width: 0;
    font-weight: var(--fw-semibold);
    overflow-wrap: anywhere;
  }

  /* DB 의 한 트랜잭션 · 세지 않는 문장 줄 — 문장이 길어 메타 줄과 따로 */
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
  .metaline {
    overflow-wrap: anywhere;
  }

  .warn {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--err);
  }

  .foot .later {
    margin-left: auto;
  }

  /*
    폰 · 태블릿(원격 웹 R5) — 손가락으로 누를 단추는 44px 높이(거절 · 승인). 원격 창의 모바일 배치(`.app.mobile`)에서는 카드가 거의
    화면 폭을 쓰고 아래 키 띠 바로 위에 앉는다.
  */
  @media (pointer: coarse) {
    .foot .later,
    .foot .reject,
    .foot .approve,
    .foot .link {
      min-height: 44px;
      padding-inline: 16px;
      font-size: var(--t-md, 14px);
    }
  }
  :global(.app.mobile) .rcard {
    width: calc(100% - 16px);
    bottom: 8px;
  }
  :global(.app.mobile) .foot .later,
  :global(.app.mobile) .foot .reject,
  :global(.app.mobile) .foot .approve {
    min-height: 44px;
    padding-inline: 16px;
  }
  .later,
  .reject,
  .approve,
  .expand {
    flex: none;
  }
  .expand {
    margin-left: auto;
  }

  /*
    위험 명령의 단추 — 확인 전 = 실패색 테두리의 빈 단추(회색 채움이 아니다 — 누르라고 권하지 않되 무엇이 다른지는 보인다),
    확인 상태 = 관제판 `.btn.danger-solid` 와 같은 옅은 실패색 판(그쪽은 스코프돼 있다).
  */
  .btn.danger-outline,
  .btn.danger-outline:hover {
    color: var(--err);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--err);
  }
  .btn.danger-outline:hover {
    background: color-mix(in srgb, var(--err) 10%, transparent);
  }
  .btn.danger-solid {
    color: var(--err);
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }
  .btn.danger-solid:hover {
    background: color-mix(in srgb, var(--err) 22%, var(--err-soft));
  }

  /* "작업안에서 보기" — 흐린 작은 글자 단추(밑줄 없이 · 올리면 밑줄). 주 동작이 아니다 */
  .link {
    flex: none;
    padding: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    background: transparent;
    border: 0;
    cursor: pointer;
    text-underline-offset: 2px;
  }
  .link:hover {
    color: var(--fg-1);
    text-decoration: underline;
  }

  .chev,
  .navbtn {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .chev:hover,
  .navbtn:hover:not(:disabled) {
    color: var(--fg-1);
    background: var(--surface-hover);
  }
  .navbtn:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
