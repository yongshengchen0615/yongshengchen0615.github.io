import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithCustomToken, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, push, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const liffId = "2005939681-ayjyxlz3";  // 請替換為你的 LIFF ID

// Firebase 設定
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

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

async function initializeLIFF() {
    await liff.init({ liffId });

    if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        handleLoginSuccess(profile);
    } else {
        document.getElementById("loginBtn").style.display = "block";
    }
}

document.getElementById("loginBtn").addEventListener("click", async () => {
    await liff.login();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut(auth);
    liff.logout();
    location.reload();
});

async function handleLoginSuccess(profile) {
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("logoutBtn").style.display = "block";
    document.getElementById("userInfo").style.display = "block";
    document.getElementById("messageBoard").style.display = "block";

    document.getElementById("userName").innerText = profile.displayName;
    document.getElementById("userImage").src = profile.pictureUrl;

    // 取得 LINE Token 並傳送至 Firebase 進行驗證
    const idToken = await liff.getIDToken();
    const credential = signInWithCustomToken(auth, idToken);
    
    credential.then(() => {
        loadMessages(profile.userId);
    }).catch((error) => {
        console.error("Firebase 登入失敗", error);
    });
}

function loadMessages(userId) {
    const messagesList = document.getElementById("messagesList");
    messagesList.innerHTML = "";

    onValue(ref(db, "messages"), (snapshot) => {
        messagesList.innerHTML = "";
        snapshot.forEach((childSnapshot) => {
            const msgData = childSnapshot.val();
            const msgId = childSnapshot.key;

            const li = document.createElement("li");
            li.innerHTML = `<span>${msgData.name}: ${msgData.text}</span>`;

            if (msgData.userId === userId) {
                const editBtn = document.createElement("button");
                editBtn.innerText = "編輯";
                editBtn.onclick = () => editMessage(msgId, msgData.text);

                const deleteBtn = document.createElement("button");
                deleteBtn.innerText = "刪除";
                deleteBtn.onclick = () => deleteMessage(msgId);

                li.appendChild(editBtn);
                li.appendChild(deleteBtn);
            }

            messagesList.appendChild(li);
        });
    });
}

function sendMessage() {
    const messageInput = document.getElementById("messageInput");
    const text = messageInput.value.trim();

    if (text === "") return;

    liff.getProfile().then((profile) => {
        push(ref(db, "messages"), {
            userId: profile.userId,
            name: profile.displayName,
            text: text
        });
        messageInput.value = "";  // 清空輸入框
    });
}

function editMessage(msgId, oldText) {
    const newText = prompt("修改留言:", oldText);
    if (newText !== null) {
        update(ref(db, "messages/" + msgId), { text: newText });
    }
}

function deleteMessage(msgId) {
    if (confirm("確定要刪除這則留言嗎？")) {
        remove(ref(db, "messages/" + msgId));
    }
}

document.getElementById("sendMessageBtn").addEventListener("click", sendMessage);

initializeLIFF();
