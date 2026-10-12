"""Validate one authored problem spec directory and emit its import-ready content and testset.

A spec directory holds meta.json, statement.md, optional solution.md, and for executable problems
reference.py, optional oracle.py, and tests.py. The reference runs through the same Python driver the
judge uses; the independent oracle must agree on every case small enough for it; expected answers come
only from that cross-checked reference. Usage: python3 validate_spec.py <spec-dir> [<spec-dir> ...]
Writes <spec-dir>/validated.json on success and prints one JSON result line per spec.
"""
from __future__ import annotations

import ctypes
import json
import math
import os
import random
import re
import resource
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent.parent
MARKER = "\x1eMANOR "
KINDS = {"coding", "system_design", "behavioral", "other"}
MODES = {"function", "class", "codec", "stdin", "none"}
ROUNDS = {"Online assessment", "Phone screen", "Onsite", "Take-home"}
CHECKERS = {"exact", "trimmed", "json", "numeric", "json_unordered", "json_unordered_deep", "json_tolerant", "special"}
MAX_CASES = 200
MAX_TESTSET_BYTES = 400_000
MAX_INPUT_BYTES = 1_048_576
MAX_ANSWER_BYTES = 65_536
INT32 = (-(2**31), 2**31 - 1)
INT64 = (-(2**63), 2**63 - 1)


class SpecError(Exception):
    """A spec defect the author must fix; the message names the file and the failing case."""


def taxonomy() -> set[str]:
    script = "import('" + str(ROOT / "app/src/shared/problemTopics.ts") + "').then(m => console.log(JSON.stringify(m.PROBLEM_TOPICS)))"
    return set(json.loads(subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True).stdout))


def node_json(request: dict) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(request, handle)
    try:
        result = subprocess.run(["node", str(TOOLS / "assemble.mjs"), handle.name], capture_output=True, text=True)
    finally:
        os.unlink(handle.name)
    if result.returncode != 0:
        raise SpecError("Interface rejected by the harness: " + result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "Interface rejected")
    return result.stdout


# ---------- Types ----------
def parse_type(text: str) -> tuple:
    text = text.strip()
    if text.endswith("[]"):
        return ("seq", parse_type(text[:-2]))
    if text.startswith("list<") and text.endswith(">"):
        return ("seq", parse_type(text[5:-1]))
    return (text,)


