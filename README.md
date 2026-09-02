# @jeremysnr/snug-anthropic

[![npm](https://img.shields.io/npm/v/@jeremysnr/snug-anthropic)](https://www.npmjs.com/package/@jeremysnr/snug-anthropic)
[![license](https://img.shields.io/npm/l/@jeremysnr/snug-anthropic)](./LICENSE)

Fit Anthropic messages into a token budget. Automatically handles `tool_use`/`tool_result` pairing so you never get a 400 error from an orphaned tool message, and guarantees the trimmed conversation still starts with a user message.

```ts
import { fitMessages } from '@jeremysnr/snug-anthropic';

const { messages } = fitMessages(conversationHistory, {
  budget: 100000,
  reserve: 4096,
});

const response = await client.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 4096,
  messages,
});
```

Messages are prioritised by recency, so older messages are dropped first. `tool_use` and `tool_result` pairs are kept together automatically; if one half does not fit, both are dropped.

## Valid conversation shape

The Anthropic API requires the first message to come from the user. Because the oldest messages are dropped first, trimming can leave an assistant turn at the front of the list. `fitMessages` checks for this after fitting and moves any leading assistant messages (together with the `tool_result` paired to a leading `tool_use`) into `dropped`, adjusting `tokensUsed` and `tokensRemaining` to match. The `messages` array is therefore always safe to pass to `client.messages.create`.

## Token counts are approximate

Anthropic does not publish a tokenizer library for Claude. This package counts each message's text with tiktoken's `cl100k_base` encoding and adds a rough four-token allowance per message for role framing. The result is an estimate that is usually within a modest margin of the real count, but it is not exact, and non-text content (images, documents) is not counted at all.

If you need exact numbers, call the [count_tokens endpoint](https://docs.anthropic.com/en/api/messages-count-tokens) (`client.messages.countTokens(...)`) and use [`@jeremysnr/snug`](https://github.com/JeremySNR/snug) directly with the `tokens` field. Otherwise keep a `reserve` large enough to absorb the estimation error.

## Install

```
npm install @jeremysnr/snug-anthropic
```

`@anthropic-ai/sdk` must be installed as a peer dependency.

## API

### `fitMessages(messages, options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `budget` | `number` | (required) | Token limit |
| `reserve` | `number` | `0` | Tokens to hold back for the model's reply |

**Returns**

```ts
{
  messages: MessageParam[];  // ready to send, always starts with a user message
  dropped: MessageParam[];   // what didn't fit, in original order
  tokensUsed: number;        // estimated
  tokensRemaining: number;   // estimated
}
```

### `freeEncoder()`

The tiktoken encoder is a WASM object and is slow to construct, so this package creates it once and keeps it for the life of the process. Call `freeEncoder()` to release that memory; the next `fitMessages()` recreates it. `freeEncoders` is exported as an alias to match the other snug packages.

## Part of the snug ecosystem

- [`@jeremysnr/snug`](https://github.com/JeremySNR/snug), zero-dependency core primitive
- [`@jeremysnr/snug-tiktoken`](https://github.com/JeremySNR/snug-tiktoken), snug with tiktoken for OpenAI encodings
- [`@jeremysnr/snug-openai`](https://github.com/JeremySNR/snug-openai), snug for the OpenAI SDK

## Licence

MIT
