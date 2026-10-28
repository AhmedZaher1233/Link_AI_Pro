// selftest-api-db.mjs endpoint client — every call declares its effect (from the mapping, never the method).
import { expect, type APIResponse } from '@playwright/test';
import { assertStatus, type RecordedRequest } from '../helpers/api-record';
import { assertRecorded } from '../helpers/record';

export class OrdersApi {
  constructor(private readonly api: RecordedRequest) {}
  login(user: string) { return this.api.post('/api/login', { effect: 'auth', data: { user, password: process.env.A1_PASSWORD } }); }
  create(name: string, token?: string) { return this.api.post('/api/orders', { effect: 'mutation', data: { name }, resource: 'orders', keep: ['body.id', 'body.name'], headers: token ? { Authorization: 'Bearer ' + token } : {} }); }
  createUnknown(name: string) { return this.api.post('/api/orders', { effect: 'unknown', data: { name }, resource: 'orders' }); }
  search(term: string) { return this.api.post('/api/orders/search', { effect: 'read', data: { term }, keep: ['body.items[].id'] }); }
  touch(id: string) { return this.api.get('/api/orders/' + id + '/touch', { effect: 'mutation' }); }
  get(id: string) { return this.api.get('/api/orders/' + id, { effect: 'read', keep: ['body.status'] }); }
  rename(id: string, name: string) { return this.api.put('/api/orders/' + id, { effect: 'mutation', data: { name }, resource: 'orders' }); }
  bad() { return this.api.post('/api/bad', { effect: 'read', data: {}, keep: ['body.error.code'] }); }
  redirectForeign() { return this.api.post('/api/redirect-foreign', { effect: 'mutation', data: { name: 'x' } }); }
  redirect303() { return this.api.post('/api/redirect-303', { effect: 'mutation', data: { name: 'x' } }); }
  redirectOk() { return this.api.get('/api/redirect-ok', { effect: 'read', keep: ['body.status'] }); }
  redirectForeignRead() { return this.api.get('/api/redirect-foreign-read', { effect: 'read' }); }
  foreignHost() { return this.api.get('http://127.0.0.1:' + process.env.FOREIGN_PORT + '/api/orders', { effect: 'read' }); }
  leak() { return this.api.get('/api/leak', { effect: 'read', keep: ['body.note'] }); }
  async expectStatus(r: APIResponse, code: number, line: string) { await assertStatus(r, code, { line, entry: this.api.lastEntry() }); }
  async expectBody(r: APIResponse, path: string, value: unknown, line: string) {
    const body = await r.json();
    await assertRecorded('body.' + path, { line, entry: this.api.lastEntry() }, () => expect(path.split('.').reduce((o: any, k) => (o ? o[k] : undefined), body)).toEqual(value));
  }
}
