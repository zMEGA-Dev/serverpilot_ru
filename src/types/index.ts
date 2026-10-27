// =====================================================
// ServerPilot RU — Core Types
// =====================================================

export type AuthType = "password" | "key" | "agent";

export type ServerStatus = "online" | "offline" | "connecting" | "error" | "unknown";

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  key_path?: string;
  group_name?: string;
  tags: string[];
  description: string;
  color: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  // Runtime (не хранится в БД)
  status?: ServerStatus;
}

export interface CreateServerRequest {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  password?: string;
  key_path?: string;
  key_passphrase?: string;
  group_name?: string;
  tags?: string[];
  description?: string;
  color?: string;
  favorite?: boolean;
}

export interface UpdateServerRequest {
  id: string;
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  auth_type?: AuthType;
  key_path?: string;
  group_name?: string;
  tags?: string[];
  description?: string;
  color?: string;
  favorite?: boolean;
}

export interface SshConnectionParams {
  server_id: string;
  host: string;
  port: number;
  username: string;
  auth_type: string;
  password?: string;
  key_path?: string;
  key_passphrase?: string;
}

export interface SshConnectionResult {
  success: boolean;
  server_id: string;
  fingerprint?: string;
  banner?: string;
  error?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

export interface ServerStats {
  server_id: string;
  cpu_usage: number;
  ram_used_mb: number;
  ram_total_mb: number;
  ram_usage_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_usage_percent: number;
  load_avg_1: number;
  load_avg_5: number;
  load_avg_15: number;
  uptime_seconds: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  os_name: string;
  kernel_version: string;
  hostname: string;
  timestamp: string;
}

// AI
export type AiMode = "explain" | "diagnose" | "fix" | "optimize" | "security" | "deploy";

export type CommandRisk = "read_only" | "low" | "medium" | "high" | "critical";

export interface AiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  proposed_command?: ProposedCommand;
}

export interface ProposedCommand {
  command: string;
  explanation: string;
  risk: CommandRisk;
  approved?: boolean;
  result?: CommandResult;
}

export interface AiProvider {
  id: string;
  name: string;
  api_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
}

// Logs
export interface LogFile {
  path: string;
  name: string;
  size: number;
  modified: string;
  category: "system" | "nginx" | "apache" | "mysql" | "app";
}

// Security
export type SecurityCheckStatus = "pass" | "warning" | "critical" | "info";

// Scripts
export interface Script {
  id: string;
  name: string;
  description: string;
  command: string;
  variables: ScriptVariable[];
  server_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ScriptVariable {
  name: string;
  description: string;
  default_value?: string;
}

// Notifications
export type NotificationType = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  server_id?: string;
}

/** Настройки Desktop-уведомлений (хранятся в localStorage) */
export interface NotificationSettings {
  enabled: boolean;
  serverOffline: boolean;
  cpuHigh: boolean;
  ramHigh: boolean;
  diskHigh: boolean;
  sslExpiring: boolean;
  sslExpired: boolean;
  backupFailed: boolean;
  deployFailed: boolean;
  deploySuccess: boolean;
  cpuThreshold: number;
  ramThreshold: number;
  diskThreshold: number;
  sslDaysThreshold: number;
}

// =====================================================
// File Manager
// =====================================================

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  modified: string;
  permissions: string;
  permissions_octal: string;
  owner: string;
  group: string;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  is_binary: boolean;
}

export interface OpenedFile {
  entry: FileEntry;
  content: string;
  originalContent: string;
  isDirty: boolean;
}

export type FileManagerView = "browser" | "editor";

// =====================================================
// Process Manager
// =====================================================

export interface ProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz_kb: number;
  rss_kb: number;
  state: string;
  state_label: string;
  started: string;
  time: string;
  command: string;
  exe: string;
}

export interface KillResult {
  pid: number;
  signal: string;
  success: boolean;
  message: string;
}

export type ProcessSortKey = "pid" | "user" | "cpu" | "mem" | "state" | "command";
export type SortDir = "asc" | "desc";

// =====================================================
// PM2 Manager
// =====================================================

export interface Pm2App {
  id: number;
  name: string;
  pid: number;
  status: string;
  cpu: number;
  memory_mb: number;
  restarts: number;
  uptime_ms: number;
  uptime_str: string;
  mode: string;
  instances: number;
  node_version: string;
  script: string;
  cwd: string;
  args: string;
  pm_log_path: string;
  pm_err_log_path: string;
  ecosystem_path: string;
  created_at: string;
  namespace: string;
}

export interface Pm2AppDetail {
  app: Pm2App;
  env: [string, string][];
}

export interface Pm2DetectResult {
  installed: boolean;
  version: string;
  error: string;
}

