use crate::settings::MonitorRef;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Clave estable dentro de la sesión: nombre + posición.
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub primary: bool,
}

impl MonitorInfo {
    pub fn new(name: Option<&String>, x: i32, y: i32, width: u32, height: u32, scale_factor: f64, primary: bool) -> Self {
        let name = name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("Pantalla {width}×{height}"));
        Self {
            id: format!("{name}@{x},{y}"),
            name,
            x,
            y,
            width,
            height,
            scale_factor,
            primary,
        }
    }

    pub fn to_ref(&self) -> MonitorRef {
        MonitorRef {
            name: self.name.clone(),
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }

    pub fn contains_point(&self, x: i32, y: i32) -> bool {
        x >= self.x
            && y >= self.y
            && (x as i64) < self.x as i64 + self.width as i64
            && (y as i64) < self.y as i64 + self.height as i64
    }
}

/// Busca el monitor guardado entre los conectados. Prioridad: mismo nombre y
/// posición; mismo nombre (si es único); misma posición y tamaño. Los sistemas
/// reordenan o renombran pantallas al conectar/desconectar, por eso se admite
/// más de un criterio, pero nunca se adivina con información ambigua.
pub fn match_monitor<'a>(saved: &MonitorRef, monitors: &'a [MonitorInfo]) -> Option<&'a MonitorInfo> {
    if let Some(found) = monitors
        .iter()
        .find(|monitor| monitor.name == saved.name && monitor.x == saved.x && monitor.y == saved.y)
    {
        return Some(found);
    }
    let same_name: Vec<_> = monitors.iter().filter(|monitor| monitor.name == saved.name).collect();
    if same_name.len() == 1 {
        return same_name.first().copied();
    }
    monitors.iter().find(|monitor| {
        monitor.x == saved.x
            && monitor.y == saved.y
            && monitor.width == saved.width
            && monitor.height == saved.height
    })
}

/// Sugerencia para la primera ejecución: el primer monitor que no es el
/// principal (normalmente el proyector o la TV).
pub fn suggest_projection_monitor(monitors: &[MonitorInfo]) -> Option<&MonitorInfo> {
    if monitors.len() < 2 {
        return None;
    }
    monitors.iter().find(|monitor| !monitor.primary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(name: &str, x: i32, primary: bool) -> MonitorInfo {
        MonitorInfo::new(Some(&name.to_string()), x, 0, 1920, 1080, 1.0, primary)
    }

    fn saved(name: &str, x: i32) -> MonitorRef {
        MonitorRef { name: name.into(), x, y: 0, width: 1920, height: 1080 }
    }

    #[test]
    fn matches_by_name_and_position_first() {
        let monitors = [monitor("Built-in", 0, true), monitor("EPSON", 1920, false)];
        assert_eq!(match_monitor(&saved("EPSON", 1920), &monitors).map(|m| m.x), Some(1920));
    }

    #[test]
    fn follows_a_renamed_or_moved_monitor_only_when_unambiguous() {
        let moved = [monitor("Built-in", 0, true), monitor("EPSON", -1920, false)];
        assert_eq!(match_monitor(&saved("EPSON", 1920), &moved).map(|m| m.x), Some(-1920));

        let renamed = [monitor("Built-in", 0, true), monitor("HDMI-1", 1920, false)];
        assert_eq!(match_monitor(&saved("EPSON", 1920), &renamed).map(|m| m.name.as_str()), Some("HDMI-1"));

        let unplugged = [monitor("Built-in", 0, true)];
        assert!(match_monitor(&saved("EPSON", 1920), &unplugged).is_none());
    }

    #[test]
    fn unnamed_monitors_get_a_readable_name() {
        let info = MonitorInfo::new(None, 0, 0, 1280, 720, 1.0, false);
        assert_eq!(info.name, "Pantalla 1280×720");
        assert!(info.contains_point(100, 100));
        assert!(!info.contains_point(1280, 100));
    }

    #[test]
    fn suggests_secondary_monitor_only_when_there_are_two() {
        assert!(suggest_projection_monitor(&[monitor("A", 0, true)]).is_none());
        let pair = [monitor("A", 0, true), monitor("B", 1920, false)];
        assert_eq!(suggest_projection_monitor(&pair).map(|m| m.name.as_str()), Some("B"));
    }
}
