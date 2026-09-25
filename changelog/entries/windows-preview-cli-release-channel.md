---
id: windows-preview-cli-release-channel
title: Keep Windows preview CLI updates on their release channel
kind: fixed
areas: ["cli", "windows"]
audiences: ["windows-preview-users"]
---

After installing the internal Windows preview from Web, later CLI update checks
and upgrades continue to use the Windows preview channel. A stable release for
another platform no longer incorrectly sets the preview CLI's update requirement.
