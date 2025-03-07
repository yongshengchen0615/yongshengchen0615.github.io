// 使用 Firebase 模組化 SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, serverTimestamp, orderBy, query } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Firebase 配置（請填入你的 Firebase 設定）
const firebaseConfig = {
    apiKey: "AIzaSyCQpelp4H9f-S0THHgSiIJHCzyvNG3AGvs",
  authDomain: "reservesystem-c8bbc.firebaseapp.com",
  databaseURL: "https://reservesystem-c8bbc-default-rtdb.firebaseio.com",
  projectId: "reservesystem-c8bbc",
  storageBucket: "reservesystem-c8bbc.firebasestorage.app",
  messagingSenderId: "138232489371",
  appId: "1:138232489371:web:b5358137baf293f9ae2d3e",
  measurementId: "G-RZ9XSVK925"
};

// 初始化 Firebase & Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 監聽表單提交
document.getElementById("appointmentForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    let name = document.getElementById("name").value;
    let phone = document.getElementById("phone").value;
    let date = document.getElementById("date").value;
    let time = document.getElementById("time").value;

    if (name && phone && date && time) {
        try {
            await addDoc(collection(db, "appointments"), {
                name: name,
                phone: phone,
                date: date,
                time: time,
                timestamp: serverTimestamp()
            });
            alert("預約成功！");
            document.getElementById("appointmentForm").reset();
        } catch (error) {
            console.error("錯誤: ", error);
        }
    } else {
        alert("請填寫所有欄位");
    }
});

// 即時監聽 Firestore 預約列表
const appointmentsList = document.getElementById("appointmentsList");

onSnapshot(query(collection(db, "appointments"), orderBy("timestamp", "desc")), (snapshot) => {
    appointmentsList.innerHTML = "";
    snapshot.forEach(doc => {
        let data = doc.data();
        let listItem = document.createElement("li");
        listItem.textContent = `${data.name} - ${data.phone} - ${data.date} ${data.time}`;
        appointmentsList.appendChild(listItem);
    });
});