export interface Pm2ActionResult {
  success: boolean;
  message: string;
  raw_output: string;
}

export interface Pm2StartRequest {
  name: string;
  script: string;
  cwd: string;
  interpreter: string;
  args: string;
}

// =====================================================
// Docker Manager
// =====================================================

export interface DockerInfo {
  installed: boolean;
  version: string;
  daemon_running: boolean;
  has_permission: boolean;
  error: string;
}

export interface DockerContainer {
  id: string;
  short_id: string;
  name: string;
  image: string;
  image_id: string;
  status: string;
  state: string;
  created: string;
  started_at: string;
  ports: string;
  cpu_percent: number;
  mem_mb: number;
  mem_limit_mb: number;
  mem_percent: number;
  command: string;
  restart_policy: string;
  networks: string;
}

export interface DockerMount {
  source: string;
  destination: string;
  mode: string;
  mount_type: string;
}

export interface DockerContainerDetail {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
  started_at: string;
  finished_at: string;
  ports: string[];
  mounts: DockerMount[];
  networks: string[];
  restart_policy: string;
  command: string;
  entrypoint: string;
  env: [string, string][];
}

export interface DockerImage {
  id: string;
  short_id: string;
  repository: string;
  tag: string;
  created: string;
  size_mb: number;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  created: string;
  scope: string;
}

export interface DockerNetwork {
  id: string;
  short_id: string;
  name: string;
  driver: string;
  scope: string;
  subnet: string;
  gateway: string;
  containers: string[];
}

export interface DockerActionResult {
  success: boolean;
  message: string;
  output: string;
}

// =====================================================
// Git Deploy
// =====================================================

export interface GitDetectResult {
  installed: boolean;
  version: string;
}

export interface GitStatusResult {
  is_repo: boolean;
  branch: string;
  commit_hash: string;
  commit_message: string;
  commit_author: string;
  commit_date: string;
  has_changes: boolean;
  changes_summary: string;
}

export interface GitOperationResult {
  success: boolean;
  output: string;
  exit_code: number;
  message: string;
}

export interface DeployRecord {
  id: string;
  server_name: string;
  repository: string;
  branch: string;
  directory: string;
  commit: string;
  timestamp: string;
  status: "success" | "error";
  message: string;
}

// =====================================================
// Nginx Manager
// =====================================================

export interface NginxInfo {
  installed: boolean;
  version: string;
  running: boolean;
  config_ok: boolean;
  config_test_output: string;
  has_sites_available: boolean;
  has_sites_enabled: boolean;
  has_conf_d: boolean;
}

export interface NginxSite {
  name: string;
  config_path: string;
  enabled: boolean;
  listen_ports: string[];
  server_names: string[];
  has_ssl: boolean;
  root: string;
}

export interface NginxResult {
  success: boolean;
  output: string;
  message: string;
}

// =====================================================
// SSL / Let's Encrypt
// =====================================================

export interface CertbotInfo {
  installed: boolean;
  version: string;
  error: string;
}

export interface SslStatus {
  has_ssl: boolean;
  cert_path: string;
  subject: string;
  issuer: string;
  not_before: string;
  not_after: string;
  days_remaining: number;
  is_valid: boolean;
  is_expiring_soon: boolean;
}

export interface CertbotCert {
  domain: string;
  expiry: string;
  cert_path: string;
  key_path: string;
  days_remaining: number;
}

export interface RenewalStatus {
  timer_active: boolean;
  timer_info: string;
}

export interface SslResult {
  success: boolean;
  output: string;
  message: string;
}

// =====================================================
// Security Audit
// =====================================================

export type CheckStatus = "pass" | "warning" | "critical" | "info" | "unknown";

export interface SecurityCheck {
  id: string;
  category: string;
  title: string;
  status: CheckStatus;
  current_value: string;
  description: string;
  recommendation: string;
}

export interface AuditResult {
  checks: SecurityCheck[];
  score: number;
  pass_count: number;
  warning_count: number;
  critical_count: number;
  unknown_count: number;
}

// =====================================================
// Backup Manager
// =====================================================

export interface Backup {
  id: string;
  server_id: string;
  server_name: string;
  source_path: string;
  archive_name: string;
  archive_path: string;
  size_bytes: number;
  status: "creating" | "ready" | "downloading" | "deleted" | "error";
  error_message: string;
  created_at: string;
  downloaded_at?: string;
}

export interface BackupSpaceInfo {
  source_size_bytes: number;
  free_bytes: number;
  source_size_human: string;
  free_human: string;
  has_enough_space: boolean;
  is_system_dir: boolean;
}

export interface BackupResult {
  success: boolean;
  backup_id: string;
  archive_path: string;
  size_bytes: number;
  size_human: string;
  message: string;
}
