const wordList = [
    { word: "apple", translation: "蘋果" },
    { word: "grape", translation: "葡萄" },
    { word: "bird", translation: "鳥" },
    { word: "fish", translation: "魚" },
    { word: "tree", translation: "樹" },
    { word: "moon", translation: "月亮" },
    { word: "star", translation: "星星" },
    { word: "rain", translation: "雨" },
    { word: "snow", translation: "雪" },
    { word: "wind", translation: "風" },
    { word: "rock", translation: "岩石" },
    { word: "fire", translation: "火" },
    { word: "lake", translation: "湖" },
    { word: "boat", translation: "船" },
    { word: "door", translation: "門" },
    { word: "book", translation: "書" },
    { word: "song", translation: "歌曲" },
    { word: "time", translation: "時間" },
    { word: "gold", translation: "黃金" },
    { word: "milk", translation: "牛奶" },
    { word: "cake", translation: "蛋糕" },
    { word: "love", translation: "愛" },
    { word: "baby", translation: "嬰兒" },
    { word: "king", translation: "國王" },
    { word: "hand", translation: "手" },
    { word: "foot", translation: "腳" },
    { word: "head", translation: "頭" },
    { word: "home", translation: "家" },
    { word: "desk", translation: "書桌" },
    { word: "ball", translation: "球" },
];

class WordGame {
    constructor(wordList) {
        this.wordList = wordList;
        this.currentWordIndex = -1;
        this.score = 0;
        this.isProcessing = false;
        this.hintTimeout = null;
        this.inactivityTimeout = null;
        this.revealedLetters = [];
        this.currentLetterIndex = 0;
        this.incorrectAttempts = 0;
        this.correctStreak = 0;
        this.difficultyLevel = 1;
        this.roundsCompleted = 0;
        this.completedRounds = 0; // 追蹤已完成的單字數量

        this.elements = {
            scoreDisplay: document.getElementById("scoreDisplay"),
            wordDisplay: document.getElementById("wordDisplay"),
            gridContainer: document.getElementById("gridContainer"),
        };

        this.nextWord();
        this.updateScore();
    }

    updateScore() {
        this.elements.scoreDisplay.innerText = `分數: ${this.score}`;
        this.elements.scoreDisplay.classList.add("score-animation");
        setTimeout(() => this.elements.scoreDisplay.classList.remove("score-animation"), 500);
    }

    showScoreChange(cell, value) {
        const scoreChange = document.createElement("div");
        scoreChange.className = value > 0 ? "reward-animation" : "penalty-animation";
        scoreChange.innerText = value > 0 ? `+${value}` : `${value}`;
        cell.appendChild(scoreChange);
        setTimeout(() => {
            scoreChange.style.opacity = "0";
            scoreChange.style.transform = "translateY(-10px)";
        }, 50);
        setTimeout(() => scoreChange.remove(), 500);
    }

    maskWord(word) {
        const wordLength = word.length;
        let hiddenCount = Math.floor((this.difficultyLevel / 5) * wordLength);
        hiddenCount = Math.min(hiddenCount, wordLength - 1);

        let hiddenIndexes = new Set();
        while (hiddenIndexes.size < hiddenCount) {
            hiddenIndexes.add(Math.floor(Math.random() * wordLength));
        }

        return word.split('').map((char, index) => 
            hiddenIndexes.has(index) 
                ? "<span class='gray'>_</span>" 
                : `<span class='gray'>${char}</span>`
        );
    }

    resetWord() {
        const { word, translation } = this.wordList[this.currentWordIndex];
        this.revealedLetters = this.maskWord(word);
        this.currentLetterIndex = 0;
        this.incorrectAttempts = 0;
        this.updateDisplay(translation);
        this.generateLetterGrid(word);
        this.resetInactivityTimer(word[this.currentLetterIndex]);
    }

    updateDisplay(translation) {
        this.elements.wordDisplay.innerHTML = `${this.revealedLetters.join(" ")} - ${translation}`;
    }

    generateLetterGrid(word) {
        if (this.currentLetterIndex >= word.length) return;
        this.elements.gridContainer.innerHTML = "";
        this.isProcessing = false;

        const letters = [word[this.currentLetterIndex], ...this.generateSmartRandomLetters(word)];
        this.shuffleArray(letters).forEach(letter => this.createGridItem(letter, word));
        this.startHintTimer(word[this.currentLetterIndex]);
        this.resetInactivityTimer(word[this.currentLetterIndex]);
    }

