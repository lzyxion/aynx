// 저장된 자격증명 지우기 — 담는 길은 접속 모달의 "이 앱에 저장" 하나다(`app/prompts`).
import { toast } from "$lib/toast.svelte.js";
import * as vault from "$lib/vault";
import { stripReason } from "$lib/error-reason";
import { hostForm } from "./form-model.svelte.js";
import { editOriginalName, hostFormMode } from "./form.svelte.js";
import { refreshSavedCreds, savedCreds } from "./saved-creds.svelte.js";

function reloadSavedCreds(): void {
  void refreshSavedCreds(hostFormMode() === "edit" ? editOriginalName() : hostForm.name, hostForm.identityFile);
}

/** 멱등이라 이미 없어도 성공이다 */
export async function clearSavedPassword(): Promise<void> {
  const alias = hostFormMode() === "edit" ? editOriginalName() : hostForm.name;
  try {
    await vault.remove("host_password", alias);
  } catch (e) {
    toast.error(stripReason(e instanceof Error ? e.message : String(e)));
  }
  reloadSavedCreds();
}

/** 대상은 담긴 그 경로다 */
export async function clearSavedPassphrase(): Promise<void> {
  const target = savedCreds.passphrase;
  if (target === null) return;
  try {
    await vault.remove("key_passphrase", target);
  } catch (e) {
    toast.error(stripReason(e instanceof Error ? e.message : String(e)));
  }
  reloadSavedCreds();
}
