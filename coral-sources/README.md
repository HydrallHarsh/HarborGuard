# HarborGuard Coral Sources

This directory contains Coral source specs that HarborGuard needs but that may
not be bundled in the currently installed Coral CLI release.

Install them into the same Coral config used by HarborGuard's `.env`:

```powershell
cd harborguard
$env:CORAL_CONFIG_DIR = "$env:APPDATA\withcoral\harborguard-config"
$coral = ".\coral-download\coral.exe"
if (-not (Test-Path $coral)) { $coral = "coral" }

New-Item -ItemType Directory -Force $env:CORAL_CONFIG_DIR | Out-Null
$osv_manifest = (Resolve-Path .\coral-sources\community\osv\manifest.yaml).Path
$deps_dev_manifest = (Resolve-Path .\coral-sources\community\deps_dev\manifest.yaml).Path
& $coral source lint $osv_manifest
& $coral source add --file $osv_manifest
& $coral source add --file $deps_dev_manifest
& $coral source test osv
& $coral source test deps_dev
```

If you change `CORAL_CONFIG_DIR` in `.env`, install and list sources with that
same environment variable set before starting HarborGuard.

Then confirm Coral can see the source:

```powershell
$env:CORAL_CONFIG_DIR = "$env:APPDATA\withcoral\harborguard-config"
.\coral-download\coral.exe sql --format json "SELECT schema_name, table_name FROM coral.tables WHERE schema_name IN ('osv', 'deps_dev') ORDER BY schema_name, table_name"
```

These source specs are copied from the Coral repository and are covered by the
Coral license included here as `LICENSE-CORAL`.

The `deps_dev` source is vendored from approved Coral PR 799:
https://github.com/withcoral/coral/pull/799
