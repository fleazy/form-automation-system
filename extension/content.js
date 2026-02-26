let isAtBottom = false;
let formFieldsDetected = false;

// ── DOM change logger ─────────────────────────────────────────────────
// Watches all radio/checkbox/textarea changes and logs them to the server
// so we can see exactly what the automation is (or isn't) doing.
(function initDOMChangeLogger() {
  // Listen for input change events (radio, checkbox)
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.type === 'radio' || el.type === 'checkbox') {
      const qdiv = el.closest('div[data-question-id]');
      const label = el.closest('label');
      const info = {
        event: 'change',
        type: el.type,
        checked: el.checked,
        labelText: label ? label.textContent.trim().substring(0, 60) : '',
        questionId: qdiv ? qdiv.getAttribute('data-question-id').substring(0, 8) : '??',
        questionLabel: qdiv ? (qdiv.getAttribute('data-label') || '') : '',
        timestamp: Date.now(),
      };
      console.log(`🔄 DOM change: [${info.questionLabel}] ${info.type} → "${info.labelText}" checked=${info.checked}`);
      fetch('http://localhost:3004/dom-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info)
      }).catch(() => {});
    }
  }, { capture: true });

  // Listen for textarea input
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.tagName === 'TEXTAREA') {
      const qdiv = el.closest('div[data-question-id]');
      const info = {
        event: 'input',
        type: 'textarea',
        valueLength: el.value.length,
        valueTrunc: el.value.substring(0, 80),
        questionId: qdiv ? qdiv.getAttribute('data-question-id').substring(0, 8) : '??',
        questionLabel: qdiv ? (qdiv.getAttribute('data-label') || '') : '',
        timestamp: Date.now(),
      };
      console.log(`🔄 DOM input: [${info.questionLabel}] textarea len=${info.valueLength}`);
      fetch('http://localhost:3004/dom-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info)
      }).catch(() => {});
    }
  }, { capture: true });
})();

function checkScrollPosition() {
  const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const windowHeight = window.innerHeight;
  
  const atBottom = currentScrollY + windowHeight >= scrollHeight - 10;
  
  if (atBottom && !isAtBottom) {
    isAtBottom = true;
    fetch('http://localhost:3004/bottom-reached', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'BOTTOM_REACHED' })
    }).catch(() => {});
  } else if (!atBottom) {
    isAtBottom = false;
  }
}

function detectFormFields() {
  if (formFieldsDetected) return;
  
  const selectors = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"])',
    'textarea',
    'select'
  ];
  
  const fields = [];
  const allElements = [];
  
  selectors.forEach(selector => {
    try {
      allElements.push(...document.querySelectorAll(selector));
    } catch (e) {}
  });
  
  const uniqueElements = [...new Set(allElements)];
  
  uniqueElements.forEach((el, i) => {
    try {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      
      if (rect.width === 0 || rect.height === 0 || 
          style.display === 'none' || style.visibility === 'hidden') return;
      
      // Skip Google Forms editor elements (form creation fields)
      if (el.id && (el.id.startsWith('hj99tb') || el.id.includes('title'))) return;
      if (el.getAttribute('aria-label') && el.getAttribute('aria-label').includes('Question')) return;
      if (el.closest('[data-params*="formTitle"]') || el.closest('[data-params*="formDescription"]')) return;
      
      const tag = el.tagName.toLowerCase();
      const type = el.type || tag;
      const name = el.name || '';
      const id = el.id || '';
      const placeholder = el.placeholder || el.getAttribute('aria-label') || '';
      
      let selector = '';
      if (name) selector = `${tag}[name="${name}"]`;
      else if (id) selector = `#${id}`;
      else selector = `${tag}:nth-of-type(${i + 1})`;
      
      const context = [
        el.textContent || '',
        placeholder,
        el.className || '',
        id,
        name
      ].join(' ').toLowerCase();
      
      let fieldType = 'text';
      if (context.includes('email')) fieldType = 'email';
      else if (context.includes('phone') || context.includes('tel')) fieldType = 'tel';
      else if (context.includes('name') && !context.includes('username')) fieldType = 'name';
      else if (context.includes('message') || context.includes('comment')) fieldType = 'textarea';
      else if (context.includes('address')) fieldType = 'address';
      else if (context.includes('company')) fieldType = 'company';
      else if (context.includes('website') || context.includes('url')) fieldType = 'url';
      else if (type === 'radio') fieldType = 'radio';
      else if (type === 'checkbox') fieldType = 'checkbox';
      else if (tag === 'select') fieldType = 'select';
      
      // Use viewport coordinates instead of document coordinates
      // and ensure they're within reasonable bounds for automation
      const viewportX = Math.round(rect.left + rect.width/2);
      const viewportY = Math.round(rect.top + rect.height/2);
      
      const windowX = window.screenX || window.screenLeft || 0;
      const windowY = window.screenY || window.screenTop || 0;

      // outerHeight - innerHeight gives the exact browser chrome height
      // (tabs + address bar + bookmarks bar) regardless of zoom or OS scaling
      const chromeOffset = window.outerHeight - window.innerHeight;

      const absoluteX = windowX + viewportX;
      const absoluteY = windowY + viewportY + chromeOffset;
      
      
      fields.push({
        type: fieldType,
        inputType: type,
        name: name,
        id: id,
        selector: selector,
        placeholder: placeholder || `Field ${i + 1}`,
        x: absoluteX,
        y: absoluteY,
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    } catch (e) {}
  });
  
  if (fields.length > 0) {
    formFieldsDetected = true;
    fetch('http://localhost:3004/form-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        type: 'FORM_FIELDS_DETECTED',
        url: window.location.href,
        fields: fields
      })
    }).catch(() => {});
  }
}

