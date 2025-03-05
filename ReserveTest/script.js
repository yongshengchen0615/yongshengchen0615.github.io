// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// DOM 元素
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const userDetailsForm = document.getElementById("user-details-form");
const saveUserDetailsBtn = document.getElementById("save-user-details");
const reservationForm = document.getElementById("reservation-form");
const reservationList = document.getElementById("reservation-list");

// **修正登入監聽邏輯**
auth.onAuthStateChanged(user => {
    if (user) {
        console.log("用戶登入成功：", user.displayName);
        userInfo.style.display = "block";
        userName.textContent = user.displayName;
        userPic.src = user.photoURL;
        loginBtn.style.display = "none";
        logoutBtn.style.display = "block";

        // **確保 Firebase 資料庫回應後再顯示內容**
        database.ref("users/" + user.uid).once("value").then(snapshot => {
            if (snapshot.exists()) {
                console.log("用戶基本資料已存在");
                userDetailsForm.style.display = "none";
                reservationForm.style.display = "block";
                loadReservations(user.uid);
            } else {
                console.log("用戶基本資料不存在，請填寫");
                userDetailsForm.style.display = "block";
                reservationForm.style.display = "none";
            }
        }).catch(error => {
            console.error("讀取用戶資料錯誤：", error);
        });

    } else {
        console.log("用戶未登入");
        userInfo.style.display = "none";
        loginBtn.style.display = "block";
        logoutBtn.style.display = "none";
        userDetailsForm.style.display = "none";
        reservationForm.style.display = "none";
        reservationList.innerHTML = "";
    }
});

// **修正 Google 登入功能**
loginBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(result => {
            console.log("登入成功：", result.user);
        })
        .catch(error => {
            console.error("登入失敗：", error.message);
            alert("登入失敗：" + error.message);
        });
});

// **登出功能**
logoutBtn.addEventListener("click", () => {
    auth.signOut()
        .then(() => console.log("已登出"))
        .catch(error => console.error("登出失敗：", error));
});
