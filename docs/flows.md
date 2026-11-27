# Flows

These sequence diagrams show the message order for the three things Northstar does:
sending a batch, resolving or deferring work, and Northstar refusing to hand over. The
participants are the toolbar (in the content script), the extension transport layer, the
native host, the daemon, the listener, the comment store, and the AI assistant.

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
    participant W as northstar listen
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
    X->>H: handoff.send (template)
    H->>D: request over the socket
    D->>W: wake the listener (template id only)
    W->>A: print one fixed line and the open comments
    D-->>X: { delivered }
    X-->>T: flash "Sent to your assistant"
    A->>S: list_comments("open")
    A-->>D: polled
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

## 3. Nobody is listening

If no assistant has run `northstar listen` in the last five minutes, the comments are
still saved and the toolbar says that nothing was handed over, with the reason and the
fix. If the assistant is busy, the line is held for its next `northstar listen`.

```mermaid
sequenceDiagram
    participant X as Transport
    participant D as Daemon
    participant T as Toolbar

    X->>D: handoff.send
    alt a listener waits
        D-->>X: { delivered: true }
    else a listener was seen but is busy
        D-->>X: { delivered: false, blocked: busy, reason, fix }
    else none seen in five minutes
        D-->>X: NOT_LISTENING with the reason and the fix
    end
    X-->>T: show the outcome
    Note over X: comments are stored either way
```

The refusal is explicit: nothing is retried and nothing is sent a second way.

## 4. Starting the listener

When no listener runs in the project the toolbar says so and offers **Copy the line**,
which you press yourself. In Claude Code the `northstar-live` mod starts the listener
for you and this flow is never needed.

```mermaid
sequenceDiagram
    participant U as You
    participant T as Toolbar
    participant D as Daemon
    participant A as Assistant

    T->>D: status.get
    D-->>T: not listening, with the reason and the fix
    U->>T: Copy the line
    T->>U: the start line on the clipboard
    U->>A: paste it into the assistant
    A->>D: northstar listen, blocks
    U->>T: Send to AI
    T->>D: handoff.send
    D-->>A: the template line and the open comments, listen returns
```
