# Extract Jev as a reusable package

Objective: Publish a private, standalone Bun/TypeScript Jev package at `ogarciarevett/jev-sdk` without changing the source repository.

Problem: Jev currently lives inside Edel scripts and references repository-specific paths, question packs, and sanitizer code.

Scope: Port generic runtime, CLI binaries, MCP server, stop hook, masking, tests, skill, and generic question packs. Document consumer migration but do not perform it.

Constraints: No secrets, Party IDs, connection strings, private logs or `.env` files in tracked files. Source checkout is read-only. TypeSafe key comes from consumer environment only.

TDD: enabled by user-provided instructions; runner `bun test`; RED → GREEN → REFACTOR.

Delivery strategy: ask-on-risk; forecast exceeds 400 authored lines because existing runtime and tests are being extracted, but no pull request is requested. Remote operation explicitly authorized only for creating and pushing `ogarciarevett/jev-sdk`.

- [x] J1 Port generic runtime and CLI with consumer-relative configuration and tests. Acceptance: `bun test` 326 passed, 0 failed; `bunx tsc --noEmit` passed. Commit: `9182b6c`.
- [ ] J2 Package skill, generic packs and README; scrub and audit all tracked content. Acceptance: installation/judge example, no source-specific paths or sensitive data. Evidence: pending.
- [ ] J3 Commit and publish the private repository; verify GitHub visibility. Acceptance: `gh repo view` reports PRIVATE. Evidence: pending.

Next step: Audit packaged documentation and the staged content, then publish privately.
