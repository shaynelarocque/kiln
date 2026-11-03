use serde::Deserialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// Saves through a temp file and a rename, so a crash mid-write can't truncate a project.
#[tauri::command]
pub fn write_text(path: String, contents: String) -> Result<(), String> {
    let tmp = format!("{path}.tmp");
    fs::write(&tmp, contents)
        .and_then(|_| fs::rename(&tmp, &path))
        .map_err(|e| format!("{path}: {e}"))
}

#[derive(Deserialize)]
pub struct OutFile {
    path: String,
    content: String,
    /// false: only written if missing (the user's own code lives there)
    overwrite: bool,
}

/// Plain relative paths only: an export can't escape the folder it was given.
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("refusing to write outside the export folder: {rel}"));
    }
    Ok(root.join(rel_path))
}

/// Writes an exported PlatformIO project and returns the paths it wrote.
#[tauri::command]
pub fn write_project(dir: String, files: Vec<OutFile>) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&dir);
    let mut written = Vec::new();
    for file in files {
        let target = inside(&root, &file.path)?;
        if !file.overwrite && target.exists() {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        fs::write(&target, file.content).map_err(|e| format!("{}: {e}", target.display()))?;
        written.push(file.path);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_that_leave_the_folder() {
        let root = Path::new("/tmp/out");
        assert!(inside(root, "src/ui/ui.c").is_ok());
        assert!(inside(root, "../evil").is_err());
        assert!(inside(root, "/etc/passwd").is_err());
        assert!(inside(root, "src/../../x").is_err());
    }

    #[test]
    fn keeps_files_marked_not_to_overwrite() {
        let dir = std::env::temp_dir().join(format!("kiln-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let d = dir.to_string_lossy().to_string();
        let file = |c: &str, overwrite| OutFile { path: "src/app.cpp".into(), content: c.into(), overwrite };
        assert_eq!(write_project(d.clone(), vec![file("first", false)]).unwrap(), vec!["src/app.cpp"]);
        assert!(write_project(d.clone(), vec![file("second", false)]).unwrap().is_empty());
        assert_eq!(fs::read_to_string(dir.join("src/app.cpp")).unwrap(), "first");
        let _ = fs::remove_dir_all(&dir);
    }
}
