import { useState, useRef, useEffect } from 'react';
import { ToolCallsBadge } from './ToolCallsBadge';
import type { ThreadMessage } from '../api/client';

const SUGGESTED_MESSAGES = [
  'Find me a quiet, nicely renovated apartment with natural light near James Ruse Public School.',
  'What would be a price guide for a two bedroom apartment in Carlingford',
  'What have I ask you so far?',
] as const;

interface ChatPanelProps {
  messages: ThreadMessage[];
  onSend: (message: string) => void;
  loading?: boolean;
  hasInitialResults?: boolean;
}

export function ChatPanel({ messages, onSend, loading, hasInitialResults }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput('');
  };

  return (
    <div className="chat-panel">
      <div className="chat-suggested">
        <label htmlFor="chat-suggested-select">Suggested questions</label>
        <select
          id="chat-suggested-select"
          className="chat-suggested-select"
          value=""
          onChange={(e) => {
            const value = e.target.value;
            if (value && !loading) {
              onSend(value);
              e.target.value = '';
            }
          }}
          disabled={loading}
          aria-label="Choose a suggested question"
        >
          <option value="">Choose a question…</option>
          {SUGGESTED_MESSAGES.map((msg, i) => (
            <option key={i} value={msg}>
              {msg}
            </option>
          ))}
        </select>
        <div className="chat-suggested-pills">
          {SUGGESTED_MESSAGES.map((msg, i) => (
            <button
              key={i}
              type="button"
              className="chat-suggested-pill"
              onClick={() => {
                if (!loading && msg) onSend(msg);
              }}
              disabled={loading}
            >
              {msg}
            </button>
          ))}
        </div>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-placeholder">
            {hasInitialResults
              ? 'Here are some properties matching your saved preferences. Ask for more details or “What price should I offer?”'
              : 'Ask for properties near a school or station, or “What price should I offer?”'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.type}`}>
            <div className="chat-msg-role">{m.type === 'human' ? 'You' : 'Assistant'}</div>
            <div className="chat-msg-content">{m.content}</div>
            {m.toolCalls?.length ? (
              <ToolCallsBadge tools={m.toolCalls} />
            ) : null}
          </div>
        ))}
        {loading && <div className="chat-msg ai">Thinking…</div>}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSubmit} className="chat-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
