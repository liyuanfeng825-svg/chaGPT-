(() => {
  const EXT_CLASS = "cgpt-delete-helper";
  const ITEM_CLASS = "cgpt-delete-helper-item";
  const BUTTON_CLASS = "cgpt-delete-helper-button";
  const TOGGLE_CLASS = "cgpt-delete-helper-master-toggle";
  const BUSY_CLASS = "cgpt-delete-helper-busy";
  const STEALTH_CLASS = "cgpt-delete-helper-stealth";
  const TOAST_CLASS = "cgpt-delete-helper-toast";
  const CHAT_PATH_RE = /^\/c\/[0-9a-z-]+\/?$/i;
  const DELETE_TEXT_RE = /^(删除|delete)$/i;
  const DELETE_LOOSE_RE = /(删除|delete)/i;
  const MORE_LABEL_RE = /(options|more|menu|conversation|更多|菜单|選項|选项)/i;

  const settings = {
    enabled: false,
    showToast: true,
    defaultOffMigrated: false
  };

  let observer = null;
  let decorateTimer = 0;

  chrome.storage.sync.get(settings, (saved) => {
    Object.assign(settings, saved);

    if (!settings.defaultOffMigrated) {
      Object.assign(settings, {
        enabled: false,
        defaultOffMigrated: true
      });
      chrome.storage.sync.set({
        enabled: false,
        defaultOffMigrated: true
      });
    }

    start();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    Object.entries(changes).forEach(([key, change]) => {
      settings[key] = change.newValue;
    });

    if (settings.enabled) {
      updateMasterToggle();
      decorateSoon();
    } else {
      updateMasterToggle();
      removeButtons();
    }
  });

  function start() {
    ensureMasterToggle();
    if (settings.enabled) decorateSoon();

    observer = new MutationObserver(() => {
      ensureMasterToggle();
      if (settings.enabled) decorateSoon();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function decorateSoon() {
    clearTimeout(decorateTimer);
    decorateTimer = window.setTimeout(() => {
      ensureMasterToggle();
      decorateConversationItems();
    }, 120);
  }

  function decorateConversationItems() {
    if (!settings.enabled) return;

    findConversationAnchors().forEach((anchor) => {
      const item = getConversationItem(anchor);
      if (!item || item.querySelector(`:scope > .${BUTTON_CLASS}`)) return;

      item.classList.add(ITEM_CLASS);

      const button = document.createElement("button");
      button.className = `${EXT_CLASS} ${BUTTON_CLASS}`;
      button.type = "button";
      button.title = "直接删除这条对话";
      button.setAttribute("aria-label", "直接删除这条对话");
      button.innerHTML = trashIcon();
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteConversation(item, anchor, button);
      });

      item.append(button);
    });
  }

  function ensureMasterToggle() {
    if (document.querySelector(`.${TOGGLE_CLASS}`)) {
      updateMasterToggle();
      return;
    }

    const toggle = document.createElement("button");
    toggle.className = `${EXT_CLASS} ${TOGGLE_CLASS}`;
    toggle.type = "button";
    toggle.title = "开启/关闭对话快捷删除";
    toggle.setAttribute("aria-label", "开启/关闭对话快捷删除");
    toggle.innerHTML = `
      <span class="cgpt-delete-helper-master-icon">${trashIcon()}</span>
      <span class="cgpt-delete-helper-master-track" aria-hidden="true">
        <span class="cgpt-delete-helper-master-thumb"></span>
      </span>
    `;
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const enabled = !settings.enabled;
      settings.enabled = enabled;
      chrome.storage.sync.set({
        enabled,
        defaultOffMigrated: true
      });
      updateMasterToggle();

      if (enabled) {
        decorateSoon();
      } else {
        removeButtons();
      }
    });

    document.body.append(toggle);
    updateMasterToggle();
  }

  function updateMasterToggle() {
    const toggle = document.querySelector(`.${TOGGLE_CLASS}`);
    if (!toggle) return;

    toggle.dataset.enabled = String(Boolean(settings.enabled));
    toggle.setAttribute("aria-pressed", String(Boolean(settings.enabled)));
  }

  function removeButtons() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => button.remove());
    document.querySelectorAll(`.${ITEM_CLASS}`).forEach((item) => {
      item.classList.remove(ITEM_CLASS, BUSY_CLASS);
    });
  }

  function findConversationAnchors() {
    return Array.from(document.querySelectorAll('a[href]')).filter((anchor) => {
      const path = getPathname(anchor);
      if (!CHAT_PATH_RE.test(path)) return false;
      if (!isInSidebar(anchor)) return false;
      return anchor.getClientRects().length > 0;
    });
  }

  function getPathname(anchor) {
    try {
      return new URL(anchor.href, location.origin).pathname;
    } catch {
      return "";
    }
  }

  function isInSidebar(element) {
    const nav = element.closest("aside, nav, [role='navigation'], [data-testid*='sidebar'], [class*='sidebar']");
    if (nav) return true;

    const rect = element.getBoundingClientRect();
    return rect.left < Math.min(420, window.innerWidth * 0.45);
  }

  function getConversationItem(anchor) {
    const listItem = anchor.closest("li");
    if (listItem) return listItem;

    const labelledRow = anchor.closest("[data-testid*='history'], [data-testid*='conversation'], [role='listitem']");
    if (labelledRow) return labelledRow;

    return anchor.parentElement;
  }

  async function deleteConversation(item, anchor, button) {
    if (button.disabled) return;

    setBusy(item, button, true);
    document.documentElement.classList.add(STEALTH_CLASS);

    try {
      await revealNativeControls(item, anchor);

      const menuButton = await waitFor(() => findNativeMenuButton(item, button), 1800);
      if (!menuButton) {
        throw new Error("没有找到这条对话自己的更多菜单");
      }

      clickElement(menuButton);

      const deleteMenuItem = await waitFor(findDeleteMenuItem, 2200);
      if (!deleteMenuItem) {
        throw new Error("没有找到删除菜单项");
      }

      clickElement(deleteMenuItem);

      const confirmButton = await waitFor(findDeleteConfirmButton, 2600);
      if (confirmButton) {
        clickElement(confirmButton);
      } else if (!document.body.contains(item)) {
        showToast("已删除");
        return;
      } else {
        throw new Error("没有找到删除确认按钮");
      }

      showToast("已删除");
    } catch (error) {
      console.warn("[ChatGPT Delete Helper]", error);
      showToast(error.message || "删除失败，请重试", true);
    } finally {
      window.setTimeout(() => {
        document.documentElement.classList.remove(STEALTH_CLASS);
      }, 220);
      setBusy(item, button, false);
      decorateSoon();
    }
  }

  async function revealNativeControls(item, anchor) {
    [item, anchor].forEach((target) => {
      if (!target) return;
      ["pointerover", "mouseover", "mouseenter", "mousemove", "focusin"].forEach((type) => {
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    });

    await sleep(90);
  }

  function findNativeMenuButton(item, helperButton) {
    const candidates = Array.from(item.querySelectorAll("button")).filter((button) => {
      if (button === helperButton) return false;
      if (button.closest(`.${EXT_CLASS}`)) return false;
      if (!isVisible(button)) return false;

      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-testid"),
        button.textContent
      ].filter(Boolean).join(" ");

      return MORE_LABEL_RE.test(label) || button.querySelector("svg");
    });

    return candidates.at(-1) || null;
  }

  function findDeleteMenuItem() {
    const menuRoots = Array.from(document.querySelectorAll([
      "[role='menu']",
      "[data-radix-menu-content]",
      "[data-radix-popper-content-wrapper]",
      "[cmdk-list]",
      "[data-testid*='menu']"
    ].join(","))).filter(isVisible);

    const roots = menuRoots.length ? menuRoots : [document.body];
    const candidates = roots.flatMap((root) => Array.from(root.querySelectorAll([
      "[role='menuitem']",
      "[role='option']",
      "button",
      "[data-testid*='delete' i]",
      "[aria-label*='delete' i]",
      "[aria-label*='删除']"
    ].join(",")))).filter(isActionable);

    return candidates
      .map((candidate) => ({
        candidate,
        label: getElementLabel(candidate)
      }))
      .filter(({ label }) => DELETE_LOOSE_RE.test(label))
      .sort((a, b) => getDeleteScore(b.candidate, b.label) - getDeleteScore(a.candidate, a.label))
      .map(({ candidate }) => candidate)[0] || null;
  }

  function getDeleteScore(element, label) {
    let score = 0;
    if (element.matches("[role='menuitem']")) score += 8;
    if (/delete|删除/i.test(element.getAttribute("data-testid") || "")) score += 6;
    if (/^(删除|delete|delete chat|删除对话)$/i.test(label)) score += 4;
    if (element.closest(`.${EXT_CLASS}`)) score -= 100;
    if (element.classList.contains(BUTTON_CLASS)) score -= 100;
    return score;
  }

  function getElementLabel(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
  }

  function findDeleteConfirmButton() {
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [data-radix-dialog-content], [aria-modal='true']"))
      .filter(isVisible);

    const roots = dialogs.length ? dialogs : [document.body];
    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll("button")).filter(isActionable);
      const exact = buttons.find((button) => DELETE_TEXT_RE.test(button.textContent.trim()));
      if (exact) return exact;

      const destructive = buttons.find((button) => {
        const label = [
          button.getAttribute("aria-label"),
          button.getAttribute("data-testid"),
          button.textContent
        ].filter(Boolean).join(" ").trim();

        return DELETE_LOOSE_RE.test(label);
      });

      if (destructive) return destructive;
    }

    return null;
  }

  function setBusy(item, button, busy) {
    item.classList.toggle(BUSY_CLASS, busy);
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }

  function showToast(message, isError = false) {
    if (!settings.showToast) return;

    let toast = document.querySelector(`.${TOAST_CLASS}`);
    if (!toast) {
      toast = document.createElement("div");
      toast.className = TOAST_CLASS;
      document.body.append(toast);
    }

    toast.textContent = message;
    toast.dataset.type = isError ? "error" : "success";
    toast.dataset.visible = "true";

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.dataset.visible = "false";
    }, 1800);
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) !== 0;
  }

  function isActionable(element) {
    if (!isVisible(element)) return false;
    if (element.disabled) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    if (element.closest(`.${EXT_CLASS}`)) return false;
    if (element.classList.contains(BUTTON_CLASS)) return false;
    return true;
  }

  function clickElement(element) {
    dispatchPointer(element, "pointerdown");
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    dispatchPointer(element, "pointerup");
    element.click();
  }

  function dispatchPointer(element, type) {
    if (!window.PointerEvent) return;
    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse"
    }));
  }

  function waitFor(getValue, timeout = 2000, interval = 80) {
    const started = performance.now();

    return new Promise((resolve) => {
      const tick = () => {
        const value = getValue();
        if (value) {
          resolve(value);
          return;
        }

        if (performance.now() - started >= timeout) {
          resolve(null);
          return;
        }

        window.setTimeout(tick, interval);
      };

      tick();
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function trashIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z"></path>
        <path d="M6 9h12l-.7 11.1A2 2 0 0 1 15.3 22H8.7a2 2 0 0 1-2-1.9L6 9Z"></path>
        <path d="M10 12v6M14 12v6"></path>
      </svg>
    `;
  }
})();
