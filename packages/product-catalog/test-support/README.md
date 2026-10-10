# OpenConnector provider fixture

`openconnector-providers.json` contains public provider metadata captured from
OpenMeld's pinned OpenConnector revision
`a295f56bf6e533ffc5699efa66282b151e127d87` on 2026-10-09. It includes the featured
providers, their credential field definitions, and OAuth readiness at capture.
It contains no account connections or credential values.

Keep vendor-only fields such as `scenario` in this fixture. Gateway must remove
those fields at its transport boundary before returning the strict OpenMeld
catalog contract. OAuth support and configured sign-in are different facts.
