import DOMPurify from 'dompurify';
import { cn } from '../../../plugin-ui';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Simple regex-based markdown renderer.
 * Supports: headers, bold, italic, code blocks, inline code,
 * links, lists, blockquotes, horizontal rules, tables.
 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const html = renderMarkdown(content);
  return (
    <div
      className={cn('markdown-body text-sm leading-relaxed text-foreground', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── Sanitization ──

function sanitize(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'a', 'del', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span'], ALLOWED_ATTR: ['href', 'target', 'rel', 'class'] });
}

// ── Rendering ──

function renderMarkdown(markdown: string): string {
  // Normalize line endings
  let text = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Store code blocks so they aren't affected by other transforms
  const codeBlocks: string[] = [];
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length;
    const escaped = escapeHtml(code.trimEnd());
    const langLabel = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    codeBlocks.push(`<pre${langLabel}><code>${escaped}</code></pre>`);
    return `%%CODEBLOCK_${index}%%`;
  });

  // Store inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code class="inline-code rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">${escapeHtml(code)}</code>`);
    return `%%INLINECODE_${index}%%`;
  });

  // Process line-by-line for block-level elements
  const lines = text.split('\n');
  const output: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;
  let inTable = false;
  let tableHeader = false;

  function closeList() {
    if (inList && listType) {
      output.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
      listType = null;
    }
  }

  function closeTable() {
    if (inTable) {
      output.push('</tbody></table></div>');
      inTable = false;
      tableHeader = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Code block placeholder
    if (/^%%CODEBLOCK_\d+%%$/.test(line)) {
      closeList();
      closeTable();
      const idx = parseInt(line.match(/\d+/)![0]);
      output.push(`<div class="my-3 overflow-x-auto rounded-lg border border-border">${codeBlocks[idx]}</div>`);
      continue;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      closeTable();
      output.push('<hr class="my-4 border-border" />');
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      closeList();
      closeTable();
      const level = headerMatch[1].length;
      const sizeClasses: Record<number, string> = {
        1: 'text-xl font-bold',
        2: 'text-lg font-bold',
        3: 'text-base font-semibold',
        4: 'text-sm font-semibold',
        5: 'text-sm font-medium',
        6: 'text-xs font-medium',
      };
      output.push(
        `<h${level} class="my-3 ${sizeClasses[level] ?? ''} text-foreground">${renderInline(headerMatch[2])}</h${level}>`,
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      closeList();
      closeTable();
      output.push(
        `<blockquote class="my-2 border-l-2 border-primary/30 pl-3 text-muted-foreground italic">${renderInline(line.slice(2))}</blockquote>`,
      );
      continue;
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHeader = true;
        output.push('<div class="my-3 overflow-x-auto rounded-lg border border-border"><table class="w-full text-xs"><thead>');
      }

      const cells = line.split('|').filter((c) => c.trim() !== '');

      if (tableHeader) {
        // Check if next line is separator
        const nextLine = lines[i + 1];
        if (nextLine && /^\|?\s*[-:]+[-|\s:]*$/.test(nextLine)) {
          output.push(
            '<tr>' +
              cells.map((c) => `<th class="border-b border-border bg-surface-2 px-3 py-2 text-left font-semibold text-foreground">${renderInline(c.trim())}</th>`).join('') +
              '</tr>',
          );
          output.push('</thead><tbody>');
          tableHeader = false;
          i++; // skip separator line
          continue;
        } else {
          // Not a proper table
          closeTable();
          output.push(`<p class="my-1">${renderInline(line)}</p>`);
          continue;
        }
      } else {
        output.push(
          '<tr>' +
            cells.map((c) => `<td class="border-b border-border px-3 py-2 text-muted-foreground">${renderInline(c.trim())}</td>`).join('') +
            '</tr>',
        );
        continue;
      }
    } else if (inTable) {
      closeTable();
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      closeTable();
      if (!inList || listType !== 'ul') {
        closeList();
        output.push('<ul class="my-2 list-disc space-y-1 pl-6">');
        inList = true;
        listType = 'ul';
      }
      output.push(`<li class="text-foreground">${renderInline(ulMatch[2])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      closeTable();
      if (!inList || listType !== 'ol') {
        closeList();
        output.push('<ol class="my-2 list-decimal space-y-1 pl-6">');
        inList = true;
        listType = 'ol';
      }
      output.push(`<li class="text-foreground">${renderInline(olMatch[2])}</li>`);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      closeList();
      continue;
    }

    // Paragraph
    closeList();
    closeTable();
    output.push(`<p class="my-1">${renderInline(line)}</p>`);
  }

  closeList();
  closeTable();

  // Restore inline code
  let result = output.join('\n');
  inlineCodes.forEach((code, i) => {
    result = result.replace(`%%INLINECODE_${i}%%`, code);
  });

  return sanitize(result);
}

// ── Inline rendering ──

function renderInline(text: string): string {
  let result = escapeHtml(text);

  // Bold + italic (***text*** or ___text___)
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

  // Bold (**text** or __text__)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic (*text* or _text_)
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');

  // Links [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline hover:no-underline">$1</a>',
  );

  // Strikethrough ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<del class="text-muted-foreground">$1</del>');

  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
