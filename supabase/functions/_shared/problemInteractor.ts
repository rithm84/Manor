/**
 * The interactor runtime. An interactive problem's trusted Python source defines the behavior of its hidden APIs:
 *
 *   start(case)                 called before each case with every input value by name, visible and hidden
 *   call(handle, method, args)  answers one API call; returns the value, or Reply(value, writes) to also fill
 *                               buffer arguments ({argument index: characters}); raise Abort(message) to stop
 *                               the solution, and the message becomes the case's answer
 *   finish(result)              optional; turns the solution's JSON answer (null for void) into the case's answer
 *
 * `handle` is the parameter name for an API object passed to the solution, null for a global API's functions, and
 * the value `call` returned for an API object a method returned. Python solutions call the interactor in process;
 * other languages start it as a child process and exchange one JSON line per message over pipes. Messages are
 * `["case", {name: value}]`, `["call", handle, method, args]`, and `["end", answer]`; replies are arrays (`[value]`,
 * `[value, [[argument, characters], ...]]`, or `[answer]`), except that a stopped case replies with its message as a
 * bare JSON string, so every driver's JSON reader can parse them without objects.
 */
export const interactorRuntime = `class Abort(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = str(message)
class Reply:
    def __init__(self, value, writes=None):
        self.value = value
        self.writes = dict(writes or {})
`

/** The child-process main loop; with two path arguments it talks over those FIFOs, otherwise over stdin and stdout. */
const serve = `
def __manor_serve():
    import sys, json
    source = open(sys.argv[1], 'rb') if len(sys.argv) > 2 else sys.stdin.buffer
    sink = open(sys.argv[2], 'wb') if len(sys.argv) > 2 else sys.stdout.buffer
    aborted = None
    def send(value):
        sink.write(json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode() + b'\\n'); sink.flush()
    for line in source:
        message = json.loads(line)
        if message[0] == 'case':
            aborted = None; start(message[1]); send([None])
        elif message[0] == 'call':
            if aborted is not None: send(aborted); continue
            try:
                reply = call(message[1], message[2], message[3])
            except Abort as error:
                aborted = error.message; send(aborted); continue
            send([reply.value, [[int(k), str(v)] for k, v in reply.writes.items()]] if isinstance(reply, Reply) else [reply])
        elif message[0] == 'end':
            send([finish(message[1]) if 'finish' in globals() else message[1]])
__manor_serve()
`

/** The full child program for an interactor. */
export function interactorProgram(source: string): string { return interactorRuntime + source + '\n' + serve }
