(function () {
  'use strict';

  if (!location.hostname.includes('duels.ink')) {
    alert('Ce bookmarklet fonctionne uniquement sur duels.ink !');
    return;
  }

  var existing = document.getElementById('lrc-bm-panel');
  if (existing) { existing.remove(); return; }

  var COLORS = {
    amber:    { name: 'Ambre',      hex: '#E8A30A' },
    amethyst: { name: 'Améthyste', hex: '#9B59B6' },
    emerald:  { name: 'Émeraude',  hex: '#27AE60' },
    ruby:     { name: 'Ruby',       hex: '#E74C3C' },
    sapphire: { name: 'Saphir',     hex: '#3498DB' },
    steel:    { name: 'Acier',      hex: '#7F8C8D' },
  };
  var COLOR_KEYS = Object.keys(COLORS);
  var PAIRS = [];
  for (var i = 0; i < COLOR_KEYS.length; i++)
    for (var j = i + 1; j < COLOR_KEYS.length; j++)
      PAIRS.push([COLOR_KEYS[i], COLOR_KEYS[j]]);

  function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

  function dot(color) {
    return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'
      + COLORS[color].hex + ';vertical-align:middle;margin-right:3px"></span>';
  }

  async function fetchReplay(gameId) {
    try {
      var resp = await fetch('/api/replay/' + gameId);
      var blob = await resp.blob();
      var ds = new DecompressionStream('gzip');
      var decompressed = blob.stream().pipeThrough(ds);
      var reader = decompressed.getReader();
      var chunks = [];
      while (true) {
        var r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
      }
      var len = chunks.reduce(function(a, c){ return a + c.length; }, 0);
      var merged = new Uint8Array(len);
      var off = 0;
      chunks.forEach(function(c){ merged.set(c, off); off += c.length; });
      return JSON.parse(new TextDecoder().decode(merged));
    } catch(e) { return null; }
  }

  function getDeckColors(data) {
    var snap = (data.baseSnapshot && data.baseSnapshot.myPlayer) || {};
    var cards = (snap.hand || []).concat(snap.inkwell || []);
    var set = {};
    cards.forEach(function(c){ (c.colors || []).forEach(function(col){ set[col] = 1; }); });
    return Object.keys(set).sort();
  }

  async function loadGameIds(c1, c2) {
    return new Promise(function(resolve) {
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1400px;height:900px;opacity:0;pointer-events:none;z-index:-1';
      iframe.src = '/match-history?colors=' + c1 + ',' + c2 + '&source=matchmaking';
      document.body.appendChild(iframe);
      var start = Date.now();
      var ticker = setInterval(async function() {
        try {
          var d = iframe.contentDocument;
          var links = d.querySelectorAll('a[href*="/replay/"]');
          if (links.length > 0 || Date.now() - start > 14000) {
            clearInterval(ticker);
            for (var s = 0; s < 14; s++) {
              d.documentElement.scrollTop = d.documentElement.scrollHeight;
              await sleep(350);
            }
            var all = d.querySelectorAll('a[href*="/replay/"]');
            var ids = [], seen = {};
            all.forEach(function(a) {
              var m = a.href.match(/\/replay\/([^?#]+)/);
              if (m && !seen[m[1]]) { seen[m[1]] = 1; ids.push(m[1]); }
            });
            document.body.removeChild(iframe);
            resolve(ids);
          }
        } catch(e) { clearInterval(ticker); try { document.body.removeChild(iframe); } catch(_){} resolve([]); }
      }, 500);
    });
  }

  async function analyse(c1, c2) {
    setStatus('Chargement des parties…');
    var ids = await loadGameIds(c1, c2);
    if (ids.length === 0) {
      setStatus('Aucune partie trouvée pour ' + COLORS[c1].name + ' / ' + COLORS[c2].name + '.');
      return;
    }
    setStatus('0 / ' + ids.length + ' parties analysées…');
    var inkStats = {}, playStats = {}, cardWS = {};
    var processed = 0, wins = 0;

    for (var i = 0; i < ids.length; i += 5) {
      var batch = ids.slice(i, i + 5);
      var results = await Promise.all(batch.map(fetchReplay));
      results.forEach(function(data) {
        if (!data) return;
        var dc = getDeckColors(data);
        var strict = dc.length === 2 && dc.indexOf(c1) >= 0 && dc.indexOf(c2) >= 0;
        if (!strict) return;
        processed++;
        var my = data.perspective;
        var won = data.winner === my;
        if (won) wins++;
        (data.logs || []).forEach(function(log) {
          if (log.player !== my) return;
          var name = log.data && log.data.cardName;
          if (!name) return;
          if (!cardWS[name]) cardWS[name] = { iW:0, iG:0, pW:0, pG:0 };
          if (log.type === 'CARD_INKED') {
            inkStats[name] = (inkStats[name] || 0) + 1;
            cardWS[name].iG++; if (won) cardWS[name].iW++;
          } else if (log.type === 'CARD_PLAYED') {
            playStats[name] = (playStats[name] || 0) + 1;
            cardWS[name].pG++; if (won) cardWS[name].pW++;
          }
        });
      });
      setStatus((Math.min(i + 5, ids.length)) + ' / ' + ids.length + ' parties analysées…');
    }

    if (processed === 0) {
      setStatus('Aucune partie strictement ' + COLORS[c1].name + ' / ' + COLORS[c2].name + ' trouvée.');
      return;
    }

    var all = Object.keys(Object.assign({}, inkStats, playStats));
    var rows = all.map(function(card) {
      var ink = inkStats[card] || 0, play = playStats[card] || 0;
      var ws = cardWS[card] || {};
      return {
        card: card, inked: ink, played: play, total: ink + play,
        inkRate: Math.round(ink / (ink + play) * 100),
        pWR: ws.pG > 0 ? Math.round(ws.pW / ws.pG * 100) : null,
        iWR: ws.iG > 0 ? Math.round(ws.iW / ws.iG * 100) : null,
        pG: ws.pG || 0, iG: ws.iG || 0,
      };
    }).sort(function(a, b){ return b.total - a.total; });

    showResults(rows, processed, wins, c1, c2);
  }

  // ── Panel ─────────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = 'lrc-bm-panel';
  panel.style.cssText = 'position:fixed;top:0;right:0;width:480px;height:100vh;z-index:2147483647;background:#161b22;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:-4px 0 24px rgba(0,0,0,.6);display:flex;flex-direction:column;font-size:13px';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'padding:14px 16px;border-bottom:1px solid #30363d;display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
  hdr.innerHTML = '<span style="font-weight:600;font-size:15px">📊 Lorcana Stats</span><button id="lrc-close" style="background:none;border:none;color:#8b949e;font-size:20px;cursor:pointer;line-height:1;padding:2px 4px">×</button>';

  var body = document.createElement('div');
  body.id = 'lrc-body-inner';
  body.style.cssText = 'flex:1;overflow-y:auto;padding:16px';

  panel.appendChild(hdr);
  panel.appendChild(body);
  document.body.appendChild(panel);
  document.getElementById('lrc-close').onclick = function(){ panel.remove(); };

  function setStatus(msg) {
    body.innerHTML = '<div style="color:#8b949e;padding:30px 0;text-align:center;line-height:1.8">' + msg + '</div>';
  }

  function badge(r) {
    if (r === null || r === undefined) return '<span style="color:#8b949e">—</span>';
    var bg = r >= 70 ? 'rgba(46,160,67,.18)' : r >= 50 ? 'rgba(210,153,34,.18)' : 'rgba(248,81,73,.18)';
    var col = r >= 70 ? '#3fb950' : r >= 50 ? '#d29922' : '#f85149';
    return '<span style="background:' + bg + ';color:' + col + ';padding:2px 7px;border-radius:6px;font-size:11px;font-weight:600">' + r + '%</span>';
  }

  function bar(v, max, color) {
    var pct = max > 0 ? Math.round(v / max * 100) : 0;
    return '<div style="display:flex;align-items:center;gap:6px">'
      + '<div style="flex:1;height:5px;background:#21262d;border-radius:3px;min-width:60px;overflow:hidden">'
      + '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:3px"></div></div>'
      + '<span style="min-width:24px;text-align:right;font-size:12px;font-weight:500">' + v + '</span>'
      + '</div>';
  }

  function showResults(rows, games, wins, c1, c2) {
    var wr = Math.round(wins / games * 100);
    var totalInk = rows.reduce(function(s, r){ return s + r.inked; }, 0);
    var totalPlay = rows.reduce(function(s, r){ return s + r.played; }, 0);
    var maxI = Math.max.apply(null, rows.map(function(r){ return r.inked; }));
    var maxP = Math.max.apply(null, rows.map(function(r){ return r.played; }));

    var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">'
      + '<button id="lrc-back" style="background:none;border:1px solid #30363d;border-radius:6px;color:#8b949e;padding:4px 10px;cursor:pointer;font-size:12px">← Retour</button>'
      + '<span style="font-weight:500;font-size:14px">' + dot(c1) + COLORS[c1].name + ' / ' + dot(c2) + COLORS[c2].name + '</span>'
      + '</div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
    [['Parties', games, ''], ['Winrate', wr + '%', wins + 'V · ' + (games - wins) + 'D'],
     ['Encrages', totalInk, ''], ['Jeux de cartes', totalPlay, '']].forEach(function(m) {
      html += '<div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 12px">'
        + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#8b949e;margin-bottom:3px">' + m[0] + '</div>'
        + '<div style="font-size:20px;font-weight:600">' + m[1] + '</div>'
        + (m[2] ? '<div style="font-size:10px;color:#8b949e;margin-top:1px">' + m[2] + '</div>' : '')
        + '</div>';
    });
    html += '</div>';

    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">'
      + '<thead><tr style="border-bottom:1px solid #30363d">'
      + '<th style="text-align:left;padding:6px 4px;color:#8b949e;font-weight:500">Carte</th>'
      + '<th style="padding:6px 4px;color:#E74C3C;font-weight:500;min-width:80px">Encrée</th>'
      + '<th style="padding:6px 4px;color:#3498DB;font-weight:500;min-width:80px">Jouée</th>'
      + '<th style="padding:6px 4px;color:#8b949e;font-weight:500;text-align:center">%</th>'
      + '<th style="padding:6px 4px;color:#8b949e;font-weight:500;text-align:center">WR</th>'
      + '</tr></thead><tbody>';

    rows.forEach(function(r, idx) {
      html += '<tr style="border-bottom:1px solid #21262d' + (idx % 2 ? ';background:#0d1117' : '') + '">'
        + '<td style="padding:6px 4px;font-weight:500;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + r.card + '">' + r.card + '</td>'
        + '<td style="padding:6px 4px">' + bar(r.inked, maxI, '#E74C3C') + '</td>'
        + '<td style="padding:6px 4px">' + bar(r.played, maxP, '#3498DB') + '</td>'
        + '<td style="padding:6px 4px;text-align:center">' + badge(r.inkRate) + '</td>'
        + '<td style="padding:6px 4px;text-align:center">' + badge(r.pWR) + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    body.innerHTML = html;
    document.getElementById('lrc-back').onclick = showPairSelector;
  }

  function showPairSelector() {
    var html = '<p style="color:#8b949e;margin:0 0 14px;line-height:1.6;font-size:13px">Choisis une bicolorité pour voir les stats de tes cartes encrées et jouées.</p>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    PAIRS.forEach(function(p) {
      var c1 = p[0], c2 = p[1];
      html += '<button class="lrc-pair-btn" data-c1="' + c1 + '" data-c2="' + c2 + '" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:10px 12px;cursor:pointer;text-align:left;font-size:12px;display:flex;align-items:center;gap:8px">'
        + dot(c1) + dot(c2)
        + '<span>' + COLORS[c1].name + ' / ' + COLORS[c2].name + '</span>'
        + '</button>';
    });
    html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('.lrc-pair-btn').forEach(function(btn) {
      btn.onmouseenter = function(){ this.style.borderColor = '#3498DB'; };
      btn.onmouseleave = function(){ this.style.borderColor = '#30363d'; };
      btn.onclick = function() { analyse(this.getAttribute('data-c1'), this.getAttribute('data-c2')); };
    });
  }

  showPairSelector();
})();
