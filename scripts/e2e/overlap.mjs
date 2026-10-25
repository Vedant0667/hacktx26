// Runs inside the page (serialised by puppeteer: keep it self-contained, no imports or closures).
// Returns { overlaps, clipped, hscroll, occluded } for the visible text on screen.
export function findLayoutIssues(minOverlap) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const items = [];
  const occluded = [];
  const label = (el) => {
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 2).join(".") : "";
    return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> "${t}"`;
  };
  const at = (it) => `${Math.round(it.l)},${Math.round(it.t)}-${Math.round(it.r)},${Math.round(it.b)}`;
  const inPortal = (el) => !!el.closest("nextjs-portal, [data-nextjs-dialog-overlay], [data-nextjs-toast]");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || inPortal(el) || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width >= 2 && r.height >= 2);
    if (!rects.length) continue;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    // Tight leading (line-height below the font's content box) makes ranges taller than the line: use the line box.
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    for (const q of rects) {
      const trim = lh > 0 && q.height > lh + 1 ? (q.height - lh) / 2 : 0;
      l = Math.min(l, q.left);
      t = Math.min(t, q.top + trim);
      r = Math.max(r, q.right);
      b = Math.max(b, q.bottom - trim);
    }
    let visible = true;
    for (let a = el; a && visible; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0 || cs.contentVisibility === "hidden") visible = false;
      // Content of a closed <details> (everything but its <summary>) is not on screen.
      if (a.tagName === "DETAILS" && !a.open && !el.closest("summary")) visible = false;
    }
    if (!visible) continue;
    // Clip by overflow ancestors: truncated or scrolled-away text is not on screen.
    const box = { l, t, r, b };
    for (let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX !== "visible";
      const oy = cs.overflowY !== "visible";
      if (!ox && !oy) continue;
      const ar = a.getBoundingClientRect();
      if (ox) {
        box.l = Math.max(box.l, ar.left);
        box.r = Math.min(box.r, ar.right);
      }
      if (oy) {
        box.t = Math.max(box.t, ar.top);
        box.b = Math.min(box.b, ar.bottom);
      }
    }
    if (box.r - box.l < 2 || box.b - box.t < 2) continue;
    if (box.b < 0 || box.t > vh) continue;
    // Occluded text (e.g. page content scrolled under a sticky bar) is not on screen: keep the text only if some
    // sample point inside it hits the element itself or a neighbour in its own subtree.
    const cx = (box.l + box.r) / 2;
    const cy = (box.t + box.b) / 2;
    const w4 = (box.r - box.l) / 4;
    const h4 = (box.b - box.t) / 4;
    const pts = [[cx, cy], [cx - w4, cy - h4], [cx + w4, cy - h4], [cx - w4, cy + h4], [cx + w4, cy + h4]];
    const hits = pts.map(([x, y]) => (x < 0 || y < 0 || x >= vw || y >= vh ? null : document.elementFromPoint(x, y)));
    const seen = hits.some((hit) => !hit || hit === el || el.contains(hit) || hit.contains(el));
    if (!seen) {
      // Under a fixed or sticky bar (content scrolled beneath it) is fine; text buried under an element in the
      // normal flow (a dock or card drawn over a list that ran too long) is a layout bug the user cannot read.
      // Only an opaque box counts: a tall transparent line box over a label paints nothing on it. Decorative
      // (aria-hidden) text is meant to sit behind things.
      const cover = hits.find((h) => h);
      let pinned = false;
      let painter = null;
      for (let a = cover; a && !a.contains(el); a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.position === "fixed" || cs.position === "sticky") pinned = true;
        const opaque = (st) => (st.backgroundColor && st.backgroundColor !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(st.backgroundColor)) || st.backgroundImage !== "none";
        const pseudo = ["::before", "::after"].map((p) => getComputedStyle(a, p)).some((st) => st.content !== "none" && st.content !== "normal" && opaque(st));
        if (!painter && (opaque(cs) || pseudo)) painter = a;
      }
      if (cover && painter && !pinned && !inPortal(cover) && !el.closest("[aria-hidden=true]")) occluded.push(`${label(el)} @${at(box)} is under ${label(painter)}`);
      continue;
    }
    items.push({ el, ...box });
  }
  const overlaps = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const c = items[j];
      if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
      const w = Math.min(a.r, c.r) - Math.max(a.l, c.l);
      const h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
      if (w > minOverlap && h > minOverlap) overlaps.push(`${label(a.el)} @${at(a)}  x  ${label(c.el)} @${at(c)}  (${Math.round(w)}x${Math.round(h)} px)`);
    }
  }
  const clipped = [];
  for (const it of items) {
    if (it.l < -1 || it.r > vw + 1) clipped.push(`${label(it.el)} spans ${Math.round(it.l)}..${Math.round(it.r)} of ${vw} px`);
  }
  const root = document.documentElement;
  const hscroll = root.scrollWidth > vw + 1 ? `page scrollWidth ${root.scrollWidth} > viewport ${vw}` : null;
  return { overlaps: [...new Set(overlaps)], clipped: [...new Set(clipped)], hscroll, occluded: [...new Set(occluded)] };
}
