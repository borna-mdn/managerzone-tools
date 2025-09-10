console.log("[MZ Tools] content script loaded:", window.location.href);

// Tiny visual proof it's running (harmless, removable later)
(function addBadge() {
  const badge = document.createElement("div");
  badge.textContent = "MZ Tools";
  Object.assign(badge.style, {
    position: "fixed",
    bottom: "10px",
    right: "10px",
    padding: "6px 8px",
    fontSize: "12px",
    fontFamily: "system-ui, sans-serif",
    background: "rgba(0,0,0,0.7)",
    color: "white",
    borderRadius: "8px",
    zIndex: 999999,
  });
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 2500);
})();

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req?.type === "PING") {
    sendResponse({ msg: "PONG from ManagerZone page" });
  }
});
