export const billOperationHeader = "x-billing-operation-id";

export class BillIssuanceConflict extends Error {
  readonly status = 409;
  readonly issuanceCommitted = true;
}
