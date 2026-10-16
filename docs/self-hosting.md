# Self-hosting status

You can self-host OpenMeld using its MIT-licensed source code. For now, you need
to work from the repository and configure your own infrastructure. Our official
documentation does not yet cover the complete setup process.

We plan to add complete self-hosting documentation and step-by-step setup guidance.

To use OpenMeld without setting up your own infrastructure, start with the
[hosted app](https://app.openmeld.ai).
Connecting your own computer runs local agents there. It does not host the
OpenMeld collaboration services.

## What the repository provides

- Source for the Web, Desktop, CLI, and cloud services.
- A [local development workflow](development.md#run-the-full-application) that uses the team's authorized Doppler configuration.
- Cloudflare deployment configuration and [maintainer release procedures](../developing/engineering/production-release.md).

The release procedures target OpenMeld-operated environments.
They are not an installation guide for your own Cloudflare account.
Do not run those production commands as a self-hosting setup step.

An independent installation needs its own infrastructure, secrets, authentication
configuration, and storage. The current team workflow does not prepare those for you.

If you want to help build a repeatable self-hosting path, open a
[feature proposal](https://github.com/amplifthq/openmeld/issues/new?template=feature_request.yml).
Describe the environment you need and the smallest useful deployment.
