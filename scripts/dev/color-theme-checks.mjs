// dock-unified-harness 에서 실행하는 색 테마의 실제 클릭·저장·취소·추출 검증.
export async function checkColorThemes({ ev, check, click, sleep, send, importApp, shot }) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev(`(async()=>{
    window.__themeSettings=await ${importApp('lib/settings.svelte.ts')};
    window.__themeMode=await ${importApp('lib/mode.svelte.ts')};
    window.__themeColors=await ${importApp('lib/app-color-themes.ts')};
    window.__themeWallpaper=await ${importApp('lib/wallpaper.svelte.ts')};
    window.__themeDynamic=await ${importApp('lib/dynamic-theme.svelte.ts')};
    window.__themeOverlays=await ${importApp('app/overlays.svelte.ts')};
    const m=window.__themeSettings;
    window.__themeOriginal={current:m.cloneSettings(m.settings.current),saved:m.cloneSettings(m.settings.saved),src:window.__themeWallpaper.wallpaper.src};
    m.settings.current=m.emptySettings();m.settings.saved=m.emptySettings();
    window.__themeMode.syncStoredMode();m.applySettings();
    window.__themeWallpaper.wallpaper.src='';
    window.__themeOverlays.openSettingsAt('theme','app-colors');
  })()`);
  await sleep(500);
  const tap = async (selector) => {
    await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await sleep(60); await click(selector); await sleep(120);
  };
  const selected = () => ev(`document.querySelector('[data-color-theme][aria-pressed="true"]')?.dataset.colorTheme ?? null`);
  const current = () => ev(`JSON.stringify(window.__themeSettings.settings.current)`);
  // AYNX 는 기본 하나(2026-10-24) — 그 밖의 고르기는 Classic 칩을 돈다
  const pick = async (id) => {
    const chip = id === 'aynx' ? '#app-color-prism' : '#app-color-classic';
    for (let i=0; i<8 && await selected() !== id; i++) await tap(chip);
    if (await selected() !== id) throw new Error('계열 순환 실패: '+id);
  };
  const open = async () => {
    await ev(`window.__themeOverlays.openSettingsAt('theme','app-colors')`); await sleep(250);
  };
  try {
    check(await ev(`document.querySelectorAll('.palette-chips > button').length===4 && !document.querySelector('.palette-chips .family-dot') && !document.querySelector('#app-color-random') && document.querySelectorAll('.palette-chips input[type="color"]').length===0 && !document.querySelector('select#app-dynamic')`) === true,
      '추출·계열 셋 칩이 있고(색 선택기는 사용자 색 칩과 함께 10-17 에 걷힘) 계열 칩에 점이 없다');
    check(await ev(`document.querySelector('#app-dynamic').disabled`) === true, 'extraction disabled without wallpaper');
    check(await ev(`document.querySelector('.palette-chips').getBoundingClientRect().top>document.querySelector('.wp-pick').getBoundingClientRect().bottom`) === true,
      'color themes follow wallpaper');

    const saves = await ev(`window.__calls.filter(([c])=>c==='save_settings').length`);
    await pick('forest');
    check(await selected() === 'forest' && await ev(`window.__themeSettings.settings.current.app.dynamic==='off' && window.__themeSettings.settings.presetKey==='dynamic'`) === true,
      'palette applies app and terminal colors without wallpaper following');
    check(await ev(`window.__calls.filter(([c])=>c==='save_settings').length===${saves}`) === true, 'palette previews without saving');
    for (const mode of ['light', 'dark']) {
      await tap('[data-app-mode="'+mode+'"]');
      check(await ev(`(()=>{const s=window.__themeSettings.settings,c=window.__themeColors,p=c.appColorPalette('forest',${mode === 'dark'});return document.documentElement.dataset.theme==='${mode}' && s.current.app.accent===p.chrome.accent && ["accent","bg","bg_panel","fg","border","err","ok","warn"].every(k=>s.current.app[k]===p.chrome[k]) && s.termTheme.background===p.term.background;})()`) === true && await selected() === 'forest',
        mode+'에서 크롬 여덟 칸과 터미널은 테마 전체 팔레트를 따른다');
    }
    for (let i=0; i<2; i++) {
      await tap('#app-color-prism');
      check(await selected() === 'aynx' && await ev(`document.querySelector('#app-color-prism').getAttribute('aria-label')==='AYNX'`) === true,
        'AYNX 는 변형 하나 — 다시 눌러도 기본이고 순환 문구가 없다');
    }
    for (const [family, ids] of [
      ['classic', ['ocean','forest','sunset','lavender','rose','amber','slate','ocean']],
      ['mono', ['mono-white','mono-silver','mono-graphite','mono-white']],
    ]) {
      for (const id of ids) {
        await tap('#app-color-'+family);
        check(await selected() === id, family+' 순환: '+id);
      }
    }
    // '사용자 색' 칩은 10-17 에 걷었다 — 저장된 사용자 색의 모델 동작은 app-color-themes.test.ts 가 본다.
    await tap('#app-color-prism');
    check(await selected() === 'aynx', '다른 계열에서 AYNX 칩은 기본으로 간다');
    // [취소] — 설정 화면 바닥 줄의 둘째 단추(`SettingsModal.svelte` 의 `.actions > .btn-secondary` · 뿌리는 `.settings-view`)
    await tap('.settings-view .actions > .btn-secondary');
    check(await ev(`window.__themeSettings.settings.current.app.bg===undefined && !window.__themeSettings.settings.dirty`) === true, 'cancel restores original colors');
    await open(); await pick('lavender');
    await tap('.settings-modal .actions > .btn-primary');
    check(await ev(`window.__calls.filter(([c])=>c==='save_settings').at(-1)?.[1].settings.app.accent===window.__themeSettings.settings.current.app.accent`) === true,
      'save persists the chosen palette');
    await open(); check(await selected() === 'lavender', 'reopening restores chosen theme from saved colors');

    await ev(`(()=>{const c=document.createElement('canvas');c.width=160;c.height=100;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,160,100);g.addColorStop(0,'#225566');g.addColorStop(1,'#74b18b');x.fillStyle=g;x.fillRect(0,0,160,100);window.__themeWallpaper.wallpaper.src=c.toDataURL();window.__themeSettings.settings.current.wallpaper.file='fixture.png';})()`);
    await sleep(150); await tap('#app-dynamic'); await sleep(700);
    check(await ev(`window.__themeSettings.settings.dynamicTheme && !!window.__themeDynamic.dynamicTheme.last && document.querySelector('#app-dynamic').getAttribute('aria-pressed')==='true'`) === true && await selected() === null,
      'wallpaper button extracts image colors and marks wallpaper selection');
    // 깜빡임 회귀: full 에서 밝기를 바꾸면 data-theme 을 바꾸는 **같은 틱**에 토큰·터미널도 새 밝기여야 한다
    // (예전에는 속성만 라이트로 가고 토큰은 사진 재추출이 끝날 때까지 다크로 남아 화면이 검게 깜빡였다).
    for (const mode of ['light', 'dark']) {
      const r = await ev(`new Promise((res)=>{
        const s=window.__themeSettings.settings,root=document.documentElement;
        const lum=(h)=>{const n=parseInt(String(h).slice(1),16);return ((n>>16&255)*299+(n>>8&255)*587+(n&255)*114)/1000;};
        const ok=()=>{const light=root.dataset.theme==='light';return root.dataset.theme==='${mode}' && (lum(s.current.app.bg)>128)===light && (lum(s.current.terminal.dynamic?.background)>128)===light && (lum(getComputedStyle(root).getPropertyValue('--term-bg').trim()||'#808080')>128)===light;};
        window.__themeMode.setAppMode('${mode}');
        const tick=ok();
        requestAnimationFrame(()=>res(JSON.stringify({tick,frame:ok(),bg:s.current.app.bg,theme:root.dataset.theme})));
      })`);
      const o = JSON.parse(r);
      check(o.tick && o.frame && await ev(`window.__themeSettings.settings.dynamicTheme`) === true,
        'wallpaper palette switches to '+mode+' in the same tick as data-theme (no black flash) '+r);
      await sleep(200);
    }
    await tap('[data-app-mode="light"]'); await sleep(700);
    check(await ev(`window.__themeSettings.settings.dynamicTheme && window.__themeSettings.settings.current.app.bg===window.__themeDynamic.dynamicTheme.last.chrome.bg && document.documentElement.dataset.theme==='light'`) === true,
      'wallpaper palette follows explicit brightness');
    const extracted = await current();
    await ev(`window.__themeWallpaper.wallpaper.src='data:image/png;base64,AAAA'`);
    await tap('#app-dynamic'); await sleep(300);
    check(await current() === extracted && await ev(`!!window.__themeDynamic.dynamicTheme.error && !!document.querySelector('.wp-error[role="alert"]')`) === true,
      'failed extraction preserves current palette and shows error');

    await pick('aynx');
    check(await ev(`!window.__themeSettings.settings.dynamicTheme && !window.__themeDynamic.dynamicTheme.error`) === true,
      'AYNX 칩은 월페이퍼 추출·오류를 걷는다');
    check(await selected() === 'aynx', '월페이퍼에서 누르면 기본으로 돌아온다');
    await ev(`window.__themeSettings.settings.current.app.status_bar='right';window.__themeSettings.settings.current.app.opacity=75;window.__themeSettings.settings.current.app.language='en'`);
    await pick('aynx');
    check(await ev(`(()=>{const s=window.__themeSettings.settings;return !s.current.app.bg && s.current.app.dynamic==='off' && s.presetKey==='aynx-light' && s.current.app.status_bar==='right' && s.current.app.opacity===75 && s.current.app.language==='en';})()`) === true,
      'AYNX palette resets only colors and preserves brightness, position, opacity and language');

    await ev(`window.__themeSettings.settings.current.app.opacity=100;window.__themeWallpaper.wallpaper.src='';window.__themeSettings.settings.current.wallpaper.file=undefined`);
    await pick('lavender');
    await ev(`document.querySelector('.wp-pick').scrollIntoView({block:'start'})`); await sleep(150); await shot('color-themes-light.png');
    await tap('[data-app-mode="dark"]');
    await ev(`document.querySelector('.wp-pick').scrollIntoView({block:'start'})`); await sleep(150); await shot('color-themes-dark.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(250); await ev(`document.querySelector('#app-colors').scrollIntoView({block:'center'})`); await sleep(100);
    check(await ev(`(()=>{const p=document.querySelector('.settings-panel'),r=p.getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1 && [...document.querySelectorAll('.palette-chips > button')].every(e=>{const b=e.getBoundingClientRect();return b.left>=r.left && b.right<=r.right;});})()`) === true,
      'palette buttons fit narrow settings panel '+await ev(`(()=>{const p=document.querySelector('.settings-panel'),r=p.getBoundingClientRect();return JSON.stringify({sw:p.scrollWidth,cw:p.clientWidth,over:[...p.querySelectorAll('*')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>r.left+p.clientLeft+p.clientWidth+1).slice(0,8).map(e=>e.tagName+'.'+[...e.classList].join('.')+'#'+e.id+':'+Math.round(e.getBoundingClientRect().right-r.left-p.clientLeft-p.clientWidth))});})()`));
    await shot('color-themes-narrow.png');
  } finally {
    await ev(`(()=>{const m=window.__themeSettings,o=window.__themeOriginal;m.settings.current=o.current;m.settings.saved=o.saved;window.__themeWallpaper.wallpaper.src=o.src;window.__themeMode.syncStoredMode();m.applySettings();})()`);
  }
}
