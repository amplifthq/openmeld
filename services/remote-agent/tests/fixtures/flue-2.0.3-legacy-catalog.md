# Retained pre-fix conversation

`flue-2.0.3-legacy-catalog.sqlite.gz` was generated on 2026-09-22 from
unmodified OpenMeld main `43d7b3dea65844dc87475fecb693f7864840e64e`
and its installed, patched Flue 2.0.3.

The capture used the real Node runtime, SQLite adapter, OpenMeld
`getRemoteAgentFlueTools`, registered OpenRouter provider, and an intercepted
HTTP response returning "Acknowledged." No production context or credentials
were used. Agent name: `CatalogContract`; conversation: `retained-catalog`.

1. Register the unmodified full catalog with an empty Core binding and no
   Computer, then dispatch "Remember that the sample record is Cedar."
2. Materialize again, adding the fictional `sample_lookup` capability
   (empty input schema, description "Read the fictional Cedar record.").
3. Dispatch "Which record did I ask you to remember?"
4. Stop Flue and gzip its closed SQLite database.

The second actual provider request exposed seven native tools while Flue's
resource event advertised the full catalog, including GitHub and
`sample_lookup`. The contract assertion failed before the production fix.
The fixture retains canonical records, snapshots, submissions, and completed
responses, rather than constructing a synthetic legacy message in the fixed
implementation. Tests restore a disposable copy; never regenerate this fixture
with the fixed registration path.
