const style = document.createElement('style');
style.type = 'text/css';
style.innerHTML = "nav[data-bottom-bar] { display: none !important; }";
document.querySelector('head').appendChild(style);
