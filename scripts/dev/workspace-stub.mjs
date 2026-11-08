// 하네스 주입 문자열. 실제 앱/파일을 건드리지 않고 v2 명령 계약만 흉내 낸다.
export const WORKSPACE_STUB = `
      if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') return Promise.resolve(null);
      if (['workspaces_load', 'workspaces_claim_writer', 'workspaces_apply', 'workspace_windows', 'workspace_bind_window', 'workspace_window_binding', 'focus_window'].includes(cmd)) {
        window.__calls?.push([cmd, args]);
        const file = window.__workspaceFile ??= structuredClone(window.__workspaceSeed ?? {
          kind: 'aynx.workspaces', version: 2, revision: 1, activeWorkspaceId: 'default',
          workspaces: [{ id: 'default', name: '기본', tabs: [], lastActive: {} }],
        });
        if (cmd === 'workspaces_load') return Promise.resolve({ state: 'v2', file: structuredClone(file) });
        if (cmd === 'workspaces_claim_writer') return Promise.resolve(1);
        if (cmd === 'workspace_windows') return Promise.resolve(['main']);
        if (cmd === 'workspace_window_binding') return Promise.resolve(null);
        if (cmd !== 'workspaces_apply') return Promise.resolve(null);
        const m = args.mutation;
        const w = file.workspaces.find(w => w.id === (m.workspaceId ?? m.id));
        if (m.op === 'putTabs') {
          const same = tab => tab.placement.kind === m.scope.kind && (m.scope.kind === 'main' || tab.placement.groupId === m.scope.groupId);
          w.tabs = [...w.tabs.filter(tab => !same(tab)), ...structuredClone(m.tabs)];
          w.lastActive = structuredClone(m.lastActive ?? {});
        }
        else if (m.op === 'setActiveWorkspace') file.activeWorkspaceId = m.id;
        else if (m.op === 'returnAuxTabsToMain') { for (const w of file.workspaces) for (const tab of w.tabs) tab.placement = { kind: 'main' }; }
        else if (m.op === 'createWorkspace') file.workspaces.push({ id: m.id, name: m.name, tabs: [], lastActive: {} });
        else if (m.op === 'renameWorkspace') w.name = m.name;
        else if (m.op === 'reorderWorkspaces') file.workspaces = m.ids.map(id => file.workspaces.find(w => w.id === id));
        else if (m.op === 'deleteWorkspace') file.workspaces = file.workspaces.filter(w => w.id !== m.id);
        else if (m.op === 'rewriteHostAliases') {
          const keys = new Set(m.aliases.map(alias => alias.trim().toLowerCase()));
          const rewrite = (node) => {
            if (node.dir) { const a = rewrite(node.a), b = rewrite(node.b); return a && b ? { ...node, a, b } : a ?? b; }
            const alias = node.alias ?? node.startProject?.host;
            if (node.adhoc || !alias || !keys.has(alias.trim().toLowerCase())) return node;
            return m.to ? { ...node, ...(node.alias ? { alias: m.to } : {}), ...(node.startProject?.host ? { startProject: { ...node.startProject, host: m.to } } : {}) } : null;
          };
          const firstKey = node => node.dir ? firstKey(node.a) : node.tileKey;
          for (const w of file.workspaces) for (const tab of w.tabs) tab.root = rewrite(tab.root) ?? { kind: 'start', tileKey: firstKey(tab.root) };
        }
        if (window.__persistWorkspace) sessionStorage.setItem('h.ws', JSON.stringify(file));
        return Promise.resolve(++file.revision);
      }
`;
