fn main() {
    // 매니페스트는 링커가 단위 시험 실행 파일까지 모든 실행 파일에 박는다 — 없으면 `tauri::test` 시험이 `STATUS_ENTRYPOINT_NOT_FOUND` 로
    // 뜨지 못한다(tauri-apps/tauri#4383). tauri-build 쪽 매니페스트는 끈다 — 둘을 같이 걸면 리소스가 겹쳐 링크가 깨진다.
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
