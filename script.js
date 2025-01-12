const wordList = [
    { word: "chair", translation: "椅子" },
    { word: "table", translation: "桌子" },
    { word: "spoon", translation: "湯匙" },
    { word: "bread", translation: "麵包" },
    { word: "water", translation: "水" },
    { word: "juice", translation: "果汁" },
    { word: "clock", translation: "時鐘" },
    { word: "phone", translation: "手機" },
    { word: "candy", translation: "糖果" },
    { word: "smile", translation: "微笑" },
    { word: "happy", translation: "快樂" },
    { word: "river", translation: "河流" },
    { word: "ocean", translation: "海洋" },
    { word: "earth", translation: "地球" },
    { word: "cloud", translation: "雲" },
    { word: "plant", translation: "植物" },
    { word: "music", translation: "音樂" },
    { word: "dance", translation: "跳舞" },
    { word: "light", translation: "燈光" },
    { word: "mouse", translation: "老鼠" },
    { word: "horse", translation: "馬" },
    { word: "piano", translation: "鋼琴" },
    { word: "grape", translation: "葡萄" },
    { word: "lemon", translation: "檸檬" },
    { word: "melon", translation: "甜瓜" },
    { word: "peach", translation: "桃子" },
    { word: "berry", translation: "漿果" },
    { word: "bread", translation: "麵包" },
    { word: "shirt", translation: "襯衫" },
    { word: "house", translation: "房子" },
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
        this.difficultyLevel = 0;
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
    // 確保已出現單字的索引記錄
    if (!this.usedWords) {
        this.usedWords = new Set();
    }

    // 如果所有單字都出現過，則重置記錄
    if (this.usedWords.size >= this.wordList.length) {
        this.usedWords.clear();
    }

    let newIndex;
    do {
        newIndex = Math.floor(Math.random() * this.wordList.length);
    } while (this.usedWords.has(newIndex)); // 避免選擇已經出現過的單字

    this.usedWords.add(newIndex); // 記錄已選過的單字
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
            utterance.rate = 1; // 設定語速
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
