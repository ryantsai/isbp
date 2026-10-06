import { describe, expect, it } from 'vitest';
import { namesFor, render, validateModuleId } from '../src/naming';
import { renderApiRegistry, renderMessagesRegistry, renderWebRegistry } from '../src/registry';

describe('naming', () => {
  it('derives every name form from a kebab-case id', () => {
    expect(namesFor('asset-tracker')).toEqual({
      id: 'asset-tracker',
      schema: 'asset_tracker',
      title: 'Asset Tracker',
      camel: 'assetTracker',
      pascal: 'AssetTracker',
    });
  });
  it('rejects reserved and malformed ids', () => {
    expect(validateModuleId('core')).toMatch(/reserved/);
    expect(validateModuleId('admin')).toMatch(/reserved/);
    expect(validateModuleId('Asset')).toMatch(/kebab-case/);
    expect(validateModuleId('asset-tracker')).toBeNull();
  });
  it('renders template placeholders', () => {
    expect(
      render("pgSchema('__SCHEMA__') // __TITLE__ (__ID__) __ICON__", namesFor('asset-tracker'), {
        __ICON__: 'box',
      }),
    ).toBe("pgSchema('asset_tracker') // Asset Tracker (asset-tracker) box");
  });
});

describe('registry rendering', () => {
  const mods = [{ id: 'asset-tracker', packageName: '@isbp/module-asset-tracker', dir: '/x' }];
  it('keeps core first in the API registry', () => {
    const out = renderApiRegistry(mods);
    expect(out).toContain("import assetTracker from '@isbp/module-asset-tracker/server';");
    expect(out).toContain('[coreModule, assetTracker]');
  });
  it('registers web modules by id and message loaders per locale', () => {
    expect(renderWebRegistry(mods)).toContain("'asset-tracker': assetTracker,");
    const messages = renderMessagesRegistry(mods);
    for (const locale of ['en', 'zh-TW', 'ja-JP']) expect(messages).toContain(`messages/${locale}.json`);
  });
});
