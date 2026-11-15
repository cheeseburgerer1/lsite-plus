const get = id => document.getElementById(id);
const prompt = get("prompt");
const messages = get("messages");
const chatList = get("chat-list");
const scroll = get("chat-scroll");
const modelDialog = get("model-dialog");
const clearDialog = get("clear-dialog");
const status = get("chat-status");
const send = get("send");
const stop = get("stop");
const thinkingButton = get("thinking");
const chatError = get("chat-error");
const modelError = get("model-error");
const history = get("history");
const storageKey = "lai-chats-v1";
const idleStatus = "First send downloads Qwen3.5-0.8B to your browser.";

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.chats)) return saved;
  } catch {}
  return { activeId: null, chats: [] };
}
const conversations = restore();
let activeChat = conversations.chats.find(chat => chat.id === conversations.activeId);
let worker;
let loading = false;
let ready = false;
let generating = false;
let queuedSend = false;
let thinking = false;
let loadFailed = false;
let loadAttempt = 0;
let activeReply;
let lastProgress = 0;

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(conversations));
    get("storage-error").hidden = true;
  } catch {
    get("storage-error").hidden = false;
  }
}

function clearError() {
  chatError.hidden = true;
  modelError.hidden = true;
}

function showError(message) {
  chatError.querySelector("span").textContent = message + " Contact";
  chatError.hidden = false;
  modelError.textContent = message;
  modelError.hidden = false;
}

function setHistoryOpen(open) {
  history.classList.toggle("is-open", open);
  get("show-history").setAttribute("aria-expanded", String(open));
}

function drawHistory() {
  const items = conversations.chats.map(chat => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-button";
    button.textContent = chat.messages.find(message => message.role === "user")?.content.trim().replace(/\s+/g, " ").slice(0, 65) || "New Chat";
    if (chat === activeChat) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => switchChat(chat));
    item.append(button);
    return item;
  });
  if (!items.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No chats yet";
    items.push(item);
  }
  chatList.replaceChildren(...items);
  get("clear-history").disabled = !conversations.chats.length;
  document.querySelectorAll("[data-export]").forEach(button => { button.disabled = !activeChat?.messages.length; });
}

function splitThought(message, inProgress = false) {
  const thoughts = [];
  const answer = message.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, (_, thought) => {
    if (thought.trim()) thoughts.push(thought.trim());
    return "";
  });
  const shownAnswer = inProgress ? answer.replace(/<\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, "") : answer;
  return { answer: shownAnswer.trim(), thought: thoughts.join("\n\n") };
}

