# Task Evaluator — AI Response Evaluation Instructions

## Overview

This folder contains a workflow for evaluating AI responses on the **Task Evaluator** platform (DataAnnotation Rate & Review). When the user says **"continue"**, read `current.json` and follow the instructions below.

## Files

| File | Purpose |
|---|---|
| `current.json` | The active task data, extracted from a saved HTML file. Contains the prompt, model responses, instructions, rating axes, and (if applicable) pre-filled ratings. |
| `extract_task.py` | Parses a SingleFile-saved HTML from the task page into structured JSON. |
| `watch_downloads.py` | Watchdog script — automatically runs `extract_task.py` on any new `.html` file dropped into this folder, saving the result to `current.json`. |

## Workflow

1. User saves the task page as HTML (via SingleFile or similar).
2. `watch_downloads.py` detects the new file and runs `extract_task.py`, populating `current.json`.
3. User says **"continue"** → AI reads `current.json` and provides the evaluation.

## Determining Task Type

Each task will be ONE of two types:

### Type 1: Fresh Evaluation (Task to Complete)
- Radio selections / ratings are blank (`"checked": null`, `"Select..."` in rating tables)
- No worker justification text present
- **Your job**: Evaluate both responses from scratch. Provide all ratings + comparative + detailed justification.

### Type 2: Rate & Review
- Radio selections / ratings are already filled in (values selected, justification text present)
- Another worker has already completed the task
- **Your job**: Review the worker's submission. Assess whether their ratings and justification are accurate and well-reasoned. Provide your own independent ratings AND flag any issues with the worker's work.

## Quality Standards

**Provide top-quality, expert-level evaluations.** This means:

### Understanding the Conversation
- Read the **full conversation history** carefully before evaluating.
- Pay attention to **multi-turn context** — did the model recall prior turns? Did it handle topic shifts well?
- Identify the user's **explicit and implicit instructions** (e.g., "keep all responses concise" applies to all subsequent turns).

### Rating Each Axis
For each response, evaluate:

| Axis | What to Look For |
|---|---|
| **Instruction Following** | Did the model follow all explicit and implicit instructions? Includes conciseness requests, formatting asks, scope constraints, etc. |
| **Completeness** | Did the response fully address the prompt? Missing key info = issue. |
| **Factuality** | Are all factual claims accurate? Spend time verifying. Mark "Not Applicable" if no factual claims exist (e.g., creative writing, casual chat). |
| **Conciseness & Relevance** | Is everything in the response relevant? Is there unnecessary filler or over-explanation? |
| **Style & Tone** | Is the writing quality good? Is the tone appropriate for the context? |
| **Overall Quality** | Holistic assessment: Amazing / Pretty Good / Okay / Pretty Bad / Horrible. |

### Code Verification
If any response contains **code** (scripts, functions, configurations, commands, etc.):
1. **Build the environment** — install dependencies, set up whatever runtime is needed.
2. **Run the code** — execute it and observe the output.
3. **Verify correctness** — does it do what the response claims? Does it compile/run without errors? Are there bugs, edge cases, or security issues?
4. **Factor findings into ratings** — code that doesn't run or produces wrong output is a factuality/completeness issue.

### Fact-Checking
If a response makes **factual claims**, fact-check them thoroughly:
- **Spend up to 30 minutes** verifying claims via web research.
- **Prioritize**: central claims first → suspicious-looking claims → remaining claims.
- Check dates, names, statistics, laws, scientific facts, and any verifiable statements.
- If a claim can't be verified (behind paywall, internal info) or you run out of time after 30 minutes, treat it neutrally — don't penalize.
- If there are **no factual claims** (creative writing, casual chat), mark Factuality as "Not Applicable."

### Rating Scale (per-axis)
- **No Issues** / **Minor Issues** / **Major Issues** / **Not Applicable** — for dimension axes
- **Amazing** / **Pretty Good** / **Okay** / **Pretty Bad** / **Horrible** — for Overall Quality

### Comparative Rating
After rating both responses individually, provide a head-to-head comparison:
- Response A is much better / better / slightly better
- About the same
- Response B is slightly better / better / much better

### Justification
- **Always explain your reasoning.** Don't just restate the ratings — explain *why*.
- **Use direct quotes** from the responses to support every claim. Never speak in vague generalities.
  - Good: 'Response A correctly handles the edge case: "if the array is empty, return -1 instead of throwing"'
  - Bad: 'Response A handles edge cases well.'
- **For coding tasks**: Reference specific function names, variable names, code blocks, and line-level issues.
  - Good: 'The `parseConfig()` function in Response B silently swallows the FileNotFoundError on line 23 instead of propagating it, which would mask configuration issues in production.'
  - Bad: 'Response B has some error handling issues.'
- **For non-coding tasks**: Still quote specific phrases or sentences that demonstrate quality or problems.
- Call out specific strengths and weaknesses with concrete examples from the responses.
- Address conciseness violations, factual errors, missed context, and any other notable issues.
- Be thorough but not redundant.

## Special Rules
- Responses starting with `<think>` without a closing `</think>` → mark as **cannot be rated**.
- Responses obviously cut off mid-sentence (technical issue) → mark as **cannot be rated**.
- Prompts with PII → mark as **not ratable**.
- Punt/refusal responses → **Not Applicable** for Factuality. Safety punts → **Not Applicable** for Instruction Following. Oversensitive punts → **Major Issues** for Instruction Following.
- `[Image]` or `[URL]` placeholder tags → do not penalize (they render in the actual product).
- Models generally have up-to-date information / internet access.
