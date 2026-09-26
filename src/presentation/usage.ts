import type { HelpDocument } from "../projection/help-model.js";

export interface UsageFailureMessage {
  readonly code: string;
  readonly option?: string;
  readonly value?: string;
}

/** Renders usage tokens projected from canonical route and field grammar. */
export function renderUsage(usage: HelpDocument["usage"]): string {
  return `Usage: ${usage.join(" ")}`;
}

/** The Canon message for a structured usage code, shared by the human and machine projections. */
export function usageFailureMessage(failure: UsageFailureMessage): string {
  switch (failure.code) {
    case "extra-positional-argument":
      return "too many arguments";
    case "unknown-option":
      return "unknown option";
    case "missing-option-value":
      return "option value missing";
    case "missing-required-option":
      return failure.option === undefined
        ? "required option not specified"
        : `required option '${failure.option}' not specified`;
    case "missing-positional-argument":
      return "required argument missing";
    case "unknown-command":
      return "unknown command";
    case "invalid-help-mode":
      return `unknown help mode ${JSON.stringify(failure.value ?? "")}`;
    case "no-command":
      return "no command selected";
    default:
      return "invalid command arguments";
  }
}

/** Renders a structured framework usage failure without consulting parser diagnostics. */
export function renderUsageFailure(failure: UsageFailureMessage, usage: HelpDocument["usage"]): string {
  return `error: ${usageFailureMessage(failure)}\n\n${renderUsage(usage)}\n`;
}
