# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-02

### Added

- `freeEncoder()` (and the alias `freeEncoders()`) to release the cached tiktoken encoder and its WASM memory.
- `CHANGELOG.md` and a GitHub Actions CI workflow (test and build on Node 20).
- `homepage`, `bugs`, `sideEffects: false` and `engines.node >= 18` in `package.json`.

### Fixed

- The returned `messages` array now always starts with a user message. Because messages are prioritised by recency, dropping the oldest user turn could leave an assistant message first, which the Anthropic API rejects even though the README said the result could be passed straight to `client.messages.create`. Leading assistant messages (and the `tool_result` paired with a leading `tool_use`) are now moved into `dropped`, and `tokensUsed` and `tokensRemaining` are adjusted to match.

### Changed

- The encoder is cached for the life of the module instead of being created and freed on every `fitMessages()` call.
- `MESSAGE_OVERHEAD` is renamed `APPROX_MESSAGE_OVERHEAD` and documented as a rough per-message allowance. The README no longer implies exact Anthropic token counts: counts are tiktoken estimates, and the `count_tokens` endpoint is the route to exact figures.
- Accepts `@jeremysnr/snug` 0.1.x or 0.2.x (`>=0.1.0 <0.3.0`). Nothing here needs the 0.2.0 additions yet.

## [0.1.1] - 2026-04-06

Initial release, published to npm as `@jeremysnr/snug-anthropic`. The repository history begins at this version.

### Added

- `fitMessages(messages, options)` for Anthropic `MessageParam[]`: messages prioritised by recency, `tool_use`/`tool_result` pairs kept or dropped together.

[Unreleased]: https://github.com/JeremySNR/snug-anthropic/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/JeremySNR/snug-anthropic/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/JeremySNR/snug-anthropic/releases/tag/v0.1.1
