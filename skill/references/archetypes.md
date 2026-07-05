# Archetype skeletons

Every plan uses the shared chrome (header, TOC, evolution strip). The archetype sets the badge/accent and the section skeleton below. Sections marked (opt) are used only when the content calls for them.

## implementation — approve and execute

```markdown
---
Archetype: implementation
---
# <What gets built>

> One-sentence scope: what will exist when this is done.

## Goal <!-- id: goal; eyebrow: Outcome -->
## Approach <!-- id: approach; eyebrow: How -->
   (::: callout decision for each load-bearing choice)
## Changes <!-- id: changes; eyebrow: Diffs -->
   (file-touch table: | File | Change | Risk | — then ::: diff per non-trivial change)
## Phases <!-- id: phases; eyebrow: Sequence -->
   (::: timeline with [next]/[later])
## Risks (opt) <!-- id: risks; eyebrow: Watch out -->
   (::: callout risk per real risk, with mitigation)
## Verification <!-- id: verify; eyebrow: Done means -->
```

## brainstorm — compare directions

```markdown
---
Archetype: brainstorm
---
# <The question being explored>

> The tension in one sentence.

## Framing <!-- id: framing; eyebrow: The question -->
## Options <!-- id: options; eyebrow: Directions -->
   (one ### per option; comparison table with {dot:...} keys; be opinionated in prose)
## Recommendation <!-- id: recommendation; eyebrow: My take -->
   (::: callout decision — the recommendation and what it forecloses)
## Open questions <!-- id: open; eyebrow: Unresolved -->
```

## audit — report findings

```markdown
---
Archetype: audit
---
# <What was audited>

> Scope and date in one line.

## Verdict <!-- id: verdict; eyebrow: Summary -->
   (::: verdict banner, then a short prose paragraph)
## Findings <!-- id: findings; eyebrow: Evidence -->
   (::: findings, CRIT/HIGH open, @collapse the rest; cite file:line in the text)
## Remediation <!-- id: remediation; eyebrow: Next -->
   (::: timeline or checklist; note what needs separate approval)
```

## design-doc — record a vision

```markdown
---
Archetype: design-doc
---
# <The system>

> The thesis in one sentence.

## Why <!-- id: why; eyebrow: Diagnosis -->
## Decisions <!-- id: decisions; eyebrow: Locked -->
   (::: callout decision per locked decision — these are the doc's spine)
## Architecture <!-- id: architecture; eyebrow: System -->
   (::: figure diagram; ### per component)
## Build order <!-- id: build; eyebrow: Sequence -->
   (::: timeline)
## Open questions <!-- id: open; eyebrow: Unresolved -->
```
