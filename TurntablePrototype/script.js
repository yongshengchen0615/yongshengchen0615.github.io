// ✅ 動態取得後端資料
let prizeData = []; // 儲存從後端取得的獎項資料
let currentIndex = 0;
let isSpinning = false;
let prizeElements = [];
let startBtn = null;

const SPIN_CONFIG = {
  initialDelay: 40,
  delayIncrement: 20,
  maxDelay: 300
};

const prizeIndexes = [0, 1, 2, 5, 8, 7, 6, 3]; // 固定順序，排除 index 4（中心）

// ✅ 從 API 取得獎品資料與標題
async function fetchPrizesFromAPI(id = "67dd4c419177db210a18ff5d") {
  try {
    const res = await fetch(`https://servertest-r18o.onrender.com/api/prizePool/${id}`);
    const json = await res.json();

    console.log("📥 後端回傳資料：", json);

    if (!json.prize || !Array.isArray(json.prize)) {
      throw new Error("後端未回傳正確的 prize 陣列");
    }

    // 解析 prize 陣列
    const parsed = json.prize.map((itemStr) => {
      const [, name, weightStr] = itemStr.split(';');
      return {
        emoji: name,
        weight: parseInt(weightStr, 10)
      };
    });

    console.log("🧾 解析後獎項：", parsed);

    // 先完整填入原始資料（最多8個）
    const filled = parsed.slice(0, 8);

    // 如果不足 8 個，再根據機率補滿
    if (filled.length < 8) {
      const needed = 8 - filled.length;
      console.log(`🔁 原始獎項 ${filled.length} 個，補入 ${needed} 個`);

      for (let i = 0; i < needed; i++) {
        const totalWeight = parsed.reduce((sum, p) => sum + p.weight, 0);
        let r = Math.random() * totalWeight;
        for (const p of parsed) {
          r -= p.weight;
          if (r < 0) {
            filled.push({ ...p });
            break;
          }
        }
      }
    }

    console.log("🎯 完整 8 格獎項：", filled);

    // 插入中心按鈕
    filled.splice(4, 0, { emoji: "center" });

    // 加入 index
    prizeData = filled.map((item, index) => ({ index, ...item }));

    console.log("🎲 最終 9 格資料（含 center）：", prizeData);

    // 設定標題
    document.querySelector(".lottery-title").textContent = json.titleText || "幸運抽獎";

    generatePrizeGrid();
    initializePrizeHighlight();

  } catch (err) {
    console.error("❌ 讀取獎品資料失敗", err);
  }
}

// ✅ 產生格子 HTML
function generatePrizeGrid() {
  const grid = document.getElementById("prizeGrid");
  grid.innerHTML = "";

  prizeData.forEach((item) => {
    const div = document.createElement("div");

    if (item.emoji === "center") {
      div.className = "prize center";
      div.id = "startBtn";
      div.textContent = "開始";
      startBtn = div;
    } else {
      div.className = "prize";
      div.textContent = item.emoji;
    }

    grid.appendChild(div);
  });

  prizeElements = document.querySelectorAll(".prize-grid .prize");
}

// ✅ 加權隨機選取中獎項
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

// ✅ 點擊開始抽獎
function handleStartSpin() {
  if (isSpinning) return;

  prizeElements.forEach(el => el.classList.remove('active'));
  isSpinning = true;

  const selectedPrize = weightedRandom(prizeData);

  console.log("🏆 中獎項目：", selectedPrize);

  const fixedPrizeIndex = selectedPrize.index;

  const cycles = 2;
  const currentPos = currentIndex % prizeIndexes.length;
  const targetPos = prizeIndexes.indexOf(fixedPrizeIndex);
  const stepsToTarget = (targetPos - currentPos + prizeIndexes.length) % prizeIndexes.length;
  const totalSteps = cycles * prizeIndexes.length + stepsToTarget;

  spin(0, SPIN_CONFIG.initialDelay, totalSteps, selectedPrize);
}

// ✅ 動畫主體
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
  fetchPrizesFromAPI(); // 開始讀取抽獎設定

  document.addEventListener("click", (e) => {
    if (e.target.id === "startBtn") {
      handleStartSpin();
    }
  });
});
