export function validateRowByColumnCount(
  row: string[],
  expectedColumnCount: number,
) {
  if (row.length !== expectedColumnCount) {
    throw new Error(
      `Expected ${expectedColumnCount} columns, got ${row.length}`,
    );
  }
}
