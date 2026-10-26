// B8 empty-catch — TRUE POSITIVES (check 28): errors swallowed with no statement and no explanation.
export async function saveAll(items: { save(): Promise<void> }[]) {
  for (const item of items) {
    try {
      await item.save();
    } catch (e) {}
  }
}

export async function readLabel(get: () => Promise<string>) {
  return get().catch(() => {});
}
