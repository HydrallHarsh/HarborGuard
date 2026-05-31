import json
import logging
import os
import subprocess
import threading
import time
import contextvars
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("harborguard.coral")

_coral_lock = threading.Lock()

_coral_credential_overrides: contextvars.ContextVar[dict[str, str] | None] = contextvars.ContextVar(
    "coral_credential_overrides",
    default=None,
)


def load_dotenv() -> None:
    env_paths = [
        Path(__file__).resolve().parent / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]

    for env_path in env_paths:
        if not env_path.exists():
            continue

        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            value = os.path.expandvars(value)

            if not key:
                continue

            if value:
                os.environ[key] = value


def harborguard_root() -> Path:
    return Path(__file__).resolve().parent.parent


def resolve_coral_bin() -> str:
    """
    Prefer CORAL_BIN from env; resolve relative paths from harborguard root.
    Otherwise use coral-download/coral.exe when present, else PATH `coral`.
    """
    root = harborguard_root()
    override = os.getenv("CORAL_BIN", "").strip()
    if override:
        candidate = Path(os.path.expandvars(override))
        if not candidate.is_absolute():
            candidate = (root / candidate).resolve()
        if candidate.exists():
            return str(candidate)
        if "/" not in override and "\\" not in override:
            return override
        return str(candidate)

    for name in ("coral.exe", "coral"):
        bundled = root / "coral-download" / name
        if bundled.is_file():
            return str(bundled.resolve())
    return "coral"


def resolve_coral_config_dir() -> str | None:
    raw = os.getenv("CORAL_CONFIG_DIR", "").strip()
    if not raw:
        return None
    return os.path.expandvars(raw)


def get_credential(env_key: str) -> str:
    overrides = _coral_credential_overrides.get()
    if overrides and overrides.get(env_key):
        return overrides[env_key]
    return os.getenv(env_key, "").strip()


@contextmanager
def coral_credentials_context(
    github_token: str | None = None,
    notion_api_key: str | None = None,
    slack_token: str | None = None,
):
    """Per-request Coral/GitHub credentials (UI-provided or server .env fallback)."""
    overrides: dict[str, str] = {}
    if github_token and github_token.strip():
        overrides["GITHUB_TOKEN"] = github_token.strip()
    if notion_api_key and notion_api_key.strip():
        overrides["NOTION_API_KEY"] = notion_api_key.strip()
    if slack_token and slack_token.strip():
        overrides["SLACK_TOKEN"] = slack_token.strip()

    if not overrides:
        yield
        return

    reset = _coral_credential_overrides.set(overrides)
    try:
        yield
    finally:
        _coral_credential_overrides.reset(reset)


def coral_env(config_dir: str | None) -> dict[str, str]:
    env = os.environ.copy()
    overrides = _coral_credential_overrides.get()
    if overrides:
        env.update(overrides)
    if config_dir:
        env["CORAL_CONFIG_DIR"] = config_dir
    else:
        env.pop("CORAL_CONFIG_DIR", None)
    return env


@dataclass
class CoralResult:
    rows: list[dict]
    sql: str


@dataclass
class CoralCommandResult:
    returncode: int
    stdout: str
    stderr: str


class CoralClientError(RuntimeError):
    pass


