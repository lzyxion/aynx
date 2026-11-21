/**
 * - 이어받기 문장은 입력 칸에 채우기만 한다(사람이 보고 [보내기]) — 앱이 보이지 않는 글을 보내는 길은 없다.
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

export { homeDraft };

export async function producerClis(): Promise<{ command: string; id: string; name: string }[]> {
  return offeredAiClis(await listAiClis(), settings.disabledAgents);
}

/** `adoptable.autoResume` 이 거짓이면(사람이 멈춤 · 거두기) "멈춤은 그대로" 를 말하는 문장을 채운다 */
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

export { lastProducerOf, rememberProducer, type ProducerPick } from "./producer-record";

export function pickStudio(path: string): void {
  selectHomeStudio(path);
  const home = findHomeTab(currentWorkspaceTabs());
  if (!home || activeTab()?.id !== home.id) openOrchHome();
}
