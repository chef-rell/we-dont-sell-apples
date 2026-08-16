// Town chat (spec §16, Phase 8): a collapsible feed of what the town is
// saying, visible in every view, with a line the player can type into.
//
// The panel is a reader and a sender, nothing more. Messages are produced by
// the engine's message bus — ambient chatter, offers, requests, reactions to
// pricing, adventure stories, mourning — and the player's own line goes back
// through `engine.sendPlayerChat()`, which owns who replies and how.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import type { ChatMessage, ChatMessageType } from "../types";
import { PALETTE } from "../utils/constants";

const VISIBLE_MESSAGES = 30; // spec §16
const OPEN_KEY = "wdsa_chat_open_v1";

// Each kind of line gets its own voice in the feed.
const TYPE_COLOR: Record<ChatMessageType, string> = {
  ambient: PALETTE.textLight,
  offer: "#7fd4a8",
  request: "#8ab8e8",
  reaction: "#d9b93a",
  story: PALETTE.textLight,
  social: "#b9a8e0",
  mourning: "#c0392b",
  player: PALETTE.gold,
  system: PALETTE.textDim,
};

export function ChatPanel({ engine }: { engine: GameEngine }) {
  const [open, setOpen] = useState(readOpen);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  // Track the last message actually seen, NOT how many there were: the engine
  // caps the buffer, so once it is full the length stops growing and a count
  // of "new since I looked" would sit at zero however much the town says.
  const seenId = useRef<string | null>(engine.state.messages.at(-1)?.id ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    const id = setInterval(() => {
      const all = engine.state.messages;
      setMessages(all.slice(-VISIBLE_MESSAGES));
      if (open) {
        seenId.current = all.at(-1)?.id ?? null;
        setUnread(0);
      } else {
        // Everything after the last seen message is unread. If that message has
        // already been trimmed away, the whole buffer is new to the player.
        const seenAt = seenId.current ? all.findIndex((m) => m.id === seenId.current) : -1;
        setUnread(seenAt === -1 ? all.length : all.length - 1 - seenAt);
      }
    }, 250);
    return () => clearInterval(id);
  }, [engine, open]);

  // Follow the feed unless the player has scrolled up to read something.
  useEffect(() => {
    const el = listRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // preference just won't persist
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    engine.sendPlayerChat(text);
    setDraft("");
    pinnedToBottom.current = true;
  };

  if (!open) {
    return (
      <button style={tabStyle} onClick={toggle} title="Open town chat">
        {/* At the buffer cap the true count is unknowable — say "at least". */}
        💬 Chat{unread > 0 ? ` (${unread >= VISIBLE_MESSAGES ? `${VISIBLE_MESSAGES}+` : unread})` : ""}
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ color: PALETTE.textLight, fontSize: 13 }}>Town chat</span>
        <button style={collapseStyle} onClick={toggle} title="Collapse">
          ▾
        </button>
      </div>

      <div
        ref={listRef}
        style={listStyle}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {messages.length === 0 ?
          <div style={{ color: PALETTE.textDim, fontSize: 11 }}>The town is quiet.</div>
        : messages.map((m) => (
            <div key={m.id} style={{ fontSize: 11, lineHeight: 1.45 }}>
              {m.type !== "system" && (
                <span style={{ color: TYPE_COLOR[m.type], opacity: 0.85 }}>{m.senderName}: </span>
              )}
              <span style={{ color: TYPE_COLOR[m.type] }}>{m.content}</span>
            </div>
          ))
        }
      </div>

      <div style={inputRow}>
        <input
          value={draft}
          maxLength={200}
          placeholder="say something…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Keep typing local: the views listen for Escape and single keys.
            e.stopPropagation();
            if (e.key === "Enter") send();
          }}
          style={inputStyle}
        />
        <button style={sendStyle} onClick={send} disabled={draft.trim().length === 0}>
          Say
        </button>
      </div>
    </div>
  );
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

// ---- styles ----

const panelStyle: CSSProperties = {
  position: "absolute",
  right: 12,
  bottom: 12,
  width: 300,
  // Kept clear of the shop's shelving: the panel sits over the canvas, so any
  // shelf slot underneath it would be unclickable while the chat is open.
  maxHeight: "31%",
  background: "rgba(26,26,46,0.94)",
  border: `4px solid ${PALETTE.uiBorder}`,
  fontFamily: "monospace",
  display: "flex",
  flexDirection: "column",
  zIndex: 4,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 8px",
  borderBottom: `2px solid ${PALETTE.uiBorder}`,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 8,
  overflowY: "auto",
  flex: 1,
  minHeight: 80,
};

const inputRow: CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 8,
  borderTop: `2px solid ${PALETTE.uiBorder}`,
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#0e0e1c",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 11,
  padding: "4px 6px",
};

const sendStyle: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.gold,
  fontFamily: "monospace",
  fontSize: 11,
  padding: "4px 8px",
  cursor: "pointer",
};

const collapseStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: PALETTE.textDim,
  fontFamily: "monospace",
  fontSize: 14,
  cursor: "pointer",
};

const tabStyle: CSSProperties = {
  position: "absolute",
  right: 12,
  bottom: 12,
  background: PALETTE.uiDark,
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 13,
  padding: "6px 12px",
  cursor: "pointer",
  zIndex: 4,
};
