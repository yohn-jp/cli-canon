export class OutputPolicyError extends Error {
  readonly failureKind: "serialization" | "budget";

  constructor(failureKind: "serialization" | "budget", message: string) {
    super(message);
    this.name = "OutputPolicyError";
    this.failureKind = failureKind;
  }
}
