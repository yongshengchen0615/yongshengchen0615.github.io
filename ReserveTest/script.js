// Firebase 設定（使用你的 Firebase 專案資訊）
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

// 取得 HTML 元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const bookingForm = document.getElementById("booking-form");
const datePicker = document.getElementById("date-picker");
const timePicker = document.getElementById("time-picker");
const submitBtn = document.getElementById("submit-btn");
const bookingList = document.getElementById("booking-list");

// 登入
loginBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(result => {
            const user = result.user;
            userName.textContent = user.displayName;
            userPic.src = user.photoURL;
            loginBtn.style.display = "none";
            logoutBtn.style.display = "block";
            userInfo.style.display = "block";
            bookingForm.style.display = "block";
            loadBookings(); // 載入預約列表
        })
        .catch(error => {
            alert("登入失敗：" + error.message);
        });
});

// 登出
logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        userInfo.style.display = "none";
        bookingForm.style.display = "none";
        bookingList.innerHTML = ""; // 清空預約列表
    });
});

// 提交預約
submitBtn.addEventListener("click", () => {
    const user = auth.currentUser;
    if (!user) return alert("請先登入");

    const date = datePicker.value;
    const time = timePicker.value;
    if (!date || !time) return alert("請選擇日期與時間");

    const bookingData = {
        name: user.displayName,
        date: date,
        time: time
    };

    // 將預約資料存入 Firebase
    const bookingRef = database.ref("bookings").push();
    bookingRef.set(bookingData)
        .then(() => {
            alert("預約成功！");
            loadBookings(); // 重新載入預約列表
        })
        .catch(error => {
            alert("預約失敗：" + error.message);
        });
});

// 讀取預約資料
function loadBookings() {
    bookingList.innerHTML = "";
    database.ref("bookings").once("value", snapshot => {
        snapshot.forEach(childSnapshot => {
            const data = childSnapshot.val();
            const li = document.createElement("li");
            li.textContent = `${data.name} 預約於 ${data.date} ${data.time}`;
            bookingList.appendChild(li);
        });
    });
}
