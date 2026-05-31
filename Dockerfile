# HarborGuard API + Coral CLI
# Build from repo root:  docker build -t harborguard-api .
# Run:                  docker run -p 10000:10000 --env-file .env harborguard-api

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Official Coral Linux install → usually /root/.local/bin/coral
RUN curl -fsSL https://withcoral.com/install.sh | sh

ENV PATH="/root/.local/bin:${PATH}" \
    CORAL_BIN=coral \
    CORAL_CONFIG_DIR=/data/coral-config \
    PORT=10000 \
    PYTHONUNBUFFERED=1 \
    HARBORGUARD_USE_FIXTURES=false

WORKDIR /app

# Install uv + Python deps (same as local backend workflow)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ .
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}"
COPY coral-sources/ /opt/coral-sources/
COPY docker-entrypoint.sh /docker-entrypoint.sh
# Windows checkouts often use CRLF; strip before chmod (avoids "exec … no such file or directory").
RUN sed -i 's/\r$//' /docker-entrypoint.sh \
    && sed -i '1s/^\xEF\xBB\xBF//' /docker-entrypoint.sh \
    && chmod +x /docker-entrypoint.sh

# Persist Coral workspace (registered sources) across restarts
VOLUME ["/data/coral-config"]

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f "http://127.0.0.1:${PORT:-10000}/health" || exit 1

# Invoke via /bin/sh so a broken shebang (CRLF/BOM) cannot block startup.
ENTRYPOINT ["/bin/sh", "/docker-entrypoint.sh"]
