'use client';

import { templateSegments } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { type ClipboardEvent, type Ref, useImperativeHandle, useLayoutEffect, useRef } from 'react';

/*
 * A text box for action settings that can hold values from the request ("Request number", "Requester's name"). The
 * values show as chips with their label; the stored text keeps `{{path}}` placeholders (`@isbp/sdk` templates). It is
 * a contenteditable element: chips are non-editable spans (`data-path`), so Backspace removes a whole chip, and the
 * text is read back from the DOM after every edit. Copying keeps the placeholders; pasting inserts plain text.
 */

/** Lets the caret sit after a chip at the end of a line; never stored. */
const ZWSP = '​';

export interface TemplateLabel {
  label: string;
  /** False for a path the menu doesn't offer (typed by hand, or a field that is gone): shown dashed. */
  known: boolean;
}

export interface TemplateInputHandle {
  /** Puts a chip for `path` where the caret was (or at the end) and reports the new text. */
  insert: (path: string) => void;
  focus: () => void;
}

const CHIP =
  'mx-px rounded-md border px-1.5 py-px text-[0.85em] font-medium whitespace-nowrap [box-decoration-break:clone]';
const KNOWN = 'border-primary/30 bg-primary/10 text-primary';
const UNKNOWN = 'border-dashed border-muted-foreground/50 bg-muted text-muted-foreground';

function chip(doc: Document, path: string, { label, known }: TemplateLabel): HTMLSpanElement {
  const el = doc.createElement('span');
  el.contentEditable = 'false';
  el.dataset.path = path;
  el.className = cn(CHIP, known ? KNOWN : UNKNOWN);
  el.textContent = label;
  return el;
}

function appendLine(target: Node, line: string, labelOf: (path: string) => TemplateLabel) {
  const doc = target.ownerDocument ?? document;
  const segments = templateSegments(line);
  for (const s of segments) {
    if ('text' in s) target.appendChild(doc.createTextNode(s.text));
    else target.appendChild(chip(doc, s.path, labelOf(s.path)));
  }
  if (segments.length && 'path' in segments[segments.length - 1]!)
    target.appendChild(doc.createTextNode(ZWSP));
}

/** Replaces the editor's content with `value`: one `<div>` per line when multi-line (the browsers' own model). */
function fill(
  root: HTMLElement,
  value: string,
  multiline: boolean,
  labelOf: (path: string) => TemplateLabel,
) {
  root.replaceChildren();
  if (!value) return;
  if (!multiline) return appendLine(root, value.replace(/\r?\n/g, ' '), labelOf);
  for (const line of value.split('\n')) {
    const div = root.ownerDocument.createElement('div');
    if (line) appendLine(div, line, labelOf);
    else div.appendChild(root.ownerDocument.createElement('br'));
    root.appendChild(div);
  }
}

const isBlock = (el: Element) => el.tagName === 'DIV' || el.tagName === 'P';

/** A `<br>` with nothing after it in its block only keeps an empty line open (it isn't a line break itself). */
function trailingBr(br: Element): boolean {
  for (let n = br.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType === Node.ELEMENT_NODE) return false;
    if ((n.nodeValue ?? '').replaceAll(ZWSP, '')) return false;
  }
  return true;
}

/** The template text of the editor's content (or of a copied fragment). */
export function serializeTemplate(root: Node): string {
  const lines = [''];
  let started = false;
  const push = (text: string) => {
    lines[lines.length - 1] += text;
    started = true;
  };
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) push(child.nodeValue ?? '');
      else if (child instanceof HTMLElement) {
        if (child.dataset.path) push(`{{${child.dataset.path}}}`);
        else if (child.tagName === 'BR') {
          if (!trailingBr(child)) lines.push('');
          started = true;
        } else if (isBlock(child)) {
          if (started) lines.push('');
          started = true;
          visit(child);
        } else visit(child);
      }
    }
  };
  visit(root);
  return lines.join('\n').replaceAll(ZWSP, '');
}

/** The end of the editor's content, inside its last line. */
function endOf(root: HTMLElement): Range {
  const range = root.ownerDocument.createRange();
  const last = root.lastElementChild;
  range.selectNodeContents(last && isBlock(last) && root.lastChild === last ? last : root);
  range.collapse(false);
  return range;
}

