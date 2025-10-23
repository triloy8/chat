export {};

type ChatRole = "system" | "user" | "assistant";

interface Message {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status?: "pending" | "error";
  error?: string;
}

interface StoredTranscript {
  conversationId: string;
  messages: Message[];
  savedAt: string;
}

interface ChatConfig {
  apiBaseUrl: string;
  apiPath: string;
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
}

interface ChatState {
  conversationId: string;
  messages: Message[];
  isSending: boolean;
  abortController?: AbortController;
}

type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

declare global {
  interface Window {
    CHAT_CONFIG?: Partial<ChatConfig>;
  }
}

const STORAGE_KEY = "minimal-chat:transcript";

const DEFAULT_CONFIG: ChatConfig = {
  apiBaseUrl: "http://localhost:11434",
  apiPath: "/v1/chat/completions",
  model: "gemma3:4b",
};

const config: ChatConfig = {
  ...DEFAULT_CONFIG,
  ...(window.CHAT_CONFIG ?? {}),
};

const state: ChatState = {
  conversationId: createConversationId(),
  messages: [],
  isSending: false,
};

const TEXTAREA_MIN_HEIGHT = 96;
const TEXTAREA_MAX_HEIGHT = 192;

const elements = {
  messageList: document.querySelector<HTMLElement>("#message-list"),
  composerForm: document.querySelector<HTMLFormElement>("#composer-form"),
  textarea: document.querySelector<HTMLTextAreaElement>("#composer-textarea"),
  sendButton: document.querySelector<HTMLButtonElement>("#send-btn"),
  statusPill: document.querySelector<HTMLSpanElement>("#status-pill"),
  statusText: document.querySelector<HTMLSpanElement>("#status-text"),
  cancelButton: document.querySelector<HTMLButtonElement>("#cancel-request-btn"),
  newChatButton: document.querySelector<HTMLButtonElement>("#new-chat-btn"),
  exportButton: document.querySelector<HTMLButtonElement>("#export-chat-btn"),
  confirmDialog: document.querySelector<HTMLDialogElement>("#confirm-dialog"),
  confirmOkButton: document.querySelector<HTMLButtonElement>("#confirm-ok-btn"),
  confirmCancelButton: document.querySelector<HTMLButtonElement>("#confirm-cancel-btn"),
  confirmTitle: document.querySelector<HTMLElement>("#confirm-title"),
  confirmDescription: document.querySelector<HTMLElement>("#confirm-description"),
};

type ElementRefs = typeof elements;
type ResolvedElements = {
  [K in keyof ElementRefs]-?: NonNullable<ElementRefs[K]>;
};

function resolveElements(source: ElementRefs): ResolvedElements {
  if (!source.messageList) throw new Error("Missing DOM element: messageList");
  if (!source.composerForm) throw new Error("Missing DOM element: composerForm");
  if (!source.textarea) throw new Error("Missing DOM element: textarea");
  if (!source.sendButton) throw new Error("Missing DOM element: sendButton");
  if (!source.statusPill) throw new Error("Missing DOM element: statusPill");
  if (!source.statusText) throw new Error("Missing DOM element: statusText");
  if (!source.cancelButton) throw new Error("Missing DOM element: cancelButton");
  if (!source.newChatButton) throw new Error("Missing DOM element: newChatButton");
  if (!source.exportButton) throw new Error("Missing DOM element: exportButton");
  if (!source.confirmDialog) throw new Error("Missing DOM element: confirmDialog");
  if (!source.confirmOkButton) throw new Error("Missing DOM element: confirmOkButton");
  if (!source.confirmCancelButton) throw new Error("Missing DOM element: confirmCancelButton");
  if (!source.confirmTitle) throw new Error("Missing DOM element: confirmTitle");
  if (!source.confirmDescription) throw new Error("Missing DOM element: confirmDescription");
  return source as ResolvedElements;
}

const ui = resolveElements(elements);

function createConversationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMessage(role: ChatRole, content: string): Message {
  return {
    id: createConversationId(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function setComposerDisabled(disabled: boolean) {
  ui.textarea.disabled = disabled;
  ui.sendButton.hidden = disabled;
  ui.cancelButton.hidden = !disabled;
  ui.cancelButton.disabled = !disabled;
}

type StatusVariant = "default" | "pending" | "error";

function setStatus(text: string, variant: StatusVariant = "default") {
  ui.statusText.textContent = text;
  ui.statusPill.dataset.state = variant;
  ui.statusPill.setAttribute("title", text);
  ui.statusPill.setAttribute("aria-label", text);
}

function adjustTextareaHeight() {
  const textarea = ui.textarea;
  textarea.style.height = "auto";
  const next = Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT);
  textarea.style.height = `${Math.max(next, TEXTAREA_MIN_HEIGHT)}px`;
  textarea.style.overflowY = next >= TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
}

function resetTextareaHeight() {
  ui.textarea.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
  ui.textarea.style.overflowY = "hidden";
}

function updateActionStates() {
  ui.exportButton.disabled = state.messages.length === 0;
}

function renderMessages() {
  ui.messageList.innerHTML = "";

  if (state.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h2>Start chatting</h2>
      <p>Ask a question or describe a task to begin a new conversation.</p>
    `;
    ui.messageList.appendChild(empty);
    updateActionStates();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const message of state.messages) {
    const article = document.createElement("article");
    article.className = "message";
    article.dataset.role = message.role;
    article.dataset.id = message.id;
    if (message.status) {
      article.dataset.status = message.status;
    }

    if (message.status === "pending") {
      article.setAttribute("aria-busy", "true");
    }

    const roleLabel = document.createElement("header");
    roleLabel.className = "message-role";
    roleLabel.textContent = roleTitle(message.role);

    const content = document.createElement("p");
    content.className = "message-body";

    if (message.status === "pending") {
      content.textContent = "Thinking…";
    } else if (message.status === "error") {
      content.textContent = message.error ?? "Something went wrong.";
    } else {
      content.textContent = message.content;
    }

    article.append(roleLabel, content);

    if (message.status) {
      const meta = document.createElement("footer");
      meta.className = "message-meta";
      const badge = document.createElement("span");
      badge.className = `message-badge ${message.status}`;
      badge.textContent = message.status === "pending" ? "Pending" : "Error";
      meta.appendChild(badge);
      article.append(meta);
    }

    fragment.appendChild(article);
  }

  ui.messageList.appendChild(fragment);
  ui.messageList.scrollTop = ui.messageList.scrollHeight;
  updateActionStates();
}

function roleTitle(role: ChatRole): string {
  switch (role) {
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return "You";
  }
}

function addMessage(message: Message) {
  state.messages.push(message);
  persistTranscript();
  renderMessages();
}

function upsertMessage(message: Message) {
  const index = state.messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    state.messages.push(message);
  } else {
    state.messages[index] = message;
  }
  persistTranscript();
  renderMessages();
}

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  if (state.isSending) return;

  const text = ui.textarea.value.trim();
  if (!text) return;

  const userMessage = createMessage("user", text);
  ui.textarea.value = "";
  resetTextareaHeight();
  addMessage(userMessage);

  const assistantPlaceholder: Message = {
    id: createConversationId(),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    status: "pending",
  };

  addMessage(assistantPlaceholder);
  await sendToModel(assistantPlaceholder);
}

async function sendToModel(placeholder: Message): Promise<void> {
  const messagesForRequest = state.messages.filter((message) => message.id !== placeholder.id);

  setComposerDisabled(true);
  setStatus("Thinking…", "pending");
  state.isSending = true;

  const controller = new AbortController();
  state.abortController = controller;

  ui.cancelButton.addEventListener(
    "click",
    () => controller.abort(),
    { once: true },
  );

  try {
    const reply = await sendChatCompletion(messagesForRequest, controller.signal);
    const assistantMessage: Message = {
      ...placeholder,
      content: reply,
      status: undefined,
    };
    upsertMessage(assistantMessage);
    setStatus("Ready");
  } catch (error) {
    const placeholderExists = state.messages.some((item) => item.id === placeholder.id);
    if (!placeholderExists) {
      setStatus("Ready");
      return;
    }

    if (controller.signal.aborted) {
      const cancelledMessage: Message = {
        ...placeholder,
        content: "",
        status: "error",
        error: "Request cancelled.",
      };
      upsertMessage(cancelledMessage);
      setStatus("Cancelled", "error");
    } else {
      console.error(error);
      const failedMessage: Message = {
        ...placeholder,
        content: "",
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error.",
      };
      upsertMessage(failedMessage);
      setStatus("Error", "error");
    }
  } finally {
    state.isSending = false;
    state.abortController = undefined;
    setComposerDisabled(false);
    ui.textarea.focus();
  }
}

type CompletionMessage = { role: ChatRole; content: string };

interface ChatCompletionChoice {
  index: number;
  message: CompletionMessage;
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: ChatCompletionChoice[];
}

async function sendChatCompletion(
  messages: Message[],
  signal: AbortSignal,
): Promise<string> {
  const requestBody = {
    model: config.model,
    messages: messages.map(({ role, content }) => ({ role, content })),
    conversation_id: state.conversationId,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(`${config.apiBaseUrl}${config.apiPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail ?? `Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No assistant content returned.");
  }
  return content.trim();
}

async function safeReadError(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    if (data?.error?.message) return data.error.message;
    if (typeof data === "string") return data;
    return JSON.stringify(data);
  } catch {
    return response.statusText || null;
  }
}

function persistTranscript() {
  if (state.messages.length === 0) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  const payload: StoredTranscript = {
    conversationId: state.conversationId,
    messages: state.messages,
    savedAt: new Date().toISOString(),
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadTranscript(): StoredTranscript | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTranscript;
  } catch (error) {
    console.warn("Failed to parse transcript from storage", error);
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

async function offerTranscriptRestore() {
  const stored = loadTranscript();
  if (!stored || stored.messages.length === 0) return;

  const shouldRestore = await confirmAction({
    title: "Restore previous chat?",
    description: "A previous conversation was found. Would you like to load it?",
    confirmLabel: "Restore",
  });

  if (shouldRestore) {
    state.conversationId = stored.conversationId ?? createConversationId();
    state.messages = stored.messages;
    renderMessages();
    setStatus("Transcript restored");
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

async function handleNewChatClick() {
  if (state.isSending) {
    state.abortController?.abort();
  }

  if (state.messages.length === 0) {
    resetChat();
    return;
  }

  const shouldReset = await confirmAction({
    title: "Start a new chat?",
    description: "This will clear the current conversation.",
    confirmLabel: "Start new chat",
  });

  if (shouldReset) {
    resetChat();
  }
}

async function handleExportClick() {
  if (state.messages.length === 0) {
    setStatus("Nothing to export", "error");
    return;
  }

  const payload = {
    conversationId: state.conversationId,
    exportedAt: new Date().toISOString(),
    messages: state.messages,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `chat-${state.conversationId}.json`;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  setStatus("Transcript exported");
}

function resetChat() {
  state.abortController?.abort();
  state.abortController = undefined;
  state.messages = [];
  state.conversationId = createConversationId();
  sessionStorage.removeItem(STORAGE_KEY);
  renderMessages();
  setStatus("Ready");
  resetTextareaHeight();
}

function attachEventListeners() {
  ui.composerForm.addEventListener("submit", handleSubmit);

  ui.newChatButton.addEventListener("click", () => {
    void handleNewChatClick();
  });

  ui.exportButton.addEventListener("click", () => {
    void handleExportClick();
  });

  ui.textarea.addEventListener("input", () => {
    adjustTextareaHeight();
  });

  ui.textarea.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;

    if (event.shiftKey) {
      return;
    }

    event.preventDefault();
    ui.composerForm.requestSubmit();
  });
}

function setup() {
  renderMessages();
  attachEventListeners();
  void offerTranscriptRestore();
  resetTextareaHeight();
  ui.textarea.focus();
}

function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const { title, description, confirmLabel = "Confirm", cancelLabel = "Cancel" } = options;
  const dialog = ui.confirmDialog;
  const ok = ui.confirmOkButton;
  const cancel = ui.confirmCancelButton;

  ui.confirmTitle.textContent = title;
  ui.confirmDescription.textContent = description;
  ok.textContent = confirmLabel;
  cancel.textContent = cancelLabel;

  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onClose = () => cleanup(false);

    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);

    dialog.showModal();
  });
}

setup();
