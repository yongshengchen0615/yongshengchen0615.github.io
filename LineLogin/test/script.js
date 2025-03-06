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
        .then(() => { alert("預約成功！"); loadBookings(); })
        .catch(error => alert("預約失敗：" + error.message));
}

function loadBookings() {
    get(ref(database, "bookings")).then(snapshot => {
        const bookingsList = document.getElementById("bookingsList");
        bookingsList.innerHTML = "";

        snapshot.forEach(child => {
            const booking = child.val();
            if (booking.userId === userId) {
                const li = document.createElement("li");
                li.innerHTML = `${booking.name} - ${booking.date} ${booking.time}
                    <button onclick="editBooking('${child.key}', '${booking.name}', '${booking.date}', '${booking.time}')">修改</button>
                    <button onclick="deleteBooking('${child.key}')">刪除</button>`;
                bookingsList.appendChild(li);
            }
        });
    });
}

// 註冊到全域
window.editBooking = function (id, name, date, time) {
    document.getElementById("bookingId").value = id;
    document.getElementById("name").value = name;
    document.getElementById("date").value = date;
    document.getElementById("time").value = time;
    document.getElementById("updateBookingBtn").style.display = "inline-block";
};

window.updateBooking = function () {
    const id = document.getElementById("bookingId").value;
    update(ref(database, `bookings/${id}`), {
        name: document.getElementById("name").value,
        date: document.getElementById("date").value,
        time: document.getElementById("time").value
    }).then(() => { alert("更新成功！"); loadBookings(); });
};

window.deleteBooking = function (id) {
    if (confirm("確定要刪除這筆預約嗎？")) {
        remove(ref(database, `bookings/${id}`))
            .then(() => {
                alert("預約已刪除！");
                loadBookings();
            })
            .catch((error) => {
                alert("刪除失敗：" + error.message);
            });
    }
};
