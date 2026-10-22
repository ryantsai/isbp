/**
 * Demo data (idempotent: skipped once any vendor exists). Runs after the core, Phase 1/2 seeds and the
 * CMDB seed: servers and network gear are linked to CMDB CIs **by name** (skipped silently when the CMDB
 * isn't seeded). Randomness is deterministic, so every fresh install looks the same.
 */
import { departments, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import type { AuthContext, ModuleContext, SessionUser } from '@isbp/sdk/server';
import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import {
  addDays,
  addMonths,
  type AssetCategory,
  type AssetStatus,
  contractStatusFor,
  DEFAULT_LIFESPAN_MONTHS,
  defaultRetireOn,
  formatAssetTag,
} from '../model';
import {
  approvedSoftware,
  approvedSoftwareDepartments,
  assetEvents,
  type AssetEventKind,
  assets,
  contractItems,
  contracts,
  discoveryReports,
  licenseAssignments,
  licenses,
  models,
  softwareInstallations,
  softwareTitleRules,
  vendors,
} from './schema';
import {
  CONTRACTS,
  INFRASTRUCTURE,
  LICENSES,
  locationOf,
  MODELS,
  type SeedModel,
  VENDORS,
} from './seed-data';
import { services } from './services';
import { companyToday, itamConfig, systemAuth } from './support';

/** Small deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
    shuffle: <T>(list: readonly T[]) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}

const SERIAL = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

/** Hostname infix per category (`TPE-LT-0042`). */
const HOST_KIND: Record<AssetCategory, string> = {
  laptop: 'LT',
  desktop: 'PC',
  monitor: 'MON',
  phone: 'MB',
  tablet: 'TB',
  peripheral: 'DK',
  server: 'SRV',
  network: 'NET',
  storage: 'STO',
  printer: 'PRN',
  other: 'HW',
};

interface Person {
  id: string;
  username: string;
  displayName: string;
  email: string;
  locale: string;
  timezone: string;
  departmentId: string | null;
  dept: string | null;
}

interface PlannedEvent {
  kind: AssetEventKind;
  at: Date;
  from?: string | null;
  to?: string | null;
  userId?: string | null;
  note?: string | null;
}

interface PlannedAsset {
  number: number;
  name: string;
  category: AssetCategory;
  model: SeedModel;
  serial: string | null;
  status: AssetStatus;
  assignee: Person | null;
  assignedAt: Date | null;
  location: string;
  departmentId: string | null;
  ciId: string | null;
  purchaseDate: string;
  warrantyEnd: string;
  cost: number;
  invoice: string;
  notes?: string;
  events: PlannedEvent[];
  disposedAt?: Date;
  disposalNote?: string;
}

/** 09:30 in Taipei on a calendar date. */
const at = (date: string, hour = 9, minute = 30) =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);

