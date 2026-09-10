---
id: required-release-stamp-consistency
title: Keep required-update releases reproducible
kind: fixed
areas: ["developer-workflow"]
audiences: ["contributors"]
---

Release stamping now writes the required CLI version before building the package.
Required updates retain a matching bundle hash when release checks rebuild them.
The `stamp` and `require` commands share this path and restore metadata if it fails.
