'use client';

import {
  type CreateIdpInput,
  createIdpSchema,
  type Group,
  type IdentityProvider,
  ldapConfigSchema,
  oidcConfigSchema,
  samlConfigSchema,
  type UpdateIdpInput,
  updateIdpSchema,
} from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckBigIcon,
  LockIcon,
  PlugZapIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  type Control,
  type FieldErrors,
  type FieldPath,
  type FieldPathByValue,
  useFieldArray,
  useForm,
  useWatch,
} from 'react-hook-form';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { type FieldProblem, problemResolver, type ValidationText, zodProblems } from './contract-resolver';
import { CRON_PRESETS, isCronLike } from './cron';
import { EndpointList } from './endpoints';
import { type IdpChoice, IdpTypeTile, typeOfChoice } from './idp-meta';
import { useCronText } from './use-cron-text';

/* ───────────────────────── form model ───────────────────────── */

export interface IdpFormValues {
  name: string;
  key: string;
  /** Entra helper: builds `config.issuer`. */
  tenantId: string;
  /** Write-only: OIDC client secret or LDAP bind password. Empty = keep the stored one. */
  secret: string;
  /** Comma/space separated; becomes `config.allowedDomains`. */
  allowedDomains: string;
  displayOrder: string;
  jitProvisioning: boolean;
  defaultDepartmentId: string | null;
  groupMappings: { external: string; groupId: string }[];
  syncEnabled: boolean;
  syncCron: string;
  config: {
    issuer: string;
    clientId: string;
    scopes: string;
    claims: { email: string; name: string; username: string; groups: string };
    entryPoint: string;
    idpCertificate: string;
    wantAssertionsSigned: boolean;
    attributes: { email: string; name: string; username: string; groups: string; memberOf: string };
    url: string;
    bindDn: string;
    baseDn: string;
    userFilter: string;
    groupBaseDn: string;
    groupFilter: string;
    /** Maps to `config.tls.rejectUnauthorized`. */
    rejectUnauthorized: boolean;
  };
}

const ENTRA_CLAIMS = { email: 'email', name: 'name', username: 'preferred_username', groups: 'groups' };
const AD_USER_FILTER = '(&(objectClass=user)(sAMAccountName={{username}}))';
const DEFAULT_SCOPES = 'openid profile email';
const DEFAULT_CRON = '0 */6 * * *';
const entraIssuer = (tenant: string) => `https://login.microsoftonline.com/${tenant}/v2.0`;
const ENTRA_ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0\/?$/;
const configSchemas = { oidc: oidcConfigSchema, saml: samlConfigSchema, ldap: ldapConfigSchema } as const;
const SECRET_KEY = { oidc: 'clientSecret', ldap: 'bindPassword', saml: null } as const;

