use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use sha2::{Digest, Sha256};

/// Получить мастер-ключ шифрования.
/// В production используем Windows DPAPI через machine-specific данные.
/// Здесь используем комбинацию machine ID + app ID для деривации ключа.
fn derive_master_key() -> Result<[u8; 32]> {
    let machine_id = get_machine_id()?;
    let app_id = "ru.serverpilot.app.v1";

    let combined = format!("{}-{}", machine_id, app_id);
    let mut hasher = Sha256::new();
    hasher.update(combined.as_bytes());
    let result = hasher.finalize();

    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    Ok(key)
}

/// Получить уникальный идентификатор машины.
fn get_machine_id() -> Result<String> {
    // На Windows используем MachineGuid из реестра
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let output = Command::new("powershell")
            .args([
                "-Command",
                "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid"
            ])
            .output();

        if let Ok(out) = output {
            let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !id.is_empty() {
                return Ok(id);
            }
        }
    }

    // Fallback: использовать username + hostname
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown".to_string());

    Ok(format!("fallback-{}", username))
}

/// Зашифровать строку (AES-256-GCM).
pub fn encrypt(plaintext: &str) -> Result<String> {
    let key_bytes = derive_master_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("Ошибка шифрования: {}", e))?;

    // Формат: base64(nonce + ciphertext)
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&combined))
}

/// Расшифровать строку.
pub fn decrypt(ciphertext_b64: &str) -> Result<String> {
    let key_bytes = derive_master_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let combined = BASE64
        .decode(ciphertext_b64)
        .context("Ошибка декодирования base64")?;

    if combined.len() < 12 {
        return Err(anyhow::anyhow!("Данные зашифрованы неверно"));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Ошибка расшифровки: {}", e))?;

    String::from_utf8(plaintext).context("Ошибка преобразования в строку")
}

/// Проверить, что модуль работает корректно.
#[allow(dead_code)]
pub fn self_test() -> Result<()> {
    let test = "test_secret_value";
    let encrypted = encrypt(test)?;
    let decrypted = decrypt(&encrypted)?;
    assert_eq!(test, decrypted);
    Ok(())
}
