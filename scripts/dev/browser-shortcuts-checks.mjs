// dock-unified-harness 에서 실행: 실제 창 리스너 + 모달 + CodeMirror의 키 경계.
export async function checkBrowserShortcuts({ send, ev, check, key, sleep }) {
  const blocked = (selector, combo) => ev(`(() => {
    const parts=${JSON.stringify(combo)}.split('+'), code=parts.at(-1);
    const event=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,code,
      key:code.startsWith('Key')?code.slice(3).toLowerCase():code,
      ctrlKey:parts.includes('Ctrl'),shiftKey:parts.includes('Shift')});
    document.querySelector(${JSON.stringify(selector)}).dispatchEvent(event);
    return event.defaultPrevented;
  })()`);

  await key('KeyG','G',10);
  check(await ev(`document.activeElement.matches('[data-workspace-switcher] input')`) === true,
    'Ctrl+Shift+G opens workspace switcher and focuses input');
  await ev(`window.__browserKeyProbe=e=>{window.__browserKeyBlocked=e.defaultPrevented;};
    window.addEventListener('keydown',window.__browserKeyProbe,{capture:true});`);
  try {
    await key('KeyG','G',10);
    check(await ev(`window.__browserKeyBlocked && document.activeElement.matches('[data-workspace-switcher] input')`) === true,
      'second Ctrl+Shift+G cancels browser find before modal stops propagation');
  } finally {
    await ev(`window.removeEventListener('keydown',window.__browserKeyProbe,{capture:true}); delete window.__browserKeyProbe; delete window.__browserKeyBlocked;`);
  }
  for (const combo of ['Ctrl+KeyF','Ctrl+KeyG','Ctrl+Shift+KeyG','F3','Shift+F3',
    'Ctrl+KeyP','Ctrl+Shift+KeyP','Ctrl+KeyS','Ctrl+KeyO','Ctrl+KeyU','Ctrl+KeyJ','Ctrl+KeyH']) {
    check(await blocked('[data-workspace-switcher] input',combo) === true, `${combo} browser default blocked inside modal`);
  }
  for (const combo of ['KeyA','Ctrl+KeyA','Ctrl+KeyC','Ctrl+KeyV']) {
    check(await blocked('[data-workspace-switcher] input',combo) === false, `${combo} editing default preserved inside modal`);
  }
  await send('Input.insertText',{text:'빌드'});
  check(await ev(`document.querySelectorAll('[data-workspace-switcher] [role="option"]').length===1 && document.querySelector('#ws-option-build')!==null`) === true,
    'workspace query still filters after repeated shortcut');
  await key('Escape');
  check(await ev(`!document.querySelector('[data-workspace-switcher]')`) === true,'Escape still closes workspace switcher');

  await key('KeyP','P',10);
  check(await blocked('.palette input','Ctrl+KeyP') === true,'browser print blocked in command palette too');
  await key('Escape');

  // 앱에서 쓰는 편집기를 그대로 세운다. 캡처에서 Ctrl+F/S까지 취소하면 CodeMirror가 키를 건너뛴다.
  check(await ev(`(async()=>{
    const {createEditor}=await import('/src/lib/doc-editor-cm.ts');
    const parent=document.createElement('div');parent.id='browser-shortcut-editor';
    parent.style.cssText='position:fixed;left:100px;top:100px;width:400px;height:200px;z-index:1000';
    document.body.append(parent);
    window.__editorSaves=0;
    window.__shortcutEditor=createEditor(parent,{text:'hello hello',eol:'\\n',indent:'  ',lang:null,plain:true,
      phrases:{},onsave:()=>window.__editorSaves++,ondirty:()=>{}});
    window.__shortcutEditor.focus();return true;
  })()`) === true,'mount real document editor for shortcut regression');
  await sleep(100);
  try {
    await key('KeyF','f',2);
    check(await ev(`!!document.querySelector('#browser-shortcut-editor .cm-search')`) === true,'Ctrl+F still opens editor search');
    await key('Escape');
    await ev(`window.__shortcutEditor.focus()`);
    await key('KeyS','s',2);
    check(await ev(`window.__editorSaves`) === 1,'Ctrl+S still runs editor save once');
    await key('KeyG','G',10);
    check(await ev(`!!document.querySelector('[data-workspace-switcher]')`) === true,'app workspace shortcut still wins inside editor');
    await key('Escape');
  } finally {
    await ev(`window.__shortcutEditor.destroy();document.querySelector('#browser-shortcut-editor').remove();delete window.__shortcutEditor;delete window.__editorSaves;`);
  }
  await sleep(100);
}
