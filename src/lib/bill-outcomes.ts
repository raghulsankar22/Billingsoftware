type OutcomeWriteResult = { error: unknown | null; data?: unknown };
type OutcomeWrite = () => PromiseLike<OutcomeWriteResult>;

export type OutcomeRecordResult = { recorded: true } | { recorded: false; error: string };

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Database update failed.";
}

export async function recordBillOutcome(write: OutcomeWrite): Promise<OutcomeRecordResult> {
  let lastError: unknown;

  // These field updates are idempotent, so one retry can recover from a transient database failure.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await write();
      if (!result.error) {
        if (!("data" in result) || result.data) return { recorded: true };
        lastError = new Error("No bill row was updated.");
      } else {
        lastError = result.error;
      }
    } catch (error) {
      lastError = error;
    }
  }

  return { recorded: false, error: errorMessage(lastError) };
}
