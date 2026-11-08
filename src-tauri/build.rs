fn main() {
    // Windows 앱 매니페스트(Common-Controls v6)는 tauri-build 의 리소스(bin 에만 붙는다) 대신 **링커가 모든 실행 파일에** 박는다
    // (`app-manifest.xml` — 내용은 tauri-build 기본과 같다). 단위 시험 실행 파일도 매니페스트가 있어야 하기 때문이다: 원격 창 다리의
    // 통합 시험(`src/remote/bridge_tests.rs`)이 쓰는 `tauri::test`(MockRuntime)가 comctl32 v6 에만 있는 진입점을 가져와, 매니페스트
    // 없는 시험 실행 파일은 `STATUS_ENTRYPOINT_NOT_FOUND`(0xc0000139)로 뜨지도 못한다. tauri 자기 저장소의 `embed_manifest_for_tests`
    // 와 같은 처방이고(tauri-apps/tauri#4383 · `WindowsAttributes::new_without_app_manifest` 문서), 둘을 같이 걸면 매니페스트 리소스가
    // 겹쳐 링크가 깨지므로 tauri-build 쪽은 끈다. 링커는 기본 UAC 항목(`asInvoker`)을 더한다 — 지금과 같은 동작이다.
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let mut attributes = tauri_build::Attributes::new();
    if windows_msvc {
        attributes = attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attributes).expect("tauri-build");
}
