#!/usr/bin/env python3
"""Prepare Vitrine's app IDs and sign all included extensions with Match profiles."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import zipfile


def entries(ipa):
    with zipfile.ZipFile(ipa) as z:
        names = z.namelist()
        roots = sorted({name.split('/')[1] for name in names if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', name)})
        if len(roots) != 1:
            raise ValueError(f'Expected exactly one Payload/*.app/Info.plist, found {len(roots)}')
        root = f'Payload/{roots[0]}/'
        plugins = sorted(n for n in names if re.fullmatch(re.escape(root)+r'PlugIns/[^/]+\.appex/Info\.plist', n))
        return root, [root+'Info.plist', *plugins]


def make_manifest(ipa, app_id):
    if not re.fullmatch(r'[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)+', app_id):
        raise ValueError('Invalid reverse-DNS Vitrine App ID')
    _, plists = entries(ipa)
    out = {'app_id': app_id, 'bundle_ids': [app_id], 'plists': {plists[0]: app_id}}
    used = {app_id}
    with zipfile.ZipFile(ipa) as z:
        for name in plists[1:]:
            info = plistlib.loads(z.read(name))
            suffix = info.get('CFBundleExecutable') or Path(name).parts[-2][:-6]
            suffix = re.sub(r'[^A-Za-z0-9-]', '', suffix).lower()
            if not suffix:
                raise ValueError(f'Cannot identify extension {name}')
            bundle_id = app_id+'.'+suffix
            if bundle_id in used:
                raise ValueError(f'Duplicate extension ID {bundle_id}')
            used.add(bundle_id)
            out['bundle_ids'].append(bundle_id)
            out['plists'][name] = bundle_id
    return out


def prepare(source, output, manifest_path, app_id):
    manifest = make_manifest(source, app_id)
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(output, 'w') as dst:
        for item in src.infolist():
            payload = src.read(item.filename)
            if item.filename in manifest['plists']:
                info = plistlib.loads(payload)
                info['CFBundleIdentifier'] = manifest['plists'][item.filename]
                payload = plistlib.dumps(info, fmt=plistlib.FMT_BINARY)
            dst.writestr(item, payload)
    Path(manifest_path).write_text(json.dumps(manifest, indent=2)+'\n')
    for app in manifest['bundle_ids']:
        print('App ID: '+app)


def profile_data(path):
    return plistlib.loads(subprocess.check_output(
        ['security', 'cms', '-D', '-i', str(path)], stderr=subprocess.DEVNULL
    ))


def profile_id(profile):
    return profile['Entitlements']['application-identifier'].split('.', 1)[1]


def select_profiles(directory, bundle_ids):
    selected = {}
    for path in Path(directory).rglob('*.mobileprovision'):
        profile = profile_data(path)
        app = profile_id(profile)
        if app in bundle_ids and app not in selected:
            if profile.get('ExpirationDate', datetime.min) <= datetime.now(timezone.utc).replace(tzinfo=None):
                raise ValueError(f'Expired Ad Hoc profile for {app}')
            if not profile.get('ProvisionedDevices'):
                raise ValueError(f'No registered Ad Hoc devices for {app}')
            selected[app] = (path, profile)
    missing = set(bundle_ids)-set(selected)
    if missing:
        raise ValueError('Missing Ad Hoc profiles: '+', '.join(sorted(missing)))
    return selected


def select_identity(directory, profile):
    hashes = {hashlib.sha256(bytes(c)).hexdigest() for c in profile['DeveloperCertificates']}
    for cert in Path(directory).rglob('*.cer'):
        if hashlib.sha256(cert.read_bytes()).hexdigest() in hashes:
            key = cert.with_suffix('.p12')
            if not key.is_file():
                raise ValueError(f'Missing exported private key for {cert.name}')
            return key, cert
    raise ValueError('Match certificate matching profile not found in signing export')


def sign(source, output, manifest_path, signing_path):
    manifest = json.loads(Path(manifest_path).read_text())
    profiles = select_profiles(signing_path, manifest['bundle_ids'])
    key, cert = select_identity(signing_path, profiles[manifest['app_id']][1])
    cmd = ['zsign', '-k', str(key), '-c', str(cert)]
    for app in manifest['bundle_ids']:
        cmd += ['-m', str(profiles[app][0])]
    cmd += ['-z', '1', '-o', str(output), str(source)]
    subprocess.run(cmd, check=True)
    verify(output, manifest_path)


def verify(ipa, manifest_path):
    manifest = json.loads(Path(manifest_path).read_text())
    _, plists = entries(ipa)
    if set(plists) != set(manifest['plists']):
        raise ValueError('Nested extension list changed during signing')
    with zipfile.ZipFile(ipa) as z:
        all_names = set(z.namelist())
        for name in plists:
            expected = manifest['plists'][name]
            actual = plistlib.loads(z.read(name))['CFBundleIdentifier']
            if actual != expected:
                raise ValueError(f'Incorrect bundle ID {actual} for {name}; expected {expected}')
            provision = name[:-len('Info.plist')]+'embedded.mobileprovision'
            if provision not in all_names:
                raise ValueError('Missing embedded profile for '+name)
            with tempfile.NamedTemporaryFile(suffix='.mobileprovision') as tmp:
                tmp.write(z.read(provision))
                tmp.flush()
                profile = profile_data(tmp.name)
            if profile_id(profile) != expected:
                raise ValueError(f'Embedded profile does not match {expected}')
            if not profile.get('ProvisionedDevices'):
                raise ValueError(f'Not an Ad Hoc profile: {expected}')
    print(f'Validated {len(plists)} signed bundle IDs and profiles in {ipa}')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('input'); p.add_argument('output'); p.add_argument('manifest')
    p.add_argument('--app-id', required=True)
    s = sub.add_parser('sign')
    s.add_argument('input'); s.add_argument('output'); s.add_argument('manifest'); s.add_argument('signing_directory')
    v = sub.add_parser('verify')
    v.add_argument('input'); v.add_argument('manifest')
    args = ap.parse_args()
    try:
        if args.command == 'prepare':
            prepare(args.input, args.output, args.manifest, args.app_id)
        elif args.command == 'sign':
            sign(args.input, args.output, args.manifest, args.signing_directory)
        else:
            verify(args.input, args.manifest)
    except (ValueError, KeyError, subprocess.CalledProcessError, OSError, zipfile.BadZipFile) as error:
        ap.exit(1, f'Ad Hoc signing error: {error}\n')


if __name__ == '__main__':
    main()
