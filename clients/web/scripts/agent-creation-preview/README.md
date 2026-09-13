# Agent creation recovery preview

Run from the repository root:

```sh
pnpm -C clients/web exec vite --config scripts/agent-creation-preview/vite.config.ts
```

Open http://127.0.0.1:30284/. No account or password is required.

This isolated UI harness renders the production Agent generator and recovery
controller with typed computer fixtures. Setup transport and Agent creation are
simulated. It never changes a real computer, runs a setup command, or creates an
Agent. The command card uses the production presentation component, but the
complete live setup workflow is covered separately by integration tests.

## Review scenarios

The Mock controls selector includes first connection, a saved offline computer,
connection checking, a failed connection check, an online computer without local
agents, a ready computer, two offline computers, and two available computers.
Use the simulation buttons to move setup through connecting, failure, and success.
Connection instructions appear immediately in scenarios that require setup.
No Connect or Reconnect confirmation click is needed. Cancel new connection is
available only after explicitly choosing to connect another computer.

Suggested review:

1. Select Connected and ready. Edit the Agent name and expand advanced settings.
2. Select Saved computer offline. Confirm connection instructions appear directly.
3. Simulate failure, retry, then simulate success. Confirm the name and
   expanded settings return in the same dialog.
4. Compare First connection with Saved computer offline. Existing computers must
   say reconnect; new computers must say connect.
5. Try connection-check failure, checking, and no-local-agent states. Each should
   explain the current condition and offer the relevant action.
   The no-local-agent state shows the shared dashed installation card, five
   supported agents, an install-guide link, and Check again, without a connection
   command. The isolated harness does not host the installation-guide route.
6. Try two offline computers, select the intended computer, and confirm its name.
7. From the ready form, choose Connect another computer, then cancel that connection.
8. Create the simulated Agent and confirm return to the preview Space context.

## Evidence and limits

Chrome localhost smoke covered first connection, offline recovery, an inline
command, failure/retry, connecting/success, preservation of an edited name and
expanded settings, multiple offline computers, failed checks/retry, the disabled
checking action, no-local-agent copy, the other-computer entry, and switching to
Remote Agent. Remote model loading is not mocked for creation acceptance.

This is presentation and interaction evidence, not authenticated full-application
or real Service reconnection acceptance. It does not prove refresh persistence,
installation, account authorization, backend readiness propagation, or a Wake.
The full local stack was not started alongside the six existing stacks because
the host was under memory pressure. Felix approved the revised UI for PR review;
real Service reconnection acceptance remains outstanding.
