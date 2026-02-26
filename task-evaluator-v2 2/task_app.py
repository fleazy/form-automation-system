#!/usr/bin/env python3
"""
Task Evaluator — Full automation pipeline for AI response evaluation.

Watches Downloads for task HTML files, extracts task data,
evaluates via Claude API, and shows results in a web UI.

Usage:
  python task_app.py              # Start watching + auto-evaluate + web UI (default)
  python task_app.py --once       # Evaluate current.json once and show in browser
  python task_app.py --dry-run    # Build prompts without calling API
  python task_app.py --no-eval    # Watch only, don't auto-evaluate
"""

import json
import re
import sys
import time
import threading
import webbrowser
import logging
import urllib.request as urllib_req
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
# Adjust imports for local modules
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

from task_evaluator import evaluate, CURRENT_JSON, STYX_MODEL
from extract_task import extract_from_html

PORT = 5111
DOWNLOADS_DIR = Path.home() / "Downloads"

# ── State ────────────────────────────────────────────────────────────────
task_history = []
current_status = {"state": "idle", "message": "Waiting for tasks..."}
history_lock = threading.Lock()
latest_task_data = None   # raw extracted task (questions + options)
latest_eval = None        # raw evaluation dict from Claude

# ── Automation helpers ───────────────────────────────────────────────────
def _sanitize_key(label: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_\- ]', '', label).strip().lower().replace(' ', '_').replace('-', '_')

def build_automation_commands(task_data: dict, evaluation: dict) -> list:
    """Map Claude's evaluation answers → FILL_FIELD / CLICK_SELECTOR commands.
    
    Uses the unique CSS selector from extract_task (based on data-question-id UUID)
    to target the correct DOM element, avoiding ghost/duplicate question divs.
    """
    commands = []
    for q in task_data.get('questions', []):
        label = q.get('label') or (q.get('text') or '')[:80] or f"question_{q.get('number','?')}"
        key = _sanitize_key(label)
        if key not in evaluation:
            continue
        answer = evaluation[key]
        if answer is None or (isinstance(answer, str) and not answer.strip()):
            continue

        q_type = q.get('type', 'unknown')
        opts   = q.get('options', [])
        # Use the pre-built selector from extract_task (UUID-based, globally unique)
        sel    = q.get('selector', '')

        if q_type == 'unknown' or not sel:
            continue

        if q_type == 'radio':
            match = next((o for o in opts if o.get('label','').strip().lower() == str(answer).strip().lower()), None)
            if match is None:
                match = next((o for o in opts if o.get('value','').strip().lower() == str(answer).strip().lower()), None)
            if match:
                label_text = (match.get('label') or match.get('value') or '').strip()
                if label_text:
                    commands.append(f'CLICK_OPTION,{sel},{label_text}')

        elif q_type == 'textarea':
            text = str(answer).strip()
            if text:
                commands.append(f'FILL_FIELD,{sel} textarea,{text}')

        elif q_type == 'checkbox':
            answers = answer if isinstance(answer, list) else [answer]
            for ans in answers:
                match = next((o for o in opts if o.get('label','').strip().lower() == str(ans).strip().lower()), None)
                if match:
                    label_text = (match.get('label') or match.get('value') or '').strip()
                    if label_text:
                        commands.append(f'CLICK_OPTION,{sel},{label_text}')

    return commands

