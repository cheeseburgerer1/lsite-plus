const modelId = "onnx-community/Qwen3.5-0.8B-ONNX";
const revision = "1c0849d8d3084bc7d6f8d00789d3f3cec0a6fda6";
const system = { role: "system", content: "You are lAI, a personal assistant that helps users of this site." };
const runtime = new URL("./runtime/", import.meta.url);
const promptLimit = 768;
let run;
let stopping;
let generating = false;

function report(value, label) { postMessage({ type: "progress", value, label }); }
function emit(text) { if (text) postMessage({ type: "token", text }); }

function downloadProgress(f16) {
  const sizes = f16
    ? { decoder_model_merged: 437, embed_tokens: 147, vision_encoder: 62 }
    : { decoder_model_merged: 485, embed_tokens: 163, vision_encoder: 68 };
  const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
  const received = new Map();
  return event => {
    const part = Object.keys(sizes).find(name => event.file?.includes(name) && event.file.endsWith(".onnx_data"));
    if (!part) return;
    if (event.status === "done") received.set(part, sizes[part]);
    if (event.status === "progress" && event.total > 0) {
      received.set(part, sizes[part] * Math.min(1, event.loaded / event.total));
    }
    const loaded = [...received.values()].reduce((sum, size) => sum + size, 0);
    const pct = Math.min(99, 100 * loaded / total);
    report(pct, pct === 99 ? "Starting model" : "Downloading model");
  };
}

async function onlineEngine() {
  const { AutoTokenizer, Qwen3_5ForConditionalGeneration, TextStreamer, InterruptableStoppingCriteria, env } =
    await import(new URL("transformers/transformers.min.js", runtime).href);
  const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
  const supportsF16 = Boolean(adapter?.features.has("shader-f16"));
  const dtype = supportsF16 ? "q4f16" : "q4";
  const options = { revision, progress_callback: downloadProgress(supportsF16) };
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = new URL("transformers/", runtime).href;
  const tokenizer = await AutoTokenizer.from_pretrained(modelId, options);
  const model = await Qwen3_5ForConditionalGeneration.from_pretrained(modelId, {
    ...options,
    dtype: { embed_tokens: dtype, decoder_model_merged: dtype, vision_encoder: dtype },
    device: adapter ? "webgpu" : "wasm"
  });

  return async (messages, thinking) => {
    stopping = new InterruptableStoppingCriteria();
    const limited = [...messages];
    let inputs;
    do {
      const formatted = tokenizer.apply_chat_template([system, ...limited], {
        add_generation_prompt: true,
        tokenize: false,
        enable_thinking: thinking
      });
      inputs = tokenizer(formatted, { add_special_tokens: false });
      if (inputs.input_ids.dims.at(-1) <= promptLimit) break;
      if (limited.length <= 1) throw new Error("Message is too long. Shorten it and send again.");
      limited.shift();
      while (limited[0]?.role === "assistant") limited.shift();
    } while (limited.length);
    if (thinking) emit("<think>\n");
    await model.generate({
      ...inputs,
      max_new_tokens: thinking ? 384 : 224,
      do_sample: true,
      temperature: thinking ? 0.7 : 0.8,
      top_k: 20,
      top_p: 0.95,
      repetition_penalty: 1.08,
      stopping_criteria: [stopping],
      streamer: new TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: false,
        callback_function: text => emit(text.replace(/<\|(?:im_end|endoftext)\|>/g, ""))
      })
    });
  };
}

async function fileEngine(file) {
  if (!file || !file.name.toLowerCase().endsWith(".gguf") || file.size > 650_000_000) {
    throw new Error("Choose a Qwen3.5-0.8B Q4 GGUF file under 650 MB.");
  }
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...header) !== "GGUF") throw new Error("This file is not a valid GGUF.");
  const { Wllama } = await import(new URL("wllama/index.js", runtime).href);
  const model = new Wllama({ default: new URL("wllama/wasm/wllama.wasm", runtime).href }, { suppressNativeLog: true });
  model.setCompat({
    wasm: new URL("wllama-compat/wllama.wasm", runtime).href,
    worker: new URL("wllama-compat/wllama.js", runtime).href
  }, "firefox_safari");
  report(10, "Initializing local model");
  await model.loadModel([file], {
    n_ctx: 1280, n_batch: 64, n_ubatch: 32, n_parallel: 1, n_threads: 1,
    n_gpu_layers: 0, warmup: false, reasoning_format: "deepseek", jinja: true
  });
  const metadata = model.getModelMetadata();
  if (metadata.meta["general.architecture"] !== "qwen35" || metadata.hparams.nEmbd !== 1024 || ![24, 25].includes(metadata.hparams.nLayer)) {
    throw new Error("This file is not a Qwen3.5-0.8B model.");
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
      run = await (data.mode === "file" ? fileEngine(data.file) : onlineEngine());
      postMessage({ type: "ready" });
    } catch (error) {
      const prefix = data.mode === "file" ? "Couldn’t load the GGUF file." : "Couldn’t download or initialize the model.";
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
      else postMessage({ type: "generation-error", message: error?.message || "lAI couldn’t generate a reply." });
    } finally {
      stopping = undefined;
      generating = false;
    }
  }
});
