import { copyFile, cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("./", import.meta.url));
const root = join(site, "..");
const modules = process.argv[2];
if (!modules) throw new Error("Provide the directory containing the pinned runtime packages.");
const runtime = join(site, "runtime");
await mkdir(join(runtime, "transformers"), { recursive: true });
const transformers = join(modules, "@huggingface", "transformers", "dist");
const transformerFiles = (await readdir(transformers)).filter(name =>
  name === "transformers.min.js" || /\.(?:mjs|wasm)$/.test(name)
);
if (!transformerFiles.includes("transformers.min.js")) throw new Error("Transformers.js browser bundle is missing.");
await Promise.all(transformerFiles.map(name => copyFile(join(transformers, name), join(runtime, "transformers", name))));
await cp(join(modules, "@wllama", "wllama", "esm"), join(runtime, "wllama"), { recursive: true });
await cp(join(modules, "@wllama", "wllama-compat", "wasm"), join(runtime, "wllama-compat"), { recursive: true });
for (const name of ["menu.css", "Roboto-Variable.ttf", "Roboto-OFL.txt"]) {
  await copyFile(join(root, name), join(site, name));
}
