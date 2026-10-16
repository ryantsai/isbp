import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/web';

afterEach(() => vi.unstubAllGlobals());

describe('API reads', () => {
  it('cancels an obsolete request with the caller signal', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const request = createApiClient('csrf').get('/users', { q: 'old' }, controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/users?q=old',
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('keeps existing callers without a signal working', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ items: [] })),
    );
    await expect(createApiClient('csrf').get('/users')).resolves.toEqual({ items: [] });
  });
});
