import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 🔥 替換為你的 Firebase 配置
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

// ✅ 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ✅ 加載留言
const messageList = document.getElementById("messageList");

function loadMessages() {
    onSnapshot(collection(db, "messages"), (snapshot) => {
        messageList.innerHTML = "";
        snapshot.forEach(doc => {
            const data = doc.data();
            const li = document.createElement("li");
            li.innerHTML = `
                ${data.text}
                <button class="edit-btn" onclick="editMessage('${doc.id}', '${data.text}')">編輯</button>
                <button class="delete-btn" onclick="deleteMessage('${doc.id}')">刪除</button>
            `;
            messageList.appendChild(li);
        });
    });
}

// ✅ 新增留言
window.addMessage = async function () {
    const messageInput = document.getElementById("message");
    const message = messageInput.value.trim();
    if (message === "") return;

    await addDoc(collection(db, "messages"), {
        text: message,
        timestamp: serverTimestamp()
    });
    messageInput.value = "";
};

// ✅ 編輯留言
window.editMessage = async function (id, oldMessage) {
    const newMessage = prompt("修改留言:", oldMessage);
    if (newMessage !== null) {
        await updateDoc(doc(db, "messages", id), { text: newMessage });
    }
};

// ✅ 刪除留言
window.deleteMessage = async function (id) {
    if (confirm("確定要刪除這則留言嗎？")) {
        await deleteDoc(doc(db, "messages", id));
    }
};

// ✅ 頁面加載時載入留言
loadMessages();
