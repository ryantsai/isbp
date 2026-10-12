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
