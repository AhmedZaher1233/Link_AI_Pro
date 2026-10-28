// Fixture endpoint client with violations — every finding line carries an `expect:` marker the harness reads.
type Recorded = { get(u: string, o?: object): Promise<unknown>; post(u: string, o?: object): Promise<unknown>; delete(u: string, o?: object): Promise<unknown> };
export class BadApi {
  constructor(private readonly request: Recorded) {}
  async list() { return this.request.get('/api/orders'); } // expect: api-effect-undeclared
  async remove(id: string) { return this.request.delete(`/api/orders/${id}`, { effect: 'remove' }); } // expect: api-effect-undeclared
  async search() { return this.request.post('/api/orders/search', { effect: 'mutation' }); } // expect: api-effect-mismatch
  async raw() { return fetch('https://example.test/api/orders'); } // expect: api-mutation-unledgered
  async follow() { return this.request.get('/api/orders/1', { effect: 'read', maxRedirects: 5 }); } // expect: api-redirect-enabled
  async token() { return this.request.get('/api/me', { effect: 'auth', headers: { 'x-api-key': 'k3y-1234567890' } }); } // expect: api-secret-header
}
