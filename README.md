# @jeremysnr/snug-anthropic

[![npm](https://img.shields.io/npm/v/@jeremysnr/snug-anthropic)](https://www.npmjs.com/package/@jeremysnr/snug-anthropic)
[![license](https://img.shields.io/npm/l/@jeremysnr/snug-anthropic)](./LICENSE)

Fit Anthropic messages into a token budget. Automatically handles `tool_use`/`tool_result` pairing so you never get a 400 error from an orphaned tool message.

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

Messages are prioritised by recency — older messages are dropped first. `tool_use` and `tool_result` pairs are kept together automatically; if one half doesn't fit, both are dropped.

## Install

```
npm install @jeremysnr/snug-anthropic
```

`@anthropic-ai/sdk` must be installed as a peer dependency.

## API

### `fitMessages(messages, options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `budget` | `number` | — | Token limit |
| `reserve` | `number` | `0` | Tokens to hold back for the model's reply |

**Returns**

```ts
{
  messages: MessageParam[];  // ready to send
  dropped: MessageParam[];   // what didn't fit
  tokensUsed: number;
  tokensRemaining: number;
}
```

## Part of the snug ecosystem

- [`@jeremysnr/snug`](https://github.com/JeremySNR/snug) — zero-dependency core primitive
- [`@jeremysnr/snug-tiktoken`](https://github.com/JeremySNR/snug-tiktoken) — snug with tiktoken, model-agnostic
- [`@jeremysnr/snug-openai`](https://github.com/JeremySNR/snug-openai) — snug for the OpenAI SDK

## Licence

MIT
