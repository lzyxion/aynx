/** 원격 창의 이 기기 파일 고르기 — 메인 PC 의 열기 대화상자(`plugin-dialog`)는 원격 창에서 폴리필이 거절한다. */

/**
 * 같은 틱에 누른다 — 브라우저는 사용자 몸짓 안에서만 고르기 창을 열므로 이 함수에 닿기 전에 `await` · 타이머가 끼면 안 된다.
 * 칸을 문서에 붙여 두는 것은 붙지 않은 칸의 `change` 를 놓치는 브라우저가 있어서다.
 */
export function pickDeviceFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = accept;
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    input.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
    const settle = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => settle(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => settle([]), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
