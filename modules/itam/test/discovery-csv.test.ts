import { describe, expect, it } from 'vitest';
import {
  csvRecords,
  DISCOVERY_CSV_EXAMPLE,
  DISCOVERY_IMPORT_BATCH,
  DISCOVERY_MAX_PRODUCTS,
  discoveryBatches,
  discoveryImportSchema,
  parseDiscoveryCsv,
} from '../src/contracts';

describe('inventory CSV', () => {
  it('reads RFC 4180 records: quotes, escaped quotes, newlines in quotes, CRLF and a BOM', () => {
    const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\n\n';
    expect(csvRecords(text)).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['x, y', 'say "hi"'] },
      { line: 3, cells: ['multi\nline', 'z'] },
    ]);
  });

  it('recognises semicolon and tab separators', () => {
    expect(csvRecords('a;b\n1;2')[1]!.cells).toEqual(['1', '2']);
    expect(csvRecords('a\tb\n1\t2,3')[1]!.cells).toEqual(['1', '2,3']);
  });

  it('groups rows into complete per-device reports, by serial number or asset tag', () => {
    const r = parseDiscoveryCsv(
      [
        'Serial Number;Asset Tag;Product;Publisher;Version;Ignored column',
        '5CG41;;Google Chrome;Google;129;x',
        '5cg41;;google chrome;Google;130;x',
        '5CG41;;7-Zip;;;',
        ';ast-00042;Microsoft 365 E3;Microsoft;16.0;',
        ';;Orphan;;;',
        'PF4X;;;;;',
      ].join('\n'),
    );
    expect(r).toEqual({
      ok: true,
      rows: 6,
      devices: [
        {
          device: '5CG41',
          assetSerial: '5CG41',
          products: [
            { product: 'Google Chrome', publisher: 'Google', version: '129' },
            { product: '7-Zip', publisher: null, version: null },
          ],
        },
        {
          device: 'ast-00042',
          assetTag: 'ast-00042',
          products: [{ product: 'Microsoft 365 E3', publisher: 'Microsoft', version: '16.0' }],
        },
      ],
      issues: [
        { line: 6, code: 'noDevice' },
        { line: 7, code: 'noProduct' },
      ],
    });
    // The example on the page is a valid file.
    expect(parseDiscoveryCsv(DISCOVERY_CSV_EXAMPLE)).toMatchObject({ ok: true, rows: 3 });
  });

  it('refuses files without the columns it needs, or without rows', () => {
    expect(parseDiscoveryCsv('serial_number,publisher\nA,B')).toEqual({
      ok: false,
      error: 'missingColumns',
      missing: ['product'],
    });
    expect(parseDiscoveryCsv('product\nChrome')).toEqual({
      ok: false,
      error: 'missingColumns',
      missing: ['serial_number', 'asset_tag'],
    });
    expect(parseDiscoveryCsv('serial_number,product\n')).toEqual({ ok: false, error: 'empty' });
    expect(parseDiscoveryCsv('')).toEqual({ ok: false, error: 'empty' });
  });

  it('skips over-long values and products beyond the per-device cap', () => {
    const rows = ['serial_number,product', `A,${'x'.repeat(201)}`];
    for (let i = 0; i <= DISCOVERY_MAX_PRODUCTS; i++) rows.push(`B,Product ${i}`);
    const r = parseDiscoveryCsv(rows.join('\n'));
    if (!r.ok) throw new Error('expected a parse');
    expect(r.issues).toEqual([
      { line: 2, code: 'tooLong' },
      { line: rows.length, code: 'tooManyProducts' },
    ]);
    expect(r.devices[0]!.products).toHaveLength(DISCOVERY_MAX_PRODUCTS);
  });

  it('sends whole devices in batches the import API accepts', () => {
    const devices = Array.from({ length: 250 }, (_, i) => ({
      assetSerial: `SN-${i}`,
      products: [{ product: 'Chrome', publisher: null, version: null }],
    }));
    const batches = discoveryBatches(devices);
    expect(batches.map((b) => b.length)).toEqual([DISCOVERY_IMPORT_BATCH, DISCOVERY_IMPORT_BATCH, 50]);
    for (const b of batches) expect(discoveryImportSchema.safeParse({ devices: b }).success).toBe(true);
    // Large devices split by size, never inside a device.
    const big = Array.from({ length: 3 }, (_, i) => ({
      assetSerial: `BIG-${i}`,
      products: Array.from({ length: 2000 }, (_, j) => ({
        product: `產品 ${j} ${'x'.repeat(150)}`,
        publisher: null,
        version: null,
      })),
    }));
    expect(discoveryBatches(big).map((b) => b.length)).toEqual([1, 1, 1]);
  });
});
