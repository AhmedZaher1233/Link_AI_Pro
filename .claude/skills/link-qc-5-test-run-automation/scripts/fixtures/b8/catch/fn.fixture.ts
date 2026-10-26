// B8 empty-catch — FALSE-NEGATIVE GUARDS: whitespace, a lone semicolon, a typed parameter, undefined and async still fire.
export async function cleanup(remove: () => Promise<void>) {
  try {
    await remove();
  } catch (error: unknown) {

  }
  try { await remove(); } catch { ; }
  await remove().catch((_e: Error) => undefined);
  await remove().catch(async () => {});
}
