"""Encrypted, server-side credential store.

Lets an operator configure AWS + GitLab credentials ONCE (instead of pasting
them on every diagram run) without putting secrets in the browser. The blob is
Fernet-encrypted at rest on the persistent volume; secret values are never
returned to the client (only non-sensitive hints via `status()`).

Master key resolution:
  1. `CENOTE_SECRET_KEY` env var, if set (recommended — keeps the key out of
     the data volume so a volume snapshot alone can't decrypt the secrets).
  2. Otherwise a key auto-generated once and persisted next to the store with
     0600 perms. Zero-config, but key + ciphertext live on the same volume.

Threat model (local single-tenant Docker): protects against accidental
plaintext-on-disk and from secrets showing up in `docker inspect` / process
environment. It does NOT protect against an attacker who already has both the
volume contents AND the env/key.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import stat
from pathlib import Path
from typing import Any

import structlog
from cryptography.fernet import Fernet, InvalidToken

log = structlog.get_logger()

_STORE_NAME = "credentials.enc"
_KEY_NAME = ".cenote_key"


class SecretStore:
    def __init__(self, directory: Path, env_key: str | None = None) -> None:
        self._dir = directory
        self._store_path = directory / _STORE_NAME
        self._key_path = directory / _KEY_NAME
        self._env_key = env_key or None

    # ---- key management ----

    def _fernet(self) -> Fernet:
        if self._env_key:
            # Derive a stable 32-byte urlsafe key from an arbitrary env string.
            digest = hashlib.sha256(self._env_key.encode("utf-8")).digest()
            return Fernet(base64.urlsafe_b64encode(digest))
        if self._key_path.exists():
            return Fernet(self._key_path.read_bytes())
        self._dir.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        self._key_path.write_bytes(key)
        try:
            os.chmod(self._key_path, stat.S_IRUSR | stat.S_IWUSR)  # 0600
        except OSError:
            pass  # best-effort on filesystems that don't support chmod
        log.info("secret_store.key_generated", path=str(self._key_path))
        return Fernet(key)

    # ---- persistence ----

    def save(self, data: dict[str, Any]) -> None:
        """Encrypt and persist the full credentials blob (overwrites)."""
        self._dir.mkdir(parents=True, exist_ok=True)
        token = self._fernet().encrypt(json.dumps(data).encode("utf-8"))
        self._store_path.write_bytes(token)
        try:
            os.chmod(self._store_path, stat.S_IRUSR | stat.S_IWUSR)  # 0600
        except OSError:
            pass
        log.info("secret_store.saved", keys=sorted(data.keys()))  # keys only, never values

    def load(self) -> dict[str, Any]:
        """Decrypt and return the stored blob, or {} if absent/undecryptable."""
        if not self._store_path.exists():
            return {}
        try:
            raw = self._fernet().decrypt(self._store_path.read_bytes())
            return json.loads(raw)
        except (InvalidToken, ValueError, json.JSONDecodeError) as exc:
            # Wrong/rotated key or corrupt file — treat as unconfigured rather
            # than crash, but log so the operator can investigate.
            log.warning("secret_store.decrypt_failed", error=type(exc).__name__)
            return {}

    def clear(self) -> bool:
        existed = self._store_path.exists()
        self._store_path.unlink(missing_ok=True)
        if existed:
            log.info("secret_store.cleared")
        return existed

    # ---- safe status (no secret values leave the process) ----

    def status(self) -> dict[str, Any]:
        """Non-sensitive view of what's configured, safe to send to the client.
        Returns booleans + masked hints (key tails, project paths), never the
        secret values themselves."""
        data = self.load()
        aws = data.get("aws") or {}
        gl = data.get("gitlab") or {}
        tv = data.get("tf_vars") or {}
        return {
            "aws": {
                "configured": bool(aws.get("access_key_id") and aws.get("secret_access_key")),
                "access_key_tail": _tail(aws.get("access_key_id")),
                "region": aws.get("region") or None,
            },
            "gitlab": {
                "configured": bool(gl.get("token") and (gl.get("project") or gl.get("group"))),
                "project": gl.get("project") or None,
                "group": gl.get("group") or None,
                "environment": gl.get("environment") or None,
            },
            # Only NAMES of stored TF vars; values stay encrypted on disk.
            "tf_vars": {
                "configured": bool(tv),
                "count": len(tv),
                "names": sorted(tv.keys()),
            },
        }


def _tail(value: str | None, keep: int = 4) -> str | None:
    if not value:
        return None
    return ("…" + value[-keep:]) if len(value) > keep else "…"
