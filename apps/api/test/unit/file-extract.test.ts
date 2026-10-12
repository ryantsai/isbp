import { describe, expect, it } from 'vitest';
import { decodeText, extractBuiltin, fileKind, garbled } from '../../src/kernel/files/extract/builtin';
import { makePdf } from '../../src/kernel/files/extract/sample';
import { makeDocx, makePptx, makeXlsx, para } from '../fixtures/office';

describe('file kinds', () => {
  it('come from the sniffed type, then the extension', () => {
    expect(fileKind('application/pdf', 'x.bin')).toBe('pdf');
    expect(
      fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx'),
    ).toBe('docx');
    expect(fileKind('image/png', 'shot.png')).toBe('image');
    expect(fileKind('application/octet-stream', 'notes.md')).toBe('text');
    expect(fileKind('application/x-cfb', 'old.doc')).toBe('other');
  });
});

describe('builtin extraction', () => {
  it('reads the text layer of a PDF page by page', async () => {
    const pdf = makePdf([
      ['VPN setup guide', 'Open Corp VPN and sign in with your work account to reach the intranet.'],
      ['Troubleshooting', 'If the gateway is unreachable, switch the client to the TCP fallback profile.'],
    ]);
    const out = await extractBuiltin('pdf', pdf);
    expect(out?.producer).toBe('builtin:pdf');
    expect(out?.pages).toHaveLength(2);
    expect(out?.pages[1]).toContain('TCP fallback');
    expect(out?.needsOcr).toBe(false);
  });

  it('flags a PDF without a text layer for OCR', async () => {
    const out = await extractBuiltin('pdf', makePdf([[''], ['']]));
    expect(out?.needsOcr).toBe(true);
  });

  it('turns Word headings, lists and tables into Markdown, split at page breaks', async () => {
    const docx = makeDocx(
      para('Printer setup', 'Heading1') +
        para('Install the Follow-Me queue.') +
        `<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Badge at any printer</w:t></w:r></w:p>` +
        `<w:tbl><w:tr><w:tc>${para('Site')}</w:tc><w:tc>${para('Queue')}</w:tc></w:tr><w:tr><w:tc>${para('Taipei')}</w:tc><w:tc>${para('TPE-FM')}</w:tc></w:tr></w:tbl>` +
        para('Second page text', undefined, '<w:r><w:lastRenderedPageBreak/></w:r>'),
    );
    const out = await extractBuiltin('docx', docx);
    expect(out?.pages[0]).toContain('# Printer setup');
    expect(out?.pages[0]).toContain('- Badge at any printer');
    expect(out?.pages[0]).toContain('| Site | Queue |');
    expect(out?.pages[0]).toContain('| Taipei | TPE-FM |');
    expect(out?.pages[1]).toBe('Second page text');
  });

  it('reads slides in order with titles and speaker notes', async () => {
    const out = await extractBuiltin(
      'pptx',
      makePptx([
        {
          title: 'Network change',
          body: 'New core switch on Saturday',
          notes: 'Expect 10 minutes of downtime',
        },
        { title: 'Rollback', body: 'Revert to the old switch' },
      ]),
    );
    expect(out?.pages).toHaveLength(2);
    expect(out?.pages[0]).toContain('## Network change');
    expect(out?.pages[0]).toContain('Notes:\nExpect 10 minutes of downtime');
    expect(out?.pages[1]).toContain('Revert to the old switch');
  });

  it('reads each sheet as a Markdown table', async () => {
    const out = await extractBuiltin(
      'xlsx',
      makeXlsx([
        {
          name: 'Licences',
          rows: [
            ['Product', 'Seats'],
            ['Visio', 25],
            ['印表機管理', 3],
          ],
        },
        { name: 'Empty', rows: [] },
      ]),
    );
    expect(out?.pages[0]).toContain('## Licences');
    expect(out?.pages[0]).toContain('| Visio | 25 |');
    expect(out?.pages[0]).toContain('| 印表機管理 | 3 |');
    expect(out?.pages[1]).toBe('');
  });

  it('decodes legacy East Asian text files', () => {
    const big5 = Buffer.from([0xa6, 0x4c, 0xaa, 0xed, 0xbe, 0xf7]); // 印表機 in Big5
    expect(decodeText(big5)).toBe('印表機');
    expect(decodeText(Buffer.from('﻿hello', 'utf8'))).toBe('hello');
  });

  it('spots garbled text layers', () => {
    expect(garbled('Normal text with words')).toBe(false);
    expect(garbled('��� ab')).toBe(true);
  });
});