function textBlock(text) {
  const paragraph = document.createElement("p");
  paragraph.className = "message-text";
  text.split(/(`[^`\n]+`)/).forEach((part, index) => {
    if (index % 2 === 0) paragraph.append(part);
    else {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      paragraph.append(code);
    }
  });
  return paragraph;
}

function codeBlock(language, text) {
  const block = document.createElement("div");
  block.className = "code-block";
  const tools = document.createElement("div");
  tools.className = "code-tools";
  const label = document.createElement("span");
  label.textContent = language || "Code";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "chat-button";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copy.textContent = "Selected";
    }
  });
  const pre = document.createElement("pre");
  pre.tabIndex = 0;
  const code = document.createElement("code");
  code.textContent = text;
  tools.append(label, copy);
  pre.append(code);
  block.append(tools, pre);
  return block;
}

function renderAnswer(bubble, content, inProgress = false) {
  const { answer, thought } = splitThought(content, inProgress);
  let accordion = bubble.querySelector(".thought");
  if (thought && !accordion) {
    accordion = document.createElement("details");
    accordion.className = "thought";
    const summary = document.createElement("summary");
    summary.textContent = "Thought Process";
    const text = document.createElement("p");
    text.className = "message-text";
    accordion.append(summary, text);
    bubble.prepend(accordion);
  }
  if (thought) accordion.lastElementChild.textContent = thought;
  else accordion?.remove();
  const body = bubble.lastElementChild;
  const items = [];
  let offset = 0;
  for (const match of answer.matchAll(/(?:^|\n) *```([\w.+#-]*)[ \t]*\n([\s\S]*?)(?:\n?```|$)/g)) {
    const prose = answer.slice(offset, match.index).trim();
    if (prose) items.push(textBlock(prose));
    items.push(codeBlock(match[1], match[2]));
    offset = match.index + match[0].length;
  }
  const remaining = answer.slice(offset).trim();
  if (remaining) items.push(textBlock(remaining));
  if (!items.length && inProgress) items.push(textBlock(thought ? "Thinking…" : "Generating…"));
  body.replaceChildren(...items);
}

function messageElement(message, inProgress = false) {
  const article = document.createElement("article");
  article.className = "message message-" + message.role;
  const label = document.createElement("strong");
  label.className = "message-label";
  label.textContent = message.role === "user" ? "You" : "lAI";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  if (message.role === "user") bubble.textContent = message.content;
  else {
    bubble.append(document.createElement("div"));
    renderAnswer(bubble, message.content, inProgress);
  }
  article.append(label, bubble);
  return article;
}

function scrollToLatest() { scroll.scrollTop = scroll.scrollHeight; }
function appendMessage(message, inProgress) {
  get("welcome").hidden = true;
  const article = messageElement(message, inProgress);
  messages.append(article);
  scrollToLatest();
  return article;
}

function drawConversation() {
  const current = activeChat?.messages || [];
  get("welcome").hidden = Boolean(current.length);
  messages.replaceChildren(...current.map(message => messageElement(message)));
  drawHistory();
  scrollToLatest();
}

function updateControls() {
  send.hidden = generating;
  send.disabled = loading;
  stop.hidden = !generating;
  stop.disabled = false;
  get("model-settings").disabled = generating || loading;
  get("download-model").disabled = loading;
  get("pick-file").disabled = loading;
}

function finishReply(note) {
  if (!activeReply) return;
  const reply = activeReply;
  activeReply = undefined;
  generating = false;
  if (reply.content.trim()) {
    renderAnswer(reply.article.lastElementChild, reply.content);
    const { role, content } = reply;
    reply.chat.messages.push({ role, content });
    save();
  } else {
    reply.article.remove();
  }
  updateControls();
  status.textContent = note;
}

function switchChat(chat) {
  if (generating) return;
  activeChat = chat;
  conversations.activeId = chat?.id ?? null;
  prompt.value = "";
  clearError();
  save();
  drawConversation();
  setHistoryOpen(false);
}

function submitPrompt() {
  const content = prompt.value.trim();
  if (!content || generating || loading) return;
  if (!ready) {
    queuedSend = true;
    openModelDialog();
    if (!loadFailed) load("online");
    return;
  }
  clearError();
  if (!activeChat) {
    activeChat = { id: crypto.randomUUID(), messages: [] };
    conversations.chats.unshift(activeChat);
    conversations.activeId = activeChat.id;
  }
  const message = { role: "user", content };
  activeChat.messages.push(message);
  save();
  drawHistory();
  appendMessage(message);
  prompt.value = "";
  const reply = { chat: activeChat, role: "assistant", content: "" };
  reply.article = appendMessage(reply, true);
  activeReply = reply;
  generating = true;
  updateControls();
  status.textContent = "Generating a reply…";
  worker.postMessage({
    type: "generate",
    messages: activeChat.messages.slice(-8).map(entry => entry.role === "assistant"
      ? { role: "assistant", content: splitThought(entry.content).answer }
      : entry),
    thinking
  });
}

function updateProgress(value, label) {
  const next = Math.max(lastProgress, Math.min(100, Math.floor(value)));
  lastProgress = next;
  get("progress-label").textContent = label;
  get("download-progress").value = next;
  get("percent").textContent = next + "%";
}

function openModelDialog() {
  get("model-title").textContent = ready ? "Change model" : "Download lAI’s model";
  get("model-progress").hidden = !loading;
  if (!modelDialog.open) modelDialog.showModal();
}

function failLoad(message) {
  worker?.terminate();
  worker = undefined;
  loading = false;
  ready = false;
  loadFailed = true;
  updateControls();
  showError(message);
  updateProgress(lastProgress, "Model loading failed");
  status.textContent = "Model unavailable";
}

async function load(mode, file) {
  if (loading || generating) return;
  const attempt = ++loadAttempt;
  worker?.terminate();
  loadFailed = false;
  clearError();
  loading = true;
  ready = false;
  lastProgress = 0;
  updateControls();
  get("model-progress").hidden = false;
  updateProgress(0, mode === "file" ? "Opening local model" : "Starting download");
  status.textContent = "Loading Qwen3.5-0.8B…";
  if (mode === "file" && navigator.serviceWorker) {
    await Promise.race([
      navigator.serviceWorker.register("./offline.js").then(() => navigator.serviceWorker.ready),
      new Promise(resolve => setTimeout(resolve, 1800))
    ]).catch(() => {});
    if (attempt !== loadAttempt) return;
  }
  try {
    worker = new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("error", event => {
      event.preventDefault();
      if (activeReply) finishReply("Generation stopped");
      failLoad("lAI couldn’t start or the model stopped unexpectedly.");
    });
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "progress") updateProgress(data.value, data.label);
      if (data.type === "failed") failLoad(data.message);
      if (data.type === "ready") {
        loading = false;
        ready = true;
        updateProgress(100, "Model ready");
        updateControls();
        status.textContent = "Qwen3.5-0.8B · " + (mode === "file" ? "Local file ready" : "Ready");
        const shouldSend = queuedSend;
        queuedSend = false;
        modelDialog.close();
        if (shouldSend) submitPrompt();
      }
      if (data.type === "token" && activeReply) {
        const reply = activeReply;
        reply.content += data.text;
        if (reply.frame) return;
        reply.frame = requestAnimationFrame(() => {
          reply.frame = 0;
          if (activeReply !== reply) return;
          const nearEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
          renderAnswer(reply.article.lastElementChild, reply.content, true);
          if (nearEnd) scrollToLatest();
        });
      }
      if (data.type === "finished") finishReply(data.stopped ? "Generation stopped" : "Qwen3.5-0.8B · Ready");
      if (data.type === "generation-error") {
        finishReply("Generation stopped");
        showError(data.message);
      }
    });
    worker.postMessage({ type: "load", mode, file });
  } catch {
    failLoad("lAI couldn’t start the model on this browser.");
  }
}

