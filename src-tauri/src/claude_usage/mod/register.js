// Aynx — Claude Code 의 요금제 한도 %(5시간 · 7일)를 앱에 넘기는 mod. 앱이 적는 파일이다(고치면 다음 실행에 덮인다).
// Aynx 타일이 CLAUDE_CODE_PLUGIN_DIRS 로 실을 때만 돈다. 숫자만 넘긴다 — 프롬프트·대화는 읽지 않는다.
// 받는 쪽: `aynx claude-usage`(src-tauri/src/claude_usage.rs) — 표준 입력의 JSON 을 한도 파일에 원자적으로 적는다.

// 마지막으로 넘긴 시각 — 값이 그대로여도 1분마다 한 번은 넘겨 "잰 시각" 이 묵지 않게 한다
let last = 0

export function register(on) {
  // 턴이 끝날 때마다, 그리고 한도 % 가 움직일 때 불린다
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.rateLimits.length === 0) return result
    const now = await $.clock.now()
    if (!e.changed.includes('rateLimits') && now - last < 60000) return result
    last = now
    const helper = await $.env.get('AYNX_CLAUDE_USAGE')
    if (!helper) return result
    try {
      await $.process.run([helper, 'claude-usage'], { stdin: JSON.stringify(e.rateLimits), timeoutMs: 10000 })
    } catch {
      // 도우미가 없거나 늦었다 — 이번 값만 놓친다. Claude 는 그대로 간다.
    }
    return result
  })
}
