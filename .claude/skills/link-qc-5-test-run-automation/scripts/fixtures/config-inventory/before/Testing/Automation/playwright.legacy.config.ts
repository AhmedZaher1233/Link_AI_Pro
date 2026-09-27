// Fixture: an orphaned config nothing refers to — a CANDIDATE with zero references.
import { defineConfig } from '@playwright/test';
export default defineConfig({ workers: 1, use: { headless: true } });
