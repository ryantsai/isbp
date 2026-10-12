import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * A stand-in for docling-serve (`/docling/v1/convert/file/async`, then `status/poll` and `result`), so attachment
 * extraction runs end to end without Docling or a GPU. It is not OCR: it "reads" a PDF by collecting the strings of
 * its text operators (`(…) Tj`), one Markdown page per page object, and says what it would have recognised for an
 * image. Pages are separated by the `md_page_break_placeholder` the client sends. `X-Api-Key` is required when the
 * request carries one that isn't `docling-key`.
 */

interface Part {
  name: string;
  filename?: string;
  type?: string;
  data: Buffer;
}

/** Fields of a multipart/form-data body (enough for the platform's client). */
export function parseMultipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: Part[] = [];
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const chunk = body.subarray(start + delimiter.length + 2, next - 2);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headers = chunk.subarray(0, headerEnd).toString('utf8');
      const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? '';
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();
      parts.push({ name, filename, type, data: chunk.subarray(headerEnd + 4) });
    }
    start = next;
  }
  return parts;
}

/** The text-operator strings of each page of a simple PDF (uncompressed content streams). */
export function pdfPageTexts(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const streams = [...text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]!);
  const pages = (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
  const out = streams
    .filter((s) => /\bBT\b/.test(s))
    .map((s) =>
      [...s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
        .map((m) => m[1]!.replace(/\\([\\()])/g, '$1'))
        .join('\n'),
    );
  while (out.length < pages) out.push('');
  return out;
}

export function registerDocling(app: FastifyInstance) {
  const tasks = new Map<string, { markdown: string; polls: number }>();

  app.register(async (scope) => {
    scope.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_req, body, done) =>
      done(null, body),
    );
    scope.addHook('onRequest', async (req, reply) => {
      const key = req.headers['x-api-key'];
      if (key !== undefined && key !== 'docling-key')
        return reply.code(401).send({ detail: 'Invalid API key' });
    });

    scope.get('/docling/health', async () => ({ status: 'ok' }));

    scope.post('/docling/v1/convert/file/async', async (req, reply) => {
      const parts = parseMultipart(req.body as Buffer, String(req.headers['content-type'] ?? ''));
      const file = parts.find((p) => p.name === 'files');
      if (!file) return reply.code(422).send({ detail: 'files is required' });
      const marker = parts.find((p) => p.name === 'md_page_break_placeholder')?.data.toString('utf8') ?? '';
      const name = file.filename ?? 'document';
      const pages =
        file.data.subarray(0, 5).toString('latin1') === '%PDF-'
          ? pdfPageTexts(file.data).map(
              (t, i) => t.trim() || `Text recognised by the Docling stand-in on page ${i + 1} of ${name}.`,
            )
          : [`Text recognised by the Docling stand-in in ${name}.`];
      const id = randomUUID();
      tasks.set(id, { markdown: pages.join(`\n\n${marker}\n\n`), polls: 0 });
      return { task_id: id, task_type: 'convert', task_status: 'pending', task_position: 0 };
    });

    scope.get<{ Params: { id: string } }>('/docling/v1/status/poll/:id', async (req, reply) => {
      const task = tasks.get(req.params.id);
      if (!task) return reply.code(404).send({ detail: 'Task not found' });
      // Busy for one poll, like a real conversion.
      task.polls++;
      return { task_id: req.params.id, task_status: task.polls > 1 ? 'success' : 'started' };
    });

    scope.get<{ Params: { id: string } }>('/docling/v1/result/:id', async (req, reply) => {
      const task = tasks.get(req.params.id);
      if (!task) return reply.code(404).send({ detail: 'Task not found' });
      // Single-use, like docling-serve's default.
      tasks.delete(req.params.id);
      return {
        document: { filename: 'document', md_content: task.markdown },
        status: 'success',
        errors: [],
        processing_time: 0.1,
      };
    });
  });
}
