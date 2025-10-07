(() => {
  const PLAYERS_PAGE_REGEX = /[?&]p=players(\b|&|$)/i;
  if (!PLAYERS_PAGE_REGEX.test(location.search)) return;

  // Minimal delay between requests to be polite (tune if needed)
  const REQUEST_GAP_MS = 250;

  const scoutUrl = (pid) =>
    `https://www.managerzone.com/ajax.php?p=players&sub=scout_report&pid=${pid}&sport=soccer`;

  const getPlayerContainers = () =>
    Array.from(document.querySelectorAll(".playerContainer"));

  function logE(...message) {
    console.error("[MZ Tools][content/scout-report]", ...message);
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
    const res = await fetch(scoutUrl(pid), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "text/html, */*;q=0.1" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseScoutHTML(await res.text());
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

  async function processContainer(container, delayMs) {
    const pid = getPlayerIdFromContainer(container);
    if (!pid) return;

    if (!hasScoutLink(container)) {
      renderStatus(container, "No scout link", "is-error");
      return;
    }

    renderStatus(container, "Fetching scout…", "is-loading");
    await new Promise((r) => setTimeout(r, delayMs));

    try {
      const { highest, lowest, starsHigh, starsLow } = await fetchScout(pid);
      if (!highest?.length && !lowest?.length) {
        renderStatus(container, "No scout info", "is-error");
        return;
      }
      applyFlagsToContainer(container, highest, lowest, starsHigh, starsLow);
      renderStatus(container, "Scout flags added", "is-done");
    } catch (e) {
      renderStatus(container, `Scout error: ${e.message}`, "is-error");
    }
  }

  function run() {
    const containers = getPlayerContainers();
    containers.forEach((c, i) => processContainer(c, i * REQUEST_GAP_MS));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
