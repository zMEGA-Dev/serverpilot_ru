fn main() {
    // Передаём абсолютный путь к иконке через атрибуты
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let icon_path = std::path::PathBuf::from(&manifest_dir).join("icons").join("icon.ico");

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(
                tauri_build::WindowsAttributes::new()
                    .window_icon_path(icon_path)
            )
    ).expect("failed to run tauri-build");
}
