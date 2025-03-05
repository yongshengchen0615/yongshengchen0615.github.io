// Firebase 設定（已整合你的專案資訊）
const firebaseConfig = {
    apiKey: "AIzaSyCQpelp4H9f-S0THHgSiIJHCzyvNG3AGvs",
    authDomain: "reservesystem-c8bbc.firebaseapp.com",
    databaseURL: "https://reservesystem-c8bbc-default-rtdb.firebaseio.com",
    projectId: "reservesystem-c8bbc",
    storageBucket: "reservesystem-c8bbc.firebasestorage.app",
    messagingSenderId: "138232489371",
    appId: "1:138232489371:web:849190b97774b5abae2d3e",
    measurementId: "G-XXDSGNYTV1"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// DOM 元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const reservationForm = document.getElementById("reservation-form");
const reserveBtn = document.getElementById("reserve-btn");
const reservationList = document.getElementById("reservation-list");

// 監聽登入狀態
auth.onAuthStateChanged(user => {
    if (user) {
        userInfo.style.display = "block";
        userName.textContent = user.displayName;
        userPic.src = user.photoURL;
        loginBtn.style.display = "none";
        logoutBtn.style.display = "block";
        reservationForm.style.display = "block";

        loadReservations(user.uid);
    } else {
        userInfo.style.display = "none";
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        reservationForm.style.display = "none";
        reservationList.innerHTML = "";
    }
});

// Google 登入
loginBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(error => {
        alert("登入失敗: " + error.message);
    });
});

// 登出
logoutBtn.addEventListener("click", () => {
    auth.signOut();
});

// 預約功能
reserveBtn.addEventListener("click", () => {
    const user = auth.currentUser;
    if (!user) {
        alert("請先登入！");
        return;
    }

    const serviceType = document.getElementById("service-type").value;
    const date = document.getElementById("date").value;
    const time = document.getElementById("time").value;

    if (!date || !time) {
        alert("請選擇日期和時間！");
        return;
    }

    const reservationRef = database.ref("reservations/" + user.uid).push();
    reservationRef.set({
        service: serviceType,
        date: date,
        time: time
    });

    alert("預約成功！");
    loadReservations(user.uid);
});

// 載入使用者預約資料
function loadReservations(uid) {
    database.ref("reservations/" + uid).once("value", snapshot => {
        reservationList.innerHTML = "";
        snapshot.forEach(childSnapshot => {
            const data = childSnapshot.val();
            const li = document.createElement("li");
            li.textContent = `${data.date} ${data.time} - ${data.service}`;
            
            // 取消預約按鈕
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "取消";
            cancelBtn.onclick = () => {
                childSnapshot.ref.remove();
                loadReservations(uid);
            };

            li.appendChild(cancelBtn);
            reservationList.appendChild(li);
        });
    });
}
