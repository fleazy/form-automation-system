#!/usr/bin/env python3
"""
Generic Task Extractor — Parses saved SingleFile HTML files from 
data annotation platforms. Extracts everything it finds with zero 
assumptions about layout, number of responses, or rating axes.

Usage:
  python3 extract_task.py <file.html>
  python3 extract_task.py <file.html> -o output.json
"""

import sys
import json
import re
import glob
from pathlib import Path
from bs4 import BeautifulSoup, Comment


def extract_from_html(filepath: str) -> dict:
    """Extract all task data generically from any annotation HTML file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        html = f.read()

    soup = BeautifulSoup(html, 'lxml')

    result = {
        'file': str(filepath),
        'title': '',
        'conversation_parts': [],
        'questions': [],
        'download_links': [],
        'instructions': [],
    }

    # --- Page title ---
    title_tag = soup.find('title')
    if title_tag:
        result['title'] = title_tag.get_text(strip=True)
    # ── 1. CONVERSATION / RESPONSE CONTENT ──────────────────────────────
    # Grab all rendered-markdown sections (the actual prompt + responses)
    markdown_sections = soup.find_all(class_='rendered-markdown')
    for i, section in enumerate(markdown_sections):
        text = section.get_text(separator='\n', strip=True)
        if text and len(text) > 10:
            result['conversation_parts'].append({
                'index': i,
                'text': text[:8000],  # generous limit
            })

    # ── 2. QUESTIONS — generic extraction via data-label / data-question-id
    # Each question block: div[id^="question-"][data-question-id]
    question_divs = soup.find_all('div', id=re.compile(r'^question-\d+'))
    for qdiv in question_divs:
        q_id = qdiv.get('data-question-id', '')
        q_label = qdiv.get('data-label', '')
        q_num = qdiv.get('id', '').replace('question-', '')

        # Get the question text from gondor-wysiwyg inside it
        q_text_el = qdiv.find(attrs={'data-testid': 'question-text'})
        q_text = q_text_el.get_text(separator='\n', strip=True) if q_text_el else ''

        question = {
            'number': q_num,
            'id': q_id,
            'label': q_label,
            'text': q_text[:2000],
            'type': 'unknown',
            'options': [],
            'selected': None,
        }
        # Check for radio buttons in this question
        radios = qdiv.find_all('input', attrs={'type': 'radio'})
        if radios:
            question['type'] = 'radio'
            for radio in radios:
                label_el = radio.find_parent('label')
                label_text = label_el.get_text(strip=True) if label_el else ''
                is_checked = radio.has_attr('checked')
                opt = {
                    'value': radio.get('value', ''),
                    'label': label_text,
                    'checked': is_checked,
                }
                question['options'].append(opt)
                if is_checked:
                    question['selected'] = label_text

        # Check for checkboxes
        checkboxes = qdiv.find_all('input', attrs={'type': 'checkbox'})
        if checkboxes and not radios:
            question['type'] = 'checkbox'
            for cb in checkboxes:
                label_el = cb.find_parent('label')
                label_text = label_el.get_text(strip=True) if label_el else ''
                is_checked = cb.has_attr('checked')
                opt = {
                    'value': cb.get('value', ''),
                    'label': label_text,
                    'checked': is_checked,
                }
                question['options'].append(opt)
                if is_checked:
                    if question['selected'] is None:
                        question['selected'] = []
                    question['selected'].append(label_text)

        # Check for textareas
        ta = qdiv.find('textarea')
        if ta:
            question['type'] = 'textarea'
            question['value'] = ta.get_text(strip=True)

        # Check for select dropdowns
        sel = qdiv.find('select')
        if sel:
            question['type'] = 'select'
            for opt_el in sel.find_all('option'):
                opt = {
                    'value': opt_el.get('value', ''),
                    'label': opt_el.get_text(strip=True),
                    'selected': opt_el.has_attr('selected'),
                }
                question['options'].append(opt)
                if opt_el.has_attr('selected'):
                    question['selected'] = opt_el.get_text(strip=True)

        result['questions'].append(question)
    # ── 3. FALLBACK: catch any radio/checkbox/textarea NOT inside question divs
    # (some layouts don't use question-N divs)
    found_q_ids = {q['id'] for q in result['questions']}
    orphan_radios = {}
    for radio in soup.find_all('input', attrs={'type': 'radio'}):
        # Skip if already captured in a question div
        parent_q = radio.find_parent('div', id=re.compile(r'^question-\d+'))
        if parent_q:
            continue
        name = radio.get('name', 'unnamed')
        if name not in orphan_radios:
            orphan_radios[name] = {'type': 'radio', 'label': name, 'options': [], 'selected': None}
        label_el = radio.find_parent('label')
        label_text = label_el.get_text(strip=True) if label_el else ''
        is_checked = radio.has_attr('checked')
        orphan_radios[name]['options'].append({'value': radio.get('value',''), 'label': label_text, 'checked': is_checked})
        if is_checked:
            orphan_radios[name]['selected'] = label_text
    for name, q in orphan_radios.items():
        result['questions'].append({'number': f'orphan-{name[:8]}', 'id': name, 'label': name, 'text': '', **q})

    # Orphan textareas
    for ta in soup.find_all('textarea'):
        parent_q = ta.find_parent('div', id=re.compile(r'^question-\d+'))
        if parent_q:
            continue
        text = ta.get_text(strip=True)
        if text:
            result['questions'].append({
                'number': 'orphan-ta', 'id': ta.get('name', ''), 'label': ta.get('placeholder', 'textarea'),
                'text': '', 'type': 'textarea', 'value': text, 'options': [], 'selected': None,
            })
    # ── 4. DOWNLOAD LINKS ───────────────────────────────────────────────
    # Any <a> with href containing download/export/attachment/file patterns
    # Also any <a> with explicit download attribute
    for a in soup.find_all('a', href=True):
        href = a['href']
        text = a.get_text(strip=True)
        has_download_attr = a.has_attr('download')
        is_download_url = bool(re.search(r'download|export|attachment|\.zip|\.tar|\.pdf|\.csv|\.json', href, re.I))
        # Also catch buttons styled as links with download-like text
        is_download_text = bool(re.search(r'download|export|save|get file', text, re.I))

        if has_download_attr or is_download_url or is_download_text:
            result['download_links'].append({
                'text': text[:200],
                'href': href[:500],
                'has_download_attr': has_download_attr,
            })

    # Also check buttons with onclick that might trigger downloads
    for btn in soup.find_all('button'):
        text = btn.get_text(strip=True)
        onclick = btn.get('onclick', '')
        if re.search(r'download|export', text, re.I) or re.search(r'download|export', onclick, re.I):
            result['download_links'].append({
                'text': text[:200],
                'href': onclick[:500] if onclick else '',
                'has_download_attr': False,
            })

    # ── 5. INSTRUCTIONS / RUBRIC CONTENT ────────────────────────────────
    # Grab all gondor-wysiwyg sections (instruction blocks)
    wysiwyg_sections = soup.find_all(class_='gondor-wysiwyg')
    for section in wysiwyg_sections:
        text = section.get_text(separator='\n', strip=True)
        if text and len(text) > 20:
            result['instructions'].append(text[:10000])

    # ── 6. TABLES (rating summaries, rubrics, etc) ──────────────────────
    tables = soup.find_all('table')
    extracted_tables = []
    for table in tables:
        rows = table.find_all('tr')
        table_data = []
        headers = []
        for i, row in enumerate(rows):
            cells = row.find_all(['th', 'td'])
            cell_texts = [c.get_text(strip=True) for c in cells]
            if i == 0:
                headers = cell_texts
            else:
                if headers and len(headers) == len(cell_texts):
                    table_data.append(dict(zip(headers, cell_texts)))
                else:
                    table_data.append(cell_texts)
        if table_data:
            extracted_tables.append({'headers': headers, 'rows': table_data})
    if extracted_tables:
        result['tables'] = extracted_tables
    # ── 7. HIGHLIGHTED / SELECTED indicators ────────────────────────────
    selected_els = soup.find_all(class_=re.compile(r'tw-text-blue-600|tw-bg-blue-600|tw-bg-primary'))
    highlights = []
    for el in selected_els:
        text = el.get_text(strip=True)
        if text and len(text) < 200 and text not in highlights:
            highlights.append(text)
    if highlights:
        result['highlighted_items'] = highlights

    # Clean up empty fields
    result = {k: v for k, v in result.items() if v}

    return result


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    files = []
    output_file = None
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == '-o' and i + 1 < len(sys.argv):
            output_file = sys.argv[i + 1]
            i += 2
        else:
            expanded = glob.glob(sys.argv[i])
            files.extend(expanded if expanded else [sys.argv[i]])
            i += 1

    results = []
    for filepath in files:
        if not Path(filepath).exists():
            print(f"⚠️  Not found: {filepath}", file=sys.stderr)
            continue
        print(f"📄 Processing: {filepath}", file=sys.stderr)
        try:
            result = extract_from_html(filepath)
            results.append(result)
            nq = len(result.get('questions', []))
            nc = len(result.get('conversation_parts', []))
            nd = len(result.get('download_links', []))
            sel = sum(1 for q in result.get('questions', []) if q.get('selected'))
            print(f"   {nc} content sections, {nq} questions ({sel} answered), {nd} downloads", file=sys.stderr)
        except Exception as e:
            print(f"❌ Error: {e}", file=sys.stderr)

    output = results[0] if len(results) == 1 else results
    out_path = output_file or 'current.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"✅ Saved to {out_path}", file=sys.stderr)


if __name__ == '__main__':
    main()