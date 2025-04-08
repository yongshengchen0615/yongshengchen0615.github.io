// ✅ 轉動速度參數（可依需求調整）
const SPIN_CONFIG = {
  initialDelay: 40,      // 初始延遲（ms）
  delayIncrement: 20,    // 每轉一步增加多少延遲
  maxDelay: 300          // 最大延遲（防止無限慢）
};

const prizeElements = document.querySelectorAll('.prize-grid .prize');
const startBtn = document.getElementById('startBtn');

let isSpinning = false;
let currentIndex = 0;

// ✅ 各獎項資料與權重（index 對應九宮格位置）
const prizeData = [
  { index: 0, emoji: "🍎", weight: 100 },
  { index: 1, emoji: "🍌", weight: 0 },
  { index: 2, emoji: "🍇", weight: 0 },
  { index: 3, emoji: "🍓", weight: 0 },
  { index: 5, emoji: "🍍", weight: 0 },
  { index: 6, emoji: "🥝", weight: 0 },
  { index: 7, emoji: "🍉", weight: 0 },
  { index: 8, emoji: "🍊", weight: 0 }
];

// ✅ 控制轉動順序（排除 index 4）
const prizeIndexes = [0, 1, 2, 5, 8, 7, 6, 3];

// ✅ 初始高亮一個獎項
function initializePrizeHighlight() {
  const initialPrize = prizeIndexes[currentIndex % prizeIndexes.length];
  prizeElements[initialPrize].classList.add('active');
}

// ✅ 抽獎：加權隨機抽出一個獎項
function weightedRandom(prizes) {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0);
  let r = Math.random() * total;

  for (const prize of prizes) {
    r -= prize.weight;
    if (r < 0) return prize;
  }
  return prizes[prizes.length - 1]; // fallback
}

// ✅ 執行抽獎並動畫轉動
startBtn.addEventListener('click', () => {
  if (isSpinning) return;

  prizeElements.forEach(el => el.classList.remove('active'));
  isSpinning = true;

  const selectedPrize = weightedRandom(prizeData);
  const fixedPrizeIndex = selectedPrize.index;

  const cycles = 2;
  const currentPos = currentIndex % prizeIndexes.length;
  const targetPos = prizeIndexes.indexOf(fixedPrizeIndex);
  const stepsToTarget = (targetPos - currentPos + prizeIndexes.length) % prizeIndexes.length;
  const totalSteps = cycles * prizeIndexes.length + stepsToTarget;

  // ✅ 啟動轉動動畫
  spin(0, SPIN_CONFIG.initialDelay, totalSteps, selectedPrize);
});

// ✅ 動畫邏輯：逐格高亮，並逐步減速
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

// ✅ 首次載入初始化高亮
initializePrizeHighlight();
