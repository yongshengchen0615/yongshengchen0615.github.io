from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if before not in text:
        raise SystemExit(f"target not found: {path}\n{before}")
    file.write_text(text.replace(before, after, 1), encoding="utf-8")


replace_once(
    "MemberWebsocket-dev/booking/app.js",
    """      const storeMinutes = storeItem ? Number(storeItem.unitDurationMinutes || DEFAULT_STORE_SERVICE_MINUTES) * Number(storeItem.quantity || 1) : 0;\n      time.textContent = `${window.BookingSystem.formatDate(booking.bookingDate)} ${booking.startTime}–${booking.endTime} · ${booking.totalDurationMinutes || 0} 分鐘${storeMinutes > 0 ? `（含店內服務 ${storeMinutes} 分鐘）` : ''} · ${formatMoney(booking.totalAmount)}`;\n""",
    """      const storeMinutes = storeItem ? Number(storeItem.unitDurationMinutes || DEFAULT_STORE_SERVICE_MINUTES) * Number(storeItem.quantity || 1) : 0;\n      const scheduledMinutes = Number(booking.totalDurationMinutes || 0);\n      const currentMinutes = Array.isArray(booking.items) && booking.items.length\n        ? booking.items.reduce((sum, service) => sum + Number(service.unitDurationMinutes || 0) * Number(service.quantity || 1), 0)\n        : scheduledMinutes;\n      const durationText = currentMinutes !== scheduledMinutes\n        ? `目前項目共 ${currentMinutes} 分鐘${storeMinutes > 0 ? `（含店內服務 ${storeMinutes} 分鐘）` : ''} · 原排程佔用 ${scheduledMinutes} 分鐘`\n        : `${currentMinutes} 分鐘${storeMinutes > 0 ? `（含店內服務 ${storeMinutes} 分鐘）` : ''}`;\n      time.textContent = `${window.BookingSystem.formatDate(booking.bookingDate)} ${booking.startTime}–${booking.endTime} · ${durationText} · ${formatMoney(booking.totalAmount)}`;\n""",
)

replace_once(
    "MemberWebsocket-dev/admin/booking-panel.js",
    """      const storeItem = bookingStoreItem(booking); const storeMinutes = storeItem ? Number(storeItem.unitDurationMinutes || 10) * Number(storeItem.quantity || 1) : 0;\n      const time = document.createElement('p'); time.className = 'booking-admin-time'; time.textContent = `${formatDate(booking.bookingDate)} ${booking.startTime}–${booking.endTime} · 預約佔用 ${booking.totalDurationMinutes || 0} 分鐘${storeMinutes ? `（含店內服務 ${storeMinutes} 分鐘）` : ''} · 總額 ${formatMoney(booking.totalAmount)}`; card.appendChild(time);\n""",
    """      const storeItem = bookingStoreItem(booking); const storeMinutes = storeItem ? Number(storeItem.unitDurationMinutes || 10) * Number(storeItem.quantity || 1) : 0;\n      const scheduledMinutes = Number(booking.totalDurationMinutes || 0);\n      const currentMinutes = Array.isArray(booking.items) && booking.items.length ? booking.items.reduce((sum, item) => sum + Number(item.unitDurationMinutes || 0) * Number(item.quantity || 1), 0) : scheduledMinutes;\n      const durationText = currentMinutes !== scheduledMinutes ? `目前項目共 ${currentMinutes} 分鐘${storeMinutes ? `（含店內服務 ${storeMinutes} 分鐘）` : ''} · 原排程佔用 ${scheduledMinutes} 分鐘` : `預約佔用 ${scheduledMinutes} 分鐘${storeMinutes ? `（含店內服務 ${storeMinutes} 分鐘）` : ''}`;\n      const time = document.createElement('p'); time.className = 'booking-admin-time'; time.textContent = `${formatDate(booking.bookingDate)} ${booking.startTime}–${booking.endTime} · ${durationText} · 總額 ${formatMoney(booking.totalAmount)}`; card.appendChild(time);\n""",
)

replace_once(
    "MemberWebsocket-dev/booking/admin/app.js",
    """    const time = document.createElement('p');\n    time.className = 'booking-time';\n    time.textContent = `${window.BookingSystem.formatDate(booking.bookingDate)}　${booking.startTime}–${booking.endTime}（原預約時段）`;\n""",
    """    const time = document.createElement('p');\n    time.className = 'booking-time';\n    const scheduledMinutes = Number(booking.totalDurationMinutes || 0);\n    const currentMinutes = Array.isArray(booking.items) && booking.items.length\n      ? booking.items.reduce((sum, item) => sum + Number(item.unitDurationMinutes || 0) * Number(item.quantity || 1), 0)\n      : scheduledMinutes;\n    const durationText = currentMinutes !== scheduledMinutes\n      ? `目前項目共 ${currentMinutes} 分鐘 · 原排程佔用 ${scheduledMinutes} 分鐘`\n      : `目前項目共 ${currentMinutes} 分鐘`;\n    time.textContent = `${window.BookingSystem.formatDate(booking.bookingDate)}　${booking.startTime}–${booking.endTime}（原預約時段） · ${durationText}`;\n""",
)

replace_once(
    "MemberWebsocket-dev/booking/index.html",
    './app.js?v=booking-lifecycle-20260911-2',
    './app.js?v=booking-duration-consistency-20260911-4',
)
replace_once(
    "MemberWebsocket-dev/admin/index.html",
    './booking-panel.js?v=booking-onsite-20260911-3',
    './booking-panel.js?v=booking-duration-consistency-20260911-4',
)
replace_once(
    "MemberWebsocket-dev/booking/admin/index.html",
    './app.js?v=booking-onsite-20260911-3',
    './app.js?v=booking-duration-consistency-20260911-4',
)
