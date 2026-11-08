/**
 * **오케스트레이션 홈의 여는 흐름**(2026-10-30 오케스트레이션 탭 ④ — docs/log/2026-10-29-orchestration-player-tab.md 2-1 · 2-2 · D6 → 2단계 단계 6 —
 * aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md 5-3 · 6절).
 *
 * 여기 사는 것: 홈 입력 칸의 초안(프로듀서 · 스튜디오 · 첫 지시 — 창 안 화면 상태 · 저장 안 함 — `app/orch-home-draft`) · 고를 수 있는 프로듀서
 * CLI · **[새 프로듀서로 이어받기]**([`adoptWithNewProducer`] — 그 앨범 탭에 프로듀서 채팅을 세우고 입력 칸에 이어받기 문장을 **채우기만**) ·
 * 앨범마다 직전 프로듀서 값 · 스튜디오 카드 ▶([`pickStudio`]).
 *
 * 홈의 "새 앨범" 칸에서 보내는 첫 말은 프로듀서 채팅 잎(`player/ProducerLeaf`)이 그 자리에서 채팅으로 보낸다. (단계 6) 1단계의 ▶ 앨범 시작 —
 * 왼쪽에 터미널 프로듀서 AI 타일을 세우고 준비되면 첫 지시를 PTY 로 보내던 길(머리말 · 첫 지시 기다림 · [보내지 않기])은 걷었다.
 *
 * ## 보안 원칙과의 관계(노트 D6)
 *
 * - **이어받기 문장은 채우기만 한다**(앱이 지은 글 — 사람이 그 채팅의 입력 칸에서 보고 [보내기]). 앱이 보이지 않는 글을 보내는 길은 없다.
 * - 새 앨범은 `NewAlbum`이 사람의 제출로 시작한다. 이어받기는 `mode:adopt`로 귀속만 세우며, 조율은 사람이 보낸 뒤 AI의 `adopt_run`으로 잇는다.
 */

import { t } from "$lib/i18n/i18n.svelte.js";
import { showNotice } from "$lib/app/notice";
import { activeTab, currentWorkspaceTabs } from "$lib/app/tabs.svelte.js";
import { openAlbumTab, openOrchHome, placeProducerLeaf } from "$lib/app/orchestration.svelte.js";
import { findHomeTab, producerLeafOf, newProducerChatId } from "$lib/orchestration/orch-tab";
import { albumScreens } from "./album-screen.svelte.js";
import { fillProducer as fillProducerChat, openProducer, type ProducerTarget } from "$lib/app/producer-chat.svelte.js";
import { listAiClis, offeredAiClis } from "$lib/session";
import { settings } from "$lib/settings.svelte.js";
import { isRemote } from "$lib/ipc";
import { homeDraft, selectHomeStudio } from "$lib/app/orch-home-draft.svelte.js";
import { lastProducerOf } from "./producer-record";

/** 홈 입력 칸의 초안(`app/orch-home-draft` — 여는 길과 함께 쓰는 한 칸) */
export { homeDraft };

/** 고를 수 있는 프로듀서 CLI(설치된 것 · 끈 에이전트 빼고 — `startOrchestrationHere` 와 같은 원천) */
export async function producerClis(): Promise<{ command: string; id: string; name: string }[]> {
  return offeredAiClis(await listAiClis(), settings.disabledAgents);
}

/**
 * **[새 프로듀서로 이어받기] · [프로듀서 다시 붙이기]**(라이브러리 · 막대 — 2단계 단계 3 · 노트 5-3): 그 앨범의 탭(없으면 프로듀서 없는 앨범 탭)을
 * 열고, 왼쪽에 **새 프로듀서 채팅 잎**을 그 앨범 저장소(스튜디오)로 세운 뒤 서버에 연다(띄우지 않는다). 입력 칸에는 이어받기 문장을
 * **채우기만** 한다(보내지 않는다 — D6 · 사람이 [보내기]). 서버 판정 `adoptable.autoResume` 이 거짓이면(사람이 멈춤 · 거두기) "멈춤은 그대로" 를
 * 말하는 문장. AI 가 `adopt_run` 하면 서버가 새 세대의 배치를 연다(보드 배치 `{runId, chat}` — 이미 그 탭이다).
 */
type AdoptTarget = {
  runId: string;
  name: string;
  repo: string;
  adoptable?: { restore: boolean; autoResume: boolean } | null;
  /** 스튜디오 화면에서 눌렀다 — 앨범의 ← · Esc 가 그리로 돌아간다 */
  fromRepo?: string;
};
const adopting = new Set<string>();
export async function adoptWithNewProducer(run: AdoptTarget): Promise<void> {
  if (adopting.has(run.runId)) return;
  adopting.add(run.runId);
  try { await adoptProducer(run); }
  catch { showNotice(t("orch.new.adoptFailed")); }
  finally { adopting.delete(run.runId); }
}

async function adoptProducer(run: AdoptTarget): Promise<void> {
  const clis = (await producerClis()).filter((c) => c.id === "claude" || c.id === "codex");
  // 기본은 직전 프로듀서의 값(이 창이 본 적 있으면) — 아니면 홈 칸의 값. 채팅이 띄워지기 전이라 채팅 머리의 칩으로 바꿀 수 있다(실기 a)
  const last = lastProducerOf(run.runId);
  const cli = clis.find((c) => c.id === last?.cli) ?? clis.find((c) => c.id === homeDraft.cliId) ?? clis[0];
  if (!cli) {
    showNotice(t("app.ai.noneEnabled"));
    return;
  }
  const pick = last && last.cli === cli.id ? last : { model: homeDraft.model, effort: homeDraft.effort };
  openAlbumTab(run.runId, run.fromRepo);
  const tab = activeTab();
  if (!tab?.orch) return;
  if (producerLeafOf(tab) || albumScreens[tab.id]?.producer) {
    showNotice(t("orch.home.adopt.hasProducer"));
    return;
  }
  const cliId = cli.id === "codex" ? "codex" : "claude";
  const chat = newProducerChatId();
  const target: ProducerTarget = { chat, cli: cliId, model: pick.model, effort: pick.effort, studio: run.repo, conv: null, adoptRun: run.runId };
  if (!await openProducer(target)) { showNotice(t("orch.new.adoptFailed")); return; }
  if (isRemote) albumScreens[tab.id] = { path: { view: "album", runId: run.runId, ...(run.fromRepo ? { fromRepo: run.fromRepo } : {}) }, producer: target };
  else placeProducerLeaf(tab.id, { cli: cliId, model: pick.model, effort: pick.effort, studio: run.repo }, chat);
  const keep = !!run.adoptable && run.adoptable.restore && !run.adoptable.autoResume;
  fillProducerChat(chat, t(keep ? "orch.producer.adopt.text.keep" : "orch.home.adopt.text", { name: run.name, runId: run.runId }));
  showNotice(t("orch.home.adopt.filled"));
}

/** 앨범마다 마지막으로 본 프로듀서(이 브라우저의 편의 — `app/producer-record` · 이어받기 칩의 기본값 · 끝난 앨범의 대화 기록) */
export { lastProducerOf, rememberProducer, type ProducerPick } from "./producer-record";

/** 스튜디오 카드 ▶ — 그 스튜디오를 고른 채 홈의 입력 칸으로(홈 탭이 아니면 홈을 연다) */
export function pickStudio(path: string): void {
  selectHomeStudio(path);
  const home = findHomeTab(currentWorkspaceTabs());
  if (!home || activeTab()?.id !== home.id) openOrchHome();
}
