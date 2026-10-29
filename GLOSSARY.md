# jev-sdk

The language of typed Jev judgments in TypeScript: questions, verdicts, bars, and the tools built on them.

## Language

**Jev**: The TypeSafe decision service that answers typed questions about a piece of state. Not a person and not a general chat model.

**State**: The JSON value the questions are asked about, masked on this machine before it is sent.
_Avoid_: context (retrieval and prompt text elsewhere).

**Question**: One typed ask with an id, a type (`noul`, `choice`, `score`, or experimental `box`) and instructions; each yields one verdict.

**Noul**: The yes or no question type. Not "null".

**Verdict**: The answer to one question: `yes` or `no`, one option, a level, or a region. Evidence for an operator or an agent, never authorization to act.
_Avoid_: decision (the whole judgment result holds many verdicts).

**Undecided**: The verdict returned when Jev could not decide above the bar or any failure occurred, with a reason. It is never permission to proceed.

**Bar**: The confidence a verdict must clear to count as decided; an explicit override, else set by the question's stakes.
_Avoid_: threshold only when naming the numeric field; the bar is the concept.

**Stakes**: A question's risk level (`passive`, `design`, `critical`) that selects its bar.

**Masking**: Replacing secrets in every string with placeholders on this machine before anything leaves it.

**Golden vectors**: Shared fixtures that make the TypeScript, Python and Rust SDKs send the same bytes, apply the same bars and return the same verdicts.

**Contract**: A DTO or schema: the shape of a request, response, record or message that crosses a boundary. Not a smart contract.
In this SDK, the question, verdict and options shapes are contracts.

**Question pack**: A JSON file `{ "questions": { id: { type, stakes, instructions, criteria } } }` that templates reusable questions.

**Finding**: A reported problem routed through Jev to decide its handling.
