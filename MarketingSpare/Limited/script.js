import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import QrScanner from "https://unpkg.com/qr-scanner@1.4.2/qr-scanner.min.js";

document.addEventListener("DOMContentLoaded", () => {
    const firebaseConfig = {
        apiKey: "YOUR_API_KEY",
        authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT_ID.appspot.com",
        messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
        appId: "YOUR_APP_ID"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    let isAuthenticated = false;

    const prizeValues = { sweetSoup: 100, footBath: 80, point: 50 };

    async function fetchPrizes() {
        const docRef = doc(db, "prizes", "lottery");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const prizeData = docSnap.data();
            Object.keys(prizeData).forEach(prize => {
                document.getElementById(`${prize}Count`).textContent = prizeData[prize];
            });
            return prizeData;
        }
        return null;
    }

    function calculateProbabilities(prizeData) {
        let totalPrizes = Object.values(prizeData).reduce((sum, count) => sum + count, 0);
        if (totalPrizes === 0) return null;

        let weights = {};
        let totalWeight = 0;
        Object.keys(prizeData).forEach(prize => {
            let factor = (prizeData[prize] / totalPrizes) ** 2;
            weights[prize] = (prizeData[prize] / totalPrizes) * prizeValues[prize] * (1 - factor);
            totalWeight += weights[prize];
        });

        return Object.keys(weights).reduce((probs, prize) => {
            probs[prize] = weights[prize] / totalWeight;
            return probs;
        }, {});
    }

    async function drawPrize() {
        const docRef = doc(db, "prizes", "lottery");
        const prizeData = await fetchPrizes();
        if (!prizeData) {
            document.getElementById("prizeText").textContent = "已無獎品！";
            return;
        }

        let probabilities = calculateProbabilities(prizeData);
        if (!probabilities) {
            document.getElementById("prizeText").textContent = "已無獎品！";
            return;
        }

        let rand = Math.random(), cumulativeProb = 0, chosenPrize;
        for (let [prize, prob] of Object.entries(probabilities)) {
            cumulativeProb += prob;
            if (rand < cumulativeProb) {
                chosenPrize = prize;
                break;
            }
        }

        document.getElementById("prizeText").textContent = `恭喜獲得: ${chosenPrize}`;
        if (prizeData[chosenPrize] > 0) {
            await updateDoc(docRef, { [chosenPrize]: increment(-1) });
        }
        fetchPrizes();
    }

    document.getElementById("drawButton").addEventListener("click", async () => {
        if (!isAuthenticated) {
            alert("請先掃描 QR Code 獲取授權！");
            return;
        }
        document.getElementById("drawButton").disabled = true;
        await drawPrize();
        document.getElementById("drawButton").disabled = false;
    });

    const qrContainer = document.getElementById("qr-container");
    let qrScanner;

    document.getElementById("scanQRButton").addEventListener("click", () => {
        if (!qrScanner) {
            qrScanner = new QrScanner(document.getElementById("qr-video"), result => {
                if (result === "AUTHORIZED_CODE") {
                    isAuthenticated = true;
                    document.getElementById("authStatus").textContent = "驗證成功！";
                    qrScanner.stop();
                    qrContainer.style.display = "none";
                    document.getElementById("drawButton").disabled = false;
                } else {
                    alert("無效的 QR Code！");
                }
            });
        }
        qrContainer.style.display = "block";
        qrScanner.start().catch(err => alert("無法啟動 QR 掃描，請確保相機權限已開啟！"));
    });

    document.getElementById("close-qr").addEventListener("click", () => {
        qrContainer.style.display = "none";
        if (qrScanner) qrScanner.stop();
    });
});
