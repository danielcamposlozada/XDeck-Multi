(() => {
  if (window.hideAdsMutationObserver) {
    window.hideAdsMutationObserver.disconnect();
    window.hideAdsMutationObserver = null;
  }

  const cells = document.querySelectorAll('div[data-testid="cellInnerDiv"]');
  cells.forEach((cell) => {
    if (cell.querySelector('[data-testid$="-impression-pixel"]')) {
      cell.style.display = "flex";
    }
  });
})();
