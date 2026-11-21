/**
 * 저장 안 한 문서 표 — 순수(룬 없음). 소속 판정을 `$state` 배열로 하면 `$effect` 안의 `setDocDirty` 가 제가 쓰는 값을
 * 구독해 `effect_update_depth_exceeded` 로 반응성이 멈춘다(docs/log/2026-09-27-doc-edit.md).
 */
export class DirtyTable {
  private ids = new Set<string>();

  /** 바뀌었으면 참 */
  set(id: string, dirty: boolean): boolean {
    if (dirty === this.ids.has(id)) return false;
    if (dirty) this.ids.add(id);
    else this.ids.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  list(): string[] {
    return [...this.ids];
  }
}

export class SaverTable {
  private fns = new Map<string, () => Promise<boolean>>();

  register(id: string, fn: () => Promise<boolean>): () => void {
    this.fns.set(id, fn);
    return () => {
      if (this.fns.get(id) === fn) this.fns.delete(id);
    };
  }

  async request(id: string): Promise<boolean> {
    const fn = this.fns.get(id);
    if (!fn) return false;
    try {
      return await fn();
    } catch {
      return false;
    }
  }
}

/**
 * 효과의 정리 함수로 지우면 안 된다 — 포커스 이동만으로 정리가 `false` 를 적고 다시 적히지 않아 닫기가 묻지 않고
 * 편집이 사라진다(docs/log/2026-09-27-doc-edit.md). 지우는 때는 id 가 값으로 바뀔 때 · [`dispose`] 뿐이다.
 */
export class DirtyBinding {
  private id: string | null = null;

  constructor(private readonly write: (id: string, dirty: boolean) => void) {}

  sync(id: string | null | undefined, dirty: boolean): void {
    const next = id || null;
    if (this.id !== null && this.id !== next) this.write(this.id, false);
    this.id = next;
    if (next !== null) this.write(next, dirty);
  }

  dispose(): void {
    if (this.id !== null) this.write(this.id, false);
    this.id = null;
  }
}
