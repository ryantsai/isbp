'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { BoldIcon, Heading2Icon, LinkIcon, ListIcon, ListOrderedIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KeyboardEvent, RefObject } from 'react';
import { applyMarkdownFormat, type MarkdownFormat } from './markdown-format';

const FORMATS: { format: MarkdownFormat; icon: typeof BoldIcon; shortcut?: string }[] = [
  { format: 'heading', icon: Heading2Icon },
  { format: 'bold', icon: BoldIcon, shortcut: 'B' },
  { format: 'bulleted', icon: ListIcon },
  { format: 'numbered', icon: ListOrderedIcon },
  { format: 'link', icon: LinkIcon },
];

/** Runs a format on the textarea's selection and hands the new text to the form; the selection follows. */
export function useMarkdownFormat(
  textarea: RefObject<HTMLTextAreaElement | null>,
  onChange: (value: string) => void,
) {
  const t = useTranslations('knowledge.editor.format');
  return (format: MarkdownFormat) => {
    const el = textarea.current;
    if (!el) return;
    const edit = applyMarkdownFormat(format, el.value, el.selectionStart, el.selectionEnd, {
      heading: t('headingText'),
      bold: t('boldText'),
      link: t('linkText'),
      url: 'https://',
    });
    showEdit(el, edit);
    onChange(edit.value);
  };
}

/**
 * Puts the new text and its selection into the textarea at once, so keys typed right after the click land in the
 * selection (selecting a frame later lost them). The form's re-render then finds the same text and leaves the caret.
 */
function showEdit(el: HTMLTextAreaElement, edit: { value: string; start: number; end: number }) {
  el.value = edit.value;
  el.focus();
  el.setSelectionRange(edit.start, edit.end);
}

/** ⌘B / Ctrl+B in the textarea makes the selection bold (other shortcuts stay the app's). */
export function markdownShortcut(e: KeyboardEvent<HTMLElement>, run: (f: MarkdownFormat) => void) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    run('bold');
  }
}

/**
 * Heading, bold, bulleted and numbered list, link — over the Markdown textarea. One tab stop (arrow keys move between
 * the buttons, as in any toolbar); each button inserts Markdown at the selection and returns focus to the text.
 */
export function MarkdownToolbar({ run }: { run: (format: MarkdownFormat) => void }) {
  const t = useTranslations('knowledge.editor.format');
  return (
    <Toolbar
      label={t('label')}
      size="sm"
      startContent={FORMATS.map(({ format, icon, shortcut }) => (
        <IconButton
          key={format}
          label={t(format)}
          tooltip={shortcut ? t('withShortcut', { label: t(format), key: shortcut }) : undefined}
          variant="ghost"
          size="sm"
          icon={<Icon icon={icon} />}
          aria-keyshortcuts={shortcut ? `Control+${shortcut} Meta+${shortcut}` : undefined}
          onClick={() => run(format)}
        />
      ))}
    />
  );
}
