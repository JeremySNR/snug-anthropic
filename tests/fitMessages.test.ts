import { fitMessages } from '../src/index.js';
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
});
