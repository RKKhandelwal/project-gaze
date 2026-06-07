"use client";

import {
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTimezone } from "@/lib/TimezoneContext";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; status: "running" | "done" | "error" }>;
}

const SUGGESTED = [
  "When was the busiest moment this week?",
  "Compare Saturday and Sunday occupancy.",
  "Show me the busiest segment from yesterday.",
];

function renderMarkdownish(text: string): React.ReactNode {
  // Tiny markdown: **bold**, _italic_, [text](url), `code`, line breaks.
  // Avoids pulling in a full markdown library for ~6 cases.
  const parts: React.ReactNode[] = [];
  const regex =
    /\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(text.slice(lastIndex, m.index));
    }
    if (m[1]) parts.push(<strong key={`k${key++}`}>{m[1]}</strong>);
    else if (m[2]) parts.push(<em key={`k${key++}`}>{m[2]}</em>);
    else if (m[3])
      parts.push(
        <code key={`k${key++}`} className="mono">
          {m[3]}
        </code>,
      );
    else if (m[4] && m[5])
      parts.push(
        <a
          key={`k${key++}`}
          href={m[5]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {m[4]}
        </a>,
      );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.map((p, i) =>
    typeof p === "string"
      ? p.split("\n").flatMap((line, j, arr) =>
          j < arr.length - 1
            ? [<span key={`s${i}-${j}`}>{line}</span>, <br key={`b${i}-${j}`} />]
            : [<span key={`s${i}-${j}`}>{line}</span>],
        )
      : p,
  );
}

export default function Chat() {
  const { tz } = useTimezone();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, streaming]);

  const send = async (text: string) => {
    if (!text.trim() || streaming) return;
    setInput("");
    const next: ChatMessage[] = [
      ...messages,
      { role: "user", content: text.trim() },
      { role: "assistant", content: "", toolCalls: [] },
    ];
    setMessages(next);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next
            .slice(0, -1) // drop the empty placeholder
            .map((m) => ({ role: m.role, content: m.content })),
          tz,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        throw new Error(err || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt: {
            type: string;
            content?: string;
            name?: string;
            ok?: boolean;
            message?: string;
          };
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          setMessages((curr) => {
            const updated = [...curr];
            const last = updated[updated.length - 1];
            if (!last || last.role !== "assistant") return updated;
            if (evt.type === "text" && evt.content) {
              last.content += evt.content;
            } else if (evt.type === "tool_call" && evt.name) {
              last.toolCalls = [
                ...(last.toolCalls ?? []),
                { name: evt.name, status: "running" },
              ];
            } else if (evt.type === "tool_result" && evt.name) {
              const tc = (last.toolCalls ?? []).find(
                (t) => t.name === evt.name && t.status === "running",
              );
              if (tc) tc.status = evt.ok ? "done" : "error";
            } else if (evt.type === "error" && evt.message) {
              last.content +=
                (last.content ? "\n\n" : "") + `_(error: ${evt.message})_`;
            }
            return updated;
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((curr) => {
        const updated = [...curr];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          last.content +=
            (last.content ? "\n\n" : "") + `_(request failed: ${message})_`;
        }
        return updated;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
  };

  return (
    <>
      {!open && (
        <button
          className="chat-fab"
          aria-label="Open chat"
          onClick={() => setOpen(true)}
        >
          <span className="chat-fab-icon" aria-hidden>
            ✦
          </span>
          <span className="chat-fab-label">Ask the data</span>
        </button>
      )}

      {open && (
        <div className="chat-panel" role="dialog" aria-label="Chat">
          <header className="chat-header">
            <div>
              <div className="chat-title">Ask the data</div>
              <div className="chat-sub muted">
                Gemini 2.5 Flash · times in {tz}
              </div>
            </div>
            <div className="chat-actions">
              {messages.length > 0 && (
                <button
                  className="chat-iconbtn"
                  onClick={reset}
                  aria-label="Clear conversation"
                  title="Clear"
                >
                  ⟲
                </button>
              )}
              <button
                className="chat-iconbtn"
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>
                  Ask anything about court occupancy — busiest times, specific
                  segments, day-over-day comparisons. I can hand you a video
                  link to watch any moment.
                </p>
                <div className="chat-suggests">
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      className="chat-suggest"
                      onClick={() => send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`chat-msg chat-${m.role}`}
              >
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="chat-tools">
                    {m.toolCalls.map((t, j) => (
                      <span key={j} className={`chat-tool ${t.status}`}>
                        <span className="chat-tool-dot" />
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="chat-bubble">
                  {m.content
                    ? renderMarkdownish(m.content)
                    : streaming && i === messages.length - 1 && (
                        <span className="chat-typing">
                          <span />
                          <span />
                          <span />
                        </span>
                      )}
                </div>
              </div>
            ))}
          </div>

          <div className="chat-input-wrap">
            <textarea
              className="chat-input"
              placeholder="Ask about the data…"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={streaming}
            />
            <button
              className="chat-send"
              onClick={() => send(input)}
              disabled={streaming || !input.trim()}
              aria-label="Send"
            >
              ↑
            </button>
          </div>
        </div>
      )}
    </>
  );
}
