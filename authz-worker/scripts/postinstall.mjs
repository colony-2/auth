import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const source = resolve(
  projectRoot,
  "node_modules",
  "@cedar-policy",
  "cedar-wasm",
  "web",
  "cedar_wasm_bg.wasm",
);
const destination = resolve(projectRoot, "src", "cedar_wasm_bg.wasm");

if (!existsSync(source)) {
  throw new Error(`cedar wasm binary not found at ${source}`);
}

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination);
