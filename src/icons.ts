/**
 * Tiny inline icon set (24×24 stroke icons, currentColor). Hand-drawn so we
 * ship no icon font or dependency. `icon('copy')` returns an <svg>.
 */

const PATHS: Record<string, string> = {
  // tool icons
  braces: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1',
  tree: 'M4 5h6M4 12h4M4 19h6M14 5h6M12 12h8M14 19h6M7 5v14',
  path: 'M4 19c4 0 4-14 8-14s4 14 8 14M4 5h.01M20 19h.01',
  graph: 'M12 3v5M12 8 6 13M12 8l6 5M6 13v3M18 13v3M9 5h6v3H9zM3 16h6v3H3zM15 16h6v3h-6z',
  xml: 'm9 7-5 5 5 5M15 7l5 5-5 5M13 4l-2 16',
  yaml: 'M4 5h16M4 10h10M8 15h12M8 20h8',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  convert: 'M4 8h13l-3-3M20 16H7l3 3',
  base64: 'M5 8h14M5 12h14M5 16h9M19 16l-3-3M19 16l-3 3',
  key: 'M15 3a6 6 0 1 1-4.8 9.6L3 20v1h3v-2h2v-2h2l1.8-1.8A6 6 0 0 1 15 3zM16 8h.01',
  minify: 'M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M4 12h16',
  css: 'M5 4h14l-1.2 13.5L12 20l-5.8-2.5zM8 8h8l-.4 5H9.2M8.6 13.5l.2 2 3.2 1 3.2-1 .2-2',
  // ui icons
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  paste: 'M9 4h6v3H9zM6 6H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1M9 12h6M9 16h6',
  clear: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  upload: 'M12 15V3M7 8l5-5 5 5M4 19h16',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  splitRight: 'M3 5h18v14H3zM12 5v14',
  splitDown: 'M3 5h18v14H3zM3 12h18',
  close: 'M6 6l12 12M18 6 6 18',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  columns: 'M3 5h18v14H3zM12 5v14',
  rows: 'M3 5h18v14H3zM3 12h18',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sun: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  check: 'M5 12l4 4L19 7',
  shield: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z',
  swap: 'M7 4v13M3 13l4 4 4-4M17 20V7M13 11l4-4 4 4',
  plus: 'M12 5v14M5 12h14',
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
};

export function icon(name: string, size = 16): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS['braces']!);
  svg.append(path);
  return svg;
}
