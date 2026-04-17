/**
 * Synchronous entry processor — main-thread fallback and shared logic.
 *
 * Uses ansi-to-html (fast, battle-tested) + DOMPurify for security.
 */

import AnsiToHtml from 'ansi-to-html';
import DOMPurify from 'dompurify';
import type { ProcessedEntry, RawEntry } from './types';

const ansiConverter = new AnsiToHtml({
  escapeXML: true,
  newline: true,
  stream: true,
});

const TIMESTAMP_RE = /^\s*(?:\\x07)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s*/;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type SyntaxRule = { pattern: RegExp; cls: string };

const syntaxRules: SyntaxRule[] = [
  { pattern: /\b(ERROR|FATAL|SEVERE|EXCEPTION|PANIC|FAIL(?:ED|URE)?)\b/gi, cls: 'chl-error' },
  { pattern: /\b(WARN(?:ING)?|CAUTION|DEPRECATED)\b/gi, cls: 'chl-warn' },
  { pattern: /\b(INFO|DEBUG|TRACE|NOTICE)\b/gi, cls: 'chl-info' },
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, cls: 'chl-uuid' },
  { pattern: /\b\d{1,2}:\d{2}(?::\d{2})(?:\.\d+)?\b/g, cls: 'chl-time' },
  { pattern: /\b\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/g, cls: 'chl-time' },
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, cls: 'chl-ip' },
  { pattern: /https?:\/\/[^\s)>\]]+/gi, cls: 'chl-url' },
];

function applySyntaxHighlighting(text: string): string {
  let result = text;
  for (const rule of syntaxRules) {
    result = result.replace(rule.pattern, (m) => `<span class="${rule.cls}">${m}</span>`);
  }
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSearch(text: string, query: string): string {
  if (!query) return text;
  const regex = new RegExp(escapeRegex(query), 'gi');
  return text.replace(regex, '<mark class="console-search-match">$&</mark>');
}

export function processEntry(entry: RawEntry, searchQuery: string): ProcessedEntry {
  let data = entry.data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!data.endsWith('\n') && !data.endsWith('\r')) data += '\n';

  const tsMatch = data.match(TIMESTAMP_RE);
  const displayTs = entry.timestamp ?? tsMatch?.[1];
  const cleaned = tsMatch ? data.replace(TIMESTAMP_RE, '') : data;
  const lines = cleaned.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));

  const htmlParts: string[] = [];
  for (const line of lines) {
    const display = line.length > 800 ? line.slice(0, 800) : line || ' ';
    let html = ansiConverter.toHtml(display);
    html = applySyntaxHighlighting(html);
    if (searchQuery) html = highlightSearch(html, searchQuery);
    html = DOMPurify.sanitize(html);
    htmlParts.push(html);
  }

  const rawText = htmlParts.join('').replace(/<[^>]*>/g, '');

  return {
    id: entry.id,
    stream: entry.stream,
    timestamp: displayTs ? formatTime(displayTs) : '',
    html: htmlParts.join(''),
    textLength: rawText.length,
  };
}
