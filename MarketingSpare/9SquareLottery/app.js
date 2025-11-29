// ============ 設定區 ============
// 修改這裡的參數來調整遊戲設定

// 主題設定（可選：'dark', 'light', 'neon', 'sunset', 'nature'）
const CURRENT_THEME = 'neon';

// 中獎權重設定
const prizes = [
  { label: '50元折價券', weight: 1 },
  { label: '30元折價券', weight: 0 },
  { label: '再抽一次', weight: 0 },
  { label: '10% 折扣', weight: 0 },
  { label: '大獎：特別獎', weight: 0 }, // 中間格，預設未納入走訪序列
  { label: '免費運送券', weight: 0 },
  { label: '會員點數+100', weight: 0 },
  { label: '小禮物', weight: 1 },
  { label: '感謝參加', weight: 1 }
];

// ============ 程式碼開始 ============

// 9宮格抽獎邏輯
// 權重設定：調整每個獎項的 weight (數字)。weight 越大，被抽中的機率越高。
// 若想禁用某格可把 weight 設為 0（或移除項目，但請保留 index 對應）。
// 注意：中間格 (index 4) 預設不在旋轉序列中，若你想讓中間格也能被抽中，請同時更新 `order` 陣列。

const order = [0,1,2,5,8,7,6,3];
const cells = Array.from(document.querySelectorAll('.cell'));
const spinBtn = document.getElementById('spinBtn');
const modal = document.getElementById('winModal');
const modalPrizeEl = document.getElementById('modalPrize');
const modalConfirm = document.getElementById('modalConfirm');

// 初始化格子文字（中間格留給按鈕，不覆蓋）
cells.forEach((c, i) => {
  if (i === 4) return; // 中間格保持按鈕
  const label = c.querySelector('.label');
  const text = (prizes[i] && prizes[i].label) ? prizes[i].label : String(prizes[i] || '');
  if(label) label.textContent = text;
  else c.textContent = text;
});

let running = false;
// 記錄上一個停留在 order 陣列中的位置（index in order），下次從此位置開始
let lastOrderPos = 0;

function playConfetti(){
  const wrapper = document.createElement('div');
  wrapper.className = 'confetti';
  for(let i=0;i<30;i++){
    const chip = document.createElement('i');
    chip.className = 'chip';
    chip.style.background = ['#ffb86b','#ff6b6b','#6be0ff','#a78bfa','#9be89a'][Math.floor(Math.random()*5)];
    chip.style.animationDelay = (Math.random()*300)+'ms';
    chip.style.marginLeft = (Math.random()*120-60)+'px';
    wrapper.appendChild(chip);
  }
  document.body.appendChild(wrapper);
  setTimeout(()=> wrapper.remove(),1200);
}

function spin(){
  if(running) return;
  running = true;
  spinBtn.disabled = true;

    // 隨機決定中獎 index，但排除中間格 (index 4)
    const allowedRaw = prizes.map((_,i) => i).filter(i => i !== 4 && (prizes[i].weight || 0) > 0);
    // 只取在走訪序列中的格子（保險），若 none 則回退使用 allowedRaw
    const allowed = allowedRaw.filter(i => order.indexOf(i) !== -1);
    if(allowed.length === 0) allowed.push(...allowedRaw);

    // 加權隨機選取：根據 prizes[i].weight 決定機率
    function pickWeightedIndex(allowedIndices){
      if(!allowedIndices || allowedIndices.length === 0) return null;
      // 建立權重陣列並計算總和
      const weights = allowedIndices.map(idx => Math.max(0, Number(prizes[idx].weight) || 0));
      const total = weights.reduce((s, w) => s + w, 0);
      if(total <= 0){
        // fallback: 均等隨機
        return allowedIndices[Math.floor(Math.random()*allowedIndices.length)];
      }
      // 隨機落在 [0, total)
      let r = Math.random() * total;
      for(let i=0;i<allowedIndices.length;i++){
        const idx = allowedIndices[i];
        const w = weights[i];
        if(r < w) return idx;
        r -= w;
      }
      // fallback
      return allowedIndices[allowedIndices.length - 1];
    }

    let winnerIndex = pickWeightedIndex(allowed);
    if(winnerIndex === null){
      // 在極端情況下回退為均等隨機（應很少發生）
      const fallback = prizes.map((_,i) => i).filter(i => i !== 4);
      winnerIndex = fallback[Math.floor(Math.random()*fallback.length)];
    }

  // 總步數：先快速轉幾圈再慢下來
  const rounds = 3; // 整圈數
  // 從上次停留位置開始，計算到目標需多少步（模數運算）
  const startPos = lastOrderPos % order.length;
  const winnerPosInOrder = order.indexOf(winnerIndex);
  // 若 winnerIndex 不在 order 中（理論上不該發生），回退為選第一個 order 項
  const safeWinnerPos = winnerPosInOrder === -1 ? 0 : winnerPosInOrder;
  const stepsToWinner = (safeWinnerPos - startPos + order.length) % order.length;
  // 為了確保最後停在目標格，totalSteps 應滿足： startPos + totalSteps - 1 ≡ safeWinnerPos (mod L)
  // 因此使用 +1 補正，並將隨機性放在額外的完整圈數上
  const extraRounds = Math.floor(Math.random()*2); // 0 或 1 額外圈數，可調
  const totalSteps = (rounds + extraRounds) * order.length + stepsToWinner + 1;

  let step = 0;
  let currentPos = startPos;
  let speed = 80; // 初始間隔 ms

  const tick = () => {
    // 清除前一個 active
    cells.forEach(c => c.classList.remove('active'));
    const idx = order[currentPos % order.length];
    cells[idx].classList.add('active');

    step++;
    currentPos++;

    // 漸進減速：在最後 20% 步驟加速減慢
    const remain = totalSteps - step;
    if(remain < Math.max(8, Math.floor(totalSteps*0.15))){
      speed += 40; // 慢下來
    } else if(step %  (order.length) === 0) {
      speed = Math.max(60, speed-6); // 先微微加速
    }

    if(step >= totalSteps){
      // 停止在 winnerIndex
      const finalOrderPos = ((currentPos-1) % order.length + order.length) % order.length;
      const finalIdx = order[finalOrderPos];
      const prizeObj = prizes[finalIdx];
      const prizeLabel = (prizeObj && prizeObj.label) ? prizeObj.label : String(prizeObj || '');
      setTimeout(()=>{
        running = false;
        // 記錄最後停的位置，下一次從這裡開始
        lastOrderPos = finalOrderPos;
        // 顯示全螢幕中獎提示，等使用者按確認後再啟用按鈕
        if(modal && modalPrizeEl && modalConfirm){
          modalPrizeEl.textContent = prizeLabel;
          modal.classList.remove('hidden');
          // 若是大獎，先播放 confetti
          if(prizeLabel.includes('大獎') || prizeLabel.includes('特別')) playConfetti();
          // focus 確認按鈕便於鍵盤/無障礙操作
          modalConfirm.focus();
        } else {
          // fallback 行為
          spinBtn.disabled = false;
          if(prizeLabel.includes('大獎') || prizeLabel.includes('特別')) playConfetti();
        }
      }, 300);
      return;
    }

    setTimeout(tick, speed);
  };

  tick();
}

