// IO를 주입한 전체 종료 절차. 확인 취소/저장 실패/ACK 시간 초과에는 exit가 없다.
export interface UnsavedWindow { label: string; displayLabel?: string; docs: { id: string; name: string }[]; unknown?: boolean }
export type QuitChoice = "save" | "discard" | "cancel";
export interface QuitIO {
  windows(): Promise<string[]>;
  inspect(label: string): Promise<UnsavedWindow | null>;
  confirm(windows: UnsavedWindow[]): Promise<QuitChoice>;
  save(label: string, ids: string[]): Promise<boolean>;
  flush(label: string): Promise<boolean>;
  resume(label: string): Promise<void>;
  exit(): Promise<void>;
}
export async function quitAll(io: QuitIO): Promise<boolean> {
  const labels = await io.windows();
  const windows = await Promise.all(labels.map(async (label) =>
    await io.inspect(label) ?? { label, docs: [], unknown: true }));
  const choice = windows.some((w) => w.unknown || w.docs.length > 0) ? await io.confirm(windows) : "discard";
  if (choice === "cancel") return false;
  if (choice === "save") {
    for (const w of windows) {
      if (w.unknown || !await io.save(w.label, w.docs.map((d) => d.id))) return false;
    }
  }
  const results = await Promise.all(labels.map((label) => io.flush(label)));
  if (!results.every(Boolean)) {
    await Promise.all(labels.map((label) => io.resume(label)));
    return false;
  }
  // 수집 중 생긴 창도 저장 ACK가 필요하다. 변한 창 집합에서는 닫지 않고 다시 요청하게 한다.
  const current = await io.windows();
  if (current.length !== labels.length || current.some((label) => !labels.includes(label))) {
    await Promise.all(labels.map((label) => io.resume(label)));
    return false;
  }
  try { await io.exit(); return true; }
  catch { await Promise.all(labels.map((label) => io.resume(label))); return false; }
}
