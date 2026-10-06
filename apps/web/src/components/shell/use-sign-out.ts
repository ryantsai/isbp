'use client';

import { useApi } from '@isbp/sdk/web';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

export function useSignOut() {
  const api = useApi();
  const client = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    client.clear();
    router.replace('/login?signedOut=1');
    router.refresh();
  }, [api, client, router]);
}
