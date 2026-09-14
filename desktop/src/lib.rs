//! Native shell for the Manor desktop application.
//!
//! The shell owns window creation, deep-link receipt, single-instance
//! forwarding, external-link opening, window-state persistence, file logging,
//! signed update delivery, relaunch, and the one command that reports which URL
//! scheme the build registered and when the process started. Everything a
//! person sees or edits belongs to
//! the React frontend that the window loads, so no product rule lives here.

mod info;

use std::fmt::Arguments;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::{error, info, kv, warn, LevelFilter, Record};
use tauri::plugin::TauriPlugin;
use tauri::{Manager, Runtime};
use tauri_plugin_log::fern::FormatCallback;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_window_state::StateFlags;

/// Label of the single window declared in `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";

/// Base name of the log file inside the operating system log directory.
const LOG_FILE_NAME: &str = "manor";

/// Size a log file may reach before it is rotated, in bytes.
const MAX_LOG_FILE_SIZE: u128 = 2 * 1024 * 1024;

/// How long the frontend gets to reveal the window before the shell does it.
const REVEAL_DEADLINE: Duration = Duration::from_secs(4);

/// Starts the desktop shell and blocks until the person quits the application.
///
/// Plugin order matters in one place: single-instance is registered before
/// deep-link so a second launch hands its link to the running app instead of
/// starting a rival process, and the deep-link plugin then receives that link.
/// The rest is a flat set of capabilities the frontend calls into.
pub fn run() {
    let launched_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the system clock is set before 1970")
        .as_millis() as u64;
    tauri::Builder::default()
        .manage(info::LaunchTime(launched_at))
        .plugin(logging())
        .plugin(tauri_plugin_single_instance::init(
            |_app, _arguments, _cwd| {
                // The deep-link plugin already consumed the arguments. They can
                // carry an authorization code, so none of them are logged.
                info!("second instance forwarded");
            },
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // Everything but visibility is restored: the frontend reveals
                // the window itself once it has painted its first frame.
                .with_state_flags(StateFlags::all().difference(StateFlags::VISIBLE))
                .build(),
        )
        // Checks the release feed named by `plugins.updater.endpoints` and
        // installs only an archive that carries a valid signature for
        // `plugins.updater.pubkey`. Both live in `tauri.conf.json`, and the
        // staging overlay points the same key at the staging feed.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Supplies the restart that the frontend calls once an update is
        // installed: on macOS the new bundle only takes effect on relaunch.
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![info::desktop_info])
        .setup(|app| {
            let name = app.package_info().name.clone();
            let version = app.package_info().version.to_string();
            let window = app
                .get_webview_window(MAIN_WINDOW)
                .ok_or_else(|| format!("tauri.conf.json declares no `{MAIN_WINDOW}` window"))?;
            window.set_title(&name)?;
            reveal_if_still_hidden(window);
            info!(
                version = version.as_str(),
                identifier = app.config().identifier.as_str();
                "desktop started"
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Manor desktop failed to start")
}

/// Shows the window if the frontend has not done so by the deadline.
///
/// The window opens hidden so its first frame already carries the saved theme,
/// and the frontend shows it once that theme is applied and its first render is
/// dispatched. A frontend that never reaches that call, because its platform
/// failed to build or its script never ran, would leave a window that looks like
/// an app that never opened, so the shell reveals whatever the webview shows and
/// says so in the log.
fn reveal_if_still_hidden<R: Runtime>(window: tauri::WebviewWindow<R>) {
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_DEADLINE);
        match window.is_visible() {
            Ok(true) => {}
            Ok(false) => {
                warn!(
                    deadline_seconds = REVEAL_DEADLINE.as_secs();
                    "frontend did not reveal the window; shown by the shell"
                );
                if let Err(cause) = window.show() {
                    error!(cause = cause.to_string().as_str(); "the shell could not show the window");
                }
            }
            // Quitting inside the deadline closes the window before the check runs.
            Err(tauri::Error::WindowNotFound) => {}
            Err(cause) => {
                error!(cause = cause.to_string().as_str(); "the shell could not read window visibility");
            }
        }
    });
}

/// Builds the logger.
///
/// Every build appends to the operating system log directory, which on macOS is
/// `~/Library/Logs/<identifier>/manor.log`. Debug builds also write to standard
/// output so `tauri dev` shows the same lines. Keeping a single rotated file
/// bounds what an installed app can leave on disk.
fn logging<R: Runtime>() -> TauriPlugin<R> {
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some(LOG_FILE_NAME.to_owned()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .level(LevelFilter::Info)
        .rotation_strategy(RotationStrategy::KeepOne)
        .max_file_size(MAX_LOG_FILE_SIZE)
        .targets(targets)
        .format(write_record)
        .build()
}

/// Writes one line as `[date][time][target][LEVEL] message key=value`.
///
/// This replaces the plugin's own format, which drops structured fields.
fn write_record(out: FormatCallback<'_>, message: &Arguments<'_>, record: &Record<'_>) {
    let now = TimezoneStrategy::UseUtc.get_now();
    out.finish(format_args!(
        "[{:04}-{:02}-{:02}][{:02}:{:02}:{:02}][{}][{}] {message}{}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        record.target(),
        record.level(),
        fields(record)
    ))
}

/// Formats a record's structured fields as a logfmt-style suffix.
fn fields(record: &Record<'_>) -> String {
    let mut writer = FieldWriter(String::new());
    // `FieldWriter` cannot fail, so the visit result carries no information.
    let _ = record.key_values().visit(&mut writer);
    writer.0
}

/// Collects `log` key-value pairs into ` key=value` pairs, quoting a value that
/// holds a space, a quote, or an equals sign so the line stays parseable.
struct FieldWriter(String);

impl<'kvs> kv::VisitSource<'kvs> for FieldWriter {
    fn visit_pair(&mut self, key: kv::Key<'kvs>, value: kv::Value<'kvs>) -> Result<(), kv::Error> {
        let text = value.to_string();
        self.0.push(' ');
        self.0.push_str(key.as_str());
        self.0.push('=');
        if text.contains([' ', '"', '=']) {
            self.0.push('"');
            self.0.push_str(&text.replace('"', "\\\""));
            self.0.push('"');
        } else {
            self.0.push_str(&text);
        }
        Ok(())
    }
}
