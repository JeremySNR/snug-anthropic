import { get_encoding, type Tiktoken } from 'tiktoken';
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
  /**
   * Messages that fit, in original order, always starting with a user
   * message. Pass directly to the Anthropic SDK.
   */
  messages: MessageParam[];
  /** Estimated tokens in `messages`. See the README: counts are approximate. */
  tokensUsed: number;
  tokensRemaining: number;
  /** Messages that were dropped, in original order. */
  dropped: MessageParam[];
}

/**
 * Rough per-message allowance for the framing Anthropic adds around each
 * message (role markers and separators). Anthropic does not publish this
 * figure; four tokens is a conservative guess carried over from OpenAI's
 * chat-format heuristic. Together with the tiktoken text count it makes the
 * total an estimate, not an exact Claude token count.
 */
const APPROX_MESSAGE_OVERHEAD = 4;

/**
 * Anthropic does not publish a tokenizer library for Claude, so text is
 * counted with tiktoken's cl100k_base encoding as an approximation. The
 * encoder is a WASM object that is expensive to construct, so one is created
 * and kept for the life of the module. Call freeEncoder() to release it.
 */
let encoder: Tiktoken | undefined;

function getEncoder(): Tiktoken {
  if (!encoder) encoder = get_encoding('cl100k_base');
  return encoder;
}

/**
 * Release the cached tiktoken encoder and the WASM memory behind it.
 * The next call to fitMessages() will create it again.
 */
export function freeEncoder(): void {
  encoder?.free();
  encoder = undefined;
}

/** Alias of freeEncoder(), matching the name used by the other snug packages. */
export const freeEncoders = freeEncoder;

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

interface MessageItem {
  id: string;
  content: MessageParam;
  tokens: number;
  priority: number;
  pairId?: string;
}

/**
 * Fit an array of Anthropic messages into a token budget.
 *
 * tool_use and tool_result message pairs are automatically linked: if one
 * half does not fit, both are dropped, preventing the 400 errors caused by
 * unpaired tool messages.
 *
 * Messages are prioritised by recency. Because the oldest messages drop
 * first, trimming can leave the survivors starting with an assistant turn,
 * which the Anthropic API rejects (the first message must be from the user).
 * Any leading assistant messages, and the tool_result paired with a leading
 * tool_use, are therefore moved into `dropped` as well, so the result is
 * ready to pass directly to client.messages.create.
 *
 * Token counts are estimates (tiktoken plus a per-message allowance), not
 * exact Claude counts. See the README.
 */
export function fitMessages(
  messages: MessageParam[],
  options: FitMessagesOptions,
): FitMessagesResult {
  const enc = getEncoder();
  const tokenizer = (text: string) => enc.encode(text).length;

  const toolUseIndex = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const id = getToolUseId(messages[i]);
    if (id) toolUseIndex.set(id, i);
  }

  const items: MessageItem[] = messages.map((msg, i) => ({
    id: String(i),
    content: msg,
    tokens: tokenizer(messageToText(msg)) + APPROX_MESSAGE_OVERHEAD,
    priority: i,
  }));

  for (let i = 0; i < messages.length; i++) {
    const toolResultId = getToolResultId(messages[i]);
    if (!toolResultId) continue;
    const useIndex = toolUseIndex.get(toolResultId);
    if (useIndex === undefined) continue;
    const pairId = `tool-pair-${toolResultId}`;
    items[i].pairId = pairId;
    items[useIndex].pairId = pairId;
    items[useIndex].priority = items[i].priority;
  }

  const result = fit(items, {
    budget: options.budget,
    reserve: options.reserve,
    suppressApproximationWarning: true,
  });

  // The API requires the first message to be from the user. Drop leading
  // assistant messages (and anything paired with them) until that holds.
  const included = [...result.included];
  const extraDroppedIds = new Set<string>();
  let tokensUsed = result.tokensUsed;

  while (included.length > 0 && included[0].content.role === 'assistant') {
    const head = included[0];
    const doomed = head.pairId
      ? included.filter(item => item.pairId === head.pairId)
      : [head];
    for (const item of doomed) {
      extraDroppedIds.add(item.id);
      tokensUsed -= item.tokens;
    }
    for (let i = included.length - 1; i >= 0; i--) {
      if (extraDroppedIds.has(included[i].id)) included.splice(i, 1);
    }
  }

  const includedIds = new Set(included.map(item => item.id));
  const effectiveBudget = options.budget - (options.reserve ?? 0);

  return {
    messages: included.map(item => item.content),
    tokensUsed,
    tokensRemaining: effectiveBudget - tokensUsed,
    dropped: items.filter(item => !includedIds.has(item.id)).map(item => item.content),
  };
}
