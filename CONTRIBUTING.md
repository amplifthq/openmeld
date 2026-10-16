# Contributing to OpenMeld

Thank you for helping build OpenMeld. Documentation, bug reports, design feedback,
and code contributions are welcome.

Follow our [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately
through [SECURITY.md](SECURITY.md), not a public issue.

## Choose a first contribution

- Correct a guide that did not match your experience.
- Report a reproducible bug with the expected and actual result.
- Improve an existing feature or a focused test.
- Propose a feature by describing the task you cannot complete today.

Search [existing issues](https://github.com/amplifthq/openmeld/issues) and
[pull requests](https://github.com/amplifthq/openmeld/pulls) first.
For a large change, open an issue to agree on the problem and scope before implementation.
Small fixes can go directly to a pull request.

## Prepare your checkout

Install Node.js 24 and Git. Fork the repository, then clone your fork:

```sh
git clone https://github.com/YOUR-USERNAME/openmeld.git
cd openmeld
git remote add upstream https://github.com/amplifthq/openmeld.git
corepack enable
corepack install
pnpm install --frozen-lockfile
git switch -c docs/clarify-setup
```

Corepack selects the pnpm version pinned in `package.json`.
Use a branch name that describes your change.

For a first contribution without team credentials, preview the public docs:

```sh
pnpm --filter openmeld-docs dev
```

Open the local URL printed by Vite, then edit `clients/docs/content/docs/`.
See [Development](docs/development.md) for checks, port selection, and the full
application setup. The full application currently requires authorized access
to the team's development secrets. Docs work does not.

## Make the change

Read [AGENTS.md](AGENTS.md), then the owner document for the area you change.
The [development guide](docs/development.md#repository-map) helps you find that area.

Keep one pull request focused on one outcome. Reuse existing shared components
and contracts. Update the relevant guide when behavior or setup changes.
Do not commit credentials, account data, generated local state, or unrelated changes.

AI-assisted contributions are welcome. You remain responsible for the result:
read the diff, check generated claims, and verify the behavior you change.

## Verify the result

Choose checks that can expose a regression in the changed behavior.
Add a test when it protects an important contract at reasonable cost.
Do not add tests only to increase coverage.

For public documentation:

```sh
pnpm --filter openmeld-docs check
```

Preview changed pages and follow their links. For repository Markdown:

```sh
git diff --check
```

For code, use the affected package's checks and relevant tests.
For user-visible changes, exercise the real user entry point.
Describe what you verified and any limits in the pull request.

Contributor-facing workflow changes can need a [Changelog entry](developing/engineering/changelog.md).
Keep the entry unpublished until delivery is verified.

## Open a pull request

1. Commit with a short English Conventional Commit message, such as `docs: clarify computer setup`.
2. Push the branch to your fork.
3. Open a **Draft** pull request against `amplifthq/openmeld:main`.
4. Explain the problem, the change, and the validation. Add screenshots for visible changes.
5. Use `Fixes #123` only when the change fully resolves that issue.
6. Request review when the change is ready. Keep incomplete work in Draft.

Install dependencies before committing so the repository hooks can run.
Do not bypass failed checks. The [delivery workflow](developing/engineering/agent-native-delivery.md#daily-workflow)
defines the checks and maintainer steps before merge and release.
External contributors do not need production credentials.
Keep production credentials out of your fork, pull request, and test output.

`OpenMeld Final Candidate` checks the exact pull request commit against the current
`main` branch. Reviews follow the repository rules and maintainer requirements.
Passing CI does not deploy OpenMeld. Production releases use separately invoked,
guarded local commands or GitHub workflows. Maintainers can disable the GitHub
release workflows while enabling pull request checks; this does not disable the
local release commands.

## Contribution licensing

Submit only material you have the right to contribute.
Your original contributions use the repository's [MIT License](LICENSE).
Changes to third-party material must preserve its applicable license and notices.

When adding copied code, fonts, images, or other assets, include the source,
required license text, and attribution. Update [Third-party notices](THIRD_PARTY_NOTICES.md).
Add major upstream projects to [Credits](CREDITS.md). A credit link does not
replace the license and copyright notices required for distribution.
After adding or changing package dependencies, run
`node scripts/docs/update-dependency-credits.mjs` and include the updated
[dependency index](docs/dependencies.md). Stage new package manifests first.
Do not assume that public source code permits unrestricted reuse.

Need help choosing a starting point? See [Support](SUPPORT.md).
