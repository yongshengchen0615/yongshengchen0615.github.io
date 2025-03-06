import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, set, get, update, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = window.firebaseConfig;
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const liffId = "2005939681-ayjyxlz3";
let userId = "";

// 初始化 LINE LIFF
document.addEventListener("DOMContentLoaded", async function () {
    await liff.init({ liffId });

    if (liff.isLoggedIn()) {
        getUserProfile();
    } else {
        document.getElementById("loginSection").style.display = "block";
    }

    document.getElementById("loginBtn").addEventListener("click", () => liff.login());
    document.getElementById("logoutBtn").addEventListener("click", () => {
        liff.logout();
        location.reload();
    });

    document.getElementById("bookingForm").addEventListener("submit", function (e) {
        e.preventDefault();
        saveBooking();
    });

    document.getElementById("updateBookingBtn").addEventListener("click", function () {
        updateBooking();
    });
});

async function getUserProfile() {
    const profile = await liff.getProfile();
    document.getElementById("userName").textContent = profile.displayName;
    document.getElementById("userPicture").src = profile.pictureUrl;
    userId = profile.userId;

    document.getElementById("loginSection").style.display = "none";
    document.getElementById("userInfo").style.display = "block";
    document.getElementById("bookingSection").style.display = "block";
    document.getElementById("myBookings").style.display = "block";

    loadBookings();
}

function saveBooking() {
    const name = document.getElementById("name").value;
    const date = document.getElementById("date").value;
    const time = document.getElementById("time").value;

    const bookingRef = push(ref(database, "bookings"));
    set(bookingRef, { userId, name, date, time, timestamp: serverTimestamp() })
        .then(() => { alert("預約成功！"); loadBookings(); });
}

window.editBooking = function (id, name, date, time) {
    document.getElementById("bookingId").value = id;
    document.getElementById("name").value = name;
    document.getElementById("date").value = date;
    document.getElementById("time").value = time;
    document.getElementById("updateBookingBtn").style.display = "inline-block";
};

window.deleteBooking = function (id) {
    if (confirm("確定要刪除這筆預約嗎？")) {
        remove(ref(database, `bookings/${id}`))
            .then(() => { alert("已刪除！"); loadBookings(); });
    }
};
