// ===== 門市座標與距離設定 =====
const storeLat = 22.989400929173414;
const storeLon = 120.20560902221429;
const allowedDistanceKm = 0.3;

const linkTargets = {
  btn5:  "../5points/index.html",
  btn10: "../10points/index.html",
  btn15: "../15points/index.html",
  btn20: "../20points/index.html",
};

const $msg = document.getElementById("message");
const $retry = document.getElementById("retry");

// ===== 模式開關判斷 =====
const CONFIG = {
  requireGeo:
    new URL(location.href).searchParams.get('geo')?.toLowerCase() === 'on' ? true
    : new URL(location.href).searchParams.get('geo')?.toLowerCase() === 'off' ? false
    : typeof window.GEO_REQUIRE === 'boolean' ? window.GEO_REQUIRE
    : true,
};

// ===== 初始化 =====
init();

function init() {
  if (!CONFIG.requireGeo) {
    // 關閉定位判斷 → 靜默解鎖，不顯示任何訊息
    unlockLinks();
    return;
  }

  // 開啟定位判斷 → 顯示定位狀態訊息
  setMessage("📍 正在獲取您的定位，請稍候…", "");
  locate();
}

// ===== 定位功能 =====
function locate() {
  $retry.hidden = true;

  if (!("geolocation" in navigator)) {
    setMessage("❌ 此瀏覽器不支援定位功能。", "error");
    return;
  }

  navigator.geolocation.getCurrentPosition(onPosition, onGeoError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 30000,
  });
}

function onPosition({ coords }) {
  const { latitude: userLat, longitude: userLon, accuracy } = coords;
  const distance = haversineKm(userLat, userLon, storeLat, storeLon);

  console.log(`[geo] lat=${userLat}, lon=${userLon}, acc~${Math.round(accuracy)}m, d=${distance.toFixed(3)}km`);

  if (distance <= allowedDistanceKm) {
    setMessage("✅ 位置確認成功！您可以參加刮刮樂！", "success");
    unlockLinks();
  } else {
    setMessage(`❌ 您距離門市約 ${distance.toFixed(2)} 公里，請靠近店內再試。`, "error");
    $retry.hidden = false;
  }
}

function onGeoError(err) {
  const map = {
    1: "您拒絕了定位權限，請在瀏覽器設定中允許位置存取。",
    2: "目前無法取得位置，請確認裝置的定位服務已開啟。",
    3: "定位逾時，請移動到空曠處或稍後再試。",
  };
  setMessage(`❌ ${map[err.code] || `定位錯誤：${err.message}`}`, "error");
  $retry.hidden = false;
}

// ===== 解鎖按鈕 =====
function unlockLinks() {
  Object.entries(linkTargets).forEach(([id, href]) => {
    const a = document.getElementById(id);
    a.setAttribute("href", href);
    a.removeAttribute("aria-disabled");
    a.removeAttribute("tabindex");
  });
}

// ===== 工具函式 =====
function setMessage(text, type) {
  $msg.classList.remove("message--success", "message--error");
  if (type) $msg.classList.add(`message--${type}`);
  $msg.textContent = text;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const deg2rad = d => d * (Math.PI / 180);
