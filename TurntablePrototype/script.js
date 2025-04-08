const prizeElements = document.querySelectorAll('.prize-grid .prize');
const startBtn = document.getElementById('startBtn');

let isSpinning = false;
let currentIndex = 0;

// ✅ 各獎項資料與權重設定（index 對應九宮格位置）
const prizeData = [
  { index: 0, emoji: "🍎", weight: 0 },
  { index: 1, emoji: "🍌", weight: 0 },
  { index: 2, emoji: "🍇", weight: 0 }, // 高機率中獎
  { index: 3, emoji: "🍓", weight: 50 },
  { index: 5, emoji: "🍍", weight: 0 },
  { index: 6, emoji: "🥝", weight: 0 },
  { index: 7, emoji: "🍉", weight: 0 },
  { index: 8, emoji: "🍊", weight: 50 }
];

// ✅ 控制轉動順序（排除 index 4）
const prizeIndexes = [0, 1, 2, 5, 8, 7, 6, 3];

// ✅ 權重抽獎函式
function weightedRandom(prizes) {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0);
  let r = Math.random() * total;

  for (const prize of prizes) {
    r -= prize.weight;
    if (r < 0) return prize;
  }

  return prizes[prizes.length - 1];
}

startBtn.addEventListener('click', () => {
  if (isSpinning) return;

  prizeElements.forEach(el => el.classList.remove('active'));

  isSpinning = true;

  // ✅ 執行加權隨機抽獎
  const selectedPrize = weightedRandom(prizeData);
  const fixedPrizeIndex = selectedPrize.index;

  const cycles = 2;
  const currentPos = currentIndex % prizeIndexes.length;
  const targetPos = prizeIndexes.indexOf(fixedPrizeIndex);
  const stepsToTarget = (targetPos - currentPos + prizeIndexes.length) % prizeIndexes.length;
  const totalSteps = cycles * prizeIndexes.length + stepsToTarget;

  let delay = 50;

  function spin(step = 0) {
    if (step > 0) {
      const prevIndex = prizeIndexes[(currentIndex - 1 + prizeIndexes.length) % prizeIndexes.length];
      prizeElements[prevIndex].classList.remove('active');
    }

    const current = prizeIndexes[currentIndex % prizeIndexes.length];
    prizeElements[current].classList.add('active');
    currentIndex++;

    if (step < totalSteps) {
      delay += 15;
      setTimeout(() => spin(step + 1), delay);
    } else {
      isSpinning = false;

      setTimeout(() => {
        alert(`🎉 恭喜中獎：${selectedPrize.emoji}`);
      }, 300);
    }
  }

  spin();
});
