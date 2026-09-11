---
id: wake-reply-thread-root-validation
title: Keep Agent replies working when a discussion thread opens
kind: fixed
areas: ["agents", "spaces"]
audiences: ["members"]
publishedAt: 2026-09-10
release: v0.3.193
evidence: ["pr:870", "pr:876", "commit:204b0e70b271ab69158f8e14a33d1d97b43cb880", "workflow:34434697090"]
---

Opening a discussion thread under a running Wake no longer moves its reply away
from the original conversation or causes a false latest-message read failure.
Replies still check for newer messages before appearing.
