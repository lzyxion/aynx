(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const kd = (code, key, mods = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...mods }));
  // 전체 검색 열기
  kd("KeyF", "F", { ctrlKey: true, shiftKey: true }); await sleep(400);
  const q = document.querySelector("input.q"); if (!q) return { err: "no search input" };
  const type = async (s) => { for (const ch of s) { q.value += ch; q.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" })); await sleep(30); } };
  await type("#make"); await sleep(400);
  const rows = [...document.querySelectorAll('.overlay [role="option"], .overlay li, .overlay .row, .overlay .result')].map((e) => e.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chip = document.querySelector('[data-chip="block"]')?.textContent.trim() ?? null;
  // 첫 결과로 점프
  q.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true, cancelable: true })); await sleep(500);
  const overlayOpen = !!document.querySelector(".overlay input.q");
  const kept = document.querySelectorAll(".xterm-decoration").length;
  // '#' 만 → 전체 블록
  kd("KeyF", "F", { ctrlKey: true, shiftKey: true }); await sleep(400);
  const q2 = document.querySelector("input.q"); q2.value = ""; q2.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })); await sleep(100);
  q2.value = "#"; q2.dispatchEvent(new InputEvent("input", { bubbles: true, data: "#", inputType: "insertText" })); await sleep(400);
  const all = [...document.querySelectorAll('.overlay [role="option"], .overlay li, .overlay .row, .overlay .result')].map((e) => e.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
  return { chip, rows: rows.slice(0, 5), overlayOpenAfterJump: overlayOpen, decorationsAfterJump: kept, allBlocks: all.slice(0, 6) };
})()
