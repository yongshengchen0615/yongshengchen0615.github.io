// Firebase 設定
const firebaseConfig = {
    apiKey: "你的API金鑰",
    authDomain: "你的專案ID.firebaseapp.com",
    projectId: "你的專案ID",
    storageBucket: "你的專案ID.appspot.com",
    messagingSenderId: "你的發送者ID",
    appId: "你的應用程式ID"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 表單提交事件
document.getElementById("booking-form").addEventListener("submit", function(event) {
    event.preventDefault();

    let name = document.getElementById("name").value;
    let phone = document.getElementById("phone").value;
    let date = document.getElementById("date").value;
    let time = document.getElementById("time").value;
    let service = document.getElementById("service").value;

    db.collection("bookings").add({
        name,
        phone,
        date,
        time,
        service,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        alert("預約成功！");
        document.getElementById("booking-form").reset();
        loadBookings(); // 重新載入預約列表
    }).catch(error => console.error("預約失敗", error));
});

// 加載預約列表
function loadBookings() {
    let bookingList = document.getElementById("booking-list");
    bookingList.innerHTML = "";

    db.collection("bookings").orderBy("createdAt", "desc").get().then(snapshot => {
        snapshot.forEach(doc => {
            let booking = doc.data();
            let listItem = document.createElement("li");
            listItem.innerHTML = `
                ${booking.date} ${booking.time} - ${booking.name} (${booking.service}) 
                <button class="delete-btn" data-id="${doc.id}">刪除</button>
            `;
            bookingList.appendChild(listItem);
        });

        // 綁定刪除事件
        document.querySelectorAll(".delete-btn").forEach(button => {
            button.addEventListener("click", function() {
                let id = this.getAttribute("data-id");
                db.collection("bookings").doc(id).delete().then(() => {
                    loadBookings(); // 重新載入列表
                });
            });
        });
    });
}

// 初始化加載
loadBookings();
