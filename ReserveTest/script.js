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
const database = firebase.database(); // 這裡使用 Realtime Database，而非 Firestore

// 取得 DOM 元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const bookingForm = document.getElementById("booking-form");
const submitBookingBtn = document.getElementById("submit-booking");

// Google 登入
loginBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(result => {
        const user = result.user;

        // 顯示使用者資訊
        userName.textContent = user.displayName;
        userPic.src = user.photoURL;

        // 顯示表單，隱藏登入按鈕
        loginBtn.style.display = "none";
        logoutBtn.style.display = "block";
        userInfo.style.display = "block";
        bookingForm.style.display = "block";
    }).catch(error => {
        alert("登入失敗: " + error.message);
    });
});

// 登出
logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        userInfo.style.display = "none";
        bookingForm.style.display = "none";
    });
});

// 提交預約
submitBookingBtn.addEventListener("click", () => {
    const service = document.getElementById("service").value;
    const date = document.getElementById("date").value;
    const time = document.getElementById("time").value;
    const user = auth.currentUser;

    if (!user) {
        alert("請先登入再進行預約！");
        return;
    }

    if (!date || !time) {
        alert("請選擇預約日期和時間！");
        return;
    }

    const bookingData = {
        userId: user.uid,
        userName: user.displayName,
        service: service,
        date: date,
        time: time
    };

    // 使用 Realtime Database 儲存預約資料
    const newBookingRef = database.ref("bookings").push();
    newBookingRef.set(bookingData)
        .then(() => {
            alert("預約成功！");
            document.getElementById("date").value = "";
            document.getElementById("time").value = "";
        })
        .catch(error => {
            alert("預約失敗：" + error.message);
        });
});
