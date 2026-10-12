/** Tiny Office Open XML files built in memory (Word, PowerPoint, Excel), for extraction tests. */
import { strToU8, zipSync } from 'fflate';

const zip = (entries: Record<string, string>) =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
export const para = (text: string, style?: string, extra = '') =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${extra}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

export function makeDocx(body: string): Buffer {
  return zip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
  });
}

export function makePptx(slides: { title: string; body: string; notes?: string }[]): Buffer {
  const P = 'xmlns:p="p" xmlns:a="a" xmlns:r="r"';
  const entries: Record<string, string> = {
    'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
      .join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships>${slides
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="slides/slide${i + 1}.xml"/>`)
      .join('')}</Relationships>`,
  };
  slides.forEach((s, i) => {
    const shape = (text: string, type?: string) =>
      `<p:sp><p:nvSpPr><p:nvPr>${type ? `<p:ph type="${type}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    entries[`ppt/slides/slide${i + 1}.xml`] =
      `<p:sld ${P}><p:cSld><p:spTree>${shape(s.title, 'title')}${shape(s.body)}</p:spTree></p:cSld></p:sld>`;
    if (s.notes) {
      entries[`ppt/slides/_rels/slide${i + 1}.xml.rels`] =
        `<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide${i + 1}.xml"/></Relationships>`;
      entries[`ppt/notesSlides/notesSlide${i + 1}.xml`] =
        `<p:notes ${P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${s.notes}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
    }
  });
  return zip(entries);
}

export function makeXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Buffer {
  const strings: string[] = [];
  const idx = (s: string) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const entries: Record<string, string> = {
    'xl/workbook.xml': `<workbook xmlns:r="r"><sheets>${sheets
      .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}</Relationships>`,
  };
  sheets.forEach((s, i) => {
    const rows = s.rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) => {
              const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
              return typeof v === 'number'
                ? `<c r="${ref}"><v>${v}</v></c>`
                : `<c r="${ref}" t="s"><v>${idx(v)}</v></c>`;
            })
            .join('')}</row>`,
      )
      .join('');
    entries[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });
  entries['xl/sharedStrings.xml'] = `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
  return zip(entries);
}
