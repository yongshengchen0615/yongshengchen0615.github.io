export function validateName() {
    const namePattern = /^[\u4e00-\u9fa5]{1,5}(先生|小姐)$/;
    let name = document.getElementById("name").value.trim();
    let errorElement = document.getElementById("name-error");

    if (!namePattern.test(name)) {
        errorElement.textContent = "請輸入正確格式，如：王先生 / 李小姐";
        return false;
    } else {
        errorElement.textContent = "";
        return true;
    }
}

export function validatePhone() {
    const phonePattern = /^09\d{8}$/;
    let phone = document.getElementById("phone").value.trim();
    let errorElement = document.getElementById("phone-error");

    if (!phonePattern.test(phone)) {
        errorElement.textContent = "請輸入正確手機號碼，如：0912345678";
        return false;
    } else {
        errorElement.textContent = "";
        return true;
    }
}

// 綁定事件監聽
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("name").addEventListener("input", validateName);
    document.getElementById("phone").addEventListener("input", validatePhone);
});
