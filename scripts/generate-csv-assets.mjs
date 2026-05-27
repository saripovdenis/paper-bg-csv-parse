import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = resolve(rootDir, 'assets');

const files = [
  {
    name: '01-main-faster-no-freeze.csv',
    rows: 1_000,
  },
  {
    name: '02-main-faster-freezes.csv',
    rows: 10_000,
  },
  {
    name: '03-worker-faster-stable.csv',
    rows: 50_000,
  },
];

const headers = [
  'id',
  'account_id',
  'created_at',
  'amount',
  'quantity',
  'status',
  'region',
  'channel',
  'score',
  'note',
];

const statuses = [
  'new',
  'active',
  'paused',
  'closed',
  'archived',
  'needs_review',
];
const regions = ['na', 'eu', 'apac', 'latam', 'mea'];
const channels = ['web', 'mobile', 'partner', 'retail'];
const noteParts = [
  'plain note',
  'contains comma, inside quoted cell',
  'line one\nline two',
  'escaped ""quote"" inside field',
];
const longNote = Array.from(
  { length: 50 },
  (_, index) => noteParts[index % noteParts.length],
).join(' | ');

function csvCell(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function makeRow(index) {
  return [
    index + 1,
    `acct_${(index % 5_000) + 1}`,
    `2026-05-${String((index % 27) + 1).padStart(2, '0')}T12:${String(index % 60).padStart(2, '0')}:00Z`,
    ((index * 13.37) % 100_000).toFixed(2),
    (index % 17) + 1,
    statuses[index % statuses.length],
    regions[index % regions.length],
    channels[index % channels.length],
    ((index * 7) % 1_000) / 10,
    longNote,
  ]
    .map(csvCell)
    .join(',');
}

async function writeCsv({ name, rows }) {
  const filePath = resolve(assetsDir, name);
  const stream = createWriteStream(filePath, { encoding: 'utf8' });

  stream.write(`${headers.join(',')}\n`);

  for (let index = 0; index < rows; index += 1) {
    if (!stream.write(`${makeRow(index)}\n`)) {
      await once(stream, 'drain');
    }
  }

  stream.end();
  await once(stream, 'finish');

  const { size } = await stat(filePath);
  console.log(
    `${name}: ${rows.toLocaleString()} rows, ${(size / 1024 / 1024).toFixed(1)} MiB`,
  );
}

await mkdir(assetsDir, { recursive: true });

for (const file of files) {
  await writeCsv(file);
}
