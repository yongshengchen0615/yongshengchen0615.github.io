import { validateName, validatePhone } from "./validation.js";
import { BookingTimeModule } from "./bookingTimeModule.js";
import { BookingModule } from "./bookingModule.js";

// ✅ 等待 .person-card 載入完成後再執行 callback
function waitForPersonCards(count, callback) {
  const checkExist = setInterval(() => {
    if ($(".person-card").length === count) {
      clearInterval(checkExist);
      callback();
    }
  }, 50);
}

$(document).ready(async function () {
  await initLIFF();

  BookingTimeModule.init("9:00", "21:00");

  // ✅ 改為帶入 callback → 當 BookingModule 完成初始化後載入資料
  BookingModule.init("#num-people", "#people-container", 5, () => {
    const saved = JSON.parse(localStorage.getItem("lastBookingData"));
    if (saved) {
      $("#name").val(saved.name);
      $("#phone").val(saved.phone);
      $("#booking-date").val(saved.date);
      $("#booking-time").val(saved.time);
      $("#booking-type").val(saved.bookingTypeText === "代訂他人" ? "other" : "self");
      $("#num-people").val(saved.numPeople).trigger("change");

      waitForPersonCards(saved.numPeople, () => {
        $(".person-card").each(function (i) {
          const p = saved.people[i];
          if (!p) return;
          const card = $(this);

          p.main.forEach(serviceName => {
            BookingModule.addServiceByName(card, serviceName, "main");
          });

          p.addon.forEach(serviceName => {
            BookingModule.addServiceByName(card, serviceName, "addon");
          });
        });
        updateTotal();
      });
    }
  });

  $("#booking-form").submit(handleSubmit);

  $("#clear-history").click(function () {
    if (confirm("確定要清除上次預約資料嗎？")) {
      localStorage.removeItem("lastBookingData");
      location.reload();
    }
  });

  const history = JSON.parse(localStorage.getItem("bookingHistory")) || [];
  const recentList = $("#recent-bookings");
  history.forEach((item, i) => {
    recentList.append(`
      <li class="list-group-item bg-dark text-light mb-3 rounded-3 p-3">
        <div class="recent-booking-item">
          <div class="booking-info">
            <strong>第 ${i + 1} 筆</strong><br>
            👤 ${item.name}<br>
            📅 ${item.date} ⏰ ${item.time}<br>
            👥 ${item.numPeople}人 ｜ 💰 $${item.total} 元
            <button class="btn btn-info w-100 mt-2" type="button" data-bs-toggle="collapse" data-bs-target="#detail-${i}">
              查看詳細服務
            </button>
          </div>

          <div class="collapse mt-2" id="detail-${i}">
            ${item.services.map(serviceBlock => {
              const lines = serviceBlock.split("\n");
              const title = lines[0];
              const serviceLine = lines[1];
              const timeLine = lines[2];
              const priceLine = lines[3];
              const serviceList = serviceLine.replace("- 服務內容：", "").split("、").map(s => `
                <li class="service-card-item">• ${s}</li>`).join("");

              return `
                <div class="recent-person-block">
                  <strong>${title}</strong>
                  <ul class="ps-3 mt-2">${serviceList}</ul>
                  <div class="mt-2">${timeLine}</div>
                  <div>${priceLine}</div>
                </div>`;
            }).join("")}
          </div>
        </div>
      </li>
    `);
  });
});

async function initLIFF() {
  try {
    await liff.init({ liffId: "2005939681-WrwevLMV" });

    if (!liff.isInClient()) {
      alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
    }

    const profile = await liff.getProfile();
    // alert("user ID:" + profile.userId);

  } catch (err) {
    console.error("❌ LIFF 初始化失敗", err);
    alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
  }
}

function updateTotal() {
  let totalTimeAll = 0, totalPriceAll = 0;
  $(".person-card").each(function () {
    totalTimeAll += parseInt($(this).find(".total-time").text());
    totalPriceAll += parseInt($(this).find(".total-price").text());
  });
  $("#total-time-all").text(totalTimeAll);
  $("#total-price-all").text(totalPriceAll);
}

function handleSubmit(event) {
  event.preventDefault();

  if (!validateName() || !validatePhone()) {
    alert("請確保姓名與手機格式正確！");
    return;
  }

  if (!BookingModule.checkAtLeastOneServiceSelected()) return;

  const date = $("#booking-date").val();
  const time = $("#booking-time").val();

  if (!BookingTimeModule.isValidBookingTime(date, time)) {
    alert("⚠️ 當日預約已超過可預約時間，請選擇其他時段！");
    return;
  }

  const name = $("#name").val();
  const phone = $("#phone").val();
  const bookingTypeText = $("#booking-type option:selected").text();
  const numPeople = $("#num-people").val();
  const dateWithDay = BookingTimeModule.formatDateWithDay(date);

  let totalPriceAll = 0;
  let totalTimeAll = 0;
  const bookingDetails = [];

  $(".person-card").each(function (index) {
    const personIndex = index + 1;
    let personTime = 0, personPrice = 0;
    const personServices = [];

    $(this).find(".main-service-list li, .addon-service-list li").each(function () {
      const text = $(this).clone().children("button").remove().end().text().trim();
      const time = parseInt($(this).attr("data-time"));
      const price = parseInt($(this).attr("data-price"));
      personServices.push(text);
      personTime += time;
      personPrice += price;
    });

    totalTimeAll += personTime;
    totalPriceAll += personPrice;

    bookingDetails.push(`👤 預約人 ${personIndex}：
- 服務內容：${personServices.join("、")}
- 服務總時間：${personTime} 分鐘
- 服務總金額：$${personPrice} 元`);
  });

  const summary = `等待預約回覆
- 預約類型：${bookingTypeText}
📅 日期：${dateWithDay}
⏰ 時間：${time}
👤 姓名：${name}
📞 電話：${phone}
👥 人數：${numPeople} 人

${bookingDetails.join("\n\n")}

⏳ 總時間：${totalTimeAll} 分鐘
💰 總金額：$${totalPriceAll} 元`;

  liff.sendMessages([{ type: "text", text: summary }])
    .then(() => {
      localStorage.setItem("lastBookingData", JSON.stringify({
        name, phone, date, time, bookingTypeText, numPeople,
        people: $(".person-card").map(function () {
          return {
            main: $(this).find(".main-service-list li").map(function () {
              return $(this).text().replace("刪除服務", "").trim();
            }).get(),
            addon: $(this).find(".addon-service-list li").map(function () {
              return $(this).text().replace("刪除服務", "").trim();
            }).get()
          };
        }).get()
      }));

      let history = JSON.parse(localStorage.getItem("bookingHistory")) || [];
      history.unshift({
        timestamp: new Date().toLocaleString(),
        name,
        date: dateWithDay,
        time,
        numPeople,
        total: totalPriceAll,
        services: bookingDetails
      });
      history = history.slice(0, 3);
      localStorage.setItem("bookingHistory", JSON.stringify(history));

      alert("✅ 預約確認訊息已成功傳送！");
      liff.closeWindow();
    })
    .catch(err => {
      alert("⚠️ 發送訊息失敗：" + err);
      console.error(err);
    });
}
