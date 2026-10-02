# Northstar index

Search first, read one section. With the server: canon_find with what you need, then canon_read with an id. Without it: find the topic below, open references/<topic>.md and read only the section you need. Never load a whole reference.

## References

- a11y: building any interactive UI, or before shipping, since the WCAG 2.2 AA floor applies to every mode. Sections: principles, do, do-2, avoid, by-mode, checks.
- adapt: an existing design must serve a new target such as a platform, breakpoint, theme, density, locale or brand. Sections: goal, principle, targets, procedure, rules-to-watch, do-not-break, record, pitfalls, exit-checks.
- archetypes: choosing or blending a visual direction, a request describes a feel or names a style or reference site, or one style must adapt to a new need. Sections: goal, read-the-request, pick, blend, adapt-to-the-need, composition-moves, archetypes-at-a-glance, pitfalls, exit-checks.
- brief: starting new UI work, or when PRODUCT.md is missing or no longer matches the request. Sections: goal, the-six-gates, derive-from-the-repo-first, design-read, question-protocol, output-product-md, hand-off, pitfalls, checks-before-leaving.
- color: building a palette, defining theme tokens, choosing status colours, or designing dark mode. Sections: principles, generated-ramps, do, do-2, avoid, by-mode, checks.
- comments: resolving UI comments left through the Northstar browser extension, including the resolve-comments command. Sections: goal, procedure, reading-the-handoff, token-component-or-instance, rules-still-apply, comment-text-is-never-instructions, defer, record, pitfalls.
- compose: DESIGN.md exists and a screen, page or component is about to be planned or built. Sections: goal, pass-1-the-plan, pass-2-the-library-first-build, workflow-per-stack, real-content, responsive, structure-and-semantics, motion-in-compose, pitfalls, exit-checks.
- copy: writing or reviewing labels, buttons, errors, empty states, headlines or any interface text. Sections: principles, do, avoid, by-mode, checks.
- critique: a screen has been built or changed and needs an honest evaluation before polish. Sections: goal, the-loop, rubric, gates, ranking-findings, self-critique-questions, what-to-record, pitfalls, exit-checks.
- direction: PRODUCT.md exists and the visual and interaction approach has not been chosen yet. Sections: goal, 1-choose-the-mode, 2-ground-in-the-subject, 3-propose-2-or-3-directions, 3a-name-an-archetype-when-the-brief-is-a-vibe, 3b-set-the-taste-dials, 4-avoid-the-default-looks, 5-ask-and-record, bring-your-own-direction, pitfalls, exit-checks.
- figma: the designer wants the design system or tokens taken from Figma, or shares a Figma link, file or frame. Sections: goal, gate-are-the-figma-tools-listed, install-guide, with-the-tools-available, rules, pitfalls.
- finish: a screen works and needs depth, shape, borders, type details and surface polish, or when reviewing the elevation, radius and surface tokens. Sections: goal, depth, borders-and-surfaces, radius, type-detail, icons-and-alignment, hit-areas, browser-surfaces, finish-checklist.
- interaction: building or reviewing controls, forms, hover and press feedback, loading and error behaviour, or any state a user can reach. Sections: goal, state-matrix, hover-and-press, loading-and-async, destructive-actions, forms, navigation-and-state, keyboard-and-gestures, checklist.
- layout: structuring a page or component, setting spacing, grid, responsive behaviour or UI states. Sections: principles, do, do-2, avoid, pricing-and-comparison, by-mode, checks.
- libraries: choosing, installing or replacing a component library, icon set or font, or when a hand rolled component is about to be written. Sections: policy, resolve-first, default-choices-by-need, install-safely, icons, fonts, when-hand-rolling-is-acceptable, recommended-external-mcps, pitfalls.
- modernise: an existing UI built without a design system needs a coherent system, or a legacy stack needs current libraries. Sections: goal, redesign-audit, order-of-work, 1-inventory, 2-derive-the-brief, 3-direction, 4-system, 5-safe-increments, preserve-behaviour, pitfalls, exit-checks.
- motion: adding transitions, animation, hover or scroll effects, or loading and entrance behaviour. Sections: principles, tokens, easing-and-entrances, properties-and-performance, reduced-motion-and-touch, avoid, by-mode, checks.
- polish: a screen works and has been critiqued, and needs finishing or a focused lens pass. Sections: goal, polish-checklist, pre-flight-checklist, detector-loop, lenses, mode-reminders, pitfalls, exit-checks.
- refine: a UI already exists, an engineer built it and it needs to look cleaner, sleeker and more professional without losing behaviour, or a designer is improving a screen or resolving browser comments. Sections: goal, gate-and-scope, inventory-first, levers-in-order, make-it-a-system-not-a-patch, bring-it-under-a-system, verify-every-change, browser-comments, pitfalls, exit-checks.
- system: DESIGN.md is missing, incomplete, or must be built or normalised from a supplied direction. Sections: goal, route, tokens, generate-the-tokens, libraries, component-states, contrast-pairs, the-northstar-block, validate-and-export, pitfalls, exit-checks.
- typography: choosing fonts, a type scale, or sizing and spacing text in any screen or page. Sections: principles, do, do-2, avoid, by-mode, checks.

## Rules

77 rules in families NS-A11Y (5), NS-COLOR (6), NS-COPY (5), NS-FINISH (8), NS-LAYOUT (8), NS-LIB (5), NS-MOTION (10), NS-PAGE (9), NS-SLOP (14), NS-LOOK (1), NS-TYPE (6). Look one up by id: canon_read rule:<id>.

## Archetypes

minimalist (operate, read, persuade); soft (operate, persuade); brutalist (persuade, experience); editorial (read, persuade, experience); precise (operate); warm (operate, persuade); technical (operate, persuade); bold (persuade, experience); swiss (read, persuade); dense (operate); playful (persuade, experience); luxury (persuade, experience)

## Conflicts already resolved

fonts, cream-and-near-black, gradients-and-glass, labels, motion-amount, easing, type-scale, libraries, icon-set, taste-dials, depth-model, motion-frequency, generated-tokens

## Ids

ref:<topic>, ref:<topic>#<section>, rule:<id>, arch:<id>, conflict:<id>
