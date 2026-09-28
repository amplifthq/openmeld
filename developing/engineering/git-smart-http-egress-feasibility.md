# Git smart HTTP egress feasibility probe

This is an experimental dependency check for replacing one-blob-at-a-time
Hosted Computer checkout. It changes no production checkout path.

The installed `@cloudflare/computer@0.2.1` exposes `http-gateway` egress on its
container backend. The workerd test in this branch exercises the SDK forwarding
path with a 32 MiB Git `git-upload-pack` POST and a 32 MiB streamed response.
The SDK strips its internal egress token and original-URL headers before handing
the request to the gateway. This demonstrates that the pinned SDK can carry a
binary POST and response in an isolated Worker test. It does **not** prove real
container networking, GitHub latency, or a completed private repository clone.

## Missing authenticated upstream

OpenMeld currently obtains the selected requester's GitHub connection through
OpenConnector. In the inspected `amplifthq/open-connector` revision `c6f45596`,
`/v1/proxy/:service` accepts a JSON request and returns a JSON envelope. Its
standard proxy budget is 30 seconds, including reading the provider response.
It cannot pass a Git request body and pack response as streams. OpenMeld does not
receive the provider credential, and moving that credential into the Computer
would break the intended boundary. Therefore this probe deliberately does not
pretend to clone a private repository or enable the gateway for ordinary
Computer egress.

The next prerequisite is an OpenConnector endpoint that authenticates the
selected existing connection and streams only `GET info/refs?service=git-upload-pack`
and `POST git-upload-pack` for one exact repository. It must reject pushes,
redirects to unapproved origins, credential-bearing client headers, and
unbounded request or response bodies. The Computer will call a virtual Git
hostname; OpenMeld's host gateway will enforce the operation's repository and
expiry, then relay to this endpoint. No connector or GitHub token will be
placed in a Computer environment variable, Git config, or remote URL.

After that endpoint exists, the separate end-to-end prototype still needs an
isolated-lane clone of an OpenMeld-sized private repository, an interrupted
fetch and resume, transfer-byte and elapsed-time measurements, and comparison
of the fetched source/default commit trees with the independently authorized
metadata before producing the existing synthetic working copy. This branch is
not ready to merge or deploy.
