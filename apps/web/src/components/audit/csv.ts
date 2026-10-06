/**
 * RFC 4180 CSV with spreadsheet-formula hardening: text cells starting with = + - @ tab or CR are
 * prefixed with an apostrophe so Excel/Sheets treat them as text (CSV injection).
 */
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else {
    s = typeof value === 'string' ? value : JSON.stringify(value);
    if (FORMULA.test(s)) s = `'${s}`;
  }
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Downloads `csv` as a UTF-8 file (with BOM so Excel shows CJK names correctly). */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
