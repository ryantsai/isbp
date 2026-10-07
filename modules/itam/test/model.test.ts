import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  annualCost,
  ASSET_STATUSES,
  canAssign,
  canTransition,
  complianceState,
  contractStatusFor,
  daysBetween,
  defaultRetireOn,
  depreciation,
  disposalFacts,
  formatAssetTag,
  formatContractRef,
  formatLicenseRef,
  licenseUsage,
  manualTransitions,
  monthsBetween,
  nextTerm,
  noticeDate,
  parseRef,
  reminderDue,
  termMonths,
  todayIn,
  TRANSITIONS,
  warrantyState,
} from '../src/model';

describe('lifecycle transitions', () => {
  it('follow the documented map', () => {
    expect(TRANSITIONS.ordered).toEqual(['in_stock', 'lost']);
    expect(TRANSITIONS.in_stock).toEqual(['deployed', 'in_repair', 'retired', 'lost']);
    expect(TRANSITIONS.deployed).toEqual(['in_stock', 'in_repair', 'lost']);
    expect(TRANSITIONS.in_repair).toEqual(['in_stock', 'deployed', 'retired']);
    expect(TRANSITIONS.retired).toEqual(['disposed', 'in_stock']);
    expect(TRANSITIONS.lost).toEqual(['in_stock']);
    expect(TRANSITIONS.disposed).toEqual([]);
    for (const s of ASSET_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
  });

  it('refuses skipping steps and leaving disposed', () => {
    expect(canTransition('deployed', 'retired')).toBe(false);
    expect(canTransition('ordered', 'deployed')).toBe(false);
    expect(canTransition('disposed', 'in_stock')).toBe(false);
    expect(canTransition('retired', 'disposed')).toBe(true);
  });

  it('keeps disposal out of manual status changes', () => {
    expect(manualTransitions('retired')).toEqual(['in_stock']);
    expect(manualTransitions('in_stock')).not.toContain('disposed');
  });

  it('only assigns assets that are or may become deployed', () => {
    expect(['in_stock', 'deployed', 'in_repair'].every((s) => canAssign(s as 'in_stock'))).toBe(true);
    expect(['ordered', 'retired', 'disposed', 'lost'].some((s) => canAssign(s as 'in_stock'))).toBe(false);
  });
});

describe('references', () => {
  it('format and parse tags, licence and contract numbers', () => {
    expect(formatAssetTag(42)).toBe('AST-00042');
    expect(formatLicenseRef(12)).toBe('LIC-00012');
    expect(formatContractRef(7)).toBe('CTR-00007');
    expect(parseRef('asset', 'AST-00042')).toEqual({ number: 42 });
    expect(parseRef('asset', 'ast42')).toEqual({ number: 42 });
    expect(parseRef('asset', 'LIC-00042')).toBeNull();
    expect(parseRef('contract', ' ctr-7 ')).toEqual({ number: 7 });
    expect(parseRef('license', '0199A1B2-0000-7000-8000-000000000001')).toEqual({
      id: '0199a1b2-0000-7000-8000-000000000001',
    });
    expect(parseRef('asset', 'AST-0')).toBeNull();
    expect(parseRef('asset', 'drop table')).toBeNull();
  });
});

describe('calendar dates', () => {
  it('add days and months, clamping month ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-10-07', -12)).toBe('2025-10-07');
    expect(daysBetween('2026-10-07', '2026-10-01')).toBe(-6);
  });

  it('count whole months', () => {
    expect(monthsBetween('2026-01-15', '2026-02-14')).toBe(0);
    expect(monthsBetween('2026-01-15', '2026-02-15')).toBe(1);
    expect(monthsBetween('2023-10-07', '2026-10-07')).toBe(36);
    expect(monthsBetween('2027-01-01', '2026-01-01')).toBe(0);
  });

  it("knows today's date in Taipei", () => {
    expect(todayIn('Asia/Taipei', new Date('2026-10-06T17:30:00Z'))).toBe('2026-10-07');
    expect(todayIn('UTC', new Date('2026-10-06T17:30:00Z'))).toBe('2026-10-06');
  });
});

