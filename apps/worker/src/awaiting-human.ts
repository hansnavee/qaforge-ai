/** Thrown to release the BullMQ worker slot while a human gate is open. */
export class AwaitingHumanError extends Error {
  constructor(public readonly awaitStatus: string) {
    super(`Paused for human approval: ${awaitStatus}`);
    this.name = 'AwaitingHumanError';
  }
}
