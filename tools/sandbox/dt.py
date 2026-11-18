"""Drives the Daytona macOS sandbox used to build, run, and QA Manor's staging app.

Credentials come from the environment (DAYTONA_API_KEY and any other DAYTONA_* settings), falling back to
the repository's .env.local. Values are never printed. The sandbox is found by name, so any machine (a
laptop or a cloud session) drives the same one.

  dt.py create                       reuse the sandbox, or create it on the active reservation
  dt.py exec "<cmd>" [timeout]       run a shell command in the sandbox, print output
  dt.py put <local> <remote>         upload a file
  dt.py get <remote> <local>         download a file
  dt.py shot <out.png> [scale]       screenshot (PNG, optional scale 0.1 to 1)
  dt.py click X Y [double|right]     mouse click in screen coordinates
  dt.py drag X1 Y1 X2 Y2
  dt.py scroll X Y up|down [amount]
  dt.py type "<text>"
  dt.py key <key> [cmd,shift,...]
  dt.py info                         display info and windows
  dt.py cu [start]                   computer-use status (start it if needed)
  dt.py delete                       delete the sandbox (ask the owner first)

Rules: the owner allows Daytona reservations of 24 hours at most and never more. Never create a new
reservation; `create` only runs on an existing active one.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = os.environ.get("MANOR_SANDBOX_NAME", "manor-native-test")
REGION = "us-east-bos-1"


def load_env():
    env = ROOT / ".env.local"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line.startswith("DAYTONA_") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))


load_env()
if not os.environ.get("DAYTONA_API_KEY"):
    sys.exit("DAYTONA_API_KEY is not set (environment or .env.local).")

from daytona import Daytona  # noqa: E402

client = Daytona().v2


def find():
    cursor = None
    while True:
        page = client.list(cursor=cursor, limit=100)
        for sb in page.items:
            if getattr(sb, "name", None) == NAME:
                return sb
        cursor = getattr(page, "next_cursor", None)
        if not cursor:
            return None


def sandbox():
    sb = find()
    if sb is None:
        sys.exit(f"No sandbox named {NAME}. Run `dt.py create`.")
    return client.get(sb.id)


def main(argv):
    cmd = argv[0] if argv else "help"
    if cmd == "create":
        existing = find()
        if existing is not None:
            print("reusing", existing.id, getattr(existing, "state", ""))
            return
        from daytona.v2 import DISABLED, MacosResources
        active = [r for r in client.reservations.list().items if r.status == "active"]
        if not active:
            sys.exit("No active Daytona reservation. Ask the owner; reservations are 24 hours at most.")
        # Persistent, so a timeout stops it instead of deleting it, and no idle expiry.
        sb = client.create_macos(
            "base-macos", region=REGION, name=NAME,
            resources=MacosResources(cpu=6, memory=20, disk=120),
            reservation=active[0].id, persistent=True,
            lifecycle_policy={"timeout_seconds": 20 * 3600, "on_timeout": "stop", "idle_expiry_seconds": DISABLED},
            wait_seconds=900, create_timeout_seconds=900,
        )
        print("created", sb.id)
    elif cmd == "exec":
        sb = sandbox()
        timeout = float(argv[2]) if len(argv) > 2 else 600
        result = sb.exec(argv[1], timeout=timeout, execution_timeout=timeout)
        out = getattr(result, "stdout", None) or getattr(result, "output", "") or ""
        err = getattr(result, "stderr", "") or ""
        sys.stdout.write(out)
        if err:
            sys.stdout.write(err)
        print(f"\n[exit {getattr(result, 'exit_code', '?')}]")
    elif cmd == "put":
        sandbox().fs.write_bytes(argv[2], Path(argv[1]).read_bytes())
        print("uploaded", argv[2])
    elif cmd == "get":
        data = sandbox().fs.read_bytes(argv[1])
        Path(argv[2]).write_bytes(data)
        print("saved", argv[2])
    elif cmd == "shot":
        sb = sandbox()
        scale = float(argv[2]) if len(argv) > 2 else None
        shot = sb.computer_use.screen.screenshot(format="png", scale=scale) if scale else sb.computer_use.screen.screenshot()
        data = getattr(shot, "data", None) or getattr(shot, "image", None) or getattr(shot, "screenshot", None)
        if isinstance(data, str):
            import base64
            data = base64.b64decode(data)
        Path(argv[1]).write_bytes(data)
        print("saved", argv[1], getattr(shot, "width", ""), getattr(shot, "height", ""))
    elif cmd == "click":
        extra = argv[3] if len(argv) > 3 else None
        sandbox().computer_use.mouse.click(x=int(argv[1]), y=int(argv[2]), double=(extra == "double") or None,
                                           button="right" if extra == "right" else None)
        print("clicked")
    elif cmd == "drag":
        sandbox().computer_use.mouse.drag(start_x=int(argv[1]), start_y=int(argv[2]), end_x=int(argv[3]), end_y=int(argv[4]))
        print("dragged")
    elif cmd == "scroll":
        sandbox().computer_use.mouse.scroll(x=int(argv[1]), y=int(argv[2]), direction=argv[3],
                                            amount=int(argv[4]) if len(argv) > 4 else 3)
        print("scrolled")
    elif cmd == "type":
        sandbox().computer_use.keyboard.type(text=argv[1])
        print("typed")
    elif cmd == "key":
        mods = argv[2].split(",") if len(argv) > 2 else None
        sandbox().computer_use.keyboard.key(key=argv[1], modifiers=mods)
        print("pressed")
    elif cmd == "info":
        sb = sandbox()
        print(sb.computer_use.display.info())
        print(sb.computer_use.display.windows())
    elif cmd == "cu":
        sb = sandbox()
        print(sb.computer_use.status())
        if len(argv) > 1 and argv[1] == "start":
            print(sb.computer_use.start())
    elif cmd == "delete":
        sandbox().delete()
        print("deleted")
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
