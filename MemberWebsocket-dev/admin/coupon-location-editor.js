(() => {
  'use strict';

  let locations = [];
  let map = null;
  let markers = null;
  const $ = (id) => document.getElementById(id);
  const validCoordinate = (value, limit) => value != null && value !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;

  function collect() {
    return locations.map((location) => ({ ...location }));
  }

  function drawMap() {
    if (!map) return;
    markers.clearLayers();
    locations.forEach((location, index) => {
      if (!validCoordinate(location.latitude, 90) || !validCoordinate(location.longitude, 180)) return;
      const marker = L.circle([Number(location.latitude), Number(location.longitude)], {
        radius: Number(location.radiusMeters) || 100, color: '#c35641', fillOpacity: 0.17, weight: 2,
        bubblingMouseEvents: false,
      }).addTo(markers);
      marker.bindTooltip(`${index + 1}. ${location.name || '未命名地點'}`);
    });
  }

  function render() {
    const root = $('eventTicketLocationRows');
    root.replaceChildren();
    locations.forEach((location, index) => {
      const row = document.createElement('div');
      row.className = 'coupon-location-row';
      const heading = document.createElement('strong');
      heading.textContent = `地點 ${index + 1}`;
      row.append(heading);
      for (const [key, title, type, min, max, step] of [
        ['name', '地點名稱', 'text', '', '', ''],
        ['latitude', '緯度', 'number', '-90', '90', '0.000001'],
        ['longitude', '經度', 'number', '-180', '180', '0.000001'],
        ['radiusMeters', '核銷半徑（公尺）', 'number', '50', '2000', '1'],
      ]) {
        const label = document.createElement('label');
        label.textContent = title;
        const input = document.createElement('input');
        input.type = type;
        input.value = location[key] ?? '';
        if (key === 'name') input.maxLength = 100;
        else { input.min = min; input.max = max; input.step = step; }
        input.addEventListener('input', () => {
          locations[index][key] = input.value;
          if (key === 'name' || key === 'radiusMeters' || key === 'latitude' || key === 'longitude') drawMap();
        });
        label.append(input);
        row.append(label);
      }
      const actions = document.createElement('div');
      actions.className = 'coupon-location-actions';
      const view = document.createElement('button');
      view.type = 'button'; view.textContent = '地圖定位'; view.className = 'text-button';
      view.addEventListener('click', () => {
        ensureMap();
        if (map && validCoordinate(location.latitude, 90) && validCoordinate(location.longitude, 180)) map.setView([Number(location.latitude), Number(location.longitude)], 16);
      });
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '移除此地點'; remove.className = 'text-button';
      remove.addEventListener('click', () => { locations.splice(index, 1); render(); });
      actions.append(view, remove); row.append(actions); root.append(row);
    });
    $('eventTicketLocationCount').textContent = `${locations.length} / 20 個使用地點`;
    $('addEventTicketLocationButton').disabled = locations.length >= 20;
    drawMap();
  }

  function add(latitude, longitude, name = '') {
    if (locations.length >= 20) return;
    locations.push({ name: String(name).slice(0, 100) || `使用地點 ${locations.length + 1}`,
      latitude: Number(latitude).toFixed(6), longitude: Number(longitude).toFixed(6), radiusMeters: 100 });
    render();
  }

  function ensureMap() {
    if (!$('eventTicketRequiresLocation').checked || !window.L) {
      if (!window.L) $('eventTicketMapStatus').textContent = '地圖暫時無法載入，仍可用下方座標欄位設定地點。';
      return;
    }
    if (!map) {
      map = L.map('eventTicketLocationMap').setView([25.033964, 121.564468], 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      markers = L.layerGroup().addTo(map);
      map.on('click', ({ latlng }) => add(latlng.lat, latlng.lng));
      drawMap();
    }
    setTimeout(() => {
      map.invalidateSize();
      if (locations.length && validCoordinate(locations[0].latitude, 90) && validCoordinate(locations[0].longitude, 180))
        map.setView([Number(locations[0].latitude), Number(locations[0].longitude)], Math.max(map.getZoom(), 15));
    }, 200);
  }

  window.CouponLocationEditor = {
    init() {
      $('eventTicketRequiresLocation').addEventListener('change', () => this.refresh());
      $('addEventTicketLocationButton').addEventListener('click', () => {
        const center = map?.getCenter() || { lat: 25.033964, lng: 121.564468 };
        add(center.lat, center.lng);
      });
      $('eventTicketUseCurrentLocationButton').addEventListener('click', () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(({ coords }) => { ensureMap(); map?.setView([coords.latitude, coords.longitude], 16);
          $('eventTicketMapStatus').textContent = '已移至目前位置；點選地圖可新增據點。';
        }, () => { $('eventTicketMapStatus').textContent = '無法取得目前位置，請在地圖上移動並點選。'; },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
      });
      render();
    },
    set(value) { locations = Array.isArray(value) ? value.map((location) => ({ ...location })) : []; render(); this.refresh(); },
    get: collect,
    refresh() {
      const enabled = $('eventTicketRequiresLocation').checked && $('eventTicketType').value === 'coupon';
      $('eventTicketLocationControls').classList.toggle('hidden', !enabled);
      if (enabled) ensureMap();
    },
  };
})();
