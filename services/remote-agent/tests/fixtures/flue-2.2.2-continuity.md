# Flue 2.2.2 continuity fixture

This synthetic SQLite snapshot was captured from the actual patched 2.2.2
runtime before installing 2.3.0. It contains thirteen completed submissions,
one interrupted provider call, one queued request, one recorded shortlist
tool result, and a format-3 conversation checkpoint. No production data is used.

The JSON records the source revision and patch digest. The capture used the
existing capture script with its version and output changed to 2.2.2; the script
now accepts that version explicitly. To reproduce, use a disposable checkout of
the recorded revision with its frozen dependencies, copy the current capture
script there, and run `node scripts/capture-flue-upgrade-fixture.mjs 2.2.2` from
Remote Agent. It refuses a different installed version or overwriting a fixture.

The continuity test restores the real rows. No shortlist tool is registered:
replaying the original tool cannot conceal a lost result. The running and queued
requests must receive separate answers using the original choices.

Before replacing the old installation, retain its real package directory and
resolved dependencies. Then run from Remote Agent:

```sh
node scripts/verify-flue-version-rollback.mjs /absolute/path/to/retained/node_modules/@flue/runtime
```

The verifier uses separate processes and each runtime's own Pi dependency. It
loads this snapshot into the installed candidate, writes sixteen additional
turns and a new result, and exits without graceful shutdown while another task
is running and one is queued. The retained 2.2.2 runtime must recover both,
read results from both versions, and continue the same conversation without
replaying completed provider or tool work. This passed for patched 2.3.0.

This proves the synthetic Node/SQLite upgrade and rollback boundary. It does
not certify a production Durable Object rollout, an in-flight external tool's
side effects, or a Core/Computer rollback. No database reset or DO class
migration is added by this PR.
