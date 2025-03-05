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
const db = firebase.database();

// 取得按鈕與顯示使用者資訊的元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const reservationSection = document.getElementById("reservation-section");

const reservationList = document.getElementById("reservation-list");
const reservationInput = document.getElementById("reservation-input");
const addReservationBtn = document.getElementById("add-reservation");

let currentUser = null;

// Google 登入
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
            reservationSection.style.display = "block";
            loadReservations();
        })
        .catch(error => alert("登入失敗: " + error.message));
});

// 登出
logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        userInfo.style.display = "none";
        reservationSection.style.display = "none";
        currentUser = null;
    });
});

// 加載預約紀錄
function loadReservations() {
    if (!currentUser) return;
    db.ref("reservations/" + currentUser.uid).on("value", snapshot => {
        reservationList.innerHTML = "";
        snapshot.forEach(childSnapshot => {
            const reservation = childSnapshot.val();
            const key = childSnapshot.key;
            const li = document.createElement("li");
            li.textContent = reservation;
            
            // 編輯按鈕
            const editBtn = document.createElement("button");
            editBtn.textContent = "編輯";
            editBtn.onclick = () => {
                const newText = prompt("修改預約內容:", reservation);
                if (newText) db.ref("reservations/" + currentUser.uid + "/" + key).set(newText);
            };
            
            // 刪除按鈕
            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "刪除";
            deleteBtn.onclick = () => db.ref("reservations/" + currentUser.uid + "/" + key).remove();
            
            li.appendChild(editBtn);
            li.appendChild(deleteBtn);
            reservationList.appendChild(li);
        });
    });
}

// 新增預約
addReservationBtn.addEventListener("click", () => {
    if (!currentUser || !reservationInput.value.trim()) return;
    db.ref("reservations/" + currentUser.uid).push(reservationInput.value.trim());
    reservationInput.value = "";
});
