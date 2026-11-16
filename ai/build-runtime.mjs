import { access, copyFile, cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("./", import.meta.url));
const root = join(site, "..");
const modules = process.argv[2];
if (!modules) throw new Error("Provide the directory containing the pinned runtime packages.");
const runtime = join(site, "runtime");
await mkdir(runtime, { recursive: true });
await cp(join(modules, "@wllama", "wllama", "esm"), join(runtime, "wllama"), { recursive: true });
await cp(join(modules, "@wllama", "wllama-compat", "wasm"), join(runtime, "wllama-compat"), { recursive: true });
await copyFile(join(modules, "katex", "dist", "katex.mjs"), join(runtime, "katex.mjs"));
await copyFile(join(modules, "katex", "LICENSE"), join(runtime, "katex.LICENSE"));
await copyFile(join(modules, "marked", "lib", "marked.esm.js"), join(runtime, "marked.mjs"));
await copyFile(join(modules, "marked", "LICENSE"), join(runtime, "marked.LICENSE"));
for (const name of ["wllama/index.js", "wllama/wasm/wllama.wasm", "wllama-compat/wllama.js", "wllama-compat/wllama.wasm"]) {
  await access(join(runtime, name));
}
for (const name of ["menu.css", "Roboto-Variable.ttf", "Roboto-OFL.txt"]) {
  await copyFile(join(root, name), join(site, name));
}
