'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { DownloadButton } from '@isbp/ui/download-button';
import { EmptyState } from '@isbp/ui/empty-state';
import { toast } from '@isbp/ui/toast';
import { CopyIcon, FileJsonIcon, FileTextIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { type EndpointDetail, exampleResponse, type ParamDef, sampleValue } from '../../contracts';
import { MethodBadge, VersionStatusBadge } from '../badges';
import { copyText, dataUrl, useOrigin } from '../lib';

const LATEST = 'latest';

interface ParamRow extends Record<string, unknown> {
  name: string;
  type: string;
  required: string;
  details: string;
}

/** `curl` for a version: query string for GET, a JSON body for POST; the API key is a placeholder. */
export function curlExample(
  origin: string,
  slug: string,
  method: 'GET' | 'POST',
  params: ParamDef[],
  version?: number,
) {
  const url = `${origin}${dataUrl(slug, version)}`;
  const auth = `-H "Authorization: Bearer <your API key>"`;
  const shown = params.filter((p) => p.required || p.example);
  if (method === 'GET') {
    const qs = new URLSearchParams();
    for (const p of shown)
      for (const v of p.list ? sampleValue(p).split(',') : [sampleValue(p)]) qs.append(p.name, v.trim());
    const q = qs.toString();
    return `curl ${auth} \\\n  "${url}${q ? `?${q}` : ''}"`;
  }
  const body = Object.fromEntries(
    shown.map((p) => {
      const raw = sampleValue(p);
      const typed = (v: string) =>
        p.type === 'integer' || p.type === 'number' ? Number(v) : p.type === 'boolean' ? v === 'true' : v;
      return [p.name, p.list ? raw.split(',').map((v) => typed(v.trim())) : typed(raw)];
    }),
  );
  return `curl -X POST ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}' \\\n  "${url}"`;
}

function CopyBlock({ label, value, language }: { label: string; value: string; language: 'shell' | 'json' }) {
  const t = useTranslations('etl.docs');
  const id = useId();
  return (
    <VStack gap={1.5} className="min-w-0">
      <HStack gap={2} hAlign="between" vAlign="center">
        <Text type="label" id={id}>
          {label}
        </Text>
        <Button
          label={t('copy')}
          variant="ghost"
          size="sm"
          icon={<Icon icon={CopyIcon} />}
          onClick={async () => {
            if (await copyText(value)) toast.success(t('copied'));
            else toast.error(t('copyFailed'));
          }}
        />
      </HStack>
      <CodeEditor
        value={value}
        language={language}
        readOnly
        lineNumbers={false}
        minHeight="3rem"
        aria-labelledby={id}
      />
    </VStack>
  );
}

/** Docs: URL, parameters, a `curl` example, an example response and the OpenAPI document. */
export function DocsTab({ endpoint }: { endpoint: EndpointDetail }) {
  const t = useTranslations('etl.docs');
  const tp = useTranslations('etl.params');
  const origin = useOrigin();
  const versions = endpoint.versions.filter((v) => v.status !== 'retired');
  const [choice, setChoice] = useState(LATEST);
  if (!versions.length)
    return <EmptyState icon={<FileTextIcon />} title={t('unpublished')} description={t('unpublishedHint')} />;
  const latest = versions.find((v) => v.status === 'published') ?? versions[0]!;
  const v = choice === LATEST ? latest : (versions.find((x) => String(x.version) === choice) ?? latest);
  const def = v.definition;
  const params = def.params as ParamDef[];
  const pinned = choice === LATEST ? undefined : v.version;
  const curl = curlExample(origin, endpoint.slug, def.method, params, pinned);
  const example = JSON.stringify(exampleResponse(v.columns, def.responseShape, v.version), null, 2);
  const constraints = (p: ParamDef) =>
    [
      p.enum?.length ? t('oneOf', { values: p.enum.join(', ') }) : null,
      p.min !== null ? `≥ ${p.min}` : null,
      p.max !== null ? `≤ ${p.max}` : null,
      p.minLength !== null ? t('minLength', { n: p.minLength }) : null,
      p.maxLength !== null ? t('maxLength', { n: p.maxLength }) : null,
      p.pattern ? t('pattern', { pattern: p.pattern }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const rows: ParamRow[] = params.map((p) => ({
    name: p.name,
    type: `${tp(`types.${p.type}`)}${p.list ? '[]' : ''}`,
    required: p.required && p.default === null ? t('yes') : t('defaultValue', { value: p.default ?? '∅' }),
    details:
      [p.description, constraints(p), p.example ? t('exampleValue', { value: p.example }) : null]
        .filter(Boolean)
        .join(' · ') || '—',
  }));

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3">
      <div className="grid min-w-0 gap-4 xl:col-span-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {t('request')}
            </CardTitle>
            <CardDescription>{t('requestHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <VStack gap={4} className="min-w-0">
              <HStack gap={2} wrap="wrap" vAlign="center">
                <MethodBadge method={def.method} />
                <Text type="code" className="min-w-0 wrap-anywhere">
                  {origin}
                  {dataUrl(endpoint.slug, pinned)}
                </Text>
                <VersionStatusBadge status={v.status} />
              </HStack>
              {rows.length === 0 ? (
                <Text color="secondary">{t('noParams')}</Text>
              ) : (
                <Table
                  aria-label={t('parameters')}
                  density="compact"
                  verticalAlign="top"
                  data={rows}
                  idKey="name"
                  columns={[
                    { key: 'name', header: tp('name'), renderCell: (r) => <Text type="code">{r.name}</Text> },
                    { key: 'type', header: tp('type') },
                    { key: 'required', header: t('requiredColumn') },
                    {
                      key: 'details',
                      header: t('details'),
                      renderCell: (r) => <Text color="secondary">{r.details}</Text>,
                    },
                  ]}
                />
              )}
              <CopyBlock label={t('curl')} value={curl} language="shell" />
              <Text type="supporting" as="p" display="block">
                {t('csvHint')}
              </Text>
            </VStack>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {t('response')}
            </CardTitle>
            <CardDescription>{t(`responseHint.${def.responseShape}`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <CopyBlock label={t('exampleResponse')} value={example} language="json" />
          </CardContent>
        </Card>
      </div>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t('versionTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VStack gap={4}>
            <Selector
              label={t('version')}
              options={[
                { value: LATEST, label: t('latest', { version: latest.version }) },
                ...versions.map((x) => ({
                  value: String(x.version),
                  label: t('pinned', { version: x.version }),
                })),
              ]}
              value={choice}
              onChange={setChoice}
            />
            <Text color="secondary" as="p" display="block">
              {t('authHint')}
            </Text>
            <DownloadButton
              label={t('openapi')}
              variant="secondary"
              icon={<Icon icon={FileJsonIcon} />}
              href="/api/v1/etl/endpoints/openapi.json"
              download="data-apis.openapi.json"
            />
          </VStack>
        </CardContent>
      </Card>
    </div>
  );
}
