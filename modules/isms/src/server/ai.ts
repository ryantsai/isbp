/** AI tools: the same service as the register page, with the caller's permissions. */
import { type AiToolHandler, localize } from '@isbp/sdk/server';
import { aiFindAssetsInput } from '../contracts';
import { services } from './services';

export const aiTools: Record<string, AiToolHandler> = {
  'isms.find_assets': async (raw, ctx, auth) => {
    const input = aiFindAssetsInput.parse(raw);
    const s = services(ctx);
    const classes = input.classCode ? await s.taxonomy.classes(true) : [];
    const cls = input.classCode ? classes.find((c) => c.code === input.classCode!.toUpperCase()) : undefined;
    if (input.classCode && !cls)
      return { items: [], total: 0, note: `No class with code ${input.classCode}` };
    const page = await s.assets.list(
      {
        page: 1,
        pageSize: input.limit,
        q: input.query,
        view: 'active',
        class: cls?.id,
        minValue: input.minValue,
        sort: '-value',
      },
      auth,
    );
    return {
      total: page.total,
      items: page.items.map((a) => ({
        number: a.number,
        name: a.name,
        class: `${a.class.code} ${localize(a.class.name, 'en')}`,
        subclass: a.subclass ? localize(a.subclass.name, 'en') : null,
        site: a.site.code,
        manager: a.manager?.displayName ?? a.managerGroup?.name ?? null,
        location: a.location,
        confidentiality: a.confidentiality,
        integrity: a.integrity,
        availability: a.availability,
        value: a.value,
        classification: a.classification ? localize(a.classification.name, 'en') : null,
        href: `/isms/assets/${a.number}`,
      })),
    };
  },
};
