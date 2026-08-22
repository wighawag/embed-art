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

export function section(name: string): void {
  console.log(`\n  ${name}`);
}

export function report(): void {
  console.log("");
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`  ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}
