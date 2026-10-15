// Lecture d'une facture hebdomadaire Intelcom (PDF « Delivery Invoice ») dans le navigateur.
// Reconstruit les lignes à partir des positions du texte, puis applique les mêmes expressions
// régulières que l'extraction initiale des 9 factures.
(function () {
  async function pdfToLines(file) {
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = {};
      tc.items.forEach(it => {
        if (!it.str.trim()) return;
        const y = Math.round(it.transform[5] / 2) * 2; // regroupe par ligne (tolérance 2 pt)
        (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str });
      });
      Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(y => {
        lines.push(rows[y].sort((a, b) => a.x - b.x).map(r => r.s).join(' ').replace(/\s+/g, ' ').trim());
      });
    }
    return lines;
  }

  function parseLines(lines) {
    const text = lines.join('\n');
    const g = (re) => { const m = text.match(re); return m ? m[1] : null; };
    const inv = {
      week: g(/Week reference:\s*(\d{4}-\d{2})/),
      from_date: g(/From:\s*(\d{4}-\d{2}-\d{2})/),
      to_date: g(/To:\s*(\d{4}-\d{2}-\d{2})/),
      total: +(g(/Total invoice\s*\$?\s*([\d,]+\.\d{2})/) || '0').replace(/,/g, ''),
      admin: +(g(/Administration Fees[^\n]*?\(\$([\d,]+\.\d{2})\)/) || '0').replace(/,/g, ''),
      cancel: +(g(/Total Cancellation[^\n]*?\(?\$([\d,]+\.\d{2})\)?/) || '0').replace(/,/g, ''),
      vendor: null
    };
    const days = []; let base = 0, fsc = 0;
    lines.forEach(l => {
      const m = l.match(/^(\d{4}-\d{2}-\d{2})\s+(\d+)\s+(\d+)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})$/);
      if (m) { const parcels = +m[3], amt = +m[4].replace(/,/g, ''), f = +m[5].replace(/,/g, ''), tot = +m[7].replace(/,/g, ''); base += amt; fsc += f; if (parcels >= 20) days.push({ date: m[1], parcels, invoiced: tot }); }
    });
    inv.base = +base.toFixed(2); inv.fsc = +fsc.toFixed(2);
    // Les objets parcels / inv / days partent tels quels dans Supabase : seules les colonnes des tables y figurent.
    // Ce qui ne s'enregistre pas (ex. nombre de signatures) va dans meta.
    const parcels = []; const meta = { sig: 0, driver_code: g(/Driver:\s*(\w+)/) };
    lines.forEach(l => {
      const m = l.match(/^(\d{4}-\d{2}-\d{2})\s+([A-Z]+)\s+(\w+)\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)\s+(ZONE_\w)\s+(\S+)\s*(\*?)\s*([\d.]+)\s*LB\s+\$([\d,]+\.\d{2})$/);
      if (m) { parcels.push({ date: m[1], svc: m[2], pc: m[4].replace(' ', ''), zone: m[5], tracking: m[6], wt: +m[8], amt: +m[9].replace(/,/g, ''), week: inv.week }); if (m[7] === '*') meta.sig++; }
    });
    // localité dominante de chaque journée (code rural J0X1A0 complet, sinon les 3 premiers caractères)
    days.forEach(d => {
      const c = {}; parcels.filter(p => p.date === d.date).forEach(p => { const k = p.pc[1] === '0' ? p.pc : p.pc.slice(0, 3); c[k] = (c[k] || 0) + 1; });
      const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; d.loc = best ? best[0] : null;
    });
    return { inv, days, parcels, meta };
  }

  window.PYPDF = {
    async parseInvoice(file) {
      const lines = await pdfToLines(file);
      const r = parseLines(lines);
      if (!r.inv.week || !r.days.length) throw new Error('Ce PDF ne ressemble pas à une facture hebdomadaire Intelcom (semaine ou journées introuvables).');
      return r;
    },
    parseLines
  };
})();
