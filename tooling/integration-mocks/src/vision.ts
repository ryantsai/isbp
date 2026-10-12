import { inflateSync } from 'node:zlib';

/**
 * What the stand-in model "sees" in an image, the way the Docling stand-in "reads" PDFs: for a PNG, its size, the
 * colour of its first pixel and the text of its `tEXt` chunks named `Text` (tests put a screenshot's words there).
 * Other formats are seen as an image of unknown colour.
 */
export interface Seen {
  width: number;
  height: number;
  colour: string;
  text: string;
}

const COLOURS: [string, [number, number, number]][] = [
  ['red', [220, 30, 30]],
  ['green', [30, 160, 60]],
  ['blue', [30, 60, 220]],
  ['yellow', [230, 210, 40]],
  ['white', [255, 255, 255]],
  ['black', [0, 0, 0]],
  ['grey', [128, 128, 128]],
];

function nearest(rgb: [number, number, number]): string {
  let best = COLOURS[0]!;
  let dist = Infinity;
  for (const c of COLOURS) {
    const d = c[1].reduce((n, v, i) => n + (v - rgb[i]!) ** 2, 0);
    if (d < dist) [best, dist] = [c, d];
  }
  return best[0];
}

/** `data:image/png;base64,…` (or bare base64) → what is in it. */
export function seeImage(url: string): Seen {
  const unknown = { width: 0, height: 0, colour: 'unknown', text: '' };
  const data = Buffer.from(url.replace(/^data:[^,]*,/, ''), 'base64');
  if (data.length < 8 || data.readUInt32BE(0) !== 0x89504e47) return unknown;
  let width = 0;
  let height = 0;
  let colourType = 2;
  const idat: Buffer[] = [];
  const text: string[] = [];
  for (let at = 8; at + 8 <= data.length;) {
    const len = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colourType = body[9]!;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'tEXt') {
      const nul = body.indexOf(0);
      if (body.toString('latin1', 0, nul) === 'Text') text.push(body.subarray(nul + 1).toString('utf8'));
    }
    at += 12 + len;
  }
  let colour = 'unknown';
  try {
    const pixels = inflateSync(Buffer.concat(idat));
    // Truecolour (with or without alpha), first row unfiltered: the first pixel follows the filter byte.
    if ((colourType === 2 || colourType === 6) && pixels[0] === 0)
      colour = nearest([pixels[1]!, pixels[2]!, pixels[3]!]);
  } catch {
    // Not a PNG we can read: the colour stays unknown.
  }
  return { width, height, colour, text: text.join('\n') };
}

/** The stand-in's answer about images: the colour when asked for it, otherwise a description. */
export function describeSeen(images: Seen[], question: string): string {
  if (/what colou?r/i.test(question)) return images[0]?.colour ?? 'unknown';
  return images
    .map((i) =>
      [
        i.text,
        `${/^[aeiou]/.test(i.colour) ? 'An' : 'A'} ${i.colour} image${i.width ? `, ${i.width}×${i.height} pixels` : ''}.`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}
