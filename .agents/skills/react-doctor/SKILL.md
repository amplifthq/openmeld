---
name: react-doctor
description: Use when the user requests React Doctor or a React code-health audit, or when a concrete React diagnostic question would benefit from its scan. Not a default step after React changes or before committing.
version: "1.0.0"
---

# React Doctor

Scans React codebases for security, performance, correctness, and architecture issues. Outputs a 0–100 health score.

## Choose the scope

Use `--diff` for a changed-code diagnostic question. Omit it only when a full
React code-health audit is requested or needed to investigate that question.

Treat findings and the score as diagnostic leads, not proof of a defect or a
commit gate. Verify a finding against actual behavior and the task's scope
before fixing it. Address real regressions introduced by the change; keep
unrelated findings out of the task. Do not rerun merely to raise the score.

## Command

```bash
npx -y react-doctor@latest . --verbose --diff
```

| Flag        | Purpose                                       |
| ----------- | --------------------------------------------- |
| `.`         | Scan current directory                        |
| `--verbose` | Show affected files and line numbers per rule |
| `--diff`    | Only scan changed files vs base branch        |
| `--score`   | Output only the numeric score                 |
