/**
 * The editor's formatting toolbar, as a pure function: applies one Markdown format to the text at the selection and
 * returns the new text with the selection to restore. Line formats (heading, lists) work on every line the selection
 * touches and switch off when all of them already have it; inline formats wrap the selection, or insert a
 * placeholder (selected, so typing replaces it) when nothing is selected.
 */

export type MarkdownFormat = 'heading' | 'bold' | 'bulleted' | 'numbered' | 'link';

export interface TextEdit {
  value: string;
  /** Selection to restore. */
  start: number;
  end: number;
}

/** Placeholder words in the author's language. */
export interface FormatPlaceholders {
  heading: string;
  bold: string;
  link: string;
  /** What goes between the link's parentheses until the author types the address. */
  url: string;
}

const HEADING = /^#{1,6}\s+/;
const BULLET = /^[-*+]\s+/;
const NUMBER = /^\d+[.)]\s+/;

function lineBounds(value: string, start: number, end: number) {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  // A selection ending right after a newline doesn't include the next line.
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nl = value.indexOf('\n', last);
  return { from, to: nl === -1 ? value.length : nl };
}

function lineFormat(
  value: string,
  start: number,
  end: number,
  has: RegExp,
  strip: RegExp[],
  prefix: (i: number) => string,
  placeholder?: string,
): TextEdit {
  const { from, to } = lineBounds(value, start, end);
  const lines = value.slice(from, to).split('\n');
  const filled = lines.filter((l) => l.trim());
  // An empty line: start the format (with a placeholder for headings) and put the caret after it.
  if (!filled.length) {
    const head = prefix(0);
    const text = head + (placeholder ?? '');
    return {
      value: value.slice(0, from) + text + value.slice(to),
      start: from + head.length,
      end: from + text.length,
    };
  }
  const off = filled.every((l) => has.test(l));
  let n = 0;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    if (off) return line.replace(has, '');
    const bare = strip.reduce((l, re) => l.replace(re, ''), line);
    return prefix(n++) + bare;
  });
  const block = next.join('\n');
  return { value: value.slice(0, from) + block + value.slice(to), start: from, end: from + block.length };
}

export function applyMarkdownFormat(
  format: MarkdownFormat,
  value: string,
  start: number,
  end: number,
  text: FormatPlaceholders,
): TextEdit {
  const s = Math.max(0, Math.min(start, end, value.length));
  const e = Math.min(Math.max(start, end), value.length);
  const selected = value.slice(s, e);
  switch (format) {
    case 'heading':
      return lineFormat(value, s, e, HEADING, [HEADING, BULLET, NUMBER], () => '## ', text.heading);
    case 'bulleted':
      return lineFormat(value, s, e, BULLET, [BULLET, NUMBER], () => '- ');
    case 'numbered':
      return lineFormat(value, s, e, NUMBER, [NUMBER, BULLET], (i) => `${i + 1}. `);
    case 'bold': {
      // Already bold (markers inside or right around the selection): remove them.
      if (selected.length >= 4 && selected.startsWith('**') && selected.endsWith('**')) {
        const inner = selected.slice(2, -2);
        return { value: value.slice(0, s) + inner + value.slice(e), start: s, end: s + inner.length };
      }
      if (value.slice(s - 2, s) === '**' && value.slice(e, e + 2) === '**' && selected) {
        return {
          value: value.slice(0, s - 2) + selected + value.slice(e + 2),
          start: s - 2,
          end: e - 2,
        };
      }
      const inner = selected || text.bold;
      return {
        value: `${value.slice(0, s)}**${inner}**${value.slice(e)}`,
        start: s + 2,
        end: s + 2 + inner.length,
      };
    }
    case 'link': {
      // A selected address becomes the link's target; other selected text its label.
      if (/^(https?:\/\/|\/)\S*$/.test(selected)) {
        const md = `[${text.link}](${selected})`;
        return {
          value: value.slice(0, s) + md + value.slice(e),
          start: s + 1,
          end: s + 1 + text.link.length,
        };
      }
      const label = selected || text.link;
      const md = `[${label}](${text.url})`;
      const urlAt = s + label.length + 3;
      return {
        value: value.slice(0, s) + md + value.slice(e),
        start: selected ? urlAt : s + 1,
        end: selected ? urlAt + text.url.length : s + 1 + label.length,
      };
    }
  }
}
