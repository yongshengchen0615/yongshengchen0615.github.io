// **店家 GPS 經緯度**
const storeLat = 22.989235128871968; // 你的店家緯度
const storeLon = 120.20502160466422; // 你的店家經度
const allowedDistance = 0.3; // 設定允許範圍 (公里)，100 公尺 = 0.1 公里

// ===== 可程式控制：是否需要定位判斷 =====
// 優先順序（高→低）：網址參數 > localStorage 覆寫 > window.GEO_ENFORCE > 預設 true
function resolveGeoPolicy() {
  const url = new URL(window.location.href);
  const qs = url.searchParams;

  // 1) URL 參數 ?geo=1/0/true/false
  if (qs.has('geo')) {
    const v = (qs.get('geo') || '').toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
  }

  // 2) localStorage 覆寫（setGeoEnforce 設定），'1' 或 '0'
  const persisted = localStorage.getItem('geo_enforce');
  if (persisted === '1') return true;
  if (persisted === '0') return false;

  // 3) 全域變數（在 index.html 內設定 window.GEO_ENFORCE）
  if (typeof window.GEO_ENFORCE === 'boolean') {
    return window.GEO_ENFORCE;
  }

  // 4) 預設：需要定位判斷
  return true;
}

// 對外提供可程式呼叫的 API（會寫入 localStorage 並重新整理）
window.setGeoEnforce = function (enable) {
  localStorage.setItem('geo_enforce', enable ? '1' : '0');
  window.location.reload();
};
window.clearGeoOverride = function () {
  localStorage.removeItem('geo_enforce');
  window.location.reload();
};

// ===== 主流程 =====
function main() {
  const requireGeo = resolveGeoPolicy();
  if (requireGeo) {
    const msg = document.getElementById('message');
    if (msg) msg.innerText = '正在獲取您的定位...';
    checkLocation();
  } else {
    const msg = document.getElementById('message');
    //if (msg) msg.innerText = '🔓 已跳過定位判斷，可直接參加。';
    if (msg) msg.innerText = '';
    enableButtons();
  }
}

// 定位並檢查距離
function checkLocation() {
  if (!('geolocation' in navigator)) {
    setMessage('❌ 瀏覽器不支援定位功能');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const userLat = position.coords.latitude;  // 使用者緯度
      const userLon = position.coords.longitude; // 使用者經度

      // 計算距離
      const distance = getDistanceFromLatLon(userLat, userLon, storeLat, storeLon);

      if (distance <= allowedDistance) {
        setMessage('✅ 位置確認成功！您可以參加刮刮樂！');
        enableButtons();
      } else {
        setMessage(`❌ 位置不符，請到店內參加！（距離約 ${distance.toFixed(2)} 公里）`);
      }
    },
    (error) => {
      console.error('定位錯誤：', error);
      setMessage('❌ 獲取位置失敗，請允許定位權限');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function setMessage(text) {
  const el = document.getElementById('message');
  if (el) el.innerText = text;
}

function enableButtons() {
  document.querySelectorAll('.button').forEach(btn => {
    btn.classList.add('enabled');
  });
}

// **哈弗賽公式計算兩點間距離（公里）**
function getDistanceFromLatLon(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球半徑（公里）
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // 轉換成公里
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// 啟動
main();
