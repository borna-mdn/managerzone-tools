(() => {
  // Minimal delay between requests to be polite (tune if needed)
  const REQUEST_GAP_MS = 250;

  // Cache configuration
  const CACHE_KEY_PREFIX = "mz-scout-";
  const CACHE_VERSION = "v1";
  const CACHE_EXPIRY_DAYS = 30; // Scout reports never change, but set reasonable expiry

  const scoutUrl = (pid) =>
    `https://www.managerzone.com/ajax.php?p=players&sub=scout_report&pid=${pid}&sport=soccer`;

  const getPlayerContainers = () =>
    Array.from(document.querySelectorAll(".playerContainer"));

  function log(...message) {
    console.log("[MZ Tools][content/scout-report]", ...message);
  }

  function logE(...message) {
    console.error("[MZ Tools][content/scout-report]", ...message);
  }

  // ---- Cache utilities ----
  function getCacheKey(pid) {
    return `${CACHE_KEY_PREFIX}${CACHE_VERSION}-${pid}`;
  }

  function getCachedScoutData(pid) {
    try {
      const key = getCacheKey(pid);
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const data = JSON.parse(cached);
      const now = Date.now();

      // Check if cache has expired
      if (data.expires && now > data.expires) {
        localStorage.removeItem(key);
        return null;
      }

      return data.scoutData;
    } catch (error) {
      logE("Error reading from cache:", error);
      return null;
    }
  }

  function setCachedScoutData(pid, scoutData) {
    try {
      const key = getCacheKey(pid);
      const expiryTime = Date.now() + CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

      const cacheEntry = {
        scoutData,
        expires: expiryTime,
        cached: Date.now(),
      };

      localStorage.setItem(key, JSON.stringify(cacheEntry));
    } catch (error) {
      logE("Error writing to cache:", error);
      // Continue without caching if localStorage is full or unavailable
    }
  }

  function clearScoutCache() {
    try {
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter((key) => key.startsWith(CACHE_KEY_PREFIX));

      for (const key of cacheKeys) {
        localStorage.removeItem(key);
      }

      log(`Scout cache cleared - ${cacheKeys.length} items removed`);
      return cacheKeys.length;
    } catch (error) {
      logE("Error clearing cache:", error);
      return 0;
    }
  }

  function getPlayerIdFromContainer(container) {
    // Preferred: span#player_id_<PID> .player_id_span => textContent
    const idSpan = container.querySelector(
      "[id^='player_id_'] .player_id_span"
    );
    if (idSpan?.textContent?.trim()) {
      return idSpan.textContent.trim();
    } else {
      logE(`Cannot find player ID, idSpan=${idSpan}`);
      return null;
    }
  }

  // ---- Scout report parsing ----
  function parseScoutHTML(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    const dds = Array.from(doc.querySelectorAll("dd"));
    let highest = [];
    let lowest = [];
    let starsHigh, starsLow;

    for (const dd of dds) {
      const title = dd
        .querySelector("li > strong")
        ?.textContent?.trim()
        .toLowerCase();
      if (!title) continue;

      const skills = Array.from(dd.querySelectorAll("ul li"))
        .map((li) => li.textContent.trim())
        .filter((t) => t && !/potential|youth training speed/i.test(t));

      const starContainer = dd.querySelector(".stars");
      const litCount = starContainer
        ? starContainer.querySelectorAll(".lit").length
        : undefined;

      if (title.includes("highest")) {
        highest = skills;
        starsHigh = litCount;
      } else if (title.includes("lowest")) {
        lowest = skills;
        starsLow = litCount;
      }
    }
    return { highest, lowest, starsHigh, starsLow };
  }

  async function fetchScout(pid) {
    // Check cache first
    const cachedData = getCachedScoutData(pid);
    if (cachedData) {
      log(`Using cached scout data for player ${pid}`);
      return cachedData;
    }

    // Fetch from server if not cached
    log(`Fetching scout data from server for player ${pid}`);
    const res = await fetch(scoutUrl(pid), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "text/html, */*;q=0.1" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const scoutData = parseScoutHTML(await res.text());

    // Cache the result for future use
    setCachedScoutData(pid, scoutData);

    return scoutData;
  }

  // ---- Skill row helpers ----
  const SKILL_NAME_ALIAS = new Map([
    // common aliases/normalizations if needed in the future
    ["play intelligence", "play intelligence"],
    ["ball control", "ball control"],
    ["aerial passing", "aerial passing"],
    ["set plays", "set plays"],
    ["goalkeeping", "keeping"], // sometimes reports say "Keeping"
    ["keeping", "keeping"],
    ["tackling", "tackling"],
    ["passing", "passing"],
    ["heading", "heading"],
    ["shooting", "shooting"],
    ["speed", "speed"],
    ["stamina", "stamina"],
    ["form", "form"],
    ["experience", "experience"],
  ]);

  function norm(s) {
    return s?.trim().toLowerCase();
  }
  function normalizeSkillName(name) {
    const key = norm(name);
    return SKILL_NAME_ALIAS.get(key) || key;
  }

  function findAllSkillNameSpans(container) {
    // find both desktop and responsive tables
    return Array.from(
      container.querySelectorAll(".player_skills td:first-child .clippable")
    );
  }

  function mapNameToRow(container) {
    const map = new Map();
    for (const span of findAllSkillNameSpans(container)) {
      const tr = span.closest("tr");
      if (!tr) continue;
      const skillNorm = normalizeSkillName(span.textContent);
      if (!map.has(skillNorm)) map.set(skillNorm, []);
      map.get(skillNorm).push({ span, tr });
    }
    return map;
  }

  // ---- Flag injection ----
  function getFlagCells(tr) {
    const tds = tr.querySelectorAll(":scope > td");
    // We expect: [0]=name, [1]=w7, [2]=w7, [3]=w6
    if (tds.length >= 4) return [tds[1], tds[2], tds[3]];
    // Fallback: try selecting by width attributes if structure shifts
    const cols = Array.from(
      tr.querySelectorAll(":scope > td[width='7'], :scope > td[width='6']")
    );
    return cols.slice(0, 3);
  }

  function clearFlagCells(cells) {
    cells.forEach((td) => {
      if (td) td.innerHTML = "";
    });
  }

  const FLAG_IMG = {
    green: "img/flag_green.png",
    yellow: "img/flag_yellow.png",
    red: "img/flag_red.png",
  };

  function flagImg(color) {
    const img = document.createElement("img");
    img.src = FLAG_IMG[color];
    img.width = 6;
    img.height = 10;
    img.alt = "";
    img.style.verticalAlign = "middle";
    return img;
  }

  function setFlagsInCells(cells, color, count) {
    clearFlagCells(cells);
    for (let i = 0; i < Math.min(count, cells.length); i++) {
      cells[i].appendChild(flagImg(color));
    }
  }

  function applyFlagsToContainer(
    container,
    highest,
    lowest,
    starsHigh,
    starsLow
  ) {
    const rows = Array.from(container.querySelectorAll(".player_skills tr"));
    if (!rows.length) return;

    // Build a quick lookup from normalized skill name -> row(s)
    const norm = (s) => s?.trim().toLowerCase();
    const nameToRows = new Map();
    for (const tr of rows) {
      const nameSpan = tr.querySelector("td:first-child .clippable");
      if (!nameSpan) continue;
      const key = norm(nameSpan.textContent);
      if (!nameToRows.has(key)) nameToRows.set(key, []);
      nameToRows.get(key).push(tr);
    }

    // Helpers for counts
    const highCount = ((stars) =>
      stars === 4 ? 3 : stars === 3 ? 2 : stars === 2 ? 1 : 0)(starsHigh);
    const lowSpec =
      starsLow === 2
        ? { color: "yellow", count: 1 }
        : starsLow === 1
        ? { color: "red", count: 1 }
        : null;

    // High potentials: fill left→right with green flags
    if (highCount > 0) {
      for (const skill of highest) {
        const trs = nameToRows.get(norm(skill));
        if (!trs) continue;
        for (const tr of trs) {
          const cells = getFlagCells(tr);
          setFlagsInCells(cells, "green", highCount);
        }
      }
    }

    // Low potentials: one flag (yellow for 2★, red for 1★) in the leftmost of the 3 cells
    if (lowSpec) {
      for (const skill of lowest) {
        const trs = nameToRows.get(norm(skill));
        if (!trs) continue;
        for (const tr of trs) {
          const cells = getFlagCells(tr);
          // Clear any existing flags first (each skill should be either high or low in the report)
          clearFlagCells(cells);
          setFlagsInCells(cells, lowSpec.color, lowSpec.count);
        }
      }
    }
  }

  // ---- Orchestration ----
  function renderStatus(container, text, className) {
    // Put a tiny status on the right side of the header to avoid clutter
    const header = container.querySelector("h2.subheader") || container;
    let status = header.querySelector(".mz-scout-status");
    if (!status) {
      status = document.createElement("span");
      status.className = "mz-scout-status";
      header.appendChild(status);
    }
    status.textContent = text;
    status.className = `mz-scout-status ${className || ""}`;
  }

  function hasScoutLink(container) {
    return !!container.querySelector(
      `a[title*="Scout report" i], a[href*="sub=scout_report"], .scout_report`
    );
  }

  function hasPlayerSkillsTable(container) {
    const skillsTable = container.querySelector(".player_skills");
    if (!skillsTable) return false;

    // Check if table has actual skill rows
    const rows = skillsTable.querySelectorAll("tr");
    return rows.length > 0;
  }

  // Store processed player data to reapply after DOM changes
  const processedPlayers = new Map(); // pid -> { highest, lowest, starsHigh, starsLow }

  async function processContainerAndStore(container, delayMs) {
    const pid = getPlayerIdFromContainer(container);
    if (!pid) return;

    if (!hasScoutLink(container)) {
      renderStatus(container, "No scout link", "is-error");
      return;
    }

    if (!hasPlayerSkillsTable(container)) {
      renderStatus(container, "No skills table", "is-error");
      return;
    }

    renderStatus(container, "Fetching scout…", "is-loading");
    await new Promise((r) => setTimeout(r, delayMs));

    try {
      const scoutData = await fetchScout(pid);
      const { highest, lowest, starsHigh, starsLow } = scoutData;

      if (!highest?.length && !lowest?.length) {
        renderStatus(container, "No scout info", "is-error");
        return;
      }

      // Store the data for reapplication
      processedPlayers.set(pid, scoutData);

      applyFlagsToContainer(container, highest, lowest, starsHigh, starsLow);
      renderStatus(container, "Scout flags added", "is-done");
    } catch (e) {
      renderStatus(container, `Scout error: ${e.message}`, "is-error");
    }
  }

  function reapplyFlagsToExistingPlayers() {
    const containers = getPlayerContainers();

    for (const container of containers) {
      const pid = getPlayerIdFromContainer(container);
      if (!pid) continue;

      const scoutData = processedPlayers.get(pid);
      if (!scoutData) continue;

      // Check if skills table is available before applying flags
      if (!hasPlayerSkillsTable(container)) {
        renderStatus(container, "No skills table", "is-error");
        continue;
      }

      const { highest, lowest, starsHigh, starsLow } = scoutData;
      applyFlagsToContainer(container, highest, lowest, starsHigh, starsLow);
      renderStatus(container, "Scout flags added", "is-done");
    }
  }

  // Track which containers we've already processed to avoid duplicates
  const processedContainers = new WeakSet();

  // Process any new player containers that appear
  function processNewContainers() {
    const containers = getPlayerContainers();
    const newContainers = containers.filter((c) => !processedContainers.has(c));

    if (newContainers.length === 0) return;

    log(`Found ${newContainers.length} new player containers`);

    // Mark as processed immediately to avoid duplicates
    newContainers.forEach((c) => processedContainers.add(c));

    // Process with staggered delays
    newContainers.forEach((c, i) =>
      processContainerAndStore(c, i * REQUEST_GAP_MS)
    );
  }

  // Watch for DOM changes (player containers appearing/filtering/etc)
  function setupDOMObserver() {
    const targetNode = document.body;
    if (!targetNode) {
      log("document.body not available yet, retrying...");
      setTimeout(setupDOMObserver, 100);
      return;
    }

    const observer = new MutationObserver((mutations) => {
      let hasPlayerContainerChanges = false;

      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          // Check if any added nodes contain player containers
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.classList?.contains("playerContainer") ||
                node.querySelector?.(".playerContainer")
              ) {
                hasPlayerContainerChanges = true;
                break;
              }
            }
          }

          // Also check removed nodes for reapplication scenarios
          if (!hasPlayerContainerChanges) {
            for (const node of mutation.removedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (
                  node.classList?.contains("playerContainer") ||
                  node.querySelector?.(".playerContainer")
                ) {
                  hasPlayerContainerChanges = true;
                  break;
                }
              }
            }
          }
        }

        if (hasPlayerContainerChanges) break;
      }

      if (hasPlayerContainerChanges) {
        log("Player container changes detected");
        // Small delay to ensure DOM is fully updated
        setTimeout(() => {
          processNewContainers();
          reapplyFlagsToExistingPlayers();
        }, 100);
      }
    });

    observer.observe(targetNode, {
      childList: true,
      subtree: true,
    });

    log("DOM observer initialized and watching for player containers");
  }

  // Initialize scout report functionality
  function initialize() {
    log("Initializing scout report enhancement");

    // Always set up the observer first to catch dynamically loaded containers
    setupDOMObserver();

    // Process any containers that are already in the DOM
    const containers = getPlayerContainers();
    if (containers.length > 0) {
      log(`Found ${containers.length} initial player containers`);
      processNewContainers();
    } else {
      log("No initial player containers found, waiting for dynamic content");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  // Handle messages from popup for cache management
  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req?.type === "GET_CACHE_STATS") {
      try {
        const keys = Object.keys(localStorage).filter((key) =>
          key.startsWith(CACHE_KEY_PREFIX)
        );

        const totalSize = keys.reduce((size, key) => {
          const item = localStorage.getItem(key);
          return size + (item ? item.length : 0);
        }, 0);

        const stats = {
          totalCached: keys.length,
          totalSize: totalSize,
          cacheKeys: keys,
        };

        sendResponse({ stats });
      } catch (error) {
        logE("Error getting cache stats:", error);
        sendResponse({ error: error.message });
      }
      return true; // Keep message channel open for async response
    }

    if (req?.type === "CLEAR_CACHE") {
      try {
        const clearedCount = clearScoutCache();
        log(`Cleared ${clearedCount} cached scout reports via popup`);
        sendResponse({ clearedCount });
      } catch (error) {
        logE("Error clearing cache:", error);
        sendResponse({ error: error.message });
      }
      return true; // Keep message channel open for async response
    }
  });
})();
