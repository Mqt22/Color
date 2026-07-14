
const uploadPanel = document.getElementById('uploadPanel');
const uploadContent = document.getElementById('uploadContent');
const fileInput = document.getElementById('fileInput');
const errorEl = document.getElementById('errorMsg');
const previewFrame = document.getElementById('previewFrame');
const previewFiles = document.getElementById('previewFiles');
const previewError = document.getElementById('previewError');
const changeFileBtn = document.getElementById('changeFileBtn');
const selectionBadge = document.getElementById('selectionBadge');
const selectionText = document.getElementById('selectionText');
const colorPanel = document.getElementById('colorPanel');
const colorHint = document.getElementById('colorHint');

const ALLOWED_EXT = ['html', 'htm', 'css', 'js'];

let hasSelection = false;
let lastSelectionLabel = '';

function getExt(filename) { return filename.split('.').pop().toLowerCase(); }

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function tagFor(ext) {
  if (ext === 'html' || ext === 'htm') return 'HTML';
  if (ext === 'css') return 'CSS';
  if (ext === 'js') return 'JS';
  return '';
}

// Injected into the uploaded template. Lets the user click around to
// select a section/element (highlighting it), blocks selecting the
// outer page wrapper and anything logo-related, strips any remaining
// hover/focus/active CSS rules so hover animations can't fire, blocks
// link navigation and form submission, and applies colors sent from
// the parent panel to whichever element is currently selected.
const SELECTOR_SCRIPT = `
  (function(){
    var hoverEl = null;
    var selectedEl = null;
    var RESTRICTED_TAGS = ['html','body','script','style','head','meta','link','title','noscript'];

    function classStr(el){
      if(!el || !el.className) return '';
      return typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
    }

    function isLogo(el){
      if(!el || el.nodeType !== 1) return false;
      var id = (el.id || '').toLowerCase();
      var cls = classStr(el).toLowerCase();
      return /logo/.test(id) || /logo/.test(cls);
    }

    function isRestricted(el){
      if(!el || el.nodeType !== 1) return true;
      var tag = el.tagName.toLowerCase();
      if(RESTRICTED_TAGS.indexOf(tag) !== -1) return true;
      if(isLogo(el)) return true;
      var p = el.parentElement;
      while(p){
        if(isLogo(p)) return true;
        if(p.tagName && p.tagName.toLowerCase() === 'body') break;
        p = p.parentElement;
      }
      return false;
    }

    var SEMANTIC = {
      header:'Header section', nav:'Navigation', footer:'Footer section',
      main:'Main content', section:'Section', article:'Article',
      button:'Button', a:'Link / Button', img:'Image',
      h1:'Heading', h2:'Heading', h3:'Heading', h4:'Heading',
      p:'Text', span:'Text', li:'List item', ul:'List', form:'Form',
      input:'Input field', textarea:'Text field'
    };

    function labelFor(el){
      var tag = el.tagName.toLowerCase();
      var cls = classStr(el).trim().split(/\\s+/)[0];
      var base = SEMANTIC[tag] || (tag.charAt(0).toUpperCase() + tag.slice(1));
      var lowerCls = (cls || '').toLowerCase();
      if(/hero/.test(lowerCls)) base = 'Hero section';
      else if(/about/.test(lowerCls)) base = 'About section';
      else if(/footer/.test(lowerCls)) base = 'Footer section';
      else if(/header/.test(lowerCls)) base = 'Header section';
      else if(/nav/.test(lowerCls)) base = 'Navigation';
      else if(/btn|button/.test(lowerCls)) base = 'Button';
      if(cls) base += ' \\u2022 .' + cls;
      return base;
    }

    function clearHoverStyle(){
      if(hoverEl && hoverEl !== selectedEl){
        hoverEl.style.outline = '';
        hoverEl.style.outlineOffset = '';
      }
      hoverEl = null;
    }

    // Strip any hover/focus/active rules left in the stylesheets so
    // hover-triggered visual effects can't run even without transitions.
    try {
      Array.prototype.forEach.call(document.styleSheets, function(sheet){
        try {
          var rules = sheet.cssRules || sheet.rules;
          if(!rules) return;
          for(var i = rules.length - 1; i >= 0; i--){
            var rule = rules[i];
            if(rule.selectorText && /:hover|:focus|:active/i.test(rule.selectorText)){
              sheet.deleteRule(i);
            }
          }
        } catch(innerErr){ /* cross-origin stylesheet, skip */ }
      });
    } catch(err){}

    document.addEventListener('mouseover', function(e){
      var el = e.target;
      if(isRestricted(el)){
        document.documentElement.style.cursor = 'not-allowed';
        return;
      }
      document.documentElement.style.cursor = 'pointer';
      if(el === selectedEl) return;
      clearHoverStyle();
      hoverEl = el;
      el.style.outline = '2px dashed #D63484';
      el.style.outlineOffset = '2px';
    }, true);

    document.addEventListener('mouseout', function(e){
      if(e.target === hoverEl) clearHoverStyle();
    }, true);

    // Block link navigation, button actions, and any other default
    // interactive behavior; only handle selection.
    document.addEventListener('click', function(e){
      var el = e.target;
      e.preventDefault();
      e.stopPropagation();
      if(isRestricted(el)) return;

      if(selectedEl){
        selectedEl.style.outline = '';
        selectedEl.style.outlineOffset = '';
      }
      selectedEl = el;
      clearHoverStyle();
      el.style.outline = '3px solid #F13C46';
      el.style.outlineOffset = '2px';

      window.parent.postMessage({ type: 'template-element-selected', label: labelFor(el) }, '*');
    }, true);

    document.addEventListener('submit', function(e){
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // Receive a color/gradient from the parent panel and apply it to
    // whichever element is currently selected.
    window.addEventListener('message', function(e){
      if(!e.data || e.data.type !== 'apply-color') return;
      if(!selectedEl) return;
      selectedEl.style.background = e.data.value;
    });
  })();
  `;

