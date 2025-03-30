// validation.js

export function validateField({ selector, pattern, errorMsg }) {
    const input = document.querySelector(selector);
    const errorEl = document.querySelector(`${selector}-error`);
    const value = input.value.trim();

    const valid = pattern.test(value);

    if (!valid) {
        errorEl.textContent = errorMsg;
        input.classList.add("is-invalid");
    } else {
        errorEl.textContent = "";
        input.classList.remove("is-invalid");
    }

    return valid;
}

// 預設使用者姓名驗證
export function validateName() {
    const namePattern = /^[\u4e00-\u9fa5]{1,5}(先生|小姐)$/;
    return validateField({
        selector: "#name",
        pattern: namePattern,
        errorMsg: "請輸入正確格式，如：王先生 / 李小姐"
    });
}

// 預設台灣手機號驗證
export function validatePhone() {
    const phonePattern = /^09\d{8}$/;
    return validateField({
        selector: "#phone",
        pattern: phonePattern,
        errorMsg: "請輸入正確手機號碼，如：0912345678"
    });
}

// 綁定即時驗證
document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("#name").addEventListener("input", validateName);
    document.querySelector("#phone").addEventListener("input", validatePhone);
});
