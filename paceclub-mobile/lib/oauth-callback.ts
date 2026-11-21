// Match the configured native callback, allowing only its OAuth query parameters to vary.
export function matchesCallback(value: string, expected: string): boolean {
  try {
    const actual = new URL(value);
    const target = new URL(expected);
    return (
      !actual.username &&
      !actual.password &&
      actual.protocol === target.protocol &&
      actual.host === target.host &&
      actual.pathname === target.pathname
    );
  } catch {
    return false;
  }
}
