// **店家 GPS 經緯度**
const storeLat = 22.989400929173414; // 你的店家緯度
const storeLon = 120.20560902221429; // 你的店家經度
const allowedDistance = 0.3; // 設定允許範圍 (公里)，100 公尺 = 0.1 公里

function checkLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;  // 使用者緯度
                const userLon = position.coords.longitude; // 使用者經度

                console.log(`使用者位置：${userLat}, ${userLon}`);

                // 計算距離
                const distance = getDistanceFromLatLon(userLat, userLon, storeLat, storeLon);

                if (distance <= allowedDistance) {
                    document.getElementById("message").innerText = "✅ 位置確認成功！您可以參加刮刮樂！";
                    enableButtons();
                } else {
                    document.getElementById("message").innerText = `❌ 位置不符，請到店內參加！（距離約 ${distance.toFixed(2)} 公里）`;
                }
            },
            (error) => {
                console.error("定位錯誤：" + error.message);
                document.getElementById("message").innerText = "❌ 獲取位置失敗，請允許定位權限";
            }
        );
    } else {
        document.getElementById("message").innerText = "❌ 瀏覽器不支援定位功能";
    }
}

function enableButtons() {
    document.querySelectorAll(".button").forEach(btn => {
        btn.classList.add("enabled");
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

checkLocation();
