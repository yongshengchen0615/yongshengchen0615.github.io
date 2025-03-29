// notificationModule.js
export const NotificationModule = (() => {
    function createContainer() {
        if (!document.getElementById("notification-container")) {
            const el = document.createElement("div");
            el.id = "notification-container";
            el.style.position = "fixed";
            el.style.top = "20px";
            el.style.right = "20px";
            el.style.zIndex = "9999";
            document.body.appendChild(el);
        }
    }

    function show(message, type = "info", duration = 3000) {
        createContainer();
        const container = document.getElementById("notification-container");

        const colorMap = {
            success: "#2a9d8f",
            error: "#e76f51",
            info: "#6a89cc",
            warning: "#f4a261"
        };

        const box = document.createElement("div");
        box.textContent = message;
        box.style.background = colorMap[type] || "#6a89cc";
        box.style.color = "#fff";
        box.style.padding = "10px 15px";
        box.style.marginTop = "10px";
        box.style.borderRadius = "10px";
        box.style.boxShadow = "0 4px 10px rgba(0,0,0,0.2)";
        box.style.fontWeight = "bold";
        box.style.minWidth = "200px";
        box.style.textAlign = "center";

        container.appendChild(box);
        setTimeout(() => container.removeChild(box), duration);
    }

    // ✅ confirm with "OK" button
    function confirm(message, type = "info") {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.position = "fixed";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100%";
            overlay.style.height = "100%";
            overlay.style.background = "rgba(0,0,0,0.5)";
            overlay.style.zIndex = "10000";
            overlay.style.display = "flex";
            overlay.style.justifyContent = "center";
            overlay.style.alignItems = "center";

            const box = document.createElement("div");
            box.style.background = "#fff";
            box.style.padding = "20px 30px";
            box.style.borderRadius = "12px";
            box.style.boxShadow = "0 4px 15px rgba(0,0,0,0.3)";
            box.style.textAlign = "center";
            box.style.maxWidth = "300px";
            box.style.fontWeight = "bold";
            box.innerHTML = `
                <p style="color:#333; margin-bottom: 20px;">${message}</p>
                <button id="confirm-ok-btn" style="padding: 8px 20px; background:#2a9d8f; color:#fff; border:none; border-radius:8px; font-weight:bold;">
                    確定
                </button>
            `;

            overlay.appendChild(box);
            document.body.appendChild(overlay);

            document.getElementById("confirm-ok-btn").onclick = () => {
                document.body.removeChild(overlay);
                resolve(true);
            };
        });
    }

    return {
        show,
        confirm
    };
})();