def trigger_automation(task_data: dict, evaluation: dict):
    """POST generated commands to the reading-behavior automation server."""
    commands = build_automation_commands(task_data, evaluation)
    if not commands:
        print("⚠  No automation commands generated (no matched questions)")
        return
    print(f"🤖 Sending {len(commands)} fill commands to automation server...")
    for c in commands:
        print(f"   {c}")
    payload = json.dumps({'commands': commands, 'cursorX': 0, 'cursorY': 0}).encode()
    try:
        req = urllib_req.Request(
            'http://localhost:3004/automation',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        urllib_req.urlopen(req, timeout=5)
        print(f"✅ Automation triggered")
    except Exception as e:
        print(f"⚠  Could not reach automation server on port 3004: {e}")

app = Flask(__name__)

# ── Watchdog Handler ────────────────────────────────────────────────────
class TaskFileHandler(FileSystemEventHandler):
    def __init__(self, auto_evaluate=True):
        self.auto_evaluate = auto_evaluate
        self.processing = False

    def on_created(self, event): self._handle(event.src_path)
    def on_moved(self, event): self._handle(event.dest_path)
    def _handle(self, filepath):
        p = Path(filepath)
        if p.is_dir() or p.suffix.lower() != ".html":
            return
        name_lower = p.name.lower()
        if "styx" not in name_lower and "obsidian" not in name_lower and "task" not in name_lower:
            return
        if self.processing:
            return
        self.processing = True
        time.sleep(2)
        threading.Thread(target=self._process, args=(p,), daemon=True).start()

    def _process(self, filepath):
        global latest_task_data, latest_eval
        try:
            with history_lock:
                current_status["state"] = "extracting"
                current_status["message"] = f"Extracting: {filepath.name}"
            print(f"\n{'='*60}")
            print(f"[+] Detected: {filepath.name}")
            print("📄 Extracting task data...")
            task_data = extract_from_html(str(filepath))
            with open(CURRENT_JSON, "w", encoding="utf-8") as f:
                json.dump(task_data, f, indent=2, ensure_ascii=False)
            print(f"✅ Extracted to current.json")
            if not self.auto_evaluate:
                with history_lock:
                    current_status["state"] = "idle"
                    current_status["message"] = "Extracted — run manually to evaluate"
                return
            with history_lock:
                current_status["state"] = "evaluating"
                current_status["message"] = f"Claude {STYX_MODEL} is thinking..."
            print(f"🤖 Evaluating with {STYX_MODEL}...")
            result = evaluate(task_data=task_data)
            if "error" in result:
                print(f"❌ Evaluation error: {result['error']}")
                with history_lock:
                    current_status["state"] = "error"
                    current_status["message"] = result["error"]
                return
            result_file = SCRIPT_DIR / "result.json"
            with open(result_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            result["_meta"] = {
                "filename": filepath.name,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "id": len(task_history),
            }
            with history_lock:
                latest_task_data = task_data
                latest_eval = result.get("evaluation", {})
                task_history.append(result)
                current_status["state"] = "complete"
                current_status["message"] = "Evaluation complete — ready to fill"
            usage = result.get("usage", {})
            print(f"✅ Done! {usage.get('input_tokens', 0):,} in / {usage.get('output_tokens', 0):,} out")
            # Auto-fill the live form
            threading.Thread(target=trigger_automation, args=(task_data, result.get("evaluation", {})), daemon=True).start()
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback; traceback.print_exc()
            with history_lock:
                current_status["state"] = "error"
                current_status["message"] = str(e)
        finally:
            self.processing = False

# ── Flask Routes ────────────────────────────────────────────────────────
@app.route("/")
def index(): return render_template_string(HTML_TEMPLATE)

@app.route("/api/status")
def api_status():
    with history_lock:
        return jsonify({"status": current_status, "task_count": len(task_history), "model": STYX_MODEL})

@app.route("/api/tasks")
def api_tasks():
    with history_lock: return jsonify(list(reversed(task_history)))
@app.route("/api/tasks/<int:task_id>")
def api_task_detail(task_id):
    with history_lock:
        if 0 <= task_id < len(task_history): return jsonify(task_history[task_id])
        return jsonify({"error": "not found"}), 404

@app.route("/api/evaluate", methods=["POST"])
def api_evaluate_now():
    def _run():
        with history_lock:
            current_status["state"] = "evaluating"
            current_status["message"] = f"Claude {STYX_MODEL} is thinking..."
        try:
            result = evaluate()
            if "error" in result:
                with history_lock:
                    current_status["state"] = "error"
                    current_status["message"] = result["error"]
                return
            result["_meta"] = {"filename":"manual","timestamp":datetime.now().strftime("%Y-%m-%d %H:%M:%S"),"id":len(task_history)}
            result_file = SCRIPT_DIR / "result.json"
            with open(result_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            with history_lock:
                task_history.append(result)
                current_status["state"] = "complete"
                current_status["message"] = "Evaluation complete"
        except Exception as e:
            with history_lock:
                current_status["state"] = "error"
                current_status["message"] = str(e)
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"ok": True})
@app.route("/api/current")
def api_current():
    with history_lock:
        if task_history: return jsonify(task_history[-1])
        return jsonify(None)

@app.route("/api/history/clear", methods=["POST"])
def api_history_clear():
    with history_lock:
        if len(task_history) > 1:
            latest = task_history[-1]
            task_history.clear()
            task_history.append(latest)
            latest["_meta"]["id"] = 0
        return jsonify({"ok": True, "remaining": len(task_history)})

@app.route("/api/fill-form", methods=["POST"])
def api_fill_form():
    with history_lock:
        td = latest_task_data
        ev = latest_eval
    if not td or not ev:
        return jsonify({"error": "No evaluation available yet"}), 400
    threading.Thread(target=trigger_automation, args=(td, ev), daemon=True).start()
    return jsonify({"ok": True})

@app.route("/api/test-fill", methods=["POST"])
def api_test_fill():
    """Send automation commands using a hardcoded mock evaluation.
    
    Skips the Claude API entirely — useful for testing the extension ↔ Pico
    pipeline without burning API credits.  Uses current.json as the task data.
    """
    with history_lock:
        td = latest_task_data
    if not td:
        return jsonify({"error": "No task data loaded — process an HTML file first"}), 400

    mock_eval = {
        "model_a_instruction_following": "Minor Issues",
        "model_a_completeness":          "No Issues",
        "model_a_factuality":            "Major Issues",
        "model_a_conciseness_relevance": "Minor Issues",
        "model_a_style_tone":            "No Issues",
        "model_a_overall_quality":       "Pretty Good",
        "model_b_instruction_following": "No Issues",
        "model_b_completeness":          "No Issues",
        "model_b_factuality":            "Minor Issues",
        "model_b_conciseness_relevance": "No Issues",
        "model_b_style_tone":            "Minor Issues",
        "model_b_overall_quality":       "Pretty Good",
        "which_response_is_better_a_vs_b": "Response B is slightly better",
        "explanation": "This is a test explanation for automated form filling. Both responses addressed the prompt adequately but Response B provided more grounded information.",
        "additional_comments": "",
    }
    threading.Thread(target=trigger_automation, args=(td, mock_eval), daemon=True).start()
    return jsonify({"ok": True, "commands_from": "mock evaluation", "keys": list(mock_eval.keys())})

@app.route("/api/scan", methods=["POST"])
def api_scan():
    """Ask the extension to scan all questions on the live page.
    
    Returns the full question map — useful for debugging what the
    extension can see vs what current.json contains.
    """
    import urllib.request as _ur
    try:
        # Trigger scan via reading-behavior server
        req = _ur.Request(
            'http://localhost:3004/trigger-scan',
            data=b'{}',
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        resp = _ur.urlopen(req, timeout=15)
        result = json.loads(resp.read().decode())
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/history/<int:task_id>", methods=["DELETE"])
def api_history_delete(task_id):
    with history_lock:
        task_history[:] = [t for t in task_history if (t.get("_meta") or {}).get("id") != task_id]
        for i, t in enumerate(task_history):
            t.setdefault("_meta", {})["id"] = i
        return jsonify({"ok": True, "remaining": len(task_history)})
# ── HTML Template ───────────────────────────────────────────────────────
HTML_TEMPLATE = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Task Evaluator</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#0c0c10;--surface:#151519;--surface-2:#1c1c24;--surface-3:#24242e;
    --border:#2a2a36;--border-hover:#3c3c50;
    --text:#dddde4;--text-dim:#6e6e82;--text-bright:#f4f4f8;
    --gold:#d4a853;--gold-dim:rgba(212,168,83,0.12);--gold-glow:rgba(212,168,83,0.25);
    --green:#5ec28b;--green-dim:rgba(94,194,139,0.12);
    --red:#d45c5c;--red-dim:rgba(212,92,92,0.12);
    --blue:#5c8ed4;--blue-dim:rgba(92,142,212,0.12);
    --cyan:#5cbfb6;--amber:#d4a040;--purple:#a07cd4;
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Manrope',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
  body::after{content:'';position:fixed;inset:0;background:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");pointer-events:none;z-index:0;}
  .header{position:sticky;top:0;z-index:100;padding:14px 24px;background:rgba(12,12,16,0.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
  .header-left{display:flex;align-items:center;gap:14px;}
  .logo{font-family:'Instrument Serif',serif;font-size:24px;color:var(--gold);letter-spacing:-0.5px;}  .status-pill{font-family:'DM Mono',monospace;font-size:11px;padding:5px 14px;border-radius:100px;border:1px solid var(--border);color:var(--text-dim);display:flex;align-items:center;gap:8px;transition:all 0.4s;}
  .status-pill[data-state="idle"] .dot{background:var(--text-dim);}
  .status-pill[data-state="extracting"] .dot,.status-pill[data-state="evaluating"] .dot{background:var(--gold);animation:blink 1s infinite;}
  .status-pill[data-state="complete"] .dot{background:var(--green);}
  .status-pill[data-state="error"] .dot{background:var(--red);}
  .dot{width:6px;height:6px;border-radius:50%;transition:background 0.3s;}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
  .header-right{display:flex;gap:10px;align-items:center;}
  .btn{font-family:'DM Mono',monospace;font-size:11px;padding:7px 16px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim);cursor:pointer;transition:all 0.2s;}
  .btn:hover{border-color:var(--gold);color:var(--gold);}
  .btn:active{transform:scale(0.97);}
  .hamburger{width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;transition:all 0.2s;}
  .hamburger:hover{border-color:var(--gold);color:var(--gold);}
  .main{position:relative;z-index:1;max-width:1000px;margin:0 auto;padding:32px 24px;}
  .empty{text-align:center;padding:100px 40px;animation:fadeUp 0.6s ease-out;}
  .empty .star{font-size:40px;opacity:0.3;margin-bottom:20px;}
  .empty h2{font-family:'Instrument Serif',serif;font-size:28px;color:var(--text-bright);margin-bottom:10px;}
  .empty p{font-size:14px;color:var(--text-dim);line-height:1.7;max-width:420px;margin:0 auto;}
  .empty kbd{font-family:'DM Mono',monospace;font-size:11px;background:var(--surface-2);padding:2px 8px;border-radius:4px;border:1px solid var(--border);color:var(--gold);}
  .spinner-block{display:flex;align-items:center;justify-content:center;gap:12px;padding:80px 0;color:var(--text-dim);font-size:14px;animation:fadeUp 0.4s ease-out;}
  .spinner-ring{width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0;}
  @keyframes fadeUp{0%{opacity:0;transform:translateY(16px)}100%{opacity:1;transform:translateY(0)}}
  @keyframes spin{to{transform:rotate(360deg)}}  .current-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;animation:cardIn 0.45s cubic-bezier(0.16,1,0.3,1);transition:border-color 0.3s;}
  .current-card:hover{border-color:var(--border-hover);}
  @keyframes cardIn{0%{opacity:0;transform:translateY(20px) scale(0.98)}100%{opacity:1;transform:none}}
  .card-header{padding:18px 22px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);}
  .card-header-left{display:flex;align-items:center;gap:14px;min-width:0;}
  .card-icon{width:36px;height:36px;border-radius:10px;background:var(--gold-dim);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .card-info h3{font-size:14px;font-weight:500;color:var(--text-bright);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:550px;}
  .card-info span{font-family:'DM Mono',monospace;font-size:11px;color:var(--text-dim);}
  .card-header-right{display:flex;align-items:center;gap:10px;flex-shrink:0;}
  .tag{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;padding:4px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:0.5px;}
  .tag-fresh{background:var(--blue-dim);color:var(--blue);}
  .tag-review{background:rgba(160,124,212,0.12);color:var(--purple);}
  .tag-tokens{background:var(--surface-3);color:var(--text-dim);}
  .card-body{padding:22px;}
  .ratings-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}
  @media(max-width:700px){.ratings-grid{grid-template-columns:1fr;}}
  .response-card{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px;}
  .response-card h4{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;color:var(--purple);margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;}
  .axis-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;}
  .axis-label{font-size:12px;color:var(--text-dim);}
  .axis-value{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;}
  .axis-value.no-issues{color:var(--green);}.axis-value.minor-issues{color:var(--amber);}.axis-value.major-issues{color:var(--red);}.axis-value.not-applicable{color:var(--text-dim);}
  .axis-value.amazing{color:var(--green);}.axis-value.pretty-good{color:var(--cyan);}.axis-value.okay{color:var(--amber);}.axis-value.pretty-bad{color:#d48040;}.axis-value.horrible{color:var(--red);}
  .overall-row{margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;}
  .overall-row .axis-label{font-weight:600;color:var(--text-bright);font-size:13px;}
  .overall-row .axis-value{font-size:13px;}  .comparative-bar{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px 20px;text-align:center;margin-bottom:16px;}
  .comparative-bar .label{font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;font-family:'DM Mono',monospace;}
  .comparative-bar .value{font-size:15px;font-weight:600;}
  .worker-review{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;}
  .worker-review h4{font-family:'DM Mono',monospace;font-size:11px;color:var(--gold);margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;}
  .wr-row{display:flex;gap:16px;margin-bottom:8px;}
  .wr-tag{font-family:'DM Mono',monospace;font-size:11px;padding:4px 10px;border-radius:6px;}
  .wr-tag.accurate{background:var(--green-dim);color:var(--green);}.wr-tag.mostly_accurate{background:rgba(212,168,83,0.12);color:var(--amber);}.wr-tag.inaccurate{background:var(--red-dim);color:var(--red);}
  .wr-tag.approve{background:var(--green-dim);color:var(--green);}.wr-tag.revise{background:rgba(212,168,83,0.12);color:var(--amber);}.wr-tag.reject{background:var(--red-dim);color:var(--red);}
  .wr-issues{margin-top:10px;list-style:none;}
  .wr-issues li{font-size:12px;color:var(--text);margin:4px 0;padding-left:12px;position:relative;line-height:1.6;}
  .wr-issues li::before{content:'→';position:absolute;left:0;color:var(--gold);}
  .justification{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:12px;}
  .justification h4{font-family:'DM Mono',monospace;font-size:11px;color:var(--gold);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;}
  .justification p{font-size:13px;line-height:1.75;color:var(--text);white-space:pre-wrap;word-wrap:break-word;}
  .card-actions{display:flex;gap:8px;margin-top:8px;}
  .card-actions .btn{font-size:10px;padding:5px 12px;}  .sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;opacity:0;pointer-events:none;transition:opacity 0.3s;}
  .sidebar-overlay.open{opacity:1;pointer-events:auto;}
  .sidebar{position:fixed;top:0;right:-380px;width:380px;height:100vh;background:var(--surface);border-left:1px solid var(--border);z-index:201;transition:right 0.35s cubic-bezier(0.16,1,0.3,1);display:flex;flex-direction:column;}
  .sidebar.open{right:0;}
  .sidebar-head{padding:18px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
  .sidebar-head h3{font-family:'Instrument Serif',serif;font-size:20px;color:var(--text-bright);}
  .sidebar-head .close-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;}
  .sidebar-head .close-btn:hover{color:var(--red);border-color:var(--red);}
  .sidebar-actions{padding:12px 20px;border-bottom:1px solid var(--border);flex-shrink:0;}
  .sidebar-list{flex:1;overflow-y:auto;padding:12px 20px;}
  .history-item{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;transition:border-color 0.2s;cursor:pointer;}
  .history-item:hover{border-color:var(--border-hover);}
  .history-item.active{border-color:var(--gold);}
  .hi-left{min-width:0;}
  .hi-left h4{font-size:12px;font-weight:500;color:var(--text-bright);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;}
  .hi-left span{font-family:'DM Mono',monospace;font-size:10px;color:var(--text-dim);}
  .hi-delete{width:28px;height:28px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--text-dim);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;transition:all 0.15s;}
  .hi-delete:hover{border-color:var(--red);color:var(--red);background:var(--red-dim);}
  .sidebar-empty{text-align:center;padding:40px 20px;color:var(--text-dim);font-size:13px;}
  ::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px;}
  .eval-table{width:100%;border-collapse:collapse;font-size:13px;}
  .eval-table th{font-family:'DM Mono',monospace;font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;padding:10px 14px;text-align:center;border-bottom:2px solid var(--border);background:var(--surface-2);}
  .eval-table th:first-child{text-align:left;}
  .eval-table td{padding:8px 14px;border-bottom:1px solid var(--border);text-align:center;vertical-align:middle;}
  .eval-table td.axis-name{text-align:left;color:var(--text);font-weight:500;white-space:nowrap;}
  .eval-table .tv{font-weight:600;font-size:13px;}
  .eval-table tr:hover{background:rgba(255,255,255,0.02);}
  .eval-table tr:last-child td{border-bottom:none;}
  .comp-badge{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 16px;text-align:center;min-width:160px;flex:1;}
  .cb-label{font-family:'DM Mono',monospace;font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px;}
  .cb-value{font-size:14px;font-weight:600;}
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo">⭐ Task Evaluator</div>
    <div class="status-pill" id="statusPill" data-state="idle"><div class="dot"></div><span id="statusText">Connecting...</span></div>
  </div>
  <div class="header-right">
    <button class="btn" onclick="evaluateNow()">▶ Evaluate Now</button>
    <button class="btn" onclick="fillForm()" id="fillBtn">⌨ Fill Form</button>
    <button class="btn" id="modelBadge">—</button>
    <button class="hamburger" onclick="toggleSidebar()" title="History">☰</button>
  </div>
