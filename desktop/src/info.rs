//! The `desktop_info` command.
//!
//! The frontend asks the shell which URL scheme the running build registered
//! and when the process started. The scheme builds the Supabase `redirectTo`
//! URL and every link back into the app; production and staging register
//! different schemes, which keeps a sign-in started in one build from being
//! routed by Launch Services to the other. The launch instant lets the
//! frontend report its boot milestones relative to the moment the person
//! opened the app rather than to the moment the document began loading.

use serde::Serialize;
use tauri::utils::config::PluginConfig;
use tauri::State;

/// Key of the deep-link plugin inside `tauri.conf.json > plugins`.
const DEEP_LINK: &str = "deep-link";

/// When the process started, as milliseconds since the Unix epoch.
pub struct LaunchTime(pub u64);

/// What the frontend needs from the shell before it renders.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    /// The URL scheme this build owns, such as `manor` or `manor-staging`.
    scheme: String,
    /// The process start, as milliseconds since the Unix epoch.
    launched_at_ms: u64,
}

/// Returns the scheme this build owns and the instant the process started.
#[tauri::command]
pub fn desktop_info(
    app: tauri::AppHandle,
    launch: State<'_, LaunchTime>,
) -> Result<DesktopInfo, String> {
    Ok(DesktopInfo {
        scheme: configured_scheme(&app.config().plugins)?,
        launched_at_ms: launch.0,
    })
}

/// Reads the first entry of `plugins.deep-link.desktop.schemes`.
fn configured_scheme(plugins: &PluginConfig) -> Result<String, String> {
    let desktop = plugins
        .0
        .get(DEEP_LINK)
        .and_then(|plugin| plugin.get("desktop"))
        .ok_or_else(|| format!("tauri.conf.json is missing `plugins.{DEEP_LINK}.desktop`"))?;
    let schemes = desktop
        .get("schemes")
        .and_then(|schemes| schemes.as_array())
        .ok_or_else(|| {
            format!("`plugins.{DEEP_LINK}.desktop.schemes` must be an array of strings")
        })?;
    schemes
        .first()
        .and_then(|scheme| scheme.as_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("`plugins.{DEEP_LINK}.desktop.schemes` lists no scheme"))
}

#[cfg(test)]
mod tests {
    use super::configured_scheme;
    use tauri::utils::config::PluginConfig;

    /// Reads the `plugins` block of a configuration file the same way Tauri does.
    fn plugins(source: &str) -> PluginConfig {
        let config: serde_json::Value = serde_json::from_str(source).expect("valid config JSON");
        serde_json::from_value(config["plugins"].clone()).expect("a plugin configuration")
    }

    #[test]
    fn reads_the_production_scheme() {
        let production = plugins(include_str!("../tauri.conf.json"));
        assert_eq!(configured_scheme(&production), Ok("manor".to_owned()))
    }

    #[test]
    fn reads_the_staging_scheme() {
        let staging = plugins(include_str!("../tauri.staging.conf.json"));
        assert_eq!(configured_scheme(&staging), Ok("manor-staging".to_owned()))
    }
}
