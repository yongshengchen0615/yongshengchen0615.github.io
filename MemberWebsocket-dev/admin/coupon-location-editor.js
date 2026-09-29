(() => {
  'use strict';

  const MAX_LOCATIONS = 20;
  const DEFAULT_CENTER = [23.69781, 120.960515];
  const DEFAULT_ZOOM = 7;
  const DETAIL_ZOOM = 16;
  const SEARCH_MIN_INTERVAL_MS = 1000;

  function normalizeLocation(raw, fallbackName = '') {
    const latitude = Number(raw?.latitude);
    const longitude = Number(raw?.longitude);
    const radiusMeters = Number(raw?.radiusMeters ?? 100);
    return {
      name: String(raw?.name || fallbackName || '').trim().slice(0, 100),
      latitude: Number.isFinite(latitude) ? latitude : 0,
      longitude: Number.isFinite(longitude) ? longitude : 0,
      radiusMeters: Number.isInteger(radiusMeters) ? radiusMeters : 100,
    };
  }

  function createEditor(config) {
    let locations = [];
    let map = null;
    let markers = [];
    let initialized = false;
    let searchBusy = false;
    let lastSearchAt = 0;
    let searchController = null;

    const byId = (id) => document.getElementById(id);
    const checkbox = () => byId(config.checkboxId);
    const controls = () => byId(config.controlsId);
    const rows = () => byId(config.rowsId);
    const count = () => byId(config.countId);
    const status = () => byId(config.statusId);
    const mapElement = () => byId(config.mapId);
    const searchInput = () => byId(config.searchInputId);
    const searchButton = () => byId(config.searchButtonId);
    const searchResults = () => byId(config.searchResultsId);

    function setStatus(message, isError = false) {
      const element = status();
      if (!element) return;
      element.textContent = message;
      element.classList.toggle('warning', Boolean(isError));
    }

    function validCoordinate(latitude, longitude) {
      return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
        && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    }

    function createMap() {
      if (map || !mapElement() || typeof window.L === 'undefined') return;
      map = window.L.map(mapElement(), { scrollWheelZoom: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      map.on('click', (event) => {
        if (locations.length >= MAX_LOCATIONS) return setStatus(`最多只能設定 ${MAX_LOCATIONS} 個使用地點。`, true);
        addLocation(event.latlng.lat, event.latlng.lng, `使用地點 ${locations.length + 1}`);
      });
    }

    function renderMarkers() {
      if (!map || typeof window.L === 'undefined') return;
      markers.forEach((marker) => marker.remove());
      markers = locations.filter((location) => validCoordinate(location.latitude, location.longitude)).map((location, index) => {
        const marker = window.L.marker([location.latitude, location.longitude]).addTo(map);
        marker.bindTooltip(location.name || `地點 ${index + 1}`);
        marker.on('click', () => {
          map.setView([location.latitude, location.longitude], DETAIL_ZOOM);
          rows()?.children[index]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        });
        return marker;
      });
    }

    function field(labelText, type, value, options = {}) {
      const label = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = labelText;
      const input = document.createElement('input');
      input.type = type;
      input.value = String(value ?? '');
      if (options.min != null) input.min = String(options.min);
      if (options.max != null) input.max = String(options.max);
      if (options.step != null) input.step = String(options.step);
      if (options.maxLength != null) input.maxLength = Number(options.maxLength);
      label.append(span, input);
      return { label, input };
    }

    function render() {
      const container = rows();
      if (!container) return;
      container.replaceChildren(...locations.map((location, index) => {
        const row = document.createElement('article');
        row.className = 'coupon-location-row';

        const title = document.createElement('strong');
        title.textContent = `地點 ${index + 1}`;
        const name = field('地點名稱', 'text', location.name, { maxLength: 100 });
        const lat = field('緯度', 'number', location.latitude, { min: -90, max: 90, step: '0.000001' });
        const lng = field('經度', 'number', location.longitude, { min: -180, max: 180, step: '0.000001' });
        const radius = field('核銷半徑（公尺）', 'number', location.radiusMeters, { min: 50, max: 2000, step: 10 });

        name.input.addEventListener('input', () => { locations[index].name = name.input.value.trim().slice(0, 100); renderMarkers(); });
        lat.input.addEventListener('input', () => { locations[index].latitude = Number(lat.input.value); renderMarkers(); });
        lng.input.addEventListener('input', () => { locations[index].longitude = Number(lng.input.value); renderMarkers(); });
        radius.input.addEventListener('input', () => { locations[index].radiusMeters = Number(radius.input.value); });

        const actions = document.createElement('div');
        actions.className = 'coupon-location-actions';
        const focus = document.createElement('button');
        focus.type = 'button';
        focus.className = 'text-button';
        focus.textContent = '地圖定位';
        focus.addEventListener('click', () => {
          if (!validCoordinate(locations[index].latitude, locations[index].longitude)) return;
          createMap();
          map?.setView([locations[index].latitude, locations[index].longitude], DETAIL_ZOOM);
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'text-button';
        remove.textContent = '刪除';
        remove.addEventListener('click', () => {
          locations.splice(index, 1);
          render();
          setStatus('已移除使用地點。');
        });
        actions.append(focus, remove);
        row.append(title, name.label, lat.label, lng.label, radius.label, actions);
        return row;
      }));
      if (count()) count().textContent = `${locations.length} / ${MAX_LOCATIONS} 個使用地點`;
      renderMarkers();
    }

    function addLocation(latitude, longitude, name = '') {
      if (locations.length >= MAX_LOCATIONS) {
        setStatus(`最多只能設定 ${MAX_LOCATIONS} 個使用地點。`, true);
        return false;
      }
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!validCoordinate(lat, lng)) {
        setStatus('座標格式不正確。', true);
        return false;
      }
      locations.push(normalizeLocation({ name: name || `使用地點 ${locations.length + 1}`, latitude: lat, longitude: lng, radiusMeters: 100 }));
      render();
      createMap();
      map?.setView([lat, lng], DETAIL_ZOOM);
      setStatus(`已新增「${locations[locations.length - 1].name}」。`);
      return true;
    }

    function refresh() {
      const enabled = Boolean(checkbox()?.checked);
      controls()?.classList.toggle('hidden', !enabled);
      if (enabled) {
        createMap();
        window.setTimeout(() => map?.invalidateSize(), 0);
      }
    }

    function useCurrentLocation() {
      if (!navigator.geolocation) return setStatus('此瀏覽器不支援 GPS 定位。', true);
      setStatus('正在取得目前 GPS 位置…');
      navigator.geolocation.getCurrentPosition((position) => {
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        if (!addLocation(lat, lng, '目前 GPS 位置')) return;
        setStatus(`已用目前 GPS 新增地點（精度約 ±${Math.round(Number(position.coords.accuracy) || 0)} 公尺）。`);
      }, (error) => {
        const message = error?.code === 1 ? '定位權限被拒絕，請允許位置權限後再試。' : '暫時無法取得 GPS 位置，請重試或使用地址搜尋。';
        setStatus(message, true);
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    }

    function clearSearchResults() {
      searchResults()?.replaceChildren();
    }

    async function searchAddress() {
      const query = String(searchInput()?.value || '').trim();
      if (query.length < 2) return setStatus('請輸入至少 2 個字的地址或地標。', true);
      if (searchBusy) return;
      const elapsed = Date.now() - lastSearchAt;
      if (elapsed < SEARCH_MIN_INTERVAL_MS) {
        setStatus('地址搜尋請稍候 1 秒再試。', true);
        return;
      }
      searchBusy = true;
      lastSearchAt = Date.now();
      if (searchButton()) searchButton().disabled = true;
      searchController?.abort();
      searchController = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = window.setTimeout(() => searchController?.abort(), 8000);
      setStatus('正在搜尋地址…');
      clearSearchResults();
      try {
        const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', 'accept-language': 'zh-TW' });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          headers: { Accept: 'application/json' },
          signal: searchController?.signal,
          referrerPolicy: 'strict-origin-when-cross-origin',
        });
        if (!response.ok) throw new Error('GEOCODER_HTTP_ERROR');
        const result = await response.json();
        const candidates = Array.isArray(result) ? result.filter((item) => validCoordinate(Number(item?.lat), Number(item?.lon))).slice(0, 5) : [];
        if (!candidates.length) {
          setStatus('找不到相符地址，請換更完整的地址或地標名稱。', true);
          return;
        }
        const container = searchResults();
        if (container) {
          container.replaceChildren(...candidates.map((candidate) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'button button-outline';
            button.textContent = String(candidate.display_name || query).slice(0, 240);
            button.addEventListener('click', () => {
              const label = String(candidate.display_name || query).trim();
              addLocation(Number(candidate.lat), Number(candidate.lon), label.slice(0, 100));
              if (searchInput()) searchInput().value = label;
              clearSearchResults();
            });
            return button;
          }));
        }
        setStatus(`找到 ${candidates.length} 個結果，請選擇要加入的地點。`);
      } catch (error) {
        if (error?.name !== 'AbortError') setStatus('地址搜尋暫時無法使用，請稍後再試或直接使用 GPS／地圖選點。', true);
        else setStatus('地址搜尋逾時，請重試。', true);
      } finally {
        window.clearTimeout(timeout);
        searchBusy = false;
        if (searchButton()) searchButton().disabled = false;
      }
    }

    function init() {
      if (initialized) return;
      if (!checkbox() || !controls() || !rows()) return;
      initialized = true;
      checkbox().addEventListener('change', refresh);
      byId(config.addButtonId)?.addEventListener('click', () => {
        const center = map?.getCenter();
        addLocation(center?.lat ?? DEFAULT_CENTER[0], center?.lng ?? DEFAULT_CENTER[1], `使用地點 ${locations.length + 1}`);
      });
      byId(config.currentButtonId)?.addEventListener('click', useCurrentLocation);
      searchButton()?.addEventListener('click', searchAddress);
      searchInput()?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        searchAddress();
      });
      createMap();
      render();
      refresh();
    }

    return {
      init,
      refresh,
      set(value) {
        locations = Array.isArray(value) ? value.slice(0, MAX_LOCATIONS).map((item, index) => normalizeLocation(item, `使用地點 ${index + 1}`)) : [];
        render();
        refresh();
      },
      get() {
        return locations.map((location) => ({ ...location }));
      },
      addLocation,
      searchAddress,
    };
  }

  const eventEditor = createEditor({
    checkboxId: 'eventTicketRequiresLocation',
    controlsId: 'eventTicketLocationControls',
    rowsId: 'eventTicketLocationRows',
    countId: 'eventTicketLocationCount',
    statusId: 'eventTicketMapStatus',
    mapId: 'eventTicketLocationMap',
    addButtonId: 'addEventTicketLocationButton',
    currentButtonId: 'eventTicketUseCurrentLocationButton',
    searchInputId: 'eventTicketAddressSearch',
    searchButtonId: 'eventTicketAddressSearchButton',
    searchResultsId: 'eventTicketAddressResults',
  });

  const templateEditor = createEditor({
    checkboxId: 'ticketRequiresLocation',
    controlsId: 'ticketLocationControls',
    rowsId: 'ticketLocationRows',
    countId: 'ticketLocationCount',
    statusId: 'ticketMapStatus',
    mapId: 'ticketLocationMap',
    addButtonId: 'addTicketLocationButton',
    currentButtonId: 'ticketUseCurrentLocationButton',
    searchInputId: 'ticketAddressSearch',
    searchButtonId: 'ticketAddressSearchButton',
    searchResultsId: 'ticketAddressResults',
  });

  window.TicketLocationEditors = {
    event: eventEditor,
    template: templateEditor,
    init() { eventEditor.init(); templateEditor.init(); },
  };
  window.CouponLocationEditor = eventEditor;
})();