// Poll for coord requests from the server. When automation is about to click
// a field, it posts a request here. We scroll the element into view and
// return fresh coordinates right at that moment.
function pollForCoordRequests() {
  fetch('http://localhost:3004/coord-request')
    .then(r => r.json())
    .then(data => {
      if (!data || !data.selector) return;

      // CLICK_OPTION path: selector = container div, labelText = option text to find
      // Finds the label whose text matches, returns its input's state + label's coords.
      let el = document.querySelector(data.selector);
      if (!el) {
        fetch('http://localhost:3004/coord-response', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: data.requestId, found: false })
        }).catch(() => {});
        return;
      }

      let clickTarget = el;

      if (data.labelText) {
        // Find the label inside the container whose text matches
        const needle = data.labelText.trim().toLowerCase();
        const labels = Array.from(el.querySelectorAll('label, [role="radio"], [role="option"]'));
        const matched = labels.find(l => l.textContent.trim().toLowerCase().includes(needle));
        if (matched) {
          clickTarget = matched;
          // Resolve the actual input inside for state reporting
          el = matched.querySelector('input[type="radio"], input[type="checkbox"]') || matched;
        } else {
          // Label text not found — report not found so server can log it
          fetch('http://localhost:3004/coord-response', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: data.requestId, found: false, reason: 'label text not found: ' + data.labelText })
          }).catch(() => {});
          return;
        }
      } else {
        // For checkboxes and radios the input itself is tiny (~18px).
        // Prefer clicking an associated <label> — it's always much larger and
        // works on any site without any HTML changes needed.
        // Priority: label[for=id] > parent <label> > the input itself.
        if (el.type === 'checkbox' || el.type === 'radio') {
          const labelFor = el.id
            ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
            : null;
          const parentLabel = el.closest('label');
          clickTarget = labelFor || parentLabel || el;
        }
      }

      // Report element position WITHOUT scrolling — server handles scrolling via Pico
      setTimeout(() => {
        const rect = clickTarget.getBoundingClientRect();
        const windowX = window.screenX || window.screenLeft || 0;
        const windowY = window.screenY || window.screenTop || 0;
        const chromeOffset = window.outerHeight - window.innerHeight;
        const vH = window.innerHeight;
        const inViewport = rect.top >= 0 && rect.bottom <= vH && rect.width > 0;

        const absX = windowX + Math.round(rect.left + rect.width / 2);
        const absY = windowY + Math.round(rect.top + rect.height / 2) + chromeOffset;
        console.log(`📍 coord-response: sel="${data.selector?.substring(0,30)}" label="${data.labelText||''}" → clickTarget=${clickTarget.tagName} rect=(${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}) abs=(${absX},${absY}) cursor=(${liveCursorX},${liveCursorY}) checked=${el.checked} inView=${inViewport} winPos=(${windowX},${windowY}) chrome=${chromeOffset}`);
        // Exact pixel delta that scrollIntoView({block:'center'}) would scroll
        const elementAbsTop = rect.top + window.scrollY;
        const targetScrollY = elementAbsTop + rect.height / 2 - vH / 2;
        const scrollDeltaNeeded = Math.round(targetScrollY - window.scrollY);
        fetch('http://localhost:3004/coord-response', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: data.requestId,
            selector: data.selector,
            x: windowX + Math.round(rect.left + rect.width / 2),
            y: windowY + Math.round(rect.top + rect.height / 2) + chromeOffset,
            cursorX: liveCursorX,
            cursorY: liveCursorY,
            value:     el.value   !== undefined ? el.value   : '',
            checked:   el.checked !== undefined ? el.checked : null,
            focused:   document.activeElement === el,
            tagName:   el.tagName.toLowerCase(),
            inputType: el.type || el.tagName.toLowerCase(),
            found: true,
            inViewport,
            viewportTop: Math.round(rect.top),
            viewportH: Math.round(vH),
            scrollDeltaNeeded,
            vpLeft: windowX,
            vpTop: windowY + chromeOffset,
            vpRight: windowX + window.innerWidth,
            vpBottom: windowY + chromeOffset + window.innerHeight
          })
        }).catch(() => {});
      }, 50);
    })
    .catch(() => {});
}

