#!/usr/bin/env python3
"""
Task Evaluator — Sends extracted task data to Claude for expert evaluation.

Reads current.json and instructions.md, builds a dynamic prompt based on
whatever questions/axes the task contains, calls the Anthropic API,
and returns structured ratings + justification.

Fully generic — no assumptions about number of responses, rating axes, 
or option values. Adapts to whatever the extractor found.
"""

import json
import os
import re
import sys
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

# Load .env from the script's directory
SCRIPT_DIR = Path(__file__).parent.resolve()
load_dotenv(SCRIPT_DIR / ".env")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
STYX_MODEL = os.getenv("STYX_MODEL", "claude-opus-4-5-20251101")
CURRENT_JSON = SCRIPT_DIR / "current.json"
INSTRUCTIONS_MD = SCRIPT_DIR / "instructions.md"

def detect_task_type(task_data: dict) -> str:
    """Detect whether this is a fresh evaluation or a Rate & Review."""
    questions = task_data.get("questions", [])
    for q in questions:
        if q.get("selected") is not None:
            return "review"
        if q.get("type") == "textarea" and q.get("value"):
            return "review"
    return "fresh"


def build_conversation_text(task_data: dict) -> str:
    """Build readable conversation/response content from extracted data."""
    parts = []
    title = task_data.get("title", "Unknown Task")
    parts.append(f"# Task: {title}\n")

    # Use conversation_parts (new generic format)
    conv_parts = task_data.get("conversation_parts", [])
    if conv_parts:
        parts.append("## Content Sections\n")
        for cp in conv_parts:
            parts.append(f"--- Section {cp.get('index', '?')} ---")
            parts.append(cp.get("text", "[empty]"))
            parts.append("")
    else:
        # Legacy fallback
        prompt = task_data.get("prompt", "")
        if prompt:
            parts.append(f"## User Prompt\n{prompt}\n")
        for i, resp in enumerate(task_data.get("model_responses", [])):
            label = chr(65 + i)
            parts.append(f"## Response {label}\n{resp.get('text', '[empty]')}\n")

    # Include any tables found
    for tbl in task_data.get("tables", []):
        parts.append(f"\n## Table (headers: {', '.join(tbl.get('headers', []))})")
        for row in tbl.get("rows", []):
            if isinstance(row, dict):
                parts.append("  " + " | ".join(f"{k}: {v}" for k, v in row.items()))
            else:
                parts.append("  " + " | ".join(str(x) for x in row))

    # Include download links
    for dl in task_data.get("download_links", []):
        parts.append(f"\n[Download: {dl.get('text', '?')}]({dl.get('href', '')})")

    return "\n".join(parts)

def build_questions_description(task_data: dict) -> str:
    """Build a description of all form questions, their options, and any existing answers."""
    questions = task_data.get("questions", [])
    if not questions:
        return "(No form questions found in this task)"

    parts = []
    parts.append("## Form Questions Found\n")
    parts.append("Below is every question/field extracted from the task form.")
    parts.append("For each one, I've listed the available options and whether anything is already selected.\n")

    for q in questions:
        label = q.get("label") or q.get("text", "")[:80] or f"Question #{q.get('number', '?')}"
        qtype = q.get("type", "unknown")
        parts.append(f"### Q{q.get('number', '?')}: {label}")
        parts.append(f"  Type: {qtype}")

        if qtype == "textarea":
            val = q.get("value", "")
            if val:
                parts.append(f"  Current value: {val[:500]}")
            else:
                parts.append("  Current value: (empty)")

        elif q.get("options"):
            opts = q["options"]
            for opt in opts:
                marker = " ✓" if opt.get("checked") else ""
                parts.append(f"  - {opt.get('label', opt.get('value', '?'))}{marker}")
            if q.get("selected"):
                sel = q["selected"]
                if isinstance(sel, list):
                    parts.append(f"  Selected: {', '.join(sel)}")
                else:
                    parts.append(f"  Selected: {sel}")

        parts.append("")

    return "\n".join(parts)


