const style = document.createElement('style');
style.type = 'text/css';
style.id = 'xdeck-hide-post-area';
style.innerHTML = "div:has(> main):has(> :nth-child(4)) > main div:has(> div > div[role='progressbar']) { display: none; }";
document.querySelector('head').appendChild(style);
