import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_CLASSIFICATIONS,
  createArticleSchema,
  parseClassificationLevels,
  updateArticleSchema,
} from '../src/contracts';

describe('classification labels', () => {
  it('default to the four built-in levels, most restrictive first', () => {
    expect(parseClassificationLevels(undefined).map((l) => [l.key, l.builtIn, l.rank])).toEqual(
      BUILT_IN_CLASSIFICATIONS.map((k, i) => [k, true, i]),
    );
  });

  it('read one label per line: built-in keys or custom text, blanks and duplicates dropped', () => {
    expect(parseClassificationLevels('  Top Secret \r\n\nconfidential\nconfidential\n社外秘\n')).toEqual([
      { key: 'Top Secret', builtIn: false, rank: 0 },
      { key: 'confidential', builtIn: true, rank: 1 },
      { key: '社外秘', builtIn: false, rank: 2 },
    ]);
    expect(parseClassificationLevels('')).toEqual([]);
    expect(parseClassificationLevels('x'.repeat(150))[0]!.key).toHaveLength(100);
  });

  it('is optional on articles and can be cleared on update', () => {
    expect(createArticleSchema.parse({ title: 'A' }).classification).toBeUndefined();
    expect(createArticleSchema.parse({ title: 'A', classification: ' confidential ' }).classification).toBe(
      'confidential',
    );
    expect(updateArticleSchema.parse({ classification: null })).toEqual({ classification: null });
    expect(updateArticleSchema.parse({})).toEqual({});
  });
});