def is_int32(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and INT32[0] <= value <= INT32[1]


def check_value(t: tuple, value, where: str) -> None:
    kind = t[0]
    if kind == "seq":
        if not isinstance(value, list):
            raise SpecError(f"{where}: expected an array")
        for index, item in enumerate(value):
            check_value(t[1], item, f"{where}[{index}]")
        return
    if kind in ("int", "long"):
        low, high = INT32 if kind == "int" else INT64
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise SpecError(f"{where}: expected a {kind} within its range, got {value!r}")
        return
    if kind == "double":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise SpecError(f"{where}: expected a finite number")
        return
    if kind == "bool":
        if not isinstance(value, bool):
            raise SpecError(f"{where}: expected a boolean")
        return
    if kind in ("string", "char"):
        if not isinstance(value, str) or not value.isascii():
            raise SpecError(f"{where}: expected an ASCII string (non-ASCII text differs across languages)")
        if kind == "char" and len(value) != 1:
            raise SpecError(f"{where}: expected exactly one character")
        return
    if kind == "ListNode":
        if not isinstance(value, list) or any(not isinstance(v, int) or isinstance(v, bool) or not INT32[0] <= v <= INT32[1] for v in value):
            raise SpecError(f"{where}: a ListNode is an array of 32-bit integers")
        return
    if kind in ("TreeNode", "NextNode"):
        if not isinstance(value, list) or any(v is not None and (not isinstance(v, int) or isinstance(v, bool) or not INT32[0] <= v <= INT32[1]) for v in value):
            raise SpecError(f"{where}: a {kind} is a level-order array of 32-bit integers and nulls")
        if value and value[0] is None:
            raise SpecError(f"{where}: an empty tree is [] rather than [null]")
        if value and value[-1] is None:
            raise SpecError(f"{where}: remove trailing nulls from the level-order tree")
        return
    if kind == "RandomListNode":
        if not isinstance(value, list) or not all(isinstance(pair, list) and len(pair) == 2 and is_int32(pair[0]) and (pair[1] is None or (is_int32(pair[1]) and 0 <= pair[1] < len(value))) for pair in value):
            raise SpecError(f"{where}: a RandomListNode is an array of [val, randomIndex] pairs, where randomIndex is null or an index into the list")
        return
    if kind == "GraphNode":
        if not isinstance(value, list) or not all(isinstance(adjacent, list) and all(is_int32(j) and 1 <= j <= len(value) for j in adjacent) for adjacent in value):
            raise SpecError(f"{where}: a GraphNode is an adjacency list where entry i lists the neighbors of node i + 1 by value (1 to n); [] is no graph")
        reached = {1} if value else set()
        stack = list(reached)
        while stack:
            for j in value[stack.pop() - 1]:
                if j not in reached:
                    reached.add(j)
                    stack.append(j)
        if len(reached) != len(value):
            raise SpecError(f"{where}: every node must be reachable from node 1, because the graph is read and printed from node 1")
        return
    if kind == "NaryNode":
        if not isinstance(value, list) or any(v is not None and not is_int32(v) for v in value):
            raise SpecError(f"{where}: an NaryNode is a level-order array of 32-bit integers with null after each child group")
        if value:
            if value[0] is None:
                raise SpecError(f"{where}: an empty N-ary tree is [] rather than [null]")
            if len(value) > 1 and value[1] is not None:
                raise SpecError(f"{where}: the root value is followed by null before its children, as in [1,null,3,2,4]")
            if value[-1] is None:
                raise SpecError(f"{where}: remove trailing nulls from the N-ary tree")
            nodes, groups, index = 1, 0, 2
            while index < len(value):
                if groups >= nodes:
                    raise SpecError(f"{where}: the N-ary tree has more child groups than nodes")
                while index < len(value) and value[index] is not None:
                    nodes += 1
                    index += 1
                groups += 1
                index += 1
        return
    raise SpecError(f"{where}: unknown type {kind}")


def contains_double(t: tuple) -> bool:
    return t[0] == "double" or (t[0] == "seq" and contains_double(t[1]))


@dataclass
class Case:
    value: object
    text: str
    explanation: str | None
    origin: str


def case_text(spec: dict, value) -> str:
    mode = spec["mode"]
    if mode == "stdin":
        if not isinstance(value, str):
            raise SpecError("stdin cases must be strings")
        return value if value.endswith("\n") else value + "\n"
    if mode == "function":
        params = spec["interface"]["params"]
        if not isinstance(value, list) or len(value) != len(params):
            raise SpecError(f"function case must be a list of {len(params)} arguments: {json.dumps(value)[:200]}")
        for param, arg in zip(params, value):
            check_value(parse_type(param["type"]), arg, param["name"])
        return "".join(json.dumps(arg, separators=(",", ":")) + "\n" for arg in value)
    if mode == "codec":
        param = spec["interface"]["encode"]["param"]
        check_value(parse_type(param["type"]), value, param["name"])
        return json.dumps(value, separators=(",", ":")) + "\n"
    interface = spec["interface"]
    if not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], list) or not isinstance(value[1], list) or len(value[0]) != len(value[1]) or not value[0]:
        raise SpecError("class case must be [operations, arguments] with equal nonempty lengths")
    operations, arguments = value
    if operations[0] != interface["className"]:
        raise SpecError("class case must start with the class name")
    methods = {method["name"]: method for method in interface["methods"]}
    for index, (operation, args) in enumerate(zip(operations, arguments)):
        params = interface["constructorParams"] if index == 0 else methods.get(operation, {}).get("params")
        if params is None:
            raise SpecError(f"unknown operation {operation!r}")
        if not isinstance(args, list) or len(args) != len(params):
            raise SpecError(f"operation {index} ({operation}) needs {len(params)} arguments")
        for param, arg in zip(params, args):
            check_value(parse_type(param["type"]), arg, f"{operation}.{param['name']}")
    return json.dumps(operations, separators=(",", ":")) + "\n" + json.dumps(arguments, separators=(",", ":")) + "\n"


def display_input(spec: dict, case: Case) -> str:
    if spec["mode"] == "function":
        return ", ".join(f"{param['name']} = {json.dumps(arg, separators=(',', ':'))}" for param, arg in zip(spec["interface"]["params"], case.value))
    if spec["mode"] == "codec":
        return f"{spec['interface']['encode']['param']['name']} = {json.dumps(case.value, separators=(',', ':'))}"
    return case.text.rstrip("\n")


