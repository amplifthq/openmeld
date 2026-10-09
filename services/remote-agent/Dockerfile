# The Center Agent computer's container backend: computerd mounts the
# AgentComputer workspace over FUSE at /computer, so heavy shell work
# (python, git, real binaries) sees the same durable file world as the
# worker-shell and worker-javascript isolates — one file world, three engines. Image pattern
# follows cloudflare/computer examples/container.
FROM node:22.22.3-bookworm-slim@sha256:16d364eebf6b62da439dc993d9b80940c78b0ca38438452f011ab9a25c752644 AS computerd

# The Worker package and native daemon apply the same ordered-source patch.
# Keep the official release source and dependency lock; build its native SEA
# rather than changing a precompiled executable or adding a second filesystem.
ADD --checksum=sha256:5e6edfdc33a15326a7aaa60382ff52931b09fe10080205b12ed5f0decaf04341 \
    https://codeload.github.com/cloudflare/computer/tar.gz/070359ff2db12442845bfce84512ec9beae35cdf \
    /tmp/computer-source.tar.gz
WORKDIR /computer-source
RUN tar -xzf /tmp/computer-source.tar.gz --strip-components=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends patch \
 && npm ci --ignore-scripts \
      --workspace @cloudflare/dofs \
      --workspace @cloudflare/computer-rpc \
      --workspace @cloudflare/computerd \
      --include-workspace-root=true
COPY computerd/upstream.patch ./openmeld-source.patch
COPY computerd/build.mjs ./openmeld-build.mjs
RUN patch -p1 < openmeld-source.patch \
 && npm run build --workspace @cloudflare/computer-rpc \
 && npm run build --workspace @cloudflare/computerd \
 && node openmeld-build.mjs

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

COPY --from=computerd /computer-source/artifacts/computerd/computerd /usr/local/bin/computerd
COPY --from=computerd /computer-source/artifacts/computerd/source.json /usr/local/share/openmeld/computerd-source.json

ENV PORT=8080
ENV MOUNT_POINT=/computer
ENV FUSE_MOUNT=auto
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/computerd"]
