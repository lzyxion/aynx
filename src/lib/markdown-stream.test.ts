import { describe, expect, it } from "vitest";
import { parseMarkdown, splitOpenFence } from "$lib/markdown";

describe("splitOpenFence — 흘러오는 글의 열린 울타리", () => {
  it("울타리가 없으면 그대로", () => {
    expect(splitOpenFence("안녕\n\n- 하나")).toEqual({ done: "안녕\n\n- 하나", open: null });
    expect(splitOpenFence("")).toEqual({ done: "", open: null });
  });

  it("닫힌 울타리는 done 에 남는다", () => {
    const s = "앞\n```mermaid\ngraph TD\nA-->B\n```\n뒤";
    expect(splitOpenFence(s)).toEqual({ done: s, open: null });
  });

  it("닫히지 않은 울타리는 여는 줄부터 open", () => {
    const s = "앞 글\n\n```mermaid\ngraph TD\nA-->";
    expect(splitOpenFence(s)).toEqual({ done: "앞 글\n\n", open: "```mermaid\ngraph TD\nA-->" });
  });

  it("앞의 닫힌 블록 뒤에 새로 연 블록만 떼어 낸다", () => {
    const s = "```js\nx\n```\n글\n```mermaid\ngraph";
    expect(splitOpenFence(s)).toEqual({ done: "```js\nx\n```\n글\n", open: "```mermaid\ngraph" });
  });

  it("닫는 줄이 반쯤 왔으면(``) 아직 열려 있다 · 다 오면 닫힌다", () => {
    expect(splitOpenFence("```\na\n``").open).toBe("```\na\n``");
    expect(splitOpenFence("```\na\n```").open).toBeNull();
  });

  it("짧은 표식으로는 긴 울타리가 닫히지 않는다 · 물결 울타리도 같다", () => {
    expect(splitOpenFence("````\na\n```").open).toBe("````\na\n```");
    expect(splitOpenFence("~~~\na\n~~~").open).toBeNull();
    expect(splitOpenFence("~~~\na\n```").open).toBe("~~~\na\n```");
  });

  it("CRLF 줄도 닫는 줄로 본다", () => {
    expect(splitOpenFence("```\r\na\r\n```\r\n").open).toBeNull();
  });

  it("열린 몫은 여느 코드 블록으로 파싱된다 — 글 전체를 파싱한 것과 같은 블록들", () => {
    const s = "글\n\n```mermaid\ngraph TD";
    const { done, open } = splitOpenFence(s);
    expect([...parseMarkdown(done), ...parseMarkdown(open ?? "")]).toEqual(parseMarkdown(s));
  });
});
