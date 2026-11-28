// Paths are trusted module constants. Host-provided labels are always plain text.
export function iconButton(button, path, label) {
  const doc = button.ownerDocument;
  const ns = 'http://www.w3.org/2000/svg';
  const icon = doc.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: 20, height: 20,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) icon.setAttribute(key, value);
  const line = doc.createElementNS(ns, 'path');
  line.setAttribute('d', path);
  icon.append(line);
  button.replaceChildren(icon);
  button.classList.add('wn-icon');
  button.title = label;
  button.setAttribute('aria-label', label);
}
