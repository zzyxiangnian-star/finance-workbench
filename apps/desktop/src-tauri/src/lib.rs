use serde::Serialize;
use std::{env, fs, path::PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendConfig {
    base_url: String,
    token: String,
}

/// 数据目录：FW_DATA_DIR 优先；Windows 用 %APPDATA%\FinanceWorkbench；其他系统 ~/.finance-workbench。
/// 与 services/core/src/finance_core/config.py 保持一致。
fn data_dir() -> Option<PathBuf> {
    if let Ok(d) = env::var("FW_DATA_DIR") {
        if !d.is_empty() {
            return Some(PathBuf::from(d));
        }
    }
    if let Ok(appdata) = env::var("APPDATA") {
        return Some(PathBuf::from(appdata).join("FinanceWorkbench"));
    }
    let home = env::var("HOME").or_else(|_| env::var("USERPROFILE")).ok()?;
    Some(PathBuf::from(home).join(".finance-workbench"))
}

/// 读取本机服务地址和令牌。令牌文件由本机服务首次启动时生成。
#[tauri::command]
fn get_backend_config() -> Result<BackendConfig, String> {
    let dir = data_dir().ok_or("找不到数据目录")?;
    let path = dir.join("api-token");
    let token = fs::read_to_string(&path)
        .map_err(|_| format!("没有找到 {}，本机服务可能还没启动过", path.display()))?
        .trim()
        .to_string();
    let port = env::var("FW_PORT").unwrap_or_else(|_| "8765".into());
    Ok(BackendConfig { base_url: format!("http://127.0.0.1:{port}"), token })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_backend_config])
        .run(tauri::generate_context!())
        .expect("启动财务工作台失败");
}
