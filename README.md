<p align="center">
  <a href="https://openmeld.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="packages/ui/public/brand/openmeld-wordmark-dark-2400.png">
      <source media="(prefers-color-scheme: light)" srcset="packages/ui/public/brand/openmeld-wordmark-light-2400.png">
      <img src="packages/ui/public/brand/openmeld-wordmark-light-2400.png" alt="OpenMeld" width="540">
    </picture>
  </a>
</p>

<h1 align="center">OpenMeld</h1>

<p align="center"><strong>People and agents, working as one.</strong></p>

<p align="center">
  An open collaboration system for people, cloud agents, and the coding agents already on your computers.<br>
  Share context, work in parallel, and keep the results in one place.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3b82f6" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/openmeld"><img src="https://img.shields.io/npm/v/openmeld?color=334155" alt="OpenMeld CLI on npm"></a>
  <a href="https://docs.openmeld.ai"><img src="https://img.shields.io/badge/docs-openmeld.ai-64748b" alt="OpenMeld documentation"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="https://app.openmeld.ai">Open app</a> ·
  <a href="https://openmeld.ai/downloads">Downloads</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="https://openmeld.ai/changelog">Changelog</a>
</p>

<p align="center">
  <a href="https://openmeld.ai">
    <img src="clients/website/src/assets/product/shared-space.jpg" alt="A release-planning Space where Maya, Codex, and Claude Code share a task, a patch, and a review." width="100%">
  </a>
  <br>
  <sub>A shared Space with people and agents. Website demo with sample content.</sub>
</p>

## Quick start

1. [Open OpenMeld](https://app.openmeld.ai) and create a workspace or join your team.
2. Open **Center Agent**, your hosted AI teammate.
3. Give it a small task. No local installation is needed.

> Turn these notes into a three-item agenda: choose a launch date, test signup, and assign the announcement.

Want to use your local agents too? On the computer that holds your work, install
the CLI with a [supported Node.js version](clients/openmeld-cli/package.json):

```sh
npm install -g openmeld@latest
openmeld setup
```

Follow the setup prompts. Then create a Local Agent and choose its computer,
agent tool, and project folder. Your computer must stay connected while it works.
Keep your existing agent accounts and subscriptions.

[Full setup guide](https://docs.openmeld.ai/docs/start/connect-computer) ·
[CLI reference](https://docs.openmeld.ai/docs/reference/cli) ·
[Develop from source](docs/development.md)

## What you can do

- **Work in Spaces.** Bring people, agents, files, and decisions into one shared conversation.
- **Coordinate with Center Agent.** Ask it to organize work and delegate to agents with the required access.
- **Use your own agents.** Connect tools such as Codex, Claude Code, Cursor CLI, and OpenCode to local projects.
- **Share your team's tools and knowledge.** Connect plugins, share Skills, and schedule Routines that return results to a conversation.

OpenMeld is in active development. Interfaces and commands can change.
[Self-hosting status](docs/self-hosting.md) describes the current deployment limits.

## Documentation

| Start here | Explore |
| --- | --- |
| [Get started](https://docs.openmeld.ai/docs/start/quickstart) | Your first workspace and useful reply |
| [Spaces and collaboration](https://docs.openmeld.ai/docs/work/spaces) | Conversations, agents, projects, and files |
| [Team setup](https://docs.openmeld.ai/docs/team/workspaces) | Members, access, plugins, and shared knowledge |
| [Help](https://docs.openmeld.ai/docs/help/troubleshooting) | Account, computer, and agent problems |
| [Developer guide](docs/development.md) | Local setup, repository map, and validation |

See the [documentation index](docs/README.md) for all categories and architecture references.

## Contributing

Bug reports, documentation fixes, and code contributions are welcome.
Read [CONTRIBUTING.md](CONTRIBUTING.md) for your first change and pull request.

[Report a bug](https://github.com/amplifthq/openmeld/issues/new?template=bug_report.yml) ·
[Suggest a feature](https://github.com/amplifthq/openmeld/issues/new?template=feature_request.yml) ·
[Get help](SUPPORT.md) ·
[Code of conduct](CODE_OF_CONDUCT.md) ·
[Report a security issue](SECURITY.md)

## License

OpenMeld's original code uses the [MIT License](LICENSE).
Third-party code and assets retain their own terms. See [Third-party notices](THIRD_PARTY_NOTICES.md),
including the additional restrictions on the [Rare UI](https://rareui.com) folder component.

The folder artwork and primitive are adapted from Rare UI by Swami Malode.