// Track the real cursor position locally on every mousemove (unthrottled).
// This is what we include in coord-responses so the server gets both the
// target element position AND the cursor's actual position in the same message,
// eliminating the race condition where currentPosition on the server is stale.
let liveCursorX = 0;
let liveCursorY = 0;

// Track which element the cursor is currently over.
// The browser fires mouseover for Pico-driven moves too, so this is always
// accurate — the server can use it to verify the cursor landed on the right element.
let hoveredId   = '';
let hoveredName = '';
window.addEventListener('mouseover', (e) => {
  hoveredId   = e.target.id                   || '';
  hoveredName = e.target.getAttribute('name') || '';
  // Use a separate endpoint so this NEVER touches currentPosition on the server.
  // If we piggybacked on /cursor-position, a stale liveCursorX/Y=0 would corrupt
  // the server's position estimate and break subsequent moves.
  fetch('http://localhost:3004/cursor-hover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hoveredId, hoveredName })
  }).catch(() => {});
}, { passive: true });

// Report real cursor position to the server on mousemove.
// The browser fires these for Pico-driven movements too, so
// currentPosition on the server stays accurate without calibration.
let lastCursorReport = 0;
window.addEventListener('mousemove', (e) => {
  const windowX = window.screenX || window.screenLeft || 0;
  const windowY = window.screenY || window.screenTop || 0;
  const chromeOffset = window.outerHeight - window.innerHeight;

  // Always update the local snapshot — no throttle on this
  liveCursorX = windowX + Math.round(e.clientX);
  liveCursorY = windowY + Math.round(e.clientY) + chromeOffset;

  // Throttle the network report to ~12/sec to avoid flooding the server
  const now = Date.now();
  if (now - lastCursorReport < 80) return;
  lastCursorReport = now;

  fetch('http://localhost:3004/cursor-position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x: liveCursorX, y: liveCursorY, hoveredId, hoveredName,
      // Viewport bounds in absolute screen coords so server can clamp mouse
      vpLeft: windowX,
      vpTop: windowY + chromeOffset,
      vpRight: windowX + window.innerWidth,
      vpBottom: windowY + chromeOffset + window.innerHeight
    })
  }).catch(() => {});
}, { passive: true });

// Also update liveCursorX/Y on click events. JavaScript has no API to read
// the cursor position without a mouse event — if the user clicks a button
// without having moved the mouse first, liveCursorX/Y would be stuck at 0.
// Capturing click ensures it's always accurate when automation starts.
window.addEventListener('click', (e) => {
  const windowX = window.screenX || window.screenLeft || 0;
  const windowY = window.screenY || window.screenTop || 0;
  const chromeOffset = window.outerHeight - window.innerHeight;
  liveCursorX = windowX + Math.round(e.clientX);
  liveCursorY = windowY + Math.round(e.clientY) + chromeOffset;
}, { passive: true });

