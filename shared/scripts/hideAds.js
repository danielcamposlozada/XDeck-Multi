function hideAds() {
  const cells = document.querySelectorAll('div[data-testid="cellInnerDiv"]');
  cells.forEach((cell) => {
    // Ads carry *-impression-pixel elements; placementTracking alone also wraps regular video tweets
    if (cell.querySelector('[data-testid$="-impression-pixel"]')) {
      cell.style.display = "none";
    }
  });
}

if (!window.hideAdsMutationObserver) {
  let hideAdsTimer;
  let observer = new MutationObserver(() => {
    clearTimeout(hideAdsTimer);
    hideAdsTimer = setTimeout(hideAds, 100);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.hideAdsMutationObserver = observer;
}

hideAds();
