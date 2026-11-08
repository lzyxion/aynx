import { describe, expect, it } from "vitest";
import { scanSource } from "../../scripts/check-bundle.mjs";

/**
 * 번들 검사(`npm run check:bundle`)의 판정 — docs/log/2026-10-14-vi-freeze-decrqm.md.
 *
 * 붙잡아 두는 것 둘: es2020 압축이 남긴 **선언 없는 대입**은 걸리고, 압축 번들에 흔한 정상 모양
 * (끌어올림·매개변수·catch·이름 있는 식·import·멤버 대입)은 걸리지 않는다.
 * 정상 표의 몇 줄(이름 있는 함수 식·클래스 식 이름에 대입)은 실행하면 TypeError 지만 이름은
 * 선언돼 있다 — 이 검사가 묻는 것은 "스코프에서 풀리는가" 하나다.
 */

const names = (src: string) => scanSource(src).map((h) => h.name);

describe("scanSource", () => {
  it("es2020 압축이 떨어뜨린 `let` — requestMode 의 `s` 하나를 잡는다", () => {
    const broken =
      'class u{requestMode(e){return(r=>(r[r.X=0]="X"))(void 0||(s={})),this.f(e)}f(e){return e}}export{u as A};';
    expect(names(broken)).toEqual(["s"]);
  });

  it("es2021 모양(`let t; … (t||={})`)은 깨끗하다", () => {
    const fixed =
      'class u{requestMode(e){let t;return(r=>(r[r.X=0]="X"))(t||={}),this.f(e)}f(e){return e}}export{u as A};';
    expect(names(fixed)).toEqual([]);
  });

  it.each([
    ["var 끌어올림", "function f(){x=1;var x}"],
    ["블록 안 var 가 함수로 끌어올려짐", "function f(){x=1;{var x}}"],
    ["함수 선언 끌어올림", "g=1;function g(){}"],
    ["매개변수", "function f(a){a=2}"],
    ["구조 분해 매개변수", "const f=({a,b:[c,...d]},e=1)=>{a=c=d=e=0}"],
    ["catch 매개변수", "try{}catch({message:m}){m=1}"],
    ["for-let", "for(let i=0;i<3;i++)i+=1"],
    ["for-of 대상이 선언된 바깥 let", "let k;for(k of [1]);"],
    ["이름 있는 함수 식", "(function h(){h=1})"],
    ["클래스 식 이름", "(class K{m(){K=1}})"],
    ["클래스 선언", "class C{}C=1"],
    ["import", 'import d,{a as b}from"x";import*as ns from"y";d=b=ns=1'],
    ["클로저에서 바깥 선언 대입", "let n=0;const inc=()=>{n++;n+=1}"],
    ["static 블록", "class S{static{let q;q=1}}"],
  ])("정상: %s", (_label, src) => {
    expect(names(src)).toEqual([]);
  });

  it("멤버 대입(`window.x = …`)은 적중이 아니다", () => {
    expect(names("window.x=1;globalThis.y=2;this.z=3;a.b.c=4;({}).d=5")).toEqual([]);
  });

  it("블록 밖에서 블록 안 let 에 대입하면 잡는다", () => {
    expect(names("{let t}t=1")).toEqual(["t"]);
  });

  it("파싱에 실패하면 던진다", () => {
    expect(() => scanSource("let = ;")).toThrow();
  });
});
