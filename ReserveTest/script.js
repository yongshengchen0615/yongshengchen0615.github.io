// Firebase 設定
const firebaseConfig = {
    apiKey: "AIzaSyCQpelp4H9f-S0THHgSiIJHCzyvNG3AGvs",
    authDomain: "reservesystem-c8bbc.firebaseapp.com",
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

// Google 登入
document.getElementById("login-btn").addEventListener("click", async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        const result = await auth.signInWithPopup(provider);
        loadUserAppointments(result.user.uid);
    } catch (error) {
        alert("登入失敗: " + error.message);
    }
});

// 監聽登入狀態
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById("appointment-section").style.display = "block";
        loadUserAppointments(user.uid);
    }
});

// 提交預約
document.getElementById("submit-appointment").addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return alert("請先登入！");

    const date = document.getElementById("appointment-date").value;
    const time = document.getElementById("appointment-time").value;

    await db.collection("appointments").add({ userId: user.uid, date, time });
    alert("預約成功！");
    loadUserAppointments(user.uid);
});

// 顯示 & 刪除預約
async function loadUserAppointments(userId) {
    const appointmentsList = document.getElementById("user-appointments");
    appointmentsList.innerHTML = "";
    const querySnapshot = await db.collection("appointments").where("userId", "==", userId).get();
    querySnapshot.forEach(doc => {
        const li = document.createElement("li");
        li.textContent = `${doc.data().date} - ${doc.data().time}`;
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "取消";
        cancelBtn.onclick = async () => {
            await db.collection("appointments").doc(doc.id).delete();
            alert("預約已取消！");
            loadUserAppointments(userId);
        };
        li.appendChild(cancelBtn);
        appointmentsList.appendChild(li);
    });
}
