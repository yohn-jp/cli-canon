import type { CanonicalArgvBackend, ComposedCommandNode, DelegatedCommandRequest } from "../../src/index.js";

// Existing backends without the composed delegated-leading capability remain source-compatible.
const legacyBackend: CanonicalArgvBackend<string, null> = {
  parseLeading: (_scope, argv) => ({ status: "parsed", operands: argv, state: null }),
  parseCommand: () => ({ status: "parsed", input: {} }),
};
void legacyBackend;

// The capability receives the composed-tree-resolved delegated node and the backend's own root state.
const composedBackend: CanonicalArgvBackend<string, { readonly leading: readonly string[] }> = {
  parseLeading: (_scope, argv) => ({ status: "parsed", operands: argv, state: { leading: [] } }),
  parseCommand: () => ({ status: "parsed", input: {} }),
  parseDelegatedLeading: (node: ComposedCommandNode, root) =>
    node.owner.kind === "delegated"
      ? { status: "parsed", argv: root.leading }
      : { status: "failure", failure: node.id },
};
void composedBackend;

const wrongCapability: CanonicalArgvBackend<string, null> = {
  parseLeading: (_scope, argv) => ({ status: "parsed", operands: argv, state: null }),
  parseCommand: () => ({ status: "parsed", input: {} }),
  // @ts-expect-error the capability returns argv, not canonical field input.
  parseDelegatedLeading: () => ({ status: "parsed", input: {} }),
};
void wrongCapability;

// The delegated executor contract is unchanged: leading occurrences arrive through `argv`.
const argvOf = (request: DelegatedCommandRequest): readonly string[] => request.argv;
void argvOf;
