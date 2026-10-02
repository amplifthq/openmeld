---
id: center-agent-space-image-history
title: Center Agent can inspect earlier Space images
kind: improved
areas: ["center-agent", "spaces"]
audiences: ["members"]
---

Center Agent can describe a JPEG or PNG shared earlier in a Space by choosing
its exact file version. It checks current Space access and uses a separate
image model to create a text description, so the main conversation does not
retain the image bytes. If image reading fails, the Agent gets an explicit
error instead of an invented description.