</div>
<div class="main" id="mainContent">
  <div class="empty" id="emptyState">
    <div class="star">⭐</div>
    <h2>Task Evaluator</h2>
    <p>Drop a task HTML file into your Downloads folder, or click <kbd>▶ Evaluate Now</kbd> to process <kbd>current.json</kbd>.</p>
  </div>
  <div id="spinnerState" style="display:none">
    <div class="spinner-block"><div class="spinner-ring"></div><span id="spinnerText">Evaluating...</span></div>
  </div>
  <div id="currentTask"></div>
</div>
<div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleSidebar()"></div>
<div class="sidebar" id="sidebar">
  <div class="sidebar-head"><h3>History</h3><button class="close-btn" onclick="toggleSidebar()">✕</button></div>
  <div class="sidebar-actions"><button class="btn" style="width:100%" onclick="clearHistory()">🗑 Clear All History</button></div>
  <div class="sidebar-list" id="historyList"><div class="sidebar-empty" id="historyEmpty">No history yet.</div></div>
</div>
<script>
const emptyState=document.getElementById('emptyState'),spinnerState=document.getElementById('spinnerState'),spinnerText=document.getElementById('spinnerText'),currentTask=document.getElementById('currentTask'),statusPill=document.getElementById('statusPill'),statusText=document.getElementById('statusText'),modelBadge=document.getElementById('modelBadge'),sidebar=document.getElementById('sidebar'),sidebarOverlay=document.getElementById('sidebarOverlay'),historyList=document.getElementById('historyList'),historyEmpty=document.getElementById('historyEmpty');
let lastRenderedId=null,allTasks=[];

