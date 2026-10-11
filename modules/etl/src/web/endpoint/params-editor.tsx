'use client';

import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { newParam, type ParamDef, PARAM_TYPES, type ProcedureDef } from '../../contracts';

export type Errors = Record<string, string>;

const textOrNull = (v: string) => (v.trim() === '' ? null : v);

/** Allowed values, edited as comma-separated text and applied on blur. */
function EnumInput({
  param,
  label,
  description,
  status,
  onCommit,
}: {
  param: ParamDef;
  label: string;
  description: string;
  status?: { type: 'error'; message: string };
  onCommit: (values: string[] | null) => void;
}) {
  const [text, setText] = useState(param.enum?.join(', ') ?? '');
  return (
    <TextInput
      label={label}
      description={description}
      placeholder="north, south"
      value={text}
      onChange={setText}
      onBlur={() => {
        const values = text
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        onCommit(values.length ? values : null);
      }}
      status={status}
    />
  );
}

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
  const err = (field: string) => {
    const message = errors[`draft.params.${index}.${field}`];
    return message ? { type: 'error' as const, message } : undefined;
  };
  const set = (patch: Partial<ParamDef>) => onChange({ ...param, ...patch });
  const numeric = param.type === 'integer' || param.type === 'number' || param.type === 'decimal';
  const inputs = procedure?.parameters.filter((a) => a.direction !== 'out') ?? [];

  return (
    <li>
      <VStack gap={3} className="min-w-0">
        {index > 0 && <Divider />}
        <Grid columns={{ minWidth: 180 }} gap={3}>
          <TextInput
            label={t('name')}
            value={param.name}
            onChange={(v) => set({ name: v.replace(/[^A-Za-z0-9_]/g, '') })}
            status={err('name')}
          />
          <Selector
            label={t('type')}
            options={PARAM_TYPES.map((type) => ({ value: type, label: t(`types.${type}`) }))}
            value={param.type}
            onChange={(v) => set({ type: v as ParamDef['type'] })}
          />
          <TextInput
            label={t('default')}
            placeholder={param.list ? 'a,b' : undefined}
            value={param.default ?? ''}
            onChange={(v) => set({ default: textOrNull(v) })}
            status={err('default')}
          />
        </Grid>
        <HStack gap={2} wrap="wrap" vAlign="center">
          <CheckboxInput
            label={t('required')}
            value={param.required}
            onChange={(v) => set({ required: v })}
          />
          <CheckboxInput label={t('list')} value={param.list} onChange={(v) => set({ list: v })} />
          <CheckboxInput
            label={t('sensitive')}
            value={param.sensitive}
            onChange={(v) => set({ sensitive: v })}
          />
          <HStack gap={1} className="sm:ml-auto" vAlign="center">
            <Button
              label={t('more')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={open ? ChevronDownIcon : ChevronRightIcon} />}
              type="button"
              aria-expanded={open}
              aria-controls={`${id}-more`}
              onClick={() => setOpen((o) => !o)}
            />
            <IconButton
              label={t('remove', { name: param.name || '?' })}
              variant="ghost"
              size="sm"
              icon={<Icon icon={Trash2Icon} />}
              type="button"
              onClick={onRemove}
            />
          </HStack>
        </HStack>
        <div id={`${id}-more`} hidden={!open}>
          <Grid columns={{ minWidth: 220 }} gap={3}>
            <TextInput
              label={t('description')}
              value={param.description ?? ''}
              onChange={(v) => set({ description: textOrNull(v) })}
              status={err('description')}
            />
            <TextInput
              label={t('example')}
              value={param.example ?? ''}
              onChange={(v) => set({ example: textOrNull(v) })}
              status={err('example')}
            />
            {procedure && (
              <Selector
                label={t('target')}
                options={inputs.map((a) => ({ value: a.name, label: `${a.name} (${a.type})` }))}
                value={param.target || param.name}
                onChange={(v) => set({ target: v })}
                status={err('target')}
              />
            )}
            {numeric && (
              <NumberInput
                label={t('min')}
                hasClear
                value={param.min}
                onChange={(v) => set({ min: v })}
                status={err('min')}
              />
            )}
            {numeric && (
              <NumberInput
                label={t('max')}
                hasClear
                value={param.max}
                onChange={(v) => set({ max: v })}
                status={err('max')}
              />
            )}
            {param.type === 'string' && (
              <NumberInput
                label={t('minLength')}
                hasClear
                isIntegerOnly
                min={0}
                value={param.minLength}
                onChange={(v) => set({ minLength: v })}
                status={err('minLength')}
              />
            )}
            {param.type === 'string' && (
              <NumberInput
                label={t('maxLength')}
                hasClear
                isIntegerOnly
                min={0}
                value={param.maxLength}
                onChange={(v) => set({ maxLength: v })}
                status={err('maxLength')}
              />
            )}
            {param.type === 'string' && (
              <TextInput
                label={t('pattern')}
                placeholder="^C\d{5}$"
                value={param.pattern ?? ''}
                onChange={(v) => set({ pattern: textOrNull(v) })}
                status={err('pattern')}
              />
            )}
            <EnumInput
              // A new key re-reads the text when the list changes elsewhere.
              key={param.enum?.join('|') ?? ''}
              param={param}
              label={t('enum')}
              description={t('enumHint')}
              status={err('enum')}
              onCommit={(values) => set({ enum: values })}
            />
          </Grid>
        </div>
      </VStack>
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
    <VStack gap={3} className="min-w-0">
      {params.length === 0 ? (
        <Text color="secondary">{t('none')}</Text>
      ) : (
        <VStack as="ul" gap={3} className="min-w-0" aria-label={t('title')}>
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
        </VStack>
      )}
      <div>
        <Button
          label={t('add')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          type="button"
          onClick={add}
        />
      </div>
    </VStack>
  );
}
