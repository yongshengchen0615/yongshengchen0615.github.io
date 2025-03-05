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
const db = firebase.firestore(); // ✅ Firestore 正確初始化

// 取得按鈕與顯示使用者資訊的元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const reservationForm = document.getElementById("reservation-form");
const reservationList = document.getElementById("reservation-list");
const appointmentsUl = document.getElementById("appointments");

let currentUser = null;

// 登入功能
loginBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(result => {
            currentUser = result.user;
            userName.textContent = currentUser.displayName;
            userPic.src = currentUser.photoURL;
            loginBtn.style.display = "none";
            logoutBtn.style.display = "block";
            userInfo.style.display = "block";
            reservationForm.style.display = "block";
            reservationList.style.display = "block";
            loadAppointments();
        })
        .catch(error => alert("登入失敗: " + error.message));
});

// 登出功能
logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
        currentUser = null;
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        userInfo.style.display = "none";
        reservationForm.style.display = "none";
        reservationList.style.display = "none";
    });
});

// 讀取使用者狀態
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        reservationForm.style.display = "block";
        reservationList.style.display = "block";
        loadAppointments();
    }
});

// 新增預約
function addAppointment() {
    if (!currentUser) return alert("請先登入！");
    const name = document.getElementById("appointment-name").value;
    const time = document.getElementById("appointment-time").value;
    if (!name || !time) return alert("請填寫完整資訊");
    const newAppointment = database.ref("appointments").push();
    newAppointment.set({ id: newAppointment.key, userId: currentUser.uid, name, time });
}

// 讀取預約
function loadAppointments() {
    if (!currentUser) return;
    database.ref("appointments").orderByChild("userId").equalTo(currentUser.uid).on("value", snapshot => {
        appointmentsUl.innerHTML = "";
        snapshot.forEach(childSnapshot => {
            const data = childSnapshot.val();
            appointmentsUl.innerHTML += `<li>${data.name} - ${data.time}</li>`;
        });
    });
}
