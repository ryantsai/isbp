import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineManifest, type ModuleManifest, serializeManifest } from '../src/manifest';
import { defineServerModule } from '../src/server';
import { matchRoute } from '../src/web';

const base: ModuleManifest = {
  id: 'asset-tracker',
  version: '1.0.0',
  name: 'asset-tracker.meta.name',
  permissions: [{ key: 'asset-tracker.assets.read', description: 'Read' }],
};

describe('defineManifest', () => {
  it('accepts a valid manifest', () => {
    expect(defineManifest(base).id).toBe('asset-tracker');
  });

  it.each([
    [{ ...base, id: 'Asset_Tracker' }, 'kebab-case'],
    [{ ...base, id: 'admin' }, 'reserved'],
    [{ ...base, version: 'v1' }, 'semver'],
    [
      { ...base, permissions: [{ key: 'core.users.read', description: 'x' }] },
      'must start with "asset-tracker."',
    ],
    [{ ...base, events: { emits: [{ name: 'core.user.created' }] } }, 'must start with "asset-tracker."'],
  ])('rejects invalid manifests (%#)', (manifest, message) => {
    expect(() => defineManifest(manifest as ModuleManifest)).toThrow(message);
  });

  it('serializes Zod schemas to JSON Schema for APIs and MCP', () => {
    const m = defineManifest({
      ...base,
      ai: {
        tools: [
          {
            name: 'asset-tracker.find_assets',
            description: 'Find assets by tag or serial number',
            input: z.object({ query: z.string() }),
            permission: 'asset-tracker.assets.read',
          },
        ],
      },
    });
    const json = serializeManifest(m);
    expect(JSON.parse(JSON.stringify(json)).ai.tools[0].input).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
    });
  });
});

describe('defineServerModule', () => {
  it('requires consumed events to be declared', () => {
    expect(() =>
      defineServerModule(base, { events: { 'core.user.offboarded': async () => undefined } }),
    ).toThrow('consumes');
  });

  it('requires every declared AI tool to have a handler', () => {
    const m = {
      ...base,
      ai: {
        tools: [
          {
            name: 'asset-tracker.find_assets',
            description: 'Find assets by tag',
            input: z.object({}),
            permission: 'asset-tracker.assets.read',
          },
        ],
      },
    };
    expect(() => defineServerModule(m, {})).toThrow('has no handler');
  });
});

describe('matchRoute', () => {
  it('matches static and parameterised paths', () => {
    expect(matchRoute('/', '/')).toEqual({});
    expect(matchRoute('/items/:id', '/items/42')).toEqual({ id: '42' });
    expect(matchRoute('/items/:id', '/items')).toBeNull();
    expect(matchRoute('/items/:id/edit', '/items/a%20b/edit')).toEqual({ id: 'a b' });
  });
});
