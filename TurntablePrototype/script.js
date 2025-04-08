const prizeElements = document.querySelectorAll('.prize-grid .prize');
const startBtn = document.getElementById('startBtn');

let currentIndex = 0;
let isSpinning = false;
const prizeIndexes = [0, 1, 2, 5, 8, 7, 6, 3];

startBtn.addEventListener('click', () => {
  if (isSpinning) return;

  // ✅【新增】清除所有 active 樣式
  prizeElements.forEach(el => el.classList.remove('active'));

  isSpinning = true;
  const totalSteps = 16 + Math.floor(Math.random() * 8);
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
    }
  }

  spin();
});
