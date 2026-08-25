/**
 * A deliberately tiny assertion helper. The project has no test framework and
 * does not need one for pure-function checks; adding Vitest here would cost
 * more than it returns.
 */
let passed = 0;
const failures: string[] = [];

export function eq(label: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    passed++;
  } else {
    failures.push(`${label}\n    got  ${g}\n    want ${w}`);
  }
}

/**
 * Refusing is a result too. Some inputs must NOT be quietly given a best
 * effort: a data: URI holding an image is not a metadata document, and
 * reporting "invalid JSON" about it would send the reader after the wrong bug.
 */
export function throws(label: string, fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    passed++;
    return;
  }
  failures.push(`${label}\n    got  no error\n    want it to throw`);
}

export function section(name: string): void {
  console.log(`\n  ${name}`);
}

export function report(): void {
  console.log("");
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`  ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}
