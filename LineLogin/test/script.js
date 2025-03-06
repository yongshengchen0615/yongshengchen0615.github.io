import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-analytics.js";

// LINE LIFF ID
const LINE_LIFF_ID = "2005939681-ayjyxlz3"; 

// Firebase 設定
const firebaseConfig = {
    apiKey: "AIzaSyCQpelp4H9f-S0THHgSiIJHCzyvNG3AGvs",
    authDomain: "reservesystem-c8bbc.firebaseapp.com",
    databaseURL: "https://reservesystem-c8bbc-default-rtdb.firebaseio.com",
    projectId: "reservesystem-c8bbc",
    storageBucket: "reservesystem-c8bbc.appspot.com",
    messagingSenderId: "138232489371",
    appId: "1:138232489371:web:849190b97774b5abae2d3e",
    measurementId: "G-XXDSGNYTV1"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const analytics = getAnalytics(app);

document.addEventListener("DOMContentLoaded", () => {
    initLiff();
    setupEventListeners();
});

async function initLiff() {
    try {
        await liff.init({ liffId: LINE_LIFF_ID });
        if (liff.isLoggedIn()) {
            displayUserProfile();
        }
    } catch (error) {
        console.error("LIFF 初始化失敗:", error);
    }
}

function setupEventListeners() {
    document.getElementById("loginBtn").addEventListener("click", () => liff.login());
    document.getElementById("logoutBtn").addEventListener("click", () => {
        liff.logout();
        location.reload();
    });
    document.getElementById("sendMessageBtn").addEventListener("click", sendMessage);
}

async function displayUserProfile() {
    try {
        const profile = await liff.getProfile();
        document.getElementById("userImage").src = profile.pictureUrl;
        document.getElementById("userName").textContent = `你好, ${profile.displayName}`;
        toggleVisibility(true);
        loadMessages();
    } catch (error) {
        console.error("取得使用者資訊失敗:", error);
    }
}

function toggleVisibility(isLoggedIn) {
    document.getElementById("profile").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("loginBtn").style.display = isLoggedIn ? "none" : "inline-block";
    document.getElementById("logoutBtn").style.display = isLoggedIn ? "inline-block" : "none";
    document.getElementById("chatSection").style.display = isLoggedIn ? "block" : "none";
}

// 發送訊息
async function sendMessage() {
    const messageInput = document.getElementById("messageInput");
    const messageText = messageInput.value.trim();
    if (!messageText) return;

    try {
        await addDoc(collection(db, "messages"), {
            text: messageText,
            timestamp: serverTimestamp()
        });
        messageInput.value = "";
        loadMessages();
    } catch (error) {
        console.error("訊息發送失敗:", error);
    }
}

// 載入訊息
async function loadMessages() {
    const messageList = document.getElementById("messageList");
    messageList.innerHTML = "";
    const querySnapshot = await getDocs(collection(db, "messages"));
    
    querySnapshot.forEach((doc) => {
        const li = document.createElement("li");
        li.textContent = doc.data().text;
        li.addEventListener("dblclick", async () => {
            await deleteDoc(doc.ref);
            loadMessages();
        });
        messageList.appendChild(li);
    });
}
