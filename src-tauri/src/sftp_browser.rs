//! SFTP **파일 브라우저** — 목록·이동·만들기·이름 바꾸기·삭제·다운로드.
//!
//! ```text
//!  sftp_home(session)                     realpath(".")          → "/home/wl"
//!  sftp_list(session, "~/logs")           opendir+readdir 한 번  → [SftpEntry]
//!      └ 심링크만 추가로 stat+readlink (8개씩 겹쳐 보낸다)
//!  sftp_mkdir / sftp_create_file / sftp_rename / sftp_remove                        → 한 번의 왕복
//!  sftp_write_text(session, path, text, v)  version 확인 → 임시 파일 → rename (문서 편집 저장)
//!  sftp_download(session, remote, local, onProgress)
//!      └ 256KiB 씩 <local>.part 로 흘려 담고 → rename(local)
//! ```
//!
//! [`crate::sftp`] 의 **세션당 SFTP 채널 캐시를 그대로 탄다**(`sftp_of`). 브라우저가 자기
//! 채널을 따로 열면 터미널이 이미 붙여 놓은 연결 위에 서브시스템 채널이 하나 더 생기고,
//! 세션 정리(`close_ssh`)도 두 군데를 알아야 한다. 전송이 죽은 오류에서 캐시를 버리는
//! 규칙(`is_transport_error` → `forget`)도 같은 것을 쓴다.
//!
//! ## 왕복 수가 이 모듈의 전부다
//!
//! russh-sftp 2.4 는 **읽기를 파이프라이닝하지 않는다**(docs/verification/russh.md 5절 —
//! 이슈 #70). `File` 의 `poll_read` 는 요청 하나를 보내고 응답을 받아야 다음을 보낸다.
//! 그래서 다운로드 시간은 대략 `파일크기 / 청크 × RTT` 다 — 통째로 메모리에 올리지
//! 않는(스트리밍) 이유이자, 진행률 채널이 필요한 이유다.
//!
//! 반면 **서로 다른 요청은 겹쳐 보낼 수 있다**. `RawSftpSession` 은 요청 id 로 응답을
//! 짝지어 주므로(DashMap), 심링크 해석처럼 독립된 요청 여러 개는 동시에 띄워도 된다 —
//! 목록에서 심링크를 8개씩 묶어 보내는 근거가 이것이다.
//!
//! ## 목록은 stat 을 더 하지 않는다
//!
//! `SSH_FXP_READDIR` 은 이름과 **속성을 함께** 준다. 그래서 항목마다 stat 을 다시 부르지
//! 않는다 (1000개짜리 디렉터리에서 1000번의 왕복이 된다). 딱 하나 예외가 심링크다 —
//! readdir 의 속성은 `lstat` 이라 "이 링크가 디렉터리를 가리키는가" 를 담고 있지 않고,
//! 그 답이 없으면 UI 가 링크된 디렉터리로 들어갈 수 없다.
//!
//! ## 자식 모듈 (역할별 — 형제끼리는 `use super::*` 로 부모의 재수출을 본다. 바깥 진입은 Tauri 명령과 지침 어댑터가 빌리는 원시다)
//!
//! | 파일 | 맡는 것 |
//! |---|---|
//! | `sftp_browser/pure.rs` | 상수 · 순수 함수(종류·권한 비트·경로 잇기·보호 판정·목록 한 줄·상태 코드 문구) |
//! | `sftp_browser/common.rs` | 오류 → 한 줄(`fail` — 전송이 죽었으면 채널 버리기) · 홈·절대 경로 · 목적지 확인 · 심링크 해석 |
//! | `sftp_browser/browse.rs` | `sftp_home` · `sftp_list` · `sftp_stat` · `sftp_free_space` |
//! | `sftp_browser/text.rs` | 문서 타일 `sftp_read_text` · `sftp_write_text`(원자 교체 → 제자리 덮어쓰기) |
//! | `sftp_browser/edit.rs` | `sftp_mkdir` · `sftp_create_file` · `sftp_rename` · `sftp_remove`(+ `remove_at` · `remove_tree`) |
//! | `sftp_browser/download.rs` | 파일 하나 `sftp_download`(`.part` → rename) |
//! | `sftp_browser/plan.rs` | 묶음 작업의 뼈대 — `Side`·`Step`·`Top`·`Plan` · 자리 정하기 · `pump` |
//! | `sftp_browser/plan_between.rs` | 원격 → 원격 계획·실행 |
//! | `sftp_browser/plan_upload.rs` | 로컬 → 원격 계획·실행 |
//! | `sftp_browser/plan_download.rs` | 원격 → 로컬 계획·실행(원격 이름 검증 F1) |
//! | `sftp_browser/prepare.rs` | 묶음 작업의 경로 준비(원격 안 · 서버 둘 · 업로드 · 다운로드) |
//! | `sftp_browser/batch.rs` | `sftp_copy` · `sftp_move` · `sftp_remove_many` · `sftp_conflicts` · `sftp_upload_paths` · `sftp_download_paths` |
//! | `sftp_browser/cross.rs` | `sftp_copy_between` · `sftp_move_between` · `local_to_sftp_move` · `sftp_to_local_move` |
//!
//! Tauri 명령은 재수출로 등록되지 않는다 — `lib.rs` 는 `sftp_browser::browse::sftp_list` 처럼 정의 경로를 쓴다.
//! 그래서 재수출은 모듈 안 전용(`use`)이고, 명령만 든 자식(`browse`·`download`·`cross`)은 재수출하지 않는다.
//! `agent_instructions` 는 `common`·`pure`·`text` 의 홈·경로·저장 원시만 직접 빌린다.

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
