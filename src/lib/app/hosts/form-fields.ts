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
 * config 의 경유 값이 별칭이 아닐 수 있다(`user@bastion:2222`) — 목록에 없으면 `<select>` 가 첫 항목으로 떨어져
 * 저장할 때 사라지므로 제 글자 그대로 항목 하나로 끼운다.
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
 * 새 키를 만들어 칸만 채운다 — 폼을 저장하지 않는다 (docs/log/2026-09-17-keygen.md).
 * 공개키 설치는 묻지 않고 실행하지 않는다(비밀번호를 받는 길이다).
 */
export async function newKeyForForm(): Promise<void> {
  // 수정 중이면 원래 별칭 — 설치는 아직 파일에 적혀 있는 그 호스트로 간다
  const alias = (hostFormMode() === "edit" ? editOriginalName() : hostForm.name).trim();
  const made = await newKey(alias === "" ? null : alias);
  if (made === null) return;

  try {
    hostForm.identityFile = shortenHomePath(made.privatePath, await homeDir());
  } catch {
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
    ms: 12000,
    actions: install === null ? [] : [{ label: t("files.host.keygen.install"), run: install }],
  });
}
