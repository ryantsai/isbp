import { mkdirSync } from 'node:fs';
import { type FullConfig, request } from '@playwright/test';

export const ADMIN = {
  username: process.env.E2E_ADMIN_USER ?? 'admin',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe-2026!',
};

/** Signs in once through the API, pins the admin's UI to English + light theme, saves the session. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const api = await request.newContext({ baseURL });
  const login = await api.post('/api/v1/auth/login', { data: ADMIN });
  if (!login.ok())
    throw new Error(`Admin login failed (${login.status()}): is the stack running and seeded?`);
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  await api.patch('/api/v1/me', {
    data: { locale: 'en', preferences: { theme: 'light', sidebarCollapsed: false, navExpanded: [] } },
    headers: { 'x-csrf-token': csrfToken },
  });
  mkdirSync('.auth', { recursive: true });
  await api.storageState({ path: '.auth/admin.json' });
  await api.dispose();
}
