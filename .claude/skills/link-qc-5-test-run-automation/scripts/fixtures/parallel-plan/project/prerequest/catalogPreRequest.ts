import type { APIRequestContext } from '@playwright/test';

/** Provisioning functions for catalogs — API only, never UI. */
export async function createCatalog(api: APIRequestContext, name: string): Promise<string> {
  const res = await api.post('/api/catalogs', { data: { name } });
  return (await res.json()).id;
}

export async function deleteCatalog(api: APIRequestContext, id: string): Promise<void> {
  await api.delete('/api/catalogs/' + id);
}
