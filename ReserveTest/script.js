const LINE_LIFF_ID = "2005939681-ayjyxlz3"; // 替換成你的 LINE LIFF ID

async function initLiff() {
    try {
        await liff.init({ liffId: LINE_LIFF_ID });
        if (liff.isLoggedIn()) {
            getUserProfile();
        }
    } catch (error) {
        console.error("LIFF 初始化失敗", error);
    }
}

async function getUserProfile() {
    if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        document.getElementById("userImage").src = profile.pictureUrl;
        document.getElementById("userName").textContent = `你好, ${profile.displayName}`;
        document.getElementById("profile").style.display = "block";
        document.getElementById("loginBtn").style.display = "none";
        document.getElementById("logoutBtn").style.display = "inline-block";
    }
}

document.getElementById("loginBtn").addEventListener("click", () => {
    liff.login();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
    liff.logout();
    location.reload();
});

window.onload = initLiff;
