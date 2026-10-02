# Brief
Load when: starting new UI work, or when PRODUCT.md is missing or no longer matches the request.

## Goal

Produce `PRODUCT.md`, a short statement of who the UI is for and what it must achieve. Every later decision is judged against it. No tools beyond `northstar_context` are needed in this stage.

## The six gates

| Gate | Question it answers | Typical source |
|---|---|---|
| Audience | Who uses this, in what situation | Request, repo copy, existing analytics notes |
| Primary job | The one thing the user comes to do | Request, route names, README |
| Success metric | How we know it worked | Request, product docs |
| Constraints | Stack, deadlines, accessibility level, browsers, legal | `package.json`, `components.json`, CI config |
| Brand | Existing identity, voice, assets, things to avoid | DESIGN.md, logo files, existing CSS |
| Content availability | Real copy, images, data, or none yet | Repo, CMS, fixtures |

A gate is closed when the repo or the user has answered it. Only open gates become questions.

## Derive from the repo first

Never ask what the repo can answer. Check in this order:

1. DESIGN.md and any existing `PRODUCT.md`.
2. `package.json` and `components.json` for stack, component library, icon library and fonts.
3. README, route and page names, and copy in existing components for audience and job.
4. Tailwind config, CSS variables and theme files for brand colour and type.
5. `design/decisions.md` for choices already made.

State what you inferred in one line each, so the user can correct it.

## Design read

Before any code, state one line that names the page kind, the audience, the vibe words the user used and the design family you will lean on. Example: "Reading this as a B2B landing page for technical buyers, minimalist, restrained motion, shadcn on Tailwind." The user can correct it in one reply. Ask a clarifying question only when two readings would lead to clearly different designs, and then ask exactly one.

## Question protocol

At most 3 questions per turn, each with a recommended default. Pick the three open gates that most change the design. A reply of "go" accepts every default.

| Gate | Question template |
|---|---|
| Audience | Who is the main user? Default: {inferred audience from the repo}. |
| Primary job | What must a visitor do in the first minute? Default: {the main route's action}. |
| Success | What counts as success? Default: {one measurable outcome, such as sign ups or tasks completed}. |
| Constraints | Any hard limits on stack, browsers or accessibility? Default: current stack, WCAG AA, evergreen browsers. |
| Brand | Is there a brand to follow? Default: none, derive from the subject in Direction. |
| Content | Is real content available? Default: draft realistic copy and mark it for review. |

Small edits skip these questions, not the DESIGN.md gate. If the request is a single comment or a one line change, proceed without asking, once DESIGN.md is valid.

## Output: PRODUCT.md

Fill `templates/PRODUCT.template.md`. Keep it under one page.

| Section | Rule |
|---|---|
| Audience | Name a real group and their situation, never "everyone" |
| Primary job | One sentence, a verb and an object |
| Success metrics | One to three, measurable |
| Use scene | Where, on what device, in what mood |
| Constraints | Hard limits only |
| Voice | Three adjectives with a do and a don't |
| Content inventory | What exists, what is missing, what is placeholder |

## Hand off

When PRODUCT.md is written, record any answer that changed direction in `design/decisions.md` with stage `brief`, then move to Direction. If the user already supplied a direction file, run `design_md_normalize` in the System stage and skip choosing in Direction, but still confirm the mode.

## Pitfalls

| Pitfall | Correction |
|---|---|
| Asking all six gates at once | Ask the three that matter most, infer the rest |
| Audience of "users" | Name the group and what they were doing a moment before |
| Success phrased as a feeling | Replace with an observable outcome |
| Inventing brand facts | Mark as assumed and ask in the next turn |
| Writing PRODUCT.md as marketing copy | State facts and constraints, not slogans |
| Starting design before the primary job is clear | Stop, close that gate first |

## Checks before leaving

- The primary job fits in one sentence.
- Every gate is closed by the repo, the user or an accepted default.
- Assumptions are labelled as assumptions.
- Nothing in the file restates a rule id, since rules live in the canon.
