// Test message to the active tab
document.getElementById("ping").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    alert("Content says: " + (response?.msg ?? "no response"));
  } catch (e) {
    alert("No content script on this page. Open managerzone.com first.");
  }
});

// Optional: handle responses from content if you start using chrome.runtime messaging
