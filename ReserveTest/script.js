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
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// DOM 元素
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const userName = document.getElementById('user-name');
const bookingContainer = document.getElementById('booking-container');
const bookingList = document.getElementById('booking-list');
const bookingTimeInput = document.getElementById('booking-time');
const addBookingBtn = document.getElementById('add-booking-btn');

let userId = null;

// Google 登入
loginBtn.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(result => console.log("登入成功"))
        .catch(error => console.error(error));
});

// 登出
logoutBtn.addEventListener('click', () => {
    auth.signOut().then(() => console.log("登出成功"));
});

// 監聽登入狀態
auth.onAuthStateChanged(user => {
    if (user) {
        userId = user.uid;
        userName.textContent = user.displayName;
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline';
        userInfo.style.display = 'block';
        bookingContainer.style.display = 'block';
        loadBookings();
    } else {
        userId = null;
        loginBtn.style.display = 'inline';
        logoutBtn.style.display = 'none';
        userInfo.style.display = 'none';
        bookingContainer.style.display = 'none';
        bookingList.innerHTML = '';
    }
});

// 加載預約資料
function loadBookings() {
    bookingList.innerHTML = '';
    db.collection('bookings')
        .where('userId', '==', userId)
        .orderBy('time', 'asc')
        .onSnapshot(snapshot => {
            bookingList.innerHTML = '';
            snapshot.forEach(doc => {
                const data = doc.data();
                const li = document.createElement('li');
                li.textContent = new Date(data.time).toLocaleString();
                
                const editBtn = document.createElement('button');
                editBtn.textContent = "修改";
                editBtn.onclick = () => editBooking(doc.id, data.time);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = "刪除";
                deleteBtn.onclick = () => deleteBooking(doc.id);
                
                li.appendChild(editBtn);
                li.appendChild(deleteBtn);
                bookingList.appendChild(li);
            });
        });
}

// 新增預約
addBookingBtn.addEventListener('click', () => {
    const bookingTime = bookingTimeInput.value;
    if (!bookingTime) return alert("請選擇時間");

    db.collection('bookings').add({
        userId: userId,
        time: new Date(bookingTime).toISOString()
    }).then(() => {
        bookingTimeInput.value = '';
    }).catch(error => console.error(error));
});

// 修改預約
function editBooking(bookingId, oldTime) {
    const newTime = prompt("請輸入新的時間", new Date(oldTime).toISOString().slice(0, 16));
    if (newTime) {
        db.collection('bookings').doc(bookingId).update({
            time: new Date(newTime).toISOString()
        }).catch(error => console.error(error));
    }
}

// 刪除預約
function deleteBooking(bookingId) {
    if (confirm("確定刪除嗎？")) {
        db.collection('bookings').doc(bookingId).delete()
            .catch(error => console.error(error));
    }
}
