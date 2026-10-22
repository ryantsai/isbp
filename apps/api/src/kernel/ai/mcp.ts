import {
  type AuthContext,
  type CustomizationsService,
  ErrorCodes,
  HttpError,
  type McpSession,
} from '@isbp/sdk/server';
import { z } from 'zod';
import { type ToolRegistry, wireName } from './tools';

/**
 * The platform's MCP server (Model Context Protocol, Streamable HTTP, JSON responses, no sessions), for outside
 * agents such as Claude Code and Claude Desktop. It exposes the AI tool registry and the customisation kinds to
 * API clients holding `core.mcp.use`, with the same permission checks and audit as the platform's own assistant.
 *
 * Dual-era (docs/architecture.md §13.4): a request carrying `_meta["io.modelcontextprotocol/protocolVersion"]` is
 * served statelessly per revision 2026-07-28 (headers validated against the body); an `initialize` request
 * selects the initialize-based revisions, served without a session id.
 */

export const MODERN_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

/** JSON-RPC and MCP error codes. */
export const RpcError = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  /** Resource not found before 2026-07-28 (now INVALID_PARAMS). */
  LEGACY_RESOURCE_NOT_FOUND: -32002,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_VERSION: -32022,
} as const;

export interface McpRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  auth: AuthContext;
}

export interface McpResponse {
  status: number;
  body?: unknown;
}

interface Envelope {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly status = 200,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

const header = (h: McpRequest['headers'], name: string): string | undefined => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** `=?base64?…?=` header values (non-ASCII names and URIs). */
export function decodeHeaderValue(v: string): string {
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  return m ? Buffer.from(m[1]!, 'base64').toString('utf8') : v;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

interface Era {
  modern: boolean;
  version: string;
}

export class McpServer {
  constructor(
    private readonly deps: {
      tools: ToolRegistry;
      customizations: CustomizationsService;
      version: string;
      publicUrl: string;
    },
  ) {}

  private get serverInfo() {
    return { name: 'isbp', title: 'IS Big Platform', version: this.deps.version };
  }

  private get instructions() {
    return [
      'IS Big Platform (ISBP): IS (information systems) operations — service desk, approvals, forms, assets, projects, data and integrations.',
      'Tools are named <module>__<tool> and run with this API client’s permissions.',
      'To customise the platform: assistant__list_kinds, then assistant__describe_kind (schema, guide, live reference ' +
        'data), assistant__list_objects / assistant__get_object to read what exists, then assistant__propose_change. ' +
        'Pass the returned changeSetId to keep adding to the same change set, and name it with ' +
        'assistant__update_change_set.',
      `Proposals are drafts: a person reviews and applies them in ISBP at ${this.deps.publicUrl.replace(/\/$/, '')}` +
        '<href>. Destructive actions are not offered over MCP.',
    ].join('\n');
  }

  async handle(req: McpRequest): Promise<McpResponse> {
    if (Array.isArray(req.body)) {
      // JSON-RPC batches existed only in 2025-03-26.
      const out: unknown[] = [];
      for (const message of req.body) {
        const r = await this.handleOne({ ...req, body: message }, true);
        if (r.body !== undefined) out.push(r.body);
      }
      return out.length ? { status: 200, body: out } : { status: 202 };
    }
    return this.handleOne(req, false);
  }

  private async handleOne(req: McpRequest, inBatch: boolean): Promise<McpResponse> {
    const msg = req.body as Envelope;
    if (!isObject(msg) || msg.jsonrpc !== '2.0')
      return this.error(null, new RpcFailure(RpcError.INVALID_REQUEST, 'Invalid JSON-RPC message', 400));
    // A response from the client (to a server request we never send): accept and ignore.
    if (msg.method === undefined && ('result' in msg || 'error' in msg)) return { status: 202 };
    if (typeof msg.method !== 'string')
      return this.error(msg.id ?? null, new RpcFailure(RpcError.INVALID_REQUEST, 'Missing method', 400));
    const isNotification = msg.id === undefined;

    let era: Era;
    try {
      era = this.eraOf(req, msg, inBatch);
    } catch (err) {
      return this.error(msg.id ?? null, err);
    }
    if (isNotification) return { status: 202 };
    try {
      const result = await this.dispatch(msg, req.auth, era);
      const body = era.modern
        ? {
            resultType: 'complete',
            ...result,
            _meta: { ...(result._meta as object), [META_SERVER]: this.serverInfo },
          }
        : result;
      return { status: 200, body: { jsonrpc: '2.0', id: msg.id, result: body } };
    } catch (err) {
      return this.error(msg.id ?? null, err, era);
    }
  }

  /** Which revision the request speaks, validating the 2026-07-28 request headers against the body. */
  private eraOf(req: McpRequest, msg: Envelope, inBatch: boolean): Era {
    const meta = isObject(msg.params?._meta) ? (msg.params._meta as Record<string, unknown>) : null;
    const requested = meta?.[META_VERSION];
    const headerVersion = header(req.headers, 'mcp-protocol-version');
    if (typeof requested === 'string' && msg.method !== 'initialize' && !inBatch) {
      if (!(MODERN_VERSIONS as readonly string[]).includes(requested))
        throw new RpcFailure(RpcError.UNSUPPORTED_VERSION, 'Unsupported protocol version', 400, {
          supported: SUPPORTED_VERSIONS,
          requested,
        });
      if (headerVersion !== requested)
        throw new RpcFailure(
          RpcError.HEADER_MISMATCH,
          `Header mismatch: MCP-Protocol-Version ${headerVersion ?? '(missing)'} does not match ${requested}`,
          400,
        );
      const method = header(req.headers, 'mcp-method');
      if (method !== msg.method)
        throw new RpcFailure(
          RpcError.HEADER_MISMATCH,
          `Header mismatch: Mcp-Method ${method ?? '(missing)'} does not match ${msg.method}`,
          400,
        );
      const named =
        msg.method === 'tools/call' || msg.method === 'prompts/get' ? msg.params?.name : undefined;
      const uri = msg.method === 'resources/read' ? msg.params?.uri : undefined;
      const expected = named ?? uri;
      if (expected !== undefined) {
        const raw = header(req.headers, 'mcp-name');
        if (raw === undefined || decodeHeaderValue(raw) !== expected)
          throw new RpcFailure(
            RpcError.HEADER_MISMATCH,
            `Header mismatch: Mcp-Name ${raw ?? '(missing)'} does not match ${String(expected)}`,
            400,
          );
      }
      return { modern: true, version: requested };
    }
    // Initialize-based revisions: the header (2025-06-18+) must name a version we speak; absent means 2025-03-26.
    if (headerVersion !== undefined && !SUPPORTED_VERSIONS.includes(headerVersion))
      throw new RpcFailure(RpcError.UNSUPPORTED_VERSION, 'Unsupported protocol version', 400, {
        supported: SUPPORTED_VERSIONS,
        requested: headerVersion,
      });
    return { modern: false, version: headerVersion ?? '2025-03-26' };
  }

  private error(id: Envelope['id'] | null, err: unknown, era?: Era): McpResponse {
    const failure =
      err instanceof RpcFailure ? err : new RpcFailure(RpcError.INTERNAL, 'Internal error', 500);
    const status = failure.code === RpcError.METHOD_NOT_FOUND && !era?.modern ? 200 : failure.status;
    return {
      status,
      body: {
        jsonrpc: '2.0',
        id: id ?? null,
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.data ? { data: failure.data } : {}),
        },
      },
    };
  }

