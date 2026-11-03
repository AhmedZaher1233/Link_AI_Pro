import { test } from '@playwright/test';
import { TIMEOUTS } from '../timeouts';

/** Every step of a test runs through here so it has its own deadline. */
export async function step<T>(name: string, body: () => Promise<T>, timeout: number = TIMEOUTS.step.default): Promise<T> {
  return test.step(name, body, { timeout });
}
