'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Spinner } from '@astryxdesign/core/Spinner';
import { VStack } from '@astryxdesign/core/Layout';
import { ApiError, type WebPageProps } from '@isbp/sdk/web';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { ChatSession } from '../../contracts';
import { type ConnectMessage, PUBLISHED_API, publicFetch } from './api';

type Step = 'working' | 'done' | 'no_opener' | 'forbidden' | 'failed';

/**
 * The sign-in window a framed chat for signed-in people opens (`/p/helpdesk-ai/chat/<token>/connect`). It is a
 * top-level page on the platform, so the platform's session cookie reaches it: it signs the person in if needed,
 * asks for a chat session and hands it to the chat that opened it (same origin only), then closes.
 */
export default function ConnectPage({ params }: WebPageProps) {
  const token = params.token ?? '';
  const t = useTranslations('helpdesk-ai.published');
  const [step, setStep] = useState<Step>('working');

  useEffect(() => {
    void (async () => {
      let csrf: string;
      try {
        csrf = (await publicFetch<{ csrfToken: string }>('/api/v1/auth/session')).csrfToken;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // Back here after signing in.
          window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        setStep('failed');
        return;
      }
      if (!window.opener) {
        setStep('no_opener');
        return;
      }
      try {
        const session = await publicFetch<ChatSession>(
          `${PUBLISHED_API}/${encodeURIComponent(token)}/sessions/me`,
          { method: 'POST', csrf },
        );
        const message: ConnectMessage = { type: 'isbp-chat:session', token, session };
        // Only to a page of the platform's own origin: the chat that opened this window.
        (window.opener as Window).postMessage(message, window.location.origin);
        setStep('done');
        window.close();
      } catch (err) {
        setStep(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'failed');
      }
    })();
  }, [token]);

  return (
    <VStack gap={3} hAlign="center" className="mx-auto max-w-md px-4 py-16 text-center">
      {step === 'working' && <Spinner size="lg" label={t('connecting')} />}
      {step === 'done' && <Banner status="success" title={t('connected')} collapsible={false} />}
      {step === 'no_opener' && <Banner status="info" title={t('noOpener')} collapsible={false} />}
      {step === 'forbidden' && <Banner status="error" title={t('connectForbidden')} collapsible={false} />}
      {step === 'failed' && <Banner status="error" title={t('connectFailed')} collapsible={false} />}
    </VStack>
  );
}
