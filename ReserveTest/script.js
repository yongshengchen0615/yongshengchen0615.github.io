import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getDatabase, ref, push, set, update, remove, onChildAdded, onChildChanged, onChildRemoved } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js";

// 🔹 Firebase 設定
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

// 🔹 初始化 Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const messagesRef = ref(database, "messages");

// 🔹 送出留言
document.getElementById("sendBtn").addEventListener("click", () => {
    const username = document.getElementById("username").value.trim();
    const message = document.getElementById("message").value.trim();

    if (username && message) {
        const newMessageRef = push(messagesRef);
        set(newMessageRef, {
            username: username,
            message: message,
            timestamp: new Date().getTime()
        });

        document.getElementById("message").value = ""; // 清空輸入框
    } else {
        alert("請輸入名稱和留言！");
    }
});

// 🔹 監聽 Firebase 新增留言
onChildAdded(messagesRef, (snapshot) => {
    const data = snapshot.val();
    createMessageElement(snapshot.key, data.username, data.message);
});

// 🔹 監聽 Firebase 修改留言
onChildChanged(messagesRef, (snapshot) => {
    const data = snapshot.val();
    const messageElement = document.getElementById(snapshot.key);
    if (messageElement) {
        messageElement.querySelector(".message-text").innerText = data.message;
    }
});

// 🔹 監聽 Firebase 刪除留言
onChildRemoved(messagesRef, (snapshot) => {
    const messageElement = document.getElementById(snapshot.key);
    if (messageElement) {
        messageElement.remove();
    }
});

// 🔹 創建留言元素
function createMessageElement(id, username, message) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message");
    messageDiv.id = id;
    messageDiv.innerHTML = `
        <strong>${username}:</strong> <span class="message-text">${message}</span>
        <button onclick="editMessage('${id}')">編輯</button>
        <button onclick="deleteMessage('${id}')">刪除</button>
    `;
    document.getElementById("messages").appendChild(messageDiv);
}

// 🔹 修改留言
window.editMessage = function(id) {
    const newMessage = prompt("請輸入新的留言內容：");
    if (newMessage) {
        const messageRef = ref(database, `messages/${id}`);
        update(messageRef, { message: newMessage });
    }
};

// 🔹 刪除留言
window.deleteMessage = function(id) {
    if (confirm("確定要刪除這則留言嗎？")) {
        const messageRef = ref(database, `messages/${id}`);
        remove(messageRef);
    }
};
