//! The `desktop_scheme` command.
//!
//! The frontend asks the shell which URL scheme the running build registered so
//! it can build the Supabase `redirectTo` URL from it. Production and staging
//! register different schemes, which keeps a sign-in started in one build from
//! being routed by Launch Services to the other.

use tauri::utils::config::PluginConfig;

/// Key of the deep-link plugin inside `tauri.conf.json > plugins`.
const DEEP_LINK: &str = "deep-link";

/// Returns the URL scheme this build owns, such as `manor` or `manor-staging`.
#[tauri::command]
pub fn desktop_scheme(app: tauri::AppHandle) -> Result<String, String> {
    configured_scheme(&app.config().plugins)
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
