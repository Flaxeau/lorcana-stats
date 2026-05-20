(function () {
  'use strict';

  if (!location.hostname.includes('duels.ink')) {
    alert('Ce bookmarklet fonctionne uniquement sur duels.ink !');
    return;
  }

  var existing = document.getElementById('lrc-bm-panel');
  if (existing) { existing.remove(); return; }

  var COLORS = {
    amber:    { name: 'Ambre',     hex: '#E8A30A', api: 'Amber' },
    amethyst: { name: 'Amethyste',hex: '#9B59B6', api: 'Amethyst' },
    emerald:  { name: 'Emeraude', hex: '#27AE60', api: 'Emerald' },
    ruby:     { name: 'Ruby',      hex: '#E74C3C', api: 'Ruby' },
    sapphire: { name: 'Saphir',    hex: '#3498DB', api: 'Sapphire' },
    steel:    { name: 'Acier',     hex: '#7F8C8D', api: 'Steel' },
  };
  var API_TO_KEY = {};
  Object.keys(COLORS).forEach(function(k) { API_TO_KEY[COLORS[k].api] = k; });

  var excludeLastTurns = 0;
  var cachedAllGames = null;
  var STORAGE_KEY = 'lrc_deck_names';

  function getDeckNames() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) { return {}; }
  }
  function saveDeckName(deckId, name) {
    try {
      var m = getDeckNames();
      if (name) m[deckId] = name; else delete m[deckId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
    } catch(e) {}
  }

  function dot(color) {
    if (!color || !COLORS[color]) return '';
    return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'
      + COLORS[color].hex + ';vertical-align:middle;margin-right:3px"></span>';
  }

  function shortId(deckId) {
    return deckId ? deckId.slice(-6) : '';
  }

  function kofiBtn() {
    return '<div style="margin-top:20px;text-align:center;padding-top:14px;border-top:1px solid #30363d">'
      + '<a href="https://ko-fi.com/flaxeau" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;background:#FF5E5B;color:#fff;text-decoration:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600">&#x2615; Soutenir le projet</a>'
      + '<div style="font-size:10px;color:#8b949e;margin-top:6px">Outil gratuit et open source</div>'
      + '</div>';
  }

  function filterHtmlFn() {
    var html = '<div style="margin-bottom:14px">'
      + '<div style="font-size:11px;color:#8b949e;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Filtre tours finaux</div>'
      + '<div style="display:flex;gap:6px">';
    [['Tous les tours', 0], ['-1 dernier tour', 1], ['-2 derniers tours', 2]].forEach(function(opt) {
      var active = excludeLastTurns === opt[1];
      html += '<button class="lrc-filter-btn" data-val="' + opt[1] + '" style="flex:1;padding:5px 4px;font-size:11px;border-radius:6px;cursor:pointer;border:1px solid ' + (active ? '#58a6ff' : '#30363d') + ';background:' + (active ? '#1f3a4a' : '#0d1117') + ';color:' + (active ? '#58a6ff' : '#8b949e') + '">' + opt[0] + '</button>';
    });
    html += '</div></div>';
    return html;
  }

  async function decompressGzip(blob) {
    try {
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

  async function fetchGamelog(url) {
    try {
      var resp = await fetch(url);
      var blob = await resp.blob();
      return await decompressGzip(blob);
    } catch(e) { return null; }
  }

  async function fetchAllMatchHistory() {
    if (cachedAllGames) return cachedAllGames;
    var allGames = [];
    var cursor = null;
    while (true) {
      var url = '/api/me/match-history?format=json&limit=1000&source=matchmaking';
      if (cursor) url += '&cursor=' + encodeURIComponent(cursor);
      var resp = await fetch(url);
      if (!resp.ok) break;
      var data = await resp.json();
      var games = data.games || [];
      allGames = allGames.concat(games);
      if (!data.next_cursor || games.length === 0) break;
      cursor = data.next_cursor;
    }
    cachedAllGames = allGames;
    return allGames;
  }

  function groupGamesByDeck(allGames) {
    var savedNames = getDeckNames();
    var decks = {};
    allGames.forEach(function(g) {
      var colors = g.your_deck_colors || '?';
      var deckId = g.your_deck_id || g.deck_id || null;
      var key = deckId || colors;
      if (!decks[key]) {
        decks[key] = { key: key, colors: colors, deckId: deckId, gameList: [], wins: 0 };
      }
      decks[key].gameList.push({ game_id: g.game_id, your_player: g.your_player, result: g.result });
      if (g.result === 'win') decks[key].wins++;
    });
    var arr = Object.values(decks).sort(function(a, b) { return b.gameList.length - a.gameList.length; });
    arr.forEach(function(d) {
      d.customName = d.deckId ? (savedNames[d.deckId] || null) : null;
    });
    return arr;
  }

  async function analyse(gameList, c1, c2, deckLabel) {
    setStatus('Recuperation de ' + gameList.length + ' gamelogs...');
    var allIds = gameList.map(function(g){ return g.game_id; });
    var manifestResp = await fetch('/api/me/bulk-gamelogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: allIds }),
    });
    var manifest = await manifestResp.json();
    var gameLookup = {};
    gameList.forEach(function(g){ gameLookup[g.game_id] = g; });
    (manifest.files || []).forEach(function(f){ if (gameLookup[f.id]) gameLookup[f.id].url = f.url; });
    var gameListWithUrl = gameList.filter(function(g){ return g.url; });
    if (gameListWithUrl.length === 0) {
      setStatus('Impossible de recuperer les gamelogs.');
      return;
    }
    var inkStats = {}, playStats = {}, cardWS = {};
    var processed = 0, wins = 0;
    for (var i = 0; i < gameListWithUrl.length; i += 5) {
      var batch = gameListWithUrl.slice(i, i + 5);
      var results = await Promise.all(batch.map(function(g){ return fetchGamelog(g.url); }));
      results.forEach(function(data, idx) {
        if (!data) return;
        var game = batch[idx];
        var myPlayer = game.your_player;
        var won = game.result === 'win';
        processed++;
        if (won) wins++;
        var myCardTurns = [];
        Object.values(data).forEach(function(e) {
          if (e.player === myPlayer && (e.type === 'CARD_INKED' || e.type === 'CARD_PLAYED') && e.turnNumber) {
            if (myCardTurns.indexOf(e.turnNumber) === -1) myCardTurns.push(e.turnNumber);
          }
        });
        myCardTurns.sort(function(a,b){ return b - a; });
        var excludedTurns = excludeLastTurns > 0 ? myCardTurns.slice(0, excludeLastTurns) : [];
        Object.values(data).forEach(function(entry) {
          if (entry.player !== myPlayer) return;
          if (excludedTurns.length > 0 && excludedTurns.indexOf(entry.turnNumber) !== -1) return;
          var name = entry.data && entry.data.cardName;
          if (!name) return;
          if (!cardWS[name]) cardWS[name] = { iW:0, iG:0, pW:0, pG:0 };
          if (entry.type === 'CARD_INKED') {
            inkStats[name] = (inkStats[name] || 0) + 1;
            cardWS[name].iG++; if (won) cardWS[name].iW++;
          } else if (entry.type === 'CARD_PLAYED') {
            playStats[name] = (playStats[name] || 0) + 1;
            cardWS[name].pG++; if (won) cardWS[name].pW++;
          }
        });
      });
      setStatus((Math.min(i + 5, gameListWithUrl.length)) + ' / ' + gameListWithUrl.length + ' parties analysees...');
    }
    if (processed === 0) { setStatus('Aucune partie analysee.'); return; }
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
    showResults(rows, processed, wins, c1, c2, excludeLastTurns, deckLabel);
  }

  // ── Export PNG ─────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawBar(ctx, x, y, w, h, val, max, color, label) {
    var barW = w - 30;
    var pct = max > 0 ? val / max : 0;
    ctx.fillStyle = '#21262d';
    roundRect(ctx, x, y + h / 2 - 3, barW, 6, 3);
    ctx.fill();
    if (pct > 0) {
      ctx.fillStyle = color;
      roundRect(ctx, x, y + h / 2 - 3, Math.max(4, barW * pct), 6, 3);
      ctx.fill();
    }
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(label), x + w - 2, y + h / 2 + 4);
    ctx.textAlign = 'left';
  }

  function drawBadge(ctx, x, y, w, h, val) {
    var bg, col;
    if (val === null || val === undefined) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('-', x + w / 2, y + h / 2 + 4);
      ctx.textAlign = 'left';
      return;
    }
    if (val >= 70)      { bg = 'rgba(46,160,67,.25)';  col = '#3fb950'; }
    else if (val >= 50) { bg = 'rgba(210,153,34,.25)'; col = '#d29922'; }
    else                { bg = 'rgba(248,81,73,.25)';  col = '#f85149'; }
    ctx.fillStyle = bg;
    roundRect(ctx, x + 4, y + 2, w - 8, h - 4, 5);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(val + '%', x + w / 2, y + h / 2 + 4);
    ctx.textAlign = 'left';
  }

  function exportImage(rows, games, wins, c1, c2, deckLabel) {
    var hasColors = c1 && c2 && COLORS[c1] && COLORS[c2];
    var DPR = 2;
    var W = 700;
    var COL_NAME = 16, COL_INK = 230, COL_PLAY = 370, COL_PCT = 510, COL_WR = 600;
    var ROW_H = 28, HEADER_H = 110, TABLE_HEAD_H = 30, LEGEND_H = 22, FOOTER_H = 36;
    var H = HEADER_H + TABLE_HEAD_H + rows.length * ROW_H + LEGEND_H + FOOTER_H;

    var canvas = document.createElement('canvas');
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    var ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    var col1hex = hasColors ? COLORS[c1].hex : '#58a6ff';
    var col2hex = hasColors ? COLORS[c2].hex : '#3fb950';
    var grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, col1hex + '33');
    grad.addColorStop(1, col2hex + '33');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, HEADER_H);

    ctx.fillStyle = col1hex; ctx.fillRect(0, 0, 4, HEADER_H / 2);
    ctx.fillStyle = col2hex; ctx.fillRect(0, HEADER_H / 2, 4, HEADER_H / 2);

    if (hasColors) {
      ctx.beginPath(); ctx.arc(28, 38, 11, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[c1].hex; ctx.fill();
      ctx.beginPath(); ctx.arc(50, 38, 11, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[c2].hex; ctx.fill();
    }

    var titleStr = hasColors ? (COLORS[c1].name + ' / ' + COLORS[c2].name) : (deckLabel || 'Deck');
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText(titleStr, hasColors ? 72 : 16, 46);
    if (deckLabel && hasColors) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(deckLabel, 72, 66);
      ctx.fillText('Lorcana Stats  -  duels.ink', 72, 82);
    } else {
      ctx.fillStyle = '#8b949e';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Lorcana Stats  -  duels.ink', hasColors ? 72 : 16, 64);
    }

    var wr = Math.round(wins / games * 100);
    var stats = [
      { l: 'Parties',   v: String(games) },
      { l: 'Winrate',   v: wr + '%', hi: true },
      { l: 'Victoires', v: String(wins) },
      { l: 'Defaites',  v: String(games - wins) },
    ];
    var pillW = 140, pillH = 40, pillY = HEADER_H - pillH - 12, gap = 8;
    var startX = W - stats.length * (pillW + gap) + gap - 8;
    stats.forEach(function(s, i) {
      var px = startX + i * (pillW + gap);
      ctx.fillStyle = '#161b22';
      roundRect(ctx, px, pillY, pillW, pillH, 7); ctx.fill();
      ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1;
      roundRect(ctx, px, pillY, pillW, pillH, 7); ctx.stroke();
      ctx.fillStyle = '#8b949e'; ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(s.l.toUpperCase(), px + 10, pillY + 14);
      ctx.fillStyle = s.hi ? (wr >= 60 ? '#3fb950' : wr >= 50 ? '#d29922' : '#f85149') : '#e6edf3';
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.fillText(s.v, px + 10, pillY + 32);
    });

    var ty = HEADER_H;
    ctx.fillStyle = '#161b22'; ctx.fillRect(0, ty, W, TABLE_HEAD_H);
    ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ty); ctx.lineTo(W, ty);
    ctx.moveTo(0, ty + TABLE_HEAD_H); ctx.lineTo(W, ty + TABLE_HEAD_H);
    ctx.stroke();
    ctx.font = '600 10px system-ui, sans-serif';
    [
      { t: 'CARTE',    x: COL_NAME, c: '#8b949e' },
      { t: 'ENCREE',   x: COL_INK,  c: '#E74C3C' },
      { t: 'JOUEE',    x: COL_PLAY, c: '#3498DB' },
      { t: '% ENC.',   x: COL_PCT,  c: '#8b949e' },
      { t: 'WR JOUE',  x: COL_WR,   c: '#8b949e' },
    ].forEach(function(h) {
      ctx.fillStyle = h.c;
      ctx.fillText(h.t, h.x, ty + 19);
    });

    var maxI = Math.max.apply(null, rows.map(function(r){ return r.inked; }));
    var maxP = Math.max.apply(null, rows.map(function(r){ return r.played; }));
    rows.forEach(function(r, idx) {
      var ry = ty + TABLE_HEAD_H + idx * ROW_H;
      ctx.fillStyle = idx % 2 === 0 ? '#0d1117' : '#0f1318';
      ctx.fillRect(0, ry, W, ROW_H);
      ctx.fillStyle = '#e6edf3'; ctx.font = '500 12px system-ui, sans-serif';
      var name = r.card.length > 30 ? r.card.substring(0, 29) + '.' : r.card;
      ctx.fillText(name, COL_NAME, ry + ROW_H / 2 + 4);
      drawBar(ctx, COL_INK,  ry + 4, 120, ROW_H - 8, r.inked,  maxI, '#E74C3C', r.inked);
      drawBar(ctx, COL_PLAY, ry + 4, 120, ROW_H - 8, r.played, maxP, '#3498DB', r.played);
      drawBadge(ctx, COL_PCT, ry + 4, 72, ROW_H - 8, r.inkRate);
      drawBadge(ctx, COL_WR,  ry + 4, 72, ROW_H - 8, r.pWR);
      ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, ry + ROW_H); ctx.lineTo(W, ry + ROW_H);
      ctx.stroke();
    });

    var legendY = H - FOOTER_H - 12;
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('% enc. = encree / (encree + jouee)   |   WR joue = winrate dans les parties ou la carte a ete jouee', 16, legendY);

    var fy = H - FOOTER_H;
    ctx.fillStyle = '#161b22'; ctx.fillRect(0, fy, W, FOOTER_H);
    ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
    ctx.fillStyle = '#8b949e'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('flaxeau.github.io/lorcana-stats  |  Outil non-officiel, non affilie a Ravensburger ou Disney', 16, fy + 22);

    canvas.toBlob(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var fname = (c1 && c2) ? ('lorcana-' + c1 + '-' + c2) : 'lorcana-deck';
      a.download = fname + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  // ── Panel ──────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = 'lrc-bm-panel';
  panel.style.cssText = 'position:fixed;top:0;right:0;width:480px;height:100vh;z-index:2147483647;background:#161b22;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:-4px 0 24px rgba(0,0,0,.6);display:flex;flex-direction:column;font-size:13px';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'padding:14px 16px;border-bottom:1px solid #30363d;display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
  hdr.innerHTML = '<span style="font-weight:600;font-size:15px">&#x1F4CA; Lorcana Stats</span><button id="lrc-close" style="background:none;border:none;color:#8b949e;font-size:20px;cursor:pointer;line-height:1;padding:2px 4px">x</button>';

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
    if (r === null || r === undefined) return '<span style="color:#8b949e">-</span>';
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

  function showResults(rows, games, wins, c1, c2, filterTurns, deckLabel) {
    var hasColors = c1 && c2 && COLORS[c1] && COLORS[c2];
    var wr = Math.round(wins / games * 100);
    var totalInk  = rows.reduce(function(s, r){ return s + r.inked; }, 0);
    var totalPlay = rows.reduce(function(s, r){ return s + r.played; }, 0);
    var maxI = rows.length > 0 ? Math.max.apply(null, rows.map(function(r){ return r.inked; })) : 0;
    var maxP = rows.length > 0 ? Math.max.apply(null, rows.map(function(r){ return r.played; })) : 0;

    var titleHtml = hasColors
      ? (dot(c1) + COLORS[c1].name + ' / ' + dot(c2) + COLORS[c2].name)
      : (deckLabel || 'Deck');

    var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">'
      + '<button id="lrc-back" style="background:none;border:1px solid #30363d;border-radius:6px;color:#8b949e;padding:4px 10px;cursor:pointer;font-size:12px">&larr; Retour</button>'
      + '<span style="font-weight:500;font-size:14px;flex:1">' + titleHtml + '</span>'
      + '<button id="lrc-export" style="background:#238636;border:none;border-radius:6px;color:#fff;padding:5px 12px;cursor:pointer;font-size:12px;font-weight:600">&#x2B07; Export PNG</button>'
      + (filterTurns > 0 ? '<span style="background:#1f3a4a;color:#58a6ff;border-radius:5px;padding:3px 8px;font-size:11px;margin-left:4px">-' + filterTurns + ' dernier' + (filterTurns > 1 ? 's' : '') + ' tour' + (filterTurns > 1 ? 's' : '') + '</span>' : '')
      + '</div>';

    if (deckLabel) {
      html += '<div style="font-size:12px;color:#8b949e;margin-bottom:10px;margin-top:-8px">' + deckLabel + '</div>';
    }

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">';
    [['Parties', games, ''], ['Winrate', wr + '%', wins + 'V - ' + (games - wins) + 'D'],
     ['Encrages', totalInk, ''], ['Jeux de cartes', totalPlay, '']].forEach(function(m) {
      html += '<div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 12px">'
        + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#8b949e;margin-bottom:3px">' + m[0] + '</div>'
        + '<div style="font-size:20px;font-weight:600">' + m[1] + '</div>'
        + (m[2] ? '<div style="font-size:10px;color:#8b949e;margin-top:1px">' + m[2] + '</div>' : '')
        + '</div>';
    });
    html += '</div>';

    html += '<div style="display:flex;gap:12px;margin-bottom:8px;font-size:10px;color:#8b949e;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:6px 10px;flex-wrap:wrap">'
      + '<span><span style="color:#E74C3C;font-weight:600">Encree</span> = fois encree</span>'
      + '<span><span style="color:#3498DB;font-weight:600">Jouee</span> = fois jouee</span>'
      + '<span><span style="font-weight:600;color:#e6edf3">% enc.</span> = encree / (encree+jouee)</span>'
      + '<span><span style="font-weight:600;color:#e6edf3">WR joue</span> = winrate quand jouee</span>'
      + '</div>';

    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">'
      + '<thead><tr style="border-bottom:1px solid #30363d">'
      + '<th style="text-align:left;padding:6px 4px;color:#8b949e;font-weight:500">Carte</th>'
      + '<th style="padding:6px 4px;color:#E74C3C;font-weight:500;min-width:80px">Encree</th>'
      + '<th style="padding:6px 4px;color:#3498DB;font-weight:500;min-width:80px">Jouee</th>'
      + '<th style="padding:6px 4px;color:#8b949e;font-weight:500;text-align:center" title="Taux d\'encrage">% enc.</th>'
      + '<th style="padding:6px 4px;color:#8b949e;font-weight:500;text-align:center" title="Winrate quand jouee">WR joue</th>'
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
    html += kofiBtn();
    body.innerHTML = html;
    document.getElementById('lrc-back').onclick = showDeckSelector;
    document.getElementById('lrc-export').onclick = function() {
      exportImage(rows, games, wins, c1, c2, deckLabel);
    };
  }

  async function showDeckSelector() {
    if (!cachedAllGames) setStatus('Chargement de l\'historique...');
    var allGames = await fetchAllMatchHistory();
    var decks = groupGamesByDeck(allGames);

    if (decks.length === 0) {
      setStatus('Aucune partie trouvee dans l\'historique.');
      return;
    }

    var html = filterHtmlFn();
    html += '<p style="color:#8b949e;margin:0 0 14px;line-height:1.6;font-size:13px">Choisis un deck pour voir les stats de tes cartes encrees et jouees.</p>';
    html += '<div style="display:flex;flex-direction:column;gap:8px">';

    decks.forEach(function(deck) {
      var wr = Math.round(deck.wins / deck.gameList.length * 100);
      var parts = deck.colors.split('/');
      var colorDots = parts.map(function(c) { return dot(API_TO_KEY[c.trim()]); }).join('');
      var colorLabel = parts.map(function(c) {
        var k = API_TO_KEY[c.trim()];
        return k ? COLORS[k].name : c;
      }).join(' / ');
      var displayName = deck.customName || colorLabel;
      var subLabel = deck.customName ? colorLabel : (deck.deckId ? ('[' + shortId(deck.deckId) + ']') : '');

      html += '<div style="display:flex;align-items:stretch;gap:4px">'
        + '<button class="lrc-deck-btn" data-key="' + deck.key + '"'
        + ' style="flex:1;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:10px 12px;cursor:pointer;text-align:left;font-size:12px;display:flex;align-items:center;gap:8px">'
        + colorDots
        + '<span style="flex:1">'
        + '<span style="font-weight:500;display:block">' + displayName + '</span>'
        + (subLabel ? '<span style="font-size:10px;color:#8b949e">' + subLabel + '</span>' : '')
        + '</span>'
        + '<span style="color:#8b949e;font-size:11px;white-space:nowrap">' + deck.gameList.length + ' parties</span>'
        + '<span style="color:' + (wr >= 50 ? '#3fb950' : '#f85149') + ';font-size:11px;font-weight:600;margin-left:6px;white-space:nowrap">WR ' + wr + '%</span>'
        + '</button>'
        + (deck.deckId ? '<button class="lrc-rename-btn" data-deckid="' + deck.deckId + '" data-current="' + (deck.customName || '') + '"'
          + ' style="background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#8b949e;padding:0 10px;cursor:pointer;font-size:14px" title="Renommer ce deck">&#x270F;</button>' : '')
        + '</div>';
    });

    html += '</div>';
    html += kofiBtn();
    body.innerHTML = html;

    var deckMap = {};
    decks.forEach(function(d) { deckMap[d.key] = d; });

    body.querySelectorAll('.lrc-filter-btn').forEach(function(btn) {
      btn.onclick = function() {
        excludeLastTurns = parseInt(this.getAttribute('data-val'));
        showDeckSelector();
      };
    });

    body.querySelectorAll('.lrc-rename-btn').forEach(function(btn) {
      btn.onclick = function(e) {
        e.stopPropagation();
        var deckId = this.getAttribute('data-deckid');
        var current = this.getAttribute('data-current');
        var newName = prompt('Nom pour ce deck (laisser vide pour effacer) :', current);
        if (newName === null) return;
        saveDeckName(deckId, newName.trim());
        cachedAllGames = null;
        showDeckSelector();
      };
    });

    body.querySelectorAll('.lrc-deck-btn').forEach(function(btn) {
      btn.onmouseenter = function(){ this.style.borderColor = '#3498DB'; };
      btn.onmouseleave = function(){ this.style.borderColor = '#30363d'; };
      btn.onclick = function() {
        var key = this.getAttribute('data-key');
        var deck = deckMap[key];
        if (!deck) return;
        var parts = deck.colors.split('/');
        var c1 = API_TO_KEY[parts[0] ? parts[0].trim() : ''] || null;
        var c2 = API_TO_KEY[parts[1] ? parts[1].trim() : ''] || null;
        var deckLabel = deck.customName || null;
        analyse(deck.gameList, c1, c2, deckLabel);
      };
    });
  }

  showDeckSelector();
})();
