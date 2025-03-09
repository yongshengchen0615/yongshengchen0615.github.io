// 定義獎項及其出現機率（總和需為 100）
const prizePool = [
    { prize: "🔸 甜湯 🍵", probability: 2 }, 
    { prize: "🔸 足湯包 🍵", probability: 23 }, 
    { prize: "🔸 🎟 集點刮點數1點", probability: 65 },

];

let canvas, ctx, isScratching = false;

document.addEventListener("DOMContentLoaded", function() {
    displayPrizes(); // 顯示所有獎項
    setupScratchCard();
});

// 顯示所有獎項及其機率
function displayPrizes() {
    let prizeList = document.getElementById("prizes");
    prizeList.innerHTML = ""; // 清空原來的列表
    prizePool.forEach(prizeData => {
        let li = document.createElement("li");
        //li.innerText = `${prizeData.prize} (${prizeData.probability}%)`;
        li.innerText = `${prizeData.prize} `;
        prizeList.appendChild(li);
    });
}

// 抽獎函數 (依機率選擇獎品)
function getRandomPrize() {
    let randomNum = Math.random() * 100; // 產生 0-100 之間的隨機數
    let cumulativeProbability = 0;

    for (let i = 0; i < prizePool.length; i++) {
        cumulativeProbability += prizePool[i].probability;
        if (randomNum < cumulativeProbability) {
            return prizePool[i].prize; // 返回對應的獎品
        }
    }
    return prizePool[prizePool.length - 1].prize; // 預防錯誤
}

function setupScratchCard() {
    let selectedPrize = getRandomPrize(); // 根據機率選擇獎品
    document.getElementById("prize").innerText = selectedPrize;

    canvas = document.getElementById("scratchCanvas");
    ctx = canvas.getContext("2d");

    canvas.removeEventListener("mousedown", startScratch);
    canvas.removeEventListener("mousemove", scratch);
    canvas.removeEventListener("mouseup", stopScratch);
    canvas.removeEventListener("mouseleave", stopScratch);
    canvas.removeEventListener("touchstart", startScratch);
    canvas.removeEventListener("touchmove", scratch);
    canvas.removeEventListener("touchend", stopScratch);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#999";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-out";
    canvas.style.display = "block";

    canvas.addEventListener("mousedown", startScratch);
    canvas.addEventListener("mousemove", scratch);
    canvas.addEventListener("mouseup", stopScratch);
    canvas.addEventListener("mouseleave", stopScratch);

    canvas.addEventListener("touchstart", startScratch, { passive: true });
    canvas.addEventListener("touchmove", scratch, { passive: true });
    canvas.addEventListener("touchend", stopScratch);
}

function startScratch(event) {
    isScratching = true;
}

function stopScratch() {
    isScratching = false;
}

function scratch(event) {
    if (!isScratching) return;
    let rect = canvas.getBoundingClientRect();
    let x = (event.clientX || event.touches[0].clientX) - rect.left;
    let y = (event.clientY || event.touches[0].clientY) - rect.top;

    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();

    checkScratchPercentage();
}

function checkScratchPercentage() {
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let pixels = imageData.data;
    let clearedPixels = 0;

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) clearedPixels++;
    }

    let percentage = (clearedPixels / (canvas.width * canvas.height)) * 100;
    if (percentage > 70) {
        canvas.style.display = "none"; // 刮到50%就顯示結果
    }
}

function resetScratchCard() {
    setupScratchCard();
}
