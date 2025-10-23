// Cache management constants
const CACHE_KEY_PREFIX = "mz-scout-";

// Utility functions
function showStatus(message, type = "info") {
  const statusEl = document.getElementById("status-message");
  statusEl.textContent = message;
  statusEl.className = `status-message status-${type}`;
  statusEl.style.display = "block";

  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusEl.style.display = "none";
  }, 3000);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Communication with content script
async function sendMessageToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { error: "No active tab found", isManagerZone: false };
  }

  // Check if it's a ManagerZone tab
  if (!tab.url?.includes("managerzone.com")) {
    return { error: "Not on ManagerZone", isManagerZone: false };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return { ...response, isManagerZone: true };
  } catch (error) {
    return { error: "Content script not responding", isManagerZone: true };
  }
}

async function getCacheStats() {
  const response = await sendMessageToActiveTab({ type: "GET_CACHE_STATS" });

  if (!response.isManagerZone) {
    return {
      totalCached: "N/A",
      totalSize: "N/A",
      cacheKeys: [],
      needsManagerZone: true,
    };
  }

  if (response.error) {
    return {
      totalCached: "Error",
      totalSize: "Error",
      cacheKeys: [],
      error: response.error,
    };
  }

  return response.stats || { totalCached: 0, totalSize: 0, cacheKeys: [] };
}

async function clearCache() {
  const response = await sendMessageToActiveTab({ type: "CLEAR_CACHE" });

  if (!response.isManagerZone) {
    return {
      error: "Please switch to a ManagerZone tab first",
      needsManagerZone: true,
    };
  }

  if (response.error) {
    return { error: response.error };
  }

  return { clearedCount: response.clearedCount || 0 };
}

function setUnavailableState() {
  document.getElementById("cache-count").textContent = "N/A";
  document.getElementById("cache-size").textContent = "N/A";

  // Disable cache buttons when not on ManagerZone
  document.getElementById("refresh-cache").disabled = true;
  document.getElementById("clear-cache").disabled = true;
}

function setAvailableState() {
  // Re-enable cache buttons when on ManagerZone
  document.getElementById("refresh-cache").disabled = false;
  document.getElementById("clear-cache").disabled = false;
}

async function updateCacheDisplay() {
  document.getElementById("cache-count").textContent = "Loading...";
  document.getElementById("cache-size").textContent = "Loading...";

  const result = await getCacheStats();

  if (result.needsManagerZone) {
    setUnavailableState();
    return { needsManagerZone: true };
  }

  if (result.error) {
    document.getElementById("cache-count").textContent = "Error";
    document.getElementById("cache-size").textContent = "Error";
    return { error: result.error };
  }

  setAvailableState();
  document.getElementById("cache-count").textContent = result.totalCached;
  document.getElementById("cache-size").textContent = formatBytes(
    result.totalSize
  );

  return { success: true };
}

// Event listeners
document.getElementById("refresh-cache").addEventListener("click", async () => {
  const result = await updateCacheDisplay();

  if (result.needsManagerZone) {
    showStatus(
      "Please switch to a ManagerZone tab to view cache stats",
      "info"
    );
    return;
  }

  if (result.error) {
    showStatus("Failed to refresh cache stats: " + result.error, "error");
    return;
  }

  showStatus("Cache stats refreshed", "success");
});

document.getElementById("clear-cache").addEventListener("click", async () => {
  const result = await clearCache();

  if (result.needsManagerZone) {
    showStatus("Please switch to a ManagerZone tab first", "info");
    return;
  }

  if (result.error) {
    showStatus("Failed to clear cache: " + result.error, "error");
    return;
  }

  await updateCacheDisplay();
  showStatus(`Cleared ${result.clearedCount} cached scout reports`, "success");
});

// Initialize on popup open
document.addEventListener("DOMContentLoaded", async () => {
  const result = await updateCacheDisplay();

  if (result.needsManagerZone) {
    showStatus("Switch to a ManagerZone tab to view cache stats", "info");
  } else if (result.error) {
    showStatus("Cache stats unavailable: " + result.error, "error");
  }
});
