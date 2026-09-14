---
id: staged-service-receiver-releases
title: Stage Service receivers before signed CLI releases
kind: fixed
areas: ["releases"]
audiences: ["operators"]
---

Cloud receiver deployments can retain the current published CLI version while
a signed CLI release is prepared separately. This lets new Service transport
capabilities reach the cloud before updated local clients, with the existing
channel, tag, and deployment checks intact.