# ---------- Execution ----------
# Each program gets a 2 GiB address-space ceiling, so a runaway reference, oracle, or generator fails
# with a clear error instead of exhausting the machine that runs many validators at once. On Linux it
# also dies with the validator, so a killed validator never leaves its program spinning.
PROGRAM_MEMORY_BYTES = 2 << 30
PR_SET_PDEATHSIG = 1
LIBC = ctypes.CDLL(None, use_errno=True) if sys.platform.startswith("linux") else None


def limit_memory() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (PROGRAM_MEMORY_BYTES, PROGRAM_MEMORY_BYTES))
    if LIBC is not None:
        LIBC.prctl(PR_SET_PDEATHSIG, signal.SIGKILL)


def run_batch(program: str, cases: list[Case], timeout: float, hash_seed: str) -> list[tuple[str | None, int]]:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory, "main.py")
        path.write_text(program)
        try:
            result = subprocess.run([sys.executable, str(path)], input="".join(case.text for case in cases), capture_output=True, text=True, timeout=timeout, env={"PATH": os.environ["PATH"], "PYTHONHASHSEED": hash_seed}, preexec_fn=limit_memory)
        except subprocess.TimeoutExpired as error:
            raise SpecError(f"program exceeded {timeout:.0f}s over {len(cases)} cases") from error
    outputs: list[tuple[str | None, int]] = []
    for line in result.stdout.split("\n"):
        at = line.find(MARKER)
        if at < 0:
            continue
        index, duration, text = line[at + len(MARKER):].split(" ", 2)
        outputs.append((None if text == "!" else text, int(duration)))
    if len(outputs) != len(cases) or any(output is None for output, _ in outputs):
        failed = next((i for i, (output, _) in enumerate(outputs) if output is None), len(outputs))
        failing = cases[failed] if failed < len(cases) else None
        raise SpecError(f"program failed on {failing.origin if failing else 'a case'} input {failing.text[:300] if failing else ''!r}: {result.stderr.strip()[-1500:]}")
    return outputs


def run_stdin(program: str, cases: list[Case], timeout: float) -> list[tuple[str | None, int]]:
    outputs = []
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory, "main.py")
        path.write_text(program)
        for case in cases:
            try:
                result = subprocess.run([sys.executable, str(path)], input=case.text, capture_output=True, text=True, timeout=timeout, env={"PATH": os.environ["PATH"]}, preexec_fn=limit_memory)
            except subprocess.TimeoutExpired as error:
                raise SpecError(f"stdin program exceeded {timeout:.0f}s on {case.origin}") from error
            if result.returncode != 0:
                raise SpecError(f"stdin program failed on {case.origin} input {case.text[:300]!r}: {result.stderr.strip()[-1500:]}")
            outputs.append((result.stdout, 0))
    return outputs


# ---------- Checkers (mirror supabase/functions/problem-runner/checkers.ts) ----------
def canonical(value) -> str:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() and abs(value) < 2**63 else repr(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    return "{" + ",".join(json.dumps(key) + ":" + canonical(value[key]) for key in sorted(value)) + "}"


def deep_unordered(value) -> str:
    if isinstance(value, list):
        return "[" + ",".join(sorted(deep_unordered(item) for item in value)) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key) + ":" + deep_unordered(value[key]) for key in sorted(value)) + "}"
    return canonical(value)


def tolerant(actual, expected) -> bool:
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        return isinstance(actual, (int, float)) and not isinstance(actual, bool) and abs(actual - expected) <= 1e-6 * max(1, abs(expected))
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(tolerant(a, e) for a, e in zip(actual, expected))
    if isinstance(expected, dict):
        return isinstance(actual, dict) and sorted(actual) == sorted(expected) and all(tolerant(actual[k], expected[k]) for k in expected)
    return canonical(actual) == canonical(expected)


