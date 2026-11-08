/**
 * **저장 안 한 문서 표의 몸통** — 순수(룬 없음). `app/doc-dirty.svelte.ts` 가 이것을 쥐고, 값이 **실제로 바뀐
 * 때만** 반응형 사본을 새로 쓴다.
 *
 * 왜 따로인가: 예전에는 `$state` 배열 하나가 표였고 `setDocDirty` 가 그 배열을 **읽고(`includes`) 썼다**. 그래서
 * `$effect` 안에서 부르면 효과가 제가 쓰는 값을 구독해 스스로를 무효화했다 — 편집기에 첫 글자를 치자마자
 * `effect_update_depth_exceeded` 로 페이지의 반응성이 멈췄다(docs/log/2026-09-27-doc-edit.md). 소속 판정은 여기
 * 평범한 `Set` 이 하므로 쓰는 쪽은 반응형 값을 읽지 않는다.
 */
export class DirtyTable {
  private ids = new Set<string>();

  /** 적는다 — 바뀌었으면 참(같은 값이면 아무 일 없이 거짓) */
  set(id: string, dirty: boolean): boolean {
    if (dirty === this.ids.has(id)) return false;
    if (dirty) this.ids.add(id);
    else this.ids.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** 새 배열(넣은 순서) */
  list(): string[] {
    return [...this.ids];
  }
}

/** 저장 함수 표 — 타일 id → 그 DocView 의 저장 */
export class SaverTable {
  private fns = new Map<string, () => Promise<boolean>>();

  /** 등록 — 돌려준 함수로 푼다(그사이 다른 함수가 등록됐으면 건드리지 않는다) */
  register(id: string, fn: () => Promise<boolean>): () => void {
    this.fns.set(id, fn);
    return () => {
      if (this.fns.get(id) === fn) this.fns.delete(id);
    };
  }

  /** 부른다 — 등록이 없거나 던지면 거짓 */
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
 * **타일 하나의 dirty 묶음** — 표에 적힌 값이 늘 `(지금 id, editing && dirty)` 와 같게 한다.
 *
 * 효과의 정리 함수로 지우면 안 된다: 상위가 같은 타일을 다시 내려 주기만 해도(포커스 이동) 효과가 다시 돌며 정리
 * 함수가 `false` 를 적고, 값 적기 쪽은 이미 참이라 다시 적지 않아 표가 거짓으로 남았다 — 머리줄 ● 가 꺼지고 닫기가
 * 묻지 않아 **편집이 사라졌다**(docs/log/2026-09-27-doc-edit.md). 그래서 지우는 때는 둘뿐이다: id 가 **값으로**
 * 바뀌었을 때(옛 id) · 컴포넌트가 사라질 때([`dispose`]). [`sync`] 는 조건 없이 늘 적는다(표가 같은 값을 거른다).
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
