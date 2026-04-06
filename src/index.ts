import { get_encoding } from 'tiktoken';
import { fit } from '@jeremysnr/snug';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';

export type { MessageParam };

export interface FitMessagesOptions {
  /** Token budget for the conversation. */
  budget: number;
  /** Tokens to reserve for the model's response. Defaults to 0. */
  reserve?: number;
}

export interface FitMessagesResult {
  /** Messages that fit, in original order. Pass directly to the Anthropic SDK. */
  messages: MessageParam[];
  tokensUsed: number;
  tokensRemaining: number;
  /** Messages that were dropped. */
  dropped: MessageParam[];
}

function messageToText(msg: MessageParam): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as unknown as Record<string, unknown>[])
      .map((block) => {
        if (block['type'] === 'text') return String(block['text'] ?? '');
        if (block['type'] === 'tool_use') return JSON.stringify(block['input'] ?? '');
        if (block['type'] === 'tool_result') {
          const c = block['content'];
          if (typeof c === 'string') return c;
          if (Array.isArray(c)) return (c as Record<string, unknown>[]).map(b => String(b['text'] ?? '')).join('');
        }
        return '';
      })
      .join('');
  }
  return '';
}

function getToolUseId(msg: MessageParam): string | undefined {
  if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return undefined;
  const block = (msg.content as unknown as Record<string, unknown>[]).find(b => b['type'] === 'tool_use');
  return block ? String(block['id'] ?? '') : undefined;
}

function getToolResultId(msg: MessageParam): string | undefined {
  if (msg.role !== 'user' || !Array.isArray(msg.content)) return undefined;
  const block = (msg.content as unknown as Record<string, unknown>[]).find(b => b['type'] === 'tool_result');
  return block ? String(block['tool_use_id'] ?? '') : undefined;
}

/**
 * Fit an array of Anthropic messages into a token budget.
 *
 * tool_use and tool_result message pairs are automatically linked — if one
 * half doesn't fit, both are dropped, preventing the 400 errors caused by
 * unpaired tool messages.
 *
 * Messages are prioritised by recency. The result is ready to pass directly
 * to client.messages.create.
 */
export function fitMessages(
  messages: MessageParam[],
  options: FitMessagesOptions,
): FitMessagesResult {
  const enc = get_encoding('cl100k_base');
  const MESSAGE_OVERHEAD = 4;

  try {
    const tokenizer = (text: string) => enc.encode(text).length;

    const toolUseIndex = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      const id = getToolUseId(messages[i]);
      if (id) toolUseIndex.set(id, i);
    }

    const items = messages.map((msg, i) => {
      const toolResultId = getToolResultId(msg);
      const pairedUseIndex = toolResultId ? toolUseIndex.get(toolResultId) : undefined;
      return {
        id: String(i),
        content: msg,
        tokens: tokenizer(messageToText(msg)) + MESSAGE_OVERHEAD,
        priority: i,
        pairId: toolResultId ? `tool-pair-${toolResultId}` : undefined,
        _pairedUseIndex: pairedUseIndex,
      };
    });

    for (const item of items) {
      if (item._pairedUseIndex !== undefined) {
        const useItem = items[item._pairedUseIndex];
        useItem.pairId = item.pairId;
        useItem.priority = item.priority;
      }
    }

    const result = fit(
      items.map(({ _pairedUseIndex: _, ...rest }) => rest),
      {
        budget: options.budget,
        reserve: options.reserve,
        suppressApproximationWarning: true,
      },
    );

    return {
      messages: result.included.map(i => i.content as MessageParam),
      tokensUsed: result.tokensUsed,
      tokensRemaining: result.tokensRemaining,
      dropped: result.excluded.map(i => i.content as MessageParam),
    };
  } finally {
    enc.free();
  }
}