// Merge an html file with separately-uploaded css files into one
// self-contained document. All <script> tags and inline on-* handlers
// are stripped so uploaded JS (animations, link handling, etc.) never
// runs; only our own selector script executes.
async function buildPreviewDoc(files) {
  const htmlFile = files.find(f => ['html', 'htm'].includes(getExt(f.name)));
  if (!htmlFile) return { error: 'Add an .html file so there is something to preview.' };

  const cssFiles = files.filter(f => getExt(f.name) === 'css');

  const [htmlText, cssTexts] = await Promise.all([
    readAsText(htmlFile),
    Promise.all(cssFiles.map(readAsText))
  ]);

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');

  // Remove every script tag (inline or external) - blocks all uploaded functionality.
  doc.querySelectorAll('script').forEach(s => s.remove());

  // Strip inline event-handler attributes (onclick, onmouseover, ...).
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    });
  });

  if (cssTexts.length) {
    const style = doc.createElement('style');
    style.textContent = cssTexts.join('\n\n');
    doc.head.appendChild(style);
  }

  // Force-disable animations/transitions so hover/scroll animations can't play.
  const lockStyle = doc.createElement('style');
  lockStyle.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }';
  doc.head.appendChild(lockStyle);

  const selectorScript = doc.createElement('script');
  selectorScript.textContent = SELECTOR_SCRIPT;
  doc.body.appendChild(selectorScript);

  return { html: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML };
}

function showPreview(html, files) {
  hasSelection = false;
  lastSelectionLabel = '';
  selectionBadge.classList.remove('visible');
  colorHint.textContent = 'Select a section in the template, then pick a color.';
  colorHint.classList.remove('warn');
  colorPanel.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));

  previewFrame.srcdoc = html;
  previewFiles.innerHTML = files
    .map(f => `<span class="tag">[${tagFor(getExt(f.name))}]</span>${f.name}`)
    .join('&nbsp;&nbsp;');
  uploadPanel.classList.add('has-preview');
}

async function handleFiles(fileArray) {
  const inPreview = uploadPanel.classList.contains('has-preview');
  errorEl.textContent = '';
  previewError.textContent = '';
  if (!fileArray.length) return;

  const invalid = fileArray.filter(f => !ALLOWED_EXT.includes(getExt(f.name)));
  if (invalid.length) {
    const names = invalid.map(f => f.name).join(', ');
    const msg = `Only .html, .css and .js files are allowed right now. Rejected: ${names}`;
    if (inPreview) previewError.textContent = msg; else errorEl.textContent = msg;
    return;
  }

  const result = await buildPreviewDoc(fileArray);
  if (result.error) {
    if (inPreview) previewError.textContent = result.error; else errorEl.textContent = result.error;
    return;
  }

  showPreview(result.html, fileArray);
}

uploadContent.addEventListener('click', () => fileInput.click());

changeFileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  handleFiles(Array.from(fileInput.files));
});

['dragenter', 'dragover'].forEach(evt => {
  uploadPanel.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadPanel.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach(evt => {
  uploadPanel.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadPanel.classList.remove('drag-over');
  });
});

uploadPanel.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  fileInput.files = dt.files;
  handleFiles(files);
});

// Selection reports coming from inside the previewed template.
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'template-element-selected') return;
  hasSelection = true;
  lastSelectionLabel = e.data.label;
  selectionText.textContent = 'Selected: ' + e.data.label;
  selectionBadge.classList.add('visible');
  colorHint.textContent = 'Pick a color to apply to: ' + e.data.label;
  colorHint.classList.remove('warn');
});

// Color swatch selection.
colorPanel.querySelectorAll('.swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    if (!uploadPanel.classList.contains('has-preview')) {
      colorHint.textContent = 'Upload a template first.';
      colorHint.classList.add('warn');
      return;
    }
    if (!hasSelection) {
      colorHint.textContent = 'Select a section in the template first, then choose a color.';
      colorHint.classList.add('warn');
      return;
    }

    colorPanel.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');

    const value = swatch.dataset.value;
    previewFrame.contentWindow.postMessage({ type: 'apply-color', value }, '*');
    colorHint.textContent = `Applied "${swatch.dataset.label}" to: ${lastSelectionLabel}`;
    colorHint.classList.remove('warn');
  });
});