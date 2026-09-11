# Plugins

Use the signed-in organization and a Local Agent Profile owned by the signed-in
account. The Profile must have an enabled local OpenMeld Service Binding.
During a Wake, use the assigned Profile; the CLI forwards its request context.

```sh
openmeld plugins list --profile <agent-profile-id> --view agent
openmeld plugins actions github --account shared --profile <agent-profile-id> --view agent
openmeld plugins call <service> <action-id> --account personal --profile <agent-profile-id> --operation <unique-operation-id> --input '<json-object>' --view agent
```

Choose `personal` or `shared` explicitly. Read the returned action input schema
before invoking it. A personal account is available only for its owner's
request; another person's Wake must use an authorized shared account.

If the result requires confirmation, show the requester the exact action,
account, and input. Only after their authorization, repeat the same command
and operation ID with `--confirm <confirmation-token>`. The token expires and
does not authorize changed input or changed connection permissions.

Keep one operation ID for one logical action, including retries after transport
failure. A repeated operation returns its recorded status without reexecuting.
`outcome_unknown` is not a failure to submit: do not create a new operation ID
to force a retry. Check the provider outcome before proposing another action.
Credentials stay on the server. Access changes are managed in Plugins.
