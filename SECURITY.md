# Security policy

## Report a vulnerability privately

Email [felix@amplift.ai](mailto:felix@amplift.ai) with the subject
`OpenMeld security report`.

Do not report vulnerabilities in public issues, pull requests, or shared product
conversations. Do not include live credentials, personal data, or another
organization's content.

Include:

- The affected component and version, or the commit SHA.
- What an attacker could do and the access they would need.
- The smallest safe reproduction, using accounts and data you control.
- Expected and actual behavior.
- Redacted logs or screenshots, if they help.

If GitHub shows **Report a vulnerability** on the
[Security Advisories page](https://github.com/amplifthq/openmeld/security/advisories),
you can use that private form instead. Email remains available if the form is absent.

## Scope and versions

Report suspected vulnerabilities in OpenMeld's source, published clients,
local Service, or hosted services. Authorization failures between accounts,
organizations, Spaces, agents, and connected computers are in scope.

During early development, fixes target the current `main` branch and the latest
published releases. Older versions do not have a separate security maintenance
commitment. Report older-version findings too, and state the affected version.

## What happens next

Maintainers review the report, request missing details, and coordinate a fix
and disclosure with the reporter. This project does not promise a fixed response
or remediation deadline.

Please keep exploit details private while we assess and address the report.
We will discuss public credit with you before naming you.

## Safe investigation

Use a local environment or accounts and data you control.
Do not access another person's data, disrupt a shared service, or test a
third-party integration without its owner's permission.
If a test exposes private data, stop and report the exposure.

For ordinary bugs and setup problems, use [Support](SUPPORT.md).
