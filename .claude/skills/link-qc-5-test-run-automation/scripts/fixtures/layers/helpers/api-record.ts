// Fixture recorded request for the validator self-test (stands in for helpers/api-record.ts). Never executed.
// The real helper wraps APIRequestContext; a helper file is exempt from the api / db member rules.
export function attachApiRecord(request: { fetch(url: string): unknown }, info: unknown) {
  return { request, async report(i: unknown) { return [i, info, await fetch('about:blank')]; } };
}
