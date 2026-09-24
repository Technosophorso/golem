# Workflow question notifications and bound Telegram responses

## Contract

`askQuestion` emits `question`, optional single-choice `options`, `allowCustom`
(default true), optional `actionId`, `version`, and authored `context`. The action
ID/version identify the external question, **not** the chat session. No tool name
or execution authority is accepted from this event.

An `assistant_call` step can supply an authored `question` template and a separate
`questionResponse: { toolName, arguments, answerField }`. Only argument values
and question values interpolate `{{input.X}}` / `{{vars.X}}`; the tool name and
answer field must be fixed literals. Exact placeholders retain JSON types
(e.g. numeric versions); missing exact placeholders fail closed. The authored
question overrides the callee's question. The existing consult still runs, so
restrict its tools as shown below and do not enable skills or page actions on a
notification-only step.

Completion means **notification produced**, not that the external action has
completed. No polling, inferred answers, auto-approval, workflow suspension or
automatic continuation is introduced. Unsupported channels retain numbered text.

## Exact workflow update

Update the notification `assistant_call` step using this shape (replace the two
UUID placeholders and use the exact connector tool registry name/schema):

```json
{
  "id": "notify_question",
  "type": "assistant_call",
  "target": { "assistantId": "ASSISTANT_UUID_SERVING_THE_CHAT" },
  "prompt": "Ask the user the supplied question. Do not perform or submit any job.",
  "tools": ["askQuestion"],
  "question": {
    "question": "{{input.question}}",
    "options": ["dev", "prod"],
    "allowCustom": true,
    "actionId": "{{input.action_id}}",
    "version": "{{input.version}}",
    "context": "Choose the environment for the existing action; do not create a new action."
  },
  "questionResponse": {
    "toolName": "answer_action",
    "arguments": {
      "action_id": "{{input.action_id}}",
      "version": "{{input.version}}"
    },
    "answerField": "answer"
  },
  "deliver": {
    "channelType": "telegram",
    "channelIntegrationId": "BYO_CHANNEL_INTEGRATION_UUID",
    "channelId": "-1001234567890:topic:7"
  }
}
```

* Match the actual webhook envelope paths; this example expects `question`,
  `action_id` and numeric `version` at the trigger input root. Set the authored
  options to the backend's accepted values. They may individually interpolate
  e.g. `{{input.options.0}}`. `allowCustom` is an authored boolean.
* `answer_action` is an **example literal**, not a special-cased provider. Use the
  exact direct connector tool name available to the answering assistant/user.
  `mcp_call` and `mcp_search` are not supported response targets. Never interpolate
  a webhook-supplied tool name or copy the entire webhook into arguments/context.
* Typed `test` is passed as `{action_id, version, answer: "test"}`. The backend,
  not Brian, interprets any custom-answer sentinel or validates stale versions.
* Pin the BYO integration UUID, not the workspace channel UUID. Use the actual
  assistant routed to that chat/topic, not an unrelated `primary` assistant.
  A new channel/UI default labelled official does not select the BYO bot.
  Choose the BYO integration explicitly. Credentials are resolved server-side;
  no bot token belongs in the workflow.
* **Current Ask limitation:** this reply path cannot create/resume an approval.
  If the pinned response tool is Ask, the user sees "Response awaiting separate
  approval" and the question remains open and unconsumed. Nothing is executed.
  Either use an existing separately approved workflow tool-call flow, or have
  an authorized admin explicitly set **this response tool** to Allow, then
  explicitly reply/click again before expiry. Do not change `submit_change` or
  other tools' policies. This implementation does not change any policy.

Apply migration `561_workflow_channel_questions.sql` before enabling this code.
No production migration, workflow edit, policy change or deployment was performed
as part of implementation.

## Delivery and reply safety

Without `questionResponse`, BYO Telegram sends numbered text with an explicit
"No response action is configured" notice, no answer buttons and no typing
promise. Correlated replies fail closed without entering chat.

BYO Telegram sends numbered text plus inline choices using the selected
integration's real credentials and topic-qualified channel ID. Custom typing is
advertised only when allowed. An opaque question reference is included in text:
it prevents a quoted reply from becoming generic chat if Telegram sent the
message but the process died before recording its message ID. It conveys no
arguments, action ID, credentials or authority. Deleted topics fail delivery;
correlated questions never retry in General or through the official bot.

`workflow_channel_questions` persists full question/context and the frozen
response arguments under integration/workspace/assistant/user/chat+topic/message.
It is system-only with RLS and a 24-hour execution expiry. Explicit replies and
callbacks still resolve consumed/expired tombstones and fail closed. A typed
answer without Telegram Reply is accepted only when one active bound question
exists for the authorized user in that topic; otherwise use Reply to disambiguate.
Unanchored text after expiry cannot be recognized as an answer, so use Reply.

The authenticated BYO webhook runs existing identity/routing/access checks,
requires current workspace membership, then rebuilds the connector registry and
Team/Project scope. A successful reply atomically claims the binding immediately
before one schema-validated tool call through the core tool executor. The reply
never enters the LLM/chat pipeline. No raw tool result or error is sent to the
channel. Blocked, invalid, or Ask responses are not consumed; execution attempts
are at-most-once, including provider redelivery and concurrent button clicks.

## Limits

* Hosted official Telegram has no bound-question handler in this open-core
  slice. An explicit response binding without BYO credentials is skipped rather
  than sending an actionable but unbound question. Other channels remain text
  fallback only; direct-chat (non-workflow) Telegram questions retain their
  existing process-local convenience buttons.
* A notification already sent before this change cannot be retroactively bound.
  Reissue it through the updated workflow after migration/configuration.
* Delivery is not an atomic transaction with Telegram. A send/attach crash yields
  an unavailable quoted question, not an action. Reissue deliberately.
* At-most-once execution sacrifices automatic recovery after a claim/process
  crash or ambiguous network failure. Check backend status before reissuing.
  Distinct deliveries are distinct claims; backend action ID/version validation
  and idempotency remain authoritative across duplicate workflow notifications.
* Tombstones are retained until workspace/integration deletion; there is no new
  polling worker or payload-retention sweeper in this slice.
