import { describe, expect, it } from "vitest";
import {
  humanSize,
  isAlreadyExists,
  uploadDirValue,
  uploadVerb,
  DEFAULT_REMOTE_DIR,
  type UploadTarget,
} from "$lib/sftp";
import { translate } from "$lib/i18n/dict";

/**
 * 파일 전송 모달의 순수 규칙 (docs/log/2026-09-02-sftp.md ·
 * docs/log/2026-09-04-native-drag-out.md "반대 방향").
 *
 * 목적지가 둘(원격 세션 · 내 디스크)이고 로직은 한 벌이다 — 갈리는 것은 **말과 기본값**뿐
 * 이라, 그 둘이 여기 두 함수에 모여 있다.
 */

const remote: UploadTarget = { kind: "remote", session: 900_001 };
const local: UploadTarget = { kind: "local" };

describe("uploadVerb — 목적지가 말을 정한다", () => {
  it("원격은 '올린다' (글자가 아니라 **문구 키**다)", () => {
    const v = uploadVerb(remote);
    expect(v.title).toBe("files.transfer.verb.remote.title");
    expect(v.ing).toBe("uploading");
    expect(v.go).toBe("files.transfer.verb.remote.go");
    expect(v.done).toBe("files.transfer.upload.summary.remote");
  });

  it("내 디스크는 '복사한다' — 같은 창에서 같은 낱말을 쓰면 어디로 가는지가 흐려진다", () => {
    const v = uploadVerb(local);
    expect(v.title).toBe("files.transfer.verb.local.title");
    expect(v.ing).toBe("copying");
    expect(v.go).toBe("files.transfer.verb.local.go");
    expect(v.done).toBe("files.transfer.upload.summary.local");
  });

  it("목적지가 아직 없으면 원격 쪽 말로 떨어진다 (모달이 뜨기 전의 잠깐)", () => {
    expect(uploadVerb(null).ing).toBe("uploading");
  });

  it("`ing` 은 상태 값이라 사전 키가 그대로 만들어진다", () => {
    expect(translate("en", `files.transfer.state.${uploadVerb(local).ing}`)).toBe("Copying");
  });
});

describe("uploadDirValue — 빈 칸의 뜻이 목적지마다 다르다", () => {
  it("적은 값이 있으면 그대로 (앞뒤 공백만 뗀다)", () => {
    expect(uploadDirValue("  /srv/app  ", remote)).toBe("/srv/app");
    expect(uploadDirValue("C:\\tmp", local)).toBe("C:\\tmp");
  });

  it("원격에서 비우면 홈(`~/`)이다", () => {
    expect(uploadDirValue("", remote)).toBe(DEFAULT_REMOTE_DIR);
    expect(uploadDirValue("   ", remote)).toBe(DEFAULT_REMOTE_DIR);
  });

  it("**로컬에는 그런 기본이 없다** — 빈 값은 빈 값으로 두어 백엔드가 거절하게 한다", () => {
    // 조용히 아무 데나 떨어뜨리는 것보다 "절대 경로가 아니다" 로 막히는 편이 낫다.
    expect(uploadDirValue("", local)).toBe("");
    expect(uploadDirValue("  ", local)).toBe("");
  });
});

describe("isAlreadyExists — [덮어쓰기] 를 붙일 줄 고르기", () => {
  // 판정은 **이유 코드**다 — 본문이 어느 언어든 같은 갈래로 걸린다 (`$lib/error-reason`).
  it("백엔드가 단 이유 코드를 알아본다 (한국어 본문)", () => {
    expect(isAlreadyExists("[exists] note.txt 이(가) 이미 있습니다 — 다른 이름을 지정하세요")).toBe(
      true,
    );
  });

  it("영어 본문도 같은 갈래다", () => {
    expect(isAlreadyExists("[exists] note.txt already exists — choose a different name")).toBe(
      true,
    );
  });

  it("다른 실패에는 붙이지 않는다", () => {
    expect(isAlreadyExists("권한이 없습니다")).toBe(false);
    expect(isAlreadyExists("Permission denied")).toBe(false);
    // 옛 한국어 조각만으로는 걸리지 않는다 — 계약은 이제 코드다.
    expect(isAlreadyExists("note.txt 이(가) 이미 있습니다")).toBe(false);
  });
});

describe("humanSize", () => {
  it("바이트·KB·MB 로 접는다", () => {
    expect(humanSize(512)).toBe("512B");
    expect(humanSize(2048)).toBe("2.0KB");
    expect(humanSize(3 * 1024 * 1024)).toBe("3.0MB");
  });

  it("경계는 큰 단위 쪽이다", () => {
    expect(humanSize(1024)).toBe("1.0KB");
    expect(humanSize(1024 * 1024)).toBe("1.0MB");
  });
});