def matches(actual: str, expected: str, checker: str) -> bool:
    if checker == "exact":
        return actual == expected
    if checker == "trimmed":
        return actual.replace("\r\n", "\n").strip() == expected.replace("\r\n", "\n").strip()
    if checker == "numeric":
        a, e = actual.split(), expected.split()
        try:
            return len(a) == len(e) and all(abs(float(x) - float(y)) <= 1e-6 * max(1, abs(float(y))) for x, y in zip(a, e))
        except ValueError:
            return False
    try:
        a, e = json.loads(actual), json.loads(expected)
    except json.JSONDecodeError:
        return False
    if checker == "json":
        return canonical(a) == canonical(e)
    if checker == "json_unordered":
        return isinstance(a, list) and sorted(canonical(x) for x in a) == sorted(canonical(x) for x in e)
    if checker == "json_unordered_deep":
        return deep_unordered(a) == deep_unordered(e)
    return tolerant(a, e)


def run_judge(directory: Path, items: list[dict]) -> list[bool]:
    program = node_json({"judge": (directory / "judge.py").read_text()})
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder, "judge.py")
        path.write_text(program)
        result = subprocess.run([sys.executable, str(path)], input=json.dumps(items), capture_output=True, text=True, timeout=120, preexec_fn=limit_memory)
    if result.returncode != 0:
        raise SpecError("judge.py failed: " + result.stderr.strip()[-1500:])
    verdicts = json.loads(result.stdout)
    require(len(verdicts) == len(items), "judge returned the wrong number of verdicts")
    return verdicts


# ---------- Spec ----------
def load_module(path: Path) -> dict:
    namespace: dict = {"__name__": "manor_tests"}
    exec(compile(path.read_text(), str(path), "exec"), namespace)
    return namespace


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SpecError(message)


