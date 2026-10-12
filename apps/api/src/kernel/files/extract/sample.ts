import { crc32, deflateSync } from 'node:zlib';

/**
 * A small PDF with one page per entry (Helvetica, Latin text): the document-extraction connection test sends one,
 * and tests build them.
 */
export function makePdf(pages: string[][]): Buffer {
  const esc = (v: string) => v.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const pageIds: number[] = [];
  for (const lines of pages) {
    const text = [
      'BT /F1 12 Tf 72 760 Td',
      ...lines.map((l, i) => `${i ? '0 -18 Td ' : ''}(${esc(l)}) Tj`),
      'ET',
    ].join('\n');
    objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    const contentId = objects.length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    pageIds.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** The page the connection test sends; a working service returns this text. */
export const TEST_PAGE = ['IS Big Platform document extraction test', 'Searchable attachments: OK'];

/**
 * A PNG filled with one colour: the image-description connection test sends one and asks for its colour (a model
 * that drops images can't answer), and tests build them. `text` goes in a `tEXt` chunk named `Text` (what the
 * stand-in model of `tooling/integration-mocks` "reads" in a screenshot); `minBytes` pads the file to at least that
 * size (figures smaller than 8 KB are skipped as icons).
 */
export function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number],
  opts: { text?: string; minBytes?: number } = {},
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  const parts = [chunk('IHDR', header), chunk('IDAT', pixels)];
  if (opts.text) parts.push(chunk('tEXt', Buffer.from(`Text\0${opts.text}`, 'utf8')));
  const size = 8 + parts.reduce((n, p) => n + p.length, 0) + 12;
  if (opts.minBytes && size < opts.minBytes)
    parts.push(chunk('tEXt', Buffer.from(`Comment\0${'.'.repeat(opts.minBytes - size)}`, 'latin1')));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...parts]);
}