function cancelLoad() {
  queuedSend = false;
  if (loading) {
    loadAttempt++;
    worker?.terminate();
    worker = undefined;
    loading = false;
    updateControls();
    status.textContent = idleStatus;
  }
  modelDialog.close();
}

get("composer").addEventListener("submit", event => { event.preventDefault(); submitPrompt(); });
prompt.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !matchMedia("(pointer: coarse)").matches) {
    event.preventDefault();
    submitPrompt();
  }
});
thinkingButton.addEventListener("click", () => {
  thinking = !thinking;
  thinkingButton.setAttribute("aria-pressed", String(thinking));
  thinkingButton.querySelector("span").textContent = thinking ? "On" : "Off";
  get("thinking-warning").hidden = !thinking;
});
get("new-chat").addEventListener("click", () => switchChat(undefined));
get("show-history").addEventListener("click", () => setHistoryOpen(!history.classList.contains("is-open")));
get("clear-history").addEventListener("click", () => {
  if (!generating) {
    clearDialog.returnValue = "";
    clearDialog.showModal();
  }
});
clearDialog.addEventListener("close", () => {
  if (clearDialog.returnValue !== "clear") return;
  conversations.chats = [];
  switchChat(undefined);
});
get("model-settings").addEventListener("click", () => { queuedSend = false; openModelDialog(); });
get("download-model").addEventListener("click", () => load("online"));
get("pick-file").addEventListener("click", () => get("model-file").click());
get("model-file").addEventListener("change", event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) load("file", file);
});
get("cancel-load").addEventListener("click", cancelLoad);
modelDialog.addEventListener("cancel", event => { event.preventDefault(); cancelLoad(); });
stop.addEventListener("click", () => {
  stop.disabled = true;
  status.textContent = "Stopping generation…";
  const reply = activeReply;
  worker.postMessage({ type: "stop" });
  setTimeout(() => {
    if (activeReply !== reply || !generating) return;
    worker.terminate();
    worker = undefined;
    ready = false;
    finishReply("Generation stopped. Send a message to load the model again.");
  }, 4000);
});

for (const button of document.querySelectorAll("[data-export]")) {
  button.addEventListener("click", () => {
    if (!activeChat?.messages.length) return;
    const type = button.dataset.export;
    const content = type === "json" ? JSON.stringify(activeChat.messages, null, 2)
      : activeChat.messages.map(message => (message.role === "user" ? "You" : "lAI") + "\n" + message.content).join("\n\n");
    const url = URL.createObjectURL(new Blob([content], { type: type === "json" ? "application/json" : "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "lAI-chat." + type;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}
drawConversation();
updateControls();
