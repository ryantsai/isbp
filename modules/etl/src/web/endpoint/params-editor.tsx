'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { newParam, type ParamDef, PARAM_TYPES, type ProcedureDef } from '../../contracts';

export type Errors = Record<string, string>;

function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}

const numberOrNull = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));
const textOrNull = (v: string) => (v.trim() === '' ? null : v);

/** One parameter: the common settings in a row, constraints and docs behind "More". */
function ParamRow({
  param,
  index,
  onChange,
  onRemove,
  procedure,
  errors,
}: {
  param: ParamDef;
  index: number;
  onChange: (p: ParamDef) => void;
  onRemove: () => void;
  procedure: ProcedureDef | null;
  errors: Errors;
}) {
  const t = useTranslations('etl.params');
  const id = useId();
  const [open, setOpen] = useState(false);
  const err = (field: string) => errors[`draft.params.${index}.${field}`];
  const set = (patch: Partial<ParamDef>) => onChange({ ...param, ...patch });
  const numeric = param.type === 'integer' || param.type === 'number' || param.type === 'decimal';
  const inputs = procedure?.parameters.filter((a) => a.direction !== 'out') ?? [];
  const text = (
    field: keyof ParamDef,
    label: string,
    opts: { mono?: boolean; placeholder?: string } = {},
  ) => (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={`${id}-${field}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`${id}-${field}`}
        className={cn('h-8', opts.mono && 'font-mono')}
        value={(param[field] as string | number | null) ?? ''}
        placeholder={opts.placeholder}
        aria-invalid={Boolean(err(field)) || undefined}
        aria-describedby={err(field) ? `${id}-${field}-error` : undefined}
        onChange={(e) =>
          set({
            [field]:
              field === 'min' || field === 'max'
                ? numberOrNull(e.target.value)
                : field === 'minLength' || field === 'maxLength'
                  ? numberOrNull(e.target.value)
                  : textOrNull(e.target.value),
          } as Partial<ParamDef>)
        }
      />
      <FieldError id={`${id}-${field}-error`} message={err(field)} />
    </div>
  );

  return (
    <li className="grid min-w-0 gap-3 rounded-lg border bg-background p-3">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${id}-name`} className="text-xs">
            {t('name')}
          </Label>
          <Input
            id={`${id}-name`}
            className="h-8 font-mono"
            value={param.name}
            aria-invalid={Boolean(err('name')) || undefined}
            onChange={(e) => set({ name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })}
          />
          <FieldError id={`${id}-name-error`} message={err('name')} />
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${id}-type`} className="text-xs">
            {t('type')}
          </Label>
          <Select value={param.type} onValueChange={(v) => set({ type: v as ParamDef['type'] })}>
            <SelectTrigger id={`${id}-type`} className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARAM_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`types.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {text('default', t('default'), { placeholder: param.list ? 'a,b' : undefined })}
        <div className="flex items-end gap-1 sm:col-span-3 lg:col-span-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={`${id}-more`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
            {t('more')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('remove', { name: param.name || '?' })}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {(
          [
            ['required', t('required')],
            ['list', t('list')],
            ['sensitive', t('sensitive')],
          ] as const
        ).map(([field, label]) => (
          <div key={field} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-${field}`}
              checked={param[field]}
              onCheckedChange={(v) => set({ [field]: v === true } as Partial<ParamDef>)}
            />
            <Label htmlFor={`${id}-${field}`} className="font-normal">
              {label}
            </Label>
          </div>
        ))}
      </div>
      <div
        id={`${id}-more`}
        hidden={!open}
        className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {text('description', t('description'))}
        {text('example', t('example'))}
        {procedure && (
          <div className="grid min-w-0 gap-1">
            <Label htmlFor={`${id}-target`} className="text-xs">
              {t('target')}
            </Label>
            <Select value={param.target || param.name} onValueChange={(v) => set({ target: v })}>
              <SelectTrigger id={`${id}-target`} className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {inputs.map((a) => (
                  <SelectItem key={a.name} value={a.name}>
                    {a.name} ({a.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id={`${id}-target-error`} message={err('target')} />
          </div>
        )}
        {numeric && text('min', t('min'))}
        {numeric && text('max', t('max'))}
        {param.type === 'string' && text('minLength', t('minLength'))}
        {param.type === 'string' && text('maxLength', t('maxLength'))}
        {param.type === 'string' && text('pattern', t('pattern'), { mono: true, placeholder: '^C\\d{5}$' })}
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${id}-enum`} className="text-xs">
            {t('enum')}
          </Label>
          <Input
            // Edited as text, applied on blur; a new key re-reads it when the list changes elsewhere.
            key={param.enum?.join('|') ?? ''}
            id={`${id}-enum`}
            className="h-8"
            defaultValue={param.enum?.join(', ') ?? ''}
            placeholder="north, south"
            aria-describedby={`${id}-enum-hint`}
            onBlur={(e) => {
              const values = e.target.value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean);
              set({ enum: values.length ? values : null });
            }}
          />
          <p id={`${id}-enum-hint`} className="text-xs text-muted-foreground">
            {t('enumHint')}
          </p>
          <FieldError id={`${id}-enum-error`} message={err('enum')} />
        </div>
      </div>
    </li>
  );
}

/** The typed parameters of a draft. */
export function ParamsEditor({
  params,
  onChange,
  procedure,
  errors,
}: {
  params: ParamDef[];
  onChange: (params: ParamDef[]) => void;
  procedure: ProcedureDef | null;
  errors: Errors;
}) {
  const t = useTranslations('etl.params');
  const add = () => {
    let n = params.length + 1;
    while (params.some((p) => p.name === `param${n}`)) n++;
    onChange([...params, newParam(`param${n}`)]);
  };
  return (
    <div className="grid min-w-0 gap-3">
      {params.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="grid min-w-0 gap-3" aria-label={t('title')}>
          {params.map((p, i) => (
            <ParamRow
              // Index keys: names change while typing.
              key={i}
              index={i}
              param={p}
              procedure={procedure}
              errors={errors}
              onChange={(next) => onChange(params.map((x, j) => (j === i ? next : x)))}
              onRemove={() => onChange(params.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <PlusIcon /> {t('add')}
        </Button>
      </div>
    </div>
  );
}
