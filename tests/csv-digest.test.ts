import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendCsvContentDigest,
  digestCsvRows,
  emptyCsvContentDigest,
  formatCsvContentDigest,
} from '../src/lib/csv/parse/digest.ts';

const rows = [
  [' name ', 'note'],
  ['one', 'contains,comma'],
  ['two', 'line one\nline two'],
  ['three', 'café 東京'],
];

test('combines chunk digests into the whole-document digest', () => {
  const whole = digestCsvRows(rows, {
    firstRowIsHeader: true,
    trimHeader: true,
  });
  const firstChunk = digestCsvRows(rows.slice(0, 2), {
    firstRowIsHeader: true,
    trimHeader: true,
  });
  const secondChunk = digestCsvRows(rows.slice(2), {
    firstRowIsHeader: false,
    trimHeader: true,
  });
  const combined = emptyCsvContentDigest();

  appendCsvContentDigest(combined, firstChunk);
  appendCsvContentDigest(combined, secondChunk);

  assert.deepEqual(combined, whole);
  assert.equal(formatCsvContentDigest(combined).length > 16, true);
});

test('detects cell, row-order, and header-normalization changes', () => {
  const baseline = formatCsvContentDigest(
    digestCsvRows(rows, { firstRowIsHeader: true, trimHeader: true }),
  );
  const changedCell = structuredClone(rows);
  changedCell[2][1] = 'line one\nline TWO';
  const reordered = [rows[0], rows[2], rows[1], rows[3]];

  assert.notEqual(
    formatCsvContentDigest(
      digestCsvRows(changedCell, {
        firstRowIsHeader: true,
        trimHeader: true,
      }),
    ),
    baseline,
  );
  assert.notEqual(
    formatCsvContentDigest(
      digestCsvRows(reordered, {
        firstRowIsHeader: true,
        trimHeader: true,
      }),
    ),
    baseline,
  );
  assert.notEqual(
    formatCsvContentDigest(
      digestCsvRows(rows, {
        firstRowIsHeader: true,
        trimHeader: false,
      }),
    ),
    baseline,
  );
});
