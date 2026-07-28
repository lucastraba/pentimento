# Archetype skeletons

Every plan uses the shared chrome (header, TOC, evolution strip). The archetype sets the badge/accent and the section skeleton below. Sections marked (opt) are used only when the content calls for them.

One rule spans all four: lead with the answer. The reader wants the verdict, the recommendation, the bottom line in the first screen, then the evidence below it. Each skeleton opens with a `::: verdict` banner that a reader can act on without scrolling. The renderer computes the glance summaries you'd otherwise write by hand: severity counts from `::: findings`, phase progress from `::: timeline` pills. Write the findings and phases; let the render tally them.

## implementation — approve and execute

```markdown
---
Archetype: implementation
---
# <What gets built>

> One-sentence scope: what will exist when this is done.

## Recommendation <!-- id: recommendation; eyebrow: Bottom line -->
   (::: verdict — Build? / First move / Main risk / Done when)
## Plan <!-- id: plan; eyebrow: Sequence -->
   (::: timeline with [done]/[next]/[later]; the render shows a progress meter)
## Decisions <!-- id: decisions; eyebrow: Locked -->
   (::: callout decision for each load-bearing choice)
## Changes <!-- id: changes; eyebrow: Diffs -->
   (file-touch table: | File | Change | Risk | — then ::: diff per non-trivial change)
## Risks (opt) <!-- id: risks; eyebrow: Watch out -->
   (::: callout risk per real risk, with mitigation)
## Verification <!-- id: verify; eyebrow: Done means -->
   (::: checklist — each done-when as a `- [ ]` item; the render shows coverage)
```

## brainstorm — compare directions

```markdown
---
Archetype: brainstorm
---
# <The question being explored>

> The tension in one sentence.

## Recommendation <!-- id: recommendation; eyebrow: Bottom line -->
   (::: verdict — Pick / Why / Closest loser; the reader gets your answer before the comparison)
## Comparison <!-- id: comparison; eyebrow: Tradeoffs -->
   (::: options criteria="..." — one row per option, exactly one [pick])
## Options <!-- id: options; eyebrow: Details -->
   (one ### per option; evidence, cost, what it forecloses; be opinionated)
## Open questions <!-- id: open; eyebrow: Unresolved -->
   (only the questions that could change the recommendation)
```

## audit — report findings

```markdown
---
Archetype: audit
---
# <What was audited>

> Scope and date in one line.

## Verdict <!-- id: verdict; eyebrow: Summary -->
   (::: verdict — Status / Highest severity / Fix first, then a short prose paragraph)
## Findings <!-- id: findings; eyebrow: Evidence -->
   (::: findings, CRIT/HIGH open, @collapse the rest; the render tallies severities; cite file:line)
## Remediation <!-- id: remediation; eyebrow: Next -->
   (::: timeline or checklist; note what needs separate approval)
## Scope (opt) <!-- id: scope; eyebrow: Coverage -->
   (what was inspected and what was not)
```

## design-doc — record a vision

```markdown
---
Archetype: design-doc
---
# <The system>

> The thesis in one sentence.

## Summary <!-- id: summary; eyebrow: Bottom line -->
   (::: verdict — Direction / Main bet / Hard constraint / Open risk)
## Decisions <!-- id: decisions; eyebrow: Locked -->
   (::: callout decision per locked decision — these are the doc's spine)
## Architecture <!-- id: architecture; eyebrow: System -->
   (::: flow diagram — hand-composed ::: figure only when flow can't say it; ### per component)
## Build order <!-- id: build; eyebrow: Sequence -->
   (::: timeline)
## Alternatives (opt) <!-- id: alternatives; eyebrow: Rejected -->
   (short comparison table or prose — what you turned down and why)
## Open questions <!-- id: open; eyebrow: Unresolved -->
```
