---
id: space-image-loading-without-webgl
title: Load Space images when WebGL is unavailable
kind: fixed
areas: ["spaces", "web"]
audiences: ["users"]
---

When a browser cannot start the image loading animation, Space messages
keep a static placeholder while the image loads. Other images on the same
page no longer retry the unavailable animation.
