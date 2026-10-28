// Fixture endpoint client (clean): every call declares its effect, the mapping agrees, redirects stay off.
import { expect } from '@playwright/test';
type Recorded = { get(u: string, o: object): Promise<{ status(): number }>; post(u: string, o: object): Promise<{ status(): number }> };
export class OrdersApi {
  constructor(private readonly request: Recorded) {}
  async search(term: string) { return this.request.post('/api/orders/search', { data: { term }, effect: 'read' }); }
  async create(name: string) { return this.request.post('/api/orders', { data: { name }, effect: 'mutation' }); }
  async get(id: string) { return this.request.get(`/api/orders/${id}`, { effect: 'read', maxRedirects: 0 }); }
  async expectStatus(r: { status(): number }, code: number) { expect(r.status()).toBe(code); }
}
