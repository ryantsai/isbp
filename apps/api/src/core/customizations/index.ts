import type { CustomizationHandler } from '@isbp/sdk/server';
import { customFieldKind } from './custom-field';
import { formKind } from './form';
import { groupKind } from './group';
import { moduleSettingsKind } from './module-settings';
import { notificationChannelKind } from './notification-channel';
import { roleKind } from './role';
import { workflowKind } from './workflow';

/**
 * Core's customisation kinds (declared in `coreManifest.customizations`): what the AI agent and outside agents
 * may build change sets for. Each one goes through the same service as its admin page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const customizations: Record<string, CustomizationHandler<any>> = {
  workflow: workflowKind,
  form: formKind,
  'custom-field': customFieldKind,
  role: roleKind,
  group: groupKind,
  'notification-channel': notificationChannelKind,
  'module-settings': moduleSettingsKind,
};
