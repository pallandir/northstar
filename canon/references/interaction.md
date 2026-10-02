# Interaction
Load when: building or reviewing controls, forms, hover and press feedback, loading and error behaviour, or any state a user can reach.

## Goal

A control feels finished when every state exists and responds at once. This reference covers states, feedback timing, forms and flows. Motion values live in `references/motion.md`.

## State matrix

Every interactive element has these states, and each is visibly different:

| State | Rule |
|---|---|
| default | The resting look, with a clear affordance |
| hover | More contrast, never less. Only on devices that can hover |
| focus visible | A ring from the focus token, offset from the edge, never removed (`NS-A11Y-FOCUS-VISIBLE`) |
| active | Pressed feedback, scale 0.97 and a darker fill (`NS-FINISH-PRESS-STATE`) |
| disabled | Reduced contrast and `not-allowed`, with the reason nearby when it is not obvious |
| loading | Spinner or progress inside the control while the label stays |
| error | Message next to the field, text plus an icon, never colour alone |
| empty | A first step or an explanation, never a blank area (`NS-COPY-EMPTY-STATE`) |
| success | A quiet confirmation near the action |

## Hover and press

- Gate hover effects with `@media (hover: hover) and (pointer: fine)` so touch screens do not get stuck states (`NS-FINISH-HOVER-GATE`).
- Press feedback appears within 100ms and scales to 0.97, never below 0.95.
- Hover should raise contrast or lift one or two pixels. Large movement on hover reads as jitter.
- Tooltips wait before the first one opens and then open instantly for neighbours, so scanning a toolbar feels fluid.
- Set `touch-action: manipulation` on controls to remove the double tap zoom delay, and set the tap highlight to the palette.

## Loading and async

- Keep the label on a loading button and add the indicator, so the width does not jump.
- Show a spinner only after about 150ms, and keep it for at least 300ms so it does not flash.
- Use skeletons that match the final layout for content, so nothing shifts when data arrives.
- Update the interface optimistically for actions that nearly always succeed, then reconcile. Roll back with a clear message when the server refuses.
- Announce async results to assistive tech with a polite live region.
- Never leave the user with no signal for more than a second.

## Destructive actions

- Offer Undo where the action can be reversed, and ask for confirmation where it cannot.
- Name the thing and the consequence in the confirm button, such as Delete 3 files, not Yes.
- Put the destructive button away from the primary one and do not make it the default focus.

## Forms

- Give every control a visible label that also activates it. Placeholders show examples and are not labels.
- Keep submit enabled until submission starts. Validate on submit and again on change, and show the error next to the field, then move focus to the first error.
- Never block typing or paste. Show the problem instead.
- Set the right `type`, `inputmode` and `autocomplete` so keyboards and password managers help.
- Warn before navigation when unsaved changes would be lost.
- Enter submits a single line field. In a multi line field, Command or Control plus Enter submits.

## Navigation and state

- Put filters, tabs, pagination and expanded panels in the URL so refresh and sharing work.
- Use real links for navigation and real buttons for actions.
- Restore scroll position on back and forward.
- Every screen has a next step or a way out. No dead ends.

## Keyboard and gestures

- Everything works from the keyboard in a sensible order, and focus moves into dialogs and returns to the trigger when they close.
- Give every drag, swipe or pinch a click and keyboard alternative.
- Do not animate actions triggered from the keyboard that people repeat all day.

## Checklist

- Each state in the matrix exists for every control the screen uses.
- Hover is gated, press is felt, focus is visible.
- Loading keeps the label, skeletons match layout, errors sit next to their fields.
- Destructive actions can be undone or are confirmed with a named consequence.
- Forms label every field, and filters live in the URL.
