import { askChoice } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { requestDocSave } from "$lib/app/doc-dirty.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { choiceFromDialog, closeAfterSave } from "$lib/unsaved-guard";

/**
 * 저장 안 한 문서가 있을 때 닫기 전에 한 번 묻는다. 저장이 하나라도 실패하면 닫지 않는다.
 * 대화를 못 띄우면 닫지 않는다 — 묻지 못한 채 글을 버리지 않는다(`closeTabAsked` 와 같은 규칙).
 */
export async function confirmUnsavedClose(
  paneIds: readonly string[],
  nameOf: (paneId: string) => string,
  verb: "close" | "switch" = "close",
): Promise<boolean> {
  if (paneIds.length === 0) return true;
  const sw = verb === "switch";
  const labels = {
    save: t(sw ? "app.unsaved.switch.save" : "app.unsaved.save"),
    discard: t(sw ? "app.unsaved.switch.discard" : "app.unsaved.discard"),
  };
  const names = paneIds.map(nameOf).filter((n) => n !== "");
  const body = [t("app.unsaved.confirm", { count: paneIds.length }), "", ...names.map((n) => `· ${n}`)]
    .join("\n")
    .trimEnd();
  let result: string;
  try {
    result = await askChoice(body, {
      title: t("app.unsaved.title"),
      kind: "warning",
      yesLabel: labels.save,
      noLabel: labels.discard,
      cancelLabel: t("app.unsaved.cancel"),
    });
  } catch {
    showNotice(t(sw ? "app.unsaved.switch.noDialog" : "app.unsaved.noDialog"));
    return false;
  }
  const choice = choiceFromDialog(result, labels);
  if (choice === "cancel") return false;
  // 버리기 — 표시는 여기서 지우지 않는다. 닫기가 실제로 일어나는 자리가 거둔다: 그 뒤 닫기가 취소되면 ● 만 사라지는 일이 없게.
  if (choice === "discard") return true;
  // 차례로 — 한 번에 여러 저장이 같은 원격 채널을 다투지 않게.
  const results: boolean[] = [];
  for (const id of paneIds) {
    const ok = await requestDocSave(id);
    results.push(ok);
    if (!ok) {
      showNotice(t(sw ? "app.unsaved.switch.saveFailed" : "app.unsaved.saveFailed", { name: nameOf(id) || id }));
      break;
    }
  }
  return closeAfterSave(results);
}
