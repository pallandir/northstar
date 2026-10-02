# Figma
Load when: the designer wants the design system or tokens taken from Figma, or shares a Figma link, file or frame.

## Goal

Turn Figma variables and components into a valid `DESIGN.md` without guessing. Northstar ships no Figma connector. It relies on the official Figma MCP server, so the first check is whether that server is connected.

## Gate: are the Figma tools listed?

Look for these tools in your tool list: `get_variable_defs`, `get_design_context`, `search_design_system`.

| Situation | Action |
|---|---|
| None of them is listed | Stop. Show the install guide below and wait. Do not guess colours, fonts or spacing from a link or a screenshot |
| They are listed | Continue with the steps below |

## Install guide

The remote server is available on every Figma seat and plan.

| Client | Command or config |
|---|---|
| Claude Code | `claude plugin install figma@claude-plugins-official`, or `claude mcp add --transport http figma https://mcp.figma.com/mcp` and then run `/mcp` to sign in |
| Codex | `codex mcp add figma --url https://mcp.figma.com/mcp` |
| Cursor | `/add-plugin figma` |
| VS Code | Add to `mcp.json`: `{"servers":{"figma":{"url":"https://mcp.figma.com/mcp","type":"http"}}}` |

After installing, sign in when the client asks, restart the session if the tools do not appear, and say "continue".

## With the tools available

1. Ask for the Figma frame or file link if the designer did not give one.
2. Call `get_variable_defs` for it to read the colour, type, spacing and radius variables.
3. Pass that output as `source` to `design_md_normalize`, then ask only the gates that are still missing (mode, stack, libraries, contrast pairs).
4. Call `search_design_system` before building a component, to reuse what the Figma library already defines, and `get_design_context` to read a frame's structure and layout.
5. Run `design_md_validate` and fix every error before touching UI code.

## Rules

- Figma variables win over search suggestions and taste defaults, since the explicit brief ranks above them.
- Map every variable to a role token. Do not copy raw values into components.
- Components still come from the project's library first. Use the Figma frame as the visual spec, not as markup to paste.
- Record "system supplied from Figma" in `design/decisions.md` and skip proposing alternative directions.

## Pitfalls

| Pitfall | Correction |
|---|---|
| Reading values off a screenshot | Install the server and read the variables |
| Pasting generated markup from a frame | Rebuild with the library and the tokens |
| Asking for tokens Figma already holds | Read them first, ask only what is missing |
