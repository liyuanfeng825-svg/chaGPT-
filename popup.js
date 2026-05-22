const defaults = {
  enabled: false,
  showToast: true,
  defaultOffMigrated: true
};

const controls = {
  enabled: document.querySelector("#enabled"),
  showToast: document.querySelector("#showToast")
};

chrome.storage.sync.get(defaults, (settings) => {
  Object.entries(controls).forEach(([key, input]) => {
    input.checked = Boolean(settings[key]);
    input.addEventListener("change", () => {
      chrome.storage.sync.set({
        [key]: input.checked
      });
    });
  });
});
