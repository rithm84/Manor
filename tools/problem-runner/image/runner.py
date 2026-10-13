"""Compile and run stdin/stdout programs in a fresh networkless, unprivileged jail.

Answers and verdicts stay in Manor's server; this process only returns bounded output.
The caller supplies source and case inputs, never expected answers or credentials.

The sandbox is reused between jobs, so each run takes a lock, reads its request from a
root-only job directory and deletes it at once, and finishes by killing every process the
jail user still owns. Anything the jail user left behind marks the sandbox as tainted, and
the server deletes a tainted sandbox instead of running another job in it.
"""
from __future__ import annotations

import ctypes
import fcntl
import json
import os
import resource
import selectors
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import TypedDict

MAX_OUTPUT = 65536
MAX_SOURCE = 262144
MAX_INPUT = 1048576
JAIL_UID = 10001
PR_SET_CHILD_SUBREAPER = 36
JOBS = Path("/var/lib/manor/jobs")
LOCK = Path("/var/lib/manor/judge.lock")
# Directories the jail user could write to if it ever reached the sandbox filesystem.
WRITABLE = [Path("/tmp"), Path("/var/tmp"), Path("/dev/shm"), Path("/workspace")]
# The image dumps /usr/lib/manor/javac.jsa with these exact options; the archive only maps when they match.
JAVAC = ["javac", "-J-Xmx256m", "-J-XX:+UseSerialGC", "-J-XX:TieredStopAtLevel=1", "-J-XX:SharedArchiveFile=/usr/lib/manor/javac.jsa"]


class ProcessResult(TypedDict):
    stdout: str
    stderr: str
    exitCode: int
    durationMs: int
    timedOut: bool
    outputLimit: bool


class CaseInput(TypedDict):
    id: str
    input: str


class JudgeRequest(TypedDict):
    language: str
    code: str
    cases: list[CaseInput]


def command_for(language: str) -> tuple[str, list[str] | None, list[str]]:
    commands: dict[str, tuple[str, list[str] | None, list[str]]] = {
        "cpp": ("main.cpp", ["g++", "-std=c++20", "-O2", "-pipe", "main.cpp", "-o", "answer"], ["./answer"]),
        "c": ("main.c", ["gcc", "-std=c17", "-O2", "-pipe", "main.c", "-lm", "-o", "answer"], ["./answer"]),
        "python": ("main.py", None, ["python3", "-I", "main.py"]),
        "javascript": ("main.js", None, ["node", "--max-old-space-size=256", "main.js"]),
        "java": ("Main.java", [*JAVAC, "Main.java"], ["java", "-Xmx256m", "-XX:MaxMetaspaceSize=128m", "-XX:ReservedCodeCacheSize=64m", "-XX:CompressedClassSpaceSize=64m", "-XX:ActiveProcessorCount=1", "Main"]),
        # The image installs the standard library into GOROOT with this setting, so builds link it instead of compiling it.
        "go": ("main.go", ["env", "GODEBUG=installgoroot=all", "go", "build", "-o", "answer", "main.go"], ["./answer"]),
    }
    if language not in commands:
        raise ValueError(f"Unsupported language: {language}")
    return commands[language]


def resource_limits(cpu_seconds: int) -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
    resource.setrlimit(resource.RLIMIT_NPROC, (96, 96))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    resource.setrlimit(resource.RLIMIT_FSIZE, (67108864, 67108864))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def jail(workspace_mount: tuple[str, str, str], command: list[str]) -> list[str]:
    args = ["bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv", "--setenv", "PATH", "/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/tmp", "--setenv", "GOCACHE", "/tmp/go-cache", "--setenv", "GOPATH", "/tmp/go", "--setenv", "GOMAXPROCS", "1", "--setenv", "LANG", "C.UTF-8"]
    for item in ["/usr", "/bin", "/lib", "/lib64"]:
        if Path(item).exists():
            args.extend(["--ro-bind", item, item])
    args.extend(["--ro-bind", "/etc", "/etc", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", *workspace_mount, "--chdir", "/workspace", "--uid", "10001", "--gid", "10001", "--", *command])
    return args


def execute(workspace_mount: tuple[str, str, str], command: list[str], stdin: str, wall_seconds: float, cpu_seconds: int) -> ProcessResult:
    started = time.monotonic()
    process = subprocess.Popen(jail(workspace_mount, command), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, user=10001, group=10001, preexec_fn=lambda: resource_limits(cpu_seconds), env={"PATH": "/usr/bin:/bin"})
    if process.stdin is None or process.stdout is None or process.stderr is None:
        raise RuntimeError("Runner failed to allocate child streams")
    selector = selectors.DefaultSelector()
    for stream, channel in [(process.stdout, "stdout"), (process.stderr, "stderr")]:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, channel)
    os.set_blocking(process.stdin.fileno(), False)
    selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
    pending = memoryview(stdin.encode())
    output: dict[str, bytearray] = {"stdout": bytearray(), "stderr": bytearray()}
    timed_out = False
    output_limit = False
    while selector.get_map():
        if time.monotonic() - started > wall_seconds:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            break
        for key, _ in selector.select(0.02):
            stream = key.fileobj
            if key.data == "stdin":
                try:
                    written = os.write(stream.fileno(), pending[:65536]) if pending else 0
                    pending = pending[written:]
                except BrokenPipeError:
                    pending = memoryview(b"")
                if not pending:
                    selector.unregister(stream)
                    stream.close()
                continue
            data = os.read(stream.fileno(), 8192)
            if not data:
                selector.unregister(stream)
                stream.close()
                continue
            output[key.data].extend(data)
            if len(output["stdout"]) + len(output["stderr"]) > MAX_OUTPUT:
                output_limit = True
                os.killpg(process.pid, signal.SIGKILL)
                break
        if output_limit:
            break
    selector.close()
    try:
        code = process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        code = process.wait(timeout=1)
    reap_orphans()
    return {"stdout": output["stdout"][:MAX_OUTPUT].decode("utf-8", errors="replace"), "stderr": output["stderr"][:MAX_OUTPUT].decode("utf-8", errors="replace"), "exitCode": code, "durationMs": round((time.monotonic() - started) * 1000), "timedOut": timed_out or code in (-signal.SIGXCPU, 128 + signal.SIGXCPU), "outputLimit": output_limit}


def become_subreaper() -> None:
    """Orphans of the jails reparent to this runner instead of the sandbox API, which never reaps them."""
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, f"prctl(PR_SET_CHILD_SUBREAPER) failed: {os.strerror(error)}")


