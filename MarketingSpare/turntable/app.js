// 轉盤抽獎主要邏輯
const canvas = document.getElementById('wheel');
const ctx = canvas.getContext('2d');
const spinBtn = document.getElementById('spinBtn');
// modal 元素（全畫面顯示中獎結果）
const modal = document.getElementById('resultModal');
const modalPrize = document.getElementById('modalPrize');
const confirmBtn = document.getElementById('confirmBtn');

// 可編輯的獎項與權重（會儲存到 localStorage）
const defaultPrizes = [
  {label: '頭獎：iPad', weight: 0},
  {label: '二獎：AirPods', weight: 0},
  {label: '三獎：禮券 $500', weight: 0},
  {label: '安慰獎：貼紙', weight: 0},
  {label: '驚喜獎：咖啡券', weight: 10},
  {label: '再接再厲', weight: 30},
  {label: '再接再厲1', weight: 30},
  {label: '再接再厲2', weight: 30},
  {label: '再接再厲3', weight: 30},
  {label: '再接再厲4', weight: 30},
];


let prizes = JSON.parse(JSON.stringify(defaultPrizes));

let size = 0;
let cx = 0;
let cy = 0;
let radius = 0;

function resizeCanvas(){
  // 以 .wheel-area 的實際寬度為基準，保持正方形
  const rect = canvas.getBoundingClientRect();
  const cssSize = rect.width; // CSS pixels
  const dpr = window.devicePixelRatio || 1;
  // 設定畫布的實際像素大小
  canvas.width = Math.max(1, Math.floor(cssSize * dpr));
  canvas.height = Math.max(1, Math.floor(cssSize * dpr));
  // 顯示尺寸（CSS）
  canvas.style.width = cssSize + 'px';
  canvas.style.height = cssSize + 'px';
  // 使用高解析度繪製
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 更新繪圖參數（以 CSS pixels 為單位）
  size = cssSize;
  cx = size / 2;
  cy = size / 2;
  radius = size / 2 - Math.max(12, size * 0.03);
}

// 在載入和視窗尺寸變化時重設畫布
window.addEventListener('resize', ()=>{ resizeCanvas(); drawWheel(); });
// 立即執行一次
setTimeout(()=>{ resizeCanvas(); drawWheel(); }, 0);

function drawWheel() {
  // 清除以 CSS 像素為單位（canvas.width 為 device pixels，因此除以 dpr）
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  const count = prizes.length;
  const arc = 2 * Math.PI / count;
  for (let i=0;i<count;i++){
    const start = i * arc;
    const end = start + arc;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,radius,start,end,false);
    ctx.closePath();
    ctx.fillStyle = i%2===0 ? '#ffb703' : '#fb8500';
    ctx.fill();
    ctx.save();
    // 繪文字
    ctx.translate(cx,cy);
    ctx.rotate(start + arc/2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#08111b';
    // 字型大小隨畫布大小調整
    const fontSize = Math.max(10, Math.round(size * 0.038));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText(prizes[i].label, radius - Math.max(12, size * 0.02), Math.round(fontSize/3));
    ctx.restore();
  }
}

// 權重抽樣，回傳索引
function weightedPickIndex(items){
  const total = items.reduce((s,i)=>s+i.weight,0);
  let r = Math.random()*total;
  for (let i=0;i<items.length;i++){
    r -= items[i].weight;
    if (r <= 0) return i;
  }
  return items.length-1;
}

// 動畫與轉盤控制
let spinning = false;
function spin() {
  if (spinning) return;
  spinning = true;
  spinBtn.disabled = true;
  // 不在頁面下方顯示狀態（改為以 modal 顯示結果）

  const pickIndex = weightedPickIndex(prizes);
  const segmentAngle = 360 / prizes.length;
  // 目標角度中心（度數），指針在頂端，canvas 0 度在正右，需轉換
  const targetSegStart = pickIndex * segmentAngle;
  const targetSegCenter = targetSegStart + segmentAngle/2;

  // 為了動畫順暢，設定多圈並加上目標角度（注意 0deg 在畫布右邊）
  const extraSpins = Math.floor(Math.random()*3) + 4; // 4~6圈

  const startRotation = currentRotation || 0;
  // 計算 offset，確保目標角度比 startRotation 大，這樣每次都會沿同一方向（順時針）轉
  const desiredPointerDeg = 270; // 指針在頂端
  const rawTargetDeg = (desiredPointerDeg - targetSegCenter + 360) % 360;
  const offset = (rawTargetDeg - (startRotation % 360) + 360) % 360;
  const targetRotationDeg = startRotation + extraSpins*360 + offset;
  const duration = 4200; // ms
  const startTime = performance.now();

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

  function frame(now){
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    const eased = easeOutCubic(t);
    currentRotation = startRotation + (targetRotationDeg - startRotation) * eased;
    canvas.style.transform = `rotate(${currentRotation}deg)`;
    if (t < 1){
      requestAnimationFrame(frame);
    } else {
      // 計算落在哪個獎項
      const finalRotation = ((currentRotation % 360) + 360) % 360; // 0~360
      // 轉換回 segment index
      const pointerDeg = 270; // pointer 指向 270deg
      const landedDeg = (pointerDeg - finalRotation + 360) % 360;
      const landedIndex = Math.floor(landedDeg / (360 / prizes.length)) % prizes.length;

      const prize = prizes[landedIndex];
      // 顯示 modal，鎖定 spin 按鈕直到使用者確認
      addHistory(prize.label);
      showModal(prize.label);
      // note: spinning 標示維持 true，會在使用者確認時釋放
    }
  }

  requestAnimationFrame(frame);
}

function showModal(text){
  if (modal){
    modalPrize.textContent = `中獎：${text}`;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function hideModal(){
  if (modal){
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  spinning = false;
  spinBtn.disabled = false;
}

function addHistory(text){
  // 只將紀錄存入 localStorage，但不在畫面上顯示
  const now = new Date().toLocaleString();
  const item = {text, time: now};
  try{
    const raw = localStorage.getItem('wheel_history');
    const all = raw ? JSON.parse(raw) : [];
    all.unshift(item);
    localStorage.setItem('wheel_history', JSON.stringify(all.slice(0,50)));
  } catch (e) {
    // ignore
  }
}

function loadHistory(){
  try{ return JSON.parse(localStorage.getItem('wheel_history')) || []; }
  catch(e){ return []; }
}

function clearHistory(){
  localStorage.removeItem('wheel_history');
  // 不在頁面顯示任何結果
}

let currentRotation = 0;

// 註冊事件
spinBtn.addEventListener('click', spin);
confirmBtn.addEventListener('click', ()=>{
  hideModal();
});

// 初始繪製
drawWheel();

// 注意：獎項請直接在程式碼的 `defaultPrizes` 中修改，UI 上不提供編輯功能
