//! SFTP 파일 브라우저 — 목록·이동·만들기·이름 바꾸기·삭제·복사·전송.
//!
//! - [`crate::sftp`] 의 세션당 SFTP 채널 캐시를 그대로 탄다(`sftp_of`) — 따로 열면 서브시스템 채널이 하나 더 생기고 `close_ssh` 가 두 군데를 알아야 한다.
//! - russh-sftp 2.4 는 읽기를 파이프라이닝하지 않는다(docs/verification/russh.md 5절 — #70) — 다운로드는 스트리밍 + 진행률이다. 서로 다른 요청은 겹쳐 보낼 수 있어 심링크 해석을 8개씩 묶는다.
//! - 목록은 항목마다 stat 을 더 하지 않는다(readdir 이 속성을 준다) — 예외는 심링크(readdir 속성이 `lstat` 이라 링크가 디렉터리를 가리키는지 모른다).
//!
//! 자식 모듈(형제끼리는 `use super::*` 로 부모의 재수출을 본다):
//!
//! | 파일 | 맡는 것 |
//! |---|---|
//! | `sftp_browser/pure.rs` | 상수 · 순수 함수 |
//! | `sftp_browser/common.rs` | 오류 → 한 줄(`fail`) · 홈·절대 경로 · 목적지 확인 · 심링크 해석 |
//! | `sftp_browser/browse.rs` | `sftp_home` · `sftp_list` · `sftp_stat` · `sftp_free_space` |
//! | `sftp_browser/text.rs` | 문서 타일 `sftp_read_text` · `sftp_write_text` |
//! | `sftp_browser/edit.rs` | `sftp_mkdir` · `sftp_create_file` · `sftp_rename` · `sftp_remove` |
//! | `sftp_browser/download.rs` | 파일 하나 `sftp_download` |
//! | `sftp_browser/plan.rs` · `plan_between.rs` · `plan_upload.rs` · `plan_download.rs` | 묶음 작업의 뼈대 · 원격↔원격 · 업로드 · 다운로드 계획·실행 |
//! | `sftp_browser/prepare.rs` | 묶음 작업의 경로 준비 |
//! | `sftp_browser/batch.rs` | `sftp_copy` · `sftp_move` · `sftp_remove_many` · `sftp_conflicts` · `sftp_upload_paths` · `sftp_download_paths` |
//! | `sftp_browser/cross.rs` | `sftp_copy_between` · `sftp_move_between` · `local_to_sftp_move` · `sftp_to_local_move` |
//!
//! Tauri 명령은 재수출로 등록되지 않는다 — `lib.rs` 는 정의 경로를 쓰므로 명령만 든 자식(`browse`·`download`·`cross`)은 재수출하지 않는다.

pub(crate) mod batch;
pub(crate) mod browse;
pub(crate) mod common;
pub(crate) mod cross;
pub(crate) mod download;
pub(crate) mod edit;
mod plan;
mod plan_between;
mod plan_download;
mod plan_upload;
mod prepare;
pub(crate) mod pure;
pub(crate) mod text;

use batch::*;
use common::*;
use edit::*;
use plan::*;
use plan_between::*;
use plan_download::*;
use plan_upload::*;
use prepare::*;
use pure::*;

#[cfg(test)]
mod tests;
