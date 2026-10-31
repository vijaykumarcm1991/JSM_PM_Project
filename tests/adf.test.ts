import { describe, it, expect } from 'vitest';
import { textToAdf } from '../src/lib/adf';

describe('ADF Converter', () => {
  it('handles empty / null input', () => {
    expect(textToAdf(null)).toEqual({ version: 1, type: 'doc', content: [] });
    expect(textToAdf('')).toEqual({ version: 1, type: 'doc', content: [] });
    expect(textToAdf('   ')).toEqual({ version: 1, type: 'doc', content: [] });
  });

  it('converts plain paragraphs with hard breaks', () => {
    const text = 'Line 1\nLine 2';
    const adf = textToAdf(text);

    expect(adf).toEqual({
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line 1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line 2' },
          ],
        },
      ],
    });
  });

  it('converts bullet points into bulletList', () => {
    const text = 'Notes:\n- Bullet one\n• Bullet two';
    const adf = textToAdf(text);

    expect(adf.content).toHaveLength(2);
    expect(adf.content[0].type).toBe('paragraph');
    expect(adf.content[1].type).toBe('bulletList');
    expect(adf.content[1].content).toHaveLength(2);
    expect(adf.content[1].content![0]).toEqual({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet one' }] }],
    });
  });

  it('closes blocks on blank lines', () => {
    const text = 'Block 1\n\nBlock 2';
    const adf = textToAdf(text);

    expect(adf.content).toHaveLength(2);
    expect(adf.content[0].type).toBe('paragraph');
    expect(adf.content[1].type).toBe('paragraph');
  });
});