function prettyKey(k){return k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
function valColor(v){
  if(!v||typeof v!=='string')return'var(--text)';const l=v.toLowerCase();
  if(/no.?issues|amazing|excellent|accurate|approve|much better|^5/i.test(l))return'var(--green)';
  if(/pretty good|better|mostly|^4/i.test(l))return'var(--cyan)';
  if(/minor|okay|same|about|^3/i.test(l))return'var(--amber)';
  if(/major|pretty bad|worse|inaccurate|reject|^2|horrible|^1/i.test(l))return'var(--red)';
  if(/not.?applicable|n\/a/i.test(l))return'var(--text-dim)';
  return'var(--text)';
}

function renderEval(task){
  const ev=task.evaluation||{};let h='';
  if(ev.parse_error){h+=`<div class="justification"><h4>Raw Response</h4><p>${(ev.raw_response||task.raw_response||'').replace(/</g,'&lt;')}</p></div>`;return h;}
  // Smart grouping: detect if keys follow "model_X_axis" or "response_X" patterns, or are nested objects
  const entries=Object.entries(ev);
  // 1. Check for nested object structure (response_a:{...}, response_b:{...})
  const nestedModels={},flatModels={},comparatives=[],texts=[];
  for(const[k,v]of entries){
    // Skip empty/blank fields
    if(v===''||v===null||v===undefined)continue;
    if(typeof v==='string'&&v.trim()===''&&/comment|optional|additional/i.test(k))continue;
    if(v&&typeof v==='object'&&!Array.isArray(v)){nestedModels[k]=v;continue;}
    if(typeof v==='string'&&v.length>120){texts.push([k,v]);continue;}
    if(Array.isArray(v)){texts.push([k,v.join('\\n• ')]);continue;}
    // Check if flat key matches model_X_axis pattern
    const mm=k.match(/^(model_[a-z]|response_[a-z])_(.+)$/i);
    if(mm){const mk=mm[1],ax=mm[2];if(!flatModels[mk])flatModels[mk]={};flatModels[mk][ax]=v;continue;}
    // Check if it's a comparative (which_response, sxs, comparative, etc)
    if(/which|comparative|sxs|vs|better|preference/i.test(k)){comparatives.push([k,v]);continue;}
    // Short misc value
    if(typeof v==='string'&&v.length<=120)comparatives.push([k,v]);
  }
  // Merge nested and flat models
  const allModels={...nestedModels};
  for(const[mk,axes]of Object.entries(flatModels)){if(!allModels[mk])allModels[mk]={};Object.assign(allModels[mk],axes);}
  const modelKeys=Object.keys(allModels);
  // Render comparison table if we have models
  if(modelKeys.length>0){
    // Collect all axes across all models
    const allAxes=new Set();
    for(const axes of Object.values(allModels))for(const ak of Object.keys(axes)){if(typeof axes[ak]==='string'&&axes[ak].length<=120)allAxes.add(ak);}
    const axesList=[...allAxes];
    h+='<div style="overflow-x:auto;margin-bottom:16px"><table class="eval-table"><thead><tr><th>Axis</th>';
    for(const mk of modelKeys)h+=`<th>${prettyKey(mk)}</th>`;
    h+='</tr></thead><tbody>';
    for(const ax of axesList){
      h+=`<tr><td class="axis-name">${prettyKey(ax)}</td>`;
      for(const mk of modelKeys){const v=allModels[mk][ax]||'—';h+=`<td><span class="tv" style="color:${valColor(String(v))}">${v}</span></td>`;}
      h+='</tr>';
    }
    h+='</tbody></table></div>';
  }
  // Render comparatives
  if(comparatives.length){
    h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">';
    for(const[k,v]of comparatives){const sv=String(v);h+=`<div class="comp-badge"><div class="cb-label">${prettyKey(k)}</div><div class="cb-value" style="color:${valColor(sv)}">${sv}</div></div>`;}
    h+='</div>';
  }
  // Render long texts
  for(const[k,v]of texts)h+=`<div class="justification"><h4>${prettyKey(k)}</h4><p>${String(v).replace(/</g,'&lt;')}</p></div>`;
  return h;
}
function renderCurrent(t){
  const m=t._meta||{},tt=t.task_type||'fresh',u=t.usage||{};
  let tok='';if(u.input_tokens)tok=`${(u.input_tokens/1000).toFixed(1)}k in / ${(u.output_tokens/1000).toFixed(1)}k out`;
  currentTask.innerHTML=`<div class="current-card"><div class="card-header"><div class="card-header-left"><div class="card-icon">⭐</div><div class="card-info"><h3>${t.title||m.filename||'Task'}</h3><span>${m.timestamp||''}</span></div></div><div class="card-header-right"><span class="tag tag-${tt}">${tt}</span>${tok?`<span class="tag tag-tokens">${tok}</span>`:''}</div></div><div class="card-body">${renderEval(t)}<div class="card-actions"><button class="btn" onclick="copyText('just')">📋 Copy Justification</button><button class="btn" onclick="copyText('json')">📋 Copy JSON</button></div></div></div>`;
}

function renderHistory(){
  historyList.querySelectorAll('.history-item').forEach(e=>e.remove());
  if(!allTasks.length){historyEmpty.style.display='';return;}
  historyEmpty.style.display='none';
  const cur=allTasks.length?allTasks[allTasks.length-1]._meta?.id:null;
  [...allTasks].reverse().forEach(t=>{
    const m=t._meta||{},el=document.createElement('div');
    el.className='history-item'+(m.id===cur?' active':'');
    el.innerHTML=`<div class="hi-left" onclick="loadItem(${m.id})"><h4>${t.title||m.filename||'Task'}</h4><span>${m.timestamp||''}</span></div><button class="hi-delete" onclick="event.stopPropagation();delItem(${m.id})" title="Delete">✕</button>`;
    historyList.appendChild(el);
  });
}

window.toggleSidebar=function(){sidebar.classList.toggle('open');sidebarOverlay.classList.toggle('open');};
window.evaluateNow=function(){fetch('/api/evaluate',{method:'POST'});};
window.fillForm=function(){const b=document.getElementById('fillBtn');const o=b.textContent;b.textContent='Sending...';fetch('/api/fill-form',{method:'POST'}).then(r=>r.json()).then(d=>{b.textContent=d.ok?'✓ Sent':'✗ Error';setTimeout(()=>b.textContent=o,2000);}).catch(()=>{b.textContent='✗ Error';setTimeout(()=>b.textContent=o,2000);});};
window.copyText=function(type){fetch('/api/current').then(r=>r.json()).then(t=>{if(!t)return;let txt;if(type==='json'){txt=JSON.stringify(t.evaluation||{},null,2);}else{const ev=t.evaluation||{};const texts=[];for(const[k,v]of Object.entries(ev)){if(typeof v==='string'&&v.length>80)texts.push(v);if(Array.isArray(v))texts.push(v.join('\\n'));}txt=texts.join('\\n\\n')||t.raw_response||'';}navigator.clipboard.writeText(txt).then(()=>{const btns=document.querySelectorAll('.card-actions .btn');const b=type==='json'?btns[1]:btns[0];if(b){const o=b.textContent;b.textContent='✓ Copied';setTimeout(()=>b.textContent=o,1200);}});});};
window.loadItem=function(id){const t=allTasks.find(x=>(x._meta||{}).id===id);if(t){renderCurrent(t);renderHistory();}toggleSidebar();};
window.delItem=function(id){fetch(`/api/history/${id}`,{method:'DELETE'}).then(()=>poll());};
window.clearHistory=function(){fetch('/api/history/clear',{method:'POST'}).then(()=>poll());};
function poll(){
  fetch('/api/status').then(r=>r.json()).then(d=>{
    statusPill.dataset.state=d.status.state;statusText.textContent=d.status.message;modelBadge.textContent=d.model;
    if(d.status.state==='evaluating'||d.status.state==='extracting'){spinnerState.style.display='';spinnerText.textContent=d.status.message;emptyState.style.display='none';}
    else{spinnerState.style.display='none';}
  }).catch(()=>{});
  fetch('/api/tasks').then(r=>r.json()).then(tasks=>{
    allTasks=tasks.reverse();
    if(!allTasks.length){emptyState.style.display='';currentTask.innerHTML='';renderHistory();return;}
    emptyState.style.display='none';
    const latest=allTasks[allTasks.length-1],lid=(latest._meta||{}).id;
    if(lid!==lastRenderedId){renderCurrent(latest);lastRenderedId=lid;}
    renderHistory();
  }).catch(()=>{});
}
setInterval(poll,2000);poll();
</script>
</body>
</html>'''

# ── Main ────────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]
    if "--dry-run" in args:
        print("🧪 Dry run mode\n")
        result = evaluate(dry_run=True)
        if "error" in result: print(f"❌ {result['error']}"); sys.exit(1)
        result_file = SCRIPT_DIR / "result.json"
        with open(result_file, "w", encoding="utf-8") as f: json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"💾 Saved to result.json")
        print(f"Task type: {result['task_type']}")
        print(f"System prompt: {result['system_prompt_length']:,} chars")
        print(f"User prompt: {result['user_prompt_length']:,} chars")
        return
    if "--once" in args:
        result = evaluate()
        if "error" in result: print(f"❌ {result['error']}"); sys.exit(1)
        result_file = SCRIPT_DIR / "result.json"
        with open(result_file, "w", encoding="utf-8") as f: json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"💾 Saved to result.json")
        usage = result.get("usage", {})
        print(f"Model: {result.get('model_used', '?')}")
        print(f"Tokens: {usage.get('input_tokens', 0):,} in / {usage.get('output_tokens', 0):,} out")
        result["_meta"] = {"filename":"manual","timestamp":datetime.now().strftime("%Y-%m-%d %H:%M:%S"),"id":0}
        task_history.append(result)
        current_status["state"] = "complete"
        current_status["message"] = "Evaluation complete"
        threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
        log = logging.getLogger("werkzeug"); log.setLevel(logging.WARNING)
        app.run(host="127.0.0.1", port=PORT, debug=False)
        return
    # ── Default: Watch mode + auto-evaluate + web UI ──
    no_eval = "--no-eval" in args
    handler = TaskFileHandler(auto_evaluate=not no_eval)
    observer = Observer()
    observer.schedule(handler, str(DOWNLOADS_DIR), recursive=False)
    observer.start()

    # Pre-load current.json if it exists so /api/test-fill works immediately
    global latest_task_data
    cj = SCRIPT_DIR / "current.json"
    if cj.exists() and latest_task_data is None:
        try:
            with open(cj, "r", encoding="utf-8") as f:
                latest_task_data = json.load(f)
            nq = len(latest_task_data.get("questions", []))
            print(f"📂 Pre-loaded current.json ({nq} questions)")
        except Exception as e:
            print(f"⚠  Could not pre-load current.json: {e}")

    mode = "watch only" if no_eval else "watch + auto-evaluate"
    print(f"⭐ Task Evaluator ({mode})")
    print(f"   Model: {STYX_MODEL}")
    print(f"   Watching: {DOWNLOADS_DIR}")
    print(f"   UI: http://localhost:{PORT}")
    print(f"   Press Ctrl+C to stop.\n")
    threading.Timer(1.5, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    try:
        log = logging.getLogger("werkzeug"); log.setLevel(logging.WARNING)
        app.run(host="127.0.0.1", port=PORT, debug=False)
    except KeyboardInterrupt: pass
    finally:
        observer.stop(); observer.join()
        print("\n👋 Stopped.")

if __name__ == "__main__":
    main()