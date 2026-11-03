import type { Locator } from '@playwright/test';

/** A sortable table component, scoped to its root locator. */
export class DataTable {
  constructor(private readonly root: Locator) {}

  async count(): Promise<number> {
    return this.root.locator('tbody tr').count();
  }

  async sortBy(column: string): Promise<void> {
    await this.root.getByRole('columnheader', { name: column }).click();
  }

  async cellText(row: number, column: number): Promise<string> {
    return (await this.root.locator('tbody tr').nth(row).locator('td').nth(column).textContent()) ?? '';
  }
}
