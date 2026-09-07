import { spawnSync } from "node:child_process";
import { buildComputerCommandProcess } from "../flue-adapter/computer-command-process.ts";

const image = process.argv[2];
if (!image) {
  throw new Error("Pass an explicitly built local Computer image.");
}
const wrap =
  process.argv[3] === "--baseline"
    ? (command) => command
    : buildComputerCommandProcess;
const source = `
import json, os, subprocess, sys, time
commands = json.loads(sys.argv[1])
work = subprocess.Popen(['/bin/sh', '-c', commands['work']], stdout=subprocess.PIPE, text=True)
peer = subprocess.Popen(['/bin/sh', '-c', commands['peer']], stdout=subprocess.PIPE, text=True)
try:
    child = int(work.stdout.readline().strip())
    work.terminate()
    work.wait(timeout=5)
    for _ in range(50):
        try:
            state = open('/proc/%s/stat' % child).read().split(') ', 1)[1].split()[0]
        except FileNotFoundError:
            break
        if state == 'Z':
            break
        time.sleep(0.1)
    else:
        raise AssertionError('Command child survived native-PID cancellation')
    peer_output = peer.communicate(timeout=5)[0]
    assert peer.returncode == 0 and peer_output.strip() == 'PEER-DONE', (peer.returncode, peer_output)
    completed = subprocess.run(['/bin/sh', '-c', commands['compound']], capture_output=True, text=True)
    assert completed.returncode == 7, completed.returncode
    assert completed.stdout == "single'quote $literal\\nsecond\\n", repr(completed.stdout)
    print('PASS: native PID cancellation terminates its child; peer survives; shell quoting and exit code preserved')
finally:
    for process in (work, peer):
        if process.poll() is None:
            process.kill()
            process.wait()
`;
const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--platform=linux/amd64",
    "-i",
    "--network=none",
    "--entrypoint",
    "python3",
    image,
    "-",
    JSON.stringify({
      work: wrap(
        "python3 -u -c 'import os,time; print(os.getpid(),flush=True); time.sleep(30)'"
      ),
      peer: wrap("sleep 1; printf 'PEER-DONE\\n'"),
      compound: wrap(
        "printf \"single'quote \\$literal\\n\"; printf 'second\\n' | cat; exit 7"
      ),
    }),
  ],
  { input: source, encoding: "utf8", timeout: 20_000 }
);
if (result.error) {
  throw result.error;
}
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.status ?? 1;
