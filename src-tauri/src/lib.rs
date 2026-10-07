use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewWindow};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::StateFlags;

#[derive(Serialize, Deserialize)]
struct Prefs {
    always_on_top: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self { always_on_top: true }
    }
}

fn prefs_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("prefs.json"))
}

fn load_prefs<R: Runtime>(app: &AppHandle<R>) -> Prefs {
    prefs_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_prefs<R: Runtime>(app: &AppHandle<R>, prefs: &Prefs) {
    if let Some(p) = prefs_path(app) {
        let _ = p.parent().map(fs::create_dir_all);
        let _ = fs::write(p, serde_json::to_string_pretty(prefs).unwrap_or_default());
    }
}

/// Place the popup next to the sprite, flipping sides so it stays on the sprite's monitor.
fn position_popup<R: Runtime>(sprite: &WebviewWindow<R>, popup: &WebviewWindow<R>) -> tauri::Result<()> {
    let s_pos = sprite.outer_position()?;
    let s_size = sprite.outer_size()?;
    let p_size = popup.outer_size()?;
    let Some(monitor) = sprite.current_monitor()?.or(sprite.primary_monitor()?) else {
        return Ok(());
    };
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let gap = 8;

    let right_x = s_pos.x + s_size.width as i32 + gap;
    let left_x = s_pos.x - p_size.width as i32 - gap;
    let x = if right_x + p_size.width as i32 <= m_pos.x + m_size.width as i32 { right_x } else { left_x.max(m_pos.x) };
    let max_y = m_pos.y + m_size.height as i32 - p_size.height as i32;
    let y = (s_pos.y + s_size.height as i32 - p_size.height as i32).clamp(m_pos.y, max_y.max(m_pos.y));
    popup.set_position(PhysicalPosition::new(x, y))
}

fn toggle<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let Some(popup) = app.get_webview_window("popup") else { return Ok(()) };
    if popup.is_visible()? {
        popup.hide()
    } else {
        if let Some(sprite) = app.get_webview_window("sprite") {
            if sprite.is_visible()? {
                position_popup(&sprite, &popup)?;
            }
        }
        popup.show()?;
        popup.set_focus()
    }
}

#[tauri::command]
fn toggle_popup(app: AppHandle) -> Result<(), String> {
    toggle(&app).map_err(|e| e.to_string())
}

fn apply_always_on_top<R: Runtime>(app: &AppHandle<R>, on: bool) {
    for label in ["sprite", "popup"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.set_always_on_top(on);
        }
    }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let prefs = load_prefs(app);
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItem::with_id(app, "open", "Open / close", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let show_sprite = MenuItem::with_id(app, "sprite", "Show / hide character", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on_top", "Always on top", true, prefs.always_on_top, None::<&str>)?;
    let login = CheckMenuItem::with_id(app, "login", "Launch at login", true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &refresh, &show_sprite, &sep, &on_top, &login, &sep, &quit])?;

    let on_top_item = on_top.clone();
    let login_item = login.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip("Task Assistant")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => {
                let _ = toggle(app);
            }
            "refresh" => {
                let _ = app.emit_to("popup", "refresh-requested", ());
            }
            "sprite" => {
                if let Some(w) = app.get_webview_window("sprite") {
                    let _ = if w.is_visible().unwrap_or(false) { w.hide() } else { w.show() };
                }
            }
            "on_top" => {
                let on = on_top_item.is_checked().unwrap_or(true);
                apply_always_on_top(app, on);
                save_prefs(app, &Prefs { always_on_top: on });
            }
            "login" => {
                let want = login_item.is_checked().unwrap_or(false);
                let al = app.autolaunch();
                let _ = if want { al.enable() } else { al.disable() };
                let _ = login_item.set_checked(al.is_enabled().unwrap_or(false));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let _ = toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = toggle(app);
        }))
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            // Remember where the sprite was dragged to and the popup size.
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .skip_initial_state("popup")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![toggle_popup])
        .setup(|app| {
            let handle = app.handle();
            apply_always_on_top(handle, load_prefs(handle).always_on_top);
            build_tray(handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Task Assistant");
}
