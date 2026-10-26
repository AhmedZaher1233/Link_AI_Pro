// B8 empty-catch — FALSE-POSITIVE GUARDS: documented swallows, rethrows and value fallbacks never fire.
export function heartbeat(write: () => void) {
  try {
    write();
  } catch { /* evidence only — the heartbeat never fails a test */ }
}

export async function saveOrThrow(save: () => Promise<void>) {
  try {
    await save();
  } catch (e) {
    throw new Error('save failed: ' + String(e));
  }
}

export async function settle(p: Promise<unknown>) {
  p.catch(() => { /* late rejection after the deadline: already reported */ });
  return p.catch((e) => { throw e; });
}

export async function isShown(visible: () => Promise<boolean>) {
  return visible().catch(() => false);
}
