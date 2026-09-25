import * as z from "zod";
import {
  bindHandlers,
  compileProduct,
  defineCommands,
  executeCanonicalArgv,
  jsonOutput,
  textOutput,
  type CanonicalArgvOutcome,
  type DelegatedCommandRequest,
  type DomainErrorAdapter,
  type PresentationMode,
  type ProductPackageIdentity,
} from "../../src/index.js";
import {
  executeNodeCli,
  projectNodeCliExecution,
  runNodeCli,
  type NodeCliExecution,
  type NodeCliResultPresenter,
  type NodeCliVersion,
  type PresentationMode as NodePresentationMode,
} from "../../src/node/index.js";

const commands = defineCommands({
  "catalog.list": {
    route: ["list"],
    summary: "List entries.",
    input: {},
    result: z.object({ entries: z.array(z.string()) }),
  },
  "catalog.count": {
    route: ["count"],
    summary: "Count entries.",
    input: {},
    result: z.object({ total: z.number() }),
  },
});
const packageMetadata: ProductPackageIdentity = { name: "@example/catalog", version: "1.0.0" };
const product = compileProduct({
  name: "catalog",
  packageMetadata,
  commands,
  handlers: bindHandlers(commands)({
    "catalog.list": () => ({ entries: ["a"] }),
    "catalog.count": () => ({ total: 1 }),
  }),
});

// The presentation mode is one closed union shared by the root and Node entrypoints.
const human: PresentationMode = "human";
const machine: NodePresentationMode = "machine";
void human;
void machine;
// @ts-expect-error Presentation is not an open string.
const invalidMode: PresentationMode = "json";
void invalidMode;

// A heterogeneous presenter narrows by commandId while reading the resolved presentation mode.
const resultPresenter: NodeCliResultPresenter<typeof commands> = {
  success: (execution) => {
    execution.presentation satisfies PresentationMode;
    switch (execution.commandId) {
      case "catalog.list": {
        const entries: readonly string[] = execution.result.entries;
        // @ts-expect-error A list success never carries the count result.
        void execution.result.total;
        return execution.presentation === "machine" ? jsonOutput({ entries }) : textOutput(entries.join("\n"));
      }
      case "catalog.count": {
        const total: number = execution.result.total;
        // @ts-expect-error A count success never carries the list result.
        void execution.result.entries;
        return execution.presentation === "machine" ? jsonOutput({ total }) : textOutput(String(total));
      }
    }
  },
};

function describe(execution: NodeCliExecution<typeof commands>): PresentationMode {
  // Every Node execution outcome carries the presentation mode.
  const mode: PresentationMode = execution.presentation;
  if (execution.status === "version") {
    const version: NodeCliVersion = execution;
    version.packageMetadata.name satisfies string;
    version.packageMetadata.version satisfies string;
  }
  if (execution.status === "success" && execution.commandId === "catalog.count") {
    execution.result.total satisfies number;
  }
  return mode;
}

void executeNodeCli(product, ["list", "--json"]).then((execution) => {
  void describe(execution);
  projectNodeCliExecution(execution, { resultPresenter });
});
void runNodeCli(product, ["count"], { resultPresenter });

// Domain error adapters receive the mode; single-parameter adapters remain assignable.
interface Locked {
  readonly code: "LOCKED";
}
const isLocked = (error: unknown): error is Locked =>
  typeof error === "object" && error !== null && "code" in error && error.code === "LOCKED";
const modeAware: DomainErrorAdapter<Locked> = {
  is: isLocked,
  map: (error, presentation) => {
    presentation satisfies PresentationMode;
    return { exitCode: 4, stream: "stderr", output: `${error.code}\n` };
  },
};
const modeIndependent: DomainErrorAdapter<Locked> = {
  is: isLocked,
  map: (error) => ({ exitCode: 4, stream: "stderr", output: `${error.code}\n` }),
};
void runNodeCli(product, ["list"], { domainErrorAdapter: modeAware });
void runNodeCli(product, ["list"], { domainErrorAdapter: modeIndependent });

// Delegated executors receive the resolved mode in their request.
const delegatedRequest = (request: DelegatedCommandRequest): PresentationMode => request.presentation;
void delegatedRequest;

// The semantic runtime outcome carries the mode and a typed version request.
declare const backend: Parameters<typeof executeCanonicalArgv>[1]["backend"];
void executeCanonicalArgv(product, { argv: ["--version"], backend, help: product }).then(
  (outcome: CanonicalArgvOutcome<typeof commands>) => {
    outcome.presentation satisfies PresentationMode;
    if (outcome.status === "version") outcome.packageMetadata.version satisfies string;
    if (outcome.status === "success" && outcome.commandId === "catalog.list") {
      outcome.result.entries satisfies string[];
    }
  },
);

// Version identity belongs to the compiled product, not the argv request.
void executeCanonicalArgv(product, {
  argv: ["--version"],
  backend,
  help: product,
  // @ts-expect-error CanonicalArgvRequest cannot override package identity.
  packageMetadata: { name: "@example/override", version: "9.9.9" },
});
