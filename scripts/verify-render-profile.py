"""Offline validation only: never submit source/configuration to Render."""
import copy
import json
import sys
import os
from pathlib import Path

import jsonschema
import yaml

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / os.environ.get("RENDER_EVIDENCE_DIR", "evidence/render-free/20261004")
SCHEMA = ROOT / ".git/render-profile-tools/render.schema.json"


def check(profile, schema_text=None):
    if schema_text is not None:
        jsonschema.validate(profile, json.loads(schema_text))
    assert set(profile) == {"services", "databases"}, "Unexpected resource group"
    assert len(profile["services"]) == 3 and len(profile["databases"]) == 1
    resources = profile["services"] + profile["databases"]
    assert len({r["name"] for r in resources}) == 4
    for resource in resources:
        assert resource.get("plan") == "free", "Missing/paid plan"
        assert resource.get("region") == "singapore"
        assert not any(k in resource for k in (
            "disk", "scaling", "preDeployCommand", "initialDeployHook", "image",
            "previewPlan", "previews", "schedule", "registryCredential",
        )), "Paid feature or unapproved publish/deploy hook"
    web = [r for r in profile["services"] if r["type"] == "web"]
    assert len(web) == 2
    for service in web:
        assert service["runtime"] == "docker"
        assert service["dockerfilePath"] == "./Dockerfile"
        assert service["dockerContext"] == "."
        # S-01: "off" = current phase (no upload/deploy without approval);
        # "checksPass" = owner-approved auto-deploy after CI. "commit" would
        # upload on every commit and stays rejected (see negative cases).
        assert service["autoDeployTrigger"] in {"off", "checksPass"}
        env = {e["key"]: e for e in service["envVars"]}
        assert not any(key.startswith("NEXT_PUBLIC_") for key in env)
        role = env["SERVICE_ROLE"]["value"]
        assert role in {"api", "web"}
        assert env["NODE_ENV"]["value"] == "production"
        if role == "api":
            assert env["HOLD_EXPIRY_MODE"]["value"] == "api"
            assert service["healthCheckPath"] == "/health"
            assert env["WEB_ORIGIN"].get("sync") is False
            assert env["DATABASE_URL"]["fromDatabase"] == {
                "name": "sang-event-postgres", "property": "connectionString"}
            assert env["REDIS_URL"]["fromService"] == {
                "type": "keyvalue", "name": "sang-event-cache",
                "property": "connectionString"}
        else:
            assert service["healthCheckPath"] == "/api/health"
            assert env["API_INTERNAL_URL"].get("sync") is False
    cache = [r for r in profile["services"] if r["type"] == "keyvalue"]
    assert len(cache) == 1
    assert cache[0]["ipAllowList"] == []
    assert cache[0]["persistenceMode"] == "off"
    assert cache[0]["maxmemoryPolicy"] == "noeviction"
    db = profile["databases"][0]
    assert db["postgresMajorVersion"] == "15"
    assert db["databaseName"] == "sang_events_staging"
    assert db["user"] == "sang_events"
    assert db["ipAllowList"] == []


profile = yaml.safe_load((ROOT / "render.yaml").read_text(encoding="utf-8"))
try:
    schema_text = SCHEMA.read_text(encoding="utf-8")
except FileNotFoundError:
    schema_text = None
    print("SKIP: .git/render-profile-tools/render.schema.json not downloaded (manual step); schema validation skipped")
check(profile, schema_text)
negative_cases = {
    "implicit-paid-plan": lambda p: p["services"][0].pop("plan"),
    "paid-worker": lambda p: p["services"][0].update(type="worker", plan="starter"),
    "auto-upload-on-commit": lambda p: p["services"][0].update(autoDeployTrigger="commit"),
    "private-api-assumption": lambda p: p["services"][1]["envVars"][-1].update(
        value="http://sang-event-api:10000", sync=True),
    "unapproved-postgres-upgrade": lambda p: p["databases"][0].update(postgresMajorVersion="18"),
}
for label, mutate in negative_cases.items():
    bad = copy.deepcopy(profile)
    mutate(bad)
    try:
        check(bad, schema_text)
    except (AssertionError, jsonschema.ValidationError):
        pass
    else:
        sys.exit(f"Negative configuration accepted: {label}")
EVIDENCE.mkdir(parents=True, exist_ok=True)
(EVIDENCE / "render-profile-validation.json").write_text(json.dumps({
    "schema": "https://render.com/schema/render.yaml.json",
    "schemaValidation": "PASS" if schema_text is not None else "SKIP-schema-not-downloaded",
    "freeProfileGuards": "PASS",
    "rejectedNegativeCases": list(negative_cases),
    "mode": "Offline; no Render API submission/account/provision validation",
    "staging": False, "uploaded": False,
}, indent=2), encoding="utf-8")
print("PASS: explicit Free profiles, five rejected negative cases" +
      (" + official schema" if schema_text is not None else " (official schema SKIPPED, not downloaded)"))
