"""Test HarborGuard against HydrallHarsh/test-coral (deliberate vulns + .env)."""
from __future__ import annotations

import json
import time
import urllib.request

API = "http://127.0.0.1:8008"
BASE = {
    "owner": "HydrallHarsh",
    "repo": "test-coral",
    "org": "HydrallHarsh",
    "slack_channel": None,
    "policy_query": "dependency security review secrets access control",
    "package_system": None,
    "package_ecosystem": None,
    "package_name": None,
    "package_version": None,
    "days": 7,
}

MODES = [
    ("dep", "Dependency Risk", "Did dependency upgrades introduce risk and require policy review?"),
    ("policy", "Policy Violation", "Are there any security policy violations in recent code changes?"),
    ("secrets", "Secrets Exposure", "Have any secrets or credentials been exposed in recent commits?"),
    ("release", "Release Safety", "Is the latest release safe to deploy to production?"),
]

EXPECTED_PACKAGES = {"minimist", "lodash", "axios", "jquery", "express", "react"}


def post(path: str, payload: dict, timeout: float) -> dict:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> None:
    print(f"Testing https://github.com/HydrallHarsh/test-coral against {API}\n")
    print("Expected in repo: vulnerable deps (minimist@0.0.8, lodash, axios, ...), committed .env\n")

    for mode_id, label, question in MODES:
        payload = {**BASE, "question": question}
        print(f"=== {label} ({mode_id}) ===")
        t0 = time.time()
        try:
            data = post("/agent/investigate", payload, timeout=900)
        except Exception as exc:
            print(f"  ERROR: {exc}\n")
            continue
        elapsed = time.time() - t0
        findings = data.get("findings") or []
        review = data.get("review_signals") or []
        steps = data.get("steps") or []
        target = data.get("target_package") or {}
        deep = [
            s.get("name")
            for s in steps
            if isinstance(s, dict)
            and s.get("name")
            and ("osv_" in s.get("name") or "deps_dev_" in s.get("name"))
            and not s.get("skipped")
        ]
        secret_step = next((s for s in steps if s.get("name") == "github_secret_file_search"), None)
        failed = [s.get("name") for s in steps if isinstance(s, dict) and not s.get("ok") and not s.get("skipped")]

        print(f"  time: {elapsed:.1f}s | risk: {data.get('risk_level')} | score: {data.get('score')}")
        print(f"  answer: {data.get('answer')}")
        if target:
            print(f"  target: {target.get('package_name')}@{target.get('version')} ({target.get('source')})")
        else:
            print("  target: none")
        print(f"  deep_scan_steps ({len(deep)}): {deep[:6]}{'...' if len(deep) > 6 else ''}")
        if secret_step:
            print(
                f"  secret_search: ok={secret_step.get('ok')} rows={len(secret_step.get('rows') or [])} "
                f"error={secret_step.get('error')}"
            )
        print(f"  findings ({len(findings)}):")
        for f in findings:
            print(f"    - [{f.get('type')}] {f.get('title')} (severity={f.get('severity')}, score={f.get('score')})")
        if not findings:
            print("    - (none)")
        print(f"  review_signals ({len(review)}):")
        for r in review:
            print(f"    - [{r.get('type')}] {r.get('title')}")
        if failed:
            print(f"  failed_steps: {failed}")

        # Validation
        found_pkgs = set()
        for f in findings:
            title = str(f.get("title", "")).lower()
            for pkg in EXPECTED_PACKAGES:
                if pkg in title:
                    found_pkgs.add(pkg)
        if mode_id == "dep":
            ok_dep = bool(deep) and (found_pkgs or target.get("package_name"))
            print(f"  CHECK dependency scan: {'PASS' if ok_dep else 'FAIL'} (pkgs in findings: {sorted(found_pkgs)})")
        if mode_id == "secrets":
            secret_types = {f.get("type") for f in findings}
            ok_sec = secret_step and secret_step.get("ok") and (
                "possible_secret_exposure" in secret_types
                or "secrets_scan_clear" in secret_types
                or "template_env_files" in secret_types
            )
            if secret_step and secret_step.get("rows"):
                for row in secret_step.get("rows", [])[:3]:
                    print(f"    secret hit path: {row.get('path') or row.get('name')}")
            print(f"  CHECK secrets scan: {'PASS' if ok_sec else 'FAIL'}")
        print()


if __name__ == "__main__":
    main()