spinBtn.addEventListener('click', spin);

// Modal 確認後讓使用者可以再次抽獎
if(modalConfirm){
  modalConfirm.addEventListener('click', ()=>{
    if(modal) modal.classList.add('hidden');
    // 允許再次抽獎
    spinBtn.disabled = false;
    // 將焦點回到抽獎按鈕
    spinBtn.focus();
  });
}

// 模擬函式：在 console 中執行 simulateWeights(N) 來模擬 N 次抽獎並輸出統計
function simulateWeights(trials = 10000){
  // 以走訪序列中的格子作為模擬候選（排除中間格）
  const allowedIndices = order.filter(i => (prizes[i] && (prizes[i].weight || 0) > 0));
  if(allowedIndices.length === 0){
    console.warn('沒有可用的候選格子 (weight 皆為 0)');
    return;
  }

  // pickWeightedIndex 與 spin 裡相同的邏輯
  function pickWeightedIndexLocal(allowed){
    const weights = allowed.map(idx => Math.max(0, Number(prizes[idx].weight) || 0));
    const total = weights.reduce((s,w) => s + w, 0);
    if(total <= 0) return allowed[Math.floor(Math.random()*allowed.length)];
    let r = Math.random() * total;
    for(let i=0;i<allowed.length;i++){
      const w = weights[i];
      if(r < w) return allowed[i];
      r -= w;
    }
    return allowed[allowed.length-1];
  }

  const counts = Object.create(null);
  for(const idx of allowedIndices) counts[idx] = 0;

  for(let t=0;t<trials;t++){
    const pick = pickWeightedIndexLocal(allowedIndices);
    counts[pick] = (counts[pick] || 0) + 1;
  }

  // 計算預期比例
  const weightSum = allowedIndices.reduce((s, idx) => s + (prizes[idx].weight || 0), 0);
  const results = allowedIndices.map(idx => ({
    index: idx,
    label: prizes[idx].label,
    weight: prizes[idx].weight || 0,
    expected: weightSum > 0 ? ((prizes[idx].weight || 0)/weightSum*100) : (100/allowedIndices.length),
    actual: (counts[idx] / trials * 100)
  }));

  console.table(results.map(r => ({Index: r.index, Label: r.label, Weight: r.weight, 'Expected %': r.expected.toFixed(2), 'Actual %': r.actual.toFixed(2)})));
  return results;
}

// 暴露給全域，以便在瀏覽器 console 直接呼叫
window.simulateWeights = simulateWeights;

// 主題設定：頁面載入時應用設定的主題
function applyTheme(){
  const THEMES = ['dark', 'light', 'neon', 'sunset', 'nature'];
  const theme = THEMES.includes(CURRENT_THEME) ? CURRENT_THEME : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
}

// 頁面載入時套用主題
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', applyTheme);
} else {
  applyTheme();
}
