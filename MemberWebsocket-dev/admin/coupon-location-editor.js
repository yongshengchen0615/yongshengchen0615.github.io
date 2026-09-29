(() => {
  'use strict';

  const MAX_LOCATIONS = 20;
  const MIN_RADIUS_METERS = 50;
  const MAX_RADIUS_METERS = 2000;
  const DEFAULT_RADIUS_METERS = 100;
  const DEFAULT_CENTER = [23.69781, 120.960515];
  const DEFAULT_ZOOM = 7;
  const DETAIL_ZOOM = 16;
  const SEARCH_MIN_INTERVAL_MS = 1000;

  function normalizeRadius(value) {
    const radius = Number(value);
    return Number.isInteger(radius) && radius >= MIN_RADIUS_METERS && radius <= MAX_RADIUS_METERS
      ? radius
      : DEFAULT_RADIUS_METERS;
  }

  function normalizeLocation(raw, fallbackName = '') {
    const latitude = Number(raw?.latitude);
    const longitude = Number(raw?.longitude);
    return {
      name: String(raw?.name || fallbackName || '').trim().slice(0, 100),
      latitude: Number.isFinite(latitude) ? latitude : 0,
      longitude: Number.isFinite(longitude) ? longitude : 0,
      radiusMeters: normalizeRadius(raw?.radiusMeters),
    };
  }

  function createEditor(config) {
    let locations = [];
    let map = null;
    let markers = [];
    let circles = [];
    let draft = null;
    let draftMarker = null;
    let draftCircle = null;
    let editingIndex = null;
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
    const draftPanel = () => byId(config.draftPanelId);
    const draftName = () => byId(config.draftNameId);
    const draftRadius = () => byId(config.draftRadiusId);
    const confirmButton = () => byId(config.addButtonId);

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

    function validRadius(radiusMeters) {
      return Number.isInteger(radiusMeters)
        && radiusMeters >= MIN_RADIUS_METERS
        && radiusMeters <= MAX_RADIUS_METERS;
    }

    function removeLayer(layer) {
      try { layer?.remove?.(); } catch {}
    }

    function clearDraftOverlay() {
      removeLayer(draftMarker);
      removeLayer(draftCircle);
      draftMarker = null;
      draftCircle = null;
    }

    function renderDraftOverlay() {
      clearDraftOverlay();
      if (!map || !draft || !validCoordinate(draft.latitude, draft.longitude) || typeof window.L === 'undefined') return;

      if (typeof window.L.circle === 'function' && validRadius(draft.radiusMeters)) {
        draftCircle = window.L.circle([draft.latitude, draft.longitude], {
          radius: draft.radiusMeters,
          weight: 2,
          fillOpacity: 0.12,
        }).addTo(map);
      }

      if (typeof window.L.marker === 'function') {
        draftMarker = window.L.marker([draft.latitude, draft.longitude], { draggable: true }).addTo(map);
        draftMarker.bindTooltip(editingIndex == null ? '待新增位置' : '待套用位置');
        draftMarker.on('dragend', (event) => {
          const latlng = event?.target?.getLatLng?.();
          if (!latlng || !draft) return;
          draft.latitude = Number(latlng.lat);
          draft.longitude = Number(latlng.lng);
          draftCircle?.setLatLng?.([draft.latitude, draft.longitude]);
          setStatus('位置已調整；確認半徑範圍後再套用。');
        });
      }
    }

    function renderMapLayers() {
      if (!map || typeof window.L === 'undefined') return;
      markers.forEach(removeLayer);
      circles.forEach(removeLayer);
      markers = [];
      circles = [];

      locations.forEach((location, index) => {
        if (!validCoordinate(location.latitude, location.longitude)) return;
        if (typeof window.L.circle === 'function' && validRadius(location.radiusMeters)) {
          const circle = window.L.circle([location.latitude, location.longitude], {
            radius: location.radiusMeters,
            weight: 2,
            fillOpacity: 0.08,
          }).addTo(map);
          circles.push(circle);
        }
        if (typeof window.L.marker === 'function') {
          const marker = window.L.marker([location.latitude, location.longitude]).addTo(map);
          marker.bindTooltip(`${location.name || `地點 ${index + 1}`} · ${location.radiusMeters} 公尺`);
          marker.on('click', () => {
            map.setView([location.latitude, location.longitude], DETAIL_ZOOM);
            rows()?.children[index]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
          });
          markers.push(marker);
        }
      });
      renderDraftOverlay();
    }

    function createMap() {
      if (map || !mapElement() || typeof window.L === 'undefined') return;
      map = window.L.map(mapElement(), { scrollWheelZoom: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      map.on('click', (event) => {
        if (locations.length >= MAX_LOCATIONS && editingIndex == null) {
          return setStatus(`最多只能設定 ${MAX_LOCATIONS} 個使用地點。`, true);
        }
        setDraft(event.latlng.lat, event.latlng.lng, `使用地點 ${locations.length + 1}`);
      });
      renderMapLayers();
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
        const radius = field('核銷半徑（公尺）', 'number', location.radiusMeters, {
          min: MIN_RADIUS_METERS,
          max: MAX_RADIUS_METERS,
          step: 10,
        });

        name.input.addEventListener('input', () => {
          locations[index].name = name.input.value.trim().slice(0, 100);
          renderMapLayers();
        });
        radius.input.addEventListener('input', () => {
          locations[index].radiusMeters = Number(radius.input.value);
          renderMapLayers();
        });

        const scope = document.createElement('small');
        scope.className = 'coupon-location-scope';
        scope.textContent = `地圖圓圈顯示目前 ${location.radiusMeters} 公尺的核銷範圍。`;

        const actions = document.createElement('div');
        actions.className = 'coupon-location-actions';

        const focus = document.createElement('button');
        focus.type = 'button';
        focus.className = 'text-button';
        focus.textContent = '查看範圍';
        focus.addEventListener('click', () => {
          if (!validCoordinate(locations[index].latitude, locations[index].longitude)) return;
          createMap();
          map?.setView([locations[index].latitude, locations[index].longitude], DETAIL_ZOOM);
        });

        const adjust = document.createElement('button');
        adjust.type = 'button';
        adjust.className = 'text-button';
        adjust.textContent = '調整位置／範圍';
        adjust.addEventListener('click', () => {
          const current = locations[index];
          setDraft(current.latitude, current.longitude, current.name, {
            radiusMeters: current.radiusMeters,
            editingIndex: index,
          });
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'text-button';
        remove.textContent = '刪除';
        remove.addEventListener('click', () => {
          locations.splice(index, 1);
          if (editingIndex === index) clearDraft(false);
          else if (Number.isInteger(editingIndex) && editingIndex > index) editingIndex -= 1;
          render();
          setStatus('已移除使用地點。');
        });

        actions.append(focus, adjust, remove);
        row.append(title, name.label, radius.label, scope, actions);
        return row;
      }));
      if (count()) count().textContent = `${locations.length} / ${MAX_LOCATIONS} 個使用地點`;
      renderMapLayers();
    }

    function renderDraftEditor() {
      const panel = draftPanel();
      if (!panel) return;
      panel.classList.toggle('hidden', !draft);
      if (!draft) return;

      const nameInput = draftName();
      const radiusInput = draftRadius();
      if (nameInput && nameInput.value !== draft.name) nameInput.value = draft.name;
      if (radiusInput && radiusInput.value !== String(draft.radiusMeters)) radiusInput.value = String(draft.radiusMeters);

      const button = confirmButton();
      if (button) button.textContent = editingIndex == null ? '＋ 新增地點' : '套用位置與範圍';
    }

    function setDraft(latitude, longitude, name = '', options = {}) {
      if (locations.length >= MAX_LOCATIONS && options.editingIndex == null) {
        setStatus(`最多只能設定 ${MAX_LOCATIONS} 個使用地點。`, true);
        return false;
      }
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!validCoordinate(lat, lng)) {
        setStatus('選取的位置無效，請重新選擇。', true);
        return false;
      }

      editingIndex = Number.isInteger(options.editingIndex) ? options.editingIndex : null;
      draft = normalizeLocation({
        name: name || `使用地點 ${locations.length + 1}`,
        latitude: lat,
        longitude: lng,
        radiusMeters: options.radiusMeters ?? DEFAULT_RADIUS_METERS,
      });
      createMap();
      renderDraftEditor();
      renderDraftOverlay();
      map?.setView([lat, lng], DETAIL_ZOOM);
      setStatus(editingIndex == null
        ? '已選擇候選位置。請確認地點名稱與半徑範圍，再按「新增地點」。'
        : '正在調整既有地點。確認位置與半徑範圍後，再按「套用位置與範圍」。');
      return true;
    }

    function clearDraft(updateStatus = true) {
      draft = null;
      editingIndex = null;
      clearDraftOverlay();
      renderDraftEditor();
      if (updateStatus) setStatus('已取消候選位置，尚未變更可使用地點。');
    }

    function commitDraft() {
      if (!draft) {
        setStatus('請先使用地址搜尋、目前 GPS，或直接在地圖上選擇位置。', true);
        return false;
      }

      const name = String(draftName()?.value || draft.name || '').trim().slice(0, 100);
      const radiusMeters = Number(draftRadius()?.value ?? draft.radiusMeters);
      if (!name) {
        setStatus('請輸入地點名稱。', true);
        return false;
      }
      if (!validRadius(radiusMeters)) {
        setStatus(`核銷半徑需為 ${MIN_RADIUS_METERS}～${MAX_RADIUS_METERS} 公尺的整數。`, true);
        return false;
      }

      const confirmed = normalizeLocation({ ...draft, name, radiusMeters });
      const wasEditing = Number.isInteger(editingIndex);
      if (wasEditing) locations[editingIndex] = confirmed;
      else locations.push(confirmed);

      draft = null;
      editingIndex = null;
      clearDraftOverlay();
      renderDraftEditor();
      render();
      map?.setView([confirmed.latitude, confirmed.longitude], DETAIL_ZOOM);
      setStatus(wasEditing ? `已套用「${confirmed.name}」的位置與範圍。` : `已新增「${confirmed.name}」。`);
      return true;
    }

    function addLocation(latitude, longitude, name = '', radiusMeters = DEFAULT_RADIUS_METERS) {
      if (!setDraft(latitude, longitude, name, { radiusMeters })) return false;
      return commitDraft();
    }

    function refresh() {
      const enabled = Boolean(checkbox()?.checked);
      controls()?.classList.toggle('hidden', !enabled);
      if (enabled) {
        createMap();
        window.setTimeout(() => {
          map?.invalidateSize();
          renderMapLayers();
        }, 0);
      }
    }

    function useCurrentLocation() {
      if (!navigator.geolocation) return setStatus('此瀏覽器不支援 GPS 定位。', true);
      setStatus('正在取得目前 GPS 位置…');
      navigator.geolocation.getCurrentPosition((position) => {
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        if (!setDraft(lat, lng, '目前 GPS 位置')) return;
        setStatus(`已選擇目前 GPS 位置（精度約 ±${Math.round(Number(position.coords.accuracy) || 0)} 公尺）。請確認半徑後再新增。`);
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
        const candidates = Array.isArray(result)
          ? result.filter((item) => validCoordinate(Number(item?.lat), Number(item?.lon))).slice(0, 5)
          : [];
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
              setDraft(Number(candidate.lat), Number(candidate.lon), label.slice(0, 100));
              if (searchInput()) searchInput().value = label;
              clearSearchResults();
            });
            return button;
          }));
        }
        setStatus(`找到 ${candidates.length} 個結果。選擇其中一個後，再確認半徑並新增。`);
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
      confirmButton()?.addEventListener('click', commitDraft);
      byId(config.clearDraftButtonId)?.addEventListener('click', () => clearDraft(true));
      byId(config.currentButtonId)?.addEventListener('click', useCurrentLocation);

      draftName()?.addEventListener('input', () => {
        if (!draft) return;
        draft.name = draftName().value.trim().slice(0, 100);
        draftMarker?.bindTooltip?.(draft.name || '待新增位置');
      });
      draftRadius()?.addEventListener('input', () => {
        if (!draft) return;
        draft.radiusMeters = Number(draftRadius().value);
        if (validRadius(draft.radiusMeters)) {
          draftCircle?.setRadius?.(draft.radiusMeters);
          if (!draftCircle) renderDraftOverlay();
          setStatus(`目前候選核銷範圍：${draft.radiusMeters} 公尺。確認後再新增。`);
        }
      });

      searchButton()?.addEventListener('click', searchAddress);
      searchInput()?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        searchAddress();
      });

      createMap();
      render();
      renderDraftEditor();
      refresh();
    }

    return {
      init,
      refresh,
      set(value) {
        locations = Array.isArray(value)
          ? value.slice(0, MAX_LOCATIONS).map((item, index) => normalizeLocation(item, `使用地點 ${index + 1}`))
          : [];
        clearDraft(false);
        render();
        refresh();
      },
      get() {
        return locations.map((location) => ({ ...location }));
      },
      addLocation,
      setDraft,
      commitDraft,
      clearDraft,
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
    draftPanelId: 'eventTicketLocationDraft',
    draftNameId: 'eventTicketLocationDraftName',
    draftRadiusId: 'eventTicketLocationDraftRadius',
    addButtonId: 'addEventTicketLocationButton',
    clearDraftButtonId: 'clearEventTicketLocationDraftButton',
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
    draftPanelId: 'ticketLocationDraft',
    draftNameId: 'ticketLocationDraftName',
    draftRadiusId: 'ticketLocationDraftRadius',
    addButtonId: 'addTicketLocationButton',
    clearDraftButtonId: 'clearTicketLocationDraftButton',
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
