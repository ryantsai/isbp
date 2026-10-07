/**
 * ManageEngine ServiceDesk Plus (on-premises, build 16000) stand-in.
 *
 * - `/sdp/api/v3/…`: requests (+ notes), problems, changes, solutions, portals and the setup lists the connector
 *   reads (statuses, priorities, …); assets the way build 15100 serves them: `asset_assets` (every asset, basic
 *   fields, no add) and one API per product type (`asset_computers`, `asset_servers`, … in `TYPE_APIS`: full
 *   records, adds). The old `/api/v3/assets` answers 404 / 4007.
 * - Every API route needs the technician API key in the `authtoken` header (`MOCK_CREDENTIALS.sdp.apiKey`; 401 /
 *   4022 otherwise) and `Accept: application/vnd.manageengine.sdp.v3+json`; an optional `PORTALID` header must
 *   name the one instance (`1`). `input_data` in the query (GET) or form body (POST/PUT), `list_info` paging,
 *   sorting and `search_criteria` (only by a module's own non-HTML fields: changes have no `last_updated_time`, so
 *   sorting them by it is refused with 400 / 4000); ServiceDesk Plus' response envelopes and status codes.
 * - `/sdp/WorkOrder.do?woID=…`, `/sdp/ProblemDetails.cc?PROBLEMID=…`, `/sdp/ChangeDetails.cc?CHANGEID=…`,
 *   `/sdp/AssetDetails.do?assetID=…`, `/sdp/AddSolution.do?solID=…`: bare pages standing in for the web UI.
 * - Test controls under `/_mock/sdp/…`: inspect, edit or create records "as a technician" (webhooks fire for
 *   requests, problems and changes), delete, throttle ("URL configured to access 30 requests within N minutes was
 *   violated"), counters.
 *
 * The connector's base URL for it is `http://localhost:<port>/sdp`.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MOCK_CREDENTIALS } from '../credentials';
import type { MockPlugin } from '../index';
import { newId, PUBLIC_PICKLISTS, type Rec, type SdpState, seedSdp, timeValue } from './data';
import { inputData, page, SdpInputError } from './query';
import {
  applyInput,
  atomically,
  createRecord,
  detailPage,
  fromControl,
  BASIC_ASSET_FIELDS,
  basicView,
  listView,
  moduleByApi,
  type ModuleDef,
  moduleOf,
  MODULES,
  singularOf,
  sortable,
  touch,
  TYPE_APIS,
  validate,
} from './records';

const ACCEPT = 'application/vnd.manageengine.sdp.v3+json';
/** The technician the demo API key belongs to: writes through the API are made as this person. */
const API_USER = 'svc-isbp@isbp.example';
/** The one service desk instance (`GET /api/v3/portals`). */
const PORTAL = { id: '1', name: 'Contoso IT Help Desk', url_name: 'itdesk' };

interface RateLimit {
  enabled: boolean;
  /** Calls still allowed before the URL is locked. */
  after: number;
  /** The lock period the throttle message names. */
  minutes: number;
  /** HTTP status of the throttled answer (not documented by ServiceDesk Plus). */
  status: number;
}

const NO_LIMIT: RateLimit = { enabled: false, after: 0, minutes: 1, status: 429 };

const failed = (statusCode: number, message: string, field?: string) => ({
  response_status: {
    status_code: 4000,
    messages: [{ status_code: statusCode, type: 'failed', message, ...(field ? { field } : {}) }],
    status: 'failed',
  },
});

const success = { status_code: 2000, status: 'success' };

/** HTTP status ServiceDesk Plus uses for each status code. */
const HTTP_FOR: Record<number, number> = {
  4000: 400,
  4001: 400,
  4002: 403,
  4007: 404,
  4012: 400,
  4014: 400,
  4015: 429,
  4021: 400,
  4022: 401,
};

