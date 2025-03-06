const LINE_LIFF_ID = "2005939681-ayjyxlz3"; // 替換成你的 LINE LIFF ID

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
    document.getElementById("loginBtn").addEventListener("click", () => {
        liff.login();
    });

    document.getElementById("logoutBtn").addEventListener("click", () => {
        liff.logout();
        location.reload();
    });
}

async function displayUserProfile() {
    try {
        const profile = await liff.getProfile();
        document.getElementById("userImage").src = profile.pictureUrl;
        document.getElementById("userName").textContent = `你好, ${profile.displayName}`;
        toggleVisibility(true);
    } catch (error) {
        console.error("取得使用者資訊失敗:", error);
    }
}

function toggleVisibility(isLoggedIn) {
    document.getElementById("profile").style.display = isLoggedIn ? "block" : "none";
    document.getElementById("loginBtn").style.display = isLoggedIn ? "none" : "inline-block";
    document.getElementById("logoutBtn").style.display = isLoggedIn ? "inline-block" : "none";
}
