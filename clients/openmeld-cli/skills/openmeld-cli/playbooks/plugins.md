# Plugins

Use the signed-in organization and a Local Agent Profile owned by the signed-in
account. The Profile must have an enabled local OpenMeld Service Binding.
During a Wake, use the assigned Profile; the CLI forwards its request context.

```sh
openmeld plugins list --profile <agent-profile-id> --view agent
openmeld plugins connect github --account choose --profile <agent-profile-id> --view agent
openmeld plugins actions github --account shared --profile <agent-profile-id> --view agent
openmeld plugins call <service> <action-id> --account personal --profile <agent-profile-id> --operation <unique-operation-id> --input '<json-object>' --view agent
```

Choose `personal` or `shared` explicitly. Read the returned action input schema
before invoking it. A personal account is available only for its owner's
request; another person's Wake must use an authorized shared account.

When a needed connection is missing, use `plugins connect <service>`. Preserve
an explicit `--account personal` or `--account shared`; use `choose` only when
the user has not required an identity. The server returns `replyText`, a trusted
ordinary link. In a Wake, include that text unchanged at the end of your final
reply. OpenMeld enhances it into the shared connection card, and only the
original requester can explicitly continue the same task after setup. Neither
opening the page nor OAuth completion runs anything. Never put credentials in
chat or construct a provider authorization URL. Keep prior operation receipts;
continuation is remaining work, not a restart. Outside a Wake there is no bound
conversation to resume; the command truthfully returns setup guidance only.

If the result requires confirmation, show the requester the exact action,
account, and input. Only after their authorization, repeat the same command
and operation ID with `--confirm <confirmation-token>`. The token expires and
does not authorize changed input or changed connection permissions.

Keep one operation ID for one logical action. Repeating a command without
`--replay` returns its recorded status. Only a receipt with `replay.allowed=true`
permits one `--replay` with the original operation ID, account and unchanged input
inside the original 24-hour window. Core consumes that allowance durably before
calling the provider; parallel calls and process recovery do not restore it.
Missing permission, an expired window or a used allowance forbids another write.
`outcome_unknown` is not a failure to submit: do not create a new operation ID
to force a retry. Within one Wake the same effect remains the same operation.
An explicit later request is a separate task and may create a new effect.
Use a reliable read of the exact target and original account to check the result.
`not_found`, a timeout, or absence from one page does not prove non-execution;
report uncertainty when the read cannot establish the outcome.
Credentials stay on the server. Access changes are managed in Plugins.

## Reuse a Plugin from Computer

For Git repository placement, reuse and capacity checks, read `computer.md`.

Do not ask the user to log in twice. Inspect the existing connection first:

```sh
openmeld plugins connection <service> --account personal --key diagnosis --profile <agent-profile-id> --view agent
openmeld plugins connection <service> --account personal --key diagnosis --computer --profile <agent-profile-id> --view agent
```

The first command returns credential health, native read rules, and official
API documentation. The second creates a temporary base URL inside the user's
cloud Computer. Use it with `computer` commands on `backend=container`; apply
returned CLI environment variables only to that command. They contain no
provider token. Inspect the CLI's own help/schema for API inputs. An unsupported
native transport means use Plugin actions, not another login.

Reuse the same key to renew an expired URL. Preserve the selected personal or
shared account. Disconnecting the Plugin, changing its account, or withdrawing
Agent access stops subsequent requests. An exact-action delegated Wake must
use its authorized action instead of opening a broader native connection.

`unknown` health means that stored credentials have not been verified by a live
provider call. `refresh_required` means execution will attempt the provider's
refresh flow. `reconnect_required` means use `plugins connect` for the same
account. Reconnecting does not grant missing provider permissions.

For Cloudflare Worker diagnosis, inspect `cloudflare_worker`'s returned native
schema. Query a narrow timeframe with a bounded limit and `dry: true`; use
events/invocations for logs and calculations for metrics. Correlate with the
Worker's deployments and versions through declared GET paths. Cloudflare's
query endpoint currently requires `Workers Observability Write` even for a dry
query. Report a permission failure accurately; do not substitute another
account. Results redact known credential values and standard secret fields,
but arbitrary application log text can still contain sensitive information.
