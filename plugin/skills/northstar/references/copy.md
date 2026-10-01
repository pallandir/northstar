# Copy
Load when: writing or reviewing labels, buttons, errors, empty states, headlines or any interface text.

## Principles
- Say what the thing is and does in plain, specific words. Real content from PRODUCT.md beats invention.
- A control names its outcome. The same thing keeps the same name everywhere, so Publish leads to Published (NS-COPY-CTA-VERB).
- Errors state the problem, the cause if known and the next step, in the interface's voice and without apology (NS-COPY-ERROR).
- An empty state explains what belongs here and offers the action to add it (NS-COPY-EMPTY-STATE).
- Shorter is better until it hides meaning. Cut words that repeat the heading or the label.
- Sentence case for headings, buttons and labels. Title case only for proper names.
- Write for the reader's task and vocabulary, not the system's internal terms.
- Filler makes a design feel templated as much as visuals do (NS-COPY-FILLER).

## Do
- Buttons: verb plus object, for example Save changes, Invite teammate, Delete project.
- Destructive actions name what is lost and use the same noun as the dialog title.
- Pick one term per concept and keep a short glossary in PRODUCT.md.
- Do not mix workspace, project and team for one object.
- Errors: Could not save changes.
- The file is larger than 10 MB. Choose a smaller file.
- Place the message beside the field, and keep it for the user to read, not a code.
- Form labels visible and above the field.
- Helper text says the format.
- Placeholders are examples only.
- Empty states: one sentence on what appears here, one primary action, optional link to learn more.
- Distinguish first use, no results and cleared states.
- Confirmations say what happened, in the past tense, and offer undo when possible.
- Loading text names the work, for example Importing 120 rows, not Please wait.
- Numbers and dates: formats for the user's locale, units written out, relative time with a tooltip for the absolute time.
- Headlines in Persuade state the product's value in concrete terms and name the audience or outcome.
- Support the claim with a proof point.
- Text lives in the document as real text so it can be translated, searched and read by assistive technology.
- Leave room for 30 to 40% longer translations.
- Tool tips and helper text add information the label lacks and are not a repeat of it.

## Avoid
- Submit, Click here, OK, Go, Learn more as labels (NS-COPY-CTA-VERB).
- Error messages such as Something went wrong or Invalid input (NS-COPY-ERROR).
- A blank list or table with no explanation (NS-COPY-EMPTY-STATE).
- Lorem ipsum, Unlock the power, Seamless, Supercharge, Elevate your, Revolutionize, Next generation, All in one platform, Unleash, Cutting edge, Game changing (NS-COPY-FILLER).
- Placeholder names such as John Doe or Acme, a person icon as an avatar, and perfect figures such as 99.99% or 50% (NS-COPY-PLACEHOLDER-DATA).
- Two calls to action with the same intent, such as Contact us and Get in touch on one page.
- Eyebrow labels above headings and a single accented word in a headline (NS-SLOP-EYEBROW, NS-SLOP-SINGLE-WORD-ACCENT).
- Emoji or glyphs in place of icons (NS-SLOP-EMOJI-ICON).
- Use icons from a library and call `resolve_icon`.
- Decorative numbering of sections (NS-SLOP-NUMBERED-SECTIONS).
- Exclamation marks, jokes in error states, blaming the user.

## By mode
| Mode | Voice |
| --- | --- |
| operate | Terse, literal, scannable. Labels are nouns and verbs, errors give the fix, no marketing language |
| read | Clear editorial voice, descriptive headings that work as a table of contents, defined terms, consistent tone |
| persuade | Specific claims, concrete outcomes, one CTA wording repeated, no filler phrases |
| experience | Distinctive voice allowed and often the point, still plain and truthful, copy may be minimal. Copy weight is low in scoring |

## Checks
- No vague CTA labels in the built page (NS-COPY-CTA-VERB).
- Trigger every error path and read the message (NS-COPY-ERROR).
- Visit every list with no data (NS-COPY-EMPTY-STATE).
- Search the source for filler phrases and placeholder text (NS-COPY-FILLER).
- Names, figures and logos are real or labelled as sample data (NS-COPY-PLACEHOLDER-DATA).
- The same concept has the same word across navigation, headings, buttons and messages.
- All headings, buttons and labels are in sentence case.
