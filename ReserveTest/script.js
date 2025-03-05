// Firebase 設定（請替換為你的 Firebase 專案資訊）
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
const db = firebase.firestore();

// 元素選取
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");

// Google 登入
loginBtn.addEventListener("click", async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        const result = await auth.signInWithPopup(provider);
        const user = result.user;

        userName.textContent = user.displayName;
        userPic.src = user.photoURL;
        loginBtn.style.display = "none";
        logoutBtn.style.display = "block";
        userInfo.style.display = "block";
        document.getElementById("appointment-section").style.display = "block";

        loadUserAppointments(user.uid);
    } catch (error) {
        alert("登入失敗: " + error.message);
    }
});

// 登出
logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        userInfo.style.display = "none";
        document.getElementById("appointment-section").style.display = "none";
    });
});

// 監聽登入狀態
auth.onAuthStateChanged(user => {
    if (user) {
        userName.textContent = user.displayName;
        userPic.src = user.photoURL;
        loginBtn.style.display = "none";
        logoutBtn.style.display = "block";
        userInfo.style.display = "block";
        document.getElementById("appointment-section").style.display = "block";
        loadUserAppointments(user.uid);
    }
});

// 預約功能
document.getElementById("submit-appointment").addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return alert("請先登入！");

    const date = document.getElementById("appointment-date").value;
    const time = document.getElementById("appointment-time").value;

    await db.collection("appointments").add({ userId: user.uid, date, time });
    alert("預約成功！");
    loadUserAppointments(user.uid);
});

// 顯示預約
async function loadUserAppointments(userId) {
    const appointmentsList = document.getElementById("user-appointments");
    appointmentsList.innerHTML = "";
    const querySnapshot = await db.collection("appointments").where("userId", "==", userId).get();
    querySnapshot.forEach(doc => {
        const li = document.createElement("li");
        li.textContent = `${doc.data().date} - ${doc.data().time}`;
        appointmentsList.appendChild(li);
    });
}
