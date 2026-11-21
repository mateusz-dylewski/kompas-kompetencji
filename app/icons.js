/* Wektorowe ikony (SVG, linia 1.8px, currentColor). Zamiast emoji. */
(() => {
  const P = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3-5.5 6.5-5.5s5.9 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.2 0 3.8 1.5 4.3 4"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    spark: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L15.5 10"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
    clip: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    scale: '<path d="M12 4v16M6 20h12M4 8h16"/><path d="M4 8l-2 5a2.5 2.5 0 0 0 4 0zM20 8l-2 5a2.5 2.5 0 0 0 4 0z"/>',
    megaphone: '<path d="M3 10v4h4l8 4V6L7 10z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
    lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    signpost: '<path d="M12 3v18"/><path d="M12 5h7l2 2-2 2h-7"/><path d="M12 11H5l-2 2 2 2h7"/>',
    chart2: '<path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/>',
  };
  // Mapowanie kompetencji (prefiks nazwy z modelu) → ikona
  const COMP = [
    ["RZETELNOŚĆ", "shield"], ["KOMUNIKACJA", "msg"], ["WYKORZYSTYWANIE", "book"], ["ORGANIZACJA PRACY", "clip"],
    ["KREATYWNOŚĆ", "bulb"], ["WSPÓŁPRACA", "users"], ["MYŚLENIE ANALITYCZNE", "chart2"], ["NEGOCJOWANIE", "scale"],
    ["WYSTĄPIENIA PUBLICZNE", "megaphone"], ["ORIENTACJA NA KLIENTA", "target"], ["RADZENIE SOBIE", "lifebuoy"],
    ["ZARZĄDZANIE STRATEGICZNE", "compass"], ["ZARZĄDZANIE LUDŹMI", "user"], ["PODEJMOWANIE DECYZJI", "signpost"],
  ];
  const wrap = (body, cls = "ic-svg") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  window.KK_ICON = (name, cls) => wrap(P[name] || P.file, cls);
  window.KK_COMP_ICON = (key, cls) => {
    const hit = COMP.find(([p]) => String(key).toUpperCase().startsWith(p));
    return wrap(P[hit ? hit[1] : "file"], cls || "ic-svg comp-ic");
  };
})();
