/**
 * Contracts shared between the Integrations Hub (module `integrations`) and connector modules (Phase 5).
 * The hub's own DTOs live in `modules/integrations/src/contracts.ts`.
 */

/**
 * Props of the `integrations.connector-config.<module>.<type>` slots (e.g.
 * `integrations.connector-config.sdp.cloud`): the module that owns a connector contributes the settings form
 * of its connections. Connectors without one get a form generated from their JSON Schemas.
 */
export interface ConnectorConfigSlotProps {
  /** `<module>.<type>`. */
  type: string;
  /** Non-secret settings (validated by the connector's `config` schema on save). */
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  /** Secret values typed in this form. Leave a key out to keep what is stored. */
  secrets: Record<string, string>;
  onSecretsChange: (secrets: Record<string, string>) => void;
  /** Secret keys that already have a stored value (show "Stored. Leave empty to keep it."). */
  storedSecrets: string[];
  /** Field errors from the last save, keyed by `config.<path>` or `secrets.<path>`. */
  errors?: Record<string, string>;
  disabled?: boolean;
  /** True when editing an existing connection. */
  editing: boolean;
}
