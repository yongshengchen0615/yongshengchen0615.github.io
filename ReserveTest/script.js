// Firebase 設定
const firebaseConfig = {
    apiKey: "你的API Key",
    authDomain: "你的Auth網域",
    projectId: "你的Project ID",
    storageBucket: "你的Storage桶",
    messagingSenderId: "你的Sender ID",
    appId: "你的App ID"
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
        loadUserAppointments(result.user.uid);
    } catch (error) {
        alert("登入失敗: " + error.message);
    }
});

// 登出
logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => location.reload());
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
