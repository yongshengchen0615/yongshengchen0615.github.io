// bookingStorage.js
export const BookingStorage = (() => {
  const STORAGE_KEY = "bookingData";

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return { save, load, clear };
})();