describe('depreciation', () => {
  const laptop = {
    cost: 36_000,
    purchaseDate: '2025-10-07',
    lifespanMonths: 36,
    category: 'laptop' as const,
  };

  it('is straight-line over the lifespan by whole months', () => {
    expect(depreciation(laptop, '2026-10-07')).toEqual({
      lifespanMonths: 36,
      ageMonths: 12,
      bookValue: 24_000,
      depreciatedPercent: 33.3,
      fullyDepreciatedOn: '2028-10-07',
    });
    expect(depreciation(laptop, '2025-10-07')!.bookValue).toBe(36_000);
    expect(depreciation(laptop, '2030-01-01')).toMatchObject({ bookValue: 0, depreciatedPercent: 100 });
  });

  it('falls back to the category lifespan and needs a cost and date', () => {
    expect(
      depreciation({ ...laptop, lifespanMonths: null, category: 'server' }, '2026-10-07')!.lifespanMonths,
    ).toBe(60);
    expect(depreciation({ ...laptop, cost: null }, '2026-10-07')).toBeNull();
    expect(depreciation({ ...laptop, purchaseDate: null }, '2026-10-07')).toBeNull();
    expect(defaultRetireOn('2025-10-07', null, 'phone')).toBe('2027-10-07');
    expect(defaultRetireOn(null, 36, 'laptop')).toBeNull();
  });
});

describe('warranty', () => {
  it('flags expiring and expired warranties', () => {
    expect(warrantyState(null, '2026-10-07')).toBe('none');
    expect(warrantyState('2026-10-06', '2026-10-07')).toBe('expired');
    expect(warrantyState('2026-10-07', '2026-10-07')).toBe('expiring');
    expect(warrantyState('2026-11-06', '2026-10-07')).toBe('expiring');
    expect(warrantyState('2026-11-07', '2026-10-07')).toBe('active');
    expect(warrantyState('2026-11-07', '2026-10-07', 60)).toBe('expiring');
  });
});

describe('compliance', () => {
  const today = '2026-10-07';
  const state = (quantity: number | null, used: number, endDate: string | null = null, pct?: number) =>
    complianceState({ quantity, used, endDate }, today, pct === undefined ? {} : { underUsedPercent: pct });

  it('is over-deployed when more is used than entitled', () => {
    expect(state(40, 46)).toBe('over_deployed');
    expect(state(40, 40)).toBe('compliant');
    expect(state(null, 9999)).toBe('compliant');
  });

  it('is under-used below 60 % from 10 entitlements up', () => {
    expect(state(20, 6)).toBe('under_used');
    expect(state(20, 12)).toBe('compliant');
    expect(state(9, 1)).toBe('compliant');
    expect(state(10, 5)).toBe('under_used');
    expect(state(20, 12, null, 70)).toBe('under_used');
  });

  it('is expiring within 60 days and expired after the end', () => {
    expect(state(10, 8, '2026-11-20')).toBe('expiring');
    expect(state(10, 8, '2026-12-06')).toBe('expiring');
    expect(state(10, 8, '2026-12-07')).toBe('compliant');
    expect(state(10, 8, '2026-10-06')).toBe('expired');
    expect(state(10, 8, '2026-10-07')).toBe('expiring');
  });

  it('ranks expired over over-deployed over expiring over under-used', () => {
    expect(state(5, 9, '2026-01-01')).toBe('expired');
    expect(state(5, 9, '2026-10-20')).toBe('over_deployed');
    expect(state(20, 2, '2026-10-20')).toBe('expiring');
  });

  it('counts unlicensed installs as usage for per-device licences only', () => {
    expect(licenseUsage('per_device', 7, 2)).toBe(9);
    expect(licenseUsage('per_user', 7, 2)).toBe(7);
  });
});

describe('money', () => {
  it('annualises recurring charges', () => {
    expect(annualCost(68_000, 'monthly')).toBe(816_000);
    expect(annualCost(10_000, 'quarterly')).toBe(40_000);
    expect(annualCost(420_000, 'annual')).toBe(420_000);
    expect(annualCost(1_150_000, 'one_time', 36)).toBeCloseTo(383_333.33, 2);
    expect(annualCost(5_000, 'one_time', 6)).toBe(5_000);
    expect(annualCost(5_000, 'one_time')).toBeNull();
    expect(annualCost(null, 'annual')).toBeNull();
  });
});

