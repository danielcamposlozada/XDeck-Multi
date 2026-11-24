const style = document.createElement('style');
style.type = 'text/css';
style.innerHTML = "div:has(> main):has(> :nth-child(4)) > main div:has(> div > div[role='progressbar']) { display: none; }";
document.querySelector('head').appendChild(style);
