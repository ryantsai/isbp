'use client';

import { Hint } from '@isbp/ui/tooltip';
import { BoldIcon, Heading2Icon, LinkIcon, ListIcon, ListOrderedIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, type RefObject, useRef, useState } from 'react';
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
export function markdownShortcut(e: KeyboardEvent<HTMLTextAreaElement>, run: (f: MarkdownFormat) => void) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    run('bold');
  }
}

/**
 * Heading, bold, bulleted and numbered list, link — over the Markdown textarea. One tab stop (arrow keys move between
 * the buttons, as in any toolbar); each button inserts Markdown at the selection and returns focus to the text.
 */
export function MarkdownToolbar({
  run,
  controls,
}: {
  run: (format: MarkdownFormat) => void;
  /** Id of the textarea it formats. */
  controls: string;
}) {
  const t = useTranslations('knowledge.editor.format');
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = FORMATS.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? active === last
          ? 0
          : active + 1
        : e.key === 'ArrowLeft'
          ? active === 0
            ? last
            : active - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  };
  return (
    <div
      role="toolbar"
      aria-label={t('label')}
      aria-controls={controls}
      onKeyDown={move}
      className="flex w-fit items-center gap-0.5 rounded-md border bg-muted/40 p-0.5"
    >
      {FORMATS.map(({ format, icon: Icon, shortcut }, i) => (
        <Hint
          key={format}
          label={shortcut ? t('withShortcut', { label: t(format), key: shortcut }) : t(format)}
        >
          <button
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            tabIndex={i === active ? 0 : -1}
            aria-label={t(format)}
            aria-keyshortcuts={shortcut ? `Control+${shortcut} Meta+${shortcut}` : undefined}
            onFocus={() => setActive(i)}
            onClick={() => run(format)}
            className="grid size-8 place-items-center rounded text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none [&_svg]:size-4"
          >
            <Icon aria-hidden />
          </button>
        </Hint>
      ))}
    </div>
  );
}
