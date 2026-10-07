/** Small Markdown helpers for builtin (extractive / templated) answers. */

const ORDERED = /^ {0,3}(\d{1,3})[.)]\s+(.+)$/;
const FENCE = /^ {0,3}(```|~~~)/;

/**
 * The first numbered list of a Markdown document, as item texts (inline Markdown kept, continuation
 * lines joined, nested content dropped). Lists inside code fences are ignored.
 */
export function extractNumberedSteps(markdown: string, max = 6): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const steps: string[] = [];
  let inFence = false;
  let inList = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      if (inList) break;
      continue;
    }
    if (inFence) continue;
    const m = ORDERED.exec(line);
    if (m) {
      inList = true;
      steps.push(m[2]!.trim());
      continue;
    }
    if (!inList) continue;
    if (!line.trim()) {
      // A blank line ends the list unless the next item continues it ("loose" lists).
      continue;
    }
    if (/^ {2,}\S/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      // Lazy continuation of the previous item.
      steps[steps.length - 1] = `${steps[steps.length - 1]} ${line.trim()}`;
      continue;
    }
    if (/^\s{2,}([-*+]|\d+[.)])\s/.test(line)) continue; // nested list: skip
    break; // anything else at the top level ends the list
  }
  return steps.slice(0, max);
}

/** Markdown → plain text (links keep their label, emphasis and code marks dropped). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]{1,3}([^*_`~]+)[*_`~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentence (or the first `max` characters) of a text, in any of the three languages. */
export function firstSentence(text: string, max = 240): string {
  const t = plainText(text);
  // Latin full stops end a sentence before whitespace; CJK ones end it anywhere.
  const m = /^(.+?(?:[.!?](?=\s|$)|[。！？]))/u.exec(t);
  const s = m ? m[1]! : t;
  return truncate(s, max);
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
