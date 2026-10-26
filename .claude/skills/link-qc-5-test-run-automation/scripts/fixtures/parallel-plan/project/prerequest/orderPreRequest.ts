import type { APIRequestContext } from '@playwright/test';

/** Provisioning functions for orders — API only, never UI. */
export async function createOrder(api: APIRequestContext, name: string): Promise<string> {
  const res = await api.post('/api/orders', { data: { name } });
  return (await res.json()).id;
}

export async function deleteOrder(api: APIRequestContext, id: string): Promise<void> {
  await api.delete('/api/orders/' + id);
}
