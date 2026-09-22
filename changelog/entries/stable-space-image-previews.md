---
id: stable-space-image-previews
title: Keep image previews steady while sending and loading
kind: fixed
areas: ["spaces", "files", "web"]
audiences: ["users"]
evidence: ["pr:1200"]
---

Images keep their original preview through sending, retries, and message
confirmation, including when a full-size preview is already open. Loading and
error states reserve the same space, and long screenshots remain fully visible
in multi-image messages.

Cold images use a loading effect only while visible, with static fallbacks for
reduced motion or unavailable graphics. Failed images offer an explicit retry.
Private image resources are released when access is revoked.
