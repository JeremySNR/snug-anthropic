import { fitMessages, freeEncoder, freeEncoders } from '../src/index.js';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';

const user = (content: string): MessageParam => ({ role: 'user', content });
const assistant = (content: string): MessageParam => ({ role: 'assistant', content });

describe('fitMessages (anthropic)', () => {
  test('returns all messages when they fit', () => {
    const result = fitMessages(
      [user('hello'), assistant('hi'), user('how are you?')],
      { budget: 200 },
    );
    expect(result.messages).toHaveLength(3);
    expect(result.dropped).toHaveLength(0);
  });

  test('drops oldest messages first when budget is very tight', () => {
    const messages: MessageParam[] = [
      user('first'),
      assistant('reply'),
      user('second'),
      assistant('reply two'),
      user('final'),
    ];
    // budget of 25 — fits ~2 short messages; should drop oldest first
    const result = fitMessages(messages, { budget: 25 });
    expect(result.dropped.length).toBeGreaterThan(0);
    const droppedContents = result.dropped.map(m => m.content);
    const includedContents = result.messages.map(m => m.content);
    // 'first' should drop before 'final'
    if (droppedContents.includes('final')) {
      expect(droppedContents).toContain('first');
    } else {
      expect(includedContents).toContain('final');
    }
  });

  test('respects reserve', () => {
    const result = fitMessages([user('hello')], { budget: 100, reserve: 50 });
    expect(result.tokensUsed).toBeLessThanOrEqual(50);
  });

  test('keeps tool_use and tool_result together', () => {
    const messages: MessageParam[] = [
      user('old message one'),
      assistant('old reply one'),
      user('old message two'),
      // tool pair
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-abc', name: 'search', input: { q: 'test' } }],
      } as unknown as MessageParam,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-abc', content: 'result text' }],
      } as unknown as MessageParam,
      user('final question'),
    ];

    // tight budget — forces drops, but pair must stay together
    const result = fitMessages(messages, { budget: 80 });

    const ids = result.messages.map((_, i) => i);
    const includedContents = result.messages.map(m => m.content);
    const droppedContents = result.dropped.map(m => m.content);

    const toolUseIncluded = includedContents.some(
      c => Array.isArray(c) && c.some((b: any) => b.type === 'tool_use'),
    );
    const toolResultIncluded = includedContents.some(
      c => Array.isArray(c) && c.some((b: any) => b.type === 'tool_result'),
    );
    const toolUseDropped = droppedContents.some(
      c => Array.isArray(c) && c.some((b: any) => b.type === 'tool_use'),
    );
    const toolResultDropped = droppedContents.some(
      c => Array.isArray(c) && c.some((b: any) => b.type === 'tool_result'),
    );

    // both included or both dropped — never split
    expect(toolUseIncluded).toBe(toolResultIncluded);
    expect(toolUseDropped).toBe(toolResultDropped);
    void ids;
  });

  test('result messages are in original order', () => {
    const messages: MessageParam[] = [user('one'), assistant('two'), user('three')];
    const result = fitMessages(messages, { budget: 200 });
    expect(result.messages.map(m => m.content)).toEqual(['one', 'two', 'three']);
  });

  test('never returns a list that starts with an assistant message', () => {
    // The mocked tokenizer counts one token per character plus 4 per message.
    // user('first') = 9, assistant('reply') = 9, user('final') = 9. A budget of
    // 18 fits exactly two messages, so recency keeps 'reply' and 'final' and
    // drops 'first', which would leave an assistant message at the front.
    const messages: MessageParam[] = [user('first'), assistant('reply'), user('final')];
    const result = fitMessages(messages, { budget: 18 });

    expect(result.messages[0].role).toBe('user');
    expect(result.messages.map(m => m.content)).toEqual(['final']);
    expect(result.dropped.map(m => m.content)).toEqual(['first', 'reply']);
    // tokens are adjusted for the extra drop
    expect(result.tokensUsed).toBe(9);
    expect(result.tokensRemaining).toBe(9);
  });

  test('drops several leading assistant messages if needed', () => {
    const messages: MessageParam[] = [
      user('a'),
      assistant('b'),
      assistant('c'),
      user('d'),
    ];
    // 5 tokens each; budget 15 fits three, dropping 'a'
    const result = fitMessages(messages, { budget: 15 });
    expect(result.messages.map(m => m.content)).toEqual(['d']);
    expect(result.dropped.map(m => m.content)).toEqual(['a', 'b', 'c']);
    expect(result.tokensUsed).toBe(5);
  });

  test('returns an empty list when only assistant messages would survive', () => {
    const messages: MessageParam[] = [user('long user message'), assistant('ok')];
    // 'ok' = 6 tokens, 'long user message' = 21; budget 10 fits only 'ok'
    const result = fitMessages(messages, { budget: 10 });
    expect(result.messages).toEqual([]);
    expect(result.dropped).toHaveLength(2);
    expect(result.tokensUsed).toBe(0);
    expect(result.tokensRemaining).toBe(10);
  });

  test('a leading tool_use takes its paired tool_result with it', () => {
    const toolUse: MessageParam = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'x' } }],
    } as unknown as MessageParam;
    const toolResult: MessageParam = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'found' }],
    } as unknown as MessageParam;
    // user('please search') = 17, toolUse = JSON '{"q":"x"}' 9 + 4 = 13,
    // toolResult = 5 + 4 = 9, user('thanks') = 10. Budget 32 fits the pair
    // (22) and 'thanks' (10) but not 'please search', leaving tool_use first.
    const result = fitMessages([user('please search'), toolUse, toolResult, user('thanks')], {
      budget: 32,
    });
    expect(result.messages.map(m => m.content)).toEqual(['thanks']);
    expect(result.dropped).toHaveLength(3);
    // the tool_result must not survive without its tool_use
    const orphan = result.messages.some(
      m => Array.isArray(m.content) && (m.content as any[]).some(b => b.type === 'tool_result'),
    );
    expect(orphan).toBe(false);
    expect(result.tokensUsed).toBe(10);
  });

  test('keeps a tool_use/tool_result pair together when it fits', () => {
    const toolUse: MessageParam = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't2', name: 'search', input: { q: 'x' } }],
    } as unknown as MessageParam;
    const toolResult: MessageParam = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't2', content: 'found' }],
    } as unknown as MessageParam;
    const result = fitMessages([user('old'), user('search'), toolUse, toolResult, user('ok')], {
      budget: 42,
    });
    // 'old' (7) drops; 'search' (10) + pair (22) + 'ok' (6) = 38 fits
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].content).toBe('search');
    expect(result.messages[1]).toBe(toolUse);
    expect(result.messages[2]).toBe(toolResult);
    expect(result.dropped.map(m => m.content)).toEqual(['old']);
  });

  test('drops a tool_use/tool_result pair together when it does not fit', () => {
    const toolUse: MessageParam = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't3', name: 'search', input: { q: 'a'.repeat(40) } }],
    } as unknown as MessageParam;
    const toolResult: MessageParam = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't3', content: 'b'.repeat(40) }],
    } as unknown as MessageParam;
    const result = fitMessages([user('search'), toolUse, toolResult, user('ok')], {
      budget: 30,
    });
    expect(result.messages.map(m => m.content)).toEqual(['search', 'ok']);
    expect(result.dropped).toEqual([toolUse, toolResult]);
  });

  test('freeEncoder releases the cache and fitMessages still works afterwards', () => {
    const before = fitMessages([user('hello')], { budget: 100 });
    expect(() => freeEncoder()).not.toThrow();
    expect(() => freeEncoders()).not.toThrow();
    const after = fitMessages([user('hello')], { budget: 100 });
    expect(after.tokensUsed).toBe(before.tokensUsed);
  });
});
