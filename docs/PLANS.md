# ExecPlan Guide

Last reviewed: 2026-03-23

Use an ExecPlan for any change that is multi-file, multi-hour, cross-cutting, or high risk.

## Required properties

- The plan must be self-contained and understandable without chat history.
- The plan must explain the user-visible or operational outcome, not only code edits.
- The plan must define validation commands and expected outcomes.
- The plan must stay updated as decisions and discoveries change.

## Required sections

- Title
- Purpose or big picture
- Repository context
- Milestones
- Validation plan
- Progress
- Surprises and discoveries
- Decision log
- Outcomes and retrospective

## Writing guidance

- Use plain language and define repository-specific terms.
- Name exact paths when implementation depends on them.
- Prefer observable acceptance criteria over internal descriptions.
- Keep the document in the repository while the work is active.
