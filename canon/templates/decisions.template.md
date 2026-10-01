# Design decisions

An append only log. Add new entries at the bottom and never edit or delete earlier ones. If a decision is reversed, add a new entry that refers to the old one. Every answer that changes direction is logged here, as is every allow entry and every critique.

## Entry shape

| Field | Content |
|---|---|
| Date | ISO date |
| Stage | brief, direction, system, compose, critique or polish |
| Decision | What was decided, in one or two sentences |
| Alternatives | What was considered and rejected, with the reason |
| Rule ids | Canon rules that influenced it, for example NS-LIB-ICON |
| Decided by | The designer, the agent with the designer's go, or a default accepted |

## Log

### <YYYY-MM-DD> <stage>

- Decision: <what was decided>
- Alternatives: <option one, why rejected>; <option two, why rejected>
- Rule ids: <NS-RULE-ID>
- Decided by: <designer | agent with default accepted>

### <YYYY-MM-DD> critique

- Decision: <overall score and the top findings accepted for polish>
- Alternatives: <findings deferred or allow listed, with reasons>
- Rule ids: <NS-RULE-ID>
- Decided by: <agent>
