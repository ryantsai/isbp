'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Field } from '@astryxdesign/core/Field';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { CodeEditor } from '@isbp/ui/code-editor';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { SCRIPT_LANGUAGES, type SandboxStatus, type ScriptLanguage } from '../../contracts';
import { type EditorProps, errorStatus, type Pair, PairsEditor } from './fields';

const SAMPLES: Record<ScriptLanguage, string> = {
  python: "import os\n\nprint(f\"Hello from {os.environ.get('GREETING', 'Python')}\")\n",
  node: "console.log(`Hello from ${process.env.GREETING ?? 'Node.js'}`);\n",
  powershell: 'Write-Output "Hello from $($env:GREETING ?? \'PowerShell\')"\n',
  shell: 'echo "Hello from ${GREETING:-the shell}"\n',
};

const IMAGE_HINT: Record<ScriptLanguage, RegExp> = {
  python: /python/i,
  node: /node/i,
  powershell: /powershell|pwsh/i,
  shell: /alpine|busybox|debian|ubuntu/i,
};

const EDITOR_LANGUAGE = {
  python: 'python',
  node: 'javascript',
  powershell: 'powershell',
  shell: 'shell',
} as const;

export function scriptDefaults(sandbox: SandboxStatus) {
  const image = sandbox.images.find((i) => IMAGE_HINT.python.test(i)) ?? sandbox.images[0] ?? '';
  return {
    language: 'python',
    image,
    script: SAMPLES.python,
    env: [],
    timeoutSeconds: 300,
    cpu: 0.5,
    memoryMb: 256,
    network: 'none',
  };
}

/** Where scripts run: none (can't be enabled), local (not sandboxed), or an isolated container runner. */
export function RunnerNotice({ sandbox }: { sandbox: SandboxStatus }) {
  const t = useTranslations('scheduler.script');
  const none = sandbox.runner === 'none';
  const local = !none && !sandbox.isolated;
  return (
    <Banner
      role="status"
      status={none ? 'error' : local ? 'warning' : 'success'}
      collapsible={false}
      title={
        none ? t('runnerNone') : local ? t('runnerLocal') : t('runnerIsolated', { runner: sandbox.runner })
      }
    />
  );
}

/** A script in an allowed container image, with environment variables (secret ones sealed) and limits. */
export function ScriptEditor({
  value,
  onChange,
  errors,
  disabled,
  sandbox,
}: EditorProps & { sandbox: SandboxStatus }) {
  const t = useTranslations('scheduler.script');
  const id = useId();
  const c = { ...scriptDefaults(sandbox), ...value } as ReturnType<typeof scriptDefaults> & {
    language: ScriptLanguage;
    env: Pair[];
  };
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });
  const changeLanguage = (language: ScriptLanguage) => {
    const image = IMAGE_HINT[language].test(c.image)
      ? c.image
      : (sandbox.images.find((i) => IMAGE_HINT[language].test(i)) ?? c.image);
    const untouched = Object.values(SAMPLES).includes(c.script) || !c.script.trim();
    set({ language, image, ...(untouched ? { script: SAMPLES[language] } : {}) });
  };

  return (
    <VStack gap={5}>
      <RunnerNotice sandbox={sandbox} />
      <Grid columns={{ minWidth: 240, repeat: 'fit' }} gap={4} align="end">
        <Selector
          label={t('language')}
          width="100%"
          value={c.language}
          onChange={(v) => changeLanguage(v as ScriptLanguage)}
          options={SCRIPT_LANGUAGES.map((l) => ({ value: l, label: t(`languages.${l}`) }))}
          status={errorStatus(errors.language)}
          isDisabled={disabled}
        />
        <Selector
          label={t('image')}
          width="100%"
          placeholder={t('pickImage')}
          value={c.image || undefined}
          onChange={(v) => set({ image: v })}
          options={sandbox.images.map((img) => ({ value: img, label: img }))}
          status={errorStatus(errors.image)}
          isDisabled={disabled}
        />
      </Grid>

      <Field
        label={t('script')}
        isGroupLabel
        labelID={`${id}-script`}
        inputID={`${id}-script-editor`}
        description={t('scriptHint')}
        descriptionID={`${id}-script-hint`}
        status={errorStatus(errors.script)}
        statusVariant="detached"
      >
        <CodeEditor
          aria-labelledby={`${id}-script`}
          aria-describedby={`${id}-script-hint`}
          aria-invalid={Boolean(errors.script)}
          value={c.script}
          onChange={(script) => set({ script })}
          language={EDITOR_LANGUAGE[c.language]}
          readOnly={disabled}
          minHeight="10rem"
        />
      </Field>

      <VStack gap={2}>
        <Text weight="medium">{t('env')}</Text>
        <PairsEditor
          items={c.env}
          onChange={(env) => set({ env })}
          errors={errors}
          prefix="env"
          disabled={disabled}
          labels={{
            name: t('envName'),
            value: t('envValue'),
            add: t('addEnv'),
            empty: t('noEnv'),
            remove: t('removeEnv'),
          }}
        />
      </VStack>

      <Grid columns={{ minWidth: 180, repeat: 'fit' }} gap={4} align="end">
        <NumberInput
          label={t('timeout')}
          width="100%"
          min={1}
          max={3600}
          value={typeof c.timeoutSeconds === 'number' ? c.timeoutSeconds : null}
          onChange={(v) => set({ timeoutSeconds: v })}
          status={errorStatus(errors.timeoutSeconds)}
          isDisabled={disabled}
        />
        <NumberInput
          label={t('cpu')}
          width="100%"
          min={0.1}
          max={2}
          step={0.1}
          value={typeof c.cpu === 'number' ? c.cpu : null}
          onChange={(v) => set({ cpu: v })}
          status={errorStatus(errors.cpu)}
          isDisabled={disabled}
        />
        <NumberInput
          label={t('memory')}
          width="100%"
          min={32}
          max={2048}
          step={32}
          value={typeof c.memoryMb === 'number' ? c.memoryMb : null}
          onChange={(v) => set({ memoryMb: v })}
          status={errorStatus(errors.memoryMb)}
          isDisabled={disabled}
        />
        <Selector
          label={t('network')}
          description={t(`networkHint.${c.network === 'egress' ? 'egress' : 'none'}`)}
          width="100%"
          value={c.network}
          onChange={(v) => set({ network: v })}
          options={[
            { value: 'none', label: t('networks.none') },
            { value: 'egress', label: t('networks.egress') },
          ]}
          isDisabled={disabled}
        />
      </Grid>
    </VStack>
  );
}
