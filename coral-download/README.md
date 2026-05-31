# Local Coral binary

HarborGuard uses the Coral CLI from this folder when `coral-download/coral.exe` exists.

## Setup (Windows)

1. Download or copy the Coral Windows build (e.g. `coral-x86_64-pc-windows-msvc.zip` in the repo root).
2. Extract so this path exists:

   `harborguard/coral-download/coral.exe`

3. In `harborguard/.env`:

   ```env
   CORAL_CONFIG_DIR=%APPDATA%\withcoral\harborguard-config
   CORAL_BIN=coral-download/coral.exe
   ```

   (`CORAL_BIN` is optional if `coral.exe` is here — the backend auto-detects it.)

## Manual CLI use

Always point at the HarborGuard Coral config:

```powershell
cd harborguard
$env:CORAL_CONFIG_DIR = "$env:APPDATA\withcoral\harborguard-config"
.\coral-download\coral.exe --version
.\coral-download\coral.exe sql --format json "SELECT DISTINCT schema_name FROM coral.tables"
```

## Add extra sources (osv, deps_dev)

See [coral-sources/README.md](../coral-sources/README.md).
