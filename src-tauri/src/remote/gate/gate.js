// AYNX 원격 관문의 페어링·잠금 해제 쪽(R1a-2) — 관문이 직접 내는 작은 쪽의 유일한 스크립트(CSP: script-src 'self').
// 앱 번들과 무관하다. 쿠키는 HttpOnly 라 여기서 보지 못한다 — 결과는 관문의 응답 코드·JSON 으로만 안다.
"use strict";
(() => {
  const page = document.body.dataset.page;
  const msg = document.getElementById("msg");
  const say = (text, kind) => {
    msg.textContent = text;
    msg.dataset.kind = kind || "";
  };
  const seconds = (ms) => Math.max(1, Math.ceil((Number(ms) || 0) / 1000));
  // 관문이 앱 언어로 적은 `<html lang>` 을 따른다(앱 번들 밖이라 프런트 사전이 없다).
  const en = document.documentElement.lang === "en";
  const tr = (ko, english) => (en ? english : ko);

  async function post(path, body) {
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        credentials: "same-origin",
        cache: "no-store",
      });
      let data = {};
      try {
        data = await r.json();
      } catch {
        data = {};
      }
      return { status: r.status, data };
    } catch {
      return { status: 0, data: {} };
    }
  }

  if (page === "pair") {
    const button = document.getElementById("pair");
    const code = document.getElementById("code");
    let timer = 0;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = 0;
      button.disabled = false;
    };
    button.addEventListener("click", async () => {
      button.disabled = true;
      say(tr("요청을 보내는 중…", "Sending the request…"));
      const { status, data } = await post("/remote/pair/request");
      if (status === 200 && data.code && data.poll) {
        code.textContent = data.code;
        code.hidden = false;
        say(tr("메인 PC 화면에 같은 코드가 떴는지 보고 [허용] 을 누르세요.", "Check that the main PC shows the same code, then press [Allow] there."));
        const poll = data.poll;
        const deadline = Date.now() + (Number(data.expiresInMs) || 120000);
        timer = setInterval(async () => {
          if (Date.now() > deadline) {
            stop();
            code.hidden = true;
            say(tr("시간이 지났습니다 — 다시 요청하세요.", "Timed out. Request again."), "err");
            return;
          }
          const r = await post("/remote/pair/status", { poll });
          const state = r.data.state;
          if (state === "allowed") {
            stop();
            button.disabled = true;
            say(tr("연결했습니다.", "Connected."), "ok");
            location.replace("/");
          } else if (state === "denied") {
            stop();
            code.hidden = true;
            say(tr("메인 PC 에서 거절했습니다.", "The main PC declined."), "err");
          } else if (state !== "pending") {
            stop();
            code.hidden = true;
            say(tr("요청이 끝났습니다 — 다시 요청하세요.", "The request ended. Request again."), "err");
          }
        }, 1500);
        return;
      }
      button.disabled = false;
      if (data.error === "paired") location.replace("/");
      else if (data.error === "busy") say(tr("다른 연결 요청이 진행 중입니다 — 잠시 뒤 다시 하세요.", "Another connection request is in progress. Try again shortly."), "err");
      else if (status === 429) say(tr("요청이 너무 잦습니다 — 잠시 뒤 다시 하세요.", "Too many requests. Try again shortly."), "err");
      else if (data.error === "full") say(tr("연결된 기기가 너무 많습니다 — 메인 PC 에서 안 쓰는 기기를 지우세요.", "Too many connected devices. Remove unused ones on the main PC."), "err");
      else say(tr("요청하지 못했습니다(", "Could not send the request (") + status + ").", "err");
    });
  }

  if (page === "unlock") {
    const form = document.getElementById("unlock");
    const pw = document.getElementById("pw");
    const button = document.getElementById("open");
    if (pw) pw.focus();
    else button.focus();
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      button.disabled = true;
      say(tr("여는 중…", "Unlocking…"));
      const { status, data } = await post("/remote/unlock", pw ? { password: pw.value } : {});
      if (pw) pw.value = "";
      if (status === 200) {
        say(tr("열었습니다.", "Unlocked."), "ok");
        location.replace("/");
        return;
      }
      button.disabled = false;
      if (data.error === "unpaired") location.replace("/");
      else if (data.error === "bad")
        say(
          data.retryAfterMs
            ? tr("암호가 맞지 않습니다 — " + seconds(data.retryAfterMs) + "초 뒤에 다시 하세요.", "Wrong password. Try again in " + seconds(data.retryAfterMs) + "s.")
            : tr("암호가 맞지 않습니다.", "Wrong password."),
          "err",
        );
      else if (status === 429) say(tr("시도가 너무 많습니다 — " + seconds(data.retryAfterMs) + "초 뒤에 다시 하세요.", "Too many attempts. Try again in " + seconds(data.retryAfterMs) + "s."), "err");
      else if (data.error === "password") say(tr("마스터 암호를 입력하세요.", "Enter the master password."), "err");
      else if (data.error === "master") location.replace("/");
      else if (status === 503) say(tr("메인 PC 의 세션 서버에 닿지 못했습니다 — 잠시 뒤 다시 하세요.", "Could not reach the main PC session server. Try again shortly."), "err");
      else say(tr("열지 못했습니다(", "Could not unlock (") + status + ").", "err");
      if (pw) pw.focus();
    });
  }
})();
