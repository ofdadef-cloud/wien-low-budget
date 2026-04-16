// Wien Low Budget – App Logic (v3: Video, Suggestions, i18n, Admin)
(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────
  let map;
  let markers = [];
  let activeCategories = new Set(['all']);
  let searchQuery = '';
  let currentView = 'map';
  let currentLang = localStorage.getItem('wlb-lang') || 'de';
  let favorites = JSON.parse(localStorage.getItem('wlb-favorites') || '[]');

  // ── i18n helper (Unified with i18n.js) ──────────────
  const t = (key) => (typeof I18N !== 'undefined' && I18N[currentLang]?.ui[key]) || (typeof I18N !== 'undefined' && I18N.de.ui[key]) || key;

  // ── DOM ──────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const mapContainer = $('map-view');
  const listContainer = $('list-view');
  const videoContainer = $('video-view');
  const favoritesContainer = $('favorites-view');
  const budgetContainer = $('budget-view');
  const listGrid = $('list-grid');
  const favGrid = $('fav-grid');
  const videoGrid = $('video-grid');
  const searchInput = $('search-input');
  const btnMap = $('btn-map');
  const btnList = $('btn-list');
  const btnVideos = $('btn-videos');
  const btnFavorites = $('btn-favorites');
  const btnBudget = $('btn-budget');
  const btnSuggest = $('btn-suggest');
  const favCountBadge = $('fav-count-badge');
  const categoryBar = $('category-bar');
  const locCount = $('loc-count');
  const detailPanel = $('detail-panel');
  const detailContent = $('detail-content');
  const detailClose = $('detail-close');
  const suggestModal = $('suggest-modal');
  const suggestClose = $('suggest-close');
  const suggestForm = $('suggest-form');
  const sugSuccess = $('sug-success');

  const langBtn = $('lang-btn');
  const langDropdown = $('lang-dropdown');


  // Get translated content for a location field
  function locText(loc, field) {
    if (currentLang !== 'de' && typeof CONTENT_TRANSLATIONS !== 'undefined') {
      const langTrans = CONTENT_TRANSLATIONS[currentLang];
      if (langTrans && langTrans[loc.id] && langTrans[loc.id][field] !== undefined && langTrans[loc.id][field] !== null) {
        return langTrans[loc.id][field];
      }
    }
    return loc[field] || '';
  }

  // Translate category label
  const catI18nKeys = { essen:'catEssen', bars:'catBars', museen:'catMuseen', unterkunft:'catUnterkunft', natur:'catNatur', einkaufen:'catEinkaufen', baeckerei:'catBaeckerei', kino:'catKino', cafe:'catCafe', transport:'catTransport' };
  function catLabel(catKey) {
    return t(catI18nKeys[catKey]) || CATEGORIES[catKey]?.label || catKey;
  }

  function updateAppI18n() {
    if (window.applyI18n) window.applyI18n(currentLang);
    renderCategoryChips();
    renderList();
    renderVideos();
    updateCount();
  }

  // ── Date formatting ──────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diffMs = Date.now() - d;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return t('today');
    if (diffDays === 1) return t('yesterday');
    if (diffDays < 7) return t('daysAgo').replace('{n}', diffDays);
    if (diffDays < 30) return t('weeksAgo').replace('{n}', Math.floor(diffDays / 7));
    if (diffDays < 365) return t('monthsAgo').replace('{n}', Math.floor(diffDays / 30));
    return t('yearsAgo').replace('{n}', Math.floor(diffDays / 365));
  }

  // ── Price Warning Detection ──────────────────────────
  function isExpensive(loc) {
    const pi = (loc.priceInfo || '').toLowerCase();
    const desc = (loc.description || '').toLowerCase();
    // Budget-friendly entries should never be flagged
    const budgetTags = ['günstig', 'gratis', 'stehplatz', 'lebensmittelrettung', 'sparticket', 'ermäßigung'];
    if (loc.tags && loc.tags.some(t => budgetTags.includes(t))) return false;
    if (pi.includes('gratis') || pi.includes('wert:') || pi.includes('spart')) return false;
    // Check for keywords
    if (pi.includes('teuer') || desc.includes('teuer') || desc.includes('touristenfalle') || pi.includes('touristenfalle')) return true;
    // Check for prices ≥ 15€
    const priceMatches = (loc.priceInfo || '').match(/(\d+[,.]?\d*)\s*€/g);
    if (priceMatches) {
      for (const m of priceMatches) {
        const val = parseFloat(m.replace(',', '.').replace('€', ''));
        if (val >= 15) return true;
      }
    }
    return false;
  }

  function priceWarningHTML(loc, style) {
    if (!isExpensive(loc)) return '';
    if (style === 'card') {
      return `<div class="loc-card-warning">⚠️ Achtung: Vergleichsweise teuer!</div>`;
    }
    if (style === 'badge') {
      return `<span class="popup-badge expensive">⚠️ Eher teuer – Budget-Alternative suchen!</span>`;
    }
    return `<div class="price-warning">⚠️ Achtung: Vergleichsweise teuer!</div>`;
  }

  // ── Deal Badges ────────────────────────────────────
  const DEAL_INFO = {
    thefork:    { icon: '🍴', label: 'TheFork', desc: 'Bis 50% Rabatt via TheFork App', color: '#00A86B', link: 'https://www.thefork.at/' },
    neotaste:   { icon: '🌟', label: 'Neotaste', desc: '2-für-1 Deals via Neotaste App', color: '#8B5CF6', link: 'https://www.neotaste.com/' },
    toogoodtogo:{ icon: '🥡', label: 'Too Good To Go', desc: 'Überraschungstüten ab 3 €', color: '#0D9488', link: 'https://www.toogoodtogo.com/' }
  };

  function dealsHTML(loc, style) {
    if (!loc.deals || !loc.deals.length) return '';
    const badges = loc.deals.map(d => {
      const info = DEAL_INFO[d];
      if (!info) return '';
      if (style === 'popup' || style === 'detail') {
        return `<a href="${info.link}" target="_blank" rel="noopener" class="deal-badge" style="--deal-color:${info.color}" title="${info.desc}">${info.icon} ${info.label} <span class="deal-hint">${info.desc}</span></a>`;
      }
      return `<span class="deal-chip" style="--deal-color:${info.color}" title="${info.desc}">${info.icon} ${info.label}</span>`;
    }).join('');
    if (style === 'card') return `<div class="deal-chips">${badges}</div>`;
    return `<div class="deal-badges">${badges}</div>`;
  }

  // ── Daily Deals (Heute!) ─────────────────────────────
  function dailyDealLiveHTML(loc, style) {
    if (!loc.dailyDeals) return '';
    const todayNum = new Date().getDay();
    const dealStr = loc.dailyDeals[todayNum];
    if (!dealStr) return '';
    if (style === 'card') {
      return `<div class="deal-badge-live">🔥 Heute: ${dealStr}</div>`;
    }
    return `<div class="popup-badge deal-live" style="background:linear-gradient(135deg,#ff3d00,#ff9100);color:#fff;border:none;">🔥 Heute: ${dealStr}</div>`;
  }

  // ── Suggestion Storage ───────────────────────────────
  function getSuggestions() {
    try { return JSON.parse(localStorage.getItem('wlb-suggestions') || '[]'); }
    catch { return []; }
  }
  function saveSuggestions(arr) {
    localStorage.setItem('wlb-suggestions', JSON.stringify(arr));
  }

  // ── Favorites ─────────────────────────────────────────
  function isFavorite(id) { return favorites.includes(id); }

  function toggleFavorite(id) {
    if (isFavorite(id)) {
      favorites = favorites.filter(f => f !== id);
    } else {
      favorites.push(id);
    }
    localStorage.setItem('wlb-favorites', JSON.stringify(favorites));
    updateFavBadge();
    renderList();
    if (currentView === 'favorites') renderFavorites();
  }

  function updateFavBadge() {
    if (!favCountBadge) return;
    if (favorites.length > 0) {
      favCountBadge.textContent = favorites.length;
      favCountBadge.style.display = 'inline-flex';
    } else {
      favCountBadge.style.display = 'none';
    }
  }

  function favBtnHTML(locId, style) {
    const active = isFavorite(locId);
    if (style === 'card') {
      return `<button class="fav-btn${active ? ' active' : ''}" data-fav-id="${locId}" title="${active ? 'Entfernen' : 'Merken'}">${active ? '❤' : '♡'}</button>`;
    }
    return `<button class="fav-btn-popup${active ? ' active' : ''}" onclick="event.stopPropagation(); document.dispatchEvent(new CustomEvent('toggle-fav',{detail:${locId}}))" title="${active ? 'Entfernen' : 'Merken'}">${active ? '❤ Gemerkt' : '♡ Merken'}</button>`;
  }

  function renderFavorites() {
    if (!favGrid) return;
    const favLocs = LOCATIONS.filter(l => favorites.includes(l.id));
    if (!favLocs.length) {
      favGrid.innerHTML = `<div class="no-results">♡<h3>Noch keine Favoriten</h3><p>Tippe auf das ♡ bei einem Ort, um ihn hier zu speichern.</p></div>`;
      return;
    }
    favGrid.innerHTML = favLocs.map(loc => {
      const cat = CATEGORIES[loc.category];
      if (!cat) return '';
      const desc = locText(loc, 'description');
      const price = locText(loc, 'priceInfo');
      return `<div class="loc-card" data-id="${loc.id}" style="--card-accent:${cat.color}">
        ${favBtnHTML(loc.id, 'card')}
        <div class="loc-card-header">
          <div class="loc-card-icon" style="background:${cat.color}22; color:${cat.color}; display:flex; align-items:center; justify-content:center; font-size:24px;">
            ${cat.icon}
          </div>
          <div class="loc-card-title"><h3>${loc.name}</h3><span class="card-category" style="color:${cat.color}">${catLabel(loc.category)}</span></div>
        </div>
        <div class="loc-card-address">📍 ${loc.address}, ${loc.district}</div>
        <div class="loc-card-desc">${desc}</div>
        <div class="loc-card-footer">
          ${price ? `<span class="loc-card-badge price">💰 ${price}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ── Budget Calculator ─────────────────────────────────
  function parsePrice(priceStr) {
    if (!priceStr) return null;
    // Extract the first number from strings like "Ab ~24 €" or "6,50 – 9,50 €"
    const matches = priceStr.match(/([\d]+[,.]?[\d]*)/);
    if (matches) return parseFloat(matches[1].replace(',', '.'));
    return null;
  }

  function initBudgetCalculator() {
    const selUnterkunft = $('budget-unterkunft');
    const selEssen1 = $('budget-essen1');
    const selEssen2 = $('budget-essen2');
    const selAktivitaet = $('budget-aktivitaet');
    const selTransport = $('budget-transport');
    if (!selUnterkunft) return;

    // Populate dropdowns from LOCATIONS
    const unterkunftOpts = LOCATIONS.filter(l => l.category === 'unterkunft');
    const essenOpts = LOCATIONS.filter(l => ['essen','cafe','baeckerei'].includes(l.category));
    const aktivitaetOpts = LOCATIONS.filter(l => ['museen','natur','kino','einkaufen'].includes(l.category));

    function populateSelect(sel, locs, placeholder) {
      sel.innerHTML = `<option value="">${placeholder}</option>`;
      locs.forEach(l => {
        const p = parsePrice(l.priceInfo);
        const priceLabel = p !== null ? ` (≈${p.toFixed(0)}€)` : '';
        sel.innerHTML += `<option value="${l.id}">${l.name}${priceLabel}</option>`;
      });
    }

    populateSelect(selUnterkunft, unterkunftOpts, '🛌 Wähle Unterkunft...');
    populateSelect(selEssen1, essenOpts, '🍕 Wähle Essen #1...');
    populateSelect(selEssen2, essenOpts, '☕ Wähle Essen #2...');
    populateSelect(selAktivitaet, aktivitaetOpts, '🏛️ Wähle Aktivität...');

    function calculate() {
      let total = 0;
      let filled = 0;

      [selUnterkunft, selEssen1, selEssen2, selAktivitaet].forEach((sel, i) => {
        const priceEl = $(['bp-unterkunft','bp-essen1','bp-essen2','bp-aktivitaet'][i]);
        if (sel.value) {
          const loc = LOCATIONS.find(l => l.id === parseInt(sel.value) || l.id === sel.value);
          const p = loc ? parsePrice(loc.priceInfo) : null;
          if (p !== null) {
            total += p;
            filled++;
            priceEl.textContent = `${p.toFixed(2).replace('.', ',')} €`;
            priceEl.classList.add('has-value');
          } else {
            priceEl.textContent = 'gratis?';
            priceEl.classList.add('has-value');
            filled++;
          }
        } else {
          priceEl.textContent = '–';
          priceEl.classList.remove('has-value');
        }
      });

      // Transport
      const transportPrice = parseFloat(selTransport.value) || 0;
      total += transportPrice;
      $('bp-transport').textContent = `${transportPrice.toFixed(2).replace('.', ',')} €`;
      $('bp-transport').classList.add('has-value');

      const totalEl = $('budget-total');
      const verdictEl = $('budget-verdict');

      if (filled > 0) {
        totalEl.textContent = `${total.toFixed(2).replace('.', ',')} €`;
        totalEl.classList.add('visible');

        // Verdict
        if (total < 30) {
          verdictEl.innerHTML = '🌟 <strong>Ultra-Budget!</strong> Wien kann so günstig sein!';
          verdictEl.className = 'budget-verdict verdict-great';
        } else if (total < 50) {
          verdictEl.innerHTML = '✅ <strong>Sehr gut!</strong> Ein toller Tag unter 50€.';
          verdictEl.className = 'budget-verdict verdict-good';
        } else if (total < 80) {
          verdictEl.innerHTML = '👍 <strong>Solide!</strong> Ein normaler Budget-Tag.';
          verdictEl.className = 'budget-verdict verdict-ok';
        } else {
          verdictEl.innerHTML = '💸 <strong>Eher teuer.</strong> Schau nach günstigeren Alternativen!';
          verdictEl.className = 'budget-verdict verdict-pricey';
        }
      } else {
        totalEl.textContent = '–';
        totalEl.classList.remove('visible');
        verdictEl.className = 'budget-verdict';
        verdictEl.innerHTML = '';
      }
    }

    [selUnterkunft, selEssen1, selEssen2, selAktivitaet, selTransport].forEach(sel => {
      sel.addEventListener('change', calculate);
    });

    // Initial calculation
    calculate();
  }

  // ── Initialize ─────────────────────────────────────────
  function init() {
    initMap();
    if (window.initLanguageSwitcher) {
      window.initLanguageSwitcher('lang-selector', (lang) => {
        currentLang = lang;
        updateAppI18n();
      });
    }
    bindEvents();
    renderCategoryChips();
    renderMarkers();
    renderList();
    renderVideos();
    updateFavBadge();
    initBudgetCalculator();
    updateAppI18n();
  }

  // ── Map ──────────────────────────────────────────────
  function initMap() {
    map = L.map('map', {
      center: [48.2082, 16.3738], zoom: 13,
      zoomControl: false, attributionControl: true
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
  }

  // ── Category Chips ───────────────────────────────────
  function renderCategoryChips() {
    let html = `<button class="category-chip chip-all${activeCategories.has('all') ? ' active' : ''}" data-cat="all">
      <span class="chip-icon">🗂️</span> ${t('all')}
    </button>`;
    const catKeys = Object.keys(CATEGORIES);
    catKeys.forEach((key) => {
      const cat = CATEGORIES[key];
      const active = activeCategories.has(key) ? ' active' : '';
      html += `<button class="category-chip${active}" data-cat="${key}" style="--chip-color: ${cat.color}">
        <span class="chip-icon">${cat.icon}</span> ${catLabel(key)}
      </button>`;
    });
    categoryBar.innerHTML = html;
  }

  // ── Markers ──────────────────────────────────────────
  function renderMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    getFilteredLocations().forEach(loc => {
      const cat = CATEGORIES[loc.category];
      if (!cat) return;
      const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div class="marker-pin" style="background:${cat.color}">
                 <span style="color:white; font-size:18px;">${cat.icon}</span>
               </div>
               <div class="marker-arrow" style="border-top-color:${cat.color}"></div>`,
        iconSize: [36, 46],
        iconAnchor: [18, 46],
        popupAnchor: [0, -42]
      });
      const m = L.marker([loc.lat, loc.lng], { icon: customIcon })
        .addTo(map)
        .bindPopup(() => createPopup(loc), { maxWidth: 320, minWidth: 260, className: 'custom-popup' });
      markers.push(m);
    });
  }

  function createPopup(loc) {
    const cat = CATEGORIES[loc.category];
    const dateLabel = formatDate(loc.lastUpdated);
    const desc = locText(loc, 'description');
    const price = locText(loc, 'priceInfo');
    const tips = locText(loc, 'tips');
    let h = `<div class="custom-popup">
      <div class="popup-header">
        <div class="popup-icon" style="background:${cat.color}; color:#fff; display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; font-size:20px;">
          ${cat.icon}
        </div>
        <div>
          <div class="popup-title">${loc.name}</div>
          <div class="popup-category" style="color: ${cat.color}">${catLabel(loc.category)}</div>
        </div>
      </div>
      <div class="popup-body">
        <div class="popup-address">📍 ${loc.address}, ${loc.district}</div>
        <div class="popup-description">${desc}</div>
        <div class="popup-meta">`;
    if (price) h += `<span class="popup-badge${isExpensive(loc) ? ' expensive' : ' price'}">💰 ${price}</span>`;
    if (loc.openingHours) h += `<span class="popup-badge hours">🕐 ${loc.openingHours}</span>`;
    h += `</div>`;
    h += priceWarningHTML(loc, 'badge');
    if (tips) h += `<div class="popup-badge tip">💡 ${tips}</div>`;
    h += dealsHTML(loc, 'popup');
    h += dailyDealLiveHTML(loc, 'popup');
    if (dateLabel) h += `<div class="popup-badge updated">🔄 ${dateLabel}</div>`;
    if (loc.website) h += `<a href="${loc.website}" target="_blank" rel="noopener" class="popup-website">🌐 ${t('visitWebsite')}</a>`;
    h += favBtnHTML(loc.id, 'popup');
    return h + '</div>';
  }

  // ── List ─────────────────────────────────────────────
  function renderList() {
    const filtered = getFilteredLocations();
    if (!filtered.length) {
      listGrid.innerHTML = `<div class="no-results">🔍<h3>${t('noResults')}</h3><p>${t('noResultsHint')}</p></div>`;
      return;
    }
    listGrid.innerHTML = filtered.map(loc => {
      const cat = CATEGORIES[loc.category];
      if (!cat) return '';
      const dateLabel = formatDate(loc.lastUpdated);
      const desc = locText(loc, 'description');
      const price = locText(loc, 'priceInfo');
      return `<div class="loc-card" data-id="${loc.id}" style="--card-accent:${cat.color}">
        ${favBtnHTML(loc.id, 'card')}
        <div class="loc-card-header">
          <div class="loc-card-icon" style="background:${cat.color}22; color:${cat.color}; display:flex; align-items:center; justify-content:center; font-size:24px;">
            ${cat.icon}
          </div>
          <div class="loc-card-title"><h3>${loc.name}</h3><span class="card-category" style="color:${cat.color}">${catLabel(loc.category)}</span></div>
        </div>
        <div class="loc-card-address">📍 ${loc.address}, ${loc.district}</div>
        <div class="loc-card-desc">${desc}</div>
        <div class="loc-card-footer">
          ${price ? `<span class="loc-card-badge${isExpensive(loc) ? ' expensive-badge' : ' price'}">💰 ${price}</span>` : ''}
          ${loc.openingHours ? `<span class="loc-card-badge hours">🕐 ${loc.openingHours}</span>` : ''}
        </div>
        ${priceWarningHTML(loc, 'card')}
        ${dealsHTML(loc, 'card')}
        ${dailyDealLiveHTML(loc, 'card')}
        ${dateLabel ? `<div class="loc-card-updated">🔄 ${dateLabel}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ── Videos ───────────────────────────────────────────
  function renderVideos() {
    if (!videoGrid || typeof VIDEO_GUIDES === 'undefined') return;
    const q = searchQuery.toLowerCase();
    const filtered = VIDEO_GUIDES.filter(v => !q ||
      v.title.toLowerCase().includes(q) || v.description.toLowerCase().includes(q) ||
      v.topic.toLowerCase().includes(q) || v.tags.some(t => t.includes(q)));
    if (!filtered.length) {
      videoGrid.innerHTML = `<div class="no-results">🎬<h3>${t('noVideos')}</h3><p>${t('noResultsHint')}</p></div>`;
      return;
    }
    const colors = { anreise:'#00BCD4', 'sehenswürdigkeiten':'#4CAF50', allgemein:'#D4A84B', museen:'#6B4C9A', transport:'#00BCD4', essen:'#E8734A' };
    videoGrid.innerHTML = filtered.map(v => {
      const c = colors[v.topic] || '#D4A84B';
      return `<div class="video-card" data-search="${encodeURIComponent(v.searchQuery)}">
        <div class="video-thumbnail" style="--accent:${c}"><div class="video-play-btn">▶</div><div class="video-duration">${v.duration}</div></div>
        <div class="video-info">
          <div class="video-topic" style="color:${c}">${v.topic.toUpperCase()}</div>
          <h3 class="video-title">${v.title}</h3>
          <p class="video-desc">${v.description}</p>
          <div class="video-tags">${v.tags.map(t => `<span class="video-tag">#${t}</span>`).join('')}</div>
          <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.searchQuery)}" target="_blank" rel="noopener" class="video-search-link">🔍 ${t('searchYoutube')}</a>
        </div>
      </div>`;
    }).join('');
  }

  // ── Filter ───────────────────────────────────────────
  function getFilteredLocations() {
    const todayNum = new Date().getDay();
    return LOCATIONS.filter(loc => {
      let matchesCat = false;
      if (activeCategories.has('all')) {
        matchesCat = true;
      } else {
        if (activeCategories.has('deals') && loc.dailyDeals && loc.dailyDeals[todayNum]) matchesCat = true;
        if (activeCategories.has(loc.category)) matchesCat = true;
      }
      if (!matchesCat) return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return loc.name.toLowerCase().includes(q) || loc.description.toLowerCase().includes(q) ||
        loc.address.toLowerCase().includes(q) || loc.district.toLowerCase().includes(q) ||
        (loc.tags && loc.tags.some(t => t.toLowerCase().includes(q))) ||
        (loc.priceInfo && loc.priceInfo.toLowerCase().includes(q));
    });
  }

  function updateCount() {
    const f = getFilteredLocations();
    locCount.innerHTML = `<strong>${f.length}</strong> ${t('of')} ${LOCATIONS.length} ${t('locations')}`;
  }


  // Load previously accepted suggestions
  function loadAccepted() {
    try {
      const accepted = JSON.parse(localStorage.getItem('wlb-accepted') || '[]');
      accepted.forEach(loc => {
        if (!LOCATIONS.find(l => l.id === loc.id)) LOCATIONS.push(loc);
      });
    } catch {}
  }

  // ── Events ───────────────────────────────────────────
  function bindEvents() {
    btnMap.addEventListener('click', () => switchView('map'));
    btnList.addEventListener('click', () => switchView('list'));
    btnVideos.addEventListener('click', () => switchView('videos'));
    if (btnFavorites) btnFavorites.addEventListener('click', () => switchView('favorites'));
    if (btnBudget) btnBudget.addEventListener('click', () => switchView('budget'));
    btnSuggest.addEventListener('click', () => { suggestModal.classList.add('active'); sugSuccess.style.display = 'none'; });
    suggestClose.addEventListener('click', () => suggestModal.classList.remove('active'));

    // Favorite toggle via card button
    document.addEventListener('click', e => {
      const favBtn = e.target.closest('.fav-btn');
      if (favBtn) {
        e.stopPropagation();
        const id = parseInt(favBtn.dataset.favId);
        if (id) toggleFavorite(id);
      }
    });

    // Favorite toggle from popup
    document.addEventListener('toggle-fav', e => {
      toggleFavorite(e.detail);
      // Re-render popup markers
      renderMarkers();
    });
    suggestModal.addEventListener('click', e => { if (e.target === suggestModal) suggestModal.classList.remove('active'); });

    // Suggestion form
    suggestForm.addEventListener('submit', e => {
      e.preventDefault();
      const sug = {
        name: $('sug-name').value.trim(),
        category: $('sug-category').value,
        address: $('sug-address').value.trim(),
        district: $('sug-district').value.trim(),
        description: $('sug-desc').value.trim(),
        priceInfo: $('sug-price').value.trim(),
        openingHours: $('sug-hours').value.trim(),
        website: $('sug-website').value.trim(),
        author: $('sug-author').value.trim(),
        status: 'pending',
        submittedAt: new Date().toISOString()
      };
      const sugs = getSuggestions();
      sugs.push(sug);
      saveSuggestions(sugs);
      suggestForm.reset();
      sugSuccess.style.display = 'block';
      setTimeout(() => { sugSuccess.style.display = 'none'; }, 4000);
    });


    // Removed local language switcher events in favor of i18n.js initLanguageSwitcher

    // Search
    let timer;
    searchInput.addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => { searchQuery = e.target.value.trim(); refresh(); }, 200);
    });

    // Categories
    categoryBar.addEventListener('click', e => {
      const chip = e.target.closest('.category-chip');
      if (!chip) return;
      const cat = chip.dataset.cat;
      if (cat === 'all') {
        activeCategories.clear();
        activeCategories.add('all');
      } else {
        if (activeCategories.has('all')) activeCategories.delete('all');
        if (activeCategories.has(cat)) {
          activeCategories.delete(cat);
          if (activeCategories.size === 0) activeCategories.add('all');
        } else {
          activeCategories.add(cat);
        }
      }
      renderCategoryChips();
      if (currentView === 'videos') switchView('list');
      else refresh();
    });

    // List card click
    listGrid.addEventListener('click', e => {
      const card = e.target.closest('.loc-card');
      if (!card) return;
      const loc = LOCATIONS.find(l => l.id === parseInt(card.dataset.id));
      if (!loc) return;
      if (window.innerWidth <= 768) {
        showDetailPanel(loc);
      } else {
        switchView('map');
        setTimeout(() => {
          map.setView([loc.lat, loc.lng], 16, { animate: true });
          const idx = getFilteredLocations().findIndex(l => l.id === loc.id);
          if (idx >= 0 && markers[idx]) markers[idx].openPopup();
        }, 100);
      }
    });

    // Video card click
    videoGrid.addEventListener('click', e => {
      const card = e.target.closest('.video-card');
      const link = e.target.closest('.video-search-link');
      if (link) return; // let the <a> handle it
      if (card) {
        const search = decodeURIComponent(card.dataset.search);
        window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(search)}`, '_blank');
      }
    });

    if (detailClose) detailClose.addEventListener('click', hideDetailPanel);
    if (detailPanel) detailPanel.addEventListener('click', e => { if (e.target === detailPanel) hideDetailPanel(); });
  }

  function switchView(view) {
    currentView = view;
    mapContainer.style.display = 'none';
    listContainer.classList.remove('active');
    videoContainer.classList.remove('active');
    if (favoritesContainer) favoritesContainer.classList.remove('active');
    if (budgetContainer) budgetContainer.classList.remove('active');
    btnMap.classList.remove('active');
    btnList.classList.remove('active');
    btnVideos.classList.remove('active');
    if (btnFavorites) btnFavorites.classList.remove('active');
    if (btnBudget) btnBudget.classList.remove('active');
    locCount.style.display = 'none';
    categoryBar.style.display = (view === 'videos' || view === 'favorites' || view === 'budget') ? 'none' : 'flex';
    if (view === 'map') {
      mapContainer.style.display = 'block'; btnMap.classList.add('active');
      locCount.style.display = 'block'; setTimeout(() => map.invalidateSize(), 100);
    } else if (view === 'list') {
      listContainer.classList.add('active'); btnList.classList.add('active');
    } else if (view === 'videos') {
      videoContainer.classList.add('active'); btnVideos.classList.add('active');
      renderVideos();
    } else if (view === 'favorites') {
      favoritesContainer.classList.add('active'); btnFavorites.classList.add('active');
      renderFavorites();
    } else if (view === 'budget') {
      budgetContainer.classList.add('active'); btnBudget.classList.add('active');
    }
    // Show/hide OGD panel
    if (typeof updateOGDPanelVisibility === 'function') updateOGDPanelVisibility();
  }

  function refresh() { renderMarkers(); renderList(); renderVideos(); updateCount(); }

  function showDetailPanel(loc) {
    const cat = CATEGORIES[loc.category];
    const dateLabel = formatDate(loc.lastUpdated);
    const desc = locText(loc, 'description');
    const price = locText(loc, 'priceInfo');
    const tips = locText(loc, 'tips');
    let h = `<div class="popup-category" style="color:${cat.color}">${cat.icon} ${catLabel(loc.category)}</div>
      <div class="popup-name" style="font-size:22px">${loc.name}</div>
      <div class="popup-address" style="margin-bottom:12px">📍 ${loc.address}, ${loc.district}</div>
      <div class="popup-description" style="margin-bottom:14px">${desc}</div>
      <div class="popup-meta">`;
    if (price) h += `<span class="popup-badge${isExpensive(loc) ? ' expensive' : ' price'}">💰 ${price}</span>`;
    if (loc.openingHours) h += `<span class="popup-badge hours">🕐 ${loc.openingHours}</span>`;
    h += '</div>';
    h += priceWarningHTML(loc, 'warning');
    if (tips) h += `<div class="popup-badge tip" style="margin-top:10px">💡 ${tips}</div>`;
    h += dealsHTML(loc, 'detail');
    h += dailyDealLiveHTML(loc, 'popup');
    if (dateLabel) h += `<div class="popup-badge updated" style="margin-top:8px">🔄 ${dateLabel}</div>`;
    if (loc.website) h += `<a href="${loc.website}" target="_blank" rel="noopener" class="popup-website" style="margin-top:14px">🌐 ${t('visitWebsite')}</a>`;
    detailContent.innerHTML = h;
    detailPanel.classList.add('active');
  }
  function hideDetailPanel() { detailPanel.classList.remove('active'); }

  // ══════════════════════════════════════════════════════
  // ── OGD INTEGRATION (Stadt Wien Open Data) ───────────
  // ══════════════════════════════════════════════════════

  const ogdState = {
    activeLayers: new Set(),
    markerGroups: {},   // key -> L.markerClusterGroup or L.layerGroup
    loadedData: {},     // key -> parsed data array
    loading: new Set()  // currently loading keys
  };

  const ogdPanel = $('ogd-panel');
  const ogdToggleBtn = $('ogd-toggle-btn');
  const ogdDropdown = $('ogd-dropdown');
  const ogdLayersContainer = $('ogd-layers');

  // ── Render OGD Layer Toggles ────────────────────────
  function renderOGDPanel() {
    if (!ogdLayersContainer) return;
    const layers = OGD_WIEN.LAYERS;
    let html = '';
    for (const [key, layer] of Object.entries(layers)) {
      const isActive = ogdState.activeLayers.has(key);
      const isLoading = ogdState.loading.has(key);
      const count = ogdState.loadedData[key] ? ogdState.loadedData[key].length : null;
      html += `<div class="ogd-layer-row" data-layer="${key}">
        <div class="ogd-layer-icon" style="background: ${layer.color}22; color: ${layer.color}">
          ${layer.icon}
        </div>
        <div class="ogd-layer-info">
          <div class="ogd-layer-name">
            ${layer.label}
            ${count !== null ? `<span class="ogd-layer-count loaded">${count}</span>` : ''}
          </div>
          <div class="ogd-layer-desc">${layer.description}</div>
        </div>
        ${isLoading
          ? `<div class="ogd-layer-loading" style="--layer-color:${layer.color}"></div>`
          : `<label class="ogd-switch" style="--layer-color:${layer.color}">
              <input type="checkbox" data-ogd-layer="${key}" ${isActive ? 'checked' : ''}>
              <span class="ogd-switch-track"></span>
            </label>`
        }
      </div>`;
    }
    ogdLayersContainer.innerHTML = html;
  }

  // ── Toggle an OGD Layer ─────────────────────────────
  async function toggleOGDLayer(key) {
    const layer = OGD_WIEN.LAYERS[key];
    if (!layer) return;

    if (ogdState.activeLayers.has(key)) {
      // Deactivate
      ogdState.activeLayers.delete(key);
      if (ogdState.markerGroups[key]) {
        map.removeLayer(ogdState.markerGroups[key]);
      }
      updateOGDToggleBtn();
      renderOGDPanel();
      return;
    }

    // Activate – fetch data if not cached
    ogdState.loading.add(key);
    renderOGDPanel();

    try {
      if (!ogdState.loadedData[key]) {
        ogdState.loadedData[key] = await OGD_WIEN.fetchLayer(key);
      }

      const data = ogdState.loadedData[key];
      ogdState.activeLayers.add(key);
      createOGDMarkers(key, data, layer);
    } catch (err) {
      console.error(`OGD layer ${key} failed:`, err);
    } finally {
      ogdState.loading.delete(key);
      updateOGDToggleBtn();
      renderOGDPanel();
    }
  }

  // ── Create OGD Markers ──────────────────────────────
  function createOGDMarkers(key, data, layer) {
    // Remove existing layer group
    if (ogdState.markerGroups[key]) {
      map.removeLayer(ogdState.markerGroups[key]);
    }

    // Use cluster for large datasets (> 50 points)
    const useCluster = data.length > 50;
    let group;

    if (useCluster && typeof L.markerClusterGroup === 'function') {
      group = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          let size = 'small';
          if (count > 100) size = 'large';
          else if (count > 20) size = 'medium';
          return L.divIcon({
            html: `<div class="ogd-cluster ogd-cluster-${size}" style="background:${layer.color}">${count}</div>`,
            className: '',
            iconSize: L.point(size === 'large' ? 52 : size === 'medium' ? 44 : 36,
                              size === 'large' ? 52 : size === 'medium' ? 44 : 36)
          });
        }
      });
    } else {
      group = L.layerGroup();
    }

    const sizeClass = `ogd-marker-${layer.markerSize || 'small'}`;
    const iconSize = layer.markerSize === 'tiny' ? [18, 18] :
                     layer.markerSize === 'medium' ? [30, 30] : [24, 24];

    data.forEach(item => {
      if (!item.lat || !item.lng) return;
      const icon = L.divIcon({
        className: sizeClass,
        html: `<div class="ogd-marker-dot" style="background:${layer.color}; width:100%; height:100%">${layer.icon}</div>`,
        iconSize: iconSize,
        iconAnchor: [iconSize[0] / 2, iconSize[1] / 2],
        popupAnchor: [0, -iconSize[1] / 2]
      });

      const marker = L.marker([item.lat, item.lng], { icon });
      marker.bindPopup(() => createOGDPopup(key, item, layer), {
        maxWidth: 280,
        minWidth: 200,
        className: 'ogd-popup'
      });
      group.addLayer(marker);
    });

    group.addTo(map);
    ogdState.markerGroups[key] = group;
  }

  // ── Create OGD Popup Content ────────────────────────
  function createOGDPopup(key, item, layer) {
    let badges = '';
    let details = '';
    let links = '';

    switch (key) {
      case 'toiletten':
        if (item.address) details += `<div class="ogd-popup-detail">📍 ${item.address}${item.district ? ', ' + item.district : ''}</div>`;
        if (item.category) badges += `<span class="ogd-popup-badge type">${item.category}</span>`;
        if (item.hours) badges += `<span class="ogd-popup-badge hours">🕐 ${item.hours}</span>`;
        if (item.info) links += `<a href="${item.info}" target="_blank" rel="noopener" class="ogd-popup-link">ℹ️ Mehr Infos</a>`;
        break;

      case 'trinkbrunnen':
        if (item.type) badges += `<span class="ogd-popup-badge type">💧 ${item.type}</span>`;
        details += `<div class="ogd-popup-detail" style="color:#81C784">Gratis Trinkwasser! 🚰</div>`;
        break;

      case 'schwimmbad':
        if (item.address) details += `<div class="ogd-popup-detail">📍 ${item.address}</div>`;
        if (item.auslastung) {
          const isOpen = item.auslastung.toLowerCase() !== 'geschlossen';
          badges += `<span class="ogd-popup-badge ${isOpen ? 'status-open' : 'status-closed'}">${isOpen ? '🟢' : '🔴'} ${item.auslastung}</span>`;
        }
        if (item.website) links += `<a href="${item.website}" target="_blank" rel="noopener" class="ogd-popup-link">🌐 Website</a> `;
        if (item.ticketLink) links += `<a href="${item.ticketLink}" target="_blank" rel="noopener" class="ogd-popup-link">🎫 Tickets</a>`;
        break;

      case 'grillplatz':
        if (item.address) details += `<div class="ogd-popup-detail">📍 ${item.address}</div>`;
        if (item.reservierung === 'ja') {
          badges += `<span class="ogd-popup-badge reservierung">📋 Reservierung möglich</span>`;
        }
        details += `<div class="ogd-popup-detail" style="color:#81C784">Gratis nutzbar! 🔥</div>`;
        if (item.website) links += `<a href="${item.website}" target="_blank" rel="noopener" class="ogd-popup-link">📋 Reservieren</a>`;
        break;

      case 'wlan':
        if (item.address) details += `<div class="ogd-popup-detail">📍 ${item.address}</div>`;
        details += `<div class="ogd-popup-detail" style="color:#81C784">Gratis WLAN! 📶</div>`;
        if (item.info) links += `<a href="${item.info}" target="_blank" rel="noopener" class="ogd-popup-link">ℹ️ Mehr Infos</a>`;
        break;
    }

    return `<div class="ogd-popup-inner">
      <div class="ogd-popup-header">
        <div class="ogd-popup-icon" style="background:${layer.color}22; color:${layer.color}">${layer.icon}</div>
        <div class="ogd-popup-name">${item.name}</div>
      </div>
      ${details}
      ${badges ? `<div style="margin-top:4px">${badges}</div>` : ''}
      ${links ? `<div style="margin-top:6px">${links}</div>` : ''}
      <div class="ogd-popup-source">Quelle: <a href="https://data.wien.gv.at" target="_blank">Stadt Wien OGD</a> · CC BY 4.0</div>
    </div>`;
  }

  // ── Update toggle button state ──────────────────────
  function updateOGDToggleBtn() {
    if (!ogdToggleBtn) return;
    if (ogdState.activeLayers.size > 0) {
      ogdToggleBtn.classList.add('active');
    } else {
      ogdToggleBtn.classList.remove('active');
    }
  }

  // ── Bind OGD Events ─────────────────────────────────
  function bindOGDEvents() {
    if (!ogdToggleBtn || !ogdDropdown) return;

    ogdToggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      ogdDropdown.classList.toggle('active');
    });

    ogdLayersContainer.addEventListener('change', e => {
      const checkbox = e.target.closest('[data-ogd-layer]');
      if (!checkbox) return;
      toggleOGDLayer(checkbox.dataset.ogdLayer);
    });

    // Also handle click on the row
    ogdLayersContainer.addEventListener('click', e => {
      const row = e.target.closest('.ogd-layer-row');
      if (!row) return;
      // Don't toggle if clicking the switch itself
      if (e.target.closest('.ogd-switch')) return;
      const key = row.dataset.layer;
      if (key) toggleOGDLayer(key);
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.ogd-panel')) {
        ogdDropdown.classList.remove('active');
      }
    });
  }

  // ── Show/hide OGD panel based on view ───────────────
  function updateOGDPanelVisibility() {
    if (!ogdPanel) return;
    if (currentView === 'map') {
      ogdPanel.classList.remove('hidden');
    } else {
      ogdPanel.classList.add('hidden');
    }
  }

  // ── Boot ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    loadAccepted();
    langBtn.textContent = (I18N[currentLang] || I18N.de).flag;
    init();

    // Initialize OGD panel
    renderOGDPanel();
    bindOGDEvents();
    updateOGDPanelVisibility();
  });
})();