def validate(directory: Path, topics: set[str]) -> dict:
    meta = json.loads((directory / "meta.json").read_text())
    for field in ("key", "title", "kind", "difficulty", "topics", "mode", "hints", "constraints"):
        require(field in meta, f"meta.json is missing {field}")
    require(re.fullmatch(r"leetcode:[1-9][0-9]*|source:[0-9a-f]{64}(:[0-9a-f-]{36})?|example:[a-z0-9-]+", str(meta["key"])) is not None, "key must be copied exactly from the batch entry or source packet (leetcode:<number>, or source: followed by the packet key)")
    require(meta["kind"] in KINDS, "kind must be coding, system_design, behavioral, or other")
    require(meta["mode"] in MODES, "mode must be function, class, codec, stdin, or none")
    require(meta["difficulty"] in ("Easy", "Medium", "Hard"), "difficulty must be Easy, Medium, or Hard")
    require(isinstance(meta["topics"], list) and 1 <= len(meta["topics"]) <= 6 and len(set(meta["topics"])) == len(meta["topics"]), "topics must be one to six distinct labels")
    unknown = [topic for topic in meta["topics"] if topic not in topics]
    require(not unknown, f"topics outside the taxonomy: {unknown}")
    require(meta.get("round") is None or meta["round"] in ROUNDS, f"round must be null or one of {sorted(ROUNDS)}")
    require(isinstance(meta["hints"], list) and all(isinstance(h, str) and h.strip() for h in meta["hints"]), "hints must be nonempty strings")
    require(isinstance(meta["constraints"], list) and all(isinstance(c, str) and c.strip() for c in meta["constraints"]), "constraints must be nonempty strings")
    statement = (directory / "statement.md").read_text().strip()
    require(len(statement) >= 40, "statement.md is missing or too short")
    lowered = statement.lower()
    for heading in ("# example", "## example", "**example", "## constraints", "**constraints", "## hint"):
        require(heading not in lowered, f"statement.md must not contain {heading!r}: examples, constraints, and hints are rendered from meta.json")
    require(not statement.startswith("# "), "statement.md must not repeat the title as a heading")
    solution_path = directory / "solution.md"
    solution = solution_path.read_text().strip() if solution_path.exists() else None
    follow_ups = meta.get("followUps", [])
    body = statement
    if meta["constraints"]:
        body += "\n\n## Constraints\n\n" + "\n".join(f"- {line.strip()}" for line in meta["constraints"])
    if follow_ups:
        body += "\n\n## Follow-up\n\n" + "\n".join(f"- {line.strip()}" for line in follow_ups)
    content = {"statement_markdown": body, "examples": [], "hints": [h.strip() for h in meta["hints"]], "solution_markdown": solution, "starter_code": {}, "interface": None}
    result = {"key": meta["key"], "title": meta["title"], "kind": meta["kind"], "difficulty": meta["difficulty"], "topics": meta["topics"], "content": content, "testset": None, "notes": meta.get("notes"), "round": meta.get("round")}
    mode = meta["mode"]
    if mode == "none":
        examples = meta.get("examples") or []
        require(all(isinstance(e.get("input"), str) and isinstance(e.get("output"), str) for e in examples), "mode none examples are display strings with input and output")
        content["examples"] = [{"input": e["input"], "output": e["output"], "explanation": e.get("explanation")} for e in examples]
        require(meta["kind"] != "coding" or meta.get("notes"), "a coding problem without a judge must say why in notes")
        return result
    require(meta["kind"] == "coding", "only coding problems can be executable")
    checker = meta.get("checker")
    require(checker in CHECKERS, f"checker must be one of {sorted(CHECKERS)}")
    spec = {"mode": mode, "interface": meta.get("interface")}
    if mode in ("function", "class", "codec"):
        interface = meta["interface"]
        require(interface["kind"] == mode, "mode must match interface.kind")
        starter = json.loads(node_json({"interface": interface}))
        content["starter_code"] = starter
        content["interface"] = interface
        types = [parse_type(p["type"]) for p in interface.get("params", [])]
        returns = [interface.get("returns", "void")] if mode == "function" else [interface["decode"]["returns"]] if mode == "codec" else [m["returns"] for m in interface["methods"]]
        has_double = any(contains_double(parse_type(r)) for r in returns if r != "void")
        if mode == "function" and interface["output"]["mode"] != "return":
            target = next(p for p in interface["params"] if p["name"] == interface["output"]["param"])
            has_double = contains_double(parse_type(target["type"]))
        require(not has_double or checker in ("json_tolerant", "special"), "outputs containing doubles must use the json_tolerant checker")
        require(checker in ("json", "json_unordered", "json_unordered_deep", "json_tolerant", "special"), "typed interfaces compare JSON answers")
        require(checker != "special" or (directory / "judge.py").exists(), "a special checker needs judge.py defining check(args, output, expected)")
        program = node_json({"interface": interface, "language": "python", "source": (directory / "reference.py").read_text()})
        oracle_program = node_json({"interface": interface, "language": "python", "source": (directory / "oracle.py").read_text()}) if (directory / "oracle.py").exists() else None
    else:
        program = (directory / "reference.py").read_text()
        oracle_program = (directory / "oracle.py").read_text() if (directory / "oracle.py").exists() else None
    tests = load_module(directory / "tests.py")
    generate: Callable = tests.get("generate")
    valid: Callable | None = tests.get("valid")
    require(callable(generate), "tests.py must define generate(rng)")
    cases: list[Case] = []
    seen: set[str] = set()

    def add(value, explanation: str | None, origin: str) -> None:
        if valid is not None and not valid(value):
            raise SpecError(f"{origin} violates the stated constraints (valid() returned False): {json.dumps(value)[:300]}")
        text = case_text(spec, value)
        if text in seen:
            return
        require(len(text.encode()) <= MAX_INPUT_BYTES, f"{origin} input exceeds 1 MiB")
        seen.add(text)
        cases.append(Case(value, text, explanation, origin))

    examples = meta.get("examples") or []
    require(1 <= len(examples) <= 6, "provide one to six examples")
    for index, example in enumerate(examples):
        add(example["case"], example.get("explanation"), f"example {index + 1}")
    example_count = len(cases)
    require(example_count == len(examples), "examples must be distinct")
    for index, value in enumerate(tests.get("EDGE", [])):
        add(value, None, f"edge case {index + 1}")
    generated = generate(random.Random(20261012))
    require(isinstance(generated, list), "generate(rng) must return a list")
    for index, value in enumerate(generated):
        add(value, None, f"generated case {index + 1}")
    require(len(cases) >= 12, f"only {len(cases)} distinct cases; cover boundaries, adversarial inputs, and random cases (at least 12)")
    require(len(cases) <= MAX_CASES, f"{len(cases)} cases exceed the limit of {MAX_CASES}")
    if mode == "stdin":
        expected = run_stdin(program, cases, 10)
        repeat = run_stdin(program, cases, 10)
    else:
        expected = run_batch(program, cases, 180, "1")
        repeat = run_batch(program, cases, 180, "2")
    if checker == "special":
        verdicts = run_judge(directory, [{"input": case.text, "output": second, "expected": first} for case, (first, _), (second, _) in zip(cases, expected, repeat)])
        rejected = [case.origin for case, ok in zip(cases, verdicts) if not ok]
        require(not rejected, f"judge rejects the reference's own answers on {rejected[:5]}")
    for case, (first, _), (second, _) in zip(cases, expected, repeat):
        if checker == "special":
            break
        require(matches(second or "", first or "", checker), f"reference output changes between runs on {case.origin}; the answer is not unique, so use an order-insensitive checker or a special judge")
    slow = [(case.origin, duration) for case, (_, duration) in zip(cases, expected) if duration > 2000]
    require(not slow, f"reference is too slow on {slow[:3]}; the judge allows about 3 seconds per batch")
    if oracle_program is not None:
        limit = int(meta.get("oracleMaxInputBytes", 2000))
        small = [i for i, case in enumerate(cases) if len(case.text) <= limit]
        require(len(small) >= min(10, len(cases)), f"the oracle covers only {len(small)} cases; raise oracleMaxInputBytes or add small cases")
        oracle = (run_stdin(oracle_program, [cases[i] for i in small], 20) if mode == "stdin" else run_batch(oracle_program, [cases[i] for i in small], 300, "3"))
        if checker == "special":
            verdicts = run_judge(directory, [{"input": cases[i].text, "output": answer, "expected": expected[i][0]} for i, (answer, _) in zip(small, oracle)])
            for i, ok, (answer, _) in zip(small, verdicts, oracle):
                require(ok, f"judge rejects the oracle's answer on {cases[i].origin}: input {cases[i].text[:400]!r} reference {expected[i][0][:300]!r} oracle {answer[:300]!r}")
        for i, (answer, _) in zip(small, oracle):
            if checker == "special":
                break
            require(matches(answer or "", expected[i][0] or "", checker), f"oracle disagrees on {cases[i].origin}: input {cases[i].text[:400]!r} reference {expected[i][0][:300]!r} oracle {answer[:300]!r}")
    else:
        require(meta.get("oracleWaiver"), "add oracle.py (an independent brute force) or explain oracleWaiver in meta.json")
    for case, (answer, _) in zip(cases, expected):
        require(len(answer.encode()) <= MAX_ANSWER_BYTES, f"{case.origin} answer exceeds 64 KiB")
    for case, (answer, _) in zip(cases[:example_count], expected[:example_count]):
        content["examples"].append({"input": display_input(spec, case), "output": answer.strip() if mode != "stdin" else answer.rstrip("\n"), "explanation": case.explanation})
    testcases = [{"id": f"case-{i + 1:03d}", "input": case.text, "expectedOutput": answer if mode == "stdin" else answer.strip(), "hidden": i >= example_count} for i, (case, (answer, _)) in enumerate(zip(cases, expected))]
    size = len(json.dumps(testcases).encode())
    require(size <= MAX_TESTSET_BYTES, f"testset is {size} bytes; keep it under {MAX_TESTSET_BYTES} by using fewer maximum-size cases")
    result["testset"] = {"checker": checker, "provenance": "generated", "cases": testcases}
    if checker == "special":
        result["testset"]["judge"] = (directory / "judge.py").read_text()
        require(len(result["testset"]["judge"].encode()) <= 65536, "judge.py exceeds 64 KiB")
    result["stats"] = {"cases": len(cases), "oracleCases": len(small) if oracle_program is not None else 0, "bytes": size, "maxReferenceMs": max(d for _, d in expected)}
    return result


def main() -> None:
    topics = taxonomy()
    failures = 0
    for argument in sys.argv[1:]:
        directory = Path(argument)
        try:
            result = validate(directory, topics)
            (directory / "validated.json").write_text(json.dumps(result, ensure_ascii=False))
            print(json.dumps({"spec": directory.name, "ok": True, **result.get("stats", {})}))
        except SpecError as error:
            failures += 1
            (directory / "validated.json").unlink(missing_ok=True)
            print(json.dumps({"spec": directory.name, "ok": False, "error": str(error)[:3000]}))
        except Exception as error:  # an authoring bug in tests.py or meta.json, reported per spec
            failures += 1
            (directory / "validated.json").unlink(missing_ok=True)
            print(json.dumps({"spec": directory.name, "ok": False, "error": f"{type(error).__name__}: {error}"[:3000]}))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
