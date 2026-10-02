# Flows

These sequence diagrams show the message order for the three things Northstar does:
sending a batch, resolving or deferring work, and the session declining to write. The
participants are the toolbar (in the content script), the extension transport layer, the
native host, the daemon, the session wrapper, the comment store, and the AI assistant.

## 1. Capture a comment and send the batch

Saving a comment is local and instant. Sending is the moment data crosses to the
project and the moment your assistant is told about it.

```mermaid
sequenceDiagram
    participant U as You
    participant T as Toolbar
    participant X as Transport
    participant H as Native host
    participant D as Daemon
    participant S as Store
    participant W as Session
    participant A as Assistant

    U->>T: pick element, write comment, Save
    T->>X: enqueue draft
    X->>X: write to extension storage
    Note over X: nothing sent yet
    U->>T: click Send to AI
    X->>H: comments.add (the whole batch, one message)
    H->>D: request over the socket
    D->>S: validate, save screenshots, upsert
    D-->>X: { ids, accepted, rejected }
    X->>H: session.send (template)
    H->>D: route to the session for this project
    D->>W: deliver (template id only)
    W->>W: wait for quiet, check for prompts and typed input
    W->>A: write one fixed line, then Enter
    A->>S: list_comments("open")
    A-->>D: polled
    D-->>X: { delivered, session }
    X-->>T: flash "Sent to Claude Code"
    A->>S: get_comment(id), claims it as in_progress
    A->>A: implement at the located place
    A->>S: resolve_comment(id, note, files)
```

Save enqueues, Send flushes. A comment that is only saved never reaches the
assistant, which is the single most common reason a batch looks like it was missed.

Delivery is automatic. You are only asked to act when Northstar must not go on, see
the next flow. Sending a selection from the context menu or the shortcut follows the
same path, with the selection stored as one comment first.

## 2. Resolve or defer

After working through a batch the assistant writes the outcomes back through the MCP
tools.

```mermaid
sequenceDiagram
    participant A as Assistant
    participant M as MCP server
    participant S as Store
    participant D as Daemon
    participant T as Toolbar

    alt implemented
        A->>M: resolve_comment(id, "resolved")
        M->>S: set status
        M->>D: bump
    else too heavy or too vague
        A->>M: defer_comment(id, reason, category)
        M->>S: add to deferred, set wontfix
        M->>D: notice
        D->>T: notice on the next status poll
    end
```

Deferrals split into two kinds: `needs-plan` for changes that are too heavy to do
inline, and `feedback` for comments too vague to act on. Both leave a notice in the
toolbar so you know they were parked, not dropped, and a plan is yours to make.

## 3. The session declines to write

The session never writes blind. If the assistant is showing a choice, has text in its
input, or never goes quiet, your comments are still saved and the toolbar tells you the
agent was not written to, with the reason and the fix.

```mermaid
sequenceDiagram
    participant X as Transport
    participant D as Daemon
    participant W as Session
    participant P as Screen copy

    X->>D: session.send
    D->>W: deliver
    loop up to 10s
        W->>P: read the rendered screen
        alt a numbered choice or a yes/no prompt is showing
            Note over W: blocked, the agent is mid-question
        else output moving or you are typing
            Note over W: wait
        else text sits in the input
            Note over W: blocked, never write over it
        else quiet and clear
            Note over W: safe to write
        end
    end
    W-->>D: { delivered: false, blocked, reason, fix }
    D-->>X: the outcome with the reason and the fix
    Note over X: comments are stored either way
```

The check is positive: it writes only once it has seen the screen hold still and clear,
rather than writing unless it recognises trouble.

## 4. No session is running

When no session runs in the project the toolbar says so, and offers two explicit
choices instead of doing either on its own.

```mermaid
sequenceDiagram
    participant U as You
    participant T as Toolbar
    participant D as Daemon

    T->>D: status.get
    D-->>T: no session, connected but not writable
    U->>T: Copy the line
    T->>U: the fixed line on the clipboard
```
