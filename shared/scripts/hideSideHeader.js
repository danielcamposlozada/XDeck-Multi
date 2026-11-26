const style = document.createElement('style');
style.type = 'text/css';
style.id = 'xdeck-hide-side-header';
// header: the side navigation of 𝕏's wide layout (older markup).
// div:has(> nav[data-bottom-bar]): what narrow columns pin to the bottom, the navigation bar and
// the floating Post button above it. Only the account's first column keeps the Post button.
style.innerHTML = "header, div:has(> nav[data-bottom-bar]) { display: none !important; }";
document.querySelector('head').appendChild(style);
