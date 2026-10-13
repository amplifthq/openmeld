# Documentation

Choose the guide for the task you want to complete.
The [public documentation site](https://docs.openmeld.ai) contains product guides.
This repository contains contributor guides and the engineering documents that own implementation rules.

## Use OpenMeld

| Category | Guides |
| --- | --- |
| Start | [Quick start](https://docs.openmeld.ai/docs/start/quickstart), [concepts](https://docs.openmeld.ai/docs/start/concepts), [connect a computer](https://docs.openmeld.ai/docs/start/connect-computer), [downloads](https://openmeld.ai/downloads) |
| Work | [Spaces](https://docs.openmeld.ai/docs/work/spaces), [agents](https://docs.openmeld.ai/docs/work/agents), [Center Agent](https://docs.openmeld.ai/docs/work/center-agent), [projects](https://docs.openmeld.ai/docs/work/projects), [files](https://docs.openmeld.ai/docs/work/files), [Routines](https://docs.openmeld.ai/docs/work/routines) |
| Team | [Workspaces](https://docs.openmeld.ai/docs/team/workspaces), [access](https://docs.openmeld.ai/docs/team/access), [plugins](https://docs.openmeld.ai/docs/team/plugins), [Skills](https://docs.openmeld.ai/docs/team/skills), [channels](https://docs.openmeld.ai/docs/team/channels) |
| Help | [Troubleshooting](https://docs.openmeld.ai/docs/help/troubleshooting), [agent not replying](https://docs.openmeld.ai/docs/help/agent-not-replying), [computer connection](https://docs.openmeld.ai/docs/help/computer) |
| Reference | [CLI](https://docs.openmeld.ai/docs/reference/cli), [feature guide](https://docs.openmeld.ai/docs/reference/feature-guide), [docs for agents](https://docs.openmeld.ai/docs/reference/docs-for-agents) |

Product guide source lives in [clients/docs/content/docs](../clients/docs/content/docs).
Edit that source to update the website. Do not maintain a second copy here.

## Build and contribute

- [Contributing](../CONTRIBUTING.md): your first change and pull request.
- [Development](development.md): prerequisites, local docs preview, and application setup.
- [Self-hosting status](self-hosting.md): current limits and deployment references.
- [Engineering index](../developing/README.md): scoped product, client, and engineering owners.
- [Agent instructions](../AGENTS.md): repository rules for coding agents.

## Understand the architecture

- [Product model](../developing/product/product-model.md): the system and its main concepts.
- [Agent transport](../developing/architecture/agent-transport-contract.md): how work reaches an agent and returns to a Space.
- [Local Service](../developing/architecture/local-openmeld-service.md): the background service on a connected computer.
- [PostgreSQL](../developing/engineering/postgresql.md): database tools and current development workflow.
- [Shared contracts](../developing/architecture/shared-contracts.md): schemas and boundaries between clients and services.

## Community and policies

[Support](../SUPPORT.md) · [Code of conduct](../CODE_OF_CONDUCT.md) ·
[Security](../SECURITY.md) · [License](../LICENSE) ·
[Third-party notices](../THIRD_PARTY_NOTICES.md) · [Changelog](../CHANGELOG.md)

Existing operational runbooks in this directory serve maintainers.
They are not standalone installation guides.
