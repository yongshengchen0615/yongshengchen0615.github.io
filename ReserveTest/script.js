const firebaseConfig = {
    apiKey: "AIzaSyCQpelp4H9f-S0THHgSiIJHCzyvNG3AGvs",
    authDomain: "reservesystem-c8bbc.firebaseapp.com",
    databaseURL: "https://reservesystem-c8bbc-default-rtdb.firebaseio.com",
    projectId: "reservesystem-c8bbc",
    storageBucket: "reservesystem-c8bbc.firebasestorage.app",
    messagingSenderId: "138232489371",
    appId: "1:138232489371:web:849190b97774b5abae2d3e",
    measurementId: "G-XXDSGNYTV1"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userName = document.getElementById("user-name");
const userPic = document.getElementById("user-pic");
const bookingSection = document.getElementById("booking-section");
const bookBtn = document.getElementById("book-btn");
const appointmentTime = document.getElementById("appointment-time");
const appointmentsList = document.getElementById("appointments-list");

loginBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(result => {
            const user = result.user;
            userName.textContent = user.displayName;
            userPic.src = user.photoURL;
            loginBtn.style.display = "none";
            userInfo.style.display = "block";
            bookingSection.style.display = "block";
            loadAppointments(user.uid);
        })
        .catch(error => {
            alert("登入失敗: " + error.message);
        });
});

logoutBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
        loginBtn.style.display = "block";
        userInfo.style.display = "none";
        bookingSection.style.display = "none";
    });
});

bookBtn.addEventListener("click", () => {
    const user = auth.currentUser;
    if (user && appointmentTime.value) {
        const bookingRef = database.ref("appointments/" + user.uid).push();
        bookingRef.set({
            time: appointmentTime.value,
            userName: user.displayName
        }).then(() => {
            alert("預約成功");
            appointmentTime.value = "";
            loadAppointments(user.uid);
        });
    }
});

function loadAppointments(userId) {
    appointmentsList.innerHTML = "";
    database.ref("appointments/" + userId).once("value", snapshot => {
        snapshot.forEach(childSnapshot => {
            const data = childSnapshot.val();
            const li = document.createElement("li");
            li.textContent = `${data.userName} 預約時間: ${data.time}`;
            appointmentsList.appendChild(li);
        });
    });
}
