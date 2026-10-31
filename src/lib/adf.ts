export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

export interface AdfDoc {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

export function textToAdf(text?: string | null): AdfDoc {
  if (!text || !text.trim()) {
    return {
      version: 1,
      type: 'doc',
      content: [],
    };
  }

  const lines = text.split(/\r?\n/);
  const content: AdfNode[] = [];

  let currentParagraphLines: string[] = [];
  let currentListItems: string[] = [];

  function flushParagraph() {
    if (currentParagraphLines.length === 0) return;
    const inlineNodes: AdfNode[] = [];
    currentParagraphLines.forEach((line, idx) => {
      if (idx > 0) {
        inlineNodes.push({ type: 'hardBreak' });
      }
      inlineNodes.push({ type: 'text', text: line });
    });
    content.push({
      type: 'paragraph',
      content: inlineNodes,
    });
    currentParagraphLines = [];
  }

  function flushList() {
    if (currentListItems.length === 0) return;
    const listItems: AdfNode[] = currentListItems.map((itemText) => ({
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: itemText }],
        },
      ],
    }));
    content.push({
      type: 'bulletList',
      content: listItems,
    });
    currentListItems = [];
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      // Blank line closes current block
      flushParagraph();
      flushList();
      continue;
    }

    const isBullet = /^[•\-*]\s+(.*)$/.exec(trimmed);

    if (isBullet) {
      flushParagraph();
      currentListItems.push(isBullet[1]);
    } else {
      flushList();
      currentParagraphLines.push(rawLine);
    }
  }

  flushParagraph();
  flushList();

  return {
    version: 1,
    type: 'doc',
    content,
  };
}
