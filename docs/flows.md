# Flows

These sequence diagrams show the message order for the three things Northstar does:
sending a batch, resolving or deferring work, and the handoff refusing to type. The
participants are the toolbar (in the content script), the extension transport layer,
the server's HTTP listener, the terminal handoff, the comment store, and the AI
assistant.

## 1. Capture a comment and send the batch

Saving a comment is local and instant. Sending is the moment data crosses to the
server and the moment your assistant is told about it.

```mermaid
sequenceDiagram
    participant U as You
    participant T as Toolbar
    participant X as Transport
    participant H as HTTP listener
    participant S as Store
    participant K as Handoff
    participant A as Assistant

    U->>T: pick element, write comment, Save
    T->>X: enqueue draft
    X->>X: write to extension storage
    Note over X: nothing sent yet
    U->>T: click Send to AI
    X->>H: POST /comments (the whole batch, one request)
    H->>S: validate, save screenshots, upsert
    H-->>X: { ids, accepted, rejected }
    X->>H: POST /handoff
    H->>K: deliver
    K->>A: channel event for Claude Code, or one typed line plus Enter for Codex and Gemini
    A->>S: list_comments("open")
    K-->>H: delivered, the agent called back
    H-->>X: { delivered, agent, via }
    X-->>T: flash "Sent to Claude"
    A->>S: get_comment(id), claims it as in_progress
    A->>A: implement at the located place
    A->>S: resolve_comment(id, note, files)
```

Save enqueues, Send flushes. A comment that is only saved never reaches the
assistant, which is the single most common reason a batch looks like it was missed.

Batches that land back to back within a few seconds are announced once, because one
line covers every comment still open.

## 2. Resolve or defer

After working through a batch the assistant writes the outcomes back through the MCP
tools.

```mermaid
sequenceDiagram
    participant A as Assistant
    participant M as MCP server
    participant S as Store
    participant T as Toolbar

    alt implemented
        A->>M: resolve_comment(id, "resolved")
        M->>S: set status
    else too heavy or too vague
        A->>M: defer_comment(id, reason, category)
        M->>S: add to deferred, set wontfix
        M->>T: notice on the next status poll
    end
```

Deferrals split into two kinds: `needs-plan` for changes that are too heavy to do
inline, and `feedback` for comments too vague to act on. Both leave a notice in the
toolbar so you know they were parked, not dropped.

## 3. The handoff declines to type

The handoff never types blind. If the terminal is showing a choice, your comments
are still saved and the toolbar tells you the agent was not woken, with the reason and the fix.

```mermaid
sequenceDiagram
    participant X as Transport
    participant H as HTTP listener
    participant K as Handoff
    participant P as Terminal

    X->>H: POST /handoff
    H->>K: deliver
    loop up to 10s
        K->>P: capture the visible pane
        alt a numbered choice or a yes/no prompt is showing
            Note over K: refuse, the agent is mid-question
        else the pane is unchanged since the last look
            Note over K: settled, safe to type
        end
    end
    K-->>H: { delivered: false, reason, fix }
    H-->>X: 200 with the reason and the fix
    Note over X: comments are stored either way
```

The check is positive: it types only once it has seen the pane hold still, rather
than typing unless it recognises trouble.
