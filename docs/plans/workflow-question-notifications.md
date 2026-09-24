# Workflow question notifications

`askQuestion` emits a generic structured question: `question`, optional `options`,
with no new metadata schema or implicit action mapping.
The consult executor handles the terminal `question` event separately from
assistant turns containing tools. It still excludes tool-bearing narration and
fails genuinely empty consults. Ordinary text/JSON outputs are unchanged.

The in-process consult transport preserves the question alongside the completed
Task. `assistant_call` stores `{kind: 'question', question, options?}`
and forwards the structure through `DeliverToChannel`. The callee and delivery
text both include the question and every numbered option.
Adapters may enhance this fallback with buttons, but button support is never an
execution requirement. This implementation uses the portable text fallback for
workflow deliveries, including Telegram. Direct-channel delivery uses the same text fallback; Telegram also keeps its existing buttons.

Completion means **question notification produced**, not that the requested
underlying action happened. Workflow successors follow the ordinary completed-step
path. No workflow suspension, automatic continuation, auto-answer or tool approval
is introduced. A blueprint-bound question is also a notification, not a claim that
a record was saved. Delivery outcomes remain best-effort and visible as before;
web remains a pull surface, not a workflow push target.

No raw webhook payload or consult transcript is injected into chat. IDs already
present in authored question text are preserved. No Oracle fields are inferred or
side effects performed. The next chat message follows existing channel routing
and transcript context. Durable question/action reply correlation and
workflow-specific interactive buttons are explicitly outside this scoped change.

Verification: consult-only question regression, transport preservation, workflow
completion and delivery (choices and no choices), channel text fallback, no-options
propagation through the query loop, and existing Telegram button/auth tests.
