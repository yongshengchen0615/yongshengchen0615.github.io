// 1. 匯入 Firebase v9+
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// 2. Firebase 設定
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

// 3. 初始化 Firebase & Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let userId = "";
let userName = "";

// 4. 初始化 LIFF，並強制要求從 LINE 開啟
async function initLIFF() {
    await liff.init({ liffId: "2005939681-bZ9XB8dP" });

    if (!liff.isInClient()) {
        alert("請透過 LINE 聊天視窗開啟此應用程式！");
        window.location.href = "https://line.me/R/"; // 跳轉到 LINE
        return;
    }

    console.log("✅ LIFF 初始化成功");

    try {
        const profile = await liff.getProfile();
        userId = profile.userId;
        userName = profile.displayName;
        document.getElementById("userId").textContent = userId;
        document.getElementById("userName").textContent = userName;
    } catch (error) {
        console.error("❌ 獲取用戶資料失敗", error);
        document.getElementById("userId").textContent = "未知使用者";
        document.getElementById("userName").textContent = "未知";
    }

    // 載入留言
    loadMessages();
}

function loadMessages() {
    let messagesList = document.getElementById("messagesList");
    messagesList.innerHTML = "";

    const q = collection(db, "messages");
    onSnapshot(q, snapshot => {
        messagesList.innerHTML = "";
        snapshot.docs.forEach(doc => {
            let msg = doc.data();
            let isOwner = (msg.userId === userId);

            let div = document.createElement("div");
            div.classList.add("message");
            div.innerHTML = `
                <p><strong>${msg.userName}:</strong> ${msg.text}</p>
                <p class="user-info">(${new Date(msg.timestamp?.seconds * 1000).toLocaleString()})</p>
                ${isOwner ? `
                    <span class="actions" onclick="editMessage('${doc.id}', '${msg.text}')">編輯</span>
                    <span class="actions" onclick="deleteMessage('${doc.id}')">刪除</span>
                ` : ""}
            `;
            messagesList.appendChild(div);
        });
    });
}

async function addMessage() {
    let input = document.getElementById("messageInput");
    let text = input.value.trim();
    if (text === "" || !userId) return;

    await addDoc(collection(db, "messages"), {
        text: text,
        userId: userId,
        userName: userName,
        timestamp: serverTimestamp()
    });

    input.value = "";
    loadMessages();
}

async function editMessage(id, oldText) {
    let newText = prompt("修改留言內容：", oldText);
    if (newText !== null && newText.trim() !== "") {
        await updateDoc(doc(db, "messages", id), { text: newText.trim() });
    }
}

async function deleteMessage(id) {
    if (confirm("確定要刪除嗎？")) {
        await deleteDoc(doc(db, "messages", id));
    }
}

// 初始化 LIFF
initLIFF();