class CoralClient:
    def __init__(self) -> None:
        load_dotenv()
        self.coral_bin = resolve_coral_bin()
        self.config_dir = resolve_coral_config_dir()
        self.timeout_seconds = float(os.getenv("CORAL_QUERY_TIMEOUT_SECONDS", "20"))
        self.source_add_timeout_seconds = float(
            os.getenv("CORAL_SOURCE_ADD_TIMEOUT_SECONDS", "45")
        )
        logger.info("coral.client.init bin=%s config_dir=%s", self.coral_bin, self.config_dir)

    def _run(self, command: list[str], timeout: float) -> subprocess.CompletedProcess[str]:
        with _coral_lock:
            return subprocess.run(
                command,
                env=coral_env(self.config_dir),
                text=True,
                capture_output=True,
                check=False,
                timeout=timeout,
            )

    def query(self, sql: str, timeout_seconds: float | None = None) -> CoralResult:
        command = [self.coral_bin, "sql", "--format", "json", sql]
        timeout = timeout_seconds or self.timeout_seconds
        started_at = time.perf_counter()
        logger.info(
            "coral.sql.start timeout=%ss sql=%s",
            f"{timeout:g}",
            compact_sql(sql),
        )

        try:
            completed = self._run(command, timeout)
        except subprocess.TimeoutExpired as error:
            duration_ms = elapsed_ms(started_at)
            logger.warning(
                "coral.sql.timeout duration_ms=%s timeout=%ss",
                duration_ms,
                f"{timeout:g}",
            )
            raise CoralClientError(
                f"Coral query timed out after {timeout:g}s"
            ) from error

        if completed.returncode != 0:
            message = completed.stderr.strip() or completed.stdout.strip()
            logger.warning(
                "coral.sql.failed duration_ms=%s returncode=%s error=%s",
                elapsed_ms(started_at),
                completed.returncode,
                compact_text(message),
            )
            raise CoralClientError(message or "Coral query failed")

        try:
            rows = json.loads(completed.stdout or "[]")
        except json.JSONDecodeError as error:
            logger.warning(
                "coral.sql.invalid_json duration_ms=%s error=%s",
                elapsed_ms(started_at),
                error,
            )
            raise CoralClientError(f"Coral returned invalid JSON: {error}") from error

        if not isinstance(rows, list):
            logger.warning(
                "coral.sql.invalid_shape duration_ms=%s",
                elapsed_ms(started_at),
            )
            raise CoralClientError("Coral returned JSON, but it was not a row list")

        logger.info(
            "coral.sql.ok duration_ms=%s rows=%s",
            elapsed_ms(started_at),
            len(rows),
        )
        return CoralResult(rows=rows, sql=sql)

    def source_list(self) -> CoralCommandResult:
        started_at = time.perf_counter()
        logger.info("coral.source_list.start timeout=%ss", f"{self.timeout_seconds:g}")
        completed = self._run(
            [self.coral_bin, "source", "list"],
            self.timeout_seconds,
        )
        logger.info(
            "coral.source_list.done duration_ms=%s returncode=%s",
            elapsed_ms(started_at),
            completed.returncode,
        )
        return CoralCommandResult(
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )

    def source_add(self, source_name: str, timeout_seconds: float | None = None) -> CoralCommandResult:
        """Register a bundled Coral source (github, slack, notion). Reads tokens from env."""
        timeout = timeout_seconds or self.source_add_timeout_seconds
        started_at = time.perf_counter()
        logger.info("coral.source_add.start source=%s timeout=%ss", source_name, f"{timeout:g}")
        try:
            completed = self._run([self.coral_bin, "source", "add", source_name], timeout)
        except subprocess.TimeoutExpired as error:
            raise CoralClientError(
                f"coral source add {source_name} timed out after {timeout:g}s"
            ) from error
        logger.info(
            "coral.source_add.done source=%s duration_ms=%s returncode=%s",
            source_name,
            elapsed_ms(started_at),
            completed.returncode,
        )
        return CoralCommandResult(
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )

    def source_add_file(
        self,
        manifest_path: str,
        timeout_seconds: float | None = None,
    ) -> CoralCommandResult:
        """Register a community source from a manifest YAML file."""
        timeout = timeout_seconds or self.source_add_timeout_seconds
        started_at = time.perf_counter()
        logger.info(
            "coral.source_add_file.start path=%s timeout=%ss",
            manifest_path,
            f"{timeout:g}",
        )
        try:
            completed = self._run(
                [self.coral_bin, "source", "add", "--file", manifest_path],
                timeout,
            )
        except subprocess.TimeoutExpired as error:
            raise CoralClientError(
                f"coral source add --file timed out after {timeout:g}s"
            ) from error
        logger.info(
            "coral.source_add_file.done path=%s duration_ms=%s returncode=%s",
            manifest_path,
            elapsed_ms(started_at),
            completed.returncode,
        )
        return CoralCommandResult(
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )


def elapsed_ms(started_at: float) -> int:
    return round((time.perf_counter() - started_at) * 1000)


def compact_sql(sql: str, limit: int = 320) -> str:
    return compact_text(" ".join(sql.split()), limit)


def compact_text(text: str, limit: int = 320) -> str:
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."
