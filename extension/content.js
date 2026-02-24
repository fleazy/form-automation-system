let isAtBottom = false;
let formFieldsDetected = false;

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

      const el = document.querySelector(data.selector);
      if (!el) {
        fetch('http://localhost:3004/coord-response', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: data.requestId, found: false })
        }).catch(() => {});
        return;
      }

      // For checkboxes and radios the input itself is tiny (~18px).
      // Prefer clicking an associated <label> — it's always much larger and
      // works on any site without any HTML changes needed.
      // Priority: label[for=id] > parent <label> > the input itself.
      let clickTarget = el;
      if (el.type === 'checkbox' || el.type === 'radio') {
        const labelFor = el.id
          ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
          : null;
        const parentLabel = el.closest('label');
        clickTarget = labelFor || parentLabel || el;
      }

      // Scroll the click target into view, then re-measure once scroll settles
      clickTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
      setTimeout(() => {
        const rect = clickTarget.getBoundingClientRect();
        const windowX = window.screenX || window.screenLeft || 0;
        const windowY = window.screenY || window.screenTop || 0;
        const chromeOffset = window.outerHeight - window.innerHeight;
        fetch('http://localhost:3004/coord-response', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: data.requestId,
            selector: data.selector,
            // Click target centre — may be a label rather than the input itself
            x: windowX + Math.round(rect.left + rect.width / 2),
            y: windowY + Math.round(rect.top + rect.height / 2) + chromeOffset,
            // Cursor's actual position at this exact moment
            cursorX: liveCursorX,
            cursorY: liveCursorY,
            // Full DOM state from the actual form element (el), not the label
            value:     el.value   !== undefined ? el.value   : '',
            checked:   el.checked !== undefined ? el.checked : null,
            focused:   document.activeElement === el,
            tagName:   el.tagName.toLowerCase(),
            inputType: el.type || el.tagName.toLowerCase(),
            found: true
          })
        }).catch(() => {});
      }, 150);
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
    body: JSON.stringify({ x: liveCursorX, y: liveCursorY, hoveredId, hoveredName })
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

setInterval(pollForCoordRequests, 300);

window.addEventListener('scroll', checkScrollPosition, { passive: true });
window.addEventListener('load', () => setTimeout(detectFormFields, 1000), { passive: true });
if (document.readyState === 'complete') setTimeout(detectFormFields, 1000);
checkScrollPosition();