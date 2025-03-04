const CLIENT_ID = "2005939681";  // 你的 LINE Channel ID
const REDIRECT_URI = "https://yongshengchen0615.github.io/ReserveTest/"; // 你的回調網址
const CLIENT_SECRET = "8c0a5aae81b608572097e0f438f1dec0"; // 你的 LINE Channel Secret
const STATE = "123456"; // 防止 CSRF 攻擊
let accessToken = "";

document.getElementById("loginBtn").addEventListener("click", loginWithLine);
document.getElementById("logoutBtn").addEventListener("click", logout);

function loginWithLine() {
    const loginUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${STATE}&scope=profile%20openid%20email`;
    window.location.href = loginUrl;
}

function getUrlParameter(name) {
    name = name.replace(/[[]/, "\\[").replace(/[\]]/, "\\]");
    const regex = new RegExp("[\\?&]" + name + "=([^&#]*)");
    const results = regex.exec(window.location.search);
    return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

window.onload = function() {
    const code = getUrlParameter("code");
    if (code) {
        document.getElementById("status").innerText = "登入成功，正在獲取用戶資訊...";
        fetchToken(code);
    }
};

async function fetchToken(code) {
    const response = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: code,
            redirect_uri: REDIRECT_URI,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET
        })
    });

    const data = await response.json();
    if (data.access_token) {
        accessToken = data.access_token;
        localStorage.setItem("lineAccessToken", accessToken); // 儲存 Token
        fetchUserProfile(accessToken);
    } else {
        document.getElementById("status").innerText = "登入失敗，請重試";
    }
}

async function fetchUserProfile(token) {
    const response = await fetch("https://api.line.me/v2/profile", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
    });

    const user = await response.json();
    document.getElementById("profile").style.display = "block";
    document.getElementById("name").innerText = user.displayName;
    document.getElementById("userId").innerText = "User ID: " + user.userId;
    document.getElementById("profilePic").src = user.pictureUrl;
    document.getElementById("status").innerText = "登入成功！";
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("logoutBtn").style.display = "inline-block";
}

function logout() {
    const token = localStorage.getItem("lineAccessToken");
    if (token) {
        fetch("https://api.line.me/oauth2/v2.1/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                access_token: token,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            })
        }).then(() => {
            localStorage.removeItem("lineAccessToken");
            window.location.href = REDIRECT_URI; // 重新導向到首頁
        });
    }
}
