// ✅ 抽獎格子資料（含獎項與起始按鈕）
const prizes = [
  { index: 0, emoji: "甜湯", weight: 50 },
  { index: 1, emoji: "腳底卷", weight: 0 },
  { index: 2, emoji: "甜湯", weight: 0 },
  { index: 3, emoji: "腳底卷", weight: 0 },
  { index: 4, emoji: "center" }, // 中心按鈕
  { index: 5, emoji: "腳底卷", weight: 50 },
  { index: 6, emoji: "全身卷", weight: 0 },
  { index: 7, emoji: "全身卷", weight: 0 },
  { index: 8, emoji: "雞湯", weight: 0 }
];

// ✅ 動畫設定
const SPIN_CONFIG = {
  initialDelay: 40,
  delayIncrement: 20,
  maxDelay: 300
};

// ✅ 控制轉動順序（排除中心）
const prizeIndexes = [0, 1, 2, 5, 8, 7, 6, 3];

let currentIndex = 0;
let isSpinning = false;
let prizeElements = []; // 動態產生後賦值
let startBtn = null;

// ✅ 產生格子 HTML
function generatePrizeGrid() {
  const grid = document.getElementById("prizeGrid");
  grid.innerHTML = "";

  prizes.forEach((item) => {
    const div = document.createElement("div");

    if (item.emoji === "center") {
      div.className = "prize center";
      div.id = "startBtn";
      div.textContent = "開始";
      startBtn = div; // 保存引用
    } else {
      div.className = "prize";
      div.textContent = item.emoji;
    }

    grid.appendChild(div);
  });

  // 更新元素陣列
  prizeElements = document.querySelectorAll(".prize-grid .prize");
}

// ✅ 加權隨機中獎
function weightedRandom(prizes) {
  const validPrizes = prizes.filter(p => typeof p.weight === 'number');
  const total = validPrizes.reduce((sum, p) => sum + p.weight, 0);
  let r = Math.random() * total;

  for (const prize of validPrizes) {
    r -= prize.weight;
    if (r < 0) return prize;
  }
  return validPrizes[validPrizes.length - 1];
}

// ✅ 初始高亮
function initializePrizeHighlight() {
  const initialPrize = prizeIndexes[currentIndex % prizeIndexes.length];
  prizeElements[initialPrize].classList.add('active');
}

// ✅ 啟動抽獎邏輯
function handleStartSpin() {
  if (isSpinning) return;

  prizeElements.forEach(el => el.classList.remove('active'));
  isSpinning = true;

  const selectedPrize = weightedRandom(prizes);
  const fixedPrizeIndex = selectedPrize.index;

  const cycles = 2;
  const currentPos = currentIndex % prizeIndexes.length;
  const targetPos = prizeIndexes.indexOf(fixedPrizeIndex);
  const stepsToTarget = (targetPos - currentPos + prizeIndexes.length) % prizeIndexes.length;
  const totalSteps = cycles * prizeIndexes.length + stepsToTarget;

  spin(0, SPIN_CONFIG.initialDelay, totalSteps, selectedPrize);
}

// ✅ 動畫轉動邏輯
function spin(step = 0, delay = SPIN_CONFIG.initialDelay, totalSteps, selectedPrize) {
  if (step > 0) {
    const prevIndex = prizeIndexes[(currentIndex - 1 + prizeIndexes.length) % prizeIndexes.length];
    prizeElements[prevIndex].classList.remove('active');
  }

  const current = prizeIndexes[currentIndex % prizeIndexes.length];
  prizeElements[current].classList.add('active');
  currentIndex++;

  if (step < totalSteps) {
    const nextDelay = Math.min(delay + SPIN_CONFIG.delayIncrement, SPIN_CONFIG.maxDelay);
    setTimeout(() => spin(step + 1, nextDelay, totalSteps, selectedPrize), delay);
  } else {
    isSpinning = false;
    setTimeout(() => {
      alert(`🎉 恭喜中獎：${selectedPrize.emoji}`);
    }, 300);
  }
}

// ✅ 啟動初始化
window.addEventListener("DOMContentLoaded", () => {
  generatePrizeGrid();
  initializePrizeHighlight();

  // 綁定開始按鈕點擊
  document.addEventListener("click", (e) => {
    if (e.target.id === "startBtn") {
      handleStartSpin();
    }
  });
});
