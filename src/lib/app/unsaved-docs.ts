import { askChoice } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { requestDocSave } from "$lib/app/doc-dirty.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { choiceFromDialog, closeAfterSave } from "$lib/unsaved-guard";

/**
 * **저장 안 한 문서가 있을 때 닫기 전에 한 번 묻는다** — 대화 함수 하나 (docs/log/2026-09-27-doc-edit.md "F2").
 *
 * 타일 닫기 · 탭 닫기 · 창 닫기가 전부 이것을 부른다(판정은 순수 `unsavedVerdict` — 부르는 쪽이 `ask` 를
 * 받았을 때만 온다). 모양은 앱의 다른 확인과 같은 **앱 확인 상자**(`app/confirm-dialog` — 10-16 전에는
 * OS 기본 상자)이고, 단추가 셋이라 `askChoice` 를 쓴다.
 *
 * - [저장하고 닫기] — 타일마다 `requestDocSave` 를 차례로 부른다. **하나라도 실패하면 닫지 않는다**
 *   (충돌 · 끊긴 세션 · 읽기 전용 — 사연은 그 타일의 띠가 말한다. 여기서는 어느 파일인지 한 줄).
 * - [버리고 닫기] — 닫게 한다(저장 안 한 표시는 실제로 닫는 자리가 거둔다).
 * - [취소] · 대화를 × 로 닫음 · 모르는 값 — 아무 일도 없다.
 *
 * 대화를 **못 띄우면 닫지 않는다** — 묻지 못한 채 글을 버리느니 아무 일도 안 하는 쪽이 낫다
 * (`closeTabAsked` 와 같은 규칙).
 *
 * 탭 모듈을 가져오지 않는다(그쪽이 이것을 부른다 — 순환을 만들지 않게). 이름은 부르는 쪽이 준다.
 */
export async function confirmUnsavedClose(
  paneIds: readonly string[],
  nameOf: (paneId: string) => string,
): Promise<boolean> {
  if (paneIds.length === 0) return true;
  const labels = { save: t("app.unsaved.save"), discard: t("app.unsaved.discard") };
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
    showNotice(t("app.unsaved.noDialog"));
    return false;
  }
  const choice = choiceFromDialog(result, labels);
  if (choice === "cancel") return false;
  // 버리기 — 표시는 여기서 지우지 않는다. 닫기가 실제로 일어나는 자리(`closeTab` · 타일 닫기 몸통)가 거둔다:
  // 이 뒤에서 닫기가 취소되면 탭은 남는데 ● 만 사라지는 일이 없게.
  if (choice === "discard") return true;
  // 차례로 — 한 번에 여러 저장이 같은 원격 채널을 다투지 않게. 실패한 첫 파일에서 멈춘다.
  const results: boolean[] = [];
  for (const id of paneIds) {
    const ok = await requestDocSave(id);
    results.push(ok);
    if (!ok) {
      showNotice(t("app.unsaved.saveFailed", { name: nameOf(id) || id }));
      break;
    }
  }
  return closeAfterSave(results);
}
