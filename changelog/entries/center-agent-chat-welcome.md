---
id: center-agent-chat-welcome
title: Keep welcome greetings out of Center Agent chat history
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
publishedAt: 2026-10-03
release: v0.3.240
evidence: ["pr:1483", "commit:15549cc047d90f90edfbe2a1209919681a1e7e24", "commit:a76ffd7eb654e78ad0be127cea8deb944c18d10f", "commit:5f5ec1d00ab8dc7f6d7bf8e00a912cd03a93abb2"]
---

Opening or preparing a Center Agent chat no longer adds a template greeting to
the conversation. Starting guidance stays in the chat introduction, so an
existing conversation cannot receive a welcome message that looks like an
unsolicited Agent reply. Previous messages remain available.
