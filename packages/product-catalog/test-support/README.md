# OpenConnector provider fixture

`openconnector-providers.json` contains public provider metadata captured from
OpenMeld's pinned OpenConnector revision
`a295f56bf6e533ffc5699efa66282b151e127d87` on 2026-10-09. It includes the featured
providers, their credential field definitions, and OAuth readiness at capture.
It contains no account connections or credential values.

Keep vendor-only fields such as `scenario` in this fixture. Gateway must remove
those fields at its transport boundary before returning the strict OpenMeld
catalog contract. OAuth support and configured sign-in are different facts.

`openconnector-expansion-providers.json` captures the additional featured
services on 2026-10-09 and from the staging runtime on 2026-10-10. The later
capture records unconfigured OAuth methods as `false` and includes the modern
`shopify_admin` GraphQL provider. Its operation descriptions were checked
against upstream revision `b78ad1f28d99fa311f25856b589ca3780aef0746`. The
separate legacy `shopify` REST provider is not part of the featured expansion.
