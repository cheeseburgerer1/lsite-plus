import katex from "./runtime/katex.mjs";
import { Marked } from "./runtime/marked.mjs";

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
const idleStatus = "Select your saved model to start chatting.";
const newChatTitle = "New Chat";
const inlineMarkup = new RegExp([
  /\u0060(?<code>[^\u0060\n]+)\u0060/,
  /\$\$(?<displayDollar>[\s\S]+?)\$\$/,
  /\\\[(?<displayBracket>[\s\S]+?)\\\]/,
  /\\\((?<inlineParenthesis>[\s\S]+?)\\\)/,
  /\$(?![\s$])(?<inlineDollar>(?:\\.|[^\\$\r\n])*?(?:\\.|[^\s\\$]))\$(?![$\d])/,
  /(?<bold>\*\*)/,
  /\\(?<escaped>[\\\u0060*$])/
].map(pattern => pattern.source).join("|"), "g");
const displayMath = /^(?: {0,3}\$\$([\s\S]+?)\$\$| {0,3}\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/m;
const markdown = new Marked({
  gfm: false,
  extensions: [{
    name: "displayMath",
    level: "block",
    start(source) { return source.search(displayMath); },
    tokenizer(source) {
      const match = displayMath.exec(source);
      if (match?.index === 0) return { type: "displayMath", raw: match[0], text: match[1] ?? match[2] };
    }
  }]
});

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
let loadAttempt = 0;
let activeReply;

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
  message = message.replace(/qwen[\w.-]*/gi, "the LAI model");
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
    button.textContent = chat.title || chat.messages.find(message => message.role === "user")?.content.trim().replace(/\s+/g, " ").slice(0, 65) || newChatTitle;
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

function textBlock(text, tag = "p") {
  const paragraph = document.createElement(tag);
  paragraph.className = "message-text";

  let offset = 0;
  let bold;
  for (const match of text.matchAll(inlineMarkup)) {
    const parent = bold || paragraph;
    parent.append(text.slice(offset, match.index));
    offset = match.index + match[0].length;
    const { code: codeText, displayDollar, displayBracket, inlineParenthesis, inlineDollar, bold: marker, escaped } = match.groups;

    if (marker && bold && /\S/.test(text[match.index - 1] || "")) {
      paragraph.append(bold);
      bold = undefined;
    } else if (marker && !bold && /\S/.test(text[offset] || "")) {
      bold = document.createElement("strong");
    } else if (codeText !== undefined) {
      const code = document.createElement("code");
      code.textContent = codeText;
      parent.append(code);
    } else if (escaped !== undefined) {
      parent.append(escaped);
    } else {
      const formula = displayDollar ?? displayBracket ?? inlineParenthesis ?? inlineDollar;
      if (formula === undefined) parent.append(match[0]);
      else parent.append(mathSpan(formula, displayDollar !== undefined || displayBracket !== undefined, match[0]));
    }
  }
  (bold || paragraph).append(text.slice(offset));
  if (bold) paragraph.append("**", ...bold.childNodes);
  return paragraph;
}

function mathSpan(formula, displayMode, original) {
  const span = document.createElement("span");
  span.className = displayMode ? "message-equation" : "message-math";
  try {
    katex.render(formula.trim(), span, { displayMode, output: "mathml", trust: false, maxExpand: 150, maxSize: 20 });
    return span;
  } catch {
    return original;
  }
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

function renderBlocks(tokens) {
  const fragment = document.createDocumentFragment();
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "heading":
        fragment.append(textBlock(token.text, "h" + token.depth));
        break;
      case "list": {
        const list = document.createElement(token.ordered ? "ol" : "ul");
        if (token.ordered) list.start = token.start;
        for (const entry of token.items) {
          const item = document.createElement("li");
          item.append(renderBlocks(entry.tokens));
          list.append(item);
        }
        fragment.append(list);
        break;
      }
      case "blockquote": {
        const quote = document.createElement("blockquote");
        quote.append(renderBlocks(token.tokens));
        fragment.append(quote);
        break;
      }
      case "hr":
        fragment.append(document.createElement("hr"));
        break;
      case "code":
        fragment.append(codeBlock(token.lang?.trim().split(/\s+/, 1)[0], token.text));
        break;
      case "displayMath":
        fragment.append(mathSpan(token.text, true, token.raw.trim()));
        break;
      case "paragraph":
      case "text":
        fragment.append(textBlock(token.text));
        break;
      default:
        fragment.append(textBlock(token.raw.trimEnd()));
    }
  }
  return fragment;
}

