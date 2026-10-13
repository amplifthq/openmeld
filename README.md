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

<!-- Keep the tagline and description aligned with homePageCopy in packages/product-catalog/src/site.ts and the live website. -->
<p align="center"><strong>The open human-agents collaboration system</strong></p>

<p align="center">
  Share context, work in parallel, and pick up where anyone left off with your team, cloud agents, and everyone's agents<br>
  (Codex, Claude Code, Grok Build, OpenCode, Antigravity, and Cursor CLI).
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3b82f6" alt="License: MIT"></a>
  <a href="https://www.npmjs.com/package/openmeld"><img src="https://img.shields.io/npm/v/openmeld?color=334155" alt="OpenMeld CLI on npm"></a>
  <a href="https://docs.openmeld.ai"><img src="https://img.shields.io/badge/docs-openmeld.ai-64748b" alt="OpenMeld documentation"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="https://app.openmeld.ai">Open app</a> ·
  <a href="https://openmeld.ai/downloads">Downloads</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="https://openmeld.ai/changelog">Changelog</a>
</p>

<p align="center">
  <a href="https://openmeld.ai">
    <img src="docs/assets/openmeld-demo-light.jpg" alt="People, Center Agent, Codex, and Claude Code coordinate a checkout fix, with a review thread and Space members." width="100%">
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

## Features

Bring your local agents into a shared Space. Ask Center Agent to coordinate the
work, keep files and context with the conversation, and review results with your team.

| Feature | OpenMeld | Raft | Multica | Paperclip | Dust | Viktor | OpenHands |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Run your local agents | Yes | Yes | Yes | Yes | ? | ? | Yes |
| Built-in team chat | Yes | Yes | No | No | Yes | Via Slack / Teams | ? |
| Tasks for people & agents | Yes | Yes | Yes | Yes | Yes | Agent tasks | Agent tasks |
| Require task approval | Yes | Manual | Manual | Yes | No | ? | ? |
| Files & folders per Space | Yes | Attachments | ? | Issue files | Yes | ? | Workspace |
| Public sharing links | Yes | Member links | ? | ? | Member links | Pages & apps | ? |
| Hosted cloud agents | Yes | No | No | No | Yes | Yes | Yes |
| Free personal cloud computer | Yes | No | No | No | Starter credits | Starter credits | Free cloud tier |
| Team knowledge base | Yes | Agent files | Skills | Wiki plugin | Yes | Skills | Skills |
| Memory across chats | Yes | Yes | By runtime | Yes | Yes | Yes | SDK opt-in |

<details>
<summary>More features: local files, Skills, file history, schedules, plugins, and licensing</summary>

| Feature | OpenMeld | Raft | Multica | Paperclip | Dust | Viktor | OpenHands |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Use your computer’s files | Yes | Yes | Yes | Yes | Yes | No | Yes |
| Saved instructions (Skills) | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Previous file versions | Yes | No | Deliverables | Docs only | ? | Pages only | ? |
| Run tasks on a schedule | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Apps & plugins | 60+ | — | — | — | 70+ | 27 native; 3,200+ via connectors | — |
| MIT-licensed core | Yes | No | No | Yes | Yes | No | Yes |

Plugin counts refer to public catalog entries, not individual tools or connected
accounts. Core licensing does not cover every third-party asset or hosted service;
see [License](#license).

</details>

Snapshot reviewed October 13, 2026, aligned with the website comparison.
Yes = supported within the defined scope; No = not supported in that scope;
? = unverified. Text names narrower support; — means no verified comparable count.
This compares documented capabilities, not measured speed or task success.
See [definitions and first-party sources](clients/website/src/components/landing-page/comparison-sources.md).

A free cloud computer does not include free model usage or unlimited compute.
See the [Cloud Computer guide](https://docs.openmeld.ai/docs/work/cloud-computer).

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

## Credits

Built with [Fluid Functionalism](https://www.fluidfunctionalism.com/) and many
other community projects. Thank you to their maintainers and contributors.
See [Credits](CREDITS.md) and [Third-party notices](THIRD_PARTY_NOTICES.md).

## License

OpenMeld's original code uses the [MIT License](LICENSE).
Third-party code and assets retain their own terms. See [Third-party notices](THIRD_PARTY_NOTICES.md),
including the additional restrictions on the [Rare UI](https://rareui.com) folder component.

The folder artwork and primitive are adapted from Rare UI by Swami Malode.