export function TemplateInput({
  id,
  value,
  onChange,
  labelOf,
  multiline = false,
  rows = 4,
  mono = false,
  placeholder,
  disabled,
  invalid,
  labelledBy,
  ariaLabel,
  describedBy,
  handleRef,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** The chip text of a placeholder path. Pass a stable (memoised) function: a new one redraws the chips. */
  labelOf: (path: string) => TemplateLabel;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  labelledBy?: string;
  /** The accessible name when the field's visible label adds more words (a "Required" marker). */
  ariaLabel?: string;
  describedBy?: string;
  handleRef?: Ref<TemplateInputHandle>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const drawnWith = useRef<typeof labelOf | null>(null);

  // Redraw only when the text differs from what is shown (an outside change, the first render) or labels change, so
  // typing never moves the caret.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (drawnWith.current === labelOf && serializeTemplate(el) === value) return;
    fill(el, value, multiline, labelOf);
    drawnWith.current = labelOf;
  }, [value, multiline, labelOf]);

  const remember = () => {
    const el = ref.current;
    const sel = window.getSelection();
    if (el && sel?.rangeCount && el.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };
  const emit = () => {
    if (ref.current) onChange(serializeTemplate(ref.current));
    remember();
  };

  useImperativeHandle(handleRef, () => ({
    focus: () => ref.current?.focus(),
    insert: (path: string) => {
      const el = ref.current;
      const sel = window.getSelection();
      if (!el || !sel) return;
      el.focus();
      const range = saved.current && el.contains(saved.current.startContainer) ? saved.current : endOf(el);
      range.deleteContents();
      // Keep a space between the chip and the word or chip before it.
      const before = el.ownerDocument.createRange();
      before.setStart(el, 0);
      before.setEnd(range.startContainer, range.startOffset);
      const holder = el.ownerDocument.createElement('div');
      holder.appendChild(before.cloneContents());
      const preceding = serializeTemplate(holder);
      const after = el.ownerDocument.createTextNode(ZWSP);
      range.insertNode(after);
      range.insertNode(chip(el.ownerDocument, path, labelOf(path)));
      if (preceding && !/\s$/.test(preceding)) range.insertNode(el.ownerDocument.createTextNode(' '));
      const caret = el.ownerDocument.createRange();
      caret.setStartAfter(after);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      emit();
    },
  }));

  const copy = (e: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;
    const holder = document.createElement('div');
    holder.appendChild(sel.getRangeAt(0).cloneContents());
    e.clipboardData.setData('text/plain', serializeTemplate(holder));
    e.preventDefault();
    if (cut && !disabled) {
      sel.deleteFromDocument();
      emit();
    }
  };

  return (
    <div className="relative min-w-0">
      <div
        ref={ref}
        id={id}
        role="textbox"
        aria-multiline={multiline || undefined}
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        aria-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={!mono}
        tabIndex={0}
        onInput={emit}
        onBlur={remember}
        onKeyUp={remember}
        onMouseUp={remember}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !multiline) e.preventDefault();
        }}
        onPaste={(e) => {
          e.preventDefault();
          if (disabled) return;
          let text = e.clipboardData.getData('text/plain');
          if (!multiline) text = text.replace(/\r?\n/g, ' ');
          // insertText keeps the browser's own undo; it is still supported everywhere for contenteditable.
          if (!document.execCommand('insertText', false, text)) {
            const sel = window.getSelection();
            if (sel?.rangeCount) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(document.createTextNode(text));
              range.collapse(false);
            }
            emit();
          }
        }}
        onCopy={(e) => copy(e, false)}
        onCut={(e) => copy(e, true)}
        style={multiline ? { minHeight: `${rows * 1.5 + 1}rem` } : undefined}
        className={cn(
          'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-base leading-6 break-words whitespace-pre-wrap outline-none transition-[color,box-shadow] motion-reduce:transition-none md:text-sm dark:bg-input/30',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
          multiline ? 'py-2' : 'min-h-9',
          mono && 'font-mono text-xs md:text-xs',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      />
      {!value && placeholder && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-0 left-0 truncate px-3 text-base leading-6 text-muted-foreground md:text-sm',
            multiline ? 'py-2' : 'py-1.5',
            mono && 'font-mono text-xs md:text-xs',
          )}
        >
          {placeholder}
        </span>
      )}
    </div>
  );
}