export const sdpMock: MockPlugin = {
  name: 'sdp',
  register(app, ctx) {
    const state = () => ctx.store.get<SdpState>('sdp', () => seedSdp());
    const stats = { apiCalls: 0, authFailures: 0 };
    let rate: RateLimit = { ...NO_LIMIT };

    const apiUser = () => state().users.find((u) => u.email_id === API_USER) ?? null;

    /* ───────────── API guard ───────────── */

    const send = (reply: FastifyReply, status: number, body: unknown) => reply.code(status).send(body);
    const sendError = (reply: FastifyReply, err: SdpInputError) =>
      send(reply, HTTP_FOR[err.statusCode] ?? 400, failed(err.statusCode, err.message, err.field));

    /** Checks the API key, portal, Accept header and the rate limit; false when it has answered already. */
    function guard(req: FastifyRequest, reply: FastifyReply): boolean {
      if (req.headers.authtoken !== MOCK_CREDENTIALS.sdp.apiKey) {
        stats.authFailures++;
        send(reply, 401, failed(4022, 'Invalid API key or the key has expired'));
        return false;
      }
      const portal = req.headers.portalid ?? (req.query as Record<string, string> | undefined)?.PORTALID;
      if (portal !== undefined && portal !== PORTAL.id) {
        send(reply, 404, failed(4007, 'Invalid URL or Resource not found'));
        return false;
      }
      if (!String(req.headers.accept ?? '').includes(ACCEPT)) {
        send(reply, 400, failed(4000, `Accept header must be ${ACCEPT}`));
        return false;
      }
      stats.apiCalls++;
      if (rate.enabled) {
        if (rate.after <= 0) {
          // ServiceDesk Plus throttles per URL and locks it for the configured period.
          send(
            reply,
            rate.status,
            failed(4000, `URL configured to access 30 requests within ${rate.minutes} minutes was violated`),
          );
          return false;
        }
        rate.after--;
      }
      return true;
    }

    type R = { Params: { module: string; id?: string } };

    const recordsOf = (def: ModuleDef) => state()[def.key];
    const find = (def: ModuleDef, id: string | undefined) => recordsOf(def).find((r) => r.id === id) ?? null;

    function run(reply: FastifyReply, fn: () => unknown) {
      try {
        return fn();
      } catch (err) {
        if (err instanceof SdpInputError) return sendError(reply, err);
        throw err;
      }
    }

    const base = '/sdp/api/v3';

    /* ───────────── records and setup lists ───────────── */

    app.get(`${base}/portals`, async (req, reply) => {
      if (!guard(req, reply)) return reply;
      return {
        response_status: [success],
        list_info: { has_more_rows: false, row_count: 1 },
        portals: [PORTAL],
      };
    });

    /**
     * What `/api/v3/<api>` serves: a module, `asset_assets` (every asset, basic fields, no add) or a product
     * type API (`asset_computers`: its types' assets, full records). The old `/api/v3/assets` is gone (4007).
     */
    function resolve(
      api: string,
    ):
      | { def: ModuleDef; view: 'module' | 'basic'; key: string; single: string; types: null }
      | { def: ModuleDef; view: 'type'; key: string; single: string; types: string[] }
      | null {
      const def = moduleByApi(api);
      if (def)
        return {
          def,
          view: def.key === 'assets' ? 'basic' : 'module',
          key: api,
          single: def.apiSingle,
          types: null,
        };
      const types = TYPE_APIS[api];
      return types ? { def: MODULES.assets, view: 'type', key: api, single: singularOf(api), types } : null;
    }
    type Target = NonNullable<ReturnType<typeof resolve>>;
    const ofType = (t: Target, rec: Rec) =>
      !t.types || t.types.includes(String((rec.product_type as { name?: string } | null)?.name ?? ''));
    const shown = (t: Target, rec: Rec) => (t.view === 'basic' ? basicView(rec) : rec);
    const notFound = (reply: FastifyReply) =>
      send(reply, 404, failed(4007, 'Invalid URL or Resource not found'));

    app.get<R>(`${base}/:module`, async (req, reply) => {
      if (!guard(req, reply)) return reply;
      return run(reply, () => {
        const input = inputData(req.query, null);
        const listInfo = (input.list_info ?? {}) as Record<string, unknown>;
        const t = resolve(req.params.module);
        if (t) {
          const records = recordsOf(t.def).filter((r) => ofType(t, r));
          const { items, listInfo: info } = page(records, listInfo, 'created_time', (f) =>
            sortable(t.def, f),
          );
          return {
            response_status: [success],
            list_info: info,
            [t.key]: items.map((r) => (t.view === 'module' ? listView(t.def, r) : shown(t, r))),
          };
        }
        const key = req.params.module as (typeof PUBLIC_PICKLISTS)[number];
        if (!PUBLIC_PICKLISTS.includes(key)) return notFound(reply);
        const list = (state().picklists[key] ?? []) as unknown as Rec[];
        const { items, listInfo: info } = page(list, listInfo, 'name');
        return { response_status: [success], list_info: info, [key]: items };
      });
    });

    app.get<R>(`${base}/:module/:id`, async (req, reply) => {
      if (!guard(req, reply)) return reply;
      const t = resolve(req.params.module);
      const rec = t ? find(t.def, req.params.id) : null;
      if (!t || !rec || !ofType(t, rec)) return notFound(reply);
      return { response_status: success, [t.single]: shown(t, rec) };
    });

    app.post<R>(`${base}/:module`, async (req, reply) => {
      if (!guard(req, reply)) return reply;
      const t = resolve(req.params.module);
      if (!t) return notFound(reply);
      return run(reply, () => {
        if (t.view === 'basic')
          throw new SdpInputError('Adding assets is not supported here: use the product type API', 4000);
        const input = inputData(req.query, req.body)[t.single];
        if (!input || typeof input !== 'object')
          throw new SdpInputError(`${t.single} is missing in input_data`, 4000, t.single);
        const body = { ...(input as Rec) };
        if (t.types) {
          // A product type API adds assets of its own types (the first one by default).
          const type = (body.product_type as { name?: string } | undefined)?.name ?? t.types[0]!;
          if (!t.types.includes(type))
            throw new SdpInputError(`${type} is not a product type of ${t.key}`, 4001, 'product_type');
          body.product_type = { name: type };
        }
        const s = state();
        const rec = atomically(s, () => createRecord(s, t.def, body, apiUser()));
        s[t.def.key].push(rec);
        ctx.store.changed();
        return send(reply, 201, { response_status: success, [t.single]: shown(t, rec) });
      });
    });

    app.put<R>(`${base}/:module/:id`, async (req, reply) => {
      if (!guard(req, reply)) return reply;
      const t = resolve(req.params.module);
      const rec = t ? find(t.def, req.params.id) : null;
      if (!t || !rec || !ofType(t, rec)) return notFound(reply);
      return run(reply, () => {
        const input = inputData(req.query, req.body)[t.single];
        if (!input || typeof input !== 'object')
          throw new SdpInputError(`${t.single} is missing in input_data`, 4000, t.single);
        if (t.view === 'basic')
          for (const field of Object.keys(input))
            if (!BASIC_ASSET_FIELDS.includes(field))
              throw new SdpInputError('EXTRA_KEY_FOUND_IN_JSON', 4000, field);
        // All or nothing: apply to a copy, then commit.
        const next = structuredClone(rec);
        atomically(state(), () => {
          applyInput(state(), t.def, next, input as Rec);
          validate(t.def, next);
        });
        if (t.def.key === 'requests')
          next.is_service_request =
            (next.request_type as { name?: string } | null)?.name === 'Service Request';
        touch(t.def, next);
        Object.assign(rec, next);
        ctx.store.changed();
        return { response_status: success, [t.single]: shown(t, rec) };
      });
    });

    /* ───────────── request notes ───────────── */

    type N = { Params: { id: string } };

    app.get<N>(`${base}/requests/:id/notes`, async (req, reply) => {
      if (!guard(req, reply)) return reply;
      if (!find(MODULES.requests, req.params.id))
        return send(reply, 404, failed(4007, 'Invalid URL or Resource not found'));
      return run(reply, () => {
        const input = inputData(req.query, null);
        const notes = state().notes[req.params.id] ?? [];
        const { items, listInfo } = page(notes, input.list_info as Record<string, unknown>, 'created_time');
        return { response_status: [success], list_info: listInfo, notes: items };
      });
    });

    app.post<N>(`${base}/requests/:id/notes`, async (req, reply) => {
      if (!guard(req, reply)) return reply;
      const request = find(MODULES.requests, req.params.id);
      if (!request) return send(reply, 404, failed(4007, 'Invalid URL or Resource not found'));
      return run(reply, () => {
        const input = inputData(req.query, req.body).request_note as Rec | undefined;
        if (!input || typeof input.description !== 'string' || !input.description.trim())
          throw new SdpInputError('Value for mandatory-field is not provided', 4012, 'description');
        const user = apiUser();
        const note = addNote(
          request,
          input,
          user ? { id: user.id, name: user.name, email_id: user.email_id } : null,
        );
        return send(reply, 201, { response_status: success, request_note: note });
      });
    });

    function addNote(request: Rec, input: Rec, by: Rec | null, at?: number): Rec {
      const s = state();
      const note: Rec = {
        id: newId(s),
        description: String(input.description ?? ''),
        show_to_requester: input.show_to_requester === true || input.show_to_requester === 'true',
        notify_technician: input.notify_technician === true,
        mark_first_response: input.mark_first_response === true,
        add_to_linked_requests: input.add_to_linked_requests === true,
        created_time: timeValue(at ?? Date.now()),
        created_by: by,
        request: { id: request.id, display_id: request.display_id, subject: request.subject },
      };
      (s.notes[String(request.id)] ??= []).push(note);
      request.has_notes = true;
      touch(MODULES.requests, request, at);
      ctx.store.changed();
      return note;
    }

    /* ───────────── web UI stand-in ───────────── */

    /** The pages a technician opens; the connector links records to them. */
    const PAGES: [path: string, idParam: string, module: ModuleDef['key']][] = [
      ['/sdp/WorkOrder.do', 'woID', 'requests'],
      ['/sdp/ProblemDetails.cc', 'PROBLEMID', 'problems'],
      ['/sdp/ChangeDetails.cc', 'CHANGEID', 'changes'],
      ['/sdp/AssetDetails.do', 'assetID', 'assets'],
      ['/sdp/AddSolution.do', 'solID', 'solutions'],
    ];
    for (const [path, idParam, module] of PAGES)
      app.get<{ Querystring: Record<string, string> }>(path, async (req, reply) => {
        const def = MODULES[module];
        const rec = find(def, req.query[idParam]);
        if (!rec) return reply.code(404).type('text/plain').send('Not found');
        return reply.type('text/html; charset=utf-8').send(detailPage(def, rec));
      });

    /* ───────────── test controls ───────────── */

    app.get('/_mock/sdp/stats', async () => ({ ...stats, rateLimit: rate }));

    /** `{ enabled?, after?, minutes?, status? }`: after `after` more API calls, the URL is locked (throttle message). */
    app.get('/_mock/sdp/rate-limit', async () => rate);
    app.post<{ Body: Partial<RateLimit> | undefined }>('/_mock/sdp/rate-limit', async (req) => {
      const b = req.body ?? {};
      rate = {
        enabled: b.enabled ?? true,
        after: Math.max(0, Number(b.after ?? 0) || 0),
        minutes: Math.max(1, Number(b.minutes ?? 1) || 1),
        status: Number(b.status) >= 400 && Number(b.status) < 600 ? Number(b.status) : 429,
      };
      return rate;
    });
    app.delete('/_mock/sdp/rate-limit', async () => {
      rate = { ...NO_LIMIT };
      return rate;
    });

    type C = { Params: { module: string; id?: string }; Body: Rec | undefined };

    app.get<C>('/_mock/sdp/:module', async (req, reply) => {
      const def = moduleOf(req.params.module);
      if (!def) return reply.code(404).send({ error: 'unknown module' });
      return recordsOf(def);
    });

    app.get<C>('/_mock/sdp/:module/:id', async (req, reply) => {
      const def = moduleOf(req.params.module);
      const rec = def ? find(def, req.params.id) : null;
      if (!def || !rec) return reply.code(404).send({ error: 'not found' });
      return def.key === 'requests' ? { ...rec, notes: state().notes[String(rec.id)] ?? [] } : rec;
    });

    /** Custom triggers run webhooks for requests, problems and changes (the id arrives as a number). */
    const hook = (def: ModuleDef, rec: Rec) => {
      if (def.key === 'requests' || def.key === 'problems' || def.key === 'changes')
        ctx.notify('sdp', { module: def.single, id: Number(rec.id) });
    };

    /** Split the control options (`_at` epoch ms, `_silent`, `_by` e-mail) from the fields. */
    const options = (body: Rec | undefined) => {
      const { _at, _silent, _by, ...fields } = body ?? {};
      const by = typeof _by === 'string' ? state().users.find((u) => u.email_id === _by) : undefined;
      return {
        fields,
        at: typeof _at === 'number' ? _at : typeof _at === 'string' ? Date.parse(_at) : undefined,
        silent: _silent === true,
        by: by ?? state().users.find((u) => u.email_id === 'helpdesk@isbp.example') ?? null,
      };
    };

    /** Someone edits the record in ServiceDesk Plus: lenient field values, the update time moves, webhooks fire. */
    app.post<C>('/_mock/sdp/:module/:id', async (req, reply) => {
      const def = moduleOf(req.params.module);
      const rec = def ? find(def, req.params.id) : null;
      if (!def || !rec) return reply.code(404).send({ error: 'not found' });
      const { fields, at, silent } = options(req.body);
      return run(reply, () => {
        const next = structuredClone(rec);
        atomically(state(), () => {
          applyInput(state(), def, next, fromControl(def, fields));
          validate(def, next);
        });
        touch(def, next, at);
        Object.assign(rec, next);
        ctx.store.changed();
        if (!silent) hook(def, rec);
        return rec;
      });
    });

    app.post<C>('/_mock/sdp/:module', async (req, reply) => {
      const def = moduleOf(req.params.module);
      if (!def) return reply.code(404).send({ error: 'unknown module' });
      const { fields, at, silent, by } = options(req.body);
      return run(reply, () => {
        const s = state();
        const rec = atomically(s, () => createRecord(s, def, fromControl(def, fields), by, at));
        s[def.key].push(rec);
        ctx.store.changed();
        if (!silent) hook(def, rec);
        return reply.code(201).send(rec);
      });
    });

    /** A technician deletes the record in ServiceDesk Plus. */
    app.delete<C>('/_mock/sdp/:module/:id', async (req, reply) => {
      const def = moduleOf(req.params.module);
      if (!def) return reply.code(404).send({ error: 'unknown module' });
      const s = state();
      const before = s[def.key].length;
      s[def.key] = s[def.key].filter((r) => r.id !== req.params.id);
      if (s[def.key].length === before) return reply.code(404).send({ error: 'not found' });
      ctx.store.changed();
      return { ok: true };
    });

    /** A technician adds a note to a request: `{ description, show_to_requester?, _by?, _at?, _silent? }`. */
    app.post<C>('/_mock/sdp/requests/:id/notes', async (req, reply) => {
      const request = find(MODULES.requests, req.params.id);
      if (!request) return reply.code(404).send({ error: 'not found' });
      const { fields, at, silent, by } = options(req.body);
      if (typeof fields.description !== 'string' || !fields.description.trim())
        return reply.code(400).send({ error: 'description is required' });
      const note = addNote(
        request,
        fields,
        by ? { id: by.id, name: by.name, email_id: by.email_id } : null,
        at,
      );
      if (!silent) hook(MODULES.requests, request);
      return reply.code(201).send(note);
    });
  },
};
