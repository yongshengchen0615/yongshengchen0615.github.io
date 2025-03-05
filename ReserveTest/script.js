// Firebase v9+ 模組化引入
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    where, 
    getDocs, 
    deleteDoc, 
    updateDoc, 
    orderBy, 
    doc, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase 配置
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
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM 元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const bookingContainer = document.getElementById("booking-container");
const bookingList = document.getElementById("booking-list");
const bookingTimeInput = document.getElementById("booking-time");
const addBookingBtn = document.getElementById("add-booking-btn");

let userId = null;

// Google 登入
loginBtn.addEventListener("click", async () => {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        console.log("登入成功", result.user);
    } catch (error) {
        console.error("登入失敗", error);
    }
});

// 登出
logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        console.log("登出成功");
    } catch (error) {
        console.error("登出失敗", error);
    }
});

// 監聽登入狀態
onAuthStateChanged(auth, (user) => {
    if (user) {
        userId = user.uid;
        userName.textContent = user.displayName;
        loginBtn.style.display = "none";
        logoutBtn.style.display = "inline";
        userInfo.style.display = "block";
        bookingContainer.style.display = "block";
        loadBookings();
    } else {
        userId = null;
        loginBtn.style.display = "inline";
        logoutBtn.style.display = "none";
        userInfo.style.display = "none";
        bookingContainer.style.display = "none";
        bookingList.innerHTML = "";
    }
});

// 加載預約資料（即時更新）
function loadBookings() {
    if (!userId) return;
    const q = query(collection(db, "bookings"), where("userId", "==", userId), orderBy("time", "asc"));
    
    onSnapshot(q, (snapshot) => {
        bookingList.innerHTML = "";
        snapshot.forEach((doc) => {
            const data = doc.data();
            const li = document.createElement("li");
            li.textContent = new Date(data.time).toLocaleString();

            const editBtn = document.createElement("button");
            editBtn.textContent = "修改";
            editBtn.onclick = () => editBooking(doc.id, data.time);

            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "刪除";
            deleteBtn.onclick = () => deleteBooking(doc.id);

            li.appendChild(editBtn);
            li.appendChild(deleteBtn);
            bookingList.appendChild(li);
        });
    });
}

// 新增預約
addBookingBtn.addEventListener("click", async () => {
    const bookingTime = bookingTimeInput.value;
    if (!bookingTime) return alert("請選擇時間");

    try {
        await addDoc(collection(db, "bookings"), {
            userId: userId,
            time: new Date(bookingTime).toISOString()
        });
        bookingTimeInput.value = "";
    } catch (error) {
        console.error("預約失敗", error);
    }
});

// 修改預約
async function editBooking(bookingId, oldTime) {
    const newTime = prompt("請輸入新的時間", new Date(oldTime).toISOString().slice(0, 16));
    if (newTime) {
        try {
            await updateDoc(doc(db, "bookings", bookingId), {
                time: new Date(newTime).toISOString()
            });
        } catch (error) {
            console.error("修改失敗", error);
        }
    }
}

// 刪除預約
async function deleteBooking(bookingId) {
    if (confirm("確定刪除嗎？")) {
        try {
            await deleteDoc(doc(db, "bookings", bookingId));
        } catch (error) {
            console.error("刪除失敗", error);
        }
    }
}
