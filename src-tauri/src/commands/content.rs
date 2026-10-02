use crate::content::repository::CatalogSummary;
use crate::content::Hymn;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::State;

/// Índice compacto para listar y buscar (solo la ventana del operador).
#[tauri::command]
pub fn get_catalog(state: State<'_, AppState>) -> AppResult<CatalogSummary> {
    state
        .content
        .as_ref()
        .map(|content| content.summary())
        .ok_or_else(|| {
            AppError::content(
                state
                    .content_error
                    .clone()
                    .unwrap_or_else(|| "El contenido no está disponible".into()),
            )
        })
}

/// Documento completo de cualquier himno (p. ej. el que está en espera).
#[tauri::command]
pub fn get_hymn(id: String, state: State<'_, AppState>) -> AppResult<Hymn> {
    let content = state
        .content
        .as_ref()
        .ok_or_else(|| AppError::content("El contenido no está disponible"))?;
    Ok(content.load(&id)?.as_ref().clone())
}

/// Documento del himno al aire, o `null` si no hay ninguno.
#[tauri::command]
pub fn get_current_hymn(state: State<'_, AppState>) -> Option<Hymn> {
    state.session().current_hymn().map(|hymn| hymn.as_ref().clone())
}

/// Secciones del himnario y fondos de imagen (con rutas para el protocolo de
/// archivos). Lo usan ambas ventanas.
#[tauri::command]
pub fn get_visuals(state: State<'_, AppState>) -> crate::content::visuals::Visuals {
    state.visuals.clone()
}
