// ACK가 온 스냅숏만 saved로 승격한다. IO를 주입하므로 실패·lease 경쟁을 순수 테스트한다.
import type { LastActive, SavedWorkspaceTab, WorkspaceMutation, WriterScope } from "./schema";

export interface WorkspaceSnapshot {
  tabs: SavedWorkspaceTab[];
  lastActive: LastActive;
}
interface Entry {
  json: string;
  value: WorkspaceSnapshot;
}

// 파일의 object 키 순서만 달라도 dirty가 되는 일을 막는다. 배열 순서는 배치다.
function snapshotJson(value: WorkspaceSnapshot): string {
  return JSON.stringify(value, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

export class WorkspaceSaveQueue {
  private pending = new Map<string, Entry>();
  private saved = new Map<string, string>();
  private active: string | null = null;
  private savedActive: string | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private warned = false;

  constructor(
    private generation: number,
    private apply: (mutation: WorkspaceMutation) => Promise<number>,
    private claim: () => Promise<number>,
    private onError: () => void,
    private scope: WriterScope = { kind: "main" },
  ) {}

  seed(id: string, value: WorkspaceSnapshot): void {
    this.saved.set(id, snapshotJson(value));
  }

  seedActive(id: string): void {
    this.active = this.savedActive = id;
  }

  track(id: string, value: WorkspaceSnapshot): void {
    this.pending.set(id, { json: snapshotJson(value), value });
  }

  setActive(id: string): void {
    this.active = id;
  }

  dirty(id: string): boolean {
    const entry = this.pending.get(id);
    return entry !== undefined && entry.json !== this.saved.get(id);
  }

  forget(id: string): void {
    this.pending.delete(id);
    this.saved.delete(id);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }

  /** Stale만 한 번 reclaim한다. 두 번째 Stale/다른 오류는 다음 변경까지 dirty로 남긴다. */
  private async put(id: string, value: WorkspaceSnapshot): Promise<void> {
    const mutation = (): WorkspaceMutation => ({
      op: "putTabs", workspaceId: id, scope: this.scope,
      generation: this.generation, ...value,
    });
    try {
      await this.apply(mutation());
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "stale") throw error;
      this.generation = await this.claim();
      await this.apply(mutation());
    }
  }

  flush(): Promise<boolean> {
    return this.serial(async () => {
      try {
        for (const [id, entry] of this.pending) {
          if (entry.json === this.saved.get(id)) continue;
          await this.put(id, entry.value);
          this.saved.set(id, entry.json);
        }
        const id = this.active;
        if (id !== null && id !== this.savedActive) {
          await this.apply({ op: "setActiveWorkspace", id });
          this.savedActive = id;
        }
        this.warned = false;
        return true;
      } catch {
        if (!this.warned) this.onError();
        this.warned = true;
        return false;
      }
    });
  }

  mutate(mutation: WorkspaceMutation): Promise<number> {
    return this.serial(() => this.apply(mutation));
  }
}