def build_instructions_text(task_data: dict) -> str:
    """Combine all instruction blocks found in the task."""
    instructions = task_data.get("instructions", [])
    if not instructions:
        return "(No instructions found embedded in this task)"
    return "\n\n---\n\n".join(instructions)

def build_json_schema(task_data: dict) -> str:
    """Dynamically build the expected JSON output schema from the actual questions."""
    questions = task_data.get("questions", [])
    if not questions:
        return '{\n  "justification": "your detailed explanation"\n}'

    parts = ["{"]
    for q in questions:
        label = q.get("label") or f"question_{q.get('number', '?')}"
        # Sanitize to make a valid JSON key
        key = re.sub(r'[^a-zA-Z0-9_\- ]', '', label).strip().lower().replace(' ', '_').replace('-', '_')
        if not key:
            key = f"q{q.get('number', 'x')}"

        qtype = q.get("type", "unknown")
        if qtype == "textarea":
            parts.append(f'  "{key}": "your text here",')
        elif qtype in ("radio", "select") and q.get("options"):
            opt_labels = [o.get("label", o.get("value", "?")) for o in q["options"] if o.get("label")]
            if opt_labels:
                opts_str = " | ".join(opt_labels[:10])  # cap at 10 to avoid huge lines
                parts.append(f'  "{key}": "{opts_str}",')
            else:
                parts.append(f'  "{key}": "your choice",')
        elif qtype == "checkbox":
            parts.append(f'  "{key}": ["selected option 1", "selected option 2"],')
        else:
            parts.append(f'  "{key}": "your answer",')

    parts.append('  "justification": "your detailed evidence-based explanation"')
    parts.append("}")
    return "\n".join(parts)

def build_system_prompt(instructions_md: str) -> str:
    """Build the system prompt."""
    return f"""You are an expert AI response evaluator for a data annotation platform.
You provide top-quality, expert-level evaluations of AI-generated responses.

⚠️ CRITICAL — READ INSTRUCTIONS CAREFULLY EVERY TIME:
The tasks and instructions you receive CHANGE between runs. Different tasks have different rubrics,
rating axes, evaluation criteria, and special rules. You MUST read and internalize the full instructions
below for THIS specific task before evaluating. Do NOT assume the instructions are the same as any
previous evaluation. Treat every set of instructions as if you are seeing them for the first time.

Here are your general evaluation guidelines:

{instructions_md}

CRITICAL RULES:
- Always output your evaluation as a JSON code block.
- Be thorough and precise in your justification.
- Consider the full conversation context, not just the latest turn.
- The justification should be detailed (3-8 sentences minimum) and must NOT just restate ratings.
- Pay close attention to the SPECIFIC rating axes, scales, and option values defined in the task.
- Use ONLY the exact option values provided for each question — do not invent your own scale.

EVIDENCE-BASED JUSTIFICATION — MANDATORY:
- You MUST use direct quotes from the responses to support your ratings.
- When citing a strength or weakness, quote the exact text that demonstrates it.
- For CODING tasks: reference actual function names, variable names, specific bugs, missing error handling, etc.
- For NON-CODING tasks: still quote specific phrases or sentences that exemplify quality or issues.
- NEVER write justifications like "Response A is well-structured" without backing it up with quoted evidence.

TASK TYPES:
- If questions already have answers selected, this is a "Rate & Review" — you review another worker's ratings AND provide your own.
- If questions are blank, this is a "fresh evaluation" — you rate from scratch.
- For Rate & Review: also assess whether the worker's existing ratings and justification are accurate.
"""

