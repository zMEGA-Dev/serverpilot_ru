// Запрет консольного окна в Windows release-сборке
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    server_pilot_ru_lib::run();
}
