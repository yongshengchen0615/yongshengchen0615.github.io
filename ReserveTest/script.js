// Firebase 設定
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
const userDetailsForm = document.getElementById("user-details-form");
const saveUserDetailsBtn = document.getElementById("save-user-details");
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

        // 檢查是否已填寫基本資料
        database.ref("users/" + user.uid).once("value", snapshot => {
            if (snapshot.exists()) {
                userDetailsForm.style.display = "none";
                reservationForm.style.display = "block";
                loadReservations(user.uid);
            } else {
                userDetailsForm.style.display = "block";
                reservationForm.style.display = "none";
            }
        });
    } else {
        userInfo.style.display = "none";
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        userDetailsForm.style.display = "none";
        reservationForm.style.display = "none";
        reservationList.innerHTML = "";
    }
});

// 儲存用戶基本資料
saveUserDetailsBtn.addEventListener("click", () => {
    const user = auth.currentUser;
    if (!user) return;

    const lastName = document.getElementById("last-name").value;
    const gender = document.getElementById("gender").value;
    const phone = document.getElementById("phone").value;

    if (!lastName || !phone) {
        alert("請填寫完整資料！");
        return;
    }

    database.ref("users/" + user.uid).set({
        name: user.displayName,
        lastName: lastName,
        gender: gender,
        phone: phone,
        email: user.email
    });

    alert("基本資料已儲存！");
    userDetailsForm.style.display = "none";
    reservationForm.style.display = "block";
});
