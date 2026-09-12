"""Install pinned upstream restic/rclone binaries into this project, verifying release SHA-256."""
import bz2
import hashlib
import io
import platform
from pathlib import Path
import urllib.request
import zipfile

DESTINATION = Path(__file__).resolve().parent / '.bin'
SYSTEM = {'Darwin': 'darwin', 'Linux': 'linux'}[platform.system()]
ARCH = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'amd64'}[platform.machine()]

def download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()

def checked(url: str, sums_url: str, filename: str) -> bytes:
    payload = download(url)
    lines = download(sums_url).decode().splitlines()
    matched = [line.split()[0] for line in lines if len(line.split()) == 2 and line.split()[-1].lstrip('*') == filename]
    if len(matched) != 1 or hashlib.sha256(payload).hexdigest().lower() != matched[0].lower():
        raise ValueError(f'Upstream checksum verification failed for {filename}')
    return payload

DESTINATION.mkdir(mode=0o700, exist_ok=True)
restic_name = f'restic_0.19.1_{SYSTEM}_{ARCH}.bz2'
restic_base = 'https://github.com/restic/restic/releases/download/v0.19.1/'
(DESTINATION / 'restic').write_bytes(bz2.decompress(checked(restic_base + restic_name, restic_base + 'SHA256SUMS', restic_name)))
rclone_system = 'osx' if SYSTEM == 'darwin' else SYSTEM
rclone_name = f'rclone-v1.75.1-{rclone_system}-{ARCH}.zip'
rclone_base = 'https://downloads.rclone.org/v1.75.1/'
with zipfile.ZipFile(io.BytesIO(checked(rclone_base + rclone_name, rclone_base + 'SHA256SUMS', rclone_name))) as archive:
    (DESTINATION / 'rclone').write_bytes(archive.read(f'rclone-v1.75.1-{rclone_system}-{ARCH}/rclone'))
for name in ['restic', 'rclone']:
    (DESTINATION / name).chmod(0o700)
print('Verified project-local restic 0.19.1 and rclone 1.75.1')
