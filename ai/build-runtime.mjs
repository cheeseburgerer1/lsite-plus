import { copyFile, cp, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("./", import.meta.url));
const root = join(site, "..");
const modules = process.argv[2];
if (!modules) throw new Error("Provide the directory containing the pinned runtime packages.");
const runtime = join(site, "runtime");
await mkdir(join(runtime, "transformers"), { recursive: true });
const transformers = join(modules, "@huggingface", "transformers");
const transformerRuntime = join(runtime, "transformers");
await copyFile(join(transformers, "dist", "transformers.min.js"), join(transformerRuntime, "transformers.min.js"));
const requireFromTransformers = createRequire(join(transformers, "package.json"));
const ortDist = dirname(requireFromTransformers.resolve("onnxruntime-web"));
const ortFiles = (await readdir(ortDist)).filter(name => /^ort-wasm-.+\.(?:mjs|wasm)$/.test(name));
for (const required of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  if (!ortFiles.includes(required)) throw new Error("Missing ONNX Runtime asset " + required);
}
await Promise.all(ortFiles.map(name => copyFile(join(ortDist, name), join(transformerRuntime, name))));
await cp(join(modules, "@wllama", "wllama", "esm"), join(runtime, "wllama"), { recursive: true });
await cp(join(modules, "@wllama", "wllama-compat", "wasm"), join(runtime, "wllama-compat"), { recursive: true });
for (const name of ["menu.css", "Roboto-Variable.ttf", "Roboto-OFL.txt"]) {
  await copyFile(join(root, name), join(site, name));
}
