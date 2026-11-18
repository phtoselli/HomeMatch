/** Picks the singular or plural form (Portuguese and English share the "one vs. other" rule). */
export function plural(n: number, one: string, other: string): string {
  return Math.abs(n) === 1 ? one : other;
}
