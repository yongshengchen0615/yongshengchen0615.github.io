// 使用 Firebase 模組化 SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, serverTimestamp, orderBy, query } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Firebase 設定（請填入你的 Firebase 專案資訊）
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

document.addEventListener("DOMContentLoaded", () => {
    const userInfoForm = document.getElementById("userInfoForm");
    const appointmentForm = document.getElementById("appointmentForm");
    const confirmUserInfoBtn = document.getElementById("confirmUserInfo");
    const phoneInput = document.getElementById("phone");
    const nameInput = document.getElementById("name");
    const genderSelect = document.getElementById("gender");
    const userDisplay = document.getElementById("userDisplay");
    const dateInput = document.getElementById("date");
    const timeInput = document.getElementById("time");
    const appointmentsList = document.getElementById("appointmentsList");
    const modal = document.getElementById("successModal");
    const closeModal = document.getElementById("closeModal");

    let userInfo = null;

    // ✅ 監聽使用者輸入基本資訊
    confirmUserInfoBtn.addEventListener("click", () => {
        const phone = phoneInput.value.trim();
        const name = nameInput.value.trim();
        const gender = genderSelect.value;

        if (!phone || !name || !gender) {
            alert("請完整填寫電話、姓氏與性別");
            return;
        }

        userInfo = { phone, name, gender };
        
        // ✅ 顯示使用者資訊
        userDisplay.textContent = `${name}${gender === "男" ? "先生" : "小姐"} 電話：${phone}`;
        userDisplay.style.display = "block";

        // ✅ 顯示預約表單
        userInfoForm.style.display = "none";
        appointmentForm.classList.remove("hidden");
    });

    // ✅ 監聽表單提交（預約）
    appointmentForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        let date = dateInput.value;
        let time = timeInput.value;

        if (!date || !time) {
            alert("請選擇日期和時間");
            return;
        }

        try {
            await addDoc(collection(db, "appointments"), {
                ...userInfo,
                date,
                time,
                timestamp: serverTimestamp()
            });

            modal.style.display = "block";
            appointmentForm.reset();
        } catch (error) {
            alert("❌ 預約失敗，請稍後再試");
        }
    });

    closeModal.addEventListener("click", () => {
        modal.style.display = "none";
    });
});