function blank(choice: IdpChoice, entraName: string): IdpFormValues {
  return {
    name: choice === 'entra' ? entraName : '',
    key: '',
    tenantId: '',
    secret: '',
    allowedDomains: '',
    displayOrder: '0',
    jitProvisioning: true,
    defaultDepartmentId: null,
    groupMappings: [],
    syncEnabled: false,
    syncCron: DEFAULT_CRON,
    config: {
      issuer: '',
      clientId: '',
      scopes: DEFAULT_SCOPES,
      claims: choice === 'entra' ? { ...ENTRA_CLAIMS } : { email: '', name: '', username: '', groups: '' },
      entryPoint: '',
      idpCertificate: '',
      wantAssertionsSigned: true,
      attributes: { email: '', name: '', username: '', groups: '', memberOf: '' },
      url: '',
      bindDn: '',
      baseDn: '',
      userFilter: choice === 'ldap' ? AD_USER_FILTER : '',
      groupBaseDn: '',
      groupFilter: '',
      rejectUnauthorized: true,
    },
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function fromProvider(idp: IdentityProvider): IdpFormValues {
  const c = idp.config;
  const claims = obj(c.claims);
  const attrs = obj(c.attributes);
  return {
    name: idp.name,
    key: idp.key,
    tenantId: ENTRA_ISSUER_RE.exec(str(c.issuer))?.[1] ?? '',
    secret: '',
    allowedDomains: Array.isArray(c.allowedDomains) ? c.allowedDomains.join(', ') : '',
    displayOrder: String(idp.displayOrder),
    jitProvisioning: idp.jitProvisioning,
    defaultDepartmentId: idp.defaultDepartmentId,
    groupMappings: idp.groupMappings.map((m) => ({ ...m })),
    syncEnabled: idp.syncEnabled,
    syncCron: idp.syncCron ?? DEFAULT_CRON,
    config: {
      issuer: str(c.issuer),
      clientId: str(c.clientId),
      scopes: str(c.scopes),
      claims: {
        email: str(claims.email),
        name: str(claims.name),
        username: str(claims.username),
        groups: str(claims.groups),
      },
      entryPoint: str(c.entryPoint),
      idpCertificate: str(c.idpCertificate),
      wantAssertionsSigned: c.wantAssertionsSigned !== false,
      attributes: {
        email: str(attrs.email),
        name: str(attrs.name),
        username: str(attrs.username),
        groups: str(attrs.groups),
        memberOf: str(attrs.memberOf),
      },
      url: str(c.url),
      bindDn: str(c.bindDn),
      baseDn: str(c.baseDn),
      userFilter: str(c.userFilter),
      groupBaseDn: str(c.groupBaseDn),
      groupFilter: str(c.groupFilter),
      rejectUnauthorized: obj(c.tls).rejectUnauthorized !== false,
    },
  };
}

function splitDomains(text: string): string[] {
  const list = text
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return [...new Set(list)];
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

/** Config object for the API. On edit, cleared optional strings are sent as '' because the API merges shallowly. */
function buildConfig(choice: IdpChoice, v: IdpFormValues, editing: boolean): Record<string, unknown> {
  const c = v.config;
  const opt = (x: string) => (x.trim() ? x.trim() : editing ? '' : undefined);
  const pick = (o: Record<string, string>, keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, (o[k] ?? '').trim()] as const).filter(([, x]) => x));
  const type = typeOfChoice(choice);
  if (type === 'oidc') {
    const domains = splitDomains(v.allowedDomains);
    return {
      issuer: c.issuer.trim(),
      clientId: c.clientId.trim(),
      scopes: opt(c.scopes),
      claims: pick(c.claims, ['email', 'name', 'username', 'groups']),
      allowedDomains: domains.length || editing ? domains : undefined,
      preset: choice === 'entra' ? 'entra' : 'generic',
    };
  }
  if (type === 'saml') {
    return {
      entryPoint: c.entryPoint.trim(),
      issuer: c.issuer.trim(),
      idpCertificate: c.idpCertificate.trim(),
      attributes: pick(c.attributes, ['email', 'name', 'username', 'groups']),
      wantAssertionsSigned: c.wantAssertionsSigned,
    };
  }
  return {
    url: c.url.trim(),
    bindDn: c.bindDn.trim(),
    baseDn: c.baseDn.trim(),
    userFilter: c.userFilter.trim(),
    groupBaseDn: opt(c.groupBaseDn),
    groupFilter: opt(c.groupFilter),
    attributes: pick(c.attributes, ['username', 'email', 'name', 'memberOf']),
    tls: { rejectUnauthorized: c.rejectUnauthorized },
  };
}

function common(choice: IdpChoice, v: IdpFormValues) {
  const ldap = typeOfChoice(choice) === 'ldap';
  return {
    name: v.name.trim(),
    jitProvisioning: v.jitProvisioning,
    defaultDepartmentId: v.defaultDepartmentId,
    groupMappings: v.groupMappings.map((m) => ({ external: m.external.trim(), groupId: m.groupId })),
    syncEnabled: ldap ? v.syncEnabled : false,
    syncCron: ldap && v.syncCron.trim() ? v.syncCron.trim() : null,
    displayOrder: Number.parseInt(v.displayOrder, 10) || 0,
  };
}

function buildCreate(choice: IdpChoice, v: IdpFormValues): CreateIdpInput {
  const type = typeOfChoice(choice);
  const secretKey = SECRET_KEY[type];
  return {
    type,
    key: v.key.trim(),
    enabled: false,
    ...common(choice, v),
    config: buildConfig(choice, v, false),
    secrets: secretKey && v.secret ? { [secretKey]: v.secret } : undefined,
  } as CreateIdpInput;
}

function buildUpdate(choice: IdpChoice, v: IdpFormValues): UpdateIdpInput {
  const secretKey = SECRET_KEY[typeOfChoice(choice)];
  return {
    ...common(choice, v),
    config: buildConfig(choice, v, true),
    secrets: secretKey && v.secret ? { [secretKey]: v.secret } : undefined,
  };
}

/** API payload path → form field. */
function fieldFor(path: string, choice: IdpChoice, v?: IdpFormValues): string | null {
  if (path === 'type' || path === 'enabled') return null;
  if (path.startsWith('secrets')) return 'secret';
  if (path.startsWith('config.allowedDomains')) return 'allowedDomains';
  if (path.startsWith('config.tls')) return 'config.rejectUnauthorized';
  if (path === 'config.issuer' && choice === 'entra' && (!v || !v.tenantId.trim())) return 'tenantId';
  return path;
}

const ADVANCED_TOP = [
  'allowedDomains',
  'groupMappings',
  'syncCron',
  'syncEnabled',
  'displayOrder',
  'jitProvisioning',
  'defaultDepartmentId',
] as const;
const ADVANCED_CONFIG = [
  'scopes',
  'claims',
  'attributes',
  'groupBaseDn',
  'groupFilter',
  'rejectUnauthorized',
  'wantAssertionsSigned',
] as const;

function hasAdvancedError(errors: FieldErrors<IdpFormValues>, choice: IdpChoice) {
  if (ADVANCED_TOP.some((k) => errors[k])) return true;
  const cfg = errors.config as Record<string, unknown> | undefined;
  if (!cfg) return false;
  return ADVANCED_CONFIG.some((k) => cfg[k]) || (choice === 'entra' && Boolean(cfg.issuer));
}

/* ───────────────────────── field helpers ───────────────────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-xs font-semibold text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="pt-2 text-sm font-medium">{children}</h4>;
}

function TextField({
  control,
  name,
  label,
  description,
  placeholder,
  mono,
  multiline,
  type = 'text',
  autoComplete = 'off',
}: {
  control: Control<IdpFormValues>;
  name: FieldPathByValue<IdpFormValues, string>;
  label: ReactNode;
  description?: ReactNode;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? (
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder={placeholder}
                rows={5}
                className={mono ? 'font-mono text-xs' : undefined}
                spellCheck={false}
              />
            ) : (
              <Input
                {...field}
                value={field.value ?? ''}
                type={type}
                placeholder={placeholder}
                autoComplete={autoComplete}
                spellCheck={false}
                className={mono ? 'font-mono text-xs md:text-xs' : undefined}
              />
            )}
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SwitchField({
  control,
  name,
  label,
  description,
}: {
  control: Control<IdpFormValues>;
  name: FieldPathByValue<IdpFormValues, boolean>;
  label: string;
  description?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

function SecretField({
  control,
  label,
  hint,
  stored,
}: {
  control: Control<IdpFormValues>;
  label: string;
  hint?: string;
  stored: boolean;
}) {
  const t = useTranslations('idp.form');
  return (
    <FormField
      control={control}
      name="secret"
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label}
            {stored && (
              <Badge variant="muted" className="font-normal">
                <LockIcon aria-hidden /> {t('secretStoredBadge')}
              </Badge>
            )}
          </FormLabel>
          <FormControl>
            <Input
              {...field}
              type="password"
              autoComplete="new-password"
              placeholder={stored ? t('secretStored') : undefined}
              spellCheck={false}
            />
          </FormControl>
          {(stored || hint) && <FormDescription>{stored ? t('secretKeep') : hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function MappingFields({
  control,
  prefix,
  keys,
  placeholders,
}: {
  control: Control<IdpFormValues>;
  prefix: 'config.claims' | 'config.attributes';
  keys: readonly string[];
  placeholders: Record<string, string>;
}) {
  const t = useTranslations('idp.form.mapping');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {keys.map((k) => (
        <TextField
          key={k}
          control={control}
          name={`${prefix}.${k}` as FieldPathByValue<IdpFormValues, string>}
          label={t(k)}
          placeholder={placeholders[k]}
          mono
        />
      ))}
    </div>
  );
}

function GroupMappingsField({
  control,
  choice,
  enabled,
}: {
  control: Control<IdpFormValues>;
  choice: IdpChoice;
  enabled: boolean;
}) {
  const t = useTranslations('idp.form');
  const { fields, append, remove } = useFieldArray({ control, name: 'groupMappings' });
  const groups = useApiQuery<Page<Group>>(enabled ? '/groups' : null, { pageSize: 100, sort: 'name' });
  const options = (groups.data?.items ?? []).filter((g) => !g.isSystem);
  return (
    <div className="space-y-3">
      <div>
        <SubHeading>{t('groupMappings')}</SubHeading>
        <p className="mt-1 text-xs text-muted-foreground">{t('groupMappingsHint')}</p>
      </div>
      {fields.length > 0 && (
        <div
          className="hidden grid-cols-[1fr_1rem_1fr_2.25rem] gap-2 text-xs text-muted-foreground sm:grid"
          aria-hidden
        >
          <span>{t('externalValue')}</span>
          <span />
          <span>{t('mappedGroup')}</span>
        </div>
      )}
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {fields.map((f, i) => (
            <motion.li
              key={f.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-[1fr_2.25rem] gap-2 sm:grid-cols-[1fr_1rem_1fr_2.25rem] sm:items-start">
                <FormField
                  control={control}
                  name={`groupMappings.${i}.external`}
                  render={({ field }) => (
                    <FormItem className="gap-1">
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t(`externalPlaceholder.${choice}`)}
                          aria-label={t('externalValue')}
                          className="font-mono text-xs md:text-xs"
                          spellCheck={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <ArrowRightIcon className="mt-2.5 hidden size-4 text-muted-foreground sm:block" aria-hidden />
                <FormField
                  control={control}
                  name={`groupMappings.${i}.groupId`}
                  render={({ field }) => (
                    <FormItem className="col-start-1 gap-1 sm:col-start-auto">
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full" aria-label={t('mappedGroup')}>
                            <SelectValue placeholder={t('chooseGroup')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-72">
                          {field.value && !options.some((g) => g.id === field.value) && (
                            <SelectItem value={field.value}>{t('unknownGroup')}</SelectItem>
                          )}
                          {options.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(i)}
                  aria-label={t('removeMapping')}
                  className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
                >
                  <XIcon />
                </Button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => append({ external: '', groupId: '' })}>
        <PlusIcon /> {t('addMapping')}
      </Button>
    </div>
  );
}

function CronField({ control }: { control: Control<IdpFormValues> }) {
  const t = useTranslations('idp');
  const describe = useCronText();
  return (
    <FormField
      control={control}
      name="syncCron"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('form.syncSchedule')}</FormLabel>
          <div role="group" aria-label={t('form.syncPresets')} className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={field.value.trim() === p.cron}
                onClick={() => field.onChange(p.cron)}
                className="rounded-full border px-2.5 py-1 text-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
              >
                {t(`cron.presets.${p.id}`)}
              </button>
            ))}
          </div>
          <FormControl>
            <Input
              {...field}
              placeholder={DEFAULT_CRON}
              className="font-mono text-xs md:text-xs"
              spellCheck={false}
            />
          </FormControl>
          <FormDescription>
            {describe(field.value) ? `${describe(field.value)} · ` : ''}
            {t('form.cronHint')}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/* ───────────────────────── sheet ───────────────────────── */

/**
 * Step 2 of adding a provider (type-specific form), or editing one. Essentials up front; mappings,
 * provisioning and sync behind "advanced". After creation the sheet shows the values to register
 * in the identity provider and the next steps.
 */
export function IdpFormSheet({
  open,
  onOpenChange,
  choice,
  provider,
  onBack,
  onTest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choice: IdpChoice;
  provider?: IdentityProvider;
  onBack?: () => void;
  onTest: (provider: IdentityProvider) => void;
}) {
  const t = useTranslations('idp');
  const tf = useTranslations('idp.form');
  const tv = useTranslations('idp.validation');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const editing = Boolean(provider);
  const type = typeOfChoice(choice);
  const [advanced, setAdvanced] = useState(false);
  const [created, setCreated] = useState<IdentityProvider | null>(null);

  const vt: ValidationText = useCallback((key, values) => tv(key, values), [tv]);

  const messageFor = (issue: { code: string }, field: string): string | undefined => {
    if (field === 'key' && issue.code === 'invalid_format') return tv('key');
    if (field === 'config.url' && issue.code === 'invalid_format') return tv('ldapUrl');
    if (field === 'config.idpCertificate' && issue.code === 'too_small') return tv('certificate');
    if (/^groupMappings\.\d+\.groupId$/.test(field)) return tv('chooseGroup');
    if (field === 'tenantId') return tv('required');
    return undefined;
  };

  const validate = (v: IdpFormValues): FieldProblem[] => {
    const problems: FieldProblem[] = [];
    const mapPath = (p: string) => fieldFor(p, choice, v);
    if (!/^-?\d+$/.test(v.displayOrder.trim()))
      problems.push({ path: 'displayOrder', message: tv('integer') });
    if (type === 'ldap' && v.syncEnabled && !isCronLike(v.syncCron))
      problems.push({ path: 'syncCron', message: tv('cron') });
    if (choice === 'entra' && !v.tenantId.trim() && !v.config.issuer.trim())
      problems.push({ path: 'tenantId', message: tv('required') });
    if (editing) {
      const body = updateIdpSchema.safeParse(buildUpdate(choice, v));
      const cfg = configSchemas[type].safeParse(buildConfig(choice, v, true));
      problems.push(...zodProblems(body.error?.issues, vt, { mapPath, message: messageFor }));
      problems.push(
        ...zodProblems(cfg.error?.issues, vt, {
          mapPath: (p) => mapPath(`config.${p}`),
          message: messageFor,
        }),
      );
    } else {
      const res = createIdpSchema.safeParse(buildCreate(choice, v));
      problems.push(...zodProblems(res.error?.issues, vt, { mapPath, message: messageFor }));
    }
    return problems;
  };

  const form = useForm<IdpFormValues>({
    defaultValues: blank(choice, tf('entra.defaultName')),
    resolver: problemResolver(validate),
  });

  useEffect(() => {
    if (!open) return;
    setAdvanced(false);
    setCreated(null);
    form.reset(provider ? fromProvider(provider) : blank(choice, tf('entra.defaultName')));
    // Reset only when (re)opening for another provider/kind — not on background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider?.id, choice]);

  // Suggest the key from the name until the admin edits it.
  const name = useWatch({ control: form.control, name: 'name' });
  useEffect(() => {
    if (editing || form.getFieldState('key').isDirty) return;
    form.setValue('key', slugify(name ?? ''));
  }, [name, editing, form]);

  // SAML: suggest this platform's entity ID from the key.
  const key = useWatch({ control: form.control, name: 'key' });
  useEffect(() => {
    if (editing || type !== 'saml' || form.getFieldState('config.issuer').isDirty) return;
    form.setValue('config.issuer', key ? `${window.location.origin}/api/v1/auth/sso/${key}/metadata` : '');
  }, [key, editing, type, form]);

  // Entra: the tenant ID builds the issuer (unless the issuer was overridden in advanced options).
  const tenantId = useWatch({ control: form.control, name: 'tenantId' });
  useEffect(() => {
    if (
      choice !== 'entra' ||
      !form.getFieldState('tenantId').isDirty ||
      form.getFieldState('config.issuer').isDirty
    )
      return;
    const tid = (tenantId ?? '').trim();
    form.setValue('config.issuer', tid ? entraIssuer(tid) : '');
  }, [tenantId, choice, form]);
  const issuer = useWatch({ control: form.control, name: 'config.issuer' });
  const [allowedDomains, groupMappings, defaultDepartmentId, groupBaseDn, groupFilter] = useWatch({
    control: form.control,
    name: [
      'allowedDomains',
      'groupMappings',
      'defaultDepartmentId',
      'config.groupBaseDn',
      'config.groupFilter',
    ],
  });
  const attributes = useWatch({ control: form.control, name: 'config.attributes' });

  const create = useApiMutation(
    (api, body: CreateIdpInput) => api.post<IdentityProvider>('/identity-providers', body),
    {
      invalidate: ['/identity-providers'],
      success: (r) => tf('createdToast', { name: r.name }),
      onSuccess: (r) => setCreated(r),
      silent: true,
    },
  );
  const update = useApiMutation(
    (api, body: UpdateIdpInput) => api.patch<IdentityProvider>(`/identity-providers/${provider!.id}`, body),
    {
      invalidate: ['/identity-providers'],
      success: (r) => tf('savedToast', { name: r.name }),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const mutation = editing ? update : create;

  const applyError = (err: unknown, values: IdpFormValues) => {
    if (err instanceof ApiError) {
      const details = err.details as
        | { issues?: { path: string | (string | number)[]; message: string }[]; constraint?: string }
        | undefined;
      if (err.status === 409 && (details?.constraint ?? '').includes('key')) {
        form.setError('key', { message: tv('keyTaken') });
        return;
      }
      const issues = details?.issues ?? [];
      if (issues.length) {
        for (const issue of issues) {
          const raw = Array.isArray(issue.path) ? `config.${issue.path.join('.')}` : issue.path;
          const field = fieldFor(raw, choice, values);
          if (field) form.setError(field as FieldPath<IdpFormValues>, { message: issue.message });
        }
        if (hasAdvancedError(form.formState.errors, choice)) setAdvanced(true);
        return;
      }
    }
    form.setError('root', { message: errorText(err) });
  };

  const onSubmit = form.handleSubmit(
    async (values) => {
      try {
        if (editing) await update.mutateAsync(buildUpdate(choice, values));
        else await create.mutateAsync(buildCreate(choice, values));
      } catch (err) {
        applyError(err, values);
      }
    },
    (errors) => {
      if (hasAdvancedError(errors, choice)) setAdvanced(true);
    },
  );

  const secretKey = SECRET_KEY[type];
  const secretStored = Boolean(editing && secretKey && provider?.secretKeys.includes(secretKey));
  const title = created
    ? t('created.sheetTitle')
    : editing
      ? tf('editTitle', { name: provider!.name })
      : tf(`createTitle.${choice}`);
  const description = created
    ? t('created.sheetDescription')
    : editing
      ? tf('editDescription')
      : tf(`createDescription.${choice}`);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader className="gap-3">
          {!editing && !created && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <ArrowLeftIcon className="size-3.5" aria-hidden /> {t('create.changeType')}
                </button>
              )}
              <span className="font-medium">{t('create.step', { step: 2, total: 2 })}</span>
            </div>
          )}
          <div className="flex items-center gap-3 pr-8">
            <IdpTypeTile choice={choice} className="size-9" />
            <div className="min-w-0">
              <SheetTitle className="truncate">{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <AnimatePresence mode="wait" initial={false}>
          {created ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <SheetBody className="space-y-5 py-2">
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <motion.span
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.1 }}
                    className="grid size-12 place-items-center rounded-full bg-success/12 text-success"
                  >
                    <CircleCheckBigIcon className="size-6" aria-hidden />
                  </motion.span>
                  <div className="space-y-1">
                    <p className="text-lg font-semibold">{t('created.title', { name: created.name })}</p>
                    <p className="text-sm text-muted-foreground">{t('created.body')}</p>
                  </div>
                </div>
                <ol className="space-y-5">
                  {[
                    Object.keys(created.endpoints).length > 0 && {
                      title: t(`created.register.${created.type}`),
                      body: <EndpointList endpoints={created.endpoints} title={false} />,
                    },
                    {
                      title: t('created.test'),
                      body: (
                        <Button variant="outline" size="sm" onClick={() => onTest(created)}>
                          <PlugZapIcon /> {t('actions.test')}
                        </Button>
                      ),
                    },
                    {
                      title: t('created.enable'),
                      body: <p className="text-sm text-muted-foreground">{t('created.enableHint')}</p>,
                    },
                  ]
                    .filter((s): s is { title: string; body: ReactElement } => Boolean(s))
                    .map((step, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1 space-y-2">
                          <p className="text-sm font-medium">{step.title}</p>
                          {step.body}
                        </div>
                      </li>
                    ))}
                </ol>
              </SheetBody>
              <SheetFooter>
                <Button onClick={() => onOpenChange(false)}>{t('created.done')}</Button>
              </SheetFooter>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <Form {...form}>
                <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
                  <SheetBody className="space-y-7 py-2">
                    {editing && provider && Object.keys(provider.endpoints).length > 0 && (
                      <EndpointList
                        endpoints={provider.endpoints}
                        className="rounded-lg border bg-card p-3"
                      />
                    )}

                    <Section title={tf('sections.basics')}>
                      <TextField
                        control={form.control}
                        name="name"
                        label={tf('name')}
                        placeholder={tf(`namePlaceholder.${choice}`)}
                        description={tf('nameHint')}
                      />
                      {editing ? (
                        <div className="grid gap-2">
                          <span className="text-sm font-medium">{tf('key')}</span>
                          <code className="w-fit rounded bg-muted px-2 py-1 font-mono text-xs">
                            {provider!.key}
                          </code>
                          <p className="text-xs text-muted-foreground">{tf('keyLocked')}</p>
                        </div>
                      ) : (
                        <TextField
                          control={form.control}
                          name="key"
                          label={tf('key')}
                          description={tf('keyHint')}
                          mono
                        />
                      )}
                    </Section>

                    <Section title={tf('sections.connection')}>
                      {choice === 'entra' && (
                        <>
                          <TextField
                            control={form.control}
                            name="tenantId"
                            label={tf('entra.tenantId')}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            description={
                              issuer ? tf('entra.issuerPreview', { issuer }) : tf('entra.tenantHint')
                            }
                            mono
                          />
                          <TextField
                            control={form.control}
                            name="config.clientId"
                            label={tf('entra.clientId')}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            mono
                          />
                          <SecretField
                            control={form.control}
                            label={tf('entra.clientSecret')}
                            hint={tf('entra.clientSecretHint')}
                            stored={secretStored}
                          />
                        </>
                      )}
                      {choice === 'oidc' && (
                        <>
                          <TextField
                            control={form.control}
                            name="config.issuer"
                            label={tf('oidc.issuer')}
                            placeholder="https://idp.example.com"
                            description={tf('oidc.issuerHint')}
                            mono
                          />
                          <TextField
                            control={form.control}
                            name="config.clientId"
                            label={tf('oidc.clientId')}
                            mono
                          />
                          <SecretField
                            control={form.control}
                            label={tf('oidc.clientSecret')}
                            hint={tf('oidc.clientSecretHint')}
                            stored={secretStored}
                          />
                        </>
                      )}
                      {choice === 'saml' && (
                        <>
                          <TextField
                            control={form.control}
                            name="config.entryPoint"
                            label={tf('saml.entryPoint')}
                            placeholder="https://idp.example.com/saml/sso"
                            description={tf('saml.entryPointHint')}
                            mono
                          />
                          <TextField
                            control={form.control}
                            name="config.issuer"
                            label={tf('saml.issuer')}
                            description={tf('saml.issuerHint')}
                            mono
                          />
                          <TextField
                            control={form.control}
                            name="config.idpCertificate"
                            label={tf('saml.certificate')}
                            placeholder="-----BEGIN CERTIFICATE-----"
                            description={tf('saml.certificateHint')}
                            mono
                            multiline
                          />
                        </>
                      )}
                      {choice === 'ldap' && (
                        <>
                          <TextField
                            control={form.control}
                            name="config.url"
                            label={tf('ldap.url')}
                            placeholder="ldaps://dc01.corp.example:636"
                            description={tf('ldap.urlHint')}
                            mono
                          />
                          <TextField
                            control={form.control}
                            name="config.bindDn"
                            label={tf('ldap.bindDn')}
                            placeholder="CN=svc-isbp,OU=Service Accounts,DC=corp,DC=example"
                            mono
                          />
                          <SecretField
                            control={form.control}
                            label={tf('ldap.bindPassword')}
                            stored={secretStored}
                          />
                          <TextField
                            control={form.control}
                            name="config.baseDn"
                            label={tf('ldap.baseDn')}
                            placeholder="OU=Staff,DC=corp,DC=example"
                            description={tf('ldap.baseDnHint')}
                            mono
                          />
                          <TextField
                            control={form.control}
                            name="config.userFilter"
                            label={tf('ldap.userFilter')}
                            description={tf('ldap.userFilterHint', { token: '{{username}}' })}
                            mono
                          />
                        </>
                      )}
                    </Section>

                    <OptionalFields
                      label={advanced ? tc('hideAdvanced') : tc('showAdvanced')}
                      open={advanced}
                      onOpenChange={setAdvanced}
                      filled={countFilled(
                        allowedDomains,
                        groupMappings,
                        defaultDepartmentId,
                        groupBaseDn,
                        groupFilter,
                        ...Object.values(attributes),
                      )}
                      contentClassName="space-y-4 pt-4"
                    >
                      {type === 'oidc' && (
                        <>
                          {choice === 'entra' && (
                            <TextField
                              control={form.control}
                              name="config.issuer"
                              label={tf('oidc.issuer')}
                              description={tf('entra.issuerOverride')}
                              placeholder={entraIssuer('<tenant-id>')}
                              mono
                            />
                          )}
                          <TextField
                            control={form.control}
                            name="config.scopes"
                            label={tf('oidc.scopes')}
                            placeholder={DEFAULT_SCOPES}
                            mono
                          />
                          <SubHeading>{tf('claimMapping')}</SubHeading>
                          <p className="-mt-2 text-xs text-muted-foreground">{tf('claimMappingHint')}</p>
                          <MappingFields
                            control={form.control}
                            prefix="config.claims"
                            keys={['email', 'name', 'username', 'groups']}
                            placeholders={ENTRA_CLAIMS}
                          />
                          <TextField
                            control={form.control}
                            name="allowedDomains"
                            label={tf('oidc.allowedDomains')}
                            placeholder="example.com, example.co.jp"
                            description={tf('oidc.allowedDomainsHint')}
                          />
                        </>
                      )}
                      {type === 'saml' && (
                        <>
                          <SubHeading>{tf('attributeMapping')}</SubHeading>
                          <p className="-mt-2 text-xs text-muted-foreground">{tf('samlAttributeHint')}</p>
                          <MappingFields
                            control={form.control}
                            prefix="config.attributes"
                            keys={['email', 'name', 'username', 'groups']}
                            placeholders={{
                              email: 'email',
                              name: 'displayName',
                              username: 'upn',
                              groups: 'groups',
                            }}
                          />
                          <SwitchField
                            control={form.control}
                            name="config.wantAssertionsSigned"
                            label={tf('saml.wantAssertionsSigned')}
                            description={tf('saml.wantAssertionsSignedHint')}
                          />
                        </>
                      )}
                      {type === 'ldap' && (
                        <>
                          <SubHeading>{tf('attributeMapping')}</SubHeading>
                          <MappingFields
                            control={form.control}
                            prefix="config.attributes"
                            keys={['username', 'email', 'name', 'memberOf']}
                            placeholders={{
                              username: 'sAMAccountName',
                              email: 'mail',
                              name: 'displayName',
                              memberOf: 'memberOf',
                            }}
                          />
                          <TextField
                            control={form.control}
                            name="config.groupBaseDn"
                            label={tf('ldap.groupBaseDn')}
                            placeholder="OU=Groups,DC=corp,DC=example"
                            mono
                          />
                          <TextField
                            control={form.control}
                            name="config.groupFilter"
                            label={tf('ldap.groupFilter')}
                            placeholder="(objectClass=group)"
                            mono
                          />
                          <SwitchField
                            control={form.control}
                            name="config.rejectUnauthorized"
                            label={tf('ldap.verifyTls')}
                            description={tf('ldap.verifyTlsHint')}
                          />
                        </>
                      )}

                      <SubHeading>{tf('provisioning')}</SubHeading>
                      <SwitchField
                        control={form.control}
                        name="jitProvisioning"
                        label={tf('jit')}
                        description={tf('jitHint')}
                      />
                      <FormField
                        control={form.control}
                        name="defaultDepartmentId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tf('defaultDepartment')}</FormLabel>
                            <FormControl>
                              <DepartmentSelect
                                value={field.value}
                                onChange={field.onChange}
                                noneLabel={tf('noDefaultDepartment')}
                              />
                            </FormControl>
                            <FormDescription>{tf('defaultDepartmentHint')}</FormDescription>
                          </FormItem>
                        )}
                      />
                      <GroupMappingsField control={form.control} choice={choice} enabled={open} />

                      {type === 'ldap' && (
                        <>
                          <SubHeading>{tf('directorySync')}</SubHeading>
                          <SwitchField
                            control={form.control}
                            name="syncEnabled"
                            label={tf('syncEnabled')}
                            description={tf('syncEnabledHint')}
                          />
                          <CronField control={form.control} />
                        </>
                      )}

                      <SubHeading>{tf('display')}</SubHeading>
                      <TextField
                        control={form.control}
                        name="displayOrder"
                        label={tf('displayOrder')}
                        description={tf('displayOrderHint')}
                        type="number"
                      />
                    </OptionalFields>
                    {form.formState.errors.root && (
                      <p role="alert" className="text-sm text-destructive">
                        {form.formState.errors.root.message}
                      </p>
                    )}
                  </SheetBody>
                  <SheetFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                      {tc('cancel')}
                    </Button>
                    <Button type="submit" loading={mutation.isPending}>
                      {editing ? tc('saveChanges') : tf('submitCreate')}
                    </Button>
                  </SheetFooter>
                </form>
              </Form>
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
}
