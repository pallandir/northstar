# Direction
Load when: PRODUCT.md exists and the visual and interaction approach has not been chosen yet.

## Goal

Choose a mode and one named design direction, and log the choice in `design/decisions.md`. Enable the research pack for this stage.

## 1. Choose the mode

The mode decides severities, motion budget and rubric weights. Pick from the primary job, not from taste.

| Primary job | Mode |
|---|---|
| Do repeated work in a tool | operate |
| Read, learn, look things up | read |
| Convince a visitor to act | persuade |
| Express a brand or tell a story | experience |

If the product mixes jobs, choose the mode of the surface being built and note it. A marketing site for an app is persuade, the app itself is operate.

## 2. Ground in the subject

A direction comes from the subject's world, not from a style catalogue. Write three short lists before proposing anything:

| List | Content |
|---|---|
| Materials | Physical or cultural things the subject is made of or used with |
| Moods | Three adjectives from the audience's point of view |
| Anti references | Looks the audience would find wrong |

Use `design_search` to find palettes, pairings and styles that match the subject and mode. Treat results as candidates only, since the brief and the mode filter them (see arbitration).

## 3. Propose 2 or 3 directions

Give each direction a name, a one line rationale and one risk.

| Part | Rule |
|---|---|
| Name | Evocative of the subject, two or three words |
| Rationale | One line tying it to the audience and job |
| Look | Palette temperature, type character, density, shape language |
| Risk | The most likely way it fails, such as low legibility or cost to build |
| Recommended | Mark one as the default so "go" works |

Directions must differ in kind, not only in colour. If all options share the same layout and type approach, they are one option.

## 4. Avoid the default looks

Check every direction against `NS-LOOK-DEFAULT-PALETTE`: cream with a serif and a terracotta accent, near black with one acid accent, and purple to cyan gradients. These are warnings unless the brief asks for them. Also avoid choosing a display face because it is the usual pick (`NS-TYPE-DEFAULT-DISPLAY`). Use `explain_rule` when you need the full reasoning.

## 5. Ask and record

Ask at most 3 questions, each with a default. Typical questions: which direction, whether the mode is right, and one open constraint. When the user answers:

1. Append an entry to `design/decisions.md` with stage `direction`, the chosen direction, the alternatives that were rejected and the rule ids that influenced it.
2. Carry the mode and direction name into the System stage.

## Bring your own direction

If the designer already has a direction file, do not propose alternatives. Confirm the mode, then record "direction supplied by designer" as the decision and go to System.

## Pitfalls

| Pitfall | Correction |
|---|---|
| Three directions that differ only in hue | Vary type, density and shape language too |
| Picking a trend by name | Derive from materials and mood |
| Skipping the risk | Every direction has one, state it |
| Choosing the mode last | The mode shapes everything, choose first |
| Treating search results as decisions | They are candidates, filter them by the brief |

## Exit checks

- Mode chosen and justified by the primary job.
- One direction chosen, with rejected alternatives noted.
- Decision appended to `design/decisions.md`.
- No default look adopted without the brief asking for it.
