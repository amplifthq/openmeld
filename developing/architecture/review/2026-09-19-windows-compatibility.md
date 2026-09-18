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

## Implementation disposition

W01-W11 have candidate code corrections: npm bootstrap returns its verified JS
entry; launch consumers preserve complete invocation; Windows environment keys
are normalized; account lifecycle uses native process identity and pre-grant
ownership; folder policy uses platform paths; Codex has a Windows physical
boundary probe; Wake Jobs own descendants; signed Desktop release/update
contracts are platform-scoped; native caption controls and Ctrl shortcuts are
present; focused native Windows CI exercises the contracts. The table above
records baseline findings, not the current implementation's capabilities.

R01's Claude SDK public spawn boundary has native Windows fixture coverage;
authenticated Claude execution remains acceptance. R02's bounded UTF-8
PowerShell inventory is implemented. R03 remains an incident-specific network
risk requiring the colleague's logs; no TLS, firewall, privilege or account
protection is disabled to make it appear resolved.

PR #1163's English delivery comments record each pushed candidate and its exact
validation. Read current PR HEAD rather than applying an earlier green CI result
to newer source. Keep source tests, child-process tests, native Windows CI and
signed-in product smoke separate. Signing publisher and full release-workstation
7-Zip are explicit operator prerequisites. No signed OpenMeld Windows installer
or production update has been published by this implementation.

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
