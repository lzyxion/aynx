// 구독은 창마다 채팅 하나. 같은 앨범을 여러 잎에서 보아도 마지막 관찰자만 떠난다.
export function createProducerObservers<T extends { chat: string }>(join: (target: T) => void, leave: (chat: string) => void) {
  const counts = new Map<string, number>();
  return (target: T): (() => void) => {
    counts.set(target.chat, (counts.get(target.chat) ?? 0) + 1);
    join(target);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (counts.get(target.chat) ?? 1) - 1;
      if (n > 0) counts.set(target.chat, n);
      else { counts.delete(target.chat); leave(target.chat); }
    };
  };
}
