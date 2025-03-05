// Firebase 設定（請填入你的 Firebase 專案資訊）
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

// 取得 UI 元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const reservationSection = document.getElementById("reservation-section");
const reservationForm = document.getElementById("reservation-form");
const reservationList = document.getElementById("reservation-list");

let currentUser = null;

// Google 登入
loginBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(result => {
            currentUser = result.user;
            displayUserInfo(currentUser);
        })
        .catch(error => alert("登入失敗: " + error.message));
});

// 登出
logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
        currentUser = null;
        hideUserInfo();
    });
});

// 監聽使用者登入狀態
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        displayUserInfo(user);
        loadReservations();
    } else {
        hideUserInfo();
    }
});

// 顯示使用者資訊
function displayUserInfo(user) {
    userName.textContent = user.displayName;
    userPic.src = user.photoURL;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "block";
    userInfo.style.display = "block";
    reservationSection.style.display = "block";
}

// 隱藏使用者資訊
function hideUserInfo() {
    loginBtn.style.display = "block";
    logoutBtn.style.display = "none";
    userInfo.style.display = "none";
    reservationSection.style.display = "none";
    reservationList.innerHTML = "";
}

// 提交預約表單
reservationForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!currentUser) return alert("請先登入！");

    const date = document.getElementById("date").value;
    const time = document.getElementById("time").value;
    const reservationId = database.ref("reservations/" + currentUser.uid).push().key;

    database.ref("reservations/" + currentUser.uid + "/" + reservationId).set({ id: reservationId, date, time });
    loadReservations();
    reservationForm.reset();
});

// 載入使用者的預約
function loadReservations() {
    if (!currentUser) return;
    reservationList.innerHTML = "";

    database.ref("reservations/" + currentUser.uid).once("value", snapshot => {
        snapshot.forEach(childSnapshot => {
            const reservation = childSnapshot.val();
            const listItem = document.createElement("li");
            listItem.innerHTML = `${reservation.date} ${reservation.time} <button class='delete-btn' data-id='${reservation.id}'>刪除</button>`;
            reservationList.appendChild(listItem);
        });
    });
}
