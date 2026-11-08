//! 세션 서버 IPC — 프레임(`frame`)과 전송(`transport`). 서버(`server::serve`)와 GUI 클라이언트(`server::client`)가
//! 함께 쓰고, 둘 다 이 아래만 거쳐 파이프를 만진다. **파이프를 중계하는 CLI 하위 명령은 없다**(설계 4.6).

pub(crate) mod frame;
pub(crate) mod transport;

pub(crate) use frame::{Frame, Grade, Hello, ProtocolRange, Welcome, WireError};
pub(crate) use transport::{BoxStream, Peer};
