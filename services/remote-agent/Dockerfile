# The Center Agent computer's container backend: computerd mounts the
# AgentComputer workspace over FUSE at /computer, so heavy shell work
# (python, git, real binaries) sees the same durable file world as the
# worker-shell and worker-javascript isolates — one file world, three engines. Image pattern
# follows cloudflare/computer examples/container.
FROM ghcr.io/cloudflare/computer-computerd-linux-x64:0.4.1 AS computerd

FROM node:24-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fuse3 libfuse2t64 ca-certificates \
      git curl jq python3 tini build-essential ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Match the repository's supported Node and pnpm majors in the cloud Computer.
# Corepack keeps pnpm pinned to each checked-out repository's packageManager.
RUN corepack prepare pnpm@10.30.0 --activate \
 && corepack enable

COPY --from=computerd /usr/local/bin/computerd /usr/local/bin/computerd

ENV PORT=8080
ENV MOUNT_POINT=/computer
ENV FUSE_MOUNT=auto
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/computerd"]
