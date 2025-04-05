// js/api.js
const API_BASE = 'https://servertest-r18o.onrender.com/api/booking-config'; // TODO: 替換為實際 API 位址

export async function fetchBookingConfig() {
  const res = await fetch(`${API_BASE}`);
  if (!res.ok) throw new Error("無法取得設定資料");
  return res.json();
}

export async function saveBookingConfig(data) {
  const res = await fetch(`${API_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("儲存失敗");
  return res.json();
}