  private async dispatch(msg: Envelope, auth: AuthContext, era: Era): Promise<Record<string, unknown>> {
    const params = msg.params ?? {};
    switch (msg.method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        return {
          protocolVersion: (LEGACY_VERSIONS as readonly string[]).includes(asked)
            ? asked
            : LEGACY_VERSIONS[0],
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: this.serverInfo,
          instructions: this.instructions,
        };
      }
      case 'ping':
        if (era.modern) break;
        return {};
      case 'server/discover':
        if (!era.modern) break;
        return {
          supportedVersions: SUPPORTED_VERSIONS,
          capabilities: { tools: {}, resources: {} },
          instructions: this.instructions,
          ttlMs: 3_600_000,
          cacheScope: 'private',
        };
      case 'tools/list':
        return {
          tools: this.session(auth).listTools(),
          ...(era.modern ? { ttlMs: 60_000, cacheScope: 'private' } : {}),
        };
      case 'tools/call':
        return this.callTool(params, auth, era);
      case 'resources/list':
        return {
          resources: this.session(auth).listResources(),
          ...(era.modern ? { ttlMs: 60_000, cacheScope: 'private' } : {}),
        };
      case 'resources/templates/list':
        return {
          resourceTemplates: [
            {
              uriTemplate: 'isbp://customizations/{kind}',
              name: 'customization-kind',
              title: 'Customisation kind',
              description: 'A kind’s value schema, guide (instructions, live reference data) and examples.',
              mimeType: 'application/json',
            },
            {
              uriTemplate: 'isbp://customizations/{kind}/{id}',
              name: 'customization-object',
              title: 'Configuration object',
              description: 'One object of a kind with its full value and version.',
              mimeType: 'application/json',
            },
          ],
          ...(era.modern ? { ttlMs: 60_000, cacheScope: 'private' } : {}),
        };
      case 'resources/read':
        return this.readResource(params, auth, era);
    }
    throw new RpcFailure(RpcError.METHOD_NOT_FOUND, `Method not found: ${msg.method}`, 404);
  }

  /**
   * The tool, resource and call semantics shared by the HTTP endpoint and in-process sessions (the platform's own
   * agent): one surface, one set of checks. Outside agents never see destructive tools; in-process sessions may list
   * them and run them only with `confirmed` (a person confirmed in the UI).
   */
  session(auth: AuthContext, opts: { includeDestructive?: boolean; via?: string } = {}): McpSession {
    const via = opts.via ?? 'mcp';
    const offered = () =>
      this.deps.tools
        .list(auth)
        .filter((t) => opts.includeDestructive || !t.destructive)
        .sort((a, b) => a.name.localeCompare(b.name));
    const text = (v: unknown) => [{ type: 'text' as const, text: JSON.stringify(v) }];
    return {
      listTools: () =>
        offered().map((t) => {
          const def = this.deps.tools.find(t.name)!.def;
          let inputSchema: Record<string, unknown>;
          try {
            inputSchema = z.toJSONSchema(def.input, { unrepresentable: 'any', io: 'input' }) as Record<
              string,
              unknown
            >;
          } catch {
            inputSchema = { type: 'object' };
          }
          return {
            name: wireName(t.name),
            title: t.name,
            description: t.description,
            inputSchema: { type: 'object', ...inputSchema },
            annotations: {
              readOnlyHint: t.readOnly,
              destructiveHint: t.destructive,
              idempotentHint: t.readOnly,
              openWorldHint: false,
            },
          };
        }),

      callTool: async (wire, args, callOpts = {}) => {
        const name = this.deps.tools.fromWire(wire);
        const tool = offered().find((t) => t.name === name);
        if (!tool) throw new RpcFailure(RpcError.INVALID_PARAMS, `Unknown tool: ${wire}`);
        if (tool.destructive && !callOpts.confirmed)
          return {
            content: text({
              error: ErrorCodes.CONFIRMATION_REQUIRED,
              message: opts.includeDestructive
                ? 'This action needs the person’s confirmation. Nothing ran.'
                : 'This action needs a person’s confirmation in ISBP and is not available over MCP.',
            }),
            isError: true,
            confirmationRequired: true,
          };
        try {
          const out = await this.deps.tools.invoke('core', name, args ?? {}, {
            auth,
            via,
            confirmed: tool.destructive && callOpts.confirmed,
          });
          return { content: text(out ?? null), structuredContent: out ?? null, isError: false };
        } catch (err) {
          const e =
            err instanceof HttpError
              ? { error: err.code, message: err.message, details: err.details }
              : { error: ErrorCodes.INTERNAL, message: 'Unexpected error' };
          return { content: text(e), isError: true };
        }
      },

      listResources: () => [
        {
          uri: 'isbp://customizations',
          name: 'customizations',
          title: 'Customisation kinds',
          description: 'The configurable surfaces this client may read and propose changes to.',
          mimeType: 'application/json',
        },
      ],

      readResource: async (uri) => {
        const m = /^isbp:\/\/customizations(?:\/([a-z][a-z0-9-]*\.[a-z][a-z0-9-]*)(?:\/([^/?#]+))?)?$/.exec(
          uri,
        );
        if (!m) return null;
        let data: unknown;
        try {
          if (!m[1]) data = { kinds: this.deps.customizations.kinds(auth) };
          else if (!m[2]) data = await this.deps.customizations.describe(m[1], auth);
          else data = await this.deps.customizations.get(m[1], decodeURIComponent(m[2]), auth);
        } catch (err) {
          if (err instanceof HttpError && (err.statusCode === 404 || err.statusCode === 403)) return null;
          throw err;
        }
        return data === null ? null : { uri, mimeType: 'application/json', text: JSON.stringify(data) };
      },
    };
  }

  private async callTool(params: Record<string, unknown>, auth: AuthContext, era: Era) {
    if (typeof params.name !== 'string') throw new RpcFailure(RpcError.INVALID_PARAMS, 'Missing tool name');
    const result = await this.session(auth).callTool(params.name, params.arguments ?? {});
    const { confirmationRequired: _, ...rest } = result;
    // Before 2026-07-28, structuredContent had to be an object.
    if (!era.modern && !isObject(rest.structuredContent)) delete rest.structuredContent;
    if (rest.isError) delete rest.structuredContent;
    return rest;
  }

  private async readResource(params: Record<string, unknown>, auth: AuthContext, era: Era) {
    const uri = typeof params.uri === 'string' ? params.uri : '';
    const content = await this.session(auth).readResource(uri);
    if (!content)
      throw new RpcFailure(
        era.modern ? RpcError.INVALID_PARAMS : RpcError.LEGACY_RESOURCE_NOT_FOUND,
        `Resource not found: ${uri}`,
        200,
        { uri },
      );
    return { contents: [content], ...(era.modern ? { ttlMs: 0, cacheScope: 'private' } : {}) };
  }
}
