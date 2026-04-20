import React from 'react';
import { renderMarkdown } from '../../constants';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  if (!content) return null;

  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-foreground/90 break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}

// ─── Markdown Toolbar ────────────────────────────────────────

interface MarkdownToolbarProps {
  onInsert: (text: string) => void;
  className?: string;
}

export function MarkdownToolbar({ onInsert, className = '' }: MarkdownToolbarProps) {
  const tools = [
    { label: 'Bold', icon: 'B', action: () => onInsert('**bold**'), className: 'font-bold' },
    { label: 'Italic', icon: 'I', action: () => onInsert('*italic*'), className: 'italic' },
    { label: 'Code', icon: '</>', action: () => onInsert('`code`'), className: 'font-mono text-xs' },
    { label: 'Link', icon: '[ ]', action: () => onInsert('[link](url)'), className: 'text-xs' },
    { label: 'List', icon: '-', action: () => onInsert('- item'), className: 'text-xs' },
    { label: 'Heading', icon: 'H', action: () => onInsert('## heading'), className: 'font-bold text-xs' },
    { label: 'Quote', icon: '>', action: () => onInsert('> quote'), className: 'text-xs' },
  ];

  return (
    <div className={`flex flex-wrap items-center gap-0.5 rounded-t-lg border border-b-0 border-border bg-surface-2 px-2 py-1 ${className}`}>
      {tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          onClick={tool.action}
          title={tool.label}
          className={`flex h-7 w-7 items-center justify-center rounded text-xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground ${tool.className}`}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}

// ─── Markdown with Character Count ──────────────────────────

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  showToolbar?: boolean;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Write content... (supports markdown)',
  rows = 4,
  maxLength = 5000,
  showToolbar = true,
  className = '',
}: MarkdownEditorProps) {
  const handleInsert = (text: string) => {
    const textarea = document.activeElement as HTMLTextAreaElement | null;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = value.substring(0, start) + text + value.substring(end);
      onChange(newValue);
      // Set cursor position after inserted text
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
      });
    } else {
      onChange(value + text);
    }
  };

  return (
    <div className={className}>
      {showToolbar && <MarkdownToolbar onInsert={handleInsert} />}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className="w-full rounded-b-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 resize-y placeholder:text-muted-foreground/50"
      />
      <div className="flex items-center justify-end px-1 pt-1">
        <span className={`text-xs ${value.length > maxLength * 0.9 ? 'text-danger' : 'text-muted-foreground'}`}>
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
