import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../services/sshQueue";
import { CheckCircle, XCircle, Loader2, ArrowRight } from "lucide-react";
import { useServersStore } from "../stores/serversStore";
import type { CreateServerRequest, AuthType, SshConnectionParams } from "../types";
import styles from "./OnboardingPage.module.css";

type Step = "welcome" | "add-server" | "checking" | "done";

interface Check {
  key: string;
  label: string;
  status: "pending" | "ok" | "fail" | "info";
}

export function OnboardingPage() {
  const { t } = useTranslation();
  const { addServer, selectServer } = useServersStore();

  const [step, setStep] = useState<Step>("welcome");
  const [form, setForm] = useState<CreateServerRequest>({
    name: "",
    host: "",
    port: 22,
    username: "root",
    auth_type: "password",
    password: "",
    color: "#4f8ef7",
  });
  const [authType, setAuthType] = useState<AuthType>("password");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);

  const updateForm = (field: keyof CreateServerRequest, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleTestAndSave = async () => {
    setError("");
    setTesting(true);

    const params: SshConnectionParams = {
      server_id: "test",
      host: form.host,
      port: form.port,
      username: form.username,
      auth_type: authType,
      password: form.password,
      key_path: form.key_path,
      key_passphrase: form.key_passphrase,
    };

    try {
      const result = await invoke<{ success: boolean; error?: string }>(
        "test_ssh_connection",
        { request: params }
      );

      if (!result.success) {
        setError(result.error || t("errors.connectionFailed"));
        setTesting(false);
        return;
      }

      const req: CreateServerRequest = { ...form, auth_type: authType };
      const saved = await addServer(req);

      setStep("checking");
      await runChecks(saved.id);
      selectServer(saved.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setTesting(false);
    }
  };

  const runChecks = async (serverId: string) => {
    const checkList: Check[] = [
      { key: "ssh",    label: t("onboarding.checks.ssh"),    status: "ok" },
      { key: "os",     label: t("onboarding.checks.os"),     status: "pending" },
      { key: "cpu",    label: t("onboarding.checks.cpu"),    status: "pending" },
      { key: "ram",    label: t("onboarding.checks.ram"),    status: "pending" },
      { key: "disk",   label: t("onboarding.checks.disk"),   status: "pending" },
      { key: "nginx",  label: t("onboarding.checks.nginx"),  status: "pending" },
      { key: "pm2",    label: t("onboarding.checks.pm2"),    status: "pending" },
      { key: "docker", label: t("onboarding.checks.docker"), status: "pending" },
    ];
    setChecks([...checkList]);

    try {
      await sshInvoke("connect_ssh", { serverId });
    } catch {
      setChecks((c) => c.map((x) => ({ ...x, status: "fail" as const })));
      setStep("done");
      return;
    }

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const updateCheck = (key: string, status: Check["status"]) => {
      setChecks((c) => c.map((x) => (x.key === key ? { ...x, status } : x)));
    };

    try {
      const stats = await sshInvoke<{ os_name: string }>("get_server_stats", { serverId });
      updateCheck("os", stats.os_name ? "ok" : "fail");
      await delay(300);
      updateCheck("cpu", "ok");
      await delay(200);
      updateCheck("ram", "ok");
      await delay(200);
      updateCheck("disk", "ok");
    } catch {
      updateCheck("os", "fail");
      updateCheck("cpu", "fail");
      updateCheck("ram", "fail");
      updateCheck("disk", "fail");
    }

    await delay(200);
    try {
      const nginxResult = await sshInvoke<{ exit_code: number }>("execute_command", {
        serverId,
        command: "which nginx 2>/dev/null && echo found || echo not_found",
      });
      updateCheck("nginx", nginxResult.exit_code === 0 ? "ok" : "info");
    } catch { updateCheck("nginx", "info"); }

    await delay(200);
    try {
      const pm2Result = await sshInvoke<{ exit_code: number }>("execute_command", {
        serverId,
        command: "which pm2 2>/dev/null && echo found || echo not_found",
      });
      updateCheck("pm2", pm2Result.exit_code === 0 ? "ok" : "info");
    } catch { updateCheck("pm2", "info"); }

    await delay(200);
    try {
      const dockerResult = await sshInvoke<{ exit_code: number }>("execute_command", {
        serverId,
        command: "which docker 2>/dev/null && echo found || echo not_found",
      });
      updateCheck("docker", dockerResult.exit_code === 0 ? "ok" : "info");
    } catch { updateCheck("docker", "info"); }

    await delay(400);
    setStep("done");
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>SP</div>
          <h1 className={styles.logoText}>
            ServerPilot <span className={styles.logoRu}>RU</span>
          </h1>
        </div>

        {step === "welcome" && (
          <div className={styles.card}>
            <h2 className={styles.title}>{t("onboarding.welcome")}</h2>
            <p className={styles.subtitle}>{t("onboarding.tagline")}</p>
            <button className={styles.primaryBtn} onClick={() => setStep("add-server")}>
              {t("onboarding.addFirst")}
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {step === "add-server" && (
          <div className={styles.card}>
            <h2 className={styles.title}>{t("servers.add")}</h2>
            <div className={styles.form}>
              <div className={styles.field}>
                <label>{t("servers.name")}</label>
                <input value={form.name} onChange={(e) => updateForm("name", e.target.value)}
                  placeholder="prod-web" className={styles.input} />
              </div>
              <div className={styles.row}>
                <div className={styles.field} style={{ flex: 2 }}>
                  <label>{t("servers.host")}</label>
                  <input value={form.host} onChange={(e) => updateForm("host", e.target.value)}
                    placeholder="192.168.1.10" className={styles.input} />
                </div>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label>{t("servers.port")}</label>
                  <input type="number" value={form.port}
                    onChange={(e) => updateForm("port", Number(e.target.value))} className={styles.input} />
                </div>
              </div>
              <div className={styles.field}>
                <label>{t("servers.username")}</label>
                <input value={form.username} onChange={(e) => updateForm("username", e.target.value)}
                  placeholder="root" className={styles.input} />
              </div>
              <div className={styles.field}>
                <label>{t("servers.authentication")}</label>
                <div className={styles.authTabs}>
                  {(["password", "key", "agent"] as AuthType[]).map((type) => (
                    <button
                      key={type}
                      className={`${styles.authTab} ${authType === type ? styles.authTabActive : ""}`}
                      onClick={() => { setAuthType(type); updateForm("auth_type", type); }}
                    >
                      {type === "password" ? t("servers.authPassword")
                        : type === "key" ? t("servers.authKey")
                        : t("servers.authAgent")}
                    </button>
                  ))}
                </div>
              </div>

              {authType === "password" && (
                <div className={styles.field}>
                  <label>{t("servers.password")}</label>
                  <input type="password" value={form.password || ""}
                    onChange={(e) => updateForm("password", e.target.value)}
                    placeholder="••••••••" className={styles.input} />
                </div>
              )}

              {authType === "key" && (
                <>
                  <div className={styles.field}>
                    <label>{t("servers.keyPath")}</label>
                    <input value={form.key_path || ""}
                      onChange={(e) => updateForm("key_path", e.target.value)}
                      placeholder="C:\Users\you\.ssh\id_rsa" className={styles.input} />
                  </div>
                  <div className={styles.field}>
                    <label>{t("onboarding.passphraseOptional")}</label>
                    <input type="password" value={form.key_passphrase || ""}
                      onChange={(e) => updateForm("key_passphrase", e.target.value)}
                      placeholder="••••••••" className={styles.input} />
                  </div>
                </>
              )}

              {authType === "agent" && (
                <p className={styles.agentHint}>{t("servers.agentHint")}</p>
              )}

              {error && <div className={styles.error}>{error}</div>}

              <button
                className={styles.primaryBtn}
                onClick={handleTestAndSave}
                disabled={testing || !form.name || !form.host || !form.username}
              >
                {testing ? (
                  <><Loader2 size={16} className="animate-spin" /> {t("servers.testingConnection")}</>
                ) : (
                  <>{t("servers.testConnection")} <ArrowRight size={16} /></>
                )}
              </button>
            </div>
          </div>
        )}

        {(step === "checking" || step === "done") && (
          <div className={styles.card}>
            <h2 className={styles.title}>
              {step === "checking" ? t("onboarding.checking") : t("onboarding.serverAdded")}
            </h2>
            <div className={styles.checkList}>
              {checks.map((check) => (
                <div key={check.key} className={styles.checkItem}>
                  {check.status === "pending" ? (
                    <Loader2 size={16} className={`animate-spin ${styles.checkPending}`} />
                  ) : check.status === "ok" ? (
                    <CheckCircle size={16} className={styles.checkOk} />
                  ) : check.status === "info" ? (
                    <span className={styles.checkInfo}>—</span>
                  ) : (
                    <XCircle size={16} className={styles.checkFail} />
                  )}
                  <span className={styles.checkLabel}>{check.label}</span>
                </div>
              ))}
            </div>
            {step === "done" && (
              <a href="/dashboard" className={styles.primaryBtn} style={{ textDecoration: "none" }}>
                {t("onboarding.goToDashboard")}
                <ArrowRight size={16} />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
