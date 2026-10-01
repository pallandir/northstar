# Modernise
Load when: an existing UI built without a design system needs a coherent system, or a legacy stack needs current libraries.

## Goal

Derive a brief and a design system from the code that exists, then upgrade in safe increments while behaviour stays the same. Modernise is a Brief derived from code, then Direction, then System, followed by incremental Compose. Enable the research, system, resolve and detect packs as the stages require.

## Order of work

| Step | Action | Output |
|---|---|---|
| 1 | Inventory the UI | List of screens, components, colours, fonts, icon sources |
| 2 | Derive the brief | `PRODUCT.md` from routes, copy and README |
| 3 | Choose a direction | Keep, evolve or replace, logged in `design/decisions.md` |
| 4 | Build the system | `DESIGN.md` from the extracted tokens |
| 5 | Plan increments | Ordered list of small changes |
| 6 | Apply and verify | One increment at a time, scanned and screenshotted |

## 1. Inventory

Read the project, never ask what it answers. Extract:

- Distinct colours in CSS, Tailwind config and components. Cluster them into roles.
- Font families and sizes actually used.
- Spacing and radius values, and how often each appears.
- Hand rolled components that a library provides: dialogs, menus, selects, toasts, icons, tables, forms.
- Icon sources, such as inline SVG, emoji or an icon font.

Run `slop_scan` on the whole source to get a baseline list of findings by rule id.

## 2. Derive the brief

Infer audience, primary job and constraints from routes, page copy and docs. Present the inference in one short block, ask at most 3 questions with defaults to confirm, then write PRODUCT.md.

## 3. Direction

Offer three options with a recommendation: keep the current look and formalise it, evolve it, or replace it. For most products formalising and evolving beats a rewrite. Log the choice.

## 4. System

Collapse the extracted values into roles. Use `design_md_normalize` if notes or style guides exist, otherwise `design_system_propose` from the inventory. Map existing values to the nearest token and list the ones that will change. Validate with `design_md_validate`, resolve libraries for each hand rolled item, and export tokens.

## 5. Safe increments

Order by risk, lowest first, and ship each as its own change.

| Increment | Examples |
|---|---|
| Tokens | Replace raw values with variables, no visual change |
| Fonts and icons | Move to Fontsource and the chosen icon library |
| Primitives | Swap hand rolled overlays and menus for library primitives, one component at a time |
| Accessibility floor | Fix contrast, focus, semantics, target size |
| Visual refresh | Apply the new look to one screen, then the rest |
| Structure | Layout changes last |

## Preserve behaviour

| Safeguard | How |
|---|---|
| Existing tests | Run them after every increment |
| Public props and routes | Keep the component API, wrap the library inside |
| Visual baseline | Screenshot before and after each increment |
| Rollback | Small commits, one concern each |

Never mix a library swap with a visual redesign in one change, since a regression then has two possible causes.

## Pitfalls

| Pitfall | Correction |
|---|---|
| Rewrite everything at once | Increments, lowest risk first |
| Imposing a new look unasked | Offer keep, evolve, replace |
| Inventing a palette from scratch | Cluster the colours already used |
| Hiding hand rolled code from the scan | Report the baseline honestly |
| Dropping edge cases while rebuilding | Check states and keyboard behaviour match |

## Exit checks

- `PRODUCT.md`, `DESIGN.md` and a decisions entry exist.
- Baseline findings are lower than at the start, with remaining ones allow listed or scheduled.
- Behaviour unchanged by tests and screenshots.
