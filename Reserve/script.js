// Firebase 設定（請填入你的 Firebase 專案資訊）
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

// 取得 Firebase Authentication 服務
const auth = firebase.auth();

// 取得 Firebase Analytics 服務（可用於分析）
const analytics = firebase.analytics();

// 取得按鈕與顯示使用者資訊的元素
const loginBtn = document.getElementById("login-btn"); // Google 登入按鈕
const logoutBtn = document.getElementById("logout-btn"); // 登出按鈕
const userInfo = document.getElementById("user-info"); // 使用者資訊區塊
const userName = document.getElementById("user-name"); // 使用者名稱
const userPic = document.getElementById("user-pic"); // 使用者頭像

// Google 登入按鈕事件
loginBtn.addEventListener("click", () => {
    // 創建 Google 登入提供者
    const provider = new firebase.auth.GoogleAuthProvider();

    // 使用彈出式登入（Popup）
    auth.signInWithPopup(provider)
        .then(result => {
            // 取得登入的使用者資訊
            const user = result.user;

            // 顯示使用者名稱
            userName.textContent = user.displayName;

            // 顯示使用者頭像
            userPic.src = user.photoURL;

            // 隱藏「登入」按鈕，顯示「登出」按鈕
            loginBtn.style.display = "none";
            logoutBtn.style.display = "block";

            // 顯示使用者資訊區塊
            userInfo.style.display = "block";
        })
        .catch(error => {
            // 若發生錯誤，顯示錯誤訊息
            alert("登入失敗: " + error.message);
        });
});

// 登出按鈕事件
logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
        // 恢復「登入」按鈕，隱藏「登出」按鈕
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";

        // 隱藏使用者資訊區塊
        userInfo.style.display = "none";
    });
});
