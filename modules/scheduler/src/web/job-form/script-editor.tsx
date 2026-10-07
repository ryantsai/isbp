'use client';

import { cn } from '@isbp/ui';
import { CodeEditor } from '@isbp/ui/code-editor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { ShieldAlertIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { SCRIPT_LANGUAGES, type SandboxStatus, type ScriptLanguage } from '../../contracts';
import { type EditorProps, FormRow, NumberInput, type Pair, PairsEditor } from './fields';

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
export function RunnerNotice({ sandbox, className }: { sandbox: SandboxStatus; className?: string }) {
  const t = useTranslations('scheduler.script');
  const none = sandbox.runner === 'none';
  const local = !none && !sandbox.isolated;
  const Icon = none || local ? (none ? ShieldAlertIcon : TriangleAlertIcon) : ShieldCheckIcon;
  return (
    <p
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        none
          ? 'border-destructive/30 bg-destructive/5 text-destructive dark:bg-destructive/10'
          : local
            ? 'border-warning/40 bg-warning/10 text-warning-foreground'
            : 'border-success/30 bg-success/5 text-success',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {none ? t('runnerNone') : local ? t('runnerLocal') : t('runnerIsolated', { runner: sandbox.runner })}
    </p>
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
    <div className="grid min-w-0 gap-5">
      <RunnerNotice sandbox={sandbox} />
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <FormRow label={t('language')} error={errors.language}>
          {({ id: fid }) => (
            <Select
              value={c.language}
              onValueChange={(v) => changeLanguage(v as ScriptLanguage)}
              disabled={disabled}
            >
              <SelectTrigger id={fid} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCRIPT_LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`languages.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormRow>
        <FormRow label={t('image')} error={errors.image} className="sm:col-span-2">
          {({ id: fid, invalid }) => (
            <Select value={c.image ?? ''} onValueChange={(v) => set({ image: v })} disabled={disabled}>
              <SelectTrigger
                id={fid}
                className="w-full font-mono text-xs"
                aria-invalid={invalid || undefined}
              >
                <SelectValue placeholder={t('pickImage')} />
              </SelectTrigger>
              <SelectContent>
                {sandbox.images.map((img) => (
                  <SelectItem key={img} value={img} className="font-mono text-xs">
                    {img}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormRow>
      </div>

      <div className="grid min-w-0 gap-2">
        <p
          id={`${id}-script`}
          className={errors.script ? 'text-sm font-medium text-destructive' : 'text-sm font-medium'}
        >
          {t('script')}
        </p>
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
        <p id={`${id}-script-hint`} className="text-xs text-muted-foreground">
          {t('scriptHint')}
        </p>
        {errors.script && <p className="text-xs font-medium text-destructive">{errors.script}</p>}
      </div>

      <div className="grid min-w-0 gap-2">
        <p className="text-sm font-medium">{t('env')}</p>
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
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormRow label={t('timeout')} error={errors.timeoutSeconds}>
          {({ id: fid, invalid }) => (
            <NumberInput
              id={fid}
              value={String(c.timeoutSeconds ?? '')}
              onChange={(v) => set({ timeoutSeconds: v === '' ? '' : Number(v) })}
              min={1}
              max={3600}
              invalid={invalid}
              disabled={disabled}
              className="sm:w-full"
            />
          )}
        </FormRow>
        <FormRow label={t('cpu')} error={errors.cpu}>
          {({ id: fid, invalid }) => (
            <NumberInput
              id={fid}
              value={String(c.cpu ?? '')}
              onChange={(v) => set({ cpu: v === '' ? '' : Number(v) })}
              min={0.1}
              max={2}
              step={0.1}
              invalid={invalid}
              disabled={disabled}
              className="sm:w-full"
            />
          )}
        </FormRow>
        <FormRow label={t('memory')} error={errors.memoryMb}>
          {({ id: fid, invalid }) => (
            <NumberInput
              id={fid}
              value={String(c.memoryMb ?? '')}
              onChange={(v) => set({ memoryMb: v === '' ? '' : Number(v) })}
              min={32}
              max={2048}
              step={32}
              invalid={invalid}
              disabled={disabled}
              className="sm:w-full"
            />
          )}
        </FormRow>
        <FormRow label={t('network')} hint={t(`networkHint.${c.network === 'egress' ? 'egress' : 'none'}`)}>
          {({ id: fid, describedBy }) => (
            <Select value={c.network} onValueChange={(v) => set({ network: v })} disabled={disabled}>
              <SelectTrigger id={fid} className="w-full" aria-describedby={describedBy}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('networks.none')}</SelectItem>
                <SelectItem value="egress">{t('networks.egress')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormRow>
      </div>
    </div>
  );
}