describe('contract renewals', () => {
  const base = { status: 'active' as const, startDate: '2025-11-01', endDate: '2026-10-31', noticeDays: 60 };

  it('moves contracts to expiring at the notice date and to expired after the end', () => {
    expect(noticeDate('2026-10-31', 60)).toBe('2026-09-01');
    expect(contractStatusFor(base, '2026-08-31')).toBe('active');
    expect(contractStatusFor(base, '2026-09-01')).toBe('expiring');
    expect(contractStatusFor(base, '2026-10-31')).toBe('expiring');
    expect(contractStatusFor(base, '2026-11-01')).toBe('expired');
    expect(contractStatusFor({ ...base, status: 'draft' }, '2026-11-01')).toBe('draft');
    expect(contractStatusFor({ ...base, status: 'cancelled' }, '2026-09-15')).toBe('cancelled');
    expect(contractStatusFor({ ...base, endDate: null }, '2030-01-01')).toBe('active');
  });

  it('reminds once when the notice period starts, again a week before the end, never twice', () => {
    const c = { ...base, lastReminderFor: null as string | null, lastRemindedOn: null as string | null };
    expect(reminderDue(c, '2026-08-31')).toBeNull();
    expect(reminderDue(c, '2026-09-01')).toBe('notice');
    const reminded = { ...c, lastReminderFor: '2026-10-31', lastRemindedOn: '2026-09-01' };
    expect(reminderDue(reminded, '2026-09-02')).toBeNull();
    expect(reminderDue(reminded, '2026-10-23')).toBeNull();
    expect(reminderDue(reminded, '2026-10-24')).toBe('final');
    const final = { ...reminded, lastRemindedOn: '2026-10-24' };
    expect(reminderDue(final, '2026-10-25')).toBeNull();
    expect(reminderDue(final, '2026-11-01')).toBeNull(); // after the end
  });

  it('sends a single reminder when the notice period is a week or less, or the job was late', () => {
    const short = { ...base, noticeDays: 5, lastReminderFor: null, lastRemindedOn: null };
    expect(reminderDue(short, '2026-10-26')).toBe('notice');
    expect(
      reminderDue({ ...short, lastReminderFor: '2026-10-31', lastRemindedOn: '2026-10-26' }, '2026-10-27'),
    ).toBeNull();
    const late = { ...base, lastReminderFor: null, lastRemindedOn: null };
    expect(reminderDue(late, '2026-10-28')).toBe('notice');
    expect(
      reminderDue({ ...late, lastReminderFor: '2026-10-31', lastRemindedOn: '2026-10-28' }, '2026-10-29'),
    ).toBeNull();
  });

  it('starts over for a renewed term and skips drafts and cancelled contracts', () => {
    const renewed = {
      ...base,
      endDate: '2027-10-31',
      lastReminderFor: '2026-10-31',
      lastRemindedOn: '2026-10-24',
    };
    expect(reminderDue(renewed, '2027-09-01')).toBe('notice');
    expect(reminderDue({ ...renewed, status: 'draft' }, '2027-09-01')).toBeNull();
    expect(reminderDue({ ...renewed, status: 'cancelled' }, '2027-09-01')).toBeNull();
  });

  it('rolls auto-renewals into a term of the same length', () => {
    expect(nextTerm('2025-11-01', '2026-10-31')).toEqual({ startDate: '2026-11-01', endDate: '2027-10-31' });
    expect(termMonths('2025-11-01', '2026-10-31')).toBe(12);
    expect(termMonths(null, '2026-10-31')).toBeNull();
  });
});

describe('disposal facts', () => {
  it('describe the asset for the approval conditions', () => {
    expect(
      disposalFacts(
        { category: 'laptop', purchaseCost: 36_000, purchaseDate: '2025-10-07', lifespanMonths: 36 },
        '2026-10-07',
      ),
    ).toEqual({ asset: { category: 'laptop', dataBearing: true, bookValue: 24_000, ageMonths: 12 } });
    expect(
      disposalFacts(
        { category: 'monitor', purchaseCost: null, purchaseDate: null, lifespanMonths: null },
        '2026-10-07',
      ),
    ).toEqual({ asset: { category: 'monitor', dataBearing: false, bookValue: 0, ageMonths: 0 } });
    expect(
      disposalFacts(
        { category: 'server', purchaseCost: 480_000, purchaseDate: '2019-01-01', lifespanMonths: 60 },
        '2026-10-07',
      ).asset,
    ).toMatchObject({ dataBearing: true, bookValue: 0, ageMonths: 93 });
  });
});
