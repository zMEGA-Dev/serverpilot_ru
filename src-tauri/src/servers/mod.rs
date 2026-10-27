use serde::{Deserialize, Serialize};
use chrono::Utc;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub key_path: Option<String>,
    pub group_name: Option<String>,
    pub tags: Vec<String>,
    pub description: String,
    pub color: String,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AuthType {
    Password,
    Key,
    Agent,
}

impl std::fmt::Display for AuthType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthType::Password => write!(f, "password"),
            AuthType::Key => write!(f, "key"),
            AuthType::Agent => write!(f, "agent"),
        }
    }
}

impl From<&str> for AuthType {
    fn from(s: &str) -> Self {
        match s {
            "key" => AuthType::Key,
            "agent" => AuthType::Agent,
            _ => AuthType::Password,
        }
    }
}

impl Server {
    #[allow(dead_code)]
    pub fn new(
        name: String,
        host: String,
        port: u16,
        username: String,
        auth_type: AuthType,
    ) -> Self {
        let now = Utc::now().to_rfc3339();
        Server {
            id: Uuid::new_v4().to_string(),
            name,
            host,
            port,
            username,
            auth_type,
            key_path: None,
            group_name: None,
            tags: vec![],
            description: String::new(),
            color: "#4f8ef7".to_string(),
            favorite: false,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
    pub group_name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateServerRequest {
    pub id: String,
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub key_path: Option<String>,
    pub group_name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub favorite: Option<bool>,
}
