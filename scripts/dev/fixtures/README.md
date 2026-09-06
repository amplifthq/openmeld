# Shared development fixture modules

Run `pnpm dev:seed` after `pnpm dev:worktree` is ready. The runner discovers the
current worktree's lane; do not supply DB files, ports, production URLs, or real
account credentials. Python 3 uses only its standard library.

| Owner area | Module | Current scenarios |
| --- | --- | --- |
| Test credentials | `accounts.py` | Random local accounts, credential retrieval, explicit new account creation; shared by `dev:account` and `dev:seed` |
| Organization and local environment | `context.py` | Organization, authentication, backup, strict local lane selection |
| People, Agents, Computers | `people.py` | 18 teammates, 42 Agents, multiple owners/controllers, disabled and unbound Agents, historical computer records |
| Spaces and Inbox | `spaces.py` | 28 Spaces, long names, public/private, pins, mixed membership, unread records |
| Messages | `messages.py` | Six DMs, mixed peers, recent/older/long/multiline and outgoing-only previews |
| Personal grouping | `sidebar.py` | Starter stars and custom People/Agents groups, existing arrangements preserved |

## Add or change a scenario

1. Edit the owning module, using `context.ident` with a stable descriptive key.
   Keep identities fictional and use reserved example domains. Do not change an
   existing key just to change its label; reruns must not duplicate entities.
2. Reuse context authentication and local paths. Add a module to `dev-seed.py`
   only when it owns a distinct product area, and declare its dependencies in
   the execution order and `--only` choices. Avoid a second bootstrap or lane
   registry reader.
3. Prefer owning APIs for creation and membership. Direct local fixture writes
   are data preparation, not a passing API, permission, or execution test. Back
   up any additional local database before changing it, and touch only stable
   fixture IDs. Never seed live transport, leases, or running execution truth.
4. Keep isolated transient visual samples in the standalone preview. Do not
   inject Space Working/needs-input summaries into the product without the
   corresponding runtime requests and normal response path. Generated IDs, sessions,
   database files, and secrets do not belong in Git.
5. Run the command twice in an isolated lane and verify counts stay stable.
   Check the relevant real UI entry point and update this scenario table.

The suite currently covers the areas above. Additional product areas should be
added by their owners with representative normal, empty, long-content, and
error/status cases where practical; it is not a simulation of real AI execution.
