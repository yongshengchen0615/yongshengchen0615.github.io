// previewModule.js
export const PreviewModule = (() => {
    let summaryContent = "";
  
    function render(summaryText) {
      summaryContent = summaryText;
      document.getElementById("preview-text").textContent = summaryText;
      document.getElementById("preview-modal").style.display = "block";
    }
  
    function bindEvents(onConfirmCallback) {
      document.getElementById("preview-cancel").addEventListener("click", close);
      document.getElementById("preview-cancel-footer").addEventListener("click", close);
      document.getElementById("preview-confirm").addEventListener("click", () => {
        if (onConfirmCallback && typeof onConfirmCallback === "function") {
          onConfirmCallback(summaryContent);
        }
        close();
      });
    }
  
    function close() {
      document.getElementById("preview-modal").style.display = "none";
    }
  
    return {
      render,
      bindEvents,
      close
    };
  })();
  