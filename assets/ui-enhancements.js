(() => {
  const interactiveSelector = [
    ".nav-item",
    ".nav-sub-item",
    ".method-item",
    ".industry-item",
    ".growth-method-card",
    ".wacc-selection-item",
    ".beta-method-card",
    ".search-result-item",
    ".method-tab",
    ".mode-tab",
    ".tab",
    ".internal-tab",
  ].join(",");

  const nativeInteractive = "button, a, input, select, textarea";

  const shortNavLabel = (label) => {
    if (label.includes("WACC")) return "분석";
    if (label.includes("DCF")) return "DCF";
    if (label.includes("멀티플")) return "멀티플";
    if (
      label.includes("고급") ||
      label.includes("Phase 3") ||
      label.includes("주식") ||
      label.includes("BOPM")
    )
      return "고급";
    return label.trim();
  };

  const enhanceInteractiveElements = () => {
    document.querySelectorAll(interactiveSelector).forEach((element) => {
      if (element.matches(nativeInteractive) || element.dataset.keyboardReady) return;

      element.dataset.keyboardReady = "true";
      element.setAttribute("role", "button");
      element.tabIndex = 0;
      element.addEventListener("keydown", (event) => {
        if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        element.click();
      });
    });
  };

  const syncNavigationState = () => {
    document.querySelectorAll(".nav-item").forEach((item) => {
      const label = item.textContent.trim();
      item.dataset.shortLabel = shortNavLabel(label);
      item.setAttribute("aria-label", label);

      if (item.classList.contains("active")) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    });

    document.querySelectorAll(".nav-sub-item").forEach((item) => {
      if (item.classList.contains("active")) {
        item.setAttribute("aria-current", "step");
      } else {
        item.removeAttribute("aria-current");
      }
    });
  };

  const syncSelectionState = () => {
    document
      .querySelectorAll(
        ".method-item, .industry-item, .growth-method-card, .wacc-selection-item, .beta-method-card, .method-tab, .mode-tab, .tab, .internal-tab",
      )
      .forEach((item) => {
        const selected =
          item.classList.contains("selected") || item.classList.contains("active");
        item.setAttribute("aria-pressed", String(selected));
      });
  };

  const refresh = () => {
    enhanceInteractiveElements();
    syncNavigationState();
    syncSelectionState();
  };

  refresh();

  const root = document.getElementById("root");
  if (!root) return;

  new MutationObserver(refresh).observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
})();
