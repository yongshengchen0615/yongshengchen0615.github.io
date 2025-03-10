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

    document.getElementById("drawButton").addEventListener("click", async () => {
        if (!isAuthenticated) {
            alert("請先掃描 QR Code 獲取授權！");
            return;
        }

        document.getElementById("drawButton").disabled = true;

        let docRef = doc(db, "prizes", "lottery");
        let docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().sweetSoup > 0) {
            await updateDoc(docRef, { sweetSoup: increment(-1) });
            fetchPrizes();
        }

        document.getElementById("drawButton").disabled = false;
    });

    document.getElementById("scanQRButton").addEventListener("click", () => {
        isAuthenticated = true;
        document.getElementById("authStatus").textContent = "驗證成功！";
        document.getElementById("drawButton").disabled = false;
    });
});
