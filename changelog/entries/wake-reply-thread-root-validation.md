---
id: wake-reply-thread-root-validation
title: Keep Agent replies working when a discussion thread opens
kind: fixed
areas: ["agents", "spaces"]
audiences: ["members"]
---

Opening a discussion thread under a running Wake no longer moves its reply away
from the original conversation or causes a false latest-message read failure.
Replies still check for newer messages before appearing.
