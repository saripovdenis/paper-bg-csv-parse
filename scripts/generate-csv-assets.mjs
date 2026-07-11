import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MEBIBYTE = 1024 * 1024;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = resolve(rootDir, 'assets');

const files = [
  {
    name: '01-small-1mib.csv',
    targetBytes: 1 * MEBIBYTE,
  },
  {
    name: '02-medium-10mib.csv',
    targetBytes: 10 * MEBIBYTE,
  },
  {
    name: '03-large-100mib.csv',
    targetBytes: 100 * MEBIBYTE,
  },
];

const legacyFileNames = [
  '01-main-faster-no-freeze.csv',
  '02-main-faster-freezes.csv',
  '03-worker-faster-stable.csv',
  '04-threshold-worker-worthy-freeze.csv',
  '05-threshold-worker-speed-parity.csv',
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
const notes = [
  'plain note',
  'contains comma, here',
  'line one\nline two',
  'escaped "quote"',
  'unicode café 東京',
];

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
    notes[index % notes.length],
  ]
    .map(csvCell)
    .join(',');
}

async function removePreviousAssets() {
  const generatedFileNames = files.map(({ name }) => name);

  await Promise.all(
    [...legacyFileNames, ...generatedFileNames].map((name) =>
      rm(resolve(assetsDir, name), { force: true }),
    ),
  );
}

async function writeCsv({ name, targetBytes }) {
  const filePath = resolve(assetsDir, name);
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  const header = `${headers.join(',')}\n`;
  let bytesWritten = Buffer.byteLength(header);
  let rowCount = 0;

  stream.write(header);

  while (true) {
    const line = `${makeRow(rowCount)}\n`;
    const lineBytes = Buffer.byteLength(line);

    if (bytesWritten + lineBytes > targetBytes) break;

    if (!stream.write(line)) {
      await once(stream, 'drain');
    }

    bytesWritten += lineBytes;
    rowCount += 1;
  }

  stream.end();
  await once(stream, 'finish');

  const { size } = await stat(filePath);
  if (size !== bytesWritten || size > targetBytes) {
    throw new Error(`Generated size invariant failed for ${name}`);
  }

  console.log(
    `${name}: ${rowCount.toLocaleString()} rows, ${(size / MEBIBYTE).toFixed(3)} MiB`,
  );
}

await mkdir(assetsDir, { recursive: true });
await removePreviousAssets();

for (const file of files) {
  await writeCsv(file);
}
