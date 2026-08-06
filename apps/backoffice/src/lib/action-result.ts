export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export const INITIAL_ACTION_RESULT: ActionResult = { ok: true, message: "" };

export async function runAction(
  fn: () => PromiseLike<{ error: { message: string } | null }>,
  successMessage: string,
): Promise<ActionResult> {
  try {
    const { error } = await fn();
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: successMessage };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Erro inesperado." };
  }
}
