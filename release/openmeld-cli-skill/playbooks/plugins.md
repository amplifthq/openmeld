# Plugins

Use Plugins when the task requires an action in a connected app. First check
the available service and action; an installed integration does not imply that
this account may use every action.

Use the signed-in Organization and a Local Agent Profile owned by the signed-in
account, with an enabled local OpenMeld Service Binding. During a Wake, use the
assigned Profile; the CLI forwards its request context.

```bash
openmeld plugins list --profile <agent-profile-id> --view agent
openmeld plugins actions <service> --account shared --profile <agent-profile-id> --view agent
openmeld plugins call <service> <action-id> --account personal --profile <agent-profile-id> --operation <unique-operation-id> --input '<json-object>' --view agent
```

Choose `personal` or `shared` explicitly. Read the returned action input
schema before invoking it. A personal account is available only for its owner's
request; another person's Wake must use an authorized shared account.

## Missing connection or confirmation

```bash
openmeld plugins connect <service> --account choose --profile <agent-profile-id> --view agent
```

Preserve an explicit `--account personal` or `--account shared`; use
`choose` only when the user has not required an identity. Return the server's
`replyText` unchanged. In a Wake, include it at the end of the final Space
Action reply. OpenMeld renders the connection card, and the original requester
can explicitly continue after setup. Opening the page or completing OAuth does
not run the action. Outside a Wake, the command returns setup guidance without
binding a conversation to resume. Keep credentials out of chat and use the
returned link rather than constructing a provider authorization URL.

If a result requires confirmation, show the requester the exact action,
account, and input. After their authorization, repeat the same command and
operation ID with `--confirm <confirmation-token>`. The token expires and
does not authorize changed input or permissions.

## Check the outcome

Keep one operation ID for one logical action, including retries after transport
failure. A repeated operation returns its recorded status without reexecuting.
`outcome_unknown` is not proof of failure: check the provider outcome before
proposing another action; do not force a retry with a new operation ID.
Preserve completed operation receipts when continuing a task after setup.
Credentials and connection permissions remain managed by OpenMeld.
