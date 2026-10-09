import { describe, expect, it } from 'vitest';
import { applyMarkdownFormat, type MarkdownFormat } from '../src/web/markdown-format';

const words = { heading: 'Heading', bold: 'bold text', link: 'link text', url: 'https://' };

/** Applies a format to a string where `«` and `»` mark the selection, and returns the result marked the same way. */
function run(format: MarkdownFormat, marked: string) {
  const start = marked.indexOf('«');
  const end = marked.indexOf('»') - 1;
  const value = marked.replace('«', '').replace('»', '');
  const r = applyMarkdownFormat(format, value, start, end, words);
  return `${r.value.slice(0, r.start)}«${r.value.slice(r.start, r.end)}»${r.value.slice(r.end)}`;
}

describe('editor formatting toolbar', () => {
  it('bold wraps the selection, inserts a selected placeholder without one, and switches off', () => {
    expect(run('bold', 'Restart the «router» first')).toBe('Restart the **«router»** first');
    expect(run('bold', 'Restart «»')).toBe('Restart **«bold text»**');
    expect(run('bold', 'Restart the **«router»** first')).toBe('Restart the «router» first');
    expect(run('bold', 'Restart the «**router**» first')).toBe('Restart the «router» first');
  });

  it('headings apply to the whole line (also from a caret mid-line) and toggle off', () => {
    expect(run('heading', 'Intro\nFix the V«»PN\nEnd')).toBe('Intro\n«## Fix the VPN»\nEnd');
    expect(run('heading', '«## Fix the VPN»')).toBe('«Fix the VPN»');
    expect(run('heading', 'Text\n«»')).toBe('Text\n## «Heading»');
  });

  it('lists prefix every non-empty selected line, renumber, convert and switch off', () => {
    expect(run('numbered', '«Open Settings\n\nTap Wi-Fi»')).toBe('«1. Open Settings\n\n2. Tap Wi-Fi»');
    expect(run('bulleted', '«1. Open Settings\n2. Tap Wi-Fi»')).toBe('«- Open Settings\n- Tap Wi-Fi»');
    expect(run('bulleted', '«- Open Settings\n- Tap Wi-Fi»')).toBe('«Open Settings\nTap Wi-Fi»');
    expect(run('numbered', 'Steps:\n«»')).toBe('Steps:\n1. «»');
    // A selection that ends at the start of the next line doesn't touch that line.
    expect(run('bulleted', '«One\n»Two')).toBe('«- One»\nTwo');
  });

  it('links take the selection as their label (then the address is selected) or as their address', () => {
    expect(run('link', 'See «the form» here')).toBe('See [the form](«https://») here');
    expect(run('link', 'See «» here')).toBe('See [«link text»](https://) here');
    expect(run('link', 'Open «/requests» now')).toBe('Open [«link text»](/requests) now');
  });
});
