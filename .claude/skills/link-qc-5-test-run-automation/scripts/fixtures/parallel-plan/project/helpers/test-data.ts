/** A unique name for every record a test creates (the real helper adds phase, worker and retry). */
export function uniqueName(prefix: string): string {
  return prefix + '-' + Date.now().toString(36);
}