def reap_orphans() -> None:
    """Collects exited orphans. Called only when no jail this runner started is still awaited by Popen."""
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return


def jail_processes() -> list[tuple[int, str, int]]:
    """Processes the jail user owns, as (pid, state, parent pid)."""
    found: list[tuple[int, str, int]] = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            if os.stat(f"/proc/{entry}").st_uid != JAIL_UID:
                continue
            fields = Path(f"/proc/{entry}/stat").read_text().rsplit(")", 1)[1].split()
        except FileNotFoundError:
            continue
        found.append((int(entry), fields[0], int(fields[1])))
    return found


def settle_jail_processes() -> list[str]:
    """Waits briefly for exiting jails to finish tearing down, then kills and reaps whatever the jail user still runs.

    Returns what survived the grace period or cannot be reaped; either taints the sandbox.
    """
    def unsettled() -> list[tuple[int, str, int]]:
        reap_orphans()
        return [item for item in jail_processes() if item[1] != "Z" or item[2] == os.getpid()]

    grace = time.monotonic() + 0.5
    while unsettled() and time.monotonic() < grace:
        time.sleep(0.005)
    survivors = [pid for pid, state, _ in unsettled() if state != "Z"]
    for pid in survivors:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            continue
    deadline = time.monotonic() + 2
    while remaining := unsettled():
        if time.monotonic() > deadline:
            raise RuntimeError(f"Jail processes survived SIGKILL: {remaining}")
        time.sleep(0.005)
    reasons: list[str] = []
    if survivors:
        reasons.append(f"{len(survivors)} jail processes outlived their jail")
    # Zombies another process adopted cannot be reaped here, and they count against the jail user's process limit.
    stuck = [pid for pid, state, parent in jail_processes() if state == "Z" and parent != os.getpid()]
    if stuck:
        reasons.append(f"{len(stuck)} jail processes cannot be reaped")
    return reasons


def jail_files() -> list[str]:
    found: list[str] = []
    for directory in WRITABLE:
        if not directory.is_dir():
            continue
        for entry in os.scandir(directory):
            if entry.stat(follow_symlinks=False).st_uid == JAIL_UID:
                found.append(entry.path)
    return found


def judge(request: JudgeRequest) -> dict[str, ProcessResult | None | list[dict[str, str | ProcessResult]]]:
    language = request["language"]
    source = request["code"]
    cases = request["cases"]
    if not isinstance(source, str) or len(source.encode()) > MAX_SOURCE:
        raise ValueError("Program source must be at most 256 KiB")
    if not cases or len(cases) > 200:
        raise ValueError("A run requires between 1 and 200 test cases")
    if any(not isinstance(case["input"], str) or len(case["input"].encode()) > MAX_INPUT for case in cases):
        raise ValueError("A test input must be at most 1 MiB")
    filename, compile_command, run_command = command_for(language)
    with tempfile.TemporaryDirectory(prefix="manor-judge-") as directory:
        os.chmod(directory, 0o755)
        os.chown(directory, JAIL_UID, JAIL_UID)
        source_path = Path(directory, filename)
        source_path.write_text(source)
        os.chown(source_path, JAIL_UID, JAIL_UID)
        compile_result = execute(("--bind", directory, "/workspace"), compile_command, "", 30, 25) if compile_command else None
        results: list[dict[str, str | ProcessResult]] = []
        if compile_result is None or compile_result["exitCode"] == 0:
            for case in cases:
                results.append({"id": case["id"], "process": execute(("--ro-bind", directory, "/workspace"), run_command, case["input"], 4, 3)})
    return {"compile": compile_result, "cases": results}


def main() -> None:
    job = Path(sys.argv[1]).resolve()
    if job.parent != JOBS:
        raise ValueError(f"Job directory must be inside {JOBS}: {job}")
    request_path = job / "request.json"
    request: JudgeRequest = json.loads(request_path.read_text())
    request_path.unlink()
    become_subreaper()
    with open(LOCK, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        tainted = [f"before this job: {reason}" for reason in settle_jail_processes()]
        output = judge(request)
        tainted.extend(f"after this job: {reason}" for reason in settle_jail_processes())
        leftovers = jail_files()
        if leftovers:
            tainted.append(f"the program left files outside its job: {leftovers[:5]}")
        result = job / "result.json"
        result.touch(mode=0o600)
        result.write_text(json.dumps({**output, "tainted": tainted}, separators=(",", ":")))
    print("Judge completed")


if __name__ == "__main__":
    main()
