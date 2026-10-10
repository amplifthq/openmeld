import type { ShellResult } from "@flue/runtime";
import {
  REMOTE_AGENT_GIT_MAX_TREE_BYTES,
  type RemoteAgentGitTreeEntry,
  remoteAgentGitNativeRequestSchema,
  remoteAgentGitNativeResultSchema,
} from "@openmeld/schemas";
import { AGENT_COMPUTER_CONTAINER_BACKEND_ID } from "./computer-workspace-config";

export type GitWorkingCopyLocation = {
  directory: string;
  transportDirectory: string;
  manifestDigest: string;
  sourceCommit: string;
  sourceTree: string;
  baselineBranch: string;
  baselineCommit: string;
  baselineTree: string;
  baselineManifestDigest: string;
};
export type GitWorkingCopyComputerApi = {
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string, maxBytes?: number): Promise<string>;
  rm(
    path: string,
    options?: { force?: boolean; recursive?: boolean }
  ): Promise<void>;
  exec(
    command: string,
    options?: {
      backend?: string;
      cwd?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<ShellResult>;
};

/** Credentials never cross this adapter. Git's object tools own binary content,
 * modes, symlinks and tree creation; the remote publisher checks the exact tree. */
export class GitWorkingCopyComputer {
  private readonly api: GitWorkingCopyComputerApi;
  private readonly signal: AbortSignal | undefined;
  constructor(api: GitWorkingCopyComputerApi, signal?: AbortSignal) {
    this.api = api;
    this.signal = signal;
  }

  async writeManifest(
    location: GitWorkingCopyLocation,
    entries: RemoteAgentGitTreeEntry[],
    baselineEntries: RemoteAgentGitTreeEntry[]
  ) {
    await this.api.writeFile(
      `${location.transportDirectory}/manifest.json`,
      JSON.stringify(entries)
    );
    await this.api.writeFile(
      `${location.transportDirectory}/baseline.json`,
      JSON.stringify(baselineEntries)
    );
  }
  async readManifest(
    location: GitWorkingCopyLocation,
    name: "manifest.json" | "baseline.json"
  ): Promise<string> {
    return await this.api.readFile(
      `${location.transportDirectory}/${name}`,
      REMOTE_AGENT_GIT_MAX_TREE_BYTES
    );
  }
  async writeBlob(
    location: GitWorkingCopyLocation,
    sha: string,
    bytes: Uint8Array
  ) {
    await this.api.writeFile(
      `${location.transportDirectory}/blobs/${sha}`,
      bytes
    );
  }
  async prepare(location: GitWorkingCopyLocation, timeoutMs = 120_000) {
    return await this.run(location, "prepare", undefined, timeoutMs);
  }
  async snapshot(location: GitWorkingCopyLocation, commit: string) {
    return await this.run(location, "snapshot", commit);
  }
  async blob(location: GitWorkingCopyLocation, sha: string) {
    const value = await this.run(location, "blob", sha);
    if (value.blob === undefined) {
      throw new Error("github.checkout.invalid_blob_export");
    }
    return Uint8Array.from(Buffer.from(value.blob, "base64"));
  }

  private async run(
    location: GitWorkingCopyLocation,
    action: "prepare" | "snapshot" | "blob",
    sha?: string,
    timeoutMs = 120_000
  ) {
    const output = `${location.transportDirectory}/output-${crypto.randomUUID()}.json`;
    const request = remoteAgentGitNativeRequestSchema.parse({
      directory: location.directory,
      transportDirectory: location.transportDirectory,
      manifestDigest: location.manifestDigest,
      sourceCommit: location.sourceCommit,
      sourceTree: location.sourceTree,
      baselineBranch: location.baselineBranch,
      baselineCommit: location.baselineCommit,
      baselineTree: location.baselineTree,
      baselineManifestDigest: location.baselineManifestDigest,
      action,
      sha,
      output,
    });
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = this.signal
      ? AbortSignal.any([this.signal, timeoutSignal])
      : timeoutSignal;
    signal.throwIfAborted();
    const result = await this.api.exec(
      `python3 -c ${quote(GITHUB_WORKING_COPY_PROGRAM)} ${quote(JSON.stringify(request))}`,
      {
        backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
        signal,
        timeoutMs,
      }
    );
    signal.throwIfAborted();
    if (result.exitCode !== 0) {
      throw new Error(
        `github.checkout.computer_failed: ${result.stderr.slice(-1500)}`
      );
    }
    try {
      const text = await this.api.readFile(
        output,
        REMOTE_AGENT_GIT_MAX_TREE_BYTES * 2
      );
      if (Buffer.byteLength(text) > REMOTE_AGENT_GIT_MAX_TREE_BYTES * 2) {
        throw new Error("github.checkout.native_result_too_large");
      }
      return remoteAgentGitNativeResultSchema.parse(JSON.parse(text));
    } finally {
      await this.api.rm(output, { force: true });
    }
  }
}

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// The same fixed program is exercised against real temporary Git repositories
// in tests. It never fetches a URL, runs hooks, or reads a provider credential.
export const GITHUB_WORKING_COPY_PROGRAM = String.raw`
import base64, fcntl, hashlib, json, os, pathlib, subprocess, sys

request = json.loads(sys.argv[1])
target = pathlib.Path(request['directory'])
transfer = pathlib.Path(request['transportDirectory'])
transfer.mkdir(parents=True, exist_ok=True)
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0', GIT_NO_REPLACE_OBJECTS='1',
    GIT_AUTHOR_NAME='OpenMeld working copy', GIT_AUTHOR_EMAIL='working-copy@openmeld.invalid',
    GIT_COMMITTER_NAME='OpenMeld working copy', GIT_COMMITTER_EMAIL='working-copy@openmeld.invalid',
    GIT_AUTHOR_DATE='2000-01-01T00:00:00Z', GIT_COMMITTER_DATE='2000-01-01T00:00:00Z')

def git(root, *args, data=None):
    result = subprocess.run(['git', '--no-replace-objects', '-C', str(root), '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode: raise RuntimeError(result.stderr.decode('utf8', 'replace')[-1000:])
    return result.stdout

def manifest(baseline=False):
    data = (transfer / ('baseline.json' if baseline else 'manifest.json')).read_bytes()
    expected = request['baselineManifestDigest'] if baseline else request['manifestDigest']
    if len(data) > 8 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected: raise RuntimeError('Working-copy manifest changed')
    entries = json.loads(data)
    if len(entries) > 30000: raise RuntimeError('Too many tree entries')
    for entry in entries:
        if any(p.lower() == '.git' or p in ('', '.', '..') for p in entry['path'].split('/')) or '\\' in entry['path'] or '\x00' in entry['path']: raise RuntimeError('Unsafe repository path')
    return entries

def check_objects(root, shas):
    if not shas: return []
    return git(root, 'cat-file', '--batch-check', data=('\n'.join(shas) + '\n').encode()).decode().splitlines()

def import_cached(root, shas):
    missing = []
    for sha, line in zip(shas, check_objects(root, shas)):
        if not line.endswith(' missing'): continue
        cached = transfer / 'blobs' / sha
        if not cached.is_file():
            missing.append(sha)
            continue
        if cached.stat().st_size > 8 * 1024 * 1024: raise RuntimeError('Oversized blob')
        data = cached.read_bytes()
        actual = hashlib.sha1(('blob %d\0' % len(data)).encode() + data).hexdigest()
        if actual != sha: raise RuntimeError('Downloaded blob changed')
        if git(root, 'hash-object', '-w', '--stdin', data=data).decode().strip() != sha: raise RuntimeError('Blob import mismatch')
        cached.unlink()
    return missing

def make_tree(root, entries):
    directories = {'': []}
    for entry in entries:
        parent, _, name = entry['path'].rpartition('/')
        directories.setdefault(parent, [])
        if entry['type'] == 'tree': directories.setdefault(entry['path'], [])
        else: directories[parent].append((entry['mode'], entry['type'], entry['sha'], name))
    for directory in sorted(directories, key=lambda p: (p.count('/'), len(p)), reverse=True):
        data = b''.join(('%s %s %s\t%s\0' % row).encode('utf8') for row in directories[directory])
        sha = git(root, 'mktree', '-z', '--missing', data=data).decode().strip()
        if not directory: return sha
        parent, _, name = directory.rpartition('/')
        directories[parent].append(('040000', 'tree', sha, name))

def prepare():
    entries = manifest()
    baseline_entries = manifest(True)
    baseline_ref = 'refs/remotes/origin/' + request['baselineBranch']
    if target.exists() or target.is_symlink():
        if target.is_symlink() or git(target, 'rev-parse', 'refs/openmeld/source^{tree}').decode().strip() != request['sourceTree']: raise RuntimeError('Destination exists and is not this working copy')
        if git(target, 'rev-parse', baseline_ref + '^{tree}').decode().strip() != request['baselineTree']: raise RuntimeError('Trusted baseline changed')
        baseline_local = git(target, 'rev-parse', baseline_ref).decode().strip()
        return {'ready': True, 'localCommit': git(target, 'rev-parse', 'HEAD').decode().strip(), 'baselineLocalCommit': baseline_local, 'tree': request['sourceTree'], 'remaining': 0, 'missing': []}
    root = transfer / 'repository'
    if not root.exists():
        root.mkdir()
        git(root, 'init', '--template=', '--initial-branch=work')
    git(root, 'check-ref-format', baseline_ref)
    shas = list(dict.fromkeys(e['sha'] for e in entries + baseline_entries if e['type'] == 'blob'))
    missing = import_cached(root, shas)
    if missing: return {'ready': False, 'remaining': len(missing), 'missing': missing[:256]}
    tree = make_tree(root, entries)
    if tree != request['sourceTree']: raise RuntimeError('Complete source tree does not match GitHub')
    baseline_tree = make_tree(root, baseline_entries)
    if baseline_tree != request['baselineTree']: raise RuntimeError('Authenticated baseline tree does not match GitHub')
    baseline_local = git(root, 'commit-tree', baseline_tree, '-m', 'Verified default-branch snapshot ' + request['baselineCommit'] + '; synthetic comparison baseline, not remote history.').decode().strip()
    git(root, 'update-ref', baseline_ref, baseline_local)
    git(root, 'update-ref', 'refs/openmeld/baseline', baseline_local)
    commit = git(root, 'commit-tree', tree, '-p', baseline_local, '-m', 'Snapshot working copy of GitHub commit ' + request['sourceCommit'] + '; synthetic comparison parent, remote history is not downloaded.').decode().strip()
    git(root, 'update-ref', 'refs/heads/work', commit)
    git(root, 'update-ref', 'refs/openmeld/source', commit)
    git(root, 'reset', '--hard', commit)
    target.parent.mkdir(parents=True, exist_ok=True)
    os.rename(root, target)
    return {'ready': True, 'localCommit': commit, 'baselineLocalCommit': baseline_local, 'tree': tree, 'remaining': 0, 'missing': []}

def snapshot():
    commit = request['sha']
    resolved = git(target, 'rev-parse', '--verify', commit + '^{commit}').decode().strip()
    if resolved != commit: raise RuntimeError('Exact local commit required')
    entries = []
    for record in git(target, 'ls-tree', '-r', '-t', '-z', commit).split(b'\0'):
        if not record: continue
        header, path = record.split(b'\t', 1)
        mode, kind, sha = header.decode().split()
        entries.append({'mode': mode.zfill(6), 'type': kind, 'sha': sha, 'path': path.decode('utf8')})
    return {'localCommit': commit, 'tree': git(target, 'rev-parse', commit + '^{tree}').decode().strip(), 'entries': entries}

def blob():
    sha = request['sha']
    if int(git(target, 'cat-file', '-s', sha)) > 8 * 1024 * 1024: raise RuntimeError('Blob exceeds 8 MiB')
    data = git(target, 'cat-file', 'blob', sha)
    if len(data) > 8 * 1024 * 1024: raise RuntimeError('Blob exceeds 8 MiB')
    return {'blob': base64.b64encode(data).decode('ascii')}

with open(transfer / 'lock', 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    result = {'prepare': prepare, 'snapshot': snapshot, 'blob': blob}[request['action']]()
    pathlib.Path(request['output']).write_text(json.dumps(result), encoding='utf8')
`;
