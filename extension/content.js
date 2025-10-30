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
      
      // Skip fields that are outside reasonable automation bounds
      if (viewportX < 0 || viewportX > 1200 || viewportY < 0 || viewportY > 900) {
        return; // Skip this field - coordinates are too extreme
      }
      
      // Get browser window offset with Mac DPI/scaling handling
      let windowX = window.screenX || window.screenLeft || 0;
      let windowY = window.screenY || window.screenTop || 0;
      
      // Detect Mac Retina/scaling issues
      const devicePixelRatio = window.devicePixelRatio || 1;
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      
      console.log(`🖥️  Display info - DPR: ${devicePixelRatio}, Platform: ${navigator.platform}`);
      console.log(`📐 Screen size: ${screen.width}x${screen.height}, Window: ${window.innerWidth}x${window.innerHeight}`);
      
      // Mac-specific coordinate correction
      if (isMac && devicePixelRatio > 1) {
        // On Retina Macs, sometimes coordinates need scaling adjustment
        console.log(`🍎 Mac Retina detected - original coords: (${windowX}, ${windowY})`);
        
        // If coordinates seem scaled incorrectly, apply correction
        if (Math.abs(windowX) > screen.width || Math.abs(windowY) > screen.height) {
          windowX = Math.round(windowX / devicePixelRatio);
          windowY = Math.round(windowY / devicePixelRatio);
          console.log(`🔧 Applied DPI correction: (${windowX}, ${windowY})`);
        }
      }
      
      // Validate window offsets - if they're still extreme, use fallbacks
      if (windowX < -1000 || windowX > 4000 || windowY < -1000 || windowY > 3000) {
        console.warn(`⚠️  Invalid coords after correction: (${windowX}, ${windowY}), using fallback`);
        windowX = 100;
        windowY = 100;
      }
      
      // Add browser chrome offset (approximately 120px for address bar/tabs)
      const chromeOffset = 120;
      
      const absoluteX = windowX + viewportX;
      const absoluteY = windowY + viewportY + chromeOffset;
      
      console.log(`🔍 Field debug - ${placeholder || name}:`);
      console.log(`   Raw rect:`, rect);
      console.log(`   Viewport coords: (${viewportX}, ${viewportY})`);
      console.log(`   Window offset: (${windowX}, ${windowY})`);
      console.log(`   Absolute coords: (${absoluteX}, ${absoluteY})`);
      console.log(`   Window size: ${window.innerWidth}x${window.innerHeight}`);
      
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

window.addEventListener('scroll', checkScrollPosition, { passive: true });
window.addEventListener('load', () => setTimeout(detectFormFields, 1000), { passive: true });
if (document.readyState === 'complete') setTimeout(detectFormFields, 1000);
checkScrollPosition();