# Docker deploy (backend + Coral)

One container runs **FastAPI + Coral CLI**. The Next.js frontend still deploys separately (e.g. Vercel).

## Build

From `harborguard/`:

```bash
docker build -t harborguard-api .
```

## Run locally

```bash
docker run --rm -p 10000:10000 \
  -e GITHUB_TOKEN=ghp_... \
  -e NOTION_API_KEY=ntn_... \
  -e SLACK_TOKEN=xoxp-... \
  -e HARBORGUARD_CORS_ORIGINS=http://localhost:3000,https://your-app.vercel.app \
  -e HARBORGUARD_USE_FIXTURES=false \
  -v harborguard-coral-config:/data/coral-config \
  harborguard-api
```

Or use an env file (do not commit):

```bash
docker run --rm -p 10000:10000 --env-file .env -v harborguard-coral-config:/data/coral-config harborguard-api
```

Smoke test:

```bash
curl http://localhost:10000/agent/capabilities
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | For GitHub scans | `gh auth token` or PAT |
| `NOTION_API_KEY` | For Notion policy | Internal integration token |
| `SLACK_TOKEN` | For Slack (optional) | Bot/user token |
| `HARBORGUARD_CORS_ORIGINS` | For Vercel | Comma-separated frontend URLs |
| `PORT` | Host sets this | Default `10000` (Render/Railway inject `PORT`) |
| `CORAL_CONFIG_DIR` | Auto | `/data/coral-config` — mount a volume |
| `CORAL_BIN` | Auto | `coral` on PATH after install |
| `HARBORGUARD_USE_FIXTURES` | Demo only | `true` = canned JSON, no Coral |

## Frontend (Vercel)

```env
NEXT_PUBLIC_API_BASE_URL=https://your-api.example.com
```

Redeploy Vercel after setting this.

## Host on Render / Railway / Fly.io

1. Connect GitHub repo, set **Dockerfile path** to `Dockerfile`, **root** to `harborguard/`.
2. Add secrets above in the dashboard.
3. Mount a **persistent disk** at `/data/coral-config` if the platform supports it (keeps Coral source registration).
4. Set `HARBORGUARD_CORS_ORIGINS` to your Vercel URL.

## Troubleshooting (Windows)

If you see `exec /docker-entrypoint.sh: no such file or directory`, the script was saved with **CRLF** line endings. Rebuild after pulling latest `Dockerfile` (it strips `\r` and runs via `/bin/sh`):

```powershell
docker build -t harborguard-api .
```

Do **not** pass a Windows `.env` with `CORAL_BIN=coral-download/coral.exe` — use Linux `coral` inside the container (default).

## Notes

- Uses **Linux Coral** from [withcoral.com/install.sh](https://withcoral.com/install.sh), not `coral-download/coral.exe`.
- Python deps install via **`uv sync`** from `backend/pyproject.toml` + `backend/uv.lock` (same as local dev).
- Investigations can run **several minutes** — avoid serverless hosts with ~60s timeouts.
- First container start registers `osv` + `deps_dev` sources; `github`, `notion`, `slack` are Coral bundled sources.