/** A tiny, valid one-page PDF (the "signed contract" attached to the Dell support contract). */
function samplePdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = [
    'BT /F1 18 Tf 72 760 Td',
    `(${esc(title)}) Tj`,
    '/F1 11 Tf',
    ...lines.map((l) => `0 -22 Td (${esc(l)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export async function seedItam(ctx: ModuleContext) {
  const [existing] = await ctx.db.select({ n: count() }).from(vendors);
  if (existing!.n > 0) return;

  const db = ctx.db;
  const rand = prng(20261007);
  const today = companyToday();
  const cfg = await itamConfig(ctx);
  const currency = cfg.currency;

  /* ───────────── people ───────────── */
  const people: Person[] = (
    await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        email: users.email,
        locale: users.locale,
        timezone: users.timezone,
        departmentId: users.departmentId,
        dept: departments.code,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(users.status, 'active'))
      .orderBy(asc(users.username))
  ).map((p) => ({ ...p }));
  const byUsername = new Map(people.map((p) => [p.username, p]));
  const admin = byUsername.get('admin') ?? null;
  const helpdesk = byUsername.get('helpdesk') ?? null;
  const deptRows = await db.select({ id: departments.id, code: departments.code }).from(departments);
  const deptId = new Map(deptRows.map((d) => [d.code, d.id]));
  const inDept = (code: string) => people.filter((p) => p.dept === code);
  const nth = (code: string, n: number) => {
    const list = inDept(code);
    return list.length ? list[n % list.length]! : (admin ?? people[0] ?? null);
  };
  const itOps = helpdesk ?? admin;
  const actor = (p: Person | null) => ({ actorId: p?.id ?? null, actorName: p ? null : 'Assets' });

  /* ───────────── vendors & models ───────────── */
  const vendorRows = await db
    .insert(vendors)
    .values(VENDORS.map((v) => ({ ...v, notes: v.notes ?? null })))
    .returning({ id: vendors.id, name: vendors.name });
  const vendorId = new Map(vendorRows.map((v) => [v.name, v.id]));
  const modelRows = await db
    .insert(models)
    .values(
      MODELS.map((m) => ({
        category: m.category,
        manufacturer: m.manufacturer,
        name: m.name,
        partNumber: m.partNumber,
        lifespanMonths: m.lifespanMonths ?? DEFAULT_LIFESPAN_MONTHS[m.category],
      })),
    )
    .returning();
  const modelByKey = new Map(MODELS.map((m, i) => [m.key, { seed: m, row: modelRows[i]! }]));
  const model = (key: string) => modelByKey.get(key)!;

  /* ───────────── CMDB configuration items by name ───────────── */
  const ciRows = await db
    .select({ id: cis.id, name: cis.name })
    .from(cis)
    .where(
      inArray(
        cis.name,
        INFRASTRUCTURE.map((i) => i.name),
      ),
    );
  const ciId = new Map(ciRows.map((c) => [c.name, c.id]));

  /* ───────────── hardware plan ───────────── */
  const planned: PlannedAsset[] = [];
  let number = 0;
  const usedSerials = new Set<string>();
  const serialFor = (m: SeedModel) => {
    for (;;) {
      const body = Array.from({ length: 7 }, () => rand.pick([...SERIAL])).join('');
      const serial =
        m.manufacturer === 'Apple'
          ? `F${body}${rand.pick([...SERIAL])}${rand.pick([...SERIAL])}`
          : m.manufacturer === 'Lenovo'
            ? `PF${body.slice(0, 6)}`
            : m.manufacturer === 'Samsung'
              ? `R5C${body}`
              : m.manufacturer === 'HP'
                ? `PHB${body.slice(0, 7)}`
                : body;
      if (!usedSerials.has(serial)) {
        usedSerials.add(serial);
        return serial;
      }
    }
  };
  const prefix = (p: Person | null) =>
    p?.dept === 'RND' ? 'HSC' : p?.dept === 'OPS' ? 'KHH' : p?.dept === 'SALES-TYO' ? 'TYO' : 'TPE';
  const nameCount = new Map<string, number>();
  const hostname = (site: string, kind: string) => {
    const key = `${site}-${kind}`;
    const n = (nameCount.get(key) ?? 0) + 1;
    nameCount.set(key, n);
    return `${key}-${String(n).padStart(4, '0')}`;
  };
  const storeroom = 'Taipei HQ 12F IS storeroom';

  function plan(input: {
    modelKey: string;
    name?: string;
    status: AssetStatus;
    assignee?: Person | null;
    ageMonths: number;
    ageDays?: number;
    location?: string;
    departmentCode?: string | null;
    ci?: string;
    serial?: string | null;
    notes?: string;
  }): PlannedAsset {
    const { seed: m } = model(input.modelKey);
    const purchaseDate = addDays(addMonths(today, -input.ageMonths), -(input.ageDays ?? rand.int(0, 25)));
    const assignee = input.assignee ?? null;
    const assignedAt = assignee
      ? at(addDays(purchaseDate, rand.int(2, 12)), rand.int(9, 17), rand.int(0, 59))
      : null;
    const site = prefix(assignee);
    const kind = HOST_KIND[m.category];
    const deptCode = input.departmentCode !== undefined ? input.departmentCode : (assignee?.dept ?? 'IS-SD');
    const a: PlannedAsset = {
      number: ++number,
      name: input.name ?? hostname(site, kind),
      category: m.category,
      model: m,
      serial: input.serial === undefined ? serialFor(m) : input.serial,
      status: input.status,
      assignee,
      assignedAt,
      location: input.location ?? (assignee ? locationOf(assignee.dept) : storeroom),
      departmentId: (deptCode && deptId.get(deptCode)) ?? null,
      ciId: input.ci ? (ciId.get(input.ci) ?? null) : null,
      purchaseDate,
      warrantyEnd: addMonths(purchaseDate, m.warrantyMonths),
      cost: m.cost,
      invoice: `INV-${purchaseDate.slice(0, 4)}${purchaseDate.slice(5, 7)}-${String(rand.int(100, 9999)).padStart(4, '0')}`,
      notes: input.notes,
      events: [
        {
          kind: 'created',
          at: at(purchaseDate, 10, 0),
          to: input.status === 'ordered' ? 'ordered' : 'in_stock',
        },
      ],
    };
    if (assignee && assignedAt)
      a.events.push({
        kind: 'assigned',
        at: assignedAt,
        userId: assignee.id,
        from: 'in_stock',
        to: assignee.displayName,
      });
    planned.push(a);
    return a;
  }

  // AST-00001: the platform admin's MacBook.
  plan({
    modelKey: 'mbp',
    status: 'deployed',
    assignee: admin,
    ageMonths: 5,
    ageDays: 3,
    name: 'TPE-LT-ADMIN',
  });

  // The service desk lead's laptop and phone.
  if (helpdesk) {
    plan({ modelKey: 'latitude', status: 'deployed', assignee: helpdesk, ageMonths: 14 });
    plan({ modelKey: 'iphone', status: 'deployed', assignee: helpdesk, ageMonths: 8 });
  }

  const others = rand.shuffle(people.filter((p) => p !== admin && p !== helpdesk));
  const laptopUsers = others.slice(0, Math.min(62, others.length));
  const laptopModelFor = (p: Person) => {
    if (p.dept === 'RND') return rand.chance(0.45) ? 'mbp' : 'x1';
    if (p.dept === 'SALES-TYO' || p.dept === 'SALES-GLB') return 'x1';
    if (p.dept?.startsWith('IS')) return rand.chance(0.5) ? 't14' : 'latitude';
    if (p.dept === 'FIN' || p.dept === 'HR') return 'latitude';
    return 't14';
  };
  laptopUsers.forEach((p, i) => {
    // A few warranties end within the month, a few ended long ago (due for refresh).
    const ageMonths = i % 17 === 3 ? 36 : i % 13 === 5 ? rand.int(38, 44) : rand.int(2, 30);
    const ageDays = i % 17 === 3 ? -rand.int(5, 22) : undefined;
    const a = plan({ modelKey: laptopModelFor(p), status: 'deployed', assignee: p, ageMonths, ageDays });
    if (i % 9 === 4 && others.length > 70) {
      // Reassigned once: a leaver's laptop went back to stock, then to this person.
      const prev = others[others.length - 1 - (i % 7)]!;
      a.events.splice(1, 0, {
        kind: 'assigned',
        at: at(addDays(a.purchaseDate, 4)),
        userId: prev.id,
        from: 'in_stock',
        to: prev.displayName,
      });
      a.events.splice(2, 0, {
        kind: 'returned',
        at: at(addDays(a.purchaseDate, 140)),
        userId: prev.id,
        from: prev.displayName,
        to: 'in_stock',
        note: 'Re-imaged after the previous user changed team.',
      });
      a.assignedAt = at(addDays(a.purchaseDate, 150), 14, 10);
      a.events[3]!.at = a.assignedAt;
    }
  });

  // Phones for sales, the service desk and infrastructure on-call.
  const phoneUsers = laptopUsers
    .filter(
      (p) => p.dept?.startsWith('SALES') || p.dept === 'IS-SD' || p.dept === 'IS-INFRA' || p.dept === 'HQ',
    )
    .slice(0, 24);
  for (const [i, p] of phoneUsers.entries())
    plan({
      modelKey: i % 4 === 3 ? 'galaxy' : 'iphone',
      status: 'deployed',
      assignee: p,
      ageMonths: rand.int(1, 20),
    });

  // Monitors and docks on Taipei desks; a stock of spares.
  const taipei = laptopUsers.filter((p) => locationOf(p.dept).startsWith('Taipei'));
  for (const p of taipei.slice(0, 15))
    plan({ modelKey: 'u2724d', status: 'deployed', assignee: p, ageMonths: rand.int(3, 40) });
  for (const p of taipei.slice(15, 23))
    plan({ modelKey: 'dock', status: 'deployed', assignee: p, ageMonths: rand.int(3, 30) });
  for (let i = 0; i < 10; i++) plan({ modelKey: 'u2724d', status: 'in_stock', ageMonths: rand.int(1, 6) });
  for (let i = 0; i < 2; i++) plan({ modelKey: 'dock', status: 'in_stock', ageMonths: 2 });

  // Finance desktops, sales tablets.
  for (const p of inDept('FIN').slice(0, 4))
    plan({ modelKey: 'optiplex', status: 'deployed', assignee: p, ageMonths: rand.int(10, 40) });
  for (let i = 0; i < 2; i++) plan({ modelKey: 'optiplex', status: 'in_stock', ageMonths: 6 });
  const tabletUsers = laptopUsers.filter((p) => p.dept?.startsWith('SALES')).slice(-4);
  for (const p of tabletUsers)
    plan({ modelKey: 'ipad', status: 'deployed', assignee: p, ageMonths: rand.int(2, 16) });
  plan({ modelKey: 'ipad', status: 'in_stock', ageMonths: 3 });
  for (let i = 0; i < 2; i++)
    plan({ modelKey: 'iphone', status: 'in_stock', ageMonths: 1, location: storeroom });

  // Spare laptops, repairs, a lost one, retirements.
  for (let i = 0; i < 5; i++)
    plan({
      modelKey: i < 3 ? 't14' : 'latitude',
      status: 'in_stock',
      ageMonths: rand.int(1, 8),
      notes: 'Imaged with the standard Windows 11 build; ready for new starters.',
    });
  const repair1 = plan({
    modelKey: 'latitude',
    status: 'in_repair',
    ageMonths: 19,
    notes: 'Swollen battery — Dell depot repair, RMA 7781-2210.',
  });
  repair1.events.push({
    kind: 'status_changed',
    at: at(addDays(today, -6), 11),
    from: 'in_stock',
    to: 'in_repair',
    note: 'Sent to the Dell depot (RMA 7781-2210).',
  });
  const repairUser = others[others.length - 1] ?? null;
  const repair2 = plan({
    modelKey: 't14',
    status: 'in_repair',
    assignee: repairUser,
    ageMonths: 26,
    notes: 'Keyboard replacement under warranty; loaner TPE-LT spare issued.',
  });
  repair2.events.push({
    kind: 'status_changed',
    at: at(addDays(today, -3), 15),
    from: 'deployed',
    to: 'in_repair',
    note: 'Keyboard keys failing — Lenovo onsite technician booked.',
  });
  const lostUser = others[others.length - 2] ?? null;
  const lost = plan({
    modelKey: 'x1',
    status: 'lost',
    assignee: lostUser,
    ageMonths: 12,
    notes: 'Reported lost in a taxi; remote wipe sent through Intune.',
  });
  lost.events.push({
    kind: 'status_changed',
    at: at(addDays(today, -12), 20, 15),
    from: 'deployed',
    to: 'lost',
    note: 'Left in a taxi after a customer visit. Police report 1130-2291; device wiped remotely.',
  });
  const retiredA = plan({
    modelKey: 'latitude',
    status: 'retired',
    ageMonths: 47,
    notes: 'End of life: slow, battery worn.',
  });
  retiredA.events.push({
    kind: 'status_changed',
    at: at(addDays(today, -20)),
    from: 'in_stock',
    to: 'retired',
    note: 'Past its 3-year life.',
  });
  const retiredB = plan({
    modelKey: 't14',
    status: 'retired',
    ageMonths: 41,
    notes: 'Cracked screen; not worth repairing.',
  });
  retiredB.events.push({
    kind: 'status_changed',
    at: at(addDays(today, -9)),
    from: 'in_stock',
    to: 'retired',
    note: 'Cracked screen — repair quote above book value.',
  });
  const disposed = plan({ modelKey: 'latitude', status: 'disposed', ageMonths: 52 });
  disposed.disposedAt = at(addDays(today, -40), 16);
  disposed.disposalNote = 'Drive shredded by the certified recycler (certificate DR-2026-0412).';
  disposed.events.push(
    { kind: 'status_changed', at: at(addDays(today, -60)), from: 'in_stock', to: 'retired' },
    { kind: 'disposal_requested', at: at(addDays(today, -58)), note: disposed.disposalNote },
    {
      kind: 'disposed',
      at: disposed.disposedAt,
      from: 'retired',
      to: 'disposed',
      note: disposed.disposalNote,
    },
  );

  // On order: three MacBooks for the next intake.
  for (let i = 0; i < 3; i++)
    plan({
      modelKey: 'mbp',
      status: 'ordered',
      ageMonths: 0,
      ageDays: 3,
      serial: null,
      notes: 'PO-2026-0931, delivery expected next week.',
    });

  // Printers per floor and office (no assignee).
  const printers: [string, string, string][] = [
    ['TPE-12F-PRN-01', 'Taipei HQ 12F', 'IS'],
    ['TPE-10F-PRN-01', 'Taipei HQ 10F', 'FIN'],
    ['TPE-8F-PRN-01', 'Taipei HQ 8F', 'SALES-TPE'],
    ['HSC-2F-PRN-01', 'Hsinchu R&D Center', 'RND'],
    ['KHH-1F-PRN-01', 'Kaohsiung Office', 'OPS'],
    ['TYO-PRN-01', 'Tokyo Office', 'SALES-TYO'],
  ];
  for (const [name, location, dept] of printers)
    plan({ modelKey: 'laserjet', name, status: 'deployed', ageMonths: 22, location, departmentCode: dept });

  // Data center: servers and network gear, the hardware behind CMDB CIs.
  for (const i of INFRASTRUCTURE)
    plan({
      modelKey: i.model,
      name: i.name,
      status: 'deployed',
      ageMonths: i.ageMonths,
      ageDays: 0,
      location: i.location,
      departmentCode: 'IS-INFRA',
      ci: i.name,
      serial: i.serial,
    });

  /* ───────────── insert hardware ───────────── */
  const assetRows = await db
    .insert(assets)
    .values(
      planned.map((a) => {
        const lastEvent = a.events.reduce((t, e) => (e.at > t ? e.at : t), a.events[0]!.at);
        return {
          number: a.number,
          name: a.name,
          category: a.category,
          modelId: model(a.model.key).row.id,
          serialNumber: a.serial,
          status: a.status,
          assignedTo: a.assignee?.id ?? null,
          assignedAt: a.assignedAt,
          location: a.location,
          departmentId: a.departmentId,
          ciId: a.ciId,
          vendorId: vendorId.get(a.model.vendor) ?? null,
          purchaseDate: a.purchaseDate,
          purchaseCost: a.cost,
          currency,
          invoiceNumber: a.status === 'ordered' ? null : a.invoice,
          warrantyEnd: a.status === 'ordered' ? null : a.warrantyEnd,
          retireOn: defaultRetireOn(a.purchaseDate, model(a.model.key).row.lifespanMonths, a.category),
          notes: a.notes ?? null,
          disposedAt: a.disposedAt ?? null,
          disposalNote: a.disposalNote ?? null,
          createdAt: a.events[0]!.at,
          updatedAt: lastEvent,
        };
      }),
    )
    .returning({ id: assets.id, number: assets.number });
  const assetId = new Map(assetRows.map((r) => [r.number, r.id]));
  await db.execute(sql`select setval('itam.asset_number_seq', (select max(number) from itam.assets))`);
  await db.insert(assetEvents).values(
    planned.flatMap((a) =>
      a.events.map((e) => ({
        assetId: assetId.get(a.number)!,
        kind: e.kind,
        fromValue: e.from ?? null,
        toValue: e.to ?? null,
        userId: e.userId ?? null,
        ...actor(e.kind === 'created' || e.kind === 'disposed' ? null : itOps),
        note: e.note ?? null,
        createdAt: e.at,
      })),
    ),
  );

  /* ───────────── contracts ───────────── */
  const contractRows = await db
    .insert(contracts)
    .values(
      CONTRACTS.map((c, i) => {
        const startDate = addMonths(today, c.startMonths);
        const endDate = addDays(today, c.endDays);
        const noticeDays = c.noticeDays ?? 60;
        return {
          number: i + 1,
          title: c.title,
          vendorId: (c.vendor && vendorId.get(c.vendor)) ?? null,
          kind: c.kind,
          status: contractStatusFor(
            { status: c.draft ? 'draft' : 'active', startDate, endDate, noticeDays },
            today,
          ),
          startDate,
          endDate,
          autoRenew: c.autoRenew ?? false,
          noticeDays,
          cost: c.cost,
          currency,
          billing: c.billing,
          ownerId: nth(c.owner[0], c.owner[1])?.id ?? null,
          notes: c.notes,
          createdAt: at(startDate, 11, 0),
        };
      }),
    )
    .returning({ id: contracts.id, title: contracts.title });
  const contractId = new Map(contractRows.map((c) => [c.title, c.id]));
  await db.execute(sql`select setval('itam.contract_number_seq', (select max(number) from itam.contracts))`);

  /* ───────────── licences, seats and installs ───────────── */
  const licenseRows = await db
    .insert(licenses)
    .values(
      LICENSES.map((l, i) => ({
        number: i + 1,
        product: l.product,
        publisher: l.publisher,
        vendorId: (l.vendor && vendorId.get(l.vendor)) ?? null,
        licenseType: l.type,
        quantity: l.quantity,
        cost: l.cost || null,
        currency,
        billing: l.billing,
        startDate: addMonths(today, l.startMonths),
        endDate: l.endDays === null ? null : addDays(today, l.endDays),
        contractId: (l.contract && contractId.get(l.contract)) ?? null,
        licenseKeySealed: l.key ? ctx.secrets.seal(l.key) : null,
        notes: l.notes ?? null,
        createdAt: at(addMonths(today, l.startMonths), 10, 0),
      })),
    )
    .returning({ id: licenses.id, product: licenses.product, startDate: licenses.startDate });
  const licenseId = new Map(licenseRows.map((l) => [l.product, l.id]));
  await db.execute(sql`select setval('itam.license_number_seq', (select max(number) from itam.licenses))`);

  const laptopOf = new Map<string, number>();
  for (const a of planned)
    if (a.assignee && (a.category === 'laptop' || a.category === 'desktop') && !laptopOf.has(a.assignee.id))
      laptopOf.set(a.assignee.id, a.number);
  const holders = new Map<string, Person[]>();
  const seats: (typeof licenseAssignments.$inferInsert)[] = [];
  for (const l of LICENSES) {
    const id = licenseId.get(l.product)!;
    const start = addMonths(today, l.startMonths);
    if (l.type === 'per_device') {
      const servers = planned.filter((a) => a.model.key === 'r760').slice(0, l.seats);
      for (const s of servers)
        seats.push({
          licenseId: id,
          assetId: assetId.get(s.number)!,
          assignedBy: admin?.id ?? null,
          assignedAt: at(start),
        });
      continue;
    }
    if (l.type === 'site' || !l.seats) continue;
    const preferred = l.departments
      ? [
          ...people.filter((p) => p.dept && l.departments!.includes(p.dept) && laptopOf.has(p.id)),
          ...people.filter((p) => p.dept && l.departments!.includes(p.dept) && !laptopOf.has(p.id)),
          ...people.filter((p) => !p.dept || !l.departments!.includes(p.dept)),
        ]
      : people;
    const chosen = [...new Set(preferred)].slice(0, l.seats);
    holders.set(l.product, chosen);
    for (const p of chosen)
      seats.push({
        licenseId: id,
        userId: p.id,
        assignedBy: admin?.id ?? null,
        assignedAt: at(addDays(start, rand.int(0, 40)), rand.int(9, 17), rand.int(0, 59)),
      });
  }
  for (let i = 0; i < seats.length; i += 500)
    await db.insert(licenseAssignments).values(seats.slice(i, i + 500));

  const installs: (typeof softwareInstallations.$inferInsert)[] = [];
  const seen = new Set<string>();
  const install = (number: number | undefined, product: string, publisher: string, version: string) => {
    if (number === undefined) return;
    const a = planned[number - 1]!;
    if (a.status === 'ordered' || a.status === 'disposed') return;
    const key = `${number}:${product.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const first = a.assignedAt ?? at(addDays(a.purchaseDate, 3));
    installs.push({
      assetId: assetId.get(number)!,
      product,
      publisher,
      version,
      source: 'api',
      firstSeenAt: first,
      lastSeenAt: new Date(Date.now() - rand.int(1, 40) * 3_600_000),
    });
  };
  const computers = planned.filter((a) => a.category === 'laptop' || a.category === 'desktop');
  for (const a of computers) {
    install(a.number, 'Microsoft 365 E3', 'Microsoft', '16.0.18025');
    install(a.number, 'Google Chrome', 'Google', '129.0.6668.90');
    install(a.number, '7-Zip', 'Igor Pavlov', '24.08');
    if (a.assignee?.dept?.startsWith('IS')) install(a.number, 'Notepad++', 'Notepad++ Team', '8.7');
  }
  const userInstalls: [product: string, publisher: string, version: string, share: number][] = [
    ['Adobe Acrobat Pro', 'Adobe', '24.003.20112', 0.87],
    ['Adobe Creative Cloud', 'Adobe', '6.4.0', 1],
    ['AutoCAD', 'Autodesk', '2025.1', 1],
    ['Zoom Workplace', 'Zoom Video Communications', '6.2.3', 0.9],
    ['Visual Studio Enterprise', 'Microsoft', '17.11.4', 1],
    ['JetBrains All Products Pack', 'JetBrains', '2024.2', 1],
    ['Microsoft Visio Plan 2', 'Microsoft', '16.0.18025', 1],
    ['Microsoft Project Plan 3', 'Microsoft', '16.0.18025', 1],
    ['TeamViewer Business', 'TeamViewer', '15.58.4', 1],
  ];
  for (const [product, publisher, version, share] of userInstalls)
    for (const p of holders.get(product) ?? [])
      if (rand.chance(share)) install(laptopOf.get(p.id), product, publisher, version);
  // Unlicensed: Acrobat and Visual Studio installed by people without a seat.
  const seated = (product: string) => new Set((holders.get(product) ?? []).map((p) => p.id));
  const acrobat = seated('Adobe Acrobat Pro');
  for (const a of computers.filter((c) => c.assignee && !acrobat.has(c.assignee.id)).slice(0, 8))
    install(a.number, 'Adobe Acrobat Pro', 'Adobe', '24.003.20112');
  // Two spares were imaged with the old build that still included Acrobat.
  for (const a of computers.filter((c) => c.status === 'in_stock').slice(0, 2))
    install(a.number, 'Adobe Acrobat Pro', 'Adobe', '23.008.20470');
  const vs = seated('Visual Studio Enterprise');
  for (const a of computers.filter((c) => c.assignee?.dept === 'RND' && !vs.has(c.assignee.id)).slice(0, 2))
    install(a.number, 'Visual Studio Enterprise', 'Microsoft', '17.11.4');
  for (const s of planned.filter((a) => a.model.key === 'r760')) {
    install(s.number, 'Windows Server 2025 Datacenter', 'Microsoft', '10.0.26100');
    install(s.number, 'Veeam Backup', 'Veeam', '12.2.0.334');
  }
  // Discovery review: a few devices still report Microsoft 365 under its old name (to map to the E3 licence), instead
  // of the licence's product. Pushed (and their E3 entries dropped) directly so the random sequence of the rest of the
  // seed stays the same.
  const oldName = computers.filter((c) => c.status === 'deployed').slice(-3);
  const renamed = new Set(oldName.map((a) => assetId.get(a.number)!));
  for (let i = installs.length - 1; i >= 0; i--)
    if (installs[i]!.product === 'Microsoft 365 E3' && renamed.has(installs[i]!.assetId))
      installs.splice(i, 1);
  for (const a of oldName)
    installs.push({
      assetId: assetId.get(a.number)!,
      product: 'Microsoft Office 365 ProPlus',
      publisher: 'Microsoft',
      version: '16.0.17928',
      source: 'api',
      firstSeenAt: a.assignedAt ?? at(addDays(a.purchaseDate, 3)),
      lastSeenAt: new Date(Date.now() - 5 * 3_600_000),
    });
  // Approved-software check: an unapproved shareware archiver on two laptops, a blocked torrent client on one.
  const deployedComputers = computers.filter((c) => c.status === 'deployed');
  for (const [k, a] of deployedComputers.slice(4, 7).entries())
    installs.push({
      assetId: assetId.get(a.number)!,
      product: k < 2 ? 'WinRAR' : 'uTorrent',
      publisher: k < 2 ? 'win.rar GmbH' : 'BitTorrent Inc.',
      version: k < 2 ? '7.01' : '3.6.0',
      source: 'api',
      firstSeenAt: new Date(Date.now() - (10 + k) * 86_400_000),
      lastSeenAt: new Date(Date.now() - (2 + k) * 3_600_000),
    });
  for (let i = 0; i < installs.length; i += 500)
    await db.insert(softwareInstallations).values(installs.slice(i, i + 500));
  // The latest report of each device from the inventory tool (the Discovery page's "Recent reports").
  const lastSeen = new Map<string, { at: Date; n: number }>();
  for (const i of installs) {
    const r = lastSeen.get(i.assetId) ?? { at: i.lastSeenAt as Date, n: 0 };
    lastSeen.set(i.assetId, {
      at: r.at > (i.lastSeenAt as Date) ? r.at : (i.lastSeenAt as Date),
      n: r.n + 1,
    });
  }
  const reports = [...lastSeen].map(([assetId, r]) => ({
    assetId,
    source: 'api' as const,
    reported: r.n,
    added: 0,
    updated: r.n,
    removed: 0,
    actorName: 'Microsoft Intune',
    createdAt: r.at,
  }));
  for (let i = 0; i < reports.length; i += 500)
    await db.insert(discoveryReports).values(reports.slice(i, i + 500));
  // 7-Zip is free: it needs no licence, so it stays out of the review list.
  await db
    .insert(softwareTitleRules)
    .values({ title: '7-Zip', licenseId: null, createdBy: admin?.id ?? null });

  /* ───────────── contract coverage ───────────── */
  const items: (typeof contractItems.$inferInsert)[] = [];
  for (const c of CONTRACTS) {
    const id = contractId.get(c.title)!;
    for (const key of c.covers?.models ?? [])
      for (const a of planned.filter(
        (x) => x.model.key === key && x.status !== 'disposed' && x.status !== 'ordered',
      ))
        items.push({ contractId: id, assetId: assetId.get(a.number)! });
    for (const name of c.covers?.assets ?? []) {
      const a = planned.find((x) => x.name === name);
      if (a) items.push({ contractId: id, assetId: assetId.get(a.number)! });
    }
    for (const product of c.covers?.licenses ?? [])
      if (licenseId.has(product)) items.push({ contractId: id, licenseId: licenseId.get(product)! });
  }
  if (items.length) await db.insert(contractItems).values(items);

  /* ───────────── the approved-software list ───────────── */
  type Approval = {
    title: string;
    publisher: string;
    licenseModel: (typeof approvedSoftware.$inferInsert)['licenseModel'];
    license?: string;
    contract?: string;
    departments?: string[];
    status?: 'allowed' | 'blocked';
    version?: string;
    validDays?: number;
    request?: string;
    notes?: string;
  };
  const APPROVED: Approval[] = [
    {
      title: 'Microsoft 365 E3',
      publisher: 'Microsoft',
      licenseModel: 'subscription',
      license: 'Microsoft 365 E3',
      contract: 'Microsoft Enterprise Agreement',
    },
    { title: 'Google Chrome', publisher: 'Google', licenseModel: 'free' },
    { title: '7-Zip', publisher: 'Igor Pavlov', licenseModel: 'open_source' },
    {
      title: 'Notepad++',
      publisher: 'Notepad++ Team',
      licenseModel: 'open_source',
      departments: ['IS', 'IS-INFRA', 'IS-SD', 'IS-APP', 'IS-SEC', 'IS-DATA'],
    },
    { title: 'Adobe Acrobat Pro', publisher: 'Adobe', licenseModel: 'paid', license: 'Adobe Acrobat Pro' },
    {
      title: 'Adobe Creative Cloud',
      publisher: 'Adobe',
      licenseModel: 'subscription',
      license: 'Adobe Creative Cloud',
    },
    {
      title: 'AutoCAD',
      publisher: 'Autodesk',
      licenseModel: 'subscription',
      license: 'AutoCAD',
      departments: ['RND', 'OPS'],
    },
    {
      title: 'Zoom Workplace',
      publisher: 'Zoom Video Communications',
      licenseModel: 'subscription',
      license: 'Zoom Workplace',
    },
    {
      title: 'Visual Studio Enterprise',
      publisher: 'Microsoft',
      licenseModel: 'subscription',
      license: 'Visual Studio Enterprise',
      departments: ['RND', 'IS-APP'],
    },
    {
      title: 'JetBrains All Products Pack',
      publisher: 'JetBrains',
      licenseModel: 'subscription',
      license: 'JetBrains All Products Pack',
      departments: ['RND', 'IS-APP'],
    },
    {
      title: 'Microsoft Visio Plan 2',
      publisher: 'Microsoft',
      licenseModel: 'subscription',
      license: 'Microsoft Visio Plan 2',
    },
    {
      title: 'Microsoft Project Plan 3',
      publisher: 'Microsoft',
      licenseModel: 'subscription',
      license: 'Microsoft Project Plan 3',
    },
    {
      title: 'TeamViewer Business',
      publisher: 'TeamViewer',
      licenseModel: 'subscription',
      license: 'TeamViewer Business',
      validDays: 9,
      notes: 'Short-term: remote support for the branch office move.',
    },
    {
      title: 'Windows Server 2025 Datacenter',
      publisher: 'Microsoft',
      licenseModel: 'paid',
      license: 'Windows Server 2025 Datacenter',
    },
    { title: 'Veeam Backup', publisher: 'Veeam', licenseModel: 'paid', license: 'Veeam Backup' },
    {
      title: 'uTorrent',
      publisher: 'BitTorrent Inc.',
      licenseModel: 'free',
      status: 'blocked',
      notes: 'Peer-to-peer file sharing is not allowed on company devices.',
    },
  ];
  for (const e of APPROVED) {
    const [row] = await db
      .insert(approvedSoftware)
      .values({
        title: e.title,
        publisher: e.publisher,
        version: e.version ?? null,
        licenseModel: e.licenseModel,
        licenseId: (e.license && licenseId.get(e.license)) || null,
        contractId: (e.contract && contractId.get(e.contract)) || null,
        scope: e.departments ? 'departments' : 'company',
        status: e.status ?? 'allowed',
        validUntil: e.validDays !== undefined ? addDays(today, e.validDays) : null,
        notes: e.notes ?? null,
        requestReference: e.request ?? null,
        createdBy: admin?.id ?? null,
      })
      .returning({ id: approvedSoftware.id });
    const depts = (e.departments ?? [])
      .map((code) => deptId.get(code))
      .filter((x): x is string => Boolean(x));
    if (depts.length)
      await db
        .insert(approvedSoftwareDepartments)
        .values(depts.map((departmentId) => ({ entryId: row!.id, departmentId })));
  }

  /* ───────────── returned laptops waiting for their data wipe ───────────── */
  const spares = computers.filter((c) => c.status === 'in_stock' && c.category === 'laptop').slice(0, 2);
  for (const [k, a] of spares.entries()) {
    const id = assetId.get(a.number)!;
    // One was returned a while ago and its wipe is overdue; the other's data is kept for another month.
    const retain = k === 0 ? addDays(today, -70) : addDays(today, 30);
    const due = addMonths(retain, cfg.wipeMonths);
    await db.update(assets).set({ dataRetainUntil: retain, wipeDue: due }).where(eq(assets.id, id));
    await db.insert(assetEvents).values({
      assetId: id,
      kind: 'wipe_scheduled',
      fromValue: retain,
      toValue: due,
      actorId: itOps?.id ?? null,
      actorName: itOps ? null : 'Assets',
      createdAt: at(addDays(today, k === 0 ? -95 : -3)),
    });
  }

  /* ───────────── compliance, a pending disposal, the signed contract ───────────── */
  const svc = services(ctx);
  await svc.licenses.recomputeAll(today);

  const requester = helpdesk ?? admin;
  if (requester) {
    try {
      await svc.assets.requestDisposal(
        formatAssetTag(retiredB.number),
        { note: 'Cracked screen and worn battery. Wipe the SSD and send it to the certified recycler.' },
        seedAuth(requester),
      );
    } catch (err) {
      ctx.logger.warn({ err }, 'itam seed: could not start the demo disposal request');
    }
  }

  const dell = contractId.get('Dell ProSupport');
  if (dell) {
    try {
      await ctx.files.attach(
        { type: 'itam.contract', id: dell },
        {
          name: 'Dell-ProSupport-Plus-signed.pdf',
          contentType: 'application/pdf',
          data: samplePdf('Dell ProSupport Plus - Service Agreement', [
            'Customer: IS Big Platform demo company, Taipei',
            'Coverage: 8 x PowerEdge R760, 4-hour onsite, 24x7',
            'Keep Your Hard Drive: included',
            'Signed by both parties (demo document)',
          ]),
        },
      );
    } catch (err) {
      ctx.logger.warn({ err }, 'itam seed: could not attach the sample contract PDF');
    }
  }

  ctx.logger.info(
    {
      vendors: vendorRows.length,
      models: modelRows.length,
      assets: assetRows.length,
      linkedCis: planned.filter((a) => a.ciId).length,
      licenses: licenseRows.length,
      seats: seats.length,
      installs: installs.length,
      contracts: contractRows.length,
    },
    'itam demo data created',
  );
}

/** The seed acts for a real person (the request shows their name), with the module's own rights. */
function seedAuth(p: Person): AuthContext {
  const base = systemAuth('Assets demo seed');
  const user: SessionUser = {
    id: p.id,
    email: p.email,
    username: p.username,
    displayName: p.displayName,
    locale: p.locale as SessionUser['locale'],
    timezone: p.timezone,
    departmentId: p.departmentId,
    avatarUrl: null,
  };
  return { ...base, principal: { type: 'user', id: p.id, name: p.displayName }, user };
}