def build_user_prompt(task_data: dict) -> str:
    """Build the complete user prompt — fully dynamic based on extracted data."""
    task_type = detect_task_type(task_data)
    conversation = build_conversation_text(task_data)
    task_instructions = build_instructions_text(task_data)
    questions_desc = build_questions_description(task_data)
    json_schema = build_json_schema(task_data)

    if task_type == "review":
        intro = """You are reviewing another worker's evaluation of AI responses. 
Their existing answers are shown with ✓ marks below. Read everything carefully, 
then provide your own independent ratings AND assess the worker's quality."""
    else:
        intro = """Evaluate the following AI responses. Read the full conversation 
and all instructions carefully, then answer every question below."""

    return f"""{intro}

{conversation}

---

## Task-Specific Instructions (from the platform)

{task_instructions}

---

{questions_desc}

---

## Your Task

Answer every question listed above. For radio/select questions, pick EXACTLY ONE of the listed options 
(use the exact text shown). For textarea questions, write your response. For checkbox questions, list 
all that apply.

{f'''Since this is a Rate & Review, also include:
- "worker_review_accuracy": "accurate | mostly_accurate | inaccurate"  
- "worker_review_issues": ["list of specific issues with the worker's existing answers"]
- "worker_review_recommendation": "approve | revise | reject"
''' if task_type == 'review' else ''}
Output as a JSON code block with this structure:

```json
{json_schema}
```

Pick ONE value from each set of options. The justification must explain your reasoning with 
specific quoted evidence from the responses — don't just restate ratings.
"""

def parse_json_from_response(text: str) -> dict:
    """Extract and parse JSON from Claude's response text."""
    json_match = re.search(r'```(?:json)?\s*\n(.*?)\n```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    return {"raw_response": text, "parse_error": True}


def evaluate(task_data: dict = None, dry_run: bool = False) -> dict:
    """Main evaluation function."""
    if task_data is None:
        if not CURRENT_JSON.exists():
            return {"error": "current.json not found"}
        with open(CURRENT_JSON, "r", encoding="utf-8") as f:
            task_data = json.load(f)

    if isinstance(task_data, list):
        if not task_data:
            return {"error": "current.json is empty"}
        task_data = task_data[0]

    # Load general instructions
    instructions_md = ""
    if INSTRUCTIONS_MD.exists():
        with open(INSTRUCTIONS_MD, "r", encoding="utf-8") as f:
            instructions_md = f.read()

    task_type = detect_task_type(task_data)
    system_prompt = build_system_prompt(instructions_md)
    user_prompt = build_user_prompt(task_data)
    if dry_run:
        return {
            "dry_run": True,
            "task_type": task_type,
            "system_prompt_length": len(system_prompt),
            "user_prompt_length": len(user_prompt),
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
        }

    if not ANTHROPIC_API_KEY:
        return {"error": "ANTHROPIC_API_KEY not set. Create a .env file with your key."}

    client = Anthropic(api_key=ANTHROPIC_API_KEY)
    print(f"🤖 Sending to {STYX_MODEL} ({task_type} evaluation)...", file=sys.stderr)

    message = client.messages.create(
        model=STYX_MODEL,
        max_tokens=8192,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    response_text = message.content[0].text
    parsed = parse_json_from_response(response_text)

    return {
        "task_type": task_type,
        "model_used": STYX_MODEL,
        "title": task_data.get("title", ""),
        "evaluation": parsed,
        "raw_response": response_text,
        "usage": {
            "input_tokens": message.usage.input_tokens,
            "output_tokens": message.usage.output_tokens,
        },
    }


def main():
    """CLI entry point."""
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("🧪 Dry run — not calling the API\n", file=sys.stderr)
    result = evaluate(dry_run=dry_run)
    if "error" in result:
        print(f"❌ {result['error']}", file=sys.stderr)
        sys.exit(1)
    output_file = SCRIPT_DIR / "result.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"✅ Saved to {output_file}", file=sys.stderr)
    if dry_run:
        print(f"System prompt: {result['system_prompt_length']} chars")
        print(f"User prompt: {result['user_prompt_length']} chars")
    else:
        print(f"Model: {result['model_used']}")
        print(f"Tokens: {result['usage']['input_tokens']} in / {result['usage']['output_tokens']} out")
        print(f"\n{result['raw_response']}")


if __name__ == "__main__":
    main()