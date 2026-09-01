# claudishlint

Claudish is the dense, metaphor-heavy style some models slip into.
claudishlint is a heuristics-based linter and Pi extension designed to
translate Claudish into English.
It detects Claudish in agent responses, provides structured feedback,
and prompts for a fixed response.

- `src/claudishlint/`. A small heuristic linter. It has no runtime
  dependencies. It flags the structural tics and the vocabulary that mark
  Claudish. Every finding carries feedback. The feedback tells the writer what
  to write instead.
- A Pi extension. Runs via hook at the end of the agent's turn. It runs the
  linter over the finished response. When a response trips enough rules, it
  queues a follow-up. The follow-up asks the model to rewrite the response. It
  quotes each finding and its rule's advice. The rules the linter applies are
  user-configurable.

The repo also ships style references and the real-data sources. The linter
uses these sources to calibrate its heuristics.

## How it works

```
agent finishes a response
        │
        ▼
lint the response with claudishlint
        │
        ├─ pass ─► done
        │
        └─ rewrite ─► queue one follow-up that quotes each finding
                      and asks the model to fix its own prose
```

The loop runs exactly once. The extension lints the agent's final message.
When the verdict is `rewrite`, it sends one follow-up re-prompt. Each
interaction receives a single re-prompt, so a long turn still ends after one
fix. The extension then stops and the conversation continues. The goal is to
remove the Claudish from a finished answer, using one clean rewrite.

The extension builds the re-prompt from the findings. Each rule carries a
`description`. This note explains the pattern and tells the writer what to
write instead. The extension quotes each finding's matched text beside that
note. Then it asks the model to rewrite the whole response, quoting the
embedded Simple Language Style Guide. The model restyles. It answers nothing
beyond the rewrite, so every fact survives.

## The linter

See [src/claudishlint/README.md](src/claudishlint/README.md) for the library itself.
In short:

```ts
import { review } from "./src/claudishlint/index.ts"

const { verdict, findings } = review(responseText, options)
```

- `lint(text, options?)`. Run every rule over a full response, or run a
  subset. Return sorted, non-overlapping findings.
- `review(text, options?)`. The decision layer. It returns
  `{ verdict, score, threshold, findings }`. `verdict` is `"rewrite"` or
  `"pass"`. This is the "when to re-prompt" knob the extension calls.
- `rules`. The rule array in `src/claudishlint/rules.ts`. Each rule has an
  `id`, `name`, `description`, an optional `minHits`, and a `find(text)`
  finder.

The rules cover structural tics (anaphora runs, echo triads, "X, not Y"
contrasts, chain verbs) and vocabulary derived from the
[load-bearing](https://louisabraham.github.io/load-bearing/) corpus. These
words separate Claude-authored writing from everything else.

## The Pi extension

The Pi extension connects the linter to an agent's turn. It subscribes to the
end of the agent's run. It lints the final message. When `review()` returns
`rewrite`, it sends one follow-up message. The message quotes each finding and
its rule's `description`. It asks the model to rewrite the prose in plain
English. It works with any model Pi runs, so the fixed prose stays plain whatever
produced it.

To keep the re-prompt to one per interaction, the extension records that it
has already nudged. It uses pi's persistent entry API. A long working session
with many turns corrects the prose once. A later request from the user
triggers another correction.

## User-configurable rules

You configure the gate with a JSON file. The extension reads this file from pi's
config directory, `~/.pi/agent/.claudishlint.json` (or wherever `PI_CODING_AGENT_DIR`
points). The file maps directly onto `review()`'s options.

```json
{
  "strictness": 0.8,
  "rules": {
    "ai-vocab": 0,
    "colon-triple": 1
  }
}
```

- `strictness`. A float from 0 to 1. The default is `1`. `1` re-prompts on any
  finding. `0` never re-prompts. Lower it to tolerate long, mostly-fine
  messages. The pass/fail line becomes a density of count-aware findings per
  1000 words. This is the knob to lower when the linter fires too often. There
  is nothing else to configure at first.
- `rules`. Per-rule overrides. `0` ignores a rule entirely. Its findings are
  neither counted nor reported. `1` makes a single finding of that rule block.
  It blocks regardless of message length. Use this for words you cannot stand.
  Rules not listed use the global `strictness`. Use this to disable rules that
  are too noisy for your register. Use this to hard-fail on a tell that bothers
  you more than the default.

To list every rule id and what it flags, see the `rules` array in
`src/claudishlint/rules.ts`.

## Data sources (test fixtures only)

The raw data in `data/` is used only to calibrate and sanity-check the
linter's heuristics. It is not part of the runtime. The extension and the
linter read it only during tests.

- `data/claudish_pairs.jsonl`. The
  [adamrotmil/claudish-pairs](https://huggingface.co/datasets/adamrotmil/claudish-pairs)
  dataset. Claude Opus wrote the English/Claudish pairs. The English side is
  the linter's "should pass" class. The Claudish side is an extra "should
  flag" class.
- `data/raw/load-bearing/`. A clone of the
  [load-bearing](https://github.com/louisabraham/load-bearing) corpus. Its
  k-means analysis of Claude-authored PR descriptions is the source of the
  vocabulary rules. PR descriptions written from 2026-04-01 onwards form the
  linter's positive class.