    createGridItem(letter, word) {
        const cell = document.createElement("div");
        cell.className = "grid-item";
        cell.innerText = letter;
        cell.onclick = () => this.processLetterSelection(cell, letter, word);
        this.elements.gridContainer.appendChild(cell);
    }

    startHintTimer(correctLetter) {
        clearTimeout(this.hintTimeout);
        this.hintTimeout = setTimeout(() => this.highlightHint(correctLetter), 3000);
    }

    resetInactivityTimer(correctLetter) {
        clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(() => this.highlightHint(correctLetter), 5000);
    }

    highlightHint(correctLetter) {
        this.elements.gridContainer.querySelectorAll(".grid-item").forEach(cell => {
            if (cell.innerText === correctLetter) {
                cell.classList.add("hint");
                cell.classList.remove("wrong");  
            }
        });
    }

    processLetterSelection(cell, letter, word) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        clearTimeout(this.hintTimeout);
        clearTimeout(this.inactivityTimeout);

        if (letter === word[this.currentLetterIndex]) {
            this.revealedLetters[this.currentLetterIndex] = `<span class='black'>${letter}</span>`;
            cell.classList.add("correct");
            cell.onclick = null;
            this.correctStreak++;
            this.incorrectAttempts = 0;

            this.score += 10 + (this.correctStreak * 2);
            this.showScoreChange(cell, 10 + (this.correctStreak * 2));

            this.speakLetter(letter);

            this.currentLetterIndex++;
            setTimeout(() => {
                if (this.currentLetterIndex < word.length) {
                    this.generateLetterGrid(word);
                } else {
                    this.speakWord(word, this.wordList[this.currentWordIndex].translation);
                    this.completedRounds++; // 完成一個單字後，已完成單字數量加 1
                    if (this.completedRounds === this.wordList.length) {
                        this.difficultyLevel++; // 所有單字完成後提高難度
                    }
                    this.nextWord();
                }
            }, 500);
        } else {
            cell.classList.add("wrong");
            this.incorrectAttempts++; // 錯誤次數加 1
            this.correctStreak = 0;

            // 根據錯誤次數增加扣分
            const penalty = Math.max(5, this.difficultyLevel * 2 + this.incorrectAttempts * 2);
            this.score = Math.max(this.score - penalty, 0); // 扣分，分數不會低於 0
            this.showScoreChange(cell, -penalty);

            setTimeout(() => {
                cell.classList.remove("wrong");
                this.isProcessing = false;
            }, 1000);

            this.highlightHint(word[this.currentLetterIndex]);
        }
        this.updateScore();
        this.updateDisplay(this.wordList[this.currentWordIndex].translation);
    }

    nextWord() {
        let newIndex;
        do {
            newIndex = Math.floor(Math.random() * this.wordList.length);
        } while (newIndex === this.currentWordIndex);
        this.currentWordIndex = newIndex;
        this.resetWord();
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    generateSmartRandomLetters(word) {
        const letters = new Set();
        while (letters.size < 8) {
            const randomLetter = String.fromCharCode(97 + Math.floor(Math.random() * 26));
            if (!word.includes(randomLetter)) letters.add(randomLetter);
        }
        return [...letters];
    }

    speakLetter(letter) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(letter);
            utterance.lang = "en-US"; // 設定語言為美式英語
            utterance.rate = 0.8; // 設定語速
            speechSynthesis.speak(utterance);
        } else {
            console.warn("你的瀏覽器不支援 Web Speech API！");
        }
    }

    speakWord(word, translation) {
        if ('speechSynthesis' in window) {
            // 英文發音
            const englishUtterance = new SpeechSynthesisUtterance(word);
            englishUtterance.lang = "en-US"; // 設定語言為美式英語
            englishUtterance.rate = 0.8; // 設定語速

            // 註冊發音結束的回調，發音結束後播放中文翻譯
            englishUtterance.onend = () => {
                const chineseUtterance = new SpeechSynthesisUtterance(translation);
                chineseUtterance.lang = "zh-TW"; // 設定語言為繁體中文
                chineseUtterance.rate = 0.8; // 設定語速
                speechSynthesis.speak(chineseUtterance);
            };

            // 開始播放英文發音
            speechSynthesis.speak(englishUtterance);
        } else {
            console.warn("你的瀏覽器不支援 Web Speech API！");
        }
    }
}

const game = new WordGame(wordList);