function renderAnswer(bubble, content, inProgress = false) {
  const { answer, thought } = splitThought(content, inProgress);
  let accordion = bubble.querySelector(".thought");
  if (thought && !accordion) {
    accordion = document.createElement("details");
    accordion.className = "thought";
    const summary = document.createElement("summary");
    summary.textContent = "Thought Process";
    const details = document.createElement("div");
    details.className = "message-content thought-content";
    accordion.append(summary, details);
    bubble.prepend(accordion);
  }
  if (thought) accordion.lastElementChild.replaceChildren(renderBlocks(markdown.lexer(thought)));
  else accordion?.remove();
  const body = bubble.lastElementChild;
  const text = answer || (inProgress ? (thought ? "Thinking…" : "Generating…") : "");
  body.replaceChildren(renderBlocks(markdown.lexer(text)));
}

function messageElement(message, inProgress = false) {
  const article = document.createElement("article");
  article.className = "message message-" + message.role;
  const label = document.createElement("strong");
  label.className = "message-label";
  label.textContent = message.role === "user" ? "You" : "LAI";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  if (message.role === "user") bubble.textContent = message.content;
  else {
    const content = document.createElement("div");
    content.className = "message-content";
    bubble.append(content);
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
  get("download-model").hidden = loading;
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
    return;
  }
  clearError();
  if (!activeChat) {
    activeChat = { id: crypto.randomUUID(), title: newChatTitle, messages: [] };
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

function openModelDialog() {
  get("model-title").textContent = ready ? "Change model file" : "Select your saved model";
  get("model-progress").hidden = !loading;
  if (!modelDialog.open) modelDialog.showModal();
}

function failLoad(message) {
  worker?.terminate();
  worker = undefined;
  loading = false;
  ready = false;
  updateControls();
  showError(message);
  get("model-progress").hidden = true;
  status.textContent = "Model unavailable";
}

async function load(file) {
  if (loading || generating) return;
  const attempt = ++loadAttempt;
  worker?.terminate();
  clearError();
  loading = true;
  ready = false;
  updateControls();
  get("model-progress").hidden = false;
  get("progress-label").textContent = "Opening saved model…";
  status.textContent = "Loading the saved model…";
  if (navigator.serviceWorker) {
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
      failLoad("LAI couldn’t start or the model stopped unexpectedly.");
    });
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "progress") get("progress-label").textContent = data.label;
      if (data.type === "failed") failLoad(data.message);
      if (data.type === "ready") {
        loading = false;
        ready = true;
        updateControls();
        status.textContent = "Local model ready";
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
      if (data.type === "finished") finishReply(data.stopped ? "Generation stopped" : "Local model ready");
      if (data.type === "generation-error") {
        finishReply("Generation stopped");
        showError(data.message);
      }
    });
    worker.postMessage({ type: "load", file });
  } catch {
    failLoad("LAI couldn’t start the model on this browser.");
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
get("pick-file").addEventListener("click", () => get("model-file").click());
get("model-file").addEventListener("change", event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) load(file);
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
      : activeChat.messages.map(message => (message.role === "user" ? "You" : "LAI") + "\n" + message.content).join("\n\n");
    const url = URL.createObjectURL(new Blob([content], { type: type === "json" ? "application/json" : "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "LAI-chat." + type;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}
drawConversation();
updateControls();
