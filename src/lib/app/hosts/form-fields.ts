// 호스트 폼 **칸 옆의 도우미** — 경유 호스트 고르개 항목 · IdentityFile [찾아보기…] · [새 키 만들기…]
// (만든 뒤 토스트의 [이 호스트에 공개키 설치…] 는 `install-key.ts` 의 `runInstall`).
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { rememberTarget } from "$lib/app/prompts.svelte.js";
import { shortenHomePath } from "$lib/hosts";
import { hostCache, lookupHost } from "./list.svelte.js";
import { hostForm } from "./form-model.svelte.js";
import { editOriginalName, hostFormMode } from "./form.svelte.js";
import { newKey, runInstall } from "./install-key";

/**
 * 경유 호스트 고르개의 **항목들** — 지금 폼이 다루는 호스트를 뺀 나머지 별칭 전부.
 * 순서는 호스트 목록과 같다(= `~/.ssh/config` 등장 순서) — 목록에서 보던 차례가 고르개에서
 * 뒤바뀌면 같은 두 화면이 서로 다른 말을 한다.
 *
 * 마지막 한 줄이 이 함수의 이유다: config 에 적힌 값이 **별칭이 아닐 수도 있다**
 * (`user@bastion:2222` 처럼 사람이 직접 적은 글자). 그 값이 목록에 없으면 `<select>` 는
 * 조용히 첫 항목("(없음)")으로 떨어지고, 저장하는 순간 사용자가 적어 둔 경유가 사라진다.
 * 그래서 그런 값은 **제 글자 그대로 항목 하나로** 끼워 넣는다.
 */
export function jumpOptions(): string[] {
  const self = (hostFormMode() === "edit" ? editOriginalName() : hostForm.name).trim().toLowerCase();
  const names = hostCache().map((h) => h.name).filter((n) => n.trim().toLowerCase() !== self);
  const current = hostForm.proxyJump.trim();
  if (current !== "" && !names.some((n) => n.toLowerCase() === current.toLowerCase())) {
    names.push(current);
  }
  return names;
}

/**
 * IdentityFile 파일 탐색기 (추가·수정 모달 공용).
 *
 * 고른 경로의 표기 규칙(홈은 `~` 로, 구분자는 OS 것 그대로)은 `hosts.ts` 의
 * [`shortenHomePath`] 가 든다.
 */
export async function browseIdentity(): Promise<void> {
  try {
    const home = await homeDir();
    const picked = await openFileDialog({
      title: t("files.host.identity.pick.title"),
      defaultPath: `${home.replace(/[\\/]+$/, "")}${home.includes("\\") ? "\\" : "/"}.ssh`,
      multiple: false,
      directory: false,
    });
    if (typeof picked !== "string") return;
    hostForm.identityFile = shortenHomePath(picked, home);
  } catch {
    // 대화상자를 못 열어도 직접 입력은 가능하므로 조용히 넘어간다
  }
}

/**
 * IdentityFile 줄의 **"새 키 만들기…"** (docs/log/2026-09-17-keygen.md).
 *
 * "찾아보기…" 바로 옆에 있는 이유: 그 칸이 비어 있는 사람에게 필요한 것은 둘 중 하나다 —
 * 이미 있는 키를 **찾거나**, 아직 없는 키를 **만들거나**. 앞의 길만 있으면 뒤의 사람은 앱을
 * 떠나 터미널에서 `ssh-keygen` 을 쳐야 했다.
 *
 * 만든 뒤에 하는 일이 셋이다.
 *
 * 1. `IdentityFile` 칸을 방금 만든 **개인키 경로**로 채운다 (`~` 표기는 `shortenHomePath`).
 * 2. 어디에 무엇이 생겼는지 토스트로 말한다 — 앱이 사용자 홈에 파일을 둘 만든 참이다.
 * 3. 그 토스트에 **남은 한 걸음**을 붙인다: [이 호스트에 공개키 설치…]. **수정 중이고
 *    접속할 수 있는 호스트**일 때만이고(설치할 대상이 있어야 한다), 묻지 않고 실행하지는
 *    않는다 (비밀번호를 받는 길이다).
 *
 * 2026-09-19 ② 까지는 그 앞에 [에이전트에 넣기] 가 있었다. 지운 이유: "다시 묻지 않게
 * 하는 길" 이 금고로 옮겨 갔고(docs/log/2026-09-19-vault.md), 암호구가 걸린 새 키는
 * **접속할 때 한 번 묻고 저장을 켜면 끝**이다 — `ssh-add` 타일을 여는 걸음이 통째로 없다.
 *
 * 폼을 **저장하지는 않는다.** 칸만 채우고 결정은 사용자에게 남긴다 — 취소로 닫으면
 * `~/.ssh/config` 는 손대지 않은 그대로다 (만든 키 파일은 남는다. 그것이 사용자가 시킨 일이다).
 */
export async function newKeyForForm(): Promise<void> {
  // 수정 중이면 **원래 별칭**이다 — 사용자가 이름 칸을 고치는 중일 수 있고, 설치는 아직
  // 파일에 적혀 있는 그 호스트로 간다.
  const alias = (hostFormMode() === "edit" ? editOriginalName() : hostForm.name).trim();
  const made = await newKey(alias === "" ? null : alias);
  if (made === null) return;

  try {
    hostForm.identityFile = shortenHomePath(made.privatePath, await homeDir());
  } catch {
    // 홈 경로를 못 읽으면 줄이지 않은 절대 경로 그대로 — 값은 여전히 옳다.
    hostForm.identityFile = made.privatePath;
  }

  const target = hostFormMode() === "edit" ? lookupHost(editOriginalName()) : null;
  const install =
    target === null
      ? null
      : () => {
          rememberTarget(target);
          void runInstall(target.name, { kind: "line", line: made.publicKeyLine });
        };

  toast.success(t("files.host.keygen.done", { path: made.privatePath }), {
    // 비밀번호 모달까지 가는 길이라 토스트 기본 3초로는 짧다.
    ms: 12000,
    actions: install === null ? [] : [{ label: t("files.host.keygen.install"), run: install }],
  });
}
