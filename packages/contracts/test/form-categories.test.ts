import { describe, expect, it } from 'vitest';
import { canonicalCategory, categoryChoices, categoryMatchKey } from '../src/form-categories';

const known = ['hardware', 'software', 'security', 'access', 'changes', 'other'];

describe('form categories', () => {
  it('compares spellings without case and extra spaces', () => {
    expect(categoryMatchKey('  Software   purchase ')).toBe('software purchase');
    expect(categoryMatchKey('HARDWARE')).toBe(categoryMatchKey('hardware'));
  });

  it('stores a known key for any spelling of it, other text trimmed', () => {
    expect(canonicalCategory('Hardware', known)).toBe('hardware');
    expect(canonicalCategory(' changes ', known)).toBe('changes');
    expect(canonicalCategory('  Software  purchase ', known)).toBe('Software purchase');
    expect(canonicalCategory('   ', known)).toBeNull();
    expect(canonicalCategory(null, known)).toBeNull();
  });

  it('offers each category once: known keys as keys, others in their most used spelling', () => {
    expect(
      categoryChoices(
        [
          'Hardware',
          'hardware',
          null,
          'Facilities',
          'facilities ',
          'facilities',
          '',
          'security',
          'Security ',
        ],
        known,
      ),
    ).toEqual(['hardware', 'facilities', 'security']);
    // A tie keeps the first spelling seen.
    expect(categoryChoices(['HR', 'hr'], known)).toEqual(['HR']);
    expect(categoryChoices([], known)).toEqual([]);
  });
});
