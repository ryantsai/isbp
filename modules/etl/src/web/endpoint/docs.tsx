'use client';

import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { toast } from '@isbp/ui/sonner';
import { CopyIcon, FileJsonIcon, FileTextIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { type EndpointDetail, exampleResponse, type ParamDef, sampleValue } from '../../contracts';
import { MethodBadge, VersionStatusBadge } from '../badges';
import { copyText, dataUrl, useOrigin } from '../lib';

const LATEST = 'latest';

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
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span id={id} className="text-sm font-medium">
          {label}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (await copyText(value)) toast.success(t('copied'));
            else toast.error(t('copyFailed'));
          }}
        >
          <CopyIcon /> {t('copy')}
        </Button>
      </div>
      <CodeEditor
        value={value}
        language={language}
        readOnly
        lineNumbers={false}
        minHeight="3rem"
        aria-labelledby={id}
      />
    </div>
  );
}

/** Docs: URL, parameters, a `curl` example, an example response and the OpenAPI document. */
export function DocsTab({ endpoint }: { endpoint: EndpointDetail }) {
  const t = useTranslations('etl.docs');
  const tp = useTranslations('etl.params');
  const id = useId();
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

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-3">
      <div className="grid min-w-0 gap-6 xl:col-span-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {t('request')}
            </CardTitle>
            <CardDescription>{t('requestHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <MethodBadge method={def.method} />
              <code className="min-w-0 font-mono text-sm wrap-anywhere">
                {origin}
                {dataUrl(endpoint.slug, pinned)}
              </code>
              <VersionStatusBadge status={v.status} />
            </div>
            <div
              role="region"
              aria-label={t('parameters')}
              tabIndex={0}
              className="min-w-0 overflow-x-auto rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <table className="w-full text-sm">
                <caption className="sr-only">{t('parameters')}</caption>
                <thead className="bg-muted/60">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">
                      {tp('name')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">
                      {tp('type')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">
                      {t('requiredColumn')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">
                      {t('details')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {params.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-muted-foreground">
                        {t('noParams')}
                      </td>
                    </tr>
                  )}
                  {params.map((p) => (
                    <tr key={p.name} className="border-t align-top">
                      <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-medium">
                        {p.name}
                      </th>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {tp(`types.${p.type}`)}
                        {p.list ? '[]' : ''}
                      </td>
                      <td className="px-3 py-2">
                        {p.required && p.default === null
                          ? t('yes')
                          : t('defaultValue', { value: p.default ?? '∅' })}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[
                          p.description,
                          constraints(p),
                          p.example ? t('exampleValue', { value: p.example }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CopyBlock label={t('curl')} value={curl} language="shell" />
            <p className="text-xs text-muted-foreground">{t('csvHint')}</p>
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
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-version`}>{t('version')}</Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger id={`${id}-version`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LATEST}>{t('latest', { version: latest.version })}</SelectItem>
                {versions.map((x) => (
                  <SelectItem key={x.version} value={String(x.version)}>
                    {t('pinned', { version: x.version })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">{t('authHint')}</p>
          <Button variant="outline" asChild>
            <a href="/api/v1/etl/endpoints/openapi.json" download="data-apis.openapi.json">
              <FileJsonIcon /> {t('openapi')}
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
