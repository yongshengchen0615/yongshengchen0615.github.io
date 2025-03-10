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

    let prizeData = {};
    let isAuthenticated = false;
    let isDrawing = false;

    async function fetchPrizes() {
        const docRef = doc(db, "prizes", "lottery");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            prizeData = docSnap.data();
            document.getElementById("sweetSoupCount").textContent = prizeData.sweetSoup;
            document.getElementById("footBathCount").textContent = prizeData.footBath;
            document.getElementById("pointCount").textContent = prizeData.point;
        }
    }

    fetchPrizes();

    document.getElementById("drawButton").addEventListener("click", async function() {
        if (!isAuthenticated) {
            alert("請先掃描 QR Code 獲取授權！");
            return;
        }

        if (isDrawing) return;
        isDrawing = true;
        document.getElementById("drawButton").disabled = true;

        let availablePrizes = [];
        if (prizeData.sweetSoup > 0) availablePrizes.push("甜湯");
        if (prizeData.footBath > 0) availablePrizes.push("足湯包");
        if (prizeData.point > 0) availablePrizes.push("1 點");

        if (availablePrizes.length === 0) {
            document.getElementById("prizeText").textContent = "已無獎品！";
            isDrawing = false;
            document.getElementById("drawButton").disabled = false;
            return;
        }

        let chosenPrize = availablePrizes[Math.floor(Math.random() * availablePrizes.length)];
        document.getElementById("prizeText").textContent = "恭喜獲得: " + chosenPrize;

        let prizeKey = chosenPrize === "甜湯" ? "sweetSoup" : chosenPrize === "足湯包" ? "footBath" : "point";
        const docRef = doc(db, "prizes", "lottery");

        // 確保 Firestore 數據不會變成負數
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data()[prizeKey] > 0) {
            await updateDoc(docRef, { [prizeKey]: increment(-1) });
        } else {
            document.getElementById("prizeText").textContent = "獎品已兌換完，請稍後再試！";
        }

        await fetchPrizes();
        isDrawing = false;
        document.getElementById("drawButton").disabled = false;
    });

    const video = document.getElementById("qr-video");
    const qrContainer = document.getElementById("qr-container");
    const authStatus = document.getElementById("authStatus");
    let qrScanner;

    document.getElementById("scanQRButton").addEventListener("click", () => {
        if (!qrScanner) {
            qrScanner = new QrScanner(video, result => {
                if (result === "AUTHORIZED_CODE") {
                    isAuthenticated = true;
                    authStatus.textContent = "驗證成功！可以抽獎！";
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
});
