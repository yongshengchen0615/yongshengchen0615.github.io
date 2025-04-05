// bookingConfig.js
import { normalizeBookingConfig } from "./normalizeBookingConfig.js";

export let bookingConfig = null;

export async function loadBookingConfig() {
  try {
    const response = await fetch("https://servertest-r18o.onrender.com/api/booking-config"); // 🔁 這裡請換成你實際 API
    const raw = await response.json();
    bookingConfig = normalizeBookingConfig(raw);
    return bookingConfig;
  } catch (err) {
    console.error("❌ 無法載入後台設定資料", err);
    throw err;
  }
}