// ── Bulk question scanner ─────────────────────────────────────────────
// Polls /scan-request.  When a request arrives, scans every
// div[data-question-id] on the page, gathering position, viewport
// visibility, current checked/value state, and option labels.
function pollForScanRequests() {
  fetch('http://localhost:3004/scan-request')
    .then(r => r.json())
    .then(data => {
      if (!data || !data.requestId) return;

      const windowX = window.screenX || window.screenLeft || 0;
      const windowY = window.screenY || window.screenTop || 0;
      const chromeOffset = window.outerHeight - window.innerHeight;
      const vH = window.innerHeight;
      const vW = window.innerWidth;

      const questions = [];
      document.querySelectorAll('div[data-question-id]').forEach(qdiv => {
        const uuid = qdiv.getAttribute('data-question-id');
        if (!uuid) return;

        const rect = qdiv.getBoundingClientRect();
        const inViewport = rect.top >= -50 && rect.bottom <= vH + 50 && rect.width > 0;

        // Determine question type and current state
        const radios = qdiv.querySelectorAll('input[type="radio"]');
        const checkboxes = qdiv.querySelectorAll('input[type="checkbox"]');
        const textarea = qdiv.querySelector('textarea');
        let qType = 'unknown';
        let checkedLabel = null;
        let value = '';
        const labels = [];

        if (radios.length > 0) {
          qType = 'radio';
          radios.forEach(r => {
            const lbl = r.closest('label');
            const labelText = lbl ? lbl.textContent.trim() : '';
            labels.push(labelText);
            if (r.checked) checkedLabel = labelText;
          });
        } else if (checkboxes.length > 0) {
          qType = 'checkbox';
          checkboxes.forEach(cb => {
            const lbl = cb.closest('label');
            const labelText = lbl ? lbl.textContent.trim() : '';
            labels.push(labelText);
            if (cb.checked) checkedLabel = labelText;
          });
        } else if (textarea) {
          qType = 'textarea';
          value = textarea.value || '';
        }

        // For visible elements, compute absolute click coordinates (center of the
        // first radio/checkbox label, or center of textarea)
        let absX = 0, absY = 0;
        if (inViewport) {
          let target = null;
          if (radios.length > 0) {
            // Use the first radio's label as reference point
            const firstLabel = radios[0].closest('label');
            target = firstLabel || radios[0];
          } else if (checkboxes.length > 0) {
            const firstLabel = checkboxes[0].closest('label');
            target = firstLabel || checkboxes[0];
          } else if (textarea) {
            target = textarea;
          }
          if (target) {
            const tRect = target.getBoundingClientRect();
            absX = windowX + Math.round(tRect.left + tRect.width / 2);
            absY = windowY + Math.round(tRect.top + tRect.height / 2) + chromeOffset;
          }
        }

        questions.push({
          uuid,
          selector: `div[data-question-id="${uuid}"]`,
          label: qdiv.getAttribute('data-label') || '',
          type: qType,
          inViewport,
          checkedLabel,
          value,
          labels,
          x: absX,
          y: absY,
          viewportTop: Math.round(rect.top),
        });
      });

      fetch('http://localhost:3004/scan-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: data.requestId,
          questions,
          total: questions.length,
          visible: questions.filter(q => q.inViewport).length,
          vpLeft: windowX,
          vpTop: windowY + chromeOffset,
          vpRight: windowX + vW,
          vpBottom: windowY + chromeOffset + vH,
          cursorX: liveCursorX,
          cursorY: liveCursorY,
        })
      }).catch(() => {});
    })
    .catch(() => {});
}

setInterval(pollForCoordRequests, 300);
setInterval(pollForScanRequests, 500);

// ── DOM Change Logger ─────────────────────────────────────────────────
// Watches all radio/checkbox inputs inside question divs and logs state
// changes to console + POSTs to reading-behavior server for debugging.
(function initDomChangeLogger() {
  const qDivs = document.querySelectorAll('div[data-question-id]');
  qDivs.forEach(qdiv => {
    const uuid = qdiv.getAttribute('data-question-id');
    const label = qdiv.getAttribute('data-label') || qdiv.id || uuid.substring(0, 8);
    qdiv.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', () => {
        const lbl = input.closest('label');
        const optText = lbl ? lbl.textContent.trim() : input.value;
        const msg = `🔔 DOM: [${label}] ${input.type} → "${optText}" checked=${input.checked}`;
        console.log(msg);
        fetch('http://localhost:3004/dom-change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid, label, type: input.type, option: optText, checked: input.checked, ts: Date.now() })
        }).catch(() => {});
      });
    });
    const ta = qdiv.querySelector('textarea');
    if (ta) {
      let debounce;
      ta.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const msg = `🔔 DOM: [${label}] textarea value="${ta.value.substring(0, 80)}..."`;
          console.log(msg);
          fetch('http://localhost:3004/dom-change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid, label, type: 'textarea', value: ta.value.substring(0, 200), ts: Date.now() })
          }).catch(() => {});
        }, 300);
      });
    }
  });
  console.log(`🔔 DOM change logger active on ${qDivs.length} question divs`);
})();

// Press F to start queued automation
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    const tag = document.activeElement && document.activeElement.tagName;
    // Don't intercept F when typing in a text field
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
    fetch('http://localhost:3004/start', { method: 'POST' }).catch(() => {});
  }
});

window.addEventListener('scroll', checkScrollPosition, { passive: true });
window.addEventListener('load', () => setTimeout(detectFormFields, 1000), { passive: true });
if (document.readyState === 'complete') setTimeout(detectFormFields, 1000);
checkScrollPosition();