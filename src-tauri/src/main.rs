// Evita la consola adicional en Windows para builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    himnario_desktop_lib::run()
}
