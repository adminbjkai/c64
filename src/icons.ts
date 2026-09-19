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
  // new tool icons
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5',
  entity: 'M7 8 3 12l4 4M17 8l4 4-4 4M10 17l4-10',
  escape: 'M4 6h16M4 12h8M4 18h12M17 15l3 3-3 3',
  textCase: 'M3 17 8 5l5 12M4.8 13h6.4M15 10h5M15 17h5M20 10c0-2-4-2-4 0v5c0 2 4 2 4 0',
  lines: 'M4 6h16M4 10h10M4 14h16M4 18h8',
  hash: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
  hex: 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9zM9 9h6M9 12h6M9 15h4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  fingerprint: 'M7 20c-1-3-1-7 0-9a6 6 0 0 1 11 3v3M9 20c-.5-3 0-8 3-8s3 5 3 8M4 8a9 9 0 0 1 16-2M12 12v8',
  diff: 'M4 5h7v14H4zM13 5h7v14h-7zM6 9h3M7.5 7.5v3M15 9h3',
  regex: 'M16 4v6M13 5.5l6 3M13 8.5l6-3M5 17a2 2 0 1 0 0 .01M11 20v-8h3a2 2 0 0 1 0 4h-3',
  markdown: 'M3 6h18v12H3zM6 15V9l3 3 3-3v6M17 9v6M15 13l2 2 2-2',
  html: 'M4 4h16l-1.5 14L12 20l-6.5-2zM8 8h8l-.5 5H9M8.5 13l.3 2.5 3.2 1 3.2-1',
  database: 'M12 3c5 0 8 1.3 8 3s-3 3-8 3-8-1.3-8-3 3-3 8-3zM4 6v12c0 1.7 3 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3 3 8 3s8-1.3 8-3',
  types: 'M4 5h16v14H4zM8 9h5M10.5 9v6M15 15v-3.5a1.5 1.5 0 0 1 3 0V15M15 13h3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h2',
  palette: 'M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-.5-1.5.5-2.5S17 15 18 15a3 3 0 0 0 3-3c0-5-4-9-9-9zM7.5 12h.01M10 8h.01M14 8h.01M17 11h.01',
  slash: 'M15 4 9 20',
  compare: 'M4 5h7v14H4zM13 5h7v14h-7zM6 10h3M6 14h3M15 10h3M15 14h3M11 3v18',
  patch: 'M4 6h16M4 12h10M4 18h7M17 15v6M14 18h6',
  schema: 'M9 4h6l4 4v12H5V4h4zM9 4v4H5M9 13h6M9 17h6M9 9h2',
  flatten: 'M4 6h16M4 12h16M4 18h16M8 9l-2 3 2 3M16 9l2 3-2 3',
  sortAz: 'M4 17V7l3 3M4 7 1 10M10 6h5l-5 5h5M10 14h6M10 18h6',
  toml: 'M4 6h16v12H4zM8 10h8M8 14h5',
  compress: 'M4 4h16v6H4zM4 14h16v6H4zM12 10v4M9 12l3-2 3 2',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM6 6h2v2H6zM16 6h2v2h-2zM6 16h2v2H6z',
  otp: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v9l6 3',
  lorem: 'M4 6h16M4 10h12M4 14h16M4 18h8',
  stringTool: 'M7 4h10M12 4v16M8 20h8',
  units: 'M4 14h16v4H4zM6 14v-3M10 14v-2M14 14v-3M18 14v-2M4 9h4M4 5h8',
  network: 'M5 4h14v6H5zM12 10v4M4 18h6M14 18h6M7 14h10v4H7z',
  image: 'M4 5h16v14H4zM8 15l3-4 3 3 2-2 4 3M8 9h.01',
  math: 'M4 6h16M4 6l6 6-6 6M14 18h6M17 15v6',
  chmod: 'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5zM12 14v3',
  star: 'M12 3l2.8 5.9 6.4.9-4.6 4.5 1.1 6.4L12 17.7l-5.7 3 1.1-6.4L2.8 9.8l6.4-.9z',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01',
  swapAb: 'M4 8h13l-3-3M20 16H7l3 3',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  // shell icons
  plus: 'M12 5v14M5 12h14',
  command: 'M8 3a3 3 0 0 0 0 6h8a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H8a3 3 0 1 0 3 3V6a3 3 0 0 0-3-3z',
  pipe: 'M4 6h5a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h5M17 15l3 3-3 3',
  maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  minimize: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  duplicate: 'M8 8h12v12H8zM4 16V4h12',
  save: 'M4 4h12l4 4v12H4zM8 4v5h7V4M7 20v-6h10v6',
  folder: 'M3 6h6l2 2h10v11H3z',
  share: 'M18 5a2 2 0 1 0 0 .01M6 12a2 2 0 1 0 0 .01M18 19a2 2 0 1 0 0 .01M8 11l8-5M8 13l8 5',
  undo: 'M4 10h11a5 5 0 0 1 0 10h-3M4 10l4-4M4 10l4 4',
  wrap: 'M4 6h16M4 12h11a3 3 0 0 1 0 6h-3M4 18h5M14 15l-2 3 2 3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  find: 'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM15 15l6 6M7 10h6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M5 12l7 7 7-7',
  arrowLeft: 'M19 12H5M12 5l-7 7 7 7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4l11-11-4-4L4 16zM13 7l4 4',
  external: 'M14 4h6v6M20 4l-9 9M18 13v7H4V6h7',
  github: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z',
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
