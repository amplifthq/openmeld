# Windows Compatibility Implementation

## Agent Context

- Purpose: Track the Windows audit, repair scope, and pending native acceptance.
- Read this when: Implementing or reviewing Windows Computer, Wake, or Desktop compatibility.
- Update this when: A finding is corrected, implemented, or validated.
- Do not use this for: Current release availability or permission to deploy.
- Source of truth: The accompanying Draft PR records evidence; scoped architecture and client owner documents define the product contracts.

Status: Implementation in progress; native Windows acceptance remains pending.

Remove when the fixes ship and their acceptance evidence is retained in the PR
and the stable contracts have been incorporated into the scoped owner documents.

## Scope and evidence

The review baseline is `c8637337950992ff3f104f2ee0e6c8f5e3c1a92d`.
This work covers Windows Computer setup, Desktop-to-CLI invocation, local
Service ownership, Agent launch, workspace permission checks, cancellation,
packaging, and platform regression coverage.

The accompanying Draft PR comments contain the complete audit, severity,
source locations, research references, repair decisions, and acceptance matrix.
The implementation owner must keep those comments current as findings are
confirmed, narrowed, corrected, or resolved. A suspected cause of a colleague's
failure is not a confirmed incident diagnosis without its logs.

## Delivery boundary

- Keep the PR Draft. The user will arrange merge and native Windows smoke.
- Do not deploy, publish an installer, change production Service state, or
  weaken identity, permissions, TLS, or process ownership to make tests pass.
- Preserve the existing RuntimeCoordinator, Service, and Prepare owners.
- Windows Web plus local Computer and installed Windows Desktop require
  separate acceptance evidence. WSL and simulated platform branches are not
  native Windows acceptance.
- Signing credentials and a published artifact are release prerequisites, not
  facts established by adding build configuration.

## Audit tracking

| ID | Boundary | Initial classification |
| --- | --- | --- |
| W01 | Desktop managed Tools bootstrap | Apple-silicon-only support gap |
| W02 | Desktop CLI discovery and invocation | Windows npm shims are not native executables |
| W03 | Agent launch contract consumers | Invocation requirements dropped by callers |
| W04 | Environment propagation | Windows case-insensitive keys lost or duplicated |
| W05 | Account-checked Service control | Windows capability not implemented |
| W06 | Execution-context directory policy | Windows sibling paths incorrectly admitted |
| W07 | Codex workspace access probe | Windows physical boundary probe not implemented |
| W08 | Agent process supervision | Windows descendants omitted from cleanup |
| W09 | Desktop packaging and updates | Mac-only distribution contract |
| W10 | Desktop keyboard navigation | Mac-only modifiers and labels |
| W11 | Native Windows validation | Product tests absent from Windows CI |
| R01 | Claude SDK launch wrapper | Vendor contract must be verified |
| R02 | PowerShell process inventory | Encoding, timeout, and error diagnostics |
| R03 | Proxy and certificate handling | Environment-specific risk; incident unconfirmed |

## Acceptance

Use an ordinary signed-in Windows user and an isolated non-production lane.
Cover clean setup, repeat setup, matching-account start/stop/disconnect,
credential changes, Node/npm and native Agent installs, spaces and Unicode in
paths, file-policy sibling/cross-drive/UNC negatives, physical sandbox probes,
streaming Wake and final Space delivery, cancellation with child/grandchild
processes, logout/reboot/reconnect, installed Desktop authentication, updates,
Ctrl shortcuts, composition, and DPI.

For each result retain the exact candidate and component versions, platform,
invocation kind, account/lane, failure stage, bounded redacted diagnostics, and
the relevant task/request identifiers. Never record credentials or treat a
green status label as proof of process termination or end-to-end delivery.
