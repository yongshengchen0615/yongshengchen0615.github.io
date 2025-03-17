const BookingInfo = (() => {
    function init() {
        $("#name").on("input", validateName);
        $("#phone").on("input", validatePhone);
    }

    function validateName() {
        const namePattern = /^[\u4e00-\u9fa5]{1,5}(先生|小姐)$/;
        let name = $("#name").val().trim();
        if (!namePattern.test(name)) {
            $("#name-error").text("請輸入正確格式，如：王先生 / 李小姐");
            return false;
        } else {
            $("#name-error").text("");
            return true;
        }
    }

    function validatePhone() {
        const phonePattern = /^09\d{8}$/;
        let phone = $("#phone").val().trim();
        if (!phonePattern.test(phone)) {
            $("#phone-error").text("請輸入正確手機號碼，如：0912345678");
            return false;
        } else {
            $("#phone-error").text("");
            return true;
        }
    }

    function getBookingInfo() {
        return {
            name: $("#name").val(),
            phone: $("#phone").val(),
            bookingType: $("#booking-type").val(),
            numPeople: $("#num-people").val()
        };
    }

    return {
        init,
        validateName,
        validatePhone,
        getBookingInfo
    };
})();
