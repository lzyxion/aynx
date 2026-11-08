// dock-unified-harness 에서 실제 포인터/클릭으로 툴팁 수명을 검증한다.
export async function checkTooltips({ ev, check, move, click, sleep, key }) {
  check(await ev(`(() => {
    const fixture=document.createElement('div');fixture.id='tooltip-probe';
    fixture.style.cssText='position:fixed;left:180px;top:120px;z-index:125;padding:20px';
    fixture.title='부모 설명';
    const button=document.createElement('button');button.id='tooltip-probe-button';
    button.title='클릭 전 설명';button.setAttribute('aria-label','툴팁 검증');
    button.innerHTML='<span>검증 버튼</span>';
    button.onclick=()=>{button.title='클릭 후 설명';fixture.title='변경된 부모 설명';};
    fixture.append(button);document.body.append(fixture);return true;
  })()`) === true,'tooltip fixture mounted');
  const hovered = () => ev(`(() => {
    const button=document.querySelector('#tooltip-probe-button'),parent=button.parentElement;
    return !button.hasAttribute('title') && !parent.hasAttribute('title');
  })()`);
  const text = () => ev(`document.querySelector('.tip.on')?.textContent ?? null`);
  // 말풍선이 뜨는 것은 시계(500ms) 뒤다 — 고정 650ms 만 기다리면 바쁜 판에서 한 번씩 놓쳤다(2026-10-27). 뜰 것을 기대하는 자리는 2초까지 본다.
  const shownText = async (want) => { const end=Date.now()+2000; let v=await text(); while (v !== want && Date.now()<end) { await sleep(50); v=await text(); } return v; };
  try {
    await move(50,100);
    const r=await ev(`(() => {const r=document.querySelector('#tooltip-probe-button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await move(r.x,r.y); await sleep(650);
    check(await shownText('클릭 전 설명') === '클릭 전 설명','hover shows themed tooltip');
    check(await hovered() === true,'hover suppresses native titles including ancestors');
    await click('#tooltip-probe-button'); await sleep(650);
    check(await text() === null,'click dismisses themed tooltip while pointer stays');
    check(await hovered() === true,'click and title update cannot restore native tooltip under stationary pointer');
    await move(r.x+1,r.y); await sleep(650);
    check(await hovered() === true,'movement within clicked button still suppresses native tooltip');
    check(await ev(`document.querySelector('#tooltip-probe-button').getAttribute('aria-label')`) === '툴팁 검증','click preserves accessible label');
    await move(50,100);
    check(await ev(`document.querySelector('#tooltip-probe-button').title==='클릭 후 설명' && document.querySelector('#tooltip-probe').title==='변경된 부모 설명'`) === true,
      'leaving restores latest child and ancestor titles');
    await move(r.x,r.y); await sleep(650);
    check(await shownText('클릭 후 설명') === '클릭 후 설명','reentering shows updated themed tooltip');
    await ev(`document.querySelector('#tooltip-probe-button').title='상태 변경 설명'`); await sleep(50);
    check(await shownText('상태 변경 설명') === '상태 변경 설명' && await hovered() === true,'reactive title update refreshes themed tooltip without native fallback');
    await key('ShiftLeft','Shift',8); await sleep(650);
    check(await hovered() === true && await text() === null,'keydown dismisses bubble without exposing native tooltip');
    await move(50,100);
    check(await ev(`document.querySelector('#tooltip-probe-button').title`) === '상태 변경 설명','leaving after dismissal restores latest title');

    await key('Tab');
    await ev(`document.querySelector('#tooltip-probe-button').focus()`); await sleep(650);
    // 2026-10-08 수정(`tooltip.svelte.ts` 머리말) — WebView2 는 Tab 포커스에도 네이티브 말풍선을 띄워 둘이 겹쳤다: 키보드 포커스
    // 동안에도 `title` 을 옮기고, 이름은 aria 로 지킨다(이미 `aria-label` 이 있으면 같은 글을 `aria-description` 으로 잠시 얹는다).
    check(await shownText('상태 변경 설명') === '상태 변경 설명' && await ev(`(() => { const b=document.querySelector('#tooltip-probe-button'); return !b.hasAttribute('title') && b.getAttribute('aria-label') === '툴팁 검증' && b.getAttribute('aria-description') === '상태 변경 설명'; })()`) === true,
      'keyboard focus shows themed tooltip · native title moved off while focused · name kept in aria');
    await move(r.x,r.y); await sleep(650);
    check(await hovered() === true && await text() === '상태 변경 설명','pointer entering keyboard-focused target suppresses native titles too');

    await move(50,100); await ev(`document.querySelector('#tooltip-probe-button').blur();document.querySelector('#tooltip-probe').setAttribute('data-native-tooltip','')`);
    await move(r.x,r.y); await sleep(650);
    check(await text() === null && await ev(`document.querySelector('#tooltip-probe-button').title`) === '상태 변경 설명','explicit native-tooltip exception remains untouched');
  } finally {
    await move(50,100);
    await ev(`document.querySelector('#tooltip-probe').remove()`);
  }
}
