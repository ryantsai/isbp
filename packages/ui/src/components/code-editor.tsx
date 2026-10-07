'use client';

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { MSSQL, MySQL, PLSQL, PostgreSQL, type SQLNamespace, sql } from '@codemirror/lang-sql';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import * as React from 'react';
import { cn } from '../lib/utils';

export type CodeLanguage = 'sql' | 'python' | 'javascript' | 'json' | 'shell' | 'powershell' | 'text';
export type SqlDialectName = 'mssql' | 'postgres' | 'mysql' | 'oracle';
/** Autocompletion for SQL: `{ "schema.table": ["column", …] }` or nested `{ schema: { table: [...] } }`. */
export type SqlSchema = SQLNamespace;

const DIALECTS = { mssql: MSSQL, postgres: PostgreSQL, mysql: MySQL, oracle: PLSQL } as const;

function languageExtension(language: CodeLanguage, dialect?: SqlDialectName, schema?: SqlSchema): Extension {
  switch (language) {
    case 'sql':
      return sql({ dialect: DIALECTS[dialect ?? 'postgres'], schema, upperCaseKeywords: true });
    case 'python':
      return python();
    case 'javascript':
      return javascript();
    case 'json':
      return json();
    case 'shell':
      return StreamLanguage.define(shell);
    case 'powershell':
      return StreamLanguage.define(powerShell);
    default:
      return [];
  }
}

/** Token colours from the theme tokens (AA on the editor background in light and dark). */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--primary)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--info)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--muted-foreground)',
    fontStyle: 'italic',
  },
  { tag: [tags.function(tags.variableName), tags.typeName], color: 'var(--foreground)', fontWeight: '500' },
  { tag: tags.special(tags.name), color: 'var(--warning-foreground, var(--foreground))' },
  { tag: tags.invalid, color: 'var(--destructive)' },
]);

const theme = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    caretColor: 'var(--foreground)',
    padding: '8px 0',
  },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.55' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--accent) 45%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 25%, transparent) !important',
  },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in oklab, var(--primary) 20%, transparent)' },
});

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage;
  /** SQL dialect for keywords and quoting. */
  dialect?: SqlDialectName;
  /** SQL autocompletion of tables and columns. */
  schema?: SqlSchema;
  readOnly?: boolean;
  placeholder?: string;
  /** Accessible name: the id of a visible label (preferred) or a text label. */
  'aria-labelledby'?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  lineNumbers?: boolean;
  className?: string;
  /** CSS min/max height of the scroll area (default 8rem / 28rem). */
  minHeight?: string;
  maxHeight?: string;
}

/**
 * A code editor (CodeMirror 6) for SQL and scripts. Tab moves focus as usual (no keyboard trap); the
 * content is a labelled, multi-line textbox for screen readers.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'text',
  dialect,
  schema,
  readOnly = false,
  placeholder,
  lineNumbers: showLineNumbers = true,
  className,
  minHeight = '8rem',
  maxHeight = '28rem',
  'aria-labelledby': labelledBy,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: CodeEditorProps) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const onChangeRef = React.useRef(onChange);
  const compartments = React.useRef({
    language: new Compartment(),
    readOnly: new Compartment(),
    attrs: new Compartment(),
    placeholder: new Compartment(),
  });

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const contentAttributes = React.useMemo(() => {
    // An explicit tabindex: some checkers (axe) don't treat contenteditable as focusable.
    const attrs: Record<string, string> = { 'aria-multiline': 'true', spellcheck: 'false', tabindex: '0' };
    if (labelledBy) attrs['aria-labelledby'] = labelledBy;
    if (ariaLabel) attrs['aria-label'] = ariaLabel;
    if (describedBy) attrs['aria-describedby'] = describedBy;
    if (invalid) attrs['aria-invalid'] = 'true';
    if (readOnly) attrs['aria-readonly'] = 'true';
    return attrs;
  }, [labelledBy, ariaLabel, describedBy, invalid, readOnly]);

  // Create the editor once; later prop changes go through compartments.
  React.useEffect(() => {
    if (!host.current) return;
    const c = compartments.current;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          syntaxHighlighting(highlight),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
          theme,
          EditorView.lineWrapping,
          c.language.of(languageExtension(language, dialect, schema)),
          // Read-only still focusable (keyboard scrolling and selection); `readOnly` blocks every change.
          c.readOnly.of(EditorState.readOnly.of(readOnly)),
          c.attrs.of(EditorView.contentAttributes.of(contentAttributes)),
          c.placeholder.of(placeholder ? placeholderExt(placeholder) : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once per mount; the effects below keep it in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  React.useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.language.reconfigure(languageExtension(language, dialect, schema)),
    });
  }, [language, dialect, schema]);

  React.useEffect(() => {
    view.current?.dispatch({
      effects: [
        compartments.current.readOnly.reconfigure(EditorState.readOnly.of(readOnly)),
        compartments.current.attrs.reconfigure(EditorView.contentAttributes.of(contentAttributes)),
        compartments.current.placeholder.reconfigure(placeholder ? placeholderExt(placeholder) : []),
      ],
    });
  }, [readOnly, contentAttributes, placeholder]);

  return (
    <div
      ref={host}
      data-slot="code-editor"
      data-invalid={invalid ? '' : undefined}
      className={cn(
        'min-w-0 overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 data-[invalid]:border-destructive dark:bg-input/30 [&_.cm-editor]:max-h-[var(--code-max)] [&_.cm-scroller]:min-h-[var(--code-min)]',
        readOnly && 'bg-muted/40',
        className,
      )}
      style={{ '--code-min': minHeight, '--code-max': maxHeight } as React.CSSProperties}
    />
  );
}
