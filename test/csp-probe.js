// Which ways of adding CSS survive a page CSP of style-src 'self'? Reports to the server log.
addEventListener('load', () => {
  const out = [];
  const style = document.createElement('style');
  style.textContent = '#a{background:#fff!important;color:#000!important}';
  document.head.appendChild(style);
  out.push(`style-element:${style.sheet ? style.sheet.cssRules.length : 'no sheet'}:${getComputedStyle(document.getElementById('a')).backgroundColor}`);
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('#b{background:#fff!important;color:#000!important}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    out.push(`adopted:${getComputedStyle(document.getElementById('b')).backgroundColor}`);
  } catch (e) { out.push(`adopted:error ${e.message}`); }
  try {
    const root = document.getElementById('host').attachShadow({ mode: 'open' });
    root.innerHTML = '<div class="x">C: constructed sheet in a shadow root</div>';
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.x{background:#123;color:#fff;padding:10px}');
    root.adoptedStyleSheets = [sheet];
    out.push(`shadow-adopted:${getComputedStyle(root.querySelector('.x')).backgroundColor}`);
  } catch (e) { out.push(`shadow-adopted:error ${e.message}`); }
  document.title = out.join(' ');
  fetch(`/__probe?${new URLSearchParams({ ua: navigator.userAgent.match(/Version\/[\d.]+ Safari|Firefox\/[\d.]+|Chrome\/[\d.]+/)[0], r: out.join(' | ') })}`).catch(() => {});
});
