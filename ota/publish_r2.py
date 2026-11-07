#!/usr/bin/env python3
"""Publish a signed Vitrine IPA to a *private* Cloudflare R2 bucket.

Never prints public or signed IPA URLs. The Worker gates and signs downloads.
Requires AWS CLI and three scoped GitHub Actions secrets.
"""
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import zipfile

BUCKET = "vitrine-ota"


def app_info(ipa):
    with zipfile.ZipFile(ipa) as archive:
        names = [n for n in archive.namelist()
                 if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", n)]
        if len(names) != 1:
            raise ValueError("Expected exactly one app bundle in the signed IPA")
        info = plistlib.loads(archive.read(names[0]))
    bundle = info.get("CFBundleIdentifier")
    version = info.get("CFBundleShortVersionString") or info.get("CFBundleVersion")
    if bundle != "com.soufianefartit.vitrine" or not version:
        raise ValueError("Unexpected IPA bundle ID or missing version")
    return str(bundle), str(version)


def upload(ipa):
    run = os.environ.get("GITHUB_RUN_ID", "")
    account = os.environ.get("R2_ACCOUNT_ID", "")
    access = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    if not re.fullmatch(r"[1-9][0-9]{0,19}", run):
        raise ValueError("Invalid GitHub Actions run ID")
    if not re.fullmatch(r"[A-Fa-f0-9]{32}", account):
        raise ValueError("Invalid Cloudflare R2 account ID")
    if not access or not secret:
        raise ValueError("R2 credentials are missing")

    bundle, version = app_info(ipa)
    metadata = {"run": run, "bundle_id": bundle, "version": version}
    prefix = "releases/" + run
    endpoint = "https://" + account + ".r2.cloudflarestorage.com"
    cmd = ["aws", "--region", "auto", "--endpoint-url", endpoint]
    process_env = os.environ.copy()
    process_env["AWS_ACCESS_KEY_ID"] = access
    process_env["AWS_SECRET_ACCESS_KEY"] = secret
    process_env["AWS_DEFAULT_REGION"] = "auto"
    process_env["AWS_EC2_METADATA_DISABLED"] = "true"

    def execute(*args):
        return subprocess.run([*cmd, *args], env=process_env,
                              check=True, capture_output=True, text=True)

    source = Path(ipa)
    key = prefix + "/vitrine.ipa"
    execute("s3", "cp", str(source), "s3://" + BUCKET + "/" + key,
            "--no-progress", "--only-show-errors",
            "--content-type", "application/octet-stream")
    head = execute("s3api", "head-object", "--bucket", BUCKET, "--key", key)
    remote_size = int(json.loads(head.stdout)["ContentLength"])
    if remote_size != source.stat().st_size:
        raise ValueError("R2 upload size mismatch")

    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / "metadata.json"
        path.write_text(json.dumps(metadata, separators=(",", ":")), encoding="utf-8")
        execute("s3", "cp", str(path), "s3://" + BUCKET + "/" + prefix + "/metadata.json",
                "--no-progress", "--only-show-errors", "--content-type", "application/json")
        # Publish latest only after the IPA + immutable metadata are uploaded.
        execute("s3", "cp", str(path), "s3://" + BUCKET + "/latest.json",
                "--no-progress", "--only-show-errors", "--content-type", "application/json")

    print("Private OTA release uploaded to R2: GitHub run #" + run)
    print("Open your password-protected Cloudflare Worker on the iPhone to install.")
    print("No IPA download URL was exposed in the public workflow logs.")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Usage: publish_r2.py <signed.ipa>")
        upload(sys.argv[1])
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
        if isinstance(exc, subprocess.CalledProcessError):
            print("R2 publication failed: AWS CLI exit code " + str(exc.returncode), file=sys.stderr)
        else:
            print("R2 publication failed: " + str(exc), file=sys.stderr)
        sys.exit(1)
