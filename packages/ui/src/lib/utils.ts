import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Stable hue (0–359) from a string — used for avatar and tag colours. */
export function hueOf(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  return h;
}

/** Up to two initials; CJK names use their first one or two characters. */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  if (/[぀-ヿ㐀-鿿]/.test(trimmed[0]!)) {
    const parts = trimmed.split(/\s+/);
    return parts.length > 1
      ? parts[0]!.slice(0, 1) + parts[1]!.slice(0, 1)
      : trimmed.slice(1, 3) || trimmed.slice(0, 1);
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase();
}
