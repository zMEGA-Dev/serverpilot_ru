# Security Model — ServerPilot RU

## Scope

This document describes the security model of the current **Alpha** release.

It is a description of the implemented design and current safeguards, not a guarantee that the application is impossible to compromise.

---

## Core principles

1. **Local-first:** there is no mandatory ServerPilot cloud backend.
2. **SSH credentials are protected locally:** stored SSH passwords and key passphrases are encrypted with AES-256-GCM.
3. **Private SSH keys stay with the user:** the application stores the path to the key file rather than copying the private key into its database.
4. **AI is optional:** AI calls happen only when the user configures and invokes an AI endpoint.
5. **AI does not receive SSH secrets intentionally:** passwords, private keys, and key passphrases are excluded from AI context.
6. **Risky actions require user confirmation:** the application does not grant AI autonomous execution authority.
7. **Security Audit is read-only:** the audit checks the server without changing its firewall, SSH, packages, users, or other configuration.

---

## Credential storage

### SSH passwords and key passphrases

Stored SSH passwords and SSH key passphrases are encrypted locally using:

```text
AES-256-GCM
machine-specific key derivation
unique nonce per encrypted value
```

The local machine identity is part of the current key derivation approach.

Important consequence:

- credentials are intended to be recoverable only on the same supported Windows installation/machine context;
- moving the database to another machine may make encrypted credentials unavailable;
- users should retain an alternative way to authenticate to their servers.

### Private SSH keys

The application does not copy private SSH key files into SQLite.

It stores the path to the user's key file and reads the key when required for authentication.

### AI API keys

AI provider credentials are stored separately from the encrypted SSH credential table. They should be treated as sensitive local application data and must never be committed to the public repository.

---

## Data that is not a secret by itself

Examples include:

- server hostname or IP address;
- SSH port;
- SSH username;
- path to a local SSH key file.

Although these values are not equivalent to passwords or private keys, users should still avoid publishing unnecessary infrastructure details.

---

## Command risk classification

The application classifies commands into risk levels used by the confirmation UI:

| Level | Examples | UI behavior |
|---|---|---|
| `read_only` | `df -h`, `ps aux`, `cat file` | Normal execution |
| `low` | `echo`, `pwd`, `ls` | Normal execution |
| `medium` | service restart, package installation | Warning |
| `high` | recursive removal, process termination | Strong warning |
| `critical` | destructive filesystem commands | Explicit confirmation |

The exact classifier is heuristic. A risk label should never be interpreted as a guarantee that a command is safe.

---

## AI command execution

AI suggestions are not automatically executed.

The intended flow is:

```text
AI suggestion
     ↓
Risk classification
     ↓
User reviews command
     ↓
User clicks Execute or Skip
```

The application is designed so that an AI response alone does not authorize execution.

---

## Prompt-injection protection

Server-controlled content such as logs, metrics, and command output is treated as untrusted input.

This content is kept separate from the AI system prompt and is explicitly marked as server data before being sent to the configured AI provider.

This reduces the risk that malicious text inside a server log will be interpreted as an instruction from the application developer.

---

## SSH security

Current protections include:

- host-key/fingerprint handling;
- known-hosts support;
- keepalive support;
- connection timeout handling;
- separate PTY sessions;
- local retention of private SSH keys.

Users should still verify host fingerprints and use appropriate SSH server hardening.

---

## SFTP security

The SFTP/file-manager layer includes protections such as:

- path normalization and validation;
- path traversal checks;
- restrictions around protected system paths in the client;
- text/binary file handling;
- editor size limits;
- explicit confirmation for destructive file operations.

Server-side Unix permissions still apply. If the SSH account has permission to read or modify a file, the application can generally act with that account's privileges.

---

## Security Audit

The built-in Security Audit is intended to be read-only.

It gathers information from commands such as:

- `cat`
- `grep`
- `ss`
- `netstat`
- `journalctl`
- `lastb`
- `ufw status`
- `firewall-cmd --state`
- `nft list`
- `iptables -L`

The audit should not be treated as a replacement for a full professional security assessment.

---

## Secret handling

The project must never contain:

- API keys;
- SSH passwords;
- private SSH keys;
- private license-signing keys;
- payment credentials;
- server credentials;
- production tokens.

Alpha documentation and test data should use placeholders.

---

## Public GitHub repository

If the Alpha repository is published publicly, assume that all committed source and documentation are public.

Therefore:

- no private signing keys;
- no API keys;
- no passwords;
- no production server credentials;
- no local databases containing user data;
- no `.env` secrets.

Future license/signing infrastructure should remain server-side and outside the public client repository.

---

## Current Alpha limitations

The Alpha release still has areas that require real-world testing, including:

- Windows notification delivery;
- reconnect behavior;
- long-running SSH operations;
- SSL/Certbot workflows on a real domain;
- backup workflows;
- AI integrations with real endpoints.

These limitations should be considered when evaluating release readiness.
