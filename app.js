(() => {
  "use strict";

  const characters = window.VOICE_CASTING_CHARACTERS || [];
  const config = window.VOICE_CASTING_CONFIG || {};
  const demoMode = !config.apiUrl;
  const state = {
    claims: {},
    filter: "all",
    search: "",
    loading: !demoMode,
    backendAvailable: demoMode,
    pendingCharacter: "",
  };

  const elements = {
    name: document.querySelector("#volunteer-name"),
    search: document.querySelector("#search"),
    filters: [...document.querySelectorAll(".filter")],
    grid: document.querySelector("#character-grid"),
    message: document.querySelector("#board-message"),
    count: document.querySelector("#claimed-count"),
    template: document.querySelector("#character-template"),
    toast: document.querySelector("#toast"),
  };

  let toastTimer = 0;

  function normalizeName(value) {
    return value.replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function readSessionValue(key) {
    try {
      return window.sessionStorage.getItem(key) || "";
    } catch (_error) {
      return "";
    }
  }

  function writeSessionValue(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (_error) {
      // Storage can be unavailable in strict privacy modes; the form still works.
    }
  }

  function clearLegacyVolunteerName() {
    try {
      window.localStorage.removeItem("voiceCastingVolunteerName");
    } catch (_error) {
      // Ignore unavailable storage and continue without persistence.
    }
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
  }

  function demoClaims() {
    try {
      return JSON.parse(window.localStorage.getItem("voiceCastingDemoClaims") || "{}");
    } catch (_error) {
      return {};
    }
  }

  function saveDemoClaims() {
    window.localStorage.setItem("voiceCastingDemoClaims", JSON.stringify(state.claims));
  }

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const callback = `voiceCastingCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const query = new URLSearchParams({
        ...params,
        callback,
        boardKey: config.boardKey || "",
        _: String(Date.now()),
      });
      const script = document.createElement("script");
      const cleanup = () => {
        window.clearTimeout(timeout);
        script.remove();
        delete window[callback];
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("The signup sheet took too long to answer."));
      }, config.requestTimeoutMs || 12000);

      window[callback] = (payload) => {
        cleanup();
        if (payload && payload.ok) resolve(payload);
        else reject(new Error(payload?.error || "The signup sheet rejected the request."));
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("Could not reach the signup sheet."));
      };
      script.src = `${config.apiUrl}?${query}`;
      document.head.append(script);
    });
  }

  async function loadClaims() {
    if (demoMode) {
      state.claims = demoClaims();
      state.loading = false;
      elements.message.textContent = "Preview mode: claims are saved only in this browser until the Google Sheet backend is connected.";
      render();
      return;
    }

    try {
      const response = await jsonp({ action: "list" });
      state.claims = response.claims || {};
      state.backendAvailable = true;
      elements.message.textContent = "";
    } catch (error) {
      state.backendAvailable = false;
      elements.message.textContent = `${error.message} The roster is still available, but claiming is temporarily disabled.`;
    } finally {
      state.loading = false;
      render();
    }
  }

  function visibleCharacters() {
    const query = state.search.toLocaleLowerCase();
    return characters
      .filter((character) => {
        const claimed = Boolean(state.claims[character.id]);
        const matchesFilter = state.filter === "all" || (state.filter === "claimed" ? claimed : !claimed);
        const haystack = `${character.name} ${character.description}`.toLocaleLowerCase();
        return matchesFilter && (!query || haystack.includes(query));
      })
      .sort((left, right) => {
        const claimDifference = Number(Boolean(state.claims[left.id])) - Number(Boolean(state.claims[right.id]));
        return claimDifference || left.name.localeCompare(right.name);
      });
  }

  async function claimCharacter(character) {
    const name = normalizeName(elements.name.value);
    if (!name) {
      elements.name.focus();
      showToast("Write your first name or nickname before claiming a voice.");
      return;
    }
    elements.name.value = name;
    writeSessionValue("voiceCastingVolunteerName", name);
    state.pendingCharacter = character.id;
    render();

    try {
      if (demoMode) {
        if (state.claims[character.id]) throw new Error(`Already claimed by ${state.claims[character.id]}.`);
        state.claims[character.id] = name;
        saveDemoClaims();
      } else {
        const response = await jsonp({ action: "claim", characterId: character.id, name });
        state.claims[character.id] = response.claimedBy;
        if (response.conflict) {
          showToast(`${character.name} was just claimed by ${response.claimedBy}.`);
          return;
        }
      }
      showToast(`You claimed ${character.name}. Save your recording as ${character.filename}.`);
    } catch (error) {
      showToast(error.message);
      if (!demoMode) await loadClaims();
    } finally {
      state.pendingCharacter = "";
      render();
    }
  }

  async function copyFilename(filename) {
    try {
      await navigator.clipboard.writeText(filename);
      showToast(`Copied ${filename}`);
    } catch (_error) {
      showToast(`Filename: ${filename}`);
    }
  }

  function createCard(character) {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const claimant = state.claims[character.id] || "";
    const pending = state.pendingCharacter === character.id;
    const hasName = Boolean(normalizeName(elements.name.value));
    card.style.setProperty("--accent", character.color);
    card.dataset.characterId = character.id;
    card.classList.toggle("is-claimed", Boolean(claimant));
    card.classList.toggle("no-art", !character.art);

    const artWrap = card.querySelector(".character-card__art-wrap");
    if (character.art) {
      artWrap.hidden = false;
      const art = card.querySelector(".character-card__art");
      art.src = character.art;
      art.alt = `${character.name} ${character.artKind === "portrait" ? "portrait" : "sprite"}`;
      art.classList.toggle("is-sprite", character.artKind === "sprite");
    }

    card.querySelector("h3").textContent = character.name;
    card.querySelector(".character-card__description").textContent = character.description;
    card.querySelector(".filename-row code").textContent = character.filename;
    card.querySelector(".copy-button").addEventListener("click", () => copyFilename(character.filename));

    const status = card.querySelector(".status-pill");
    status.textContent = claimant ? "Claimed" : "Available";
    const button = card.querySelector(".claim-button");
    button.textContent = pending ? "Signing the sheet…" : claimant ? `Claimed by ${claimant}` : "Claim this voice";
    button.disabled = state.loading || !state.backendAvailable || pending || Boolean(claimant) || !hasName;
    button.addEventListener("click", () => claimCharacter(character));
    const note = card.querySelector(".claim-note");
    note.textContent = claimant ? `Voice: ${claimant}` : !hasName ? "Enter your nickname above to claim." : "";
    return card;
  }

  function render() {
    const claimedCount = Object.keys(state.claims).filter((id) => state.claims[id]).length;
    elements.count.textContent = `${claimedCount} / ${characters.length}`;
    elements.grid.replaceChildren(...visibleCharacters().map(createCard));
    if (!state.loading && !elements.grid.children.length) {
      elements.message.textContent = "No characters match that search and filter.";
    } else if (!state.loading && elements.message.textContent.startsWith("No characters")) {
      elements.message.textContent = "";
    }
  }

  clearLegacyVolunteerName();
  elements.name.value = readSessionValue("voiceCastingVolunteerName");
  elements.name.addEventListener("input", render);
  elements.name.addEventListener("change", () => {
    const value = normalizeName(elements.name.value);
    elements.name.value = value;
    writeSessionValue("voiceCastingVolunteerName", value);
    render();
  });
  elements.search.addEventListener("input", () => {
    state.search = elements.search.value.trim();
    render();
  });
  elements.filters.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      elements.filters.forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
      render();
    });
  });

  render();
  loadClaims();
  if (!demoMode) {
    window.setInterval(() => {
      if (!state.pendingCharacter && document.visibilityState === "visible") loadClaims();
    }, 30000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !state.pendingCharacter) loadClaims();
    });
  }
})();
