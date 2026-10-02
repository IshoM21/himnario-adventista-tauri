use serde::Serialize;
use std::fmt;

/// Error que cruza la frontera IPC. `code` es estable (para lógica y pruebas);
/// `message` está en español y se muestra directamente al operador.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn content(message: impl Into<String>) -> Self {
        Self::new("CONTENT", message)
    }

    pub fn audio(message: impl Into<String>) -> Self {
        Self::new("AUDIO", message)
    }

    pub fn state(message: impl Into<String>) -> Self {
        Self::new("STATE", message)
    }

    pub fn window(message: impl Into<String>) -> Self {
        Self::new("WINDOW", message)
    }

    pub fn settings(message: impl Into<String>) -> Self {
        Self::new("SETTINGS", message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::window(error.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
