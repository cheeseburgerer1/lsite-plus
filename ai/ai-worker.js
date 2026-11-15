const system = { role: "system", content: "You are LAI, a personal assistant that helps users of this site." };
const runtime = new URL("./runtime/", import.meta.url);
let run;
let stopping;
let generating = false;

function emit(text) { if (text) postMessage({ type: "token", text }); }

async function fileEngine(file) {
  if (!file || !file.name.toLowerCase().endsWith(".gguf") || file.size > 650_000_000) {
    throw new Error("Choose the LAI model file (.gguf, under 650 MB).");
  }
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...header) !== "GGUF") throw new Error("This file is not a valid GGUF.");
  const { Wllama } = await import(new URL("wllama/index.js", runtime).href);
  const model = new Wllama({ default: new URL("wllama/wasm/wllama.wasm", runtime).href }, { suppressNativeLog: true });
  model.setCompat({
    wasm: new URL("wllama-compat/wllama.wasm", runtime).href,
    worker: new URL("wllama-compat/wllama.js", runtime).href
  }, "firefox_safari");
  postMessage({ type: "progress", label: "Initializing saved model…" });
  await model.loadModel([file], {
    n_ctx: 1280, n_batch: 64, n_ubatch: 32, n_parallel: 1, n_threads: 1,
    n_gpu_layers: 0, warmup: false, reasoning_format: "deepseek", jinja: true
  });
  const metadata = model.getModelMetadata();
  if (metadata.meta["general.architecture"] !== "qwen35" || metadata.hparams.nEmbd !== 1024 || ![24, 25].includes(metadata.hparams.nLayer)) {
    throw new Error("This model file is incompatible with LAI. Choose the LAI model file.");
  }

  return async (messages, thinking) => {
    let limited = [...messages];
    while (limited.length > 1 && limited.reduce((size, entry) => size + entry.content.length, 0) > 2400) {
      limited = limited.slice(limited[1]?.role === "assistant" ? 2 : 1);
    }
    const controller = new AbortController();
    stopping = { interrupt: () => controller.abort() };
    const chunks = await model.createChatCompletion({
      messages: [system, ...limited],
      max_tokens: thinking ? 384 : 224,
      chat_template_kwargs: { enable_thinking: thinking },
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
      signal: controller.signal
    });
    let thinkingOpen = false;
    for await (const chunk of chunks) {
      if (controller.signal.aborted) break;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning_content && thinking) {
        if (!thinkingOpen) emit("<think>\n");
        thinkingOpen = true;
        emit(delta.reasoning_content);
      }
      if (delta?.content) {
        if (thinkingOpen) emit("\n</think>\n");
        thinkingOpen = false;
        emit(delta.content);
      }
    }
  };
}

self.addEventListener("message", async ({ data }) => {
  if (data.type === "stop") {
    if (generating) generating = "stopped";
    stopping?.interrupt();
  }
  if (data.type === "load") {
    try {
      run = await fileEngine(data.file);
      postMessage({ type: "ready" });
    } catch (error) {
      const prefix = "Couldn’t open the saved model.";
      postMessage({ type: "failed", message: prefix + (error?.message ? " " + error.message : "") });
    }
  }
  if (data.type === "generate" && run && !generating) {
    generating = true;
    try {
      const recent = data.messages.filter(message => message.content).slice(-8);
      while (recent[0]?.role === "assistant") recent.shift();
      await run(recent, data.thinking === true);
      postMessage({ type: "finished", stopped: generating === "stopped" });
    } catch (error) {
      if (generating === "stopped") postMessage({ type: "finished", stopped: true });
      else postMessage({ type: "generation-error", message: error?.message || "LAI couldn’t generate a reply." });
    } finally {
      stopping = undefined;
      generating = false;
    }
  }
});
