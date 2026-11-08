# AYNX 기여 안내

[English](CONTRIBUTING.md) · 한국어

## 커밋 전 검사

프런트엔드를 수정했다면 다음 검사를 모두 통과해야 합니다.

```sh
npm run check && npm run build && npm test && npm run check:cycles && npm run check:bundle
```

Rust(`src-tauri/`) 코드를 수정했다면 다음 검사도 통과해야 합니다.

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

`cargo test` 출력은 파일로 저장합니다. 파이프(`| head` 등)를 사용하면 SIGPIPE로 종료됩니다.
문서만 수정했다면 `npm run check`만 실행하면 됩니다.

## 코드와 문서 지도

[코드 관례](docs/conventions.md) · [백엔드 모듈 지도](docs/modules.md) · [프런트 모듈 지도](docs/modules-frontend.md) · [문서 색인](docs/README.md)

설계 노트와 작업 기록(`docs/log/`, `docs/internal/`, `docs/verification/`)은 비공개 저장소에서 관리하므로, 이 저장소에서는 해당 링크가 열리지 않습니다.

[README로 돌아가기](README.ko.md)
