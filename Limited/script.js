import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import QrScanner from "https://unpkg.com/qr-scanner@1.4.2/qr-scanner.min.js";

document.addEventListener("DOMContentLoaded", () => {
    const firebaseConfig = {
        apiKey: "AIzaSyCQpelp4H9f-S0THHgSiIJHCzyvNG3AGvs",
  authDomain: "reservesystem-c8bbc.firebaseapp.com",
  databaseURL: "https://reservesystem-c8bbc-default-rtdb.firebaseio.com",
  projectId: "reservesystem-c8bbc",
  storageBucket: "reservesystem-c8bbc.firebasestorage.app",
  messagingSenderId: "138232489371",
  appId: "1:138232489371:web:b5358137baf293f9ae2d3e",
  measurementId: "G-RZ9XSVK925"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    let isAuthenticated = false;

    async function fetchPrizes() {
        const docRef = doc(db, "prizes", "lottery");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            document.getElementById("sweetSoupCount").textContent = docSnap.data().sweetSoup;
            document.getElementById("footBathCount").textContent = docSnap.data().footBath;
            document.getElementById("pointCount").textContent = docSnap.data().point;
        }
    }

    fetchPrizes();

    async function calculateExpectedValueAndDrawPrize() {
        const docRef = doc(db, "prizes", "lottery");
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return;

        let prizeData = docSnap.data();
        let totalPrizes = prizeData.sweetSoup + prizeData.footBath + prizeData.point;

        if (totalPrizes === 0) {
            document.getElementById("prizeText").textContent = "已無獎品！";
            return;
        }

        // 設定獎品價值
        const valueSweetSoup = 100;
        const valueFootBath = 80;
        const valuePoint = 50;

        // 計算各獎項機率
        let probSweetSoup = prizeData.sweetSoup / totalPrizes;
        let probFootBath = prizeData.footBath / totalPrizes;
        let probPoint = prizeData.point / totalPrizes;

        // 計算期望值
        let expectedValue = (probSweetSoup * valueSweetSoup) + (probFootBath * valueFootBath) + (probPoint * valuePoint);

        console.log(`當前期望值: ${expectedValue.toFixed(2)}`);

        // 根據機率隨機選擇獎品
        let rand = Math.random();
        let cumulativeProb = 0;

        let chosenPrize;
        if (rand < (cumulativeProb += probSweetSoup)) {
            chosenPrize = "甜湯";
        } else if (rand < (cumulativeProb += probFootBath)) {
            chosenPrize = "足湯包";
        } else {
            chosenPrize = "1 點";
        }

        document.getElementById("prizeText").textContent = `恭喜獲得: ${chosenPrize}`;

        // 獎品鍵對應 Firestore 欄位名稱
        let prizeKey = chosenPrize === "甜湯" ? "sweetSoup" : chosenPrize === "足湯包" ? "footBath" : "point";

        // 確保獎品數量足夠後才減少
        if (prizeData[prizeKey] > 0) {
            await updateDoc(docRef, { [prizeKey]: increment(-1) });
        }

        fetchPrizes();
    }

    document.getElementById("drawButton").addEventListener("click", async () => {
        if (!isAuthenticated) {
            alert("請先掃描 QR Code 獲取授權！");
            return;
        }

        document.getElementById("drawButton").disabled = true;
        await calculateExpectedValueAndDrawPrize();
        document.getElementById("drawButton").disabled = false;
    });

    // QR Code 掃描驗證
    const video = document.getElementById("qr-video");
    const qrContainer = document.getElementById("qr-container");
    const authStatus = document.getElementById("authStatus");
    let qrScanner;

    document.getElementById("scanQRButton").addEventListener("click", () => {
        if (!qrScanner) {
            qrScanner = new QrScanner(video, result => {
                if (result === "AUTHORIZED_CODE") {
                    isAuthenticated = true;
                    authStatus.textContent = "驗證成功！";
                    qrScanner.stop();
                    qrContainer.style.display = "none";
                    document.getElementById("drawButton").disabled = false;
                } else {
                    alert("無效的 QR Code！");
                }
            });
        }
        qrContainer.style.display = "block";
        qrScanner.start().catch(err => {
            console.error("無法啟動 QR 掃描器", err);
            alert("無法啟動 QR 掃描，請確保相機權限已開啟！");
        });
    });

    document.getElementById("close-qr").addEventListener("click", () => {
        qrContainer.style.display = "none";
        if (qrScanner) {
            qrScanner.stop();
        }
    });
});
