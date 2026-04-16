// Wien Low Budget – Stadt Wien Open Government Data Integration
// Datenquelle: data.wien.gv.at (CC BY 4.0)
// ──────────────────────────────────────────────────────────────

const OGD_WIEN = (function () {
  'use strict';

  // ── Base URL for Vienna WFS ─────────────────────────────
  const WFS_BASE = 'https://data.wien.gv.at/daten/geo';
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour

  // ── Layer Definitions ───────────────────────────────────
  const LAYERS = {
    toiletten: {
      key: 'toiletten',
      typeName: 'ogdwien:WCANLAGEOGD',
      icon: '🚻',
      label: 'Gratis WC',
      color: '#26A69A',
      markerSize: 'small',
      description: 'Öffentliche WC-Anlagen der Stadt Wien',
      parse: (feature) => {
        const p = feature.properties;
        const coords = feature.geometry.coordinates;
        return {
          lat: coords[1],
          lng: coords[0],
          name: p.KATEGORIE || 'Öffentliches WC',
          address: p.STRASSE || 'Unbekannt',
          district: p.BEZIRK ? `${p.BEZIRK}. Bezirk` : '',
          hours: p.OEFFNUNGSZEIT || '',
          category: p.KATEGORIE || '',
          info: p.INFORMATION || '',
          source: 'Stadt Wien OGD'
        };
      }
    },

    trinkbrunnen: {
      key: 'trinkbrunnen',
      typeName: 'ogdwien:TRINKBRUNNENOGD',
      icon: '💧',
      label: 'Trinkbrunnen',
      color: '#42A5F5',
      markerSize: 'tiny',
      description: 'Trinkwasserbrunnen – gratis Wasser nachfüllen!',
      parse: (feature) => {
        const p = feature.properties;
        const coords = feature.geometry.coordinates;
        return {
          lat: coords[1],
          lng: coords[0],
          name: p.BASIS_TYP_TXT || 'Trinkbrunnen',
          type: p.BASIS_TYP_TXT || '',
          source: 'Stadt Wien OGD'
        };
      }
    },

    schwimmbad: {
      key: 'schwimmbad',
      typeName: 'ogdwien:SCHWIMMBADOGD',
      icon: '🏊',
      label: 'Schwimmbäder',
      color: '#5C6BC0',
      markerSize: 'medium',
      description: 'Städtische Bäder mit Live-Auslastung',
      parse: (feature) => {
        const p = feature.properties;
        const coords = feature.geometry.coordinates;
        // Build capacity info
        let auslastung = '';
        if (p.AUSLASTUNG_AMPEL_KAT_TXT_0) {
          auslastung = p.AUSLASTUNG_AMPEL_KAT_TXT_0;
        }
        return {
          lat: coords[1],
          lng: coords[0],
          name: p.NAME || 'Schwimmbad',
          address: p.ADRESSE || '',
          district: p.BEZIRK ? `${p.BEZIRK}. Bezirk` : '',
          website: p.WEBLINK1 || '',
          ticketLink: p.WEBLINK2 || '',
          auslastung: auslastung,
          source: 'Stadt Wien OGD'
        };
      }
    },

    grillplatz: {
      key: 'grillplatz',
      typeName: 'ogdwien:GRILLPLATZOGD',
      icon: '🔥',
      label: 'Grillplätze',
      color: '#FF7043',
      markerSize: 'medium',
      description: 'Offizielle Grillplätze – gratis nutzbar!',
      parse: (feature) => {
        const p = feature.properties;
        const coords = feature.geometry.coordinates;
        return {
          lat: coords[1],
          lng: coords[0],
          name: `Grillplatz #${p.GRILLPLATZ_ID || '?'}`,
          address: p.LAGE || '',
          reservierung: p.RESERVIERUNG || 'nein',
          website: p.WEBLINK1 || '',
          source: 'Stadt Wien OGD'
        };
      }
    },

    wlan: {
      key: 'wlan',
      typeName: 'ogdwien:WLANWRLOGD',
      icon: '📶',
      label: 'Gratis WLAN',
      color: '#AB47BC',
      markerSize: 'medium',
      description: 'Kostenlose WLAN-Hotspots der Stadt Wien',
      parse: (feature) => {
        const p = feature.properties;
        const coords = feature.geometry.coordinates;
        return {
          lat: coords[1],
          lng: coords[0],
          name: p.NAME || 'Gratis WLAN',
          address: p.ADRESSE || '',
          provider: p.ANBIETER || '',
          info: p.WEITERE_INFORMATIONEN || '',
          source: 'Stadt Wien OGD'
        };
      }
    }
  };

  // ── Fetch with Caching ──────────────────────────────────
  async function fetchLayer(layerKey) {
    const layer = LAYERS[layerKey];
    if (!layer) throw new Error(`Unknown OGD layer: ${layerKey}`);

    // Check cache
    const cacheKey = `ogd-wien-${layerKey}`;
    const cacheTimeKey = `ogd-wien-${layerKey}-ts`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      const cachedTs = sessionStorage.getItem(cacheTimeKey);
      if (cached && cachedTs && (Date.now() - parseInt(cachedTs)) < CACHE_TTL) {
        return JSON.parse(cached);
      }
    } catch (e) { /* ignore cache errors */ }

    // Build WFS URL
    const url = `${WFS_BASE}?service=WFS&request=GetFeature&version=1.1.0` +
      `&typeName=${encodeURIComponent(layer.typeName)}` +
      `&outputFormat=application/json&srsName=EPSG:4326`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`OGD fetch failed: ${response.status}`);

    const geojson = await response.json();
    const parsed = geojson.features
      .filter(f => f.geometry && f.geometry.coordinates)
      .map(f => layer.parse(f));

    // Cache result
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(parsed));
      sessionStorage.setItem(cacheTimeKey, Date.now().toString());
    } catch (e) { /* storage full, skip caching */ }

    return parsed;
  }

  // ── Public API ──────────────────────────────────────────
  return {
    LAYERS,
    fetchLayer
  };
})();
