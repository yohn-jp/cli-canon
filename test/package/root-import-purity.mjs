import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export async function assertRootImportPure({ cwd, specifier }) {
  const script = `
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const resolvedSpecifier = import.meta.resolve(${JSON.stringify(specifier)});
const sourcePath = fileURLToPath(new URL(resolvedSpecifier));
const distributionIndex = sourcePath.lastIndexOf(path.sep + "dist" + path.sep);
const packageRoot = distributionIndex === -1 ? path.dirname(sourcePath) : sourcePath.slice(0, distributionIndex);
const effects = [];
const importErrors = [];
const originalArgv = process.argv;
const originalArgvDescriptor = Object.getOwnPropertyDescriptor(process, "argv");
const originalExit = process.exit;
const originalOn = process.on;
const originalAddListener = process.addListener;
const originalOnce = process.once;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
const record = (effect) => () => {
  effects.push(effect);
  throw new Error("blocked import side effect: " + effect);
};
const require = createRequire(import.meta.url);

const moduleNames = [
  "node:fs",
  "node:fs/promises",
  "node:net",
  "node:dgram",
  "node:dns",
  "node:http",
  "node:https",
  "node:tls",
  "node:child_process",
];
const builtins = Object.fromEntries(moduleNames.map((name) => [name, require(name)]));
const guardedFunctions = {
  "node:fs": [
    "access", "accessSync", "appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync", "copyFile",
    "copyFileSync", "link", "linkSync", "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync",
    "rename", "renameSync", "rm", "rmSync", "rmdir", "rmdirSync", "symlink", "symlinkSync",
    "truncate", "truncateSync", "unlink", "unlinkSync", "utimes", "utimesSync", "writeFile",
    "writeFileSync", "watch", "watchFile", "existsSync", "lstat", "lstatSync", "open", "openSync",
    "readFile", "readFileSync", "readdir", "readdirSync", "realpath", "realpathSync", "stat", "statSync",
  ],
  "node:fs/promises": [
    "access", "appendFile", "chmod", "chown", "copyFile", "link", "mkdir", "mkdtemp", "rename", "rm",
    "rmdir", "symlink", "truncate", "unlink", "utimes", "writeFile", "lstat", "open", "readFile",
    "readdir", "realpath", "stat",
  ],
  "node:net": ["connect", "createConnection", "createServer"],
  "node:dgram": ["createSocket"],
  "node:dns": [
    "lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCname",
    "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv",
    "resolveTxt", "reverse",
  ],
  "node:http": ["createServer", "get", "request"],
  "node:https": ["createServer", "get", "request"],
  "node:tls": ["connect", "createServer"],
  "node:child_process": [
    "exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync",
  ],
};
for (const [moduleName, keys] of Object.entries(guardedFunctions)) {
  const builtin = builtins[moduleName];
  for (const key of keys) {
    if (typeof builtin[key] === "function") {
      try {
        const original = builtin[key];
        const isFsRead =
          (moduleName === "node:fs" || moduleName === "node:fs/promises") &&
          /^(access|exists|lstat|open|read|readdir|realpath|stat)/u.test(key);
        builtin[key] = function (...args) {
          if (isFsRead) {
            const requestedPath = args[0] instanceof URL ? fileURLToPath(args[0]) : String(args[0]);
            const absolutePath = path.resolve(requestedPath);
            if (absolutePath.startsWith(packageRoot + path.sep) || absolutePath.includes(path.sep + "node_modules" + path.sep)) {
              return original.apply(this, args);
            }
          }
          return record(moduleName + "." + key)();
        };
      } catch {}
    }
  }
}
syncBuiltinESMExports();

process.exit = record("process.exit");
process.on = record("process.on");
process.addListener = record("process.addListener");
process.once = record("process.once");
process.stdout.write = record("stdout.write");
process.stderr.write = record("stderr.write");
try {
  Object.defineProperty(process, "argv", {
    configurable: true,
    get() {
      effects.push("process.argv");
      return originalArgv;
    },
  });
} catch (error) {
  importErrors.push("could not guard process.argv: " + error.message);
}

try {
  await import(resolvedSpecifier);
} catch (error) {
  importErrors.push(error instanceof Error ? error.message : String(error));
}

if (originalArgvDescriptor !== undefined) Object.defineProperty(process, "argv", originalArgvDescriptor);
process.exit = originalExit;
process.on = originalOn;
process.addListener = originalAddListener;
process.once = originalOnce;
process.stdout.write = originalStdoutWrite;
process.stderr.write = originalStderrWrite;
originalStdoutWrite.call(process.stdout, JSON.stringify({ effects, importErrors }) + "\\n");
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || "root import child process failed");
  assert.deepEqual(JSON.parse(result.stdout), { effects: [], importErrors: [] });
  assert.equal(result.stderr, "");
}
