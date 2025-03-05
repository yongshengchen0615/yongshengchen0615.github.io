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

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const reservationForm = document.getElementById("reservation-form");
const reservationList = document.getElementById("reservation-list");
const appointmentsUl = document.getElementById("appointments");

let currentUser = null;

// 監聽登入狀態變化
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        userName.textContent = currentUser.displayName;
        userPic.src = currentUser.photoURL;

        loginBtn.style.display = "none";
        logoutBtn.style.display = "block";
        userInfo.style.display = "block";
        reservationForm.style.display = "block";
        reservationList.style.display = "block";

        loadAppointments(); // 讀取當前使用者的預約
    } else {
        currentUser = null;
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        userInfo.style.display = "none";
        reservationForm.style.display = "none";
        reservationList.style.display = "none";
    }
});

// Google 登入
loginBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(error => alert("登入失敗: " + error.message));
});

// 登出
logoutBtn.addEventListener("click", () => {
    auth.signOut();
});

// ✅ 新增預約（僅限已登入的使用者）
function addAppointment() {
    if (!currentUser) return alert("請先登入！");

    const name = document.getElementById("appointment-name").value;
    const time = document.getElementById("appointment-time").value;
    if (!name || !time) return alert("請填寫完整資訊");

    const newAppointment = database.ref("appointments").push();
    newAppointment.set({
        id: newAppointment.key,
        userId: currentUser.uid, // 🔹 存儲用戶的 UID
        name: name,
        time: time
    }).then(() => {
        document.getElementById("appointment-name").value = "";
        document.getElementById("appointment-time").value = "";
    }).catch(error => console.error("預約失敗", error));
}

// ✅ 讀取當前登入者的預約
function loadAppointments() {
    if (!currentUser) return;

    database.ref("appointments")
        .orderByChild("userId")
        .equalTo(currentUser.uid) // 🔹 只讀取當前登入使用者的預約
        .on("value", snapshot => {
            appointmentsUl.innerHTML = "";
            snapshot.forEach(childSnapshot => {
                const data = childSnapshot.val();
                const li = document.createElement("li");
                li.innerHTML = `
                    ${data.name} - ${data.time}
                    <button class="edit-btn" onclick="editAppointment('${data.id}', '${data.name}', '${data.time}')">編輯</button>
                    <button class="delete-btn" onclick="deleteAppointment('${data.id}')">刪除</button>
                `;
                appointmentsUl.appendChild(li);
            });
        });
}

// ✅ 編輯預約（只允許修改自己的）
function editAppointment(id, oldName, oldTime) {
    if (!currentUser) return alert("請先登入！");

    const newName = prompt("請輸入新的預約名稱", oldName);
    const newTime = prompt("請輸入新的預約時間", oldTime);
    if (!newName || !newTime) return;

    database.ref("appointments/" + id).update({
        name: newName,
        time: newTime
    }).catch(error => console.error("更新失敗", error));
}

// ✅ 刪除預約（只允許刪除自己的）
function deleteAppointment(id) {
    if (!currentUser) return alert("請先登入！");

    if (confirm("確定要刪除這個預約嗎？")) {
        database.ref("appointments/" + id).remove().catch(error => console.error("刪除失敗", error));
    }
}
